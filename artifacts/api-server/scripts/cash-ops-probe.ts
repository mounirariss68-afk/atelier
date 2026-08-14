/** Task #431 probe — live cash ops: auto-match on statement import,
 * triage queue, inflow confirm (AR + GL via Bookkeeper), outflow
 * confirm, park + manual journal, scheduled forecast snapshot write,
 * working-capital dashboard. Self-cleaning (__t431 pattern sweep). */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss";
const T = "__t431";

async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const {
    db, atelierLegalEntities, atelierInvoice, atelierBankAccount,
    atelierBankTransaction, atelierBankStatementImport, atelierCashReceipt,
    atelierCashApplication, atelierContractorPayments, atelierGlAccount,
    atelierGlJournalEntry, atelierGlJournalLine, atelierCashForecastSnapshot,
    atelierPaneAItems, atelierAgentRuns,
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
  const rid = (p: string) => `${p}_t431_${Math.random().toString(36).slice(2, 8)}`;
  let entId = "";
  let entBId = "";
  const acctId = rid("bnkacct");
  const invId = rid("inv");
  const invBId = rid("inv");
  const cpId = rid("cp");
  const cpBId = rid("cp");
  const snapshotIds: string[] = [];
  try {
    // 0) unauthenticated is rejected
    const anon = await fetch(`${base}/wallet/cash/triage`);
    check("triage 401 unauthenticated", anon.status === 401, anon.status);

    // 1) entity + chart + bank account + open invoice + approved contractor payment
    const er = await fetch(`${base}/finance/entities`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ legalNameEn: `${T} Cash Entity`, shortName: "T431", country: "AE", baseCurrency: "USD" }),
    });
    const ej = await er.json();
    check("create entity", er.status === 201 && !!ej.entity?.id, ej);
    entId = ej.entity.id;
    const sd = await fetch(`${base}/gl/accounts?entityId=${entId}`, { headers: hdrs });
    check("chart auto-seeded on read", sd.status === 200, await sd.text().catch(() => ""));
    const glAccts = await db.select().from(atelierGlAccount)
      .where(and(eq(atelierGlAccount.legalEntityId, entId), eq(atelierGlAccount.type, "expense")));
    check("expense accounts exist", glAccts.length > 0, glAccts.length);
    const expCode = glAccts[0].code;

    await db.insert(atelierBankAccount).values({
      id: acctId, orgId: "aico", legalEntityId: entId, bankName: `${T} Bank`,
      accountLabel: `${T} Operating`, accountNumberLast4: "4311", currency: "USD",
      openingBalance: 10000,
    } as any);
    await db.insert(atelierInvoice).values({
      id: invId, jurisdiction: "UAE", legalEntityId: entId, status: "issued",
      invoiceNumber: `${T}-INV-1`, currency: "USD", subtotal: 5000, vatAmount: 0, total: 5000,
      amountPaid: 0, billTo: { name: `${T} Acme Corp` }, dueDate: "2026-07-01",
      issuedAt: new Date("2026-06-20T00:00:00Z"),
    } as any);
    await db.insert(atelierContractorPayments).values({
      id: cpId, orgId: "aico", payeeUserId: PERSONA, payeeName: `${T} Jane Contractor`,
      engagementId: rid("eng"), legalEntityId: entId, weekIso: "2026-W28",
      hours: 12, ratePerHour: 100, costAmount: 1200, usdAmount: 1200, status: "partner_approved",
    } as any);

    // Second entity with decoy rows (same names/amounts) to prove entity scoping.
    const eb = await fetch(`${base}/finance/entities`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ legalNameEn: `${T} Other Entity`, shortName: "T431B", country: "AE", baseCurrency: "USD" }),
    }).then(r => r.json());
    entBId = eb.entity.id;
    await db.insert(atelierInvoice).values({
      id: invBId, jurisdiction: "UAE", legalEntityId: entBId, status: "issued",
      invoiceNumber: `${T}-INV-B`, currency: "USD", subtotal: 5000, vatAmount: 0, total: 5000,
      amountPaid: 0, billTo: { name: `${T} Acme Corp` }, dueDate: "2026-07-01",
      issuedAt: new Date("2026-06-20T00:00:00Z"),
    } as any);
    await db.insert(atelierContractorPayments).values({
      id: cpBId, orgId: "aico", payeeUserId: PERSONA, payeeName: `${T} Jane Contractor`,
      engagementId: rid("eng"), legalEntityId: entBId, weekIso: "2026-W28",
      hours: 12, ratePerHour: 100, costAmount: 1200, usdAmount: 1200, status: "partner_approved",
    } as any);

    // 2) import statement → auto-match runs
    const csv = [
      "date,amount,counterparty,reference,kind",
      `2026-07-13,5000,${T} Acme Corp,${T}-INV-1,receipt`,
      `2026-07-14,-1200,${T} Jane Contractor,payout,payment`,
      `2026-07-15,-75,${T} Random Vendor,sub,payment`,
    ].join("\n");
    const ir = await fetch(`${base}/wallet/bank/import`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ bankAccountId: acctId, source: "csv", raw: csv, statementDate: "2026-07-15" }),
    });
    const ij = await ir.json();
    check("import ok", ir.status === 200 && ij.data?.rowsImported === 3, ij);
    const m = ij.data?.matcher;
    check("matcher auto-ran", m?.status === "ok", m);
    check("matcher: receipt created + inflow proposal", m?.summary?.receiptsCreated === 1 && m?.summary?.inflowProposals === 1, m?.summary);
    check("matcher: outflow proposal for contractor", (m?.summary?.outflowProposals ?? 0) >= 1, m?.summary);
    const importId = ij.data.importId as string;

    // 3) triage queue shows proposals
    const tq = await fetch(`${base}/wallet/cash/triage`, { headers: hdrs }).then(r => r.json());
    const mine = (tq.data.rows as any[]).filter(r => r.statementImportId === importId);
    check("triage lists 3 rows", mine.length === 3, mine.length);
    const inflow = mine.find(r => r.amount > 0);
    const cpTxn = mine.find(r => r.amount === -1200);
    const miscTxn = mine.find(r => r.amount === -75);
    check("inflow proposal recommends invoice", inflow?.matchProposal?.candidates?.[0]?.invoiceId === invId, inflow?.matchProposal);
    check("outflow proposal has contractor candidate", cpTxn?.matchProposal?.candidates?.[0]?.refId === cpId, cpTxn?.matchProposal);
    check("txn tagged with entity", inflow?.legalEntityId === entId, inflow?.legalEntityId);
    // Entity scoping: decoy rows from entity B never appear as candidates.
    const inflowCandIds = (inflow?.matchProposal?.candidates ?? []).map((c: any) => c.invoiceId);
    check("inflow candidates exclude other-entity invoice", !inflowCandIds.includes(invBId), inflowCandIds);
    const cpCandIds = (cpTxn?.matchProposal?.candidates ?? []).map((c: any) => c.refId);
    check("outflow candidates exclude other-entity payment", !cpCandIds.includes(cpBId), cpCandIds);
    // Cross-entity confirms are rejected outright.
    const xin = await fetch(`${base}/wallet/cash/triage/${inflow.id}/confirm`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ invoiceId: invBId }),
    });
    check("cross-entity inflow confirm 400", xin.status === 400 && (await xin.json()).error === "entity_mismatch", xin.status);
    const xout = await fetch(`${base}/wallet/cash/triage/${cpTxn.id}/outflow-confirm`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ refKind: "contractor_payment", refId: cpBId }),
    });
    check("cross-entity outflow confirm 400", xout.status === 400 && (await xout.json()).error === "entity_mismatch", xout.status);
    const [cpBUntouched] = await db.select().from(atelierContractorPayments).where(eq(atelierContractorPayments.id, cpBId));
    check("other-entity payment untouched", cpBUntouched.status === "partner_approved", cpBUntouched?.status);

    // 4) confirm inflow → AR updated + GL posting
    const cf = await fetch(`${base}/wallet/cash/triage/${inflow.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" });
    const cfj = await cf.json();
    check("confirm inflow ok", cf.status === 200 && cfj.data?.applied === 5000, cfj);
    check("confirm glPosting posted", cfj.data?.glPosting?.status === "posted", cfj.data?.glPosting);
    const [invAfter] = await db.select().from(atelierInvoice).where(eq(atelierInvoice.id, invId));
    check("invoice paid", invAfter.amountPaid === 5000 && invAfter.status === "paid", invAfter?.status);
    const [inTxnAfter] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, inflow.id));
    check("txn matched to application", inTxnAfter.matchedState === "matched" && inTxnAfter.matchedRefKind === "invoice_application", inTxnAfter);
    const cf2 = await fetch(`${base}/wallet/cash/triage/${inflow.id}/confirm`, { method: "POST", headers: hdrs, body: "{}" });
    check("confirm idempotent-409", cf2.status === 409, cf2.status);

    // 5) confirm outflow → source paid + matched
    const oc = await fetch(`${base}/wallet/cash/triage/${cpTxn.id}/outflow-confirm`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ refKind: "contractor_payment", refId: cpId }),
    });
    const ocj = await oc.json();
    check("outflow confirm ok", oc.status === 200, ocj);
    const [cpAfter] = await db.select().from(atelierContractorPayments).where(eq(atelierContractorPayments.id, cpId));
    check("contractor payment marked paid", cpAfter.status === "paid", cpAfter?.status);
    const [cpTxnAfter] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, cpTxn.id));
    check("outflow txn matched", cpTxnAfter.matchedState === "matched" && cpTxnAfter.matchedRefId === cpId, cpTxnAfter);

    // 6) park then journal the misc outflow
    const pk = await fetch(`${base}/wallet/cash/triage/${miscTxn.id}/park`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ reason: "Awaiting vendor detail" }),
    });
    check("park ok", pk.status === 200, pk.status);
    const [parked] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, miscTxn.id));
    check("parked state + reason", parked.matchedState === "parked" && parked.parkedReason === "Awaiting vendor detail", parked);
    const jr = await fetch(`${base}/wallet/cash/triage/${miscTxn.id}/journal`, {
      method: "POST", headers: hdrs, body: JSON.stringify({ expenseAccountCode: expCode }),
    });
    const jrj = await jr.json();
    check("journal ok", jr.status === 201 && !!jrj.data?.journalEntryId, jrj);
    const [jrn] = await db.select().from(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.id, jrj.data.journalEntryId));
    check("journal balanced 75/75 sourceRef=txn", jrn.totalDebit === 75 && jrn.totalCredit === 75 && jrn.sourceRef === miscTxn.id, jrn);
    const [miscAfter] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, miscTxn.id));
    check("misc txn journaled + linked", miscAfter.matchedState === "journaled" && miscAfter.glJournalEntryId === jrj.data.journalEntryId, miscAfter);

    // 7) forecast run writes 13 persisted rows
    const fr = await fetch(`${base}/wallet/cash/forecast/run`, { method: "POST", headers: hdrs, body: "{}" });
    const frj = await fr.json();
    check("forecast run ok 13 weeks", fr.status === 200 && frj.data?.weeks?.length === 13, frj?.data?.weeks?.length);
    if (frj.data?.snapshotId) snapshotIds.push(frj.data.snapshotId);
    const fl = await fetch(`${base}/wallet/cash/forecast/latest`, { headers: hdrs }).then(r => r.json());
    check("forecast latest returns snapshot", fl.data?.snapshotId === frj.data?.snapshotId && fl.data?.weeks?.length === 13, { got: fl.data?.snapshotId, want: frj.data?.snapshotId });

    // 8) working capital
    const wc = await fetch(`${base}/wallet/cash/working-capital`, { headers: hdrs }).then(r => r.json());
    const myAcct = wc.data?.cash?.byAccount?.find((a: any) => a.id === acctId);
    check("working capital: account balance = 10000+3725", myAcct?.balance === 13725, myAcct);
    check("working capital shape", typeof wc.data?.ar?.open === "number" && typeof wc.data?.netWorkingCapital === "number" && wc.data?.triageCounts, wc.data);
  } finally {
    // cleanup — tracked ids then __t431 pattern sweep
    try {
      const txns = await db.select({ id: atelierBankTransaction.id }).from(atelierBankTransaction)
        .where(eq(atelierBankTransaction.bankAccountId, acctId));
      const txnIds = txns.map(t => t.id);
      if (txnIds.length > 0) {
        const rcpts = await db.select({ id: atelierCashReceipt.id }).from(atelierCashReceipt)
          .where(inArray(atelierCashReceipt.bankTransactionId, txnIds));
        const rcptIds = rcpts.map(r => r.id);
        if (rcptIds.length > 0) {
          await db.delete(atelierCashApplication).where(inArray(atelierCashApplication.cashReceiptId, rcptIds));
          await db.delete(atelierCashReceipt).where(inArray(atelierCashReceipt.id, rcptIds));
        }
        await db.delete(atelierBankTransaction).where(inArray(atelierBankTransaction.id, txnIds));
      }
      await db.delete(atelierBankStatementImport).where(eq(atelierBankStatementImport.bankAccountId, acctId));
      await db.delete(atelierBankAccount).where(eq(atelierBankAccount.id, acctId));
      await db.delete(atelierContractorPayments).where(inArray(atelierContractorPayments.id, [cpId, cpBId]));
      await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, [invId, invBId]));
      if (entBId) await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, entBId));
      if (entId) {
        const jes = await db.select({ id: atelierGlJournalEntry.id }).from(atelierGlJournalEntry)
          .where(eq(atelierGlJournalEntry.legalEntityId, entId));
        const jeIds = jes.map(j => j.id);
        if (jeIds.length > 0) {
          await db.delete(atelierGlJournalLine).where(inArray(atelierGlJournalLine.journalEntryId, jeIds));
          await db.delete(atelierGlJournalEntry).where(inArray(atelierGlJournalEntry.id, jeIds));
        }
        await db.delete(atelierGlAccount).where(eq(atelierGlAccount.legalEntityId, entId));
        await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, entId));
      }
      if (snapshotIds.length > 0) {
        await db.delete(atelierCashForecastSnapshot).where(inArray(atelierCashForecastSnapshot.snapshotId, snapshotIds));
        await db.delete(atelierPaneAItems).where(like(atelierPaneAItems.id, "panea_cashgap_%"));
      }
      await db.delete(atelierAgentRuns).where(like(atelierAgentRuns.targetLabel, `%${T}%`));
      // pattern sweep
      await db.delete(atelierInvoice).where(like(atelierInvoice.invoiceNumber, `${T}%`));
      await db.delete(atelierContractorPayments).where(like(atelierContractorPayments.payeeName, `${T}%`));
      await db.delete(atelierBankAccount).where(like(atelierBankAccount.bankName, `${T}%`));
      await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.legalNameEn, `${T}%`));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
