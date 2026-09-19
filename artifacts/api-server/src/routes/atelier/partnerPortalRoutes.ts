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
  type NextFunction,
} from "express";
import { createHash, randomBytes } from "node:crypto";
import multer from "multer";
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
  atelierPartnerEngagementGrants,
  atelierPartnerSharedDocuments,
  atelierEngagements,
  atelierDeliverables,
  atelierRaidItems,
  atelierMeetings,
  atelierDocuments,
  atelierDocumentVersions,
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
import {
  storeSharedDocBytes,
  loadSharedDocBytes,
  dropSharedDocBytes,
} from "../../lib/partnerSharedDocStorage.js";
import { loadDocBytes } from "../../lib/atelier-documents.js";

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

// ---------------------------------------------------------------------
// Task #1174 — Delivery read model (field-allowlisted, server-composed).
//
// The partner delivery portal exposes GRANTED engagements only. The
// snapshot is built through a SINGLE pure wire-builder so the allowlist is
// testable + greppable. HARD EXCLUSIONS (never composed anywhere):
//   charter, workstreams, valueCase, economics, timesheets/expenses,
//   legalEntityId, owner/lead user ids, deliverable criticReadiness /
//   criticReportSummary / partner-approval internals / version bodies /
//   hypothesis ids, RAID ownerId/ownerName + mitigation, meeting attendees /
//   transcripts / links, and any OTHER firm's grants (never reveal that a
//   different firm is involved).
// ---------------------------------------------------------------------

/** The redacted delivery-list projection for one granted engagement. */
export function partnerEngagementWire(
  e: typeof atelierEngagements.$inferSelect,
  sharedAt?: Date | null,
): {
  id: string;
  name: string;
  plmStage: string;
  raidStatus: string;
  startDate: string | null;
  plannedEndDate: string | null;
  sharedAt: string | null;
} {
  return {
    id: e.id,
    name: e.name,
    // plmStage is the phase (mobilize|deliver|compound|closed); raidStatus is
    // the health colour. There is NO status/health column beyond these.
    plmStage: e.plmStage,
    raidStatus: e.raidStatus,
    startDate: e.startDate ?? null,
    plannedEndDate: e.plannedEndDate ?? null,
    sharedAt: sharedAt ? sharedAt.toISOString() : null,
  };
}

/**
 * The FULL delivery snapshot wire object. Pure: given the already-loaded
 * (and already firm-scoped) rows it composes ONLY allowlisted fields. This
 * is the single greppable allowlist — deep-scan tests assert forbidden keys
 * are absent from its output.
 */
export function partnerDeliverySnapshotWire(input: {
  engagement: typeof atelierEngagements.$inferSelect;
  sharedAt: Date | null;
  account: typeof atelierAccounts.$inferSelect | null;
  deliverables: Array<typeof atelierDeliverables.$inferSelect>;
  openItems: Array<typeof atelierRaidItems.$inferSelect>;
  upcomingMeetings: Array<typeof atelierMeetings.$inferSelect>;
}): {
  engagement: ReturnType<typeof partnerEngagementWire> & {
    account: ReturnType<typeof redactedAccountOverview> | null;
  };
  deliverables: Array<{
    name: string;
    type: string;
    status: string;
    dueDate: string | null;
    sentAt: string | null;
    clientVisibility: string;
  }>;
  openItems: Array<{
    kind: string;
    severity: string;
    status: string;
    dueDate: string | null;
    description: string;
  }>;
  upcomingMeetings: Array<{ title: string; date: string; kind: string }>;
} {
  return {
    engagement: {
      ...partnerEngagementWire(input.engagement, input.sharedAt),
      account: input.account ? redactedAccountOverview(input.account) : null,
    },
    deliverables: input.deliverables.map((d) => ({
      name: d.name,
      type: d.type,
      status: d.status,
      dueDate: d.dueDate ?? null,
      sentAt: d.sentAt ? d.sentAt.toISOString() : null,
      clientVisibility: d.clientVisibility,
    })),
    openItems: input.openItems.map((r) => ({
      kind: r.kind,
      severity: r.severity,
      status: r.status,
      dueDate: r.dueDate ?? null,
      description: r.description,
    })),
    upcomingMeetings: input.upcomingMeetings.map((m) => ({
      title: m.title,
      date: m.date,
      kind: m.kind,
    })),
  };
}

/**
 * Live granted engagements for a firm (rows + earliest active grant time),
 * org-scoped. Shared by partner reads AND leadership preview reads. Mirrors
 * grantedOppScopeForFirm.
 */
export async function grantedEngScopeForFirm(
  orgId: string,
  firm: typeof atelierPartnerFirms.$inferSelect,
): Promise<{
  engs: Array<typeof atelierEngagements.$inferSelect>;
  sharedAtByEngId: Map<string, Date>;
}> {
  const grantRows = await db
    .select({
      engagementId: atelierPartnerEngagementGrants.engagementId,
      createdAt: atelierPartnerEngagementGrants.createdAt,
    })
    .from(atelierPartnerEngagementGrants)
    .where(
      and(
        eq(atelierPartnerEngagementGrants.orgId, orgId),
        eq(atelierPartnerEngagementGrants.partnerFirmId, firm.id),
        isNull(atelierPartnerEngagementGrants.revokedAt),
      ),
    );
  const sharedAtByEngId = new Map<string, Date>();
  for (const r of grantRows) {
    const prev = sharedAtByEngId.get(r.engagementId);
    if (!prev || r.createdAt < prev) sharedAtByEngId.set(r.engagementId, r.createdAt);
  }
  const engIds = [...sharedAtByEngId.keys()];
  if (engIds.length === 0) return { engs: [], sharedAtByEngId };
  const engs = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.orgId, orgId),
        inArray(atelierEngagements.id, engIds),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  return { engs, sharedAtByEngId };
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

// =====================================================================
// Task #1175 — Partner self-service change requests.
//
// A partner may PROPOSE (never write) a small, safe subset of their own
// firm profile fields. Every submission lands on the SAME
// atelier_partner_firms.pendingUpdates proposal queue the alliance
// agents use, so internal leadership approves/rejects it through the
// existing decide route. Bank details are HARD-rejected here (they have
// a dedicated finance maker-checker path); everything outside the safe
// subset is rejected too (tier/archetype/scorecards are internal;
// contacts go via /partner-portal/contact-suggestions).
//
// This helper is the SINGLE write path shared by the REST route
// (POST /partner-portal/change-requests) and the chat write tool
// (partnerportal.request_change) so both enforce one allowlist +
// supersede + append semantics.
// =====================================================================

/** The ONLY firm fields a partner may propose a change to. */
export const PARTNER_CHANGE_FIELDS = new Set([
  "legalName",
  "registrationNumber",
  "taxId",
  "registeredAddress",
  "capabilityProfile",
  "capabilities",
  "speciality",
  "country",
]);

/** Bank-related fields: never proposable here — pointed to finance path. */
const PARTNER_CHANGE_BANK_FIELDS = new Set([
  "bankName",
  "iban",
  "bankIban",
  "swift",
  "bankSwift",
  "currency",
  "bankCurrency",
]);

const CHANGE_TEXT_MAX: Record<string, number> = {
  legalName: 300,
  registrationNumber: 120,
  taxId: 120,
  registeredAddress: 1000,
  speciality: 400,
  country: 120,
  capabilityProfile: 4000,
};

export type ChangeRequestOutcome =
  | { ok: false; code: 400; error: string; message: string }
  | {
      ok: true;
      proposalId: string;
      field: string;
      fromValue: unknown;
      toValue: unknown;
      supersededId: string | null;
    };

/**
 * Normalise + validate a partner-submitted field/value into the shape
 * stored on pendingUpdates.toValue. Returns a 400 outcome on any invalid
 * or out-of-scope field (bank fields carry the finance-path message).
 */
function normalizeChangeValue(
  field: string,
  rawValue: unknown,
):
  | { ok: false; code: 400; error: string; message: string }
  | { ok: true; toValue: unknown } {
  if (PARTNER_CHANGE_BANK_FIELDS.has(field)) {
    return {
      ok: false,
      code: 400,
      error: "bank-field-not-allowed",
      message:
        "Bank details can't be changed here. Use the secure bank-change request in the Billing tab so Finance can verify and approve them.",
    };
  }
  if (!PARTNER_CHANGE_FIELDS.has(field)) {
    return {
      ok: false,
      code: 400,
      error: "field-not-allowed",
      message:
        "That field isn't editable from the partner portal. You can request changes to your firm's legal name, registration number, tax ID, registered address, capability summary, capabilities, speciality or country. For contacts, use the contact-suggestions form.",
    };
  }
  if (field === "capabilities") {
    if (!Array.isArray(rawValue)) {
      return {
        ok: false,
        code: 400,
        error: "invalid-value",
        message: "Provide capabilities as a list of short text labels.",
      };
    }
    const items = rawValue
      .map((v) => (typeof v === "string" ? v.trim().slice(0, 120) : ""))
      .filter((v) => v.length > 0)
      .slice(0, 50);
    if (items.length === 0) {
      return {
        ok: false,
        code: 400,
        error: "invalid-value",
        message: "Provide at least one capability label.",
      };
    }
    return { ok: true, toValue: items };
  }
  // All remaining fields are simple scalar text (capabilityProfile is a
  // capability summary string; it is wrapped into the structured column
  // shape at apply time).
  const text = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!text) {
    return {
      ok: false,
      code: 400,
      error: "invalid-value",
      message: "Provide a non-empty value.",
    };
  }
  const max = CHANGE_TEXT_MAX[field] ?? 500;
  return { ok: true, toValue: text.slice(0, max) };
}

/** The current firm value we record as fromValue for a proposed field. */
function currentChangeValue(
  firm: typeof atelierPartnerFirms.$inferSelect,
  field: string,
): unknown {
  switch (field) {
    case "legalName":
      return firm.legalName ?? null;
    case "registrationNumber":
      return firm.registrationNumber ?? null;
    case "taxId":
      return firm.taxId ?? null;
    case "registeredAddress":
      return firm.registeredAddress ?? null;
    case "speciality":
      return firm.speciality ?? null;
    case "country":
      return firm.country ?? null;
    case "capabilities":
      return firm.capabilities ?? {};
    case "capabilityProfile":
      return firm.capabilityProfile?.summary ?? null;
    default:
      return null;
  }
}

/**
 * Submit ONE partner change request. Row-locks the firm, supersedes any
 * prior PENDING partner-submitted proposal for the same field, and
 * appends a new pending proposal to pendingUpdates. Pure DB write (no
 * audit / no HTTP): callers add their own audit + response.
 */
export async function submitPartnerChangeRequest(args: {
  orgId: string;
  firmId: string;
  field: string;
  toValueRaw: unknown;
  rationale: string | null;
  submittedByUserId: string;
  submittedByName: string;
}): Promise<ChangeRequestOutcome> {
  const norm = normalizeChangeValue(args.field, args.toValueRaw);
  if (!norm.ok) return norm;
  return db.transaction(async (tx) => {
    const [firm] = await tx
      .select()
      .from(atelierPartnerFirms)
      .where(
        and(
          eq(atelierPartnerFirms.id, args.firmId),
          eq(atelierPartnerFirms.orgId, args.orgId),
          isNull(atelierPartnerFirms.deletedAt),
        ),
      )
      .for("update");
    if (!firm) {
      return {
        ok: false as const,
        code: 400 as const,
        error: "firm-unavailable",
        message: "Your firm record is not available right now.",
      };
    }
    const nowIso = new Date().toISOString();
    const queue = [...(firm.pendingUpdates ?? [])];
    let supersededId: string | null = null;
    for (const p of queue) {
      const meta = (p.meta ?? {}) as { partnerSubmitted?: unknown };
      if (
        p.status === "pending" &&
        p.field === args.field &&
        meta.partnerSubmitted === true
      ) {
        p.status = "rejected";
        p.decidedAt = nowIso;
        p.meta = {
          ...(p.meta ?? {}),
          decisionNote: "Superseded by a newer partner submission",
          superseded: true,
        };
        supersededId = p.id;
      }
    }
    const proposalId = rid("prop");
    const fromValue = currentChangeValue(firm, args.field);
    queue.push({
      id: proposalId,
      proposedBy: "partner_portal",
      proposedAt: nowIso,
      field: args.field,
      fromValue,
      toValue: norm.toValue,
      rationale: args.rationale ?? "",
      status: "pending",
      meta: {
        partnerSubmitted: true,
        partnerFirmId: args.firmId,
        submittedByUserId: args.submittedByUserId,
        submittedByName: args.submittedByName,
      },
    });
    await tx
      .update(atelierPartnerFirms)
      .set({ pendingUpdates: queue, updatedAt: new Date() })
      .where(eq(atelierPartnerFirms.id, firm.id));
    return {
      ok: true as const,
      proposalId,
      field: args.field,
      fromValue,
      toValue: norm.toValue,
      supersededId,
    };
  });
}

/** Partner-facing serialization of one of the firm's own proposals. */
function partnerChangeRequestWire(p: {
  id: string;
  field: string;
  toValue: unknown;
  rationale: string;
  status: string;
  proposedAt: string;
  decidedAt?: string;
  meta?: Record<string, unknown>;
}) {
  const meta = (p.meta ?? {}) as { decisionNote?: unknown };
  return {
    id: p.id,
    field: p.field,
    toValue: p.toValue,
    rationale: p.rationale || null,
    status: p.status,
    submittedAt: p.proposedAt,
    decidedAt: p.decidedAt ?? null,
    decisionNote: typeof meta.decisionNote === "string" ? meta.decisionNote : null,
  };
}

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
// Task #1174 — Partner delivery portal reads (/partner-portal/delivery/*)
// ---------------------------------------------------------------------

// @cli-skip: partner-portal read — external delivery surface (Task #1174), portal-UI only
router.get("/partner-portal/delivery", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    if (req.portalPreview) {
      await audit({
        entityType: "partner_firm",
        entityId: firm.id,
        actor: me,
        action: "partner_portal.previewed",
        payload: { firmId: firm.id, firmName: firm.name, surface: "delivery" },
        summary: `${me.name} previewed ${firm.name}'s partner portal (delivery).`,
      });
    }
    const scope = await grantedEngScopeForFirm(me.orgId, firm);
    res.json({
      firm: { id: firm.id, name: firm.name },
      engagements: scope.engs
        .map((e) => partnerEngagementWire(e, scope.sharedAtByEngId.get(e.id) ?? null))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal read — external delivery detail surface (Task #1174), portal-UI only
router.get("/partner-portal/delivery/:engId", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    const scope = await grantedEngScopeForFirm(me.orgId, firm);
    const eng = scope.engs.find((e) => e.id === req.params.engId);
    // Foreign-firm / revoked / unknown ids are indistinguishable: 404.
    if (!eng) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    // Server-composed snapshot from an EXPLICIT allowlist. Each collection is
    // narrowly SELECTed (never a spread of the raw row) and further filtered.
    const [account] = eng.accountId
      ? await db
          .select()
          .from(atelierAccounts)
          .where(and(eq(atelierAccounts.id, eng.accountId), eq(atelierAccounts.orgId, me.orgId)))
      : [];

    const deliverables = await db
      .select()
      .from(atelierDeliverables)
      .where(
        and(
          eq(atelierDeliverables.orgId, me.orgId),
          eq(atelierDeliverables.engagementId, eng.id),
          isNull(atelierDeliverables.deletedAt),
        ),
      )
      .orderBy(desc(atelierDeliverables.createdAt));

    const openItems = await db
      .select()
      .from(atelierRaidItems)
      .where(
        and(
          eq(atelierRaidItems.orgId, me.orgId),
          eq(atelierRaidItems.engagementId, eng.id),
          eq(atelierRaidItems.status, "open"),
          isNull(atelierRaidItems.deletedAt),
        ),
      )
      .orderBy(desc(atelierRaidItems.createdAt));

    const todayIso = new Date().toISOString().slice(0, 10);
    const meetings = await db
      .select()
      .from(atelierMeetings)
      .where(
        and(
          eq(atelierMeetings.orgId, me.orgId),
          eq(atelierMeetings.parentType, "engagement"),
          eq(atelierMeetings.parentId, eng.id),
          isNull(atelierMeetings.deletedAt),
        ),
      );
    const upcomingMeetings = meetings
      .filter((m) => (m.date ?? "") >= todayIso)
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

    res.json({
      firm: { id: firm.id, name: firm.name },
      ...partnerDeliverySnapshotWire({
        engagement: eng,
        sharedAt: scope.sharedAtByEngId.get(eng.id) ?? null,
        account: account ?? null,
        deliverables,
        openItems,
        upcomingMeetings,
      }),
    });
  } catch (err) {
    next(err);
  }
});

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
// Task #1174 — Internal admin: engagement delivery grants
// (leadership-only, audited). Mirrors the opportunity-grant trio.
// ---------------------------------------------------------------------

async function loadLiveEngagement(orgId: string, engId: string) {
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, engId),
        eq(atelierEngagements.orgId, orgId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  return eng ?? null;
}

// @cli-skip: internal admin read — leadership delivery-grant listing on the engagement page UI only
router.get("/engagements/:engId/partner-grants", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const eng = await loadLiveEngagement(me.orgId, req.params.engId);
    if (!eng) {
      res.status(404).json({ error: "engagement-not-found" });
      return;
    }
    const rows = await db
      .select({
        grant: atelierPartnerEngagementGrants,
        firmName: atelierPartnerFirms.name,
        firmDeletedAt: atelierPartnerFirms.deletedAt,
      })
      .from(atelierPartnerEngagementGrants)
      .leftJoin(
        atelierPartnerFirms,
        eq(atelierPartnerFirms.id, atelierPartnerEngagementGrants.partnerFirmId),
      )
      .where(
        and(
          eq(atelierPartnerEngagementGrants.orgId, me.orgId),
          eq(atelierPartnerEngagementGrants.engagementId, eng.id),
        ),
      )
      .orderBy(desc(atelierPartnerEngagementGrants.createdAt));
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
router.post("/engagements/:engId/partner-grants", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const eng = await loadLiveEngagement(me.orgId, req.params.engId);
    if (!eng) {
      res.status(404).json({ error: "engagement-not-found" });
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
      .from(atelierPartnerEngagementGrants)
      .where(
        and(
          eq(atelierPartnerEngagementGrants.orgId, me.orgId),
          eq(atelierPartnerEngagementGrants.partnerFirmId, firm.id),
          eq(atelierPartnerEngagementGrants.engagementId, eng.id),
          isNull(atelierPartnerEngagementGrants.revokedAt),
        ),
      );
    if (existing) {
      res.status(200).json({ ok: true, grantId: existing.id, alreadyGranted: true });
      return;
    }
    const id = rid("ppeg");
    await db.insert(atelierPartnerEngagementGrants).values({
      id,
      orgId: me.orgId,
      partnerFirmId: firm.id,
      engagementId: eng.id,
      createdByUserId: me.id,
    });
    await audit({
      entityType: "engagement",
      entityId: eng.id,
      actor: me,
      action: "partners.engagement.share",
      payload: { grantId: id, partnerFirmId: firm.id, firmName: firm.name },
      summary: `${me.name} shared engagement "${eng.name}" with ${firm.name} on the delivery portal.`,
    });
    // Notify the firm (in-app + email) AFTER commit.
    await notifyPartnerFirm({
      orgId: me.orgId,
      partnerFirmId: firm.id,
      kind: "engagement_shared",
      title: "A delivery engagement was shared with you",
      body: `"${eng.name}" is now visible in your partner delivery portal.`,
      href: "/partner/delivery",
      email: {
        subject: "A delivery engagement was shared with you — Cognirise",
        paragraphs: [
          `Cognirise has shared the engagement "${eng.name}" with ${firm.name}.`,
          "Sign in to your partner portal to view delivery progress and shared documents.",
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
  "/engagements/:engId/partner-grants/:grantId/revoke",
  async (req, res, next) => {
    try {
      const me = requireLeadership(req, res);
      if (!me) return;
      const [grant] = await db
        .select()
        .from(atelierPartnerEngagementGrants)
        .where(
          and(
            eq(atelierPartnerEngagementGrants.id, req.params.grantId),
            eq(atelierPartnerEngagementGrants.orgId, me.orgId),
            eq(atelierPartnerEngagementGrants.engagementId, req.params.engId),
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
        .update(atelierPartnerEngagementGrants)
        .set({ revokedAt: new Date(), revokedByUserId: me.id })
        .where(eq(atelierPartnerEngagementGrants.id, grant.id));
      await audit({
        entityType: "engagement",
        entityId: grant.engagementId,
        actor: me,
        action: "partners.engagement.share_revoke",
        payload: { grantId: grant.id, partnerFirmId: grant.partnerFirmId },
        summary: `${me.name} revoked a partner firm's delivery-portal access to this engagement.`,
      });
      // Notify the firm (in-app only; no email for revokes).
      await notifyPartnerFirm({
        orgId: me.orgId,
        partnerFirmId: grant.partnerFirmId,
        kind: "engagement_revoked",
        title: "A delivery engagement is no longer shared with you",
        body: "One of the engagements previously shared with your firm has been removed from your delivery portal.",
        href: "/partner/delivery",
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: internal admin read — leadership firm-side delivery-grant listing UI only (Task #1174)
router.get("/partners/firms/:firmId/engagement-grants", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const rows = await db
      .select({
        grant: atelierPartnerEngagementGrants,
        engagementName: atelierEngagements.name,
      })
      .from(atelierPartnerEngagementGrants)
      .leftJoin(
        atelierEngagements,
        eq(atelierEngagements.id, atelierPartnerEngagementGrants.engagementId),
      )
      .where(
        and(
          eq(atelierPartnerEngagementGrants.orgId, me.orgId),
          eq(atelierPartnerEngagementGrants.partnerFirmId, req.params.firmId),
        ),
      )
      .orderBy(desc(atelierPartnerEngagementGrants.createdAt));
    res.json({
      grants: rows.map((r) => ({
        id: r.grant.id,
        engagementId: r.grant.engagementId,
        engagementName: r.engagementName ?? null,
        createdAt: r.grant.createdAt.toISOString(),
        revokedAt: r.grant.revokedAt ? r.grant.revokedAt.toISOString() : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

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

// ---------------------------------------------------------------------
// Task #1172 — Partner firm document library + contact suggestions.
// ---------------------------------------------------------------------

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
        // Task #1175 — capability summary Cognirise holds, so the partner
        // can see what to request changes to.
        speciality: firm.speciality ?? null,
        country: firm.country ?? null,
        capabilities: Object.keys(firm.capabilities ?? {}),
        capabilityProfile: firm.capabilityProfile
          ? {
              summary: firm.capabilityProfile.summary ?? null,
              domains: (firm.capabilityProfile.domains ?? []).map((d) => ({
                label: d.label,
                description: d.description,
                evidence: d.evidence,
              })),
            }
          : null,
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
// Task #1175 — Partner self-service change requests (review-gated).
// ---------------------------------------------------------------------

// @cli-skip: partner-portal write — external surface; chat parity via partnerportal.request_change (Task #1175)
router.post("/partner-portal/change-requests", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    // Reject preview BEFORE any effect: leadership preview is read-only.
    if (refuseIfPreview(req, res)) return;
    const { me, firm } = resolved;
    const field = typeof req.body?.field === "string" ? req.body.field.trim() : "";
    if (!field) {
      res.status(400).json({ error: "invalid-body", message: "A field is required." });
      return;
    }
    const rationale =
      typeof req.body?.rationale === "string" ? req.body.rationale.trim().slice(0, 1000) || null : null;
    const outcome = await submitPartnerChangeRequest({
      orgId: me.orgId,
      firmId: firm.id,
      field,
      toValueRaw: req.body?.toValue,
      rationale,
      submittedByUserId: me.id,
      submittedByName: me.name,
    });
    if (!outcome.ok) {
      res.status(outcome.code).json({ error: outcome.error, message: outcome.message });
      return;
    }
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partner_firm.change_request.submitted",
      payload: {
        proposalId: outcome.proposalId,
        field: outcome.field,
        supersededId: outcome.supersededId,
        via: "portal",
      },
      summary: `${me.name} requested a change to ${firm.name}'s ${outcome.field} (pending internal review).`,
    });
    res.status(201).json({
      ok: true,
      changeRequest: {
        id: outcome.proposalId,
        field: outcome.field,
        toValue: outcome.toValue,
        rationale,
        status: "pending",
      },
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal read — external surface (Task #1175)
router.get("/partner-portal/change-requests", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { firm } = resolved;
    // Only this firm's own partner-submitted proposals — never internal
    // agent proposals, and never the decider identity.
    const items = (firm.pendingUpdates ?? [])
      .filter((p) => {
        const meta = (p.meta ?? {}) as { partnerSubmitted?: unknown };
        return meta.partnerSubmitted === true;
      })
      .map(partnerChangeRequestWire)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    res.json({ items });
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

// ---------------------------------------------------------------------
// Task #1173 — Partner notification center (portal reads + mark-read).
// Scoped via resolvePortalFirm: alliance_partner sees own firm; leadership
// may preview (read-only — marking read is refused in preview).
// ---------------------------------------------------------------------

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

// =====================================================================
// Task #1174 — Partner shared-document space.
//
// Two directions on atelier_partner_shared_documents:
//   'shared'          internal → firm. A SNAPSHOT of a library document
//                     version copied into firm-scoped partner storage.
//   'partner_upload'  firm → internal, for review.
// Bytes live in the private bucket under a firm-scoped key prefix; blobRef /
// sha256 / source ids are NEVER exposed to the portal.
// =====================================================================

// Portal upload limits (independent of the internal library caps).
const SHARED_UPLOAD_MIMES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const SHARED_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;
// Route-local memory multipart parser. Invoked ONLY after resolvePortalFirm +
// refuseIfPreview succeed (see the POST handler below), so an unauthenticated
// or preview caller never has their request body consumed.
const sharedDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: SHARED_UPLOAD_MAX_BYTES },
});
// Never trust a client-declared mime — sniff the leading signature and accept
// only if it matches exactly one allowlisted type. Returns null for anything
// else (empty, corrupt, or a disallowed format), which the route rejects.
function sniffSharedMime(buf: Buffer): string | null {
  for (const mime of SHARED_UPLOAD_MIMES) {
    if (magicBytesMatchMime(buf, mime)) return mime;
  }
  return null;
}
// Strip any path components a client may smuggle in originalname and clamp
// length; the stored fileName is display-only (blob keys are firm-scoped).
function sanitizeUploadFileName(raw: string): string {
  const base = raw.replace(/[/\\]/g, "_").replace(/\u0000/g, "").trim();
  return base.slice(0, 300);
}
// Run the route-local multer parser as a promise so the handler can await it
// AFTER auth/preview gating rather than mounting it as pre-handler middleware.
function runSharedDocUpload(req: Request, res: Response): Promise<Express.Multer.File | null | "error"> {
  return new Promise((resolve) => {
    sharedDocUpload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
            ? "File exceeds the 16MB upload limit."
            : err instanceof Error
              ? err.message
              : String(err);
        if (!res.headersSent) {
          res.status(400).json({ error: "upload-failed", message });
        }
        resolve("error");
        return;
      }
      resolve(req.file ?? null);
    });
  });
}

/** Portal-facing serialization: never leaks blobRef / sha256 / source ids. */
function sharedDocPortalWire(d: typeof atelierPartnerSharedDocuments.$inferSelect) {
  return {
    id: d.id,
    direction: d.direction,
    title: d.title,
    fileName: d.fileName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    note: d.note ?? null,
    status: d.status,
    sharedByLabel: d.direction === "shared" ? d.sharedByLabel ?? null : null,
    sharedAt: d.createdAt.toISOString(),
    reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
  };
}

/** Internal (admin) serialization — richer, still no blobRef. */
function sharedDocAdminWire(d: typeof atelierPartnerSharedDocuments.$inferSelect) {
  return {
    id: d.id,
    partnerFirmId: d.partnerFirmId,
    direction: d.direction,
    title: d.title,
    fileName: d.fileName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    note: d.note ?? null,
    status: d.status,
    sourceDocumentId: d.sourceDocumentId ?? null,
    sourceVersionId: d.sourceVersionId ?? null,
    sharedByUserId: d.sharedByUserId ?? null,
    sharedByLabel: d.sharedByLabel ?? null,
    reviewedByUserId: d.reviewedByUserId ?? null,
    reviewedAt: d.reviewedAt ? d.reviewedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
  };
}

async function loadLiveFirm(orgId: string, firmId: string) {
  const [firm] = await db
    .select()
    .from(atelierPartnerFirms)
    .where(
      and(
        eq(atelierPartnerFirms.id, firmId),
        eq(atelierPartnerFirms.orgId, orgId),
        isNull(atelierPartnerFirms.deletedAt),
      ),
    );
  return firm ?? null;
}

/**
 * Drop a shared-document blob only when NO OTHER active share row IN THE
 * SAME FIRM references it. Dedupe/refcount is per-firm, never org-global.
 */
async function dropSharedBlobIfUnreferenced(
  orgId: string,
  partnerFirmId: string,
  blobRef: string,
  excludeRowId: string,
): Promise<void> {
  const others = await db
    .select({ id: atelierPartnerSharedDocuments.id })
    .from(atelierPartnerSharedDocuments)
    .where(
      and(
        eq(atelierPartnerSharedDocuments.orgId, orgId),
        eq(atelierPartnerSharedDocuments.partnerFirmId, partnerFirmId),
        eq(atelierPartnerSharedDocuments.blobRef, blobRef),
        isNull(atelierPartnerSharedDocuments.revokedAt),
        isNull(atelierPartnerSharedDocuments.deletedAt),
      ),
    );
  if (others.some((o) => o.id !== excludeRowId)) return;
  await dropSharedDocBytes(blobRef);
}

// @cli-skip: internal admin read — leadership shared-document listing on the firm page UI only (Task #1174)
router.get("/partners/firms/:firmId/shared-documents", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const conds = [
      eq(atelierPartnerSharedDocuments.orgId, me.orgId),
      eq(atelierPartnerSharedDocuments.partnerFirmId, req.params.firmId),
      eq(atelierPartnerSharedDocuments.direction, "shared"),
      isNull(atelierPartnerSharedDocuments.deletedAt),
    ];
    if (String(req.query.status ?? "active") === "active") {
      conds.push(isNull(atelierPartnerSharedDocuments.revokedAt));
    }
    const rows = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(and(...conds))
      .orderBy(desc(atelierPartnerSharedDocuments.createdAt));
    res.json({ items: rows.map(sharedDocAdminWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: internal admin read — leadership partner-upload review queue UI only (Task #1174)
router.get("/partners/firms/:firmId/partner-uploads", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const status = String(req.query.status ?? "pending_review");
    const conds = [
      eq(atelierPartnerSharedDocuments.orgId, me.orgId),
      eq(atelierPartnerSharedDocuments.partnerFirmId, req.params.firmId),
      eq(atelierPartnerSharedDocuments.direction, "partner_upload"),
      isNull(atelierPartnerSharedDocuments.deletedAt),
    ];
    if (status !== "all") conds.push(eq(atelierPartnerSharedDocuments.status, status));
    const rows = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(and(...conds))
      .orderBy(desc(atelierPartnerSharedDocuments.createdAt));
    res.json({ items: rows.map(sharedDocAdminWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: security-sensitive external document share — deliberate UI-only write (Task #1174)
router.post("/partners/firms/:firmId/shared-documents", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const firm = await loadLiveFirm(me.orgId, req.params.firmId);
    if (!firm) {
      res.status(404).json({ error: "partner-firm-not-found" });
      return;
    }
    const documentId = typeof req.body?.documentId === "string" ? req.body.documentId : "";
    if (!documentId) {
      res.status(400).json({ error: "invalid-body", message: "documentId is required." });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) || null : null;
    // Resolve the internal library document.
    const [doc] = await db
      .select()
      .from(atelierDocuments)
      .where(
        and(
          eq(atelierDocuments.id, documentId),
          eq(atelierDocuments.orgId, me.orgId),
          eq(atelierDocuments.status, "active"),
        ),
      );
    if (!doc) {
      res.status(404).json({ error: "document-not-found" });
      return;
    }
    // Snapshot the requested version, else the document's current version.
    const requestedVersionId =
      typeof req.body?.versionId === "string" ? req.body.versionId : null;
    const targetVersionId = requestedVersionId ?? doc.currentVersionId;
    if (!targetVersionId) {
      res.status(409).json({ error: "no-version", message: "The document has no version to share." });
      return;
    }
    const [version] = await db
      .select()
      .from(atelierDocumentVersions)
      .where(
        and(
          eq(atelierDocumentVersions.id, targetVersionId),
          eq(atelierDocumentVersions.orgId, me.orgId),
          eq(atelierDocumentVersions.documentId, doc.id),
        ),
      );
    if (!version) {
      res.status(404).json({ error: "version-not-found" });
      return;
    }
    // Idempotent on (firmId, sourceDocumentId, sourceVersionId) active.
    const [existing] = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(
        and(
          eq(atelierPartnerSharedDocuments.orgId, me.orgId),
          eq(atelierPartnerSharedDocuments.partnerFirmId, firm.id),
          eq(atelierPartnerSharedDocuments.direction, "shared"),
          eq(atelierPartnerSharedDocuments.sourceDocumentId, doc.id),
          eq(atelierPartnerSharedDocuments.sourceVersionId, version.id),
          isNull(atelierPartnerSharedDocuments.revokedAt),
          isNull(atelierPartnerSharedDocuments.deletedAt),
        ),
      );
    if (existing) {
      res.status(200).json({ ok: true, id: existing.id, alreadyShared: true });
      return;
    }
    // COPY the current version bytes into firm-scoped partner storage
    // (snapshot semantics; later library edits never leak).
    const bytes = await loadDocBytes(version.blobRef);
    if (!bytes) {
      res.status(409).json({ error: "source-bytes-missing" });
      return;
    }
    const stored = await storeSharedDocBytes({
      partnerFirmId: firm.id,
      buf: bytes,
      sha256: version.sha256,
      contentType: version.mime,
    });
    const id = rid("ppsd");
    const [created] = await db
      .insert(atelierPartnerSharedDocuments)
      .values({
        id,
        orgId: me.orgId,
        partnerFirmId: firm.id,
        direction: "shared",
        title: doc.title,
        fileName: version.fileName,
        mime: version.mime,
        sizeBytes: stored.sizeBytes,
        sha256: version.sha256,
        blobRef: stored.blobRef,
        sourceDocumentId: doc.id,
        sourceVersionId: version.id,
        note,
        status: "active",
        sharedByUserId: me.id,
        sharedByLabel: me.name,
      })
      .returning();
    await audit({
      entityType: "partner_firm",
      entityId: firm.id,
      actor: me,
      action: "partners.document.shared",
      payload: {
        sharedDocumentId: id,
        sourceDocumentId: doc.id,
        sourceVersionId: version.id,
        fileName: version.fileName,
        sizeBytes: stored.sizeBytes,
      },
      summary: `${me.name} shared document "${doc.title}" (${version.fileName}) with ${firm.name}.`,
    });
    // Notify the firm (in-app + email) AFTER commit.
    await notifyPartnerFirm({
      orgId: me.orgId,
      partnerFirmId: firm.id,
      kind: "document_shared",
      title: "A document was shared with you",
      body: `"${doc.title}" is now available in your partner portal documents.`,
      href: "/partner/documents",
      email: {
        subject: "A document was shared with you — Cognirise",
        paragraphs: [
          `Cognirise has shared the document "${doc.title}" with ${firm.name}.`,
          "Sign in to your partner portal to download it.",
        ],
      },
    });
    res.status(201).json({ ok: true, document: sharedDocAdminWire(created) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: security-sensitive external document revoke — deliberate UI-only write (Task #1174)
// @cli-skip: internal admin read — leadership byte download for review/inspection UI only (Task #1174)
router.get("/partners/firms/:firmId/shared-documents/:id/download", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    // Leadership may inspect any share/upload row for this firm (including
    // revoked shares and decided uploads) — internal review surface.
    const [row] = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(
        and(
          eq(atelierPartnerSharedDocuments.id, req.params.id),
          eq(atelierPartnerSharedDocuments.orgId, me.orgId),
          eq(atelierPartnerSharedDocuments.partnerFirmId, req.params.firmId),
          isNull(atelierPartnerSharedDocuments.deletedAt),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const bytes = await loadSharedDocBytes(row.blobRef);
    if (!bytes) {
      res.status(404).json({ error: "document-missing" });
      return;
    }
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", row.fileName));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner document revocation is an audited portal workflow; assistant authority parity is unproven
router.post("/partners/firms/:firmId/shared-documents/:id/revoke", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const [row] = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(
        and(
          eq(atelierPartnerSharedDocuments.id, req.params.id),
          eq(atelierPartnerSharedDocuments.orgId, me.orgId),
          eq(atelierPartnerSharedDocuments.partnerFirmId, req.params.firmId),
          eq(atelierPartnerSharedDocuments.direction, "shared"),
          isNull(atelierPartnerSharedDocuments.deletedAt),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "shared-document-not-found" });
      return;
    }
    if (row.revokedAt) {
      res.json({ ok: true, alreadyRevoked: true });
      return;
    }
    await db
      .update(atelierPartnerSharedDocuments)
      .set({ revokedAt: new Date(), revokedByUserId: me.id })
      .where(eq(atelierPartnerSharedDocuments.id, row.id));
    // Unreference-delete the bytes if no OTHER active share row in the SAME
    // firm references the same blob.
    await dropSharedBlobIfUnreferenced(me.orgId, row.partnerFirmId, row.blobRef, row.id);
    await audit({
      entityType: "partner_firm",
      entityId: row.partnerFirmId,
      actor: me,
      action: "partners.document.revoked",
      payload: { sharedDocumentId: row.id, fileName: row.fileName },
      summary: `${me.name} revoked the shared document "${row.title}" from this firm's portal.`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: internal admin partner-upload review — deliberate UI-only write (Task #1174)
router.post("/partners/firms/:firmId/partner-uploads/:id/review", async (req, res, next) => {
  try {
    const me = requireLeadership(req, res);
    if (!me) return;
    const decision = String(req.body?.decision ?? "");
    if (decision !== "accepted" && decision !== "rejected") {
      res.status(400).json({ error: "invalid-body", message: "decision must be accepted|rejected." });
      return;
    }
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) || null : null;
    const [row] = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(
        and(
          eq(atelierPartnerSharedDocuments.id, req.params.id),
          eq(atelierPartnerSharedDocuments.orgId, me.orgId),
          eq(atelierPartnerSharedDocuments.partnerFirmId, req.params.firmId),
          eq(atelierPartnerSharedDocuments.direction, "partner_upload"),
          isNull(atelierPartnerSharedDocuments.deletedAt),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "upload-not-found" });
      return;
    }
    if (row.status !== "pending_review") {
      res.status(409).json({ error: "already-decided", status: row.status });
      return;
    }
    // Single-decider CAS.
    const claimed = await db
      .update(atelierPartnerSharedDocuments)
      .set({
        status: decision,
        note: note ?? row.note,
        reviewedByUserId: me.id,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(atelierPartnerSharedDocuments.id, row.id),
          eq(atelierPartnerSharedDocuments.status, "pending_review"),
        ),
      )
      .returning({ id: atelierPartnerSharedDocuments.id });
    if (claimed.length === 0) {
      res.status(409).json({ error: "already-decided" });
      return;
    }
    await audit({
      entityType: "partner_firm",
      entityId: row.partnerFirmId,
      actor: me,
      action: "partners.document.upload_reviewed",
      payload: { sharedDocumentId: row.id, decision, fileName: row.fileName },
      summary: `${me.name} ${decision} the partner upload "${row.fileName}".`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal read — external shared-documents surface (Task #1174), portal-UI only
router.get("/partner-portal/documents", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    if (req.portalPreview) {
      await audit({
        entityType: "partner_firm",
        entityId: firm.id,
        actor: me,
        action: "partner_portal.previewed",
        payload: { firmId: firm.id, firmName: firm.name, surface: "documents" },
        summary: `${me.name} previewed ${firm.name}'s partner portal (documents).`,
      });
    }
    // Active shared docs (internal → firm) + the firm's own uploads.
    const rows = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(
        and(
          eq(atelierPartnerSharedDocuments.orgId, me.orgId),
          eq(atelierPartnerSharedDocuments.partnerFirmId, firm.id),
          isNull(atelierPartnerSharedDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPartnerSharedDocuments.createdAt));
    const shared = rows.filter((r) => r.direction === "shared" && r.revokedAt == null);
    const uploads = rows.filter((r) => r.direction === "partner_upload");
    res.json({
      firm: { id: firm.id, name: firm.name },
      shared: shared.map(sharedDocPortalWire),
      uploads: uploads.map(sharedDocPortalWire),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal download — external surface, own-firm only (Task #1174)
router.get("/partner-portal/documents/:id/download", async (req, res, next) => {
  try {
    const resolved = await resolvePortalFirm(req, res);
    if (!resolved) return;
    const { me, firm } = resolved;
    // Grant re-checked at byte-serving time: active shared (revokedAt null)
    // OR the firm's own upload. Foreign/revoked/unknown ids are 404
    // (indistinguishable). Preview MAY download (read).
    const [row] = await db
      .select()
      .from(atelierPartnerSharedDocuments)
      .where(
        and(
          eq(atelierPartnerSharedDocuments.id, req.params.id),
          eq(atelierPartnerSharedDocuments.orgId, me.orgId),
          eq(atelierPartnerSharedDocuments.partnerFirmId, firm.id),
          isNull(atelierPartnerSharedDocuments.deletedAt),
        ),
      );
    const servable =
      row &&
      ((row.direction === "shared" && row.revokedAt == null) ||
        row.direction === "partner_upload");
    if (!servable) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const bytes = await loadSharedDocBytes(row.blobRef);
    if (!bytes) {
      res.status(404).json({ error: "document-missing" });
      return;
    }
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", row.fileName));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: partner-portal write — external upload-for-review surface (Task #1174)
router.post(
  "/partner-portal/documents",
  // NB: NO pre-handler body parser. The web client sends multipart/form-data
  // (fields: "file" = binary, optional "note"); a JSON base64 body is also
  // accepted as a secondary content-type. In BOTH cases the body is consumed
  // ONLY after resolvePortalFirm + refuseIfPreview succeed below, so an
  // unauthenticated or preview caller is rejected before any bytes are read.
  async (req, res, next) => {
    try {
      const resolved = await resolvePortalFirm(req, res);
      if (!resolved) return;
      // refuseIfPreview BEFORE any multipart parsing / storage / DB write.
      if (refuseIfPreview(req, res)) return;
      const { me, firm } = resolved;

      // ---- ingest the payload (multipart primary; base64 JSON secondary) --
      let buf: Buffer | null = null;
      let rawFileName = "";
      let note: string | null = null;
      const contentType = String(req.headers["content-type"] ?? "");
      if (contentType.includes("multipart/form-data")) {
        const file = await runSharedDocUpload(req, res);
        if (file === "error") return; // multer already responded (e.g. 413/size)
        if (!file || !file.buffer || file.buffer.byteLength === 0) {
          res.status(400).json({ error: "invalid-body", message: "A file part is required." });
          return;
        }
        buf = file.buffer;
        rawFileName = String(file.originalname ?? "");
        const noteField = (req.body as Record<string, unknown> | undefined)?.note;
        note = typeof noteField === "string" ? noteField.trim().slice(0, 1000) || null : null;
      } else {
        // Secondary contract: JSON { base64, fileName?, note? }. Uses the
        // default express.json parser (small bodies); large uploads should use
        // multipart. decodeBase64Strict rejects malformed / oversize input.
        buf = decodeBase64Strict(String(req.body?.base64 ?? ""));
        if (!buf) {
          res.status(400).json({ error: "invalid-base64" });
          return;
        }
        rawFileName = String(req.body?.fileName ?? "");
        const noteField = req.body?.note;
        note = typeof noteField === "string" ? noteField.trim().slice(0, 1000) || null : null;
      }

      if (buf.byteLength === 0 || buf.byteLength > SHARED_UPLOAD_MAX_BYTES) {
        res.status(400).json({ error: "invalid-size", maxBytes: SHARED_UPLOAD_MAX_BYTES });
        return;
      }
      // Mime is derived from magic-byte detection — the declared type (if any)
      // is never trusted. A buffer matching no allowlisted signature is a
      // content mismatch (covers garbage / disguised uploads).
      const mime = sniffSharedMime(buf);
      if (!mime) {
        res.status(400).json({ error: "content-mismatch", message: "File content does not match an accepted type (PDF, PNG, JPEG)." });
        return;
      }
      const fileName = sanitizeUploadFileName(rawFileName);
      if (!fileName) {
        res.status(400).json({ error: "invalid-body", message: "A file name is required." });
        return;
      }
      const title = fileName;
      const sha256 = createHash("sha256").update(buf).digest("hex");
      const stored = await storeSharedDocBytes({
        partnerFirmId: firm.id,
        buf,
        sha256,
        contentType: mime,
      });
      const id = rid("ppsd");
      const [created] = await db
        .insert(atelierPartnerSharedDocuments)
        .values({
          id,
          orgId: me.orgId,
          partnerFirmId: firm.id,
          direction: "partner_upload",
          title: title || fileName,
          fileName,
          mime,
          sizeBytes: stored.sizeBytes,
          sha256,
          blobRef: stored.blobRef,
          note,
          status: "pending_review",
          sharedByUserId: me.id,
          sharedByLabel: me.name,
        })
        .returning();
      // Internal review is internal — notify nothing external.
      await audit({
        entityType: "partner_firm",
        entityId: firm.id,
        actor: me,
        action: "partners.document.uploaded_for_review",
        payload: { sharedDocumentId: id, fileName, sizeBytes: stored.sizeBytes },
        summary: `${me.name} uploaded "${fileName}" from ${firm.name}'s portal for internal review.`,
      });
      res.status(201).json({ ok: true, document: sharedDocPortalWire(created) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
