/** Task #1077 probe — pick ranked match candidates from the recon
 * exceptions list. Verifies: exceptions expose inflow candidates
 * (invoiceNumber/appliedAmount/confidence/invoiceOutstanding),
 * confirm with candidateIndex applies the SELECTED invoice (not the
 * top one), out-of-range/conflicting indexes 400, and exceptions +
 * summary refresh after apply. Self-cleaning (__t1077 pattern). */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss";
const T = "__t1077";

async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const {
    db, atelierInvoice, atelierBankAccount, atelierBankTransaction,
    atelierBankReconPeriod, atelierCashReceipt, atelierCashApplication,
    atelierAuditEvents, atelierBankStatementImport,
  } = await import("@workspace/db");
  const { and, eq, like, inArray } = await import("drizzle-orm");
  const server = (app as any).listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${PERSONA}`, "content-type": "application/json" };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra)?.slice(0, 500));
  };
  const rid = (p: string) => `${p}_t1077_${Math.random().toString(36).slice(2, 8)}`;
  const acctId = rid("bnkacct");
  const invAId = rid("inv");
  const invBId = rid("inv");
  const txnId = rid("btxn");
  const periodId = rid("recon");
  const importId = rid("bimp");
  try {
    await db.insert(atelierBankAccount).values({
      id: acctId, orgId: "aico", bankName: `${T} Bank`,
      accountLabel: `${T} Operating`, accountNumberLast4: "1077", currency: "USD",
      openingBalance: 10000,
    } as any);
    await db.insert(atelierInvoice).values([
      { id: invAId, jurisdiction: "UAE", status: "issued", invoiceNumber: `${T}-INV-A`,
        currency: "USD", subtotal: 3000, vatAmount: 0, total: 3000, amountPaid: 0,
        billTo: { name: `${T} Acme Corp` }, dueDate: "2026-07-01", issuedAt: new Date("2026-06-20T00:00:00Z") },
      { id: invBId, jurisdiction: "UAE", status: "issued", invoiceNumber: `${T}-INV-B`,
        currency: "USD", subtotal: 3000, vatAmount: 0, total: 3000, amountPaid: 0,
        billTo: { name: `${T} Acme Corp` }, dueDate: "2026-07-05", issuedAt: new Date("2026-06-21T00:00:00Z") },
    ] as any);
    await db.insert(atelierBankStatementImport).values({
      id: importId, orgId: "aico", bankAccountId: acctId, statementDate: "2026-07-31",
      fileHash: rid("hash"), rowsCount: 1,
    } as any);
    // Inflow txn with a stored 2-candidate proposal (A ranked above B).
    await db.insert(atelierBankTransaction).values({
      id: txnId, orgId: "aico", bankAccountId: acctId, statementImportId: importId, postedDate: "2026-07-10",
      amount: 3000, currency: "USD", counterpartyNameRaw: `${T} Acme Corp`,
      referenceRaw: "wire", matchedState: "proposed",
      matchProposal: {
        recommended: "manual_review",
        candidates: [
          { invoiceId: invAId, invoiceNumber: `${T}-INV-A`, appliedAmount: 3000, confidence: 0.6, rationale: "name match", invoiceOutstanding: 3000 },
          { invoiceId: invBId, invoiceNumber: `${T}-INV-B`, appliedAmount: 3000, confidence: 0.55, rationale: "name match", invoiceOutstanding: 3000 },
        ],
        proposedAt: new Date().toISOString(),
      },
    } as any);
    await db.insert(atelierBankReconPeriod).values({
      id: periodId, orgId: "aico", bankAccountId: acctId, periodLabel: `${T}-2026-07`,
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
      openingBalance: 10000, closingBalance: 13000, status: "open",
      createdByUserId: PERSONA,
    } as any);

    // 1) exceptions expose ranked candidates
    const ex1 = await fetch(`${base}/wallet/bank/recon/${periodId}/exceptions`, { headers: hdrs });
    const ej1 = await ex1.json();
    const row = (ej1.data?.exceptions ?? []).find((e: any) => e.txnId === txnId);
    check("exception row present", ex1.status === 200 && !!row, ej1);
    const cands = row?.candidates ?? [];
    check("two candidates exposed", cands.length === 2, cands);
    check("candidate fields present", cands[0]?.index === 0 && cands[0]?.invoiceNumber === `${T}-INV-A`
      && cands[0]?.appliedAmount === 3000 && cands[0]?.confidence === 0.6 && cands[0]?.invoiceOutstanding === 3000, cands[0]);

    // 2) out-of-range + conflicting index rejected
    const bad = await fetch(`${base}/wallet/cash/triage/${txnId}/confirm`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ candidateIndex: 5 }) });
    check("out-of-range candidateIndex 400", bad.status === 400, bad.status);
    const conflict = await fetch(`${base}/wallet/cash/triage/${txnId}/confirm`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ candidateIndex: 1, invoiceId: invAId }) });
    check("conflicting invoiceId+index 400", conflict.status === 400, conflict.status);

    // 3) pick candidate #1 (NOT the top one) → invoice B paid
    const cf = await fetch(`${base}/wallet/cash/triage/${txnId}/confirm`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ candidateIndex: 1 }) });
    const cfj = await cf.json();
    check("confirm via candidateIndex ok", cf.status === 200 && cfj.data?.applied === 3000, cfj);
    const [invB] = await db.select().from(atelierInvoice).where(eq(atelierInvoice.id, invBId));
    const [invA] = await db.select().from(atelierInvoice).where(eq(atelierInvoice.id, invAId));
    check("selected invoice B paid", invB?.status === "paid" && invB?.amountPaid === 3000, invB);
    check("top invoice A untouched", invA?.amountPaid === 0, invA);

    // 4) exceptions + summary refresh: row resolved
    const ex2 = await fetch(`${base}/wallet/bank/recon/${periodId}/exceptions`, { headers: hdrs });
    const ej2 = await ex2.json();
    check("exception cleared after apply",
      !(ej2.data?.exceptions ?? []).some((e: any) => e.txnId === txnId)
      && ej2.data?.summary?.matchedCount === 1, ej2.data?.summary);

    // 5) already-resolved re-pick 409
    const again = await fetch(`${base}/wallet/cash/triage/${txnId}/confirm`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ candidateIndex: 0 }) });
    check("re-confirm 409", again.status === 409, again.status);
  } finally {
    // cleanup
    const apps = await db.select({ id: atelierCashApplication.id }).from(atelierCashApplication)
      .where(inArray(atelierCashApplication.invoiceId, [invAId, invBId]));
    if (apps.length) await db.delete(atelierCashApplication).where(inArray(atelierCashApplication.id, apps.map(a => a.id)));
    await db.delete(atelierCashReceipt).where(eq(atelierCashReceipt.bankTransactionId, txnId));
    await db.delete(atelierBankReconPeriod).where(eq(atelierBankReconPeriod.id, periodId));
    await db.delete(atelierBankTransaction).where(eq(atelierBankTransaction.id, txnId));
    await db.delete(atelierBankStatementImport).where(eq(atelierBankStatementImport.id, importId));
    await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, [invAId, invBId]));
    await db.delete(atelierBankAccount).where(eq(atelierBankAccount.id, acctId));
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.payloadSummary, `%${T}%`));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
