/**
 * Atelier — per-engagement Financials tab routes (Task #442).
 *
 * Consolidates billing schedule, collections, P&L (with EAC + leakage),
 * Action Center, and the Billing Steward agent that auto-drafts bills
 * from client-signed deliverable acceptances and walks them through a
 * two-step Lead → Finance approval before they enter the existing
 * `/wallet/invoices/:id/issue` pipeline.
 *
 * Endpoints
 *   GET  /finance/engagement-financials/:engId
 *        Header strip + billing schedule + collections + P&L summary +
 *        action-center buckets, all in one payload so the tab is a
 *        single fetch.
 *   POST /finance/engagement-financials/:engId/billing-steward/run
 *        For each `client_signed` acceptance with no linked invoice
 *        yet, draft an invoice in `pending_lead_approval`. Returns the
 *        list of bills drafted.
 *   POST /finance/engagement-financials/bills/:invoiceId/lead-approve
 *        Lead approves a steward-drafted bill (any senior_manager,
 *        partner, founding_partner, finance). Moves to
 *        `pending_finance_approval`.
 *   POST /finance/engagement-financials/bills/:invoiceId/finance-approve
 *        Finance approves and the bill drops back to `draft` so the
 *        existing /wallet/invoices/:id/issue path can mint the number
 *        and submit e-invoice.
 *
 * Bill approval state machine (uses atelierInvoice.status):
 *   pending_lead_approval → pending_finance_approval → draft → issued ...
 *
 * The two intermediate statuses are bill-steward-only; the existing
 * compose / lines / issue / void / payment endpoints continue to work
 * once the bill is back in `draft`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import {
  db,
  atelierEngagements,
  atelierInvoice,
  atelierInvoiceLine,
  atelierDeliverableAcceptance,
  atelierAuditEvents,
  atelierNotifications,
  atelierPaneAItems,
  atelierAccounts,
  atelierUsers,
  atelierDealPricings,
} from "@workspace/db";
import { withRls } from "./rls";
import { isLeadership, isFinance, isRestrictedPersona, isBoardObserver } from "./personaRoles";
import {
  getBudget,
  getCost,
  getEtc,
} from "../../data/atelier-engagement-pnl-seed.js";
import { computeEac } from "../../lib/atelier-eac-engine.js";
import { recomputeEngagementCostToDate } from "../../lib/atelier-engagement-pnl-recompute.js";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response) {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role)) {
    res.status(403).json({ error: "financials-forbidden" });
    return null;
  }
  return me;
}

function canLeadApprove(role: string | null | undefined): boolean {
  return isLeadership(role) || isFinance(role) || role === "senior_manager";
}

function canFinanceApprove(role: string | null | undefined): boolean {
  return isLeadership(role) || isFinance(role);
}

function deriveBillingModel(pricingModel: string | null | undefined): string {
  switch (pricingModel) {
    case "fixed_fee":
      return "milestone";
    case "outcome_based":
      return "outcome";
    case "retainer":
      return "retainer";
    case "time_and_materials":
    default:
      return "time_and_materials";
  }
}

// Billing models eligible for Steward auto-draft on client-sign.
// T&M is excluded because the Invoice Composer (hours+expenses) handles it.
// Default-allow when the pricing model is unknown so demo flows still
// produce a draft; if it's known and explicitly t&m, skip auto-draft.
function isStewardEligible(pricingModel: string | null | undefined): boolean {
  if (!pricingModel) return true;
  const m = deriveBillingModel(pricingModel);
  return m !== "time_and_materials";
}

// Look up the pricing model via opportunity → deal pricing. Returns
// null if no opportunity is linked or no deal-pricing row exists.
async function lookupPricingModel(
  orgId: string,
  opportunityId: string | null,
): Promise<string | null> {
  if (!opportunityId) return null;
  const [row] = await db
    .select({ pricingModel: atelierDealPricings.pricingModel })
    .from(atelierDealPricings)
    .where(
      and(
        eq(atelierDealPricings.opportunityId, opportunityId),
        eq(atelierDealPricings.orgId, orgId),
      ),
    )
    .limit(1);
  return row?.pricingModel ?? null;
}

// ---------------------------------------------------------------
// Steward draft helper (used by manual /run AND the client-sign hook)
// ---------------------------------------------------------------
interface StewardActor {
  id: string;
  orgId: string;
  name: string;
  role: string;
}

interface StewardDraftResult {
  invoiceId: string;
  total: number;
  acceptanceId: string;
  title: string;
}

async function draftStewardBills(args: {
  actor: StewardActor;
  engagement: typeof atelierEngagements.$inferSelect;
  account: typeof atelierAccounts.$inferSelect | null;
  signedAcceptances: Array<typeof atelierDeliverableAcceptance.$inferSelect>;
  alreadyLinkedAcceptanceIds: Set<string>;
  perBill: number;
}): Promise<StewardDraftResult[]> {
  const { actor, engagement: eng, account, signedAcceptances, alreadyLinkedAcceptanceIds, perBill } = args;
  const queue = signedAcceptances.filter((a) => !alreadyLinkedAcceptanceIds.has(a.id));
  const drafted: StewardDraftResult[] = [];
  for (const acc of queue) {
    const invId = rid("inv");
    const lineId = rid("invl");
    const subtotal = perBill;
    const total = subtotal;
    await db.insert(atelierInvoice).values({
      id: invId,
      orgId: actor.orgId,
      engagementId: eng.id,
      accountId: eng.accountId ?? null,
      jurisdiction: "GLOBAL",
      currency: "USD",
      status: "pending_lead_approval",
      billTo: account ? { name: account.name, contactEmail: undefined } : {},
      subtotal,
      vatAmount: 0,
      vatRatePct: 0,
      total,
      amountPaid: 0,
      notes: `Billing Steward · acceptance ${acc.id} · "${acc.title}"`,
      createdByUserId: actor.id,
    });
    await db.insert(atelierInvoiceLine).values({
      id: lineId,
      orgId: actor.orgId,
      invoiceId: invId,
      ord: 0,
      description: `Milestone fee — ${acc.title}`,
      qty: 1,
      unitPrice: subtotal,
      amount: subtotal,
      sourceKind: "milestone",
      sourceRef: acc.milestoneId ?? acc.id,
    });
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "invoice",
      entityId: invId,
      actorType: "agent",
      actorId: "ag_billing_steward",
      actorLabel: "Billing Steward",
      action: "billing.steward.drafted",
      payload: { engagementId: eng.id, acceptanceId: acc.id, total },
      payloadSummary: `Billing Steward drafted bill for "${acc.title}" (${total.toLocaleString()} USD).`,
    });
    await db
      .insert(atelierPaneAItems)
      .values({
        id: `panea_bill_lead_${invId}`,
        userId: eng.engagementLeadId,
        title: `Bill ready for Lead approval · ${eng.name}`,
        summary: `Billing Steward drafted a $${total.toLocaleString()} bill against "${acc.title}". Lead approval required.`,
        priority: "medium",
        hrefKind: "engagement_economics",
        hrefTargetId: eng.id,
        dueLabel: "Today",
        sortKey: 70,
      })
      .onConflictDoNothing({ target: atelierPaneAItems.id });
    await db.insert(atelierNotifications).values({
      id: rid("notif"),
      userId: eng.engagementLeadId,
      kind: "bill_lead_approval_required",
      payload: { engagementId: eng.id, invoiceId: invId, total },
      subject: `Bill awaiting your approval · ${eng.name}`,
      body: `Steward drafted a $${total.toLocaleString()} bill from acceptance "${acc.title}".`,
      refType: "invoice",
      refId: invId,
      status: "queued",
    });
    drafted.push({ invoiceId: invId, total, acceptanceId: acc.id, title: acc.title });
  }
  return drafted;
}

// Auto-draft entry-point used from the deliverable-acceptance hook.
// Returns drafted invoice ids (or empty list) so callers can log it.
export async function autoDraftOnClientSign(args: {
  actor: StewardActor;
  acceptanceId: string;
}): Promise<StewardDraftResult[]> {
  const { actor, acceptanceId } = args;
  const [acc] = await db
    .select()
    .from(atelierDeliverableAcceptance)
    .where(
      and(
        eq(atelierDeliverableAcceptance.id, acceptanceId),
        isNull(atelierDeliverableAcceptance.deletedAt),
      ),
    )
    .limit(1);
  if (!acc || acc.status !== "client_signed") return [];
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, acc.engagementId),
        eq(atelierEngagements.orgId, actor.orgId),
        isNull(atelierEngagements.deletedAt),
      ),
    )
    .limit(1);
  if (!eng) return [];
  const pricingModel = await lookupPricingModel(actor.orgId, eng.opportunityId ?? null);
  if (!isStewardEligible(pricingModel)) return [];
  const account = eng.accountId
    ? (
        await db
          .select()
          .from(atelierAccounts)
          .where(
            and(
              eq(atelierAccounts.id, eng.accountId),
              eq(atelierAccounts.orgId, actor.orgId),
            ),
          )
          .limit(1)
      )[0] ?? null
    : null;
  const [allSigned, allInvs, budget] = await Promise.all([
    db
      .select()
      .from(atelierDeliverableAcceptance)
      .where(
        and(
          eq(atelierDeliverableAcceptance.engagementId, eng.id),
          eq(atelierDeliverableAcceptance.status, "client_signed"),
          isNull(atelierDeliverableAcceptance.deletedAt),
        ),
      ),
    db
      .select()
      .from(atelierInvoice)
      .where(
        and(
          eq(atelierInvoice.engagementId, eng.id),
          eq(atelierInvoice.orgId, actor.orgId),
          isNull(atelierInvoice.deletedAt),
        ),
      ),
    getBudget(eng.id),
  ]);
  const linked = new Set<string>();
  for (const inv of allInvs) {
    const refs = (inv.notes ?? "").match(/dlacc_[a-z0-9_]+/gi) ?? [];
    for (const r of refs) linked.add(r);
  }
  if (linked.has(acc.id)) return [];
  const perBill = budget && budget.contractValueUsd > 0 && allSigned.length > 0
    ? Math.round(budget.contractValueUsd / Math.max(allSigned.length, 4))
    : 50_000;
  return draftStewardBills({
    actor,
    engagement: eng,
    account,
    signedAcceptances: [acc],
    alreadyLinkedAcceptanceIds: linked,
    perBill,
  });
}

// ---------------------------------------------------------------
// GET /finance/engagement-financials/:engId
// ---------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/engagement-financials/:engId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const engId = String(req.params.engId);

  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, engId),
        eq(atelierEngagements.orgId, me.orgId),
        isNull(atelierEngagements.deletedAt),
      ),
    )
    .limit(1);
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found" });
    return;
  }

  await recomputeEngagementCostToDate(engId, { actorUserId: me.id });

  // Task #442 — derive pricing model from the same opportunity → deal
  // pricing path used for Steward eligibility (atelierEngagements has
  // no pricingModel column).
  const engPricingModel = await lookupPricingModel(
    me.orgId,
    eng.opportunityId ?? null,
  );

  const [budget, cost, etcRow, account] = await Promise.all([
    getBudget(engId),
    getCost(engId),
    getEtc(engId),
    eng.accountId
      ? db
          .select()
          .from(atelierAccounts)
          .where(
            and(
              eq(atelierAccounts.id, eng.accountId),
              eq(atelierAccounts.orgId, me.orgId),
            ),
          )
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  // Invoices for this engagement (collections view) — tenant-scoped.
  const invoices = await db
    .select()
    .from(atelierInvoice)
    .where(
      and(
        eq(atelierInvoice.engagementId, engId),
        eq(atelierInvoice.orgId, me.orgId),
        isNull(atelierInvoice.deletedAt),
      ),
    )
    .orderBy(desc(atelierInvoice.createdAt))
    .limit(200);

  // Acceptances for this engagement (steward queue)
  const acceptances = await withRls(req, async (tx) =>
    tx
      .select()
      .from(atelierDeliverableAcceptance)
      .where(
        and(
          eq(atelierDeliverableAcceptance.engagementId, engId),
          isNull(atelierDeliverableAcceptance.deletedAt),
        ),
      )
      .orderBy(desc(atelierDeliverableAcceptance.createdAt))
      .limit(100),
  );

  const today = new Date().toISOString().slice(0, 10);
  const overdueInvoices = invoices.filter(
    (i) => i.status === "issued" && i.dueDate && i.dueDate < today && i.amountPaid < i.total,
  );

  // AR aging buckets + DSO. Standard 0-30/31-60/61-90/90+ buckets on
  // outstanding balance; DSO = (AR / billed-last-90d) × 90 (Burlington
  // formula simplified for the demo).
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  let arOutstandingUsd = 0;
  for (const i of invoices) {
    if (i.status === "void" || i.status === "draft") continue;
    const outstanding = Math.max(0, i.total - i.amountPaid);
    if (outstanding <= 0) continue;
    arOutstandingUsd += outstanding;
    const days = i.dueDate
      ? Math.floor((Date.now() - new Date(i.dueDate).getTime()) / (24 * 3600 * 1000))
      : 0;
    if (days <= 0) aging.current += outstanding;
    else if (days <= 30) aging.d30 += outstanding;
    else if (days <= 60) aging.d60 += outstanding;
    else if (days <= 90) aging.d90 += outstanding;
    else aging.d90plus += outstanding;
  }
  const ninetyDaysAgoMs = Date.now() - 90 * 24 * 3600 * 1000;
  const billedLast90 = invoices
    .filter((i) => i.issuedAt && i.issuedAt.getTime() >= ninetyDaysAgoMs)
    .reduce((s, i) => s + i.total, 0);
  const dsoDays = billedLast90 > 0 ? Math.round((arOutstandingUsd / billedLast90) * 90) : 0;

  // Steward queue: signed acceptances with no invoice referencing them yet.
  const linkedAcceptanceIds = new Set<string>();
  for (const inv of invoices) {
    const refs = (inv.notes ?? "").match(/dlacc_[a-z0-9_]+/gi) ?? [];
    for (const r of refs) linkedAcceptanceIds.add(r);
  }
  const stewardQueue = acceptances.filter(
    (a) => a.status === "client_signed" && !linkedAcceptanceIds.has(a.id),
  );

  // Bill-approval queues
  const pendingLeadApproval = invoices.filter((i) => i.status === "pending_lead_approval");
  const pendingFinanceApproval = invoices.filter(
    (i) => i.status === "pending_finance_approval",
  );

  // Header strip
  const contractValueUsd = budget?.contractValueUsd ?? 0;
  const recognisedUsd = cost?.revenueRecognisedToDateUsd ?? 0;
  const billedUsd = cost?.invoicedToDateUsd ?? 0;
  const collectedUsd = cost?.cashCollectedToDateUsd ?? 0;
  const eac = budget && cost && etcRow ? computeEac({ budget, cost, etc: etcRow }) : null;
  const grossMarginToDatePct =
    recognisedUsd > 0 ? (recognisedUsd - (cost?.costToDateUsd ?? 0)) / recognisedUsd : 0;

  // Plan vs actual: man-days (= labour-hours / 8) and elapsed weeks
  const plannedManDays = budget ? budget.budgetLabourHours / 8 : 0;
  const actualManDays = cost ? cost.labourHoursToDate / 8 : 0;
  const startMs = eng.startDate ? new Date(eng.startDate).getTime() : Date.now();
  const elapsedWeeks = Math.max(0, (Date.now() - startMs) / (7 * 24 * 3600 * 1000));
  // Task #442 — atelierEngagements uses `plannedEndDate` (not `endDate`).
  const plannedEnd = eng.plannedEndDate ?? null;
  const plannedWeeks = plannedEnd
    ? Math.max(0, (new Date(plannedEnd).getTime() - startMs) / (7 * 24 * 3600 * 1000))
    : null;

  // Leakage breakdown — naive, derived from BAC vs incurred & invoiced.
  const writeOffUsd = budget && cost
    ? Math.max(0, (cost.costToDateUsd / Math.max(1, budget.budgetAtCompletionUsd)) * contractValueUsd - billedUsd - (recognisedUsd - billedUsd))
    : 0;
  const realizationLossUsd = Math.max(0, recognisedUsd - billedUsd) * 0; // unbilled WIP isn't loss yet
  const overrunUsd = eac ? Math.max(0, -eac.vacUsd) : 0;
  const leakage = {
    writeOffUsd: Math.round(writeOffUsd),
    overrunUsd: Math.round(overrunUsd),
    realizationLossUsd: Math.round(realizationLossUsd),
    totalUsd: Math.round(writeOffUsd + overrunUsd + realizationLossUsd),
  };

  res.json({
    engagement: {
      id: eng.id,
      name: eng.name,
      accountId: eng.accountId,
      accountName: account?.name ?? null,
      pricingModel: engPricingModel,
      billingModel: deriveBillingModel(engPricingModel),
      startDate: eng.startDate ?? null,
      endDate: plannedEnd,
      partnerOwnerId: eng.partnerOwnerId,
      engagementLeadId: eng.engagementLeadId,
    },
    header: {
      contractValueUsd,
      recognisedRevenueUsd: recognisedUsd,
      billedUsd,
      collectedUsd,
      pctBilled: contractValueUsd > 0 ? billedUsd / contractValueUsd : 0,
      pctCollected: contractValueUsd > 0 ? collectedUsd / contractValueUsd : 0,
      grossMarginToDatePct,
      forecastFinalMarginPct: eac?.forecastFinalMarginPct ?? 0,
      ragStatus: eac?.ragStatus ?? "green",
      eacUsd: eac?.eacUsd ?? 0,
      vacUsd: eac?.vacUsd ?? 0,
      pctComplete: cost?.pctComplete ?? 0,
      plannedManDays: Math.round(plannedManDays),
      actualManDays: Math.round(actualManDays),
      elapsedWeeks: Math.round(elapsedWeeks * 10) / 10,
      plannedWeeks: plannedWeeks != null ? Math.round(plannedWeeks * 10) / 10 : null,
    },
    leakage,
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      status: i.status,
      currency: i.currency,
      total: i.total,
      amountPaid: i.amountPaid,
      dueDate: i.dueDate,
      issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
      paidAt: i.paidAt ? i.paidAt.toISOString() : null,
      notes: i.notes,
      createdAt: i.createdAt.toISOString(),
    })),
    overdueInvoices: overdueInvoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      total: i.total,
      amountPaid: i.amountPaid,
      dueDate: i.dueDate,
      daysOverdue: i.dueDate
        ? Math.floor((Date.now() - new Date(i.dueDate).getTime()) / (24 * 3600 * 1000))
        : 0,
    })),
    collections: {
      arOutstandingUsd: Math.round(arOutstandingUsd),
      dsoDays,
      aging: {
        current: Math.round(aging.current),
        d1_30: Math.round(aging.d30),
        d31_60: Math.round(aging.d60),
        d61_90: Math.round(aging.d90),
        d90plus: Math.round(aging.d90plus),
      },
    },
    acceptances: acceptances.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      milestoneId: a.milestoneId,
      deliverableId: a.deliverableId,
      signedAt: a.signedAt ? a.signedAt.toISOString() : null,
      submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
    })),
    stewardQueue: stewardQueue.map((a) => ({
      id: a.id,
      title: a.title,
      signedAt: a.signedAt ? a.signedAt.toISOString() : null,
      milestoneId: a.milestoneId,
    })),
    approvals: {
      pendingLeadApproval: pendingLeadApproval.map((i) => ({
        id: i.id,
        total: i.total,
        currency: i.currency,
        notes: i.notes,
        createdAt: i.createdAt.toISOString(),
      })),
      pendingFinanceApproval: pendingFinanceApproval.map((i) => ({
        id: i.id,
        total: i.total,
        currency: i.currency,
        notes: i.notes,
        createdAt: i.createdAt.toISOString(),
      })),
    },
    actionCenter: buildActionCenter({
      engId: eng.id,
      stewardQueueCount: stewardQueue.length,
      leadApprovalCount: pendingLeadApproval.length,
      financeApprovalCount: pendingFinanceApproval.length,
      overdueCount: overdueInvoices.length,
      overdueInvoiceId: overdueInvoices[0]?.id ?? null,
      ragStatus: eac?.ragStatus ?? "green",
      vacUsd: eac?.vacUsd ?? 0,
    }),
    permissions: {
      canRunSteward: canLeadApprove(me.role),
      canLeadApprove: canLeadApprove(me.role),
      canFinanceApprove: canFinanceApprove(me.role),
    },
  });
});

interface ActionCenterArgs {
  engId: string;
  stewardQueueCount: number;
  leadApprovalCount: number;
  financeApprovalCount: number;
  overdueCount: number;
  overdueInvoiceId: string | null;
  ragStatus: "green" | "amber" | "red";
  vacUsd: number;
}

interface ActionCenterItem {
  id: string;
  severity: "info" | "warn" | "urgent";
  label: string;
  detail: string;
  // Frontend renders these as one-click controls.
  action:
    | { kind: "run_steward"; engId: string }
    | { kind: "scroll"; targetId: string }
    | { kind: "open_invoice"; invoiceId: string }
    | { kind: "open_pnl_deepdive"; engId: string }
    | null;
  actionLabel: string | null;
}

function buildActionCenter(a: ActionCenterArgs): ActionCenterItem[] {
  const items: ActionCenterItem[] = [];
  if (a.stewardQueueCount > 0) {
    items.push({
      id: "steward_queue",
      severity: "warn",
      label: `${a.stewardQueueCount} signed deliverable(s) ready to bill`,
      detail: "Run the Billing Steward to draft bills against client-signed acceptances.",
      action: { kind: "run_steward", engId: a.engId },
      actionLabel: "Run Steward",
    });
  }
  if (a.leadApprovalCount > 0) {
    items.push({
      id: "lead_approval",
      severity: "warn",
      label: `${a.leadApprovalCount} bill(s) awaiting Lead approval`,
      detail: "Engagement Lead must review the steward-drafted bills before Finance.",
      action: { kind: "scroll", targetId: "queue-lead" },
      actionLabel: "Open queue",
    });
  }
  if (a.financeApprovalCount > 0) {
    items.push({
      id: "finance_approval",
      severity: "warn",
      label: `${a.financeApprovalCount} bill(s) awaiting Finance approval`,
      detail: "Finance must approve before the bill drops back into the issuance pipeline.",
      action: { kind: "scroll", targetId: "queue-finance" },
      actionLabel: "Open queue",
    });
  }
  if (a.overdueCount > 0 && a.overdueInvoiceId) {
    items.push({
      id: "overdue",
      severity: "urgent",
      label: `${a.overdueCount} invoice(s) past due`,
      detail: "Open the oldest overdue invoice to send a reminder or escalate.",
      action: { kind: "open_invoice", invoiceId: a.overdueInvoiceId },
      actionLabel: "Open oldest",
    });
  } else if (a.overdueCount > 0) {
    items.push({
      id: "overdue",
      severity: "urgent",
      label: `${a.overdueCount} invoice(s) past due`,
      detail: "Trigger collections / dunning ladder.",
      action: { kind: "scroll", targetId: "collections" },
      actionLabel: "Open collections",
    });
  }
  if (a.ragStatus === "red") {
    items.push({
      id: "rag_red",
      severity: "urgent",
      label: "Engagement RAG = RED",
      detail: `EAC variance ${a.vacUsd >= 0 ? "+" : ""}$${Math.round(a.vacUsd).toLocaleString()}.`,
      action: { kind: "open_pnl_deepdive", engId: a.engId },
      actionLabel: "P&L deep-dive",
    });
  } else if (a.ragStatus === "amber") {
    items.push({
      id: "rag_amber",
      severity: "warn",
      label: "Engagement RAG = AMBER",
      detail: "Forecast margin slipping below plan.",
      action: { kind: "open_pnl_deepdive", engId: a.engId },
      actionLabel: "P&L deep-dive",
    });
  }
  return items;
}

// ---------------------------------------------------------------
// POST /finance/engagement-financials/:engId/billing-steward/run
// ---------------------------------------------------------------
router.post(
  "/finance/engagement-financials/:engId/billing-steward/run",
  async (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canLeadApprove(me.role)) {
      res.status(403).json({ error: "steward-run-denied" });
      return;
    }
    const engId = String(req.params.engId);
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.id, engId),
          eq(atelierEngagements.orgId, me.orgId),
          isNull(atelierEngagements.deletedAt),
        ),
      )
      .limit(1);
    if (!eng) {
      res.status(404).json({ error: "engagement-not-found" });
      return;
    }
    // Lead approver must be the actual engagement lead, partner-owner,
    // or higher (leadership/finance). Senior managers may run only if
    // they are the named engagement lead.
    if (
      !isLeadership(me.role) &&
      !isFinance(me.role) &&
      me.id !== eng.engagementLeadId &&
      me.id !== eng.partnerOwnerId
    ) {
      res.status(403).json({ error: "steward-run-denied-not-engagement-lead" });
      return;
    }

    // Task #442 — Steward only drafts bills for milestone/deliverable
    // billing models. Resolve via opportunity → atelierDealPricings
    // (atelierEngagements has no pricingModel column) and short-circuit
    // for T&M / unsupported models so the manual run matches
    // autoDraftOnClientSign behavior.
    const pricingModel = await lookupPricingModel(
      me.orgId,
      eng.opportunityId ?? null,
    );
    if (!isStewardEligible(pricingModel)) {
      res.status(409).json({
        error: "steward-ineligible",
        pricingModel,
        message:
          "Billing Steward only drafts bills for milestone / deliverable / fixed-fee engagements.",
      });
      return;
    }

    const account = eng.accountId
      ? (
          await db
            .select()
            .from(atelierAccounts)
            .where(
              and(
                eq(atelierAccounts.id, eng.accountId),
                eq(atelierAccounts.orgId, me.orgId),
              ),
            )
            .limit(1)
        )[0] ?? null
      : null;

    const [signedAcc, existingInvs, budget] = await Promise.all([
      withRls(req, async (tx) =>
        tx
          .select()
          .from(atelierDeliverableAcceptance)
          .where(
            and(
              eq(atelierDeliverableAcceptance.engagementId, engId),
              eq(atelierDeliverableAcceptance.status, "client_signed"),
              isNull(atelierDeliverableAcceptance.deletedAt),
            ),
          ),
      ),
      db
        .select()
        .from(atelierInvoice)
        .where(
          and(
            eq(atelierInvoice.engagementId, engId),
            eq(atelierInvoice.orgId, me.orgId),
            isNull(atelierInvoice.deletedAt),
          ),
        ),
      getBudget(engId),
    ]);

    const linked = new Set<string>();
    for (const inv of existingInvs) {
      const refs = (inv.notes ?? "").match(/dlacc_[a-z0-9_]+/gi) ?? [];
      for (const r of refs) linked.add(r);
    }
    if (signedAcc.every((a) => linked.has(a.id))) {
      res.json({ drafted: [], message: "No signed acceptances pending bill drafting." });
      return;
    }
    const perBill = budget && budget.contractValueUsd > 0 && signedAcc.length > 0
      ? Math.round(budget.contractValueUsd / Math.max(signedAcc.length, 4))
      : 50_000;
    const drafted = await draftStewardBills({
      actor: me,
      engagement: eng,
      account,
      signedAcceptances: signedAcc,
      alreadyLinkedAcceptanceIds: linked,
      perBill,
    });
    res.json({
      drafted: drafted.map((d) => ({ id: d.invoiceId, ...d })),
      message: `Billing Steward drafted ${drafted.length} bill(s) awaiting Lead approval.`,
    });
  },
);

// ---------------------------------------------------------------
// POST /finance/engagement-financials/bills/:invoiceId/lead-approve
// ---------------------------------------------------------------
router.post(
  "/finance/engagement-financials/bills/:invoiceId/lead-approve",
  async (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canLeadApprove(me.role)) {
      res.status(403).json({ error: "lead-approve-denied" });
      return;
    }
    const invId = String(req.params.invoiceId);
    const rationale = typeof req.body?.rationale === "string"
      ? String(req.body.rationale).slice(0, 2000).trim()
      : "";
    const evidenceUrl = typeof req.body?.evidenceUrl === "string"
      ? String(req.body.evidenceUrl).slice(0, 1024).trim()
      : "";
    const [inv] = await db
      .select()
      .from(atelierInvoice)
      .where(
        and(
          eq(atelierInvoice.id, invId),
          eq(atelierInvoice.orgId, me.orgId),
          isNull(atelierInvoice.deletedAt),
        ),
      )
      .limit(1);
    if (!inv) {
      res.status(404).json({ error: "invoice-not-found" });
      return;
    }
    if (inv.status !== "pending_lead_approval") {
      res.status(409).json({ error: "illegal-transition", from: inv.status });
      return;
    }
    // Lead approver must be the engagement lead (or higher).
    if (inv.engagementId) {
      const [eng] = await db
        .select()
        .from(atelierEngagements)
        .where(
          and(
            eq(atelierEngagements.id, inv.engagementId),
            eq(atelierEngagements.orgId, me.orgId),
          ),
        )
        .limit(1);
      if (
        !eng ||
        (!isLeadership(me.role) &&
          !isFinance(me.role) &&
          me.id !== eng.engagementLeadId &&
          me.id !== eng.partnerOwnerId)
      ) {
        res.status(403).json({ error: "lead-approve-denied-not-engagement-lead" });
        return;
      }
    }
    await db
      .update(atelierInvoice)
      .set({
        status: "pending_finance_approval",
        notes: rationale
          ? `${inv.notes ?? ""}\nLead approval (${me.name}): ${rationale}${evidenceUrl ? ` [${evidenceUrl}]` : ""}`.trim()
          : inv.notes,
        updatedAt: new Date(),
      })
      .where(
        and(eq(atelierInvoice.id, invId), eq(atelierInvoice.orgId, me.orgId)),
      );
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "invoice",
      entityId: invId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "billing.steward.lead_approved",
      payload: { invoiceId: invId, rationale, evidenceUrl },
      payloadSummary: `${me.name} (Lead) approved Steward-drafted bill ${invId}; awaiting Finance.${rationale ? ` Rationale: ${rationale}` : ""}`,
    });
    // Pane-A + notifications for the finance/leadership queue. Route
    // to every active finance/leadership user in the same org so the
    // signal isn't misdirected to the lead approver.
    if (inv.engagementId) {
      const financeUsers = await db
        .select()
        .from(atelierUsers)
        .where(
          and(
            eq(atelierUsers.orgId, me.orgId),
            isNull(atelierUsers.deletedAt),
            inArray(atelierUsers.role, [
              "finance",
              "founding_partner",
              "partner",
            ]),
          ),
        );
      for (const u of financeUsers) {
        await db
          .insert(atelierPaneAItems)
          .values({
            id: `panea_bill_fin_${invId}_${u.id}`,
            userId: u.id,
            title: `Bill ready for Finance approval`,
            summary: `Lead approved a $${inv.total.toLocaleString()} bill; Finance approval needed before issuance.`,
            priority: "medium",
            hrefKind: "engagement_economics",
            hrefTargetId: inv.engagementId,
            dueLabel: "Today",
            sortKey: 75,
          })
          .onConflictDoNothing({ target: atelierPaneAItems.id });
        await db
          .insert(atelierNotifications)
          .values({
            id: rid("notif"),
            userId: u.id,
            kind: "bill_finance_approval_required",
            payload: { engagementId: inv.engagementId, invoiceId: invId, total: inv.total },
            subject: `Bill awaiting Finance approval`,
            body: `Lead ${me.name} approved a $${inv.total.toLocaleString()} bill on this engagement.`,
            refType: "invoice",
            refId: invId,
            status: "queued",
          });
      }
    }
    res.json({ ok: true, invoiceId: invId, status: "pending_finance_approval" });
  },
);

// ---------------------------------------------------------------
// POST /finance/engagement-financials/bills/:invoiceId/finance-approve
// ---------------------------------------------------------------
router.post(
  "/finance/engagement-financials/bills/:invoiceId/finance-approve",
  async (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canFinanceApprove(me.role)) {
      res.status(403).json({ error: "finance-approve-denied" });
      return;
    }
    const invId = String(req.params.invoiceId);
    const rationale = typeof req.body?.rationale === "string"
      ? String(req.body.rationale).slice(0, 2000).trim()
      : "";
    const evidenceUrl = typeof req.body?.evidenceUrl === "string"
      ? String(req.body.evidenceUrl).slice(0, 1024).trim()
      : "";
    const [inv] = await db
      .select()
      .from(atelierInvoice)
      .where(
        and(
          eq(atelierInvoice.id, invId),
          eq(atelierInvoice.orgId, me.orgId),
          isNull(atelierInvoice.deletedAt),
        ),
      )
      .limit(1);
    if (!inv) {
      res.status(404).json({ error: "invoice-not-found" });
      return;
    }
    if (inv.status !== "pending_finance_approval") {
      res.status(409).json({ error: "illegal-transition", from: inv.status });
      return;
    }
    await db
      .update(atelierInvoice)
      .set({
        status: "draft",
        notes: rationale
          ? `${inv.notes ?? ""}\nFinance approval (${me.name}): ${rationale}${evidenceUrl ? ` [${evidenceUrl}]` : ""}`.trim()
          : inv.notes,
        updatedAt: new Date(),
      })
      .where(
        and(eq(atelierInvoice.id, invId), eq(atelierInvoice.orgId, me.orgId)),
      );
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "invoice",
      entityId: invId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "billing.steward.finance_approved",
      payload: { invoiceId: invId, rationale, evidenceUrl },
      payloadSummary: `${me.name} (Finance) approved Steward-drafted bill ${invId}; ready to issue.${rationale ? ` Rationale: ${rationale}` : ""}`,
    });
    res.json({ ok: true, invoiceId: invId, status: "draft" });
  },
);

/* ────────────────────── Collections actions ──────────────────────
 * Task #442 — minimal but real action endpoints surfaced in the
 * Financials → Collections section so AR is not read-only. Each action
 * appends a structured, timestamped entry to the invoice's notes column
 * and writes an audit event so the activity is traceable. We
 * intentionally avoid mutating invoice status (the wallet pipeline owns
 * that) — `mark-disputed` is recorded as a flag inside notes plus an
 * audit event; finance can void/issue from the wallet ledger as today.
 */

function appendNote(existing: string | null, line: string): string {
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${line}`;
  return existing && existing.trim().length > 0 ? `${existing}\n${entry}` : entry;
}

async function loadInvoiceForAction(
  invId: string,
  orgId: string,
): Promise<typeof atelierInvoice.$inferSelect | null> {
  const [inv] = await db
    .select()
    .from(atelierInvoice)
    .where(and(eq(atelierInvoice.id, invId), eq(atelierInvoice.orgId, orgId)))
    .limit(1);
  return inv ?? null;
}

router.post(
  "/finance/engagement-financials/invoices/:invId/send-reminder",
  async (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    const invId = String(req.params.invId);
    const inv = await loadInvoiceForAction(invId, me.orgId);
    if (!inv) {
      res.status(404).json({ error: "invoice-not-found" });
      return;
    }
    const channel = String((req.body?.channel ?? "email") || "email");
    const message = String(req.body?.message ?? "").trim();
    const newNotes = appendNote(
      inv.notes,
      `Reminder sent via ${channel} by ${me.name}${message ? `: ${message}` : ""}`,
    );
    await db
      .update(atelierInvoice)
      .set({ notes: newNotes, updatedAt: new Date() })
      .where(
        and(eq(atelierInvoice.id, invId), eq(atelierInvoice.orgId, me.orgId)),
      );
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "invoice",
      entityId: invId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "collections.reminder_sent",
      payload: { invoiceId: invId, channel, message },
      payloadSummary: `${me.name} sent ${channel} reminder for invoice ${inv.invoiceNumber ?? invId}.`,
    });
    res.json({ ok: true, invoiceId: invId });
  },
);

router.post(
  "/finance/engagement-financials/invoices/:invId/log-commitment",
  async (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    const invId = String(req.params.invId);
    const inv = await loadInvoiceForAction(invId, me.orgId);
    if (!inv) {
      res.status(404).json({ error: "invoice-not-found" });
      return;
    }
    const promisedDate = String(req.body?.promisedDate ?? "").trim();
    const promisedAmountUsd = Number(req.body?.promisedAmountUsd ?? 0);
    const note = String(req.body?.note ?? "").trim();
    if (!promisedDate) {
      res.status(400).json({ error: "promised-date-required" });
      return;
    }
    const newNotes = appendNote(
      inv.notes,
      `Commitment logged by ${me.name}: $${promisedAmountUsd.toLocaleString()} by ${promisedDate}${note ? ` — ${note}` : ""}`,
    );
    await db
      .update(atelierInvoice)
      .set({ notes: newNotes, updatedAt: new Date() })
      .where(
        and(eq(atelierInvoice.id, invId), eq(atelierInvoice.orgId, me.orgId)),
      );
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "invoice",
      entityId: invId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "collections.commitment_logged",
      payload: { invoiceId: invId, promisedDate, promisedAmountUsd, note },
      payloadSummary: `${me.name} logged collection commitment on invoice ${inv.invoiceNumber ?? invId}: $${promisedAmountUsd.toLocaleString()} by ${promisedDate}.`,
    });
    res.json({ ok: true, invoiceId: invId });
  },
);

router.post(
  "/finance/engagement-financials/invoices/:invId/mark-disputed",
  async (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    const invId = String(req.params.invId);
    const inv = await loadInvoiceForAction(invId, me.orgId);
    if (!inv) {
      res.status(404).json({ error: "invoice-not-found" });
      return;
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) {
      res.status(400).json({ error: "reason-required" });
      return;
    }
    const newNotes = appendNote(
      inv.notes,
      `DISPUTED — flagged by ${me.name}: ${reason}`,
    );
    await db
      .update(atelierInvoice)
      .set({ notes: newNotes, updatedAt: new Date() })
      .where(
        and(eq(atelierInvoice.id, invId), eq(atelierInvoice.orgId, me.orgId)),
      );
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "invoice",
      entityId: invId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "collections.disputed",
      payload: { invoiceId: invId, reason },
      payloadSummary: `${me.name} marked invoice ${inv.invoiceNumber ?? invId} as disputed: ${reason}`,
    });
    res.json({ ok: true, invoiceId: invId });
  },
);

router.post(
  "/finance/engagement-financials/invoices/:invId/escalate",
  async (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    const invId = String(req.params.invId);
    const inv = await loadInvoiceForAction(invId, me.orgId);
    if (!inv) {
      res.status(404).json({ error: "invoice-not-found" });
      return;
    }
    const note = String(req.body?.note ?? "").trim();
    const newNotes = appendNote(
      inv.notes,
      `ESCALATED to founding partners by ${me.name}${note ? `: ${note}` : ""}`,
    );
    await db
      .update(atelierInvoice)
      .set({ notes: newNotes, updatedAt: new Date() })
      .where(
        and(eq(atelierInvoice.id, invId), eq(atelierInvoice.orgId, me.orgId)),
      );

    // Notify founding partners + finance in the same org via Pane-A.
    const partners = await db
      .select()
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.orgId, me.orgId),
          inArray(atelierUsers.role, [
            "founding_partner",
            "partner",
            "finance",
          ]),
        ),
      );
    for (const p of partners) {
      await db
        .insert(atelierPaneAItems)
        .values({
          id: `panea_collesc_${invId}_${p.id}`,
          userId: p.id,
          title: "Collections escalated",
          summary: `${me.name} escalated invoice ${inv.invoiceNumber ?? invId}${note ? ` — ${note}` : ""}.`,
          priority: "high",
          hrefKind: inv.engagementId ? "engagement_economics" : "invoice",
          hrefTargetId: inv.engagementId ?? invId,
          dueLabel: "Today",
          sortKey: 80,
        })
        .onConflictDoNothing({ target: atelierPaneAItems.id });
    }
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "invoice",
      entityId: invId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "collections.escalated",
      payload: { invoiceId: invId, note, notified: partners.map((p) => p.id) },
      payloadSummary: `${me.name} escalated invoice ${inv.invoiceNumber ?? invId} to founding partners.`,
    });
    res.json({ ok: true, invoiceId: invId, notified: partners.length });
  },
);

export default router;
