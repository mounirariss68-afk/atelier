import type { Request, Response, NextFunction } from "express";
import { db, atelierUsers } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Mock persona-based auth for the Atelier MVP shell.
 *
 * The single source of truth for the active persona is the `atelier_persona`
 * cookie. Real OAuth (Replit Auth or Clerk + Google/Microsoft) is the
 * follow-up workstream — see #221.
 *
 * Default persona on a fresh session is the firm's founding Partner so the
 * portal is never blank on first visit.
 */
export const PERSONA_COOKIE = "atelier_persona";
export const DEFAULT_PERSONA_ID = "p_mounir_ariss";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      atelierPersonaId?: string;
      atelierPersona?: typeof atelierUsers.$inferSelect;
    }
  }
}

export async function attachPersona(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const fromCookie = req.cookies?.[PERSONA_COOKIE] as string | undefined;
    const salonCookie = req.cookies?.["salon_persona"] as string | undefined;
    // Realm guard (Task #242): if a salon (client) session is active and the
    // caller did NOT explicitly present an internal atelier_persona cookie,
    // refuse to manufacture an internal default persona for them. They must
    // route through /api/salon/*.
    if (!fromCookie?.trim() && salonCookie?.trim()) {
      next();
      return;
    }
    const personaId = fromCookie?.trim() || DEFAULT_PERSONA_ID;

    const [persona] = await db
      .select()
      .from(atelierUsers)
      .where(
        and(eq(atelierUsers.id, personaId), isNull(atelierUsers.deletedAt)),
      );

    if (!persona) {
      // Persona referenced by cookie no longer exists — clear it and fall back.
      res.clearCookie(PERSONA_COOKIE, { path: "/" });
      const [fallback] = await db
        .select()
        .from(atelierUsers)
        .where(
          and(
            eq(atelierUsers.id, DEFAULT_PERSONA_ID),
            isNull(atelierUsers.deletedAt),
          ),
        );
      if (fallback) {
        req.atelierPersonaId = fallback.id;
        req.atelierPersona = fallback;
      }
      next();
      return;
    }

    req.atelierPersonaId = persona.id;
    req.atelierPersona = persona;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Realm guard for /api/atelier/* — Task #242.
 *
 * The Atelier (internal) realm and the Salon (client) realm share schemas
 * but never share users. A client_user persona cookie must NOT be able to
 * read internal atelier endpoints, even by accident (or by hand-pasted
 * cookie). Conversely the Salon router applies a mirror guard rejecting
 * internal aico_employee personas. See `salonCookie.ts`.
 */
export function rejectClientRealm(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Reject if the resolved internal persona is a client_user (defense in
  // depth — should never happen since salon users live in atelier_salon_users).
  if (req.atelierPersona && req.atelierPersona.role === "client_user") {
    res.status(403).json({
      error: "wrong-realm",
      message: "client_user personas must use /api/salon/*",
    });
    return;
  }
  // Authoritative realm guard (Task #242 round-5): if the request carries a
  // salon_persona cookie but no resolvable internal persona, the caller is a
  // Salon principal — refuse all internal Atelier routes regardless of which
  // particular endpoint is being hit.
  const salonCookie = req.cookies?.["salon_persona"];
  if (
    !req.atelierPersona &&
    typeof salonCookie === "string" &&
    salonCookie.length > 0
  ) {
    res.status(403).json({
      error: "wrong-realm",
      message: "Salon (client) sessions must use /api/salon/*",
    });
    return;
  }
  next();
}

export function setPersonaCookie(res: Response, personaId: string): void {
  res.cookie(PERSONA_COOKIE, personaId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

export function personaToWire(p: typeof atelierUsers.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    // Task #292 — 9-persona model.
    role: p.role as
      | "founding_partner"
      | "partner"
      | "finance"
      | "hr"
      | "senior_manager"
      | "consultant"
      | "contractor"
      | "partner_firm_resource"
      | "board_observer",
    roleLabel: p.roleLabel,
    title: p.title,
    initials: p.initials,
    avatarUrl: p.avatarUrl,
  };
}
