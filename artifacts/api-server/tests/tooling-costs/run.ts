/**
 * Task #1251 — vendor tooling spend probes.
 *
 * Proves the invariants that money-correctness depends on, driving the REAL
 * mining lib + REST routes against an isolated scratch DB (no LLM: we hand
 * the extraction payloads directly to proposeSplitsForInvoice / store them on
 * the invoice, so behaviour is deterministic):
 *
 *   (a) HARD recon gate blocks bad sums — reconciles() rejects an extraction
 *       whose items don't tie to subtotal/total, and never scales.
 *   (b) UNMAPPED → inbox + no splits: a reconciled invoice with an unmapped
 *       project proposes NO splits and surfaces a vendor_project_unmapped
 *       inbox item.
 *   (c) MAP → re-propose exact-to-cent pro-rata with credits + VAT: mapping
 *       the project makes proposeSplitsForInvoice emit splits whose gross /
 *       credit / vat / net tie to the invoice figures to the cent.
 *   (d) APPROVE → engagement cost-to-date recompute + audit: approving the
 *       engagement-bucket splits adds their USD to subsToDate and writes a
 *       tooling.splits_approved audit event.
 *   (e) FLAT invoice + vendor rule %: a flat (__vendor_default__) invoice
 *       fans out across the vendor alloc rule's percentages, summing exactly.
 *   (f) FORGED approve on an unmapped invoice → 409 (never approves without
 *       proposed splits).
 *
 * Run: NODE_ENV=test tsx tests/tooling-costs/run.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierAccounts, atelierEngagements,
    atelierEngagementBudget, atelierEngagementCostToDate,
    atelierPartnerFirmInvoices, atelierVendorProjectMap, atelierVendorAllocRules,
    atelierVendorCostSplits, atelierAuditEvents,
  } = D as any;
  const { and, eq } = await import("drizzle-orm");
  const mining = await import("../../src/lib/atelier-vendor-invoice-mining.js");

  const STAMP = Date.now();
  const ORG = "aico"; // scratch DB; RLS defaults to 'aico'
  const FP_ID = `p_tc_fp_${STAMP}`;
  const CONSULT_ID = `p_tc_con_${STAMP}`;
  const ACC_ID = `acc_tc_${STAMP}`;
  const ENG_ID = `eng_tc_${STAMP}`;

  function invId(tag: string) { return `pfi_tc_${tag}_${STAMP}`; }
  const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

  // Minimal invoice row (no blob needed — we never re-extract via LLM here).
  async function seedInvoice(tag: string, supplier: string, total: number, currency = "USD") {
    const id = invId(tag);
    await db.insert(atelierPartnerFirmInvoices).values({
      id, orgId: ORG,
      partnerFirmId: "unlinked", partnerFirmName: supplier,
      weekIso: "2026-08-04",
      costAmount: total, costCurrency: currency, usdAmount: total,
      invoiceDate: "2026-08-04", reference: `TC-${tag}-${STAMP}`,
      fileName: `${tag}.pdf`, status: "submitted",
      submittedByUserId: FP_ID, submittedAt: new Date(),
    }).onConflictDoNothing();
    return id;
  }

  // Build + store an "ok" extraction payload and (best-effort) propose splits.
  function payload(items: Array<{ label: string; amount: number }>, opts: { subtotal: number; vat: number; credits: number; currency?: string }) {
    return {
      status: "ok" as const,
      extractedAt: new Date().toISOString(),
      currency: opts.currency ?? "USD",
      subtotal: opts.subtotal,
      vatAmount: opts.vat,
      creditsTotal: opts.credits,
      items: items.map((it) => ({
        projectKey: mining.projectKeyFromLabel(it.label),
        projectLabel: it.label,
        category: null,
        amount: it.amount,
      })),
      note: null,
    };
  }
  async function storeAndPropose(id: string, supplier: string, pl: any) {
    await db.update(atelierPartnerFirmInvoices).set({ toolingExtraction: pl }).where(eq(atelierPartnerFirmInvoices.id, id));
    const [inv] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, id));
    return mining.proposeSplitsForInvoice({
      inv: {
        id: inv.id, orgId: inv.orgId, partnerFirmName: inv.partnerFirmName,
        costAmount: Number(inv.costAmount || 0), costCurrency: inv.costCurrency,
        invoiceDate: inv.invoiceDate, fileName: inv.fileName, reference: inv.reference, blobRef: inv.blobRef,
      },
      vendorKey: mining.detectVendorKey(supplier)!,
      payload: pl,
    });
  }

  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(method: string, path: string, personaId: string, body?: Record<string, unknown>) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${personaId}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  try {
    // ---- Setup: FP + consultant + account + engagement (+ budget/cost rows).
    await db.insert(atelierUsers).values([
      { id: FP_ID, orgId: ORG, email: `${FP_ID}@ex.com`, name: "TC FP", initials: "TF", role: "founding_partner", roleLabel: "FP", title: "FP", permissions: [], bdActive: false },
      { id: CONSULT_ID, orgId: ORG, email: `${CONSULT_ID}@ex.com`, name: "TC Con", initials: "TC", role: "consultant", roleLabel: "Con", title: "Con", permissions: [], bdActive: false },
    ]).onConflictDoNothing();

    await db.insert(atelierAccounts).values({
      id: ACC_ID, orgId: ORG, name: `TC Account ${STAMP}`,
      country: "AE", sector: "public", tier: "A", status: "active",
    }).onConflictDoNothing();

    await db.insert(atelierEngagements).values({
      id: ENG_ID, orgId: ORG, slug: `tc-eng-${STAMP}`, name: `TC Engagement ${STAMP}`,
      accountId: ACC_ID, plmStage: "deliver", partnerOwnerId: FP_ID, engagementLeadId: FP_ID,
      startDate: "2026-01-01", plannedEndDate: "2026-12-31",
    }).onConflictDoNothing();
    await db.insert(atelierEngagementBudget).values({ engagementId: ENG_ID, orgId: ORG }).onConflictDoNothing();
    await db.insert(atelierEngagementCostToDate).values({
      engagementId: ENG_ID, orgId: ORG, asOf: "2026-08-04",
      labourHoursToDate: 0, labourCostToDateUsd: 0, expensesToDateUsd: 0,
      subsToDateUsd: 0, costToDateUsd: 0, revenueRecognisedToDateUsd: 0,
      invoicedToDateUsd: 0, cashCollectedToDateUsd: 0, pctComplete: 0,
    }).onConflictDoNothing();

    // ============================================================
    // (a) HARD recon gate blocks bad sums (pure function).
    // ============================================================
    const goodRecon = mining.reconciles(
      { items: [{ projectLabel: "P", category: null, amount: 100 }], subtotal: 100, vatAmount: 5, creditsTotal: 0, currency: "USD" },
      105,
    );
    const badItemSum = mining.reconciles(
      { items: [{ projectLabel: "P", category: null, amount: 90 }], subtotal: 100, vatAmount: 5, creditsTotal: 0, currency: "USD" },
      105,
    );
    const badTotal = mining.reconciles(
      { items: [{ projectLabel: "P", category: null, amount: 100 }], subtotal: 100, vatAmount: 5, creditsTotal: 0, currency: "USD" },
      999,
    );
    check("(a) recon accepts well-formed", goodRecon === true);
    check("(a) recon rejects item-sum≠subtotal", badItemSum === false);
    check("(a) recon rejects subtotal≠total", badTotal === false);

    // ============================================================
    // (a2) Deterministic Replit parser: multi-section, per-section credits,
    // a $-prefixed Rate column (must not be read as the amount), and aggregate
    // by project. Item NET must sum to the printed subtotal to the cent.
    //   Agent Usage $110.00 gross (Alpha 100 + Beta 10) − $10 pre-purchase → net 100
    //   Neon Compute Time $0.05 gross (Alpha .03 + Beta .02) − $0.03 → net 0.02
    //   Subtotal 100.02, VAT 5.00, Amount due 105.02
    const replitText = [
      "INVOICE Replit Inc Invoice number ZZ-1 Invoice date Aug 4, 2026",
      "Description   Quantity   Rate (excl. tax)   Tax   Amount (excl. tax)",
      "Agent Usage  Aug 4, 2026  5%   $110.00",
      "Alpha   100   $1.00   $100.00",
      "Beta   10   $1.00   $10.00",
      "Pre-purchase applied   -$10.00",
      "Neon Compute Time  Aug 4, 2026  5%   $0.05",
      "Alpha   0.19   $0.16   $0.03",
      "Beta   0.12   $0.16   $0.02",
      "Pre-purchase applied   -$0.03",
      "Subtotal   $100.02 VAT (5%)   $5.00  Amount due   $105.02  1 of 1",
    ].join(" ");
    const parsed = mining.parseReplitInvoice(replitText);
    const pItems = parsed?.items ?? [];
    const pSum = pItems.reduce((s, i) => s + i.amount, 0);
    const alpha = pItems.find((i) => i.projectLabel === "Alpha")?.amount ?? -1;
    const beta = pItems.find((i) => i.projectLabel === "Beta")?.amount ?? -1;
    check("(a2) deterministic parser returns a reconciling extraction", !!parsed && Math.round(pSum * 100) === 10002, { pSum, subtotal: parsed?.subtotal });
    check("(a2) parser reads Amount col not Rate (Alpha net = 90.92)", Math.round(alpha * 100) === 9092, { alpha });
    check("(a2) parser aggregates Beta across sections (net = 9.10)", Math.round(beta * 100) === 910, { beta });
    check("(a2) parser reports creditsTotal (10.03) positive", Math.round((parsed?.creditsTotal ?? 0) * 100) === 1003, { credits: parsed?.creditsTotal });
    check("(a2) full parse also passes the recon gate", !!parsed && mining.reconciles(parsed, 105.02) === true);

    // A stored unreconciled invoice must never yield proposed splits: emulate
    // by NOT proposing (extractAndPropose would store unreconciled). We assert
    // proposeSplitsForInvoice with a payload whose project is unmapped yields
    // no splits (covered by (b)).

    // ============================================================
    // (b) UNMAPPED → inbox + no splits.
    // ============================================================
    const invB = await seedInvoice("b", "Replit Inc", 105);
    const plB = payload([{ label: "Ministry Ops Hub", amount: 100 }], { subtotal: 100, vat: 5, credits: 0 });
    const resB = await storeAndPropose(invB, "Replit Inc", plB);
    const bSplits = await db.select().from(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.invoiceId, invB));
    check("(b) unmapped → proposeSplits reports unmapped", resB.unmapped === true && resB.proposed === false, resB);
    check("(b) unmapped → zero splits persisted", bSplits.length === 0);

    const inbox = await call("GET", "/finance/approvals/inbox", FP_ID);
    const inboxItems = (inbox.body?.data?.items ?? inbox.body?.items ?? []) as any[];
    const hasUnmapped = inboxItems.some((i) => i.kind === "vendor_project_unmapped");
    check("(b) inbox surfaces vendor_project_unmapped", inbox.status === 200 && hasUnmapped, { status: inbox.status, kinds: inboxItems.map((i) => i.kind) });

    // ============================================================
    // (c) MAP → re-propose exact-to-cent pro-rata with credits + VAT.
    // ============================================================
    const mapRes = await call("POST", "/finance/tooling/map", FP_ID, {
      vendorKey: "replit", projectKey: mining.projectKeyFromLabel("Ministry Ops Hub"),
      bucketType: "engagement", bucketRef: ENG_ID,
    });
    check("(c) map returns 200 + reproposes invoice", mapRes.status === 200 && (mapRes.body?.data?.reproposedInvoiceIds ?? []).includes(invB), mapRes.body);

    // Use a fresh invoice with credits+VAT split across TWO projects to
    // exercise pro-rata to the cent. MODEL (mirrors the deterministic parser
    // and the LLM prompt): item amounts are POST-CREDIT NET and sum to the
    // printed subtotal; the invoice total = subtotal + VAT. creditsTotal is
    // an INFORMATIONAL figure that must NOT be re-subtracted from net.
    //   post-credit net 60 + 40 = 100 (subtotal) ; vat 5.00 ; total 105.00
    //   creditsTotal 9.99 recorded for display only (does not move net).
    const invC = await seedInvoice("c", "Replit Inc", 105.0);
    await call("POST", "/finance/tooling/map", FP_ID, {
      vendorKey: "replit", projectKey: mining.projectKeyFromLabel("Proj A"),
      bucketType: "engagement", bucketRef: ENG_ID,
    });
    await call("POST", "/finance/tooling/map", FP_ID, {
      vendorKey: "replit", projectKey: mining.projectKeyFromLabel("Proj B"),
      bucketType: "internal", bucketRef: null,
    });
    const plC = payload([{ label: "Proj A", amount: 60 }, { label: "Proj B", amount: 40 }], { subtotal: 100, vat: 5, credits: 9.99 });
    const resC = await storeAndPropose(invC, "Replit Inc", plC);
    const cSplits = await db.select().from(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.invoiceId, invC));
    const sumGross = cSplits.reduce((s: number, r: any) => s + Number(r.grossAmount), 0);
    const sumCredit = cSplits.reduce((s: number, r: any) => s + Number(r.creditAmount), 0);
    const sumVat = cSplits.reduce((s: number, r: any) => s + Number(r.vatAmount), 0);
    const sumNet = cSplits.reduce((s: number, r: any) => s + Number(r.netAmount), 0);
    const cents = (n: number) => Math.round(n * 100);
    check("(c) proposed 2 splits", resC.proposed === true && cSplits.length === 2, { resC, n: cSplits.length });
    check("(c) gross(net-of-credit) sums to subtotal to the cent", cents(sumGross) === cents(100), sumGross);
    check("(c) informational credit sums to creditsTotal to the cent", cents(sumCredit) === cents(9.99), sumCredit);
    check("(c) vat sums to vatAmount to the cent", cents(sumVat) === cents(5), sumVat);
    check("(c) net sums to invoice total (subtotal+VAT, credit NOT re-subtracted)", cents(sumNet) === cents(105.0), sumNet);

    // ============================================================
    // (d) APPROVE → engagement cost-to-date recompute + audit.
    // ============================================================
    // invC has one engagement-bucket split (Proj A) + one internal (Proj B).
    const engSplit = cSplits.find((r: any) => r.bucketType === "engagement");
    const approve = await call("POST", `/finance/tooling/invoices/${invC}/approve`, FP_ID);
    check("(d) approve 200", approve.status === 200, approve.body);
    const approvedRows = await db.select().from(atelierVendorCostSplits).where(and(eq(atelierVendorCostSplits.invoiceId, invC), eq(atelierVendorCostSplits.status, "approved")));
    check("(d) both splits approved", approvedRows.length === 2, approvedRows.length);

    const [ctd] = await db.select().from(atelierEngagementCostToDate).where(eq(atelierEngagementCostToDate.engagementId, ENG_ID));
    const engUsd = Number(engSplit?.usdAmount ?? 0);
    check("(d) engagement subsToDate includes tooling split usd", cents(Number(ctd.subsToDateUsd)) === cents(engUsd) && engUsd > 0, { subs: ctd.subsToDateUsd, engUsd });

    const auditRows = await db.select().from(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityId, invC), eq(atelierAuditEvents.action, "tooling.splits_approved")));
    check("(d) tooling.splits_approved audit written", auditRows.length === 1, auditRows.length);

    // ============================================================
    // (e) FLAT invoice + vendor rule %.
    // ============================================================
    const ruleRes = await call("PUT", "/finance/tooling/vendor-rules", FP_ID, {
      vendorKey: "anthropic",
      splits: [
        { bucketType: "engagement", bucketRef: ENG_ID, pct: 70 },
        { bucketType: "internal", bucketRef: null, pct: 30 },
      ],
    });
    check("(e) vendor rule set 200", ruleRes.status === 200, ruleRes.body);

    const invE = await seedInvoice("e", "Anthropic, PBC", 11.32);
    // Flat: single __vendor_default__ item at pre-VAT subtotal 10.78; vat .54; total 11.32.
    const plE = {
      status: "ok" as const, extractedAt: new Date().toISOString(), currency: "USD",
      subtotal: 10.78, vatAmount: 0.54, creditsTotal: 0,
      items: [{ projectKey: mining.VENDOR_DEFAULT_KEY, projectLabel: "Auto recharge, Team plan", category: null, amount: 10.78 }],
      note: null,
    };
    const resE = await storeAndPropose(invE, "Anthropic, PBC", plE);
    const eSplits = await db.select().from(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.invoiceId, invE));
    const eGross = eSplits.reduce((s: number, r: any) => s + Number(r.grossAmount), 0);
    const eNet = eSplits.reduce((s: number, r: any) => s + Number(r.netAmount), 0);
    check("(e) flat fans out to 2 rule buckets", resE.proposed === true && eSplits.length === 2, { resE, n: eSplits.length });
    check("(e) flat gross sums to subtotal", cents(eGross) === cents(10.78), eGross);
    check("(e) flat net sums to total", cents(eNet) === cents(11.32), eNet);
    const engBucket = eSplits.find((r: any) => r.bucketType === "engagement");
    check("(e) 70% bucket gross ≈ 7.55", engBucket && cents(Number(engBucket.grossAmount)) === cents(7.55), engBucket?.grossAmount);

    // ============================================================
    // (f) FORGED approve on an unmapped invoice → 409.
    // ============================================================
    const invF = await seedInvoice("f", "Replit Inc", 105);
    const plF = payload([{ label: "Never Mapped Project", amount: 100 }], { subtotal: 100, vat: 5, credits: 0 });
    await storeAndPropose(invF, "Replit Inc", plF); // unmapped → no splits
    const forged = await call("POST", `/finance/tooling/invoices/${invF}/approve`, FP_ID);
    check("(f) approve on unmapped → 409", forged.status === 409, forged.body);

    // Bonus: non-finance persona is refused on the console.
    const denied = await call("GET", "/finance/tooling/overview", CONSULT_ID);
    check("(f) consultant denied tooling overview (403)", denied.status === 403, denied.status);

    // ============================================================
    // (g) END-TO-END with GENUINE Replit-credit semantics: parse a real
    // multi-section, credit-bearing invoice text, map every project, propose
    // splits, and assert sum(split.netUsd) === invoice total to the cent.
    // This is the regression guard for the credit double-count bug: the parser
    // emits POST-CREDIT NET items, so netUsd must NOT re-subtract credits.
    // ============================================================
    const gText = [
      "INVOICE Replit Inc Invoice number GG-1 Invoice date Aug 4, 2026",
      "Description   Quantity   Rate (excl. tax)   Tax   Amount (excl. tax)",
      "Agent Usage  Aug 4, 2026  5%   $110.00",
      "Alpha   100   $1.00   $100.00",
      "Beta   10   $1.00   $10.00",
      "Pre-purchase applied   -$10.00",
      "Neon Compute Time  Aug 4, 2026  5%   $0.05",
      "Alpha   0.19   $0.16   $0.03",
      "Beta   0.12   $0.16   $0.02",
      "Pre-purchase applied   -$0.03",
      "Subtotal   $100.02 VAT (5%)   $5.00  Amount due   $105.02  1 of 1",
    ].join(" ");
    const gParsed = mining.parseReplitInvoice(gText);
    check("(g) real credit-bearing invoice parses", !!gParsed, gParsed);
    // invoice total = subtotal + VAT = 105.02 (credits already inside subtotal)
    const invG = await seedInvoice("g", "Replit Inc", 105.02);
    for (const it of gParsed?.items ?? []) {
      await call("POST", "/finance/tooling/map", FP_ID, {
        vendorKey: "replit", projectKey: mining.projectKeyFromLabel(it.projectLabel),
        bucketType: "engagement", bucketRef: ENG_ID,
      });
    }
    const gPayload = {
      status: "ok" as const, extractedAt: new Date().toISOString(),
      currency: gParsed!.currency, subtotal: gParsed!.subtotal,
      vatAmount: gParsed!.vatAmount, creditsTotal: gParsed!.creditsTotal,
      items: (gParsed?.items ?? []).map((it) => ({
        projectKey: mining.projectKeyFromLabel(it.projectLabel), projectLabel: it.projectLabel, category: it.category, amount: it.amount,
      })),
      note: null,
    };
    const resG = await storeAndPropose(invG, "Replit Inc", gPayload);
    const gSplits = await db.select().from(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.invoiceId, invG));
    const gNet = gSplits.reduce((s: number, r: any) => s + Number(r.netAmount), 0);
    const gNetUsd = gSplits.reduce((s: number, r: any) => s + Number(r.usdAmount), 0);
    const gCredit = gSplits.reduce((s: number, r: any) => s + Number(r.creditAmount), 0);
    check("(g) splits proposed for every parsed project", resG.proposed === true && gSplits.length >= 1, { resG, n: gSplits.length });
    check("(g) sum(split.netAmount) === invoice total 105.02 (credit NOT double-counted)", cents(gNet) === cents(105.02), gNet);
    check("(g) sum(split.netUsd) === invoice total to the cent", cents(gNetUsd) === cents(105.02), gNetUsd);
    check("(g) informational credit total preserved (10.03)", cents(gCredit) === cents(10.03), gCredit);

    // splits_proposed audit written with count + net total.
    const gpAudit = await db.select().from(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityId, invG), eq(atelierAuditEvents.action, "tooling.splits_proposed")));
    const gpPayload = (gpAudit[0]?.payload ?? {}) as any;
    check("(g) tooling.splits_proposed audit written with count+total", gpAudit.length >= 1 && Number(gpPayload.count) === gSplits.length && cents(Number(gpPayload.netTotalUsd)) === cents(105.02), { n: gpAudit.length, payload: gpPayload });

    // ============================================================
    // (h) FLAT vendor: sentinel projectKey + rule-vendor listing.
    // ============================================================
    // GET vendor-rules must list a row per supported vendor even when unset,
    // so the console can seed the first rule (anthropic already set in (e)).
    const rulesGet = await call("GET", "/finance/tooling/vendor-rules", FP_ID);
    const ruleVendors = ((rulesGet.body?.data?.rules ?? []) as any[]).map((r) => r.vendorKey).sort();
    check("(h) vendor-rules lists anthropic+perplexity+replit", rulesGet.status === 200 && JSON.stringify(ruleVendors) === JSON.stringify(["anthropic", "perplexity", "replit"]), ruleVendors);
    const perpRow = ((rulesGet.body?.data?.rules ?? []) as any[]).find((r) => r.vendorKey === "perplexity");
    check("(h) unset vendor returns splits: [] (addable card)", !!perpRow && Array.isArray(perpRow.splits) && perpRow.splits.length === 0, perpRow);

    // A flat-vendor extraction with a description label must carry the sentinel
    // projectKey (so it resolves through the rule, never as a description slug).
    const invH = await seedInvoice("h", "Anthropic, PBC", 11.32);
    const plH = {
      status: "ok" as const, extractedAt: new Date().toISOString(), currency: "USD",
      subtotal: 10.78, vatAmount: 0.54, creditsTotal: 0,
      items: [{ projectKey: mining.VENDOR_DEFAULT_KEY, projectLabel: "Auto recharge, Team plan (variable desc)", category: null, amount: 10.78 }],
      note: null,
    };
    const resH = await storeAndPropose(invH, "Anthropic, PBC", plH);
    const hSplits = await db.select().from(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.invoiceId, invH));
    check("(h) flat sentinel resolves via rule (not stranded by description)", resH.proposed === true && hSplits.length === 2, { resH, n: hSplits.length });

    // ============================================================
    // (i) APPROVED SPLITS ARE IMMUTABLE — no automatic re-proposal may churn
    // or double-count them. invC was approved in (d) with 2 approved splits
    // (Proj A engagement + Proj B internal). Approve invH (flat anthropic) too
    // for the vendor-rule case.
    // ============================================================
    const snapshot = async (invoiceId: string) => {
      const all = await db.select().from(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.invoiceId, invoiceId));
      const approved = all.filter((r: any) => r.status === "approved");
      const proposed = all.filter((r: any) => r.status === "proposed");
      const approvedUsd = approved.reduce((s: number, r: any) => s + Number(r.usdAmount), 0);
      return { total: all.length, approved: approved.length, proposed: proposed.length, approvedUsd, ids: all.map((r: any) => r.id).sort() };
    };
    // (i-a) approve → change mapping → no new proposed rows, approved unchanged.
    const cBefore = await snapshot(invC);
    const remap = await call("POST", "/finance/tooling/map", FP_ID, {
      vendorKey: "replit", projectKey: mining.projectKeyFromLabel("Proj A"),
      bucketType: "internal", bucketRef: null, // change the bucket for Proj A
    });
    const cAfter = await snapshot(invC);
    const remapReproposed = (remap.body?.data?.reproposedInvoiceIds ?? []) as string[];
    check("(i-a) remap excludes approved invoice from re-proposal", remap.status === 200 && !remapReproposed.includes(invC), { status: remap.status, remapReproposed });
    check("(i-a) approved invoice: no proposed rows created", cAfter.proposed === 0, cAfter);
    check("(i-a) approved rows + spend unchanged after remap", cAfter.approved === cBefore.approved && cents(cAfter.approvedUsd) === cents(cBefore.approvedUsd) && JSON.stringify(cAfter.ids) === JSON.stringify(cBefore.ids), { cBefore, cAfter });

    // (i-b) approve flat invoice → PUT vendor rule → no new proposed rows.
    const approveH = await call("POST", `/finance/tooling/invoices/${invH}/approve`, FP_ID);
    check("(i-b) approve flat invoice 200", approveH.status === 200, approveH.body);
    const hBefore = await snapshot(invH);
    const ruleReput = await call("PUT", "/finance/tooling/vendor-rules", FP_ID, {
      vendorKey: "anthropic",
      splits: [
        { bucketType: "engagement", bucketRef: ENG_ID, pct: 50 },
        { bucketType: "internal", bucketRef: null, pct: 50 },
      ],
    });
    const hAfter = await snapshot(invH);
    check("(i-b) vendor-rule re-PUT 200", ruleReput.status === 200, ruleReput.body);
    check("(i-b) approved flat invoice: no proposed rows, approved unchanged", hAfter.proposed === 0 && hAfter.approved === hBefore.approved && JSON.stringify(hAfter.ids) === JSON.stringify(hBefore.ids), { hBefore, hAfter });

    // (i-c) approve → POST /extract → 409, no row churn, engagement total same.
    // Capture the engagement total NOW (after the legitimate i-b approval) so
    // the assertion isolates the blocked re-proposal's effect.
    const [ctdBefore] = await db.select().from(atelierEngagementCostToDate).where(eq(atelierEngagementCostToDate.engagementId, ENG_ID));
    const cPreExtract = await snapshot(invC);
    const reextract = await call("POST", `/finance/tooling/invoices/${invC}/extract`, FP_ID);
    const cPostExtract = await snapshot(invC);
    check("(i-c) extract on approved invoice → 409 splits-already-approved", reextract.status === 409 && reextract.body?.error === "splits-already-approved", { status: reextract.status, body: reextract.body });
    check("(i-c) no split row churn after blocked extract", JSON.stringify(cPostExtract) === JSON.stringify(cPreExtract), { cPreExtract, cPostExtract });
    const [ctdAfter] = await db.select().from(atelierEngagementCostToDate).where(eq(atelierEngagementCostToDate.engagementId, ENG_ID));
    check("(i-c) engagement subsToDate unchanged after blocked re-proposals", cents(Number(ctdAfter.subsToDateUsd)) === cents(Number(ctdBefore.subsToDateUsd)), { before: ctdBefore.subsToDateUsd, after: ctdAfter.subsToDateUsd });

    // ============================================================
    // (j) AMBIGUOUS GROSS-BEFORE-CREDIT LLM RESULT must never persist an
    // overstated cost. The canonical bug case: an LLM returns pre-credit
    // items/subtotal 110, credits 10, VAT 5, invoice total 105. Split creation
    // is post-credit (net = gross + VAT), so persisting this verbatim yields
    // splits netting 115 > 105. The strict gate + normalizer must instead
    // rewrite it to post-credit (subtotal 100, items summing to 100) so splits
    // net exactly 105 — or quarantine it. `mined` here is exactly the struct
    // mineInvoiceText() returns from the LLM (stubbed LLM output).
    const llmGrossBeforeCredit = {
      currency: "USD",
      subtotal: 110, vatAmount: 5, creditsTotal: 10,
      items: [
        { projectLabel: "Proj A", category: null, amount: 70 },
        { projectLabel: "Proj B", category: null, amount: 40 },
      ],
    };
    // Strict gate rejects the raw gross-before-credit form.
    check("(j) strict reconciles() rejects raw gross-before-credit (110/10/5/105)", mining.reconciles(llmGrossBeforeCredit, 105) === false, llmGrossBeforeCredit);
    // Normalizer rewrites to canonical post-credit and passes the strict gate.
    const jNorm = mining.normalizeToPostCredit(llmGrossBeforeCredit, 105);
    const jItemSum = (jNorm?.items ?? []).reduce((s: number, it: any) => s + it.amount, 0);
    check("(j) normalizeToPostCredit rewrites subtotal to post-credit 100", !!jNorm && cents(jNorm.subtotal) === cents(100) && cents(jItemSum) === cents(100), jNorm);
    check("(j) normalized form passes STRICT post-credit gate (100+5=105)", !!jNorm && mining.reconciles(jNorm, 105) === true, jNorm);
    check("(j) creditsTotal retained as informational (10)", !!jNorm && cents(jNorm.creditsTotal) === cents(10), jNorm?.creditsTotal);

    // Persist the NORMALIZED result end-to-end and assert splits net to 105,
    // never 115 (the double-count/overstatement the strict gate prevents).
    const invJ = await seedInvoice("j", "Perplexity AI", 105);
    await call("PUT", "/finance/tooling/vendor-rules", FP_ID, {
      vendorKey: "perplexity",
      splits: [{ bucketType: "internal", bucketRef: null, pct: 100 }],
    });
    const plJ = {
      status: "ok" as const, extractedAt: new Date().toISOString(), currency: "USD",
      subtotal: jNorm!.subtotal, vatAmount: jNorm!.vatAmount, creditsTotal: jNorm!.creditsTotal,
      // Flat vendor → sentinel key so it resolves through the rule.
      items: [{ projectKey: mining.VENDOR_DEFAULT_KEY, projectLabel: "Perplexity usage", category: null, amount: jNorm!.subtotal }],
      note: null,
    };
    const resJ = await storeAndPropose(invJ, "Perplexity AI", plJ);
    const jSplits = await db.select().from(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.invoiceId, invJ));
    const jNet = jSplits.reduce((s: number, r: any) => s + Number(r.netAmount), 0);
    check("(j) persisted splits net EXACTLY 105 (never 115)", resJ.proposed === true && cents(jNet) === cents(105) && cents(jNet) !== cents(115), { resJ, jNet });

    // Quarantine: a figure set matching NEITHER identity must return null.
    const jBad = { currency: "USD", subtotal: 110, vatAmount: 5, creditsTotal: 0,
      items: [{ projectLabel: "X", category: null, amount: 110 }] };
    check("(j) neither-identity figures quarantined (null)", mining.normalizeToPostCredit(jBad, 105) === null, jBad);

    // ============================================================
    // (k) CONCURRENCY — no duplicate proposed set. Two extract+propose runs
    // for the SAME fresh invoice (the async trigger + a synchronous backfill/
    // manual /extract) could each insert a FULL proposed set → double-count on
    // approval. proposeSplitsForInvoice is the split-writing critical section
    // (per-invoice advisory lock + partial unique index uq_..._proposed_identity);
    // firing two concurrently must leave EXACTLY ONE complete proposed set.
    const invK = await seedInvoice("k", "Replit Inc", 105.0);
    await call("POST", "/finance/tooling/map", FP_ID, {
      vendorKey: "replit", projectKey: mining.projectKeyFromLabel("Conc A"),
      bucketType: "engagement", bucketRef: ENG_ID,
    });
    await call("POST", "/finance/tooling/map", FP_ID, {
      vendorKey: "replit", projectKey: mining.projectKeyFromLabel("Conc B"),
      bucketType: "internal", bucketRef: null,
    });
    const plK = payload([{ label: "Conc A", amount: 60 }, { label: "Conc B", amount: 40 }], { subtotal: 100, vat: 5, credits: 0 });
    await db.update(atelierPartnerFirmInvoices).set({ toolingExtraction: plK }).where(eq(atelierPartnerFirmInvoices.id, invK));
    const [invKRow] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, invK));
    const invKArg = {
      id: invKRow.id, orgId: invKRow.orgId, partnerFirmName: invKRow.partnerFirmName,
      costAmount: Number(invKRow.costAmount || 0), costCurrency: invKRow.costCurrency,
      invoiceDate: invKRow.invoiceDate, fileName: invKRow.fileName, reference: invKRow.reference, blobRef: invKRow.blobRef,
    };
    // Fire two proposals concurrently. At least one succeeds; a loser that
    // collides on the unique index rejects (never a second full set).
    const conc = await Promise.allSettled([
      mining.proposeSplitsForInvoice({ inv: invKArg, vendorKey: "replit", payload: plK }),
      mining.proposeSplitsForInvoice({ inv: invKArg, vendorKey: "replit", payload: plK }),
    ]);
    const kSplits = await db.select().from(atelierVendorCostSplits).where(and(eq(atelierVendorCostSplits.invoiceId, invK), eq(atelierVendorCostSplits.status, "proposed")));
    const kNet = kSplits.reduce((s: number, r: any) => s + Number(r.netAmount), 0);
    const anyFulfilledProposed = conc.some((r) => r.status === "fulfilled" && (r.value as any).proposed === true);
    check("(k) at least one concurrent proposal fulfilled", anyFulfilledProposed, conc.map((r) => r.status));
    check("(k) EXACTLY ONE complete proposed set (2 rows, no duplicates)", kSplits.length === 2, { n: kSplits.length });
    check("(k) concurrent proposed set net ties to total 105 (no double-count)", cents(kNet) === cents(105.0), kNet);
  } finally {
    // Scratch DB is per-run/isolated; still clean our rows for reuse.
    try {
      await db.delete(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.orgId, ORG));
      await db.delete(atelierVendorProjectMap).where(eq(atelierVendorProjectMap.orgId, ORG));
      await db.delete(atelierVendorAllocRules).where(eq(atelierVendorAllocRules.orgId, ORG));
    } catch { /* best effort */ }
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
  console.log("\nAll tooling-costs probes passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
