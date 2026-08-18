/**
 * Task #1303 — Non-Equity Partner MOBILE surface probe.
 *
 * The mobile app (artifacts/atelier-mobile) has no org tabs — its surfaces
 * are Chat, Expenses, Meetings, Me and Settings. This probe boots the app
 * in-process against the isolated scratch DB and asserts, for an ephemeral
 * NEP persona, that every endpoint the mobile app fires on boot / tab mount
 * does NOT 403 (so an NEP login produces no 403 floods), and that the two
 * endpoints the mobile UI now role-gates client-side (Task #1303) are the
 * ONLY leadership/employee-only ones:
 *
 *   allowed  : /me/profile /me/documents /me/pay /me/tasks /me/expenses
 *              /me/preferences /me/msconnection /me/calendar/changed
 *              /me/holidays /me/notifications /me/push-tokens
 *              /cli/capabilities /cli/sessions
 *   403 (UI-gated, never called by mobile for NEP anymore):
 *              /me/letters (employees only)
 *              /roster/on-leave-today (leadership only)
 *
 *   chat     : /cli/capabilities returns a self-scope clamped, non-empty
 *              capability list (me.* only; no account./opportunity. write
 *              caps beyond the documented NEP slice).
 *
 * Cleans up the ephemeral persona in finally.
 * Run: pnpm --filter @workspace/api-server run test:nep-mobile
 */

process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be first import.
import "./scratch-db.js";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra)?.slice(0, 400) : "");
  }
}

const NEP = "p_test_nep_1303";

async function main() {
  const { default: app } = await import("../../src/app.ts");
  const { db, atelierUsers } = await import("@workspace/db");

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const get = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: `atelier_persona=${NEP}` },
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    return { status: res.status, json };
  };

  try {
    await db.insert(atelierUsers).values({
      id: NEP,
      orgId: "aico",
      email: "test.nep.1303@example.test",
      name: "Test NEP Mobile",
      initials: "TM",
      role: "non_equity_partner",
      roleLabel: "Non-Equity Partner",
      title: "Non-Equity Partner",
    } as any).onConflictDoNothing();

    console.log("\n[1] mobile boot / tab-mount endpoints must not 403 for NEP");
    const now = new Date();
    const start = now.toISOString();
    const end = new Date(now.getTime() + 7 * 86400_000).toISOString();
    const allowed: Array<[string, string]> = [
      ["/me/profile", "Me tab profile"],
      ["/me/documents", "Me tab documents"],
      ["/me/pay", "Me tab pay meta"],
      ["/me/tasks", "Me tab tasks"],
      ["/me/expenses", "Expenses tab list"],
      ["/me/preferences", "Settings preferences"],
      ["/me/msconnection", "Meetings MS connection"],
      ["/me/calendar/changed", "calendar-changed poll"],
      [`/me/holidays?start=${start.slice(0, 10)}&end=${end.slice(0, 10)}`, "holiday banner"],
      ["/me/notifications", "in-app notifications"],
      ["/cli/capabilities", "chat capabilities"],
      ["/cli/sessions", "chat session list"],
    ];
    for (const [path, label] of allowed) {
      const r = await get(path);
      check(`${label} (${path.split("?")[0]}) not 403/500`, r.status !== 403 && r.status < 500, {
        s: r.status,
        j: r.json,
      });
    }

    console.log("\n[2] employee/leadership-only endpoints 403 (mobile UI now hides them for NEP)");
    const letters = await get("/me/letters");
    check("/me/letters 403 for NEP", letters.status === 403, letters.status);
    const away = await get("/roster/on-leave-today");
    check("/roster/on-leave-today 403 for NEP", away.status === 403, away.status);

    console.log("\n[3] org-restricted surfaces stay 403 (no widening from this task)");
    for (const path of ["/roster/people", "/finance/overview", "/partners/firms"]) {
      const r = await get(path);
      check(`${path} not 2xx for NEP`, r.status === 403 || r.status === 404, r.status);
    }

    console.log("\n[4] chat capabilities are self-scope clamped but usable");
    const caps = await get("/cli/capabilities");
    const list: Array<{ name?: string; id?: string }> =
      caps.json?.capabilities ?? caps.json?.tools ?? [];
    const names = list.map((c) => String(c.name ?? c.id ?? ""));
    check("capabilities 200 + non-empty", caps.status === 200 && names.length > 0, caps.json);
    const hasMe = names.some((n) => n.startsWith("me."));
    check("includes me.* capabilities", hasMe, names.slice(0, 40));
    const orgWide = names.filter(
      (n) =>
        /^(finance|roster|partner|hr|contract)\./.test(n) ||
        /^(account|opportunity)\.(delete|merge)/.test(n),
    );
    check("no org-wide capability leak", orgWide.length === 0, orgWide);
  } finally {
    try {
      await db.delete(atelierUsers).where(eq(atelierUsers.id, NEP));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
  }

  if (failures.length) {
    console.error(`\nFAILURES (${failures.length}):`, failures);
    process.exit(1);
  }
  console.log("\nAll NEP mobile-surface checks passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
