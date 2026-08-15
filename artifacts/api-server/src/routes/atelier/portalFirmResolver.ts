/**
 * Task #1173 / #875 review — shared partner-portal firm resolution.
 *
 * Both the opportunities portal (partnerPortalRoutes) and the contracts &
 * billing portal (partnerBillingRoutes) scope every `/partner-portal/*`
 * request to a single firm. That scoping supports two callers:
 *
 *   - alliance_partner  → own linked (active) firm. Full read + write.
 *   - leadership + a preview firm id (header `x-partner-preview-firm` or
 *     `?previewFirm=`) → that active same-org firm, with req.portalPreview
 *     set true. READ-ONLY: mutating routes must call refuseIfPreview first.
 *   - anyone else       → 403 partner-portal-only.
 *
 * Kept in a dedicated module so both routers share ONE implementation (no
 * drift between the two portal surfaces) without a router↔router import.
 */
import type { Request, Response, NextFunction } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, atelierUsers, atelierPartnerFirms } from "@workspace/db";
import { isLeadership, isAlliancePartner } from "./personaRoles";

type Me = typeof atelierUsers.$inferSelect;
type Firm = typeof atelierPartnerFirms.$inferSelect;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Set true by resolvePortalFirm when an internal leadership user is
      // previewing a firm's portal read-only. Mutating routes must 403.
      portalPreview?: boolean;
    }
  }
}

/** The active firm linked to an alliance_partner persona, org-scoped. */
export async function resolveAlliancePartnerFirm(me: {
  id: string;
  orgId: string;
  role: string;
  partnerFirmId?: string | null;
}): Promise<Firm | null> {
  if (!isAlliancePartner(me.role)) return null;
  const firmId = me.partnerFirmId ?? null;
  if (!firmId) return null;
  const [firm] = await db
    .select()
    .from(atelierPartnerFirms)
    .where(
      and(
        eq(atelierPartnerFirms.id, firmId),
        eq(atelierPartnerFirms.orgId, me.orgId),
        isNull(atelierPartnerFirms.deletedAt),
      ),
    );
  return firm ?? null;
}

/**
 * Resolve the firm a `/partner-portal/*` request is scoped to.
 * Returns { me, firm } or null (a response has already been sent).
 * Always sets req.portalPreview (false for partners, true for preview).
 */
export async function resolvePortalFirm(
  req: Request,
  res: Response,
): Promise<{ me: Me; firm: Firm } | null> {
  const me = (req.atelierPersona as Me | null) ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  req.portalPreview = false;
  if (isAlliancePartner(me.role)) {
    const firm = await resolveAlliancePartnerFirm(me);
    if (!firm) {
      res.status(403).json({ error: "partner-firm-unavailable" });
      return null;
    }
    return { me, firm };
  }
  if (isLeadership(me.role)) {
    const previewFirmId =
      (typeof req.headers["x-partner-preview-firm"] === "string"
        ? (req.headers["x-partner-preview-firm"] as string)
        : "") ||
      (typeof req.query.previewFirm === "string" ? req.query.previewFirm : "");
    if (!previewFirmId) {
      res.status(403).json({
        error: "preview-firm-required",
        message: "Supply x-partner-preview-firm to preview a partner portal.",
      });
      return null;
    }
    const [firm] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(
        and(
          eq(atelierPartnerFirms.id, previewFirmId),
          eq(atelierPartnerFirms.orgId, me.orgId),
          isNull(atelierPartnerFirms.deletedAt),
        ),
      );
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return null;
    }
    req.portalPreview = true;
    return { me, firm };
  }
  res.status(403).json({ error: "partner-portal-only" });
  return null;
}

/**
 * Guard for MUTATING /partner-portal routes: in preview mode there is no
 * write path. Returns true when the request should be refused (a 403 has
 * been sent). Call BEFORE any multipart parsing / storage / DB write.
 */
export function refuseIfPreview(req: Request, res: Response): boolean {
  if (req.portalPreview) {
    res.status(403).json({ error: "preview-read-only" });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// Task #1173 / #875 review — per-user sliding-window throttle on ALL
// /partner-portal/* traffic. Mounted ONCE on the common atelier parent
// router BEFORE both the opportunities and contracts/billing routers, so
// every portal surface (incl. multipart uploads in partnerBillingRoutes)
// is covered and a single request is counted exactly once. Internal staff
// (leadership preview) is exempt. Default 120 req/min per userId,
// overridable via ATELIER_PORTAL_RATE_LIMIT for tests.
// ---------------------------------------------------------------------

const PORTAL_RL_WINDOW_MS = 60_000;
function portalRateLimit(): number {
  const raw = Number(process.env.ATELIER_PORTAL_RATE_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : 120;
}
const portalHits = new Map<string, number[]>();

/** Test-only: reset the sliding-window state. */
export function __resetPortalRateLimit(): void {
  portalHits.clear();
}

function portalRateLimitOk(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - PORTAL_RL_WINDOW_MS;
  const arr = (portalHits.get(userId) ?? []).filter((t) => t > cutoff);
  if (arr.length >= portalRateLimit()) {
    portalHits.set(userId, arr);
    return false;
  }
  arr.push(now);
  portalHits.set(userId, arr);
  return true;
}

/**
 * Express middleware: throttle alliance_partner logins per userId across
 * every /partner-portal/* route. Non-alliance_partner personas (leadership
 * preview, unauthenticated) pass through untouched.
 */
export function partnerPortalThrottle(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const me = req.atelierPersona ?? null;
  if (!me || !isAlliancePartner(me.role)) {
    next();
    return;
  }
  if (!portalRateLimitOk(me.id)) {
    res.status(429).json({ error: "rate-limited", message: "Too many requests. Please slow down." });
    return;
  }
  next();
}
