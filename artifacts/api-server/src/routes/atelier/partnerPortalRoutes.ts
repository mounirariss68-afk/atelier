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

import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, desc, inArray, sql } from "drizzle-orm";
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
  atelierPartnerFirmDocuments,
  atelierPartnerContactSuggestions,
  atelierPartnerNotifications,
} from "@workspace/db";
import { notifyPartnerFirm } from "../../lib/partnerNotify.js";
import { audit } from "./engagementRoutes";
import { isLeadership, canEditPartnersLens } from "./personaRoles";
import { revokeAllSessions } from "../../lib/auth/session.js";
import { trustedRequestOrigin } from "../../lib/auth/trusted-origin";
import { provisionPortalLogin } from "./rosterLifecycleRoutes";
import { mintLoginToken } from "../auth/index.js";
import { sendPartnerRegistrationEmail } from "../../lib/atelier-welcome-email.js";
import { isFinance } from "./personaRoles";
import { normalizeContacts, stampContactPersons } from "./partnersRoutes";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import {
  storePartnerDocBytes,
  loadPartnerDocBytes,
  dropPartnerDocBytes,
  decodeBase64Strict,
  magicBytesMatchMime,
} from "../../lib/partnerDocStorage.js";

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

// The firm an alliance-partner login belongs to (null when the link is
// missing OR the firm is archived) plus the preview-aware portal resolver
// and preview guard now live in the shared portalFirmResolver module so the
// contracts/billing portal and this router scope requests identically.
export {
  resolveAlliancePartnerFirm,
  resolvePortalFirm,
  refuseIfPreview,
} from "./portalFirmResolver";
import {
  resolveAlliancePartnerFirm,
  resolvePortalFirm,
  refuseIfPreview,
} from "./portalFirmResolver";

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

/**
 * Task #1173 — granted-opportunity scope for an arbitrary (already-loaded,
 * live) firm. Shared by partner reads AND leadership preview reads. Same
 * projection as grantedOpportunitiesForPartner, minus the firm resolution.
 */
export async function grantedOppScopeForFirm(
  orgId: string,
  firm: typeof atelierPartnerFirms.$inferSelect,
): Promise<{
  opps: Array<typeof atelierOpportunities.$inferSelect>;
  sharedAtByOppId: Map<string, Date>;
}> {
  const grantRows = await db
    .select({
      opportunityId: atelierPartnerOppGrants.opportunityId,
      createdAt: atelierPartnerOppGrants.createdAt,
    })
    .from(atelierPartnerOppGrants)
    .where(
      and(
        eq(atelierPartnerOppGrants.orgId, orgId),
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
  if (oppIds.length === 0) return { opps: [], sharedAtByOppId };
  const opps = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.orgId, orgId),
        inArray(atelierOpportunities.id, oppIds),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  return { opps, sharedAtByOppId };
}

// resolvePortalFirm / refuseIfPreview + the Express.Request.portalPreview
// declaration now live in ./portalFirmResolver (imported above) and are
// re-exported so existing importers keep working.
//
// The per-user /partner-portal/* throttle also lives there
// (partnerPortalThrottle) and is mounted ONCE on the common atelier parent
// router in routes/atelier/index.ts — so it covers BOTH this router and the
// separately-mounted partnerBillingRoutes without double-counting.
// __resetPortalRateLimit is re-exported for existing test importers.
export { __resetPortalRateLimit } from "./portalFirmResolver";

// ---------------------------------------------------------------------
// Partner-facing reads (/partner-portal/*)
// ---------------------------------------------------------------------

// @cli-skip: partner-portal read — external alliance-partner surface; chat parity provided by partnerportal.opportunities capability
router.get("/partner-portal/opportunities", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    // Task #1173 — audit each preview-mode entry read (kept simple: fires
    // on every opportunities GET while previewing).
    if (req.portalPreview) {
      await audit({
        entityType: "partner_firm",
        entityId: firm.id,
        actor: me,
        action: "partner_portal.previewed",
        payload: { firmId: firm.id, firmName: firm.name, surface: "opportunities" },
        summary: `${me.name} previewed ${firm.name}'s partner portal (opportunities).`,
      });
    }
    const scope = await grantedOppScopeForFirm(me.orgId, firm);
    res.json({
      firm: { id: firm.id, name: firm.name },
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
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    const scope = await grantedOppScopeForFirm(me.orgId, firm);
    const opp = scope.opps.find((o) => o.id === req.params.oppId);
    // Foreign-firm / revoked / unknown ids are indistinguishable: 404.
    if (!opp) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json({
      firm: { id: firm.id, name: firm.name },
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
      const resolved = await resolvePortalFirm(req, res);
      if (!resolved) return;
      const { me, firm } = resolved;
      const scope = await grantedOppScopeForFirm(me.orgId, firm);
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
    // Task #1173 — notify the firm (in-app + email) after commit.
    await notifyPartnerFirm({
      orgId: me.orgId,
      partnerFirmId: firm.id,
      kind: "grant_shared",
      title: "A new opportunity was shared with you",
      body: `"${opp.name}" is now visible in your partner portal.`,
      href: "/partner/opportunities",
      email: {
        subject: "A new opportunity was shared with you — Cognirise",
        paragraphs: [
          `Cognirise has shared the opportunity "${opp.name}" with ${firm.name}.`,
          "Sign in to your partner portal to view the details.",
        ],
      },
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
      // Task #1173 — notify the firm (in-app only; no email for revokes).
      await notifyPartnerFirm({
        orgId: me.orgId,
        partnerFirmId: grant.partnerFirmId,
        kind: "grant_revoked",
        title: "An opportunity is no longer shared with you",
        body: "One of the opportunities previously shared with your firm has been removed from your portal.",
        href: "/partner/opportunities",
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
    // Task #1173 — firms may now have MULTIPLE active portal logins. The v1
    // one-active-login-per-firm gate (and its 23505 → 409 mapping) is gone;
    // provisionPortalLogin still refuses a duplicate email via its own
    // credential-collision check.
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
      partnerFirmName: firm.name,
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

// Task #1173 — offboard a partner firm: deactivate ALL active
// alliance-partner logins (soft-delete + revoke sessions each). Idempotent
// — re-running after every login is already down is a no-op. Leadership-only,
// audited partner_firm.offboarded.
// @cli-skip: security-sensitive external offboarding — deliberate UI-only write
router.post("/partners/firms/:firmId/offboard", async (req, res, next) => {
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
        ),
      );
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    const logins = await db
      .select()
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.orgId, me.orgId),
          eq(atelierUsers.role, "alliance_partner"),
          eq(atelierUsers.partnerFirmId, firm.id),
          isNull(atelierUsers.deletedAt),
        ),
      );
    const now = new Date();
    for (const u of logins) {
      await db
        .update(atelierUsers)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(atelierUsers.id, u.id));
      // Always revoke sessions so access ends NOW.
      await revokeAllSessions(u.id);
    }
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_firm.offboarded",
      payload: {
        firmName: firm.name,
        deactivatedUserIds: logins.map((u) => u.id),
        deactivatedCount: logins.length,
      },
      summary: `${me.name} offboarded ${firm.name} — ${logins.length} portal login(s) deactivated.`,
    });
    res.json({ ok: true, deactivated: logins.length });
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
        // Supersede EVERY prior live link for THIS login so only the newest
        // one works. Scope by userId (not email alone) and include BOTH the
        // first-time `partner_registration` link the provisioning flow mints
        // AND any earlier `activation` reset link — otherwise a freshly
        // provisioned partner (whose only live token has purpose
        // "partner_registration") would keep a second working link after a
        // reset. (Task #1173 — multi-login provisioning mints
        // partner_registration; Task #885 reset mints activation.)
        await tx
          .update(atelierLoginActivationTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(atelierLoginActivationTokens.userId, user.id),
              inArray(atelierLoginActivationTokens.purpose, [
                "activation",
                "partner_registration",
              ]),
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
    // Task #1173 — notify the firm of the bank-change decision.
    await notifyPartnerFirm({
      orgId: me.orgId,
      partnerFirmId: firm.id,
      kind: "bank_change_decided",
      title: "Your bank details were approved",
      body: "The bank details you submitted have been approved and are now on file for payments.",
      href: "/partner/company",
      email: {
        subject: "Your bank details were approved — Cognirise",
        paragraphs: [
          `The bank details submitted for ${firm.name} have been approved and are now on file for payments.`,
        ],
      },
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
    // Task #1173 — notify the firm of the bank-change decision.
    await notifyPartnerFirm({
      orgId: me.orgId,
      partnerFirmId: reqRow.partnerFirmId,
      kind: "bank_change_decided",
      title: "Your bank details were not accepted",
      body: note
        ? `Your bank-details submission was not accepted. Note: ${note}`
        : "Your bank-details submission was not accepted. Please review and resubmit.",
      href: "/partner/company",
      email: {
        subject: "Action needed: your bank details — Cognirise",
        paragraphs: [
          "The bank details you submitted were not accepted.",
          note ? `Reviewer note: ${note}` : "Please sign in to your portal to review and resubmit.",
        ],
      },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Task #1172 — Partner firm document library + contact suggestions.
// =====================================================================

const PARTNER_DOC_KINDS = new Set([
  "trade_license",
  "certificate",
  "insurance",
  "vat_trn",
  "signatory_id",
  "other",
]);
const PARTNER_DOC_MIMES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const PARTNER_DOC_MAX_BYTES = 10 * 1024 * 1024;

/** Serialized firm-document row — never leaks fileRef / sha256. */
function partnerDocWire(d: typeof atelierPartnerFirmDocuments.$inferSelect) {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title ?? null,
    fileName: d.fileName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    issuedDate: d.issuedDate ?? null,
    expiryDate: d.expiryDate ?? null,
    reviewStatus: d.reviewStatus,
    reviewNote: d.reviewNote ?? null,
    reviewedByName: d.reviewedByName ?? null,
    reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
    uploadedVia: d.uploadedVia,
    createdAt: d.createdAt.toISOString(),
  };
}

function contactSuggestionWire(
  s: typeof atelierPartnerContactSuggestions.$inferSelect,
  firmName?: string | null,
) {
  return {
    id: s.id,
    partnerFirmId: s.partnerFirmId,
    firmName: firmName ?? undefined,
    proposedContacts: (s.proposedContacts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role ?? null,
      email: c.email ?? null,
    })),
    note: s.note ?? null,
    status: s.status,
    decidedByName: s.decidedByName ?? null,
    decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
    decisionNote: s.decisionNote ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

const isoDate = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : t;
};

// ---------------------------------------------------------------------
// Partner-facing (alliance_partner; strictly scoped to me.partnerFirmId)
// ---------------------------------------------------------------------

// @cli-skip: partner-portal read — external surface (Task #1172)
router.get("/partner-portal/company-profile", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    const docs = await db
      .select()
      .from(atelierPartnerFirmDocuments)
      .where(
        and(
          eq(atelierPartnerFirmDocuments.orgId, me.orgId),
          eq(atelierPartnerFirmDocuments.partnerFirmId, firm.id),
          isNull(atelierPartnerFirmDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPartnerFirmDocuments.createdAt));
    const [pendingSuggestion] = await db
      .select()
      .from(atelierPartnerContactSuggestions)
      .where(
        and(
          eq(atelierPartnerContactSuggestions.orgId, me.orgId),
          eq(atelierPartnerContactSuggestions.partnerFirmId, firm.id),
          eq(atelierPartnerContactSuggestions.status, "pending"),
          isNull(atelierPartnerContactSuggestions.deletedAt),
        ),
      )
      .orderBy(desc(atelierPartnerContactSuggestions.createdAt));
    res.json({
      firm: {
        id: firm.id,
        name: firm.name,
        legalName: firm.legalName ?? null,
        registrationNumber: firm.registrationNumber ?? null,
        taxId: firm.taxId ?? null,
        registeredAddress: firm.registeredAddress ?? null,
        bankName: firm.bankName ?? null,
        bankIbanMasked: maskIban(firm.bankIban),
        bankCurrency: firm.bankCurrency ?? firm.defaultBillingCurrency ?? null,
        bankDetailsOnFile: Boolean(firm.bankIban),
      },
      contacts: (firm.contacts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role ?? null,
        email: c.email ?? null,
      })),
      documents: docs.map(partnerDocWire),
      pendingContactSuggestion: pendingSuggestion
        ? contactSuggestionWire(pendingSuggestion)
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal write — external surface (Task #1172)
router.post(
  "/partner-portal/company-documents",
  // Body parsing at 16mb is handled by the path-scoped parser mounted in
  // app.ts (BEFORE the default 100KB express.json), so no per-route parser.
  async (req, res, next) => {
    try {
      const resolved = await resolvePortalFirm(req, res);
      if (!resolved) return;
      if (refuseIfPreview(req, res)) return;
      const { me, firm } = resolved;
      const kind = String(req.body?.kind ?? "");
      if (!PARTNER_DOC_KINDS.has(kind)) {
        res.status(400).json({ error: "invalid-kind", allowed: [...PARTNER_DOC_KINDS] });
        return;
      }
      const fileName = String(req.body?.fileName ?? "").trim().slice(0, 300);
      if (!fileName) {
        res.status(400).json({ error: "invalid-body", message: "fileName is required." });
        return;
      }
      const mime = String(req.body?.mime ?? "").trim().toLowerCase();
      if (!PARTNER_DOC_MIMES.has(mime)) {
        res.status(400).json({ error: "invalid-mime", allowed: [...PARTNER_DOC_MIMES] });
        return;
      }
      const buf = decodeBase64Strict(String(req.body?.base64 ?? ""));
      if (!buf) {
        res.status(400).json({ error: "invalid-base64" });
        return;
      }
      if (buf.byteLength === 0 || buf.byteLength > PARTNER_DOC_MAX_BYTES) {
        res.status(400).json({ error: "invalid-size", maxBytes: PARTNER_DOC_MAX_BYTES });
        return;
      }
      if (!magicBytesMatchMime(buf, mime)) {
        res.status(400).json({ error: "content-mismatch", message: "File content does not match the declared type." });
        return;
      }
      const title = (() => {
        const t = String(req.body?.title ?? "").trim();
        return t ? t.slice(0, 300) : null;
      })();
      const stored = await storePartnerDocBytes(buf, mime);
      const docId = rid("pfdoc");
      const [created] = await db
        .insert(atelierPartnerFirmDocuments)
        .values({
          id: docId,
          orgId: me.orgId,
          partnerFirmId: firm.id,
          kind,
          title,
          fileName,
          mime,
          fileRef: stored.fileRef,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          issuedDate: isoDate(req.body?.issuedDate),
          expiryDate: isoDate(req.body?.expiryDate),
          reviewStatus: "pending",
          uploadedByUserId: me.id,
          uploadedVia: "portal",
        })
        .returning();
      await audit({
        entityType: "partner_firm",
        entityId: firm.id,
        actor: me,
        action: "partner_firm.document.uploaded",
        payload: { documentId: docId, kind, fileName, sizeBytes: stored.sizeBytes, uploadedVia: "portal" },
        summary: `${me.name} uploaded ${kind} document "${fileName}" for ${firm.name} via the partner portal.`,
      });
      res.status(201).json({ ok: true, document: partnerDocWire(created) });
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: partner-portal download — external surface, own-firm only (Task #1172)
router.get("/partner-portal/company-documents/:id/download", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    const [doc] = await db
      .select()
      .from(atelierPartnerFirmDocuments)
      .where(
        and(
          eq(atelierPartnerFirmDocuments.id, req.params.id),
          eq(atelierPartnerFirmDocuments.orgId, me.orgId),
          eq(atelierPartnerFirmDocuments.partnerFirmId, firm.id),
          isNull(atelierPartnerFirmDocuments.deletedAt),
        ),
      );
    if (!doc) {
      res.status(404).json({ error: "document-not-found" });
      return;
    }
    const bytes = await loadPartnerDocBytes(doc.fileRef);
    if (!bytes) {
      res.status(404).json({ error: "document-missing" });
      return;
    }
    res.setHeader("Content-Type", doc.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", doc.fileName));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal write — external surface (Task #1172)
router.post("/partner-portal/contact-suggestions", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    if (refuseIfPreview(req, res)) return;
    const { me, firm } = resolved;
    const rawContacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    if (rawContacts.length === 0 || rawContacts.length > 25) {
      res.status(400).json({ error: "invalid-body", message: "Provide between 1 and 25 contacts." });
      return;
    }
    const proposed: Array<{ id: string; name: string; role: string | null; email: string | null }> = [];
    for (const raw of rawContacts) {
      const c = (raw ?? {}) as Record<string, unknown>;
      const name = typeof c.name === "string" ? c.name.trim().slice(0, 200) : "";
      if (!name) {
        res.status(400).json({ error: "invalid-body", message: "Each contact requires a name." });
        return;
      }
      const email = typeof c.email === "string" ? c.email.trim().slice(0, 320) || null : null;
      if (email && !email.includes("@")) {
        res.status(400).json({ error: "invalid-body", message: `Invalid email for contact "${name}".` });
        return;
      }
      const role = typeof c.role === "string" ? c.role.trim().slice(0, 200) || null : null;
      proposed.push({ id: rid("pfc"), name, role, email });
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) || null : null;
    const sugId = rid("pfcsug");
    await db.transaction(async (tx) => {
      // Supersede any earlier pending suggestion for this firm (latest wins).
      await tx
        .update(atelierPartnerContactSuggestions)
        .set({ status: "rejected", decisionNote: "Superseded by a newer submission.", decidedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(atelierPartnerContactSuggestions.orgId, me.orgId),
            eq(atelierPartnerContactSuggestions.partnerFirmId, firm.id),
            eq(atelierPartnerContactSuggestions.status, "pending"),
            isNull(atelierPartnerContactSuggestions.deletedAt),
          ),
        );
      await tx.insert(atelierPartnerContactSuggestions).values({
        id: sugId,
        orgId: me.orgId,
        partnerFirmId: firm.id,
        proposedContacts: proposed,
        note,
        status: "pending",
        submittedByUserId: me.id,
      });
    });
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_firm.contacts.suggested",
      payload: { suggestionId: sugId, count: proposed.length },
      summary: `${me.name} suggested ${proposed.length} contact update(s) for ${firm.name} (pending internal review).`,
    });
    res.status(201).json({ ok: true, suggestionId: sugId });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Internal review — firm documents + contact suggestions (audited).
// Gate: leadership + senior_manager + finance (matches canEditPartnersLens,
// the partner-admin write gate). Chosen over the narrower finance/leadership
// bank-changes gate because documents are ops-relevant, not payable-details.
// ---------------------------------------------------------------------

function requirePartnerAdmin(req: Request, res: Response): Me | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (!canEditPartnersLens(me.role)) {
    res.status(403).json({ error: "partners-admin-only" });
    return null;
  }
  return me;
}

// @cli-skip: internal partner-admin review queue — UI-only surface (Task #1172)
router.get("/partners/firm-documents", async (req, res, next) => {
  try {
    const me = requirePartnerAdmin(req, res);
    if (!me) return;
    const status = String(req.query.status ?? "pending");
    const partnerFirmId =
      typeof req.query.partnerFirmId === "string" ? req.query.partnerFirmId : null;
    const conds = [
      eq(atelierPartnerFirmDocuments.orgId, me.orgId),
      isNull(atelierPartnerFirmDocuments.deletedAt),
    ];
    if (status !== "all") conds.push(eq(atelierPartnerFirmDocuments.reviewStatus, status));
    if (partnerFirmId) conds.push(eq(atelierPartnerFirmDocuments.partnerFirmId, partnerFirmId));
    const rows = await db
      .select({ doc: atelierPartnerFirmDocuments, firmName: atelierPartnerFirms.name })
      .from(atelierPartnerFirmDocuments)
      .leftJoin(
        atelierPartnerFirms,
        eq(atelierPartnerFirms.id, atelierPartnerFirmDocuments.partnerFirmId),
      )
      .where(and(...conds))
      .orderBy(desc(atelierPartnerFirmDocuments.createdAt));
    res.json({
      items: rows.map((r) => ({
        ...partnerDocWire(r.doc),
        partnerFirmId: r.doc.partnerFirmId,
        firmName: r.firmName ?? "(deleted firm)",
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: internal partner-admin document download — UI-only surface (Task #1172)
router.get("/partners/firm-documents/:id/download", async (req, res, next) => {
  try {
    const me = requirePartnerAdmin(req, res);
    if (!me) return;
    const [doc] = await db
      .select()
      .from(atelierPartnerFirmDocuments)
      .where(
        and(
          eq(atelierPartnerFirmDocuments.id, req.params.id),
          eq(atelierPartnerFirmDocuments.orgId, me.orgId),
          isNull(atelierPartnerFirmDocuments.deletedAt),
        ),
      );
    if (!doc) {
      res.status(404).json({ error: "document-not-found" });
      return;
    }
    const bytes = await loadPartnerDocBytes(doc.fileRef);
    if (!bytes) {
      res.status(404).json({ error: "document-missing" });
      return;
    }
    res.setHeader("Content-Type", doc.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", doc.fileName));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: internal partner-admin document review — UI-only write (Task #1172)
router.post("/partners/firm-documents/:id/review", async (req, res, next) => {
  try {
    const me = requirePartnerAdmin(req, res);
    if (!me) return;
    const decision = String(req.body?.decision ?? "");
    if (decision !== "accepted" && decision !== "rejected") {
      res.status(400).json({ error: "invalid-body", message: "decision must be accepted|rejected." });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
    const [doc] = await db
      .select()
      .from(atelierPartnerFirmDocuments)
      .where(
        and(
          eq(atelierPartnerFirmDocuments.id, req.params.id),
          eq(atelierPartnerFirmDocuments.orgId, me.orgId),
          isNull(atelierPartnerFirmDocuments.deletedAt),
        ),
      );
    if (!doc) {
      res.status(404).json({ error: "document-not-found" });
      return;
    }
    if (doc.reviewStatus !== "pending") {
      res.status(409).json({ error: "already-decided", status: doc.reviewStatus });
      return;
    }
    // Single-decider CAS: only transitions pending → decision.
    const claimed = await db
      .update(atelierPartnerFirmDocuments)
      .set({
        reviewStatus: decision,
        reviewNote: note,
        reviewedByUserId: me.id,
        reviewedByName: me.name,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierPartnerFirmDocuments.id, doc.id),
          eq(atelierPartnerFirmDocuments.reviewStatus, "pending"),
        ),
      )
      .returning({ id: atelierPartnerFirmDocuments.id });
    if (claimed.length === 0) {
      res.status(409).json({ error: "already-decided" });
      return;
    }
    await audit({
      entityType: "partner_firm",
      entityId: doc.partnerFirmId,
      actor: me,
      action: "partner_firm.document.reviewed",
      payload: { documentId: doc.id, decision, kind: doc.kind },
      summary: `${me.name} ${decision} the ${doc.kind} document "${doc.fileName}".`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: internal partner-admin contact-suggestion queue — UI-only surface (Task #1172)
router.get("/partners/contact-suggestions", async (req, res, next) => {
  try {
    const me = requirePartnerAdmin(req, res);
    if (!me) return;
    const status = String(req.query.status ?? "pending");
    const conds = [
      eq(atelierPartnerContactSuggestions.orgId, me.orgId),
      isNull(atelierPartnerContactSuggestions.deletedAt),
    ];
    if (status !== "all") conds.push(eq(atelierPartnerContactSuggestions.status, status));
    const rows = await db
      .select({ sug: atelierPartnerContactSuggestions, firmName: atelierPartnerFirms.name })
      .from(atelierPartnerContactSuggestions)
      .leftJoin(
        atelierPartnerFirms,
        eq(atelierPartnerFirms.id, atelierPartnerContactSuggestions.partnerFirmId),
      )
      .where(and(...conds))
      .orderBy(desc(atelierPartnerContactSuggestions.createdAt));
    res.json({ items: rows.map((r) => contactSuggestionWire(r.sug, r.firmName)) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: internal partner-admin contact-suggestion decision — UI-only write (Task #1172)
router.post("/partners/contact-suggestions/:id/decide", async (req, res, next) => {
  try {
    const me = requirePartnerAdmin(req, res);
    if (!me) return;
    const decision = String(req.body?.decision ?? "");
    if (decision !== "approved" && decision !== "rejected") {
      res.status(400).json({ error: "invalid-body", message: "decision must be approved|rejected." });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
    const [sug] = await db
      .select()
      .from(atelierPartnerContactSuggestions)
      .where(
        and(
          eq(atelierPartnerContactSuggestions.id, req.params.id),
          eq(atelierPartnerContactSuggestions.orgId, me.orgId),
          isNull(atelierPartnerContactSuggestions.deletedAt),
        ),
      );
    if (!sug) {
      res.status(404).json({ error: "suggestion-not-found" });
      return;
    }
    if (sug.status !== "pending") {
      res.status(409).json({ error: "already-decided", status: sug.status });
      return;
    }
    const [firm] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(
        and(
          eq(atelierPartnerFirms.id, sug.partnerFirmId),
          eq(atelierPartnerFirms.orgId, me.orgId),
          isNull(atelierPartnerFirms.deletedAt),
        ),
      );
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    const won = await db.transaction(async (tx) => {
      // CAS claim the pending suggestion so two reviewers can't both decide.
      const claimed = await tx
        .update(atelierPartnerContactSuggestions)
        .set({
          status: decision,
          decidedByUserId: me.id,
          decidedByName: me.name,
          decidedAt: new Date(),
          decisionNote: note,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(atelierPartnerContactSuggestions.id, sug.id),
            eq(atelierPartnerContactSuggestions.status, "pending"),
          ),
        )
        .returning({ id: atelierPartnerContactSuggestions.id });
      if (claimed.length === 0) return false;
      if (decision === "approved") {
        // The portal sends the FULL edited contact list; approving REPLACES
        // the firm's contact list with it. To avoid duplicate person records
        // and duplicate `pfr_pfc_<id>` roster rows, we re-attach the existing
        // entry's id + personId when the proposed contact matches an existing
        // one (by email first, else by exact trimmed name). Matched entries
        // then carry a personId, so stampContactPersons leaves them untouched.
        const existing = (firm.contacts ?? []) as Array<{
          id?: string;
          name: string;
          role?: string | null;
          email?: string | null;
          personId?: string | null;
        }>;
        const byEmail = new Map<string, (typeof existing)[number]>();
        const byName = new Map<string, (typeof existing)[number]>();
        for (const e of existing) {
          const em = (e.email ?? "").trim().toLowerCase();
          if (em) byEmail.set(em, e);
          const nm = (e.name ?? "").trim().toLowerCase();
          if (nm && !byName.has(nm)) byName.set(nm, e);
        }
        const replacement = normalizeContacts(
          (sug.proposedContacts ?? []).map((c) => {
            const em = (c.email ?? "").trim().toLowerCase();
            const nm = (c.name ?? "").trim().toLowerCase();
            const match = (em && byEmail.get(em)) || (nm && byName.get(nm)) || null;
            return {
              // Preserve the matched entry's id so the deterministic
              // pfr_pfc_<id> roster row is reused, not re-created.
              id: match?.id,
              name: c.name,
              role: c.role ?? null,
              email: c.email ?? null,
              // Preserve the matched entry's personId so it is not re-promoted.
              personId: match?.personId ?? null,
            };
          }),
        ) ?? [];
        const stamped = await stampContactPersons(tx, me, firm.id, replacement);
        await tx
          .update(atelierPartnerFirms)
          .set({ contacts: stamped, updatedAt: new Date() })
          .where(eq(atelierPartnerFirms.id, firm.id));
      }
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
      action: "partner_firm.contacts_suggestion.decided",
      payload: { suggestionId: sug.id, decision, count: (sug.proposedContacts ?? []).length },
      summary:
        decision === "approved"
          ? `${me.name} approved ${(sug.proposedContacts ?? []).length} contact update(s) for ${firm.name}.`
          : `${me.name} rejected a contact-update suggestion for ${firm.name}.`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Task #1173 — Partner notification center (portal reads + mark-read).
// Scoped via resolvePortalFirm: alliance_partner sees own firm; leadership
// may preview (read-only — marking read is refused in preview).
// =====================================================================

function notificationWire(n: typeof atelierPartnerNotifications.$inferSelect) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body ?? null,
    href: n.href ?? null,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

// @cli-skip: partner-portal read — external notification center (Task #1173)
router.get("/partner-portal/notifications", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    // Task #1173 — audit preview entry reads on the notifications surface too.
    if (req.portalPreview) {
      await audit({
        entityType: "partner_firm",
        entityId: firm.id,
        actor: me,
        action: "partner_portal.previewed",
        payload: { firmId: firm.id, firmName: firm.name, surface: "notifications" },
        summary: `${me.name} previewed ${firm.name}'s partner portal (notifications).`,
      });
    }
    const rows = await db
      .select()
      .from(atelierPartnerNotifications)
      .where(
        and(
          eq(atelierPartnerNotifications.orgId, me.orgId),
          eq(atelierPartnerNotifications.partnerFirmId, firm.id),
          isNull(atelierPartnerNotifications.deletedAt),
        ),
      )
      .orderBy(desc(atelierPartnerNotifications.createdAt))
      .limit(50);
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(atelierPartnerNotifications)
      .where(
        and(
          eq(atelierPartnerNotifications.orgId, me.orgId),
          eq(atelierPartnerNotifications.partnerFirmId, firm.id),
          isNull(atelierPartnerNotifications.deletedAt),
          isNull(atelierPartnerNotifications.readAt),
        ),
      );
    const wire = rows.map(notificationWire);
    res.json({
      unreadCount: Number(count ?? 0),
      notifications: wire,
      // Alias consumed by the web bell (PartnerPortal.tsx).
      items: wire,
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal write — external notification mark-read (Task #1173)
router.post("/partner-portal/notifications/:id/read", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    if (refuseIfPreview(req, res)) return;
    const { me, firm } = resolved;
    const [row] = await db
      .select()
      .from(atelierPartnerNotifications)
      .where(
        and(
          eq(atelierPartnerNotifications.id, req.params.id),
          eq(atelierPartnerNotifications.orgId, me.orgId),
          eq(atelierPartnerNotifications.partnerFirmId, firm.id),
          isNull(atelierPartnerNotifications.deletedAt),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "notification-not-found" });
      return;
    }
    if (!row.readAt) {
      await db
        .update(atelierPartnerNotifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierPartnerNotifications.id, row.id));
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal write — external notification mark-all-read (Task #1173)
router.post("/partner-portal/notifications/read-all", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    if (refuseIfPreview(req, res)) return;
    const { me, firm } = resolved;
    await db
      .update(atelierPartnerNotifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(atelierPartnerNotifications.orgId, me.orgId),
          eq(atelierPartnerNotifications.partnerFirmId, firm.id),
          isNull(atelierPartnerNotifications.deletedAt),
          isNull(atelierPartnerNotifications.readAt),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
