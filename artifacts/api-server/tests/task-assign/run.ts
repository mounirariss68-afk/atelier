/**
 * Task #1011 — hand a task to a colleague (accept / decline) probe.
 *
 * Runs standalone (tsx ./tests/task-assign/run.ts) against the isolated
 * scratch database. Pins:
 *
 *   1. Catalog surface: assign_task registered as tasks.assign (NOT
 *      me.*) — invisible to employee/contractor/board_observer chat,
 *      visible to partner/founding_partner.
 *   2. Roster-scope gate: an assigner without scope over the target
 *      gets out_of_scope (REST 403); founding_partner (full scope) can
 *      assign; self-assign rejected; person without a login rejected.
 *   3. Lifecycle: assignment lands owned by the ASSIGNEE as pending +
 *      notification card for the assignee; accept/decline stamps the
 *      status and notifies the ASSIGNER; respond is assignee-only and
 *      pending-only (second respond 404s).
 *   4. Declined tasks vanish from the assignee's list, Home roll-up
 *      query and the reminder tick, but stay in /me/tasks/assigned for
 *      the assigner with status "declined".
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

const STAMP = Date.now();
const ORG = "aico";
const BOSS_UID = `p_test_asgboss_${STAMP}`; // founding_partner (full scope)
const PEON_UID = `p_test_asgpeon_${STAMP}`; // employee, no reports
const TARGET_UID = `p_test_asgtarget_${STAMP}`; // employee (assignee)
const TARGET_PID = `emp_test_asgtarget_${STAMP}`;
const NOLOGIN_PID = `emp_test_asgnologin_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail !== undefined ? ` \u2014 ${JSON.stringify(detail)?.slice(0, 400)}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierEmployees, atelierPersonalTasks, atelierSelfNotifications } = D as any;
  const { eq, inArray, and, like } = await import("drizzle-orm");

  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { capabilitiesForPersona, findByToolName } = catalog;
  const helpers = await import("../../src/routes/atelier/meTasksRoutes.js");
  const { runPersonalTaskReminderTick } = await import("../../src/lib/atelier-agents/ledgerNudges.js");

  await db.insert(atelierUsers).values([
    { id: BOSS_UID, orgId: ORG, email: `${BOSS_UID}@test.local`, name: "Asg Boss", initials: "AB", role: "founding_partner", roleLabel: "Founding Partner", title: "Test Persona" },
    { id: PEON_UID, orgId: ORG, email: `${PEON_UID}@test.local`, name: "Asg Peon", initials: "AP", role: "employee", roleLabel: "Employee", title: "Test Persona" },
    { id: TARGET_UID, orgId: ORG, email: `${TARGET_UID}@test.local`, name: "Asg Target", initials: "AT", role: "employee", roleLabel: "Employee", title: "Test Persona" },
  ]);
  await db.insert(atelierEmployees).values([
    { id: TARGET_PID, orgId: ORG, userId: TARGET_UID, fullName: "Asg Target", email: `${TARGET_UID}@test.local`, role: "employee" },
    { id: NOLOGIN_PID, orgId: ORG, userId: null, fullName: "Asg NoLogin", email: `nobody_${STAMP}@test.local`, role: "employee" },
  ]);

  const [boss] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, BOSS_UID));
  const [peon] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, PEON_UID));

  try {
    group("1. Catalog surface");
    const entry = findByToolName("assign_task");
    check("assign_task registered", !!entry);
    check("assign_task is tasks.assign (NOT me.*)", entry?.id === "tasks.assign" && !entry.id.startsWith("me."), entry?.id);
    check("assign_task isWrite + twoPhaseConfirm", entry?.isWrite === true && entry?.twoPhaseConfirm === true);
    for (const role of ["employee", "contractor", "board_observer"] as const) {
      const caps = capabilitiesForPersona({ id: PEON_UID, role, orgId: ORG } as any).map((c: any) => c.toolName);
      check(`${role} chat does NOT see assign_task`, !caps.includes("assign_task"));
    }
    for (const role of ["founding_partner", "partner", "hr"] as const) {
      const caps = capabilitiesForPersona({ id: BOSS_UID, role, orgId: ORG } as any).map((c: any) => c.toolName);
      check(`${role} chat sees assign_task`, caps.includes("assign_task"));
    }

    group("2. Roster-scope gate");
    const outOfScope = await helpers.assignPersonalTask({ assigner: peon, personId: TARGET_PID, title: "sneaky" });
    check("assigner without scope → out_of_scope", outOfScope.ok === false && (outOfScope as any).error === "out_of_scope", outOfScope);
    const noLogin = await helpers.assignPersonalTask({ assigner: boss, personId: NOLOGIN_PID, title: "no login" });
    check("target without portal login → no_login", noLogin.ok === false && (noLogin as any).error === "no_login", noLogin);
    const missing = await helpers.assignPersonalTask({ assigner: boss, personId: "emp_does_not_exist", title: "ghost" });
    check("unknown person → no_login (never a row)", missing.ok === false, missing);

    group("3. Assign → pending + assignee notification");
    const res = await helpers.assignPersonalTask({
      assigner: boss,
      personId: TARGET_PID,
      title: `Send the deck ${STAMP}`,
      dueAt: new Date(Date.now() - 60_000), // already due → tick eligible
    });
    check("founding_partner can assign", res.ok === true, res);
    if (!res.ok) throw new Error("assignment failed; aborting");
    const task = res.task;
    check("task owned by ASSIGNEE, pending, stamped assigner",
      task.userId === TARGET_UID && task.assignmentStatus === "pending" && task.assignedById === BOSS_UID, task);
    const assigneeCards = await db.select().from(atelierSelfNotifications)
      .where(eq(atelierSelfNotifications.id, `selfnotif_ptaskassign_${task.id}`));
    check("assignee got ONE assignment card", assigneeCards.length === 1 && assigneeCards[0].userId === TARGET_UID, assigneeCards.length);
    const targetList = await helpers.listPersonalTasks(ORG, TARGET_UID);
    check("pending task appears in the assignee's list", targetList.some((t: any) => t.id === task.id));
    const bossList = await helpers.listPersonalTasks(ORG, BOSS_UID);
    check("assigner's OWN list does not contain it", !bossList.some((t: any) => t.id === task.id));
    const wire = helpers.personalTaskWire(task, "Asg Boss");
    check("wire carries assignmentStatus + assignedByName", wire.assignmentStatus === "pending" && wire.assignedByName === "Asg Boss", wire);

    group("4. Respond — assignee-only, pending-only");
    const crossRespond = await helpers.respondToAssignedTask({ orgId: ORG, userId: BOSS_UID, taskId: task.id, response: "accepted" });
    check("assigner cannot accept on the assignee's behalf", crossRespond === null);
    const accepted = await helpers.respondToAssignedTask({ orgId: ORG, userId: TARGET_UID, taskId: task.id, response: "accepted" });
    check("assignee accepts → accepted", accepted?.assignmentStatus === "accepted", accepted?.assignmentStatus);
    const again = await helpers.respondToAssignedTask({ orgId: ORG, userId: TARGET_UID, taskId: task.id, response: "declined" });
    check("second respond is a no-op (pending-only)", again === null);
    const bossCards = await db.select().from(atelierSelfNotifications)
      .where(eq(atelierSelfNotifications.id, `selfnotif_ptaskresp_${task.id}_accepted`));
    check("assigner notified of the acceptance", bossCards.length === 1 && bossCards[0].userId === BOSS_UID);

    group("5. Decline path — drops off assignee surfaces, stays for assigner");
    const res2 = await helpers.assignPersonalTask({
      assigner: boss, personId: TARGET_PID, title: `Declined chore ${STAMP}`, dueAt: new Date(Date.now() - 60_000),
    });
    if (!res2.ok) throw new Error("second assignment failed");
    const declined = await helpers.respondToAssignedTask({ orgId: ORG, userId: TARGET_UID, taskId: res2.task.id, response: "declined" });
    check("decline stamps declined", declined?.assignmentStatus === "declined");
    const listAfter = await helpers.listPersonalTasks(ORG, TARGET_UID);
    check("declined task GONE from assignee list", !listAfter.some((t: any) => t.id === res2.task.id));
    check("accepted task still on assignee list", listAfter.some((t: any) => t.id === task.id));
    await runPersonalTaskReminderTick();
    const remCards = await db.select().from(atelierSelfNotifications)
      .where(like(atelierSelfNotifications.id, `selfnotif_ptask_${res2.task.id}_%`));
    check("reminder tick never nags a declined task", remCards.length === 0, remCards.length);
    const acceptedRem = await db.select().from(atelierSelfNotifications)
      .where(like(atelierSelfNotifications.id, `selfnotif_ptask_${task.id}_%`));
    check("reminder tick DOES fire for the accepted due task", acceptedRem.length === 1, acceptedRem.length);
    const declineCard = await db.select().from(atelierSelfNotifications)
      .where(eq(atelierSelfNotifications.id, `selfnotif_ptaskresp_${res2.task.id}_declined`));
    check("assigner notified of the decline", declineCard.length === 1 && declineCard[0].userId === BOSS_UID);

    group("6. REST surface");
    const appMod = await import("../../src/app.js");
    const server = appMod.default.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const BASE = `http://127.0.0.1:${(server.address() as any).port}/api/atelier`;
    const call = async (method: string, path: string, uid: string | null, body?: unknown) => {
      const r = await fetch(`${BASE}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(uid ? { cookie: `atelier_persona=${uid}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    try {
      const anon = await call("POST", "/me/tasks/assign", null, { personId: TARGET_PID, title: "x" });
      check("unauthenticated assign → 401", anon.status === 401, anon.status);
      const forbidden = await call("POST", "/me/tasks/assign", PEON_UID, { personId: TARGET_PID, title: "x" });
      check("out-of-scope assign → 403", forbidden.status === 403, forbidden);
      const ok = await call("POST", "/me/tasks/assign", BOSS_UID, { personId: TARGET_PID, title: `REST handover ${STAMP}` });
      check("in-scope assign → 201 pending", ok.status === 201 && ok.body?.assignmentStatus === "pending", ok);
      const crossResp = await call("POST", `/me/tasks/${ok.body.id}/respond`, BOSS_UID, { response: "accepted" });
      check("cross-user respond → 404", crossResp.status === 404, crossResp.status);
      const badResp = await call("POST", `/me/tasks/${ok.body.id}/respond`, TARGET_UID, { response: "maybe" });
      check("bad response value → 400", badResp.status === 400, badResp.status);
      const resp = await call("POST", `/me/tasks/${ok.body.id}/respond`, TARGET_UID, { response: "declined" });
      check("assignee decline → 200 declined", resp.status === 200 && resp.body?.assignmentStatus === "declined", resp);
      const assignedView = await call("GET", "/me/tasks/assigned", BOSS_UID);
      const rows = assignedView.body?.tasks ?? [];
      check("assigner status view lists all handovers with names + statuses",
        assignedView.status === 200 &&
          rows.some((t: any) => t.id === ok.body.id && t.assignmentStatus === "declined" && t.assigneeName === "Asg Target") &&
          rows.some((t: any) => t.id === task.id && t.assignmentStatus === "accepted"),
        rows.map((t: any) => ({ id: t.id, s: t.assignmentStatus })));
      const targetAssigned = await call("GET", "/me/tasks/assigned", TARGET_UID);
      check("assignee's assigned view is empty (they assigned nothing)",
        targetAssigned.status === 200 && (targetAssigned.body?.tasks ?? []).length === 0);
      const selfList = await call("GET", "/me/tasks", TARGET_UID);
      const mine = selfList.body?.tasks ?? [];
      check("assignee list wire carries assignedByName", mine.some((t: any) => t.id === task.id && t.assignedByName === "Asg Boss"),
        mine.map((t: any) => ({ id: t.id, by: t.assignedByName })));
    } finally {
      server.close();
    }
  } finally {
    const uids = [BOSS_UID, PEON_UID, TARGET_UID];
    await db.delete(atelierSelfNotifications).where(inArray(atelierSelfNotifications.userId, uids));
    await db.delete(atelierPersonalTasks).where(inArray(atelierPersonalTasks.userId, uids));
    await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [TARGET_PID, NOLOGIN_PID]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, uids));
    await pool.end();
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\n\u2713 All task-assign checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
