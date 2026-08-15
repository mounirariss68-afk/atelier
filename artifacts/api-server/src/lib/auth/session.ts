import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db, atelierAuthSessions } from "@workspace/db";
import { and, eq, lt, ne } from "drizzle-orm";

/**
 * Server-side session store (Postgres-backed) — Task #1.
 *
 * The cookie holds an opaque random token; the DB stores only its SHA-256
 * digest. Sessions expire after SESSION_TTL_MS; lookups delete-on-read when
 * expired so the table self-cleans under normal traffic.
 */
export const AUTH_SESSION_COOKIE = "atelier_auth_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface AuthSession {
  userId: string;
  email: string;
  expiresAt: Date;
  mustChangePassword: boolean;
  // Task #821 — when this session last passed a TOTP/backup-code check.
  totpVerifiedAt: Date | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authSession?: AuthSession;
    }
  }
}

/**
 * Task #328 — mobile clients authenticate with `Authorization: Bearer <token>`
 * (the same opaque session token the web client keeps in the httpOnly
 * cookie). Cookie wins when both are present (web semantics unchanged).
 */
export function sessionTokenFromRequest(req: Request): string | undefined {
  const cookieToken = req.cookies?.[AUTH_SESSION_COOKIE] as string | undefined;
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const t = header.slice("Bearer ".length).trim();
    if (t) return t;
  }
  return undefined;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  email: string,
  opts?: {
    mustChangePassword?: boolean;
    totpVerifiedAt?: Date | null;
    // Task #1173 — external (alliance_partner) sessions get a shorter TTL.
    // Defaults to SESSION_TTL_MS (7d) when omitted.
    ttlMs?: number;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const ttlMs =
    typeof opts?.ttlMs === "number" && opts.ttlMs > 0 ? opts.ttlMs : SESSION_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(atelierAuthSessions).values({
    tokenHash: hashToken(token),
    userId,
    email,
    mustChangePassword: opts?.mustChangePassword ?? false,
    totpVerifiedAt: opts?.totpVerifiedAt ?? null,
    expiresAt,
  });
  // Opportunistic sweep of expired rows (cheap; indexed on expires_at).
  void db
    .delete(atelierAuthSessions)
    .where(lt(atelierAuthSessions.expiresAt, new Date()))
    .catch(() => undefined);
  return { token, expiresAt };
}

/**
 * Task #4 — periodic sweep of expired session rows. Abandoned browsers never
 * trigger the delete-on-read path, so a daily cron deletes anything past its
 * expires_at. Active sessions (expires_at in the future) are untouched.
 */
export async function cleanupExpiredSessions(): Promise<{ deleted: number }> {
  const rows = await db
    .delete(atelierAuthSessions)
    .where(lt(atelierAuthSessions.expiresAt, new Date()))
    .returning({ tokenHash: atelierAuthSessions.tokenHash });
  return { deleted: rows.length };
}

export async function lookupSession(token: string): Promise<AuthSession | null> {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(atelierAuthSessions)
    .where(eq(atelierAuthSessions.tokenHash, hashToken(token)));
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(atelierAuthSessions)
      .where(eq(atelierAuthSessions.tokenHash, row.tokenHash))
      .catch(() => undefined);
    return null;
  }
  return {
    userId: row.userId,
    email: row.email,
    expiresAt: row.expiresAt,
    mustChangePassword: row.mustChangePassword,
    totpVerifiedAt: row.totpVerifiedAt ?? null,
  };
}

/** Task #821 — stamp a fresh step-up verification on this session. */
export async function markSessionTotpVerified(token: string): Promise<void> {
  if (!token) return;
  await db
    .update(atelierAuthSessions)
    .set({ totpVerifiedAt: new Date() })
    .where(eq(atelierAuthSessions.tokenHash, hashToken(token)));
}

/**
 * Task #5 — after a forced password change succeeds, clear the
 * must-change flag on the session that performed it so the user can
 * proceed without re-logging in.
 */
export async function clearSessionMustChange(token: string): Promise<void> {
  if (!token) return;
  await db
    .update(atelierAuthSessions)
    .set({ mustChangePassword: false })
    .where(eq(atelierAuthSessions.tokenHash, hashToken(token)));
}

/**
 * Task #5 — partner-initiated password reset revokes EVERY session of the
 * reset user, so a lost/stolen session cannot ride out the reset.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .delete(atelierAuthSessions)
    .where(eq(atelierAuthSessions.userId, userId));
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await db
    .delete(atelierAuthSessions)
    .where(eq(atelierAuthSessions.tokenHash, hashToken(token)));
}

/**
 * Task #2 — after a password change, kill every other session for the user
 * so any stolen/old session dies with the old password. The session behind
 * `keepToken` (the one that made the change) survives.
 */
export async function revokeOtherSessions(
  userId: string,
  keepToken: string,
): Promise<void> {
  await db
    .delete(atelierAuthSessions)
    .where(
      and(
        eq(atelierAuthSessions.userId, userId),
        ne(atelierAuthSessions.tokenHash, hashToken(keepToken)),
      ),
    );
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(AUTH_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(AUTH_SESSION_COOKIE, { path: "/" });
}

/**
 * True when running under the integration test harness (tests/crm/run.ts
 * sets NODE_ENV=test before importing the app). The harness authenticates
 * with a bare persona cookie; production never runs with NODE_ENV=test.
 */
export function isTestAuthBypass(): boolean {
  // Guardrail: a published deployment always sets REPLIT_DEPLOYMENT, so
  // even a misconfigured NODE_ENV=test can never open the bypass in prod.
  if (process.env.REPLIT_DEPLOYMENT) return false;
  return process.env.NODE_ENV === "test";
}

/**
 * Global API auth gate. Every data route (atelier, salon, chat, and the
 * legacy demo routers) sits behind this: no valid session -> 401. The only
 * exemptions are /api/healthz and /api/auth/* (mounted before this guard).
 */
export async function requireAuthSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (isTestAuthBypass()) {
      // Task #328 — even under the test bypass, resolve a presented token so
      // downstream persona resolution (attachPersona) sees the real identity,
      // matching production bearer-token behavior for mobile clients.
      const bypassToken = sessionTokenFromRequest(req);
      if (bypassToken) {
        const bypassSession = await lookupSession(bypassToken);
        if (bypassSession) req.authSession = bypassSession;
      }
      next();
      return;
    }
    const token = sessionTokenFromRequest(req);
    const session = token ? await lookupSession(token) : null;
    if (!session) {
      if (req.cookies?.[AUTH_SESSION_COOKIE]) clearSessionCookie(res);
      res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
      return;
    }
    // Task #5 — a reset user must change their temporary password before
    // touching any data route (/api/auth/* is mounted before this gate).
    if (session.mustChangePassword) {
      res.status(403).json({
        error: "password-change-required",
        message: "You must change your temporary password before continuing.",
      });
      return;
    }
    req.authSession = session;
    next();
  } catch (err) {
    next(err);
  }
}
