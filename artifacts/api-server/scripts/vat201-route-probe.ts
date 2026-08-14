/**
 * Task #1102 probe — VAT 201 export route: PDF/CSV downloads, export audit
 * trail, UAE-only gating, and mark-filed payload linkage.
 * Fixture-scoped; cleans up in finally.
 */
import express from "express";
import { and, eq, like } from "drizzle-orm";
import {
  db, atelierLegalEntities, atelierGlAccount, atelierGlJournalEntry,
  atelierGlJournalLine, atelierInvoice, atelierVatRegister, atelierAuditEvents, atelierUsers,
} from "@workspace/db";
import vatRoutes from "../src/routes/atelier/vatRoutes.js";

const ORG = "aico";
const P = "probe_v201r";
const ENT = `${P}_ent`;
const ENT_SA = `${P}_ent_sa`;
const PERIOD = "2026-07";

function fail(msg: string): never { throw new Error(`FAIL: ${msg}`); }

async function cleanup() {
  await db.delete(atelierGlJournalLine).where(like(atelierGlJournalLine.id, `${P}%`));
  await db.delete(atelierGlJournalEntry).where(like(atelierGlJournalEntry.id, `${P}%`));
  await db.delete(atelierGlAccount).where(like(atelierGlAccount.id, `${P}%`));
  await db.delete(atelierInvoice).where(like(atelierInvoice.id, `${P}%`));
  await db.delete(atelierVatRegister).where(like(atelierVatRegister.id, `${P}%`));
  await db.delete(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityId, ENT), eq(atelierAuditEvents.action, "vat.vat201_exported")));
  await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.id, `${P}%`));
}

async function main() {
  await cleanup();
  await db.insert(atelierLegalEntities).values([
    { id: ENT, orgId: ORG, legalNameEn: "Probe Dubai FZ-LLC", shortName: "Probe Dubai", country: "AE", jurisdiction: "Dubai", baseCurrency: "AED" },
    { id: ENT_SA, orgId: ORG, legalNameEn: "Probe Riyadh LLC", shortName: "Probe Riyadh", country: "SA", jurisdiction: "Riyadh", baseCurrency: "SAR" },
    { id: `${P}_ent_noem`, orgId: ORG, legalNameEn: "Probe Freezone Co", shortName: "Probe Freezone", country: "AE", jurisdiction: "Freezone", baseCurrency: "AED" },
    { id: `${P}_ent_amb`, orgId: ORG, legalNameEn: "Probe Ambiguous FZ-LLC", shortName: "Probe Ambiguous", country: "AE", jurisdiction: "Dubai", baseCurrency: "AED" },
  ] as (typeof atelierLegalEntities.$inferInsert)[]);
  await db.insert(atelierGlAccount).values([
    { id: `${P}_a23`, orgId: ORG, legalEntityId: ENT, code: "2300", name: "VAT payable", type: "liability", normalSide: "credit" },
    { id: `${P}_a14`, orgId: ORG, legalEntityId: ENT, code: "1400", name: "VAT receivable", type: "asset", normalSide: "debit" },
  ] as (typeof atelierGlAccount.$inferInsert)[]);
  await db.insert(atelierInvoice).values({
    id: `${P}_inv1`, orgId: ORG, legalEntityId: ENT, jurisdiction: "AE", invoiceNumber: "INV-R-001",
    currency: "AED", status: "issued", billTo: { name: "Route Client LLC" },
    subtotal: 2100, vatAmount: 105, vatRatePct: 5, total: 2205,
    issuedAt: new Date("2026-07-10T00:00:00Z"),
  });
  await db.insert(atelierGlJournalEntry).values([
    { id: `${P}_j1`, orgId: ORG, legalEntityId: ENT, periodLabel: "2026-07", entryDate: "2026-07-10", kind: "posting",
      sourceKind: "invoice", sourceRef: `${P}_inv1`, memo: "Invoice INV-R-001", currency: "AED", totalDebit: 2205, totalCredit: 2205 },
    // Ambiguous entity: manual output VAT with no source doc → export must be blocked.
    { id: `${P}_j2`, orgId: ORG, legalEntityId: `${P}_ent_amb`, periodLabel: "2026-07", entryDate: "2026-07-11", kind: "posting",
      sourceKind: "manual", sourceRef: `${P}_man1`, memo: "Manual output VAT", currency: "AED", totalDebit: 40, totalCredit: 40 },
  ] as (typeof atelierGlJournalEntry.$inferInsert)[]);
  await db.insert(atelierGlAccount).values({
    id: `${P}_a23b`, orgId: ORG, legalEntityId: `${P}_ent_amb`, code: "2300", name: "VAT payable", type: "liability", normalSide: "credit",
  } as typeof atelierGlAccount.$inferInsert);
  await db.insert(atelierGlJournalLine).values([
    { id: `${P}_l1`, orgId: ORG, journalEntryId: `${P}_j1`, accountId: `${P}_a23`, accountCode: "2300", accountName: "VAT payable", debit: 0, credit: 105 },
    { id: `${P}_l2`, orgId: ORG, journalEntryId: `${P}_j2`, accountId: `${P}_a23b`, accountCode: "2300", accountName: "VAT payable", debit: 0, credit: 40 },
  ] as (typeof atelierGlJournalLine.$inferInsert)[]);

  const [founder] = await db.select().from(atelierUsers).where(eq(atelierUsers.role, "founding_partner")).limit(1);
  if (!founder) fail("no founding_partner user in dev DB");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as { atelierPersona?: unknown }).atelierPersona = founder; next(); });
  app.use(vatRoutes);
  const srv = app.listen(0);
  const port = (srv.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // CSV
    const csvRes = await fetch(`${base}/vat/return/vat201?entityId=${ENT}&period=${PERIOD}&format=csv`);
    const csv = await csvRes.text();
    if (csvRes.status !== 200) fail(`csv status ${csvRes.status}: ${csv.slice(0, 200)}`);
    if (!csvRes.headers.get("content-disposition")?.includes("vat201-Probe_Dubai-2026-07.csv")) fail("csv filename");
    if (!csv.includes("1b,Standard rated supplies in Dubai,2100.00,105.00")) fail(`csv box 1b missing:\n${csv.slice(0, 600)}`);
    if (!csv.includes("INV-R-001")) fail("classified invoice line missing in csv");

    // Unclassified output VAT blocks the statutory export (JSON preview still works).
    const ambRes = await fetch(`${base}/vat/return/vat201?entityId=${P}_ent_amb&period=${PERIOD}&format=csv`);
    const ambBody = (await ambRes.json()) as { error?: string };
    if (ambRes.status !== 409 || ambBody.error !== "unclassified_transactions") fail(`expected unclassified 409, got ${ambRes.status} ${JSON.stringify(ambBody)}`);
    const ambJson = await fetch(`${base}/vat/return/vat201?entityId=${P}_ent_amb&period=${PERIOD}`);
    const ambRep = (await ambJson.json()) as { data: { unclassified: unknown[]; totals: { box12VatAed: number } } };
    if (ambJson.status !== 200 || ambRep.data.unclassified.length !== 1 || ambRep.data.totals.box12VatAed !== 0)
      fail(`json preview of ambiguous entity wrong: ${ambJson.status} ${JSON.stringify(ambRep.data?.totals)}`);

    // PDF
    const pdfRes = await fetch(`${base}/vat/return/vat201?entityId=${ENT}&period=${PERIOD}&format=pdf`);
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    if (pdfRes.status !== 200 || pdfBuf.subarray(0, 5).toString() !== "%PDF-") fail(`pdf bad: ${pdfRes.status} ${pdfBuf.subarray(0, 20)}`);
    if (pdfBuf.length < 20000) fail(`pdf suspiciously small: ${pdfBuf.length}`);

    // Export audit recorded + surfaced on GET /vat/return
    const audits = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityId, ENT), eq(atelierAuditEvents.action, "vat.vat201_exported")));
    if (audits.length !== 2) fail(`expected 2 export audit rows, got ${audits.length}`);
    const retRes = await fetch(`${base}/vat/return?entityId=${ENT}&period=${PERIOD}`);
    const ret = (await retRes.json()) as { data: { vat201Available: boolean; vat201LastExportedAt: string | null; outputVat: number } };
    if (!ret.data.vat201Available || !ret.data.vat201LastExportedAt) fail(`GET /vat/return missing vat201 fields: ${JSON.stringify(ret.data)}`);
    if (ret.data.outputVat !== 105) fail("existing calculator changed");

    // Non-AE entity is rejected
    const saRes = await fetch(`${base}/vat/return/vat201?entityId=${ENT_SA}&period=${PERIOD}&format=csv`);
    if (saRes.status !== 400) fail(`expected 400 for SA entity, got ${saRes.status}`);

    // UAE entity whose emirate cannot be resolved is refused (never a silent Dubai default)
    const noemRes = await fetch(`${base}/vat/return/vat201?entityId=${P}_ent_noem&period=${PERIOD}&format=csv`);
    const noemBody = (await noemRes.json()) as { error?: string };
    if (noemRes.status !== 400 || noemBody.error !== "emirate_unresolved") fail(`expected emirate_unresolved 400, got ${noemRes.status} ${JSON.stringify(noemBody)}`);

    // JSON format works and does NOT add an audit row
    const jsonRes = await fetch(`${base}/vat/return/vat201?entityId=${ENT}&period=${PERIOD}`);
    if (jsonRes.status !== 200) fail("json format failed");
    const audits2 = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityId, ENT), eq(atelierAuditEvents.action, "vat.vat201_exported")));
    if (audits2.length !== 2) fail("json preview must not write an export audit row");

    // Mark filed carries the vat201 export stamp; rollforward unchanged.
    const fileRes = await fetch(`${base}/vat/return/file`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ entityId: ENT, period: PERIOD }),
    });
    const fileBody = (await fileRes.json()) as { data?: { settlementJournalEntryId: string } };
    if (fileRes.status !== 200) fail(`file status ${fileRes.status}: ${JSON.stringify(fileBody)}`);
    const [filedAudit] = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.action, "vat.return_filed"),
      eq(atelierAuditEvents.entityId, fileBody.data!.settlementJournalEntryId)));
    const pl = filedAudit?.payload as { vat201ExportedAt?: string | null; vat201ExportFormat?: string | null };
    if (!pl?.vat201ExportedAt || !pl.vat201ExportFormat) fail(`filed audit missing vat201 stamp: ${JSON.stringify(pl)}`);
    // cleanup the settlement + filed audit
    await db.delete(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.id, fileBody.data!.settlementJournalEntryId));
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.id, filedAudit.id));

    console.log("PASS: VAT 201 route — CSV/PDF downloads, audit trail, UAE gating, mark-filed linkage all good.");
  } finally {
    srv.close();
  }
}

main().then(() => cleanup()).then(() => process.exit(0)).catch(async (e) => {
  console.error(e);
  try { await cleanup(); } catch {}
  process.exit(1);
});
