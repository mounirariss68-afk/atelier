/**
 * Task #759 — Roster quick-add probe.
 *
 * Runs standalone (npx tsx ./tests/roster-quick-add/run.ts) booting the
 * app in-process via app.listen(0); NODE_ENV=test enables the
 * persona-cookie bypass with ephemeral p_test_* personas. Rows cleaned
 * up in `finally`.
 *
 * Coverage (POST /roster/people):
 *   1. HR quick-adds an EMPLOYEE — 201, active status, employee row with
 *      structured person link, appears in GET /roster/people, audit row
 *      roster.person.created with method quick_add.
 *   2. HR quick-adds a CONTRACTOR — 201, contractor row, active.
 *   3. runOnboarding:true — person lands as "onboarding" with an
 *      onboarding sequence row.
 *   4. createLogin:true — portal login provisioned via the shared path:
 *      atelier_users row, user_managed credential, activation token/URL.
 *   5. Manager edge — reports_to row inserted for managerPersonId.
 *   6. Duplicate email → 409; bad worker type → 400; missing name → 400.
 *   7. Employee persona → 403 (never authorized).
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const HR_ID = `p_test_qahr_${STAMP}`;
const EMP_ID = `p_test_qaemp_${STAMP}`;
const MGR_PERSON = `emp_test_qamgr_${STAMP}`;

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
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractors,
    atelierPersons,
    atelierOnboardings,
    atelierRosterReportsTo,
    atelierAuditEvents,
    atelierAuthCredentials,
    atelierLoginActivationTokens,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function post(personaId: string, body: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${API}/roster/people`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${personaId}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  const createdRosterIds: string[] = [];
  try {
    // Personas + a manager employee.
    for (const p of [
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "QA HR" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "QA Employee" },
    ]) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "QA",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    await db.insert(atelierEmployees).values({
      id: MGR_PERSON,
      orgId: ORG,
      fullName: "QA Manager",
      email: `${MGR_PERSON}@cognirise.ai`,
      role: "senior_manager",
      title: "Senior Manager",
      status: "active",
    });

    // ==================================================================
    group("employee quick add \u2014 201 active + audit + list visibility");
    // ==================================================================
    const e1 = await post(HR_ID, {
      workerType: "employee",
      firstName: "Quick",
      lastName: `Addley${STAMP}`,
      email: `qa.addley.${STAMP}@example.com`,
      title: "Consultant",
      country: "AE",
      startDate: "2026-07-01",
      managerPersonId: MGR_PERSON,
    });
    check("201 created", e1.status === 201, `status=${e1.status} ${JSON.stringify(e1.json)}`);
    const empRosterId = e1.json?.id as string;
    if (empRosterId) createdRosterIds.push(empRosterId);
    check("id is emp_* and status active", !!empRosterId?.startsWith("emp_") && e1.json.status === "active");
    check("fullName composed from structured name", e1.json.fullName === `Quick Addley${STAMP}`);
    const [empRow] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, empRosterId ?? "missing"));
    check(
      "employee row active with person link + fields",
      !!empRow && empRow.status === "active" && !!empRow.personId && empRow.country === "AE" && empRow.startDate === "2026-07-01",
      JSON.stringify(empRow ?? null),
    );
    if (empRow?.personId) {
      const [personRow] = await db.select().from(atelierPersons).where(eq(atelierPersons.id, empRow.personId));
      check("structured person row exists (first/last)", personRow?.firstName === "Quick" && personRow?.lastName === `Addley${STAMP}`);
    }
    const [edge] = await db
      .select()
      .from(atelierRosterReportsTo)
      .where(and(eq(atelierRosterReportsTo.personId, empRosterId ?? "missing"), eq(atelierRosterReportsTo.managerPersonId, MGR_PERSON)));
    check("reports_to edge created for manager", !!edge);
    const [auditRow] = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityId, empRosterId ?? "missing"), eq(atelierAuditEvents.action, "roster.person.created")));
    check(
      "audit roster.person.created with method quick_add + actor",
      !!auditRow && (auditRow.payload as any)?.method === "quick_add" && auditRow.actorId === HR_ID,
      JSON.stringify(auditRow?.payload ?? null),
    );
    const listRes = await fetch(`${API}/roster/people?q=Addley${STAMP}`, {
      headers: { cookie: `atelier_persona=${HR_ID}` },
    });
    const listJson = await listRes.json();
    check("new person searchable in GET /roster/people", (listJson.people ?? []).some((p: any) => p.id === empRosterId));
    check("no onboarding + no login by default", e1.json.onboardingId === null && e1.json.login === null);

    // ==================================================================
    group("contractor quick add \u2014 201 active contractor row");
    // ==================================================================
    const c1 = await post(HR_ID, {
      workerType: "contractor",
      firstName: "Quinn",
      lastName: `Contract${STAMP}`,
      email: `qa.contract.${STAMP}@example.com`,
      country: "TR",
      vendorEntity: "QC Consulting FZ-LLC",
    });
    check("201 created", c1.status === 201, `status=${c1.status} ${JSON.stringify(c1.json)}`);
    const ctrRosterId = c1.json?.id as string;
    if (ctrRosterId) createdRosterIds.push(ctrRosterId);
    check("id is ctr_* and status active", !!ctrRosterId?.startsWith("ctr_") && c1.json.status === "active");
    const [ctrRow] = await db.select().from(atelierContractors).where(eq(atelierContractors.id, ctrRosterId ?? "missing"));
    check("contractor row active with vendor + person link", !!ctrRow && ctrRow.status === "active" && !!ctrRow.personId && ctrRow.vendorEntity === "QC Consulting FZ-LLC");

    // ==================================================================
    group("runOnboarding toggle \u2014 onboarding status + sequence row");
    // ==================================================================
    const e2 = await post(HR_ID, {
      workerType: "employee",
      firstName: "Onby",
      lastName: `Boarder${STAMP}`,
      email: `qa.onboard.${STAMP}@example.com`,
      runOnboarding: true,
    });
    check("201 created with onboardingId", e2.status === 201 && typeof e2.json.onboardingId === "string", JSON.stringify(e2.json));
    if (e2.json?.id) createdRosterIds.push(e2.json.id);
    check("status onboarding", e2.json.status === "onboarding");
    const [onbRow] = await db
      .select()
      .from(atelierOnboardings)
      .where(eq(atelierOnboardings.id, e2.json.onboardingId ?? "missing"));
    check("onboarding sequence row exists for person", !!onbRow && onbRow.personId === e2.json.id && onbRow.personType === "employee");

    // ==================================================================
    group("createLogin toggle \u2014 portal login via shared path");
    // ==================================================================
    const loginEmail = `qa.login.${STAMP}@example.com`;
    const e3 = await post(HR_ID, {
      workerType: "contractor",
      firstName: "Loggy",
      lastName: `Innes${STAMP}`,
      email: loginEmail,
      createLogin: true,
    });
    check("201 with login ok:true + activationUrl", e3.status === 201 && e3.json.login?.ok === true && String(e3.json.login?.activationUrl ?? "").includes("/activate?token="), JSON.stringify(e3.json.login ?? null));
    if (e3.json?.id) createdRosterIds.push(e3.json.id);
    const loginUserId = e3.json.login?.userId as string | undefined;
    const [loginUser] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, loginUserId ?? "missing"));
    check("atelier_users row created with contractor role + person link", !!loginUser && loginUser.role === "contractor" && loginUser.personId === e3.json.personId);
    const [cred] = await db.select().from(atelierAuthCredentials).where(eq(atelierAuthCredentials.userId, loginUserId ?? "missing"));
    check("credential row user_managed + must-change joiner", !!cred && cred.userManaged === true && cred.mustChangePassword === true && cred.mustChangeReason === "joiner");
    const [tok] = await db.select().from(atelierLoginActivationTokens).where(eq(atelierLoginActivationTokens.userId, loginUserId ?? "missing"));
    check("activation token row exists (72h)", !!tok && tok.email === loginEmail);

    // ==================================================================
    group("validation \u2014 409 dup email, 400 bad inputs");
    // ==================================================================
    const dup = await post(HR_ID, {
      workerType: "employee",
      firstName: "Dupe",
      lastName: "Person",
      email: `qa.addley.${STAMP}@example.com`,
    });
    check("duplicate roster email 409", dup.status === 409 && dup.json.error === "email-already-on-roster", `status=${dup.status}`);
    const badType = await post(HR_ID, {
      workerType: "partner_firm_resource",
      firstName: "A",
      lastName: "B",
      email: `qa.badtype.${STAMP}@example.com`,
    });
    check("partner_firm_resource rejected 400", badType.status === 400 && badType.json.error === "invalid-worker-type");
    const noName = await post(HR_ID, { workerType: "employee", email: `qa.noname.${STAMP}@example.com` });
    check("missing name 400", noName.status === 400, `status=${noName.status}`);
    const badEmail = await post(HR_ID, { workerType: "employee", firstName: "A", lastName: "B", email: "not-an-email" });
    check("bad email 400", badEmail.status === 400 && badEmail.json.error === "invalid-email");
    const badMgr = await post(HR_ID, {
      workerType: "employee",
      firstName: "A",
      lastName: "B",
      email: `qa.badmgr.${STAMP}@example.com`,
      managerPersonId: "emp_does_not_exist",
    });
    check("unknown manager 400", badMgr.status === 400 && badMgr.json.error === "manager-not-found");

    // ==================================================================
    group("unauthorized persona \u2014 403");
    // ==================================================================
    const forb = await post(EMP_ID, {
      workerType: "employee",
      firstName: "Nope",
      lastName: "Denied",
      email: `qa.denied.${STAMP}@example.com`,
    });
    check("employee persona 403", forb.status === 403, `status=${forb.status} ${JSON.stringify(forb.json)}`);
    const [noDenied] = await db
      .select({ id: atelierEmployees.id })
      .from(atelierEmployees)
      .where(eq(atelierEmployees.email, `qa.denied.${STAMP}@example.com`));
    check("no row created on 403", !noDenied);
  } finally {
    // Cleanup — tracked ids + pattern sweep for anything hook-created.
    try {
      await db.delete(atelierRosterReportsTo).where(like(atelierRosterReportsTo.managerPersonId, `emp_test_qamgr_${STAMP}`));
      for (const id of createdRosterIds) {
        await db.delete(atelierRosterReportsTo).where(eq(atelierRosterReportsTo.personId, id));
        await db.delete(atelierOnboardings).where(eq(atelierOnboardings.personId, id));
        await db.delete(atelierEmployees).where(eq(atelierEmployees.id, id));
        await db.delete(atelierContractors).where(eq(atelierContractors.id, id));
      }
      await db.delete(atelierLoginActivationTokens).where(like(atelierLoginActivationTokens.email, `qa.%.${STAMP}@example.com`));
      await db.delete(atelierAuthCredentials).where(like(atelierAuthCredentials.email, `qa.%.${STAMP}@example.com`));
      await db.delete(atelierUsers).where(like(atelierUsers.email, `qa.%.${STAMP}@example.com`));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_qa%_${STAMP}`));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, MGR_PERSON));
      await db.delete(atelierPersons).where(like(atelierPersons.lastName, `%${STAMP}`));
    } catch (err) {
      console.error("cleanup error (non-fatal):", err);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\n\u2713 roster quick-add probe passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
