/**
 * Atelier — Finance real-data facts loader (Task #177).
 *
 * Single shared module that derives every Finance Plan / Reports figure
 * from real operational records, replacing the fabricated demo arrays
 * that were removed under the no-demo-data policy (2026-07-16):
 *
 *   - Cash receipts       ← open AR on issued invoices (total − amountPaid,
 *                           expected on dueDate) + earned/invoiceable
 *                           revenue milestones.
 *   - Cash disbursements  ← monthly payroll from the active employee
 *                           roster (baseCompensation is annual → /12),
 *                           unpaid contractor payment proposals, and
 *                           approved-but-unreimbursed expense claims.
 *   - Backlog             ← engagement budgets (contract value) minus
 *                           recognised-to-date, per live engagement.
 *   - Pipeline            ← open CRM opportunities weighted by
 *                           probabilityPct.
 *   - Headcount plan      ← active employees grouped by seniority.
 *   - Overhead            ← trailing-3-month average of approved,
 *                           non-client-billable expense spend.
 *   - Monthly P&L facts   ← issued invoices (revenue), contractor
 *                           payments + billable expenses (direct cost),
 *                           roster payroll, non-billable expenses (opex).
 *   - Profitability cube  ← per-engagement invoice revenue vs contractor
 *                           payment + billable expense cost.
 *
 * Every number is traceable to a concrete DB row; when no rows exist the
 * surfaces render honest zeros. Results are cached for a short TTL so a
 * page-load fan-out of finance endpoints hits the DB once.
 */
import { and, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  atelierInvoice,
  atelierExpenses,
  atelierEmployees,
  atelierContractorPayments,
  atelierOpportunities,
  atelierEngagements,
  atelierAccounts,
  atelierUsers,
  atelierEngagementBudget,
  atelierEngagementCostToDate,
  atelierRevenueMilestone,
} from "@workspace/db";

// FX aligned with financePlanFpaEngine.FX_TO_USD.
const FX_TO_USD: Record<string, number> = {
  USD: 1.0, GBP: 1.27, AED: 0.272, SAR: 0.267, EUR: 1.08,
};
function toUsd(amount: number, currency: string | null | undefined): number {
  return amount * (FX_TO_USD[currency ?? "USD"] ?? 1);
}

export const FIRM_ENTITY_ID = "firm";

// ─────────────────────── shapes ───────────────────────
export type ReceiptSource = "open_ar" | "milestone" | "other";
export type DisbursementCategory =
  | "payroll" | "vendor" | "tax_vat" | "tax_ct" | "lease" | "debt_service" | "other";

export interface FactCashLine {
  id: string;
  entityId: string;
  currency: string;
  amount: number;
  expectedDate: string; // ISO date
  confidence: "high" | "medium" | "low";
  label: string;
  detail?: string;
}
export interface FactReceipt extends FactCashLine { source: ReceiptSource; counterparty: string }
export interface FactDisbursement extends FactCashLine { category: DisbursementCategory; vendor: string }

export interface FactBacklogContract {
  id: string;
  client: string;
  sector: string;
  partnerOwner: string;
  entityId: string;
  currency: string;
  signedTotalLocal: number;
  recognisedToDateLocal: number;
  remainingLocal: number;
  expectedBurnPerQuarterLocal: number;
  endsOn: string;
}
export interface FactPipelineDeal {
  id: string;
  name: string;
  client: string;
  sector: string;
  partnerOwner: string;
  entityId: string;
  currency: string;
  acvLocal: number;
  stage: "discover" | "qualify" | "shape" | "propose" | "negotiate" | "verbal";
  stageProbability: number;
  expectedClose: string;
}

export interface FactHeadcountRow {
  entityId: string;
  roleCode: "P" | "SM" | "M" | "SC" | "C" | "A";
  startingHeadcount: number;
}
export interface FactBonusPerson {
  id: string;
  name: string;
  roleCode: "P" | "SM" | "M" | "SC" | "C" | "A";
  entityId: string;
  baseSalaryAnnualUsd: number;
}
export interface FactRenewal {
  id: string;
  client: string;
  entityId: string;
  currency: string;
  arrLocal: number;
  expiresOn: string;
  ownerName: string;
}

export interface FactMonth {
  revenueUsd: number;    // issued invoice subtotals (ex-VAT)
  directCostUsd: number; // contractor payments + client-billable expenses
  payrollUsd: number;    // roster base comp / 12 for months the firm had staff
  opexUsd: number;       // approved non-billable expenses
}

export interface FactCubeRow {
  engagementId: string;
  engagement: string;
  client: string;
  sector: string;
  partner: string;
  entityId: string;
  revenueUsd: number;
  directCostUsd: number;
}

export interface FactBalances {
  cashCollectedUsd: number;   // cumulative invoice receipts
  cashPaidOutUsd: number;     // cumulative reimbursed expenses + paid contractor payments
  openArUsd: number;          // issued, unpaid invoice remainder
  openApUsd: number;          // unpaid contractor payments + approved unreimbursed expenses
}

export interface FinanceFacts {
  loadedAt: string;
  receipts: FactReceipt[];
  disbursements: FactDisbursement[];
  backlog: FactBacklogContract[];
  pipeline: FactPipelineDeal[];
  headcount: FactHeadcountRow[];
  bonusPeople: FactBonusPerson[];
  renewals: FactRenewal[];
  overheadFixedMonthlyUsd: number;
  /** "YYYY-MM" → monthly P&L facts, last 24 months. */
  monthly: Record<string, FactMonth>;
  cube: FactCubeRow[];
  balances: FactBalances;
  /** balances as-of each month end, "YYYY-MM" → snapshot (last 24 months). */
  balancesByMonth: Record<string, FactBalances>;
  /** Submitted-but-unapproved expense spend, "YYYY-MM" → USD (Task #1069).
   *  Correctly EXCLUDED from monthly facts — surfaced separately so
   *  pending spend is never invisible on facts-driven reports. */
  pendingByMonth: Record<string, number>;
}

// ─────────────────────── helpers ───────────────────────
const SENIORITY_TO_ROLE: Record<string, FactHeadcountRow["roleCode"]> = {
  partner: "P",
  principal: "SM",
  manager: "M",
  senior_consultant: "SC",
  consultant: "C",
  analyst: "A",
};

const STAGE_MAP: Record<string, { stage: FactPipelineDeal["stage"] }> = {
  suspect: { stage: "discover" },
  prospect: { stage: "qualify" },
  convert: { stage: "propose" },
  runner: { stage: "negotiate" },
};
const OPEN_STAGES = Object.keys(STAGE_MAP);

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function monthKey(d: Date): string { return d.toISOString().slice(0, 7); }
function monthKeyFromIso(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return null;
  return iso.slice(0, 7);
}
function lastNMonthKeys(n: number, anchor: Date): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(monthKey(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1))));
  }
  return out;
}
function endOfMonthIso(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return isoDay(new Date(Date.UTC(y, m, 0)));
}
/** ISO week "2026-W12" → the Friday of that week (payment day proxy). */
function isoWeekFriday(weekIso: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekIso);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const friday = new Date(mondayW1);
  friday.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7 + 4);
  return isoDay(friday);
}

// ─────────────────────── loader ───────────────────────
// Facts are computed and cached PER ORG — every query below is scoped to
// the caller's orgId so tenants can never see each other's figures.
const cache = new Map<string, { at: number; facts: FinanceFacts }>();
const inflight = new Map<string, Promise<FinanceFacts>>();
const TTL_MS = 15_000;

export async function loadFinanceFacts(orgId: string): Promise<FinanceFacts> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.facts;
  const running = inflight.get(orgId);
  if (running) return running;
  const p = (async () => {
    try {
      const facts = await computeFacts(orgId);
      cache.set(orgId, { at: Date.now(), facts });
      return facts;
    } finally {
      inflight.delete(orgId);
    }
  })();
  inflight.set(orgId, p);
  return p;
}

export function invalidateFinanceFacts(): void {
  cache.clear();
}

async function computeFacts(orgId: string): Promise<FinanceFacts> {
  const now = new Date();
  const today = isoDay(now);

  const [invoices, expenses, submittedExpenses, employees, contractorPayments, opportunities, engagements, budgets, ctds, milestones] =
    await Promise.all([
      db.select().from(atelierInvoice).where(and(eq(atelierInvoice.orgId, orgId), isNull(atelierInvoice.deletedAt))),
      db.select().from(atelierExpenses)
        .where(and(eq(atelierExpenses.orgId, orgId), isNull(atelierExpenses.deletedAt), inArray(atelierExpenses.status, ["approved", "reimbursed"]))),
      // Task #1069 — pending (submitted) claims, reported separately.
      db.select().from(atelierExpenses)
        .where(and(eq(atelierExpenses.orgId, orgId), isNull(atelierExpenses.deletedAt), eq(atelierExpenses.status, "submitted"))),
      db.select().from(atelierEmployees).where(and(eq(atelierEmployees.orgId, orgId), isNull(atelierEmployees.deletedAt), eq(atelierEmployees.status, "active"))),
      db.select().from(atelierContractorPayments).where(and(eq(atelierContractorPayments.orgId, orgId), isNull(atelierContractorPayments.deletedAt))),
      db.select().from(atelierOpportunities).where(and(eq(atelierOpportunities.orgId, orgId), isNull(atelierOpportunities.deletedAt), inArray(atelierOpportunities.salesStage, OPEN_STAGES))),
      db.select().from(atelierEngagements).where(and(eq(atelierEngagements.orgId, orgId), isNull(atelierEngagements.deletedAt))),
      db.select().from(atelierEngagementBudget).where(eq(atelierEngagementBudget.orgId, orgId)),
      db.select().from(atelierEngagementCostToDate).where(eq(atelierEngagementCostToDate.orgId, orgId)),
      db.select().from(atelierRevenueMilestone).where(and(eq(atelierRevenueMilestone.orgId, orgId), inArray(atelierRevenueMilestone.status, ["earned", "invoiceable"]))),
    ]);

  // Lookup maps.
  const accountIds = new Set<string>();
  for (const o of opportunities) accountIds.add(o.accountId);
  for (const e of engagements) accountIds.add(e.accountId);
  for (const i of invoices) if (i.accountId) accountIds.add(i.accountId);
  const accounts = accountIds.size
    ? await db.select().from(atelierAccounts).where(and(eq(atelierAccounts.orgId, orgId), inArray(atelierAccounts.id, [...accountIds])))
    : [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const userIds = new Set<string>();
  for (const o of opportunities) userIds.add(o.partnerOwnerId);
  for (const e of engagements) userIds.add(e.partnerOwnerId);
  const users = userIds.size
    ? await db.select({ id: atelierUsers.id, name: atelierUsers.name }).from(atelierUsers).where(and(eq(atelierUsers.orgId, orgId), inArray(atelierUsers.id, [...userIds])))
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.name]));
  const engagementById = new Map(engagements.map((e) => [e.id, e]));
  const budgetByEng = new Map(budgets.map((b) => [b.engagementId, b]));
  const ctdByEng = new Map(ctds.map((c) => [c.engagementId, c]));

  // ── Receipts: open AR + earned milestones ──
  const receipts: FactReceipt[] = [];
  for (const inv of invoices) {
    if (inv.status !== "issued" || inv.voidedAt || inv.paidAt) continue;
    const remaining = (inv.total ?? 0) - (inv.amountPaid ?? 0);
    if (remaining <= 0.005) continue;
    const acct = inv.accountId ? accountById.get(inv.accountId) : undefined;
    const counterparty = inv.billTo?.name || acct?.name || "Client";
    const due = inv.dueDate || (inv.issuedAt ? isoDay(new Date(inv.issuedAt.getTime() + 30 * 86_400_000)) : today);
    const overdue = due < today;
    receipts.push({
      id: `rcpt_inv_${inv.id}`,
      entityId: FIRM_ENTITY_ID,
      currency: inv.currency ?? "USD",
      amount: Math.round(remaining * 100) / 100,
      // Overdue AR is expected in the coming week, not in the past.
      expectedDate: overdue ? today : due,
      confidence: overdue ? "medium" : "high",
      source: "open_ar",
      counterparty,
      label: `Invoice ${inv.invoiceNumber ?? inv.id} — ${counterparty}`,
      detail: overdue ? `Overdue since ${due}` : `Due ${due}`,
    });
  }
  for (const ms of milestones) {
    const eng = engagementById.get(ms.engagementId);
    const acct = eng ? accountById.get(eng.accountId) : undefined;
    const amount = ms.earnedAmount > 0 ? ms.earnedAmount : ms.plannedAmount;
    if (amount <= 0) continue;
    receipts.push({
      id: `rcpt_ms_${ms.id}`,
      entityId: FIRM_ENTITY_ID,
      currency: "USD",
      amount,
      expectedDate: ms.plannedDate && ms.plannedDate >= today ? ms.plannedDate : today,
      confidence: ms.status === "invoiceable" ? "high" : "medium",
      source: "milestone",
      counterparty: acct?.name ?? eng?.name ?? "Client",
      label: `Milestone — ${ms.name}${eng ? ` (${eng.name})` : ""}`,
      detail: `Status: ${ms.status}`,
    });
  }

  // ── Disbursements ──
  const disbursements: FactDisbursement[] = [];
  // Monthly payroll from the active roster (baseCompensation is annual).
  const monthlyPayrollUsd = employees.reduce(
    (s, e) => s + (e.baseCompensation ? toUsd(e.baseCompensation, e.baseCurrency) / 12 : 0), 0);
  if (monthlyPayrollUsd > 0) {
    for (let i = 0; i < 4; i++) {
      const eom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 0));
      if (eom < now) continue;
      const key = monthKey(eom);
      disbursements.push({
        id: `dis_payroll_${key}`,
        entityId: FIRM_ENTITY_ID,
        currency: "USD",
        amount: Math.round(monthlyPayrollUsd),
        expectedDate: isoDay(eom),
        confidence: "high",
        category: "payroll",
        vendor: "Payroll",
        label: `Payroll run — ${key} (${employees.length} staff)`,
        detail: "Active roster base compensation / 12",
      });
    }
  }
  // Contractor payment proposals not yet paid.
  for (const cp of contractorPayments) {
    if (cp.status !== "proposed" && cp.status !== "partner_approved") continue;
    if ((cp.usdAmount ?? 0) <= 0) continue;
    const wkFriday = isoWeekFriday(cp.weekIso);
    disbursements.push({
      id: `dis_cp_${cp.id}`,
      entityId: FIRM_ENTITY_ID,
      currency: "USD",
      amount: cp.usdAmount,
      expectedDate: wkFriday && wkFriday >= today ? wkFriday : today,
      confidence: cp.status === "partner_approved" ? "high" : "medium",
      category: "vendor",
      vendor: cp.payeeName,
      label: `Contractor payment — ${cp.payeeName} (${cp.weekIso})`,
      detail: `Status: ${cp.status}`,
    });
  }
  // Approved, unreimbursed expense claims.
  for (const ex of expenses) {
    if (ex.status !== "approved" || ex.reimbursedAt) continue;
    if ((ex.usdAmount ?? 0) <= 0) continue;
    disbursements.push({
      id: `dis_exp_${ex.id}`,
      entityId: FIRM_ENTITY_ID,
      currency: "USD",
      amount: ex.usdAmount,
      expectedDate: today,
      confidence: "high",
      category: "other",
      vendor: ex.merchant ?? "Expense reimbursement",
      label: `Expense reimbursement — ${ex.merchant ?? ex.category}`,
      detail: ex.description ?? undefined,
    });
  }

  // ── Backlog + pipeline ──
  const backlog: FactBacklogContract[] = [];
  for (const eng of engagements) {
    if (eng.plmStage === "closed") continue;
    const budget = budgetByEng.get(eng.id);
    if (!budget || budget.contractValueUsd <= 0) continue;
    const ctd = ctdByEng.get(eng.id);
    const recognised = ctd?.revenueRecognisedToDateUsd ?? 0;
    const remaining = Math.max(0, budget.contractValueUsd - recognised);
    const acct = accountById.get(eng.accountId);
    const endsOn = eng.plannedEndDate || today;
    const monthsLeft = Math.max(1,
      (new Date(`${endsOn}T00:00:00Z`).getTime() - now.getTime()) / (30.44 * 86_400_000));
    backlog.push({
      id: `bkl_${eng.id}`,
      client: acct?.name ?? eng.name,
      sector: budget.sector || acct?.sector || "Other",
      partnerOwner: userNameById.get(eng.partnerOwnerId) ?? "Partner",
      entityId: FIRM_ENTITY_ID,
      currency: "USD",
      signedTotalLocal: budget.contractValueUsd,
      recognisedToDateLocal: recognised,
      remainingLocal: remaining,
      expectedBurnPerQuarterLocal: Math.round((remaining / monthsLeft) * 3),
      endsOn,
    });
  }
  const pipeline: FactPipelineDeal[] = opportunities
    .filter((o) => o.dealSizeHypothesis > 0)
    .map((o) => {
      const acct = accountById.get(o.accountId);
      return {
        id: `pip_${o.id}`,
        name: o.name,
        client: acct?.name ?? "Prospect",
        sector: acct?.sector ?? "Other",
        partnerOwner: userNameById.get(o.partnerOwnerId) ?? "Partner",
        entityId: FIRM_ENTITY_ID,
        currency: "USD",
        acvLocal: o.dealSizeHypothesis,
        stage: STAGE_MAP[o.salesStage]?.stage ?? "discover",
        stageProbability: Math.min(1, Math.max(0, o.probabilityPct / 100)),
        expectedClose: o.closeDate || o.nextMilestoneDate || today,
      };
    });

  // ── Headcount + bonus people ──
  const headcountAgg = new Map<string, number>();
  const bonusPeople: FactBonusPerson[] = [];
  for (const e of employees) {
    const code = SENIORITY_TO_ROLE[e.seniority] ?? "C";
    headcountAgg.set(code, (headcountAgg.get(code) ?? 0) + 1);
    if (e.baseCompensation && e.baseCompensation > 0) {
      bonusPeople.push({
        id: e.id,
        name: e.fullName,
        roleCode: code,
        entityId: FIRM_ENTITY_ID,
        baseSalaryAnnualUsd: toUsd(e.baseCompensation, e.baseCurrency),
      });
    }
  }
  const headcount: FactHeadcountRow[] = [...headcountAgg.entries()].map(([roleCode, n]) => ({
    entityId: FIRM_ENTITY_ID,
    roleCode: roleCode as FactHeadcountRow["roleCode"],
    startingHeadcount: n,
  }));

  // ── Renewals: live engagements ending in the next 12 months ──
  const in12m = isoDay(new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate())));
  const renewals: FactRenewal[] = engagements
    .filter((e) => e.plmStage !== "closed" && e.plannedEndDate && e.plannedEndDate >= today && e.plannedEndDate <= in12m)
    .map((e) => {
      const budget = budgetByEng.get(e.id);
      const acct = accountById.get(e.accountId);
      return {
        id: `rnw_${e.id}`,
        client: acct?.name ?? e.name,
        entityId: FIRM_ENTITY_ID,
        currency: "USD",
        arrLocal: budget?.contractValueUsd ?? 0,
        expiresOn: e.plannedEndDate,
        ownerName: userNameById.get(e.partnerOwnerId) ?? "Partner",
      };
    });

  // ── Monthly facts (last 24 months) ──
  const monthKeys = lastNMonthKeys(24, now);
  const monthly: Record<string, FactMonth> = {};
  for (const k of monthKeys) monthly[k] = { revenueUsd: 0, directCostUsd: 0, payrollUsd: 0, opexUsd: 0 };

  for (const inv of invoices) {
    if (inv.status !== "issued" && inv.status !== "paid") continue;
    if (inv.voidedAt || !inv.issuedAt) continue;
    const k = monthKey(inv.issuedAt);
    if (monthly[k]) monthly[k].revenueUsd += toUsd(inv.subtotal ?? 0, inv.currency);
  }
  for (const cp of contractorPayments) {
    const wk = isoWeekFriday(cp.weekIso);
    const k = wk ? wk.slice(0, 7) : null;
    if (k && monthly[k]) monthly[k].directCostUsd += cp.usdAmount ?? 0;
  }
  for (const ex of expenses) {
    const k = monthKeyFromIso(ex.expenseDate);
    if (!k || !monthly[k]) continue;
    if (ex.clientBillable) monthly[k].directCostUsd += ex.usdAmount ?? 0;
    else monthly[k].opexUsd += ex.usdAmount ?? 0;
  }
  // Payroll: charge the roster's monthly cost to every month from each
  // employee's start date (bounded by the 24-month window) to now.
  for (const e of employees) {
    if (!e.baseCompensation) continue;
    const monthlyUsd = toUsd(e.baseCompensation, e.baseCurrency) / 12;
    const startKey = monthKeyFromIso(e.startDate) ?? monthKeys[0];
    for (const k of monthKeys) {
      if (k >= startKey && k <= monthKey(now)) monthly[k].payrollUsd += monthlyUsd;
    }
  }

  // ── Overhead: trailing-3-month average non-billable approved spend ──
  const last3 = monthKeys.slice(-3);
  const overheadFixedMonthlyUsd = last3.reduce((s, k) => s + (monthly[k]?.opexUsd ?? 0), 0) / 3;

  // ── Profitability cube ──
  const cubeMap = new Map<string, FactCubeRow>();
  const rowFor = (engId: string): FactCubeRow | null => {
    const eng = engagementById.get(engId);
    if (!eng) return null;
    let row = cubeMap.get(engId);
    if (!row) {
      const acct = accountById.get(eng.accountId);
      row = {
        engagementId: engId,
        engagement: eng.name,
        client: acct?.name ?? eng.name,
        sector: budgetByEng.get(engId)?.sector || acct?.sector || "Other",
        partner: userNameById.get(eng.partnerOwnerId) ?? "Partner",
        entityId: FIRM_ENTITY_ID,
        revenueUsd: 0,
        directCostUsd: 0,
      };
      cubeMap.set(engId, row);
    }
    return row;
  };
  for (const inv of invoices) {
    if ((inv.status !== "issued" && inv.status !== "paid") || inv.voidedAt || !inv.engagementId) continue;
    const row = rowFor(inv.engagementId);
    if (row) row.revenueUsd += toUsd(inv.subtotal ?? 0, inv.currency);
  }
  for (const cp of contractorPayments) {
    const row = rowFor(cp.engagementId);
    if (row) row.directCostUsd += cp.usdAmount ?? 0;
  }
  for (const ex of expenses) {
    if (!ex.clientBillable || !ex.engagementId) continue;
    const row = rowFor(ex.engagementId);
    if (row) row.directCostUsd += ex.usdAmount ?? 0;
  }
  const cube = [...cubeMap.values()].filter((r) => r.revenueUsd !== 0 || r.directCostUsd !== 0);

  // ── Balances (current + per month end) ──
  const balancesAsOf = (endIso: string): FactBalances => {
    let collected = 0, paidOut = 0, openAr = 0, openAp = 0;
    const isCurrent = endIso >= today;
    for (const inv of invoices) {
      if (inv.voidedAt) continue;
      const issued = inv.issuedAt ? isoDay(inv.issuedAt) : null;
      if (!issued || issued > endIso) continue;
      const paidIso = inv.paidAt ? isoDay(inv.paidAt) : null;
      if (paidIso && paidIso <= endIso) {
        collected += toUsd(inv.total ?? 0, inv.currency);
      } else {
        // Partial payments carry no dates; attribute them to the current period.
        const paid = isCurrent ? (inv.amountPaid ?? 0) : 0;
        collected += toUsd(paid, inv.currency);
        openAr += toUsd(Math.max(0, (inv.total ?? 0) - paid), inv.currency);
      }
    }
    for (const cp of contractorPayments) {
      const paidIso = cp.paidAt ? isoDay(cp.paidAt) : null;
      if (paidIso && paidIso <= endIso) paidOut += cp.usdAmount ?? 0;
      else if (isCurrent && (cp.status === "proposed" || cp.status === "partner_approved")) openAp += cp.usdAmount ?? 0;
    }
    for (const ex of expenses) {
      const remIso = ex.reimbursedAt ? isoDay(ex.reimbursedAt) : null;
      if (remIso && remIso <= endIso) paidOut += ex.usdAmount ?? 0;
      else if (isCurrent && ex.status === "approved") openAp += ex.usdAmount ?? 0;
    }
    return {
      cashCollectedUsd: collected,
      cashPaidOutUsd: paidOut,
      openArUsd: openAr,
      openApUsd: openAp,
    };
  };
  const balancesByMonth: Record<string, FactBalances> = {};
  for (const k of monthKeys) balancesByMonth[k] = balancesAsOf(endOfMonthIso(k));
  const balances = balancesAsOf(today);

  // ── Pending (submitted) expense spend per expense-date month ──
  const pendingByMonth: Record<string, number> = {};
  for (const ex of submittedExpenses) {
    const k = monthKeyFromIso(ex.expenseDate);
    if (!k || (ex.usdAmount ?? 0) <= 0) continue;
    pendingByMonth[k] = (pendingByMonth[k] ?? 0) + (ex.usdAmount ?? 0);
  }

  return {
    loadedAt: now.toISOString(),
    receipts,
    disbursements,
    backlog,
    pipeline,
    headcount,
    bonusPeople,
    renewals,
    overheadFixedMonthlyUsd,
    monthly,
    cube,
    balances,
    balancesByMonth,
    pendingByMonth,
  };
}
