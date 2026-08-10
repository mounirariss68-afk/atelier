/**
 * Task #873 — Alliance-partner portal.
 *
 * Two surfaces in one router:
 *
 * 1. `/partner-portal/*` — the ONLY data reads an `alliance_partner`
 *    login can reach (the central gate in index.ts forbids everything
 *    else). Visibility is driven exclusively by unrevoked rows in
 *    `atelier_partner_opp_grants` joined against a live (non-archived)
 *    partner firm and a live (non-deleted) opportunity. The account
 *    overview is built from an EXPLICIT field allowlist — never a
 *    spread of the account row.
 *
 * 2. Internal admin surfaces (leadership-only, audited):
 *    - `/opportunities/:oppId/partner-grants` (list / assign / revoke)
 *    - `/partners/firms/:firmId/logins` (list / provision / deactivate)
 *
 * Read-only in v1: partners can never write CRM data. Revoking a grant
 * or archiving the firm drops visibility immediately; grant rows are
 * retained (soft revoke) for internal history.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierPartnerFirms,
  atelierPartnerOppGrants,
  atelierOpportunities,
  atelierAccounts,
} from "@workspace/db";
import { audit } from "./engagementRoutes";
import { isLeadership, isAlliancePartner } from "./personaRoles";
import { revokeAllSessions } from "../../lib/auth/session.js";
import { provisionPortalLogin } from "./rosterLifecycleRoutes";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me as Me;
}

// ---------------------------------------------------------------------
// Shared grant-resolution helpers (also used by the chat capabilities in
// lib/atelier-cli/partner-portal-capabilities.ts — keep them the single
// source of truth for what an alliance-partner login may see).
// ---------------------------------------------------------------------

/**
 * The firm an alliance-partner login belongs to, or null when the link
 * is missing OR the firm has been archived (soft-deleted). Archiving the
 * firm therefore revokes portal visibility immediately.
 */
export async function resolveAlliancePartnerFirm(me: {
  id: string;
  orgId: string;
  role: string;
  partnerFirmId?: string | null;
}): Promise<typeof atelierPartnerFirms.$inferSelect | null> {
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

/** Active (unrevoked) granted opportunity ids for a firm, org-scoped. */
export async function activeGrantedOppIds(
  orgId: string,
  partnerFirmId: string,
): Promise<string[]> {
  const rows = await db
    .select({ opportunityId: atelierPartnerOppGrants.opportunityId })
    .from(atelierPartnerOppGrants)
    .where(
      and(
        eq(atelierPartnerOppGrants.orgId, orgId),
        eq(atelierPartnerOppGrants.partnerFirmId, partnerFirmId),
        isNull(atelierPartnerOppGrants.revokedAt),
      ),
    );
  return [...new Set(rows.map((r) => r.opportunityId))];
}

/**
 * The redacted opportunity projection an external partner may see.
 * Deliberately EXCLUDES: deal size, probability, forecast category,
 * qualification rubric, go/no-go, owner identities, source lead.
 */
export function partnerOppWire(o: typeof atelierOpportunities.$inferSelect): {
  id: string;
  name: string;
  salesStage: string;
  subStatus: string | null;
  nextMilestone: string;
  nextMilestoneDate: string | null;
  closeDate: string | null;
  accountId: string;
  createdAt: string;
} {
  return {
    id: o.id,
    name: o.name,
    salesStage: o.salesStage,
    subStatus: o.subStatus ?? null,
    nextMilestone: o.nextMilestone,
    nextMilestoneDate: o.nextMilestoneDate ?? null,
    closeDate: o.closeDate ?? null,
    accountId: o.accountId,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * Task #873 — the redacted account overview. EXPLICIT allowlist:
 * name, brand name, sector, country, city, size band, employee count.
 * Never contacts, signals, financials, strategy (hypothesis /
 * strategic priorities), notes, documents, or other opportunities.
 */
export function redactedAccountOverview(a: typeof atelierAccounts.$inferSelect): {
  name: string;
  brandName: string | null;
  sector: string;
  country: string;
  hqCity: string | null;
  size: string | null;
  employeeCount: number | null;
} {
  return {
    name: a.name,
    brandName: a.brandName ?? null,
    sector: a.sector,
    country: a.country,
    hqCity: a.hqCity ?? null,
    size: a.size ?? null,
    employeeCount: a.employeeCount ?? null,
  };
}

/** Live granted opportunities (rows), for a partner login. */
export async function grantedOpportunitiesForPartner(me: {
  id: string;
  orgId: string;
  role: string;
  partnerFirmId?: string | null;
}): Promise<{
  firm: typeof atelierPartnerFirms.$inferSelect;
  opps: Array<typeof atelierOpportunities.$inferSelect>;
} | null> {
  const firm = await resolveAlliancePartnerFirm(me);
  if (!firm) return null;
  const oppIds = await activeGrantedOppIds(me.orgId, firm.id);
  if (oppIds.length === 0) return { firm, opps: [] };
  const opps = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.orgId, me.orgId),
        inArray(atelierOpportunities.id, oppIds),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  return { firm, opps };
}

function requireAlliancePartner(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (!isAlliancePartner(me.role)) {
    res.status(403).json({ error: "partner-portal-only" });
    return null;
  }
  return me;
}

// ---------------------------------------------------------------------
// Partner-facing reads (/partner-portal/*)
// ---------------------------------------------------------------------

// @cli-skip: partner-portal read — external alliance-partner surface; chat parity provided by partnerportal.opportunities capability
router.get("/partner-portal/opportunities", async (req, res, next) => {
  try {
    const me = requireAlliancePartner(req, res);
    if (!me) return;
    const scope = await grantedOpportunitiesForPartner(me);
    if (!scope) {
      // Firm link missing or firm archived — nothing is visible.
      res.status(403).json({ error: "partner-firm-unavailable" });
      return;
    }
    res.json({
      firm: { id: scope.firm.id, name: scope.firm.name },
      opportunities: scope.opps
        .map(partnerOppWire)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal read — external surface; chat parity via partnerportal.opportunity_detail
router.get("/partner-portal/opportunities/:oppId", async (req, res, next) => {
  try {
    const me = requireAlliancePartner(req, res);
    if (!me) return;
    const scope = await grantedOpportunitiesForPartner(me);
    if (!scope) {
      res.status(403).json({ error: "partner-firm-unavailable" });
      return;
    }
    const opp = scope.opps.find((o) => o.id === req.params.oppId);
    // Foreign-firm / revoked / unknown ids are indistinguishable: 404.
    if (!opp) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json({ opportunity: partnerOppWire(opp) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal read — external surface; chat parity via partnerportal.account_overview
router.get(
  "/partner-portal/opportunities/:oppId/account",
  async (req, res, next) => {
    try {
      const me = requireAlliancePartner(req, res);
      if (!me) return;
      const scope = await grantedOpportunitiesForPartner(me);
      if (!scope) {
        res.status(403).json({ error: "partner-firm-unavailable" });
        return;
      }
      const opp = scope.opps.find((o) => o.id === req.params.oppId);
      if (!opp) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const [account] = await db
        .select()
        .from(atelierAccounts)
        .where(
          and(
            eq(atelierAccounts.id, opp.accountId),
            eq(atelierAccounts.orgId, me.orgId),
          ),
        );
      if (!account) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      res.json({ account: redactedAccountOverview(account) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------
// Internal admin — opportunity grants (leadership-only, audited)
// ---------------------------------------------------------------------

function requireLeadership(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (!isLeadership(me.role)) {
    res.status(403).json({ error: "leadership-only" });
    return null;
  }
  return me;
}

async function loadLiveOpportunity(orgId: string, oppId: string) {
  const [opp] = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.id, oppId),
        eq(atelierOpportunities.orgId, orgId),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  return opp ?? null;
}

// @cli-skip: internal admin read — leadership grant listing on the opportunity page UI only
router.get("/opportunities/:oppId/partner-grants", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const opp = await loadLiveOpportunity(me.orgId, req.params.oppId);
    if (!opp) {
      res.status(404).json({ error: "opportunity-not-found" });
      return;
    }
    const rows = await db
      .select({
        grant: atelierPartnerOppGrants,
        firmName: atelierPartnerFirms.name,
        firmDeletedAt: atelierPartnerFirms.deletedAt,
      })
      .from(atelierPartnerOppGrants)
      .leftJoin(
        atelierPartnerFirms,
        eq(atelierPartnerFirms.id, atelierPartnerOppGrants.partnerFirmId),
      )
      .where(
        and(
          eq(atelierPartnerOppGrants.orgId, me.orgId),
          eq(atelierPartnerOppGrants.opportunityId, opp.id),
        ),
      )
      .orderBy(desc(atelierPartnerOppGrants.createdAt));
    res.json({
      grants: rows.map((r) => ({
        id: r.grant.id,
        partnerFirmId: r.grant.partnerFirmId,
        firmName: r.firmName ?? "(deleted firm)",
        firmArchived: r.firmDeletedAt != null,
        createdAt: r.grant.createdAt.toISOString(),
        createdByUserId: r.grant.createdByUserId,
        revokedAt: r.grant.revokedAt ? r.grant.revokedAt.toISOString() : null,
        revokedByUserId: r.grant.revokedByUserId ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: security-sensitive external-access grant — deliberate UI-only write (no chat surface for access control)
router.post("/opportunities/:oppId/partner-grants", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const opp = await loadLiveOpportunity(me.orgId, req.params.oppId);
    if (!opp) {
      res.status(404).json({ error: "opportunity-not-found" });
      return;
    }
    const partnerFirmId =
      typeof req.body?.partnerFirmId === "string" ? req.body.partnerFirmId : "";
    if (!partnerFirmId) {
      res.status(400).json({ error: "invalid-body", message: "partnerFirmId is required." });
      return;
    }
    const [firm] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(
        and(
          eq(atelierPartnerFirms.id, partnerFirmId),
          eq(atelierPartnerFirms.orgId, me.orgId),
          isNull(atelierPartnerFirms.deletedAt),
        ),
      );
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(atelierPartnerOppGrants)
      .where(
        and(
          eq(atelierPartnerOppGrants.orgId, me.orgId),
          eq(atelierPartnerOppGrants.partnerFirmId, firm.id),
          eq(atelierPartnerOppGrants.opportunityId, opp.id),
          isNull(atelierPartnerOppGrants.revokedAt),
        ),
      );
    if (existing) {
      // Idempotent: assigning an already-granted firm returns the row.
      res.status(200).json({ ok: true, grantId: existing.id, alreadyGranted: true });
      return;
    }
    const id = rid("ppog");
    await db.insert(atelierPartnerOppGrants).values({
      id,
      orgId: me.orgId,
      partnerFirmId: firm.id,
      opportunityId: opp.id,
      createdByUserId: me.id,
    });
    await audit({
      entityType: "opportunity",
      entityId: opp.id,
      actor: me,
      action: "partner_grant.assigned",
      payload: { grantId: id, partnerFirmId: firm.id, firmName: firm.name },
      summary: `${me.name} granted ${firm.name} portal access to opportunity "${opp.name}".`,
    });
    res.status(201).json({ ok: true, grantId: id });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: security-sensitive external-access revoke — deliberate UI-only write
router.post(
  "/opportunities/:oppId/partner-grants/:grantId/revoke",
  async (req, res, next) => {
    try {
      const me = requireLeadership(req, res);
      if (!me) return;
      const [grant] = await db
        .select()
        .from(atelierPartnerOppGrants)
        .where(
          and(
            eq(atelierPartnerOppGrants.id, req.params.grantId),
            eq(atelierPartnerOppGrants.orgId, me.orgId),
            eq(atelierPartnerOppGrants.opportunityId, req.params.oppId),
          ),
        );
      if (!grant) {
        res.status(404).json({ error: "grant-not-found" });
        return;
      }
      if (grant.revokedAt) {
        res.json({ ok: true, alreadyRevoked: true });
        return;
      }
      await db
        .update(atelierPartnerOppGrants)
        .set({ revokedAt: new Date(), revokedByUserId: me.id })
        .where(eq(atelierPartnerOppGrants.id, grant.id));
      await audit({
        entityType: "opportunity",
        entityId: grant.opportunityId,
        actor: me,
        action: "partner_grant.revoked",
        payload: { grantId: grant.id, partnerFirmId: grant.partnerFirmId },
        summary: `${me.name} revoked a partner firm's portal access to this opportunity.`,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------
// Internal admin — partner portal logins (leadership-only, audited)
// ---------------------------------------------------------------------

// @cli-skip: internal admin read — leadership login listing UI only
router.get("/partners/firms/:firmId/logins", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.orgId, me.orgId),
          eq(atelierUsers.role, "alliance_partner"),
          eq(atelierUsers.partnerFirmId, req.params.firmId),
        ),
      );
    res.json({
      logins: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        active: u.deletedAt == null,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: security-sensitive external login provisioning — deliberate UI-only write
router.post("/partners/firms/:firmId/logins", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const [firm] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(
        and(
          eq(atelierPartnerFirms.id, req.params.firmId),
          eq(atelierPartnerFirms.orgId, me.orgId),
          isNull(atelierPartnerFirms.deletedAt),
        ),
      );
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    const fullName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!fullName || !email.includes("@")) {
      res.status(400).json({
        error: "invalid-body",
        message: "name and a valid email are required.",
      });
      return;
    }
    const result = await provisionPortalLogin({
      me,
      person: {
        id: firm.id,
        workerType: "partner_firm_resource",
        fullName,
        email,
        personId: null,
      },
      onboarding: null,
      skipMsProvisioning: true,
      origin: req.headers.origin ? String(req.headers.origin) : null,
      // Task #873 — role override: the login is an external
      // alliance-partner portal account linked to the firm.
      alliancePartnerFirmId: firm.id,
    });
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_login.created",
      payload: { userId: result.body.userId, email, firmName: firm.name },
      summary: `${me.name} provisioned a partner-portal login for ${fullName} (${firm.name}).`,
    });
    res.status(201).json(result.body);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: security-sensitive login deactivation — deliberate UI-only write
router.post(
  "/partners/firms/:firmId/logins/:userId/deactivate",
  async (req, res, next) => {
    try {
      const me = requireLeadership(req, res);
      if (!me) return;
      const [user] = await db
        .select()
        .from(atelierUsers)
        .where(
          and(
            eq(atelierUsers.id, req.params.userId),
            eq(atelierUsers.orgId, me.orgId),
            eq(atelierUsers.role, "alliance_partner"),
            eq(atelierUsers.partnerFirmId, req.params.firmId),
          ),
        );
      if (!user) {
        res.status(404).json({ error: "login-not-found" });
        return;
      }
      if (user.deletedAt == null) {
        await db
          .update(atelierUsers)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(atelierUsers.id, user.id));
      }
      // Always clear sessions — deactivation must revoke access NOW.
      await revokeAllSessions(user.id);
      await audit({
        entityType: "partner_firm",
        entityId: req.params.firmId,
        actor: me,
        action: "partner_login.deactivated",
        payload: { userId: user.id, email: user.email },
        summary: `${me.name} deactivated the partner-portal login for ${user.name}.`,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
