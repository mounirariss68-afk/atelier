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
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authSession?: AuthSession;
    }
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  email: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(atelierAuthSessions).values({
    tokenHash: hashToken(token),
    userId,
    email,
    expiresAt,
  });
  // Opportunistic sweep of expired rows (cheap; indexed on expires_at).
  void db
    .delete(atelierAuthSessions)
    .where(lt(atelierAuthSessions.expiresAt, new Date()))
    .catch(() => undefined);
  return { token, expiresAt };
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
  return { userId: row.userId, email: row.email, expiresAt: row.expiresAt };
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
      next();
      return;
    }
    const token = req.cookies?.[AUTH_SESSION_COOKIE] as string | undefined;
    const session = token ? await lookupSession(token) : null;
    if (!session) {
      if (token) clearSessionCookie(res);
      res.status(401).json({ error: "unauthenticated", message: "Sign in required." });
      return;
    }
    req.authSession = session;
    next();
  } catch (err) {
    next(err);
  }
}
