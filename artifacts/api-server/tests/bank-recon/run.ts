/**
 * Task #1071 — Bank statement upload, auto-reconciliation & exception probes.
 *
 * Runs standalone (tsx ./tests/bank-recon/run.ts) booting the app in-process
 * via app.listen(0); NODE_ENV=test enables the persona-cookie bypass so
 * requests act as ephemeral p_test_* personas. All rows created here are
 * removed in `finally`.
 *
 * Coverage:
 *   1. Role gate: consultant 403 on statement upload; finance 200.
 *   2. Multipart CSV upload → parsed rows + auto-match proposals.
 *   3. Idempotent re-upload of the same file → 409, txn count unchanged.
 *   4. One-click apply of a confident proposal → invoice payment recorded,
 *      txn matched.
 *   5. Exceptions derived for unmatched rows, amount mismatches and
 *      in-file duplicates, with reasons.
 *   6. Classify (fee/transfer/other) resolves an exception.
 *   7. Finalise gating: 409 exceptions_present without acknowledgement,
 *      success with exceptionsAcknowledged=true.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FIN_ID = `p_test_br_fin_${STAMP}`;
const FP_ID = `p_test_br_fp_${STAMP}`;
const CONS_ID = `p_test_br_cons_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers,
    atelierBankAccount,
    atelierBankStatementImport,
    atelierBankTransaction,
    atelierBankReconPeriod,
    atelierCashReceipt,
    atelierCashApplication,
    atelierInvoice,
    atelierInvoiceLine,
    atelierAuditEvents,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string, path: string, personaId: string, body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${personaId}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function uploadStatement(
    personaId: string, fields: Record<string, string>, csv: string, fileName = "statement.csv",
  ): Promise<{ status: number; body: any }> {
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), fileName);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${API}/wallet/bank/import-file`, {
      method: "POST", headers: { cookie: `atelier_persona=${personaId}` }, body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  const bankId = `bank_test_br_${STAMP}`;
  const invId = `inv_test_br_${STAMP}`;
  const importIds: string[] = [];

  try {
    // -------------------------------------------------------------- setup
    for (const p of [
      { id: FIN_ID, role: "finance", name: "BR Finance" },
      { id: FP_ID, role: "founding_partner", name: "BR FP" },
      { id: CONS_ID, role: "consultant", name: "BR Consultant" },
    ]) {
      await db.insert(atelierUsers).values({
        id: p.id, orgId: ORG, email: `${p.id}@example.com`, name: p.name,
        initials: "BR", role: p.role, roleLabel: p.name, title: p.name,
        permissions: [], bdActive: false,
      }).onConflictDoNothing();
    }
    await db.insert(atelierBankAccount).values({
      id: bankId, orgId: ORG, bankName: "Test Bank", accountLabel: `Ops ${STAMP}`,
      accountNumberLast4: "9911", currency: "USD", openingBalance: 0, createdByUserId: FP_ID,
    });
    // Issued invoice the auto-matcher should hit exactly (name + amount).
    await db.insert(atelierInvoice).values({
      id: invId, orgId: ORG, jurisdiction: "GLOBAL", currency: "USD", status: "issued",
      invoiceNumber: `BR-${STAMP}`, billTo: { name: "Acme Widgets LLC" },
      subtotal: 5000, vatAmount: 0, total: 5000, amountPaid: 0, vatRatePct: 0,
      createdByUserId: FP_ID,
    });
    await db.insert(atelierInvoiceLine).values({
      id: `invl_test_br_${STAMP}`, orgId: ORG, invoiceId: invId, ord: 0,
      description: "Services", qty: 1, unitPrice: 5000, amount: 5000, sourceKind: "fee",
    });

    const CSV = [
      "date,amount,counterparty,reference,kind",
      `2026-07-03,5000.00,Acme Widgets LLC,BR-${STAMP},receipt`,      // exact invoice match
      "2026-07-08,1234.56,Mystery Sender Ltd,wire-777,receipt",       // no invoice → no_match
      "2026-07-12,-42.50,BANK SVC CHARGE,fee-jul,payment",            // outflow, no source → no_match
      "2026-07-12,-42.50,BANK SVC CHARGE,fee-jul-2,payment",          // in-file duplicate (same date/amount/counterparty)
    ].join("\n");

    // -------------------------------------------------------------- 1. gates
    group("1. Role gates on statement upload");
    const denied = await uploadStatement(CONS_ID, { bankAccountId: bankId, statementDate: "2026-07-31" }, CSV);
    check("consultant is denied statement upload (403)", denied.status === 403, `got ${denied.status}`);
    const badReq = await uploadStatement(FIN_ID, { bankAccountId: bankId }, CSV);
    check("missing statementDate rejected (400)", badReq.status === 400, `got ${badReq.status}`);

    // -------------------------------------------------------------- 2. upload
    group("2. Multipart CSV upload parses + auto-matches");
    const up = await uploadStatement(FIN_ID, { bankAccountId: bankId, statementDate: "2026-07-31" }, CSV);
    check("upload succeeds (200)", up.status === 200, JSON.stringify(up.body));
    check("4 rows imported", up.body?.data?.rowsImported === 4, JSON.stringify(up.body?.data));
    check("auto-matcher ran ok", up.body?.data?.matcher?.status === "ok", JSON.stringify(up.body?.data?.matcher));
    if (up.body?.data?.importId) importIds.push(up.body.data.importId);

    const [impRow] = await db.select().from(atelierBankStatementImport)
      .where(eq(atelierBankStatementImport.id, up.body?.data?.importId ?? "none"));
    check("successful import stored the original file (fileUrl set)",
      typeof impRow?.fileUrl === "string" && impRow.fileUrl.includes("bank-statements/"),
      String(impRow?.fileUrl));

    // Storage failure must abort the import entirely (retryable 503).
    process.env.TEST_FORCE_STATEMENT_STORAGE_FAIL = "1";
    const upFail = await uploadStatement(FIN_ID, { bankAccountId: bankId, statementDate: "2026-07-31" },
      "date,amount,counterparty,reference,kind\n2026-07-04,10.00,Storage Fail Probe,sf-1,receipt", "fail.csv");
    delete process.env.TEST_FORCE_STATEMENT_STORAGE_FAIL;
    check("storage failure → 503, not success", upFail.status === 503 && upFail.body?.error === "storage_unavailable",
      `${upFail.status} ${JSON.stringify(upFail.body)}`);
    const orphan = await db.select().from(atelierBankTransaction)
      .where(eq(atelierBankTransaction.bankAccountId, bankId));
    check("no rows imported on storage failure", orphan.length === 4, `got ${orphan.length}`);

    // Legacy JSON route enforces the same durability precondition.
    process.env.TEST_FORCE_STATEMENT_STORAGE_FAIL = "1";
    const jsonFail = await call("POST", "/wallet/bank/import", FIN_ID, {
      bankAccountId: bankId, statementDate: "2026-07-31",
      raw: "date,amount,counterparty,reference,kind\n2026-07-05,11.00,Json Probe,jp-1,receipt",
    });
    delete process.env.TEST_FORCE_STATEMENT_STORAGE_FAIL;
    check("JSON import also 503s on storage failure", jsonFail.status === 503, `got ${jsonFail.status}`);

    // Concurrent identical uploads: exactly one wins, the other gets 409.
    const RACE_CSV = "date,amount,counterparty,reference,kind\n2026-08-06,77.00,Race Probe,rp-1,receipt";
    const [raceA, raceB] = await Promise.all([
      uploadStatement(FIN_ID, { bankAccountId: bankId, statementDate: "2026-07-31" }, RACE_CSV, "race.csv"),
      uploadStatement(FIN_ID, { bankAccountId: bankId, statementDate: "2026-07-31" }, RACE_CSV, "race.csv"),
    ]);
    const statuses = [raceA.status, raceB.status].sort();
    check("concurrent duplicate uploads → one 200, one 409", statuses[0] === 200 && statuses[1] === 409,
      JSON.stringify(statuses));
    for (const r of [raceA, raceB]) if (r.status === 200 && r.body?.data?.importId) importIds.push(r.body.data.importId);
    const raceRows = await db.select().from(atelierBankTransaction)
      .where(eq(atelierBankTransaction.bankAccountId, bankId));
    check("race imported exactly one txn set", raceRows.length === 5, `got ${raceRows.length}`);
    // Winner's stored object must survive the loser's cleanup.
    const winner = raceA.status === 200 ? raceA : raceB;
    const [winnerImp] = await db.select().from(atelierBankStatementImport)
      .where(eq(atelierBankStatementImport.id, winner.body?.data?.importId ?? "none"));
    check("winner import has a fileUrl", typeof winnerImp?.fileUrl === "string" && winnerImp.fileUrl.length > 0,
      String(winnerImp?.fileUrl));
    {
      const { objectStorageClient } = await import("../../src/lib/objectStorage.js");
      const slash = (winnerImp.fileUrl as string).replace(/^\//, "");
      const [exists] = await objectStorageClient.bucket(slash.split("/")[0])
        .file(slash.split("/").slice(1).join("/")).exists();
      check("winner's stored object still exists after loser cleanup", exists === true, String(exists));
    }

    const txns = await db.select().from(atelierBankTransaction)
      .where(eq(atelierBankTransaction.statementImportId, up.body?.data?.importId ?? "none"));
    check("4 bank txns created", txns.length === 4, `got ${txns.length}`);
    const acmeTxn = txns.find((t: any) => t.counterpartyNameRaw?.includes("Acme"));
    check("Acme inflow has a proposal", acmeTxn?.matchedState === "proposed", acmeTxn?.matchedState);
    const proposal = acmeTxn?.matchProposal as any;
    check("proposal recommends the invoice", proposal?.candidates?.[0]?.invoiceId === invId,
      JSON.stringify(proposal?.candidates?.slice(0, 1)));

    // -------------------------------------------------------------- 3. idempotent re-upload
    group("3. Re-upload of the same file is rejected");
    const dup = await uploadStatement(FIN_ID, { bankAccountId: bankId, statementDate: "2026-07-31" }, CSV);
    check("duplicate upload → 409", dup.status === 409, `got ${dup.status}`);
    const txnsAfter = await db.select().from(atelierBankTransaction)
      .where(eq(atelierBankTransaction.bankAccountId, bankId));
    check("txn count unchanged after re-upload", txnsAfter.length === 5, `got ${txnsAfter.length} (4 statement rows + 1 race probe)`);

    // -------------------------------------------------------------- 4. recon period + exceptions
    group("4. Recon period shows totals + exceptions");
    const recon = await call("POST", "/wallet/bank/recon", FIN_ID, {
      bankAccountId: bankId, periodLabel: `2026-07-BR-${STAMP}`,
      periodStart: "2026-07-01", periodEnd: "2026-07-31",
    });
    check("recon period opened", recon.status === 200 && recon.body?.data?.id, JSON.stringify(recon.body));
    const reconId = recon.body?.data?.id as string;

    const exResp = await call("GET", `/wallet/bank/recon/${reconId}/exceptions`, FIN_ID);
    check("exceptions endpoint responds", exResp.status === 200, `got ${exResp.status}`);
    const exceptions: any[] = exResp.body?.data?.exceptions ?? [];
    check("all 4 unresolved rows are exceptions", exceptions.length === 4, `got ${exceptions.length}`);
    const mystery = exceptions.find((e) => e.counterpartyNameRaw?.includes("Mystery"));
    check("unmatched inflow flagged no_match", mystery?.reasons?.includes("no_match"), JSON.stringify(mystery?.reasons));
    const dupEx = exceptions.filter((e) => e.reasons?.includes("duplicate"));
    check("in-file duplicate row flagged", dupEx.length === 1, `got ${dupEx.length}`);
    const acmeEx = exceptions.find((e) => e.txnId === acmeTxn?.id);
    check("proposed match flagged as needs-review", acmeEx?.reasons?.includes("unreviewed_proposal"), JSON.stringify(acmeEx?.reasons));

    const list = await call("GET", "/wallet/bank/recon", FIN_ID);
    const row = (list.body?.data?.rows ?? []).find((r: any) => r.id === reconId);
    check("recon list carries reconSummary", !!row?.reconSummary, JSON.stringify(row?.reconSummary));
    check("summary counts 4 unmatched / 0 matched",
      row?.reconSummary?.unmatchedCount === 4 && row?.reconSummary?.matchedCount === 0,
      JSON.stringify(row?.reconSummary));

    // Amount-mismatch reason: shrink the invoice outstanding then rematch view.
    // (Simplest deterministic route: a second import row close-but-not-equal.)
    const CSV2 = [
      "date,amount,counterparty,reference,kind",
      `2026-07-20,4900.00,Acme Widgets LLC,BR-${STAMP},receipt`, // invoice is 5000 → mismatch
    ].join("\n");
    const up2 = await uploadStatement(FIN_ID, { bankAccountId: bankId, statementDate: "2026-07-31" }, CSV2, "statement2.csv");
    check("second statement imports", up2.status === 200, JSON.stringify(up2.body));
    if (up2.body?.data?.importId) importIds.push(up2.body.data.importId);
    const exResp2 = await call("GET", `/wallet/bank/recon/${reconId}/exceptions`, FIN_ID);
    const mismatch = (exResp2.body?.data?.exceptions ?? []).find((e: any) => e.reasons?.includes("amount_mismatch"));
    check("amount mismatch flagged", !!mismatch, JSON.stringify((exResp2.body?.data?.exceptions ?? []).map((e: any) => e.reasons)));

    // -------------------------------------------------------------- 5. one-click apply
    group("5. One-click apply records the invoice payment");
    const confirm = await call("POST", `/wallet/cash/triage/${acmeTxn.id}/confirm`, FIN_ID, {});
    check("confirm succeeds", confirm.status === 200, JSON.stringify(confirm.body));
    check("applied 5000", confirm.body?.data?.applied === 5000, JSON.stringify(confirm.body?.data));
    const [invAfter] = await db.select().from(atelierInvoice).where(eq(atelierInvoice.id, invId));
    check("invoice fully paid", invAfter?.amountPaid === 5000 && invAfter?.status === "paid",
      `${invAfter?.amountPaid} / ${invAfter?.status}`);
    const [acmeAfter] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, acmeTxn.id));
    check("txn matched", acmeAfter?.matchedState === "matched", acmeAfter?.matchedState);

    // -------------------------------------------------------------- 6. classify
    group("6. Classify resolves fee/duplicate exceptions");
    const feeTxns = txnsAfter.filter((t: any) => t.amount < 0);
    const cls = await call("POST", `/wallet/cash/triage/${feeTxns[0].id}/classify`, FIN_ID, { classification: "bank_fee" });
    check("classify bank_fee succeeds", cls.status === 200, JSON.stringify(cls.body));
    const clsBad = await call("POST", `/wallet/cash/triage/${feeTxns[0].id}/classify`, FIN_ID, { classification: "bank_fee" });
    check("re-classify resolved txn → 409", clsBad.status === 409, `got ${clsBad.status}`);
    const clsDenied = await call("POST", `/wallet/cash/triage/${feeTxns[1].id}/classify`, CONS_ID, { classification: "other" });
    check("consultant cannot classify (403)", clsDenied.status === 403, `got ${clsDenied.status}`);
    const [feeAfter] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, feeTxns[0].id));
    check("classified txn resolved as fee", feeAfter?.matchedState === "matched" && feeAfter?.kind === "fee",
      `${feeAfter?.matchedState}/${feeAfter?.kind}`);

    // -------------------------------------------------------------- 7. finalise gating
    group("7. Finalise gated on outstanding exceptions");
    const fin1 = await call("POST", `/wallet/bank/recon/${reconId}/finalise`, FP_ID, {
      rationale: "probe", varianceAccepted: true,
    });
    check("finalise blocked while exceptions open (409)", fin1.status === 409 && fin1.body?.error === "exceptions_present",
      JSON.stringify(fin1.body));
    check("blocked response reports count", typeof fin1.body?.count === "number" && fin1.body.count > 0, JSON.stringify(fin1.body));
    const fin2 = await call("POST", `/wallet/bank/recon/${reconId}/finalise`, FP_ID, {
      rationale: "probe ack", varianceAccepted: true, exceptionsAcknowledged: true,
    });
    check("finalise with acknowledgement succeeds", fin2.status === 200, JSON.stringify(fin2.body));
    const finGate = await call("POST", `/wallet/bank/recon/${reconId}/finalise`, FIN_ID, {
      rationale: "probe", varianceAccepted: true, exceptionsAcknowledged: true,
    });
    check("finance (non-partner) cannot finalise", finGate.status === 403 || finGate.status === 409, `got ${finGate.status}`);
  } finally {
    // -------------------------------------------------------------- cleanup
    try {
      const txnIds = (await db.select({ id: atelierBankTransaction.id }).from(atelierBankTransaction)
        .where(eq(atelierBankTransaction.bankAccountId, bankId))).map((r: any) => r.id);
      if (txnIds.length > 0) {
        const rcpts = (await db.select({ id: atelierCashReceipt.id }).from(atelierCashReceipt)
          .where(inArray(atelierCashReceipt.bankTransactionId, txnIds))).map((r: any) => r.id);
        if (rcpts.length > 0) {
          await db.delete(atelierCashApplication).where(inArray(atelierCashApplication.cashReceiptId, rcpts));
          await db.delete(atelierCashReceipt).where(inArray(atelierCashReceipt.id, rcpts));
        }
        await db.delete(atelierBankTransaction).where(inArray(atelierBankTransaction.id, txnIds));
      }
      if (importIds.length > 0) {
        await db.delete(atelierBankStatementImport).where(inArray(atelierBankStatementImport.id, importIds));
      }
      await db.delete(atelierBankReconPeriod).where(eq(atelierBankReconPeriod.bankAccountId, bankId));
      await db.delete(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, invId));
      await db.delete(atelierInvoice).where(eq(atelierInvoice.id, invId));
      await db.delete(atelierBankAccount).where(eq(atelierBankAccount.id, bankId));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `p_test_br_%_${STAMP}`));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FIN_ID, FP_ID, CONS_ID]));
    } catch (err) {
      console.error("cleanup error:", err);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n\u2713 All bank-recon probes passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
