import { Router, type Request, type Response } from "express";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAccounts,
  atelierBankAccount,
  atelierBankTransaction,
  atelierEngagements,
  atelierExpenses,
  atelierInvoice,
  atelierPartnerFirmInvoices,
} from "@workspace/db";
import { convertToUsd, convertUsdTo, DISPLAY_CURRENCIES } from "../../lib/atelier-fx.js";
import { isRestrictedPersona } from "./personaRoles.js";
import {
  FINANCE_MVP_CONTRACT,
  type FinanceMvpCurrencyBucket,
  type FinanceMvpMetric,
  type FinanceMvpPeriodDimension,
  type FinanceMvpSummary,
} from "./financeMvpContract.js";

const router = Router();
type Me = typeof atelierUsers.$inferSelect;

function gate(req: Request, res: Response): Me | null {
  const me = req.atelierPersona;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return null; }
  if (isRestrictedPersona(me.role)) { res.status(403).json({ error: "forbidden" }); return null; }
  return me;
}
function round(n: number): number { return Math.round(n * 100) / 100; }
function add(map: Map<string, number>, currency: string | null | undefined, amount: number): void {
  const c = (currency || "USD").toUpperCase();
  map.set(c, round((map.get(c) ?? 0) + amount));
}
function metric(map: Map<string, number>): FinanceMvpMetric {
  return { buckets: [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount })) };
}
function dateBounds(dimension: FinanceMvpPeriodDimension, value: string | undefined): { from: string; to: string } | null {
  const now = new Date();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const v = value || fallback;
  if (dimension === "month" && /^\d{4}-\d{2}$/.test(v)) {
    const [y, m] = v.split("-").map(Number);
    if (m >= 1 && m <= 12) return { from: `${v}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  }
  if (dimension === "quarter" && /^(\d{4})-Q([1-4])$/.test(v)) {
    const match = /^(\d{4})-Q([1-4])$/.exec(v)!;
    const y = Number(match[1]); const q = Number(match[2]); const m = (q - 1) * 3 + 1;
    return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: new Date(Date.UTC(y, m + 2, 0)).toISOString().slice(0, 10) };
  }
  if (dimension === "year" && /^\d{4}$/.test(v)) return { from: `${v}-01-01`, to: `${v}-12-31` };
  return null;
}
async function withDisplay(metricValue: FinanceMvpMetric, requested: string | undefined, asOf: string): Promise<FinanceMvpMetric> {
  if (!requested || !DISPLAY_CURRENCIES.includes(requested)) return metricValue;
  let totalUsd = 0;
  for (const b of metricValue.buckets) totalUsd += (await convertToUsd(b.amount, b.currency, asOf)).usdAmount;
  const converted = await convertUsdTo(totalUsd, requested, asOf);
  return { ...metricValue, display: { currency: requested, amount: round(converted.amount), source: converted.source } };
}

// @cli-skip: static UI contract metadata
router.get("/finance/mvp/contract", (_req, res) => res.json(FINANCE_MVP_CONTRACT));

// @cli-skip: finance analytical read; existing finance chat tools remain authoritative
router.get("/finance/mvp/summary", async (req, res): Promise<void> => {
  const me = gate(req, res); if (!me) return;
  const dimension = String(req.query.dimension || "month") as FinanceMvpPeriodDimension;
  if (!["month", "quarter", "year"].includes(dimension)) { res.status(400).json({ error: "invalid-period-dimension" }); return; }
  const bounds = dateBounds(dimension, typeof req.query.period === "string" ? req.query.period : undefined);
  if (!bounds) { res.status(400).json({ error: "invalid-period" }); return; }
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : null;
  const displayCurrency = typeof req.query.displayCurrency === "string" ? req.query.displayCurrency.toUpperCase() : undefined;
  if (displayCurrency && !DISPLAY_CURRENCIES.includes(displayCurrency)) { res.status(400).json({ error: "unsupported-display-currency" }); return; }
  const base = and(eq(atelierInvoice.orgId, me.orgId), isNull(atelierInvoice.deletedAt), gte(atelierInvoice.issuedAt, new Date(`${bounds.from}T00:00:00Z`)), lte(atelierInvoice.issuedAt, new Date(`${bounds.to}T23:59:59Z`)));
  const [invoices, expenses, supplierBills, transactions, cashTransactions, bankAccounts, engagements, accounts] = await Promise.all([
    db.select().from(atelierInvoice).where(entityId ? and(base, eq(atelierInvoice.legalEntityId, entityId)) : base),
    db.select().from(atelierExpenses).where(and(eq(atelierExpenses.orgId, me.orgId), isNull(atelierExpenses.deletedAt), gte(atelierExpenses.expenseDate, bounds.from), lte(atelierExpenses.expenseDate, bounds.to), ...(entityId ? [eq(atelierExpenses.entityId, entityId)] : []))),
    db.select().from(atelierPartnerFirmInvoices).where(and(eq(atelierPartnerFirmInvoices.orgId, me.orgId), isNull(atelierPartnerFirmInvoices.deletedAt), gte(atelierPartnerFirmInvoices.invoiceDate, bounds.from), lte(atelierPartnerFirmInvoices.invoiceDate, bounds.to), ...(entityId ? [eq(atelierPartnerFirmInvoices.legalEntityId, entityId)] : []))),
    db.select().from(atelierBankTransaction).where(and(eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt), gte(atelierBankTransaction.postedDate, bounds.from), lte(atelierBankTransaction.postedDate, bounds.to), ...(entityId ? [eq(atelierBankTransaction.legalEntityId, entityId)] : []))),
    db.select().from(atelierBankTransaction).where(and(eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.deletedAt), lte(atelierBankTransaction.postedDate, bounds.to), ...(entityId ? [eq(atelierBankTransaction.legalEntityId, entityId)] : []))),
    db.select().from(atelierBankAccount).where(and(eq(atelierBankAccount.orgId, me.orgId), isNull(atelierBankAccount.deletedAt), ...(entityId ? [eq(atelierBankAccount.legalEntityId, entityId)] : []))),
    db.select().from(atelierEngagements).where(and(eq(atelierEngagements.orgId, me.orgId), isNull(atelierEngagements.deletedAt))),
    db.select().from(atelierAccounts).where(eq(atelierAccounts.orgId, me.orgId)),
  ]);
  const revenue = new Map<string, number>(), direct = new Map<string, number>(), opex = new Map<string, number>(), cash = new Map<string, number>(), liabilities = new Map<string, number>();
  const project = new Map<string, { projectId: string | null; projectName: string; clientId: string | null; clientName: string; revenue: Map<string, number>; direct: Map<string, number> }>();
  const engById = new Map(engagements.map((e) => [e.id, e])), acctById = new Map(accounts.map((a) => [a.id, a]));
  for (const inv of invoices) {
    if (inv.status === "voided" || !["issued", "paid"].includes(inv.status)) continue;
    add(revenue, inv.currency, inv.subtotal);
    if (inv.engagementId) {
      const e = engById.get(inv.engagementId); const a = e ? acctById.get(e.accountId) : undefined;
      const p = project.get(inv.engagementId) ?? { projectId: inv.engagementId, projectName: e?.name ?? inv.engagementId, clientId: e?.accountId ?? null, clientName: a?.name ?? "Unknown client", revenue: new Map(), direct: new Map() };
      add(p.revenue, inv.currency, inv.subtotal); project.set(inv.engagementId, p);
    }
  }
  for (const e of expenses) {
    if (!["approved", "reimbursed"].includes(e.status)) continue;
    const amount = e.amount;
    if (e.clientBillable) { add(direct, e.currency, amount); } else add(opex, e.currency, amount);
    if (e.engagementId && e.clientBillable) {
      const eng = engById.get(e.engagementId); const account = eng ? acctById.get(eng.accountId) : undefined;
      const p = project.get(e.engagementId) ?? { projectId: e.engagementId, projectName: eng?.name ?? e.engagementId, clientId: eng?.accountId ?? null, clientName: account?.name ?? "Unknown client", revenue: new Map(), direct: new Map() };
      add(p.direct, e.currency, amount); project.set(e.engagementId, p);
    }
    if (e.status === "approved") add(liabilities, e.currency, amount);
  }
  for (const b of supplierBills) if (["proposed", "partner_approved", "submitted", "under_review", "approved", "scheduled"].includes(b.status)) {
    add(liabilities, b.costCurrency, b.costAmount);
    add(direct, b.costCurrency, b.costAmount);
    if (b.engagementId) {
      const e = engById.get(b.engagementId); const a = e ? acctById.get(e.accountId) : undefined;
      const p = project.get(b.engagementId) ?? { projectId: b.engagementId, projectName: e?.name ?? b.engagementId, clientId: e?.accountId ?? null, clientName: a?.name ?? "Unknown client", revenue: new Map(), direct: new Map() };
      add(p.direct, b.costCurrency, b.costAmount); project.set(b.engagementId, p);
    }
  }
  for (const account of bankAccounts) add(cash, account.currency, account.openingBalance);
  for (const t of cashTransactions) add(cash, t.currency, t.amount);
  const net = new Map<string, number>();
  for (const c of new Set([...revenue.keys(), ...direct.keys(), ...opex.keys()]))
    net.set(c, round((revenue.get(c) ?? 0) - (direct.get(c) ?? 0) - (opex.get(c) ?? 0)));
  const asOf = bounds.to;
  const summary: FinanceMvpSummary = {
    contractVersion: "finance-mvp.v1", period: { dimension, ...bounds }, scope: { kind: entityId ? "entity" : "overall", entityId }, actualOnly: true,
    revenue: await withDisplay(metric(revenue), displayCurrency, asOf), directCosts: await withDisplay(metric(direct), displayCurrency, asOf), operatingExpenses: await withDisplay(metric(opex), displayCurrency, asOf), netResult: await withDisplay(metric(net), displayCurrency, asOf), cash: await withDisplay(metric(cash), displayCurrency, asOf), openLiabilities: await withDisplay(metric(liabilities), displayCurrency, asOf),
    projectClientGrossMargin: await Promise.all([...project.values()].map(async (p) => {
      const currencies = new Set([...p.revenue.keys(), ...p.direct.keys()]);
      const gm = new Map<string, number>();
      for (const c of currencies) gm.set(c, round((p.revenue.get(c) ?? 0) - (p.direct.get(c) ?? 0)));
      const revenueMetric = await withDisplay(metric(p.revenue), displayCurrency, asOf);
      const directMetric = await withDisplay(metric(p.direct), displayCurrency, asOf);
      const marginMetric = await withDisplay(metric(gm), displayCurrency, asOf);
      const comparableRevenue = revenueMetric.display?.amount ?? (currencies.size <= 1 ? revenueMetric.buckets[0]?.amount ?? 0 : null);
      const comparableMargin = marginMetric.display?.amount ?? (currencies.size <= 1 ? marginMetric.buckets[0]?.amount ?? 0 : null);
      return {
        projectId: p.projectId, projectName: p.projectName, clientId: p.clientId, clientName: p.clientName,
        revenue: revenueMetric, directCosts: directMetric, grossMargin: marginMetric,
        grossMarginPct: comparableRevenue && comparableMargin != null ? round((comparableMargin / comparableRevenue) * 100) : comparableRevenue === 0 ? 0 : null,
      };
    })),
    reconciliation: { bankTransactions: transactions.length, matchedTransactions: transactions.filter((t) => t.matchedState === "matched" || t.matchedState === "journaled").length, unmatchedTransactions: transactions.filter((t) => !["matched", "journaled"].includes(t.matchedState)).length, completenessPct: transactions.length ? round(transactions.filter((t) => ["matched", "journaled"].includes(t.matchedState)).length / transactions.length * 100) : 100 },
  };
  res.json(summary);
});
export default router;