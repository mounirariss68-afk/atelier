/** Task #602 probe — away-today gate, holidays, revoke/shorten (self-cleaning). */
process.env.NODE_ENV = "test";
const STAMP = Date.now();
const PARTNER_ID = `p_test_602p_${STAMP}`;
const PARTNER2_ID = `p_test_602q_${STAMP}`;
const EMP_ID = `p_test_602e_${STAMP}`;

async function main() {
  const appMod = await import("../src/app.js");
  const app: any = (appMod as any).default ?? (appMod as any).app;
  const D: any = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierEmployees, atelierLeaveRequests } = D;
  const { like, inArray } = await import("drizzle-orm");
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const pHdrs = { cookie: `atelier_persona=${PARTNER_ID}`, "content-type": "application/json" };
  const eHdrs = { cookie: `atelier_persona=${EMP_ID}`, "content-type": "application/json" };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra));
  };
  const empRowId = `emp_test_602_${STAMP}`;
  const p2RowId = `emp_test_602p2_${STAMP}`;
  const lrToday = `lr_test_602a_${STAMP}`;
  const lrShorten = `lr_test_602b_${STAMP}`;
  const lrEmp = `lr_test_602c_${STAMP}`;
  const today = new Date().toISOString().slice(0, 10);
  const plus = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  try {
    await db.insert(atelierUsers).values([
      { id: PARTNER_ID, orgId: "aico", email: `${PARTNER_ID}@cognirise.ai`, name: "T602 Partner", initials: "TP", role: "partner", roleLabel: "Partner", title: "Partner", permissions: [], bdActive: false },
      { id: PARTNER2_ID, orgId: "aico", email: `${PARTNER2_ID}@cognirise.ai`, name: "T602 Partner Two", initials: "PT", role: "partner", roleLabel: "Partner", title: "Partner", permissions: [], bdActive: false },
      { id: EMP_ID, orgId: "aico", email: `${EMP_ID}@cognirise.ai`, name: "T602 Emp", initials: "TE", role: "employee", roleLabel: "Employee", title: "Analyst", permissions: [], bdActive: false },
    ]);
    await db.insert(atelierEmployees).values([
      { id: empRowId, orgId: "aico", userId: EMP_ID, fullName: "T602 Emp", email: `${EMP_ID}@cognirise.ai`, role: "employee", title: "Analyst" },
      { id: p2RowId, orgId: "aico", userId: PARTNER2_ID, fullName: "T602 Partner Two", email: `${PARTNER2_ID}@cognirise.ai`, role: "employee", title: "Partner", country: "Türkiye" },
    ]);
    await db.insert(atelierLeaveRequests).values([
      // Away strip shows PARTNER leave-takers only.
      { id: lrToday, orgId: "aico", userId: PARTNER2_ID, personId: p2RowId, personType: "employee", leaveType: "annual", startDate: today, endDate: plus(2), workingDays: 2, status: "approved" },
      { id: lrShorten, orgId: "aico", userId: PARTNER2_ID, personId: p2RowId, personType: "employee", leaveType: "annual", startDate: plus(5), endDate: plus(10), workingDays: 4, status: "approved" },
      // Employee leave overlapping today must NOT appear in the strip.
      { id: lrEmp, orgId: "aico", userId: EMP_ID, personId: empRowId, personType: "employee", leaveType: "annual", startDate: today, endDate: plus(2), workingDays: 2, status: "approved" },
    ]);

    // 1. on-leave-today: partner sees the partner away entry with initials + returnDate
    let r = await fetch(`${base}/roster/on-leave-today`, { headers: pHdrs });
    let j: any = await r.json();
    const mine = (j.away ?? []).filter((a: any) => a.personId === p2RowId);
    check("partner sees partner away-today entry", r.status === 200 && mine.length === 1, { s: r.status, j });
    check(
      "away entry carries initials + returnDate > endDate",
      mine[0]?.initials === "TP" && typeof mine[0]?.returnDate === "string" && mine[0].returnDate > mine[0].endDate,
      { entry: mine[0] },
    );
    check("employee leave excluded from away strip", !(j.away ?? []).some((a: any) => a.personId === empRowId), { j });

    // 1b. ?date= drives the window (future leave visible on its start day, not before)
    r = await fetch(`${base}/roster/on-leave-today?date=${plus(5)}`, { headers: pHdrs });
    j = await r.json();
    check("date param returns future leave", r.status === 200 && j.date === plus(5) && (j.away ?? []).some((a: any) => a.personId === p2RowId && a.startDate === plus(5)), { s: r.status, j });
    r = await fetch(`${base}/roster/on-leave-today?date=${plus(3)}`, { headers: pHdrs });
    j = await r.json();
    check("date param excludes non-overlapping leave", r.status === 200 && (j.away ?? []).every((a: any) => a.personId !== p2RowId || a.startDate === today), { j });

    // 2. on-leave-today: employee is 403
    r = await fetch(`${base}/roster/on-leave-today`, { headers: eHdrs });
    check("employee 403 on away-today", r.status === 403, { s: r.status });

    // 3. /me/holidays returns holidays in a known window (TR Republic Day)
    r = await fetch(`${base}/me/holidays?start=2026-10-28&end=2026-10-30`, { headers: eHdrs });
    j = await r.json();
    check("holidays window returns TR Oct 29", r.status === 200 && (j.holidays ?? []).some((h: any) => h.country === "TR" && h.date === "2026-10-29"), { s: r.status, j });

    // 4. shorten approved leave via revoke {newEndDate}
    r = await fetch(`${base}/roster/leave-requests/${lrShorten}/revoke`, { method: "POST", headers: pHdrs, body: JSON.stringify({ newEndDate: plus(7) }) });
    j = await r.json();
    check("shorten approved leave 200", r.status === 200, { s: r.status, j });
    const [row] = await db.select().from(atelierLeaveRequests).where(like(atelierLeaveRequests.id, lrShorten));
    check("shortened endDate persisted", row?.endDate === plus(7) && row?.status === "approved", { row: { end: row?.endDate, status: row?.status } });

    // 5. full revoke
    r = await fetch(`${base}/roster/leave-requests/${lrToday}/revoke`, { method: "POST", headers: pHdrs, body: JSON.stringify({}) });
    j = await r.json();
    check("full revoke 200", r.status === 200, { s: r.status, j });
    const [row2] = await db.select().from(atelierLeaveRequests).where(like(atelierLeaveRequests.id, lrToday));
    check("revoked status persisted", row2?.status === "cancelled" || row2?.status === "revoked", { status: row2?.status });

    // 6. revoke again -> 409 not-approved
    r = await fetch(`${base}/roster/leave-requests/${lrToday}/revoke`, { method: "POST", headers: pHdrs, body: JSON.stringify({}) });
    check("second revoke 409", r.status === 409, { s: r.status });

    // 7. revoked leave no longer in away-today
    r = await fetch(`${base}/roster/on-leave-today`, { headers: pHdrs });
    j = await r.json();
    check("revoked leave gone from away-today", r.status === 200 && !(j.away ?? []).some((a: any) => a.personId === p2RowId), { j });
  } finally {
    await db.delete(atelierLeaveRequests).where(inArray(atelierLeaveRequests.id, [lrToday, lrShorten, lrEmp]));
    await db.delete(atelierEmployees).where(like(atelierEmployees.id, `emp_test_602_%`));
    await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_602%`));
    server.close();
    await pool.end();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
void main();
