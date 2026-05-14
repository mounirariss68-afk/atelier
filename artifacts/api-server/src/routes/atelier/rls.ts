import type { Request, Response, NextFunction } from "express";
import { db, pool, atelierEngagementAccess } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { isBoardObserverRestricted, isRestrictedPersona } from "./personaRoles.js";

/**
 * Per-request Row-Level-Security context for The Atelier.
 *
 * Postgres RLS policies on `atelier_*` tables read three GUCs:
 *   app.org_id           — tenant scope (matches atelier_*.org_id)
 *   app.user_id          — current persona (audit / future ACL refinements)
 *   app.engagement_ids   — comma-separated list of engagement_ids the user
 *                          may see (consumed by atelier_engagement_allowed())
 *
 * Two layers cooperate:
 *
 * 1. `pool.on('connect')` sets safe defaults on every new connection so
 *    that a query that escapes a request-scoped transaction (e.g. a
 *    background job or a cron) is never granted broader visibility than
 *    the default tenant.
 *
 * 2. `withRls(req, fn)` runs `fn` inside a single Drizzle transaction
 *    with `set_config(..., true)` so the GUCs are bound to that
 *    transaction only. Routes that touch engagement-scoped tables MUST
 *    use this wrapper; routes that only touch org-scoped tables can rely
 *    on the connection-level default.
 */

let connectionDefaultsRegistered = false;

export function registerAtelierRlsDefaults(): void {
  if (connectionDefaultsRegistered) return;
  connectionDefaultsRegistered = true;
  pool.on("connect", (client) => {
    client
      .query(
        "SELECT set_config('app.org_id', 'aico', false), " +
          "set_config('app.user_id', '', false), " +
          "set_config('app.engagement_ids', '', false)",
      )
      .catch((err) => {
        // Don't crash the pool if the GUCs can't be set — RLS is still
        // enforced by the policies themselves; we just lose the per-user
        // narrowing on legacy connections.
        // eslint-disable-next-line no-console
        console.warn("[atelier-rls] failed to set defaults on new pg client:", err);
      });
  });
}

export interface AtelierRlsContext {
  orgId: string;
  userId: string;
  engagementIds: string[];
}

function ctxFromReq(req: Request): AtelierRlsContext {
  const persona = req.atelierPersona;
  return {
    orgId: persona?.orgId ?? "aico",
    userId: persona?.id ?? "",
    // Future: derive from atelier_engagement_members. For the MVP every
    // signed-in persona may see every engagement in the firm.
    engagementIds: (req.atelierEngagementIds as string[] | undefined) ?? [],
  };
}

/**
 * Run `fn` inside a Drizzle transaction with the Atelier RLS GUCs bound
 * to that transaction. The third arg to set_config (`true`) makes the
 * setting transaction-local, so it cannot leak to subsequent requests
 * sharing the same pooled connection.
 */
export async function withRls<T>(
  req: Request,
  fn: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<T>,
): Promise<T> {
  const ctx = ctxFromReq(req);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT
      set_config('app.org_id', ${ctx.orgId}, true),
      set_config('app.user_id', ${ctx.userId}, true),
      set_config('app.engagement_ids', ${ctx.engagementIds.join(",")}, true)`);
    return fn(tx);
  });
}

/**
 * Express middleware shim. Stores the resolved RLS context on the
 * request so handlers/observers can introspect it without re-querying.
 *
 * Task #261 — For contractor / partner_firm_resource personas, populate
 * `req.atelierEngagementIds` from `atelier_engagement_access` so the
 * RLS engagement gate (added on `atelier_timesheet_entries` +
 * `atelier_expenses`) actually narrows their visibility. Other roles
 * (partner / engagement_lead / sme / ai_engineer / business_developer /
 * operations) continue to see the full org and rely on per-route ACLs.
 *
 * Failure-to-resolve degrades to "no engagements" so a misconfigured
 * persona never silently leaks cross-engagement data.
 */
export function attachRls(req: Request, _res: Response, next: NextFunction): void {
  const persona = req.atelierPersona;
  // Task #292 — board_observer is deny-by-default until the boardroom realm
  // ships (#329). Force engagement_ids=[] so RLS denies all org-wide reads;
  // any per-engagement grants will still flow through atelier_engagement_access
  // below.
  const isBoardObs = !!persona && isBoardObserverRestricted(persona.role);
  const restricted = !!persona && (isRestrictedPersona(persona.role) || isBoardObs);
  if (!restricted) {
    (req as Request & { atelierRls?: AtelierRlsContext }).atelierRls = ctxFromReq(req);
    return next();
  }
  // Async path: query engagement_access then attach.
  void (async () => {
    try {
      const grants = await db
        .select({ engagementId: atelierEngagementAccess.engagementId })
        .from(atelierEngagementAccess)
        .where(
          and(
            eq(atelierEngagementAccess.userId, persona!.id),
            eq(atelierEngagementAccess.status, "active"),
            isNull(atelierEngagementAccess.deletedAt),
          ),
        );
      const ids = grants.map((g) => g.engagementId).filter(Boolean) as string[];
      // SECURITY: empty `app.engagement_ids` means ALLOW-ALL in
      // `atelier_engagement_allowed()`. Restricted personas with no grants
      // must therefore receive a deny sentinel (a real engagement_id can
      // never collide with this token), not an empty list.
      req.atelierEngagementIds = ids.length > 0 ? ids : ["__atelier_deny_all__"];
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[atelier-rls] failed to resolve engagement grants for", persona!.id, err);
      req.atelierEngagementIds = ["__atelier_deny_all__"];
    }
    (req as Request & { atelierRls?: AtelierRlsContext }).atelierRls = ctxFromReq(req);
    next();
  })();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      atelierEngagementIds?: string[];
      atelierRls?: AtelierRlsContext;
    }
  }
}
