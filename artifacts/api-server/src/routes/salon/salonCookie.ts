/**
 * Salon (client-realm) persona auth — Task #242.
 *
 * Mirror of `atelier/personaCookie.ts` for the client-facing workspace.
 * The active client persona is the `salon_persona` cookie (separate from
 * the internal `atelier_persona` cookie so the two realms cannot collide).
 *
 * Default fallback: the seeded Tasama Salon admin so demo links land
 * inside the workspace immediately.
 */
import type { Request, Response, NextFunction } from "express";
import {
  db,
  atelierSalonUsers,
  atelierSalonUserEngagementAccess,
  atelierSalonWorkspaces,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";

export const SALON_PERSONA_COOKIE = "salon_persona";
export const ATELIER_PERSONA_COOKIE = "atelier_persona";

/**
 * Realm guard for /api/salon/* — Task #242 mirror of rejectClientRealm.
 * If an internal aico_employee persona cookie is present we refuse the request
 * outright, even if a salon_persona cookie is also set. The two realms must
 * never share an active session.
 */
export function rejectInternalRealm(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const internal = req.cookies?.[ATELIER_PERSONA_COOKIE];
  const salon = req.cookies?.[SALON_PERSONA_COOKIE];
  // Sign-in bootstrap exemption (Task #242 round-5): always allow the
  // persona-listing and persona-switch endpoints through, so an internal
  // user landing on /salon with a stale atelier_persona cookie can still
  // see personas and pick one (which sets salon_persona).
  const path = req.path || "";
  if (path === "/personas" || path === "/persona" || path === "/me") {
    next();
    return;
  }
  // Otherwise: reject when atelier cookie is present without a salon cookie.
  // Mixed-cookie sessions defer to ensureSalonPersona which authenticates
  // against the salon identity.
  if (
    typeof internal === "string" &&
    internal.length > 0 &&
    !(typeof salon === "string" && salon.length > 0)
  ) {
    res.status(403).json({
      error: "wrong-realm",
      message: "Internal AICo personas must use /api/atelier/*",
    });
    return;
  }
  next();
}
export const DEFAULT_SALON_PERSONA_ID = "su_tasama_admin";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      salonPersonaId?: string;
      salonPersona?: typeof atelierSalonUsers.$inferSelect;
    }
  }
}

export async function attachSalonPersona(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const fromCookie = req.cookies?.[SALON_PERSONA_COOKIE] as
      | string
      | undefined;
    const id = fromCookie?.trim();
    // Task #242 architect round-4: NO default-admin fallback. Without an
    // explicit salon_persona cookie the request is unauthenticated and the
    // route handler must return 401 (or, for /me, persona:null so the
    // frontend can redirect to /salon/sign-in).
    if (!id) {
      next();
      return;
    }

    const [persona] = await db
      .select()
      .from(atelierSalonUsers)
      .where(
        and(eq(atelierSalonUsers.id, id), isNull(atelierSalonUsers.deletedAt)),
      );

    if (!persona) {
      res.clearCookie(SALON_PERSONA_COOKIE, { path: "/" });
      next();
      return;
    }

    req.salonPersonaId = persona.id;
    req.salonPersona = persona;
    next();
  } catch (err) {
    next(err);
  }
}

export function setSalonPersonaCookie(res: Response, id: string): void {
  res.cookie(SALON_PERSONA_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

export function salonPersonaToWire(
  p: typeof atelierSalonUsers.$inferSelect,
  access: Array<typeof atelierSalonUserEngagementAccess.$inferSelect>,
  workspaces: Array<typeof atelierSalonWorkspaces.$inferSelect>,
) {
  const wsBySlug = new Map(workspaces.map((w) => [w.id, w]));
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    initials: p.initials,
    title: p.title,
    avatarUrl: p.avatarUrl,
    locale: p.locale as "en" | "ar",
    role: "client_user" as const,
    accountId: p.accountId,
    engagements: access
      .filter((a) => !a.revokedAt)
      .map((a) => {
        const ws = wsBySlug.get(a.workspaceId);
        return {
          accessId: a.id,
          engagementId: a.engagementId,
          workspaceId: a.workspaceId,
          workspaceSlug: ws?.slug ?? null,
          workspaceName: ws?.displayName ?? null,
          accentColor: ws?.accentColor ?? "#0B5CFF",
          role: a.role as "admin" | "approver" | "viewer",
          canApprove: a.canApprove,
          downloadsAllowed:
            a.downloadsAllowed ?? ws?.downloadsAllowedDefault ?? false,
        };
      }),
  };
}
