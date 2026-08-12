/**
 * Task #1015 — pure probe for lib/pushRoute.ts (no expo imports).
 *
 *   1. Reminder href /me/tasks (and other Me-scoped hrefs) → Me tab.
 *   2. Unknown / non-string / non-path hrefs stay null (tap just foregrounds).
 *   3. Response extraction reads data.href defensively.
 *   4. Warm-app tap: stash + consume with auth ready navigates immediately.
 *   5. Cold start before auth: stash held while canNavigate=false, consumed
 *      exactly once when auth becomes ready.
 *
 * Run: pnpm --filter @workspace/atelier-mobile run test:push-route
 */
import {
  routeForNotificationResponse,
  routeForPushHref,
  stashPushRoute,
  takePushRoute,
} from "../lib/pushRoute";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// 1–2. href mapping
check("/me/tasks → me tab", routeForPushHref("/me/tasks") === "/(tabs)/me");
check("/me → me tab", routeForPushHref("/me") === "/(tabs)/me");
check("/me?tab=tasks → me tab", routeForPushHref("/me?tab=tasks") === "/(tabs)/me");
check("/me/expenses → me tab", routeForPushHref("/me/expenses") === "/(tabs)/me");
check("/meetings NOT me-prefixed", routeForPushHref("/meetings") === null);
check("unknown href → null", routeForPushHref("/engagements/e1/economics") === null);
check("non-path → null", routeForPushHref("me/tasks") === null);
check("non-string → null", routeForPushHref(42) === null);
check("null href → null", routeForPushHref(null) === null);

// 3. response extraction
const resp = (data: unknown) => ({ notification: { request: { content: { data } } } });
check(
  "response with href navigates",
  routeForNotificationResponse(resp({ href: "/me/tasks", kind: "personal_task_due" })) ===
    "/(tabs)/me",
);
check("response without data → null", routeForNotificationResponse(resp(undefined)) === null);
check("null response → null", routeForNotificationResponse(null) === null);
check("missing href → null", routeForNotificationResponse(resp({ kind: "x" })) === null);

// 4. warm-app tap — auth already ready
stashPushRoute("/(tabs)/me");
check("warm tap consumes immediately", takePushRoute(true) === "/(tabs)/me");
check("stash cleared after consume", takePushRoute(true) === null);

// 5. cold start — response arrives before auth is ready
stashPushRoute("/(tabs)/me");
check("held while auth not ready", takePushRoute(false) === null);
check("still stashed", takePushRoute(true) === "/(tabs)/me");
check("consumed exactly once", takePushRoute(true) === null);

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("push-route probe: all checks passed");
