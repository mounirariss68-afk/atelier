/**
 * Task #77 — team leave-calendar probe.
 *
 * Runs standalone (tsx ./tests/leave-calendar/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass. All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. Employee persona → 403 (approver-surface gate).
 *   2. Bad/missing window → 400.
 *   3. Approver sees approved + pending leave intersecting the window,
 *      with person names; cancelled/rejected rows and non-intersecting
 *      rows are excluded.
 */

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const EMP_ID = `p_test_lcemp_${STAMP}`;
const LEAD_ID = `p_test_lclead_${STAMP}`;
const A_PERSON = `emp_test_lca_${STAMP}`;
const B_PERSON = `emp_test_lcb_${STAMP}`;
const C_PERSON = `emp_test_lcc_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierEmployees, atelierLeaveRequests } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(path: string, personaId: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      headers: { cookie: `atelier_persona=${personaId}` },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  try {
    for (const p of [
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "LC Employee" },
      { id: LEAD_ID, role: "senior_manager", roleLabel: "Senior Manager", name: "LC Lead" },
    ]) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "LC",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    for (const [id, name] of [
      [A_PERSON, "LC Alice"],
      [B_PERSON, "LC Bob"],
      [C_PERSON, "LC Cara"],
    ] as const) {
      await db.insert(atelierEmployees).values({
        id,
        orgId: ORG,
        userId: null,
        fullName: name,
        email: `${id}@cognirise.ai`,
        role: "employee",
        title: "Analyst",
      });
    }
    const mk = (id: string, personId: string, start: string, end: string, status: string) =>
      db.insert(atelierLeaveRequests).values({
        id,
        orgId: ORG,
        personId,
        personType: "employee",
        userId: EMP_ID,
        leaveType: "annual",
        startDate: start,
        endDate: end,
        workingDays: 3,
        status,
      });
    const L1 = `leave_test_lc1_${STAMP}`; // approved, intersects
    const L2 = `leave_test_lc2_${STAMP}`; // pending, intersects
    const L3 = `leave_test_lc3_${STAMP}`; // approved, OUTSIDE window
    const L4 = `leave_test_lc4_${STAMP}`; // rejected, intersects — excluded
    await mk(L1, A_PERSON, "2026-08-03", "2026-08-07", "approved");
    await mk(L2, B_PERSON, "2026-08-06", "2026-08-10", "pending");
    await mk(L3, C_PERSON, "2026-09-01", "2026-09-05", "approved");
    await mk(L4, C_PERSON, "2026-08-04", "2026-08-05", "rejected");

    const gate = await call(`/roster/leave-calendar?start=2026-08-01&end=2026-08-14`, EMP_ID);
    check("employee persona \u2192 403", gate.status === 403, `status=${gate.status}`);

    const bad = await call(`/roster/leave-calendar?start=2026-08-14&end=2026-08-01`, LEAD_ID);
    check("inverted window \u2192 400", bad.status === 400, `status=${bad.status}`);
    const missing = await call(`/roster/leave-calendar`, LEAD_ID);
    check("missing window \u2192 400", missing.status === 400, `status=${missing.status}`);

    const ok = await call(`/roster/leave-calendar?start=2026-08-01&end=2026-08-14`, LEAD_ID);
    check("approver window read \u2192 200", ok.status === 200, `status=${ok.status}`);
    const ids = new Set((ok.body?.entries ?? []).map((e: any) => e.id));
    check("approved intersecting row present", ids.has(L1));
    check("pending intersecting row present", ids.has(L2));
    check("non-intersecting row excluded", !ids.has(L3));
    check("rejected row excluded", !ids.has(L4));
    const e1 = (ok.body?.entries ?? []).find((e: any) => e.id === L1);
    check("entry carries person name", e1?.personName === "LC Alice", `name=${e1?.personName}`);
    check("entry carries status", e1?.status === "approved", `status=${e1?.status}`);
  } finally {
    await db.delete(atelierLeaveRequests).where(like(atelierLeaveRequests.id, `leave_test_lc%_${STAMP}`));
    await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [A_PERSON, B_PERSON, C_PERSON]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [EMP_ID, LEAD_ID]));
    server.close();
    await pool.end();
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log("\n\u2713 leave-calendar probe passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
