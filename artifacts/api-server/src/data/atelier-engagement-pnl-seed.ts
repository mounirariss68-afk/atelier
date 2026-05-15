/**
 * Atelier — Engagement P&L, EAC and Change-Order seed (Task #414, Wave 2).
 *
 * Demo-only data describing per-engagement budgets, costs incurred to date,
 * estimate-to-complete (ETC), and a small change-order register. The state
 * is held in-memory on the server (per the task: "mock workflow is fine")
 * so the page can demonstrate re-baselining on change-order approval and
 * RAG behaviour end-to-end without touching the GL or the contracts table.
 *
 * Cost figures are at *cost rate* (not bill rate) — labour is loaded at
 * USD/hour cost, not the rack rate the client pays. That distinction is
 * what makes the P&L a useful surface for the CFO instead of a mirror of
 * recognised revenue.
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

export type ChangeOrderStatus = "draft" | "submitted" | "approved" | "rejected";

export interface ChangeOrder {
  id: string;
  engagementId: string;
  number: string;
  description: string;
  valueUsd: number; // delta to contract value
  hoursImpact: number; // delta to budget labour hours
  costImpactUsd: number; // delta to BAC
  status: ChangeOrderStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  raisedByUserId: string;
  approvedByUserId: string | null;
  rejectionReason: string | null;
  createdAt: string;
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
// Tuned so that:
//   - tasama (amber) — over plan on hours; ETC will push EAC ~5–8% over BAC
//   - dge (green) — closed/compounded, on-plan
//   - aldrees (green) — closed/compounded, on-plan
//   - nhc (red) — early-stage but already burning fast; ETC drives EAC
//     ~18% over BAC and forecast margin slips well below planned 44%
const COSTS: EngagementCostToDate[] = [
  {
    engagementId: "eng_tasama_bpo_phase1",
    asOf: today,
    labourHoursToDate: 5_280, // 55% of plan
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
    labourHoursToDate: 720, // 40% of plan
    labourCostToDateUsd: 122_400,
    expensesToDateUsd: 9_600,
    subsToDateUsd: 18_000,
    costToDateUsd: 150_000,
    revenueRecognisedToDateUsd: 162_000,
    invoicedToDateUsd: 108_000,
    cashCollectedToDateUsd: 54_000,
    pctComplete: 0.30, // burning cost faster than %complete would suggest
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

// ----- CHANGE ORDERS (initial state) ---------------------------------
const CHANGE_ORDERS: ChangeOrder[] = [
  {
    id: "co_tasama_001",
    engagementId: "eng_tasama_bpo_phase1",
    number: "CO-001",
    description:
      "Add Arabic-language conversational coverage for top-3 services (out-of-scope in original SOW).",
    valueUsd: 180_000,
    hoursImpact: 720,
    costImpactUsd: 100_800,
    status: "approved",
    submittedAt: daysAgo(35),
    approvedAt: daysAgo(28),
    rejectedAt: null,
    raisedByUserId: "p_layla_haddad",
    approvedByUserId: "p_mounir_ariss",
    rejectionReason: null,
    createdAt: daysAgo(40),
  },
  {
    id: "co_tasama_002",
    engagementId: "eng_tasama_bpo_phase1",
    number: "CO-002",
    description:
      "Extend rollout cadence by two weeks to absorb client's holiday freeze; partner-firm subs to bridge.",
    valueUsd: 60_000,
    hoursImpact: 240,
    costImpactUsd: 50_400,
    status: "submitted",
    submittedAt: daysAgo(4),
    approvedAt: null,
    rejectedAt: null,
    raisedByUserId: "p_layla_haddad",
    approvedByUserId: null,
    rejectionReason: null,
    createdAt: daysAgo(6),
  },
  {
    id: "co_nhc_001",
    engagementId: "eng_nhc_ar_pilot",
    number: "CO-001",
    description:
      "Add CRM hand-off integration discovered during week-2 walkthrough; client agreed in steering.",
    valueUsd: 72_000,
    hoursImpact: 240,
    costImpactUsd: 33_600,
    status: "submitted",
    submittedAt: daysAgo(2),
    approvedAt: null,
    rejectedAt: null,
    raisedByUserId: "p_layla_haddad",
    approvedByUserId: null,
    rejectionReason: null,
    createdAt: daysAgo(3),
  },
  {
    id: "co_dge_001",
    engagementId: "eng_dge_effortless_v1",
    number: "CO-001",
    description: "Carve-out of compliance dashboard scope; client deferred to phase 2.",
    valueUsd: -45_000,
    hoursImpact: -150,
    costImpactUsd: -21_000,
    status: "approved",
    submittedAt: daysAgo(120),
    approvedAt: daysAgo(115),
    rejectedAt: null,
    raisedByUserId: "p_omar_najjar",
    approvedByUserId: "p_mounir_ariss",
    rejectionReason: null,
    createdAt: daysAgo(125),
  },
];

// ----- AUDIT TRAIL (initial state, derived) --------------------------
const AUDIT: AuditEntry[] = [];
function pushAudit(entry: AuditEntry): void {
  AUDIT.unshift(entry);
}

// Seed a couple of audit rows from the pre-approved change orders so the
// trail isn't empty on first load.
for (const co of CHANGE_ORDERS) {
  pushAudit({
    id: `aud_${co.id}_created`,
    engagementId: co.engagementId,
    at: co.createdAt,
    actorUserId: co.raisedByUserId,
    action: "change_order.created",
    detail: `${co.number} drafted: ${co.description}`,
  });
  if (co.submittedAt) {
    pushAudit({
      id: `aud_${co.id}_submitted`,
      engagementId: co.engagementId,
      at: co.submittedAt,
      actorUserId: co.raisedByUserId,
      action: "change_order.submitted",
      detail: `${co.number} submitted for approval (value ${co.valueUsd >= 0 ? "+" : ""}$${co.valueUsd.toLocaleString()}).`,
    });
  }
  if (co.status === "approved" && co.approvedAt) {
    pushAudit({
      id: `aud_${co.id}_approved`,
      engagementId: co.engagementId,
      at: co.approvedAt,
      actorUserId: co.approvedByUserId,
      action: "change_order.approved",
      detail: `${co.number} approved — engagement re-baselined.`,
    });
  }
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
export function listChangeOrders(engagementId?: string): ChangeOrder[] {
  return engagementId
    ? CHANGE_ORDERS.filter((c) => c.engagementId === engagementId)
    : CHANGE_ORDERS.slice();
}
export function getChangeOrder(id: string): ChangeOrder | null {
  return CHANGE_ORDERS.find((c) => c.id === id) ?? null;
}
export function listAudit(engagementId?: string, limit = 100): AuditEntry[] {
  const rows = engagementId ? AUDIT.filter((a) => a.engagementId === engagementId) : AUDIT;
  return rows.slice(0, limit);
}

// ============================================================
// Mutations (mock workflow — in-memory only)
// ============================================================
function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
function nowIso(): string {
  return new Date().toISOString();
}

export function createChangeOrder(input: {
  engagementId: string;
  description: string;
  valueUsd: number;
  hoursImpact: number;
  costImpactUsd: number;
  raisedByUserId: string;
}): ChangeOrder {
  const eng = input.engagementId;
  const existing = listChangeOrders(eng).length;
  const co: ChangeOrder = {
    id: rid("co"),
    engagementId: eng,
    number: `CO-${String(existing + 1).padStart(3, "0")}`,
    description: input.description,
    valueUsd: input.valueUsd,
    hoursImpact: input.hoursImpact,
    costImpactUsd: input.costImpactUsd,
    status: "draft",
    submittedAt: null,
    approvedAt: null,
    rejectedAt: null,
    raisedByUserId: input.raisedByUserId,
    approvedByUserId: null,
    rejectionReason: null,
    createdAt: nowIso(),
  };
  CHANGE_ORDERS.push(co);
  pushAudit({
    id: rid("aud"),
    engagementId: eng,
    at: co.createdAt,
    actorUserId: input.raisedByUserId,
    action: "change_order.created",
    detail: `${co.number} drafted: ${co.description}`,
  });
  return co;
}

export function submitChangeOrder(id: string, actorUserId: string): ChangeOrder | null {
  const co = getChangeOrder(id);
  if (!co || co.status !== "draft") return null;
  co.status = "submitted";
  co.submittedAt = nowIso();
  pushAudit({
    id: rid("aud"),
    engagementId: co.engagementId,
    at: co.submittedAt,
    actorUserId,
    action: "change_order.submitted",
    detail: `${co.number} submitted for approval.`,
  });
  return co;
}

/**
 * Approve a change order. Re-baselines the engagement: contract value,
 * budget labour hours, BAC. Records the audit trail entry.
 */
export function approveChangeOrder(
  id: string,
  actorUserId: string,
): { changeOrder: ChangeOrder; budget: EngagementBudget } | null {
  const co = getChangeOrder(id);
  if (!co || co.status !== "submitted") return null;
  const budget = getBudget(co.engagementId);
  if (!budget) return null;
  co.status = "approved";
  co.approvedAt = nowIso();
  co.approvedByUserId = actorUserId;
  // Re-baseline. Cost impact lands on labour cost; BAC is recomputed.
  budget.contractValueUsd += co.valueUsd;
  budget.budgetLabourHours += co.hoursImpact;
  budget.budgetLabourCostUsd += co.costImpactUsd;
  budget.budgetAtCompletionUsd =
    budget.budgetLabourCostUsd + budget.budgetExpensesUsd + budget.budgetSubsUsd;
  budget.baselinedAt = co.approvedAt;
  pushAudit({
    id: rid("aud"),
    engagementId: co.engagementId,
    at: co.approvedAt,
    actorUserId,
    action: "change_order.approved",
    detail: `${co.number} approved — engagement re-baselined: contract value ${co.valueUsd >= 0 ? "+" : ""}$${co.valueUsd.toLocaleString()}, BAC ${co.costImpactUsd >= 0 ? "+" : ""}$${co.costImpactUsd.toLocaleString()}.`,
  });
  return { changeOrder: co, budget };
}

export function rejectChangeOrder(
  id: string,
  actorUserId: string,
  reason: string,
): ChangeOrder | null {
  const co = getChangeOrder(id);
  if (!co || co.status !== "submitted") return null;
  co.status = "rejected";
  co.rejectedAt = nowIso();
  co.rejectionReason = reason;
  pushAudit({
    id: rid("aud"),
    engagementId: co.engagementId,
    at: co.rejectedAt,
    actorUserId,
    action: "change_order.rejected",
    detail: `${co.number} rejected — ${reason}`,
  });
  return co;
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
