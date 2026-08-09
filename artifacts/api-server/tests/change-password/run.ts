/**
 * Task #6 — change-password regression probe.
 *
 * Automated coverage for the /api/auth/change-password flow plus the boot
 * seed's user_managed guarantee, so future auth/seed edits can't silently
 * break them. Verified paths:
 *   1. 401 unauthenticated (no session cookie)
 *   2. 400 invalid-body (missing fields)
 *   3. 403 wrong-password (current password incorrect)
 *   4. 400 weak-password (< 10 chars)
 *   5. 400 same-password (new === current)
 *   6. success → user_managed=true, must_change_password=false in the DB
 *   7. old password rejected at login; new password accepted
 *   8. other sessions revoked on success; the changing session stays valid
 *   9. ensureAtelierAuthSeed skips user_managed=true rows, repairs others
 *
 * Runs standalone (tsx ./tests/change-password/run.ts) booting the app
 * in-process via app.listen(0) — see memory note: the CRM harness can't run
 * under restart_workflow. All rows it creates are ephemeral and removed in
 * `finally`; the founder credential row touched by the seed check is
 * snapshotted first and restored byte-for-byte.
 *
 * Rate-limit budget: login + change-password share one per-IP window of 10
 * requests / 15 min (in-memory, fresh per process). This suite issues 9
 * rate-limited requests — if you add another login/change call, raise the
 * limit awareness here or the suite will flake with 429s.
 */

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

const STAMP = Date.now();
const TEST_USER_ID = `p_test_pwchange_${STAMP}`;
const TEST_EMAIL = `test.pwchange.${STAMP}@cognirise.ai`;
const INITIAL_PW = "InitialPw-For-Test-2026!";
const NEW_PW = "Rotated-Pw-For-Test-2026!";

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

function cookieFromResponse(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const m = /atelier_auth_session=([^;]+)/.exec(setCookie);
  return m ? `atelier_auth_session=${m[1]}` : null;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "\u2717 DATABASE_URL is not set \u2014 this probe requires a database connection. " +
        "Set TEST_DATABASE_URL (preferred, isolated) or DATABASE_URL.",
    );
    process.exit(1);
  }

  // Dynamic imports AFTER env is finalised so the pool binds the right URL.
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAuthCredentials, atelierAuthSessions, atelierAuditEvents } =
    D as unknown as {
      db: any;
      pool: { end: () => Promise<void> };
      atelierUsers: any;
      atelierAuthCredentials: any;
      atelierAuthSessions: any;
      atelierAuditEvents: any;
    };
  const { hashPassword, verifyPassword } = await import("../../src/lib/auth/passwords.js");
  const { ensureAtelierAuthSeed } = await import("../../src/lib/atelier-seed-auth.js");
  // The isolated scratch database starts without the boot auth seed; run it
  // here so the founder credential the seed checks depend on exists.
  await ensureAtelierAuthSeed();
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/auth`;

  async function post(
    path: string,
    body: Record<string, unknown>,
    cookie?: string,
  ): Promise<{ status: number; body: any; res: Response }> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    const body2 = await res.json().catch(() => null);
    return { status: res.status, body: body2, res };
  }

  // Snapshot of the founder credential row mutated by the seed check —
  // restored byte-for-byte in `finally`.
  const SEED_EMAIL = "mounir@cognirise.ai";
  let seedRowBackup: any = null;

  try {
    // --- provision the ephemeral login this suite acts as ---
    await db
      .insert(atelierUsers)
      .values({
        id: TEST_USER_ID,
        orgId: "aico",
        email: TEST_EMAIL,
        name: "Test PwChange",
        initials: "TP",
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
      passwordHash: hashPassword(INITIAL_PW),
    });

    // =====================================================================
    group("change-password \u00b7 unauthenticated & validation failures");
    // =====================================================================
    const noCookie = await post("/change-password", {
      currentPassword: INITIAL_PW,
      newPassword: NEW_PW,
    });
    check(
      "no session cookie \u2192 401 unauthenticated",
      noCookie.status === 401 && noCookie.body?.error === "unauthenticated",
      `status=${noCookie.status} error=${noCookie.body?.error}`,
    );

    // Two live sessions: A (does the change), B (must be revoked by it).
    const loginA = await post("/login", { email: TEST_EMAIL, password: INITIAL_PW });
    const cookieA = cookieFromResponse(loginA.res);
    check("login with initial password \u2192 200 + session cookie", loginA.status === 200 && !!cookieA, `status=${loginA.status}`);
    const loginB = await post("/login", { email: TEST_EMAIL, password: INITIAL_PW });
    const cookieB = cookieFromResponse(loginB.res);
    check("second login \u2192 200 + distinct session cookie", loginB.status === 200 && !!cookieB && cookieB !== cookieA, `status=${loginB.status}`);
    if (!cookieA || !cookieB) throw new Error("could not establish sessions; aborting");

    const missingBody = await post("/change-password", {}, cookieA);
    check(
      "missing fields \u2192 400 invalid-body",
      missingBody.status === 400 && missingBody.body?.error === "invalid-body",
      `status=${missingBody.status} error=${missingBody.body?.error}`,
    );
    const wrongCurrent = await post(
      "/change-password",
      { currentPassword: "not-the-password-123", newPassword: NEW_PW },
      cookieA,
    );
    check(
      "wrong current password \u2192 403 wrong-password",
      wrongCurrent.status === 403 && wrongCurrent.body?.error === "wrong-password",
      `status=${wrongCurrent.status} error=${wrongCurrent.body?.error}`,
    );
    const weak = await post(
      "/change-password",
      { currentPassword: INITIAL_PW, newPassword: "short" },
      cookieA,
    );
    check(
      "weak (<10 chars) new password \u2192 400 weak-password",
      weak.status === 400 && weak.body?.error === "weak-password",
      `status=${weak.status} error=${weak.body?.error}`,
    );
    const same = await post(
      "/change-password",
      { currentPassword: INITIAL_PW, newPassword: INITIAL_PW },
      cookieA,
    );
    check(
      "new password === current \u2192 400 same-password",
      same.status === 400 && same.body?.error === "same-password",
      `status=${same.status} error=${same.body?.error}`,
    );

    // None of the failures may have touched the credential.
    const [credAfterFailures] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, TEST_EMAIL));
    check(
      "failed attempts leave the credential untouched",
      !!credAfterFailures &&
        verifyPassword(INITIAL_PW, credAfterFailures.passwordHash) &&
        credAfterFailures.userManaged === false,
      `userManaged=${credAfterFailures?.userManaged}`,
    );

    // =====================================================================
    group("change-password \u00b7 success path");
    // =====================================================================
    const ok = await post(
      "/change-password",
      { currentPassword: INITIAL_PW, newPassword: NEW_PW },
      cookieA,
    );
    check("valid change \u2192 200 ok", ok.status === 200 && ok.body?.ok === true, `status=${ok.status}`);

    const [credAfter] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, TEST_EMAIL));
    check("new hash verifies the new password", !!credAfter && verifyPassword(NEW_PW, credAfter.passwordHash));
    check("old password no longer verifies against the stored hash", !!credAfter && !verifyPassword(INITIAL_PW, credAfter.passwordHash));
    check("credential is flagged user_managed=true", credAfter?.userManaged === true);
    check("must_change_password cleared on success", credAfter?.mustChangePassword === false);

    // Session semantics: the changing session survives, every other dies.
    const sessA = await fetch(`${BASE}/session`, { headers: { cookie: cookieA } });
    check("changing session (A) stays valid \u2192 200", sessA.status === 200, `status=${sessA.status}`);
    const sessB = await fetch(`${BASE}/session`, { headers: { cookie: cookieB } });
    check("other session (B) revoked \u2192 401", sessB.status === 401, `status=${sessB.status}`);

    // Login semantics after the change.
    const oldLogin = await post("/login", { email: TEST_EMAIL, password: INITIAL_PW });
    check(
      "login with OLD password \u2192 401 invalid-credentials",
      oldLogin.status === 401 && oldLogin.body?.error === "invalid-credentials",
      `status=${oldLogin.status} error=${oldLogin.body?.error}`,
    );
    const newLogin = await post("/login", { email: TEST_EMAIL, password: NEW_PW });
    check("login with NEW password \u2192 200", newLogin.status === 200, `status=${newLogin.status}`);

    // =====================================================================
    group("boot seed \u00b7 user_managed rows are never overwritten");
    // =====================================================================
    const [seedRow] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, SEED_EMAIL));
    check("seeded founder credential exists", !!seedRow);
    if (seedRow) {
      seedRowBackup = { ...seedRow };
      const sentinelHash = hashPassword(`sentinel-user-chosen-${STAMP}`);

      // 1. user_managed=true → the seed must keep the hash exactly as-is.
      await db
        .update(atelierAuthCredentials)
        .set({ passwordHash: sentinelHash, userManaged: true })
        .where(eq(atelierAuthCredentials.email, SEED_EMAIL));
      await ensureAtelierAuthSeed();
      const [afterSkip] = await db
        .select()
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.email, SEED_EMAIL));
      check(
        "seed skips user_managed=true row (hash untouched)",
        afterSkip?.passwordHash === sentinelHash && afterSkip?.userManaged === true,
      );

      // 2. Task #820 — there is no boot password anymore: the seed keeps ANY
      // existing hash (user-managed or not) and only repairs a drifted
      // userId link.
      await db
        .update(atelierAuthCredentials)
        .set({ passwordHash: sentinelHash, userManaged: false, userId: `drifted_${STAMP}` })
        .where(eq(atelierAuthCredentials.email, SEED_EMAIL));
      await ensureAtelierAuthSeed();
      const [afterRepair] = await db
        .select()
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.email, SEED_EMAIL));
      check(
        "seed keeps non-user-managed hash and repairs only the userId link",
        !!afterRepair &&
          afterRepair.passwordHash === sentinelHash &&
          afterRepair.userId === seedRowBackup.userId,
        `userId=${afterRepair?.userId} hashKept=${afterRepair?.passwordHash === sentinelHash}`,
      );
    }
  } finally {
    // Restore the founder credential exactly as we found it.
    if (seedRowBackup) {
      await db
        .update(atelierAuthCredentials)
        .set({
          userId: seedRowBackup.userId,
          passwordHash: seedRowBackup.passwordHash,
          userManaged: seedRowBackup.userManaged,
          mustChangePassword: seedRowBackup.mustChangePassword,
          updatedAt: seedRowBackup.updatedAt,
        })
        .where(eq(atelierAuthCredentials.email, SEED_EMAIL))
        .catch((err: unknown) => console.error("restore of founder credential FAILED:", err));
    }
    // Remove every ephemeral row this suite created.
    await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, TEST_USER_ID)).catch(() => {});
    await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, TEST_EMAIL)).catch(() => {});
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.actorId, TEST_USER_ID)).catch(() => {});
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.actorLabel, TEST_EMAIL)).catch(() => {});
    await db.delete(atelierUsers).where(eq(atelierUsers.id, TEST_USER_ID)).catch(() => {});
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) FAILED:`);
    for (const f of failures) console.error(`  \u2717 ${f}`);
    process.exit(1);
  }
  console.log(`\nAll checks passed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("change-password probe crashed:", err);
  process.exit(1);
});
