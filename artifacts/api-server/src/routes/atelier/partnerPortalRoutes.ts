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
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierPartnerFirms,
  atelierPartnerOppGrants,
  atelierOpportunities,
  atelierAccounts,
  atelierAuthCredentials,
  atelierLoginActivationTokens,
  atelierPartnerFirmBankChangeRequests,
} from "@workspace/db";
import { audit } from "./engagementRoutes";
import { isLeadership, isAlliancePartner } from "./personaRoles";
import { revokeAllSessions } from "../../lib/auth/session.js";
import { trustedRequestOrigin } from "../../lib/auth/trusted-origin";
import { provisionPortalLogin } from "./rosterLifecycleRoutes";
import { mintLoginToken } from "../auth/index.js";
import { sendPartnerRegistrationEmail } from "../../lib/atelier-welcome-email.js";
import { isFinance } from "./personaRoles";

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
export function partnerOppWire(
  o: typeof atelierOpportunities.$inferSelect,
  sharedAt?: Date | null,
): {
  id: string;
  name: string;
  salesStage: string;
  subStatus: string | null;
  nextMilestone: string;
  nextMilestoneDate: string | null;
  closeDate: string | null;
  accountId: string;
  createdAt: string;
  sharedAt: string | null;
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
    // Task #886 — when the (earliest active) grant shared this
    // opportunity with the partner firm. Read-only stamp from the
    // existing grant row; no new data exposure.
    sharedAt: sharedAt ? sharedAt.toISOString() : null,
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
  /** Earliest ACTIVE grant createdAt per opportunity id (Task #886). */
  sharedAtByOppId: Map<string, Date>;
} | null> {
  const firm = await resolveAlliancePartnerFirm(me);
  if (!firm) return null;
  const grantRows = await db
    .select({
      opportunityId: atelierPartnerOppGrants.opportunityId,
      createdAt: atelierPartnerOppGrants.createdAt,
    })
    .from(atelierPartnerOppGrants)
    .where(
      and(
        eq(atelierPartnerOppGrants.orgId, me.orgId),
        eq(atelierPartnerOppGrants.partnerFirmId, firm.id),
        isNull(atelierPartnerOppGrants.revokedAt),
      ),
    );
  const sharedAtByOppId = new Map<string, Date>();
  for (const r of grantRows) {
    const prev = sharedAtByOppId.get(r.opportunityId);
    if (!prev || r.createdAt < prev) sharedAtByOppId.set(r.opportunityId, r.createdAt);
  }
  const oppIds = [...sharedAtByOppId.keys()];
  if (oppIds.length === 0) return { firm, opps: [], sharedAtByOppId };
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
  return { firm, opps, sharedAtByOppId };
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
        .map((o) => partnerOppWire(o, scope.sharedAtByOppId.get(o.id) ?? null))
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
    res.json({
      firm: { id: scope.firm.id, name: scope.firm.name },
      opportunity: partnerOppWire(opp, scope.sharedAtByOppId.get(opp.id) ?? null),
    });
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
    // Task #874 — invitations are for SIGNED partner firms only.
    if (firm.partnershipStage !== "agreed" || firm.agreementStage !== "signed") {
      res.status(422).json({
        error: "firm-not-signed",
        message: "Partner users can only be invited once the partnership agreement is signed.",
      });
      return;
    }
    // Task #874 — one active user per firm in v1.
    const [activeLogin] = await db
      .select({ id: atelierUsers.id, email: atelierUsers.email })
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.orgId, me.orgId),
          eq(atelierUsers.role, "alliance_partner"),
          eq(atelierUsers.partnerFirmId, firm.id),
          isNull(atelierUsers.deletedAt),
        ),
      );
    if (activeLogin) {
      res.status(409).json({
        error: "firm-login-exists",
        message: `This firm already has an active portal user (${activeLogin.email}). Deactivate it first — one user per firm in v1.`,
      });
      return;
    }
    let result;
    try {
      result = await provisionPortalLogin({
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
        partnerFirmName: firm.name,
      });
    } catch (err: unknown) {
      // Task #874 — the partial unique index uq_atelier_users_active_partner_firm
      // is the race-safe enforcement of one-active-login-per-firm: concurrent
      // invites (even with distinct emails) collide here; the loser gets 409.
      const code = (err as { code?: string; cause?: { code?: string } })?.code
        ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") {
        res.status(409).json({
          error: "firm-login-exists",
          message: "This firm already has an active portal user — one user per firm in v1.",
        });
        return;
      }
      throw err;
    }
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

// Task #885 — leadership regenerates an activation link for an existing
// partner login (forgotten password / expired original link). Fixes the
// login WITHOUT deleting it: mints a fresh single-use 72h activation
// token (invalidating any earlier unused ones for the email) and revokes
// every existing session immediately. The partner chooses a new password
// via the same /activate page as first-time activation. Self-serve
// /forgot-password also covers alliance_partner logins (no role gate).
// @cli-skip: security-sensitive credential reset — deliberate UI-only write
router.post(
  "/partners/firms/:firmId/logins/:userId/reset-link",
  async (req, res, next) => {
    try {
      const me = requireLeadership(req, res);
      if (!me) return;
      // CSRF / token-exfiltration guard: this response carries a
      // credential-bearing activation URL, so a cross-site request from a
      // hostile origin must be rejected outright — never answered with a
      // token. An explicit Origin header is only accepted when it resolves
      // to a trusted app origin (same policy as the auth routes).
      const explicitOrigin = req.get("origin");
      const trustedOrigin = trustedRequestOrigin(req);
      if (explicitOrigin) {
        let originAllowed = false;
        try {
          originAllowed = new URL(explicitOrigin).origin === trustedOrigin;
        } catch {
          originAllowed = false;
        }
        if (!originAllowed) {
          res.status(403).json({ error: "untrusted-origin" });
          return;
        }
      }
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
      if (user.deletedAt != null) {
        res.status(409).json({
          error: "login-deactivated",
          message: "This login is deactivated. Provision a new login instead.",
        });
        return;
      }
      const [cred] = await db
        .select()
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.userId, user.id));
      if (!cred || cred.disabled) {
        res.status(409).json({
          error: "credential-unavailable",
          message: "No usable credential exists for this login.",
        });
        return;
      }
      // Single-use 72h activation token; only the newest link works.
      const rawToken = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await db.transaction(async (tx) => {
        await tx
          .update(atelierLoginActivationTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(atelierLoginActivationTokens.email, cred.email),
              eq(atelierLoginActivationTokens.purpose, "activation"),
              isNull(atelierLoginActivationTokens.usedAt),
            ),
          );
        await tx.insert(atelierLoginActivationTokens).values({
          tokenHash,
          email: cred.email,
          userId: user.id,
          purpose: "activation",
          createdByUserId: me.id,
          expiresAt,
        });
      });
      // A reset always revokes existing sessions immediately.
      await revokeAllSessions(user.id);
      await audit({
        entityType: "partner_firm",
        entityId: req.params.firmId,
        actor: me,
        action: "partner_login.reset_link_issued",
        payload: { userId: user.id, email: cred.email },
        summary: `${me.name} issued a new activation link for the partner-portal login of ${user.name} (sessions revoked).`,
      });
      res.json({
        ok: true,
        // trustedRequestOrigin only honours allow-listed hostnames (else
        // the canonical origin / relative), never a raw Origin header.
        activationUrl: `${trustedOrigin ?? ""}/activate?token=${rawToken}`,
        activationExpiresAt: expiresAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

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

// Task #874 — re-send the registration link for a firm's active login.
// Minting supersedes any earlier unused token of the same purpose, so only
// the newest link works (same discipline as activation links). Refused once
// the partner has completed registration (credential is user-managed).
// @cli-skip: security-sensitive external login administration — deliberate UI-only write
router.post(
  "/partners/firms/:firmId/logins/:userId/resend-registration",
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
            isNull(atelierUsers.deletedAt),
          ),
        );
      if (!user) {
        res.status(404).json({ error: "login-not-found" });
        return;
      }
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
      const [cred] = await db
        .select()
        .from(atelierAuthCredentials)
        .where(eq(atelierAuthCredentials.userId, user.id));
      if (!cred || cred.disabled) {
        res.status(404).json({ error: "login-not-found" });
        return;
      }
      // NOTE: provisionPortalLogin stamps the placeholder credential
      // userManaged — the reliable "registration done" signal is the firm's
      // registrationCompletedAt (set inside the registration transaction).
      if (firm.registrationCompletedAt) {
        res.status(409).json({
          error: "already-registered",
          message: "This partner has already completed registration.",
        });
        return;
      }
      const { rawToken, expiresAt } = await mintLoginToken({
        email: user.email,
        userId: user.id,
        purpose: "partner_registration",
        ttlMs: 72 * 60 * 60 * 1000,
        createdByUserId: me.id,
      });
      let origin: string | null = null;
      try {
        const parsed = new URL(String(req.headers.origin ?? ""));
        if (parsed.protocol === "https:" || parsed.protocol === "http:") origin = parsed.origin;
      } catch {
        // no valid origin — return a relative link only
      }
      const registrationUrl = origin
        ? `${origin}/partner-register?token=${rawToken}`
        : `/partner-register?token=${rawToken}`;
      const emailStatus = await sendPartnerRegistrationEmail({
        fullName: user.name,
        email: user.email,
        firmName: firm.name,
        registrationUrl: origin ? registrationUrl : null,
        validity: "72 hours",
        sender: { actor: { name: me.name, email: me.email } },
      });
      await audit({
        entityType: "partner_firm",
        entityId: firm.id,
        actor: me,
        action: "partner_login.registration_resent",
        payload: { userId: user.id, email: user.email },
        summary: `${me.name} re-sent the registration link for ${user.name} (${firm.name}).`,
      });
      res.json({
        ok: true,
        registrationUrl,
        expiresAt: expiresAt.toISOString(),
        email: emailStatus,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------
// Task #874 — firm bank-details maker-checker (finance/leadership).
// Partner-submitted bank details land as PENDING rows; the approve route
// below is the ONLY code path that writes the payable bank columns on the
// firm record. Paths avoid /partners/firms/:id to dodge param-route capture.
// ---------------------------------------------------------------------

function requireFinanceOrLeadership(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (!isLeadership(me.role) && !isFinance(me.role)) {
    res.status(403).json({ error: "finance-or-leadership-only" });
    return null;
  }
  return me;
}

function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const v = iban.replace(/\s+/g, "");
  if (v.length <= 4) return "••••";
  return `••••${v.slice(-4)}`;
}

function bankReqWire(
  r: typeof atelierPartnerFirmBankChangeRequests.$inferSelect,
  firmName: string | null,
) {
  return {
    id: r.id,
    partnerFirmId: r.partnerFirmId,
    firmName: firmName ?? "(deleted firm)",
    previousIbanMasked: r.previousIbanMasked,
    newIbanMasked: maskIban(r.newIban) ?? "••••",
    newSwift: r.newSwift,
    newBankName: r.newBankName,
    newCurrency: r.newCurrency,
    reason: r.reason,
    status: r.status,
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  };
}

// @cli-skip: internal finance review queue — UI-only surface (Task #874)
router.get("/partners/bank-changes", async (req, res, next) => {
  try {
    const me = requireFinanceOrLeadership(req, res);
    if (!me) return;
    const rows = await db
      .select({
        req: atelierPartnerFirmBankChangeRequests,
        firmName: atelierPartnerFirms.name,
      })
      .from(atelierPartnerFirmBankChangeRequests)
      .leftJoin(
        atelierPartnerFirms,
        eq(atelierPartnerFirms.id, atelierPartnerFirmBankChangeRequests.partnerFirmId),
      )
      .where(
        and(
          eq(atelierPartnerFirmBankChangeRequests.orgId, me.orgId),
          isNull(atelierPartnerFirmBankChangeRequests.deletedAt),
        ),
      )
      .orderBy(desc(atelierPartnerFirmBankChangeRequests.createdAt));
    rows.sort((a, b) => (a.req.status === "pending" ? 0 : 1) - (b.req.status === "pending" ? 0 : 1));
    res.json({ items: rows.map((r) => bankReqWire(r.req, r.firmName)) });
  } catch (err) {
    next(err);
  }
});

async function loadPendingBankReq(me: Me, id: string) {
  const [row] = await db
    .select()
    .from(atelierPartnerFirmBankChangeRequests)
    .where(
      and(
        eq(atelierPartnerFirmBankChangeRequests.id, id),
        eq(atelierPartnerFirmBankChangeRequests.orgId, me.orgId),
        isNull(atelierPartnerFirmBankChangeRequests.deletedAt),
      ),
    );
  return row ?? null;
}

// @cli-skip: security-sensitive payable-details approval — deliberate UI-only write (Task #874)
router.post("/partners/bank-changes/:id/approve", async (req, res, next) => {
  try {
    const me = requireFinanceOrLeadership(req, res);
    if (!me) return;
    const reqRow = await loadPendingBankReq(me, req.params.id);
    if (!reqRow) {
      res.status(404).json({ error: "bank-change-not-found" });
      return;
    }
    if (reqRow.status !== "pending") {
      res.status(409).json({ error: "already-decided", status: reqRow.status });
      return;
    }
    // Maker-checker: the submitter can never approve their own request.
    if (reqRow.requestedByUserId === me.id) {
      res.status(403).json({ error: "no-self-approval" });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
    const [firm] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(
        and(
          eq(atelierPartnerFirms.id, reqRow.partnerFirmId),
          eq(atelierPartnerFirms.orgId, me.orgId),
          isNull(atelierPartnerFirms.deletedAt),
        ),
      );
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    const won = await db.transaction(async (tx) => {
      // Atomically CLAIM the pending row first (conditional on status) so
      // two concurrent reviewers can't both decide it — only the winner
      // proceeds to write the firm's payable bank columns.
      const claimed = await tx
        .update(atelierPartnerFirmBankChangeRequests)
        .set({
          status: "approved",
          decidedByUserId: me.id,
          decidedByName: me.name,
          decidedAt: new Date(),
          decisionNote: note,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(atelierPartnerFirmBankChangeRequests.id, reqRow.id),
            eq(atelierPartnerFirmBankChangeRequests.status, "pending"),
          ),
        )
        .returning({ id: atelierPartnerFirmBankChangeRequests.id });
      if (claimed.length === 0) return false;
      // This is the SOLE write path for the firm's payable bank columns.
      await tx
        .update(atelierPartnerFirms)
        .set({
          bankIban: reqRow.newIban,
          bankSwift: reqRow.newSwift,
          bankName: reqRow.newBankName,
          bankCurrency: reqRow.newCurrency,
          updatedAt: new Date(),
        })
        .where(eq(atelierPartnerFirms.id, firm.id));
      return true;
    });
    if (!won) {
      res.status(409).json({ error: "already-decided" });
      return;
    }
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_firm.bank_change.approved",
      payload: {
        bankChangeRequestId: reqRow.id,
        newIbanMasked: maskIban(reqRow.newIban),
        newSwift: reqRow.newSwift,
        newBankName: reqRow.newBankName,
        newCurrency: reqRow.newCurrency,
      },
      summary: `${me.name} approved the bank details for ${firm.name} — they are now payable.`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: security-sensitive payable-details rejection — deliberate UI-only write (Task #874)
router.post("/partners/bank-changes/:id/reject", async (req, res, next) => {
  try {
    const me = requireFinanceOrLeadership(req, res);
    if (!me) return;
    const reqRow = await loadPendingBankReq(me, req.params.id);
    if (!reqRow) {
      res.status(404).json({ error: "bank-change-not-found" });
      return;
    }
    if (reqRow.status !== "pending") {
      res.status(409).json({ error: "already-decided", status: reqRow.status });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
    // Atomic claim: only transitions pending → rejected; a concurrent
    // approve/reject that got there first wins and this returns 409.
    const claimed = await db
      .update(atelierPartnerFirmBankChangeRequests)
      .set({
        status: "rejected",
        decidedByUserId: me.id,
        decidedByName: me.name,
        decidedAt: new Date(),
        decisionNote: note,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierPartnerFirmBankChangeRequests.id, reqRow.id),
          eq(atelierPartnerFirmBankChangeRequests.status, "pending"),
        ),
      )
      .returning({ id: atelierPartnerFirmBankChangeRequests.id });
    if (claimed.length === 0) {
      res.status(409).json({ error: "already-decided" });
      return;
    }
    await audit({
      entityType: "partner_firm",
      entityId: reqRow.partnerFirmId,
      actor: me,
      action: "partner_firm.bank_change.rejected",
      payload: { bankChangeRequestId: reqRow.id },
      summary: `${me.name} rejected a partner-firm bank-details submission.`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
