/**
 * Task #1251 — one-off backfill of tooling vendor invoices (Replit /
 * Anthropic / Perplexity) from attached_assets, so the tooling console has
 * real line-item extractions + proposed splits to work from.
 *
 * Ingests the Invoice-*.pdf files (NOT the Receipt-*.pdf duplicates), parses
 * amount / date / reference deterministically from the PDF text (LLM fallback
 * only when the regexes miss), calls createSupplierInvoiceCore as a
 * founding_partner (409 duplicate → skip), then runs extraction+split
 * proposal synchronously so the report reflects final state.
 *
 * Run from the repo root:
 *   npx tsx artifacts/api-server/scripts/backfill-vendor-invoices.ts           # dry run (default)
 *   npx tsx artifacts/api-server/scripts/backfill-vendor-invoices.ts --apply   # write
 *
 * Splits are NEVER auto-approved here — extraction only proposes. Finance
 * leadership approves in the console.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, atelierUsers, atelierPartnerFirmInvoices, type VendorInvoiceExtraction } from "@workspace/db";
import { extractPdfText } from "../src/lib/atelier-merchant/pdf.js";
import { createSupplierInvoiceCore } from "../src/routes/atelier/financePayablesRoutes.js";
import { detectVendorKey, extractAndProposeForInvoice } from "../src/lib/atelier-vendor-invoice-mining.js";

const APPLY = process.argv.includes("--apply");
const ASSETS_DIR = join(process.cwd(), "..", "..", "attached_assets");
const ORG_ID = "aico";

type Me = typeof atelierUsers.$inferSelect;

function log(...args: unknown[]): void {
  console.log(...args);
}

/** Parse "Aug 4, 2026" / "August 16, 2026" → ISO YYYY-MM-DD. */
function parseInvoiceDate(text: string): string | null {
  const m = text.match(/(?:Invoice date|Date of issue)\s+([A-Za-z]+ \d{1,2},? \d{4})/i);
  if (!m) return null;
  const d = new Date(m[1].replace(",", ""));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Amount due — both vendors print "Amount due  $NNN.NN". */
function parseAmount(text: string): number | null {
  const m = text.match(/Amount due\s+\$([\d,]+\.\d{2})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Invoice number — Replit "YBJGOJ-00094"; Anthropic "LJ4KOL87  0008". */
function parseReference(text: string, fallbackFromName: string): string {
  const m = text.match(/Invoice number\s+([A-Za-z0-9-]+(?:\s+\d+)?)/i);
  if (m) return m[1].replace(/\s+/g, "-").trim();
  return fallbackFromName;
}

function supplierNameFor(text: string): string | null {
  if (/Replit\s+Inc/i.test(text)) return "Replit Inc";
  if (/Anthropic,?\s+PBC/i.test(text)) return "Anthropic, PBC";
  if (/Perplexity/i.test(text)) return "Perplexity AI, Inc.";
  return null;
}

/** Reference embedded in the file name, e.g. Invoice-YBJGOJ-00094_...pdf. */
function refFromFileName(name: string): string {
  const base = name.replace(/^Invoice-/i, "").replace(/_\d+\.pdf$/i, "").replace(/\.pdf$/i, "");
  return base;
}

async function main(): Promise<void> {
  log(`[backfill-vendor-invoices] mode=${APPLY ? "APPLY" : "DRY-RUN"} org=${ORG_ID}`);

  // Acting user: a founding_partner in the org (finance-leadership writer).
  const [me] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.orgId, ORG_ID), eq(atelierUsers.role, "founding_partner")))
    .limit(1);
  if (!me) {
    console.error(`No founding_partner user found in org ${ORG_ID}; cannot ingest.`);
    process.exit(1);
  }
  log(`Acting as ${me.name} (${me.id})`);

  const files = readdirSync(ASSETS_DIR)
    .filter((n) => /^Invoice-.*\.pdf$/i.test(n))
    .sort();
  log(`Found ${files.length} Invoice-*.pdf file(s) (Receipt-*.pdf ignored).`);

  const summary = {
    ingested: 0,
    skippedDuplicate: 0,
    skippedNonTooling: 0,
    failedParse: 0,
    failedIngest: 0,
    extractionOk: 0,
    extractionUnreconciled: 0,
    extractionFailed: 0,
    proposedSplitInvoices: 0,
  };
  const unmappedProjects = new Set<string>();

  for (const fileName of files) {
    const buf = readFileSync(join(ASSETS_DIR, fileName));
    let text = "";
    try {
      const r = await extractPdfText(new Uint8Array(buf));
      text = r.text;
    } catch (e) {
      log(`  [SKIP parse] ${fileName}: ${(e as Error).message}`);
      summary.failedParse += 1;
      continue;
    }

    const supplierName = supplierNameFor(text);
    if (!supplierName || !detectVendorKey(supplierName)) {
      log(`  [SKIP non-tooling] ${fileName}`);
      summary.skippedNonTooling += 1;
      continue;
    }

    const amount = parseAmount(text);
    const invoiceDate = parseInvoiceDate(text);
    // Prefer the filename-derived reference: it captures multi-token invoice
    // numbers (e.g. Anthropic "LJ4KOL87-0008") that the in-text label misses.
    const reference = refFromFileName(fileName) || parseReference(text, refFromFileName(fileName));
    if (amount == null || !reference) {
      log(`  [SKIP parse] ${fileName}: amount=${amount} ref=${reference}`);
      summary.failedParse += 1;
      continue;
    }

    log(`  [${APPLY ? "INGEST" : "DRY"}] ${fileName} → ${supplierName} ${reference} $${amount} ${invoiceDate ?? "(no date)"}`);

    if (!APPLY) {
      // Dry run: don't write, don't extract.
      continue;
    }

    let invoiceId: string | null = null;
    try {
      const out = await createSupplierInvoiceCore({
        me: me as Me,
        fileBuffer: buf,
        fileName,
        supplierName,
        amount,
        currency: "USD",
        reference,
        invoiceDate,
        via: "parsed_doc",
        // Suppress the async mining trigger — this script runs extraction
        // SYNCHRONOUSLY below, and letting both run would race two full split
        // proposals for the same fresh invoice (double-count on approval).
        skipToolingMining: true,
      });
      if (out.status === 409) {
        log(`    duplicate — skipped`);
        summary.skippedDuplicate += 1;
        // Still resolve the existing invoice id so we can (re)extract.
        const [existing] = await db
          .select({ id: atelierPartnerFirmInvoices.id })
          .from(atelierPartnerFirmInvoices)
          .where(and(
            eq(atelierPartnerFirmInvoices.orgId, ORG_ID),
            eq(atelierPartnerFirmInvoices.reference, reference),
          ))
          .limit(1);
        invoiceId = existing?.id ?? null;
      } else if (out.status >= 200 && out.status < 300) {
        const item = out.body?.item as { id?: string } | undefined;
        invoiceId = item?.id ?? (out.body?.id as string) ?? null;
        summary.ingested += 1;
      } else {
        log(`    ingest failed status=${out.status} body=${JSON.stringify(out.body)}`);
        summary.failedIngest += 1;
      }
    } catch (e) {
      log(`    ingest threw: ${(e as Error).message}`);
      summary.failedIngest += 1;
    }

    if (!invoiceId) continue;

    // Run extraction + split proposal synchronously (bypass the fire-and-
    // forget trigger so the report reflects final state).
    try {
      const res = await extractAndProposeForInvoice(invoiceId);
      if (res.status === "ok") summary.extractionOk += 1;
      else if (res.status === "unreconciled") summary.extractionUnreconciled += 1;
      else summary.extractionFailed += 1;

      // Read back the extraction to collect unmapped project names + split flag.
      const [row] = await db
        .select({ toolingExtraction: atelierPartnerFirmInvoices.toolingExtraction })
        .from(atelierPartnerFirmInvoices)
        .where(eq(atelierPartnerFirmInvoices.id, invoiceId));
      const ext = (row?.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
      if (ext?.status === "ok") {
        for (const it of ext.items) unmappedProjects.add(it.projectLabel);
      }
      log(`    extraction=${res.status}`);
    } catch (e) {
      log(`    extraction threw: ${(e as Error).message}`);
      summary.extractionFailed += 1;
    }
  }

  // Count invoices that ended up with proposed splits.
  if (APPLY) {
    const rows = await db
      .select({ id: atelierPartnerFirmInvoices.id, toolingExtraction: atelierPartnerFirmInvoices.toolingExtraction, name: atelierPartnerFirmInvoices.partnerFirmName })
      .from(atelierPartnerFirmInvoices)
      .where(eq(atelierPartnerFirmInvoices.orgId, ORG_ID));
    for (const r of rows) {
      if (!detectVendorKey(r.name)) continue;
      const ext = (r.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
      if (ext?.status === "ok" && ext.items.length > 0) summary.proposedSplitInvoices += 1;
    }
  }

  log("\n[backfill-vendor-invoices] SUMMARY");
  log(JSON.stringify(summary, null, 2));
  if (unmappedProjects.size > 0) {
    log(`\nDistinct project labels seen (map these in /finance/tooling?focus=unmapped):`);
    for (const p of [...unmappedProjects].sort()) log(`  - ${p}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
