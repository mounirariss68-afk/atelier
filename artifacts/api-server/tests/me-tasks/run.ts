/**
 * Task #1002 — personal tasks & reminders: self-scoping probe.
 *
 * Runs standalone (tsx ./tests/me-tasks/run.ts) against the isolated
 * scratch database. Pins:
 *
 *   1. Catalog surface: my_tasks / create_my_task / complete_my_task /
 *      reschedule_my_task registered, me.* module=roster, input schemas
 *      locked (additionalProperties:false, no person selector), and
 *      visible to the self-only personas (employee + contractor) but
 *      not board_observer.
 *   2. Identity lock: hostile inputs ({userId, personId, email} of
 *      ANOTHER user) still only read/write the caller's own rows;
 *      cross-user update/get by id returns null (404 semantics).
 *   3. Time resolution: "5pm" with no date resolves to the NEXT
 *      occurrence of that wall time in the caller's timezone; explicit
 *      date+time round-trips; garbage times fail loudly.
 *   4. Reminder tick: due→ONE unread self-notification (idempotent
 *      across ticks); complete/reschedule/delete clears it; a
 *      rescheduled task re-fires ONCE at the new time.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

const STAMP = Date.now();
const ORG = "aico";
const A_UID = `p_test_ptaskA_${STAMP}`;
const B_UID = `p_test_ptaskB_${STAMP}`;
const BOARD_UID = `p_test_ptaskboard_${STAMP}`;

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
  const { db, pool, atelierUsers, atelierPersonalTasks, atelierSelfNotifications } = D as any;
  const { eq, inArray, like } = await import("drizzle-orm");

  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { capabilitiesForPersona, findByToolName } = catalog;
  const helpers = await import("../../src/routes/atelier/meTasksRoutes.js");
  const { runPersonalTaskReminderTick } = await import("../../src/lib/atelier-agents/ledgerNudges.js");
  const { resolveDueInstant, parseTimeAnswer } = await import(
    "../../src/lib/atelier-cli/me-task-capabilities.js"
  );

  await db.insert(atelierUsers).values([
    { id: A_UID, orgId: ORG, email: `${A_UID}@test.local`, name: "PTask A", initials: "PA", role: "employee", roleLabel: "Employee", title: "Test Persona" },
    { id: B_UID, orgId: ORG, email: `${B_UID}@test.local`, name: "PTask B", initials: "PB", role: "employee", roleLabel: "Employee", title: "Test Persona" },
    { id: BOARD_UID, orgId: ORG, email: `${BOARD_UID}@test.local`, name: "PTask Board", initials: "PO", role: "board_observer", roleLabel: "Board Observer", title: "Test Persona" },
  ]);

  const personaA = { id: A_UID, name: "PTask A", role: "employee", orgId: ORG };
  const personaBoard = { id: BOARD_UID, name: "PTask Board", role: "board_observer", orgId: ORG };
  const runTool = async (toolName: string, persona: any, input: Record<string, unknown> = {}) => {
    const entry = findByToolName(toolName);
    if (!entry) throw new Error(`tool not registered: ${toolName}`);
    return entry.run(input, { persona } as any);
  };

  try {
    group("1. Catalog surface & persona gating");
    const TOOLS = ["my_tasks", "create_my_task", "complete_my_task", "reschedule_my_task"];
    for (const t of TOOLS) {
      const entry = findByToolName(t);
      check(`${t} registered`, !!entry);
      if (!entry) continue;
      check(`${t} is me.* / roster`, entry.id.startsWith("me.") && entry.module === "roster", entry.id);
      const props = Object.keys((entry.inputSchema as any)?.properties ?? {});
      check(
        `${t} schema locked (no person selector)`,
        (entry.inputSchema as any)?.additionalProperties === false &&
          !props.some((p) => ["userId", "personId", "email", "person", "user"].includes(p)),
        props,
      );
    }
    for (const role of ["employee", "contractor"] as const) {
      const caps = capabilitiesForPersona({ id: A_UID, role, orgId: ORG } as any).map((c: any) => c.toolName);
      check(`${role} persona sees all 4 task tools`, TOOLS.every((t) => caps.includes(t)), caps.filter((c: string) => c.includes("task")));
    }
    const boardCaps = capabilitiesForPersona(personaBoard as any).map((c: any) => c.toolName);
    check("board_observer sees NO task tools", TOOLS.every((t) => !boardCaps.includes(t)));

    group("2. Identity lock / self-scoping");
    const taskA = await helpers.createPersonalTask({ orgId: ORG, userId: A_UID, title: `A private task ${STAMP}` });
    const taskB = await helpers.createPersonalTask({ orgId: ORG, userId: B_UID, title: `B secret task ${STAMP}` });
    const listA = await helpers.listPersonalTasks(ORG, A_UID);
    check("list returns only own rows", listA.some((t: any) => t.id === taskA.id) && !listA.some((t: any) => t.id === taskB.id));
    check("cross-user get by id returns null", (await helpers.getOwnPersonalTask(ORG, A_UID, taskB.id)) === null);
    const crossPatch = await helpers.updatePersonalTask({ orgId: ORG, userId: A_UID, taskId: taskB.id, patch: { status: "done" } });
    check("cross-user update returns null and leaves the row untouched", crossPatch === null);
    const bAfter = await helpers.getOwnPersonalTask(ORG, B_UID, taskB.id);
    check("victim row still open", bAfter?.status === "open");

    const hostile = { userId: B_UID, personId: B_UID, email: `${B_UID}@test.local` };
    const toolList = await runTool("my_tasks", personaA, hostile as any);
    check(
      "my_tasks with hostile input returns only caller rows",
      toolList.ok === true &&
        toolList.data.items.some((i: any) => i.id === taskA.id) &&
        !toolList.data.items.some((i: any) => i.id === taskB.id),
      toolList.data?.items?.map((i: any) => i.id),
    );
    const toolComplete = await runTool("complete_my_task", personaA, { taskId: taskB.id });
    const bAfter2 = await helpers.getOwnPersonalTask(ORG, B_UID, taskB.id);
    check(
      "complete_my_task cannot touch another user's task",
      bAfter2?.status === "open" && (toolComplete.ok === false || !!toolComplete.disambiguation || !!toolComplete.data?.options),
      { ok: toolComplete.ok },
    );

    group("3. Time resolution");
    check("parseTimeAnswer '5pm' → 17:00", parseTimeAnswer("5pm") === "17:00");
    check("parseTimeAnswer '5:30 pm' → 17:30", parseTimeAnswer("5:30 pm") === "17:30");
    check("parseTimeAnswer '09:15' → 09:15", parseTimeAnswer("09:15") === "09:15");
    check("parseTimeAnswer rejects garbage", parseTimeAnswer("teatime") === null);
    const tz = "Asia/Dubai";
    const nowRef = new Date();
    const bare = resolveDueInstant({ dueTime: "5pm", tz }, { timezone: tz } as any, nowRef);
    check(
      "bare '5pm' resolves to a FUTURE instant (next occurrence)",
      !("error" in bare) && !!bare.dueAt && bare.dueAt.getTime() > nowRef.getTime() - 60_000,
      bare,
    );
    const dated = resolveDueInstant({ dueDate: "2027-03-02", dueTime: "17:00", tz }, { timezone: tz } as any);
    check(
      "explicit date+time resolves in the caller's zone (Dubai 17:00 = 13:00Z)",
      !("error" in dated) && dated.dueAt?.toISOString() === "2027-03-02T13:00:00.000Z",
      dated,
    );
    const bad = resolveDueInstant({ dueDate: "soonish" }, { timezone: tz } as any);
    check("garbage date fails loudly", "error" in bad);
    const undated = resolveDueInstant({}, { timezone: tz } as any);
    check("no due info → null dueAt (undated to-do allowed)", !("error" in undated) && undated.dueAt === null);

    group("4. Reminder tick + clearing");
    const past = new Date(Date.now() - 5 * 60_000);
    const remTask = await helpers.createPersonalTask({ orgId: ORG, userId: A_UID, title: `Remind probe ${STAMP}`, dueAt: past });
    await runPersonalTaskReminderTick();
    await runPersonalTaskReminderTick();
    const notifSel = () =>
      db.select().from(atelierSelfNotifications).where(like(atelierSelfNotifications.id, `selfnotif_ptask_${remTask.id}_%`));
    let notifs = await notifSel();
    check("due task → exactly ONE unread notification across two ticks", notifs.length === 1 && notifs[0].status === "unread", notifs.length);

    // Reschedule clears the old card; a new one fires at the new due time.
    const past2 = new Date(Date.now() - 60_000);
    await helpers.updatePersonalTask({ orgId: ORG, userId: A_UID, taskId: remTask.id, patch: { dueAt: past2, dueAtSet: true } });
    notifs = await notifSel();
    check("reschedule dismisses the old reminder card", notifs.every((n: any) => n.status === "dismissed"), notifs.map((n: any) => n.status));
    await runPersonalTaskReminderTick();
    notifs = await notifSel();
    check(
      "rescheduled-and-due task re-fires exactly one fresh card",
      notifs.filter((n: any) => n.status === "unread").length === 1,
      notifs.map((n: any) => ({ id: n.id, status: n.status })),
    );
    await helpers.updatePersonalTask({ orgId: ORG, userId: A_UID, taskId: remTask.id, patch: { status: "done" } });
    notifs = await notifSel();
    check("completion dismisses all reminder cards", notifs.every((n: any) => n.status === "dismissed"));
    const doneRow = await helpers.getOwnPersonalTask(ORG, A_UID, remTask.id);
    check("completed task stamped completedAt", doneRow?.status === "done" && !!doneRow?.completedAt);
  } finally {
    const allUsers = [A_UID, B_UID, BOARD_UID];
    await db.delete(atelierSelfNotifications).where(inArray(atelierSelfNotifications.userId, allUsers));
    await db.delete(atelierPersonalTasks).where(inArray(atelierPersonalTasks.userId, allUsers));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, allUsers));
    await pool.end();
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\n\u2713 All personal-task checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
