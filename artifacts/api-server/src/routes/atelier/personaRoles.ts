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

// Compensation viewers (day rates, base comp). HR + finance + leadership.
const COMP_VIEWERS = SET("founding_partner", "partner", "finance", "hr");

// Restricted personas that must be narrowed to their explicit engagement
// grants (no firm-wide visibility). Board observers are intentionally not
// here — their realm gate is handled separately when the board shell ships.
const RESTRICTED = SET("contractor", "partner_firm_resource");

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
