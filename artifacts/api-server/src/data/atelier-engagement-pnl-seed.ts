/**
 * Atelier — Engagement P&L, EAC and Change-Order data layer (Task #414, Wave 2;
 * persisted in Postgres per Task #430).
 *
 * Originally an in-memory seed; now backed by drizzle tables so that
 * re-baselining (change-order approval) and ETC overrides survive an
 * API server restart. The seed *data* (SEED_BUDGETS / SEED_COSTS / SEED_ETCS)
 * is still defined here so it can be loaded by the `pnpm seed:atelier` script.
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

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierEngagementBudget,
  atelierEngagementCostToDate,
  atelierEngagementEtc,
  atelierEngagementPnlChangeOrder,
  atelierEngagementPnlAudit,
} from "@workspace/db";

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

// ============================================================
// Initial demo seed (used by scripts/src/seed-atelier.ts and as a
// fallback if the API encounters an empty table on first read)
// ============================================================

const SEED_TODAY = "2026-05-15";
const seedDaysAgo = (n: number): string => {
  const d = new Date(SEED_TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export const SEED_BUDGETS: EngagementBudget[] = [
  {
    engagementId: "eng_tasama_bpo_phase1",
    contractValueUsd: 2_400_000,
    budgetLabourHours: 9_600,
    budgetLabourCostUsd: 1_344_000, // 9600h × $140 blended cost
    budgetExpensesUsd: 96_000,
    budgetSubsUsd: 240_000,
    budgetAtCompletionUsd: 1_680_000, // labour + expenses + subs
    baselinedAt: seedDaysAgo(60),
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
    baselinedAt: seedDaysAgo(180),
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
    baselinedAt: seedDaysAgo(45),
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
    baselinedAt: seedDaysAgo(20),
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    sector: "Real Estate",
  },
];

// Tuned so that:
//   - tasama (amber) — over plan on hours; ETC will push EAC ~5–8% over BAC
//   - dge (green) — closed/compounded, on-plan
//   - aldrees (green) — closed/compounded, on-plan
//   - nhc (red) — early-stage but already burning fast; ETC drives EAC
//     ~18% over BAC and forecast margin slips well below planned 44%
export const SEED_COSTS: EngagementCostToDate[] = [
  {
    engagementId: "eng_tasama_bpo_phase1",
    asOf: SEED_TODAY,
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
    asOf: SEED_TODAY,
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
    asOf: SEED_TODAY,
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
    asOf: SEED_TODAY,
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

export const SEED_ETCS: EngagementEtc[] = [
  {
    engagementId: "eng_tasama_bpo_phase1",
    method: "manual",
    manualEtcUsd: 820_000,
    rationale:
      "Lead's bottoms-up: rollout workstream slipping ~3 weeks; held additional QA hours and one extra sub-engagement.",
    updatedAt: seedDaysAgo(7),
    updatedByUserId: "p_layla_haddad",
  },
  {
    engagementId: "eng_dge_effortless_v1",
    method: "manual",
    manualEtcUsd: 0,
    rationale: "Closed engagement; nothing left to spend.",
    updatedAt: seedDaysAgo(20),
    updatedByUserId: "p_omar_najjar",
  },
  {
    engagementId: "eng_aldrees_workshop",
    method: "manual",
    manualEtcUsd: 0,
    rationale: "Workshop closed; learning harvest captured.",
    updatedAt: seedDaysAgo(15),
    updatedByUserId: "p_layla_haddad",
  },
  {
    engagementId: "eng_nhc_ar_pilot",
    method: "extrapolation",
    manualEtcUsd: null,
    rationale:
      "Driver-based: CTD is 50% of BAC at only 30% complete — extrapolation forecasts a material over-run.",
    updatedAt: seedDaysAgo(3),
    updatedByUserId: "p_layla_haddad",
  },
];

export const SEED_CHANGE_ORDERS: any[] = [
  {
    id: "co_tasama_001",
    engagementId: "eng_tasama_bpo_phase1",
    number: "CO-001",
    description:
      "Add Arabic-language conversational coverage for top-3 services (out-of-scope in original SOW).",
    valueUsd: 180_000,
    hoursImpact: 720,
    costImpactUsd: 100_800,
    status: "posted",
    submittedAt: seedDaysAgo(35),
    approvedAt: seedDaysAgo(28),
    rejectedAt: null,
    raisedByUserId: "p_layla_haddad",
    approvedByUserId: "p_mounir_ariss",
    rejectionReason: null,
    createdAt: seedDaysAgo(40),
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
    status: "partner_approved",
    submittedAt: seedDaysAgo(4),
    approvedAt: null,
    rejectedAt: null,
    raisedByUserId: "p_layla_haddad",
    approvedByUserId: null,
    rejectionReason: null,
    createdAt: seedDaysAgo(6),
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
    status: "partner_approved",
    submittedAt: seedDaysAgo(2),
    approvedAt: null,
    rejectedAt: null,
    raisedByUserId: "p_layla_haddad",
    approvedByUserId: null,
    rejectionReason: null,
    createdAt: seedDaysAgo(3),
  },
  {
    id: "co_dge_001",
    engagementId: "eng_dge_effortless_v1",
    number: "CO-001",
    description: "Carve-out of compliance dashboard scope; client deferred to phase 2.",
    valueUsd: -45_000,
    hoursImpact: -150,
    costImpactUsd: -21_000,
    status: "posted",
    submittedAt: seedDaysAgo(120),
    approvedAt: seedDaysAgo(115),
    rejectedAt: null,
    raisedByUserId: "p_omar_najjar",
    approvedByUserId: "p_mounir_ariss",
    rejectionReason: null,
    createdAt: seedDaysAgo(125),
  },
];

// ============================================================
// Row mappers (drizzle row ⇄ domain type)
// ============================================================
type BudgetRow = typeof atelierEngagementBudget.$inferSelect;
type CostRow = typeof atelierEngagementCostToDate.$inferSelect;
type EtcRow = typeof atelierEngagementEtc.$inferSelect;
type CoRow = typeof atelierEngagementPnlChangeOrder.$inferSelect;
type AuditRow = typeof atelierEngagementPnlAudit.$inferSelect;

function budgetFromRow(r: BudgetRow): EngagementBudget {
  return {
    engagementId: r.engagementId,
    contractValueUsd: r.contractValueUsd,
    budgetLabourHours: r.budgetLabourHours,
    budgetLabourCostUsd: r.budgetLabourCostUsd,
    budgetExpensesUsd: r.budgetExpensesUsd,
    budgetSubsUsd: r.budgetSubsUsd,
    budgetAtCompletionUsd: r.budgetAtCompletionUsd,
    baselinedAt: r.baselinedAt,
    partnerOwnerId: r.partnerOwnerId,
    engagementLeadId: r.engagementLeadId,
    sector: r.sector,
  };
}
function costFromRow(r: CostRow): EngagementCostToDate {
  return {
    engagementId: r.engagementId,
    asOf: r.asOf,
    labourHoursToDate: r.labourHoursToDate,
    labourCostToDateUsd: r.labourCostToDateUsd,
    expensesToDateUsd: r.expensesToDateUsd,
    subsToDateUsd: r.subsToDateUsd,
    costToDateUsd: r.costToDateUsd,
    revenueRecognisedToDateUsd: r.revenueRecognisedToDateUsd,
    invoicedToDateUsd: r.invoicedToDateUsd,
    cashCollectedToDateUsd: r.cashCollectedToDateUsd,
    pctComplete: r.pctComplete,
  };
}
function etcFromRow(r: EtcRow): EngagementEtc {
  return {
    engagementId: r.engagementId,
    method: (r.method === "extrapolation" ? "extrapolation" : "manual") as EtcMethod,
    manualEtcUsd: r.manualEtcUsd ?? null,
    rationale: r.rationale,
    updatedAt: r.updatedAtIso,
    updatedByUserId: r.updatedByUserId ?? null,
  };
}
function coFromRow(r: CoRow): ChangeOrder {
  return {
    id: r.id,
    engagementId: r.engagementId,
    status: r.status as ChangeOrder["status"],
    valueDeltaUsd: r.valueUsd,
  };
}
function auditFromRow(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    engagementId: r.engagementId,
    at: r.atIso,
    actorUserId: r.actorUserId ?? null,
    action: r.action,
    detail: r.detail,
  };
}

export async function listChangeOrders(engagementId?: string): Promise<ChangeOrder[]> {
  const where = engagementId
    ? and(
        isNull(atelierEngagementPnlChangeOrder.deletedAt),
        eq(atelierEngagementPnlChangeOrder.engagementId, engagementId),
      )
    : isNull(atelierEngagementPnlChangeOrder.deletedAt);
  const rows = await db
    .select()
    .from(atelierEngagementPnlChangeOrder)
    .where(where)
    .orderBy(asc(atelierEngagementPnlChangeOrder.createdAtIso));
  return rows.map(coFromRow);
}
export async function getChangeOrder(id: string): Promise<ChangeOrder | null> {
  const [row] = await db
    .select()
    .from(atelierEngagementPnlChangeOrder)
    .where(eq(atelierEngagementPnlChangeOrder.id, id))
    .limit(1);
  return row ? coFromRow(row) : null;
}
// ============================================================
// Read accessors (drizzle-backed; async)
// ============================================================
export async function listBudgets(): Promise<EngagementBudget[]> {
  const rows = await db
    .select()
    .from(atelierEngagementBudget)
    .where(isNull(atelierEngagementBudget.deletedAt));
  return rows.map(budgetFromRow);
}
export async function getBudget(engagementId: string): Promise<EngagementBudget | null> {
  const [row] = await db
    .select()
    .from(atelierEngagementBudget)
    .where(eq(atelierEngagementBudget.engagementId, engagementId))
    .limit(1);
  return row ? budgetFromRow(row) : null;
}
export async function listCosts(): Promise<EngagementCostToDate[]> {
  const rows = await db
    .select()
    .from(atelierEngagementCostToDate)
    .where(isNull(atelierEngagementCostToDate.deletedAt));
  return rows.map(costFromRow);
}
export async function getCost(engagementId: string): Promise<EngagementCostToDate | null> {
  const [row] = await db
    .select()
    .from(atelierEngagementCostToDate)
    .where(eq(atelierEngagementCostToDate.engagementId, engagementId))
    .limit(1);
  return row ? costFromRow(row) : null;
}
export async function listEtcs(): Promise<EngagementEtc[]> {
  const rows = await db
    .select()
    .from(atelierEngagementEtc)
    .where(isNull(atelierEngagementEtc.deletedAt));
  return rows.map(etcFromRow);
}
export async function getEtc(engagementId: string): Promise<EngagementEtc | null> {
  const [row] = await db
    .select()
    .from(atelierEngagementEtc)
    .where(eq(atelierEngagementEtc.engagementId, engagementId))
    .limit(1);
  return row ? etcFromRow(row) : null;
}
export async function listAudit(engagementId?: string, limit = 100): Promise<AuditEntry[]> {
  const base = db.select().from(atelierEngagementPnlAudit);
  const rows = await (engagementId
    ? base.where(eq(atelierEngagementPnlAudit.engagementId, engagementId))
    : base
  )
    .orderBy(desc(atelierEngagementPnlAudit.atIso), desc(atelierEngagementPnlAudit.createdAt))
    .limit(limit);
  return rows.map(auditFromRow);
}
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

async function insertAudit(
  entry: Omit<AuditEntry, "id" | "at"> & { id?: string; at?: string },
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
): Promise<void> {
  await executor.insert(atelierEngagementPnlAudit).values({
    id: entry.id ?? rid("aud"),
    engagementId: entry.engagementId,
    atIso: entry.at ?? nowIso(),
    actorUserId: entry.actorUserId,
    action: entry.action,
    detail: entry.detail,
  });
}

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

export async function applyPostedChangeOrder(args: {
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
}): Promise<ApplyPostedChangeOrderResult> {
  if (APPLIED_POSTED_COS.has(args.changeOrderId)) {
    return { status: "already_applied" };
  }

  return await db.transaction(async (tx) => {
    const budget = await getBudget(args.engagementId);
    if (!budget) return { status: "engagement_unknown" };

    const delta = Number.isFinite(args.valueDeltaUsd) ? args.valueDeltaUsd : 0;
    const newContractValue = budget.contractValueUsd + delta;
    const baselinedAt = args.baselinedAtIso ?? nowIso();

    await tx
      .update(atelierEngagementBudget)
      .set({
        contractValueUsd: newContractValue,
        baselinedAt,
        updatedAt: new Date(),
      })
      .where(eq(atelierEngagementBudget.engagementId, args.engagementId));

    APPLIED_POSTED_COS.add(args.changeOrderId);

    await insertAudit(
      {
        engagementId: args.engagementId,
        at: baselinedAt,
        actorUserId: args.actorUserId,
        action: "change_order.posted",
        detail: `${args.changeOrderId} posted — engagement re-baselined: contract value ${delta >= 0 ? "+" : ""}$${Math.round(delta).toLocaleString()}.`,
      },
      tx,
    );

    return {
      status: "applied",
      budget: { ...budget, contractValueUsd: newContractValue, baselinedAt },
    };
  });
}

export async function setEtc(input: {
  engagementId: string;
  method: EtcMethod;
  manualEtcUsd: number | null;
  rationale: string;
  actorUserId: string;
}): Promise<EngagementEtc | null> {
  const existing = await getEtc(input.engagementId);
  if (!existing) return null;
  const updatedAt = nowIso();
  const manual = input.method === "manual" ? input.manualEtcUsd ?? 0 : null;
  await db
    .update(atelierEngagementEtc)
    .set({
      method: input.method,
      manualEtcUsd: manual,
      rationale: input.rationale,
      updatedAtIso: updatedAt,
      updatedByUserId: input.actorUserId,
      updatedAt: new Date(),
    })
    .where(eq(atelierEngagementEtc.engagementId, input.engagementId));
  await insertAudit({
    id: rid("aud"),
    engagementId: input.engagementId,
    at: updatedAt,
    actorUserId: input.actorUserId,
    action: "etc.updated",
    detail: `ETC updated (${input.method})${input.method === "manual" && input.manualEtcUsd != null ? ` to $${input.manualEtcUsd.toLocaleString()}` : ""}.`,
  });
  return {
    engagementId: input.engagementId,
    method: input.method,
    manualEtcUsd: manual,
    rationale: input.rationale,
    updatedAt,
    updatedByUserId: input.actorUserId,
  };
}
