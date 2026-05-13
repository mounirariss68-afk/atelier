/**
 * Invoice Composer — Task #260.
 *
 * On-demand composer triggered from the engagement-economics view.
 * Reads:
 *   - Approved billable timesheet entries (atelier_timesheet_entries
 *     where status='approved', billable=true, engagementId=:eid)
 *     × applicable rate-card rate (from the engagement's deal pricing).
 *   - Approved client-billable expenses (atelier_expenses where
 *     status='approved', clientBillable=true, engagementId=:eid)
 *     × markup percentage stored on the expense row.
 *
 * Writes one atelier_invoice_line_drafts row carrying the flattened
 * line set + totals; returned as JSON; CSV export is rendered by the
 * route handler.
 */

import {
  db,
  atelierInvoiceLineDrafts,
  atelierTimesheetEntries,
  atelierExpenses,
  atelierEngagements,
  atelierOpportunities,
  atelierDealPricings,
  atelierRateCards,
  atelierRateCardRows,
  atelierEmployees,
  atelierContractors,
  atelierAuditEvents,
  type InvoiceLineDraftLine,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { convertToUsd } from "./atelier-fx.js";
import { buildContractDigest } from "./atelier-contract-digest.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_BILL_RATE_USD = 250;

/**
 * Build a seniority -> billRateUsd lookup for an engagement.
 * Resolution order: (1) deal_pricing.rate_card_id; (2) any active rate card.
 * Falls back to DEFAULT_BILL_RATE_USD if neither is present.
 */
async function resolveRateMap(engagementId: string): Promise<{
  rateCardId: string | null;
  rateBySeniority: Map<string, number>;
}> {
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(eq(atelierEngagements.id, engagementId));
  let rateCardId: string | null = null;
  if (eng?.opportunityId) {
    const [pricing] = await db
      .select()
      .from(atelierDealPricings)
      .where(
        and(
          eq(atelierDealPricings.opportunityId, eng.opportunityId),
          isNull(atelierDealPricings.deletedAt),
        ),
      );
    rateCardId = pricing?.rateCardId ?? null;
  }
  if (!rateCardId) {
    const [card] = await db
      .select()
      .from(atelierRateCards)
      .where(
        and(eq(atelierRateCards.status, "active"), isNull(atelierRateCards.deletedAt)),
      );
    rateCardId = card?.id ?? null;
  }
  const rateBySeniority = new Map<string, number>();
  if (rateCardId) {
    const rows = await db
      .select()
      .from(atelierRateCardRows)
      .where(
        and(eq(atelierRateCardRows.rateCardId, rateCardId), isNull(atelierRateCardRows.deletedAt)),
      );
    // Rate-card rows store a day-rate (8h) in client-price terms; convert to
    // hourly so the composer can multiply directly by timesheet hours.
    for (const r of rows) {
      const hourly = r.dayRateClientPrice > 0 ? r.dayRateClientPrice / 8 : DEFAULT_BILL_RATE_USD;
      rateBySeniority.set(r.seniority, +hourly.toFixed(2));
    }
  }
  return { rateCardId, rateBySeniority };
}

export interface InvoiceComposerOutput {
  draftId: string;
  engagementId: string;
  rateCardId: string | null;
  lines: InvoiceLineDraftLine[];
  totals: {
    hoursUsd: number;
    expensesNetUsd: number;
    markupUsd: number;
    totalUsd: number;
    lineCount: number;
  };
  composedAt: string;
}

interface RunArgs {
  engagementId: string;
  composedByUserId: string | null;
}

export async function runInvoiceComposer(args: RunArgs): Promise<InvoiceComposerOutput> {
  const { engagementId, composedByUserId } = args;
  const composerRunId = rid("icr");

  const { rateCardId, rateBySeniority } = await resolveRateMap(engagementId);
  const fallbackRate =
    rateBySeniority.size > 0
      ? rateBySeniority.values().next().value ?? DEFAULT_BILL_RATE_USD
      : DEFAULT_BILL_RATE_USD;

  // Pre-resolve seniority for every person we'll bill so each hours bucket
  // can use the *applicable* rate-card row, not a single fallback rate.
  // Atelier persons live in either atelier_employees (consultants/staff)
  // or atelier_contractors (1099/T&M). Both expose a `seniority` column;
  // we look the person up by id against both tables and pick whichever
  // resolves first.
  async function resolveSeniorityRate(personId: string): Promise<{
    seniority: string;
    rate: number;
  }> {
    const [emp] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, personId));
    if (emp?.seniority) {
      return {
        seniority: emp.seniority,
        rate: rateBySeniority.get(emp.seniority) ?? fallbackRate,
      };
    }
    const [con] = await db.select().from(atelierContractors).where(eq(atelierContractors.id, personId));
    if (con?.seniority) {
      return {
        seniority: con.seniority,
        rate: rateBySeniority.get(con.seniority) ?? fallbackRate,
      };
    }
    return { seniority: "unknown", rate: fallbackRate };
  }

  // ---- Hours lines (per timesheet entry, grouped by personId+activityCode) ----
  const entries = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(
      and(
        eq(atelierTimesheetEntries.engagementId, engagementId),
        eq(atelierTimesheetEntries.billable, true),
        eq(atelierTimesheetEntries.status, "approved"),
        isNull(atelierTimesheetEntries.deletedAt),
      ),
    );

  const lines: InvoiceLineDraftLine[] = [];
  let hoursUsd = 0;
  let expensesNetUsd = 0;
  let markupUsd = 0;

  // Roll up by personId + workDate-month for a more readable invoice
  type HoursAgg = { personId: string; month: string; hours: number; entryIds: string[] };
  const byBucket = new Map<string, HoursAgg>();
  for (const e of entries) {
    const month = (e.workDate ?? "").slice(0, 7) || "unknown";
    const key = `${e.personId}|${month}`;
    const cur = byBucket.get(key) ?? { personId: e.personId, month, hours: 0, entryIds: [] };
    cur.hours += e.hours ?? 0;
    cur.entryIds.push(e.id);
    byBucket.set(key, cur);
  }
  for (const agg of byBucket.values()) {
    if (agg.hours <= 0) continue;
    const { seniority, rate: unit } = await resolveSeniorityRate(agg.personId);
    const amount = +(agg.hours * unit).toFixed(2);
    hoursUsd += amount;
    lines.push({
      kind: "hours",
      sourceId: agg.entryIds[0],
      description: `Billable hours — ${agg.personId} (${seniority}) (${agg.month})`,
      qty: +agg.hours.toFixed(2),
      unitPriceUsd: unit,
      amountUsd: amount,
      meta: { personId: agg.personId, seniority, month: agg.month, entryIds: agg.entryIds },
    });
  }

  // ---- Expense lines (one per approved client-billable expense) ----
  const expenses = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.engagementId, engagementId),
        eq(atelierExpenses.clientBillable, true),
        eq(atelierExpenses.status, "approved"),
        isNull(atelierExpenses.deletedAt),
      ),
    );
  for (const ex of expenses) {
    const net = +ex.usdAmount.toFixed(2);
    const markupPct = ex.markupPct ?? 0;
    const lineMarkup = +(net * markupPct).toFixed(2);
    const amount = +(net + lineMarkup).toFixed(2);
    expensesNetUsd += net;
    markupUsd += lineMarkup;
    lines.push({
      kind: "expense",
      sourceId: ex.id,
      description: `${ex.merchant ?? "Expense"} — ${ex.category} (${ex.expenseDate})`,
      qty: 1,
      unitPriceUsd: amount,
      amountUsd: amount,
      markupPct,
      meta: {
        merchant: ex.merchant,
        category: ex.category,
        currency: ex.currency,
        netUsd: net,
        markupUsd: lineMarkup,
      },
    });
  }

  const totals = {
    hoursUsd: +hoursUsd.toFixed(2),
    expensesNetUsd: +expensesNetUsd.toFixed(2),
    markupUsd: +markupUsd.toFixed(2),
    totalUsd: +(hoursUsd + expensesNetUsd + markupUsd).toFixed(2),
    lineCount: lines.length,
  };

  // Soft-delete prior drafts so "current" is unambiguous; keep audit trail.
  await db
    .update(atelierInvoiceLineDrafts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(atelierInvoiceLineDrafts.engagementId, engagementId),
        isNull(atelierInvoiceLineDrafts.deletedAt),
      ),
    );

  const draftId = rid("ild");
  await db.insert(atelierInvoiceLineDrafts).values({
    id: draftId,
    engagementId,
    composedByUserId,
    composerRunId,
    rateCardId,
    lines,
    totals,
    status: "draft",
  });

  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "invoice_line_draft",
    entityId: draftId,
    actorType: composedByUserId ? "human" : "agent",
    actorId: composedByUserId,
    actorLabel: "Invoice Composer",
    action: "wallet.invoice_composer.run",
    payload: { engagementId, totals, rateCardId } as never,
    payloadSummary: `Composed ${lines.length} draft line(s); total $${totals.totalUsd.toFixed(2)}.`,
  });

  return {
    draftId,
    engagementId,
    rateCardId,
    lines,
    totals,
    composedAt: new Date().toISOString(),
  };
}

// Used by the Salon Publish Sentinel kind=expense extension.
export async function expensePublishSentinelChecks(args: {
  expenseId: string;
}): Promise<{
  status: "pass" | "warn" | "fail";
  publishAllowed: boolean;
  checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }>;
  redactionProposal: string | null;
  confidence: "green" | "amber" | "red";
}> {
  const [ex] = await db
    .select()
    .from(atelierExpenses)
    .where(and(eq(atelierExpenses.id, args.expenseId), isNull(atelierExpenses.deletedAt)));
  const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }> = [];
  if (!ex) {
    return {
      status: "fail",
      publishAllowed: false,
      checks: [{ name: "exists", status: "fail", detail: "Expense not found" }],
      redactionProposal: null,
      confidence: "red",
    };
  }

  // 1) Must be lead-approved before the third gate.
  if (ex.status !== "approved") {
    checks.push({
      name: "lead_approved",
      status: "fail",
      detail: `Expense status is "${ex.status}" — must be lead-approved before client-bill.`,
    });
  } else {
    checks.push({ name: "lead_approved", status: "pass", detail: "Lead-approved." });
  }

  // 2) clientBillable must be set.
  if (!ex.clientBillable) {
    checks.push({
      name: "client_billable_flag",
      status: "fail",
      detail: "Expense not flagged client-billable.",
    });
  } else {
    checks.push({
      name: "client_billable_flag",
      status: "pass",
      detail: "Marked client-billable.",
    });
  }

  // 3) Contract-derived markup cap. Use the engagement charter's
  // expense-clause cap (resolved by buildContractDigest) instead of a
  // hardcoded band. Fail (RED) when over cap; warn when expense is
  // billable but engagement has no clause; pass otherwise.
  const digest = await buildContractDigest(ex.engagementId ?? null);
  // markup_pct is stored in percent units (e.g. 10 = 10%) to match the
  // submit-time check in walletRoutes; the contract digest cap is also
  // expressed in percent (e.g. 10).
  const mp = ex.markupPct ?? 0;
  const cap = digest?.expenseMarkupCapPct ?? 0;
  if (!digest) {
    checks.push({
      name: "markup_band",
      status: "warn",
      detail: `Cannot resolve engagement contract for markup check — defaulting to AMBER.`,
    });
  } else if (!digest.expensesClause) {
    checks.push({
      name: "markup_band",
      status: "fail",
      detail: `Engagement has no expense pass-through clause; markup ${mp.toFixed(1)}% cannot be billed.`,
    });
  } else if (mp < 0 || mp > cap) {
    checks.push({
      name: "markup_band",
      status: "fail",
      detail: `Markup ${mp.toFixed(1)}% exceeds contract cap of ${cap.toFixed(0)}% on this engagement.`,
    });
  } else {
    checks.push({
      name: "markup_band",
      status: "pass",
      detail: `Markup ${mp.toFixed(1)}% within contract cap of ${cap.toFixed(0)}%.`,
    });
  }

  // 4) Contract-allowed category — driven by the contract digest's
  // permitted/blocked/amber category lists rather than a hardcoded set.
  const cat = (ex.category ?? "other").toLowerCase();
  const permitted = digest?.permittedCategories ?? [];
  const blocked = digest?.blockedCategories ?? [];
  const ambered = digest?.amberCategories ?? [];
  if (blocked.includes(cat)) {
    checks.push({
      name: "category_allowed",
      status: "fail",
      detail: `Category "${cat}" is never client-billable (contract block-list).`,
    });
  } else if (digest && permitted.length > 0 && !permitted.includes(cat)) {
    checks.push({
      name: "category_allowed",
      status: "fail",
      detail: `Category "${cat}" is outside this engagement's contract pass-through scope (${permitted.join(", ")}).`,
    });
  } else if (ambered.includes(cat)) {
    checks.push({
      name: "category_allowed",
      status: "warn",
      detail: `Category "${cat}" requires explicit contract clause; verify before billing.`,
    });
  } else {
    checks.push({
      name: "category_allowed",
      status: "pass",
      detail: `Category "${cat}" allowed for client billing.`,
    });
  }

  // 5) Watermark / receipt evidence — receipt ref must be present.
  if (!ex.receiptFileRef && !ex.receiptFixtureKey && ex.captureSource !== "per_diem") {
    checks.push({
      name: "watermark_receipt",
      status: "warn",
      detail: "No receipt reference attached; client may dispute.",
    });
  } else {
    checks.push({
      name: "watermark_receipt",
      status: "pass",
      detail: "Receipt evidence present.",
    });
  }

  const failed = checks.some((c) => c.status === "fail");
  const warned = checks.some((c) => c.status === "warn");
  const status: "pass" | "warn" | "fail" = failed ? "fail" : warned ? "warn" : "pass";
  return {
    status,
    publishAllowed: !failed,
    checks,
    redactionProposal: failed
      ? "Re-categorise or remove client-billable flag, or invoke Partner override with rationale."
      : null,
    confidence: failed ? "red" : warned ? "amber" : "green",
  };
}
