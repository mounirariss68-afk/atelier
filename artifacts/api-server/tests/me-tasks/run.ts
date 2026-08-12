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
 *   5. Device push (Task #1010): due reminders mirror to registered
 *      tokens via a LOCAL Expo stub — new-card-only sends (same dedupe
 *      key as the in-app card), DeviceNotRegistered pruning, self-scope
 *      route denial (401 unauthenticated, cross-user delete is a no-op),
 *      and token re-owning on re-register.
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

    group("5. Device push mirroring (Task #1010)");
    const { atelierPushTokens } = D as any;
    const http = await import("node:http");
    // Local Expo push stub: records messages; flags one token as dead.
    const DEAD_TOKEN = "ExponentPushToken[probe-dead]";
    const received: any[] = [];
    const stub = http.createServer((req: any, res: any) => {
      let body = "";
      req.on("data", (c: any) => (body += c));
      req.on("end", () => {
        const msgs = JSON.parse(body);
        received.push(...msgs);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            data: msgs.map((m: any) =>
              m.to === DEAD_TOKEN
                ? { status: "error", details: { error: "DeviceNotRegistered" } }
                : { status: "ok" },
            ),
          }),
        );
      });
    });
    stub.listen(0);
    await new Promise<void>((r) => stub.once("listening", () => r()));
    process.env.EXPO_PUSH_BASE_URL = `http://127.0.0.1:${(stub.address() as any).port}`;

    const A_TOKEN = "ExponentPushToken[probe-alive]";
    await db.insert(atelierPushTokens).values([
      { token: A_TOKEN, orgId: ORG, userId: A_UID, platform: "ios" },
      { token: DEAD_TOKEN, orgId: ORG, userId: A_UID, platform: "android" },
    ]);

    const pushTask = await helpers.createPersonalTask({
      orgId: ORG, userId: A_UID, title: `Push probe ${STAMP}`, dueAt: new Date(Date.now() - 60_000),
    });
    const tickRes = await runPersonalTaskReminderTick();
    const mine = () => received.filter((m: any) => String(m.to).startsWith("ExponentPushToken[probe-"));
    check("due reminder pushes to BOTH registered tokens", mine().length === 2, mine().map((m: any) => m.to));
    check("push title mirrors the in-app card", mine()[0]?.title === `Reminder: Push probe ${STAMP}`, mine()[0]?.title);
    check("push payload carries the /me/tasks href", mine().every((m: any) => m.data?.href === "/me/tasks"));
    check("tick reports pushed count (dead token excluded)", tickRes.pushed === 1, tickRes);
    const deadLeft = await db.select().from(atelierPushTokens).where(eq(atelierPushTokens.token, DEAD_TOKEN));
    check("DeviceNotRegistered token pruned from the registry", deadLeft.length === 0);

    const before = mine().length;
    await runPersonalTaskReminderTick();
    check("second tick pushes NOTHING (same dedupe key as the card)", mine().length === before);

    // Completing then re-running never pushes again for this task.
    await helpers.updatePersonalTask({ orgId: ORG, userId: A_UID, taskId: pushTask.id, patch: { status: "done" } });
    await runPersonalTaskReminderTick();
    check("no stale push after completion", mine().length === before);

    group("6. /me/push-tokens self-scope (Task #1010)");
    const appMod = await import("../../src/app.js");
    const server = appMod.default.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const BASE = `http://127.0.0.1:${(server.address() as any).port}/api/atelier`;
    const call = async (method: string, path: string, uid: string | null, body?: unknown) => {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(uid ? { cookie: `atelier_persona=${uid}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    try {
      const anon = await call("POST", "/me/push-tokens", null, { token: A_TOKEN, platform: "ios" });
      check("unauthenticated registration → 401", anon.status === 401, anon.status);
      const badTok = await call("POST", "/me/push-tokens", A_UID, { token: "not-a-token" });
      check("malformed token rejected 400", badTok.status === 400, badTok);
      const reg = await call("POST", "/me/push-tokens", A_UID, { token: A_TOKEN, platform: "ios" });
      check("owner registration → 201", reg.status === 201, reg);
      // Cross-user delete is an ownership no-op — A's token survives.
      const crossDel = await call("DELETE", "/me/push-tokens", B_UID, { token: A_TOKEN });
      const stillThere = await db.select().from(atelierPushTokens).where(eq(atelierPushTokens.token, A_TOKEN));
      check("cross-user delete is a no-op (token survives)", crossDel.status === 200 && stillThere.length === 1 && stillThere[0].userId === A_UID);
      // Re-register by B RE-OWNS the token (device switched accounts).
      const reown = await call("POST", "/me/push-tokens", B_UID, { token: A_TOKEN, platform: "ios" });
      const owned = await db.select().from(atelierPushTokens).where(eq(atelierPushTokens.token, A_TOKEN));
      check("re-register re-owns the token to the new user", reown.status === 201 && owned[0]?.userId === B_UID);
      const ownDel = await call("DELETE", "/me/push-tokens", B_UID, { token: A_TOKEN });
      const gone = await db.select().from(atelierPushTokens).where(eq(atelierPushTokens.token, A_TOKEN));
      check("owner delete removes the token", ownDel.status === 200 && gone.length === 0);
    } finally {
      server.close();
      stub.close();
      delete process.env.EXPO_PUSH_BASE_URL;
    }
  } finally {
    const allUsers = [A_UID, B_UID, BOARD_UID];
    await db.delete((D as any).atelierPushTokens).where(inArray((D as any).atelierPushTokens.userId, allUsers));
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
