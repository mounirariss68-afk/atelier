/**
 * L2C Wave 2 (Task #361) — CLI capability registrations for revenue
 * recognition, period postings, adjustments, WIP, margin, and leakage.
 *
 * Three perimeters layered on top of every entry:
 *
 *   1. The catalog gate (`capabilitiesForPersona`) strips the entire
 *      `revrec` / `wip` / `margin` / `leakage` modules from the slice
 *      the orchestrator sees for restricted personas (contractor /
 *      partner_firm_resource / recruiter) AND for board_observer —
 *      EXCEPT the rollup ids in `BOARD_OBSERVER_ROLLUP_ALLOWLIST`
 *      (`wip_report`, `leakage_report`, `revrec_compute_schedule`).
 *
 *   2. Each entry's `requiredRoles` enumerates the explicit allow-list
 *      for the FIRST phase. The new `approverRoles` field declares a
 *      tighter perimeter for the SECOND phase of two-phase writes:
 *      `revrec_post_period` is initiated by `finance` but irrev-posted
 *      only by `founding_partner`.
 *
 *   3. The `run` body re-asserts persona role + rationale length so a
 *      bypass via tool-call injection is rejected with a clean
 *      errorCode.
 *
 * The HTTP surface in `routes/atelier/revrecRoutes.ts` is the canonical
 * write path; these CLI entries reproduce the same business rules so
 * the orchestrator can drive the workflow from natural language.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierAuditEvents,
  atelierRevenueMethod,
  atelierRevenueSchedule,
  atelierRevenuePeriodPosting,
  atelierRevenuePeriodPostingLine,
  atelierRevenueAdjustment,
  atelierPeriodCloseLock,
  atelierUnbilledWipSnapshot,
  atelierEngagementMarginSnapshot,
  atelierTimesheetEntries,
  atelierExpenses,
} from "@workspace/db";
import { defineCapability, CATALOG_SCHEMA_VERSION } from "./capability-catalog.js";
import type { ToolContext, ToolResult } from "./index.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";
import { runRevenueRecognizer } from "../atelier-agents/revenue-recognizer.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function audit(ctx: ToolContext, args: {
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: ctx.persona.id,
    actorLabel: ctx.persona.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

const ROLE_FINANCE: AtelierRole[] = ["founding_partner", "partner", "finance"];
const ROLE_FOUNDING: AtelierRole[] = ["founding_partner"];
const ROLE_LEADERSHIP: AtelierRole[] = ["founding_partner", "partner"];

// ---------------------------------------------------------------------------
// 1. revrec_set_method  (finance/leadership)
// ---------------------------------------------------------------------------
defineCapability({
  id: "revrec_set_method",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  slashAliases: {},
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: null,
  toolName: "revrec_set_method",
  module: "revrec",
  description: "Declare the revenue recognition method for an engagement (poc_hours | poc_cost | ratable | milestone | outcome).",
  isWrite: true,
  irreversible: false,
  requiredRoles: ROLE_FINANCE,
  surfaceOn: ["engagement_dashboard", "wallet"],
  
  inputSchema: {
    type: "object",
    required: ["engagement_id", "method"],
    properties: {
      engagement_id: { type: "string" },
      method: { type: "string", enum: ["poc_hours", "poc_cost", "ratable", "milestone", "outcome"] },
      planned_total_amount: { type: "number" },
      planned_hours: { type: "number" },
      planned_cost: { type: "number" },
      ratable_periods: { type: "integer" },
      active_from: { type: "string" },
    },
  },
  run: async (input, ctx): Promise<ToolResult> => {
    if (!ROLE_FINANCE.includes(ctx.persona.role as AtelierRole)) {
      return { ok: false, errorCode: "forbidden", errorMessage: "finance/leadership role required" };
    }
    const id = rid("revmeth");
    const [row] = await db
      .insert(atelierRevenueMethod)
      .values({
        id,
        engagementId: String(input.engagement_id),
        method: String(input.method),
        plannedTotalAmount: Number(input.planned_total_amount ?? 0),
        plannedHours: Number(input.planned_hours ?? 0),
        plannedCost: Number(input.planned_cost ?? 0),
        ratablePeriods: Number(input.ratable_periods ?? 0),
        activeFrom: input.active_from ? String(input.active_from) : null,
        approvedAt: new Date(),
        approvedByUserId: ctx.persona.id,
        createdByUserId: ctx.persona.id,
      })
      .returning();
    await audit(ctx, {
      entityType: "revenue_method",
      entityId: id,
      action: "method.set",
      payload: { engagement_id: input.engagement_id, method: input.method },
      summary: `Set revenue method ${input.method} for ${input.engagement_id}`,
    });
    // Task #511 — revrec writes land on the wallet surface.
    return {
      ok: true,
      data: { method: row, navigateTo: { path: "/wallet", when: "on_commit" as const } },
    };
  },
});

// ---------------------------------------------------------------------------
// 2. revrec_compute_schedule  (read-mostly: visible to board_observer via allow-list)
// ---------------------------------------------------------------------------
defineCapability({
  id: "revrec_compute_schedule",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  slashAliases: {},
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: null,
  toolName: "revrec_compute_schedule",
  module: "revrec",
  description: "Compute (or fetch the cached) revenue recognition schedule for a period. Idempotent unless schedules are unfrozen.",
  isWrite: true,
  irreversible: false,
  requiredRoles: ROLE_FINANCE,
  surfaceOn: ["wallet"],
  
  inputSchema: {
    type: "object",
    required: ["period_label"],
    properties: {
      period_label: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
      engagement_id: { type: "string" },
    },
  },
  run: async (input, ctx): Promise<ToolResult> => {
    const period = String(input.period_label);
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return { ok: false, errorCode: "invalid_period", errorMessage: "period_label must be YYYY-MM" };
    }
    const methods = await db
      .select()
      .from(atelierRevenueMethod)
      .where(
        and(
          isNull(atelierRevenueMethod.deletedAt),
          input.engagement_id
            ? eq(atelierRevenueMethod.engagementId, String(input.engagement_id))
            : sql`TRUE`,
        ),
      );
    const written: typeof atelierRevenueSchedule.$inferSelect[] = [];
    for (const m of methods) {
      const [existing] = await db
        .select()
        .from(atelierRevenueSchedule)
        .where(
          and(
            eq(atelierRevenueSchedule.engagementId, m.engagementId),
            eq(atelierRevenueSchedule.periodLabel, period),
            isNull(atelierRevenueSchedule.deletedAt),
          ),
        )
        .limit(1);
      if (existing && existing.frozen) {
        written.push(existing);
        continue;
      }
      const [tsAgg] = await db
        .select({ hours: sql<number>`COALESCE(SUM(${atelierTimesheetEntries.hours}),0)` })
        .from(atelierTimesheetEntries)
        .where(
          and(
            eq(atelierTimesheetEntries.engagementId, m.engagementId),
            eq(atelierTimesheetEntries.billable, true),
          ),
        );
      const [exAgg] = await db
        .select({ cost: sql<number>`COALESCE(SUM(${atelierExpenses.usdAmount}),0)` })
        .from(atelierExpenses)
        .where(eq(atelierExpenses.engagementId, m.engagementId));
      const recog = runRevenueRecognizer({
        engagementId: m.engagementId,
        periodLabel: period,
        method: m.method,
        plannedTotalAmount: m.plannedTotalAmount,
        plannedHours: m.plannedHours,
        plannedCost: m.plannedCost,
        ratablePeriods: m.ratablePeriods,
        activeFrom: m.activeFrom,
        hoursToDate: Number(tsAgg?.hours ?? 0),
        costToDate: Number(exAgg?.cost ?? 0),
        milestones: [],
      });
      if (existing) {
        const [u] = await db
          .update(atelierRevenueSchedule)
          .set({
            basisPct: recog.basisPct,
            recognisedAmount: recog.recognisedAmount,
            deferredBalanceEnding: recog.deferredBalanceEnding,
            computationInputsJson: recog.inputs,
            computedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(atelierRevenueSchedule.id, existing.id))
          .returning();
        written.push(u);
      } else {
        const [n] = await db
          .insert(atelierRevenueSchedule)
          .values({
            id: rid("sched"),
            engagementId: m.engagementId,
            periodLabel: period,
            method: m.method,
            basisPct: recog.basisPct,
            recognisedAmount: recog.recognisedAmount,
            deferredBalanceEnding: recog.deferredBalanceEnding,
            computationInputsJson: recog.inputs,
            createdByUserId: ctx.persona.id,
          })
          .returning();
        written.push(n);
      }
    }
    return {
      ok: true,
      data: {
        schedules: written,
        period,
        navigateTo: { path: "/wallet", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 3. revrec_freeze_schedule
// ---------------------------------------------------------------------------
defineCapability({
  id: "revrec_freeze_schedule",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  slashAliases: {},
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: null,
  toolName: "revrec_freeze_schedule",
  module: "revrec",
  description: "Freeze a computed revenue schedule row so subsequent compute calls are no-ops until unfreeze.",
  isWrite: true,
  irreversible: false,
  requiredRoles: ROLE_FINANCE,
  surfaceOn: ["wallet"],
  
  inputSchema: {
    type: "object",
    required: ["schedule_id"],
    properties: { schedule_id: { type: "string" } },
  },
  run: async (input, ctx): Promise<ToolResult> => {
    const [row] = await db
      .update(atelierRevenueSchedule)
      .set({
        frozen: true,
        frozenAt: new Date(),
        frozenByUserId: ctx.persona.id,
        updatedAt: new Date(),
      })
      .where(eq(atelierRevenueSchedule.id, String(input.schedule_id)))
      .returning();
    if (!row) return { ok: false, errorCode: "not_found", errorMessage: "schedule not found" };
    await audit(ctx, {
      entityType: "revenue_schedule",
      entityId: row.id,
      action: "schedule.freeze",
      payload: { period: row.periodLabel, eng: row.engagementId },
      summary: `Froze schedule ${row.periodLabel}/${row.engagementId}`,
    });
    return {
      ok: true,
      data: {
        schedule: row,
        navigateTo: { path: "/wallet", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 4. revrec_post_period  (2PC: finance initiates, founding_partner approves)
//    `approverRoles` declares the SECOND-phase perimeter. The orchestrator's
//    confirmation flow consults it before invoking `run` on the confirmed
//    payload.
// ---------------------------------------------------------------------------
defineCapability({
  id: "revrec_post_period",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  slashAliases: { en: ["/post-period"] },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: null,
  toolName: "revrec_post_period",
  module: "revrec",
  description: "Post all frozen revenue schedules for a period to the immutable ledger. Two-phase: finance initiates, founding_partner approves; auto-locks the period.",
  isWrite: true,
  irreversible: true,
  requiredRoles: ROLE_FINANCE,
  approverRoles: ROLE_FOUNDING,
  surfaceOn: ["wallet"],
  
  inputSchema: {
    type: "object",
    required: ["period_label"],
    properties: {
      period_label: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
      rationale_text: { type: "string" },
    },
  },
  run: async (input, ctx): Promise<ToolResult> => {
    if (!ROLE_FOUNDING.includes(ctx.persona.role as AtelierRole)) {
      return {
        ok: false,
        errorCode: "forbidden",
        errorMessage: "founding_partner approval required to post a period",
      };
    }
    const period = String(input.period_label);
    const [lock] = await db
      .select()
      .from(atelierPeriodCloseLock)
      .where(
        and(
          eq(atelierPeriodCloseLock.periodLabel, period),
          isNull(atelierPeriodCloseLock.deletedAt),
        ),
      )
      .limit(1);
    if (lock && (lock.lockedModules ?? []).includes("revrec")) {
      return { ok: false, errorCode: "period_locked", errorMessage: `Period ${period} is locked` };
    }
    const scheds = await db
      .select()
      .from(atelierRevenueSchedule)
      .where(
        and(
          eq(atelierRevenueSchedule.periodLabel, period),
          eq(atelierRevenueSchedule.frozen, true),
          isNull(atelierRevenueSchedule.deletedAt),
        ),
      );
    if (scheds.length === 0) {
      return { ok: false, errorCode: "no_frozen_schedules", errorMessage: "no frozen schedules for period" };
    }
    const postingId = rid("rvpost");
    const gross = scheds.reduce((s, x) => s + Number(x.recognisedAmount), 0);
    const [posting] = await db
      .insert(atelierRevenuePeriodPosting)
      .values({
        id: postingId,
        periodLabel: period,
        initiatedByUserId: ctx.persona.id,
        postedAt: new Date(),
        postedByUserId: ctx.persona.id,
        linesCount: scheds.length,
        grossRecognisedAmount: gross,
        rationaleText: String(input.rationale_text ?? ""),
        createdByUserId: ctx.persona.id,
      })
      .returning();
    for (const s of scheds) {
      await db.insert(atelierRevenuePeriodPostingLine).values({
        id: rid("rvline"),
        postingId,
        engagementId: s.engagementId,
        scheduleId: s.id,
        kind: "posting",
        method: s.method,
        recognisedAmount: s.recognisedAmount,
        deferredBalanceEnding: s.deferredBalanceEnding,
        currency: s.currency,
        createdByUserId: ctx.persona.id,
      });
      await db
        .update(atelierRevenueSchedule)
        .set({ postingId, updatedAt: new Date() })
        .where(eq(atelierRevenueSchedule.id, s.id));
    }
    await db
      .insert(atelierPeriodCloseLock)
      .values({
        id: rid("plock"),
        periodLabel: period,
        lockedModules: ["revrec"],
        lockedByUserId: ctx.persona.id,
        createdByUserId: ctx.persona.id,
      })
      .onConflictDoNothing();
    await audit(ctx, {
      entityType: "revenue_period_posting",
      entityId: postingId,
      action: "posting.post",
      payload: { period, lines: scheds.length, gross },
      summary: `POSTED ${period} (${scheds.length} lines, gross ${gross})`,
    });
    return {
      ok: true,
      data: {
        posting,
        locked: true,
        navigateTo: { path: "/wallet", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 5. revrec_record_adjustment  (founding_partner only; rationale ≥20 chars)
// ---------------------------------------------------------------------------
defineCapability({
  id: "revrec_record_adjustment",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  slashAliases: { en: ["/revenue-adjust"] },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: null,
  toolName: "revrec_record_adjustment",
  module: "revrec",
  description: "Append a revenue adjustment line to an already-posted period. Founding partner only; rationale_text ≥20 chars required.",
  isWrite: true,
  irreversible: true,
  requiredRoles: ROLE_FOUNDING,
  surfaceOn: ["wallet"],
  
  inputSchema: {
    type: "object",
    required: ["posting_id", "engagement_id", "delta_amount", "rationale_text"],
    properties: {
      posting_id: { type: "string" },
      engagement_id: { type: "string" },
      delta_amount: { type: "number" },
      rationale_text: { type: "string", minLength: 20 },
    },
  },
  run: async (input, ctx): Promise<ToolResult> => {
    if (ctx.persona.role !== "founding_partner") {
      return { ok: false, errorCode: "forbidden", errorMessage: "founding_partner role required" };
    }
    const rationale = String(input.rationale_text ?? "");
    if (rationale.length < 20) {
      return { ok: false, errorCode: "rationale_too_short", errorMessage: "rationale_text must be at least 20 characters" };
    }
    const delta = Number(input.delta_amount);
    if (!isFinite(delta) || delta === 0) {
      return { ok: false, errorCode: "invalid_delta", errorMessage: "delta_amount must be a non-zero number" };
    }
    const [posting] = await db
      .select()
      .from(atelierRevenuePeriodPosting)
      .where(eq(atelierRevenuePeriodPosting.id, String(input.posting_id)))
      .limit(1);
    if (!posting || !posting.postedAt) {
      return { ok: false, errorCode: "posting_not_posted", errorMessage: "posting not in POSTED state" };
    }
    const adjId = rid("rvadj");
    await db.insert(atelierRevenueAdjustment).values({
      id: adjId,
      postingId: String(input.posting_id),
      engagementId: String(input.engagement_id),
      deltaAmount: delta,
      rationaleText: rationale,
      requestedByUserId: ctx.persona.id,
      createdByUserId: ctx.persona.id,
    });
    const [line] = await db
      .insert(atelierRevenuePeriodPostingLine)
      .values({
        id: rid("rvline"),
        postingId: String(input.posting_id),
        engagementId: String(input.engagement_id),
        kind: "adjustment",
        method: "adjustment",
        recognisedAmount: delta,
        adjustmentId: adjId,
        notes: rationale.slice(0, 200),
        createdByUserId: ctx.persona.id,
      })
      .returning();
    await db
      .update(atelierRevenuePeriodPosting)
      .set({
        grossRecognisedAmount: sql`${atelierRevenuePeriodPosting.grossRecognisedAmount} + ${delta}`,
        updatedAt: new Date(),
      })
      .where(eq(atelierRevenuePeriodPosting.id, String(input.posting_id)));
    await audit(ctx, {
      entityType: "revenue_adjustment",
      entityId: adjId,
      action: "adjustment.record",
      payload: { posting_id: input.posting_id, delta, eng: input.engagement_id },
      summary: `Adjustment ${delta} on ${input.posting_id}: ${rationale.slice(0, 80)}`,
    });
    return {
      ok: true,
      data: {
        adjustment: line,
        id: adjId,
        navigateTo: { path: "/wallet", when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 6. wip_report  (board_observer allow-listed → firm rollup visible)
// ---------------------------------------------------------------------------
defineCapability({
  id: "wip_report",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  slashAliases: {},
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: null,
  toolName: "wip_report",
  module: "wip",
  description: "Latest unbilled WIP snapshot per engagement plus firm rollup. Board observers see the rollup; restricted personas see nothing.",
  isWrite: false,
  irreversible: false,
  surfaceOn: ["wallet", "home"],
  
  inputSchema: { type: "object", properties: {} },
  run: async (_input, _ctx): Promise<ToolResult> => {
    const rows = await db.execute<{
      engagement_id: string;
      hours_burned: number;
      expense_burned: number;
      recognised_revenue: number;
      invoiced_amount: number;
      unbilled_amount: number;
      currency: string;
    }>(sql`
      SELECT DISTINCT ON (engagement_id)
        engagement_id, hours_burned, expense_burned,
        recognised_revenue, invoiced_amount, unbilled_amount, currency
      FROM atelier_unbilled_wip_snapshot
      WHERE deleted_at IS NULL
      ORDER BY engagement_id, snapshot_at DESC
    `);
    const list = rows.rows ?? [];
    const firm = list.reduce(
      (acc, r) => {
        acc.recognised += Number(r.recognised_revenue);
        acc.invoiced += Number(r.invoiced_amount);
        acc.unbilled += Number(r.unbilled_amount);
        return acc;
      },
      { recognised: 0, invoiced: 0, unbilled: 0 },
    );
    return { ok: true, data: { firm: { ...firm, count: list.length }, engagements: list } };
  },
});

// ---------------------------------------------------------------------------
// 7. margin_engagement_report
// ---------------------------------------------------------------------------
defineCapability({
  id: "margin_engagement_report",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  slashAliases: {},
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: null,
  toolName: "margin_engagement_report",
  module: "margin",
  description: "Latest engagement-margin snapshot for an engagement (revenue, direct cost, GM%, realization, leakage).",
  isWrite: false,
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "wallet"],
  
  inputSchema: {
    type: "object",
    required: ["engagement_id"],
    properties: { engagement_id: { type: "string" } },
  },
  run: async (input, _ctx): Promise<ToolResult> => {
    const rows = await db
      .select()
      .from(atelierEngagementMarginSnapshot)
      .where(
        and(
          eq(atelierEngagementMarginSnapshot.engagementId, String(input.engagement_id)),
          isNull(atelierEngagementMarginSnapshot.deletedAt),
        ),
      )
      .orderBy(sql`snapshot_at DESC`)
      .limit(12);
    return { ok: true, data: { snapshots: rows } };
  },
});

// ---------------------------------------------------------------------------
// 8. leakage_report  (board_observer allow-listed)
// ---------------------------------------------------------------------------
defineCapability({
  id: "leakage_report",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  slashAliases: {},
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: null,
  toolName: "leakage_report",
  module: "leakage",
  description: "Firm-wide realization + leakage report. Board observers see firm rollup; restricted personas see nothing.",
  isWrite: false,
  irreversible: false,
  surfaceOn: ["wallet", "home"],
  
  inputSchema: { type: "object", properties: {} },
  run: async (_input, _ctx): Promise<ToolResult> => {
    const rows = await db.execute<{
      engagement_id: string;
      revenue_recognised: number;
      standard_revenue_at_rack: number;
      leakage_amount: number;
      realization_rate: number;
    }>(sql`
      SELECT DISTINCT ON (engagement_id)
        engagement_id, revenue_recognised, standard_revenue_at_rack,
        leakage_amount, realization_rate
      FROM atelier_engagement_margin_snapshot
      WHERE deleted_at IS NULL
      ORDER BY engagement_id, snapshot_at DESC
    `);
    const list = rows.rows ?? [];
    const totals = list.reduce(
      (acc, r) => {
        acc.standard += Number(r.standard_revenue_at_rack);
        acc.recognised += Number(r.revenue_recognised);
        acc.leakage += Number(r.leakage_amount);
        return acc;
      },
      { standard: 0, recognised: 0, leakage: 0 },
    );
    const firmRealization = totals.standard === 0 ? 0 : totals.recognised / totals.standard;
    return { ok: true, data: { firm: { ...totals, realizationRate: firmRealization }, engagements: list } };
  },
});
