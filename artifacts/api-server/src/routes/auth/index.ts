import express, { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  atelierAuthCredentials,
  atelierUsers,
  atelierAuditEvents,
  atelierLoginActivationTokens,
  atelierAdminSettings,
  atelierPartnerFirms,
  atelierPartnerFirmBankChangeRequests,
  atelierPartnerFirmDocuments,
} from "@workspace/db";
import { eq, ne, and, isNull, gte, lte, desc, sql } from "drizzle-orm";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { verifyPassword, hashPassword } from "../../lib/auth/passwords";
import {
  AUTH_SESSION_COOKIE,
  sessionTokenFromRequest,
  createSession,
  destroySession,
  lookupSession,
  revokeOtherSessions,
  revokeAllSessions,
  clearSessionMustChange,
  setSessionCookie,
  clearSessionCookie,
  markSessionTotpVerified,
} from "../../lib/auth/session";
import { personaToWire } from "../atelier/personaCookie";
import { isDemoUser } from "../../lib/auth/demoReadOnly";
import { trustedRequestOrigin } from "../../lib/auth/trusted-origin";
import { validateNewPassword } from "../../lib/auth/password-policy";
import {
  generateTotpSecret,
  encryptTotpSecret,
  decryptTotpSecret,
  verifyTotpCode,
  otpauthUrl,
  generateBackupCodes,
  backupCodesRemaining,
} from "../../lib/auth/totp";
import { requireFreshTotp, verifyCredentialCode } from "../../lib/auth/step-up";
import { sendPasswordResetEmail } from "../../lib/atelier-reset-email";
import {
  sendSecurityAlert,
  noteFailedLoginForAlerts,
} from "../../lib/atelier-security-alerts";
import { contentDispositionFilename } from "../../lib/httpFilename";
import { logger } from "../../lib/logger";

/**
 * Real email + password auth — Task #1. Mounted at /api/auth (in front of
 * the global requireAuthSession gate). Only the two seeded credential rows
 * can log in; everything else gets the same generic error (no enumeration).
 */
const router: IRouter = Router();

// ---- login rate limiting (per client IP, in-memory sliding window) ----
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const rateBuckets = new Map<string, number[]>();

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (bucket.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  return true;
}

/** Test-only: probes that intentionally exhaust the window call this. */
export function __resetAuthRateLimitForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  rateBuckets.clear();
}

// ---- persisted per-account lockout (Task #820) --------------------------
// Independent from the per-IP rate limit: consecutive wrong-password
// attempts against ONE account lock it for a cooling-off period even when
// the attacker rotates IPs. The response stays the generic 401 so lockout
// state is not enumerable.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function isLockedOut(cred: { lockedUntil: Date | null }): boolean {
  return !!cred.lockedUntil && cred.lockedUntil.getTime() > Date.now();
}

async function audit(
  action:
    | "login_success"
    | "login_failed"
    | "logout"
    | "password_changed"
    | "password_change_failed"
    | "password_reset_by_partner"
    | "password_reset_denied"
    | "account_activated"
    | "account_activation_failed"
    | "password_reset_requested"
    | "password_reset_completed"
    | "password_reset_failed"
    | "account_locked"
    | "account_unlocked"
    | "twofa_enrolled"
    | "twofa_disabled"
    | "twofa_challenge_success"
    | "twofa_challenge_failed"
    | "twofa_backup_code_used"
    | "twofa_reset_by_partner"
    | "twofa_policy_updated"
    | "security_log_viewed",
  opts: {
    actorId?: string | null;
    actorLabel: string;
    ip: string;
    targetEmail?: string;
    targetUserId?: string;
    orgId?: string;
  },
): Promise<void> {
  try {
    // Tenancy: stamp the event with the org of the target (or actor) persona
    // so the security console can scope the auth trail per organization.
    // Unknown-account failures fall back to the schema default.
    let orgId = opts.orgId;
    if (!orgId) {
      const personaId = opts.targetUserId ?? opts.actorId;
      if (personaId) {
        const [p] = await db
          .select({ orgId: atelierUsers.orgId })
          .from(atelierUsers)
          .where(eq(atelierUsers.id, personaId));
        orgId = p?.orgId;
      }
      if (!orgId && opts.targetEmail) {
        const [c] = await db
          .select({ userId: atelierAuthCredentials.userId })
          .from(atelierAuthCredentials)
          .where(eq(atelierAuthCredentials.email, opts.targetEmail));
        if (c) {
          const [p] = await db
            .select({ orgId: atelierUsers.orgId })
            .from(atelierUsers)
            .where(eq(atelierUsers.id, c.userId));
          orgId = p?.orgId;
        }
      }
    }
    await db.insert(atelierAuditEvents).values({
      id: `audit_${randomUUID()}`,
      ...(orgId ? { orgId } : {}),
      entityType: "auth",
      entityId: opts.targetUserId ?? opts.actorId ?? "unknown",
      actorType: opts.actorId ? "human" : "system",
      actorId: opts.actorId ?? null,
      actorLabel: opts.actorLabel,
      action,
      payload: {
        ip: opts.ip,
        ...(opts.targetEmail ? { targetEmail: opts.targetEmail } : {}),
        ...(opts.targetUserId ? { targetUserId: opts.targetUserId } : {}),
      },
      payloadSummary:
        action === "login_success"
          ? `${opts.actorLabel} signed in`
          : action === "logout"
            ? `${opts.actorLabel} signed out`
            : action === "password_changed"
              ? `${opts.actorLabel} changed their password`
              : action === "password_change_failed"
                ? `Failed password change attempt by ${opts.actorLabel}`
                : action === "password_reset_by_partner"
                  ? `${opts.actorLabel} reset the password for ${opts.targetEmail ?? "a colleague"}`
                  : action === "password_reset_denied"
                    ? `Denied password reset attempt by ${opts.actorLabel}`
                    : action === "account_activated"
                      ? `${opts.actorLabel} activated their account`
                      : action === "account_activation_failed"
                        ? `Failed account activation attempt`
                        : action === "password_reset_requested"
                          ? `Password reset link requested for ${opts.targetEmail ?? opts.actorLabel}`
                          : action === "password_reset_completed"
                            ? `${opts.actorLabel} set a new password via reset link`
                            : action === "password_reset_failed"
                              ? `Failed password reset attempt`
                              : action === "account_locked"
                                ? `Account ${opts.targetEmail ?? opts.actorLabel} locked after repeated failed sign-ins`
                                : action === "account_unlocked"
                                  ? `${opts.actorLabel} unlocked account ${opts.targetEmail ?? ""}`.trim()
                                  : action === "twofa_enrolled"
                                    ? `${opts.actorLabel} enabled two-factor authentication`
                                    : action === "twofa_disabled"
                                      ? `${opts.actorLabel} disabled two-factor authentication`
                                      : action === "twofa_challenge_success"
                                        ? `${opts.actorLabel} passed a two-factor check`
                                        : action === "twofa_challenge_failed"
                                          ? `Failed two-factor code attempt by ${opts.actorLabel}`
                                          : action === "twofa_backup_code_used"
                                            ? `${opts.actorLabel} used a two-factor backup code`
                                            : action === "twofa_reset_by_partner"
                                              ? `${opts.actorLabel} reset two-factor authentication for ${opts.targetEmail ?? "a colleague"}`
                                              : action === "twofa_policy_updated"
                                                ? `${opts.actorLabel} updated the two-factor requirement policy`
                                                : action === "security_log_viewed"
                                                  ? `${opts.actorLabel} viewed the security audit console`
                                                  : `Failed sign-in attempt`,
    });
  } catch (err) {
    logger.warn({ err, action }, "auth audit write failed");
  }
}

// Precomputed once at boot; used to equalize timing for unknown emails.
const DUMMY_HASH = hashPassword("dummy-timing-equalizer");

const GENERIC_FAIL = {
  error: "invalid-credentials",
  message: "Incorrect email or password.",
};

router.post("/login", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({
      error: "rate-limited",
      message: "Too many sign-in attempts. Try again in a few minutes.",
    });
    return;
  }
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password) {
    res.status(400).json({ error: "invalid-body", message: "Email and password are required." });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, email));
  // Anti-enumeration: unknown emails still pay the scrypt cost so response
  // timing does not reveal whether an account exists.
  const passwordOk = cred
    ? verifyPassword(password, cred.passwordHash)
    : (verifyPassword(password, DUMMY_HASH), false);
  // Task #820 — locked account: even a CORRECT password is rejected with
  // the same generic 401 until the lock expires (no lockout enumeration).
  if (cred && isLockedOut(cred)) {
    await audit("login_failed", { actorLabel: email, ip, targetEmail: email });
    // Task #824 — keep counting attempts against a locked account so a
    // sustained brute force still surfaces as a burst alert.
    noteFailedLoginForAlerts({ email, ip, origin: trustedRequestOrigin(req) });
    res.status(401).json(GENERIC_FAIL);
    return;
  }
  if (!cred || !passwordOk) {
    if (cred) {
      // Persisted per-account failure counter → lockout at the threshold.
      // Atomic DB-side increment: concurrent bad guesses must each advance
      // the counter (a read-then-write here could be raced past the
      // threshold).
      const [bumped] = await db
        .update(atelierAuthCredentials)
        .set({
          failedLoginCount: sql`${atelierAuthCredentials.failedLoginCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(atelierAuthCredentials.email, cred.email))
        .returning({ failedLoginCount: atelierAuthCredentials.failedLoginCount });
      const lock = (bumped?.failedLoginCount ?? 0) >= LOCKOUT_THRESHOLD;
      if (lock) {
        await db
          .update(atelierAuthCredentials)
          .set({
            failedLoginCount: 0,
            lockedUntil: new Date(Date.now() + LOCKOUT_MS),
            updatedAt: new Date(),
          })
          .where(eq(atelierAuthCredentials.email, cred.email));
      }
      if (lock) {
        await audit("account_locked", {
          actorLabel: email,
          ip,
          targetEmail: cred.email,
          targetUserId: cred.userId,
        });
        // Task #824 — proactive founder alert. Fire-and-forget: alerting
        // must never delay or fail the login response.
        void sendSecurityAlert({
          trigger: "account_locked",
          targetEmail: cred.email,
          targetUserId: cred.userId,
          ip,
          origin: trustedRequestOrigin(req),
        }).catch((err) => logger.warn({ err }, "security alert (lockout) failed"));
      }
    }
    await audit("login_failed", { actorLabel: email || "unknown", ip, targetEmail: email });
    // Task #824 — sliding-window burst detection per account and per IP.
    noteFailedLoginForAlerts({ email, ip, origin: trustedRequestOrigin(req) });
    res.status(401).json(GENERIC_FAIL);
    return;
  }
  // Successful verification — clear any stale failure counter.
  if (cred.failedLoginCount > 0 || cred.lockedUntil) {
    await db
      .update(atelierAuthCredentials)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(atelierAuthCredentials.email, cred.email));
  }
  // Task #50 — deactivated leaver. Same generic error as a bad password so
  // a former colleague cannot distinguish "wrong password" from "disabled".
  if (cred.disabled) {
    await audit("login_failed", { actorLabel: email, ip, targetEmail: email });
    res.status(401).json(GENERIC_FAIL);
    return;
  }
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, cred.userId), isNull(atelierUsers.deletedAt)));
  if (!persona) {
    // Credential points at a missing/deleted employee — treat as invalid.
    await audit("login_failed", { actorLabel: email, ip, targetEmail: email });
    res.status(401).json(GENERIC_FAIL);
    return;
  }
  // Task #821 — two-step login: password OK but 2FA is enabled, so no
  // session yet. Mint a short-lived single-use challenge token; the client
  // finishes at POST /login/2fa with a TOTP or backup code.
  if (cred.totpEnabled && !isDemoUser({ userId: cred.userId, email })) {
    const { rawToken: challenge, expiresAt: challengeExpiresAt } = await mintLoginToken({
      email,
      userId: cred.userId,
      purpose: "2fa",
      ttlMs: TWOFA_CHALLENGE_TTL_MS,
    });
    res.json({
      twoFactorRequired: true,
      challenge,
      expiresAt: challengeExpiresAt.toISOString(),
    });
    return;
  }
  const { token, expiresAt } = await createSession(persona.id, email, {
    mustChangePassword: cred.mustChangePassword,
  });
  setSessionCookie(res, token, expiresAt);
  await audit("login_success", { actorId: persona.id, actorLabel: persona.name, ip });
  // Task #328 — the mobile app cannot use httpOnly cookies; it asks for the
  // session token in the response body and sends it back as a Bearer header.
  const isMobileClient = String(req.body?.client ?? "") === "mobile";
  res.json({
    user: personaToWire(persona),
    mustChangePassword: cred.mustChangePassword,
    // Task #59 — "joiner" (first-ever login) vs "reset" (partner reset);
    // drives the copy on the forced-change interstitial.
    mustChangeReason: cred.mustChangePassword ? (cred.mustChangeReason ?? "reset") : null,
    // Task #821 — org policy requires 2FA for this role but the user has
    // not enrolled yet: clients show an enrolment prompt after sign-in.
    ...((await twoFactorRequiredForRole(persona.orgId, persona.role)) &&
    !isDemoUser({ userId: cred.userId, email })
      ? { twoFactorEnrollRequired: true }
      : {}),
    ...(isMobileClient ? { token, expiresAt: expiresAt.toISOString() } : {}),
  });
});

// Task #328 — public launch-gate metadata for the mobile app. Mounted in
// front of the global auth gate on purpose: the app must be able to check
// the minimum supported version before anyone signs in.
router.get("/app-meta", (_req: Request, res: Response) => {
  res.json({
    minSupportedAppVersion: process.env.ATELIER_MIN_APP_VERSION ?? "1.0.0",
    serverTime: new Date().toISOString(),
  });
});

router.post("/logout", async (req: Request, res: Response) => {
  const token = sessionTokenFromRequest(req);
  if (token) {
    const session = await lookupSession(token);
    await destroySession(token);
    if (session) {
      await audit("logout", {
        actorId: session.userId,
        actorLabel: session.email,
        ip: req.ip ?? "unknown",
      });
    }
  }
  clearSessionCookie(res);
  // Also clear the persona cookies so no stale identity survives logout.
  res.clearCookie("atelier_persona", { path: "/" });
  res.clearCookie("salon_persona", { path: "/" });
  res.json({ ok: true });
});

// Task #2 — authenticated password change. Mounted before the global auth
// gate, so it verifies the session itself. Requires the current password
// (session-cookie theft alone can't rotate the credential), rate-limited
// with the same per-IP window as login.
router.post("/change-password", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  const token = sessionTokenFromRequest(req);
  const session = token ? await lookupSession(token) : null;
  if (!session) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
    return;
  }
  if (!rateLimitOk(ip)) {
    res.status(429).json({
      error: "rate-limited",
      message: "Too many attempts. Try again in a few minutes.",
    });
    return;
  }
  // Task #621 — the App Store review demo account is read-only; its
  // published password must never be rotated (the boot seed also repairs
  // it, but reject the attempt outright with the uniform demo error).
  if (isDemoUser({ userId: session.userId, email: session.email })) {
    res.status(403).json({
      error: "demo-read-only",
      message: "The demo account is read-only and cannot change its password.",
    });
    return;
  }
  const currentPassword = String(req.body?.currentPassword ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    res.status(400).json({
      error: "invalid-body",
      message: "Current and new password are required.",
    });
    return;
  }
  const policy = validateNewPassword(newPassword, { email: session.email });
  if (!policy.ok) {
    res.status(400).json({ error: policy.error, message: policy.message });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({
      error: "same-password",
      message: "New password must be different from the current one.",
    });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, session.email));
  if (!cred || cred.userId !== session.userId || !verifyPassword(currentPassword, cred?.passwordHash ?? DUMMY_HASH)) {
    await audit("password_change_failed", {
      actorId: session.userId,
      actorLabel: session.email,
      ip,
    });
    res.status(403).json({
      error: "wrong-password",
      message: "Current password is incorrect.",
    });
    return;
  }
  // Task #821 — step-up: 2FA-enabled users must present a fresh code.
  const stepUp = await requireFreshTotp(req, res, session);
  if (!stepUp.ok) return;
  await db
    .update(atelierAuthCredentials)
    .set({
      passwordHash: hashPassword(newPassword),
      userManaged: true,
      // Task #5 — a successful change satisfies any pending forced reset.
      mustChangePassword: false,
      mustChangeReason: null,
      updatedAt: new Date(),
    })
    .where(eq(atelierAuthCredentials.email, session.email));
  // Revoke every other session for this user (the current one stays valid),
  // so a stolen session elsewhere dies with the old password.
  if (token) {
    await revokeOtherSessions(session.userId, token);
    await clearSessionMustChange(token);
  }
  await audit("password_changed", {
    actorId: session.userId,
    actorLabel: session.email,
    ip,
  });
  res.json({ ok: true });
});

// ---- one-time account activation (new-joiner bootstrap) ----------------
// The create-login onboarding step mints a single-use, 72-hour token
// (SHA-256 hash stored server-side). The joiner opens the activation link
// and chooses their own password here — no temporary password ever exists.

async function lookupActivationToken(
  rawToken: string,
  purpose: "activation" | "reset" | "2fa" | "partner_registration",
) {
  if (!/^[0-9a-f]{64}$/.test(rawToken)) return null;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const [row] = await db
    .select()
    .from(atelierLoginActivationTokens)
    .where(eq(atelierLoginActivationTokens.tokenHash, tokenHash));
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  if (row.purpose !== purpose) return null;
  return row;
}

/**
 * Mint a single-use login token (Task #820). Invalidates any earlier unused
 * token of the same purpose for the same email, so only the newest link works.
 */
export async function mintLoginToken(args: {
  email: string;
  userId: string;
  purpose: "activation" | "reset" | "2fa" | "partner_registration";
  ttlMs: number;
  createdByUserId?: string | null;
}): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + args.ttlMs);
  await db.transaction(async (tx) => {
    await tx
      .update(atelierLoginActivationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(atelierLoginActivationTokens.email, args.email),
          eq(atelierLoginActivationTokens.purpose, args.purpose),
          isNull(atelierLoginActivationTokens.usedAt),
        ),
      );
    await tx.insert(atelierLoginActivationTokens).values({
      tokenHash,
      email: args.email,
      userId: args.userId,
      purpose: args.purpose,
      createdByUserId: args.createdByUserId ?? null,
      expiresAt,
    });
  });
  return { rawToken, expiresAt };
}

/** Best-effort absolute origin from the request (for building links). */
// Pre-auth: lets the activation page show which account is being activated.
// Tokens are 256-bit random values, so this is not enumerable.
router.get("/activate-info", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const row = await lookupActivationToken(String(req.query?.token ?? ""), "activation");
  if (!row) {
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This activation link is invalid, expired, or already used. Ask your onboarding contact for a new one.",
    });
    return;
  }
  res.json({ ok: true, email: row.email, expiresAt: row.expiresAt.toISOString() });
});

router.post("/activate", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const rawToken = String(req.body?.token ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  const row = await lookupActivationToken(rawToken, "activation");
  if (!row) {
    await audit("account_activation_failed", { actorLabel: "unknown", ip });
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This activation link is invalid, expired, or already used. Ask your onboarding contact for a new one.",
    });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, row.email));
  if (!cred || cred.userId !== row.userId || cred.disabled) {
    await audit("account_activation_failed", { actorLabel: row.email, ip, targetEmail: row.email });
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This activation link is no longer valid. Ask your onboarding contact for a new one.",
    });
    return;
  }
  const policy = validateNewPassword(newPassword, { email: row.email });
  if (!policy.ok) {
    res.status(400).json({ error: policy.error, message: policy.message });
    return;
  }
  await db.transaction(async (tx) => {
    // Consume the token first; the WHERE guard on used_at makes activation
    // single-use even under concurrent requests.
    const consumed = await tx
      .update(atelierLoginActivationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(atelierLoginActivationTokens.tokenHash, row.tokenHash),
          isNull(atelierLoginActivationTokens.usedAt),
        ),
      )
      .returning({ tokenHash: atelierLoginActivationTokens.tokenHash });
    if (consumed.length === 0) throw Object.assign(new Error("token-already-used"), { activationRace: true });
    await tx
      .update(atelierAuthCredentials)
      .set({
        passwordHash: hashPassword(newPassword),
        userManaged: true,
        mustChangePassword: false,
        mustChangeReason: null,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(atelierAuthCredentials.email, row.email));
  }).catch(async (err: unknown) => {
    if ((err as { activationRace?: boolean }).activationRace) {
      await audit("account_activation_failed", { actorLabel: row.email, ip, targetEmail: row.email });
      res.status(404).json({ error: "invalid-or-expired", message: "This activation link was already used." });
      return;
    }
    throw err;
  });
  if (res.headersSent) return;
  await audit("account_activated", {
    actorId: row.userId,
    actorLabel: row.email,
    ip,
    targetEmail: row.email,
    targetUserId: row.userId,
  });
  res.json({ ok: true, email: row.email });
});

// ---- partner self-registration (Task #874) ------------------------------
// A signed partner firm's invited user follows a single-use, 72-hour
// "partner_registration" token to a public page where they submit their
// firm's company legal details + bank details AND choose their password in
// one flow. Company details write to the firm record; bank details land as
// a PENDING change that finance must approve (maker-checker) before they
// become payable.

function maskIbanPublic(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const v = iban.replace(/\s+/g, "");
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

/** Resolve the alliance-partner user + live firm behind a registration token. */
async function partnerRegistrationContext(row: { userId: string; email: string }) {
  const [user] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, row.userId), isNull(atelierUsers.deletedAt)));
  if (!user || user.role !== "alliance_partner" || !user.partnerFirmId) return null;
  const [firm] = await db
    .select()
    .from(atelierPartnerFirms)
    .where(
      and(
        eq(atelierPartnerFirms.id, user.partnerFirmId),
        eq(atelierPartnerFirms.orgId, user.orgId),
        isNull(atelierPartnerFirms.deletedAt),
      ),
    );
  if (!firm) return null;
  return { user, firm };
}

// Pre-auth: lets the registration page show who/which firm is registering.
router.get("/partner-register-info", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const row = await lookupActivationToken(String(req.query?.token ?? ""), "partner_registration");
  const ctx = row ? await partnerRegistrationContext(row) : null;
  if (!row || !ctx) {
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This registration link is invalid, expired, or already used. Ask your Cognirise contact for a new one.",
    });
    return;
  }
  // Task #1172 — surface earlier document uploads + existing declared
  // contacts so the resumable registration page prefills.
  const docs = await db
    .select()
    .from(atelierPartnerFirmDocuments)
    .where(
      and(
        eq(atelierPartnerFirmDocuments.orgId, ctx.firm.orgId),
        eq(atelierPartnerFirmDocuments.partnerFirmId, ctx.firm.id),
        isNull(atelierPartnerFirmDocuments.deletedAt),
      ),
    )
    .orderBy(desc(atelierPartnerFirmDocuments.createdAt));
  res.json({
    ok: true,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
    firm: {
      name: ctx.firm.name,
      legalName: ctx.firm.legalName ?? null,
      registrationNumber: ctx.firm.registrationNumber ?? null,
      taxId: ctx.firm.taxId ?? null,
      registeredAddress: ctx.firm.registeredAddress ?? null,
      defaultCurrency: ctx.firm.bankCurrency ?? ctx.firm.defaultBillingCurrency ?? null,
    },
    documents: docs.map(partnerDocWire),
    contacts: (ctx.firm.contacts ?? []).map((c) => ({
      name: c.name,
      role: c.role ?? null,
      email: c.email ?? null,
    })),
  });
});

router.post("/partner-register", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const rawToken = String(req.body?.token ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  const company = (req.body?.company ?? {}) as Record<string, unknown>;
  const bank = (req.body?.bank ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max = 500): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? t.slice(0, max) : null;
  };
  const row = await lookupActivationToken(rawToken, "partner_registration");
  const ctx = row ? await partnerRegistrationContext(row) : null;
  if (!row || !ctx) {
    await audit("account_activation_failed", { actorLabel: "unknown", ip });
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This registration link is invalid, expired, or already used. Ask your Cognirise contact for a new one.",
    });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, row.email));
  if (!cred || cred.userId !== row.userId || cred.disabled) {
    await audit("account_activation_failed", { actorLabel: row.email, ip, targetEmail: row.email });
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This registration link is no longer valid. Ask your Cognirise contact for a new one.",
    });
    return;
  }
  // ---- validation (reject BEFORE consuming the token) --------------------
  const policy = validateNewPassword(newPassword, { email: row.email });
  if (!policy.ok) {
    res.status(400).json({ error: policy.error, message: policy.message });
    return;
  }
  const legalName = str(company.legalName, 300);
  if (!legalName) {
    res.status(400).json({ error: "invalid-body", message: "Company legal name is required." });
    return;
  }
  const registrationNumber = str(company.registrationNumber, 100);
  const taxId = str(company.taxId, 100);
  const registeredAddress = str(company.registeredAddress, 1000);
  const iban = String(bank.iban ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8,34}$/.test(iban)) {
    res.status(400).json({ error: "invalid-iban", message: "A valid IBAN (8–34 characters) is required." });
    return;
  }
  const swift = str(bank.swift, 20)?.toUpperCase() ?? null;
  const bankName = str(bank.bankName, 200);
  if (!bankName) {
    res.status(400).json({ error: "invalid-body", message: "Bank name is required." });
    return;
  }
  const currencyRaw = str(bank.currency, 10)?.toUpperCase() ?? null;
  if (!currencyRaw || !/^[A-Z]{3}$/.test(currencyRaw)) {
    res.status(400).json({ error: "invalid-currency", message: "Currency must be a 3-letter code (e.g. AED, USD)." });
    return;
  }
  // Task #1172 — optional declared contacts. These are the invited
  // partner's OWN people so they apply directly to the firm's contacts
  // jsonb (mirrors the internal PATCH /partners/firms contacts path,
  // including the roster promotion below).
  const rawContacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  if (rawContacts.length > 25) {
    res.status(400).json({ error: "invalid-body", message: "At most 25 contacts may be submitted." });
    return;
  }
  const parsedContacts: Array<{ name: string; role: string | null; email: string | null }> = [];
  for (const raw of rawContacts) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const name = str(c.name, 200);
    if (!name) {
      res.status(400).json({ error: "invalid-body", message: "Each contact requires a name." });
      return;
    }
    const email = str(c.email, 320);
    if (email && !email.includes("@")) {
      res.status(400).json({ error: "invalid-body", message: `Invalid email for contact "${name}".` });
      return;
    }
    parsedContacts.push({ name, role: str(c.role, 200), email });
  }
  const { user, firm } = ctx;
  const bankReqId = `pfbankreq_${randomBytes(9).toString("base64url")}`;
  await db.transaction(async (tx) => {
    // Consume the token first; the used_at guard makes registration
    // single-use even under concurrent requests.
    const consumed = await tx
      .update(atelierLoginActivationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(atelierLoginActivationTokens.tokenHash, row.tokenHash),
          isNull(atelierLoginActivationTokens.usedAt),
        ),
      )
      .returning({ tokenHash: atelierLoginActivationTokens.tokenHash });
    if (consumed.length === 0) throw Object.assign(new Error("token-already-used"), { activationRace: true });
    await tx
      .update(atelierAuthCredentials)
      .set({
        passwordHash: hashPassword(newPassword),
        userManaged: true,
        mustChangePassword: false,
        mustChangeReason: null,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(atelierAuthCredentials.email, row.email));
    // Task #1172 — merge declared contacts into the firm's contacts jsonb,
    // stamping each new entry with a person record + promoted PFR row via
    // the SHARED helper (single source of truth with the internal path).
    const firmPatch: Record<string, unknown> = {
      legalName,
      registrationNumber,
      taxId,
      registeredAddress,
      registrationCompletedAt: new Date(),
      registrationCompletedByUserId: user.id,
      updatedAt: new Date(),
    };
    if (parsedContacts.length > 0) {
      const { stampContactPersons } = await import("../atelier/partnersRoutes.js");
      const existing = firm.contacts ?? [];
      const additions = parsedContacts.map((c) => ({
        id: `pfc_${randomBytes(9).toString("base64url")}`,
        name: c.name,
        role: c.role,
        email: c.email,
        personId: null as string | null,
      }));
      const stamped = await stampContactPersons(tx, user, firm.id, additions);
      firmPatch.contacts = [...existing, ...stamped];
    }
    // Company legal details write straight to the firm record.
    await tx
      .update(atelierPartnerFirms)
      .set(firmPatch)
      .where(eq(atelierPartnerFirms.id, firm.id));
    // Bank details are NEVER applied directly — pending finance approval.
    // Supersede any earlier pending request from this firm (latest wins).
    await tx
      .update(atelierPartnerFirmBankChangeRequests)
      .set({ status: "rejected", decisionNote: "Superseded by a newer submission.", decidedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(atelierPartnerFirmBankChangeRequests.partnerFirmId, firm.id),
          eq(atelierPartnerFirmBankChangeRequests.status, "pending"),
          isNull(atelierPartnerFirmBankChangeRequests.deletedAt),
        ),
      );
    await tx.insert(atelierPartnerFirmBankChangeRequests).values({
      id: bankReqId,
      orgId: firm.orgId,
      partnerFirmId: firm.id,
      requestedByUserId: user.id,
      previousIbanMasked: maskIbanPublic(firm.bankIban),
      newIban: iban,
      newSwift: swift,
      newBankName: bankName,
      newCurrency: currencyRaw,
      reason: "Submitted via partner registration.",
    });
    await tx.insert(atelierAuditEvents).values([
      {
        id: `audit_${randomUUID()}`,
        entityType: "partner_firm",
        entityId: firm.id,
        actorType: "human",
        actorId: user.id,
        actorLabel: user.name,
        action: "partner_firm.registration.completed",
        payload: { userId: user.id, email: row.email, legalName, registrationNumber, taxId, contactsAdded: parsedContacts.length },
        payloadSummary: `${user.name} completed partner registration for ${firm.name} (company details submitted${parsedContacts.length ? `, ${parsedContacts.length} contact(s)` : ""}).`,
      },
      {
        id: `audit_${randomUUID()}`,
        entityType: "partner_firm",
        entityId: firm.id,
        actorType: "human",
        actorId: user.id,
        actorLabel: user.name,
        action: "partner_firm.bank_change.requested",
        payload: {
          bankChangeRequestId: bankReqId,
          newIbanMasked: maskIbanPublic(iban),
          newSwift: swift,
          newBankName: bankName,
          newCurrency: currencyRaw,
        },
        payloadSummary: `${user.name} submitted bank details for ${firm.name} — pending finance approval.`,
      },
    ]);
  }).catch(async (err: unknown) => {
    if ((err as { activationRace?: boolean }).activationRace) {
      await audit("account_activation_failed", { actorLabel: row.email, ip, targetEmail: row.email });
      res.status(404).json({ error: "invalid-or-expired", message: "This registration link was already used." });
      return;
    }
    throw err;
  });
  if (res.headersSent) return;
  await audit("account_activated", {
    actorId: row.userId,
    actorLabel: row.email,
    ip,
    targetEmail: row.email,
    targetUserId: row.userId,
  });
  res.json({ ok: true, email: row.email });
});

// ---- partner registration document uploads (Task #1172) -----------------
// Token-gated pre-auth document library for the resumable registration page.
// The activation token is VALIDATED (never consumed) on every call so the
// partner can upload/list/delete files across multiple visits before final
// submit. Bytes land in private object storage; the DB row starts pending
// and surfaces to internal reviewers. Uploads are rate-limited, capped at
// 10MB and restricted to a pdf/png/jpeg allowlist. The wire shape NEVER
// exposes the object-storage fileRef.

const PARTNER_DOC_KINDS = new Set([
  "trade_license",
  "certificate",
  "insurance",
  "vat_trn",
  "signatory_id",
  "other",
]);
const PARTNER_DOC_MIMES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const PARTNER_DOC_MAX_BYTES = 10 * 1024 * 1024;

/** Serialized firm-document row — never leaks fileRef / sha256. */
function partnerDocWire(d: typeof atelierPartnerFirmDocuments.$inferSelect) {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title ?? null,
    fileName: d.fileName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    issuedDate: d.issuedDate ?? null,
    expiryDate: d.expiryDate ?? null,
    reviewStatus: d.reviewStatus,
    reviewNote: d.reviewNote ?? null,
    uploadedVia: d.uploadedVia,
    createdAt: d.createdAt.toISOString(),
  };
}

const isoDateOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : t;
};

router.post(
  "/partner-register-upload",
  // Body parsing at 16mb is handled by the path-scoped parser mounted in
  // app.ts (BEFORE the default 100KB express.json), so no per-route parser.
  async (req: Request, res: Response) => {
    const ip = req.ip ?? "unknown";
    if (!rateLimitOk(ip)) {
      res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
      return;
    }
    const row = await lookupActivationToken(String(req.body?.token ?? ""), "partner_registration");
    const ctx = row ? await partnerRegistrationContext(row) : null;
    if (!row || !ctx) {
      res.status(404).json({
        error: "invalid-or-expired",
        message: "This registration link is invalid, expired, or already used.",
      });
      return;
    }
    const kind = String(req.body?.kind ?? "");
    if (!PARTNER_DOC_KINDS.has(kind)) {
      res.status(400).json({ error: "invalid-kind", allowed: [...PARTNER_DOC_KINDS] });
      return;
    }
    const fileName = String(req.body?.fileName ?? "").trim().slice(0, 300);
    if (!fileName) {
      res.status(400).json({ error: "invalid-body", message: "fileName is required." });
      return;
    }
    const mime = String(req.body?.mime ?? "").trim().toLowerCase();
    if (!PARTNER_DOC_MIMES.has(mime)) {
      res.status(400).json({ error: "invalid-mime", allowed: [...PARTNER_DOC_MIMES] });
      return;
    }
    const base64 = String(req.body?.base64 ?? "");
    if (!base64) {
      res.status(400).json({ error: "invalid-body", message: "base64 file content is required." });
      return;
    }
    const { storePartnerDocBytes, decodeBase64Strict, magicBytesMatchMime } = await import(
      "../../lib/partnerDocStorage.js"
    );
    const buf = decodeBase64Strict(base64);
    if (!buf) {
      res.status(400).json({ error: "invalid-base64" });
      return;
    }
    if (buf.byteLength === 0 || buf.byteLength > PARTNER_DOC_MAX_BYTES) {
      res.status(400).json({ error: "invalid-size", maxBytes: PARTNER_DOC_MAX_BYTES });
      return;
    }
    if (!magicBytesMatchMime(buf, mime)) {
      res.status(400).json({ error: "content-mismatch", message: "File content does not match the declared type." });
      return;
    }
    const title = (() => {
      const t = String(req.body?.title ?? "").trim();
      return t ? t.slice(0, 300) : null;
    })();
    const issuedDate = isoDateOrNull(req.body?.issuedDate);
    const expiryDate = isoDateOrNull(req.body?.expiryDate);
    const { user, firm } = ctx;
    const stored = await storePartnerDocBytes(buf, mime);
    const docId = `pfdoc_${randomBytes(9).toString("base64url")}`;
    const [created] = await db
      .insert(atelierPartnerFirmDocuments)
      .values({
        id: docId,
        orgId: firm.orgId,
        partnerFirmId: firm.id,
        kind,
        title,
        fileName,
        mime,
        fileRef: stored.fileRef,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        issuedDate,
        expiryDate,
        reviewStatus: "pending",
        uploadedByUserId: user.id,
        uploadedVia: "registration",
      })
      .returning();
    await db.insert(atelierAuditEvents).values({
      id: `audit_${randomUUID()}`,
      entityType: "partner_firm",
      entityId: firm.id,
      actorType: "human",
      actorId: user.id,
      actorLabel: user.name,
      action: "partner_firm.document.uploaded",
      payload: { documentId: docId, kind, fileName, sizeBytes: stored.sizeBytes, uploadedVia: "registration" },
      payloadSummary: `${user.name} uploaded ${kind} document "${fileName}" for ${firm.name} during registration.`,
    });
    res.status(201).json({ ok: true, document: partnerDocWire(created) });
  },
);

router.get("/partner-register-documents", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const row = await lookupActivationToken(String(req.query?.token ?? ""), "partner_registration");
  const ctx = row ? await partnerRegistrationContext(row) : null;
  if (!row || !ctx) {
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This registration link is invalid, expired, or already used.",
    });
    return;
  }
  const docs = await db
    .select()
    .from(atelierPartnerFirmDocuments)
    .where(
      and(
        eq(atelierPartnerFirmDocuments.orgId, ctx.firm.orgId),
        eq(atelierPartnerFirmDocuments.partnerFirmId, ctx.firm.id),
        isNull(atelierPartnerFirmDocuments.deletedAt),
      ),
    )
    .orderBy(desc(atelierPartnerFirmDocuments.createdAt));
  res.json({ ok: true, documents: docs.map(partnerDocWire) });
});

router.delete("/partner-register-document", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const row = await lookupActivationToken(String(req.body?.token ?? ""), "partner_registration");
  const ctx = row ? await partnerRegistrationContext(row) : null;
  if (!row || !ctx) {
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This registration link is invalid, expired, or already used.",
    });
    return;
  }
  const documentId = String(req.body?.documentId ?? "");
  const [doc] = await db
    .select()
    .from(atelierPartnerFirmDocuments)
    .where(
      and(
        eq(atelierPartnerFirmDocuments.id, documentId),
        eq(atelierPartnerFirmDocuments.orgId, ctx.firm.orgId),
        eq(atelierPartnerFirmDocuments.partnerFirmId, ctx.firm.id),
        isNull(atelierPartnerFirmDocuments.deletedAt),
      ),
    );
  // Only a still-pending doc that was uploaded via registration may be
  // removed here — reviewed / portal / internal docs are off-limits.
  if (!doc || doc.reviewStatus !== "pending" || doc.uploadedVia !== "registration") {
    res.status(404).json({ error: "document-not-found" });
    return;
  }
  await db
    .update(atelierPartnerFirmDocuments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(atelierPartnerFirmDocuments.id, doc.id));
  try {
    const { dropPartnerDocBytes } = await import("../../lib/partnerDocStorage.js");
    await dropPartnerDocBytes(doc.fileRef);
  } catch {
    // best-effort blob cleanup; the row is already soft-deleted
  }
  await db.insert(atelierAuditEvents).values({
    id: `audit_${randomUUID()}`,
    entityType: "partner_firm",
    entityId: ctx.firm.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorLabel: ctx.user.name,
    action: "partner_firm.document.uploaded",
    payload: { documentId: doc.id, removed: true },
    payloadSummary: `${ctx.user.name} removed a pending registration document (${doc.fileName}) for ${ctx.firm.name}.`,
  });
  res.json({ ok: true });
});

// ---- self-service forgot-password (Task #820) ---------------------------
// Public, rate-limited, non-enumerating: the response is always {ok:true}
// regardless of whether the email has a login. When it does, a single-use
// 60-minute reset link is emailed (system sender).

const RESET_TTL_SELF_MS = 60 * 60 * 1000;
const RESET_TTL_PARTNER_MS = 24 * 60 * 60 * 1000;

router.post("/forgot-password", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "invalid-body", message: "Email is required." });
    return;
  }
  // The uniform response goes out no matter what happens below.
  const respond = () =>
    res.json({
      ok: true,
      message: "If an account exists for that email, a reset link has been sent.",
    });
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, email));
  // Demo account is read-only — its password can never be reset.
  if (!cred || cred.disabled || isDemoUser({ userId: cred.userId, email })) {
    respond();
    return;
  }
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, cred.userId), isNull(atelierUsers.deletedAt)));
  if (!persona) {
    respond();
    return;
  }
  const { rawToken } = await mintLoginToken({
    email,
    userId: cred.userId,
    purpose: "reset",
    ttlMs: RESET_TTL_SELF_MS,
  });
  const origin = trustedRequestOrigin(req);
  const resetUrl = `${origin ?? ""}/reset-password?token=${rawToken}`;
  await audit("password_reset_requested", {
    actorLabel: email,
    ip,
    targetEmail: email,
    targetUserId: cred.userId,
  });
  // Best-effort email; never leaks delivery status to the caller.
  await sendPasswordResetEmail({
    to: email,
    firstName: persona.name?.trim().split(/\s+/)[0] ?? null,
    resetUrl,
    validity: "60 minutes",
    initiatedBy: "self",
    sender: "system",
  });
  respond();
});

// Pre-auth: lets the reset page show which account the link belongs to.
router.get("/reset-info", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const row = await lookupActivationToken(String(req.query?.token ?? ""), "reset");
  if (!row) {
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This reset link is invalid, expired, or already used. Request a new one from the sign-in page.",
    });
    return;
  }
  res.json({ ok: true, email: row.email, expiresAt: row.expiresAt.toISOString() });
});

router.post("/reset-password", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const rawToken = String(req.body?.token ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  const row = await lookupActivationToken(rawToken, "reset");
  if (!row) {
    await audit("password_reset_failed", { actorLabel: "unknown", ip });
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This reset link is invalid, expired, or already used. Request a new one from the sign-in page.",
    });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, row.email));
  if (!cred || cred.userId !== row.userId || cred.disabled) {
    await audit("password_reset_failed", { actorLabel: row.email, ip, targetEmail: row.email });
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This reset link is no longer valid. Request a new one from the sign-in page.",
    });
    return;
  }
  const policy = validateNewPassword(newPassword, { email: row.email });
  if (!policy.ok) {
    res.status(400).json({ error: policy.error, message: policy.message });
    return;
  }
  await db.transaction(async (tx) => {
    const consumed = await tx
      .update(atelierLoginActivationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(atelierLoginActivationTokens.tokenHash, row.tokenHash),
          isNull(atelierLoginActivationTokens.usedAt),
        ),
      )
      .returning({ tokenHash: atelierLoginActivationTokens.tokenHash });
    if (consumed.length === 0) throw Object.assign(new Error("token-already-used"), { activationRace: true });
    await tx
      .update(atelierAuthCredentials)
      .set({
        passwordHash: hashPassword(newPassword),
        userManaged: true,
        mustChangePassword: false,
        mustChangeReason: null,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(atelierAuthCredentials.email, row.email));
  }).catch(async (err: unknown) => {
    if ((err as { activationRace?: boolean }).activationRace) {
      await audit("password_reset_failed", { actorLabel: row.email, ip, targetEmail: row.email });
      res.status(404).json({ error: "invalid-or-expired", message: "This reset link was already used." });
      return;
    }
    throw err;
  });
  if (res.headersSent) return;
  // A completed reset invalidates every existing session for the account.
  await revokeAllSessions(row.userId);
  await audit("password_reset_completed", {
    actorId: row.userId,
    actorLabel: row.email,
    ip,
    targetEmail: row.email,
    targetUserId: row.userId,
  });
  res.json({ ok: true, email: row.email });
});

router.get("/session", async (req: Request, res: Response) => {
  const token = sessionTokenFromRequest(req);
  const session = token ? await lookupSession(token) : null;
  if (!session) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, session.userId), isNull(atelierUsers.deletedAt)));
  if (!persona) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  // Task #59 — when a change is pending, resolve why ("joiner" first-ever
  // login vs "reset" partner reset) so the interstitial shows the right copy.
  let mustChangeReason: string | null = null;
  if (session.mustChangePassword) {
    const [cred] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, session.email));
    mustChangeReason = cred?.mustChangeReason ?? "reset";
  }
  res.json({
    user: personaToWire(persona),
    expiresAt: session.expiresAt.toISOString(),
    mustChangePassword: session.mustChangePassword,
    mustChangeReason,
  });
});

// ---------------------------------------------------------------------------
// Task #5 — partner-initiated password reset ("colleague locked out").
// Founding partners only. Generates a temporary password, flags the
// credential so the next login forces a change, revokes every session of
// the reset user, and writes an audit event.
// ---------------------------------------------------------------------------

/** Resolve the session AND require a founding_partner persona. */
async function requireFoundingPartner(
  req: Request,
  res: Response,
): Promise<{ userId: string; email: string; name: string; orgId: string } | null> {
  const token = sessionTokenFromRequest(req);
  const session = token ? await lookupSession(token) : null;
  if (!session) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
    return null;
  }
  // A session that is itself pending a forced password change must not be
  // able to reset anyone else's password.
  if (session.mustChangePassword) {
    res.status(403).json({
      error: "password-change-required",
      message: "You must change your temporary password before continuing.",
    });
    return null;
  }
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, session.userId), isNull(atelierUsers.deletedAt)));
  if (!persona || persona.role !== "founding_partner") {
    await audit("password_reset_denied", {
      actorId: session.userId,
      actorLabel: persona?.name ?? session.email,
      ip: req.ip ?? "unknown",
    });
    res.status(403).json({
      error: "forbidden",
      message: "Only founding partners can reset a colleague's password.",
    });
    return null;
  }
  return { userId: session.userId, email: session.email, name: persona.name, orgId: persona.orgId };
}

// Who can I reset? Every credential except my own, with the person's name.
router.get("/reset-targets", async (req: Request, res: Response) => {
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  const creds = await db.select().from(atelierAuthCredentials);
  const now = Date.now();
  const targets = [];
  for (const c of creds) {
    if (c.email === actor.email) continue;
    // Demo account is read-only and never a reset/unlock target.
    if (isDemoUser({ userId: c.userId, email: c.email })) continue;
    const [persona] = await db
      .select()
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, c.userId), isNull(atelierUsers.deletedAt)));
    if (!persona) continue;
    // Pending = an unused, unexpired reset link exists for this email.
    const tokenRows = await db
      .select()
      .from(atelierLoginActivationTokens)
      .where(
        and(
          eq(atelierLoginActivationTokens.email, c.email),
          eq(atelierLoginActivationTokens.purpose, "reset"),
          isNull(atelierLoginActivationTokens.usedAt),
        ),
      );
    const pendingReset =
      c.mustChangePassword || tokenRows.some((t) => t.expiresAt.getTime() > now);
    targets.push({
      email: c.email,
      name: persona.name,
      title: persona.title,
      pendingReset,
      locked: isLockedOut(c),
      lockedUntil: isLockedOut(c) ? c.lockedUntil?.toISOString() : null,
      twoFactorEnabled: c.totpEnabled,
    });
  }
  res.json({ targets });
});

router.post("/reset-colleague-password", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  if (!rateLimitOk(ip)) {
    res.status(429).json({
      error: "rate-limited",
      message: "Too many attempts. Try again in a few minutes.",
    });
    return;
  }
  const targetEmail = String(req.body?.email ?? "").trim().toLowerCase();
  if (!targetEmail) {
    res.status(400).json({ error: "invalid-body", message: "Target email is required." });
    return;
  }
  if (targetEmail === actor.email) {
    res.status(400).json({
      error: "cannot-reset-self",
      message: "You cannot reset your own password this way — use Change password instead.",
    });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, targetEmail));
  if (!cred) {
    res.status(404).json({ error: "not-found", message: "No login exists for that email." });
    return;
  }
  // The published demo credential is force-repaired read-only — a partner
  // reset would brick the App Store review login until the next boot.
  if (isDemoUser({ userId: cred.userId, email: targetEmail })) {
    res.status(403).json({ error: "demo-account", message: "The demo account's password cannot be reset." });
    return;
  }
  // Task #821 — step-up: partners with 2FA must present a fresh code.
  {
    const token = sessionTokenFromRequest(req);
    const session = token ? await lookupSession(token) : null;
    if (!session) {
      res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
      return;
    }
    const stepUp = await requireFreshTotp(req, res, session);
    if (!stepUp.ok) return;
  }
  // Task #820 — no more on-screen temporary passwords. The old password is
  // invalidated (unusable random hash), every session dies, and the target
  // gets a single-use 24-hour reset link (emailed when delivery works; the
  // link is also returned once so the partner can share it securely).
  await db
    .update(atelierAuthCredentials)
    .set({
      passwordHash: hashPassword(randomBytes(32).toString("hex")),
      // user_managed=true: the boot seed must never overwrite this hash.
      userManaged: true,
      mustChangePassword: false,
      mustChangeReason: null,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(atelierAuthCredentials.email, targetEmail));
  await revokeAllSessions(cred.userId);
  const { rawToken, expiresAt } = await mintLoginToken({
    email: targetEmail,
    userId: cred.userId,
    purpose: "reset",
    ttlMs: RESET_TTL_PARTNER_MS,
    createdByUserId: actor.userId,
  });
  const origin = trustedRequestOrigin(req);
  const resetUrl = `${origin ?? ""}/reset-password?token=${rawToken}`;
  const [targetPersona] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, cred.userId));
  const emailResult = await sendPasswordResetEmail({
    to: targetEmail,
    firstName: targetPersona?.name?.trim().split(/\s+/)[0] ?? null,
    resetUrl,
    validity: "24 hours",
    initiatedBy: "partner",
    sender: { actor: { name: actor.name, email: actor.email } },
  });
  await audit("password_reset_by_partner", {
    actorId: actor.userId,
    actorLabel: actor.name,
    ip,
    targetEmail,
    targetUserId: cred.userId,
  });
  res.json({
    ok: true,
    resetUrl,
    expiresAt: expiresAt.toISOString(),
    resetValidity: "24 hours",
    email: { status: emailResult.status, note: emailResult.note },
  });
});

// Task #820 — partner unlock: clears a lockout without touching the password.
router.post("/unlock-account", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  const targetEmail = String(req.body?.email ?? "").trim().toLowerCase();
  if (!targetEmail) {
    res.status(400).json({ error: "invalid-body", message: "Target email is required." });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, targetEmail));
  if (!cred) {
    res.status(404).json({ error: "not-found", message: "No login exists for that email." });
    return;
  }
  // The demo credential is managed exclusively by the boot repair.
  if (isDemoUser({ userId: cred.userId, email: targetEmail })) {
    res.status(403).json({ error: "demo-account", message: "The demo account cannot be managed here." });
    return;
  }
  // Task #821 — step-up: partners with 2FA must present a fresh code.
  {
    const token = sessionTokenFromRequest(req);
    const session = token ? await lookupSession(token) : null;
    if (!session) {
      res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
      return;
    }
    const stepUp = await requireFreshTotp(req, res, session);
    if (!stepUp.ok) return;
  }
  await db
    .update(atelierAuthCredentials)
    .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
    .where(eq(atelierAuthCredentials.email, targetEmail));
  await audit("account_unlocked", {
    actorId: actor.userId,
    actorLabel: actor.name,
    ip,
    targetEmail,
    targetUserId: cred.userId,
  });
  res.json({ ok: true });
});


// ===========================================================================
// Task #821 — two-factor authentication (TOTP + backup codes)
// ===========================================================================

const TWOFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Org 2FA policy — stored in atelier_admin_settings value.require2faRoles:
 * [] (off), ["*"] (everyone), or a list of persona roles.
 */
async function getRequire2faRoles(orgId: string): Promise<string[]> {
  const [row] = await db
    .select()
    .from(atelierAdminSettings)
    .where(eq(atelierAdminSettings.orgId, orgId));
  const value = (row?.value ?? {}) as { require2faRoles?: unknown };
  return Array.isArray(value.require2faRoles)
    ? value.require2faRoles.filter((r): r is string => typeof r === "string")
    : [];
}

async function twoFactorRequiredForRole(orgId: string, role: string): Promise<boolean> {
  const roles = await getRequire2faRoles(orgId);
  return roles.includes("*") || roles.includes(role);
}

/** Resolve the calling session + its credential row (shared by 2FA routes). */
async function requireSessionCred(req: Request, res: Response) {
  const token = sessionTokenFromRequest(req);
  const session = token ? await lookupSession(token) : null;
  if (!session || !token) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
    return null;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, session.email));
  if (!cred || cred.userId !== session.userId) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
    return null;
  }
  return { token, session, cred };
}

// Current user's 2FA state (drives the profile security card).
router.get("/2fa/status", async (req: Request, res: Response) => {
  const ctx = await requireSessionCred(req, res);
  if (!ctx) return;
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, ctx.session.userId), isNull(atelierUsers.deletedAt)));
  const required = persona
    ? await twoFactorRequiredForRole(persona.orgId, persona.role)
    : false;
  res.json({
    enabled: ctx.cred.totpEnabled,
    backupCodesRemaining: backupCodesRemaining(ctx.cred.totpBackupCodes),
    required: required && !isDemoUser({ userId: ctx.cred.userId, email: ctx.cred.email }),
  });
});

// Step 1 of enrolment: verify the current password, mint a secret (stored
// encrypted, NOT yet enabled) and return the QR payload + manual key.
router.post("/2fa/enroll", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const ctx = await requireSessionCred(req, res);
  if (!ctx) return;
  if (isDemoUser({ userId: ctx.cred.userId, email: ctx.cred.email })) {
    res.status(403).json({ error: "demo-read-only", message: "The demo account cannot enrol in two-factor authentication." });
    return;
  }
  if (ctx.cred.totpEnabled) {
    res.status(409).json({ error: "already-enabled", message: "Two-factor authentication is already enabled." });
    return;
  }
  const currentPassword = String(req.body?.currentPassword ?? "");
  if (!currentPassword || !verifyPassword(currentPassword, ctx.cred.passwordHash)) {
    res.status(403).json({ error: "wrong-password", message: "Current password is incorrect." });
    return;
  }
  const secret = generateTotpSecret();
  await db
    .update(atelierAuthCredentials)
    .set({ totpSecretEnc: encryptTotpSecret(secret), totpLastStep: null, updatedAt: new Date() })
    .where(eq(atelierAuthCredentials.email, ctx.cred.email));
  res.json({
    ok: true,
    manualKey: secret,
    otpauthUrl: otpauthUrl({ secretB32: secret, email: ctx.cred.email }),
  });
});

// Step 2 of enrolment: first valid code flips 2FA on and returns the
// one-time backup codes (shown exactly once, stored only as hashes).
router.post("/2fa/confirm", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const ctx = await requireSessionCred(req, res);
  if (!ctx) return;
  if (ctx.cred.totpEnabled || !ctx.cred.totpSecretEnc) {
    res.status(409).json({ error: "no-pending-enrolment", message: "Start enrolment first." });
    return;
  }
  const secret = decryptTotpSecret(ctx.cred.totpSecretEnc);
  const step = secret ? verifyTotpCode(secret, String(req.body?.code ?? ""), null) : null;
  if (step == null) {
    await audit("twofa_challenge_failed", { actorId: ctx.session.userId, actorLabel: ctx.session.email, ip });
    res.status(403).json({ error: "invalid-code", message: "That code is incorrect. Check your authenticator app and try again." });
    return;
  }
  const { codes, records } = generateBackupCodes();
  await db
    .update(atelierAuthCredentials)
    .set({ totpEnabled: true, totpLastStep: step, totpBackupCodes: records, updatedAt: new Date() })
    .where(eq(atelierAuthCredentials.email, ctx.cred.email));
  await markSessionTotpVerified(ctx.token);
  await audit("twofa_enrolled", { actorId: ctx.session.userId, actorLabel: ctx.session.email, ip });
  res.json({ ok: true, backupCodes: codes });
});

// Disable 2FA — requires the current password AND a fresh code (step-up).
router.post("/2fa/disable", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const ctx = await requireSessionCred(req, res);
  if (!ctx) return;
  if (!ctx.cred.totpEnabled) {
    res.status(409).json({ error: "not-enabled", message: "Two-factor authentication is not enabled." });
    return;
  }
  const currentPassword = String(req.body?.currentPassword ?? "");
  if (!currentPassword || !verifyPassword(currentPassword, ctx.cred.passwordHash)) {
    res.status(403).json({ error: "wrong-password", message: "Current password is incorrect." });
    return;
  }
  const stepUp = await requireFreshTotp(req, res, ctx.session);
  if (!stepUp.ok) return;
  await db
    .update(atelierAuthCredentials)
    .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, totpBackupCodes: null, updatedAt: new Date() })
    .where(eq(atelierAuthCredentials.email, ctx.cred.email));
  await audit("twofa_disabled", { actorId: ctx.session.userId, actorLabel: ctx.session.email, ip });
  res.json({ ok: true });
});

// Explicit step-up verification: stamps the session as freshly verified.
router.post("/2fa/verify", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const ctx = await requireSessionCred(req, res);
  if (!ctx) return;
  if (!ctx.cred.totpEnabled) {
    res.status(409).json({ error: "not-enabled", message: "Two-factor authentication is not enabled." });
    return;
  }
  const result = await verifyCredentialCode(ctx.cred, String(req.body?.code ?? ""));
  if (!result.ok) {
    await audit("twofa_challenge_failed", { actorId: ctx.session.userId, actorLabel: ctx.session.email, ip });
    res.status(403).json({ error: "invalid-code", message: "That code is incorrect or already used." });
    return;
  }
  await markSessionTotpVerified(ctx.token);
  if (result.method === "backup") {
    await audit("twofa_backup_code_used", { actorId: ctx.session.userId, actorLabel: ctx.session.email, ip });
  }
  await audit("twofa_challenge_success", { actorId: ctx.session.userId, actorLabel: ctx.session.email, ip });
  res.json({ ok: true });
});

// Step 2 of login. Single-use challenge token + TOTP/backup code -> session.
// Wrong codes share the SAME persisted lockout counter as password attempts.
router.post("/login/2fa", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many sign-in attempts. Try again in a few minutes." });
    return;
  }
  const challenge = String(req.body?.challenge ?? "");
  const code = String(req.body?.code ?? "");
  const row = await lookupActivationToken(challenge, "2fa");
  if (!row) {
    res.status(401).json({ error: "challenge-expired", message: "Sign-in expired. Enter your email and password again." });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, row.email));
  if (!cred || cred.disabled || !cred.totpEnabled || isLockedOut(cred)) {
    await audit("login_failed", { actorLabel: row.email, ip, targetEmail: row.email });
    // Task #824 — hammering a locked/disabled 2FA challenge still counts
    // toward the failed-sign-in burst detector.
    noteFailedLoginForAlerts({ email: row.email, ip, origin: trustedRequestOrigin(req) });
    res.status(401).json(GENERIC_FAIL);
    return;
  }
  const result = await verifyCredentialCode(cred, code);
  if (!result.ok) {
    // Shared lockout counter with password attempts (atomic increment).
    const [bumped] = await db
      .update(atelierAuthCredentials)
      .set({
        failedLoginCount: sql`${atelierAuthCredentials.failedLoginCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(atelierAuthCredentials.email, cred.email))
      .returning({ failedLoginCount: atelierAuthCredentials.failedLoginCount });
    if ((bumped?.failedLoginCount ?? 0) >= LOCKOUT_THRESHOLD) {
      await db
        .update(atelierAuthCredentials)
        .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS), updatedAt: new Date() })
        .where(eq(atelierAuthCredentials.email, cred.email));
      await audit("account_locked", { actorLabel: row.email, ip, targetEmail: cred.email, targetUserId: cred.userId });
      // Task #824 — a lockout via wrong 2FA codes is the same security event
      // as a password lockout: alert founders (fire-and-forget, debounced).
      void sendSecurityAlert({
        trigger: "account_locked",
        targetEmail: cred.email,
        targetUserId: cred.userId,
        ip,
        origin: trustedRequestOrigin(req),
        detail: "The lockout was triggered by repeated invalid two-factor codes.",
      }).catch((err) => logger.warn({ err }, "security alert (2fa lockout) failed"));
    }
    await audit("twofa_challenge_failed", { actorLabel: row.email, ip, targetEmail: row.email });
    // Task #824 — invalid 2FA submissions count toward burst detection too.
    noteFailedLoginForAlerts({ email: row.email, ip, origin: trustedRequestOrigin(req) });
    res.status(401).json({ error: "invalid-code", message: "That code is incorrect or already used." });
    return;
  }
  // Consume the challenge only on success (retries allowed until expiry).
  // Conditional on usedAt IS NULL: of two concurrent valid submissions only
  // one claims the challenge and mints a session.
  const consumed = await db
    .update(atelierLoginActivationTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(atelierLoginActivationTokens.tokenHash, row.tokenHash),
        isNull(atelierLoginActivationTokens.usedAt),
      ),
    )
    .returning({ tokenHash: atelierLoginActivationTokens.tokenHash });
  if (consumed.length === 0) {
    res.status(401).json({ error: "challenge-expired", message: "Sign-in expired. Enter your email and password again." });
    return;
  }
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, cred.userId), isNull(atelierUsers.deletedAt)));
  if (!persona) {
    await audit("login_failed", { actorLabel: row.email, ip, targetEmail: row.email });
    res.status(401).json(GENERIC_FAIL);
    return;
  }
  if (cred.failedLoginCount > 0 || cred.lockedUntil) {
    await db
      .update(atelierAuthCredentials)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(atelierAuthCredentials.email, cred.email));
  }
  const { token, expiresAt } = await createSession(persona.id, row.email, {
    mustChangePassword: cred.mustChangePassword,
    totpVerifiedAt: new Date(),
  });
  setSessionCookie(res, token, expiresAt);
  if (result.method === "backup") {
    await audit("twofa_backup_code_used", { actorId: persona.id, actorLabel: persona.name, ip });
  }
  await audit("twofa_challenge_success", { actorId: persona.id, actorLabel: persona.name, ip });
  await audit("login_success", { actorId: persona.id, actorLabel: persona.name, ip });
  const isMobileClient = String(req.body?.client ?? "") === "mobile";
  res.json({
    user: personaToWire(persona),
    mustChangePassword: cred.mustChangePassword,
    mustChangeReason: cred.mustChangePassword ? (cred.mustChangeReason ?? "reset") : null,
    ...(isMobileClient ? { token, expiresAt: expiresAt.toISOString() } : {}),
  });
});

// Partner-initiated 2FA reset for a locked-out colleague (step-up gated).
router.post("/reset-colleague-2fa", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  const targetEmail = String(req.body?.email ?? "").trim().toLowerCase();
  if (!targetEmail) {
    res.status(400).json({ error: "invalid-body", message: "Target email is required." });
    return;
  }
  if (targetEmail === actor.email) {
    res.status(400).json({ error: "cannot-reset-self", message: "Disable your own two-factor from your profile instead." });
    return;
  }
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, targetEmail));
  if (!cred) {
    res.status(404).json({ error: "not-found", message: "No login exists for that email." });
    return;
  }
  if (isDemoUser({ userId: cred.userId, email: targetEmail })) {
    res.status(403).json({ error: "demo-account", message: "The demo account cannot be managed here." });
    return;
  }
  if (!cred.totpEnabled) {
    res.status(409).json({ error: "not-enabled", message: "That account does not have two-factor enabled." });
    return;
  }
  const token = sessionTokenFromRequest(req);
  const session = token ? await lookupSession(token) : null;
  if (!session) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
    return;
  }
  const stepUp = await requireFreshTotp(req, res, session);
  if (!stepUp.ok) return;
  await db
    .update(atelierAuthCredentials)
    .set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, totpBackupCodes: null, updatedAt: new Date() })
    .where(eq(atelierAuthCredentials.email, targetEmail));
  // Their sessions die with the second factor: a fresh login (password-only
  // now) is required, and the enrolment prompt fires again if policy applies.
  await revokeAllSessions(cred.userId);
  await audit("twofa_reset_by_partner", {
    actorId: actor.userId,
    actorLabel: actor.name,
    ip,
    targetEmail,
    targetUserId: cred.userId,
  });
  // Task #824 — 2FA resets are rare and high-signal: tell every founder
  // (including ones who didn't perform it). Fire-and-forget.
  void sendSecurityAlert({
    trigger: "twofa_reset_by_partner",
    targetEmail,
    targetUserId: cred.userId,
    ip,
    origin: trustedRequestOrigin(req),
    detail: `The reset was performed by ${actor.name}.`,
  }).catch((err) => logger.warn({ err }, "security alert (2fa reset) failed"));
  res.json({ ok: true });
});

// Org-wide / per-role 2FA requirement policy (founding partners only).
router.get("/2fa/policy", async (req: Request, res: Response) => {
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, actor.userId));
  if (!persona) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
    return;
  }
  res.json({ require2faRoles: await getRequire2faRoles(persona.orgId) });
});

router.post("/2fa/policy", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  const roles = req.body?.require2faRoles;
  if (
    !Array.isArray(roles) ||
    roles.some((r) => typeof r !== "string" || r.length > 40) ||
    roles.length > 20
  ) {
    res.status(400).json({ error: "invalid-body", message: "require2faRoles must be a list of role names (or [\"*\"] for everyone)." });
    return;
  }
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, actor.userId));
  if (!persona) {
    res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierAdminSettings)
    .where(eq(atelierAdminSettings.orgId, persona.orgId));
  const value = { ...((row?.value ?? {}) as Record<string, unknown>), require2faRoles: roles };
  if (row) {
    await db
      .update(atelierAdminSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(atelierAdminSettings.orgId, persona.orgId));
  } else {
    await db.insert(atelierAdminSettings).values({ orgId: persona.orgId, value });
  }
  await audit("twofa_policy_updated", { actorId: actor.userId, actorLabel: actor.name, ip });
  res.json({ require2faRoles: roles });
});


// ---------------------------------------------------------------------------
// Task #822 — Security audit console (founding partner only, READ-ONLY).
// Two views over atelier_audit_events: the auth trail (entityType="auth")
// and the org-wide business action trail (everything else). Filterable by
// person, event type and date range; paginated; CSV export of the filtered
// view. Access to the console is itself audited (debounced per actor).
// ---------------------------------------------------------------------------

const SECURITY_LOG_MAX_LIMIT = 100;
const SECURITY_LOG_EXPORT_CAP = 5000;
const SECURITY_LOG_VIEW_AUDIT_DEBOUNCE_MS = 10 * 60 * 1000;

type SecurityLogFilters = {
  tab: "auth" | "actions";
  actor: string;
  action: string;
  from: Date | null;
  to: Date | null;
};

function parseSecurityLogFilters(req: Request): SecurityLogFilters | null {
  const tab = String(req.query?.tab ?? "auth");
  if (tab !== "auth" && tab !== "actions") return null;
  const parseDate = (v: unknown): Date | null | undefined => {
    if (v == null || v === "") return null;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const from = parseDate(req.query?.from);
  const to = parseDate(req.query?.to);
  if (from === undefined || to === undefined) return null;
  return {
    tab,
    actor: String(req.query?.actor ?? "").trim(),
    action: String(req.query?.action ?? "").trim(),
    from,
    to: to ? new Date(to.getTime() + (String(req.query?.to).length <= 10 ? 24 * 60 * 60 * 1000 - 1 : 0)) : null,
  };
}

function securityLogConditions(f: SecurityLogFilters, orgId: string) {
  const conds = [isNull(atelierAuditEvents.deletedAt)];
  if (f.tab === "auth") {
    conds.push(eq(atelierAuditEvents.entityType, "auth"));
    conds.push(eq(atelierAuditEvents.orgId, orgId));
  } else {
    conds.push(ne(atelierAuditEvents.entityType, "auth"));
    conds.push(eq(atelierAuditEvents.orgId, orgId));
  }
  if (f.action) conds.push(eq(atelierAuditEvents.action, f.action));
  if (f.from) conds.push(gte(atelierAuditEvents.ts, f.from));
  if (f.to) conds.push(lte(atelierAuditEvents.ts, f.to));
  if (f.actor) {
    const like = `%${f.actor.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(
      sql`(${atelierAuditEvents.actorLabel} ILIKE ${like} OR ${atelierAuditEvents.actorId} = ${f.actor} OR ${atelierAuditEvents.payload}->>'targetEmail' ILIKE ${like})`,
    );
  }
  return and(...conds);
}

function securityLogRowToWire(row: typeof atelierAuditEvents.$inferSelect) {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.payloadSummary,
    ip: typeof payload.ip === "string" ? payload.ip : null,
    targetEmail: typeof payload.targetEmail === "string" ? payload.targetEmail : null,
  };
}

/** Audit console access, debounced so pagination doesn't flood the trail. */
async function auditSecurityLogView(actor: { userId: string; name: string }, ip: string, tab: string): Promise<void> {
  const [recent] = await db
    .select({ ts: atelierAuditEvents.ts })
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.action, "security_log_viewed"),
        eq(atelierAuditEvents.actorId, actor.userId),
        gte(atelierAuditEvents.ts, new Date(Date.now() - SECURITY_LOG_VIEW_AUDIT_DEBOUNCE_MS)),
      ),
    )
    .limit(1);
  if (recent) return;
  await audit("security_log_viewed", { actorId: actor.userId, actorLabel: actor.name, ip });
  void tab;
}

router.get("/security-log", async (req: Request, res: Response) => {
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  const filters = parseSecurityLogFilters(req);
  if (!filters) {
    res.status(400).json({ error: "invalid-query", message: "Invalid tab or date filter." });
    return;
  }
  const limit = Math.min(Math.max(parseInt(String(req.query?.limit ?? "50"), 10) || 50, 1), SECURITY_LOG_MAX_LIMIT);
  const offset = Math.max(parseInt(String(req.query?.offset ?? "0"), 10) || 0, 0);
  const where = securityLogConditions(filters, actor.orgId);

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(atelierAuditEvents).where(where).orderBy(desc(atelierAuditEvents.ts)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(atelierAuditEvents).where(where),
  ]);

  // Distinct action values (for the filter dropdown) — only on the first page
  // and without the action filter applied, so the list stays complete.
  let actions: string[] | undefined;
  if (offset === 0) {
    const base = securityLogConditions({ ...filters, action: "" }, actor.orgId);
    const rowsA = await db
      .selectDistinct({ action: atelierAuditEvents.action })
      .from(atelierAuditEvents)
      .where(base)
      .orderBy(atelierAuditEvents.action)
      .limit(200);
    actions = rowsA.map((r) => r.action);
    await auditSecurityLogView(actor, req.ip ?? "unknown", filters.tab);
  }

  res.json({ events: rows.map(securityLogRowToWire), total, limit, offset, ...(actions ? { actions } : {}) });
});

router.get("/security-log/export.csv", async (req: Request, res: Response) => {
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  const filters = parseSecurityLogFilters(req);
  if (!filters) {
    res.status(400).json({ error: "invalid-query", message: "Invalid tab or date filter." });
    return;
  }
  const rows = await db
    .select()
    .from(atelierAuditEvents)
    .where(securityLogConditions(filters, actor.orgId))
    .orderBy(desc(atelierAuditEvents.ts))
    .limit(SECURITY_LOG_EXPORT_CAP);

  const esc = (v: unknown): string => {
    const t = v == null ? "" : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const header = "timestamp,action,actor_type,actor,actor_id,ip,target_email,entity_type,entity_id,summary";
  const lines = rows.map((r) => {
    const w = securityLogRowToWire(r);
    return [w.ts, w.action, w.actorType, w.actorLabel, w.actorId ?? "", w.ip ?? "", w.targetEmail ?? "", w.entityType, w.entityId, w.summary ?? ""].map(esc).join(",");
  });
  await audit("security_log_viewed", {
    actorId: actor.userId,
    actorLabel: actor.name,
    ip: req.ip ?? "unknown",
  });
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    contentDispositionFilename("attachment", `security-log-${filters.tab}-${new Date().toISOString().slice(0, 10)}.csv`),
  );
  res.send([header, ...lines].join("\n") + "\n");
});

export default router;
