/**
 * Atelier — Engagement P&L, EAC and ETC seed (Task #414, Wave 2; Task #431).
 *
 * Demo-only data describing per-engagement budgets, costs incurred to date,
 * and estimate-to-complete (ETC). The state is held in-memory on the
 * server so the page can demonstrate re-baselining and RAG behaviour
 * end-to-end without touching the GL.
 *
 * Cost figures are at *cost rate* (not bill rate) — labour is loaded at
 * USD/hour cost, not the rack rate the client pays.
 *
 * Change orders used to live in this in-memory store too (Wave-2 mock
 * workflow). As of Task #431 they are owned by the real
 * `atelier_change_order` table + `changeOrderRoutes.ts` state machine
 * (draft → partner_approved → client_proposed → client_accepted/rejected
 * → posted). The only leftover hook here is `applyPostedChangeOrder`,
 * which the server calls when a CO transitions to `posted` so the
 * engagement budget gets re-baselined and the EAC engine recomputes.
 */

export interface EngagementBudget {
  engagementId: string;
  contractValueUsd: number;
  budgetLabourHours: number;
  budgetLabourCostUsd: number;
  budgetExpensesUsd: number;
  budgetSubsUsd: number;
  budgetAtCompletionUsd: number; // BAC = labour + expenses + subs
  baselinedAt: string;
  partnerOwnerId: string;
  engagementLeadId: string;
  sector: string;
}

export interface EngagementCostToDate {
  engagementId: string;
  asOf: string;
  labourHoursToDate: number;
  labourCostToDateUsd: number;
  expensesToDateUsd: number;
  subsToDateUsd: number;
  costToDateUsd: number;
  revenueRecognisedToDateUsd: number;
  invoicedToDateUsd: number;
  cashCollectedToDateUsd: number;
  pctComplete: number; // 0..1, manual / PM call
}

/** Tiny lookup so the per-engagement P&L and firm register can render
 *  partner / lead names without joining against a separate people table. */
export const PERSON_NAMES: Record<string, string> = {
  p_mounir_ariss: "Mounir Ariss",
  p_layla_haddad: "Layla Haddad",
  p_omar_najjar: "Omar Najjar",
  p_gokhan_guney: "Gokhan Guney",
};
export function personName(id: string | null | undefined): string {
  if (!id) return "—";
  return PERSON_NAMES[id] ?? id;
}

export type EtcMethod = "manual" | "extrapolation";

export interface EngagementEtc {
  engagementId: string;
  method: EtcMethod;
  manualEtcUsd: number | null;
  rationale: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

/**
 * Lightweight projection of `atelier_change_order` used by the EAC
 * engine's `summariseChangeOrders` and the engagement-pnl payloads.
 * Only the fields the EAC + register UI need.
 */
export interface ChangeOrder {
  id: string;
  engagementId: string;
  status:
    | "draft"
    | "partner_approved"
    | "client_proposed"
    | "client_accepted"
    | "client_rejected"
    | "withdrawn"
    | "posted";
  valueDeltaUsd: number | null;
}

export interface AuditEntry {
  id: string;
  engagementId: string;
  at: string;
  actorUserId: string | null;
  action: string;
  detail: string;
}

const today = "2026-05-15";
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// ----- BUDGETS (baselines) -------------------------------------------
const BUDGETS: EngagementBudget[] = [
  {
    engagementId: "eng_tasama_bpo_phase1",
    contractValueUsd: 2_400_000,
    budgetLabourHours: 9_600,
    budgetLabourCostUsd: 1_344_000, // 9600h × $140 blended cost
    budgetExpensesUsd: 96_000,
    budgetSubsUsd: 240_000,
    budgetAtCompletionUsd: 1_680_000, // labour + expenses + subs
    baselinedAt: daysAgo(60),
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    sector: "BPO / Shared Services",
  },
  {
    engagementId: "eng_dge_effortless_v1",
    contractValueUsd: 720_000,
    budgetLabourHours: 2_400,
    budgetLabourCostUsd: 336_000,
    budgetExpensesUsd: 24_000,
    budgetSubsUsd: 60_000,
    budgetAtCompletionUsd: 420_000,
    baselinedAt: daysAgo(180),
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_omar_najjar",
    sector: "Public Sector",
  },
  {
    engagementId: "eng_aldrees_workshop",
    contractValueUsd: 180_000,
    budgetLabourHours: 480,
    budgetLabourCostUsd: 72_000,
    budgetExpensesUsd: 12_000,
    budgetSubsUsd: 0,
    budgetAtCompletionUsd: 84_000,
    baselinedAt: daysAgo(45),
    partnerOwnerId: "p_gokhan_guney",
    engagementLeadId: "p_layla_haddad",
    sector: "Industrial",
  },
  {
    engagementId: "eng_nhc_ar_pilot",
    contractValueUsd: 540_000,
    budgetLabourHours: 1_800,
    budgetLabourCostUsd: 252_000,
    budgetExpensesUsd: 18_000,
    budgetSubsUsd: 30_000,
    budgetAtCompletionUsd: 300_000,
    baselinedAt: daysAgo(20),
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    sector: "Real Estate",
  },
];

// ----- COSTS-TO-DATE -------------------------------------------------
const COSTS: EngagementCostToDate[] = [
  {
    engagementId: "eng_tasama_bpo_phase1",
    asOf: today,
    labourHoursToDate: 5_280,
    labourCostToDateUsd: 792_000,
    expensesToDateUsd: 61_000,
    subsToDateUsd: 144_000,
    costToDateUsd: 997_000,
    revenueRecognisedToDateUsd: 1_320_000,
    invoicedToDateUsd: 1_140_000,
    cashCollectedToDateUsd: 760_000,
    pctComplete: 0.55,
  },
  {
    engagementId: "eng_dge_effortless_v1",
    asOf: today,
    labourHoursToDate: 2_350,
    labourCostToDateUsd: 329_000,
    expensesToDateUsd: 22_400,
    subsToDateUsd: 58_500,
    costToDateUsd: 409_900,
    revenueRecognisedToDateUsd: 720_000,
    invoicedToDateUsd: 720_000,
    cashCollectedToDateUsd: 720_000,
    pctComplete: 1.0,
  },
  {
    engagementId: "eng_aldrees_workshop",
    asOf: today,
    labourHoursToDate: 460,
    labourCostToDateUsd: 69_000,
    expensesToDateUsd: 11_200,
    subsToDateUsd: 0,
    costToDateUsd: 80_200,
    revenueRecognisedToDateUsd: 180_000,
    invoicedToDateUsd: 180_000,
    cashCollectedToDateUsd: 165_000,
    pctComplete: 1.0,
  },
  {
    engagementId: "eng_nhc_ar_pilot",
    asOf: today,
    labourHoursToDate: 720,
    labourCostToDateUsd: 122_400,
    expensesToDateUsd: 9_600,
    subsToDateUsd: 18_000,
    costToDateUsd: 150_000,
    revenueRecognisedToDateUsd: 162_000,
    invoicedToDateUsd: 108_000,
    cashCollectedToDateUsd: 54_000,
    pctComplete: 0.30,
  },
];

// ----- ETC (initial state) -------------------------------------------
const ETCS: EngagementEtc[] = [
  {
    engagementId: "eng_tasama_bpo_phase1",
    method: "manual",
    manualEtcUsd: 820_000,
    rationale:
      "Lead's bottoms-up: rollout workstream slipping ~3 weeks; held additional QA hours and one extra sub-engagement.",
    updatedAt: daysAgo(7),
    updatedByUserId: "p_layla_haddad",
  },
  {
    engagementId: "eng_dge_effortless_v1",
    method: "manual",
    manualEtcUsd: 0,
    rationale: "Closed engagement; nothing left to spend.",
    updatedAt: daysAgo(20),
    updatedByUserId: "p_omar_najjar",
  },
  {
    engagementId: "eng_aldrees_workshop",
    method: "manual",
    manualEtcUsd: 0,
    rationale: "Workshop closed; learning harvest captured.",
    updatedAt: daysAgo(15),
    updatedByUserId: "p_layla_haddad",
  },
  {
    engagementId: "eng_nhc_ar_pilot",
    method: "extrapolation",
    manualEtcUsd: null,
    rationale:
      "Driver-based: CTD is 50% of BAC at only 30% complete — extrapolation forecasts a material over-run.",
    updatedAt: daysAgo(3),
    updatedByUserId: "p_layla_haddad",
  },
];

// ----- AUDIT TRAIL (initial state) -----------------------------------
const AUDIT: AuditEntry[] = [];
function pushAudit(entry: AuditEntry): void {
  AUDIT.unshift(entry);
}

// ============================================================
// Read accessors
// ============================================================
export function listBudgets(): EngagementBudget[] {
  return BUDGETS;
}
export function getBudget(engagementId: string): EngagementBudget | null {
  return BUDGETS.find((b) => b.engagementId === engagementId) ?? null;
}
export function listCosts(): EngagementCostToDate[] {
  return COSTS;
}
export function getCost(engagementId: string): EngagementCostToDate | null {
  return COSTS.find((c) => c.engagementId === engagementId) ?? null;
}
export function listEtcs(): EngagementEtc[] {
  return ETCS;
}
export function getEtc(engagementId: string): EngagementEtc | null {
  return ETCS.find((e) => e.engagementId === engagementId) ?? null;
}
export function listAudit(engagementId?: string, limit = 100): AuditEntry[] {
  const rows = engagementId ? AUDIT.filter((a) => a.engagementId === engagementId) : AUDIT;
  return rows.slice(0, limit);
}

// ============================================================
// Mutations (in-memory only)
// ============================================================
function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Idempotency guard for `applyPostedChangeOrder`. Tracks the set of
 * change-order IDs whose deltas have already been folded into the
 * in-memory baseline. Prevents double-counting when:
 *   - the seed reconciliation pass replays already-posted demo COs at
 *     boot, AND
 *   - the runtime workflow posts a brand-new CO from the UI
 * Both call paths converge on this function, and both are safe.
 */
const APPLIED_POSTED_COS = new Set<string>();

/**
 * Re-baseline an engagement when its change order transitions to `posted`.
 * Adds the value delta to contract value and marks the budget as
 * re-baselined now. Cost/hour impact is not modeled on
 * `atelier_change_order` so BAC is unchanged here — the EAC engine will
 * pick up the new contract value via forecast margin recompute.
 *
 * Pushes an audit entry so the per-engagement P&L audit trail captures
 * the rebase. Returns `null` if the engagement is unknown to the in-memory
 * P&L store, OR if this CO has already been applied (idempotent no-op).
 */
export type ApplyPostedChangeOrderResult =
  | { status: "applied"; budget: EngagementBudget }
  | { status: "already_applied" }
  | { status: "engagement_unknown" };

export function applyPostedChangeOrder(args: {
  engagementId: string;
  changeOrderId: string;
  valueDeltaUsd: number;
  actorUserId: string | null;
  /**
   * When true, marks the baseline timestamp with the original posted-at
   * date (passed via `baselinedAtIso`) instead of "now" — used by the
   * boot-time reconciliation pass so the seeded demo doesn't show every
   * engagement as "re-baselined just now".
   */
  baselinedAtIso?: string;
}): ApplyPostedChangeOrderResult {
  if (APPLIED_POSTED_COS.has(args.changeOrderId)) {
    return { status: "already_applied" };
  }
  const budget = getBudget(args.engagementId);
  if (!budget) return { status: "engagement_unknown" };
  const delta = Number.isFinite(args.valueDeltaUsd) ? args.valueDeltaUsd : 0;
  budget.contractValueUsd += delta;
  budget.baselinedAt = args.baselinedAtIso ?? nowIso();
  APPLIED_POSTED_COS.add(args.changeOrderId);
  pushAudit({
    id: rid("aud"),
    engagementId: args.engagementId,
    at: budget.baselinedAt,
    actorUserId: args.actorUserId,
    action: "change_order.posted",
    detail: `${args.changeOrderId} posted — engagement re-baselined: contract value ${delta >= 0 ? "+" : ""}$${Math.round(delta).toLocaleString()}.`,
  });
  return { status: "applied", budget };
}

export function setEtc(input: {
  engagementId: string;
  method: EtcMethod;
  manualEtcUsd: number | null;
  rationale: string;
  actorUserId: string;
}): EngagementEtc | null {
  const existing = getEtc(input.engagementId);
  if (!existing) return null;
  existing.method = input.method;
  existing.manualEtcUsd = input.method === "manual" ? input.manualEtcUsd ?? 0 : null;
  existing.rationale = input.rationale;
  existing.updatedAt = nowIso();
  existing.updatedByUserId = input.actorUserId;
  pushAudit({
    id: rid("aud"),
    engagementId: input.engagementId,
    at: existing.updatedAt,
    actorUserId: input.actorUserId,
    action: "etc.updated",
    detail: `ETC updated (${input.method})${input.method === "manual" && input.manualEtcUsd != null ? ` to $${input.manualEtcUsd.toLocaleString()}` : ""}.`,
  });
  return existing;
}
