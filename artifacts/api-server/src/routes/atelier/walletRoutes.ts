/**
 * Atelier — v3 Wallet routes (Task #259).
 *
 * Surfaces:
 *   GET  /wallet/expenses               — list (scoped: self for non-leadership)
 *   GET  /wallet/expenses/:id           — detail
 *   POST /wallet/expenses               — create draft (any path)
 *   POST /wallet/expenses/:id/audit     — (re-)run Expense Auditor
 *   POST /wallet/expenses/:id/submit    — submit for approval (RED blocks)
 *   POST /wallet/expenses/:id/approve   — partner/operations
 *   POST /wallet/expenses/:id/reject    — partner/operations/lead
 *   GET  /wallet/policy                 — list rules (any persona)
 *   POST /wallet/policy                 — create (partner/operations)
 *   PATCH /wallet/policy/:id            — update (partner/operations)
 *   DELETE /wallet/policy/:id           — soft-delete (partner/operations)
 *   POST /wallet/policy/seed-defaults   — install PRD §4.4 defaults
 *   GET  /wallet/cards                  — list corporate cards
 *   GET  /wallet/vat                    — VAT register (?format=csv)
 *   POST /wallet/fx/seed                — re-seed FX rates (deterministic)
 *   POST /wallet/retention/run          — 90d OCR-payload redaction sweep
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, desc, lt, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierExpenses,
  atelierExpensePolicies,
  atelierCorporateCards,
  atelierFxRates,
  atelierVatRegister,
  atelierEngagements,
  atelierAuditEvents,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierPartnerFirmHours,
  atelierTimesheetEntries,
  atelierInvoiceLineDrafts,
  atelierPaneAItems,
} from "@workspace/db";
import { convertToUsd, seedFxRates } from "../../lib/atelier-fx.js";
import { evaluateExpense, DEFAULT_POLICIES } from "../../lib/atelier-expense-policy.js";
import { assertAuditAction } from "./auditContract.js";
import { RECEIPT_FIXTURES, resolveFixtureDate } from "../../lib/atelier-receipt-fixtures.js";
import { runExpenseAuditor, runPublishSentinel } from "../../lib/atelier-agents/runner.js";
import { runPaymentProposer } from "../../lib/atelier-payment-proposer.js";
import { runInvoiceComposer, expensePublishSentinelChecks } from "../../lib/atelier-invoice-composer.js";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function isLeadership(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner" || me.role === "operations";
}
function isPartnerOrOps(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner" || me.role === "operations";
}

async function audit(args: {
  entityType: string;
  entityId: string;
  actor: typeof atelierUsers.$inferSelect;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}) {
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

// =============================================================
// Receipt encryption stub
// =============================================================
function encryptedReceiptRef(rawKey: string): string {
  // Application-layer indicator only — no live KMS in this build.
  return `enc:wallet:${rawKey}`;
}

// =============================================================
// Build OCR + contract digest for the Auditor
// =============================================================
function buildOcrFromExpense(
  expense: typeof atelierExpenses.$inferSelect,
): {
  merchant?: string;
  date?: string;
  total?: number;
  tax?: number;
  currency?: string;
  country?: string;
  category?: string;
  rawText?: string;
  confidence?: "green" | "amber" | "red";
} | null {
  if (expense.captureSource === "mileage" || expense.captureSource === "per_diem") {
    // No OCR needed — synthetise a high-confidence payload from the row.
    return {
      merchant: expense.merchant ?? expense.captureSource,
      date: expense.expenseDate,
      total: expense.amount,
      tax: 0,
      currency: expense.currency,
      country: expense.vatCountry ?? undefined,
      category: expense.category,
      rawText: `${expense.captureSource} entry`,
      confidence: "green",
    };
  }
  const fxKey = expense.receiptFixtureKey;
  if (fxKey && RECEIPT_FIXTURES[fxKey]) {
    const f = RECEIPT_FIXTURES[fxKey];
    return {
      merchant: f.merchant,
      date: resolveFixtureDate(fxKey, expense.expenseDate),
      total: f.total,
      tax: f.tax,
      currency: f.currency,
      country: f.country,
      category: f.category,
      rawText: f.rawText,
      confidence: f.confidence,
    };
  }
  // Card-feed without fixture: use the card-feed line itself, low confidence.
  if (expense.captureSource === "card_feed") {
    return {
      merchant: expense.merchant ?? "Unknown merchant",
      date: expense.expenseDate,
      total: expense.amount,
      tax: 0,
      currency: expense.currency,
      country: expense.vatCountry ?? undefined,
      category: expense.category,
      rawText: "card-feed line",
      confidence: "amber",
    };
  }
  return null;
}

import { buildContractDigest } from "../../lib/atelier-contract-digest.js";

// Inline definition retained as a typed wrapper that delegates to the
// shared module so existing call sites keep their import.
// buildContractDigest moved to lib/atelier-contract-digest.ts so it can
// be reused by the wallet sentinel without creating a route ↔ lib cycle.

// =============================================================
// EXPENSES
// =============================================================
function expenseToWire(e: typeof atelierExpenses.$inferSelect, who?: typeof atelierUsers.$inferSelect) {
  return {
    id: e.id,
    personId: e.personId,
    personType: e.personType,
    engagementId: e.engagementId,
    expenseDate: e.expenseDate,
    captureSource: e.captureSource,
    cardId: e.cardId,
    merchant: e.merchant,
    description: e.description,
    category: e.category,
    amount: e.amount,
    currency: e.currency,
    fxRate: e.fxRate,
    fxRateDate: e.fxRateDate,
    usdAmount: e.usdAmount,
    vatAmount: e.vatAmount,
    vatTreatment: e.vatTreatment,
    vatCountry: e.vatCountry,
    clientBillable: e.clientBillable,
    markupPct: e.markupPct,
    status: e.status,
    policyStatus: e.policyStatus,
    policyFindings: e.policyFindings,
    overrideRationale: e.overrideRationale,
    auditorRunId: e.auditorRunId,
    auditorProposal: e.auditorProposal,
    receiptFileRef: e.receiptFileRef,
    receiptFixtureKey: e.receiptFixtureKey,
    receiptEncryptedAtRest: e.receiptEncryptedAtRest,
    ocrPayloadRedactedAt: e.ocrPayloadRedactedAt?.toISOString() ?? null,
    summary: e.summary,
    submittedAt: e.submittedAt?.toISOString() ?? null,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    rejectedAt: e.rejectedAt?.toISOString() ?? null,
    rejectedReason: e.rejectedReason,
    createdAt: e.createdAt.toISOString(),
  };
}

router.get("/wallet/expenses", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const scope = (req.query.scope as string) || (isLeadership(me) ? "all" : "self");
  const personFilter = (req.query.personId as string) || null;

  let rows = await db
    .select()
    .from(atelierExpenses)
    .where(isNull(atelierExpenses.deletedAt))
    .orderBy(desc(atelierExpenses.createdAt));

  if (scope === "self" || !isLeadership(me)) {
    rows = rows.filter((r) => r.personId === me.id);
  } else if (personFilter) {
    rows = rows.filter((r) => r.personId === personFilter);
  }

  res.json({ expenses: rows.map((r) => expenseToWire(r, me)) });
});

// Engagement-lead authorization helper for engagement-scoped wallet
// endpoints. Returns true when the caller is partner/ops OR is the
// engagement_lead of the specific engagement. Other roles are denied.
async function ensureEngagementAccess(
  req: Request,
  res: Response,
  me: typeof atelierUsers.$inferSelect,
  engagementId: string,
): Promise<boolean> {
  if (isPartnerOrOps(me)) return true;
  if (me.role !== "engagement_lead") {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, engagementId), isNull(atelierEngagements.deletedAt)));
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found" });
    return false;
  }
  if (eng.engagementLeadId !== me.id) {
    res.status(403).json({ error: "not-your-engagement" });
    return false;
  }
  return true;
}

// Evidence inspection endpoints used by the approvals UI to let
// partners click through from a contractor / partner-firm proposal to
// the underlying timesheet entry / firm-hours row that justifies it.
router.get("/wallet/timesheet-entries/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [row] = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(and(eq(atelierTimesheetEntries.id, req.params.id), isNull(atelierTimesheetEntries.deletedAt)));
  if (!row) {
    res.status(404).json({ error: "entry-not-found" });
    return;
  }
  if (!isLeadership(me) && row.personId !== me.id) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({ entry: row });
});

router.get("/wallet/partner-firm-hours/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isLeadership(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierPartnerFirmHours)
    .where(and(eq(atelierPartnerFirmHours.id, req.params.id), isNull(atelierPartnerFirmHours.deletedAt)));
  if (!row) {
    res.status(404).json({ error: "firm-hours-not-found" });
    return;
  }
  res.json({ firmHours: row });
});

router.get("/wallet/expenses/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [row] = await db
    .select()
    .from(atelierExpenses)
    .where(and(eq(atelierExpenses.id, req.params.id), isNull(atelierExpenses.deletedAt)));
  if (!row) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (row.personId !== me.id && !isLeadership(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.json({ expense: expenseToWire(row, me) });
});

interface CreateExpenseBody {
  expenseDate?: string;
  captureSource?: "card_feed" | "manual" | "mileage" | "per_diem";
  cardId?: string | null;
  engagementId?: string | null;
  merchant?: string;
  description?: string;
  category?: string;
  amount?: number;
  currency?: string;
  vatCountry?: string | null;
  receiptFixtureKey?: string | null;
  receiptFileName?: string | null;
  // mileage
  km?: number;
  ratePerKmUsd?: number;
  // per-diem
  days?: number;
  perDiemUsd?: number;
}

router.post("/wallet/expenses", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const b = (req.body ?? {}) as CreateExpenseBody;
  const captureSource = (b.captureSource ?? "manual") as
    | "card_feed"
    | "manual"
    | "mileage"
    | "per_diem";
  const dateStr = b.expenseDate ?? new Date().toISOString().slice(0, 10);

  // Compute amount from path-specific inputs if not given.
  let amount = b.amount ?? 0;
  let currency = (b.currency ?? "USD").toUpperCase();
  let merchant = b.merchant ?? "";
  let category = b.category ?? "other";

  if (captureSource === "mileage") {
    const km = Math.max(0, Number(b.km ?? 0));
    const rate = Math.max(0, Number(b.ratePerKmUsd ?? 0.62));
    amount = +(km * rate).toFixed(2);
    currency = "USD";
    merchant = b.merchant ?? `Mileage ${km} km`;
    category = "mileage";
  } else if (captureSource === "per_diem") {
    const days = Math.max(0, Number(b.days ?? 1));
    const perDiem = Math.max(0, Number(b.perDiemUsd ?? 75));
    amount = +(days * perDiem).toFixed(2);
    currency = "USD";
    merchant = b.merchant ?? `Per-diem ${days} day(s)`;
    category = "per_diem";
  }

  const fx = await convertToUsd(amount, currency, dateStr);

  const id = rid("exp");
  const receiptFileRef = b.receiptFileName ? encryptedReceiptRef(b.receiptFileName) : null;

  await db.insert(atelierExpenses).values({
    id,
    personId: me.id,
    personType: me.role === "contractor" ? "contractor" : "employee",
    engagementId: b.engagementId ?? null,
    expenseDate: dateStr,
    captureSource,
    cardId: b.cardId ?? null,
    merchant,
    description: b.description ?? null,
    category,
    amount,
    currency,
    fxRate: fx.rate,
    fxRateDate: fx.rateDate,
    usdAmount: +fx.usdAmount.toFixed(2),
    vatCountry: b.vatCountry ?? null,
    receiptFixtureKey: b.receiptFixtureKey ?? null,
    receiptFileRef,
    receiptEncryptedAtRest: !!receiptFileRef,
    summary: b.description ?? merchant,
    status: "draft",
    policyStatus: "green",
    createdByUserId: me.id,
  });

  await audit({
    entityType: "expense",
    entityId: id,
    actor: me,
    action: "expense.create",
    payload: { captureSource, amount, currency, usdAmount: fx.usdAmount },
    summary: `Created ${captureSource} expense ${merchant} (${currency} ${amount.toFixed(2)} ≈ $${fx.usdAmount.toFixed(2)})`,
  });

  const [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, id));
  res.status(201).json({ expense: expenseToWire(row, me) });
});

async function runAuditOnExpense(
  expenseId: string,
  triggeredByUserId: string | null,
): Promise<{ expense: typeof atelierExpenses.$inferSelect; runId: string }> {
  const [expense] = await db
    .select()
    .from(atelierExpenses)
    .where(eq(atelierExpenses.id, expenseId));
  if (!expense) throw new Error("expense-not-found");

  const ocr = buildOcrFromExpense(expense);
  const contractDigest = await buildContractDigest(expense.engagementId ?? null);

  const { runId, proposal } = await runExpenseAuditor({
    expenseId,
    triggeredByUserId,
    ocr,
    contractDigest,
    draft: {
      amount: expense.amount,
      currency: expense.currency,
      country: expense.vatCountry ?? undefined,
      category: expense.category,
      engagementId: expense.engagementId ?? null,
    },
  });

  // Look up submitter role so role-scoped policies (partner caps etc.) match correctly.
  const [submitter] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, expense.personId));
  const submitterRole = submitter?.role ?? null;
  const flightClass =
    proposal.category === "flight"
      ? (ocr?.rawText?.match(/\b(first|business|premium_economy|economy)\b/i)?.[1]?.toLowerCase() ?? null)
      : null;

  // Apply Auditor proposal as defaults; user can edit before submit.
  const policy = await evaluateExpense({
    category: proposal.category,
    usdAmount: expense.usdAmount,
    amount: expense.amount,
    currency: expense.currency,
    country: expense.vatCountry ?? null,
    role: submitterRole,
    flightClass,
  });

  await db
    .update(atelierExpenses)
    .set({
      auditorRunId: runId,
      auditorProposal: proposal,
      category: proposal.category,
      vatTreatment: proposal.vatTreatment,
      vatAmount: proposal.vatAmount,
      vatCurrency: expense.currency,
      clientBillable: proposal.clientBillable,
      markupPct: proposal.markupPct,
      policyStatus: policy.status,
      policyFindings: policy.findings,
      ocrPayload: ocr,
      summary: proposal.summary,
      updatedAt: new Date(),
    })
    .where(eq(atelierExpenses.id, expenseId));

  const [refreshed] = await db
    .select()
    .from(atelierExpenses)
    .where(eq(atelierExpenses.id, expenseId));
  return { expense: refreshed, runId };
}

router.post("/wallet/expenses/:id/audit", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [existing] = await db
    .select()
    .from(atelierExpenses)
    .where(and(eq(atelierExpenses.id, req.params.id), isNull(atelierExpenses.deletedAt)));
  if (!existing) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (existing.personId !== me.id && !isLeadership(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  try {
    const { expense, runId } = await runAuditOnExpense(req.params.id, me.id);
    await audit({
      entityType: "expense",
      entityId: expense.id,
      actor: me,
      action: "expense.audit",
      payload: { runId, policyStatus: expense.policyStatus },
      summary: `Auditor ran on ${expense.merchant ?? expense.id} → policy ${expense.policyStatus}`,
    });
    res.json({ expense: expenseToWire(expense, me), runId });
  } catch (err) {
    res.status(500).json({ error: "audit-failed", message: err instanceof Error ? err.message : String(err) });
  }
});

interface SubmitBody {
  overrideRationale?: string;
  patch?: Partial<{
    category: string;
    clientBillable: boolean;
    markupPct: number;
    description: string;
    vatTreatment: string;
    vatAmount: number;
  }>;
}

router.post("/wallet/expenses/:id/submit", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [existing] = await db
    .select()
    .from(atelierExpenses)
    .where(and(eq(atelierExpenses.id, req.params.id), isNull(atelierExpenses.deletedAt)));
  if (!existing) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (existing.personId !== me.id) {
    res.status(403).json({ error: "only-submitter-can-submit" });
    return;
  }

  const body = (req.body ?? {}) as SubmitBody;

  // Run the Auditor first to get the proposal + initial policy outcome.
  await runAuditOnExpense(existing.id, me.id);

  // Re-apply user-edited patch on top of auditor proposal so the user
  // remains authoritative on category / billable / markup / VAT fields.
  const patch = body.patch ?? {};
  if (Object.keys(patch).length > 0) {
    await db
      .update(atelierExpenses)
      .set({
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.clientBillable !== undefined ? { clientBillable: patch.clientBillable } : {}),
        ...(patch.markupPct !== undefined ? { markupPct: patch.markupPct } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.vatTreatment !== undefined ? { vatTreatment: patch.vatTreatment } : {}),
        ...(patch.vatAmount !== undefined ? { vatAmount: patch.vatAmount } : {}),
        updatedAt: new Date(),
      })
      .where(eq(atelierExpenses.id, existing.id));
  }

  // Recompute FX at submission date so the USD reference reflects the
  // rate on the day the expense is actually submitted (drafts created
  // earlier don't carry stale FX into VAT/rollups).
  {
    const [pre] = await db
      .select()
      .from(atelierExpenses)
      .where(eq(atelierExpenses.id, existing.id));
    const submitDate = new Date().toISOString().slice(0, 10);
    const fx = await convertToUsd(pre.amount, pre.currency, submitDate);
    await db
      .update(atelierExpenses)
      .set({
        fxRate: fx.rate,
        fxRateDate: fx.rateDate,
        usdAmount: +fx.usdAmount.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(atelierExpenses.id, existing.id));
  }

  // Re-evaluate policy on the final (post-patch) values so the user can't
  // smuggle a violation in through the patch.
  const [postPatch] = await db
    .select()
    .from(atelierExpenses)
    .where(eq(atelierExpenses.id, existing.id));
  const [submitter] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, postPatch.personId));
  // Derive flight class from auditor OCR / merchant text so flight-class
  // policy still triggers at submit time (do not hardcode null).
  const ocrText = (postPatch.ocrPayload as { rawText?: string } | null)?.rawText ?? "";
  const flightClassMatch =
    `${ocrText} ${postPatch.merchant ?? ""} ${postPatch.description ?? ""}`
      .toLowerCase()
      .match(/\b(first|business|premium_economy|economy)\b/);
  const finalPolicy = await evaluateExpense({
    category: postPatch.category,
    usdAmount: postPatch.usdAmount,
    amount: postPatch.amount,
    currency: postPatch.currency,
    country: postPatch.vatCountry ?? null,
    role: submitter?.role ?? null,
    flightClass: postPatch.category === "flight" ? (flightClassMatch?.[1] ?? null) : null,
  });
  await db
    .update(atelierExpenses)
    .set({ policyStatus: finalPolicy.status, policyFindings: finalPolicy.findings, updatedAt: new Date() })
    .where(eq(atelierExpenses.id, existing.id));
  const [expense] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, existing.id));

  // Hard refusal from auditor (e.g. missing OCR) blocks submit unconditionally.
  const proposal = expense.auditorProposal as { refused?: boolean; reason?: string } | null;
  if (proposal?.refused) {
    res.status(409).json({
      error: "auditor-refused",
      message: `Auditor refused: ${proposal.reason ?? "unknown"}. Attach a clearer receipt and retry.`,
      reason: proposal.reason,
    });
    return;
  }

  // Re-validate contract billability + markup cap on the post-patch values
  // so user edits cannot smuggle clientBillable=true or an inflated markup
  // past the auditor.
  if (expense.clientBillable) {
    const digest = await buildContractDigest(expense.engagementId ?? null);
    if (!digest || !digest.expensesClause) {
      res.status(409).json({
        error: "billable-not-permitted",
        message: digest?.summary
          ? `Cannot mark client-billable: ${digest.summary}`
          : "Cannot mark client-billable: no engagement / no contract clause.",
      });
      return;
    }
    if (
      Array.isArray(digest.permittedCategories) &&
      digest.permittedCategories.length > 0 &&
      !digest.permittedCategories.includes(expense.category)
    ) {
      res.status(409).json({
        error: "category-not-permitted",
        message: `Category "${expense.category}" is outside the contract pass-through scope (${digest.permittedCategories.join(", ")}).`,
      });
      return;
    }
    const cap = digest.expenseMarkupCapPct ?? 0;
    if ((expense.markupPct ?? 0) > cap) {
      res.status(409).json({
        error: "markup-cap-exceeded",
        message: `Markup ${expense.markupPct}% exceeds contract cap of ${cap}%.`,
      });
      return;
    }
  } else if ((expense.markupPct ?? 0) > 0) {
    res.status(409).json({
      error: "markup-without-billable",
      message: "Markup may only be applied when the expense is client-billable.",
    });
    return;
  }

  if (expense.policyStatus === "red") {
    await audit({
      entityType: "expense",
      entityId: expense.id,
      actor: me,
      action: "expense.submit.blocked",
      payload: { reason: "policy-red-block", findings: expense.policyFindings },
      summary: `Submit blocked (RED) on ${expense.merchant ?? expense.id}.`,
    });
    // Task #261 — Expense Auditor Pane A producer. When a submit is blocked
    // by a hard RED policy, emit a Pane A item to the engagement lead (or
    // the submitter when there's no engagement attached) so the violation
    // doesn't sit invisible in the user's wallet. Idempotent on
    // (expense, target_user) so repeated submit attempts don't spam.
    {
      const targets: string[] = [];
      if (expense.engagementId) {
        const [eng] = await db
          .select({ leadId: atelierEngagements.engagementLeadId })
          .from(atelierEngagements)
          .where(eq(atelierEngagements.id, expense.engagementId));
        if (eng?.leadId) targets.push(eng.leadId);
      }
      // Always notify the submitter so the issue is visible in their own
      // Home pane even if there's no engagement lead to copy.
      if (!targets.includes(me.id)) targets.push(me.id);
      const merchantLabel = expense.merchant ?? expense.id;
      const findingsSummary = (expense.policyFindings ?? [])
        .map((f) => f.message)
        .filter(Boolean)
        .slice(0, 2)
        .join(" · ");
      for (const uid of targets) {
        await db
          .insert(atelierPaneAItems)
          .values({
            id: `panea_expense_red_${expense.id}_${uid}`,
            userId: uid,
            title: `Expense RED: ${merchantLabel}`,
            summary: `Expense Auditor blocked submit on ${merchantLabel}${findingsSummary ? ` — ${findingsSummary}` : ""}.`,
            priority: "high",
            hrefKind: "atelier",
            hrefTargetId: "wallet",
            dueLabel: new Date().toISOString().slice(0, 10),
            sortKey: 0,
            createdByUserId: me.id,
          })
          .onConflictDoNothing({ target: atelierPaneAItems.id });
      }
    }
    res.status(409).json({
      error: "policy-red-block",
      message: "Expense violates a hard policy block; edit and retry.",
      findings: expense.policyFindings,
    });
    return;
  }
  if (expense.policyStatus === "amber" && !body.overrideRationale) {
    await audit({
      entityType: "expense",
      entityId: expense.id,
      actor: me,
      action: "expense.submit.blocked",
      payload: { reason: "amber-requires-rationale", findings: expense.policyFindings },
      summary: `Submit blocked (AMBER, no rationale) on ${expense.merchant ?? expense.id}.`,
    });
    res.status(409).json({
      error: "amber-requires-rationale",
      message: "Policy AMBER warning — submit again with `overrideRationale`.",
      findings: expense.policyFindings,
    });
    return;
  }

  await db
    .update(atelierExpenses)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      overrideRationale: body.overrideRationale ?? null,
      updatedAt: new Date(),
    })
    .where(eq(atelierExpenses.id, expense.id));

  await audit({
    entityType: "expense",
    entityId: expense.id,
    actor: me,
    action: "expense.submit",
    payload: {
      policyStatus: expense.policyStatus,
      override: !!body.overrideRationale,
    },
    summary: `Submitted expense ${expense.merchant ?? expense.id} (policy ${expense.policyStatus}${body.overrideRationale ? " · override" : ""})`,
  });

  const [final] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expense.id));
  res.json({ expense: expenseToWire(final, me) });
});

router.post("/wallet/expenses/:id/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me) && me.role !== "engagement_lead") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierExpenses)
    .where(and(eq(atelierExpenses.id, req.params.id), isNull(atelierExpenses.deletedAt)));
  if (!existing) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (existing.status !== "submitted") {
    res.status(409).json({ error: "not-submitted" });
    return;
  }
  // engagement_lead may only approve expenses bound to engagements they lead.
  if (!isPartnerOrOps(me)) {
    if (!existing.engagementId) {
      res.status(403).json({ error: "lead-cannot-approve-firm-overhead" });
      return;
    }
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(eq(atelierEngagements.id, existing.engagementId));
    if (!eng || eng.engagementLeadId !== me.id) {
      res.status(403).json({ error: "not-your-engagement" });
      return;
    }
  }

  await db
    .update(atelierExpenses)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedByUserId: me.id,
      updatedAt: new Date(),
    })
    .where(eq(atelierExpenses.id, existing.id));

  // Materialise the VAT register row.
  const treatmentRate =
    existing.vatTreatment === "ksa_15"
      ? 0.15
      : existing.vatTreatment === "uae_5"
        ? 0.05
        : 0;
  const net = existing.amount - existing.vatAmount;
  const usdNet = +(existing.usdAmount * (net / Math.max(existing.amount, 0.0001))).toFixed(2);
  const usdVat = +(existing.usdAmount - usdNet).toFixed(2);

  await db.insert(atelierVatRegister).values({
    id: rid("vat"),
    expenseId: existing.id,
    expenseDate: existing.expenseDate,
    country: existing.vatCountry ?? "UNK",
    treatment: existing.vatTreatment,
    rate: treatmentRate,
    netAmount: +net.toFixed(2),
    vatAmount: existing.vatAmount,
    grossAmount: existing.amount,
    currency: existing.currency,
    usdNet,
    usdVat,
    usdGross: existing.usdAmount,
    merchant: existing.merchant,
    summary: existing.summary,
  });

  await audit({
    entityType: "expense",
    entityId: existing.id,
    actor: me,
    action: "expense.approve",
    payload: { vatTreatment: existing.vatTreatment, usdGross: existing.usdAmount },
    summary: `Approved ${existing.merchant ?? existing.id} ($${existing.usdAmount.toFixed(2)}); VAT register row written.`,
  });

  const [final] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, existing.id));
  res.json({ expense: expenseToWire(final, me) });
});

router.post("/wallet/expenses/:id/reject", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me) && me.role !== "engagement_lead") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const reason = (req.body?.reason as string) || "rejected";
  const [existing] = await db
    .select()
    .from(atelierExpenses)
    .where(and(eq(atelierExpenses.id, req.params.id), isNull(atelierExpenses.deletedAt)));
  if (!existing) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (existing.status !== "submitted") {
    res.status(409).json({ error: "not-submitted" });
    return;
  }
  // engagement_lead may only reject expenses bound to engagements they lead.
  if (!isPartnerOrOps(me)) {
    if (!existing.engagementId) {
      res.status(403).json({ error: "lead-cannot-reject-firm-overhead" });
      return;
    }
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(eq(atelierEngagements.id, existing.engagementId));
    if (!eng || eng.engagementLeadId !== me.id) {
      res.status(403).json({ error: "not-your-engagement" });
      return;
    }
  }
  await db
    .update(atelierExpenses)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(atelierExpenses.id, existing.id));
  await audit({
    entityType: "expense",
    entityId: existing.id,
    actor: me,
    action: "expense.reject",
    payload: { reason },
    summary: `Rejected ${existing.merchant ?? existing.id}: ${reason}`,
  });
  const [final] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, existing.id));
  res.json({ expense: expenseToWire(final, me) });
});

// =============================================================
// POLICY
// =============================================================
router.get("/wallet/policy", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Admin-only per PRD §4.4: policy view is restricted to partner/operations.
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden", message: "Wallet policy is admin-only." });
    return;
  }
  const rows = await db
    .select()
    .from(atelierExpensePolicies)
    .where(isNull(atelierExpensePolicies.deletedAt))
    .orderBy(atelierExpensePolicies.category);
  res.json({ rules: rows });
});

router.post("/wallet/policy/seed-defaults", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  await db.insert(atelierExpensePolicies).values(DEFAULT_POLICIES).onConflictDoNothing();
  await audit({
    entityType: "wallet_policy",
    entityId: "all",
    actor: me,
    action: "wallet.policy.seed_defaults",
    payload: { count: DEFAULT_POLICIES.length },
    summary: `Seeded ${DEFAULT_POLICIES.length} default expense policies.`,
  });
  res.json({ ok: true, count: DEFAULT_POLICIES.length });
});

router.post("/wallet/policy", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const b = req.body ?? {};
  if (!b.category) {
    res.status(400).json({ error: "category-required" });
    return;
  }
  const id = rid("pol");
  await db.insert(atelierExpensePolicies).values({
    id,
    category: b.category,
    appliesToRole: b.appliesToRole ?? null,
    appliesToCountry: b.appliesToCountry ?? null,
    capAmountUsd: b.capAmountUsd ?? null,
    capUnit: b.capUnit ?? null,
    hardBlockAmountUsd: b.hardBlockAmountUsd ?? null,
    approvalThresholdUsd: b.approvalThresholdUsd ?? null,
    flightClassMax: b.flightClassMax ?? null,
    rationale: b.rationale ?? null,
    active: b.active ?? true,
  });
  await audit({
    entityType: "wallet_policy",
    entityId: id,
    actor: me,
    action: "wallet.policy.create",
    payload: { category: b.category },
    summary: `Created policy rule for ${b.category}`,
  });
  res.status(201).json({ id });
});

router.patch("/wallet/policy/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const b = req.body ?? {};
  await db
    .update(atelierExpensePolicies)
    .set({
      capAmountUsd: b.capAmountUsd,
      capUnit: b.capUnit,
      hardBlockAmountUsd: b.hardBlockAmountUsd,
      approvalThresholdUsd: b.approvalThresholdUsd,
      flightClassMax: b.flightClassMax,
      rationale: b.rationale,
      active: b.active,
      updatedAt: new Date(),
    })
    .where(eq(atelierExpensePolicies.id, req.params.id));
  await audit({
    entityType: "wallet_policy",
    entityId: req.params.id,
    actor: me,
    action: "wallet.policy.update",
    payload: b,
    summary: `Updated policy rule ${req.params.id}`,
  });
  res.json({ ok: true });
});

router.delete("/wallet/policy/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  await db
    .update(atelierExpensePolicies)
    .set({ deletedAt: new Date(), active: false })
    .where(eq(atelierExpensePolicies.id, req.params.id));
  await audit({
    entityType: "wallet_policy",
    entityId: req.params.id,
    actor: me,
    action: "wallet.policy.delete",
    payload: {},
    summary: `Retired policy rule ${req.params.id}`,
  });
  res.json({ ok: true });
});

// =============================================================
// CARDS
// =============================================================
router.get("/wallet/cards", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierCorporateCards)
    .where(isNull(atelierCorporateCards.deletedAt))
    .orderBy(desc(atelierCorporateCards.linkedAt));
  // Non-leadership only sees own cards.
  const filtered = isLeadership(me) ? rows : rows.filter((r) => r.cardholderUserId === me.id);
  // Look up cardholder names.
  const holderIds = Array.from(new Set(filtered.map((c) => c.cardholderUserId)));
  const holders = holderIds.length
    ? await db.select().from(atelierUsers).where(inArray(atelierUsers.id, holderIds))
    : [];
  const nameById = new Map(holders.map((h) => [h.id, h.name]));
  res.json({
    cards: filtered.map((c) => ({
      id: c.id,
      cardholderUserId: c.cardholderUserId,
      cardholderName: nameById.get(c.cardholderUserId) ?? c.label ?? c.cardholderUserId,
      last4: c.last4,
      network: c.provider,
      issuingCurrency: c.currency,
      monthlyLimitUsd: c.monthlyLimitAmount,
      active: c.status === "active",
      linkedAt: c.linkedAt.toISOString(),
    })),
  });
});

// =============================================================
// VAT register
// =============================================================
router.get("/wallet/vat", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierVatRegister)
    .orderBy(desc(atelierVatRegister.expenseDate));

  if ((req.query.format as string) === "csv") {
    const header = [
      "id",
      "expense_id",
      "expense_date",
      "country",
      "treatment",
      "rate",
      "currency",
      "net_amount",
      "vat_amount",
      "gross_amount",
      "usd_net",
      "usd_vat",
      "usd_gross",
      "merchant",
      "summary",
    ].join(",");
    const lines = rows.map((r) =>
      [
        r.id,
        r.expenseId,
        r.expenseDate,
        r.country,
        r.treatment,
        r.rate,
        r.currency,
        r.netAmount,
        r.vatAmount,
        r.grossAmount,
        r.usdNet,
        r.usdVat,
        r.usdGross,
        JSON.stringify(r.merchant ?? ""),
        JSON.stringify(r.summary ?? ""),
      ].join(","),
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="vat-register.csv"`);
    res.send([header, ...lines].join("\n"));
    return;
  }

  // Bucketed summary + raw rows.
  const buckets = new Map<string, { country: string; treatment: string; usdNet: number; usdVat: number; usdGross: number; count: number }>();
  for (const r of rows) {
    const key = `${r.country}::${r.treatment}`;
    const cur = buckets.get(key) ?? { country: r.country, treatment: r.treatment, usdNet: 0, usdVat: 0, usdGross: 0, count: 0 };
    cur.usdNet += r.usdNet;
    cur.usdVat += r.usdVat;
    cur.usdGross += r.usdGross;
    cur.count += 1;
    buckets.set(key, cur);
  }
  res.json({
    buckets: Array.from(buckets.values()).map((b) => ({
      ...b,
      usdNet: +b.usdNet.toFixed(2),
      usdVat: +b.usdVat.toFixed(2),
      usdGross: +b.usdGross.toFixed(2),
    })),
    rows: rows.map((r) => ({ ...r, recordedAt: r.recordedAt.toISOString(), createdAt: r.createdAt.toISOString() })),
  });
});

// =============================================================
// FX seed (ops)
// =============================================================
router.post("/wallet/fx/seed", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const days = Number(req.body?.days ?? 60);
  const written = await seedFxRates(days);
  res.json({ ok: true, written });
});

router.get("/wallet/fx", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const quote = (req.query.quote as string)?.toUpperCase() || null;
  let rows = await db.select().from(atelierFxRates).orderBy(desc(atelierFxRates.date));
  if (quote) rows = rows.filter((r) => r.quote === quote);
  res.json({ rates: rows.slice(0, 200) });
});

// =============================================================
// Retention sweep — 90d OCR-payload redaction
// =============================================================
/**
 * Reusable 90-day OCR-payload redaction sweep. Called both by the manual
 * POST /wallet/retention/run endpoint and by the daily wallet-retention
 * cron in lib/scheduler.ts.
 */
export async function runWalletRetentionSweep(): Promise<{ redacted: number; scanned: number }> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const candidates = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        isNull(atelierExpenses.deletedAt),
        isNull(atelierExpenses.ocrPayloadRedactedAt),
        lt(atelierExpenses.createdAt, cutoff),
      ),
    );
  let redacted = 0;
  for (const c of candidates) {
    if (!c.ocrPayload) continue;
    await db
      .update(atelierExpenses)
      .set({
        ocrPayload: null,
        ocrPayloadRedactedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(atelierExpenses.id, c.id));
    redacted++;
  }
  return { redacted, scanned: candidates.length };
}

router.post("/wallet/retention/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const result = await runWalletRetentionSweep();
  await audit({
    entityType: "wallet_retention",
    entityId: "sweep",
    actor: me,
    action: "wallet.retention.run",
    payload: result,
    summary: `Retention sweep: redacted ${result.redacted}/${result.scanned} OCR payloads older than 90d.`,
  });
  res.json({ ok: true, ...result });
});

// =============================================================
// Task #260 — Client-billable expenses · /wallet/client-billable
// =============================================================
router.get("/wallet/client-billable/:engagementId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eid = req.params.engagementId;
  if (!(await ensureEngagementAccess(req, res, me, eid))) return;
  // Third-gate queue: only expenses already approved by the lead are
  // candidates for client invoicing. Drafts / submitted / rejected rows
  // are filtered out so the page shows the *invoiceable* set.
  const rows = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.engagementId, eid),
        eq(atelierExpenses.clientBillable, true),
        eq(atelierExpenses.status, "approved"),
        isNull(atelierExpenses.deletedAt),
      ),
    )
    .orderBy(desc(atelierExpenses.expenseDate));
  // Run sentinel on each row so the UI surfaces RED/AMBER blockers
  // (markup outside band, blocked category, missing receipt, etc.)
  // before the Lead clicks "Compose draft".
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const sentinel = await expensePublishSentinelChecks({ expenseId: r.id });
      return {
        id: r.id,
        personId: r.personId,
        expenseDate: r.expenseDate,
        merchant: r.merchant,
        category: r.category,
        amount: r.amount,
        currency: r.currency,
        usdAmount: r.usdAmount,
        markupPct: r.markupPct,
        status: r.status,
        policyStatus: r.policyStatus,
        summary: r.summary,
        sentinel: {
          status: sentinel.status,
          confidence: sentinel.confidence,
          publishAllowed: sentinel.publishAllowed,
          // RED rows must surface a redaction proposal so the lead has
          // a concrete remediation path before re-running the third
          // gate; AMBER/GREEN rows return null.
          redactionProposal: sentinel.redactionProposal,
          findings: sentinel.checks
            .filter((c) => c.status !== "pass")
            .map((c) => ({ name: c.name, status: c.status, detail: c.detail })),
        },
      };
    }),
  );
  const sentinelStatusCounts = enriched.reduce(
    (acc, e) => {
      acc[e.sentinel.status] = (acc[e.sentinel.status] ?? 0) + 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 } as Record<string, number>,
  );
  res.json({
    engagementId: eid,
    expenses: enriched,
    totals: {
      count: rows.length,
      netUsd: +rows.reduce((s, r) => s + r.usdAmount, 0).toFixed(2),
      markupUsd: +rows.reduce((s, r) => s + r.usdAmount * ((r.markupPct ?? 0) / 100), 0).toFixed(2),
      sentinel: sentinelStatusCounts,
    },
  });
});

// =============================================================
// Task #260 — Payment Proposals · /wallet/approvals (Partner-only)
// =============================================================
router.get("/wallet/approvals", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const status = (req.query.status as string) ?? "proposed";
  const cps = await db
    .select()
    .from(atelierContractorPayments)
    .where(
      and(
        isNull(atelierContractorPayments.deletedAt),
        eq(atelierContractorPayments.status, status),
      ),
    )
    .orderBy(desc(atelierContractorPayments.createdAt));
  const pfis = await db
    .select()
    .from(atelierPartnerFirmInvoices)
    .where(
      and(
        isNull(atelierPartnerFirmInvoices.deletedAt),
        eq(atelierPartnerFirmInvoices.status, status),
      ),
    )
    .orderBy(desc(atelierPartnerFirmInvoices.createdAt));
  // Group by payee so the partner sees one row per contractor / firm,
  // not a flat list. Per-payee totals + child rows make weekly approval
  // a one-click decision per person.
  type CpRow = (typeof cps)[number];
  type PfRow = (typeof pfis)[number];
  const cpByPayee = new Map<string, { payeeUserId: string; payeeName: string; totalUsd: number; weekCount: number; rows: CpRow[] }>();
  for (const r of cps) {
    const g = cpByPayee.get(r.payeeUserId) ?? {
      payeeUserId: r.payeeUserId,
      payeeName: r.payeeName,
      totalUsd: 0,
      weekCount: 0,
      rows: [],
    };
    g.totalUsd = +(g.totalUsd + r.usdAmount).toFixed(2);
    g.weekCount += 1;
    g.rows.push(r);
    cpByPayee.set(r.payeeUserId, g);
  }
  const pfByFirm = new Map<string, { partnerFirmId: string; partnerFirmName: string; totalUsd: number; weekCount: number; rows: PfRow[] }>();
  for (const r of pfis) {
    const g = pfByFirm.get(r.partnerFirmId) ?? {
      partnerFirmId: r.partnerFirmId,
      partnerFirmName: r.partnerFirmName,
      totalUsd: 0,
      weekCount: 0,
      rows: [],
    };
    g.totalUsd = +(g.totalUsd + r.usdAmount).toFixed(2);
    g.weekCount += 1;
    g.rows.push(r);
    pfByFirm.set(r.partnerFirmId, g);
  }
  res.json({
    contractorPayments: cps,
    partnerFirmInvoices: pfis,
    contractorPayeeGroups: Array.from(cpByPayee.values()).sort((a, b) => b.totalUsd - a.totalUsd),
    partnerFirmGroups: Array.from(pfByFirm.values()).sort((a, b) => b.totalUsd - a.totalUsd),
    totals: {
      contractorCount: cps.length,
      partnerFirmCount: pfis.length,
      contractorPayeeCount: cpByPayee.size,
      partnerFirmPayeeCount: pfByFirm.size,
      contractorUsd: +cps.reduce((s, r) => s + r.usdAmount, 0).toFixed(2),
      partnerFirmUsd: +pfis.reduce((s, r) => s + r.usdAmount, 0).toFixed(2),
    },
  });
});

router.post("/wallet/approvals/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner" && !isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const weeksIso = Array.isArray(req.body?.weeksIso) ? req.body.weeksIso : undefined;
  const summary = await runPaymentProposer({ triggeredBy: me.id, weeksIso });
  await audit({
    entityType: "wallet_payment_proposer",
    entityId: "manual",
    actor: me,
    action: "wallet.payment_proposer.run",
    payload: summary as unknown as Record<string, unknown>,
    summary: `Proposer composed ${summary.contractorProposals.created}+${summary.partnerFirmProposals.created} proposal(s).`,
  });
  res.json({ ok: true, summary });
});

router.post("/wallet/approvals/contractor/:id/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierContractorPayments)
    .where(
      and(
        eq(atelierContractorPayments.id, req.params.id),
        isNull(atelierContractorPayments.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (row.status !== "proposed") {
    res.status(409).json({ error: "not-proposed", status: row.status });
    return;
  }
  const rationale = (req.body?.rationale as string) || null;
  await db
    .update(atelierContractorPayments)
    .set({
      status: "partner_approved",
      partnerApprovedByUserId: me.id,
      partnerApprovedAt: new Date(),
      partnerRationale: rationale,
      updatedAt: new Date(),
    })
    .where(eq(atelierContractorPayments.id, row.id));
  await audit({
    entityType: "contractor_payment",
    entityId: row.id,
    actor: me,
    action: "wallet.payment.approve",
    payload: { usdAmount: row.usdAmount, rationale },
    summary: `Approved $${row.usdAmount.toFixed(2)} for ${row.payeeName} (${row.weekIso}).`,
  });
  res.json({ ok: true });
});

router.post("/wallet/approvals/contractor/:id/reject", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const reason = (req.body?.reason as string) || "rejected";
  const [row] = await db
    .select()
    .from(atelierContractorPayments)
    .where(
      and(
        eq(atelierContractorPayments.id, req.params.id),
        isNull(atelierContractorPayments.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  // Mirror the approve endpoint: only proposed rows are eligible for
  // rejection. Approved/paid rows must be reversed via a new flow, not
  // silently flipped back to rejected.
  if (row.status !== "proposed") {
    res.status(409).json({ error: "not-proposed", status: row.status });
    return;
  }
  await db
    .update(atelierContractorPayments)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(atelierContractorPayments.id, row.id));
  await audit({
    entityType: "contractor_payment",
    entityId: row.id,
    actor: me,
    action: "wallet.payment.reject",
    payload: { reason },
    summary: `Rejected ${row.payeeName} (${row.weekIso}): ${reason}`,
  });
  res.json({ ok: true });
});

router.post("/wallet/approvals/partner-firm/:id/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierPartnerFirmInvoices)
    .where(
      and(
        eq(atelierPartnerFirmInvoices.id, req.params.id),
        isNull(atelierPartnerFirmInvoices.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (row.status !== "proposed") {
    res.status(409).json({ error: "not-proposed", status: row.status });
    return;
  }
  const rationale = (req.body?.rationale as string) || null;
  await db
    .update(atelierPartnerFirmInvoices)
    .set({
      status: "partner_approved",
      partnerApprovedByUserId: me.id,
      partnerApprovedAt: new Date(),
      partnerRationale: rationale,
      updatedAt: new Date(),
    })
    .where(eq(atelierPartnerFirmInvoices.id, row.id));
  await audit({
    entityType: "partner_firm_invoice",
    entityId: row.id,
    actor: me,
    action: "wallet.payment.approve",
    payload: { usdAmount: row.usdAmount, rationale },
    summary: `Approved $${row.usdAmount.toFixed(2)} for ${row.partnerFirmName} (${row.weekIso}).`,
  });
  res.json({ ok: true });
});

router.post("/wallet/approvals/partner-firm/:id/reject", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const reason = (req.body?.reason as string) || "rejected";
  const [row] = await db
    .select()
    .from(atelierPartnerFirmInvoices)
    .where(
      and(
        eq(atelierPartnerFirmInvoices.id, req.params.id),
        isNull(atelierPartnerFirmInvoices.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  // Mirror the approve endpoint: only proposed rows are eligible for
  // rejection. Approved/paid rows must be reversed via a new flow, not
  // silently flipped back to rejected.
  if (row.status !== "proposed") {
    res.status(409).json({ error: "not-proposed", status: row.status });
    return;
  }
  await db
    .update(atelierPartnerFirmInvoices)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(atelierPartnerFirmInvoices.id, row.id));
  await audit({
    entityType: "partner_firm_invoice",
    entityId: row.id,
    actor: me,
    action: "wallet.payment.reject",
    payload: { reason },
    summary: `Rejected ${row.partnerFirmName} (${row.weekIso}): ${reason}`,
  });
  res.json({ ok: true });
});

// =============================================================
// Task #260 — Invoice-line drafts · /wallet/invoice-drafts/:eid
// =============================================================
router.get("/wallet/invoice-drafts/:engagementId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eid = req.params.engagementId;
  if (!(await ensureEngagementAccess(req, res, me, eid))) return;
  const [current] = await db
    .select()
    .from(atelierInvoiceLineDrafts)
    .where(
      and(
        eq(atelierInvoiceLineDrafts.engagementId, eid),
        isNull(atelierInvoiceLineDrafts.deletedAt),
      ),
    )
    .orderBy(desc(atelierInvoiceLineDrafts.composedAt));
  if (req.query.format === "csv") {
    if (!current) {
      res.status(404).type("text/plain").send("no draft");
      return;
    }
    const headers = ["kind", "sourceId", "description", "qty", "unitPriceUsd", "amountUsd", "markupPct"];
    const lines = current.lines as Array<{
      kind: string;
      sourceId: string;
      description: string;
      qty: number;
      unitPriceUsd: number;
      amountUsd: number;
      markupPct?: number;
    }>;
    const csv = [
      headers.join(","),
      ...lines.map((l) =>
        [
          l.kind,
          l.sourceId,
          `"${(l.description || "").replace(/"/g, "''")}"`,
          l.qty,
          l.unitPriceUsd,
          l.amountUsd,
          l.markupPct ?? "",
        ].join(","),
      ),
      `,,,TOTAL,,${(current.totals as { totalUsd: number }).totalUsd},`,
    ].join("\n");
    res
      .type("text/csv")
      .header("content-disposition", `attachment; filename="invoice-draft-${eid}.csv"`)
      .send(csv);
    return;
  }
  res.json({ engagementId: eid, draft: current ?? null });
});

// =============================================================
// Task #260 — Publish Sentinel (kind=expense) extension. Routes the
// expense through the SAME runPublishSentinel agent the v2 deliverable
// flow uses, but feeds it pre-computed expense checks so the result is
// recorded as a normal sentinel run on the agent runs page.
// =============================================================
router.post("/wallet/expenses/:id/publish-sentinel", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Resolve the expense's engagement first, then enforce the same
  // engagement-ownership check used by approve/reject so a lead can't
  // sentinel an expense on someone else's engagement.
  const [ex] = await db
    .select()
    .from(atelierExpenses)
    .where(and(eq(atelierExpenses.id, req.params.id), isNull(atelierExpenses.deletedAt)));
  if (!ex) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (!isPartnerOrOps(me)) {
    if (me.role !== "engagement_lead") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!ex.engagementId) {
      res.status(403).json({ error: "lead-cannot-sentinel-firm-overhead" });
      return;
    }
    if (!(await ensureEngagementAccess(req, res, me, ex.engagementId))) return;
  }
  const expenseChecks = await expensePublishSentinelChecks({ expenseId: req.params.id });
  const sentinel = await runPublishSentinel({
    triggeredByUserId: me.id,
    actorLabel: me.name,
    deliverableId: req.params.id,
    deliverableLabel: `expense ${req.params.id}`,
    body: "",
    kind: "expense",
    precomputedChecks: expenseChecks.checks,
  });
  await audit({
    entityType: "expense",
    entityId: req.params.id,
    actor: me,
    action: "wallet.publish_sentinel.run",
    payload: { runId: sentinel.runId, status: sentinel.output.status },
    summary: `Publish Sentinel (kind=expense): ${sentinel.output.status} — ${sentinel.output.checks.length} check(s).`,
  });
  res.json({ ok: true, runId: sentinel.runId, sentinel: sentinel.output });
});

router.post("/wallet/invoice-drafts/:engagementId/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const eid = req.params.engagementId;
  if (!(await ensureEngagementAccess(req, res, me, eid))) return;
  const out = await runInvoiceComposer({
    engagementId: eid,
    composedByUserId: me.id,
  });
  await audit({
    entityType: "invoice_line_draft",
    entityId: out.draftId,
    actor: me,
    action: "wallet.invoice_composer.run",
    payload: out.totals,
    summary: `Composed ${out.totals.lineCount} line(s); $${out.totals.totalUsd.toFixed(2)}.`,
  });
  res.json({ ok: true, draft: out });
});

export default router;
