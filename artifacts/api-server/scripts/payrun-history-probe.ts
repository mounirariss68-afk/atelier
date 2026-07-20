/** Task #459 probe — payment-run detail audit trail + history data (self-cleaning). */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss";
async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const { db, atelierUsers, atelierPaymentRuns, atelierPaymentRunItems, atelierAuditEvents } = await import("@workspace/db");
  const { eq, like } = await import("drizzle-orm");
  const server = (app as any).listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${PERSONA}`, "content-type": "application/json" };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  const runId = "payrun___t459probe";
  try {
    const [me] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, PERSONA));
    if (!me) throw new Error("persona not found");
    const now = new Date();
    await db.insert(atelierPaymentRuns).values({
      id: runId, orgId: me.orgId, runNumber: "PR-__T459", bankAccountId: "bank___t459",
      bankAccountLabel: "Probe Bank ····0000", currency: "USD", status: "paid",
      itemCount: 1, totalUsd: 123.45, makerUserId: me.id, makerName: me.name,
      createdByUserId: me.id,
      signatures: [
        { signatoryId: "sig1", userId: me.id, name: me.name, authority: "full", signedAt: now.toISOString() },
        { signatoryId: "sig2", userId: "p___t459b", name: "Second Signer", authority: "full", signedAt: now.toISOString() },
      ],
      approvedAt: now, exportedAt: now, paidAt: now,
    } as any);
    await db.insert(atelierPaymentRunItems).values({
      id: "pri___t459", orgId: me.orgId, runId, itemType: "expense_reimbursement",
      refId: "exp___t459", payeeName: "Probe Payee", description: "Probe item",
      amount: 123.45, currency: "USD", amountUsd: 123.45, status: "paid",
      remittanceRef: "REMIT-__T459", paidAt: now,
    } as any);
    await db.insert(atelierAuditEvents).values({
      id: "aud___t459", orgId: me.orgId, entityType: "payment_run", entityId: runId,
      actorType: "human", actorId: me.id, actorLabel: me.name,
      action: "finance.payment_run.mark_paid", payload: {}, payloadSummary: "Probe: marked paid.",
    } as any);

    const list = await fetch(`${base}/finance/payables/payment-runs`, { headers: hdrs });
    const lj = await list.json();
    check("list 200", list.status === 200, lj);
    const row = (lj.items as any[]).find((r) => r.id === runId);
    check("paid run in list with signatures+paidAt", !!row && row.status === "paid" && row.signatures.length === 2 && !!row.paidAt, row);

    const det = await fetch(`${base}/finance/payables/payment-runs/${runId}`, { headers: hdrs });
    const dj = await det.json();
    check("detail 200", det.status === 200, dj);
    check("detail item remittanceRef", dj.run?.items?.[0]?.remittanceRef === "REMIT-__T459", dj.run?.items);
    check("detail auditEvents present", Array.isArray(dj.auditEvents) && dj.auditEvents.length === 1 && dj.auditEvents[0].action === "finance.payment_run.mark_paid" && dj.auditEvents[0].actorLabel === me.name && typeof dj.auditEvents[0].at === "string", dj.auditEvents);
  } finally {
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.id, "aud___t459%"));
    await db.delete(atelierPaymentRunItems).where(like(atelierPaymentRunItems.id, "pri___t459%"));
    await db.delete(atelierPaymentRuns).where(like(atelierPaymentRuns.id, "payrun___t459%"));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("PROBE_ERR", e); process.exit(1); });
