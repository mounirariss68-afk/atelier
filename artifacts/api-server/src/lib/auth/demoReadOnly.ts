import type { Request, Response, NextFunction } from "express";
import { DEMO_EMAIL, DEMO_USER_ID } from "../atelier-seed-auth";

/**
 * Task #621 — App Store review demo account is read-only.
 *
 * Mounted immediately after the global auth gate, so it covers every data
 * route (atelier REST, /cli/* chat turns, uploads, salon, legacy routers).
 * Any mutating HTTP method from the demo user is rejected with a clear,
 * uniform error. GET/HEAD/OPTIONS pass through — the persona boundary
 * (self-only `employee` scope) then limits what it can read.
 *
 * The pre-gate /auth endpoints (login, logout, session) are mounted before
 * this guard on purpose — they are the only writes the demo user needs.
 * /auth/change-password additionally blocks the demo user inside the auth
 * router so the published review password can never be rotated.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isDemoUser(opts: { userId?: string | null; email?: string | null }): boolean {
  return opts.userId === DEMO_USER_ID || (opts.email ?? "").toLowerCase() === DEMO_EMAIL;
}

export function demoChatExceptionAllowed(opts: {
  method: string;
  path: string;
  requestedPersonaId?: string | null;
}): boolean {
  return opts.method === "POST" &&
    (opts.path === "/atelier/cli/turn" || opts.path === "/assistant/turns") &&
    (!opts.requestedPersonaId || opts.requestedPersonaId === DEMO_USER_ID);
}

export function demoReadOnlyGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const s = req.authSession;
  if (!s || !isDemoUser({ userId: s.userId, email: s.email })) {
    next();
    return;
  }
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  // Per user request (2026-07-23): the demo persona may POST a chat turn so
  // the reviewer can ask "what can I do with Atelier?". The /cli/turn
  // route short-circuits demo turns into a canned, read-only capability
  // showcase (see runDemoShowcaseTurn) — the orchestrator/LLM and every
  // write tool are never invoked for this user.
  if (demoChatExceptionAllowed({
    method: req.method,
    path: req.path,
    requestedPersonaId:
      typeof req.cookies?.atelier_persona === "string"
        ? req.cookies.atelier_persona
        : null,
  })) {
    next();
    return;
  }
  res.status(403).json({
    error: "demo-read-only",
    message:
      "The demo account is read-only. Browsing is allowed, but nothing can be created, changed, or deleted.",
  });
}
