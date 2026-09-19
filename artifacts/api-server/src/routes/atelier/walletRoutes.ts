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
  atelierPartnerFirms,
  atelierPartnerFirmHours,
  atelierTimesheetEntries,
  atelierInvoiceLineDrafts,
  atelierPaneAItems,
  atelierEmployees,
  atelierRosterReportsTo,
  atelierEngagementBudget,
  atelierEngagementExpenseAlerts,
  atelierContractors,
  atelierContractRecords,
  atelierContractDocuments,
} from "@workspace/db";
// Task #383 — taxonomy + merchant memory.
import { learnMerchantMapping } from "../../lib/atelier-expense-categorizer.js";
import {
  startBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  getJobById,
  hasRunningJob,
} from "../../lib/background-jobs.js";
import { resolveCategoryPair, policyKeyFor } from "../../lib/atelier-expense-taxonomy.js";
// Task #1092 — attribution parity for wallet create (incl. pre-formation entities).
import { resolveExpenseExtras } from "../../lib/atelier-expense-attribution.js";
import { convertToUsd, seedFxRates } from "../../lib/atelier-fx.js";
import { evaluateExpense, defaultPoliciesForOrg, ensureDefaultExpensePolicies, POLICY_PRINCIPLES } from "../../lib/atelier-expense-policy.js";
import { assertAuditAction } from "./auditContract.js";
// Task #53 — Me-home notification cards on expense status changes.
import { emitSelfNotification } from "./meRoutes";
import { invalidateFinanceFacts } from "./financeRealFacts";
import { RECEIPT_FIXTURES, resolveFixtureDate } from "../../lib/atelier-receipt-fixtures.js";
import { runExpenseAuditor, runPublishSentinel } from "../../lib/atelier-agents/runner.js";
import { runPaymentProposer } from "../../lib/atelier-payment-proposer.js";
import { runInvoiceComposer, expensePublishSentinelChecks } from "../../lib/atelier-invoice-composer.js";
// Task #76 — stream stored receipt images to approvers/finance.
import { ObjectStorageService, ObjectNotFoundError } from "../../lib/objectStorage.js";
import { sendReceiptForDisplay } from "../../lib/atelier-heic.js";
// Task #396 — shared receipt/invoice parse pipeline + merchant enrichment.
import { parseReceiptForExpense } from "../../lib/atelier-receipt-parse.js";
import {
  proposeExpenseAllocation,
  decideAllocation,
} from "../../lib/atelier-entity-allocation.js";
import { isGlPeriodLocked } from "../../lib/atelier-agents/bookkeeper.js";
import { atelierGlJournalEntry } from "@workspace/db";
import { runMerchantEnrichment } from "../../lib/atelier-merchant/enrichment.js";
// Task #408 — manual merchant corrections feed org-scoped aliases.
import { rememberMerchantAlias, listAliasMatchKeys } from "../../lib/atelier-merchant/aliases.js";
import { normalizeMerchant } from "../../lib/atelier-merchant/normalizer.js";
import { atelierUnmatchedMerchants } from "@workspace/db";
import { normalizeContingencyType, wireReimbursementTrigger, resolveExpenseBeneficiary } from "../../lib/atelier-expense-lifecycle.js";

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

// Task #292 — 9-persona model. Wallet "leadership" = partner-tier + finance
// (operations split → finance for wallet/payroll). Per-engagement leads
// (formerly engagement_lead) are now senior_manager and are checked
// separately via the engagement-scoped guards below.
function isLeadership(me: typeof atelierUsers.$inferSelect): boolean {
  return (
    me.role === "founding_partner" ||
    me.role === "partner" ||
    me.role === "finance"
  );
}
function isPartnerOrOps(me: typeof atelierUsers.$inferSelect): boolean {
  return isLeadership(me);
}

// Task #1343 — payment decisions are a maker-checker boundary. Finance is
// allowed at this financial approval stage, while partner-tier eligibility is
// retained. A founding partner may use the existing, documented founder
// self-approval policy; the decision audit stamps that exception.
function canApprovePayment(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner" || me.role === "founding_partner" || me.role === "finance";
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

// -------
// Receipt encryption stub
// -------
function encryptedReceiptRef(rawKey: string): string {
  // Application-layer indicator only — no live KMS in this build.
  return `enc:wallet:${rawKey}`;
}

// -------
// Build OCR + contract digest for the Auditor
// -------
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
import { contentDispositionFilename } from "../../lib/httpFilename.js";

// Inline definition retained as a typed wrapper that delegates to the
// shared module so existing call sites keep their import.
// buildContractDigest moved to lib/atelier-contract-digest.ts so it can
// be reused by the wallet sentinel without creating a route ↔ lib cycle.

// -------
// EXPENSES
// -------
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
    // Task #396 — layered merchant normalization output.
    merchantNormalized: e.merchantNormalized,
    merchantResolution: e.merchantResolution,
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
    // Task #53 — Me-lens claim context + reimbursement lifecycle.
    contextType: e.contextType,
    accountId: e.accountId,
    internalProjectLabel: e.internalProjectLabel,
    // Task #383 — taxonomy + attribution + funding.
    categoryCode: e.categoryCode,
    subCategoryCode: e.subCategoryCode,
    categorySource: e.categorySource,
    bdIndustry: e.bdIndustry,
    entityId: e.entityId,
    costCenter: e.costCenter,
    fundingSource: e.fundingSource,
    fundingBankAccountId: e.fundingBankAccountId,
    businessPurpose: e.businessPurpose,
    beneficiaryUserId: e.beneficiaryUserId,
    owedTo: e.beneficiaryName,
    beneficiaryName: e.beneficiaryName,
    contingencyType: e.contingencyType,
    reimbursementTrigger: wireReimbursementTrigger(e.contingencyType),
    contingencyStatus: e.contingencyStatus,
    projectOutcome: e.projectOutcome,
    recoveryStatus: e.recoveryStatus,
    directCostStatus: e.directCostStatus,
    timesheetWeekId: e.timesheetWeekId,
    approvalRoute: e.approvalRoute,
    // Task #1095 — entity-allocation lifecycle + trip context.
    allocStatus: e.allocStatus,
    allocRuleId: e.allocRuleId,
    allocJustification: e.allocJustification,
    allocConfidence: e.allocConfidence,
    allocDecidedBy: e.allocDecidedBy,
    allocShared: e.allocShared,
    allocApprovedByUserId: e.allocApprovedByUserId,
    allocApprovedAt: e.allocApprovedAt?.toISOString() ?? null,
    allocOverrideReason: e.allocOverrideReason,
    tripDestinationCountry: e.tripDestinationCountry,
    tripPurpose: e.tripPurpose,
    tripContextSource: e.tripContextSource,
    reimbursedAt: e.reimbursedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

// -------
// Task #383 — dual-route approval helpers
// -------

/** Resolve a user id to their roster person id (userId link, then email). */
async function personIdForUser(userId: string): Promise<string | null> {
  const [byUser] = await db
    .select({ id: atelierEmployees.id })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.userId, userId), isNull(atelierEmployees.deletedAt)))
    .limit(1);
  if (byUser) return byUser.id;
  const [u] = await db.select({ email: atelierUsers.email, orgId: atelierUsers.orgId })
    .from(atelierUsers).where(eq(atelierUsers.id, userId));
  if (!u?.email) return null;
  const [byEmail] = await db
    .select({ id: atelierEmployees.id })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.email, u.email), eq(atelierEmployees.orgId, u.orgId), isNull(atelierEmployees.deletedAt)))
    .limit(1);
  return byEmail?.id ?? null;
}

/** True when `approver` transitively manages the submitter (BFS over ALL
 *  reports_to edges — multi-manager possible, cycle-safe, org-scoped). */
async function lineManages(
  approver: typeof atelierUsers.$inferSelect,
  submitterUserId: string,
): Promise<boolean> {
  const [approverPerson, submitterPerson] = await Promise.all([
    personIdForUser(approver.id),
    personIdForUser(submitterUserId),
  ]);
  if (!approverPerson || !submitterPerson) return false;
  const edges = await db
    .select({
      personId: atelierRosterReportsTo.personId,
      managerPersonId: atelierRosterReportsTo.managerPersonId,
    })
    .from(atelierRosterReportsTo)
    .where(eq(atelierRosterReportsTo.orgId, approver.orgId));
  const byManager = new Map<string, string[]>();
  for (const e of edges) {
    const arr = byManager.get(e.managerPersonId) ?? [];
    arr.push(e.personId);
    byManager.set(e.managerPersonId, arr);
  }
  const queue = [approverPerson];
  const visited = new Set<string>([approverPerson]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of byManager.get(cur) ?? []) {
      if (child === submitterPerson) return true;
      if (visited.has(child)) continue;
      visited.add(child);
      queue.push(child);
    }
  }
  return false;
}

/**
 * Dual-route approval authority. Project-linked (engagementId) expenses
 * route to the ENGAGEMENT LEAD; internal/non-project ones to the LINE
 * MANAGER (BFS scope) or HR. Partner-tier + finance may approve anything.
 * Returns the approval route stamp, or null (+403 written) when the
 * caller has no authority over this expense.
 */
async function resolveApprovalAuthority(
  res: Response,
  me: typeof atelierUsers.$inferSelect,
  expense: typeof atelierExpenses.$inferSelect,
): Promise<string | null> {
  // Task #501 — self-approval: ONLY founding partners may approve/reject
  // their own claim (stamped distinctly as `founder_self`). Every other
  // role — including partner and finance leadership — gets an explicit
  // 403 before any leadership/HR/line-manager route can resolve.
  if (expense.personId === me.id) {
    if (me.role === "founding_partner") return "founder_self";
    res.status(403).json({
      error: "no-self-approval",
      message: "You cannot approve or reject your own expense claim.",
    });
    return null;
  }
  if (expense.engagementId) {
    const [eng] = await db
      .select({ leadId: atelierEngagements.engagementLeadId })
      .from(atelierEngagements)
      .where(eq(atelierEngagements.id, expense.engagementId));
    if (eng?.leadId === me.id) return "engagement_lead";
    if (isLeadership(me)) return "leadership";
    res.status(403).json({
      error: "not-your-engagement",
      message: "Project-linked expenses are approved by the engagement lead (or leadership).",
    });
    return null;
  }
  if (me.role === "hr") return "hr";
  if (isLeadership(me)) return "leadership";
  if (await lineManages(me, expense.personId)) return "line_manager";
  res.status(403).json({
    error: "forbidden",
    message: "Internal expenses are approved by the claimant's line manager, HR, or leadership.",
  });
  return null;
}

/**
 * Task #501 — every submitted expense must land visibly in BOTH founders'
 * queues. Notify all founding_partner users in the claim's org when a
 * claim is submitted (any source: wallet or Me lens). The submitting
 * founder is skipped so they aren't notified twice about their own claim.
 */
export async function notifyFoundersOfSubmittedExpense(expense: {
  id: string;
  orgId: string;
  personId: string;
  merchant: string | null;
  currency: string;
  amount: number;
}): Promise<void> {
  const founders = await db
    .select({ id: atelierUsers.id })
    .from(atelierUsers)
    .where(
      and(
        eq(atelierUsers.orgId, expense.orgId),
        eq(atelierUsers.role, "founding_partner"),
        isNull(atelierUsers.deletedAt),
      ),
    );
  const [submitter] = await db
    .select({ name: atelierUsers.name })
    .from(atelierUsers)
    .where(eq(atelierUsers.id, expense.personId));
  for (const f of founders) {
    if (f.id === expense.personId) continue;
    await emitSelfNotification({
      orgId: expense.orgId,
      userId: f.id,
      kind: "expense_submitted",
      title: "Expense claim awaiting approval",
      body: `${submitter?.name ?? expense.personId} — ${expense.merchant ?? "expense"} ${expense.currency} ${expense.amount.toFixed(2)} is ready for review.`,
      href: "/wallet/expenses",
    });
  }
}

/**
 * Task #383 — after an approval, check the engagement's expense budget and
 * notify the engagement lead once per 80%/100% crossing (dedupe ledger;
 * re-arms when the budget is raised because the row keys on threshold and
 * we only insert when the crossing is real at current budget).
 */
export async function checkEngagementExpenseBudget(engagementId: string): Promise<void> {
  const [budget] = await db
    .select()
    .from(atelierEngagementBudget)
    .where(eq(atelierEngagementBudget.engagementId, engagementId));
  const cap = budget?.budgetExpensesUsd ?? 0;
  if (!budget || cap <= 0) return;
  const spentRows = await db
    .select({ usd: atelierExpenses.usdAmount })
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.engagementId, engagementId),
        inArray(atelierExpenses.status, ["approved", "reimbursed"]),
        isNull(atelierExpenses.deletedAt),
      ),
    );
  const spent = spentRows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const pct = (spent / cap) * 100;
  const [eng] = await db
    .select({ leadId: atelierEngagements.engagementLeadId, name: atelierEngagements.name, orgId: atelierEngagements.orgId })
    .from(atelierEngagements)
    .where(eq(atelierEngagements.id, engagementId));
  for (const threshold of [80, 100]) {
    if (pct < threshold) continue;
    const inserted = await db
      .insert(atelierEngagementExpenseAlerts)
      .values({
        id: rid("engexpal"),
        engagementId,
        threshold,
        budgetUsdAtNotify: cap,
        spentUsdAtNotify: +spent.toFixed(2),
        notifiedUserId: eng?.leadId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: atelierEngagementExpenseAlerts.id });
    if (inserted.length > 0 && eng?.leadId) {
      await emitSelfNotification({
        orgId: eng.orgId,
        userId: eng.leadId,
        kind: "engagement_expense_budget",
        title: `Expense budget ${threshold >= 100 ? "reached" : "at 80%"}: ${eng.name}`,
        body: `Approved expenses $${spent.toFixed(0)} of $${cap.toFixed(0)} budget (${pct.toFixed(0)}%).`,
        href: "/wallet",
      });
    }
  }
}

// @cli-skip: pending Task #340 read-parity migration
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
  if (me.role !== "senior_manager") { // Task #292 — engagement_lead → senior_manager
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
// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
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

// Task #76 — stream the attached receipt so approvers/finance can inspect it
// before deciding. Same app-level ACL as the detail route (owner or
// leadership); the object lives in private object storage, so the app ACL is
// the authorization boundary here — leadership are not the object owner and
// would fail the storage-level owner check, hence no canAccessObjectEntity.
// @cli-skip: binary receipt stream; no CLI shape (Task #76)
router.get("/wallet/expenses/:id/receipt", async (req, res) => {
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
  if (!row.receiptFileRef || !row.receiptFileRef.startsWith("/objects/")) {
    res.status(404).json({ error: "no-receipt" });
    return;
  }
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(row.receiptFileRef);
    const response = await svc.downloadObject(file, 60);
    // Task #554 — HEIC receipts convert to JPEG on the fly for display.
    await sendReceiptForDisplay(res, response);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "no-receipt" });
      return;
    }
    throw err;
  }
});

interface CreateExpenseBody {
  expenseDate?: string;
  captureSource?: "card_feed" | "manual" | "mileage" | "per_diem";
  cardId?: string | null;
  engagementId?: string | null;
  merchant?: string;
  description?: string;
  businessPurpose?: string;
  beneficiaryUserId?: string;
  owedTo?: string;
  contingencyType?: "none" | "win" | "project_start";
  reimbursementTrigger?: "none" | "win" | "project_start";
  governingContractId?: string;
  governingContractVersionId?: string;
  fundingSource?: "personal_claim" | "partner_paid" | "company_account";
  fundingBankAccountId?: string | null;
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
  // Task #1095 — trip context (destination ISO-2 + purpose).
  tripDestinationCountry?: string;
  tripPurpose?: string;
  // Task #1092 — attribution parity with the Me-lens create path so
  // internal spend (incl. pre-formation entities) can be tagged at create.
  contextType?: "bd" | "account" | "engagement" | "internal";
  accountId?: string | null;
  entityId?: string | null;
  costCenter?: string | null;
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/expenses", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const b = (req.body ?? {}) as CreateExpenseBody;
  const captureSource = (b.captureSource ?? "manual") as
    | "card_feed"
    | "manual"
    | "mileage"
    | "per_diem";
  // Task #757 — validation parity with the Me-lens create path: ISO date,
  // 3-letter currency, capped merchant/description, bounded amount.
  const dateStr =
    typeof b.expenseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.expenseDate)
      ? b.expenseDate
      : new Date().toISOString().slice(0, 10);

  // Compute amount from path-specific inputs if not given.
  let amount = Number(b.amount ?? 0);
  let currency = String(b.currency ?? "USD").toUpperCase().slice(0, 3);
  let merchant = String(b.merchant ?? "").trim().slice(0, 200);
  let category = String(b.category ?? "other").trim() || "other";
  const description =
    typeof b.description === "string" && b.description.trim()
      ? b.description.slice(0, 2000)
      : null;
  const businessPurpose = typeof b.businessPurpose === "string" ? b.businessPurpose.trim().slice(0, 1000) : "";
  const beneficiaryResult = await resolveExpenseBeneficiary(me.orgId, b.beneficiaryUserId ?? b.owedTo ?? me.id);
  if (!beneficiaryResult.beneficiary) {
    res.status(409).json({ error: beneficiaryResult.ambiguous ? "beneficiary-ambiguous" : "beneficiary-not-found" });
    return;
  }
  const beneficiary = beneficiaryResult.beneficiary;
  const contingencyType = normalizeContingencyType(b.contingencyType ?? b.reimbursementTrigger);
  const fundingSource = b.fundingSource ?? "personal_claim";
  if (fundingSource === "personal_claim" && beneficiary.id !== me.id) {
    res.status(400).json({ error: "personal-claim-beneficiary-must-be-self" });
    return;
  }
  if (fundingSource === "company_account" && beneficiary.id !== me.id) {
    res.status(400).json({ error: "company-account-no-beneficiary" });
    return;
  }
  if (me.role === "non_equity_partner") {
    const canonicalPersonId = me.personId ?? me.id;
    let contractId = b.governingContractId;
    let versionId = b.governingContractVersionId;
    if (!contractId || !versionId) {
      const [contractor] = await db.select({ id: atelierContractors.id, personId: atelierContractors.personId })
        .from(atelierContractors).where(and(eq(atelierContractors.orgId, me.orgId), eq(atelierContractors.personId, canonicalPersonId), isNull(atelierContractors.deletedAt)));
      const [auto] = await db.select().from(atelierContractRecords).where(and(
        eq(atelierContractRecords.orgId, me.orgId), eq(atelierContractRecords.status, "signed"),
        eq(atelierContractRecords.counterpartyKind, "person"),
        eq(atelierContractRecords.personId, contractor?.personId ?? canonicalPersonId),
      )).orderBy(desc(atelierContractRecords.updatedAt)).limit(1);
      contractId = auto?.id;
      versionId = auto?.currentDocumentId ?? undefined;
    }
    if (!contractId || !versionId) {
      res.status(409).json({ error: "signed-governing-contract-required" });
      return;
    }
    const [contract] = await db.select().from(atelierContractRecords).where(and(
      eq(atelierContractRecords.id, contractId),
      eq(atelierContractRecords.orgId, me.orgId),
      eq(atelierContractRecords.status, "signed"),
      eq(atelierContractRecords.personId, canonicalPersonId),
    ));
    const [version] = await db.select().from(atelierContractDocuments).where(and(
      eq(atelierContractDocuments.id, versionId),
      eq(atelierContractDocuments.contractId, contractId),
    ));
    if (!contract || !version || contract.currentDocumentId !== versionId ||
      !["non_equity_partner_employment", "contractor_agreement"].includes(contract.contractType)) {
      res.status(409).json({ error: "signed-governing-contract-required" });
      return;
    }
    (b as any).governingContractId = contractId;
    (b as any).governingContractVersionId = versionId;
    const scope = (contract.fieldValues ?? {}) as Record<string, unknown>;
    const categories = scope.expenseCategories ?? scope.allowedExpenseCategories;
    const projects = scope.projectIds ?? scope.allowedProjects;
    if (Array.isArray(categories) && categories.length > 0 && !categories.includes(category)) {
      res.status(409).json({ error: "expense-category-not-in-agreement" });
      return;
    }
    if (Array.isArray(projects) && projects.length > 0 && !projects.includes(b.engagementId)) {
      res.status(409).json({ error: "expense-project-not-in-agreement" });
      return;
    }
  }
  if (contingencyType !== "none" && fundingSource !== "partner_paid") {
    res.status(400).json({ error: "contingency-requires-partner-funding" });
    return;
  }
  if (contingencyType !== "none" && b.contextType !== "engagement" && b.contextType !== "account") {
    res.status(400).json({ error: "contingency-requires-pursuit-context" });
    return;
  }
  if (!businessPurpose) {
    res.status(400).json({ error: "business-purpose-required", message: "Explain the business purpose before saving the claim." });
    return;
  }

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

  // Task #757 — bound the final amount the same way the Me-lens create does.
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    res.status(400).json({ error: "invalid-amount" });
    return;
  }

  const fx = await convertToUsd(amount, currency, dateStr);

  // Task #1092 — optional internal attribution at create time (same
  // shared validator as the Me-lens path; in_formation entities are
  // valid targets for the pre-formation cost pools). BD/account spend
  // keeps its existing flow (attribution set post-create via PATCH).
  const wantContext = b.contextType === "internal";
  let extras: import("../../lib/atelier-expense-attribution.js").ExpenseExtrasPatch | null = await resolveExpenseExtras(
    res,
    me.orgId,
    b as Record<string, unknown>,
    { contextType: wantContext ? "internal" : (b.contextType ?? "bd"), accountId: b.accountId ?? null, personId: me.id },
  );
  if (!extras) return; // 4xx already written

  const id = rid("exp");
  const receiptFileRef = b.receiptFileName ? encryptedReceiptRef(b.receiptFileName) : null;

  await db.insert(atelierExpenses).values({
    id,
    contextType: b.contextType ?? "bd",
    accountId: b.accountId ?? null,
    ...extras,
    fundingSource,
    personId: me.id,
    personType: ["contractor", "partner", "founding_partner", "non_equity_partner"].includes(me.role)
      ? me.role
      : "employee",
    engagementId: b.engagementId ?? null,
    expenseDate: dateStr,
    captureSource,
    cardId: b.cardId ?? null,
    merchant,
    description,
    businessPurpose,
    beneficiaryUserId: beneficiary.id,
    beneficiaryName: beneficiary.name,
    governingContractId: b.governingContractId ?? null,
    governingContractVersionId: b.governingContractVersionId ?? null,
    contingencyType,
    contingencyStatus: contingencyType !== "none" ? "pending" : "not_applicable",
    directCostStatus: "excluded",
    recoveryStatus: extras.clientBillable ? "pending" : "not_billable",
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
    summary: description ?? merchant,
    status: "draft",
    policyStatus: "green",
    createdByUserId: me.id,
    // Task #1095 — lightweight trip context feeding the allocation engine.
    tripDestinationCountry:
      typeof b.tripDestinationCountry === "string" && /^[A-Za-z]{2}$/.test(b.tripDestinationCountry.trim())
        ? b.tripDestinationCountry.trim().toUpperCase()
        : null,
    tripPurpose:
      typeof b.tripPurpose === "string" && b.tripPurpose.trim()
        ? b.tripPurpose.trim().slice(0, 40)
        : null,
    tripContextSource:
      (typeof b.tripDestinationCountry === "string" && b.tripDestinationCountry.trim()) ||
      (typeof b.tripPurpose === "string" && b.tripPurpose.trim())
        ? "user"
        : null,
  });

  // Task #1095 — deterministic allocation prefill on create (fast path;
  // the AI fallback runs at submit / receipt-parse time instead).
  await proposeExpenseAllocation(id, { allowAi: false, actorId: me.id }).catch(() => {});

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
    orgId: expense.orgId,
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

// @cli-skip: pending Task #340 read-parity migration
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

// Task #396 — full receipt/invoice re-parse (extraction + matcher), not just
// the field-level audit. Owner or leadership; draft/submitted rows only so
// approved financials are never rewritten by a re-parse.
// @cli-skip: binary-driven parse; no CLI shape (Task #396)
router.post("/wallet/expenses/:id/parse-receipt", async (req, res) => {
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
  if (existing.status !== "draft" && existing.status !== "submitted") {
    res.status(409).json({
      error: "not-reparsable",
      message: `Only draft or submitted claims can be re-parsed (status: ${existing.status}).`,
    });
    return;
  }
  try {
    const result = await parseReceiptForExpense({ row: existing, me, via: "wallet" });
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json({
      expense: expenseToWire(result.expense, me),
      runId: result.runId,
      proposal: result.proposal,
      policyFindings: result.policyFindings,
    });
  } catch (err) {
    res.status(500).json({
      error: "parse-failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// -------
// Task #408 — manual merchant correction (+ "remember this correction")
// -------
// When a parsed merchant is wrong or unrecognized, the user can correct it
// here. With remember=true the original→corrected pair is stored as an
// org-scoped alias consulted first by the matcher on future parses.
// @cli-skip: inline edit surface; no CLI shape (Task #408)
router.post("/wallet/expenses/:id/merchant", async (req, res) => {
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
  if (existing.status !== "draft" && existing.status !== "submitted") {
    res.status(409).json({
      error: "not-editable",
      message: `Merchant can only be corrected on draft or submitted claims (status: ${existing.status}).`,
    });
    return;
  }
  const body = (req.body ?? {}) as { merchant?: unknown; remember?: unknown };
  const merchant = typeof body.merchant === "string" ? body.merchant.trim() : "";
  if (!merchant || merchant.length > 200) {
    res.status(400).json({
      error: "invalid-merchant",
      message: "Provide a merchant name (1–200 characters).",
    });
    return;
  }
  const remember = body.remember === true;
  const original = (existing.merchant ?? "").trim();

  let alias: Awaited<ReturnType<typeof rememberMerchantAlias>> = null;
  if (remember && original && original !== merchant) {
    alias = await rememberMerchantAlias({
      originalText: original,
      correctedLabel: merchant,
      orgId: me.orgId,
      userId: me.id,
    });
  }

  const [updated] = await db
    .update(atelierExpenses)
    .set({
      merchant: merchant.slice(0, 200),
      merchantNormalized: normalizeMerchant(merchant).slice(0, 200),
      merchantResolution: "manual",
      updatedAt: new Date(),
    })
    .where(eq(atelierExpenses.id, existing.id))
    .returning();

  await audit({
    entityType: "expense",
    entityId: existing.id,
    actor: me,
    action: "wallet.expense.merchant_corrected",
    payload: {
      from: original || null,
      to: merchant,
      remembered: !!alias,
      aliasId: alias?.id ?? null,
      aliasMatchKey: alias?.matchKey ?? null,
    },
    summary: `Merchant corrected "${original || "(none)"}" → "${merchant}"${alias ? " · remembered as org alias" : ""}`,
  });

  res.json({ expense: expenseToWire(updated, me), remembered: !!alias });
});

interface SubmitBody {
  overrideRationale?: string;
  patch?: Partial<{
    category: string;
    // Task #383 — two-axis taxonomy pair (validated; flat category derived).
    categoryCode: string;
    subCategoryCode: string;
    clientBillable: boolean;
    markupPct: number;
    description: string;
    vatTreatment: string;
    vatAmount: number;
  }>;
}

// @cli-skip: pending Task #340 read-parity migration
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
  if (!existing.businessPurpose?.trim()) {
    res.status(409).json({ error: "business-purpose-required", message: "Add a business purpose before submitting." });
    return;
  }
  if (!existing.receiptFileRef && !existing.receiptFixtureKey && existing.captureSource !== "mileage" && existing.captureSource !== "per_diem") {
    res.status(409).json({ error: "receipt-required", message: "Attach a receipt before submitting this claim." });
    return;
  }

  // Run the Auditor first to get the proposal + initial policy outcome.
  await runAuditOnExpense(existing.id, me.id);

  // Re-apply user-edited patch on top of auditor proposal so the user
  // remains authoritative on category / billable / markup / VAT fields.
  const patch = body.patch ?? {};
  // Task #383 — user-picked taxonomy pair overrides the flat category too.
  let taxonomyPatch: Record<string, unknown> = {};
  if (patch.categoryCode !== undefined || patch.subCategoryCode !== undefined) {
    const pair =
      patch.categoryCode && patch.subCategoryCode
        ? await resolveCategoryPair(patch.categoryCode, patch.subCategoryCode)
        : null;
    if (!pair) {
      res.status(400).json({ error: "invalid-category-pair" });
      return;
    }
    taxonomyPatch = {
      categoryCode: pair.category.code,
      subCategoryCode: pair.sub.code,
      category: policyKeyFor(pair.sub),
      categorySource: "manual",
    };
  }
  if (Object.keys(patch).length > 0 || Object.keys(taxonomyPatch).length > 0) {
    await db
      .update(atelierExpenses)
      .set({
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...taxonomyPatch,
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
    orgId: postPatch.orgId,
    category: postPatch.category,
    usdAmount: postPatch.usdAmount,
    amount: postPatch.amount,
    currency: postPatch.currency,
    country: postPatch.vatCountry ?? null,
    role: submitter?.role ?? null,
    flightClass: postPatch.category === "flight" ? (flightClassMatch?.[1] ?? null) : null,
    submitterRole: submitter?.role ?? null,
    hasReceipt: !!postPatch.receiptFileRef || !!postPatch.receiptFixtureKey,
    businessPurpose: postPatch.businessPurpose,
    personId: postPatch.personId,
    expenseDate: postPatch.expenseDate,
  });
  await db
    .update(atelierExpenses)
    .set({ policyStatus: finalPolicy.status, policyFindings: finalPolicy.findings, updatedAt: new Date() })
    .where(eq(atelierExpenses.id, existing.id));

  // Task #1095 — entity-allocation prefill at submit (AI fallback allowed:
  // trip purpose may need inferring from the receipt/description).
  await proposeExpenseAllocation(existing.id, { actorId: me.id }).catch(() => {});
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

  // Task #383 — submitted pair is a confirmed choice; feed merchant memory.
  if (expense.merchant && expense.categoryCode && expense.subCategoryCode) {
    await learnMerchantMapping({
      merchant: expense.merchant,
      categoryCode: expense.categoryCode,
      subCategoryCode: expense.subCategoryCode,
      userId: me.id,
      orgId: me.orgId,
    });
  }

  // Task #501 — every submitted claim lands in both founders' queues.
  await notifyFoundersOfSubmittedExpense(expense);

  // Task #1069 — pending-approval totals on finance surfaces refresh promptly.
  invalidateFinanceFacts();

  const [final] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expense.id));
  res.json({ expense: expenseToWire(final, me) });
});

/**
 * Task #383 — timesheet-linked auto-approval (per-approver opt-in).
 * Approves every SUBMITTED, policy-GREEN, engagement-linked expense that
 * references the given timesheet week. Anything amber/red or non-project
 * stays in the queue for a human decision. Writes the same VAT register
 * row + audit trail as a manual approval.
 */
export async function autoApproveTimesheetExpenses(
  weekId: string,
  approver: typeof atelierUsers.$inferSelect,
): Promise<{ approved: number; skipped: number }> {
  const rows = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.timesheetWeekId, weekId),
        // Week ids are deterministic (tsw_<person>_<week>), so tenant scoping
        // here is load-bearing: never approve another org's expenses.
        eq(atelierExpenses.orgId, approver.orgId),
        eq(atelierExpenses.status, "submitted"),
        isNull(atelierExpenses.deletedAt),
      ),
    );
  let approved = 0;
  let skipped = 0;
  const touchedEngagements = new Set<string>();
  for (const existing of rows) {
    if (existing.policyStatus !== "green" || !existing.engagementId) {
      skipped += 1;
      continue;
    }
    await db
      .update(atelierExpenses)
      .set({
        status: "approved",
        approvalRoute: "timesheet_auto",
        approvedAt: new Date(),
        approvedByUserId: approver.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierExpenses.id, existing.id),
          eq(atelierExpenses.orgId, approver.orgId),
          eq(atelierExpenses.status, "submitted"),
        ),
      );
    const treatmentRate =
      existing.vatTreatment === "ksa_15" ? 0.15 : existing.vatTreatment === "uae_5" ? 0.05 : 0;
    const net = existing.amount - existing.vatAmount;
    const usdNet = +(existing.usdAmount * (net / Math.max(existing.amount, 0.0001))).toFixed(2);
    const usdVat = +(existing.usdAmount - usdNet).toFixed(2);
    await db.insert(atelierVatRegister).values({
      id: rid("vat"),
      orgId: existing.orgId,
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
      actor: approver,
      action: "expense.approve",
      payload: {
        vatTreatment: existing.vatTreatment,
        usdGross: existing.usdAmount,
        approvalRoute: "timesheet_auto",
        timesheetWeekId: weekId,
      },
      summary: `Auto-approved ${existing.merchant ?? existing.id} ($${existing.usdAmount.toFixed(2)}) with timesheet week approval.`,
    });
    await emitSelfNotification({
      orgId: approver.orgId,
      userId: existing.personId,
      kind: "expense_approved",
      title: "Expense claim approved",
      body: `${existing.merchant ?? "Expense"} approved automatically with your timesheet.`,
      href: "/me",
    });
    touchedEngagements.add(existing.engagementId);
    approved += 1;
  }
  for (const engId of touchedEngagements) {
    await checkEngagementExpenseBudget(engId);
  }
  if (approved > 0) invalidateFinanceFacts(); // Task #1069 — auto-approved spend surfaces promptly.
  return { approved, skipped };
}

// Task #1095 — standalone allocation decision (approve / override) on an
// expense. Finance leadership only; overrides after posting are blocked
// when the posted period is close-locked (reversal/repost must be used).
// @cli-skip: UI-workflow write; allocation decisions ride the approval surfaces
router.post("/wallet/expenses/:id/allocation", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "Entity allocations are decided by finance leadership." });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierExpenses)
    .where(and(
      eq(atelierExpenses.id, req.params.id),
      eq(atelierExpenses.orgId, me.orgId),
      isNull(atelierExpenses.deletedAt),
    ));
  if (!existing) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  const b = (req.body ?? {}) as { entityId?: string; reason?: string };
  // Period-close lock: once the expense is posted into a locked period,
  // the allocation cannot be silently changed — reversal/repost only.
  const [posted] = await db
    .select({ periodLabel: atelierGlJournalEntry.periodLabel })
    .from(atelierGlJournalEntry)
    .where(and(
      eq(atelierGlJournalEntry.orgId, me.orgId),
      eq(atelierGlJournalEntry.sourceKind, "expense"),
      eq(atelierGlJournalEntry.sourceRef, existing.id),
      isNull(atelierGlJournalEntry.deletedAt),
    ))
    .limit(1);
  if (posted && b.entityId && b.entityId !== existing.entityId && (await isGlPeriodLocked(me.orgId, posted.periodLabel))) {
    res.status(409).json({
      error: "period-locked",
      message: `This expense is posted in ${posted.periodLabel}, which is close-locked. Reopen the period or use reversal/repost.`,
    });
    return;
  }
  const decided = await decideAllocation({
    kind: "expense",
    id: existing.id,
    orgId: me.orgId,
    actor: { id: me.id, name: me.name },
    entityId: typeof b.entityId === "string" && b.entityId ? b.entityId : null,
    overrideReason: b.reason ?? null,
  });
  if (!decided.ok) {
    res.status(400).json({ error: decided.error, message: decided.message });
    return;
  }
  const [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, existing.id));
  res.json({ ok: true, status: decided.status, expense: expenseToWire(row) });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/expenses/:id/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [existing] = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.id, req.params.id),
        eq(atelierExpenses.orgId, me.orgId),
        isNull(atelierExpenses.deletedAt),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (existing.status !== "submitted") {
    res.status(409).json({ error: "not-submitted" });
    return;
  }
  if (!existing.businessPurpose?.trim()) {
    res.status(409).json({ error: "business-purpose-required" });
    return;
  }
  if (!existing.receiptFileRef && !existing.receiptFixtureKey && existing.captureSource !== "mileage" && existing.captureSource !== "per_diem") {
    res.status(409).json({ error: "receipt-required" });
    return;
  }
  // Task #383 — dual-route authority: engagement lead for project-linked,
  // line manager (BFS) / HR for internal, leadership always.
  const approvalRoute = await resolveApprovalAuthority(res, me, existing);
  if (!approvalRoute) return;

  // Task #383 — approver corrections: category pair and billable flag may
  // be overridden at approval time; corrections feed the merchant memory.
  const b = (req.body ?? {}) as {
    categoryCode?: string;
    subCategoryCode?: string;
    clientBillable?: boolean;
    // Task #1095 — approving the expense approves (or overrides) its
    // entity allocation in the same act. `entityId` different from the
    // proposal requires `allocationOverrideReason`.
    entityId?: string;
    allocationOverrideReason?: string;
  };
  // Task #1095 — allocation decision rides the expense approval. Only
  // finance leadership may decide allocations; other approval routes
  // (engagement lead / line manager) leave the allocation untouched.
  if (existing.allocStatus === "proposed" || existing.allocStatus === "needs_input" || b.entityId) {
    if (isLeadership(me)) {
      const decided = await decideAllocation({
        kind: "expense",
        id: existing.id,
        orgId: me.orgId,
        actor: { id: me.id, name: me.name },
        entityId: typeof b.entityId === "string" && b.entityId ? b.entityId : null,
        overrideReason: b.allocationOverrideReason ?? null,
      });
      if (!decided.ok && decided.error !== "entity_required") {
        // needs_input with no entity picked is tolerated (expense can be
        // approved, allocation stays queued); other failures are the
        // caller's mistake.
        res.status(400).json({ error: decided.error, message: decided.message });
        return;
      }
    } else if (b.entityId) {
      res.status(403).json({ error: "allocation-requires-finance", message: "Only finance leadership can change the entity allocation." });
      return;
    }
  }
  const correction: Record<string, unknown> = {};
  if (b.categoryCode !== undefined || b.subCategoryCode !== undefined) {
    const pair =
      b.categoryCode && b.subCategoryCode
        ? await resolveCategoryPair(b.categoryCode, b.subCategoryCode)
        : null;
    if (!pair) {
      res.status(400).json({ error: "invalid-category-pair" });
      return;
    }
    correction.categoryCode = pair.category.code;
    correction.subCategoryCode = pair.sub.code;
    correction.category = policyKeyFor(pair.sub);
    correction.categorySource = "manual";
  }
  if (typeof b.clientBillable === "boolean") correction.clientBillable = b.clientBillable;

  await db
    .update(atelierExpenses)
    .set({
      ...correction,
      status: "approved",
      approvalRoute,
       directCostStatus: existing.contingencyStatus === "pending" ? "pending" : "included",
       recoveryStatus: (correction.clientBillable ?? existing.clientBillable) ? "pending" : "not_billable",
      approvedAt: new Date(),
      approvedByUserId: me.id,
      updatedAt: new Date(),
    })
    .where(eq(atelierExpenses.id, existing.id));

  if (existing.merchant && (correction.subCategoryCode || existing.subCategoryCode)) {
    await learnMerchantMapping({
      merchant: existing.merchant,
      categoryCode: (correction.categoryCode as string) ?? existing.categoryCode!,
      subCategoryCode: (correction.subCategoryCode as string) ?? existing.subCategoryCode!,
      userId: me.id,
      orgId: me.orgId,
    });
  }

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
    payload: { vatTreatment: existing.vatTreatment, usdGross: existing.usdAmount, approvalRoute },
    summary: `Approved ${existing.merchant ?? existing.id} ($${existing.usdAmount.toFixed(2)}) via ${approvalRoute}; VAT register row written.`,
  });

  // Task #383 — engagement expense-budget alerts (80% / 100%, deduped).
  if (existing.engagementId) {
    await checkEngagementExpenseBudget(existing.engagementId);
  }

  // Task #53 — expense personId IS the atelier_users id; notify directly.
  await emitSelfNotification({
    orgId: me.orgId,
    userId: existing.personId,
    kind: "expense_approved",
    title: "Expense claim approved",
    body: `${existing.merchant ?? existing.id} — ${existing.currency} ${existing.amount.toFixed(2)} was approved.`,
    href: "/me",
  });

  // Task #1069 — newly approved spend must appear promptly on facts-driven
  // finance surfaces (P&L, plan, reports).
  invalidateFinanceFacts();

  const [final] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, existing.id));
  res.json({ expense: expenseToWire(final, me) });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/expenses/:id/reject", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const reason = (req.body?.reason as string) || "rejected";
  const [existing] = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.id, req.params.id),
        eq(atelierExpenses.orgId, me.orgId),
        isNull(atelierExpenses.deletedAt),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (existing.status !== "submitted") {
    res.status(409).json({ error: "not-submitted" });
    return;
  }
  // Task #383 — same dual-route authority as approve.
  const approvalRoute = await resolveApprovalAuthority(res, me, existing);
  if (!approvalRoute) return;
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

  // Task #53 — notify the claimant on their Me home.
  await emitSelfNotification({
    orgId: me.orgId,
    userId: existing.personId,
    kind: "expense_rejected",
    title: "Expense claim rejected",
    body: `${existing.merchant ?? existing.id} — ${existing.currency} ${existing.amount.toFixed(2)} was rejected: ${reason}`,
    href: "/me",
  });

  invalidateFinanceFacts(); // Task #1069 — drop pending-approval totals promptly.

  const [final] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, existing.id));
  res.json({ expense: expenseToWire(final, me) });
});

// -------
// POST /wallet/expenses/:id/reimburse — Task #53
// Finance/leadership marks an APPROVED claim as paid out.
// -------
// @cli-skip: finance reimbursement action backing Wallet UI (Task #53)
router.post("/wallet/expenses/:id/reimburse", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!(isLeadership(me) || me.role === "finance")) {
    res.status(403).json({ error: "forbidden", message: "Reimbursement is a finance/leadership action." });
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
  if (existing.status === "reimbursed") {
    // Idempotent — repeat calls return the current row.
    res.json({ expense: expenseToWire(existing, me), alreadyReimbursed: true });
    return;
  }
  if (existing.status !== "approved") {
    res.status(409).json({ error: "not-approved", status: existing.status });
    return;
  }
  if (existing.policyStatus === "red" || !existing.businessPurpose?.trim()) {
    res.status(409).json({ error: "policy-or-evidence-incomplete", message: "Policy, evidence and business purpose must pass before reimbursement." });
    return;
  }
  if (existing.contingencyStatus === "pending") {
    res.status(409).json({ error: "contingency-pending", message: "Record the qualifying project outcome before reimbursing this contingent claim." });
    return;
  }
  if (existing.contingencyStatus === "lost" || existing.contingencyStatus === "abandoned") {
    res.status(409).json({
      error: "contingency-not-met",
      message: "This pursuit closed without meeting the reimbursement condition.",
    });
    return;
  }
  // Task #383 — company-account spend has NO reimbursement leg: the firm
  // already paid from its own bank account. Refuse instead of silently
  // creating a payout obligation.
  if (existing.fundingSource === "company_account") {
    res.status(409).json({
      error: "company-account-no-reimbursement",
      message: "This expense was paid from a company bank account — there is nothing to reimburse.",
    });
    return;
  }
  await db
    .update(atelierExpenses)
    .set({
      status: "reimbursed",
      reimbursedAt: new Date(),
      reimbursedByUserId: me.id,
      updatedAt: new Date(),
    })
    .where(eq(atelierExpenses.id, existing.id));
  await audit({
    entityType: "expense",
    entityId: existing.id,
    actor: me,
    action: "expense.reimburse",
    payload: { usdGross: existing.usdAmount },
    summary: `Reimbursed ${existing.merchant ?? existing.id} ($${existing.usdAmount.toFixed(2)}).`,
  });
  await emitSelfNotification({
    orgId: me.orgId,
    userId: existing.personId,
    kind: "expense_reimbursed",
    title: "Expense reimbursed",
    body: `${existing.merchant ?? existing.id} — ${existing.currency} ${existing.amount.toFixed(2)} has been paid out.`,
    href: "/me",
  });
  invalidateFinanceFacts(); // Task #1069 — refresh cash/AP facts promptly.
  const [final] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, existing.id));
  res.json({ expense: expenseToWire(final, me) });
});

// Task #1344 — settle a partner-funded contingent claim exactly once. This
// deliberately lives beside reimbursement: outcome changes never pay a claim
// directly; they only unlock the normal approved → reimbursed path.
router.post("/wallet/expenses/:id/contingency-outcome", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "Only leadership can settle a project expense outcome." });
    return;
  }
  const outcome = String(req.body?.outcome ?? "");
  if (!["won", "started", "lost", "abandoned"].includes(outcome)) {
    res.status(400).json({ error: "invalid-project-outcome" });
    return;
  }
  const [existing] = await db.select().from(atelierExpenses).where(and(
    eq(atelierExpenses.id, req.params.id),
    eq(atelierExpenses.orgId, me.orgId),
    isNull(atelierExpenses.deletedAt),
  ));
  if (!existing) {
    res.status(404).json({ error: "expense-not-found" });
    return;
  }
  if (existing.contingencyType === "none" || existing.contingencyStatus === "not_applicable") {
    res.status(409).json({ error: "not-contingent" });
    return;
  }
  const qualifies = existing.contingencyType === "win" ? outcome === "won" : outcome === "started";
  const nextStatus = qualifies ? "activated" : outcome === "abandoned" ? "abandoned" : "lost";
  const [updated] = await db.update(atelierExpenses).set({
    projectOutcome: outcome,
    contingencyStatus: nextStatus,
    directCostStatus: qualifies && ["approved", "reimbursed"].includes(existing.status)
      ? "included"
      : "excluded",
    updatedAt: new Date(),
  }).where(and(eq(atelierExpenses.id, existing.id), eq(atelierExpenses.contingencyStatus, "pending"))).returning();
  if (!updated) {
    const [current] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, existing.id));
    res.json({ expense: expenseToWire(current, me), alreadySettled: true });
    return;
  }
  await audit({
    entityType: "expense",
    entityId: updated.id,
    actor: me,
    action: "expense.contingency_outcome",
    payload: { outcome, contingencyType: updated.contingencyType, contingencyStatus: nextStatus },
    summary: `Settled contingent expense ${updated.merchant ?? updated.id} as ${outcome}.`,
  });
  invalidateFinanceFacts();
  res.json({ expense: expenseToWire(updated, me), activated: qualifies });
});

// -------
// POLICY
// -------
// @cli-skip: pending Task #340 read-parity migration
router.get("/wallet/policy", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Admin-only per PRD §4.4: policy view is restricted to partner/operations.
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden", message: "Wallet policy is admin-only." });
    return;
  }
  // First-read auto-seed: an org that has never created a rule gets the
  // default lean policy installed here (idempotent; never touches orgs
  // that edited or retired rules).
  await ensureDefaultExpensePolicies(me.orgId);
  const rows = await db
    .select()
    .from(atelierExpensePolicies)
    .where(and(eq(atelierExpensePolicies.orgId, me.orgId), isNull(atelierExpensePolicies.deletedAt)))
    .orderBy(atelierExpensePolicies.category);
  res.json({ rules: rows, principles: POLICY_PRINCIPLES });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/policy/seed-defaults", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isPartnerOrOps(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const values = defaultPoliciesForOrg(me.orgId);
  const inserted = await db
    .insert(atelierExpensePolicies)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: atelierExpensePolicies.id });
  await audit({
    entityType: "wallet_policy",
    entityId: "all",
    actor: me,
    action: "wallet.policy.seed_defaults",
    payload: { count: inserted.length },
    summary: `Restored ${inserted.length} missing default expense policies.`,
  });
  res.json({ ok: true, count: inserted.length });
});

// @cli-skip: pending Task #340 read-parity migration
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
    orgId: me.orgId,
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

// @cli-skip: pending Task #340 read-parity migration
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
    .where(and(eq(atelierExpensePolicies.id, req.params.id), eq(atelierExpensePolicies.orgId, me.orgId)));
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

// @cli-skip: pending Task #340 read-parity migration
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
    .where(and(eq(atelierExpensePolicies.id, req.params.id), eq(atelierExpensePolicies.orgId, me.orgId)));
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

// -------
// CARDS
// -------
// @cli-skip: pending Task #340 read-parity migration
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

// -------
// VAT register
// -------
// @cli-skip: pending Task #340 read-parity migration
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
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", "vat-register.csv"));
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

// -------
// FX seed (ops)
// -------
// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
router.get("/wallet/fx", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const quote = (req.query.quote as string)?.toUpperCase() || null;
  let rows = await db.select().from(atelierFxRates).orderBy(desc(atelierFxRates.date));
  if (quote) rows = rows.filter((r) => r.quote === quote);
  res.json({ rates: rows.slice(0, 200) });
});

// -------
// Retention sweep — 90d OCR-payload redaction
// -------
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

// @cli-skip: pending Task #340 read-parity migration
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

// -------
// Task #396 — Merchant enrichment (leadership-facing admin loop)
// -------
// Unknown merchants logged by the matcher can be batch-classified by AI so
// they match instantly next time. Long LLM batch → async launch + poll.

// @cli-skip: leadership admin surface; no CLI shape (Task #396)
router.get("/wallet/merchants/unmatched", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isLeadership(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const allRows = await db
    .select()
    .from(atelierUnmatchedMerchants)
    .orderBy(desc(atelierUnmatchedMerchants.count))
    .limit(200);
  // Task #408 — entries a user has already corrected via an org alias are
  // no longer "unknown"; drop them from the admin queue.
  const aliasKeys = await listAliasMatchKeys(me.orgId);
  const rows = allRows.filter((r) => !aliasKeys.has(r.normalizedMerchantText));
  res.json({
    merchants: rows.map((r) => ({
      id: r.id,
      rawMerchantText: r.rawMerchantText,
      normalizedText: r.normalizedMerchantText,
      occurrenceCount: r.count,
      status: r.status,
      lastSeenAt: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null,
    })),
    pendingCount: rows.filter((r) => r.status === "pending").length,
  });
});

// Task #1020 — enrichment run state now lives in the durable
// background-job registry (job id doubles as the public runId), so status
// survives restarts, shows in the global indicator, and notifies the
// starter when the batch finishes.
const ENRICHMENT_TARGET_ID = "org-merchants";

// @cli-skip: leadership admin action; no CLI shape (Task #396)
router.post("/wallet/merchants/enrich", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isLeadership(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (await hasRunningJob(["merchant_enrichment"], ENRICHMENT_TARGET_ID, me.orgId)) {
    res.status(409).json({ error: "enrichment-already-running" });
    return;
  }
  const runId = rid("enr");
  const started = await startBackgroundJob({
    id: runId,
    orgId: me.orgId,
    userId: me.id,
    kind: "merchant_enrichment",
    targetType: "merchant_registry",
    targetId: ENRICHMENT_TARGET_ID,
    label: "Merchant enrichment",
  });
  if (!started) {
    // Lost the atomic-start race to a concurrent request.
    res.status(409).json({ error: "enrichment-already-running" });
    return;
  }
  // Return instantly; the LLM batch continues in the background (proxy
  // 502s held requests — see the async-launch pattern).
  void (async () => {
    try {
      const result = await runMerchantEnrichment();
      await completeBackgroundJob(runId, {
        result,
        notifyTitle: "Merchant enrichment finished",
        notifyBody: `${result.inserted} merchants added (${result.processed} processed, ${result.remainingPending} still pending).`,
      });
      await audit({
        entityType: "merchant_enrichment",
        entityId: runId,
        actor: me,
        action: "wallet.merchants.enrich",
        payload: { runId, ...result },
        summary: `Merchant enrichment: ${result.inserted} merchants added (${result.processed} processed, ${result.remainingPending} still pending).`,
      });
    } catch (err) {
      await failBackgroundJob(runId, err instanceof Error ? err.message : String(err), {
        notifyTitle: "Merchant enrichment failed",
      });
    }
  })();
  res.status(202).json({ runId, status: "running" });
});

// @cli-skip: poll endpoint; no CLI shape (Task #396)
router.get("/wallet/merchants/enrich/:runId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isLeadership(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const job = await getJobById(req.params.runId, me.orgId);
  if (!job || job.kind !== "merchant_enrichment") {
    res.status(404).json({ error: "run-not-found" });
    return;
  }
  res.json({
    id: job.id,
    status: job.status,
    startedAt: job.createdAt.toISOString(),
    ...(job.status === "done" && job.result ? { result: job.result } : {}),
    ...(job.status === "failed" ? { error: job.error ?? "failed" } : {}),
  });
});

// -------
// Task #260 — Client-billable expenses · /wallet/client-billable
// -------
// @cli-skip: pending Task #340 read-parity migration
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

// -------
// Task #260 — Payment Proposals · /wallet/approvals (Partner-only)
// -------
// @cli-skip: pending Task #340 read-parity migration
router.get("/wallet/approvals", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Finance is a maker-checker approver for this same queue; do not expose
  // any broader wallet surface here than the partner approval queue.
  if (!canApprovePayment(me)) {
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

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/approvals/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner") && !isPartnerOrOps(me)) {
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

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/approvals/contractor/:id/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApprovePayment(me)) {
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
  const founderSelfApproval = row.payeeUserId === me.id;
  if (founderSelfApproval && me.role !== "founding_partner") {
    res.status(403).json({
      error: "no-self-approval",
      message: "You cannot approve your own contractor payment proposal.",
    });
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
    payload: {
      usdAmount: row.usdAmount,
      rationale,
      ...(founderSelfApproval
        ? { founderSelfApproval: true, approvalAuthority: "founder_self" }
        : {}),
    },
    summary: founderSelfApproval
      ? `Founder self-approved $${row.usdAmount.toFixed(2)} for ${row.payeeName} (${row.weekIso}); explicit founder self-approval exception documented.`
      : `Approved $${row.usdAmount.toFixed(2)} for ${row.payeeName} (${row.weekIso}).`,
  });
  res.json({ ok: true });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/approvals/contractor/:id/reject", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApprovePayment(me)) {
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
  const founderSelfApproval = row.payeeUserId === me.id;
  if (founderSelfApproval && me.role !== "founding_partner") {
    res.status(403).json({
      error: "no-self-approval",
      message: "You cannot reject your own contractor payment proposal.",
    });
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
    payload: {
      reason,
      ...(founderSelfApproval
        ? { founderSelfApproval: true, approvalAuthority: "founder_self" }
        : {}),
    },
    summary: founderSelfApproval
      ? `Founder self-rejected ${row.payeeName} (${row.weekIso}); explicit founder self-approval exception documented: ${reason}`
      : `Rejected ${row.payeeName} (${row.weekIso}): ${reason}`,
  });
  res.json({ ok: true });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/approvals/partner-firm/:id/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApprovePayment(me)) {
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
  // Task #1343 — use only explicit relationship mappings; never infer
  // beneficial ownership from names or other fuzzy identity signals.
  const [firm] = await db
    .select({
      primaryContactUserId: atelierPartnerFirms.primaryContactUserId,
    })
    .from(atelierPartnerFirms)
    .where(
      and(
        eq(atelierPartnerFirms.id, row.partnerFirmId),
        eq(atelierPartnerFirms.orgId, me.orgId),
        isNull(atelierPartnerFirms.deletedAt),
      ),
    );
  const directFirmOwner =
    firm?.primaryContactUserId === me.id || me.partnerFirmId === row.partnerFirmId;
  if (directFirmOwner) {
    res.status(403).json({
      error: "no-self-approval",
      message: "You cannot approve a partner-firm payment for a firm you own or represent.",
    });
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

// @cli-skip: pending Task #340 read-parity migration
router.post("/wallet/approvals/partner-firm/:id/reject", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApprovePayment(me)) {
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
  const [firm] = await db
    .select({
      primaryContactUserId: atelierPartnerFirms.primaryContactUserId,
    })
    .from(atelierPartnerFirms)
    .where(
      and(
        eq(atelierPartnerFirms.id, row.partnerFirmId),
        eq(atelierPartnerFirms.orgId, me.orgId),
        isNull(atelierPartnerFirms.deletedAt),
      ),
    );
  const directFirmOwner =
    firm?.primaryContactUserId === me.id || me.partnerFirmId === row.partnerFirmId;
  if (directFirmOwner) {
    res.status(403).json({
      error: "no-self-approval",
      message: "You cannot reject a partner-firm payment for a firm you own or represent.",
    });
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

// -------
// Task #260 — Invoice-line drafts · /wallet/invoice-drafts/:eid
// -------
// @cli-skip: pending Task #340 read-parity migration
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
      .header("content-disposition", contentDispositionFilename("attachment", `invoice-draft-${eid}.csv`))
      .send(csv);
    return;
  }
  res.json({ engagementId: eid, draft: current ?? null });
});

// -------
// Task #260 — Publish Sentinel (kind=expense) extension. Routes the
// expense through the SAME runPublishSentinel agent the v2 deliverable
// flow uses, but feeds it pre-computed expense checks so the result is
// recorded as a normal sentinel run on the agent runs page.
// -------
// @cli-skip: pending Task #340 read-parity migration
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
    if (me.role !== "senior_manager") { // Task #292 — engagement_lead → senior_manager
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

// @cli-skip: pending Task #340 read-parity migration
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
