import { Router, type IRouter, type Request, type Response } from "express";
import { db, atelierAuthCredentials, atelierUsers, atelierAuditEvents } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { verifyPassword, hashPassword } from "../../lib/auth/passwords";
import {
  AUTH_SESSION_COOKIE,
  createSession,
  destroySession,
  lookupSession,
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
  action: "login_success" | "login_failed" | "logout",
  opts: { actorId?: string | null; actorLabel: string; ip: string },
): Promise<void> {
  try {
    await db.insert(atelierAuditEvents).values({
      id: `audit_${randomUUID()}`,
      entityType: "auth",
      entityId: opts.actorId ?? "unknown",
      actorType: opts.actorId ? "human" : "system",
      actorId: opts.actorId ?? null,
      actorLabel: opts.actorLabel,
      action,
      payload: { ip: opts.ip },
      payloadSummary:
        action === "login_success"
          ? `${opts.actorLabel} signed in`
          : action === "logout"
            ? `${opts.actorLabel} signed out`
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
  const { token, expiresAt } = await createSession(persona.id, email);
  setSessionCookie(res, token, expiresAt);
  await audit("login_success", { actorId: persona.id, actorLabel: persona.name, ip });
  res.json({ user: personaToWire(persona) });
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
  res.json({ user: personaToWire(persona), expiresAt: session.expiresAt.toISOString() });
});

export default router;
