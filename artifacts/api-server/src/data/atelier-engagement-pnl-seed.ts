/**
 * Atelier — Engagement P&L, EAC and Change-Order data layer (Task #414, Wave 2;
 * persisted in Postgres per Task #430).
 *
 * Originally an in-memory seed; now backed by drizzle tables so that
 * re-baselining (change-order approval) and ETC overrides survive an
 * API server restart. The old demo seed data (SEED_BUDGETS / SEED_COSTS /
 * SEED_ETCS) and the seed-atelier script were removed with the demo-data
 * purge (2026-07-17); this module is now a pure data-access layer.
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

import { and, asc, desc, eq, isNull, like, sql } from "drizzle-orm";
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
  // Task #455 — first-class scope/effort deltas. Null when the
  // requesting persona isn't allowed to see them (mirrors the
  // valueDeltaUsd masking).
  labourHoursDelta: number | null;
  labourCostDeltaUsd: number | null;
  expensesDeltaUsd: number | null;
  subsDeltaUsd: number | null;
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
    // Task #455 — the engagement-pnl CO table doesn't carry the
    // scope/effort deltas (those live on `atelier_change_order`); the
    // EAC engine only needs them via `applyPostedChangeOrder`. Mask
    // them as null so the projection still satisfies the interface.
    labourHoursDelta: null,
    labourCostDeltaUsd: null,
    expensesDeltaUsd: null,
    subsDeltaUsd: null,
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
export async function listBudgets(orgId: string): Promise<EngagementBudget[]> {
  const rows = await db
    .select()
    .from(atelierEngagementBudget)
    .where(and(eq(atelierEngagementBudget.orgId, orgId), isNull(atelierEngagementBudget.deletedAt)));
  return rows.map(budgetFromRow);
}
export async function getBudget(orgId: string, engagementId: string): Promise<EngagementBudget | null> {
  const [row] = await db
    .select()
    .from(atelierEngagementBudget)
    .where(and(eq(atelierEngagementBudget.orgId, orgId), eq(atelierEngagementBudget.engagementId, engagementId), isNull(atelierEngagementBudget.deletedAt)))
    .limit(1);
  return row ? budgetFromRow(row) : null;
}
export async function listCosts(orgId: string): Promise<EngagementCostToDate[]> {
  const rows = await db
    .select()
    .from(atelierEngagementCostToDate)
    .where(and(eq(atelierEngagementCostToDate.orgId, orgId), isNull(atelierEngagementCostToDate.deletedAt)));
  return rows.map(costFromRow);
}
export async function getCost(orgId: string, engagementId: string): Promise<EngagementCostToDate | null> {
  const [row] = await db
    .select()
    .from(atelierEngagementCostToDate)
    .where(and(eq(atelierEngagementCostToDate.orgId, orgId), eq(atelierEngagementCostToDate.engagementId, engagementId), isNull(atelierEngagementCostToDate.deletedAt)))
    .limit(1);
  return row ? costFromRow(row) : null;
}
export async function listEtcs(orgId: string): Promise<EngagementEtc[]> {
  const rows = await db
    .select()
    .from(atelierEngagementEtc)
    .where(and(eq(atelierEngagementEtc.orgId, orgId), isNull(atelierEngagementEtc.deletedAt)));
  return rows.map(etcFromRow);
}
export async function getEtc(orgId: string, engagementId: string): Promise<EngagementEtc | null> {
  const [row] = await db
    .select()
    .from(atelierEngagementEtc)
    .where(and(eq(atelierEngagementEtc.orgId, orgId), eq(atelierEngagementEtc.engagementId, engagementId), isNull(atelierEngagementEtc.deletedAt)))
    .limit(1);
  return row ? etcFromRow(row) : null;
}
export async function listAudit(orgId: string, engagementId?: string, limit = 100): Promise<AuditEntry[]> {
  const base = db.select().from(atelierEngagementPnlAudit);
  const rows = await base.where(
    engagementId
      ? and(eq(atelierEngagementPnlAudit.orgId, orgId), eq(atelierEngagementPnlAudit.engagementId, engagementId))
      : eq(atelierEngagementPnlAudit.orgId, orgId),
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

async function insertAudit(
  entry: Omit<AuditEntry, "id" | "at"> & { id?: string; at?: string; orgId?: string },
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0] = db,
): Promise<void> {
  await executor.insert(atelierEngagementPnlAudit).values({
    id: entry.id ?? rid("aud"),
    orgId: entry.orgId,
    engagementId: entry.engagementId,
    atIso: entry.at ?? nowIso(),
    actorUserId: entry.actorUserId,
    action: entry.action,
    detail: entry.detail,
  });
}

/**
 * Re-baseline an engagement when its change order transitions to `posted`.
 * Adds the value delta to contract value and the labour-hour / labour-cost /
 * expenses / subs deltas (Task #455) to the matching budget lines so the
 * EAC engine forecasts labour cost automatically. BAC is recomputed as
 * labour + expenses + subs.
 *
 * Pushes an audit entry so the per-engagement P&L audit trail captures
 * the rebase. Returns `engagement_unknown` if the engagement is unknown
 * to the in-memory P&L store, OR `already_applied` if this CO has
 * already been folded in (idempotent no-op).
 */
export type ApplyPostedChangeOrderResult =
  | { status: "applied"; budget: EngagementBudget }
  | { status: "already_applied" }
  | { status: "engagement_unknown" };

export async function applyPostedChangeOrder(args: {
  orgId: string;
  engagementId: string;
  changeOrderId: string;
  valueDeltaUsd: number;
  labourHoursDelta?: number;
  labourCostDeltaUsd?: number;
  expensesDeltaUsd?: number;
  subsDeltaUsd?: number;
  actorUserId: string | null;
  /**
   * When true, marks the baseline timestamp with the original posted-at
   * date (passed via `baselinedAtIso`) instead of "now" — used by the
   * boot-time reconciliation pass so the seeded demo doesn't show every
   * engagement as "re-baselined just now".
   */
  baselinedAtIso?: string;
}, executor?: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<ApplyPostedChangeOrderResult> {
  const run = async (
    tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  ): Promise<ApplyPostedChangeOrderResult> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`engagement-budget:${args.orgId}:${args.engagementId}`}))`);
    const [budgetRow] = await tx
      .select()
      .from(atelierEngagementBudget)
      .where(
        and(
          eq(atelierEngagementBudget.engagementId, args.engagementId),
          eq(atelierEngagementBudget.orgId, args.orgId),
          isNull(atelierEngagementBudget.deletedAt),
        ),
      )
      .limit(1);
    if (!budgetRow) return { status: "engagement_unknown" };
    const budget = budgetFromRow(budgetRow);

    // The deterministic audit id is also the durable application receipt.
    // It is inserted in the same transaction as the budget update, so a
    // restart, retry or concurrent poster can never apply the delta twice.
    const applicationId = `coapply_${args.changeOrderId}`;
    // Upgrade compatibility: older successful postings wrote the human-readable
    // `change_order.posted` audit but predate deterministic application receipts.
    // Treat that durable audit as proof the budget delta already landed, and
    // backfill only the receipt. Failed old side effects have no such P&L audit,
    // so a posted→posted repair still applies them exactly once.
    const [legacyApplied] = await tx
      .select({ id: atelierEngagementPnlAudit.id })
      .from(atelierEngagementPnlAudit)
      .where(
        and(
          eq(atelierEngagementPnlAudit.orgId, args.orgId),
          eq(atelierEngagementPnlAudit.engagementId, args.engagementId),
          eq(atelierEngagementPnlAudit.action, "change_order.posted"),
          like(atelierEngagementPnlAudit.detail, `${args.changeOrderId} posted —%`),
        ),
      )
      .limit(1);
    if (legacyApplied) {
      await tx
        .insert(atelierEngagementPnlAudit)
        .values({
          id: applicationId,
          orgId: args.orgId,
          engagementId: args.engagementId,
          atIso: args.baselinedAtIso ?? nowIso(),
          actorUserId: args.actorUserId,
          action: "change_order.application_claimed",
          detail: `${args.changeOrderId} legacy rebaseline application receipt backfilled.`,
        })
        .onConflictDoNothing({ target: atelierEngagementPnlAudit.id });
      return { status: "already_applied" };
    }
    const claimed = await tx
      .insert(atelierEngagementPnlAudit)
      .values({
        id: applicationId,
        orgId: args.orgId,
        engagementId: args.engagementId,
        atIso: args.baselinedAtIso ?? nowIso(),
        actorUserId: args.actorUserId,
        action: "change_order.application_claimed",
        detail: `${args.changeOrderId} rebaseline application receipt.`,
      })
      .onConflictDoNothing({ target: atelierEngagementPnlAudit.id })
      .returning({ id: atelierEngagementPnlAudit.id });
    if (!claimed.length) return { status: "already_applied" };

    const num = (n: number | undefined): number =>
      typeof n === "number" && Number.isFinite(n) ? n : 0;
    const valueDelta = num(args.valueDeltaUsd);
    const hoursDelta = num(args.labourHoursDelta);
    const labourCostDelta = num(args.labourCostDeltaUsd);
    const expensesDelta = num(args.expensesDeltaUsd);
    const subsDelta = num(args.subsDeltaUsd);

    const newContractValue = budget.contractValueUsd + valueDelta;
    const newLabourHours = budget.budgetLabourHours + hoursDelta;
    const newLabourCost = budget.budgetLabourCostUsd + labourCostDelta;
    const newExpenses = budget.budgetExpensesUsd + expensesDelta;
    const newSubs = budget.budgetSubsUsd + subsDelta;
    const newBac = newLabourCost + newExpenses + newSubs;
    const baselinedAt = args.baselinedAtIso ?? nowIso();

    await tx
      .update(atelierEngagementBudget)
      .set({
        contractValueUsd: newContractValue,
        budgetLabourHours: newLabourHours,
        budgetLabourCostUsd: newLabourCost,
        budgetExpensesUsd: newExpenses,
        budgetSubsUsd: newSubs,
        budgetAtCompletionUsd: newBac,
        baselinedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(atelierEngagementBudget.engagementId, args.engagementId), eq(atelierEngagementBudget.orgId, args.orgId), isNull(atelierEngagementBudget.deletedAt)));

    const fmtUsd = (n: number) =>
      `${n >= 0 ? "+" : ""}$${Math.round(n).toLocaleString()}`;
    const fmtHrs = (n: number) =>
      `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}h`;
    const detailParts = [
      `contract value ${fmtUsd(valueDelta)}`,
      `labour ${fmtHrs(hoursDelta)} / ${fmtUsd(labourCostDelta)}`,
      `expenses ${fmtUsd(expensesDelta)}`,
      `subs ${fmtUsd(subsDelta)}`,
    ];
    await insertAudit(
      {
        orgId: args.orgId,
        engagementId: args.engagementId,
        at: baselinedAt,
        actorUserId: args.actorUserId,
        action: "change_order.posted",
        detail: `${args.changeOrderId} posted — engagement re-baselined from contract ${fmtUsd(budget.contractValueUsd)} / BAC ${fmtUsd(budget.budgetAtCompletionUsd)} to contract ${fmtUsd(newContractValue)} / BAC ${fmtUsd(newBac)}: ${detailParts.join("; ")}.`,
      },
      tx,
    );

    return {
      status: "applied",
      budget: {
        ...budget,
        contractValueUsd: newContractValue,
        budgetLabourHours: newLabourHours,
        budgetLabourCostUsd: newLabourCost,
        budgetExpensesUsd: newExpenses,
        budgetSubsUsd: newSubs,
        budgetAtCompletionUsd: newBac,
        baselinedAt,
      },
    };
  };
  return executor ? run(executor) : db.transaction(run);
}

export async function setEtc(input: {
  orgId: string;
  engagementId: string;
  method: EtcMethod;
  manualEtcUsd: number | null;
  rationale: string;
  actorUserId: string;
}): Promise<EngagementEtc | null> {
  const existing = await getEtc(input.orgId, input.engagementId);
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
    .where(and(eq(atelierEngagementEtc.engagementId, input.engagementId), eq(atelierEngagementEtc.orgId, input.orgId)));
  await insertAudit({
    orgId: input.orgId,
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
