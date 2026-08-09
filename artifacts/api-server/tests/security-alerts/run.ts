/**
 * Task #824 — founder security-alert regression probe.
 *
 * Verifies the proactive founder alerting on suspicious sign-in activity:
 *   1. password lockout (5 wrong passwords) fires ONE account_locked alert
 *      to all founding partners, with a Security Log deep link filtered to
 *      the person and the day (securityActor / securityFrom / securityTo)
 *   2. sustained failures fire ONE failed_login_burst alert (8 in 10 min),
 *      counting attempts against an already-locked account
 *   3. a second lockout inside the cooling window is debounced (no email)
 *   4. a lockout reached via wrong 2FA codes on /login/2fa also alerts
 *   5. twofa_reset_by_partner alerts resolve org + recipients correctly
 *
 * Fully offline: the lib's test probe hook captures alerts INSTEAD of
 * sending email. Runs against the isolated scratch DB (never the live DB).
 * Run: pnpm --filter @workspace/api-server run test:security-alerts
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";

process.env.NODE_ENV = "test";

const STAMP = Date.now();
const PW_USER_ID = `p_test_secalert_${STAMP}`;
const PW_EMAIL = `test.secalert.${STAMP}@cognirise.ai`;
const PW_PASSWORD = "Correct-Horse-2026!x";
const TOTP_USER_ID = `p_test_secalert2fa_${STAMP}`;
const TOTP_EMAIL = `test.secalert2fa.${STAMP}@cognirise.ai`;

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

async function main(): Promise<void> {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAuthCredentials, atelierAuthSessions } = D as any;
  const { eq, inArray } = await import("drizzle-orm");
  const { hashPassword } = await import("../../src/lib/auth/passwords.js");
  const { generateTotpSecret, encryptTotpSecret } = await import("../../src/lib/auth/totp.js");
  const { ensureAtelierAuthSeed } = await import("../../src/lib/atelier-seed-auth.js");
  await ensureAtelierAuthSeed();
  const alerts = await import("../../src/lib/atelier-security-alerts.js");
  const authRoutes = await import("../../src/routes/auth/index.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/auth`;

  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  type Captured = { trigger: string; targetEmail?: string; consoleUrl: string; recipients: string[] };
  let captured: Captured[] = [];
  alerts.__setSecurityAlertProbeForTests((info: Captured) => captured.push(info));
  const resetWindows = () => {
    (authRoutes as any).__resetAuthRateLimitForTests();
  };

  try {
    await db.insert(atelierUsers).values({
      id: PW_USER_ID,
      orgId: "aico",
      email: PW_EMAIL,
      name: "Test SecAlert",
      initials: "TS",
      role: "consultant",
      roleLabel: "Consultant",
      title: "Test Consultant",
      permissions: [],
      bdActive: false,
    });
    await db.insert(atelierAuthCredentials).values({
      email: PW_EMAIL,
      userId: PW_USER_ID,
      passwordHash: hashPassword(PW_PASSWORD),
    });

    // ---- 1. password lockout fires one alert with the day deep link ----
    group("password lockout alert");
    alerts.__resetSecurityAlertsForTests();
    captured = [];
    for (let i = 0; i < 5; i++) {
      const r = await post("/login", { email: PW_EMAIL, password: "wrong-pw-!" });
      check(`attempt ${i + 1} rejected 401`, r.status === 401);
    }
    // Alerts are fire-and-forget; give the microtask queue a beat.
    await new Promise((r) => setTimeout(r, 250));
    const lockAlerts = captured.filter((c) => c.trigger === "account_locked");
    check("exactly one account_locked alert", lockAlerts.length === 1, `got ${lockAlerts.length}`);
    const a = lockAlerts[0];
    if (a) {
      check("alert targets the locked account", a.targetEmail === PW_EMAIL);
      check("recipients are the founders", a.recipients.length >= 1 && a.recipients.every((e) => e.endsWith("@cognirise.ai")), JSON.stringify(a.recipients));
      const u = new URL(a.consoleUrl, "http://x");
      const day = new Date().toISOString().slice(0, 10);
      check("deep link filters to the person", u.searchParams.get("securityActor") === PW_EMAIL);
      check("deep link bounds the day (from)", u.searchParams.get("securityFrom") === day);
      check("deep link bounds the day (to)", u.searchParams.get("securityTo") === day);
      check("deep link opens the auth tab", u.searchParams.get("securityTab") === "auth");
      check("deep link targets /admin", u.pathname.endsWith("/admin"));
    }

    // ---- 2. sustained failures → one burst alert (locked branch counts) --
    group("failed-login burst alert");
    resetWindows();
    for (let i = 0; i < 3; i++) await post("/login", { email: PW_EMAIL, password: "wrong-pw-!" });
    await new Promise((r) => setTimeout(r, 250));
    const bursts = captured.filter((c) => c.trigger === "failed_login_burst");
    check("exactly one failed_login_burst alert", bursts.length === 1, `got ${bursts.length}`);

    // ---- 3. second lockout inside the cooling window is debounced -------
    group("debounce");
    resetWindows();
    await db
      .update(atelierAuthCredentials)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(atelierAuthCredentials.email, PW_EMAIL));
    const before = captured.length;
    for (let i = 0; i < 5; i++) await post("/login", { email: PW_EMAIL, password: "wrong-pw-!" });
    await new Promise((r) => setTimeout(r, 250));
    check(
      "no second alert within the cooling window",
      captured.length === before,
      `got ${captured.length - before} extra`,
    );

    // ---- 4. lockout via wrong 2FA codes also alerts ----------------------
    group("2FA-code lockout alert");
    resetWindows();
    alerts.__resetSecurityAlertsForTests();
    captured = [];
    await db.insert(atelierUsers).values({
      id: TOTP_USER_ID,
      orgId: "aico",
      email: TOTP_EMAIL,
      name: "Test SecAlert 2FA",
      initials: "T2",
      role: "consultant",
      roleLabel: "Consultant",
      title: "Test Consultant",
      permissions: [],
      bdActive: false,
    });
    await db.insert(atelierAuthCredentials).values({
      email: TOTP_EMAIL,
      userId: TOTP_USER_ID,
      passwordHash: hashPassword(PW_PASSWORD),
      totpEnabled: true,
      totpSecretEnc: encryptTotpSecret(generateTotpSecret()),
    });
    const login = await post("/login", { email: TOTP_EMAIL, password: PW_PASSWORD });
    check("password step returns a 2FA challenge", login.status === 200 && login.body?.twoFactorRequired === true);
    const challenge = String(login.body?.challenge ?? "");
    for (let i = 0; i < 5; i++) {
      const r = await post("/login/2fa", { challenge, code: "000000" });
      check(`wrong code ${i + 1} rejected`, r.status === 401);
    }
    await new Promise((r) => setTimeout(r, 250));
    const lock2fa = captured.filter((c) => c.trigger === "account_locked");
    check("2FA lockout fires one account_locked alert", lock2fa.length === 1, `got ${lock2fa.length}`);
    check("2FA lockout alert targets the account", lock2fa[0]?.targetEmail === TOTP_EMAIL);

    // ---- 5. twofa_reset_by_partner resolves org + recipients -------------
    group("2FA reset alert plumbing");
    alerts.__resetSecurityAlertsForTests();
    captured = [];
    await alerts.sendSecurityAlert({
      trigger: "twofa_reset_by_partner",
      targetEmail: TOTP_EMAIL,
      targetUserId: TOTP_USER_ID,
      ip: "203.0.113.7",
      origin: "https://example.test",
    });
    check("reset alert delivered to founders", captured.length === 1 && captured[0].recipients.length >= 1);
    check(
      "reset alert deep link is absolute",
      captured[0]?.consoleUrl.startsWith("https://example.test/admin?") ?? false,
    );
  } finally {
    alerts.__setSecurityAlertProbeForTests(null);
    try {
      await db.delete(atelierAuthSessions).where(inArray(atelierAuthSessions.userId, [PW_USER_ID, TOTP_USER_ID]));
      await db.delete(atelierAuthCredentials).where(inArray(atelierAuthCredentials.email, [PW_EMAIL, TOTP_EMAIL]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [PW_USER_ID, TOTP_USER_ID]));
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    await pool.end();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll security-alert checks passed.");
}

void main();
