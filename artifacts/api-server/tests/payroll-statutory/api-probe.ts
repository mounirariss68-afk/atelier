/**
 * Task #655 — statutory payroll live-API probe (isolated scratch DB).
 *
 * Covers:
 *   - Gating: consultant/recruiter 403 on payroll surfaces; finance OK.
 *   - GET /finance/payroll/overview — entities + auto-attached filings.
 *   - Regime summary for a covered country.
 *   - POST run (compute draft) → totals for an AE expat employee;
 *     POST :id/post → posted + GL journal; re-post → 409-ish error.
 *   - EOSB report rows; settlement create + settle (GL journal).
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/payroll-statutory/api-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierEmployees, atelierAuthCredentials } = D;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe655_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const conId = `u_${runTag}_con`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (who: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values([
      {
        id: fpId,
        orgId: "aico",
        name: "Probe655 Partner",
        initials: "PP",
        email: `${runTag}_fp@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
      {
        id: conId,
        orgId: "aico",
        name: "Probe655 Consultant",
        initials: "PC",
        email: `${runTag}_con@example.test`,
        role: "consultant",
        roleLabel: "Consultant",
        title: "Consultant",
      },
    ] as any);

    // ---- Gating ----
    const conOverview = await api(conId, "GET", "/finance/payroll/overview");
    check("consultant payroll overview -> 403", conOverview.status === 403, conOverview);

    // ---- Entity with statutory coverage (AE) ----
    const created = await api(fpId, "POST", "/finance/entities", {
      legalNameEn: `Probe655 FZ-LLC ${runTag}`,
      country: "AE",
      legalForm: "FZ-LLC",
      jurisdiction: "DIFC",
      baseCurrency: "AED",
      registeredAddress: "Unit 42, DIFC, Dubai",
    });
    check("fp entity create -> 201", created.status === 201, created);
    const entityId: string = created.body?.entity?.id;

    // Park pre-existing unlinked employees (boot-seeded founders, prior
    // probe leftovers) on a placeholder entity so they don't show up as
    // unattributed validation errors in this entity's run.
    const { isNull: dIsNull } = await import("drizzle-orm");
    await db.update(atelierEmployees).set({ legalEntityId: "lent_probe655_parked" }).where(dIsNull(atelierEmployees.legalEntityId));

    // ---- Employee on that entity: expat, 10k basic ----
    const empId = `emp_${runTag}`;
    await db.insert(atelierEmployees).values({
      id: empId,
      orgId: "aico",
      fullName: "Probe Six Fifty-Five",
      email: `${runTag}_emp@example.test`,
      role: "consultant",
      nationality: "IN",
      startDate: "2019-07-01",
      legalEntityId: entityId,
      basicWageMonthly: 10_000,
      housingAllowanceMonthly: 2_000,
      baseCurrency: "AED",
      baseCompensation: 180_000, // 15k/mo gross
      iban: "AE070331234567890123456",
    } as any);

    // ---- Overview: entity covered + filings auto-attached ----
    const ov = await api(fpId, "GET", "/finance/payroll/overview");
    check("overview -> 200", ov.status === 200, ov.status);
    const entCard = (ov.body?.entities ?? []).find((e: any) => e.id === entityId);
    check("overview lists covered AE entity", !!entCard && entCard.covered === true, entCard);

    const regime = await api(fpId, "GET", "/finance/payroll/regime/AE");
    const regimeFilings = (regime.body?.rules?.versions ?? []).flatMap((v: any) => v.filings ?? []);
    check("regime AE -> 200 with filings", regime.status === 200 && regimeFilings.length >= 2, regime.status);

    // ---- Compute a draft run ----
    const period = "2026-06";
    const run = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: period });
    check("compute run -> 201/200", run.status === 201 || run.status === 200, run);
    const runId = run.body?.run?.id;
    const totals = run.body?.run?.totals ?? run.body?.run;
    check("run headcount 1", (totals?.headcount ?? run.body?.run?.headcount) === 1, totals);

    const detail = await api(fpId, "GET", `/finance/payroll/runs/${runId}`);
    check("run detail -> 200 with lines", detail.status === 200 && (detail.body?.lines?.length ?? 0) === 1, detail.status);
    const line = detail.body?.lines?.[0];
    // AE expat: EOSB accrual only (30 d/yr past 5y svc → 10000*30/30/12 ≈ 833.33/mo), ILOE employee 5
    check("line has EOSB accrual > 0", (line?.eosbAccrual ?? 0) > 0, line);

    // ---- Post to GL ----
    const posted = await api(fpId, "POST", `/finance/payroll/runs/${runId}/post`);
    check("post run -> 200 posted", posted.status === 200 && posted.body?.run?.status === "posted", posted);
    const repost = await api(fpId, "POST", `/finance/payroll/runs/${runId}/post`);
    check("re-post idempotent/blocked", repost.status >= 400 || repost.body?.alreadyPosted === true, repost.body);

    // ---- EOSB report ----
    const eosb = await api(fpId, "GET", `/finance/payroll/eosb/report?entityId=${entityId}`);
    check("eosb report -> 200", eosb.status === 200, eosb.status);
    const row = (eosb.body?.rows ?? []).find((r: any) => r.employeeId === empId);
    check("eosb row present with liability > 0", !!row && row.liabilityToDate > 0, row);

    // ---- Consolidated rollup (no entityId) ----
    const consolidated = await api(fpId, "GET", "/finance/payroll/eosb/report");
    check("consolidated report -> 200", consolidated.status === 200 && consolidated.body?.consolidated === true, consolidated.status);
    const consEnt = (consolidated.body?.entities ?? []).find((e: any) => e.entityId === entityId);
    check("consolidated includes entity with liability", !!consEnt && consEnt.totalLiability > 0, consEnt);
    check("group totals aggregate by currency", (consolidated.body?.groupTotals?.AED?.totalLiability ?? 0) >= (consEnt?.totalLiability ?? 1), consolidated.body?.groupTotals);

    // ---- Settlement create + settle ----
    const stl = await api(fpId, "POST", "/finance/payroll/eosb/settlements", {
      employeeId: empId,
      leaveDate: "2026-07-31",
      reason: "resignation",
    });
    check("settlement create -> 201/200", stl.status === 201 || stl.status === 200, stl);
    const stlId = stl.body?.settlement?.id;
    check("AE resignation pays full (factor 1)", stl.body?.settlement?.adjustmentFactor === 1, stl.body?.settlement);

    const settled = await api(fpId, "POST", `/finance/payroll/eosb/settlements/${stlId}/settle`);
    check("settle -> 200 settled", settled.status === 200 && settled.body?.settlement?.status === "settled", settled);

    const list = await api(fpId, "GET", "/finance/payroll/eosb/settlements");
    check("settlements list includes settled row", (list.body?.items ?? []).some((s: any) => s.id === stlId && s.status === "settled"), list.status);

    // ---- 13-week forecast: statutory lines are employer contributions only
    // (salary rides on the roster dis_payroll_* lines — no double count) ----
    const cashLines = await api(fpId, "GET", "/finance/plan/cash-13w/lines");
    check("cash-13w lines -> 200", cashLines.status === 200, cashLines.status);
    const allLines: any[] = [
      ...(cashLines.body?.receipts ?? []),
      ...(cashLines.body?.disbursements ?? []),
      ...(cashLines.body?.lines ?? []),
      ...(cashLines.body?.items ?? []),
    ];
    const statLines = allLines.filter((l: any) => String(l.id ?? "").startsWith(`statpay-${entityId}`));
    const runTotals = detail.body?.run?.totals;
    if (statLines.length > 0 && runTotals) {
      check(
        "statutory line = employer contributions only (no salary double-count)",
        Math.abs(statLines[0].amount - runTotals.employerContributions) < 0.02,
        { line: statLines[0].amount, employerContributions: runTotals.employerContributions, netPay: runTotals.netPay },
      );
    } else {
      // AE expat run has zero employer cash contributions (EOSB is non-cash),
      // so no statutory line at all is the correct outcome.
      check(
        "no statutory cash line when employer contributions are zero",
        (runTotals?.employerContributions ?? 0) === 0,
        { statLines: statLines.length, totals: runTotals },
      );
    }

    // ---- Offboarding hook: deactivate(markLeaver) drafts the EOSB settlement ----
    const leaverUserId = `u_${runTag}_leaver`;
    const leaverEmpId = `emp_${runTag}_leaver`;
    const leaverEmail = `${runTag}_leaver@example.test`;
    await db.insert(atelierUsers).values({
      id: leaverUserId,
      orgId: "aico",
      name: "Probe655 Leaver",
      initials: "PL",
      email: leaverEmail,
      role: "consultant",
      roleLabel: "Consultant",
      title: "Consultant",
    } as any);
    await db.insert(atelierAuthCredentials).values({
      email: leaverEmail,
      userId: leaverUserId,
      passwordHash: "x-not-a-real-hash",
    } as any);
    await db.insert(atelierEmployees).values({
      id: leaverEmpId,
      orgId: "aico",
      userId: leaverUserId,
      fullName: "Probe655 Leaver",
      email: leaverEmail,
      role: "consultant",
      nationality: "PK",
      startDate: "2020-01-01",
      legalEntityId: entityId,
      basicWageMonthly: 8_000,
      baseCurrency: "AED",
      baseCompensation: 120_000,
      iban: "AE070331234567890123457",
    } as any);
    const deact = await api(fpId, "POST", `/roster/joiners/${leaverUserId}/deactivate`, {
      markLeaver: true,
      endDate: "2026-07-24",
      eosbReason: "resignation",
    });
    check("deactivate(markLeaver) -> 200", deact.status === 200, deact);
    const list2 = await api(fpId, "GET", "/finance/payroll/eosb/settlements");
    const autoStl = (list2.body?.items ?? []).find((s: any) => s.employeeId === leaverEmpId);
    check("offboarding auto-drafts EOSB settlement", !!autoStl && autoStl.status === "draft" && autoStl.finalAmount > 0, autoStl ?? list2.status);
    check("auto settlement uses passed reason", autoStl?.reason === "resignation", autoStl?.reason);

    // ---- Positive forecast case: UAE national → employer GPSSA cash ----
    await db.insert(atelierEmployees).values({
      id: `emp_${runTag}_nat`,
      orgId: "aico",
      fullName: "Probe National",
      email: `${runTag}_nat@example.test`,
      role: "consultant",
      nationality: "AE",
      startDate: "2024-01-01",
      legalEntityId: entityId,
      basicWageMonthly: 20_000,
      baseCurrency: "AED",
      baseCompensation: 240_000,
      iban: "AE070331234567890123458",
    } as any);
    const run2 = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-07" });
    const run2Id = run2.body?.run?.id;
    const post2 = await api(fpId, "POST", `/finance/payroll/runs/${run2Id}/post`);
    const t2 = post2.body?.run?.totals;
    check("national run posts with employer contributions > 0", post2.status === 200 && (t2?.employerContributions ?? 0) > 0, t2);
    const cash2 = await api(fpId, "GET", "/finance/plan/cash-13w/lines");
    const all2: any[] = [
      ...(cash2.body?.receipts ?? []), ...(cash2.body?.disbursements ?? []),
      ...(cash2.body?.lines ?? []), ...(cash2.body?.items ?? []),
    ];
    const stat2 = all2.filter((l: any) => String(l.id ?? "").startsWith(`statpay-${entityId}`));
    check(
      "forecast statutory line = employer contributions only (no salary double-count)",
      stat2.length > 0 && Math.abs(stat2[0].amount - t2.employerContributions) < 0.02,
      { line: stat2[0]?.amount, employerContributions: t2?.employerContributions, netPay: t2?.netPay },
    );

    // ════════ Task #1135 — proration, advances, comp history, final pay ════════
    const { atelierPayDocuments, atelierPayrollRun, atelierLeaveRequests, atelierCompChanges } = D as any;
    const { and: dAnd, eq: dEq } = await import("drizzle-orm");

    // Payslips were generated into the pay hub when run2 posted.
    const slips = await db.select().from(atelierPayDocuments).where(dAnd(
      dEq(atelierPayDocuments.orgId, "aico"),
      dEq(atelierPayDocuments.category, "payslip"),
      dEq(atelierPayDocuments.notes, `payrun:${run2Id}`),
    ));
    check("posting generates published payslip docs", slips.length >= 1 && slips.every((s: any) => s.published === true && s.mime === "application/pdf" && s.sizeBytes > 1000), slips.map((s: any) => ({ personId: s.personId, size: s.sizeBytes })));

    // -- Missing IBAN blocks posting --
    const noIbanId = `emp_${runTag}_noiban`;
    await db.insert(atelierEmployees).values({
      id: noIbanId, orgId: "aico", fullName: "Probe NoIban", email: `${runTag}_ni@example.test`,
      role: "consultant", nationality: "IN", startDate: "2025-01-01", legalEntityId: entityId,
      basicWageMonthly: 6_000, baseCurrency: "AED", baseCompensation: 96_000,
    } as any);
    const runNi = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-08" });
    const veNi = runNi.body?.run?.validationErrors ?? [];
    check("missing IBAN → validation error on draft", veNi.some((v: any) => /iban/i.test(v.message)), veNi);
    const postNi = await api(fpId, "POST", `/finance/payroll/runs/${runNi.body?.run?.id}/post`);
    check("missing IBAN blocks posting", postNi.status >= 400, postNi.status);
    await db.update(atelierEmployees).set({ iban: "AE070331234567890123459" }).where(dEq(atelierEmployees.id, noIbanId));

    // -- Mid-month joiner proration + unpaid leave --
    const joinId = `emp_${runTag}_join`;
    await db.insert(atelierEmployees).values({
      id: joinId, orgId: "aico", fullName: "Probe Joiner", email: `${runTag}_j@example.test`,
      role: "consultant", nationality: "IN", startDate: "2026-08-16", legalEntityId: entityId,
      basicWageMonthly: 6_000, housingAllowanceMonthly: 3_100, baseCurrency: "AED", baseCompensation: 120_000,
      iban: "AE070331234567890123460",
    } as any);
    // Approved unpaid leave for the no-IBAN emp: Aug 1–6 (6 days)
    await db.insert(atelierLeaveRequests).values({
      id: `lv_${runTag}`, orgId: "aico", userId: fpId, personId: noIbanId, personType: "employee",
      leaveType: "unpaid", startDate: "2026-08-01", endDate: "2026-08-06", workingDays: 4,
      status: "approved",
    } as any);
    const runAug = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-08" });
    const augDetail = await api(fpId, "GET", `/finance/payroll/runs/${runAug.body?.run?.id}`);
    const joinLine = (augDetail.body?.lines ?? []).find((l: any) => l.employeeId === joinId);
    check("mid-month joiner prorated 16/31 days", !!joinLine && joinLine.payableDays === 16 && joinLine.daysInMonth === 31 && Math.abs(joinLine.monthlyGross - (120_000 / 12) * (16 / 31)) < 0.05, joinLine && { payableDays: joinLine.payableDays, gross: joinLine.monthlyGross, basis: joinLine.prorationBasis });
    // Housing on the line/payslip is the PRORATED amount, never the
    // contractual monthly figure (which would exceed a 16/31 gross here).
    check("joiner housing allowance prorated (16/31 of 3100, < gross)",
      !!joinLine && Math.abs(joinLine.housingAllowance - 3_100 * (16 / 31)) < 0.05 && joinLine.housingAllowance < joinLine.monthlyGross,
      joinLine && { housing: joinLine.housingAllowance, gross: joinLine.monthlyGross });
    const uLine = (augDetail.body?.lines ?? []).find((l: any) => l.employeeId === noIbanId);
    check("unpaid-leave days reduce pay (25/31 payable)", !!uLine && uLine.unpaidLeaveDays === 6 && uLine.payableDays === 25, uLine && { payableDays: uLine.payableDays, unpaid: uLine.unpaidLeaveDays, basis: uLine.prorationBasis });

    // -- Comp change via audited payroll PATCH → mid-month raise splits --
    const raisePatch = await api(fpId, "PATCH", `/roster/people/${noIbanId}/payroll`, {
      baseCompensation: 144_000, basicWageMonthly: 9_000,
      effectiveFrom: "2026-08-16", reason: "promotion",
    });
    check("payroll PATCH with comp meta -> 200", raisePatch.status === 200, raisePatch);
    const compRows = await db.select().from(atelierCompChanges).where(dEq(atelierCompChanges.employeeId, noIbanId));
    check("comp-change history row written (promotion, effective 2026-08-16)", compRows.some((c: any) => c.reason === "promotion" && c.effectiveFrom === "2026-08-16"), compRows);
    const runAug2 = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-08" });
    const augDetail2 = await api(fpId, "GET", `/finance/payroll/runs/${runAug2.body?.run?.id}`);
    const uLine2 = (augDetail2.body?.lines ?? []).find((l: any) => l.employeeId === noIbanId);
    // Old 8k gross Aug 1–15 (minus 6 unpaid 1–6), new 12k gross Aug 16–31: (9/31)*8000 + (16/31)*12000
    const expectSplit = (9 / 31) * 8_000 + (16 / 31) * 12_000;
    check("mid-month raise splits the month's pay", !!uLine2 && Math.abs(uLine2.monthlyGross - expectSplit) < 0.05, uLine2 && { gross: uLine2.monthlyGross, expect: expectSplit, basis: uLine2.prorationBasis });

    // -- Salary advance lifecycle --
    const advConDenied = await api(conId, "POST", "/finance/payroll/advances", { employeeId: noIbanId, amount: 6_000, installmentAmount: 2_000, startPeriod: "2026-08" });
    check("consultant cannot issue advances (403)", advConDenied.status === 403, advConDenied.status);
    const adv = await api(fpId, "POST", "/finance/payroll/advances", { employeeId: noIbanId, amount: 6_000, installmentAmount: 2_000, startPeriod: "2026-08" });
    check("advance issue -> 201 with journal", adv.status === 201 && !!adv.body?.advance?.journalEntryId && adv.body?.advance?.outstanding === 6_000, adv.body);
    const advId = adv.body?.advance?.id;
    const runAug3 = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-08" });
    const runAug3Id = runAug3.body?.run?.id;
    const augDetail3 = await api(fpId, "GET", `/finance/payroll/runs/${runAug3Id}`);
    const uLine3 = (augDetail3.body?.lines ?? []).find((l: any) => l.employeeId === noIbanId);
    const dedExpected = Math.min(2_000, (uLine3?.monthlyGross ?? 0) * 0.2);
    check("run deducts scheduled installment (cap-aware) from net", !!uLine3 && Math.abs(uLine3.advanceDeduction - dedExpected) < 0.05 && uLine3.netPay < uLine3.monthlyGross, uLine3 && { ded: uLine3.advanceDeduction, expect: dedExpected, net: uLine3.netPay });
    // pause → no deduction
    const paused = await api(fpId, "POST", `/finance/payroll/advances/${advId}/pause`);
    check("advance pause -> 200", paused.status === 200 && paused.body?.advance?.status === "paused", paused.body);
    const runAug4 = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-08" });
    const augDetail4 = await api(fpId, "GET", `/finance/payroll/runs/${runAug4.body?.run?.id}`);
    const uLine4 = (augDetail4.body?.lines ?? []).find((l: any) => l.employeeId === noIbanId);
    check("paused advance not deducted", !!uLine4 && (uLine4.advanceDeduction ?? 0) === 0, uLine4?.advanceDeduction);
    await api(fpId, "POST", `/finance/payroll/advances/${advId}/resume`);
    // deduction cap: 20% of gross — issue big advance on the joiner
    const bigAdv = await api(fpId, "POST", "/finance/payroll/advances", { employeeId: joinId, amount: 9_000, installmentAmount: 9_000, startPeriod: "2026-08" });
    check("big advance issued", bigAdv.status === 201, bigAdv.status);
    const runAug5 = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-08" });
    const augDetail5 = await api(fpId, "GET", `/finance/payroll/runs/${runAug5.body?.run?.id}`);
    const jLine5 = (augDetail5.body?.lines ?? []).find((l: any) => l.employeeId === joinId);
    check("deduction capped at 20% of gross, net ≥ 0", !!jLine5 && jLine5.advanceDeduction <= jLine5.monthlyGross * 0.2 + 0.01 && jLine5.netPay >= 0, jLine5 && { gross: jLine5.monthlyGross, ded: jLine5.advanceDeduction, net: jLine5.netPay });
    // post the run → outstanding drops, GL 1150 credited
    const postAug = await api(fpId, "POST", `/finance/payroll/runs/${runAug5.body?.run?.id}/post`);
    check("august run posts (advances applied)", postAug.status === 200, postAug.body);
    const advList = await api(fpId, "GET", "/finance/payroll/advances");
    const advRow = (advList.body?.items ?? []).find((a: any) => a.id === advId);
    const uLine5 = (augDetail5.body?.lines ?? []).find((l: any) => l.employeeId === noIbanId);
    check("outstanding drops after posted run", !!advRow && Math.abs(advRow.outstanding - (6_000 - (uLine5?.advanceDeduction ?? 0))) < 0.05 && advRow.outstanding < 6_000, { outstanding: advRow?.outstanding, ded: uLine5?.advanceDeduction });
    // early payoff of remaining balance
    const payoff = await api(fpId, "POST", `/finance/payroll/advances/${advId}/payoff`);
    check("early payoff -> repaid, outstanding 0", payoff.status === 200 && payoff.body?.advance?.status === "repaid" && payoff.body?.advance?.outstanding === 0, payoff.body?.advance);

    // -- Settlement final pay: encashment + notice − advances --
    const bigAdvRow = (advList.body?.items ?? []).find((a: any) => a.id === bigAdv.body?.advance?.id);
    const stlFinal = await api(fpId, "POST", "/finance/payroll/eosb/settlements", {
      employeeId: joinId, leaveDate: "2026-09-15", reason: "termination",
      noticeDaysDue: 30, noticeDaysServed: 30, probation: true,
    });
    check("final-pay settlement -> 201", stlFinal.status === 201, stlFinal.body);
    const sf = stlFinal.body?.settlement;
    check("probation leaver: gratuity 0 but final pay assembled", !!sf && sf.finalAmount === 0 && typeof sf.finalPayTotal === "number", sf && { finalAmount: sf.finalAmount, finalPayTotal: sf.finalPayTotal, encash: sf.leaveEncashment, advOffset: sf.advanceOffset });
    check("settlement offsets outstanding advance", !!sf && Math.abs(sf.advanceOffset - (bigAdvRow?.outstanding ?? -1)) < 0.01, { advOffset: sf?.advanceOffset, outstanding: bigAdvRow?.outstanding });
    check("settlement includes prorated final salary", !!sf && sf.salaryIncluded === true && sf.lastSalary > 0, sf && { salaryIncluded: sf.salaryIncluded, lastSalary: sf.lastSalary });
    const settledF = await api(fpId, "POST", `/finance/payroll/eosb/settlements/${sf?.id}/settle`);
    check("final-pay settle -> 200 balanced journal", settledF.status === 200 && settledF.body?.settlement?.status === "settled", settledF.body);
    const advList2 = await api(fpId, "GET", "/finance/payroll/advances");
    const bigAfter = (advList2.body?.items ?? []).find((a: any) => a.id === bigAdv.body?.advance?.id);
    check("settlement drains the advance", !!bigAfter && bigAfter.outstanding === 0 && bigAfter.status === "repaid", bigAfter && { out: bigAfter.outstanding, status: bigAfter.status });

    // -- salaryIncluded is EMPLOYEE-LINE scoped, not run-existence scoped --
    // noIban had a payable line in the posted Aug run → salary must NOT be
    // double-included in an Aug-leaver settlement…
    const stlPaid = await api(fpId, "POST", "/finance/payroll/eosb/settlements", {
      employeeId: noIbanId, leaveDate: "2026-08-31", reason: "termination",
    });
    check("leaver already paid in posted run: salary not double-included", stlPaid.status === 201 && stlPaid.body?.settlement?.salaryIncluded === false, stlPaid.body?.settlement && { salaryIncluded: stlPaid.body.settlement.salaryIncluded });
    // …but a leaver EXCLUDED from that posted run (added after compute)
    // still gets their final salary despite the run existing.
    const exclId = `emp_${runTag}_excl`;
    await db.insert(atelierEmployees).values({
      id: exclId, orgId: "aico", fullName: "Probe Excluded Leaver", email: `${runTag}_excl@example.test`,
      role: "consultant", nationality: "IN", startDate: "2026-08-01", legalEntityId: entityId,
      basicWageMonthly: 7_000, baseCurrency: "AED", baseCompensation: 84_000,
      iban: "AE070331234567890123459",
    } as any);
    const stlExcl = await api(fpId, "POST", "/finance/payroll/eosb/settlements", {
      employeeId: exclId, leaveDate: "2026-08-31", reason: "termination",
    });
    const sfe = stlExcl.body?.settlement;
    check("leaver excluded from posted run: final salary still included", stlExcl.status === 201 && sfe?.salaryIncluded === true && sfe?.lastSalary > 0, sfe && { salaryIncluded: sfe.salaryIncluded, lastSalary: sfe.lastSalary });

    // -- Payslip repair path: re-posting a posted run regenerates missing slips --
    const [lostSlip] = slips;
    if (lostSlip) {
      await db.delete(atelierPayDocuments).where(dEq(atelierPayDocuments.id, lostSlip.id));
      const repost = await api(fpId, "POST", `/finance/payroll/runs/${run2Id}/post`);
      const slipsAfter = await db.select().from(atelierPayDocuments).where(dAnd(
        dEq(atelierPayDocuments.orgId, "aico"),
        dEq(atelierPayDocuments.category, "payslip"),
        dEq(atelierPayDocuments.notes, `payrun:${run2Id}`),
      ));
      check("idempotent re-post repairs missing payslips", repost.status === 200 && slipsAfter.length === slips.length, { before: slips.length, after: slipsAfter.length, status: repost.status });
    }

    // -- Segment-weighted contributions: GPSSA national with a mid-month raise --
    // Oct 2026 (31 days): 20k basic for Oct 1-15 (15d), 26k from Oct 16 (16d).
    // GPSSA amounts must be the day-weighted blend of per-segment bases,
    // NOT end-of-month wage × factor.
    const natId = `emp_${runTag}_nat`;
    await db.insert(atelierCompChanges).values([
      {
        id: `cc_${runTag}_nat0`, orgId: "aico", employeeId: natId, effectiveFrom: "2024-01-01",
        baseCompensation: 240_000, baseCurrency: "AED", basicWageMonthly: 20_000, reason: "initial",
      },
      {
        id: `cc_${runTag}_nat1`, orgId: "aico", employeeId: natId, effectiveFrom: "2026-10-16",
        baseCompensation: 312_000, baseCurrency: "AED", basicWageMonthly: 26_000, reason: "promotion",
      },
    ] as any);
    const runOct = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-10" });
    const octDetail = await api(fpId, "GET", `/finance/payroll/runs/${runOct.body?.run?.id}`);
    const natLine = (octDetail.body?.lines ?? []).find((l: any) => l.employeeId === natId);
    const gpssa = (natLine?.contributions ?? []).find((c: any) => /gpssa|pension/i.test(`${c.schemeKey} ${c.name}`));
    const oldSegAmt = (20_000 * 0.05) * (15 / 31); // employee 5% (post-2023 registration path may differ — compare weighted vs flat instead
    // Robust check: weighted amount must sit strictly BETWEEN old-wage×factor and new-wage×factor and differ from new-wage-only.
    if (gpssa) {
      const pct = gpssa.employeePct as number;
      const wOld = (20_000 * pct / 100) * (15 / 31);
      const wNew = (26_000 * pct / 100) * (16 / 31);
      const expected = wOld + wNew;
      const flatEndOfMonth = (26_000 * pct / 100); // full month at raised wage
      check("GPSSA employee amount is segment-weighted (not end-of-month × factor)",
        Math.abs(gpssa.employeeAmount - expected) < 0.05 && Math.abs(gpssa.employeeAmount - flatEndOfMonth) > 1,
        { got: gpssa.employeeAmount, expected, flatEndOfMonth, pct, oldSegAmt });
    } else {
      check("GPSSA contribution present on national line", false, natLine?.contributions);
    }

    // -- Entity transfer: another entity's run never touches the advance --
    // Advance issued while on entity A stays on A's 1150 ledger; after the
    // employee transfers to entity B, B's run must not deduct or clear it.
    const ent2 = await api(fpId, "POST", "/finance/entities", {
      legalNameEn: `Probe655 Transfer LLC ${runTag}`, country: "AE", legalForm: "LLC",
      jurisdiction: "Dubai mainland", baseCurrency: "AED", registeredAddress: "Dubai",
    });
    const entity2Id: string = ent2.body?.entity?.id;
    const legEmpId = `emp_leg_${runTag}`;
    await db.insert(atelierEmployees).values({
      id: legEmpId,
      orgId: "aico",
      fullName: "Probe Legacy Liner",
      email: `${runTag}_leg@example.test`,
      role: "consultant",
      nationality: "IN",
      startDate: "2024-01-01",
      status: "active",
      employmentStatus: "active",
      employingEntity: "Probe655",
      legalEntityId: entityId,
      basicWageMonthly: 9_000,
      baseCurrency: "AED",
      baseCompensation: 120_000,
      iban: "AE070331234567890123457",
    } as any);
    const xferAdv = await api(fpId, "POST", "/finance/payroll/advances", {
      employeeId: legEmpId, amount: 3_000, installmentAmount: 1_000, startPeriod: "2026-11",
    });
    check("transfer advance issued on entity A", xferAdv.status === 201, xferAdv.body);
    await db.update(atelierEmployees).set({ legalEntityId: entity2Id }).where(dEq(atelierEmployees.id, legEmpId));
    const runB = await api(fpId, "POST", "/finance/payroll/runs", { entityId: entity2Id, periodLabel: "2026-11" });
    const runBDetail = await api(fpId, "GET", `/finance/payroll/runs/${runB.body?.run?.id}`);
    const legLineB = (runBDetail.body?.lines ?? []).find((l: any) => l.employeeId === legEmpId);
    check("transferred employee's new-entity run deducts NO advance",
      !!legLineB && (legLineB.advanceDeduction ?? 0) === 0,
      legLineB ? { ded: legLineB.advanceDeduction } : runBDetail.body);
    const xferList = await api(fpId, "GET", "/finance/payroll/advances");
    const xferRow = (xferList.body?.items ?? []).find((a: any) => a.id === xferAdv.body?.advance?.id);
    check("advance outstanding untouched after other-entity run", !!xferRow && xferRow.outstanding === 3_000, xferRow?.outstanding);
    // move them back so the legacy dual-path fixture below still matches entity A
    await db.update(atelierEmployees).set({ legalEntityId: entityId }).where(dEq(atelierEmployees.id, legEmpId));

    // -- Stale-draft protection: payoff between compute and post → 409 --
    const runNov = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-11" });
    const novDetail = await api(fpId, "GET", `/finance/payroll/runs/${runNov.body?.run?.id}`);
    const legNov = (novDetail.body?.lines ?? []).find((l: any) => l.employeeId === legEmpId);
    check("draft run schedules the advance deduction", !!legNov && (legNov.advanceDeduction ?? 0) > 0, legNov?.advanceDeduction);
    const stalePayoff = await api(fpId, "POST", `/finance/payroll/advances/${xferAdv.body?.advance?.id}/payoff`);
    check("advance paid off after draft computed", stalePayoff.status === 200, stalePayoff.body);
    const stalePost = await api(fpId, "POST", `/finance/payroll/runs/${runNov.body?.run?.id}/post`);
    check("posting a stale draft cannot over-credit the advance asset (409)",
      stalePost.status === 409 && /recompute the run before posting/.test(stalePost.body?.message ?? ""),
      { status: stalePost.status, message: stalePost.body?.message });
    const runNov2 = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-11" });
    const novDetail2 = await api(fpId, "GET", `/finance/payroll/runs/${runNov2.body?.run?.id}`);
    const legNov2 = (novDetail2.body?.lines ?? []).find((l: any) => l.employeeId === legEmpId);
    const novPost2 = await api(fpId, "POST", `/finance/payroll/runs/${runNov2.body?.run?.id}/post`);
    check("recomputed run drops the deduction and posts cleanly",
      (legNov2?.advanceDeduction ?? -1) === 0 && novPost2.status === 200,
      { ded: legNov2?.advanceDeduction, status: novPost2.status });

    // -- Concurrency: legacy approve vs statutory post race on one period --
    // Both drafts exist for 2026-12; fire approve + post simultaneously.
    // The shared advisory lock must let at most ONE salary journal through.
    const statDec = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-12" });
    const legacyDec = await api(fpId, "POST", "/payroll/runs", { entityId, periodLabel: "2026-12" });
    const [statDecPost, legacyDecApprove] = await Promise.all([
      api(fpId, "POST", `/finance/payroll/runs/${statDec.body?.run?.id}/post`),
      api(fpId, "POST", `/payroll/runs/${legacyDec.body?.data?.id}/approve`),
    ]);
    const bothWon = statDecPost.status === 200 && legacyDecApprove.status === 200;
    check("racing legacy approve vs statutory post: not both succeed",
      !bothWon && (statDecPost.status === 200 || legacyDecApprove.status === 200),
      { statutory: statDecPost.status, legacy: legacyDecApprove.status });
    const { atelierGlJournalEntry } = D as any;
    const decJournals = await db.select().from(atelierGlJournalEntry).where(dAnd(
      dEq(atelierGlJournalEntry.orgId, "aico"),
      dEq(atelierGlJournalEntry.sourceKind, "payroll_run"),
      dEq(atelierGlJournalEntry.legalEntityId, entityId),
      dEq(atelierGlJournalEntry.periodLabel, "2026-12"),
    ));
    check("race leaves exactly one Dec salary journal", decJournals.length === 1, decJournals.map((j: any) => j.sourceRef));

    // Concurrent double-post of the same statutory run → single journal.
    if (statDecPost.status === 200) {
      const [rp1, rp2] = await Promise.all([
        api(fpId, "POST", `/finance/payroll/runs/${statDec.body?.run?.id}/post`),
        api(fpId, "POST", `/finance/payroll/runs/${statDec.body?.run?.id}/post`),
      ]);
      const decJournals2 = await db.select().from(atelierGlJournalEntry).where(dAnd(
        dEq(atelierGlJournalEntry.orgId, "aico"),
        dEq(atelierGlJournalEntry.sourceKind, "payroll_run"),
        dEq(atelierGlJournalEntry.legalEntityId, entityId),
        dEq(atelierGlJournalEntry.periodLabel, "2026-12"),
      ));
      check("concurrent re-posts stay idempotent (one journal)", rp1.status === 200 && rp2.status === 200 && decJournals2.length === 1, { rp1: rp1.status, rp2: rp2.status, journals: decJournals2.length });
    }

    // -- Race: recompute while posting must never desync journal vs run --
    const statJan = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2027-01" });
    const janRunId = statJan.body?.run?.id;
    const [janPost, janRecompute] = await Promise.all([
      api(fpId, "POST", `/finance/payroll/runs/${janRunId}/post`),
      api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2027-01" }),
    ]);
    // Whatever the interleaving: the post succeeds, the recompute either
    // ran before the post (200, then post journals ITS snapshot under the
    // lock), lost the race (409 "posted while recompute"), or returned the
    // posted snapshot. The posted run/lines/journal must be ONE snapshot.
    const janRunAfter = (await api(fpId, "GET", `/finance/payroll/runs/${janRunId}`)).body;
    const janTotals = janRunAfter?.run?.totals;
    const janLines = janRunAfter?.lines ?? [];
    const [janJournal] = await db.select().from(atelierGlJournalEntry).where(dAnd(
      dEq(atelierGlJournalEntry.orgId, "aico"),
      dEq(atelierGlJournalEntry.sourceKind, "payroll_run"),
      dEq(atelierGlJournalEntry.sourceRef, `${entityId}:2027-01`),
    ));
    const janExpectedDebit = Math.round(((janTotals?.grossSalaries ?? 0) + (janTotals?.employerContributions ?? 0) + (janTotals?.eosbAccrual ?? 0)) * 100) / 100;
    const janLineGross = Math.round(janLines.reduce((s: number, l: any) => s + l.monthlyGross, 0) * 100) / 100;
    check("recompute-vs-post race: post succeeded and recompute did not corrupt",
      janPost.status === 200 && (janRecompute.status === 200 || janRecompute.status === 409),
      { post: janPost.status, recompute: janRecompute.status });
    check("recompute-vs-post race: posted run status is posted", janRunAfter?.run?.status === "posted", janRunAfter?.run?.status);
    check("recompute-vs-post race: journal debit matches posted totals",
      !!janJournal && Math.abs(janJournal.totalDebit - janExpectedDebit) < 0.02,
      { journal: janJournal?.totalDebit, expected: janExpectedDebit });
    check("recompute-vs-post race: lines sum matches posted totals gross",
      Math.abs(janLineGross - (janTotals?.grossSalaries ?? -1)) < 0.02 && janLines.length === (janTotals?.headcount ?? -1),
      { lineGross: janLineGross, totals: janTotals?.grossSalaries, lines: janLines.length, headcount: janTotals?.headcount });
    // Recompute AFTER post returns the posted snapshot unchanged.
    const janRe2 = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2027-01" });
    check("recompute after post returns the posted snapshot", (janRe2.status === 200 || janRe2.status === 201) && janRe2.body?.run?.status === "posted" && janRe2.body?.run?.totals?.grossSalaries === janTotals?.grossSalaries,
      { status: janRe2.status, runStatus: janRe2.body?.run?.status });

    // -- Race: settlement vs run post → final-month salary paid ONCE --
    const raceEmpId = `emp_${runTag}_strace`;
    await db.insert(atelierEmployees).values({
      id: raceEmpId, orgId: "aico", fullName: "Probe SettleRace", email: `${runTag}_sr@example.test`,
      role: "consultant", nationality: "IN", startDate: "2025-03-01", endDate: "2027-02-15",
      legalEntityId: entityId, basicWageMonthly: 7_000, baseCurrency: "AED", baseCompensation: 108_000,
      iban: "AE070331234567890123499",
    } as any);
    const febRun = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2027-02" });
    const febHasRace = (febRun.body?.lines ?? (await api(fpId, "GET", `/finance/payroll/runs/${febRun.body?.run?.id}`)).body?.lines ?? []).some((l: any) => l.employeeId === raceEmpId);
    check("settle-race fixture: leaver on the Feb 2027 draft", febHasRace, febRun.status);
    const raceStl = await api(fpId, "POST", "/finance/payroll/eosb/settlements", {
      employeeId: raceEmpId, leaveDate: "2027-02-15", reason: "resignation",
    });
    const raceStlId = raceStl.body?.settlement?.id ?? raceStl.body?.id;
    check("settle-race fixture: draft settlement includes final salary", (raceStl.body?.settlement ?? raceStl.body)?.salaryIncluded === true, raceStl.status);
    const [raceSettle, racePost] = await Promise.all([
      api(fpId, "POST", `/finance/payroll/eosb/settlements/${raceStlId}/settle`),
      api(fpId, "POST", `/finance/payroll/runs/${febRun.body?.run?.id}/post`),
    ]);
    const febRunAfter = (await api(fpId, "GET", `/finance/payroll/runs/${febRun.body?.run?.id}`)).body;
    const stlAfter = ((await api(fpId, "GET", "/finance/payroll/eosb/settlements")).body?.items ?? []).find((s: any) => s.id === raceStlId);
    const runPaidSalary = febRunAfter?.run?.status === "posted" && (febRunAfter?.lines ?? []).some((l: any) => l.employeeId === raceEmpId);
    const stlPaidSalary = stlAfter?.status === "settled" && stlAfter?.salaryIncluded === true;
    check("settle-vs-post race: settlement settled", raceSettle.status === 200, raceSettle.status);
    check("settle-vs-post race: exactly one path pays the final-month salary",
      (runPaidSalary ? 1 : 0) + (stlPaidSalary ? 1 : 0) === 1,
      { post: racePost.status, settle: raceSettle.status, runPaidSalary, stlPaidSalary, runStatus: febRunAfter?.run?.status, salaryIncluded: stlAfter?.salaryIncluded });
    // -- Race: concurrent double-settle (with outstanding advance) --
    const dsEmpId = `emp_${runTag}_dsettle`;
    await db.insert(atelierEmployees).values({
      id: dsEmpId, orgId: "aico", fullName: "Probe DoubleSettle", email: `${runTag}_ds@example.test`,
      role: "consultant", nationality: "IN", startDate: "2025-05-01", endDate: "2027-03-10",
      legalEntityId: entityId, basicWageMonthly: 8_000, baseCurrency: "AED", baseCompensation: 120_000,
      iban: "AE070331234567890123497",
    } as any);
    const dsAdv = await api(fpId, "POST", "/finance/payroll/advances", { employeeId: dsEmpId, amount: 2_000, installmentAmount: 1_000, startPeriod: "2027-03" });
    check("double-settle fixture: advance issued", dsAdv.status === 200 || dsAdv.status === 201, dsAdv.status);
    const dsStl = await api(fpId, "POST", "/finance/payroll/eosb/settlements", {
      employeeId: dsEmpId, leaveDate: "2027-03-10", reason: "resignation",
    });
    const dsStlId = dsStl.body?.settlement?.id ?? dsStl.body?.id;
    const [ds1, ds2] = await Promise.all([
      api(fpId, "POST", `/finance/payroll/eosb/settlements/${dsStlId}/settle`),
      api(fpId, "POST", `/finance/payroll/eosb/settlements/${dsStlId}/settle`),
    ]);
    const dsAfter = ((await api(fpId, "GET", "/finance/payroll/eosb/settlements")).body?.items ?? []).find((x: any) => x.id === dsStlId);
    const [dsJournal, ...dsExtra] = await db.select().from(atelierGlJournalEntry).where(dAnd(
      dEq(atelierGlJournalEntry.orgId, "aico"),
      dEq(atelierGlJournalEntry.sourceKind, "eosb_settlement"),
      dEq(atelierGlJournalEntry.sourceRef, dsStlId),
    ));
    check("double-settle: both calls 200, one journal", ds1.status === 200 && ds2.status === 200 && !!dsJournal && dsExtra.length === 0, { ds1: ds1.status, ds2: ds2.status, journals: 1 + dsExtra.length });
    check("double-settle: settled amounts match the journal (advance offset once)",
      dsAfter?.status === "settled" && dsAfter?.advanceOffset === 2_000 && Math.abs(dsJournal.totalCredit - (dsAfter.finalPayTotal + dsAfter.advanceOffset)) < 0.02,
      { advanceOffset: dsAfter?.advanceOffset, finalPayTotal: dsAfter?.finalPayTotal, journalCredit: dsJournal?.totalCredit });
    const dsAdvAfter = ((await api(fpId, "GET", "/finance/payroll/advances")).body?.items ?? []).find((a: any) => a.employeeId === dsEmpId);
    check("double-settle: advance drawn down exactly once", dsAdvAfter?.outstanding === 0 && dsAdvAfter?.status === "repaid", { outstanding: dsAdvAfter?.outstanding, status: dsAdvAfter?.status });

    // If the post lost the race it must have 409'd demanding a recompute;
    // recompute then drops the settled leaver and the run posts cleanly.
    if (racePost.status !== 200) {
      check("losing post 409s with a settled-leaver message", racePost.status === 409 && /settled|recompute/i.test(racePost.body?.message ?? ""), { status: racePost.status, msg: racePost.body?.message });
      const febRe = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2027-02" });
      const febHasRace2 = ((await api(fpId, "GET", `/finance/payroll/runs/${febRe.body?.run?.id}`)).body?.lines ?? []).some((l: any) => l.employeeId === raceEmpId);
      const febPost2 = await api(fpId, "POST", `/finance/payroll/runs/${febRe.body?.run?.id}/post`);
      check("recompute drops settled leaver and posts", !febHasRace2 && febPost2.status === 200, { hasLeaver: febHasRace2, post: febPost2.status });
    }

    // -- Dual-path guard: legacy simple run cannot double-post --
    const legacy = await api(fpId, "POST", "/payroll/runs", { entityId, periodLabel: "2026-08" });
    const legacyId = legacy.body?.data?.id;
    if (legacyId) {
      const legacyApprove = await api(fpId, "POST", `/payroll/runs/${legacyId}/approve`);
      check("legacy approve blocked when statutory run posted (409)", legacyApprove.status === 409 && legacyApprove.body?.error === "statutory_run_posted", legacyApprove);
    } else {
      check("legacy run draft creatable", legacy.status === 201 || legacy.status === 200, legacy);
    }
    // reverse direction: legacy-approved period blocks statutory post
    // (the legacy builder picks up the emp_leg fixture created above via
    // its employingEntity token).
    const legacySep = await api(fpId, "POST", "/payroll/runs", { entityId, periodLabel: "2026-09" });
    const legacySepId = legacySep.body?.data?.id;
    const legacySepApprove = await api(fpId, "POST", `/payroll/runs/${legacySepId}/approve`);
    check("legacy run with payable lines approves for a free period", legacySepApprove.status === 200, { status: legacySepApprove.status, body: legacySepApprove.body });
    const statSep = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2026-09" });
    const statSepPost = await api(fpId, "POST", `/finance/payroll/runs/${statSep.body?.run?.id}/post`);
    check("statutory post blocked when legacy approved (409)", statSepPost.status === 409 && /legacy monthly payroll already posted/.test(statSepPost.body?.message ?? ""), statSepPost.status === 409 ? statSepPost.body : statSepPost);

    // ════════ Task #1148 — GL journal per-account balance assertions ════════
    // Full EOSB settlement with ALL components non-zero:
    //   • finalAmount > 0       (~10 yrs AE expat service)
    //   • leaveEncashment >= 0  (natural annual-leave accrual from long tenure)
    //   • noticePay < 0         (employee owes 30 unserved notice days — negative debit
    //                            flips to a credit on account 6000 inside postJournal)
    //   • advOffset = 4 000 AED (active advance outstanding)
    //   • salaryPart > 0        (no posted payroll run for leave month 2027-05 for this employee)
    // After settling, read back atelierGlJournalLine rows and assert per-account
    // debit/credit sums match the figures stored on the settled row.
    const glEmpId = `emp_${runTag}_glcheck`;
    await db.insert(atelierEmployees).values({
      id: glEmpId,
      orgId: "aico",
      fullName: "Probe GL Check",
      email: `${runTag}_glcheck@example.test`,
      role: "consultant",
      nationality: "IN",
      startDate: "2017-04-01", // ~10 years by 2027-05-31 → significant EOSB gratuity
      legalEntityId: entityId,
      basicWageMonthly: 12_000,
      housingAllowanceMonthly: 2_500,
      baseCurrency: "AED",
      baseCompensation: 174_000,
      iban: "AE070331234567890123491",
    } as any);

    // Issue advance before the settlement — will become the advOffset component.
    const glAdv = await api(fpId, "POST", "/finance/payroll/advances", {
      employeeId: glEmpId, amount: 4_000, installmentAmount: 1_000, startPeriod: "2027-05",
    });
    check("gl-check: advance issued (4 000 AED)", glAdv.status === 201 && glAdv.body?.advance?.outstanding === 4_000, glAdv.body?.advance);

    // noticeDaysServed: 0 with noticeDaysDue: 30 → employee owes 30 days notice → noticePay < 0.
    // No posted run for "2027-05" on this employee → salaryIncluded = true → salaryPart > 0.
    const glStl = await api(fpId, "POST", "/finance/payroll/eosb/settlements", {
      employeeId: glEmpId,
      leaveDate: "2027-05-31",
      reason: "resignation",
      noticeDaysDue: 30,
      noticeDaysServed: 0,
    });
    check("gl-check: settlement -> 201", glStl.status === 201, glStl.body);
    const glSf = glStl.body?.settlement;
    check(
      "gl-check: settlement has all components (finalAmount>0, noticePay<0, advOffset=4000, salary included)",
      !!glSf &&
        glSf.finalAmount > 0 &&
        (glSf.noticePay ?? 0) < 0 &&
        (glSf.advanceOffset ?? 0) === 4_000 &&
        glSf.salaryIncluded === true &&
        glSf.lastSalary > 0,
      { finalAmount: glSf?.finalAmount, noticePay: glSf?.noticePay, advOffset: glSf?.advanceOffset, salary: glSf?.lastSalary, encash: glSf?.leaveEncashment },
    );

    const glSettled = await api(fpId, "POST", `/finance/payroll/eosb/settlements/${glSf?.id}/settle`);
    check("gl-check: settle -> 200 settled", glSettled.status === 200 && glSettled.body?.settlement?.status === "settled", glSettled.body?.settlement?.status);

    if (glSettled.status === 200 && glSf) {
      const glRow = glSettled.body?.settlement;
      const journalId: string | undefined = glRow?.journalEntryId;
      check("gl-check: settled row has journalEntryId", !!journalId, glRow);

      if (journalId) {
        // Read back every GL line for this settlement journal.
        const { atelierGlJournalLine: glLineTable } = D as any;
        const jLines: any[] = await db.select().from(glLineTable).where(dEq(glLineTable.journalEntryId, journalId));

        // Aggregate debit and credit per account code.
        const byCode: Record<string, { debit: number; credit: number }> = {};
        for (const jl of jLines) {
          if (!byCode[jl.accountCode]) byCode[jl.accountCode] = { debit: 0, credit: 0 };
          byCode[jl.accountCode].debit  = Math.round((byCode[jl.accountCode].debit  + (jl.debit  ?? 0)) * 100) / 100;
          byCode[jl.accountCode].credit = Math.round((byCode[jl.accountCode].credit + (jl.credit ?? 0)) * 100) / 100;
        }

        // ── Overall balance ──
        const totDr = Math.round(jLines.reduce((s: number, l: any) => s + (l.debit  ?? 0), 0) * 100) / 100;
        const totCr = Math.round(jLines.reduce((s: number, l: any) => s + (l.credit ?? 0), 0) * 100) / 100;
        check("gl-check: journal lines balance (ΣDebit === ΣCredit)", Math.abs(totDr - totCr) < 0.02, { totDr, totCr, lineCount: jLines.length });

        // Derive expected amounts from the authoritative settled-row figures.
        // postJournal flips negative debits: a line spec { debit: x < 0 } becomes { debit: 0, credit: -x }.
        const provAccrued = Math.round((glRow.provisionAccrued ?? 0) * 100) / 100;
        const truUp       = Math.round(((glRow.finalAmount ?? 0) - provAccrued) * 100) / 100;
        const encash      = Math.round((glRow.leaveEncashment ?? 0) * 100) / 100;
        const noticeAmt   = Math.round((glRow.noticePay ?? 0) * 100) / 100; // < 0 in this fixture
        const salaryPart  = glRow.salaryIncluded ? Math.round((glRow.lastSalary ?? 0) * 100) / 100 : 0;
        const advOff      = Math.round((glRow.advanceOffset ?? 0) * 100) / 100;
        const payable     = Math.round((glRow.finalPayTotal ?? 0) * 100) / 100;

        // ── Account 2500: release of provision ──
        // postJournal skips zero-amount lines, so when provisionAccrued = 0 (this
        // employee has no prior posted runs) there must be NO 2500 line at all.
        if (provAccrued > 0.01) {
          check(
            "gl-check 2500: debit = provisionAccrued",
            !!byCode["2500"] && Math.abs(byCode["2500"].debit - provAccrued) < 0.02,
            { got: byCode["2500"], expected: provAccrued },
          );
        } else {
          check(
            "gl-check 2500: zero provisionAccrued → line absent (postJournal drops zero lines)",
            !byCode["2500"],
            { got: byCode["2500"] },
          );
        }

        // ── Account 6020: gratuity true-up (positive = under-provisioned → debit; negative → credit) ──
        const exp6020Dr = Math.max(0, truUp);
        const exp6020Cr = Math.max(0, -truUp);
        if (exp6020Dr > 0.01 || exp6020Cr > 0.01) {
          check(
            "gl-check 6020: true-up debit/credit matches (finalAmount − provisionAccrued)",
            !!byCode["6020"] &&
              Math.abs(byCode["6020"].debit  - exp6020Dr) < 0.02 &&
              Math.abs(byCode["6020"].credit - exp6020Cr) < 0.02,
            { got: byCode["6020"], exp6020Dr, exp6020Cr, truUp },
          );
        }

        // ── Account 6000 (three lines merged by the aggregation):
        //   Line "encash"  : spec debit=encash    ≥ 0  → stays debit
        //   Line "notice"  : spec debit=noticeAmt < 0  → flips: debit=0, credit=-noticeAmt
        //   Line "salary"  : spec debit=salaryPart≥ 0  → stays debit
        //   ∴ sum(debit) on 6000  = encash + salaryPart
        //     sum(credit) on 6000 = -noticeAmt        (positive because noticeAmt < 0)
        const exp6000Dr = Math.round((encash + salaryPart) * 100) / 100;
        const exp6000Cr = Math.round(-noticeAmt * 100) / 100; // noticeAmt < 0 → this is > 0
        check(
          "gl-check 6000: debit = encashment + final-month salary",
          !!byCode["6000"] && Math.abs(byCode["6000"].debit - exp6000Dr) < 0.02,
          { got: byCode["6000"]?.debit, expected: exp6000Dr, encash, salaryPart },
        );
        check(
          "gl-check 6000: credit = unserved-notice recovery (−noticePay)",
          !!byCode["6000"] && Math.abs(byCode["6000"].credit - exp6000Cr) < 0.02,
          { got: byCode["6000"]?.credit, expected: exp6000Cr, noticeAmt },
        );

        // ── Account 1150: advance asset drawdown (credit only) ──
        check(
          "gl-check 1150: credit = advanceOffset, no debit",
          !!byCode["1150"] &&
            Math.abs(byCode["1150"].credit - advOff) < 0.02 &&
            byCode["1150"].debit === 0,
          { got: byCode["1150"], expected: advOff },
        );

        // ── Account 2100: net payable to employee (credit only) ──
        check(
          "gl-check 2100: credit = finalPayTotal (net payable), no debit",
          !!byCode["2100"] &&
            Math.abs(byCode["2100"].credit - payable) < 0.02 &&
            byCode["2100"].debit === 0,
          { got: byCode["2100"], expected: payable },
        );
      }
    }

    // ════════ Task #1148 — Paused-then-resumed advance across two POSTED periods ════════
    // Sequence:
    //   Period 2027-06 (active)  → installment deducted, run posted  → outstanding drops.
    //   Period 2027-07 (paused)  → NO deduction, run posted           → outstanding unchanged.
    //   Period 2027-08 (resumed) → deduction resumes, run posted      → outstanding drops again.
    //   Final outstanding = (after-A) - (period-C deduction); period B is skipped entirely.
    const prEmpId = `emp_${runTag}_pr`;
    await db.insert(atelierEmployees).values({
      id: prEmpId,
      orgId: "aico",
      fullName: "Probe Pause Resume",
      email: `${runTag}_pr@example.test`,
      role: "consultant",
      nationality: "IN",
      startDate: "2024-06-01",
      legalEntityId: entityId,
      basicWageMonthly: 10_000,
      baseCurrency: "AED",
      baseCompensation: 120_000,
      iban: "AE070331234567890123492",
    } as any);

    const prAdv = await api(fpId, "POST", "/finance/payroll/advances", {
      employeeId: prEmpId, amount: 6_000, installmentAmount: 2_000, startPeriod: "2027-06",
    });
    check("pause-resume: advance issued (6 000 AED, 2 000/mo)", prAdv.status === 201 && prAdv.body?.advance?.outstanding === 6_000, prAdv.body?.advance);
    const prAdvId: string | undefined = prAdv.body?.advance?.id;

    // ── Period A (2027-06): active → deduction applied, then run posted ──
    const runPA = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2027-06" });
    const runPADetail = await api(fpId, "GET", `/finance/payroll/runs/${runPA.body?.run?.id}`);
    const prLineA = (runPADetail.body?.lines ?? []).find((l: any) => l.employeeId === prEmpId);
    const dedA = Math.round((prLineA?.advanceDeduction ?? 0) * 100) / 100;
    check("pause-resume period A: installment scheduled on draft line", dedA > 0, prLineA?.advanceDeduction);
    const postPA = await api(fpId, "POST", `/finance/payroll/runs/${runPA.body?.run?.id}/post`);
    check("pause-resume period A: run posts cleanly", postPA.status === 200, postPA.body);

    const advListA = await api(fpId, "GET", "/finance/payroll/advances");
    const advRowA = (advListA.body?.items ?? []).find((a: any) => a.id === prAdvId);
    const outstandingAfterA = Math.round((advRowA?.outstanding ?? 6_000) * 100) / 100;
    check("pause-resume after period A: outstanding reduced by installment", outstandingAfterA < 6_000 && Math.abs(outstandingAfterA - (6_000 - dedA)) < 0.02, { outstanding: outstandingAfterA, expected: 6_000 - dedA });

    // ── Pause, then Period B (2027-07): paused → NO deduction, run posts ──
    const prPause = await api(fpId, "POST", `/finance/payroll/advances/${prAdvId}/pause`);
    check("pause-resume: pause -> 200 paused", prPause.status === 200 && prPause.body?.advance?.status === "paused", prPause.body?.advance?.status);

    const runPB = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2027-07" });
    const runPBDetail = await api(fpId, "GET", `/finance/payroll/runs/${runPB.body?.run?.id}`);
    const prLineB = (runPBDetail.body?.lines ?? []).find((l: any) => l.employeeId === prEmpId);
    check("pause-resume period B: draft line has zero deduction while paused", !!prLineB && (prLineB.advanceDeduction ?? 0) === 0, prLineB?.advanceDeduction);
    const postPB = await api(fpId, "POST", `/finance/payroll/runs/${runPB.body?.run?.id}/post`);
    check("pause-resume period B: run posts cleanly", postPB.status === 200, postPB.body);

    const advListB = await api(fpId, "GET", "/finance/payroll/advances");
    const advRowB = (advListB.body?.items ?? []).find((a: any) => a.id === prAdvId);
    const outstandingAfterB = Math.round((advRowB?.outstanding ?? -1) * 100) / 100;
    check(
      "pause-resume after period B (paused): outstanding unchanged vs after-A",
      Math.abs(outstandingAfterB - outstandingAfterA) < 0.01,
      { afterA: outstandingAfterA, afterB: outstandingAfterB },
    );

    // ── Resume, then Period C (2027-08): resumed → deduction resumes, run posts ──
    const prResume = await api(fpId, "POST", `/finance/payroll/advances/${prAdvId}/resume`);
    check("pause-resume: resume -> 200 active", prResume.status === 200 && prResume.body?.advance?.status === "active", prResume.body?.advance?.status);

    const runPC = await api(fpId, "POST", "/finance/payroll/runs", { entityId, periodLabel: "2027-08" });
    const runPCDetail = await api(fpId, "GET", `/finance/payroll/runs/${runPC.body?.run?.id}`);
    const prLineC = (runPCDetail.body?.lines ?? []).find((l: any) => l.employeeId === prEmpId);
    const dedC = Math.round((prLineC?.advanceDeduction ?? 0) * 100) / 100;
    check("pause-resume period C: installment scheduled again after resume", dedC > 0, prLineC?.advanceDeduction);
    const postPC = await api(fpId, "POST", `/finance/payroll/runs/${runPC.body?.run?.id}/post`);
    check("pause-resume period C: run posts cleanly", postPC.status === 200, postPC.body);

    const advListC = await api(fpId, "GET", "/finance/payroll/advances");
    const advRowC = (advListC.body?.items ?? []).find((a: any) => a.id === prAdvId);
    const outstandingAfterC = Math.round((advRowC?.outstanding ?? -1) * 100) / 100;
    const expectedFinalOut = Math.round((outstandingAfterA - dedC) * 100) / 100;
    check(
      "pause-resume final outstanding = (after-A) − C_ded (period B entirely skipped)",
      Math.abs(outstandingAfterC - expectedFinalOut) < 0.02 && outstandingAfterC < outstandingAfterA,
      { outstandingAfterA, dedC, expectedFinalOut, outstandingAfterC },
    );
  } finally {
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\napi-probe: ALL PASS" : `\napi-probe: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
