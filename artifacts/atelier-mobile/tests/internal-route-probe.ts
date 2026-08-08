/**
 * Task #794 — regression probe pinning internalRouteFor(): every chat
 * "view result" href that has a mobile surface maps to the right
 * expo-router route; everything else stays null (non-pressable), never
 * throws. Run: pnpm --filter @workspace/atelier-mobile run test:internal-route
 */
import { internalRouteFor } from "../lib/internalRoute";

let failures = 0;
function expectRoute(href: string, route: string | null, label?: string) {
  const got = internalRouteFor(href);
  const ok =
    route === null
      ? got === null
      : got != null && got.route === route && (label == null || got.label === label);
  if (!ok) {
    failures++;
    console.error(
      `FAIL ${JSON.stringify(href)} → expected ${JSON.stringify(route)}${
        label ? ` (${label})` : ""
      }, got ${JSON.stringify(got)}`,
    );
  } else {
    console.log(`ok   ${JSON.stringify(href)} → ${JSON.stringify(got?.route ?? null)}`);
  }
}

// Me destinations
expectRoute("/me", "/(tabs)/me", "View in Me");
expectRoute("/me/profile", "/(tabs)/me");
expectRoute("/me/timesheets", "/(tabs)/me");
expectRoute("/me/leave", "/(tabs)/me");
expectRoute("/me/learning", "/(tabs)/me");
expectRoute("/me/contracts/abc123", "/(tabs)/me");
expectRoute("/me?tab=documents", "/(tabs)/me");

// Calendar / meetings → Meetings tab
expectRoute("/me?tab=calendar", "/(tabs)/meetings", "View calendar");
expectRoute("/me?foo=1&tab=calendar", "/(tabs)/meetings");

// Expenses
expectRoute("/me/expenses", "/(tabs)/expenses", "View expenses");
expectRoute("/wallet/expenses", "/(tabs)/expenses", "View expenses");
expectRoute("/wallet/expenses/new", "/expense/new", "New expense");
expectRoute("/wallet/expenses/exp_42", "/expense/exp_42", "View expense");

// No mobile surface → stays non-pressable
expectRoute("/engagements/e1", null);
expectRoute("/clients/deliver/engagements/e1", null);
expectRoute("/opportunities/o1", null);
expectRoute("/opportunities/o1/win-loss", null);
expectRoute("/accounts/a1?tab=contacts", null);
expectRoute("/documents", null);
expectRoute("/pipeline", null);
expectRoute("/wallet", null);
expectRoute("/wallet/invoices/i1", null);
expectRoute("/contracts/codex", null);
expectRoute("/people/p1", null);
expectRoute("/atelier/firm-profile", null);

// Junk / non-internal input never crashes
expectRoute("", null);
expectRoute("https://example.com/me", null);
expectRoute("me/profile", null);
expectRoute("//me", null);
expectRoute(undefined as unknown as string, null);
expectRoute(123 as unknown as string, null);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\ninternal-route-probe: all assertions passed");
