/**
 * Task #1017 — device push for non-task self-notifications + per-category
 * opt-outs. Runs standalone (tsx ./tests/push-notif-prefs/run.ts) against
 * the isolated scratch database. Pins:
 *
 *   1. Kind→category mapping (unknown kinds fall to "other", never bypass).
 *   2. emitSelfNotification mirrors newly inserted cards to registered
 *      devices via a LOCAL Expo stub, keyed on the notification id.
 *   3. Per-category opt-out: an expenses opt-out silences expense pushes
 *      but leaves timesheet pushes flowing; the in-app card still lands.
 *   4. /me/preferences GET returns resolved pushCategories; PATCH accepts
 *      partial toggles, rejects unknown categories/non-booleans, keeps
 *      displayCurrency-only patches working.
 *   5. Personal-task reminder tick honors the "tasks" opt-out.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

const STAMP = Date.now();
const ORG = "aico";
const A_UID = `p_test_push17A_${STAMP}`;
const B_UID = `p_test_push17B_${STAMP}`;

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierPushTokens, atelierSelfNotifications, atelierPersonalTasks } = D as any;
  const { eq, like, inArray } = await import("drizzle-orm");

  const push = await import("../../src/lib/expoPush.js");
  const { pushCategoryForKind, resolvePushCategoryPrefs } = push;
  const { emitSelfNotification } = await import("../../src/routes/atelier/meRoutes.js");
  const { runPersonalTaskReminderTick } = await import("../../src/lib/atelier-agents/ledgerNudges.js");
  const helpers = await import("../../src/routes/atelier/meTasksRoutes.js");

  // Local Expo push stub.
  const http = await import("node:http");
  const received: any[] = [];
  const stub = http.createServer((req: any, res: any) => {
    let body = "";
    req.on("data", (c: any) => (body += c));
    req.on("end", () => {
      const msgs = JSON.parse(body);
      received.push(...msgs);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: msgs.map(() => ({ status: "ok" })) }));
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  process.env.EXPO_PUSH_BASE_URL = `http://127.0.0.1:${(stub.address() as any).port}`;

  await db.insert(atelierUsers).values([
    { id: A_UID, orgId: ORG, email: `${A_UID}@test.local`, name: "Push A", initials: "PA", role: "employee", roleLabel: "Employee", title: "Test Persona" },
    { id: B_UID, orgId: ORG, email: `${B_UID}@test.local`, name: "Push B", initials: "PB", role: "employee", roleLabel: "Employee", title: "Test Persona" },
  ]);
  const A_TOKEN = `ExponentPushToken[p17A-${STAMP}]`;
  await db.insert(atelierPushTokens).values([{ token: A_TOKEN, orgId: ORG, userId: A_UID, platform: "ios" }]);

  // Wait until the stub has received >= n messages for A (push is
  // fire-and-forget from emitSelfNotification).
  const mine = () => received.filter((m: any) => m.to === A_TOKEN);
  const waitFor = async (n: number) => {
    for (let i = 0; i < 40 && mine().length < n; i++) await sleep(50);
    return mine().length;
  };

  try {
    group("1. Kind→category mapping");
    check("personal_task_due → tasks", pushCategoryForKind("personal_task_due") === "tasks");
    check("expense_approved → expenses", pushCategoryForKind("expense_approved") === "expenses");
    check("engagement_expense_budget → expenses", pushCategoryForKind("engagement_expense_budget") === "expenses");
    check("timesheet_rejected → timesheets", pushCategoryForKind("timesheet_rejected") === "timesheets");
    check("ea_item_pending → approvals", pushCategoryForKind("ea_item_pending") === "approvals");
    check("leave_approved → approvals", pushCategoryForKind("leave_approved") === "approvals");
    check("bank_change → approvals", pushCategoryForKind("bank_change") === "approvals");
    check("agreement_signed → agreements", pushCategoryForKind("agreement_signed") === "agreements");
    check("contract_signature_requested → agreements", pushCategoryForKind("contract_signature_requested") === "agreements");
    check("unknown kind → other (never bypasses prefs)", pushCategoryForKind(`brand_new_kind_${STAMP}`) === "other");
    check("empty prefs resolve all-enabled", resolvePushCategoryPrefs(null).expenses === true && resolvePushCategoryPrefs({}).tasks === true);
    check("stored opt-out resolves false", resolvePushCategoryPrefs({ expenses: false }).expenses === false);

    group("2. emitSelfNotification mirrors to devices");
    const id1 = await emitSelfNotification({
      orgId: ORG, userId: A_UID, kind: "expense_approved",
      title: `Expense approved ${STAMP}`, body: "Your claim was approved.", href: "/me/expenses",
    });
    const got = await waitFor(1);
    check("expense card pushed to registered device", got === 1, received);
    check("push keyed on the notification id", mine()[0]?.data?.notificationId === id1, mine()[0]?.data);
    check("push carries kind + href", mine()[0]?.data?.kind === "expense_approved" && mine()[0]?.data?.href === "/me/expenses");
    const card = await db.select().from(atelierSelfNotifications).where(eq(atelierSelfNotifications.id, id1));
    check("in-app card inserted too", card.length === 1 && card[0].userId === A_UID);
    // User without tokens: card lands, no push, no crash.
    await emitSelfNotification({ orgId: ORG, userId: B_UID, kind: "expense_approved", title: "No device", body: "" });
    await sleep(200);
    check("tokenless user gets card only (no stray push)", received.every((m: any) => m.to === A_TOKEN));

    group("3. Per-category opt-out");
    await db.update(atelierUsers).set({ pushNotificationPrefs: { expenses: false } }).where(eq(atelierUsers.id, A_UID));
    const before = mine().length;
    await emitSelfNotification({
      orgId: ORG, userId: A_UID, kind: "expense_rejected", title: `Expense rejected ${STAMP}`, body: "x",
    });
    await sleep(400);
    check("opted-out category pushes NOTHING", mine().length === before);
    const rejCards = await db.select().from(atelierSelfNotifications)
      .where(like(atelierSelfNotifications.title, `Expense rejected ${STAMP}`));
    check("in-app card still lands when pushes are off", rejCards.length === 1);
    await emitSelfNotification({
      orgId: ORG, userId: A_UID, kind: "timesheet_approved", title: `Timesheet approved ${STAMP}`, body: "x",
    });
    const afterTs = await waitFor(before + 1);
    check("other categories still push", afterTs === before + 1, { afterTs, before });

    group("4. /me/preferences API");
    const appMod = await import("../../src/app.js");
    const server = appMod.default.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const BASE = `http://127.0.0.1:${(server.address() as any).port}/api/atelier`;
    const call = async (method: string, path: string, uid: string | null, body?: unknown) => {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(uid ? { cookie: `atelier_persona=${uid}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    try {
      const g = await call("GET", "/me/preferences", A_UID);
      check("GET resolves stored opt-out", g.status === 200 && g.body?.pushCategories?.expenses === false && g.body?.pushCategories?.timesheets === true, g.body);
      const p1 = await call("PATCH", "/me/preferences", A_UID, { pushCategories: { expenses: true, approvals: false } });
      check("partial PATCH merges toggles", p1.status === 200 && p1.body?.pushCategories?.expenses === true && p1.body?.pushCategories?.approvals === false, p1.body);
      const g2 = await call("GET", "/me/preferences", A_UID);
      check("merge persisted", g2.body?.pushCategories?.approvals === false && g2.body?.pushCategories?.expenses === true);
      const bad1 = await call("PATCH", "/me/preferences", A_UID, { pushCategories: { bogus: true } });
      check("unknown category rejected 400", bad1.status === 400, bad1);
      const bad2 = await call("PATCH", "/me/preferences", A_UID, { pushCategories: { expenses: "yes" } });
      check("non-boolean rejected 400", bad2.status === 400, bad2);
      const bad3 = await call("PATCH", "/me/preferences", A_UID, {});
      check("empty patch rejected 400", bad3.status === 400, bad3);
      const curOnly = await call("PATCH", "/me/preferences", A_UID, { displayCurrency: "eur" });
      check("displayCurrency-only PATCH still works", curOnly.status === 200 && curOnly.body?.displayCurrency === "EUR", curOnly.body);
      check("currency PATCH doesn't clobber push prefs", curOnly.body?.pushCategories?.approvals === false, curOnly.body);
      const anon = await call("GET", "/me/preferences", null);
      check("unauthenticated → 401", anon.status === 401);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }

    group("5. Reminder tick honors tasks opt-out");
    await db.update(atelierUsers).set({ pushNotificationPrefs: { tasks: false } }).where(eq(atelierUsers.id, A_UID));
    const beforeTick = mine().length;
    await helpers.createPersonalTask({ orgId: ORG, userId: A_UID, title: `Tick optout ${STAMP}`, dueAt: new Date(Date.now() - 60_000) });
    const tick = await runPersonalTaskReminderTick();
    check("tick inserts the card", tick.inserted >= 1, tick);
    check("tick pushes nothing for opted-out user", mine().length === beforeTick && tick.pushed === 0, { tick, got: mine().length - beforeTick });
  } finally {
    delete process.env.EXPO_PUSH_BASE_URL;
    stub.close();
    // Cleanup scratch rows.
    await db.delete(atelierPushTokens).where(eq(atelierPushTokens.userId, A_UID));
    await db.delete(atelierSelfNotifications).where(inArray(atelierSelfNotifications.userId, [A_UID, B_UID]));
    await db.delete(atelierPersonalTasks).where(inArray(atelierPersonalTasks.userId, [A_UID, B_UID]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [A_UID, B_UID]));
    await pool.end();
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll push-notification-prefs checks passed.");
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(1);
});
