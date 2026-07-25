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
