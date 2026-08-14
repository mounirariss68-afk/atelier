/**
 * Atelier — L2C Wave 2: Revenue recognition, period postings,
 * adjustments, WIP snapshots, engagement margin, leakage.
 * (Task #361 in `.local/tasks/l2c-wave-2-revrec-wip-margin.md`.)
 *
 * All routes are mounted under `/api/atelier`. RLS is enforced via
 * `withRls(req, ...)`; persona role gates are enforced in-handler
 * before the DB layer is touched.
 *
 * Wave-2 hinge: the `client_accepted` milestone transition can ONLY
 * fire when a row exists in `atelier_milestone_acceptance_view` for
 * the same engagement+milestone (server-side check, not client-side).
 *
 * Posted period immutability: once `atelier_revenue_period_posting`
 * has `posted_at` non-null AND a matching `atelier_period_close_lock`
 * row exists, further posts are denied. The only mutation path is
 * `revrec_record_adjustment` (founding_partner only, requires
 * rationale_text), which writes a NEW posting line with
 * `kind = 'adjustment'` to the same posting — original lines stay
 * intact (append-only).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierAuditEvents,
  atelierRevenueMethod,
  atelierRevenueMilestone,
  atelierRevenueSchedule,
  atelierRevenuePeriodPosting,
  atelierRevenuePeriodPostingLine,
  atelierRevenueAdjustment,
  atelierPeriodCloseLock,
  atelierUnbilledWipSnapshot,
  atelierEngagementMarginSnapshot,
  atelierWipSnapshotRunLog,
  atelierEngagements,
  atelierTimesheetEntries,
  atelierExpenses,
} from "@workspace/db";
import { withRls } from "./rls";
import {
  isLeadership,
  isFinance,
  isFoundingPartner,
  isRestrictedPersona,
  isBoardObserver,
} from "./personaRoles";
import { runRevenueRecognizer } from "../../lib/atelier-agents/revenue-recognizer";
import { runAgentExclusive } from "../../lib/atelier-agents/exclusive-runs";

const router: IRouter = Router();

const STANDARD_HOURLY_RATE_USD = 300;
const DEFAULT_DIRECT_COST_PER_HOUR_USD = 150;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response) {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function canRead(role: string | null | undefined): boolean {
  return !!role && !isRestrictedPersona(role) && !isBoardObserver(role);
}

function canReadRollup(role: string | null | undefined): boolean {
  // Firm-wide rollups are visible to non-restricted personas + board_observer.
  return !!role && !isRestrictedPersona(role);
}

function canWriteFinance(role: string | null | undefined): boolean {
  return isFinance(role) || isLeadership(role);
}

async function audit(
  actorId: string,
  actorLabel: string,
  args: {
    entityType: string;
    entityId: string;
    action: string;
    payload: Record<string, unknown>;
    summary: string;
  },
): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId,
    actorLabel,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ===========================================================================
// REVENUE METHOD
// ===========================================================================

const SetMethodSchema = z.object({
  engagementId: z.string().min(1),
  method: z.enum(["poc_hours", "poc_cost", "ratable", "milestone", "outcome"]),
  basis: z.string().optional().default(""),
  currency: z.string().optional().default("USD"),
  plannedTotalAmount: z.number().nonnegative().optional().default(0),
  plannedHours: z.number().nonnegative().optional().default(0),
  plannedCost: z.number().nonnegative().optional().default(0),
  ratablePeriods: z.number().int().nonnegative().optional().default(0),
  activeFrom: z.string().optional(),
  activeTo: z.string().optional(),
  notes: z.string().optional().default(""),
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/revrec/methods", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-read-denied" });
    return;
  }
  const engagementId = req.query.engagementId
    ? String(req.query.engagementId)
    : null;
  const rows = await withRls(req, async (tx) => {
    const conds = [isNull(atelierRevenueMethod.deletedAt)];
    if (engagementId)
      conds.push(eq(atelierRevenueMethod.engagementId, engagementId));
    return tx
      .select()
      .from(atelierRevenueMethod)
      .where(and(...conds))
      .orderBy(desc(atelierRevenueMethod.createdAt))
      .limit(200);
  });
  res.json({ methods: rows });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/methods", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteFinance(me.role)) {
    res.status(403).json({ error: "revrec-method-write-denied" });
    return;
  }
  const parsed = SetMethodSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-input", details: parsed.error.flatten() });
    return;
  }
  const id = rid("revmeth");
  const row = await withRls(req, async (tx) => {
    const [r] = await tx
      .insert(atelierRevenueMethod)
      .values({
        id,
        engagementId: parsed.data.engagementId,
        method: parsed.data.method,
        basis: parsed.data.basis ?? "",
        currency: parsed.data.currency ?? "USD",
        plannedTotalAmount: parsed.data.plannedTotalAmount ?? 0,
        plannedHours: parsed.data.plannedHours ?? 0,
        plannedCost: parsed.data.plannedCost ?? 0,
        ratablePeriods: parsed.data.ratablePeriods ?? 0,
        activeFrom: parsed.data.activeFrom ?? null,
        activeTo: parsed.data.activeTo ?? null,
        approvedAt: new Date(),
        approvedByUserId: me.id,
        notes: parsed.data.notes ?? "",
        createdByUserId: me.id,
      })
      .returning();
    return r;
  });
  await audit(me.id, me.name, {
    entityType: "revenue_method",
    entityId: id,
    action: "method.set",
    payload: { engagementId: parsed.data.engagementId, method: parsed.data.method },
    summary: `Set ${parsed.data.method} for ${parsed.data.engagementId}`,
  });
  res.status(201).json({ method: row });
});

// ===========================================================================
// REVENUE MILESTONE — state machine
//   pending → claimed → partner_attested → client_accepted → earned → invoiceable
// ===========================================================================

const CreateMilestoneSchema = z.object({
  engagementId: z.string().min(1),
  sequence: z.number().int().min(0),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  plannedDate: z.string().optional(),
  plannedAmount: z.number().nonnegative().optional().default(0),
  contractClauseId: z.string().optional(),
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/revrec/milestones", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-read-denied" });
    return;
  }
  const engagementId = req.query.engagementId
    ? String(req.query.engagementId)
    : null;
  const rows = await withRls(req, async (tx) => {
    const conds = [isNull(atelierRevenueMilestone.deletedAt)];
    if (engagementId)
      conds.push(eq(atelierRevenueMilestone.engagementId, engagementId));
    return tx
      .select()
      .from(atelierRevenueMilestone)
      .where(and(...conds))
      .orderBy(atelierRevenueMilestone.sequence)
      .limit(500);
  });
  res.json({ milestones: rows });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/milestones", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-write-denied" });
    return;
  }
  const parsed = CreateMilestoneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-input", details: parsed.error.flatten() });
    return;
  }
  const id = rid("revms");
  const row = await withRls(req, async (tx) => {
    const [r] = await tx
      .insert(atelierRevenueMilestone)
      .values({
        id,
        engagementId: parsed.data.engagementId,
        sequence: parsed.data.sequence,
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        plannedDate: parsed.data.plannedDate ?? null,
        plannedAmount: parsed.data.plannedAmount ?? 0,
        contractClauseId: parsed.data.contractClauseId ?? null,
        createdByUserId: me.id,
      })
      .returning();
    return r;
  });
  await audit(me.id, me.name, {
    entityType: "revenue_milestone",
    entityId: id,
    action: "milestone.create",
    payload: { engagementId: parsed.data.engagementId, name: parsed.data.name },
    summary: `Declared milestone ${parsed.data.name}`,
  });
  res.status(201).json({ milestone: row });
});

// State transitions.
async function transitionMilestone(
  req: Request,
  res: Response,
  newStatus: string,
  setExtra: Record<string, unknown>,
  allowedFrom: string[],
  validator?: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    row: typeof atelierRevenueMilestone.$inferSelect,
  ) => Promise<{ ok: boolean; errorCode?: string; errorMessage?: string }>,
): Promise<void> {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-write-denied" });
    return;
  }
  const id = String(req.params.id);
  const result = await withRls(req, async (tx) => {
    const [row] = await tx
      .select()
      .from(atelierRevenueMilestone)
      .where(
        and(
          eq(atelierRevenueMilestone.id, id),
          isNull(atelierRevenueMilestone.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return { error: "not-found" as const };
    if (!allowedFrom.includes(row.status)) {
      return { error: "bad-state" as const, status: row.status };
    }
    if (validator) {
      const v = await validator(tx, row);
      if (!v.ok)
        return {
          error: "blocked" as const,
          errorCode: v.errorCode,
          errorMessage: v.errorMessage,
        };
    }
    const [updated] = await tx
      .update(atelierRevenueMilestone)
      .set({ status: newStatus, updatedAt: new Date(), ...setExtra })
      .where(eq(atelierRevenueMilestone.id, id))
      .returning();
    return { row: updated };
  });
  if ("error" in result) {
    if (result.error === "not-found") {
      res.status(404).json({ error: "milestone-not-found" });
      return;
    }
    if (result.error === "bad-state") {
      res
        .status(409)
        .json({ error: "milestone-bad-state", status: result.status, expected: allowedFrom });
      return;
    }
    res.status(409).json({
      error: result.errorCode ?? "milestone-blocked",
      message: result.errorMessage ?? "transition blocked",
    });
    return;
  }
  await audit(me.id, me.name, {
    entityType: "revenue_milestone",
    entityId: id,
    action: `milestone.${newStatus}`,
    payload: { from: result.row.status, to: newStatus },
    summary: `Milestone → ${newStatus}`,
  });
  res.json({ milestone: result.row });
}

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/milestones/:id/claim", (req, res) =>
  transitionMilestone(
    req,
    res,
    "claimed",
    { claimedAt: new Date(), claimedByUserId: req.atelierPersona?.id ?? null },
    ["pending"],
  ),
);

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/milestones/:id/partner-attest", (req, res) => {
  if (!isLeadership(req.atelierPersona?.role)) {
    res.status(403).json({ error: "leadership-required" });
    return;
  }
  return transitionMilestone(
    req,
    res,
    "partner_attested",
    {
      partnerAttestedAt: new Date(),
      partnerAttestedByUserId: req.atelierPersona?.id ?? null,
    },
    ["claimed"],
  );
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/milestones/:id/client-accept", (req, res) =>
  // Critical contract: the client_accepted transition can only fire if a
  // matching `atelier_milestone_acceptance_view` row exists. Server-side
  // check inside the same transaction.
  transitionMilestone(
    req,
    res,
    "client_accepted",
    { clientAcceptedAt: new Date() },
    ["partner_attested"],
    async (tx, row) => {
      const acc = await tx.execute<{ acceptance_id: string }>(sql`
        SELECT acceptance_id FROM atelier_milestone_acceptance_view
        WHERE engagement_id = ${row.engagementId}
          AND milestone_id = ${row.id}
        LIMIT 1
      `);
      const matched = acc.rows?.[0];
      if (!matched) {
        return {
          ok: false,
          errorCode: "missing-deliverable-acceptance",
          errorMessage:
            "client_accepted requires a deliverable acceptance with status='client_signed' bound to this milestone",
        };
      }
      // Bind the acceptance id back onto the milestone row.
      await tx
        .update(atelierRevenueMilestone)
        .set({ deliverableAcceptanceId: matched.acceptance_id })
        .where(eq(atelierRevenueMilestone.id, row.id));
      return { ok: true };
    },
  ),
);

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/milestones/:id/earn", (req, res) => {
  if (!canWriteFinance(req.atelierPersona?.role)) {
    res.status(403).json({ error: "finance-required" });
    return;
  }
  return transitionMilestone(
    req,
    res,
    "earned",
    { earnedAt: new Date() },
    ["client_accepted"],
  );
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/milestones/:id/mark-invoiceable", async (req, res) => {
  if (!canWriteFinance(req.atelierPersona?.role)) {
    res.status(403).json({ error: "finance-required" });
    return;
  }
  await transitionMilestone(
    req,
    res,
    "invoiceable",
    { invoiceableAt: new Date() },
    ["earned"],
  );
  // Task #429 — milestone-event billing run: when a milestone becomes
  // invoiceable, fire the Billing Orchestrator for that engagement
  // (fire-and-forget; the transition response is already sent). The
  // engine's idempotency keys make a duplicate run harmless.
  if (res.statusCode < 300) {
    try {
      const [ms] = await db
        .select({ engagementId: atelierRevenueMilestone.engagementId, orgId: atelierRevenueMilestone.orgId })
        .from(atelierRevenueMilestone)
        .where(eq(atelierRevenueMilestone.id, req.params.id));
      if (ms) {
        void import("../../lib/atelier-agents/billing-orchestrator.js")
          .then(({ runBillingOrchestrator }) =>
            runBillingOrchestrator({
              orgId: ms.orgId,
              input: { engagementId: ms.engagementId, source: "milestone_event" },
              triggeredByUserId: req.atelierPersona?.id ?? null,
            }),
          )
          .catch((err) => {
            console.error("[billing-orchestrator] milestone-event run failed", err);
          });
      }
    } catch (err) {
      console.error("[billing-orchestrator] milestone-event hook failed", err);
    }
  }
});

// ===========================================================================
// REVENUE SCHEDULE — compute (Recognizer agent), freeze
// ===========================================================================

const ComputeSchedSchema = z.object({
  periodLabel: z.string().regex(/^\d{4}-\d{2}$/),
  engagementId: z.string().optional(), // omit ⇒ compute for all eligible engagements
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/schedules/compute", async (req: Request, res: Response) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteFinance(me.role)) {
    res.status(403).json({ error: "revrec-compute-denied" });
    return;
  }
  const parsed = ComputeSchedSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-input", details: parsed.error.flatten() });
    return;
  }
  // Task #1105 — single-flight through the SHARED per-agent lock the cron
  // Revenue Recognizer also uses. This manual compute and the scheduled
  // org-wide run both write atelier_revenue_schedule, so they must be
  // mutually exclusive; a concurrent trigger returns 409.
  const ex = await runAgentExclusive({
    agent: "revenue_recognizer", orgId: me.orgId, userId: me.id,
    label: `Revenue Recognizer — manual compute ${parsed.data.periodLabel}`, resultHref: "/finance/revrec",
    work: () => withRls(req, async (tx) => {
    const methods = await tx
      .select()
      .from(atelierRevenueMethod)
      .where(
        and(
          isNull(atelierRevenueMethod.deletedAt),
          parsed.data.engagementId
            ? eq(atelierRevenueMethod.engagementId, parsed.data.engagementId)
            : sql`TRUE`,
        ),
      );
    const written: typeof atelierRevenueSchedule.$inferSelect[] = [];
    for (const m of methods) {
      // Idempotence: skip if a frozen schedule already exists for this period+engagement.
      const [existing] = await tx
        .select()
        .from(atelierRevenueSchedule)
        .where(
          and(
            eq(atelierRevenueSchedule.engagementId, m.engagementId),
            eq(atelierRevenueSchedule.periodLabel, parsed.data.periodLabel),
            isNull(atelierRevenueSchedule.deletedAt),
          ),
        )
        .limit(1);
      if (existing && existing.frozen) {
        written.push(existing);
        continue;
      }
      // Gather inputs deterministically.
      const tsRows = await tx
        .select({
          hours: sql<number>`COALESCE(SUM(${atelierTimesheetEntries.hours}), 0)`,
        })
        .from(atelierTimesheetEntries)
        .where(
          and(
            eq(atelierTimesheetEntries.engagementId, m.engagementId),
            eq(atelierTimesheetEntries.billable, true),
            sql`substr(${atelierTimesheetEntries.workDate}, 1, 7) <= ${parsed.data.periodLabel}`,
          ),
        );
      const expRows = await tx
        .select({
          cost: sql<number>`COALESCE(SUM(${atelierExpenses.usdAmount}), 0)`,
        })
        .from(atelierExpenses)
        .where(
          and(
            eq(atelierExpenses.engagementId, m.engagementId),
            sql`substr(${atelierExpenses.expenseDate}, 1, 7) <= ${parsed.data.periodLabel}`,
          ),
        );
      const milestonesEarned = await tx
        .select()
        .from(atelierRevenueMilestone)
        .where(
          and(
            eq(atelierRevenueMilestone.engagementId, m.engagementId),
            isNull(atelierRevenueMilestone.deletedAt),
          ),
        );
      const recog = runRevenueRecognizer({
        engagementId: m.engagementId,
        periodLabel: parsed.data.periodLabel,
        method: m.method,
        plannedTotalAmount: m.plannedTotalAmount,
        plannedHours: m.plannedHours,
        plannedCost: m.plannedCost,
        ratablePeriods: m.ratablePeriods,
        activeFrom: m.activeFrom,
        hoursToDate: Number(tsRows[0]?.hours ?? 0),
        costToDate: Number(expRows[0]?.cost ?? 0),
        milestones: milestonesEarned.map((x) => ({
          id: x.id,
          status: x.status,
          plannedAmount: x.plannedAmount,
          earnedAmount: x.earnedAmount,
        })),
      });
      const id = existing?.id ?? rid("sched");
      if (existing) {
        const [u] = await tx
          .update(atelierRevenueSchedule)
          .set({
            method: m.method,
            basisPct: recog.basisPct,
            recognisedAmount: recog.recognisedAmount,
            deferredBalanceEnding: recog.deferredBalanceEnding,
            currency: m.currency,
            computationInputsJson: recog.inputs,
            computedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(atelierRevenueSchedule.id, existing.id))
          .returning();
        written.push(u);
      } else {
        const [n] = await tx
          .insert(atelierRevenueSchedule)
          .values({
            id,
            engagementId: m.engagementId,
            periodLabel: parsed.data.periodLabel,
            method: m.method,
            basisPct: recog.basisPct,
            recognisedAmount: recog.recognisedAmount,
            deferredBalanceEnding: recog.deferredBalanceEnding,
            currency: m.currency,
            computationInputsJson: recog.inputs,
            createdByUserId: me.id,
          })
          .returning();
        written.push(n);
      }
    }
    return written;
    }),
  });
  if (!ex.ran) {
    res.status(409).json({ error: "already_running", message: "A Revenue Recognizer run is already in progress — try again once it finishes." });
    return;
  }
  const out = ex.result;
  await audit(me.id, me.name, {
    entityType: "revenue_schedule",
    entityId: parsed.data.periodLabel,
    action: "schedule.compute",
    payload: { period: parsed.data.periodLabel, count: out.length },
    summary: `Computed ${out.length} schedule rows for ${parsed.data.periodLabel}`,
  });
  res.json({ schedules: out, period: parsed.data.periodLabel });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/schedules/:id/freeze", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteFinance(me.role)) {
    res.status(403).json({ error: "finance-required" });
    return;
  }
  const out = await withRls(req, async (tx) => {
    const [u] = await tx
      .update(atelierRevenueSchedule)
      .set({
        frozen: true,
        frozenAt: new Date(),
        frozenByUserId: me.id,
        updatedAt: new Date(),
      })
      .where(eq(atelierRevenueSchedule.id, req.params.id))
      .returning();
    return u;
  });
  if (!out) {
    res.status(404).json({ error: "schedule-not-found" });
    return;
  }
  await audit(me.id, me.name, {
    entityType: "revenue_schedule",
    entityId: req.params.id,
    action: "schedule.freeze",
    payload: { period: out.periodLabel, eng: out.engagementId },
    summary: `Froze schedule for ${out.periodLabel}/${out.engagementId}`,
  });
  res.json({ schedule: out });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/revrec/schedules", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-read-denied" });
    return;
  }
  const periodLabel = req.query.periodLabel ? String(req.query.periodLabel) : null;
  const engagementId = req.query.engagementId ? String(req.query.engagementId) : null;
  const rows = await withRls(req, async (tx) => {
    const conds = [isNull(atelierRevenueSchedule.deletedAt)];
    if (periodLabel) conds.push(eq(atelierRevenueSchedule.periodLabel, periodLabel));
    if (engagementId) conds.push(eq(atelierRevenueSchedule.engagementId, engagementId));
    return tx
      .select()
      .from(atelierRevenueSchedule)
      .where(and(...conds))
      .orderBy(desc(atelierRevenueSchedule.periodLabel))
      .limit(500);
  });
  res.json({ schedules: rows });
});

// ===========================================================================
// PERIOD POSTING — 2PC: initiate (finance) + confirm post (founding_partner)
// ===========================================================================

const InitPostingSchema = z.object({
  periodLabel: z.string().regex(/^\d{4}-\d{2}$/),
  rationaleText: z.string().optional().default(""),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/period-postings", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteFinance(me.role)) {
    res.status(403).json({ error: "finance-required" });
    return;
  }
  const parsed = InitPostingSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-input", details: parsed.error.flatten() });
    return;
  }
  const out = await withRls(req, async (tx) => {
    // Lock check.
    const [lock] = await tx
      .select()
      .from(atelierPeriodCloseLock)
      .where(
        and(
          eq(atelierPeriodCloseLock.periodLabel, parsed.data.periodLabel),
          isNull(atelierPeriodCloseLock.deletedAt),
        ),
      )
      .limit(1);
    if (lock && (lock.lockedModules ?? []).includes("revrec")) {
      return { error: "period-locked" as const };
    }
    // Existing posted header? Refuse re-init.
    const [existingPosted] = await tx
      .select()
      .from(atelierRevenuePeriodPosting)
      .where(
        and(
          eq(atelierRevenuePeriodPosting.periodLabel, parsed.data.periodLabel),
          isNull(atelierRevenuePeriodPosting.deletedAt),
        ),
      )
      .limit(1);
    if (existingPosted && existingPosted.postedAt) {
      return { error: "already-posted" as const };
    }
    // Gather frozen schedules for the period.
    const scheds = await tx
      .select()
      .from(atelierRevenueSchedule)
      .where(
        and(
          eq(atelierRevenueSchedule.periodLabel, parsed.data.periodLabel),
          eq(atelierRevenueSchedule.frozen, true),
          isNull(atelierRevenueSchedule.deletedAt),
        ),
      );
    if (scheds.length === 0) {
      return { error: "no-frozen-schedules" as const };
    }
    const id = existingPosted?.id ?? rid("rvpost");
    const gross = scheds.reduce((s, x) => s + Number(x.recognisedAmount), 0);
    if (existingPosted) {
      const [u] = await tx
        .update(atelierRevenuePeriodPosting)
        .set({
          linesCount: scheds.length,
          grossRecognisedAmount: gross,
          rationaleText: parsed.data.rationaleText ?? "",
          updatedAt: new Date(),
        })
        .where(eq(atelierRevenuePeriodPosting.id, existingPosted.id))
        .returning();
      return { posting: u, scheds, isNew: false as const };
    }
    const [n] = await tx
      .insert(atelierRevenuePeriodPosting)
      .values({
        id,
        periodLabel: parsed.data.periodLabel,
        initiatedByUserId: me.id,
        linesCount: scheds.length,
        grossRecognisedAmount: gross,
        rationaleText: parsed.data.rationaleText ?? "",
        createdByUserId: me.id,
      })
      .returning();
    return { posting: n, scheds, isNew: true as const };
  });
  if ("error" in out) {
    res.status(409).json({ error: out.error });
    return;
  }
  await audit(me.id, me.name, {
    entityType: "revenue_period_posting",
    entityId: out.posting.id,
    action: "posting.initiate",
    payload: { period: parsed.data.periodLabel, lines: out.scheds.length },
    summary: `Initiated posting for ${parsed.data.periodLabel} (${out.scheds.length} lines, awaits founding_partner)`,
  });
  res.status(202).json({
    posting: out.posting,
    requiresApproval: true,
    approverRoles: ["founding_partner"],
    confirmationToken: out.posting.id,
  });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/period-postings/:id/confirm-post", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFoundingPartner(me.role)) {
    res.status(403).json({ error: "founding-partner-required" });
    return;
  }
  const out = await withRls(req, async (tx) => {
    // Race-safety: lock the posting header row for the duration of the
    // transaction so two concurrent confirms cannot both pass the
    // postedAt precheck and double-append posting lines.
    const lockedRows = await tx.execute(
      sql`SELECT * FROM atelier_revenue_period_posting
          WHERE id = ${String(req.params.id)} AND deleted_at IS NULL
          FOR UPDATE`,
    );
    const lockedRow = (lockedRows as { rows?: Array<Record<string, unknown>> }).rows?.[0]
      ?? (Array.isArray(lockedRows) ? (lockedRows as Array<Record<string, unknown>>)[0] : undefined);
    if (!lockedRow) return { error: "not-found" as const };
    if (lockedRow["posted_at"] != null) return { error: "already-posted" as const };
    const [posting] = await tx
      .select()
      .from(atelierRevenuePeriodPosting)
      .where(
        and(
          eq(atelierRevenuePeriodPosting.id, String(req.params.id)),
          isNull(atelierRevenuePeriodPosting.deletedAt),
        ),
      )
      .limit(1);
    if (!posting) return { error: "not-found" as const };
    if (posting.postedAt) return { error: "already-posted" as const };
    // Re-check lock (defence in depth).
    const [lock] = await tx
      .select()
      .from(atelierPeriodCloseLock)
      .where(
        and(
          eq(atelierPeriodCloseLock.periodLabel, posting.periodLabel),
          isNull(atelierPeriodCloseLock.deletedAt),
        ),
      )
      .limit(1);
    if (lock && (lock.lockedModules ?? []).includes("revrec")) {
      return { error: "period-locked" as const };
    }
    const scheds = await tx
      .select()
      .from(atelierRevenueSchedule)
      .where(
        and(
          eq(atelierRevenueSchedule.periodLabel, posting.periodLabel),
          eq(atelierRevenueSchedule.frozen, true),
          isNull(atelierRevenueSchedule.deletedAt),
        ),
      );
    // Append lines.
    for (const s of scheds) {
      await tx.insert(atelierRevenuePeriodPostingLine).values({
        id: rid("rvline"),
        postingId: posting.id,
        engagementId: s.engagementId,
        scheduleId: s.id,
        kind: "posting",
        method: s.method,
        recognisedAmount: s.recognisedAmount,
        deferredBalanceEnding: s.deferredBalanceEnding,
        currency: s.currency,
        createdByUserId: me.id,
      });
      await tx
        .update(atelierRevenueSchedule)
        .set({ postingId: posting.id, updatedAt: new Date() })
        .where(eq(atelierRevenueSchedule.id, s.id));
    }
    const [updated] = await tx
      .update(atelierRevenuePeriodPosting)
      .set({
        postedAt: new Date(),
        postedByUserId: me.id,
        linesCount: scheds.length,
        grossRecognisedAmount: scheds.reduce((s, x) => s + Number(x.recognisedAmount), 0),
        updatedAt: new Date(),
      })
      .where(eq(atelierRevenuePeriodPosting.id, posting.id))
      .returning();
    // Auto-create the period-close lock for revrec.
    await tx
      .insert(atelierPeriodCloseLock)
      .values({
        id: rid("plock"),
        periodLabel: posting.periodLabel,
        lockedModules: ["revrec"],
        lockedByUserId: me.id,
        createdByUserId: me.id,
      })
      .onConflictDoNothing();
    return { posting: updated, lineCount: scheds.length };
  });
  if ("error" in out) {
    res.status(409).json({ error: out.error });
    return;
  }
  await audit(me.id, me.name, {
    entityType: "revenue_period_posting",
    entityId: out.posting.id,
    action: "posting.post",
    payload: { period: out.posting.periodLabel, lines: out.lineCount },
    summary: `POSTED ${out.posting.periodLabel} (${out.lineCount} lines, gross ${out.posting.grossRecognisedAmount})`,
  });
  res.json({ posting: out.posting, locked: true });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/revrec/period-postings", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-read-denied" });
    return;
  }
  const rows = await withRls(req, async (tx) => {
    return tx
      .select()
      .from(atelierRevenuePeriodPosting)
      .where(isNull(atelierRevenuePeriodPosting.deletedAt))
      .orderBy(desc(atelierRevenuePeriodPosting.periodLabel))
      .limit(50);
  });
  res.json({ postings: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/revrec/period-postings/:id/lines", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-read-denied" });
    return;
  }
  const lines = await withRls(req, async (tx) => {
    return tx
      .select()
      .from(atelierRevenuePeriodPostingLine)
      .where(
        and(
          eq(atelierRevenuePeriodPostingLine.postingId, req.params.id),
          isNull(atelierRevenuePeriodPostingLine.deletedAt),
        ),
      )
      .orderBy(atelierRevenuePeriodPostingLine.engagementId);
  });
  res.json({ lines });
});

// Task #1082 — targeted posting-line lookup for GL drill-through deep-links.
// Resolves a line id to its posting/period/schedule without the 50-posting
// list cap, so old-period GL sources still focus the exact schedule row.
// @cli-skip: internal deep-link resolver, no standalone CLI value
router.get("/revrec/posting-lines/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-read-denied" });
    return;
  }
  const row = await withRls(req, async (tx) => {
    const [r] = await tx
      .select({
        id: atelierRevenuePeriodPostingLine.id,
        postingId: atelierRevenuePeriodPostingLine.postingId,
        scheduleId: atelierRevenuePeriodPostingLine.scheduleId,
        periodLabel: atelierRevenuePeriodPosting.periodLabel,
      })
      .from(atelierRevenuePeriodPostingLine)
      .innerJoin(
        atelierRevenuePeriodPosting,
        eq(atelierRevenuePeriodPosting.id, atelierRevenuePeriodPostingLine.postingId),
      )
      .where(
        and(
          eq(atelierRevenuePeriodPostingLine.id, req.params.id),
          isNull(atelierRevenuePeriodPostingLine.deletedAt),
          isNull(atelierRevenuePeriodPosting.deletedAt),
        ),
      );
    return r ?? null;
  });
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ line: row });
});

// ===========================================================================
// REVENUE ADJUSTMENT — founding_partner only
// ===========================================================================

const AdjustmentSchema = z.object({
  postingId: z.string().min(1),
  engagementId: z.string().min(1),
  deltaAmount: z.number().refine((n) => n !== 0, { message: "delta must be non-zero" }),
  currency: z.string().optional().default("USD"),
  rationaleText: z.string().min(20, "rationale_text must be at least 20 chars"),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/revrec/adjustments", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFoundingPartner(me.role)) {
    res.status(403).json({ error: "founding-partner-required" });
    return;
  }
  const parsed = AdjustmentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-input", details: parsed.error.flatten() });
    return;
  }
  const out = await withRls(req, async (tx) => {
    const [posting] = await tx
      .select()
      .from(atelierRevenuePeriodPosting)
      .where(eq(atelierRevenuePeriodPosting.id, parsed.data.postingId))
      .limit(1);
    if (!posting || !posting.postedAt) return { error: "posting-not-posted" as const };
    const adjId = rid("rvadj");
    await tx.insert(atelierRevenueAdjustment).values({
      id: adjId,
      postingId: parsed.data.postingId,
      engagementId: parsed.data.engagementId,
      deltaAmount: parsed.data.deltaAmount,
      currency: parsed.data.currency ?? "USD",
      rationaleText: parsed.data.rationaleText,
      requestedByUserId: me.id,
      createdByUserId: me.id,
    });
    const [line] = await tx
      .insert(atelierRevenuePeriodPostingLine)
      .values({
        id: rid("rvline"),
        postingId: parsed.data.postingId,
        engagementId: parsed.data.engagementId,
        kind: "adjustment",
        method: "adjustment",
        recognisedAmount: parsed.data.deltaAmount,
        currency: parsed.data.currency ?? "USD",
        adjustmentId: adjId,
        notes: parsed.data.rationaleText.slice(0, 200),
        createdByUserId: me.id,
      })
      .returning();
    // Update posting gross.
    await tx
      .update(atelierRevenuePeriodPosting)
      .set({
        grossRecognisedAmount: sql`${atelierRevenuePeriodPosting.grossRecognisedAmount} + ${parsed.data.deltaAmount}`,
        updatedAt: new Date(),
      })
      .where(eq(atelierRevenuePeriodPosting.id, parsed.data.postingId));
    return { adjustmentId: adjId, line };
  });
  if ("error" in out) {
    res.status(409).json({ error: out.error });
    return;
  }
  await audit(me.id, me.name, {
    entityType: "revenue_adjustment",
    entityId: out.adjustmentId,
    action: "adjustment.record",
    payload: {
      postingId: parsed.data.postingId,
      delta: parsed.data.deltaAmount,
      eng: parsed.data.engagementId,
    },
    summary: `Adjustment ${parsed.data.deltaAmount} on ${parsed.data.postingId} — ${parsed.data.rationaleText.slice(0, 80)}`,
  });
  res.status(201).json({ adjustment: out.line, id: out.adjustmentId });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/revrec/adjustments", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-read-denied" });
    return;
  }
  const postingId = req.query.postingId ? String(req.query.postingId) : null;
  const rows = await withRls(req, async (tx) => {
    const conds = [isNull(atelierRevenueAdjustment.deletedAt)];
    if (postingId) conds.push(eq(atelierRevenueAdjustment.postingId, postingId));
    return tx
      .select()
      .from(atelierRevenueAdjustment)
      .where(and(...conds))
      .orderBy(desc(atelierRevenueAdjustment.createdAt))
      .limit(200);
  });
  res.json({ adjustments: rows });
});

// ===========================================================================
// PERIOD CLOSE LOCK
// ===========================================================================

// @cli-skip: pending Task #340 read-parity migration
router.get("/revrec/period-locks", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "revrec-read-denied" });
    return;
  }
  const rows = await withRls(req, async (tx) =>
    tx
      .select()
      .from(atelierPeriodCloseLock)
      .where(isNull(atelierPeriodCloseLock.deletedAt))
      .orderBy(desc(atelierPeriodCloseLock.periodLabel))
      .limit(50),
  );
  res.json({ locks: rows });
});

// ===========================================================================
// WIP SNAPSHOT — daemon refresh + reads
// ===========================================================================

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/wip/snapshots/refresh", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteFinance(me.role)) {
    res.status(403).json({ error: "finance-required" });
    return;
  }
  const runId = rid("wiprun");
  const out = await withRls(req, async (tx) => {
    await tx.insert(atelierWipSnapshotRunLog).values({
      id: runId,
      status: "running",
      triggeredByUserId: me.id,
      createdByUserId: me.id,
    });
    const engs = await tx
      .select({ id: atelierEngagements.id })
      .from(atelierEngagements)
      .where(isNull(atelierEngagements.deletedAt))
      .limit(500);
    let written = 0;
    for (const e of engs) {
      const tsRows = await tx
        .select({
          hours: sql<number>`COALESCE(SUM(${atelierTimesheetEntries.hours}), 0)`,
        })
        .from(atelierTimesheetEntries)
        .where(
          and(
            eq(atelierTimesheetEntries.engagementId, e.id),
            eq(atelierTimesheetEntries.billable, true),
          ),
        );
      const expRows = await tx
        .select({
          cost: sql<number>`COALESCE(SUM(${atelierExpenses.usdAmount}), 0)`,
        })
        .from(atelierExpenses)
        .where(eq(atelierExpenses.engagementId, e.id));
      const recRows = await tx
        .select({
          rec: sql<number>`COALESCE(SUM(${atelierRevenueSchedule.recognisedAmount}), 0)`,
        })
        .from(atelierRevenueSchedule)
        .where(
          and(
            eq(atelierRevenueSchedule.engagementId, e.id),
            isNull(atelierRevenueSchedule.deletedAt),
          ),
        );
      const hoursBurned = Number(tsRows[0]?.hours ?? 0);
      const expenseBurned = Number(expRows[0]?.cost ?? 0);
      const recognised = Number(recRows[0]?.rec ?? 0);
      // Wave 2: invoiced = 0 (Wave 3 will replace this view source with
      // real atelier_invoice rows). Unbilled = recognised - invoiced.
      const invoiced = 0;
      const unbilled = recognised - invoiced;
      await tx.insert(atelierUnbilledWipSnapshot).values({
        id: rid("wip"),
        engagementId: e.id,
        hoursBurned,
        expenseBurned,
        recognisedRevenue: recognised,
        invoicedAmount: invoiced,
        unbilledAmount: unbilled,
        runLogId: runId,
        createdByUserId: me.id,
      });
      written++;
    }
    await tx
      .update(atelierWipSnapshotRunLog)
      .set({
        finishedAt: new Date(),
        engagementsScanned: engs.length,
        snapshotsWritten: written,
        status: "complete",
        updatedAt: new Date(),
      })
      .where(eq(atelierWipSnapshotRunLog.id, runId));
    return { runId, scanned: engs.length, written };
  });
  await audit(me.id, me.name, {
    entityType: "wip_snapshot_run",
    entityId: runId,
    action: "wip.refresh",
    payload: out,
    summary: `WIP refresh: ${out.written} snapshots`,
  });
  res.json(out);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/wip/snapshots/latest", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadRollup(me.role)) {
    res.status(403).json({ error: "wip-read-denied" });
    return;
  }
  const out = await withRls(req, async (tx) => {
    const rows = await tx.execute<{
      engagement_id: string;
      snapshot_at: Date;
      hours_burned: number;
      expense_burned: number;
      recognised_revenue: number;
      invoiced_amount: number;
      unbilled_amount: number;
      currency: string;
    }>(sql`
      SELECT DISTINCT ON (engagement_id)
        engagement_id, snapshot_at, hours_burned, expense_burned,
        recognised_revenue, invoiced_amount, unbilled_amount, currency
      FROM atelier_unbilled_wip_snapshot
      WHERE deleted_at IS NULL
      ORDER BY engagement_id, snapshot_at DESC
    `);
    const list = rows.rows ?? [];
    const firmTotals = list.reduce(
      (acc, r) => {
        acc.recognised += Number(r.recognised_revenue);
        acc.invoiced += Number(r.invoiced_amount);
        acc.unbilled += Number(r.unbilled_amount);
        return acc;
      },
      { recognised: 0, invoiced: 0, unbilled: 0 },
    );
    return { engagements: list, firm: { ...firmTotals, count: list.length } };
  });
  res.json(out);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/wip/run-log", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "wip-read-denied" });
    return;
  }
  const rows = await withRls(req, async (tx) =>
    tx
      .select()
      .from(atelierWipSnapshotRunLog)
      .orderBy(desc(atelierWipSnapshotRunLog.startedAt))
      .limit(50),
  );
  res.json({ runs: rows });
});

// ===========================================================================
// MARGIN
// ===========================================================================

// @cli-skip: pending Task #340 read-parity migration
router.get("/margin/firm", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadRollup(me.role)) {
    res.status(403).json({ error: "margin-read-denied" });
    return;
  }
  const out = await withRls(req, async (tx) => {
    const rows = await tx.execute<{
      engagement_id: string;
      snapshot_at: Date;
      revenue_recognised: number;
      direct_cost: number;
      gross_margin_amount: number;
      gross_margin_pct: number;
      realization_rate: number;
      leakage_amount: number;
      currency: string;
    }>(sql`
      SELECT DISTINCT ON (engagement_id)
        engagement_id, snapshot_at, revenue_recognised, direct_cost,
        gross_margin_amount, gross_margin_pct, realization_rate,
        leakage_amount, currency
      FROM atelier_engagement_margin_snapshot
      WHERE deleted_at IS NULL
      ORDER BY engagement_id, snapshot_at DESC
    `);
    const list = rows.rows ?? [];
    const totals = list.reduce(
      (acc, r) => {
        acc.revenue += Number(r.revenue_recognised);
        acc.cost += Number(r.direct_cost);
        acc.leakage += Number(r.leakage_amount);
        return acc;
      },
      { revenue: 0, cost: 0, leakage: 0 },
    );
    const firmGm = totals.revenue - totals.cost;
    const firmGmPct = totals.revenue === 0 ? 0 : firmGm / totals.revenue;
    // Top realization slips (lowest realization rate).
    const slips = [...list]
      .filter((r) => Number(r.revenue_recognised) > 0)
      .sort((a, b) => Number(a.realization_rate) - Number(b.realization_rate))
      .slice(0, 5)
      .map((r) => ({
        engagementId: r.engagement_id,
        realizationRate: Number(r.realization_rate),
        leakageAmount: Number(r.leakage_amount),
      }));
    return {
      firm: {
        revenueRecognised: totals.revenue,
        directCost: totals.cost,
        grossMarginAmount: firmGm,
        grossMarginPct: firmGmPct,
        leakageAmount: totals.leakage,
        engagementCount: list.length,
      },
      slips,
      asOf: list[0]?.snapshot_at ?? null,
    };
  });
  res.json(out);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/margin/engagements/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canRead(me.role)) {
    res.status(403).json({ error: "margin-read-denied" });
    return;
  }
  const out = await withRls(req, async (tx) => {
    const rows = await tx
      .select()
      .from(atelierEngagementMarginSnapshot)
      .where(
        and(
          eq(atelierEngagementMarginSnapshot.engagementId, req.params.id),
          isNull(atelierEngagementMarginSnapshot.deletedAt),
        ),
      )
      .orderBy(desc(atelierEngagementMarginSnapshot.snapshotAt))
      .limit(50);
    return rows;
  });
  res.json({ snapshots: out });
});

// Compute margin snapshots (callable by finance; cost-capped via daemon).
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/margin/refresh", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWriteFinance(me.role)) {
    res.status(403).json({ error: "finance-required" });
    return;
  }
  const periodLabel = req.body?.periodLabel ? String(req.body.periodLabel) : null;
  if (!periodLabel || !/^\d{4}-\d{2}$/.test(periodLabel)) {
    res.status(400).json({ error: "invalid-period-label" });
    return;
  }
  const out = await withRls(req, async (tx) => {
    const engs = await tx
      .select({ id: atelierEngagements.id })
      .from(atelierEngagements)
      .where(isNull(atelierEngagements.deletedAt))
      .limit(500);
    let written = 0;
    for (const e of engs) {
      const [sched] = await tx
        .select({
          rec: sql<number>`COALESCE(SUM(${atelierRevenueSchedule.recognisedAmount}), 0)`,
        })
        .from(atelierRevenueSchedule)
        .where(
          and(
            eq(atelierRevenueSchedule.engagementId, e.id),
            eq(atelierRevenueSchedule.periodLabel, periodLabel),
            isNull(atelierRevenueSchedule.deletedAt),
          ),
        );
      const [hours] = await tx
        .select({
          billable: sql<number>`COALESCE(SUM(CASE WHEN ${atelierTimesheetEntries.billable}=true THEN ${atelierTimesheetEntries.hours} ELSE 0 END), 0)`,
          billed: sql<number>`COALESCE(SUM(CASE WHEN ${atelierTimesheetEntries.billable}=true AND ${atelierTimesheetEntries.status}='approved' THEN ${atelierTimesheetEntries.hours} ELSE 0 END), 0)`,
        })
        .from(atelierTimesheetEntries)
        .where(
          and(
            eq(atelierTimesheetEntries.engagementId, e.id),
            sql`substr(${atelierTimesheetEntries.workDate}, 1, 7) = ${periodLabel}`,
          ),
        );
      const [expenseRow] = await tx
        .select({
          cost: sql<number>`COALESCE(SUM(${atelierExpenses.usdAmount}), 0)`,
        })
        .from(atelierExpenses)
        .where(
          and(
            eq(atelierExpenses.engagementId, e.id),
            sql`substr(${atelierExpenses.expenseDate}, 1, 7) = ${periodLabel}`,
          ),
        );
      const revenue = Number(sched?.rec ?? 0);
      const billable = Number(hours?.billable ?? 0);
      const billed = Number(hours?.billed ?? 0);
      const expenses = Number(expenseRow?.cost ?? 0);
      const directCost = billed * DEFAULT_DIRECT_COST_PER_HOUR_USD + expenses;
      const grossMargin = revenue - directCost;
      const grossMarginPct = revenue === 0 ? 0 : grossMargin / revenue;
      const standardRevenue = billable * STANDARD_HOURLY_RATE_USD;
      const realization = standardRevenue === 0 ? 0 : revenue / standardRevenue;
      const leakage = standardRevenue - revenue;
      // Skip writing zero-everything rows.
      if (revenue === 0 && billable === 0 && expenses === 0) continue;
      await tx.insert(atelierEngagementMarginSnapshot).values({
        id: rid("mrg"),
        engagementId: e.id,
        periodLabel,
        revenueRecognised: revenue,
        directCost,
        grossMarginAmount: grossMargin,
        grossMarginPct,
        realizationRate: realization,
        hoursBillable: billable,
        hoursBilled: billed,
        standardRevenueAtRack: standardRevenue,
        leakageAmount: leakage,
        createdByUserId: me.id,
      });
      written++;
    }
    return { period: periodLabel, scanned: engs.length, written };
  });
  await audit(me.id, me.name, {
    entityType: "engagement_margin_snapshot",
    entityId: periodLabel,
    action: "margin.refresh",
    payload: out,
    summary: `Margin refresh: ${out.written} snapshots for ${periodLabel}`,
  });
  res.json(out);
});

// ===========================================================================
// LEAKAGE
// ===========================================================================

// @cli-skip: pending Task #340 read-parity migration
router.get("/leakage", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReadRollup(me.role)) {
    res.status(403).json({ error: "leakage-read-denied" });
    return;
  }
  const out = await withRls(req, async (tx) => {
    const rows = await tx.execute<{
      engagement_id: string;
      snapshot_at: Date;
      revenue_recognised: number;
      standard_revenue_at_rack: number;
      leakage_amount: number;
      realization_rate: number;
    }>(sql`
      SELECT DISTINCT ON (engagement_id)
        engagement_id, snapshot_at, revenue_recognised, standard_revenue_at_rack,
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
    const firmRealization =
      totals.standard === 0 ? 0 : totals.recognised / totals.standard;
    return {
      firm: { ...totals, realizationRate: firmRealization },
      engagements: list,
    };
  });
  res.json(out);
});

export default router;
