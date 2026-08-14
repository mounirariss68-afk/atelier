/**
 * Task #429 — Automated billing engine routes.
 *
 * Surfaces:
 *   GET    /billing/rules?engagementId=      list billing rules
 *   POST   /billing/rules                    create rule (finance leadership)
 *   PATCH  /billing/rules/:id                update / pause / resume rule
 *   GET    /billing/worklist                 ready + drafted + held + skipped triggers,
 *                                            upcoming preview, recent orchestrator runs
 *   POST   /billing/run                      run the Billing Orchestrator now (sync — rule-based)
 *   POST   /billing/triggers/:id/hold        park a trigger (never drafted while held)
 *   POST   /billing/triggers/:id/release     ready again
 *   POST   /billing/triggers/:id/skip        permanently skip (won't bill)
 *   POST   /billing/triggers/:id/approve     partner approves → linked draft invoice ISSUES
 *                                            (shared issueInvoiceCore path)
 *
 * Authorization: finance leadership (partner tier + finance) for
 * everything; approve additionally requires partner tier because it
 * issues an invoice.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { effectiveAgentRunStatus } from "../../lib/atelier-agents/run-staleness.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierUsers,
  atelierAuditEvents,
  atelierBillingRule,
  atelierBillingTrigger,
  atelierEngagements,
  atelierInvoice,
  atelierAgentRuns,
} from "@workspace/db";
import { assertAuditAction } from "./auditContract.js";
import { issueInvoiceCore } from "./invoiceRoutes.js";
import { computeUpcomingTriggers } from "../../lib/atelier-billing-engine.js";
import {
  launchBillingOrchestratorRun,
  getLatestBillingOrchestratorJob,
  billingOrchJobMode,
} from "../../lib/atelier-agents/billingOrchestratorJobs.js";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}
function isPartnerTier(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "founding_partner" || me.role === "partner";
}
function isFinanceLeadership(me: typeof atelierUsers.$inferSelect): boolean {
  return isPartnerTier(me) || me.role === "finance";
}
function denyNonFinance(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role) || !isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "Finance leadership required for billing surfaces." });
    return null;
  }
  return me;
}

async function audit(args: {
  entityType: string;
  entityId: string;
  actor: typeof atelierUsers.$inferSelect;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  assertAuditAction(args.action);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ------------------------------------------------------------------ rules

const InstallmentSchema = z.object({
  key: z.string().min(1).max(60),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().nonnegative(),
  label: z.string().max(200),
  // Pass-through cost installments are re-invoiced at cost — the flag must
  // survive rule edits or the at-cost marker silently disappears.
  passThrough: z.boolean().optional(),
});

// Contingent (outcome/SLA/volume) components — carried on the rule config
// purely for manual verification; NEVER turned into billing triggers.
const ContingentComponentSchema = z.object({
  key: z.string().min(1).max(80),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedAmount: z.number().nonnegative(),
  label: z.string().max(200),
});

const RuleConfigSchema = z.object({
  cadence: z.literal("monthly").optional(),
  amount: z.number().nonnegative().optional(),
  defaultRateUsd: z.number().positive().optional(),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  installments: z.array(InstallmentSchema).max(60).optional(),
  contingentComponents: z.array(ContingentComponentSchema).max(60).optional(),
});

const CreateRuleSchema = z.object({
  engagementId: z.string().min(1),
  ruleType: z.enum(["milestone", "periodic_tnm", "fixed_fee", "retainer"]),
  currency: z.string().min(3).max(3).default("USD"),
  paymentTermsDays: z.number().int().min(0).max(180).default(30),
  legalEntityId: z.string().nullable().optional(),
  jurisdiction: z.enum(["AE", "SA", "EU", "GLOBAL"]).default("GLOBAL"),
  billTo: z
    .object({
      name: z.string().max(200).optional(),
      address: z.string().max(500).optional(),
      vatId: z.string().max(60).optional(),
      country: z.string().max(60).optional(),
      contactEmail: z.string().max(200).optional(),
    })
    .default({}),
  config: RuleConfigSchema.default({}),
  notes: z.string().max(2000).default(""),
});

// @cli-skip: finance billing surface; worklist UI is the supported path
router.get("/billing/rules", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const where = [eq(atelierBillingRule.orgId, me.orgId), isNull(atelierBillingRule.deletedAt)];
  const engagementId = typeof req.query.engagementId === "string" ? req.query.engagementId : null;
  if (engagementId) where.push(eq(atelierBillingRule.engagementId, engagementId));
  const rules = await db
    .select()
    .from(atelierBillingRule)
    .where(and(...where))
    .orderBy(desc(atelierBillingRule.createdAt));
  res.json({ items: rules });
});

// @cli-skip: finance billing surface; worklist UI is the supported path
router.post("/billing/rules", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const parsed = CreateRuleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const [eng] = await db
    .select({ id: atelierEngagements.id, accountId: atelierEngagements.accountId })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, b.engagementId), eq(atelierEngagements.orgId, me.orgId)));
  if (!eng) {
    res.status(404).json({ error: "engagement_not_found" });
    return;
  }
  if (b.ruleType === "retainer" && !(b.config.amount && b.config.amount > 0)) {
    res.status(400).json({ error: "invalid-body", message: "retainer rules require config.amount > 0" });
    return;
  }
  if (b.ruleType === "fixed_fee" && !(b.config.installments && b.config.installments.length > 0)) {
    res.status(400).json({ error: "invalid-body", message: "fixed_fee rules require config.installments" });
    return;
  }
  const id = rid("brule");
  await db.insert(atelierBillingRule).values({
    id,
    orgId: me.orgId,
    engagementId: b.engagementId,
    accountId: eng.accountId,
    ruleType: b.ruleType,
    status: "active",
    currency: b.currency.toUpperCase(),
    paymentTermsDays: b.paymentTermsDays,
    legalEntityId: b.legalEntityId ?? null,
    jurisdiction: b.jurisdiction,
    billTo: b.billTo,
    config: b.config,
    notes: b.notes,
    createdByUserId: me.id,
  });
  await audit({
    entityType: "billing_rule",
    entityId: id,
    actor: me,
    action: "billing.rule.created",
    payload: { engagementId: b.engagementId, ruleType: b.ruleType, currency: b.currency },
    summary: `Created ${b.ruleType} billing rule for engagement ${b.engagementId}`,
  });
  const [rule] = await db.select().from(atelierBillingRule).where(eq(atelierBillingRule.id, id));
  res.status(201).json(rule);
});

const PatchRuleSchema = z.object({
  status: z.enum(["active", "paused"]).optional(),
  currency: z.string().min(3).max(3).optional(),
  paymentTermsDays: z.number().int().min(0).max(180).optional(),
  legalEntityId: z.string().nullable().optional(),
  jurisdiction: z.enum(["AE", "SA", "EU", "GLOBAL"]).optional(),
  billTo: CreateRuleSchema.shape.billTo.optional(),
  config: RuleConfigSchema.optional(),
  notes: z.string().max(2000).optional(),
});

// @cli-skip: finance billing surface; worklist UI is the supported path
router.patch("/billing/rules/:id", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const parsed = PatchRuleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
    return;
  }
  const [rule] = await db
    .select()
    .from(atelierBillingRule)
    .where(and(
      eq(atelierBillingRule.id, req.params.id),
      eq(atelierBillingRule.orgId, me.orgId),
      isNull(atelierBillingRule.deletedAt),
    ));
  if (!rule) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const b = parsed.data;
  await db
    .update(atelierBillingRule)
    .set({
      ...(b.status !== undefined ? { status: b.status } : {}),
      ...(b.currency !== undefined ? { currency: b.currency.toUpperCase() } : {}),
      ...(b.paymentTermsDays !== undefined ? { paymentTermsDays: b.paymentTermsDays } : {}),
      ...(b.legalEntityId !== undefined ? { legalEntityId: b.legalEntityId } : {}),
      ...(b.jurisdiction !== undefined ? { jurisdiction: b.jurisdiction } : {}),
      ...(b.billTo !== undefined ? { billTo: b.billTo } : {}),
      ...(b.config !== undefined ? { config: b.config } : {}),
      ...(b.notes !== undefined ? { notes: b.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(atelierBillingRule.id, rule.id));
  await audit({
    entityType: "billing_rule",
    entityId: rule.id,
    actor: me,
    action: "billing.rule.updated",
    payload: { changes: b },
    summary: `Updated billing rule ${rule.id}`,
  });
  const [updated] = await db.select().from(atelierBillingRule).where(eq(atelierBillingRule.id, rule.id));
  res.json(updated);
});

// ------------------------------------------------------------------ worklist

// @cli-skip: finance billing surface; worklist UI is the supported path
router.get("/billing/worklist", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const triggers = await db
    .select()
    .from(atelierBillingTrigger)
    .where(and(eq(atelierBillingTrigger.orgId, me.orgId), isNull(atelierBillingTrigger.deletedAt)))
    .orderBy(desc(atelierBillingTrigger.dueDate));

  const invoiceIds = triggers.map((t) => t.invoiceId).filter((x): x is string => !!x);
  const invoices = invoiceIds.length
    ? await db
        .select({
          id: atelierInvoice.id,
          status: atelierInvoice.status,
          total: atelierInvoice.total,
          currency: atelierInvoice.currency,
          invoiceNumber: atelierInvoice.invoiceNumber,
          dueDate: atelierInvoice.dueDate,
        })
        .from(atelierInvoice)
        .where(eq(atelierInvoice.orgId, me.orgId))
    : [];
  const invById = new Map(invoices.map((i) => [i.id, i]));

  const engIds = [...new Set(triggers.map((t) => t.engagementId))];
  const engs = engIds.length
    ? await db
        .select({ id: atelierEngagements.id, name: atelierEngagements.name })
        .from(atelierEngagements)
        .where(eq(atelierEngagements.orgId, me.orgId))
    : [];
  const engById = new Map(engs.map((e) => [e.id, e.name]));

  const upcoming = await computeUpcomingTriggers({ orgId: me.orgId, horizonDays: 90 });

  const runs = await db
    .select({
      id: atelierAgentRuns.id,
      status: atelierAgentRuns.status,
      createdAt: atelierAgentRuns.createdAt,
      updatedAt: atelierAgentRuns.updatedAt,
      output: atelierAgentRuns.output,
      targetLabel: atelierAgentRuns.targetLabel,
    })
    .from(atelierAgentRuns)
    .where(eq(atelierAgentRuns.agentId, "ag_billing_orchestrator"))
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(10);

  res.json({
    triggers: triggers.map((t) => ({
      ...t,
      engagementName: engById.get(t.engagementId) ?? t.engagementId,
      invoice: t.invoiceId ? (invById.get(t.invoiceId) ?? null) : null,
    })),
    upcoming: upcoming.map((u) => ({
      ...u,
      engagementName: engById.get(u.engagementId) ?? u.engagementId,
    })),
    // Task #1046 — stale "running" rows (dead process) render as error.
    recentRuns: runs.map((r) => ({ ...r, status: effectiveAgentRunStatus(r) })),
  });
});

// ------------------------------------------------------------------ run now

// Task #1099 — async: claim the shared orchestrator lock, start the run in
// the background and return immediately; the page polls /billing/run/status.
// @cli-skip: finance billing surface; worklist UI is the supported path
router.post("/billing/run", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const engagementId =
    typeof req.body?.engagementId === "string" && req.body.engagementId ? req.body.engagementId : undefined;
  const out = await launchBillingOrchestratorRun({
    orgId: me.orgId,
    kind: "billing_orchestrator_manual",
    userId: me.id,
    label: engagementId ? `Billing run — engagement ${engagementId}` : "Billing run — all engagements",
    input: { engagementId, source: "manual" },
    triggeredByUserId: me.id,
    wait: false,
  });
  if (!out.started) {
    res.status(409).json({
      error: "run_in_progress",
      message: "A billing orchestrator run is already in progress — refresh in a moment.",
    });
    return;
  }
  res.status(202).json({ jobId: out.jobId, status: "running" });
});

// Task #1099 — latest orchestrator run (any entry point), like
// GET /gl/bookkeeper/status. The Run button polls this until terminal.
// @cli-skip: finance billing surface; worklist UI is the supported path
router.get("/billing/run/status", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const job = await getLatestBillingOrchestratorJob(me.orgId);
  if (!job) { res.json({ lastRun: null }); return; }
  const result = (job.result ?? null) as Record<string, unknown> | null;
  res.json({
    lastRun: {
      jobId: job.id,
      mode: billingOrchJobMode(job.kind),
      status: job.status, // running | done | failed
      startedAt: job.createdAt,
      finishedAt: job.finishedAt,
      error: job.error ?? null,
      triggersCreated: typeof result?.triggersCreated === "number" ? result.triggersCreated : null,
      invoicesDrafted: typeof result?.invoicesDrafted === "number" ? result.invoicesDrafted : null,
      rationaleSummary: typeof result?.rationaleSummary === "string" ? result.rationaleSummary : null,
    },
  });
});

// ------------------------------------------------------------------ trigger actions

async function loadTrigger(orgId: string, id: string) {
  const [t] = await db
    .select()
    .from(atelierBillingTrigger)
    .where(and(
      eq(atelierBillingTrigger.id, id),
      eq(atelierBillingTrigger.orgId, orgId),
      isNull(atelierBillingTrigger.deletedAt),
    ));
  return t;
}

// @cli-skip: finance billing surface; worklist UI is the supported path
router.post("/billing/triggers/:id/hold", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const t = await loadTrigger(me.orgId, req.params.id);
  if (!t) { res.status(404).json({ error: "not_found" }); return; }
  if (t.status !== "ready") {
    res.status(400).json({ error: "invalid_state", message: `Only ready triggers can be held (is ${t.status}).` });
    return;
  }
  const reason = String(req.body?.reason ?? "").trim() || "Held by finance";
  await db.update(atelierBillingTrigger).set({
    status: "held", holdReason: reason, heldAt: new Date(), heldByUserId: me.id, updatedAt: new Date(),
  }).where(eq(atelierBillingTrigger.id, t.id));
  await audit({
    entityType: "billing_trigger", entityId: t.id, actor: me,
    action: "billing.trigger.held", payload: { reason }, summary: `Held ${t.idempotencyKey}: ${reason}`,
  });
  res.json(await loadTrigger(me.orgId, t.id));
});

// @cli-skip: finance billing surface; worklist UI is the supported path
router.post("/billing/triggers/:id/release", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const t = await loadTrigger(me.orgId, req.params.id);
  if (!t) { res.status(404).json({ error: "not_found" }); return; }
  if (t.status !== "held") {
    res.status(400).json({ error: "invalid_state", message: `Only held triggers can be released (is ${t.status}).` });
    return;
  }
  await db.update(atelierBillingTrigger).set({
    status: "ready", holdReason: null, heldAt: null, heldByUserId: null, updatedAt: new Date(),
  }).where(eq(atelierBillingTrigger.id, t.id));
  await audit({
    entityType: "billing_trigger", entityId: t.id, actor: me,
    action: "billing.trigger.released", payload: {}, summary: `Released ${t.idempotencyKey}`,
  });
  res.json(await loadTrigger(me.orgId, t.id));
});

// @cli-skip: finance billing surface; worklist UI is the supported path
router.post("/billing/triggers/:id/skip", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  const t = await loadTrigger(me.orgId, req.params.id);
  if (!t) { res.status(404).json({ error: "not_found" }); return; }
  if (t.status !== "ready" && t.status !== "held") {
    res.status(400).json({ error: "invalid_state", message: `Only ready/held triggers can be skipped (is ${t.status}).` });
    return;
  }
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) { res.status(400).json({ error: "invalid_input", message: "reason required" }); return; }
  await db.update(atelierBillingTrigger).set({
    status: "skipped", skippedReason: reason, skippedAt: new Date(), skippedByUserId: me.id, updatedAt: new Date(),
  }).where(eq(atelierBillingTrigger.id, t.id));
  await audit({
    entityType: "billing_trigger", entityId: t.id, actor: me,
    action: "billing.trigger.skipped", payload: { reason }, summary: `Skipped ${t.idempotencyKey}: ${reason}`,
  });
  res.json(await loadTrigger(me.orgId, t.id));
});

// Partner approval checkpoint: approving a drafted trigger issues its
// linked draft invoice through the shared issueInvoiceCore path.
// @cli-skip: finance billing surface; worklist UI is the supported path
router.post("/billing/triggers/:id/approve", async (req, res) => {
  const me = denyNonFinance(req, res);
  if (!me) return;
  if (!isPartnerTier(me)) {
    res.status(403).json({ error: "forbidden", message: "Partner-tier required to approve and issue." });
    return;
  }
  const t = await loadTrigger(me.orgId, req.params.id);
  if (!t) { res.status(404).json({ error: "not_found" }); return; }
  if (t.status !== "drafted" || !t.invoiceId) {
    res.status(400).json({ error: "invalid_state", message: `Only drafted triggers with a linked invoice can be approved (is ${t.status}).` });
    return;
  }
  const out = await issueInvoiceCore({ invoiceId: t.invoiceId, actor: me });
  if (!out.ok) {
    res.status(out.httpStatus).json({ error: out.error, message: out.message });
    return;
  }
  await db.update(atelierBillingTrigger).set({
    status: "issued", issuedAt: new Date(), updatedAt: new Date(),
  }).where(eq(atelierBillingTrigger.id, t.id));
  await audit({
    entityType: "billing_trigger", entityId: t.id, actor: me,
    action: "billing.trigger.approved",
    payload: { invoiceId: t.invoiceId, invoiceNumber: out.invoiceNumber },
    summary: `Approved ${t.idempotencyKey} → issued ${out.invoiceNumber}`,
  });
  res.json({ trigger: await loadTrigger(me.orgId, t.id), invoice: out.invoice });
});

export default router;
