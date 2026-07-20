/**
 * Atelier — Automated billing trigger engine (Task #429).
 *
 * Deterministic, idempotent engine that turns engagement billing rules
 * into billing triggers and draft invoices:
 *
 *   1. `scanBillingTriggers` — scans active rules and materialises due
 *      billing triggers. Every trigger carries a deterministic
 *      idempotency key; the UNIQUE (org_id, idempotency_key) index +
 *      ON CONFLICT DO NOTHING makes double billing structurally
 *      impossible no matter how often the scan runs.
 *   2. `draftInvoiceForTrigger` — turns one ready trigger into a DRAFT
 *      invoice, reusing the Wave-3 compose semantics (approved billable
 *      time + client-billable expenses with sourceRef dedupe) for T&M
 *      periods, and single fee lines for milestone / installment /
 *      retainer triggers. NEVER issues — issuing stays a partner action.
 *   3. `computeUpcomingTriggers` — pure preview of future trigger dates
 *      for the worklist (nothing persisted).
 *
 * The Billing Orchestrator agent (atelier-billing-orchestrator.ts) wraps
 * 1+2 in the standard runAgent lifecycle.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierBillingRule,
  atelierBillingTrigger,
  atelierRevenueMilestone,
  atelierInvoice,
  atelierInvoiceLine,
  atelierTimesheetEntries,
  atelierExpenses,
  atelierEngagements,
  atelierAccounts,
  atelierAuditEvents,
  type BillingRuleConfig,
} from "@workspace/db";

export type BillingRuleRow = typeof atelierBillingRule.$inferSelect;
export type BillingTriggerRow = typeof atelierBillingTrigger.$inferSelect;

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function monthLabel(d: Date): string {
  return d.toISOString().slice(0, 7); // YYYY-MM
}
function monthStart(label: string): string {
  return `${label}-01`;
}
function monthEnd(label: string): string {
  const [y, m] = label.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)); // day 0 of next month
  return isoDate(last);
}
/** First day of the month AFTER the given label — the billing date for that period. */
function monthAfter(label: string): string {
  const [y, m] = label.split("-").map(Number);
  return isoDate(new Date(Date.UTC(y, m, 1)));
}
/** All fully-completed month labels from anchor (inclusive) whose period end < asOf. */
function completedMonths(anchor: string, asOf: Date, endDate?: string): string[] {
  const out: string[] = [];
  let [y, m] = anchor.slice(0, 7).split("-").map(Number);
  for (let i = 0; i < 240; i++) {
    const label = `${y}-${String(m).padStart(2, "0")}`;
    const periodEnd = new Date(`${monthEnd(label)}T23:59:59Z`);
    if (periodEnd.getTime() >= asOf.getTime()) break;
    if (endDate && monthStart(label) > endDate) break;
    out.push(label);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

const VAT_RATE_BY_JURISDICTION: Record<string, number> = {
  AE: 5, SA: 15, EU: 20, GLOBAL: 0,
};

export interface TriggerCandidate {
  ruleId: string;
  engagementId: string;
  triggerType: "milestone" | "period_end" | "installment" | "retainer";
  idempotencyKey: string;
  dueDate: string;
  amount: number;
  currency: string;
  details: Record<string, unknown>;
}

async function agentAudit(args: {
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
  actorId?: string | null;
  actorLabel?: string;
  actorType?: "human" | "agent";
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: args.actorType ?? "agent",
    actorId: args.actorId ?? "ag_billing_orchestrator",
    actorLabel: args.actorLabel ?? "Billing Orchestrator",
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

/** Unbilled approved billable T&M totals for one engagement month. */
async function estimateTnmPeriod(args: {
  engagementId: string;
  from: string;
  to: string;
  rate: number;
  billedRefs: Set<string>;
}): Promise<{ hours: number; timeAmount: number; expenseAmount: number; total: number }> {
  const timeRows = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(and(
      eq(atelierTimesheetEntries.engagementId, args.engagementId),
      eq(atelierTimesheetEntries.billable, true),
      eq(atelierTimesheetEntries.status, "approved"),
      isNull(atelierTimesheetEntries.deletedAt),
    ));
  const time = timeRows.filter(
    (t) => t.workDate >= args.from && t.workDate <= args.to && !args.billedRefs.has(t.id),
  );
  const expRows = await db
    .select()
    .from(atelierExpenses)
    .where(and(
      eq(atelierExpenses.engagementId, args.engagementId),
      eq(atelierExpenses.clientBillable, true),
      eq(atelierExpenses.status, "approved"),
      isNull(atelierExpenses.deletedAt),
    ));
  const exp = expRows.filter(
    (e) => e.expenseDate >= args.from && e.expenseDate <= args.to && !args.billedRefs.has(e.id),
  );
  const hours = time.reduce((s, t) => s + t.hours, 0);
  const timeAmount = round2(hours * args.rate);
  const expenseAmount = round2(
    exp.reduce((s, e) => s + e.usdAmount * (1 + (e.markupPct ?? 0) / 100), 0),
  );
  return { hours, timeAmount, expenseAmount, total: round2(timeAmount + expenseAmount) };
}

/** All sourceRefs already billed on any non-void invoice of the engagement. */
async function billedRefsForEngagement(orgId: string, engagementId: string): Promise<Set<string>> {
  const invs = await db
    .select({ id: atelierInvoice.id })
    .from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.orgId, orgId),
      eq(atelierInvoice.engagementId, engagementId),
      isNull(atelierInvoice.deletedAt),
    ));
  const refs = new Set<string>();
  if (invs.length === 0) return refs;
  const lines = await db
    .select({ sourceRef: atelierInvoiceLine.sourceRef })
    .from(atelierInvoiceLine)
    .where(inArray(atelierInvoiceLine.invoiceId, invs.map((i) => i.id)));
  for (const l of lines) {
    if (!l.sourceRef) continue;
    for (const ref of l.sourceRef.split(",")) refs.add(ref);
  }
  return refs;
}

/** Compute due candidates for one rule (deterministic). */
export async function candidatesForRule(
  rule: BillingRuleRow,
  asOf: Date,
): Promise<TriggerCandidate[]> {
  const cfg: BillingRuleConfig = rule.config ?? {};
  const out: TriggerCandidate[] = [];
  const anchor = (cfg.anchorDate ?? isoDate(rule.createdAt)).slice(0, 10);

  if (rule.ruleType === "milestone") {
    const ms = await db
      .select()
      .from(atelierRevenueMilestone)
      .where(and(
        eq(atelierRevenueMilestone.orgId, rule.orgId),
        eq(atelierRevenueMilestone.engagementId, rule.engagementId),
        eq(atelierRevenueMilestone.status, "invoiceable"),
        isNull(atelierRevenueMilestone.deletedAt),
      ));
    for (const m of ms) {
      out.push({
        ruleId: rule.id,
        engagementId: rule.engagementId,
        triggerType: "milestone",
        idempotencyKey: `bill:${rule.id}:milestone:${m.id}`,
        dueDate: m.invoiceableAt ? isoDate(m.invoiceableAt) : isoDate(asOf),
        amount: m.earnedAmount > 0 ? m.earnedAmount : m.plannedAmount,
        currency: rule.currency,
        details: { milestoneId: m.id, milestoneName: m.name, sequence: m.sequence },
      });
    }
  } else if (rule.ruleType === "periodic_tnm") {
    const billedRefs = await billedRefsForEngagement(rule.orgId, rule.engagementId);
    for (const label of completedMonths(anchor, asOf, cfg.endDate)) {
      const rate = cfg.defaultRateUsd ?? 250;
      const est = await estimateTnmPeriod({
        engagementId: rule.engagementId,
        from: monthStart(label),
        to: monthEnd(label),
        rate,
        billedRefs,
      });
      out.push({
        ruleId: rule.id,
        engagementId: rule.engagementId,
        triggerType: "period_end",
        idempotencyKey: `bill:${rule.id}:period:${label}`,
        dueDate: monthAfter(label),
        amount: est.total,
        currency: rule.currency,
        details: { periodLabel: label, ...est, rate },
      });
    }
  } else if (rule.ruleType === "fixed_fee") {
    for (const inst of cfg.installments ?? []) {
      if (inst.dueDate > isoDate(asOf)) continue;
      out.push({
        ruleId: rule.id,
        engagementId: rule.engagementId,
        triggerType: "installment",
        idempotencyKey: `bill:${rule.id}:installment:${inst.key}`,
        dueDate: inst.dueDate,
        amount: inst.amount,
        currency: rule.currency,
        details: { installmentKey: inst.key, label: inst.label },
      });
    }
  } else if (rule.ruleType === "retainer") {
    for (const label of completedMonths(anchor, asOf, cfg.endDate)) {
      out.push({
        ruleId: rule.id,
        engagementId: rule.engagementId,
        triggerType: "retainer",
        idempotencyKey: `bill:${rule.id}:retainer:${label}`,
        dueDate: monthAfter(label),
        amount: cfg.amount ?? 0,
        currency: rule.currency,
        details: { periodLabel: label },
      });
    }
  }
  return out;
}

export interface ScanResult {
  rulesScanned: number;
  candidatesFound: number;
  triggersCreated: number;
}

/**
 * Materialise due triggers for all active rules (optionally one
 * engagement). Safe to run any number of times: the idempotency key
 * unique index makes re-inserts no-ops.
 */
export async function scanBillingTriggers(args: {
  orgId: string;
  asOf?: Date;
  engagementId?: string;
}): Promise<ScanResult> {
  const asOf = args.asOf ?? new Date();
  const where = [
    eq(atelierBillingRule.orgId, args.orgId),
    eq(atelierBillingRule.status, "active"),
    isNull(atelierBillingRule.deletedAt),
  ];
  if (args.engagementId) where.push(eq(atelierBillingRule.engagementId, args.engagementId));
  const rules = await db.select().from(atelierBillingRule).where(and(...where));

  let candidatesFound = 0;
  let triggersCreated = 0;
  for (const rule of rules) {
    const cands = await candidatesForRule(rule, asOf);
    candidatesFound += cands.length;
    for (const c of cands) {
      const inserted = await db
        .insert(atelierBillingTrigger)
        .values({
          id: rid("btrig"),
          orgId: args.orgId,
          ruleId: c.ruleId,
          engagementId: c.engagementId,
          triggerType: c.triggerType,
          idempotencyKey: c.idempotencyKey,
          dueDate: c.dueDate,
          amount: c.amount,
          currency: c.currency,
          status: "ready",
          details: c.details,
        })
        .onConflictDoNothing()
        .returning({ id: atelierBillingTrigger.id });
      if (inserted.length > 0) triggersCreated++;
    }
  }
  return { rulesScanned: rules.length, candidatesFound, triggersCreated };
}

export interface UpcomingTrigger {
  ruleId: string;
  engagementId: string;
  triggerType: string;
  dueDate: string;
  amount: number;
  currency: string;
  label: string;
}

/** Pure preview of future trigger dates within a horizon (nothing persisted). */
export async function computeUpcomingTriggers(args: {
  orgId: string;
  asOf?: Date;
  horizonDays?: number;
}): Promise<UpcomingTrigger[]> {
  const asOf = args.asOf ?? new Date();
  const horizon = new Date(asOf.getTime() + (args.horizonDays ?? 90) * 86400_000);
  const rules = await db
    .select()
    .from(atelierBillingRule)
    .where(and(
      eq(atelierBillingRule.orgId, args.orgId),
      eq(atelierBillingRule.status, "active"),
      isNull(atelierBillingRule.deletedAt),
    ));
  const out: UpcomingTrigger[] = [];
  for (const rule of rules) {
    const cfg: BillingRuleConfig = rule.config ?? {};
    const anchor = (cfg.anchorDate ?? isoDate(rule.createdAt)).slice(0, 10);
    if (rule.ruleType === "fixed_fee") {
      for (const inst of cfg.installments ?? []) {
        if (inst.dueDate > isoDate(asOf) && inst.dueDate <= isoDate(horizon)) {
          out.push({
            ruleId: rule.id, engagementId: rule.engagementId,
            triggerType: "installment", dueDate: inst.dueDate,
            amount: inst.amount, currency: rule.currency,
            label: inst.label || `Installment ${inst.key}`,
          });
        }
      }
    } else if (rule.ruleType === "retainer" || rule.ruleType === "periodic_tnm") {
      // Months completing within the horizon but not yet completed as of now.
      const doneNow = new Set(completedMonths(anchor, asOf, cfg.endDate));
      for (const label of completedMonths(anchor, horizon, cfg.endDate)) {
        if (doneNow.has(label)) continue;
        out.push({
          ruleId: rule.id, engagementId: rule.engagementId,
          triggerType: rule.ruleType === "retainer" ? "retainer" : "period_end",
          dueDate: monthAfter(label),
          amount: rule.ruleType === "retainer" ? (cfg.amount ?? 0) : 0,
          currency: rule.currency,
          label: rule.ruleType === "retainer" ? `Retainer ${label}` : `T&M period ${label}`,
        });
      }
    } else if (rule.ruleType === "milestone") {
      // Pending milestones with planned dates in the horizon.
      const ms = await db
        .select()
        .from(atelierRevenueMilestone)
        .where(and(
          eq(atelierRevenueMilestone.orgId, rule.orgId),
          eq(atelierRevenueMilestone.engagementId, rule.engagementId),
          isNull(atelierRevenueMilestone.deletedAt),
        ));
      for (const m of ms) {
        if (m.status === "invoiceable") continue; // already a real trigger
        if (!m.plannedDate || m.plannedDate > isoDate(horizon)) continue;
        out.push({
          ruleId: rule.id, engagementId: rule.engagementId,
          triggerType: "milestone", dueDate: m.plannedDate,
          amount: m.plannedAmount, currency: rule.currency,
          label: `Milestone: ${m.name} (${m.status})`,
        });
      }
    }
  }
  out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return out;
}

export interface DraftResult {
  triggerId: string;
  status: "drafted" | "skipped";
  invoiceId?: string;
  total?: number;
  reason?: string;
  lineCount?: number;
}

/**
 * Turn one ready trigger into a DRAFT invoice. Never issues.
 * T&M periods with nothing unbilled are marked skipped (visible in the
 * worklist) instead of producing empty drafts.
 */
export async function draftInvoiceForTrigger(args: {
  trigger: BillingTriggerRow;
  rule: BillingRuleRow;
  agentRunId?: string | null;
}): Promise<DraftResult> {
  const { trigger: staleTrigger, rule } = args;
  // Cheap pre-checks on the caller's snapshot (fast path; authoritative
  // re-check happens under a row lock inside the transaction below).
  if (staleTrigger.status !== "ready") {
    return { triggerId: staleTrigger.id, status: "skipped", reason: `not ready (${staleTrigger.status})` };
  }
  if (staleTrigger.invoiceId) {
    return { triggerId: staleTrigger.id, status: "skipped", reason: "already linked to an invoice" };
  }

  // All reads + writes happen in one transaction. The SELECT ... FOR UPDATE
  // claims the trigger row: overlapping orchestrator runs (cron + manual +
  // milestone-event) serialize here, and the loser sees the updated
  // status/invoiceId and bails — one invoice per trigger, guaranteed.
  type Audit = { entityType: string; entityId: string; action: string; payload: Record<string, unknown>; summary: string };
  const audits: Audit[] = [];
  const result = await db.transaction(async (tx): Promise<DraftResult> => {
  const [trigger] = await tx
    .select()
    .from(atelierBillingTrigger)
    .where(eq(atelierBillingTrigger.id, staleTrigger.id))
    .for("update");
  if (!trigger) {
    return { triggerId: staleTrigger.id, status: "skipped", reason: "trigger no longer exists" };
  }
  if (trigger.status !== "ready") {
    return { triggerId: trigger.id, status: "skipped", reason: `not ready (${trigger.status})` };
  }
  if (trigger.invoiceId) {
    return { triggerId: trigger.id, status: "skipped", reason: "already linked to an invoice" };
  }

  const [eng] = await tx
    .select()
    .from(atelierEngagements)
    .where(eq(atelierEngagements.id, trigger.engagementId));
  const [acct] = eng?.accountId
    ? await tx.select().from(atelierAccounts).where(eq(atelierAccounts.id, eng.accountId))
    : [undefined];

  // Build the lines first — a T&M period may turn out empty.
  type NewLine = Omit<typeof atelierInvoiceLine.$inferInsert, "invoiceId" | "id" | "orgId">;
  const lines: NewLine[] = [];
  const details = (trigger.details ?? {}) as Record<string, unknown>;

  if (trigger.triggerType === "milestone") {
    const milestoneId = String(details.milestoneId ?? "");
    const [m] = await tx
      .select()
      .from(atelierRevenueMilestone)
      .where(eq(atelierRevenueMilestone.id, milestoneId));
    if (!m) return { triggerId: trigger.id, status: "skipped", reason: "milestone not found" };
    const amount = round2(m.earnedAmount > 0 ? m.earnedAmount : m.plannedAmount);
    lines.push({
      ord: 0,
      description: `Milestone: ${m.name}`,
      qty: 1,
      unitPrice: amount,
      amount,
      sourceKind: "milestone",
      sourceRef: m.id,
    });
  } else if (trigger.triggerType === "period_end") {
    const periodLabel = String(details.periodLabel ?? "");
    const from = monthStart(periodLabel);
    const to = monthEnd(periodLabel);
    const rate = typeof details.rate === "number" ? details.rate : (rule.config?.defaultRateUsd ?? 250);
    const billedRefs = await billedRefsForEngagement(rule.orgId, rule.engagementId);
    const timeRows = await tx
      .select()
      .from(atelierTimesheetEntries)
      .where(and(
        eq(atelierTimesheetEntries.engagementId, rule.engagementId),
        eq(atelierTimesheetEntries.billable, true),
        eq(atelierTimesheetEntries.status, "approved"),
        isNull(atelierTimesheetEntries.deletedAt),
      ));
    const time = timeRows.filter(
      (t) => t.workDate >= from && t.workDate <= to && !billedRefs.has(t.id),
    );
    const byPerson = new Map<string, { hours: number; ids: string[] }>();
    for (const t of time) {
      const v = byPerson.get(t.personId) ?? { hours: 0, ids: [] };
      v.hours += t.hours;
      v.ids.push(t.id);
      byPerson.set(t.personId, v);
    }
    let ord = 0;
    for (const [personId, agg] of byPerson) {
      lines.push({
        ord: ord++,
        description: `Professional services — ${personId} (${agg.hours.toFixed(2)} hrs, ${periodLabel})`,
        qty: agg.hours,
        unitPrice: rate,
        amount: round2(agg.hours * rate),
        sourceKind: "time",
        sourceRef: agg.ids.join(","),
      });
    }
    const expRows = await tx
      .select()
      .from(atelierExpenses)
      .where(and(
        eq(atelierExpenses.engagementId, rule.engagementId),
        eq(atelierExpenses.clientBillable, true),
        eq(atelierExpenses.status, "approved"),
        isNull(atelierExpenses.deletedAt),
      ));
    for (const e of expRows) {
      if (e.expenseDate < from || e.expenseDate > to || billedRefs.has(e.id)) continue;
      const amount = round2(e.usdAmount * (1 + (e.markupPct ?? 0) / 100));
      lines.push({
        ord: ord++,
        description: `Reimbursable: ${e.merchant ?? e.category} (${e.expenseDate})`,
        qty: 1,
        unitPrice: amount,
        amount,
        sourceKind: "expense",
        sourceRef: e.id,
      });
    }
    if (lines.length === 0) {
      await tx.update(atelierBillingTrigger).set({
        status: "skipped",
        skippedReason: "Nothing unbilled in period",
        skippedAt: new Date(),
        agentRunId: args.agentRunId ?? null,
        updatedAt: new Date(),
      }).where(eq(atelierBillingTrigger.id, trigger.id));
      audits.push({
        entityType: "billing_trigger",
        entityId: trigger.id,
        action: "billing.trigger.skipped",
        payload: { reason: "empty_period", periodLabel },
        summary: `Skipped T&M period ${periodLabel} — nothing unbilled`,
      });
      return { triggerId: trigger.id, status: "skipped", reason: "Nothing unbilled in period" };
    }
  } else if (trigger.triggerType === "installment") {
    lines.push({
      ord: 0,
      description: String(details.label ?? "Fixed-fee installment"),
      qty: 1,
      unitPrice: trigger.amount,
      amount: trigger.amount,
      sourceKind: "installment",
      sourceRef: trigger.idempotencyKey,
    });
  } else if (trigger.triggerType === "retainer") {
    const periodLabel = String(details.periodLabel ?? "");
    lines.push({
      ord: 0,
      description: `Retainer — ${eng?.name ?? rule.engagementId} (${periodLabel})`,
      qty: 1,
      unitPrice: trigger.amount,
      amount: trigger.amount,
      sourceKind: "retainer",
      sourceRef: trigger.idempotencyKey,
    });
  }

  // Create the draft invoice.
  const invoiceId = rid("inv");
  const vatRatePct = VAT_RATE_BY_JURISDICTION[rule.jurisdiction] ?? 0;
  const subtotal = round2(lines.reduce((s, l) => s + (l.amount as number), 0));
  const vat = round2((subtotal * vatRatePct) / 100);
  const total = round2(subtotal + vat);
  const due = new Date(new Date(`${trigger.dueDate}T00:00:00Z`).getTime() + rule.paymentTermsDays * 86400_000);
  const billTo = Object.keys(rule.billTo ?? {}).length > 0
    ? rule.billTo
    : { name: acct?.name ?? undefined };

  await tx.insert(atelierInvoice).values({
    id: invoiceId,
    orgId: rule.orgId,
    engagementId: rule.engagementId,
    accountId: eng?.accountId ?? rule.accountId ?? null,
    legalEntityId: rule.legalEntityId ?? null,
    jurisdiction: rule.jurisdiction,
    currency: rule.currency,
    status: "draft",
    billTo,
    subtotal,
    vatAmount: vat,
    vatRatePct,
    total,
    dueDate: isoDate(due),
    notes: `Auto-drafted by Billing Orchestrator (${trigger.triggerType}, trigger ${trigger.idempotencyKey}). Review and issue.`,
    createdByUserId: null,
  });
  await tx.insert(atelierInvoiceLine).values(
    lines.map((l, i) => ({
      ...l,
      id: rid("invl"),
      orgId: rule.orgId,
      invoiceId,
      ord: i,
    })),
  );

  await tx.update(atelierBillingTrigger).set({
    status: "drafted",
    invoiceId,
    amount: subtotal,
    draftedAt: new Date(),
    agentRunId: args.agentRunId ?? null,
    updatedAt: new Date(),
  }).where(eq(atelierBillingTrigger.id, trigger.id));

  audits.push({
    entityType: "invoice",
    entityId: invoiceId,
    action: "wallet.invoice.drafted",
    payload: { triggerId: trigger.id, idempotencyKey: trigger.idempotencyKey, triggerType: trigger.triggerType, total },
    summary: `Billing Orchestrator drafted invoice ($${total}) from ${trigger.triggerType} trigger`,
  });
  audits.push({
    entityType: "billing_trigger",
    entityId: trigger.id,
    action: "billing.trigger.drafted",
    payload: { invoiceId, total, lineCount: lines.length },
    summary: `Drafted invoice for ${trigger.idempotencyKey} ($${total})`,
  });

  return { triggerId: trigger.id, status: "drafted", invoiceId, total, lineCount: lines.length };
  });

  for (const a of audits) await agentAudit(a);
  return result;
}
