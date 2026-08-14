/** Task #654 probe — six finance gaps.
 * Covers: (1) payroll run build/approve/mark-paid → journals + role/lock gates,
 * (2) VAT return compute + drill-down + mark-filed netting + nextVatFilingDate roll,
 * (3) CT provision (preview + configurable rate → Dr 6950 / Cr 2400 accrual),
 * (4) auto-reversing accrual journal dated 1st of next period + fail-loud when
 *     next period GL-locked, (5) founding-partner-only reopen (reason, sign-off
 *     reset, lock release), (6) engagement legalEntityId (PATCH validate,
 *     backfill from unambiguous invoices).
 * Self-cleaning (period 2018-xx, tag __T654). */
process.env.NODE_ENV = "test";
const P1 = "p_mounir_ariss";
const P2 = "p_gokhan_guney";
const T = "__T654";

async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const {
    db, atelierLegalEntities, atelierEmployees, atelierPayrollRun,
    atelierGlAccount, atelierGlJournalEntry, atelierGlJournalLine,
    atelierPeriodCloseLock, atelierAuditEvents, atelierInvoice,
    atelierCloseCycle, atelierCloseItem, atelierCloseAccrual,
    atelierEngagements, atelierAccounts, atelierUsers,
  } = await import("@workspace/db");
  const { and, eq, like, inArray, isNull } = await import("drizzle-orm");
  const { backfillEngagementLegalEntities } = await import("../src/lib/atelier-engagement-entity.js");
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
  const rid = (p: string) => `${p}_t654_${Math.random().toString(36).slice(2, 8)}`;
  const entIds: string[] = [];
  const empIds: string[] = [];
  const engIds: string[] = [];
  const invIds: string[] = [];
  const cycleIds: string[] = [];
  let acctId = "";
  try {
    const [me1] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, P1));
    const orgId = me1.orgId;

    // 0) entity + chart
    const er = await fetch(`${base}/finance/entities`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ legalNameEn: `${T} Entity A`, shortName: `T654A`, country: "AE", baseCurrency: "USD" }),
    });
    const ej = await er.json();
    check("create entity", er.status === 201 && !!ej.entity?.id, ej);
    const entA = ej.entity.id as string;
    entIds.push(entA);
    const s = await fetch(`${base}/gl/accounts?entityId=${entA}`, { headers: hdrs });
    check("chart auto-seeded on read", s.status === 200);
    const accts = await db.select().from(atelierGlAccount).where(and(eq(atelierGlAccount.legalEntityId, entA), isNull(atelierGlAccount.deletedAt)));
    check("chart has 6950", accts.some((a: any) => a.code === "6950"), accts.map((a: any) => a.code));

    // ── (1) payroll ──
    const e1 = rid("emp"), e2 = rid("emp");
    empIds.push(e1, e2);
    await db.insert(atelierEmployees).values([
      { id: e1, orgId, fullName: `${T} Alice`, email: `${e1}@x.test`, role: "consultant", employingEntity: "t654a", baseCompensation: 120000, baseCurrency: "USD", status: "active", employmentStatus: "active" },
      { id: e2, orgId, fullName: `${T} Bob`, email: `${e2}@x.test`, role: "consultant", employingEntity: "t654a", status: "active", employmentStatus: "active" },
    ] as any);
    const pb = await fetch(`${base}/payroll/runs`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodLabel: "2018-03" }) });
    const pbj = await pb.json();
    check("payroll build 201", pb.status === 201 && pbj.data.lines.length === 1 && pbj.data.totalAmount === 10000, pbj);
    check("no-comp employee excluded", pbj.data.excluded.length === 1 && pbj.data.excluded[0].reason === "no_base_compensation", pbj.data.excluded);
    const runId = pbj.data.id as string;
    const pb2 = await fetch(`${base}/payroll/runs`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodLabel: "2018-03" }) }).then(r => r.json());
    check("payroll rebuild refreshes draft", pb2.data.id === runId && pb2.data.refreshed === true, pb2);
    const pa = await fetch(`${base}/payroll/runs/${runId}/approve`, { method: "POST", headers: hdrs, body: "{}" });
    const paj = await pa.json();
    check("payroll approve posts journal", pa.status === 200 && !!paj.data.journalEntryId, paj);
    const [pj] = await db.select().from(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.id, paj.data.journalEntryId));
    check("payroll journal Dr6000/Cr2100 EOM", pj?.sourceKind === "payroll_run" && pj?.entryDate === "2018-03-31" && pj?.totalDebit === 10000, pj);
    const pjl = await db.select().from(atelierGlJournalLine).where(eq(atelierGlJournalLine.journalEntryId, pj.id));
    check("payroll lines 6000/2100", pjl.some((l: any) => l.accountCode === "6000" && l.debit === 10000) && pjl.some((l: any) => l.accountCode === "2100" && l.credit === 10000), pjl);
    const pa2 = await fetch(`${base}/payroll/runs/${runId}/approve`, { method: "POST", headers: hdrs, body: "{}" });
    check("payroll double-approve 409", pa2.status === 409);
    const pd = await fetch(`${base}/payroll/runs/${runId}`, { method: "DELETE", headers: hdrs });
    check("approved run delete rejected", pd.status === 409, pd.status);
    const pp = await fetch(`${base}/payroll/runs/${runId}/mark-paid`, { method: "POST", headers: hdrs, body: JSON.stringify({ paidDate: "2018-03-28" }) });
    const ppj = await pp.json();
    check("payroll mark-paid posts payment", pp.status === 200 && !!ppj.data.paymentJournalEntryId, ppj);
    const ppl = await db.select().from(atelierGlJournalLine).where(eq(atelierGlJournalLine.journalEntryId, ppj.data.paymentJournalEntryId));
    check("payment lines 2100/1000", ppl.some((l: any) => l.accountCode === "2100" && l.debit === 10000) && ppl.some((l: any) => l.accountCode === "1000" && l.credit === 10000), ppl);

    // ── (2) VAT return ──
    // post a manual sales-VAT journal (Cr 2300 = output 50) and purchase VAT (Dr 1400 = input 20)
    const mv1 = await fetch(`${base}/gl/journal/manual`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodLabel: "2018-03", entryDate: "2018-03-10", memo: `${T} sale`, currency: "USD", lines: [{ accountCode: "1000", debit: 1050 }, { accountCode: "4000", credit: 1000 }, { accountCode: "2300", credit: 50 }] }) });
    check("manual sales journal", mv1.status === 200 || mv1.status === 201, await mv1.json().catch(() => null));
    const mv2 = await fetch(`${base}/gl/journal/manual`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodLabel: "2018-03", entryDate: "2018-03-12", memo: `${T} purchase`, currency: "USD", lines: [{ accountCode: "6100", debit: 400 }, { accountCode: "1400", debit: 20 }, { accountCode: "2000", credit: 420 }] }) });
    check("manual purchase journal", mv2.status === 200 || mv2.status === 201, await mv2.json().catch(() => null));
    const vr = await fetch(`${base}/vat/return?entityId=${entA}&period=2018-03`, { headers: hdrs }).then(r => r.json());
    check("vat return computed", vr.data.outputVat === 50 && vr.data.inputVat === 20 && vr.data.netVat === 30 && vr.data.filed === false, vr.data);
    check("vat drill-down lines", vr.data.lines.length === 2 && vr.data.lines.some((l: any) => l.accountCode === "2300"), vr.data.lines);
    // set fiscal so filing rolls the date
    await fetch(`${base}/finance/entities/${entA}`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ fiscal: { vatPeriod: "monthly", nextVatFilingDate: "2018-04-28", ctRatePct: 10 } }) });
    const vf = await fetch(`${base}/vat/return/file`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, period: "2018-03" }) });
    const vfj = await vf.json();
    check("vat file posts netting", vf.status === 200 && !!vfj.data.settlementJournalEntryId && vfj.data.netVat === 30, vfj);
    const vnl = await db.select().from(atelierGlJournalLine).where(eq(atelierGlJournalLine.journalEntryId, vfj.data.settlementJournalEntryId));
    check("netting Dr2300/Cr1400 min-side 20", vnl.some((l: any) => l.accountCode === "2300" && l.debit === 20) && vnl.some((l: any) => l.accountCode === "1400" && l.credit === 20), vnl);
    check("nextVatFilingDate rolled +1mo", vfj.data.rolledNextVatFilingDateTo === "2018-05-28", vfj.data);
    const vf2 = await fetch(`${base}/vat/return/file`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, period: "2018-03" }) });
    check("vat double-file rejected", vf2.status === 409, vf2.status);
    const vr2 = await fetch(`${base}/vat/return?entityId=${entA}&period=2018-03`, { headers: hdrs }).then(r => r.json());
    check("vat return shows filed, unchanged", vr2.data.filed === true && vr2.data.netVat === 30, vr2.data);

    // ── (3+4) cycle: CT provision + auto-reversing accrual ──
    const c1 = await fetch(`${base}/close/cycles`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodType: "month", periodLabel: "2018-03" }) }).then(r => r.json());
    const cycleId = c1.data.id as string;
    cycleIds.push(cycleId);
    const det0 = await fetch(`${base}/close/cycles/${cycleId}`, { headers: hdrs }).then(r => r.json());
    check("checklist has payroll_posted + ct_provision", det0.data.items.some((i: any) => i.itemKey === "payroll_posted") && det0.data.items.some((i: any) => i.itemKey === "ct_provision"), det0.data.items.map((i: any) => i.itemKey));
    const ctp = await fetch(`${base}/close/cycles/${cycleId}/ct-provision`, { method: "POST", headers: hdrs, body: JSON.stringify({ preview: true }) }).then(r => r.json());
    check("ct preview uses entity rate 10%", ctp.data.preview === true && ctp.data.ratePct === 10, ctp.data);
    const ctr = await fetch(`${base}/close/cycles/${cycleId}/ct-provision`, { method: "POST", headers: hdrs, body: JSON.stringify({ ratePct: 20 }) });
    const ctrj = await ctr.json();
    // pre-tax profit 2018-03: revenue 1000 - payroll 10000 - purchase 400 < 0 → no_taxable_profit expected
    check("ct provision honest on loss", ctr.status === 400 && ctrj.error === "no_taxable_profit", ctrj);
    // make it profitable: big revenue journal
    await fetch(`${base}/gl/journal/manual`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodLabel: "2018-03", entryDate: "2018-03-20", memo: `${T} big sale`, currency: "USD", lines: [{ accountCode: "1000", debit: 50000 }, { accountCode: "4000", credit: 50000 }] }) });
    const ctr2 = await fetch(`${base}/close/cycles/${cycleId}/ct-provision`, { method: "POST", headers: hdrs, body: JSON.stringify({ ratePct: 20 }) });
    const ctr2j = await ctr2.json();
    check("ct provision proposes accrual", (ctr2.status === 200 || ctr2.status === 201) && !!ctr2j.data.accrualId, ctr2j);
    const [ctAcc] = await db.select().from(atelierCloseAccrual).where(eq(atelierCloseAccrual.id, ctr2j.data.accrualId));
    check("ct accrual Dr6950/Cr2400 non-reversing", !!ctAcc && ctAcc.autoReverse === false && ctAcc.lines.some((l: any) => l.accountCode === "6950" && l.debit > 0) && ctAcc.lines.some((l: any) => l.accountCode === "2400" && l.credit > 0), ctAcc);
    const ctApprove = await fetch(`${base}/close/accruals/${ctAcc.id}/approve`, { method: "POST", headers: hdrs, body: "{}" });
    const ctApJ = await ctApprove.json();
    check("ct accrual approve, NO reversal", ctApprove.status === 200 && !!ctApJ.data.journalEntryId && ctApJ.data.reversalEntryId === null, ctApJ);

    // auto-reversing accrual: insert a manual accrual row with autoReverse true
    const accId = rid("clsacc");
    await db.insert(atelierCloseAccrual).values({
      id: accId, orgId, cycleId, entityId: entA, periodLabel: "2018-03",
      sourceKey: `${T}_rev_test`, memo: `${T} reversing accrual`, rationaleText: "probe",
      currency: "USD", amount: 111, status: "proposed", autoReverse: true,
      lines: [{ accountCode: "6100", debit: 111, credit: 0 }, { accountCode: "2000", debit: 0, credit: 111 }],
    } as any);
    const rap = await fetch(`${base}/close/accruals/${accId}/approve`, { method: "POST", headers: hdrs, body: "{}" });
    const rapj = await rap.json();
    check("reversing accrual approve", rap.status === 200 && !!rapj.data.reversalEntryId, rapj);
    const [rev] = await db.select().from(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.id, rapj.data.reversalEntryId));
    check("reversal dated 2018-04-01, kind reversal", rev?.entryDate === "2018-04-01" && rev?.kind === "reversal" && rev?.reversesEntryId === rapj.data.journalEntryId && rev?.periodLabel === "2018-04", rev);
    const revLines = await db.select().from(atelierGlJournalLine).where(eq(atelierGlJournalLine.journalEntryId, rev.id));
    check("reversal flips Dr/Cr", revLines.some((l: any) => l.accountCode === "2000" && l.debit === 111) && revLines.some((l: any) => l.accountCode === "6100" && l.credit === 111), revLines);

    // fail-loud when next period locked: lock 2018-05, accrual in 2018-04
    const lockId = rid("lock");
    await db.insert(atelierPeriodCloseLock).values({ id: lockId, orgId, periodLabel: "2018-05", lockedModules: ["gl"], lockedByUserId: P1 } as any);
    const c2 = await fetch(`${base}/close/cycles`, { method: "POST", headers: hdrs, body: JSON.stringify({ entityId: entA, periodType: "month", periodLabel: "2018-04" }) }).then(r => r.json());
    cycleIds.push(c2.data.id);
    const accId2 = rid("clsacc");
    await db.insert(atelierCloseAccrual).values({
      id: accId2, orgId, cycleId: c2.data.id, entityId: entA, periodLabel: "2018-04",
      sourceKey: `${T}_rev_locked`, memo: `${T} locked-next accrual`, rationaleText: "probe",
      currency: "USD", amount: 50, status: "proposed", autoReverse: true,
      lines: [{ accountCode: "6100", debit: 50, credit: 0 }, { accountCode: "2000", debit: 0, credit: 50 }],
    } as any);
    const rap2 = await fetch(`${base}/close/accruals/${accId2}/approve`, { method: "POST", headers: hdrs, body: "{}" });
    const rap2j = await rap2.json();
    check("locked next period fails loudly 409", rap2.status === 409 && rap2j.error === "next_period_locked", rap2j);
    const [acc2After] = await db.select().from(atelierCloseAccrual).where(eq(atelierCloseAccrual.id, accId2));
    check("accrual untouched after 409", acc2After.status === "proposed" && !acc2After.journalEntryId, acc2After);
    await db.delete(atelierPeriodCloseLock).where(eq(atelierPeriodCloseLock.id, lockId));

    // ── (5) reopen ──
    // drive cycle 1 to signed_off: run controller, complete manual items, two sign-offs
    await fetch(`${base}/close/cycles/${cycleId}/run`, { method: "POST", headers: hdrs, body: "{}" });
    const detM = await fetch(`${base}/close/cycles/${cycleId}`, { headers: hdrs }).then(r => r.json());
    for (const it of detM.data.items.filter((i: any) => !i.autoCheck && i.status !== "done" && i.status !== "na")) {
      await fetch(`${base}/close/cycles/${cycleId}/items/${it.id}`, { method: "POST", headers: hdrs, body: JSON.stringify({ status: "done", note: `${T}` }) });
    }
    const jr = await fetch(`${base}/close/cycles/${cycleId}/run`, { method: "POST", headers: hdrs, body: "{}" }).then(r => r.json());
    if (!jr.data.readyForSignoff) {
      // clear auto blockers where possible is out of scope; report
      check("cycle ready for signoff (pre-reopen setup)", false, jr.data.blockers);
    } else {
      await fetch(`${base}/close/cycles/${cycleId}/signoff`, { method: "POST", headers: hdrs, body: "{}" });
      const so2 = await fetch(`${base}/close/cycles/${cycleId}/signoff`, { method: "POST", headers: H(P2), body: "{}" }).then(r => r.json());
      check("cycle signed off + locked", so2.data?.locked === true, so2);
      // reopen gates
      const roBad = await fetch(`${base}/close/cycles/${cycleId}/reopen`, { method: "POST", headers: hdrs, body: JSON.stringify({ reason: "short" }) });
      check("reopen short reason 400", roBad.status === 400, roBad.status);
      const ro = await fetch(`${base}/close/cycles/${cycleId}/reopen`, { method: "POST", headers: hdrs, body: JSON.stringify({ reason: `${T} correcting a misposted accrual` }) });
      const roj = await ro.json();
      check("founding partner reopen 200", ro.status === 200 && roj.data.reopened === true && roj.data.lockReleased === true, roj);
      const [cyc] = await db.select().from(atelierCloseCycle).where(eq(atelierCloseCycle.id, cycleId));
      check("signoffs reset + status open", cyc.status !== "signed_off" && !cyc.firstSignoffUserId && !cyc.secondSignoffUserId, cyc);
      const [lockRow] = await db.select().from(atelierPeriodCloseLock).where(and(eq(atelierPeriodCloseLock.periodLabel, "2018-03"), isNull(atelierPeriodCloseLock.deletedAt)));
      check("lock removed", !lockRow, lockRow);
      const aud = await db.select().from(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityId, cycleId), eq(atelierAuditEvents.action, "close.reopen")));
      check("reopen audited with reason", aud.length === 1 && JSON.stringify(aud[0].payload).includes("misposted"), aud);
      const roAgain = await fetch(`${base}/close/cycles/${cycleId}/reopen`, { method: "POST", headers: hdrs, body: JSON.stringify({ reason: `${T} second reopen attempt` }) });
      check("reopen non-signed-off 409", roAgain.status === 409);
    }

    // ── (6) engagement legalEntityId ──
    const [acct] = await db.select().from(atelierAccounts).limit(1);
    acctId = acct?.id ?? "";
    const engId = rid("eng");
    engIds.push(engId);
    await db.insert(atelierEngagements).values({
      id: engId, orgId, slug: rid("slug"), name: `${T} Engagement`, accountId: acctId,
      partnerOwnerId: P1, engagementLeadId: P1, plmStage: "mobilize",
      startDate: "2018-03-01", plannedEndDate: "2018-06-30",
    } as any);
    const pe1 = await fetch(`${base}/engagements/${engId}`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ legalEntityId: "nonexistent_ent" }) });
    check("PATCH unknown entity 404", pe1.status === 404, pe1.status);
    const pe2 = await fetch(`${base}/engagements/${engId}`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ legalEntityId: entA }) });
    check("PATCH set entity 200", pe2.status === 200, await pe2.json().catch(() => null));
    const ge = await fetch(`${base}/engagements/${engId}`, { headers: hdrs }).then(r => r.json());
    check("GET returns legalEntityId", ge.legalEntityId === entA, ge);
    const audE = await db.select().from(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityId, engId), eq(atelierAuditEvents.action, "engagement.legal_entity.update")));
    check("entity change audited", audE.length === 1, audE.length);
    const pe3 = await fetch(`${base}/engagements/${engId}`, { method: "PATCH", headers: hdrs, body: JSON.stringify({ legalEntityId: null }) });
    check("PATCH clear entity 200", pe3.status === 200);

    // backfill: engagement with unambiguous invoice history
    const eng2 = rid("eng");
    engIds.push(eng2);
    await db.insert(atelierEngagements).values({
      id: eng2, orgId, slug: rid("slug"), name: `${T} Engagement 2`, accountId: acctId,
      partnerOwnerId: P1, engagementLeadId: P1, plmStage: "mobilize",
      startDate: "2018-03-01", plannedEndDate: "2018-06-30",
    } as any);
    const inv1 = rid("inv");
    invIds.push(inv1);
    await db.insert(atelierInvoice).values({
      id: inv1, jurisdiction: "T654X", legalEntityId: entA, engagementId: eng2, status: "issued",
      invoiceNumber: `${T}-INV-1`, currency: "USD", subtotal: 100, vatAmount: 0, total: 100,
      amountPaid: 0, dueDate: "2018-05-01", issuedAt: new Date("2018-04-01T00:00:00Z"),
      billTo: { name: `${T} Client` },
    } as any);
    const bf = await backfillEngagementLegalEntities();
    check("backfill filled unambiguous engagement", bf.filled >= 1, bf);
    const [eng2Row] = await db.select().from(atelierEngagements).where(eq(atelierEngagements.id, eng2));
    check("backfilled legalEntityId", eng2Row.legalEntityId === entA, eng2Row.legalEntityId);
    const [eng1Row] = await db.select().from(atelierEngagements).where(eq(atelierEngagements.id, engId));
    check("no-invoice engagement stays null", eng1Row.legalEntityId === null, eng1Row.legalEntityId);

    // role gates: finance persona blocked from payroll approve is partner-tier only — check via no persona
    const forb = await fetch(`${base}/payroll/runs`, { headers: { cookie: "atelier_persona=__nonexistent", "content-type": "application/json" } });
    check("payroll no persona rejected", forb.status === 401 || forb.status === 403, forb.status);
  } finally {
    // cleanup — tracked ids then __T654 sweep
    for (const cid of cycleIds) {
      await db.delete(atelierCloseItem).where(eq(atelierCloseItem.cycleId, cid));
      await db.delete(atelierCloseAccrual).where(eq(atelierCloseAccrual.cycleId, cid));
      await db.delete(atelierCloseCycle).where(eq(atelierCloseCycle.id, cid));
    }
    if (invIds.length) await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, invIds));
    if (engIds.length) await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, engIds));
    if (empIds.length) await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, empIds));
    await db.delete(atelierPayrollRun).where(like(atelierPayrollRun.periodLabel, "2018-%"));
    const entries = await db.select({ id: atelierGlJournalEntry.id }).from(atelierGlJournalEntry).where(like(atelierGlJournalEntry.periodLabel, "2018-%"));
    const eIds = entries.map(e => e.id);
    if (eIds.length) {
      await db.delete(atelierGlJournalLine).where(inArray(atelierGlJournalLine.journalEntryId, eIds));
      await db.delete(atelierGlJournalEntry).where(inArray(atelierGlJournalEntry.id, eIds));
    }
    await db.delete(atelierPeriodCloseLock).where(like(atelierPeriodCloseLock.periodLabel, "2018-%"));
    if (entIds.length) await db.delete(atelierGlAccount).where(inArray(atelierGlAccount.legalEntityId, entIds));
    for (const id of entIds) {
      await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, id));
      await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, id));
    }
    await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.legalNameEn, `${T}%`));
    await db.delete(atelierEmployees).where(like(atelierEmployees.fullName, `${T}%`));
    await db.delete(atelierEngagements).where(like(atelierEngagements.name, `${T}%`));
    await db.delete(atelierInvoice).where(like(atelierInvoice.invoiceNumber, `${T}%`));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("PROBE_ERR", e); process.exit(1); });
