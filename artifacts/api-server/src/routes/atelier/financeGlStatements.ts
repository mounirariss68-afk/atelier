/**
 * Atelier — GL-derived financial statements (Task #433).
 *
 * Replaces the retired seed-profile statement generators: per-entity
 * P&L / Balance Sheet / Cash Flow are built from the append-only GL
 * journal (atelier_gl_journal_entry/_line) grouped through the chart
 * of accounts. Entities with no journals get honest zeros.
 *
 * Design:
 *   - One grouped SQL aggregation per request (entity × period ×
 *     account), then pure in-memory classification + statement math
 *     (`buildGlStatements`) so the accounting identities are unit
 *     testable without a database.
 *   - P&L lines are period flows; BS lines are cumulative balances
 *     through period end; CF is indirect (net income + non-cash +
 *     working-capital deltas) and ties to the cash-account movement
 *     by construction because every BS bucket is classified.
 *   - Intercompany comes from tagged accounts: any account whose name
 *     contains "intercompany" / "inter-company" (or an "IC " prefix)
 *     is treated as an IC line and eliminates on consolidation. The
 *     default chart carries no IC accounts, so eliminations are
 *     honest zeros until finance books IC journals.
 *   - Closed-period stability: the journal is append-only and locked
 *     periods reject postings (isGlPeriodLocked), so a closed period's
 *     statements cannot drift. Open periods in scope are flagged
 *     `preliminary` by the routes via `lockedPeriods`.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierPeriodCloseLock,
} from "@workspace/db";

// ──────────────────────────────────────────────────────────────
// Shapes (structurally identical to the wire shapes in
// financeReportsRoutes so results can be consumed directly).
// ──────────────────────────────────────────────────────────────
export interface GlPnlFlows {
  grossRevenue: number;
  intercoRevenue: number;
  directCost: number;
  intercoCost: number;
  payroll: number;
  opex: number;
  depreciation: number;
  interestExpense: number;
  tax: number;
}
export interface GlBsStocks {
  cash: number;
  ar: number;
  intercoAr: number;
  wip: number;
  ppe: number;
  intangible: number;
  intercoLoanReceivable: number;
  ap: number;
  intercoAp: number;
  accruals: number;
  debt: number;
  intercoLoanPayable: number;
  shareCapital: number;
  /** Equity postings other than share capital (excludes cumulative NI). */
  otherEquity: number;
  /** Cumulative net income (revenue − expense) through period end. */
  cumNetIncome: number;
}
export interface GlEntityStatements {
  /** Period flows keyed by periodLabel (YYYY-MM) — only labels with journals. */
  flows: Record<string, GlPnlFlows>;
  /** Cumulative balances through each REQUESTED period end. */
  stocks: Record<string, GlBsStocks>;
  hasJournals: boolean;
}
export interface GlStatements {
  byEntity: Record<string, GlEntityStatements>;
  /** Period labels whose close lock covers the GL module. */
  lockedPeriods: Set<string>;
}

export interface GlAggRow {
  entityId: string;
  periodLabel: string;
  accountCode: string;
  accountName: string;
  accountType: string; // asset | liability | equity | revenue | expense
  debit: number;
  credit: number;
}

// ──────────────────────────────────────────────────────────────
// Account classification (pure).
// ──────────────────────────────────────────────────────────────
function isIcAccount(name: string): boolean {
  return /inter[\s-]?company|^ic[\s:-]/i.test(name.trim());
}

type FlowBucket = keyof GlPnlFlows | null;
type StockBucket = keyof GlBsStocks | null;

export function classifyFlow(accountType: string, code: string, name: string): FlowBucket {
  if (accountType === "revenue") return isIcAccount(name) ? "intercoRevenue" : "grossRevenue";
  if (accountType !== "expense") return null;
  if (isIcAccount(name)) return "intercoCost";
  if (/deprec|amortis|amortiz/i.test(name)) return "depreciation";
  if (/interest/i.test(name)) return "interestExpense";
  if (/(corporate|income)\s+tax/i.test(name)) return "tax";
  if (code.startsWith("5")) return "directCost";
  if (/salar|payroll|wages|benefits/i.test(name)) return "payroll";
  return "opex";
}

export function classifyStock(accountType: string, code: string, name: string): StockBucket {
  if (accountType === "asset") {
    if (isIcAccount(name)) return /loan/i.test(name) ? "intercoLoanReceivable" : "intercoAr";
    if (code.startsWith("10") || /cash|bank/i.test(name)) return "cash";
    if (code.startsWith("12") || /wip|unbilled/i.test(name)) return "wip";
    if (/property|plant|equipment|fixture|vehicle/i.test(name)) return "ppe";
    if (/intangible|goodwill|software licence/i.test(name)) return "intangible";
    // AR, prepaids, VAT receivable, deposits → receivables & other current assets
    return "ar";
  }
  if (accountType === "liability") {
    if (isIcAccount(name)) return /loan/i.test(name) ? "intercoLoanPayable" : "intercoAp";
    if (code.startsWith("20") || /accounts payable|trade payable/i.test(name)) return "ap";
    if (/debt|borrow|loan|facility/i.test(name)) return "debt";
    // Accruals, deferred revenue, VAT/tax payable → accruals & other liabilities
    return "accruals";
  }
  if (accountType === "equity") {
    if (code.startsWith("30") || /share|owners|capital|stock/i.test(name)) return "shareCapital";
    return "otherEquity";
  }
  return null; // revenue/expense feed cumNetIncome
}

function zeroFlows(): GlPnlFlows {
  return { grossRevenue: 0, intercoRevenue: 0, directCost: 0, intercoCost: 0, payroll: 0, opex: 0, depreciation: 0, interestExpense: 0, tax: 0 };
}
export function zeroStocks(): GlBsStocks {
  return { cash: 0, ar: 0, intercoAr: 0, wip: 0, ppe: 0, intangible: 0, intercoLoanReceivable: 0, ap: 0, intercoAp: 0, accruals: 0, debt: 0, intercoLoanPayable: 0, shareCapital: 0, otherEquity: 0, cumNetIncome: 0 };
}

// ──────────────────────────────────────────────────────────────
// Pure builder: aggregate rows → per-entity flows + cumulative stocks.
// `requestedPeriods` are the report periods (sorted ascending) whose
// closing balances we snapshot; journals in earlier months roll into
// the first snapshot's opening position.
// ──────────────────────────────────────────────────────────────
export function buildGlStatements(rows: GlAggRow[], requestedPeriods: string[]): Record<string, GlEntityStatements> {
  const byEntity = new Map<string, GlAggRow[]>();
  for (const r of rows) {
    const list = byEntity.get(r.entityId) ?? [];
    list.push(r);
    byEntity.set(r.entityId, list);
  }
  const sortedRequested = [...requestedPeriods].sort();
  const out: Record<string, GlEntityStatements> = {};
  for (const [entityId, entRows] of byEntity) {
    const flows: Record<string, GlPnlFlows> = {};
    // Group rows by periodLabel first, then walk labels in order.
    const byPeriod = new Map<string, GlAggRow[]>();
    for (const r of entRows) {
      const list = byPeriod.get(r.periodLabel) ?? [];
      list.push(r);
      byPeriod.set(r.periodLabel, list);
    }
    const journalLabels = [...byPeriod.keys()].sort();
    const running = zeroStocks();
    const stocks: Record<string, GlBsStocks> = {};
    let li = 0;
    for (const reqPeriod of sortedRequested) {
      while (li < journalLabels.length && journalLabels[li] <= reqPeriod) {
        const label = journalLabels[li];
        const periodFlows = flows[label] ?? zeroFlows();
        for (const r of byPeriod.get(label)!) {
          // Flows
          const fb = classifyFlow(r.accountType, r.accountCode, r.accountName);
          if (fb) {
            const amt = r.accountType === "revenue" ? r.credit - r.debit : r.debit - r.credit;
            periodFlows[fb] += amt;
          }
          // Stocks
          const sb = classifyStock(r.accountType, r.accountCode, r.accountName);
          if (sb) {
            const amt = r.accountType === "asset" ? r.debit - r.credit : r.credit - r.debit;
            running[sb] += amt;
          } else if (r.accountType === "revenue") {
            running.cumNetIncome += r.credit - r.debit;
          } else if (r.accountType === "expense") {
            running.cumNetIncome -= r.debit - r.credit;
          }
        }
        flows[label] = periodFlows;
        li++;
      }
      stocks[reqPeriod] = { ...running };
    }
    out[entityId] = { flows, stocks, hasJournals: journalLabels.length > 0 };
  }
  return out;
}

// ──────────────────────────────────────────────────────────────
// Statement math (pure). PnL/BS/CF line shapes mirror the routes'.
// ──────────────────────────────────────────────────────────────
export interface GlPnlLines {
  grossRevenue: number; intercoRevenue: number; netRevenue: number;
  directCost: number; intercoCost: number; grossProfit: number;
  payroll: number; opex: number; depreciation: number;
  ebitda: number; ebit: number; interestExpense: number;
  pretaxIncome: number; tax: number; netIncome: number;
}
export interface GlBsLines {
  cash: number; ar: number; intercoAr: number; wip: number;
  ppe: number; intangible: number; intercoLoanReceivable: number;
  totalAssets: number;
  ap: number; intercoAp: number; accruals: number; debt: number;
  intercoLoanPayable: number; totalLiabilities: number;
  shareCapital: number; retainedEarnings: number; fctr: number;
  totalEquity: number; totalLiabilitiesAndEquity: number;
}
export interface GlCfLines {
  netIncome: number; depreciation: number; workingCapitalChange: number;
  cashFromOps: number; capex: number; cashFromInvesting: number;
  debtRepayment: number; intercoFunding: number; cashFromFinancing: number;
  fxOnCash: number; netChangeInCash: number; openingCash: number; closingCash: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildPnlFromFlows(f: GlPnlFlows): GlPnlLines {
  const netRevenue = f.grossRevenue + f.intercoRevenue;
  const grossProfit = netRevenue - f.directCost - f.intercoCost;
  const ebitda = grossProfit - f.payroll - f.opex;
  const ebit = ebitda - f.depreciation;
  const pretaxIncome = ebit - f.interestExpense;
  const netIncome = pretaxIncome - f.tax;
  return {
    grossRevenue: r2(f.grossRevenue), intercoRevenue: r2(f.intercoRevenue), netRevenue: r2(netRevenue),
    directCost: r2(f.directCost), intercoCost: r2(f.intercoCost), grossProfit: r2(grossProfit),
    payroll: r2(f.payroll), opex: r2(f.opex), depreciation: r2(f.depreciation),
    ebitda: r2(ebitda), ebit: r2(ebit), interestExpense: r2(f.interestExpense),
    pretaxIncome: r2(pretaxIncome), tax: r2(f.tax), netIncome: r2(netIncome),
  };
}

/** BS balances by construction: assets − liabilities = shareCapital + (otherEquity + cumNI). */
export function buildBsFromStocks(s: GlBsStocks): GlBsLines {
  const totalAssets = s.cash + s.ar + s.intercoAr + s.wip + s.ppe + s.intangible + s.intercoLoanReceivable;
  const totalLiabilities = s.ap + s.intercoAp + s.accruals + s.debt + s.intercoLoanPayable;
  const retainedEarnings = s.otherEquity + s.cumNetIncome;
  const totalEquity = s.shareCapital + retainedEarnings;
  return {
    cash: r2(s.cash), ar: r2(s.ar), intercoAr: r2(s.intercoAr), wip: r2(s.wip),
    ppe: r2(s.ppe), intangible: r2(s.intangible), intercoLoanReceivable: r2(s.intercoLoanReceivable),
    totalAssets: r2(totalAssets),
    ap: r2(s.ap), intercoAp: r2(s.intercoAp), accruals: r2(s.accruals), debt: r2(s.debt),
    intercoLoanPayable: r2(s.intercoLoanPayable), totalLiabilities: r2(totalLiabilities),
    shareCapital: r2(s.shareCapital), retainedEarnings: r2(retainedEarnings), fctr: 0,
    totalEquity: r2(totalEquity), totalLiabilitiesAndEquity: r2(totalLiabilities + totalEquity),
  };
}

/**
 * Indirect cash flow between two cumulative-balance snapshots. Ties to
 * the cash-account movement exactly because every BS bucket appears in
 * one of ops / investing / financing.
 */
export function buildCfFromStocks(prev: GlBsStocks, cur: GlBsStocks, pnl: GlPnlLines): GlCfLines {
  const dCash = cur.cash - prev.cash;
  const wc =
    -(cur.ar - prev.ar) - (cur.wip - prev.wip) - (cur.intercoAr - prev.intercoAr)
    + (cur.ap - prev.ap) + (cur.accruals - prev.accruals) + (cur.intercoAp - prev.intercoAp);
  const ops = pnl.netIncome + pnl.depreciation + wc;
  // Δppe = capex − depreciation ⇒ gross additions:
  const capex = (cur.ppe - prev.ppe) + (cur.intangible - prev.intangible) + pnl.depreciation;
  const investing = -capex - (cur.intercoLoanReceivable - prev.intercoLoanReceivable);
  const intercoFunding = (cur.intercoLoanPayable - prev.intercoLoanPayable);
  const debtMove = cur.debt - prev.debt;
  const equityMove = (cur.shareCapital - prev.shareCapital) + (cur.otherEquity - prev.otherEquity);
  const financing = debtMove + intercoFunding + equityMove;
  // cumNetIncome delta equals pnl.netIncome for the same span by
  // construction, so ops+investing+financing ≡ dCash. Keep any rounding
  // residual in fxOnCash so the statement always ties to the ledger.
  const fxOnCash = r2(dCash - (ops + investing + financing));
  return {
    netIncome: r2(pnl.netIncome), depreciation: r2(pnl.depreciation),
    workingCapitalChange: r2(wc), cashFromOps: r2(ops),
    capex: r2(-capex), cashFromInvesting: r2(investing),
    debtRepayment: r2(debtMove), intercoFunding: r2(intercoFunding),
    cashFromFinancing: r2(financing), fxOnCash,
    netChangeInCash: r2(dCash), openingCash: r2(prev.cash), closingCash: r2(cur.cash),
  };
}

// ──────────────────────────────────────────────────────────────
// Working-capital metrics (pure).
// ──────────────────────────────────────────────────────────────
export interface WorkingCapitalMetrics {
  ar: number; wip: number; ap: number;
  revenue: number; spend: number; days: number;
  dso: number | null; wipDays: number | null; dpo: number | null; lockupDays: number | null;
}
export function computeWorkingCapital(args: {
  ar: number; wip: number; ap: number;
  revenue: number; spend: number; days: number;
}): WorkingCapitalMetrics {
  const { ar, wip, ap, revenue, spend, days } = args;
  const revPerDay = days > 0 ? revenue / days : 0;
  const spendPerDay = days > 0 ? spend / days : 0;
  const dso = revPerDay > 0 ? r2(ar / revPerDay) : null;
  const wipDays = revPerDay > 0 ? r2(wip / revPerDay) : null;
  const dpo = spendPerDay > 0 ? r2(ap / spendPerDay) : null;
  const lockupDays = dso != null && wipDays != null ? r2(dso + wipDays) : null;
  return { ar: r2(ar), wip: r2(wip), ap: r2(ap), revenue: r2(revenue), spend: r2(spend), days, dso, wipDays, dpo, lockupDays };
}

// ──────────────────────────────────────────────────────────────
// DB loader — one grouped aggregation + close-lock lookup.
// ──────────────────────────────────────────────────────────────
export async function loadGlStatements(orgId: string, entityIds: string[], requestedPeriods: string[]): Promise<GlStatements> {
  const lockedPeriods = new Set<string>();
  if (entityIds.length === 0) return { byEntity: {}, lockedPeriods };

  const [rows, locks] = await Promise.all([
    db
      .select({
        entityId: atelierGlJournalEntry.legalEntityId,
        periodLabel: atelierGlJournalEntry.periodLabel,
        accountCode: atelierGlJournalLine.accountCode,
        accountName: atelierGlJournalLine.accountName,
        accountType: sql<string>`coalesce(${atelierGlAccount.type}, 'asset')`,
        debit: sql<number>`coalesce(sum(${atelierGlJournalLine.debit}), 0)`,
        credit: sql<number>`coalesce(sum(${atelierGlJournalLine.credit}), 0)`,
      })
      .from(atelierGlJournalLine)
      .innerJoin(atelierGlJournalEntry, eq(atelierGlJournalLine.journalEntryId, atelierGlJournalEntry.id))
      .leftJoin(atelierGlAccount, eq(atelierGlJournalLine.accountId, atelierGlAccount.id))
      .where(and(
        eq(atelierGlJournalEntry.orgId, orgId),
        inArray(atelierGlJournalEntry.legalEntityId, entityIds),
        isNull(atelierGlJournalEntry.deletedAt),
        isNull(atelierGlJournalLine.deletedAt),
      ))
      .groupBy(
        atelierGlJournalEntry.legalEntityId,
        atelierGlJournalEntry.periodLabel,
        atelierGlJournalLine.accountCode,
        atelierGlJournalLine.accountName,
        atelierGlAccount.type,
      ),
    db
      .select({ periodLabel: atelierPeriodCloseLock.periodLabel, lockedModules: atelierPeriodCloseLock.lockedModules })
      .from(atelierPeriodCloseLock)
      .where(and(eq(atelierPeriodCloseLock.orgId, orgId), isNull(atelierPeriodCloseLock.deletedAt))),
  ]);

  for (const l of locks) {
    if ((l.lockedModules ?? []).includes("gl")) lockedPeriods.add(l.periodLabel);
  }

  const aggRows: GlAggRow[] = rows.map((r) => ({
    entityId: r.entityId,
    periodLabel: r.periodLabel,
    accountCode: r.accountCode,
    accountName: r.accountName,
    accountType: r.accountType,
    debit: Number(r.debit) || 0,
    credit: Number(r.credit) || 0,
  }));
  return { byEntity: buildGlStatements(aggRows, requestedPeriods), lockedPeriods };
}
