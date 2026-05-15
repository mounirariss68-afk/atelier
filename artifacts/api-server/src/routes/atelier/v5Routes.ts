/**
 * Atelier v5 — Press / Alliances / Studio / Guardhouse / IP Catalog read routes.
 *
 * Task #354: Replaces the TypeScript seed files in
 * `artifacts/atelier/src/data/{press,alliances,studio,guardhouse,ip}-seed.ts`
 * with Postgres-backed reads. All routes are firm-wide reads scoped by
 * the active persona's `orgId`. Persona gating:
 *
 *   - `recruiter` is restricted to /studio (and identity). The non-employee
 *     allowlist in routes/atelier/index.ts enforces this firm-wide; here we
 *     additionally deny `recruiter` on every non-studio v5 surface so the
 *     two layers can never drift.
 *   - `compliance_officer` is firm-wide read on guardhouse + audit-relevant
 *     surfaces (controls, evidence, pentests, vendors, incidents, dsars,
 *     backups). They get *no* write capabilities here. Press / Studio / IP /
 *     Alliances remain accessible to them as read-only firm-wide knowledge
 *     surfaces; this matches `personaRoles.ts` ("compliance_officer is NOT
 *     restricted by engagement — by design they need firm-wide read for
 *     audit").
 *
 * The seed bootstrap in `lib/atelier-seed-v5.ts` populates the canonical
 * v5 demo dataset on cold start (idempotent).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  db,
  atelierUsers,
  atelierPressEditorialCalendar,
  atelierPressInFlightContent,
  atelierPressPartnerCadence,
  atelierPressNewsletter,
  atelierPressSpeakingOpportunities,
  atelierPressMentions,
  atelierAlliancePartnerFirms,
  atelierAllianceJointPipeline,
  atelierAllianceCertifications,
  atelierAllianceConflicts,
  atelierStudioOpenRoles,
  atelierStudioCandidates,
  atelierStudioInterviewPanels,
  atelierStudioReferenceChecks,
  atelierStudioOffers,
  atelierStudioReferrals,
  atelierGuardhouseControls,
  atelierGuardhouseEvidence,
  atelierGuardhousePentests,
  atelierGuardhouseVendors,
  atelierGuardhouseIncidents,
  atelierGuardhouseDsars,
  atelierGuardhouseBackups,
  atelierIpCodeAssets,
  atelierIpOssDependencies,
  atelierIpDemoEnvironments,
  atelierIpLicenseGrants,
} from "@workspace/db";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

/**
 * Recruiter persona is scoped to /studio. Defense-in-depth: even if
 * future routing accidentally exposes a non-studio v5 surface, this
 * helper guarantees a 403.
 *
 * `compliance_officer` is intentionally NOT denied here. Per Task #354
 * and the docstring on `RESTRICTED` in `personaRoles.ts`, compliance
 * officers receive firm-wide read across the v5 surfaces by design —
 * audit work needs visibility into press, alliances, hiring pipeline,
 * controls, vendors, and IP. Their access remains bounded elsewhere:
 * no comp/personnel/breakglass/approval capabilities are granted.
 */
function denyRecruiterOutsideStudio(me: Me, res: Response): boolean {
  if (me.role === "recruiter") {
    res.status(403).json({
      error: "recruiter-scope",
      message: "Recruiter persona may only access /studio surfaces.",
    });
    return true;
  }
  return false;
}

/** Standard org-scoped soft-delete filter for any v5 table. */
function orgScope(
  me: Me,
  table: { orgId: AnyPgColumn; deletedAt: AnyPgColumn },
) {
  return and(eq(table.orgId, me.orgId), isNull(table.deletedAt));
}

// =============================================================
// PRESS
// =============================================================
router.get("/press/editorial-calendar", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressEditorialCalendar)
    .where(orgScope(me, atelierPressEditorialCalendar));
  res.json({ items: rows });
});

router.get("/press/in-flight", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressInFlightContent)
    .where(orgScope(me, atelierPressInFlightContent));
  res.json({ items: rows });
});

router.get("/press/partner-cadence", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressPartnerCadence)
    .where(orgScope(me, atelierPressPartnerCadence));
  res.json({ items: rows });
});

router.get("/press/newsletter", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const [row] = await db
    .select()
    .from(atelierPressNewsletter)
    .where(orgScope(me, atelierPressNewsletter))
    .limit(1);
  res.json({ newsletter: row ?? null });
});

router.get("/press/speaking-opportunities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressSpeakingOpportunities)
    .where(orgScope(me, atelierPressSpeakingOpportunities));
  res.json({ items: rows });
});

router.get("/press/mentions", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressMentions)
    .where(orgScope(me, atelierPressMentions));
  res.json({ items: rows });
});

// =============================================================
// ALLIANCES
// =============================================================
router.get("/alliances/partner-firms", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAlliancePartnerFirms)
    .where(orgScope(me, atelierAlliancePartnerFirms));
  res.json({ items: rows });
});

router.get("/alliances/joint-pipeline", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAllianceJointPipeline)
    .where(orgScope(me, atelierAllianceJointPipeline));
  res.json({ items: rows });
});

router.get("/alliances/certifications", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAllianceCertifications)
    .where(orgScope(me, atelierAllianceCertifications));
  res.json({ items: rows });
});

router.get("/alliances/conflicts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAllianceConflicts)
    .where(orgScope(me, atelierAllianceConflicts));
  res.json({ items: rows });
});

// =============================================================
// PARTNERS — alliance lifecycle scaffolds (Task #371)
// First-pass static seed for the new lifecycle stages that don't
// have Postgres tables yet (target partners, capability matrix,
// MDF, joint marketing, sub-contractor SOWs, framework agreements,
// QBRs, scorecards, renewal pipeline, tier changes). The existing
// alliance tables (firms, joint-pipeline, certifications, conflicts)
// continue to back the re-mounted Identify/Co-sell/Govern views.
// =============================================================
const PARTNER_TARGETS = [
  { id: "tg_001", name: "Helvetica AI", ecosystem: "Hyperscaler ML", country: "Switzerland", rationale: "Fills sovereign-cloud LLM evaluation gap that Quanta cannot serve in EU.", priority: "high", stage: "outreach", lastContact: "2026-04-21" },
  { id: "tg_002", name: "Crescent FSI Advisors", ecosystem: "Boutique strategy", country: "UAE", rationale: "GCC banking-sector reach; complements Lumen's KSA footprint without overlap.", priority: "high", stage: "intro_call", lastContact: "2026-05-02" },
  { id: "tg_003", name: "Polaris Data Co.", ecosystem: "Snowflake SI", country: "UK", rationale: "Net-new Snowflake delivery muscle; named in three losses to Anchorline.", priority: "med", stage: "researching", lastContact: null },
  { id: "tg_004", name: "Atlas Public Sector", ecosystem: "Public sector advisory", country: "Türkiye", rationale: "Public-sector framework holder; unlocks municipal AI pilots without a prime change.", priority: "med", stage: "outreach", lastContact: "2026-04-30" },
];

const PARTNER_CAPABILITIES = [
  { id: "cap_quanta", partnerFirm: "Quanta Systems", capabilities: { delivery: 4, sales: 3, geo_gcc: 5, geo_eu: 1, regulated: 4, agents: 3 }, ndaStatus: "signed", mutualEvalStatus: "complete", lastReviewed: "2026-03-15" },
  { id: "cap_lumen", partnerFirm: "Lumen Strategic", capabilities: { delivery: 3, sales: 4, geo_gcc: 5, geo_eu: 2, regulated: 5, agents: 2 }, ndaStatus: "signed", mutualEvalStatus: "complete", lastReviewed: "2026-02-08" },
  { id: "cap_anchor", partnerFirm: "Anchorline Advisors", capabilities: { delivery: 4, sales: 3, geo_gcc: 1, geo_eu: 5, regulated: 3, agents: 2 }, ndaStatus: "signed", mutualEvalStatus: "in_review", lastReviewed: "2026-04-02" },
  { id: "cap_north", partnerFirm: "Northstar Cloud", capabilities: { delivery: 5, sales: 2, geo_gcc: 2, geo_eu: 2, regulated: 4, agents: 4 }, ndaStatus: "signed", mutualEvalStatus: "complete", lastReviewed: "2026-01-19" },
];

const PARTNER_MDF = [
  { id: "mdf_001", partnerFirm: "Quanta Systems", program: "AWS Sovereign Cloud co-marketing", periodEnds: "2026-09-30", allocatedUsdK: 80, spentUsdK: 32, status: "active", focus: "GCC public sector roundtable + 2 reference assets" },
  { id: "mdf_002", partnerFirm: "Northstar Cloud", program: "Azure FSI control-tower demand-gen", periodEnds: "2026-12-31", allocatedUsdK: 60, spentUsdK: 14, status: "active", focus: "İstanbul executive dinner + paid LinkedIn co-branded" },
  { id: "mdf_003", partnerFirm: "Lumen Strategic", program: "PDPL readiness webinar series", periodEnds: "2026-08-15", allocatedUsdK: 35, spentUsdK: 35, status: "fully_spent", focus: "Three-part webinar; converted 4 SQLs into joint pipeline." },
];

const PARTNER_JOINT_MARKETING = [
  { id: "jm_001", title: "Sovereign AI Forum — Riyadh", kind: "co_hosted_event", partnerFirm: "Quanta Systems", date: "2026-06-12", status: "confirmed", expectedAttendees: 80, leadOwner: "Mounir" },
  { id: "jm_002", title: "PDPL playbook — joint webinar #4", kind: "webinar", partnerFirm: "Lumen Strategic", date: "2026-05-28", status: "in_promo", expectedAttendees: 220, leadOwner: "Aisha M." },
  { id: "jm_003", title: "Azure FSI control-tower lunch — Istanbul", kind: "executive_dinner", partnerFirm: "Northstar Cloud", date: "2026-07-09", status: "draft", expectedAttendees: 24, leadOwner: "Gökhan" },
];

const PARTNER_SUBCONTRACTS = [
  { id: "sc_001", engagement: "Sovereign data fabric — Phase 1", partnerFirm: "Quanta Systems", scope: "Landing zone build + data ingestion", sowStatus: "signed", rateCardLockedAt: "2026-03-10", monthlyBurnUsdK: 110, acceptanceGate: "Phase 1 acceptance memo signed by client and AICo lead" },
  { id: "sc_002", engagement: "PDPL readiness program", partnerFirm: "Lumen Strategic", scope: "Regulator interface + KSA-resident delivery staff", sowStatus: "in_redline", rateCardLockedAt: null, monthlyBurnUsdK: 65, acceptanceGate: "Pending — joint quality plan v0.4 in review" },
  { id: "sc_003", engagement: "Azure FSI control-tower", partnerFirm: "Northstar Cloud", scope: "Prime delivery; AICo as named subcontractor", sowStatus: "signed", rateCardLockedAt: "2026-02-21", monthlyBurnUsdK: 38, acceptanceGate: "Joint quality plan v1.0 signed; weekly acceptance reviews" },
];

const PARTNER_FRAMEWORKS = [
  { id: "fa_001", partnerFirm: "Quanta Systems", agreementKind: "Master Services + Reseller", effectiveFrom: "2024-09-01", effectiveTo: "2027-08-31", governingLaw: "DIFC", exclusivities: ["GCC sovereign cloud — joint preferred"], status: "active" },
  { id: "fa_002", partnerFirm: "Lumen Strategic", agreementKind: "Strategic Alliance MoU", effectiveFrom: "2025-02-15", effectiveTo: "2026-02-14", governingLaw: "ADGM", exclusivities: ["KSA financial services regulator interface"], status: "expired_renewing" },
  { id: "fa_003", partnerFirm: "Anchorline Advisors", agreementKind: "Co-delivery framework", effectiveFrom: "2025-06-01", effectiveTo: "2027-05-31", governingLaw: "England & Wales", exclusivities: [], status: "active" },
  { id: "fa_004", partnerFirm: "Northstar Cloud", agreementKind: "Subcontractor framework", effectiveFrom: "2024-11-01", effectiveTo: "2026-10-31", governingLaw: "Türkiye", exclusivities: [], status: "active" },
];

const PARTNER_QBRS = [
  { id: "qbr_001", partnerFirm: "Quanta Systems", periodLabel: "Q1 FY26", scheduledFor: "2026-04-22", status: "completed", attendees: ["Mounir", "Cem Aydın (Quanta)"], decisions: ["Lock joint roadmap on sovereign LLM eval", "Joint hire for KSA delivery — kick off May"], artefactsUrl: "/atelier/qbr/quanta-q1" },
  { id: "qbr_002", partnerFirm: "Lumen Strategic", periodLabel: "Q1 FY26", scheduledFor: "2026-04-29", status: "completed", attendees: ["Aisha M.", "Lumen managing partner"], decisions: ["Renewal terms aligned; redlines exchange by 2026-05-20"], artefactsUrl: "/atelier/qbr/lumen-q1" },
  { id: "qbr_003", partnerFirm: "Northstar Cloud", periodLabel: "Q2 FY26", scheduledFor: "2026-07-15", status: "scheduled", attendees: ["Gökhan", "Northstar founder"], decisions: [], artefactsUrl: null },
  { id: "qbr_004", partnerFirm: "Anchorline Advisors", periodLabel: "Q1 FY26", scheduledFor: "2026-05-21", status: "scheduled", attendees: ["Mounir", "Anchorline alliance lead"], decisions: [], artefactsUrl: null },
];

const PARTNER_SCORECARDS = [
  { id: "sc_quanta", partnerFirm: "Quanta Systems", periodLabel: "Trailing 12mo", revenueUsdK: 1850, satisfaction: 4.4, complianceFlags: 0, jointWinRate: 0.62, deliveryQuality: 4.3, trend: "up" },
  { id: "sc_lumen", partnerFirm: "Lumen Strategic", periodLabel: "Trailing 12mo", revenueUsdK: 940, satisfaction: 4.6, complianceFlags: 0, jointWinRate: 0.55, deliveryQuality: 4.5, trend: "flat" },
  { id: "sc_anchor", partnerFirm: "Anchorline Advisors", periodLabel: "Trailing 12mo", revenueUsdK: 720, satisfaction: 3.9, complianceFlags: 1, jointWinRate: 0.41, deliveryQuality: 3.8, trend: "down" },
  { id: "sc_north", partnerFirm: "Northstar Cloud", periodLabel: "Trailing 12mo", revenueUsdK: 540, satisfaction: 4.1, complianceFlags: 0, jointWinRate: 0.50, deliveryQuality: 4.0, trend: "up" },
];

const PARTNER_RENEWALS = [
  { id: "rn_001", partnerFirm: "Lumen Strategic", agreementKind: "Strategic Alliance MoU", expiresAt: "2026-02-14", daysUntil: -90, stage: "redlines", owner: "Aisha M.", recommendation: "Renew with widened scope to Bahrain + Oman", risk: "low" },
  { id: "rn_002", partnerFirm: "Northstar Cloud", agreementKind: "Subcontractor framework", expiresAt: "2026-10-31", daysUntil: 169, stage: "internal_review", owner: "Gökhan", recommendation: "Renew at improved blended rate; add joint marketing addendum", risk: "low" },
  { id: "rn_003", partnerFirm: "Quanta Systems", agreementKind: "Master Services + Reseller", expiresAt: "2027-08-31", daysUntil: 473, stage: "monitoring", owner: "Mounir", recommendation: "Renew + escalate to multi-year + exclusivity in GCC sovereign", risk: "low" },
  { id: "rn_004", partnerFirm: "Anchorline Advisors", agreementKind: "Co-delivery framework", expiresAt: "2027-05-31", daysUntil: 381, stage: "monitoring", owner: "Mounir", recommendation: "Tier review — performance below threshold; consider non-renew or scope-narrow", risk: "med" },
];

const PARTNER_TIER_CHANGES = [
  { id: "tc_001", partnerFirm: "Northstar Cloud", platform: "Azure", fromTier: "Advanced", toTier: "Expert MSP", effectiveAt: "2026-06-01", driver: "Two new Solutions Architect Expert holders", action: "Update co-sell motion + refresh joint deck" },
  { id: "tc_002", partnerFirm: "AICo (with AWS)", platform: "AWS", fromTier: "Advanced", toTier: "Premier", effectiveAt: "2026-08-15", driver: "ML Specialty + Sovereign Cloud spec defended", action: "Push joint Quanta GTM into AWS Premier track" },
  { id: "tc_003", partnerFirm: "Anchorline Advisors", platform: "Internal", fromTier: "Strategic", toTier: "Preferred", effectiveAt: "2026-07-01", driver: "Sustained scorecard slip; conflict on jo_003 detected", action: "Communicate downgrade in next QBR; gate joint deals to partner-led only" },
];

const PARTNER_OFFBOARDINGS = [
  { id: "ob_001", partnerFirm: "Beacon Cloud Co.", reason: "Acquired by competitor; conflict baseline broken.", initiatedAt: "2026-03-01", phase: "wind_down_in_flight", openObligationsUsdK: 40, dataReturnDue: "2026-06-30" },
];

router.get("/partners/target-partners", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_TARGETS });
});

router.get("/partners/capability-matrix", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_CAPABILITIES });
});

router.get("/partners/mdf", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_MDF });
});

router.get("/partners/joint-marketing", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_JOINT_MARKETING });
});

router.get("/partners/sub-contracts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_SUBCONTRACTS });
});

router.get("/partners/framework-agreements", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_FRAMEWORKS });
});

router.get("/partners/qbrs", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_QBRS });
});

router.get("/partners/scorecards", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_SCORECARDS });
});

router.get("/partners/renewals", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_RENEWALS });
});

router.get("/partners/tier-changes", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_TIER_CHANGES });
});

router.get("/partners/offboardings", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  res.json({ items: PARTNER_OFFBOARDINGS });
});

// =============================================================
// STUDIO  (recruiter has read access here; this is their workspace)
// =============================================================
router.get("/studio/open-roles", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioOpenRoles)
    .where(orgScope(me, atelierStudioOpenRoles));
  res.json({ items: rows });
});

router.get("/studio/candidates", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioCandidates)
    .where(orgScope(me, atelierStudioCandidates));
  res.json({ items: rows });
});

router.get("/studio/interview-panels", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioInterviewPanels)
    .where(orgScope(me, atelierStudioInterviewPanels));
  res.json({ items: rows });
});

router.get("/studio/reference-checks", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioReferenceChecks)
    .where(orgScope(me, atelierStudioReferenceChecks));
  res.json({ items: rows });
});

router.get("/studio/offers", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioOffers)
    .where(orgScope(me, atelierStudioOffers));
  res.json({ items: rows });
});

router.get("/studio/referrals", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioReferrals)
    .where(orgScope(me, atelierStudioReferrals));
  res.json({ items: rows });
});

// =============================================================
// GUARDHOUSE  (compliance_officer is the canonical owner)
// =============================================================
router.get("/guardhouse/controls", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseControls)
    .where(orgScope(me, atelierGuardhouseControls));
  res.json({ items: rows });
});

router.get("/guardhouse/evidence", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseEvidence)
    .where(orgScope(me, atelierGuardhouseEvidence));
  res.json({ items: rows });
});

router.get("/guardhouse/pentests", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhousePentests)
    .where(orgScope(me, atelierGuardhousePentests));
  res.json({ items: rows });
});

router.get("/guardhouse/vendors", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseVendors)
    .where(orgScope(me, atelierGuardhouseVendors));
  res.json({ items: rows });
});

router.get("/guardhouse/incidents", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseIncidents)
    .where(orgScope(me, atelierGuardhouseIncidents));
  res.json({ items: rows });
});

router.get("/guardhouse/dsars", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseDsars)
    .where(orgScope(me, atelierGuardhouseDsars));
  res.json({ items: rows });
});

router.get("/guardhouse/backups", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseBackups)
    .where(orgScope(me, atelierGuardhouseBackups));
  res.json({ items: rows });
});

// =============================================================
// IP CATALOG
// =============================================================
router.get("/ip/code-assets", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierIpCodeAssets)
    .where(orgScope(me, atelierIpCodeAssets));
  res.json({ items: rows });
});

router.get("/ip/oss-dependencies", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierIpOssDependencies)
    .where(orgScope(me, atelierIpOssDependencies));
  res.json({ items: rows });
});

router.get("/ip/demo-environments", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierIpDemoEnvironments)
    .where(orgScope(me, atelierIpDemoEnvironments));
  res.json({ items: rows });
});

router.get("/ip/license-grants", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierIpLicenseGrants)
    .where(orgScope(me, atelierIpLicenseGrants));
  res.json({ items: rows });
});

export default router;
