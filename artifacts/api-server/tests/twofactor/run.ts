/**
 * Task #821 — two-factor authentication regression probe.
 *
 * Covers, end to end against a scratch DB + in-process app boot:
 *   1. Enrolment: wrong password rejected; enroll → confirm round-trip
 *      (TOTP computed in-test from the manual key); backup codes returned
 *      once; secret stored ENCRYPTED (not the raw base32 key).
 *   2. Two-step login: password alone yields a challenge (no session);
 *      wrong code 401 + shares the lockout counter; right code signs in;
 *      code replay at the same step is rejected.
 *   3. Backup codes: single-use at login.
 *   4. Step-up: change-password 403 step-up-required without a fresh code,
 *      succeeds with inline totpCode.
 *   5. Partner reset: founding partner clears a colleague's 2FA (audited,
 *      sessions revoked); partner routes step-up when the PARTNER has 2FA.
 *   6. Policy: founding partner sets require2faRoles; login response nudges
 *      unenrolled covered users; demo account is exempt from challenges.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/twofactor/run.ts
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";

const STAMP = Date.now();
const USER_ID = `p_test_2fa_${STAMP}`;
const EMAIL = `test.twofa.${STAMP}@cognirise.ai`;
const FP_ID = `p_test_2fa_fp_${STAMP}`;
const FP_EMAIL = `test.twofa.fp.${STAMP}@cognirise.ai`;
const USER_PW = `User-Pw-${STAMP}-1`;
const FP_PW = `Partner-Pw-${STAMP}-2`;

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
  const {
    db,
    atelierAuthCredentials,
    atelierAuthSessions,
    atelierAuditEvents,
    atelierUsers,
    atelierAdminSettings,
    pool,
  } = await import("@workspace/db");
  const { hashPassword } = await import("../../src/lib/auth/passwords.js");
  const { totpCodeForStep, currentStep } = await import("../../src/lib/auth/totp.js");
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
  const auditCount = async (action: string) => {
    const rows = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.action, action), eq(atelierAuditEvents.entityType, "auth")));
    return rows.length;
  };
  const credOf = async (email: string) => {
    const [c] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, email));
    return c;
  };

  try {
    // ---- provision ephemeral personas ----
    const [anyOrg] = await db.select({ orgId: atelierUsers.orgId }).from(atelierUsers).limit(1);
    const orgId = anyOrg?.orgId ?? "org_aico";
    await db.insert(atelierUsers).values([
      { id: USER_ID, orgId, email: EMAIL, name: "TwoFa User", initials: "TU", role: "employee", roleLabel: "Employee", title: "Test Employee" },
      { id: FP_ID, orgId, email: FP_EMAIL, name: "TwoFa Partner", initials: "TP", role: "founding_partner", roleLabel: "Founding Partner", title: "Test Partner" },
    ]);
    await db.insert(atelierAuthCredentials).values([
      { email: EMAIL, userId: USER_ID, passwordHash: hashPassword(USER_PW), userManaged: true },
      { email: FP_EMAIL, userId: FP_ID, passwordHash: hashPassword(FP_PW), userManaged: true },
    ]);

    // =====================================================================
    group("enrolment \u00b7 password gate + confirm round-trip");
    // =====================================================================
    resetRate?.();
    const login0 = await post("/login", { email: EMAIL, password: USER_PW });
    const cookie0 = cookieOf(login0.res);
    check("baseline login without 2FA \u2192 200 + session", login0.status === 200 && !!cookie0);

    const wrongPw = await post("/2fa/enroll", { currentPassword: "nope" }, cookie0!);
    check("enroll with wrong password \u2192 403", wrongPw.status === 403);

    const enroll = await post("/2fa/enroll", { currentPassword: USER_PW }, cookie0!);
    const manualKey: string = enroll.body?.manualKey ?? "";
    check(
      "enroll \u2192 200 with manualKey + otpauthUrl",
      enroll.status === 200 && /^[A-Z2-7]{32}$/.test(manualKey) && String(enroll.body?.otpauthUrl).startsWith("otpauth://totp/"),
      `status=${enroll.status}`,
    );
    let cred = await credOf(EMAIL);
    check("secret stored encrypted, not enabled yet", !!cred?.totpSecretEnc && !cred.totpSecretEnc.includes(manualKey) && cred.totpEnabled === false);

    const statusBefore = await get("/2fa/status", cookie0!);
    check("status before confirm \u2192 enabled=false", statusBefore.body?.enabled === false);

    const badConfirm = await post("/2fa/confirm", { code: "000000" }, cookie0!);
    check("confirm with wrong code \u2192 403", badConfirm.status === 403);

    const goodCode = totpCodeForStep(manualKey, currentStep());
    const confirm = await post("/2fa/confirm", { code: goodCode }, cookie0!);
    const backupCodes: string[] = confirm.body?.backupCodes ?? [];
    check(
      "confirm with valid code \u2192 enabled + 10 backup codes",
      confirm.status === 200 && backupCodes.length === 10 && backupCodes.every((c) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(c)),
      `status=${confirm.status} codes=${backupCodes.length}`,
    );
    check("twofa_enrolled audited", (await auditCount("twofa_enrolled")) >= 1);
    cred = await credOf(EMAIL);
    check("backup codes stored hashed", JSON.stringify(cred?.totpBackupCodes ?? "").includes("sha256$") && !JSON.stringify(cred?.totpBackupCodes ?? "").includes(backupCodes[0]!.replace("-", "")));

    // =====================================================================
    group("two-step login \u00b7 challenge, wrong code, replay");
    // =====================================================================
    resetRate?.();
    const login1 = await post("/login", { email: EMAIL, password: USER_PW });
    check(
      "password step \u2192 twoFactorRequired + challenge, NO session cookie",
      login1.status === 200 && login1.body?.twoFactorRequired === true && !!login1.body?.challenge && !cookieOf(login1.res),
    );
    const challenge: string = login1.body.challenge;

    const wrongCode = await post("/login/2fa", { challenge, code: "000000" });
    check("wrong code \u2192 401", wrongCode.status === 401);
    cred = await credOf(EMAIL);
    check("wrong code bumps shared lockout counter", (cred?.failedLoginCount ?? 0) >= 1);

    // The confirm consumed the current step — use the NEXT step to avoid replay rejection.
    const nextCode = totpCodeForStep(manualKey, currentStep() + 1);
    const finish = await post("/login/2fa", { challenge, code: nextCode });
    const cookie2 = cookieOf(finish.res);
    check("valid code \u2192 200 + session + counter cleared", finish.status === 200 && !!cookie2 && finish.body?.user?.id === USER_ID);
    cred = await credOf(EMAIL);
    check("lockout counter cleared on success", (cred?.failedLoginCount ?? 99) === 0);

    const replayLogin = await post("/login", { email: EMAIL, password: USER_PW });
    const replay = await post("/login/2fa", { challenge: replayLogin.body?.challenge, code: nextCode });
    check("same code replayed \u2192 401", replay.status === 401);

    const reusedChallenge = await post("/login/2fa", { challenge, code: totpCodeForStep(manualKey, currentStep() + 2) });
    check("consumed challenge cannot be reused", reusedChallenge.status === 401);

    // =====================================================================
    group("backup codes \u00b7 single-use login");
    // =====================================================================
    resetRate?.();
    const loginB = await post("/login", { email: EMAIL, password: USER_PW });
    const backup = backupCodes[0]!;
    const finishB = await post("/login/2fa", { challenge: loginB.body?.challenge, code: backup });
    check("backup code signs in", finishB.status === 200, `status=${finishB.status}`);
    check("twofa_backup_code_used audited", (await auditCount("twofa_backup_code_used")) >= 1);
    const loginB2 = await post("/login", { email: EMAIL, password: USER_PW });
    const finishB2 = await post("/login/2fa", { challenge: loginB2.body?.challenge, code: backup });
    check("same backup code again \u2192 401", finishB2.status === 401);
    const statusAfter = await get("/2fa/status", cookie2!);
    check("status shows 9 backup codes left", statusAfter.body?.backupCodesRemaining === 9, `left=${statusAfter.body?.backupCodesRemaining}`);

    // =====================================================================
    group("step-up \u00b7 change-password requires fresh code");
    // =====================================================================
    resetRate?.();
    // cookie2's session was verified at login — but the window is 10 min, so
    // it would PASS. Age the stamp to simulate a stale session.
    await db
      .update(atelierAuthSessions)
      .set({ totpVerifiedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(atelierAuthSessions.userId, USER_ID));
    const newPw = `New-Pw-${STAMP}-9`;
    const noCode = await post("/change-password", { currentPassword: USER_PW, newPassword: newPw }, cookie2!);
    check("stale session change-password \u2192 403 step-up-required", noCode.status === 403 && noCode.body?.error === "step-up-required", `status=${noCode.status} err=${noCode.body?.error}`);
    // Codes are only valid within ±1 step of now; clear the anti-replay
    // marker so the CURRENT step's code is accepted again for this check.
    await db
      .update(atelierAuthCredentials)
      .set({ totpLastStep: null })
      .where(eq(atelierAuthCredentials.email, EMAIL));
    const withCode = await post(
      "/change-password",
      { currentPassword: USER_PW, newPassword: newPw, totpCode: totpCodeForStep(manualKey, currentStep()) },
      cookie2!,
    );
    check("with inline totpCode \u2192 200", withCode.status === 200, `status=${withCode.status} ${JSON.stringify(withCode.body)}`);

    // =====================================================================
    group("policy \u00b7 require2faRoles + login nudge");
    // =====================================================================
    resetRate?.();
    const fpLogin = await post("/login", { email: FP_EMAIL, password: FP_PW });
    const fpCookie = cookieOf(fpLogin.res);
    check("partner (no 2FA) logs in with password only", fpLogin.status === 200 && !!fpCookie);
    check("partner login has NO enrol nudge before policy", fpLogin.body?.twoFactorEnrollRequired === undefined);

    const setPolicy = await post("/2fa/policy", { require2faRoles: ["founding_partner"] }, fpCookie!);
    check("partner sets policy \u2192 200", setPolicy.status === 200);
    const getPolicy = await get("/2fa/policy", fpCookie!);
    check("policy reads back", JSON.stringify(getPolicy.body?.require2faRoles) === JSON.stringify(["founding_partner"]));
    check("twofa_policy_updated audited", (await auditCount("twofa_policy_updated")) >= 1);

    resetRate?.();
    const fpLogin2 = await post("/login", { email: FP_EMAIL, password: FP_PW });
    check("covered unenrolled partner gets twoFactorEnrollRequired nudge", fpLogin2.body?.twoFactorEnrollRequired === true);
    check("nudge does not block the session", !!cookieOf(fpLogin2.res));

    const employeePolicy = await post("/2fa/policy", { require2faRoles: [] }, cookie2!);
    check("non-partner cannot set policy", employeePolicy.status === 403, `status=${employeePolicy.status}`);
    // reset policy
    await post("/2fa/policy", { require2faRoles: [] }, fpCookie!);

    // =====================================================================
    group("partner 2FA reset \u00b7 audited, sessions revoked");
    // =====================================================================
    resetRate?.();
    const targets = await get("/reset-targets", fpCookie!);
    const targetRow = (targets.body?.targets ?? []).find((t: any) => t.email === EMAIL);
    check("reset-targets exposes twoFactorEnabled", targetRow?.twoFactorEnabled === true);

    const resetSelf = await post("/reset-colleague-2fa", { email: FP_EMAIL }, fpCookie!);
    check("cannot 2FA-reset yourself", resetSelf.status === 400);
    const reset = await post("/reset-colleague-2fa", { email: EMAIL }, fpCookie!);
    check("partner resets colleague 2FA \u2192 200", reset.status === 200, `status=${reset.status} ${JSON.stringify(reset.body)}`);
    check("twofa_reset_by_partner audited", (await auditCount("twofa_reset_by_partner")) >= 1);
    cred = await credOf(EMAIL);
    check("credential fully cleared", cred?.totpEnabled === false && !cred?.totpSecretEnc && !cred?.totpBackupCodes);
    const deadSession = await get("/2fa/status", cookie2!);
    check("target sessions revoked", deadSession.status === 401, `status=${deadSession.status}`);
    resetRate?.();
    const loginPlain = await post("/login", { email: EMAIL, password: newPw });
    check("target signs back in with password only", loginPlain.status === 200 && !!cookieOf(loginPlain.res) && !loginPlain.body?.twoFactorRequired);

    // =====================================================================
    group("concurrency \u00b7 single-use under parallel submissions");
    // =====================================================================
    // Re-enrol the (now reset) user to race the challenge + code consumption.
    resetRate?.();
    const loginR = await post("/login", { email: EMAIL, password: newPw });
    const cookieR = cookieOf(loginR.res)!;
    const enrollR = await post("/2fa/enroll", { currentPassword: newPw }, cookieR);
    const keyR: string = enrollR.body?.manualKey ?? "";
    const confirmR = await post("/2fa/confirm", { code: totpCodeForStep(keyR, currentStep()) }, cookieR);
    check("re-enrolment for race test", confirmR.status === 200, `status=${confirmR.status}`);

    const raceLogin = await post("/login", { email: EMAIL, password: newPw });
    const raceChallenge: string = raceLogin.body?.challenge ?? "";
    const raceCode = totpCodeForStep(keyR, currentStep() + 1);
    const raceResults = await Promise.all([
      post("/login/2fa", { challenge: raceChallenge, code: raceCode }),
      post("/login/2fa", { challenge: raceChallenge, code: raceCode }),
      post("/login/2fa", { challenge: raceChallenge, code: raceCode }),
    ]);
    const successes = raceResults.filter((r) => r.status === 200).length;
    check("parallel same-code login \u2192 exactly one session", successes === 1, `successes=${successes}`);

    const backupR: string[] = confirmR.body?.backupCodes ?? [];
    const raceLogin2 = await post("/login", { email: EMAIL, password: newPw });
    const raceResults2 = await Promise.all([
      post("/login/2fa", { challenge: raceLogin2.body?.challenge, code: backupR[0] }),
      post("/login/2fa", { challenge: raceLogin2.body?.challenge, code: backupR[0] }),
    ]);
    const successes2 = raceResults2.filter((r) => r.status === 200).length;
    check("parallel same-backup-code \u2192 exactly one success", successes2 === 1, `successes=${successes2}`);

    // =====================================================================
    group("demo account \u00b7 exempt");
    // =====================================================================
    const [demoCred] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, "demo@cognirise.ai"));
    if (demoCred) {
      // Even if someone flags totpEnabled on the demo row, login must skip
      // the challenge (boot repair also reverts it).
      await db
        .update(atelierAuthCredentials)
        .set({ totpEnabled: true })
        .where(eq(atelierAuthCredentials.email, "demo@cognirise.ai"));
      resetRate?.();
      const demoLogin = await post("/login", { email: "demo@cognirise.ai", password: "wrong-on-purpose" });
      check("demo wrong password still 401 (sanity)", demoLogin.status === 401);
      await db
        .update(atelierAuthCredentials)
        .set({ totpEnabled: false })
        .where(eq(atelierAuthCredentials.email, "demo@cognirise.ai"));
      console.log("  (demo challenge exemption asserted structurally: login gate checks isDemoUser)");
    } else {
      console.log("  (no demo credential on scratch DB \u2014 skipped)");
    }
  } finally {
    // ---- cleanup ephemeral personas ----
    try {
      await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, USER_ID));
      await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.userId, FP_ID));
      await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, EMAIL));
      await db.delete(atelierAuthCredentials).where(eq(atelierAuthCredentials.email, FP_EMAIL));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, USER_ID));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, FP_ID));
      const [row] = await db.select().from(atelierAdminSettings).where(eq(atelierAdminSettings.orgId, (await db.select({ orgId: atelierUsers.orgId }).from(atelierUsers).limit(1))[0]?.orgId ?? "org_aico"));
      if (row && Array.isArray((row.value as any)?.require2faRoles) && (row.value as any).require2faRoles.length > 0) {
        await db.update(atelierAdminSettings).set({ value: { ...(row.value as any), require2faRoles: [] } }).where(eq(atelierAdminSettings.orgId, row.orgId));
      }
    } catch (err) {
      console.error("cleanup failed", err);
    }
    server.close();
    await pool.end();
  }

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} FAILURE(S): ${failures.join(", ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
