import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  atelierAuthCredentials,
  atelierUsers,
  atelierAuditEvents,
  atelierLoginActivationTokens,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
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
} from "../../lib/auth/session";
import { personaToWire } from "../atelier/personaCookie";
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
    | "account_activation_failed",
  opts: {
    actorId?: string | null;
    actorLabel: string;
    ip: string;
    targetEmail?: string;
    targetUserId?: string;
  },
): Promise<void> {
  try {
    await db.insert(atelierAuditEvents).values({
      id: `audit_${randomUUID()}`,
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
  if (!cred || !passwordOk) {
    await audit("login_failed", { actorLabel: email || "unknown", ip });
    res.status(401).json(GENERIC_FAIL);
    return;
  }
  // Task #50 — deactivated leaver. Same generic error as a bad password so
  // a former colleague cannot distinguish "wrong password" from "disabled".
  if (cred.disabled) {
    await audit("login_failed", { actorLabel: email, ip });
    res.status(401).json(GENERIC_FAIL);
    return;
  }
  const [persona] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, cred.userId), isNull(atelierUsers.deletedAt)));
  if (!persona) {
    // Credential points at a missing/deleted employee — treat as invalid.
    await audit("login_failed", { actorLabel: email, ip });
    res.status(401).json(GENERIC_FAIL);
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
  const currentPassword = String(req.body?.currentPassword ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    res.status(400).json({
      error: "invalid-body",
      message: "Current and new password are required.",
    });
    return;
  }
  if (newPassword.length < 10 || newPassword.length > 200) {
    res.status(400).json({
      error: "weak-password",
      message: "New password must be at least 10 characters.",
    });
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

async function lookupActivationToken(rawToken: string) {
  if (!/^[0-9a-f]{64}$/.test(rawToken)) return null;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const [row] = await db
    .select()
    .from(atelierLoginActivationTokens)
    .where(eq(atelierLoginActivationTokens.tokenHash, tokenHash));
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

// Pre-auth: lets the activation page show which account is being activated.
// Tokens are 256-bit random values, so this is not enumerable.
router.get("/activate-info", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  if (!rateLimitOk(ip)) {
    res.status(429).json({ error: "rate-limited", message: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const row = await lookupActivationToken(String(req.query?.token ?? ""));
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
  if (newPassword.length < 10 || newPassword.length > 200) {
    res.status(400).json({ error: "weak-password", message: "Password must be at least 10 characters." });
    return;
  }
  const row = await lookupActivationToken(rawToken);
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
    await audit("account_activation_failed", { actorLabel: row.email, ip });
    res.status(404).json({
      error: "invalid-or-expired",
      message: "This activation link is no longer valid. Ask your onboarding contact for a new one.",
    });
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
        updatedAt: new Date(),
      })
      .where(eq(atelierAuthCredentials.email, row.email));
  }).catch(async (err: unknown) => {
    if ((err as { activationRace?: boolean }).activationRace) {
      await audit("account_activation_failed", { actorLabel: row.email, ip });
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
): Promise<{ userId: string; email: string; name: string } | null> {
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
  return { userId: session.userId, email: session.email, name: persona.name };
}

/** Human-friendly temporary password, e.g. "Reset-KJH3-TM8Q-9XWC". */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `Reset-${out}`;
}

// Who can I reset? Every credential except my own, with the person's name.
router.get("/reset-targets", async (req: Request, res: Response) => {
  const actor = await requireFoundingPartner(req, res);
  if (!actor) return;
  const creds = await db.select().from(atelierAuthCredentials);
  const targets = [];
  for (const c of creds) {
    if (c.email === actor.email) continue;
    const [persona] = await db
      .select()
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, c.userId), isNull(atelierUsers.deletedAt)));
    if (!persona) continue;
    targets.push({
      email: c.email,
      name: persona.name,
      title: persona.title,
      pendingReset: c.mustChangePassword,
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
  const tempPassword = generateTempPassword();
  await db
    .update(atelierAuthCredentials)
    .set({
      passwordHash: hashPassword(tempPassword),
      // user_managed=true: the boot seed must never overwrite this hash.
      userManaged: true,
      mustChangePassword: true,
      // Task #59 — even if the target never logged in yet, a partner reset
      // shows the reset copy (the temp password now comes from a partner).
      mustChangeReason: "reset",
      updatedAt: new Date(),
    })
    .where(eq(atelierAuthCredentials.email, targetEmail));
  // Kill every session of the reset user — they must log back in with the
  // temporary password and immediately change it.
  await revokeAllSessions(cred.userId);
  await audit("password_reset_by_partner", {
    actorId: actor.userId,
    actorLabel: actor.name,
    ip,
    targetEmail,
    targetUserId: cred.userId,
  });
  res.json({ ok: true, tempPassword });
});

export default router;
