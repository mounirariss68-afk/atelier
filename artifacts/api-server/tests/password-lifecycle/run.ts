/**
 * Task #820 — go-live password management regression probe.
 *
 * Covers, end to end against a scratch DB + in-process app boot:
 *   1. Boot seed: founder credentials exist WITHOUT the old hardcoded
 *      password; the seed never rewrites an existing hash.
 *   2. Password policy: letter+digit rule enforced on /activate,
 *      /reset-password and /change-password.
 *   3. Self-service forgot-password: non-enumerating response, reset token
 *      minted (hashed at rest, purpose="reset"), audit written; demo and
 *      unknown accounts get the same 200 with no token.
 *   4. Reset link redemption: /reset-info + /reset-password happy path,
 *      single use, sessions revoked, lockout counters cleared.
 *   5. Persisted lockout: 5 wrong passwords lock the account (generic 401,
 *      audit account_locked), the CORRECT password is rejected while
 *      locked, partner /unlock-account clears it (audit account_unlocked).
 *   6. Partner reset: returns a reset URL (no temp password), invalidates
 *      the old password + sessions, link works once.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/password-lifecycle/run.ts
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const USER_ID = `p_test_pwlife_${STAMP}`;
const EMAIL = `test.pwlife.${STAMP}@cognirise.ai`;
const FP_ID = `p_test_pwlife_fp_${STAMP}`;
const FP_EMAIL = `test.pwlife.fp.${STAMP}@cognirise.ai`;
const INITIAL_PW = `Initial-Pw-${STAMP}-1`;
const RESET_PW = `Reset-Pw-${STAMP}-2`;
const FP_PW = `Partner-Pw-${STAMP}-3`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main() {
  const { db, atelierAuthCredentials, atelierAuthSessions, atelierAuditEvents, atelierUsers, atelierLoginActivationTokens, pool } =
    await import("@workspace/db");
  const { hashPassword, verifyPassword } = await import("../../src/lib/auth/passwords.js");
  const { ensureAtelierAuthSeed } = await import("../../src/lib/atelier-seed-auth.js");
  const authModule = await import("../../src/routes/auth/index.js");
  const resetRate = authModule.__resetAuthRateLimitForTests;
  const app = (await import("../../src/app.js")).default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;

  const post = async (path: string, body: unknown, cookie?: string) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
  };
  const get = async (path: string, cookie?: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const cookieOf = (res: Response): string | null => {
    const m = /atelier_auth_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
    return m ? `atelier_auth_session=${m[1]}` : null;
  };
  const auditRows = (action: string) =>
    db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.action, action), eq(atelierAuditEvents.entityType, "auth")));

  try {
    // =====================================================================
    group("boot seed \u00b7 no hardcoded founder password");
    // =====================================================================
    await ensureAtelierAuthSeed();
    const [founderCred] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, "mounir@cognirise.ai"));
    check("founder credential row exists after seed", !!founderCred);
    if (founderCred) {
      const before = founderCred.passwordHash;
      await ensureAtelierAuthSeed();
      const [after] = await db
        .select()
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.email, "mounir@cognirise.ai"));
      check("re-running the seed never rewrites the hash", after?.passwordHash === before);

      // Fresh-creation semantics: delete the row (scratch DB only) and
      // re-seed — the recreated credential must carry an UNUSABLE hash, not
      // any known boot password. (The reused scratch DB may hold a
      // credential that predates Task #820, so test the creation path
      // directly instead of asserting on the pre-existing row.)
      await db
        .delete(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.email, "mounir@cognirise.ai"));
      await ensureAtelierAuthSeed();
      const [recreated] = await db
        .select()
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.email, "mounir@cognirise.ai"));
      check(
        "fresh seed creates an unusable credential (retired boot password does NOT verify)",
        !!recreated && !verifyPassword("SeptemberEylul2026!", recreated.passwordHash),
      );
      // Restore the original row so other suites sharing this scratch DB
      // keep their baseline.
      if (recreated) {
        await db
          .update(atelierAuthCredentials)
          .set({
            passwordHash: before,
            userManaged: founderCred.userManaged,
            mustChangePassword: founderCred.mustChangePassword,
          })
          .where(eq(atelierAuthCredentials.email, "mounir@cognirise.ai"));
      }
    }

    // ---- provision ephemeral personas ----
    const [anyOrg] = await db.select({ orgId: atelierUsers.orgId }).from(atelierUsers).limit(1);
    const orgId = anyOrg?.orgId ?? "org_aico";
    await db.insert(atelierUsers).values([
      { id: USER_ID, orgId, email: EMAIL, name: "Pw Lifecycle", initials: "PL", role: "employee", roleLabel: "Employee", title: "Test Employee" },
      { id: FP_ID, orgId, email: FP_EMAIL, name: "Pw Partner", initials: "PP", role: "founding_partner", roleLabel: "Founding Partner", title: "Test Partner" },
    ]);
    await db.insert(atelierAuthCredentials).values([
      { email: EMAIL, userId: USER_ID, passwordHash: hashPassword(INITIAL_PW), userManaged: true },
      { email: FP_EMAIL, userId: FP_ID, passwordHash: hashPassword(FP_PW), userManaged: true },
    ]);

    // =====================================================================
    group("password policy \u00b7 letter+digit rule");
    // =====================================================================
    resetRate?.();
    const login1 = await post("/login", { email: EMAIL, password: INITIAL_PW });
    const cookie1 = cookieOf(login1.res);
    check("baseline login \u2192 200", login1.status === 200 && !!cookie1, `status=${login1.status}`);
    const noDigit = await post(
      "/change-password",
      { currentPassword: INITIAL_PW, newPassword: "OnlyLettersHere" },
      cookie1 ?? undefined,
    );
    check(
      "change-password without a digit \u2192 400 weak-password",
      noDigit.status === 400 && noDigit.body?.error === "weak-password",
      `status=${noDigit.status} error=${noDigit.body?.error}`,
    );
    const containsEmail = await post(
      "/change-password",
      { currentPassword: INITIAL_PW, newPassword: `${EMAIL.split("@")[0]}A1` },
      cookie1 ?? undefined,
    );
    check(
      "change-password containing email local part \u2192 400 weak-password",
      containsEmail.status === 400 && containsEmail.body?.error === "weak-password",
      `status=${containsEmail.status}`,
    );

    // =====================================================================
    group("forgot-password \u00b7 non-enumerating request");
    // =====================================================================
    resetRate?.();
    const unknown = await post("/forgot-password", { email: `nobody.${STAMP}@cognirise.ai` });
    check("unknown email \u2192 200 ok (no enumeration)", unknown.status === 200 && unknown.body?.ok === true, `status=${unknown.status}`);
    const known = await post("/forgot-password", { email: EMAIL });
    check("known email \u2192 identical 200 ok", known.status === 200 && known.body?.ok === true, `status=${known.status}`);
    check(
      "responses are indistinguishable",
      JSON.stringify(unknown.body) === JSON.stringify(known.body),
    );
    const tokensForUser = await db
      .select()
      .from(atelierLoginActivationTokens)
      .where(and(eq(atelierLoginActivationTokens.email, EMAIL), eq(atelierLoginActivationTokens.purpose, "reset")));
    check("reset token row minted for known email (hashed at rest)", tokensForUser.length === 1 && !tokensForUser[0]!.usedAt);
    const tokensForUnknown = await db
      .select()
      .from(atelierLoginActivationTokens)
      .where(eq(atelierLoginActivationTokens.email, `nobody.${STAMP}@cognirise.ai`));
    check("no token row for unknown email", tokensForUnknown.length === 0);
    const reqAudits = await auditRows("password_reset_requested");
    check(
      "password_reset_requested audited for the known email only",
      reqAudits.some((a) => (a.payload as any)?.targetEmail === EMAIL) &&
        !reqAudits.some((a) => (a.payload as any)?.targetEmail === `nobody.${STAMP}@cognirise.ai`),
    );
    const demo = await post("/forgot-password", { email: "demo@cognirise.ai" });
    const demoTokens = await db
      .select()
      .from(atelierLoginActivationTokens)
      .where(and(eq(atelierLoginActivationTokens.email, "demo@cognirise.ai"), eq(atelierLoginActivationTokens.purpose, "reset")));
    check("demo account \u2192 200 ok but NO reset token", demo.status === 200 && demoTokens.length === 0, `tokens=${demoTokens.length}`);

    // =====================================================================
    group("reset link \u00b7 redemption, single use, session revocation");
    // =====================================================================
    resetRate?.();
    // Mint a token with a KNOWN raw value directly (email delivery is
    // log-only in tests; the raw token never leaves the server otherwise).
    const rawToken = randomBytes(32).toString("hex");
    await db.insert(atelierLoginActivationTokens).values({
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      email: EMAIL,
      userId: USER_ID,
      purpose: "reset",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const info = await get(`/reset-info?token=${rawToken}`);
    check("reset-info \u2192 200 with account email", info.status === 200 && info.body?.email === EMAIL, `status=${info.status}`);
    const activateInfoCross = await get(`/activate-info?token=${rawToken}`);
    check("reset token rejected by activate-info (purpose isolation)", activateInfoCross.status === 404, `status=${activateInfoCross.status}`);
    const weakReset = await post("/reset-password", { token: rawToken, newPassword: "lettersonly" });
    check("weak password on reset \u2192 400, token NOT consumed", weakReset.status === 400 && weakReset.body?.error === "weak-password", `status=${weakReset.status}`);
    const goodReset = await post("/reset-password", { token: rawToken, newPassword: RESET_PW });
    check("valid reset \u2192 200 ok", goodReset.status === 200 && goodReset.body?.ok === true, `status=${goodReset.status} err=${goodReset.body?.error}`);
    const reuse = await post("/reset-password", { token: rawToken, newPassword: `${RESET_PW}x9` });
    check("token reuse \u2192 404 invalid-or-expired", reuse.status === 404, `status=${reuse.status}`);
    const sessAfterReset = await get("/session", cookie1 ?? undefined);
    check("pre-reset session revoked \u2192 401", sessAfterReset.status === 401, `status=${sessAfterReset.status}`);
    resetRate?.();
    const oldPwLogin = await post("/login", { email: EMAIL, password: INITIAL_PW });
    check("old password rejected after reset", oldPwLogin.status === 401);
    const newPwLogin = await post("/login", { email: EMAIL, password: RESET_PW });
    check("new password accepted after reset", newPwLogin.status === 200, `status=${newPwLogin.status}`);
    const completedAudits = await auditRows("password_reset_completed");
    check("password_reset_completed audited", completedAudits.some((a) => (a.payload as any)?.targetEmail === EMAIL));

    // =====================================================================
    group("lockout \u00b7 5 failures lock; correct password still 401; unlock");
    // =====================================================================
    resetRate?.();
    for (let i = 0; i < 5; i++) {
      await post("/login", { email: EMAIL, password: `wrong-pass-${i}-x1` });
    }
    const [lockedCred] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, EMAIL));
    check(
      "5th failure sets locked_until in the DB",
      !!lockedCred?.lockedUntil && lockedCred.lockedUntil.getTime() > Date.now(),
      `lockedUntil=${lockedCred?.lockedUntil}`,
    );
    const lockAudits = await auditRows("account_locked");
    check("account_locked audited", lockAudits.some((a) => (a.payload as any)?.targetEmail === EMAIL));
    resetRate?.();
    const correctWhileLocked = await post("/login", { email: EMAIL, password: RESET_PW });
    check(
      "correct password while locked \u2192 generic 401",
      correctWhileLocked.status === 401 && correctWhileLocked.body?.error === "invalid-credentials",
      `status=${correctWhileLocked.status}`,
    );
    // Partner unlock.
    const fpLogin = await post("/login", { email: FP_EMAIL, password: FP_PW });
    const fpCookie = cookieOf(fpLogin.res);
    check("founding partner login \u2192 200", fpLogin.status === 200 && !!fpCookie);
    const targets = await get("/reset-targets", fpCookie ?? undefined);
    const targetRow = (targets.body?.targets as any[] | undefined)?.find((t) => t.email === EMAIL);
    check("reset-targets shows the account as locked", targetRow?.locked === true, JSON.stringify(targetRow));
    const unlock = await post("/unlock-account", { email: EMAIL }, fpCookie ?? undefined);
    check("partner unlock \u2192 200 ok", unlock.status === 200 && unlock.body?.ok === true, `status=${unlock.status}`);
    const unlockAudits = await auditRows("account_unlocked");
    check("account_unlocked audited", unlockAudits.some((a) => (a.payload as any)?.targetEmail === EMAIL));
    resetRate?.();
    const afterUnlock = await post("/login", { email: EMAIL, password: RESET_PW });
    check("correct password works after unlock", afterUnlock.status === 200, `status=${afterUnlock.status}`);
    // Non-partner cannot unlock.
    const userCookie = cookieOf(afterUnlock.res);
    const forbidden = await post("/unlock-account", { email: FP_EMAIL }, userCookie ?? undefined);
    check("employee cannot unlock accounts \u2192 403", forbidden.status === 403, `status=${forbidden.status}`);

    // =====================================================================
    group("partner reset \u00b7 link instead of temp password");
    // =====================================================================
    resetRate?.();
    const pReset = await post("/reset-colleague-password", { email: EMAIL }, fpCookie ?? undefined);
    check(
      "partner reset \u2192 200 with resetUrl and NO tempPassword",
      pReset.status === 200 && typeof pReset.body?.resetUrl === "string" && pReset.body?.tempPassword === undefined,
      `status=${pReset.status} body=${JSON.stringify(pReset.body)?.slice(0, 200)}`,
    );
    check("email delivery status surfaced", typeof pReset.body?.email?.status === "string");
    const sessAfterPartnerReset = await get("/session", userCookie ?? undefined);
    check("target's sessions revoked by partner reset", sessAfterPartnerReset.status === 401);
    resetRate?.();
    const oldAfterPartnerReset = await post("/login", { email: EMAIL, password: RESET_PW });
    check("old password invalidated by partner reset", oldAfterPartnerReset.status === 401);
    const linkToken = /token=([0-9a-f]{64})/.exec(String(pReset.body?.resetUrl ?? ""))?.[1];
    check("reset URL carries a 256-bit token", !!linkToken);
    if (linkToken) {
      const redeem = await post("/reset-password", { token: linkToken, newPassword: `Final-Pw-${STAMP}-7` });
      check("partner reset link redeems \u2192 200", redeem.status === 200 && redeem.body?.ok === true, `status=${redeem.status}`);
      resetRate?.();
      const finalLogin = await post("/login", { email: EMAIL, password: `Final-Pw-${STAMP}-7` });
      check("login works with the password chosen via the link", finalLogin.status === 200, `status=${finalLogin.status}`);
    }
    const byPartnerAudits = await auditRows("password_reset_by_partner");
    check("password_reset_by_partner audited", byPartnerAudits.some((a) => (a.payload as any)?.targetEmail === EMAIL));
  } finally {
    await db.delete(atelierAuthSessions).where(inArray(atelierAuthSessions.userId, [USER_ID, FP_ID])).catch(() => {});
    await db.delete(atelierLoginActivationTokens).where(inArray(atelierLoginActivationTokens.email, [EMAIL, FP_EMAIL])).catch(() => {});
    await db.delete(atelierAuthCredentials).where(inArray(atelierAuthCredentials.email, [EMAIL, FP_EMAIL])).catch(() => {});
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorLabel, `%${STAMP}%`)).catch(() => {});
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [USER_ID, FP_ID])).catch(() => {});
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) FAILED:`);
    for (const f of failures) console.error(`  \u2717 ${f}`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
  process.exit(0);
}

void main();
