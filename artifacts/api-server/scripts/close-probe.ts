/** Task #432 probe — period-close workflow + Collections Agent.
 * Covers: cycle create + checklist, Close Controller checks + accrual
 * proposal, hard-blocked sign-off, accrual approve → journal, manual
 * items, two-distinct-partner sign-off + period lock, year-end rollover
 * idempotency, collections drafts (never auto-send), approve-send →
 * dunning event, P2P suppression, escalation ack, dismiss, role gates.
 * Self-cleaning (uses period 2019-01 / year 2019, tag __T432). */
process.env.NODE_ENV = "test";
const P1 = "p_mounir_ariss";
const P2 = "p_gokhan_guney";
const PERIOD = "2019-01";
const YEAR = "2019";
const T = "__T432";

async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const {
    db, atelierLegalEntities, atelierInvoice, atelierExpenses,
    atelierGlAccount, atelierGlJournalEntry, atelierGlJournalLine,
    atelierPeriodCloseLock, atelierAuditEvents,
    atelierCloseCycle, atelierCloseItem, atelierCloseAccrual,
    atelierCollectionsDraft, atelierDunningLadder, atelierDunningEvent,
    atelierPromiseToPay,
  } = await import("@workspace/db");
  const { and, eq, like, inArray, isNull } = await import("drizzle-orm");
  const server = (app as any).listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const H = (p: string) => ({ cookie: `atelier_persona=${p}`, "content-type": "application/json" });
  const hdrs = H(P1);
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra)?.slice(0, 500));
  };
  const rid = (p: string) => `${p}_t432_${Math.random().toString(36).slice(2, 8)}`;
  const entIds: string[] = [];
  const cycleIds: string[] = [];
  const invIds: string[] = [];
  let ladderId = "";
  try {
    // 0) two entities + seeded chart on A
    for (const nm of ["A", "B"]) {
      const r = await fetch(`${base}/finance/entities`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ legalNameEn: `${T} Entity ${nm}`, shortName: `T432${nm}`, country: "AE", baseCurrency: "USD" }),
      });
      const j = await r.json();
      check(`create entity ${nm}`, r.status === 201 && !!j.entity?.id, j);
      entIds.push(j.entity.id);
    }
    const [entA] = entIds;
    const s = await fetch(`${base}/gl/accounts/seed`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA }) });
    check("seed chart", s.status === 200);

    // 1) create a month cycle → checklist scaffolded
    const c1 = await fetch(`${base}/close/cycles`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodType: "month", periodLabel: PERIOD }) });
    const c1j = await c1.json();
    check("create month cycle", (c1.status === 201 || c1.status === 200) && !!c1j.data?.id, c1j);
    const cycleId = c1j.data.id as string;
    cycleIds.push(cycleId);
    const c1b = await fetch(`${base}/close/cycles`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodType: "month", periodLabel: PERIOD }) }).then(r => r.json());
    check("cycle create idempotent", c1b.data.id === cycleId && c1b.data.alreadyExists === true, c1b);
    const badP = await fetch(`${base}/close/cycles`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodType: "month", periodLabel: "2019-13" }) });
    check("invalid period rejected 400", badP.status === 400);
    const det0 = await fetch(`${base}/close/cycles/${cycleId}`, { headers: hdrs }).then(r => r.json());
    check("checklist scaffolded", det0.data.items.length >= 8 && det0.data.items.some((i: any) => i.itemKey === "ar_tie"), det0.data.items?.length);

    // 2) pending expense in period → controller proposes accrual + blocks
    const expId = rid("exp");
    await db.insert(atelierExpenses).values({
      id: expId, personId: P1, expenseDate: "2019-01-12", captureSource: "manual",
      merchant: `${T} Hotel`, category: "hotel", amount: 200, usdAmount: 200, vatTreatment: "none",
      status: "submitted", entityId: entA,
    } as any);
    const r1 = await fetch(`${base}/close/cycles/${cycleId}/run`, { method: "POST", headers: hdrs, body: "{}" });
    const j1 = await r1.json();
    check("controller run 200", r1.status === 200, j1);
    check("expense_cutoff blocked", j1.data.blockers.some((b: any) => b.itemKey === "expense_cutoff"), j1.data.blockers);
    check("accrual proposed", j1.data.accrualsProposed >= 1, j1.data);
    check("not ready for signoff", j1.data.readyForSignoff === false);

    // 3) sign-off hard-blocked
    const so1 = await fetch(`${base}/close/cycles/${cycleId}/signoff`, { method: "POST", headers: hdrs, body: "{}" });
    check("signoff hard-blocked 409", so1.status === 409, await so1.json());

    // 4) approve accrual → balanced journal posts (kind accrual, month-end date)
    const det1 = await fetch(`${base}/close/cycles/${cycleId}`, { headers: hdrs }).then(r => r.json());
    const acc = det1.data.accruals.find((a: any) => a.status === "proposed");
    check("accrual visible on cycle", !!acc && acc.amount === 200, det1.data.accruals);
    const ap = await fetch(`${base}/close/accruals/${acc.id}/approve`, { method: "POST", headers: hdrs, body: "{}" });
    const apj = await ap.json();
    check("accrual approve 200 + journal", ap.status === 200 && !!apj.data.journalEntryId, apj);
    const [jrn] = await db.select().from(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.id, apj.data.journalEntryId));
    check("journal kind/source/date", jrn?.kind === "accrual" && jrn?.sourceKind === "close_accrual" && jrn?.entryDate === "2019-01-31" && jrn?.totalDebit === 200, jrn);
    const ap2 = await fetch(`${base}/close/accruals/${acc.id}/approve`, { method: "POST", headers: hdrs, body: "{}" });
    check("accrual double-approve 409", ap2.status === 409);

    // 5) clear the expense, re-run → auto checks pass; complete manual items
    await db.update(atelierExpenses).set({ status: "approved", approvedAt: new Date("2019-01-13T00:00:00Z") } as any).where(eq(atelierExpenses.id, expId));
    const j2 = await fetch(`${base}/close/cycles/${cycleId}/run`, { method: "POST", headers: hdrs, body: "{}" }).then(r => r.json());
    check("auto blockers cleared", j2.data.blockers.every((b: any) => ["timesheet_review", "management_review"].includes(b.itemKey)), j2.data.blockers);
    const det2 = await fetch(`${base}/close/cycles/${cycleId}`, { headers: hdrs }).then(r => r.json());
    const autoItem = det2.data.items.find((i: any) => i.autoCheck);
    const manualItems = det2.data.items.filter((i: any) => !i.autoCheck && (i.status === "open" || i.status === "blocked"));
    const badItem = await fetch(`${base}/close/cycles/${cycleId}/items/${autoItem.id}`, { method: "POST", headers: hdrs, body: JSON.stringify({ status: "done" }) });
    check("auto item manual-complete rejected 400", badItem.status === 400);
    for (const it of manualItems) {
      const mi = await fetch(`${base}/close/cycles/${cycleId}/items/${it.id}`, { method: "POST", headers: hdrs, body: JSON.stringify({ status: "done", note: `${T} reviewed` }) });
      check(`manual item ${it.itemKey} done`, mi.status === 200);
    }
    const j3 = await fetch(`${base}/close/cycles/${cycleId}/run`, { method: "POST", headers: hdrs, body: "{}" }).then(r => r.json());
    check("ready for signoff", j3.data.readyForSignoff === true, j3.data.blockers);

    // 6) two-distinct-partner sign-off → lock engaged
    const soA = await fetch(`${base}/close/cycles/${cycleId}/signoff`, { method: "POST", headers: hdrs, body: "{}" }).then(r => r.json());
    check("first signoff", soA.data?.signoff === "first" && soA.data.awaitingSecond === true, soA);
    const soDup = await fetch(`${base}/close/cycles/${cycleId}/signoff`, { method: "POST", headers: hdrs, body: "{}" });
    check("same-partner second signoff 409", soDup.status === 409, await soDup.json());
    const soB = await fetch(`${base}/close/cycles/${cycleId}/signoff`, { method: "POST", headers: H(P2), body: "{}" });
    const soBj = await soB.json();
    check("second distinct partner locks", soB.status === 200 && soBj.data.signoff === "final" && soBj.data.locked === true, soBj);
    const [lock] = await db.select().from(atelierPeriodCloseLock).where(and(eq(atelierPeriodCloseLock.periodLabel, PERIOD), isNull(atelierPeriodCloseLock.deletedAt)));
    check("lock row has modules", !!lock && ["revrec", "gl", "bank_rec"].every(m => (lock.lockedModules ?? []).includes(m)), lock);
    const soAgain = await fetch(`${base}/close/cycles/${cycleId}/signoff`, { method: "POST", headers: hdrs, body: "{}" }).then(r => r.json());
    check("signed-off cycle idempotent", soAgain.data?.alreadySignedOff === true, soAgain);
    const lockedManual = await fetch(`${base}/gl/journal/manual`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ entityId: entA, periodLabel: PERIOD, entryDate: "2019-01-20", memo: `${T} blocked`, currency: "USD", lines: [{ accountCode: "1000", debit: 10 }, { accountCode: "3000", credit: 10 }] }),
    });
    check("locked period blocks manual GL 409", lockedManual.status === 409);

    // 7) year-end rollover (net income from the 2019-01 accrual journal) + idempotency
    const ro = await fetch(`${base}/close/rollover`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, year: YEAR }) });
    const roj = await ro.json();
    check("rollover posts", ro.status === 200 && !!roj.data.journalEntryId && Math.abs(roj.data.netIncome - -200) < 0.011, roj);
    const ro2 = await fetch(`${base}/close/rollover`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, year: YEAR }) }).then(r => r.json());
    check("rollover idempotent", ro2.data.alreadyPosted === true, ro2);

    // 8) Collections — ladder + overdue invoice → drafts only, never auto-send
    ladderId = rid("ldr");
    await db.insert(atelierDunningLadder).values({
      id: ladderId, name: `${T} ladder`, jurisdiction: "T432X", isDefault: true,
      steps: [
        { offsetDays: 7, channel: "email", template: "gentle_reminder", requireApproval: false },
        { offsetDays: 21, channel: "email", template: "final_notice", requireApproval: true },
      ],
    } as any);
    const invId = rid("inv");
    invIds.push(invId);
    await db.insert(atelierInvoice).values({
      id: invId, jurisdiction: "T432X", legalEntityId: entIds[0], status: "issued",
      invoiceNumber: `${T}-INV-1`, currency: "USD", subtotal: 1000, vatAmount: 0, total: 1000,
      amountPaid: 0, dueDate: "2026-06-01", issuedAt: new Date("2026-05-01T00:00:00Z"),
      billTo: { name: `${T} Client`, contactEmail: "billing@example.com" },
    } as any);
    const cr1 = await fetch(`${base}/collections/run`, { method: "POST", headers: hdrs, body: JSON.stringify({ asOf: "2026-07-01" }) });
    const cr1j = await cr1.json();
    check("collections run drafts step 0", cr1.status === 200 && cr1j.data.draftsCreated >= 1, cr1j);
    const dl = await fetch(`${base}/collections/drafts?status=draft`, { headers: hdrs }).then(r => r.json());
    const d0 = dl.data.rows.find((d: any) => d.invoiceId === invId);
    check("draft step0 not sent, no event", d0?.stepIndex === 0 && d0.status === "draft" && !d0.escalation, d0);
    const ev0 = await db.select().from(atelierDunningEvent).where(eq(atelierDunningEvent.invoiceId, invId));
    check("no dunning event before approval", ev0.length === 0);

    // approve-send step 0 → dunning event written, draft marked sent
    const send0 = await fetch(`${base}/collections/drafts/${d0.id}/approve-send`, { method: "POST", headers: hdrs, body: "{}" });
    const send0j = await send0.json();
    check("approve-send 200", send0.status === 200 && !!send0j.data.dunningEventId, send0j);
    const ev1 = await db.select().from(atelierDunningEvent).where(eq(atelierDunningEvent.invoiceId, invId));
    check("dunning event recorded", ev1.length === 1 && ev1[0].stepIndex === 0);
    const resend = await fetch(`${base}/collections/drafts/${d0.id}/approve-send`, { method: "POST", headers: hdrs, body: "{}" });
    check("double-send rejected 409", resend.status === 409);

    // step 1 drafts on re-run; open future P2P suppresses further chases
    const cr2 = await fetch(`${base}/collections/run`, { method: "POST", headers: hdrs, body: JSON.stringify({ asOf: "2026-07-01" }) }).then(r => r.json());
    const dl2 = await fetch(`${base}/collections/drafts?status=draft`, { headers: hdrs }).then(r => r.json());
    const d1 = dl2.data.rows.find((d: any) => d.invoiceId === invId && d.stepIndex === 1);
    check("step 1 drafted after event", !!d1 && d1.requireApproval === true, cr2.data);
    const p2pId = rid("p2p");
    await db.insert(atelierPromiseToPay).values({ id: p2pId, invoiceId: invId, promisedAmount: 1000, promisedDate: "2026-08-15", status: "open", recordedBy: P1 } as any);
    const sendP = await fetch(`${base}/collections/drafts/${d1.id}/approve-send`, { method: "POST", headers: hdrs, body: "{}" });
    check("open P2P blocks send 409", sendP.status === 409, await sendP.json());
    await db.delete(atelierPromiseToPay).where(eq(atelierPromiseToPay.id, p2pId));

    // dismiss step 1 draft
    const dis = await fetch(`${base}/collections/drafts/${d1.id}/dismiss`, { method: "POST", headers: hdrs, body: JSON.stringify({ reason: `${T} test` }) });
    check("dismiss 200", dis.status === 200);

    // escalation: exhaust the ladder → internal escalation draft; ack = no email/event
    await db.insert(atelierDunningEvent).values({ id: rid("dun"), invoiceId: invId, ladderId, stepIndex: 1, channel: "email", template: "final_notice", sentBy: P1 } as any);
    await fetch(`${base}/collections/run`, { method: "POST", headers: hdrs, body: JSON.stringify({ asOf: "2026-07-01" }) });
    const dl3 = await fetch(`${base}/collections/drafts?status=draft`, { headers: hdrs }).then(r => r.json());
    const desc = dl3.data.rows.find((d: any) => d.invoiceId === invId && d.escalation);
    check("escalation drafted when ladder exhausted", !!desc, dl3.data.rows);
    const ack = await fetch(`${base}/collections/drafts/${desc.id}/approve-send`, { method: "POST", headers: hdrs, body: "{}" });
    const ackj = await ack.json();
    check("escalation ack internal", ack.status === 200 && ackj.data.sentVia === "internal", ackj);
    const evFinal = await db.select().from(atelierDunningEvent).where(eq(atelierDunningEvent.invoiceId, invId));
    check("escalation ack adds no dunning event", evFinal.length === 2);

    // 9) role gate
    const forb = await fetch(`${base}/close/cycles`, { headers: { cookie: "atelier_persona=__nonexistent", "content-type": "application/json" } });
    check("no persona rejected", forb.status === 401 || forb.status === 403, forb.status);
  } finally {
    // cleanup — tracked ids then __T432 pattern sweep
    for (const cid of cycleIds) {
      await db.delete(atelierCloseItem).where(eq(atelierCloseItem.cycleId, cid));
      await db.delete(atelierCloseAccrual).where(eq(atelierCloseAccrual.cycleId, cid));
      await db.delete(atelierCloseCycle).where(eq(atelierCloseCycle.id, cid));
    }
    if (invIds.length) {
      await db.delete(atelierCollectionsDraft).where(inArray(atelierCollectionsDraft.invoiceId, invIds));
      await db.delete(atelierDunningEvent).where(inArray(atelierDunningEvent.invoiceId, invIds));
      await db.delete(atelierPromiseToPay).where(inArray(atelierPromiseToPay.invoiceId, invIds));
    }
    if (ladderId) await db.delete(atelierDunningLadder).where(eq(atelierDunningLadder.id, ladderId));
    const entries = await db.select({ id: atelierGlJournalEntry.id }).from(atelierGlJournalEntry).where(like(atelierGlJournalEntry.periodLabel, `${YEAR}%`));
    const eIds = entries.map(e => e.id);
    if (eIds.length) {
      await db.delete(atelierGlJournalLine).where(inArray(atelierGlJournalLine.journalEntryId, eIds));
      await db.delete(atelierGlJournalEntry).where(inArray(atelierGlJournalEntry.id, eIds));
    }
    await db.delete(atelierPeriodCloseLock).where(like(atelierPeriodCloseLock.periodLabel, `${YEAR}%`));
    if (entIds.length) await db.delete(atelierGlAccount).where(inArray(atelierGlAccount.legalEntityId, entIds));
    await db.delete(atelierInvoice).where(like(atelierInvoice.invoiceNumber, `${T}%`));
    await db.delete(atelierExpenses).where(like(atelierExpenses.merchant, `${T}%`));
    for (const id of entIds) {
      await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, id));
      await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, id));
    }
    await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.legalNameEn, `${T}%`));
    await db.delete(atelierDunningLadder).where(like(atelierDunningLadder.name, `${T}%`));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("PROBE_ERR", e); process.exit(1); });
