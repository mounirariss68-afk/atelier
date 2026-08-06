/**
 * Atelier — central persona-role helpers (Task #292).
 *
 * One source of truth for the 9-persona model so route guards stay aligned
 * as we sweep the rest of the codebase. Anything that used to test
 * `me.role === "partner"` for "leadership" should call `isLeadership`;
 * anything that used "operations" for finance/people-ops should split into
 * `isFinance` / `isHr`; anything that used "engagement_lead" as a persona
 * should call `isSeniorManager` (and remember that engagement-leadership is
 * now a per-engagement role on `atelier_engagement_access`, not a persona).
 *
 * The 9 canonical roles:
 *   founding_partner | partner | finance | hr | senior_manager |
 *   consultant      | contractor | partner_firm_resource | board_observer
 */

export const ATELIER_PERSONA_ROLES = [
  "founding_partner",
  "partner",
  "finance",
  "hr",
  "senior_manager",
  "consultant",
  "contractor",
  "partner_firm_resource",
  "board_observer",
  // v5 — Scale & Trust personas
  // Recruiter: write access into /studio (candidate CRM, panels, offers).
  // Cannot see client engagements.
  "recruiter",
  // Compliance Officer: evidence write access in /guardhouse, plus
  // read-only across audit-relevant surfaces (audit log, access reviews,
  // backups, incidents, DSARs).
  "compliance_officer",
  // Task #50 — self-service employee. Created by the HR add-joiner flow;
  // sees ONLY the Me lens (/me self-scope routes + /personas). No org-wide
  // data, no client work surfaces.
  "employee",
] as const;

export type AtelierRole = (typeof ATELIER_PERSONA_ROLES)[number];

type RoleLike = string | null | undefined;

const SET = (...rs: AtelierRole[]) => new Set<string>(rs);

// Partner-tier leadership: founding_partner outranks partner, both bypass
// per-engagement ACLs and may sign off as the partner approver.
const LEADERSHIP = SET("founding_partner", "partner");

// Lead-level approvers (timesheet lead-approve, expense lead-approve, etc.).
// senior_manager replaces the legacy `engagement_lead` persona; finance also
// gets lead-approve rights because operations split into finance/hr.
const LEAD_APPROVERS = SET("founding_partner", "partner", "senior_manager", "finance");

// Compensation viewers (payroll, salary/base comp, day rates, banking).
// Task #221 — tightened: founding_partner | hr | finance. Regular partners
// lose person-level compensation; they keep engagement-costing visibility
// via ENGAGEMENT_COSTING_VIEWERS below. Mirrors atelier_can_view_comp()
// in lib/db/drizzle/0025_atelier_column_rls.sql (updated in 0027).
const COMP_VIEWERS = SET("founding_partner", "hr", "finance");

// Sensitive-people viewers (personal data, HR notes, person documents,
// dependents, compliance records, personnel contracts / NDA / COI / ID /
// tax docs). Subjects can always read their own — caller-side check, not
// in this set. Task #221 — founding_partner | hr ONLY (partners removed;
// finance never had it). Pairs with the column-level RLS mask
// `atelier_can_view_personnel(owner_user_id)`.
const SENSITIVE_PEOPLE_VIEWERS = SET("founding_partner", "hr");

// Engagement-costing viewers (deal pricing internal cost, engagement P&L,
// change-order value deltas, wallet/ledger cost roll-ups). Task #221 —
// this is the ONLY cost surface where regular partners keep visibility;
// it is engagement economics, not person-level compensation.
const ENGAGEMENT_COSTING_VIEWERS = SET(
  "founding_partner",
  "partner",
  "finance",
  "hr",
);

// People-record editors (roster demographics / contact / titles / PATCH).
// Task #221 — founding_partner | hr only.
const PEOPLE_EDITORS = SET("founding_partner", "hr");

// Restricted personas that must be narrowed to their explicit engagement
// grants (no firm-wide visibility). Board observers are intentionally not
// here — their realm gate is handled separately when the board shell ships.
//
// Task #306 (v5) — `recruiter` is restricted: their workspace is /studio
// (candidates, panels, offers) and they explicitly must not see client
// engagements. Adding them here makes the RLS middleware resolve their
// engagement grants from `atelier_engagement_access`; with no rows they
// receive the deny-all sentinel and any engagement-scoped table denies
// access. `compliance_officer` is NOT restricted by engagement — by design
// they need firm-wide read for audit (controls, evidence, incidents,
// access reviews, backups, DSARs). They get no comp / personnel /
// approval / breakglass capabilities elsewhere in this file, so the
// firm-wide read is bounded to non-sensitive audit surfaces.
const RESTRICTED = SET("contractor", "partner_firm_resource", "recruiter");

// Reference-data / firm-config admin (Task #292 re-gate).
const REFERENCE_DATA_ADMIN = SET("founding_partner", "hr");

export const isLeadership = (r: RoleLike): boolean => !!r && LEADERSHIP.has(r);
export const isFoundingPartner = (r: RoleLike): boolean => r === "founding_partner";
export const isPartner = (r: RoleLike): boolean => r === "partner";
export const isFinance = (r: RoleLike): boolean => r === "finance";
export const isHr = (r: RoleLike): boolean => r === "hr";
export const isSeniorManager = (r: RoleLike): boolean => r === "senior_manager";
export const isConsultant = (r: RoleLike): boolean => r === "consultant";
export const isContractor = (r: RoleLike): boolean => r === "contractor";
export const isPartnerFirmResource = (r: RoleLike): boolean =>
  r === "partner_firm_resource";
export const isBoardObserver = (r: RoleLike): boolean => r === "board_observer";

/** Lead-tier approval (timesheet stage 1, expense lead-approve, etc.). */
export const canApproveAsLead = (r: RoleLike): boolean =>
  !!r && LEAD_APPROVERS.has(r);

/** Final partner sign-off — only the two partner-tier personas. */
export const canApproveAsPartner = (r: RoleLike): boolean =>
  !!r && LEADERSHIP.has(r);

/** Compensation read access (base, day rate, cost). */
export const canViewCompensation = (r: RoleLike): boolean =>
  !!r && COMP_VIEWERS.has(r);

/**
 * Sensitive-people read access (personal data, HR notes, person documents,
 * dependents, compliance records). Self-access (the subject reading their
 * own data) is checked by the caller — this helper only answers the
 * "is this persona on the firm-wide allow-list?" question. Task #221.
 */
export const canViewSensitivePeopleData = (r: RoleLike): boolean =>
  !!r && SENSITIVE_PEOPLE_VIEWERS.has(r);

/**
 * Personnel-contract read access (employment contract, NDA, COI, ID/tax,
 * cert files). Task #221 — now an alias of the sensitive-people gate
 * (founding_partner | hr); kept for existing call sites.
 */
export const canViewPersonnelContract = (r: RoleLike): boolean =>
  !!r && SENSITIVE_PEOPLE_VIEWERS.has(r);

/**
 * Engagement-costing read access (deal pricing internal cost, P&L value
 * deltas, change-order economics, cost roll-ups). Task #221 — regular
 * partners keep this even though they lost person-level comp.
 */
export const canViewEngagementCosting = (r: RoleLike): boolean =>
  !!r && ENGAGEMENT_COSTING_VIEWERS.has(r);

/** People-record edit access (roster person writes). Task #221. */
export const canEditPeople = (r: RoleLike): boolean =>
  !!r && PEOPLE_EDITORS.has(r);

/**
 * Principle-override (breakglass) actor allow-list. Only partner-tier may
 * invoke `atelier_breakglass(...)` to unmask comp / personnel-contract
 * sensitivity for one transaction. The DB function enforces this too.
 * Task #293.
 */
export const canBreakglass = (r: RoleLike): boolean =>
  !!r && LEADERSHIP.has(r);

/**
 * Persona requires per-engagement scoping and never sees the firm-wide
 * aggregate. Used by the RLS middleware to decide whether to inject
 * `app.engagement_ids` from `atelier_engagement_access`.
 */
// Task #292 — board_observer is deny-by-default at the RLS layer until the
// boardroom realm ships (see follow-up #329). Treat it as restricted so it
// receives no engagement-grants and no org-wide access.
export const isBoardObserverRestricted = (r: RoleLike): boolean =>
  r === "board_observer";

export const isRestrictedPersona = (r: RoleLike): boolean =>
  !!r && RESTRICTED.has(r);

/** Firm-wide reference-data admin (countries / industries / sub-industries). */
export const canAdminReferenceData = (r: RoleLike): boolean =>
  !!r && REFERENCE_DATA_ADMIN.has(r);

/** Wallet / expense policy admin (CRUD on policies, approve any expense). */
export const canAdminWalletPolicy = (r: RoleLike): boolean =>
  !!r && (LEADERSHIP.has(r) || r === "finance");

/** Partner-firm-hours uploader (PFR PMs + leadership + finance). */
export const canUploadPartnerFirmHours = (r: RoleLike): boolean =>
  !!r && (LEADERSHIP.has(r) || r === "finance" || r === "partner_firm_resource");

/** Partner-firm-hours viewer (leadership + finance + senior manager + PFR). */
export const canViewPartnerFirmHours = (r: RoleLike): boolean =>
  !!r &&
  (LEADERSHIP.has(r) ||
    r === "finance" ||
    r === "senior_manager" ||
    r === "partner_firm_resource");

/** Manage partner-firm definitions (leadership + finance). */
export const canManagePartnerFirm = (r: RoleLike): boolean =>
  !!r && (LEADERSHIP.has(r) || r === "finance");

// Task #513 — Partners lens (alliance lifecycle) readers. Internal roles
// only: partner-tier + consultant-tier per the persona doctrine, plus
// finance/hr (registry doubles as the roster partner-firm master) and
// compliance_officer (firm-wide read for audit, per Task #354). External
// personas — partner_firm_resource especially — must NEVER read firm-wide
// alliance intel; recruiters stay scoped to /studio.
const PARTNERS_LENS_READERS = SET(
  "founding_partner",
  "partner",
  "senior_manager",
  "consultant",
  "finance",
  "hr",
  "compliance_officer",
);
export const canAccessPartnersLens = (r: RoleLike): boolean =>
  !!r && PARTNERS_LENS_READERS.has(r);

/** Partner-lens writers (create/edit/archive alliance records). */
export const canEditPartnersLens = (r: RoleLike): boolean =>
  !!r &&
  (LEADERSHIP.has(r) || r === "senior_manager" || r === "finance");
