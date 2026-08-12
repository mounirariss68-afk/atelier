// Task #1035 — probe: the phone-alerts toggle must never surface the raw
// `No "projectId" found…` error. Expo Go / missing-project-id environments
// degrade to device-local reminders ("local-only"); real builds with a
// project id register the token remotely.
//
// Run:
//   npx tsx --tsconfig tests/tsconfig.push-probe.json tests/push-fallback-probe.ts
// (the probe tsconfig maps expo/react-native modules to tests/mocks/*)
import { state as constantsState } from "./mocks/expo-constants";
import { state as notifState } from "./mocks/expo-notifications";
import { store } from "./mocks/async-storage";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const main = async () => {
  const push = await import("../lib/pushNotifications");
  const { syncTaskLocalReminders } = await import("../lib/taskLocalReminders");

  // --- Scenario 1: Expo Go (appOwnership="expo") ---------------------------
  constantsState.appOwnership = "expo";
  const r1 = await push.enableTaskPush();
  check("expo-go → local-only (no raw projectId error)", r1 === "local-only", `got ${r1}`);
  check("expo-go → pref persisted on", store.get("atelier.taskPush.enabled") === "1");
  check("expo-go → mode=local", store.get("atelier.taskPush.mode") === "local");

  // --- Scenario 2: real build but no EAS project id ------------------------
  store.clear();
  constantsState.appOwnership = null;
  constantsState.executionEnvironment = "standalone";
  constantsState.extra = {};
  constantsState.easConfig = undefined;
  const r2 = await push.enableTaskPush();
  check("no project id → local-only", r2 === "local-only", `got ${r2}`);
  check("no project id → reason reported", push.remotePushUnavailableReason() === "no-project-id");

  // --- Scenario 3: project id present but token call still throws ----------
  store.clear();
  constantsState.extra = { eas: { projectId: "11111111-2222-3333-4444-555555555555" } };
  // notifState.tokenImpl still throws the raw projectId error by default.
  const r3 = await push.enableTaskPush();
  check("token throws projectId error → local-only (defensive)", r3 === "local-only", `got ${r3}`);

  // --- Scenario 4: healthy real build → remote registration -----------------
  store.clear();
  notifState.tokenImpl = () => ({ data: "ExponentPushToken[probe]" });
  let posted: unknown = null;
  (globalThis as { fetch?: unknown }).fetch = async (_url: string, init?: { body?: string }) => {
    posted = init?.body ? JSON.parse(init.body) : null;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const r4 = await push.enableTaskPush();
  check("healthy build → granted", r4 === "granted", `got ${r4}`);
  check("healthy build → token registered", (posted as { token?: string } | null)?.token === "ExponentPushToken[probe]");
  check("healthy build → mode=remote", store.get("atelier.taskPush.mode") === "remote");

  // --- Scenario 5: local reminder sync schedules only open, future-due -----
  // Enter local mode through the real API (module caches pref+mode in memory).
  constantsState.appOwnership = "expo";
  const r5 = await push.enableTaskPush();
  check("re-enable in expo-go → local-only", r5 === "local-only", `got ${r5}`);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  notifState.scheduled = [];
  await syncTaskLocalReminders([
    { id: "t1", title: "Call Dr. Hassan", status: "open", dueAt: future },
    { id: "t2", title: "Done already", status: "done", dueAt: future },
    { id: "t3", title: "Past due", status: "open", dueAt: past },
    { id: "t4", title: "No due date", status: "open", dueAt: null },
  ]);
  check("local sync → schedules exactly the open future-due task", notifState.scheduled.length === 1, `got ${notifState.scheduled.length}`);
  check("local sync → id carries prefix", String(notifState.scheduled[0]?.identifier ?? "").startsWith("taskloc_t1_"));

  // Re-sync after completion cancels the stale reminder.
  await syncTaskLocalReminders([{ id: "t1", title: "Call Dr. Hassan", status: "done", dueAt: future }]);
  check("local sync → completing the task cancels its reminder", notifState.scheduled.length === 0, `got ${notifState.scheduled.length}`);

  // --- Scenario 5b: successful remote enable clears leftover local schedules
  constantsState.appOwnership = null;
  constantsState.executionEnvironment = "standalone";
  constantsState.extra = { eas: { projectId: "11111111-2222-3333-4444-555555555555" } };
  notifState.tokenImpl = () => ({ data: "ExponentPushToken[probe2]" });
  notifState.scheduled = [{ identifier: "taskloc_t9_123", content: {}, trigger: {} }];
  const r5b = await push.enableTaskPush();
  check("remote enable after local mode → granted", r5b === "granted", `got ${r5b}`);
  check(
    "remote enable → leftover local reminders cancelled (no double alerts)",
    notifState.scheduled.length === 0,
    `got ${notifState.scheduled.length}`,
  );

  // --- Scenario 6: disable in Expo Go never throws --------------------------
  constantsState.appOwnership = "expo";
  notifState.tokenImpl = () => {
    throw new Error("should not be called in Expo Go");
  };
  await push.disableTaskPush();
  check("disable in expo-go → no throw, pref off", store.get("atelier.taskPush.enabled") === "0");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
};

void main();
