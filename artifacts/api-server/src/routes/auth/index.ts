import { Router, type IRouter, type Request, type Response } from "express";
import { db, atelierAuthCredentials, atelierUsers, atelierAuditEvents } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID, randomBytes } from "node:crypto";
import { verifyPassword, hashPassword } from "../../lib/auth/passwords";
import {
  AUTH_SESSION_COOKIE,
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
    | "password_reset_denied",
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
  res.json({ user: personaToWire(persona), mustChangePassword: cred.mustChangePassword });
});

router.post("/logout", async (req: Request, res: Response) => {
  const token = req.cookies?.[AUTH_SESSION_COOKIE] as string | undefined;
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
  const token = req.cookies?.[AUTH_SESSION_COOKIE] as string | undefined;
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

router.get("/session", async (req: Request, res: Response) => {
  const token = req.cookies?.[AUTH_SESSION_COOKIE] as string | undefined;
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
  res.json({
    user: personaToWire(persona),
    expiresAt: session.expiresAt.toISOString(),
    mustChangePassword: session.mustChangePassword,
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
  const token = req.cookies?.[AUTH_SESSION_COOKIE] as string | undefined;
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
