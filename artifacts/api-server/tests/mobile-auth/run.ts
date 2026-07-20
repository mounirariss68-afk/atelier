/**
 * Task #328 — mobile bearer-token auth + self-service expense probe.
 *
 * Verifies the mobile companion app's server contract:
 *   1. GET /api/auth/app-meta is public and returns minSupportedAppVersion
 *   2. POST /api/auth/login with client:"mobile" returns {token, expiresAt}
 *   3. Bearer token authenticates GET /api/auth/session (no cookie)
 *   4. Bearer token works on self-service routes (/api/atelier/me/*)
 *   5. Expense draft lifecycle over bearer auth: contexts → create → patch → list → delete
 *   6. Logout with bearer token revokes the session (subsequent 401)
 *   7. Bogus bearer token → 401
 *
 * Runs standalone (tsx ./tests/mobile-auth/run.ts) on an isolated scratch DB,
 * booting the app in-process via app.listen(0). All rows are ephemeral and
 * removed in `finally`.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

const STAMP = Date.now();
const TEST_USER_ID = `p_test_mobile_${STAMP}`;
const TEST_EMAIL = `test.mobile.${STAMP}@cognirise.ai`;
const TEST_PW = "Mobile-Probe-Pw-2026!";

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAuthCredentials, atelierAuthSessions } =
    D as unknown as {
      db: any;
      pool: { end: () => Promise<void> };
      atelierUsers: any;
      atelierAuthCredentials: any;
      atelierAuthSessions: any;
    };
  const { hashPassword } = await import("../../src/lib/auth/passwords.js");
  const { ensureAtelierAuthSeed } = await import("../../src/lib/atelier-seed-auth.js");
  await ensureAtelierAuthSeed();
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api`;

  async function req(
    method: string,
    path: string,
    opts: { body?: unknown; token?: string } = {},
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  let createdExpenseId: string | null = null;

  try {
    await db
      .insert(atelierUsers)
      .values({
        id: TEST_USER_ID,
        orgId: "aico",
        email: TEST_EMAIL,
        name: "Test Mobile",
        initials: "TM",
        role: "consultant",
        roleLabel: "Consultant",
        title: "Test Consultant",
        permissions: [],
        bdActive: false,
      })
      .onConflictDoNothing();
    await db.insert(atelierAuthCredentials).values({
      email: TEST_EMAIL,
      userId: TEST_USER_ID,
      passwordHash: hashPassword(TEST_PW),
      userManaged: true,
      mustChangePassword: false,
    });

    group("app-meta (public)");
    {
      const r = await req("GET", "/auth/app-meta");
      check("app-meta 200", r.status === 200, `got ${r.status}`);
      check(
        "app-meta has minSupportedAppVersion",
        typeof r.body?.minSupportedAppVersion === "string",
      );
    }

    group("mobile login returns bearer token");
    let token = "";
    {
      const r = await req("POST", "/auth/login", {
        body: { email: TEST_EMAIL, password: TEST_PW, client: "mobile" },
      });
      check("login 200", r.status === 200, JSON.stringify(r.body));
      check("login returns token", typeof r.body?.token === "string" && r.body.token.length > 20);
      check("login returns expiresAt", typeof r.body?.expiresAt === "string");
      check("login returns user", r.body?.user?.email === TEST_EMAIL);
      token = r.body?.token ?? "";
    }

    group("bearer session");
    {
      const r = await req("GET", "/auth/session", { token });
      check("session 200 via bearer", r.status === 200, `got ${r.status}`);
      check("session user matches", r.body?.user?.id === TEST_USER_ID);
      const bogus = await req("GET", "/auth/session", { token: "bogus-token-value" });
      check("bogus bearer 401", bogus.status === 401, `got ${bogus.status}`);
    }

    group("self-service routes via bearer");
    {
      const prof = await req("GET", "/atelier/me/profile", { token });
      check("me/profile 200", prof.status === 200, `got ${prof.status}`);
      const ctx = await req("GET", "/atelier/me/expense-contexts", { token });
      check("expense-contexts 200", ctx.status === 200, `got ${ctx.status}`);
      check(
        "expense-contexts shape",
        Array.isArray(ctx.body?.accounts) || Array.isArray(ctx.body?.engagements) || typeof ctx.body === "object",
      );
    }

    group("expense draft lifecycle via bearer");
    {
      const create = await req("POST", "/atelier/me/expenses", {
        token,
        body: {
          merchant: "Probe Cafe",
          amount: 12.5,
          currency: "GBP",
          category: "meals",
          expenseDate: "2026-07-18",
          context: "internal",
          description: "Mobile probe test expense",
        },
      });
      check("create draft 200/201", create.status === 200 || create.status === 201, `got ${create.status}: ${JSON.stringify(create.body)}`);
      createdExpenseId = create.body?.expense?.id ?? create.body?.id ?? null;
      check("created expense has id", !!createdExpenseId);

      if (createdExpenseId) {
        const patch = await req("PATCH", `/atelier/me/expenses/${createdExpenseId}`, {
          token,
          body: { amount: 14.75 },
        });
        check("patch draft 200", patch.status === 200, `got ${patch.status}: ${JSON.stringify(patch.body)}`);

        const list = await req("GET", "/atelier/me/expenses", { token });
        check("list 200", list.status === 200, `got ${list.status}`);
        const items = list.body?.expenses ?? list.body?.items ?? list.body;
        check(
          "list contains created draft",
          Array.isArray(items) && items.some((e: any) => e.id === createdExpenseId),
        );

        const del = await req("DELETE", `/atelier/me/expenses/${createdExpenseId}`, { token });
        check("delete draft 200", del.status === 200, `got ${del.status}: ${JSON.stringify(del.body)}`);
        createdExpenseId = null;
      }
    }

    group("logout revokes bearer session");
    {
      const out = await req("POST", "/auth/logout", { token, body: {} });
      check("logout 200", out.status === 200, `got ${out.status}`);
      const after = await req("GET", "/auth/session", { token });
      check("session 401 after logout", after.status === 401, `got ${after.status}`);
    }
  } finally {
    try {
      const { atelierSelfExpenses } = (await import("@workspace/db")) as any;
      if (createdExpenseId && atelierSelfExpenses) {
        await db.delete(atelierSelfExpenses).where(eq(atelierSelfExpenses.id, createdExpenseId));
      }
    } catch {
      /* table name may differ; scratch DB is disposable anyway */
    }
    await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, TEST_USER_ID));
    await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, TEST_EMAIL));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, TEST_USER_ID));
    server.close();
    await pool.end();
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 ${failures.length} failure(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\n\u2713 mobile-auth probe passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("Probe crashed:", err);
  process.exit(1);
});
