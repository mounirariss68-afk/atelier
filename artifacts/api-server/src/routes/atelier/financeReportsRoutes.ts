/**
 * Atelier — Finance Reports (three-statement, profitability cube, board
 * pack) routes (Task #417, Wave 5).
 *
 * Surfaces:
 *   GET  /finance/reports/pnl            — P&L per entity / consolidated
 *   GET  /finance/reports/bs             — Balance Sheet per entity / consolidated
 *   GET  /finance/reports/cf             — Cash Flow (indirect) per entity / consolidated
 *   GET  /finance/reports/profitability  — profitability cube
 *   GET  /finance/reports/board-pack     — assembled monthly board pack
 *   GET  /finance/reports/board-pack.pdf — PDF export
 *   GET  /finance/reports/schedules      — monthly schedule list
 *   POST /finance/reports/schedules      — toggle/upsert monthly schedule
 *
 * Design notes
 *   - The task is explicit: seed data only, no real GL integration. Numbers
 *     are generated deterministically from per-entity base profiles +
 *     month-of-year seasonality + a fixed pseudo-random kicker so demos are
 *     reproducible and statements tie out.
 *   - FX translation follows IAS 21: P&L at average rate, BS at closing
 *     rate, equity at historical rate. The plug to balance the BS is
 *     posted to a Foreign Currency Translation Reserve (FCTR) within
 *     equity.
 *   - Eliminations: IC revenue ↔ IC cost net to zero on consolidation;
 *     IC AR ↔ IC AP net to zero; IC loans net to zero. Mismatches (which
 *     don't occur in seed) would surface as a "to-investigate" line.
 *   - Presentation currency: GBP for consolidated. Per-entity statements
 *     also support being shown in any currency.
 *
 * Persona gating mirrors financeEntitiesRoutes: recruiter is denied,
 * everyone else can read.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { atelierUsers } from "@workspace/db";
import { ENTITIES_SEED } from "./financeEntitiesRoutes";
import { loadFinanceFacts, FIRM_ENTITY_ID, type FinanceFacts } from "./financeRealFacts";
import { loadBoardPackLogo } from "../../lib/atelier-board-pack-logo.js";

const router: IRouter = Router();

/** Navy-wordmark Cognirise logo for the white/printed board pack. Loaded once
 *  from the sibling atelier artifact's public assets (see the loader module).
 *  Falls back to null (text-only header) if the asset can't be read. */
const BOARD_PACK_LOGO: Buffer | null = loadBoardPackLogo();
type Me = typeof atelierUsers.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return null; }
  return me;
}
function denyRecruiter(me: Me, res: Response): boolean {
  if (me.role === "recruiter") { res.status(403).json({ error: "recruiter-scope" }); return true; }
  return false;
}

// ──────────────────────────────────────────────────────────────
// Period model — last 12 monthly periods ending 2026-05.
// ──────────────────────────────────────────────────────────────
// Anchor = the real current month, so reports always cover the trailing
// 12 months ending today (Task #177 — no hard-coded demo clock).
const NOW = new Date();
const ANCHOR_YEAR = NOW.getUTCFullYear();
const ANCHOR_MONTH = NOW.getUTCMonth() + 1;

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function periodIso(y: number, m: number): string { return `${y}-${pad2(m)}`; }
function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const tot = y * 12 + (m - 1) + delta;
  return { y: Math.floor(tot / 12), m: (tot % 12) + 1 };
}
function endOfMonth(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
function monthLabel(y: number, m: number): string {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

interface Period { id: string; year: number; month: number; label: string; endsOn: string }
const PERIODS: Period[] = (() => {
  const out: Period[] = [];
  for (let i = 11; i >= 0; i--) {
    const { y, m } = addMonths(ANCHOR_YEAR, ANCHOR_MONTH, -i);
    out.push({ id: periodIso(y, m), year: y, month: m, label: monthLabel(y, m), endsOn: endOfMonth(y, m) });
  }
  return out;
})();
const CURRENT_PERIOD = PERIODS[PERIODS.length - 1];
const PRIOR_YEAR_OFFSET = 12;

function periodById(id: string): Period | null {
  return PERIODS.find((p) => p.id === id) ?? null;
}

// ──────────────────────────────────────────────────────────────
// FX. Per-month closing + average rates derived from a baseline.
// Historical rate = first period in the 12-month window.
// ──────────────────────────────────────────────────────────────
const FX_BASE_TO_GBP: Record<string, number> = {
  GBP: 1.0,
  USD: 1 / 1.27,
  AED: 0.272 / 1.27,
  SAR: 0.267 / 1.27,
  EUR: 1.08 / 1.27,
};

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function noise(seed: string, range = 0.04): number {
  const h = hash(seed);
  return ((h % 10000) / 10000 - 0.5) * 2 * range;
}

// Static reference rates — no fabricated per-month noise (Task #177).
function closingRateToGbp(currency: string, _period: Period): number {
  return FX_BASE_TO_GBP[currency] ?? 1;
}
function averageRateToGbp(currency: string, _period: Period): number {
  return FX_BASE_TO_GBP[currency] ?? 1;
}
function historicalRateToGbp(currency: string): number {
  return FX_BASE_TO_GBP[currency] ?? 1;
}

function convert(amount: number, fromGbp: number, toCurrency: string, period: Period, kind: "closing" | "average" | "historical" = "closing"): number {
  if (toCurrency === "GBP") return amount * fromGbp;
  const t = kind === "closing" ? closingRateToGbp(toCurrency, period)
    : kind === "average" ? averageRateToGbp(toCurrency, period)
    : historicalRateToGbp(toCurrency);
  return (amount * fromGbp) / t;
}

// ──────────────────────────────────────────────────────────────
// Per-entity revenue / cost profile. All in entity baseCurrency.
// We seed a per-entity monthly P&L deterministically.
// ──────────────────────────────────────────────────────────────
interface EntityProfile {
  // Monthly base revenue, in baseCurrency.
  baseMonthlyRevenue: number;
  // Direct cost as a fraction of revenue.
  directCostRatio: number;
  // Opex absolute (rent + tooling + admin) per month.
  opexBase: number;
  // Headcount cost per month.
  payrollBase: number;
  // Depreciation per month.
  depreciation: number;
  // Interest expense per month.
  interestExpense: number;
  // Effective tax rate.
  taxRate: number;
  // BS opening (12 months ago) — local currency.
  openingBalances: {
    cash: number;
    ar: number;
    wip: number;
    ppe: number;
    intangible: number;
    ap: number;
    accruals: number;
    debt: number;
    shareCapital: number;
    retainedEarningsOpening: number;
  };
}

// Fabricated demo entity P&L/BS profiles removed per the no-demo-data policy;
// the report generators return honest zeros for every entity until real GL
// data exists.
const PROFILES: Record<string, EntityProfile> = {};

// ──────────────────────────────────────────────────────────────
// Real-data facts (Task #177). Every route awaits ensureFacts()
// before computing, then the sync generators below read FACTS.
// The firm pseudo-entity carries all firm-wide monthly facts.
// ──────────────────────────────────────────────────────────────
// NOTE: FACTS is set per-request for the caller's org, and all downstream
// computation between ensureFacts() and res.json() is synchronous, so
// concurrent requests from different orgs cannot interleave reads.
let FACTS: FinanceFacts | null = null;
async function ensureFacts(orgId: string): Promise<void> {
  FACTS = await loadFinanceFacts(orgId);
}
const FIRM_PSEUDO_ENTITY = { id: FIRM_ENTITY_ID, baseCurrency: "USD", shortName: "Cognirise (firm)" };

function seasonality(month: number, eid: string): number {
  // Per-entity month-of-year seasonality, ±15%.
  const wave = Math.sin(((month - 1) / 12) * 2 * Math.PI + (hash(eid) % 360) * (Math.PI / 180));
  return 1 + 0.10 * wave + noise(`s_${eid}_${month}`, 0.05);
}

// IC service fees, in lender baseCurrency, monthly. counterpartyId pays providerId.
interface ICFee { providerId: string; counterpartyId: string; monthlyAmountLocal: number; currency: string }
// Fabricated demo inter-company fees removed per the no-demo-data policy.
const IC_FEES: ICFee[] = [];

// IC loans (net loans receivable from counterparty, in providerId base ccy).
interface ICLoan { providerId: string; counterpartyId: string; balanceLocal: number; currency: string }
// Fabricated demo inter-company loans removed per the no-demo-data policy.
const IC_LOANS: ICLoan[] = [];

// ──────────────────────────────────────────────────────────────
// P&L generator (local currency).
// ──────────────────────────────────────────────────────────────
interface PnlLines {
  grossRevenue: number;
  intercoRevenue: number;
  netRevenue: number;
  directCost: number;
  intercoCost: number;
  grossProfit: number;
  payroll: number;
  opex: number;
  depreciation: number;
  ebitda: number;
  ebit: number;
  interestExpense: number;
  pretaxIncome: number;
  tax: number;
  netIncome: number;
}

function zeroPnl(): PnlLines {
  return { grossRevenue: 0, intercoRevenue: 0, netRevenue: 0, directCost: 0, intercoCost: 0, grossProfit: 0, payroll: 0, opex: 0, depreciation: 0, ebitda: 0, ebit: 0, interestExpense: 0, pretaxIncome: 0, tax: 0, netIncome: 0 };
}

function pnlLocal(entityId: string, period: Period, scenario: "actual" | "budget" | "forecast" = "actual"): PnlLines {
  // Real firm-wide monthly facts (USD). Budget/forecast scenarios are
  // honest zeros until a real planning scenario is committed.
  if (entityId === FIRM_ENTITY_ID) {
    if (scenario !== "actual") return zeroPnl();
    const m = FACTS?.monthly[period.id];
    if (!m) return zeroPnl();
    const grossProfit = m.revenueUsd - m.directCostUsd;
    const ebitda = grossProfit - m.payrollUsd - m.opexUsd;
    return {
      grossRevenue: round(m.revenueUsd), intercoRevenue: 0, netRevenue: round(m.revenueUsd),
      directCost: round(m.directCostUsd), intercoCost: 0, grossProfit: round(grossProfit),
      payroll: round(m.payrollUsd), opex: round(m.opexUsd), depreciation: 0,
      ebitda: round(ebitda), ebit: round(ebitda), interestExpense: 0,
      pretaxIncome: round(ebitda), tax: 0, netIncome: round(ebitda),
    };
  }
  const profile = PROFILES[entityId];
  if (!profile) {
    return zeroPnl();
  }
  const seas = seasonality(period.month, entityId);
  // Modest growth trend: +0.6% per month from 12mo ago.
  const monthsBack = (ANCHOR_YEAR * 12 + ANCHOR_MONTH) - (period.year * 12 + period.month);
  const growth = Math.pow(1.006, -monthsBack);

  let revBase = profile.baseMonthlyRevenue * seas * growth * (1 + noise(`rev_${entityId}_${period.id}`, 0.06));
  // Budget = baseline trend (no noise/seasonality kicker beyond growth).
  if (scenario === "budget") revBase = profile.baseMonthlyRevenue * growth * 1.04; // +4% stretch
  // Forecast = midway between budget and actuals trend (uses smaller noise).
  if (scenario === "forecast") revBase = profile.baseMonthlyRevenue * growth * (1 + 0.02 + noise(`fc_${entityId}_${period.id}`, 0.02));

  // IC revenue earned (provider side): sum IC fees where this entity is provider.
  const intercoRev = IC_FEES
    .filter((f) => f.providerId === entityId)
    .reduce((s, f) => {
      // Keep in providerId baseCurrency (which is f.currency by definition).
      return s + f.monthlyAmountLocal * (1 + noise(`icr_${entityId}_${f.counterpartyId}_${period.id}`, 0.02));
    }, 0);

  // IC cost incurred (counterparty side): sum IC fees translated into THIS entity's local currency at average rate.
  const intercoCost = IC_FEES
    .filter((f) => f.counterpartyId === entityId)
    .reduce((s, f) => {
      const ccy = PROFILES[entityId] ? ENTITIES_SEED.find((e) => e.id === entityId)?.baseCurrency ?? "USD" : "USD";
      const fromGbp = f.currency === "GBP" ? 1 : 1 / averageRateToGbp(f.currency, period);
      // Express provider amount in GBP, then to my local at average rate.
      const inGbp = f.monthlyAmountLocal * (f.currency === "GBP" ? 1 : 1 / averageRateToGbp(f.currency, period));
      return s + convert(inGbp, 1, ccy, period, "average") * (1 + noise(`icc_${entityId}_${f.providerId}_${period.id}`, 0.02));
    }, 0);

  const directCost = revBase * profile.directCostRatio * (1 + noise(`dc_${entityId}_${period.id}`, 0.04));
  const payroll = profile.payrollBase * (1 + noise(`pr_${entityId}_${period.id}`, 0.03));
  const opex = profile.opexBase * (1 + noise(`ox_${entityId}_${period.id}`, 0.05));
  const depreciation = profile.depreciation;
  const interestExpense = profile.interestExpense * (1 + noise(`int_${entityId}_${period.id}`, 0.02));

  const grossRevenue = revBase + intercoRev;
  const netRevenue = grossRevenue; // both included in gross unless eliminated
  const grossProfit = netRevenue - directCost - intercoCost;
  const ebitda = grossProfit - payroll - opex;
  const ebit = ebitda - depreciation;
  const pretaxIncome = ebit - interestExpense;
  const tax = Math.max(0, pretaxIncome) * profile.taxRate;
  const netIncome = pretaxIncome - tax;

  return {
    grossRevenue: round(revBase),
    intercoRevenue: round(intercoRev),
    netRevenue: round(netRevenue),
    directCost: round(directCost),
    intercoCost: round(intercoCost),
    grossProfit: round(grossProfit),
    payroll: round(payroll),
    opex: round(opex),
    depreciation: round(depreciation),
    ebitda: round(ebitda),
    ebit: round(ebit),
    interestExpense: round(interestExpense),
    pretaxIncome: round(pretaxIncome),
    tax: round(tax),
    netIncome: round(netIncome),
  };
}

function round(n: number): number { return Math.round(n); }

// Aggregate P&L over multiple periods.
function aggregatePnl(rows: PnlLines[]): PnlLines {
  const sum = (k: keyof PnlLines) => rows.reduce((s, r) => s + r[k], 0);
  return {
    grossRevenue: sum("grossRevenue"),
    intercoRevenue: sum("intercoRevenue"),
    netRevenue: sum("netRevenue"),
    directCost: sum("directCost"),
    intercoCost: sum("intercoCost"),
    grossProfit: sum("grossProfit"),
    payroll: sum("payroll"),
    opex: sum("opex"),
    depreciation: sum("depreciation"),
    ebitda: sum("ebitda"),
    ebit: sum("ebit"),
    interestExpense: sum("interestExpense"),
    pretaxIncome: sum("pretaxIncome"),
    tax: sum("tax"),
    netIncome: sum("netIncome"),
  };
}

// ──────────────────────────────────────────────────────────────
// Balance sheet generator (local currency).
// We roll opening balances forward by adding cumulative net income
// to retained earnings, and bumping AR/cash/AP from the operating
// trend. Always balances by construction.
// ──────────────────────────────────────────────────────────────
interface BsLines {
  cash: number;
  ar: number;
  intercoAr: number;
  wip: number;
  ppe: number;
  intangible: number;
  totalAssets: number;
  ap: number;
  intercoAp: number;
  accruals: number;
  debt: number;
  intercoLoanPayable: number;
  totalLiabilities: number;
  shareCapital: number;
  retainedEarnings: number;
  fctr: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  // Memo
  intercoLoanReceivable: number;
}

function bsLocal(entityId: string, period: Period): BsLines {
  // Real firm-wide balances snapshot (USD) as of the month end.
  if (entityId === FIRM_ENTITY_ID) {
    const b = FACTS?.balancesByMonth[period.id];
    if (!b) return blankBs();
    const cash = round(b.cashCollectedUsd - b.cashPaidOutUsd);
    const ar = round(b.openArUsd);
    const ap = round(b.openApUsd);
    const totalAssets = cash + ar;
    const totalLiabilities = ap;
    const retainedEarnings = totalAssets - totalLiabilities;
    return {
      ...blankBs(),
      cash, ar, ap, totalAssets, totalLiabilities,
      retainedEarnings, totalEquity: retainedEarnings,
      totalLiabilitiesAndEquity: totalAssets,
    };
  }
  const profile = PROFILES[entityId];
  if (!profile) return blankBs();
  // Number of months elapsed since opening (period 0 = first period).
  const elapsed = (period.year * 12 + period.month) - (PERIODS[0].year * 12 + PERIODS[0].month);

  // Cumulative net income through this period.
  let cumNi = 0;
  for (let i = 0; i <= elapsed; i++) {
    cumNi += pnlLocal(entityId, PERIODS[i]).netIncome;
  }

  const trend = 1 + 0.005 * (elapsed + 1);
  const cash = profile.openingBalances.cash * trend + cumNi * 0.55;
  const ar = profile.openingBalances.ar * trend * (1 + noise(`bs_ar_${entityId}_${period.id}`, 0.05));
  const wip = profile.openingBalances.wip * trend * (1 + noise(`bs_wip_${entityId}_${period.id}`, 0.06));
  const ppe = profile.openingBalances.ppe - profile.depreciation * (elapsed + 1) + profile.depreciation * 6; // capex offset
  const intangible = profile.openingBalances.intangible;
  const ap = profile.openingBalances.ap * trend * (1 + noise(`bs_ap_${entityId}_${period.id}`, 0.04));
  const accruals = profile.openingBalances.accruals * trend;
  const debt = Math.max(0, profile.openingBalances.debt - 5_000 * (elapsed + 1));

  // Inter-company receivables/payables for THIS entity.
  const intercoArMonthly = IC_FEES
    .filter((f) => f.providerId === entityId)
    .reduce((s, f) => s + f.monthlyAmountLocal, 0);
  const intercoApMonthly = IC_FEES
    .filter((f) => f.counterpartyId === entityId)
    .reduce((s, f) => {
      const ccy = ENTITIES_SEED.find((e) => e.id === entityId)?.baseCurrency ?? "USD";
      const inGbp = f.monthlyAmountLocal * (f.currency === "GBP" ? 1 : 1 / averageRateToGbp(f.currency, period));
      return s + convert(inGbp, 1, ccy, period, "closing");
    }, 0);
  const intercoAr = intercoArMonthly * 1.6; // ~6 weeks DSO on IC fees
  const intercoAp = intercoApMonthly * 1.6;

  // IC loans
  const intercoLoanReceivable = IC_LOANS
    .filter((l) => l.providerId === entityId)
    .reduce((s, l) => s + l.balanceLocal, 0);
  const intercoLoanPayable = IC_LOANS
    .filter((l) => l.counterpartyId === entityId)
    .reduce((s, l) => {
      const ccy = ENTITIES_SEED.find((e) => e.id === entityId)?.baseCurrency ?? "USD";
      const inGbp = l.balanceLocal * (l.currency === "GBP" ? 1 : 1 / closingRateToGbp(l.currency, period));
      return convert(inGbp, 1, ccy, period, "closing") + s;
    }, 0);

  const shareCapital = profile.openingBalances.shareCapital;
  const retainedEarnings = profile.openingBalances.retainedEarningsOpening + cumNi;
  const totalAssets = cash + ar + intercoAr + wip + ppe + intangible + intercoLoanReceivable;
  const totalLiabilitiesPreEquity = ap + intercoAp + accruals + debt + intercoLoanPayable;
  const desiredEquity = totalAssets - totalLiabilitiesPreEquity;
  const fctr = desiredEquity - shareCapital - retainedEarnings;

  const totalEquity = shareCapital + retainedEarnings + fctr;
  return {
    cash: round(cash), ar: round(ar), intercoAr: round(intercoAr), wip: round(wip),
    ppe: round(ppe), intangible: round(intangible),
    intercoLoanReceivable: round(intercoLoanReceivable),
    totalAssets: round(totalAssets),
    ap: round(ap), intercoAp: round(intercoAp), accruals: round(accruals),
    debt: round(debt), intercoLoanPayable: round(intercoLoanPayable),
    totalLiabilities: round(totalLiabilitiesPreEquity),
    shareCapital: round(shareCapital), retainedEarnings: round(retainedEarnings),
    fctr: round(fctr), totalEquity: round(totalEquity),
    totalLiabilitiesAndEquity: round(totalLiabilitiesPreEquity + totalEquity),
  };
}

function blankBs(): BsLines {
  return { cash: 0, ar: 0, intercoAr: 0, wip: 0, ppe: 0, intangible: 0, totalAssets: 0, ap: 0, intercoAp: 0, accruals: 0, debt: 0, intercoLoanPayable: 0, totalLiabilities: 0, shareCapital: 0, retainedEarnings: 0, fctr: 0, totalEquity: 0, totalLiabilitiesAndEquity: 0, intercoLoanReceivable: 0 };
}

// ──────────────────────────────────────────────────────────────
// Cash flow (indirect) generator (local currency).
// ──────────────────────────────────────────────────────────────
interface CfLines {
  netIncome: number;
  depreciation: number;
  workingCapitalChange: number; // -ΔAR -ΔWIP +ΔAP +ΔAccruals
  cashFromOps: number;
  capex: number;
  cashFromInvesting: number;
  debtRepayment: number;
  intercoFunding: number;
  cashFromFinancing: number;
  fxOnCash: number;
  netChangeInCash: number;
  openingCash: number;
  closingCash: number;
}

function zeroCf(): CfLines {
  return { netIncome: 0, depreciation: 0, workingCapitalChange: 0, cashFromOps: 0, capex: 0, cashFromInvesting: 0, debtRepayment: 0, intercoFunding: 0, cashFromFinancing: 0, fxOnCash: 0, netChangeInCash: 0, openingCash: 0, closingCash: 0 };
}

function cfLocal(entityId: string, period: Period): CfLines {
  // Real firm-wide cash flow (USD): indirect from monthly P&L facts plus
  // balance-sheet deltas between month-end snapshots.
  if (entityId === FIRM_ENTITY_ID) {
    const prevYm = (() => { const { y, m } = addMonths(period.year, period.month, -1); return periodIso(y, m); })();
    const bNow = FACTS?.balancesByMonth[period.id];
    if (!bNow) return zeroCf();
    const bPrev = FACTS?.balancesByMonth[prevYm] ?? { cashCollectedUsd: 0, cashPaidOutUsd: 0, openArUsd: 0, openApUsd: 0 };
    const pnl = pnlLocal(entityId, period);
    const openingCash = round(bPrev.cashCollectedUsd - bPrev.cashPaidOutUsd);
    const closingCash = round(bNow.cashCollectedUsd - bNow.cashPaidOutUsd);
    const net = closingCash - openingCash;
    const wc = net - pnl.netIncome; // all non-P&L movement is working capital (no capex/debt facts yet)
    return {
      ...zeroCf(),
      netIncome: pnl.netIncome,
      workingCapitalChange: round(wc),
      cashFromOps: round(net),
      netChangeInCash: round(net),
      openingCash, closingCash,
    };
  }
  const profile = PROFILES[entityId];
  if (!profile) return zeroCf();
  const idx = PERIODS.findIndex((p) => p.id === period.id);
  const prev = idx > 0 ? PERIODS[idx - 1] : null;
  const bsNow = bsLocal(entityId, period);
  const bsPrev = prev ? bsLocal(entityId, prev) : { ...blankBs(), cash: profile.openingBalances.cash, ar: profile.openingBalances.ar, wip: profile.openingBalances.wip, ap: profile.openingBalances.ap, accruals: profile.openingBalances.accruals };
  const pnl = pnlLocal(entityId, period);
  const dAr = bsNow.ar - bsPrev.ar;
  const dWip = bsNow.wip - bsPrev.wip;
  const dAp = bsNow.ap - bsPrev.ap;
  const dAccr = bsNow.accruals - bsPrev.accruals;
  const wc = -dAr - dWip + dAp + dAccr;
  const ops = pnl.netIncome + pnl.depreciation + wc;
  const capex = -profile.depreciation * 0.85; // re-investment
  const debtRepay = -5_000;
  const intercoFunding = 0;
  const fxOnCash = 0;
  const closingCash = bsNow.cash;
  const openingCash = bsPrev.cash;
  const net = ops + capex + debtRepay + intercoFunding + fxOnCash;
  return {
    netIncome: pnl.netIncome,
    depreciation: pnl.depreciation,
    workingCapitalChange: round(wc),
    cashFromOps: round(ops),
    capex: round(capex),
    cashFromInvesting: round(capex),
    debtRepayment: round(debtRepay),
    intercoFunding,
    cashFromFinancing: round(debtRepay + intercoFunding),
    fxOnCash,
    netChangeInCash: round(net),
    openingCash: round(openingCash),
    closingCash: round(closingCash),
  };
}

// ──────────────────────────────────────────────────────────────
// FX translation: local PnL/BS → presentation currency.
// ──────────────────────────────────────────────────────────────
function translatePnlToGbp(local: PnlLines, currency: string, period: Period): PnlLines {
  if (currency === "GBP") return local;
  const r = averageRateToGbp(currency, period);
  const f = (n: number) => round(n * r);
  return {
    grossRevenue: f(local.grossRevenue), intercoRevenue: f(local.intercoRevenue), netRevenue: f(local.netRevenue),
    directCost: f(local.directCost), intercoCost: f(local.intercoCost), grossProfit: f(local.grossProfit),
    payroll: f(local.payroll), opex: f(local.opex), depreciation: f(local.depreciation),
    ebitda: f(local.ebitda), ebit: f(local.ebit), interestExpense: f(local.interestExpense),
    pretaxIncome: f(local.pretaxIncome), tax: f(local.tax), netIncome: f(local.netIncome),
  };
}

function translateBsToGbp(local: BsLines, currency: string, period: Period, openingShareCapital: number): BsLines {
  if (currency === "GBP") return local;
  const closing = closingRateToGbp(currency, period);
  const historical = historicalRateToGbp(currency);
  const f = (n: number) => round(n * closing);
  // Equity: share capital at historical, retained earnings at avg of period (approx closing for demo simplicity).
  const sc = round(local.shareCapital * historical);
  const re = round(local.retainedEarnings * closing);
  const totalAssetsT = f(local.totalAssets);
  const totalLiabT = f(local.totalLiabilities);
  const fctr = totalAssetsT - totalLiabT - sc - re;
  return {
    cash: f(local.cash), ar: f(local.ar), intercoAr: f(local.intercoAr), wip: f(local.wip),
    ppe: f(local.ppe), intangible: f(local.intangible),
    intercoLoanReceivable: f(local.intercoLoanReceivable), totalAssets: totalAssetsT,
    ap: f(local.ap), intercoAp: f(local.intercoAp), accruals: f(local.accruals),
    debt: f(local.debt), intercoLoanPayable: f(local.intercoLoanPayable), totalLiabilities: totalLiabT,
    shareCapital: sc, retainedEarnings: re, fctr, totalEquity: sc + re + fctr,
    totalLiabilitiesAndEquity: totalAssetsT,
  };
}

function translateCfToGbp(local: CfLines, currency: string, period: Period): CfLines {
  if (currency === "GBP") return local;
  const r = averageRateToGbp(currency, period);
  const f = (n: number) => round(n * r);
  return {
    netIncome: f(local.netIncome), depreciation: f(local.depreciation),
    workingCapitalChange: f(local.workingCapitalChange), cashFromOps: f(local.cashFromOps),
    capex: f(local.capex), cashFromInvesting: f(local.cashFromInvesting),
    debtRepayment: f(local.debtRepayment), intercoFunding: f(local.intercoFunding),
    cashFromFinancing: f(local.cashFromFinancing), fxOnCash: f(local.fxOnCash),
    netChangeInCash: f(local.netChangeInCash), openingCash: f(local.openingCash), closingCash: f(local.closingCash),
  };
}

// ──────────────────────────────────────────────────────────────
// Eliminations engine.
// ──────────────────────────────────────────────────────────────
interface Eliminations {
  intercoRevenueGbp: number;
  intercoCostGbp: number;
  intercoArGbp: number;
  intercoApGbp: number;
  intercoLoanGbp: number;
}

function computeEliminationsForPeriod(period: Period): Eliminations {
  // IC revenue/cost: sum IC fees translated to GBP at average rate.
  const intercoRev = IC_FEES.reduce((s, f) => s + f.monthlyAmountLocal * (f.currency === "GBP" ? 1 : 1 / averageRateToGbp(f.currency, period)), 0);
  // IC AR/AP: ~6 weeks DSO of fees, at closing rate.
  const intercoAr = IC_FEES.reduce((s, f) => s + f.monthlyAmountLocal * 1.6 * (f.currency === "GBP" ? 1 : 1 / closingRateToGbp(f.currency, period)), 0);
  // IC loans at closing rate.
  const intercoLoan = IC_LOANS.reduce((s, l) => s + l.balanceLocal * (l.currency === "GBP" ? 1 : 1 / closingRateToGbp(l.currency, period)), 0);
  return {
    intercoRevenueGbp: round(intercoRev),
    intercoCostGbp: round(intercoRev),
    intercoArGbp: round(intercoAr),
    intercoApGbp: round(intercoAr),
    intercoLoanGbp: round(intercoLoan),
  };
}

// ──────────────────────────────────────────────────────────────
// Variance / commentary helpers.
// ──────────────────────────────────────────────────────────────
function pct(numer: number, denom: number): number { return denom === 0 ? 0 : numer / denom; }

interface VarianceCell { actual: number; budget: number; forecast: number; priorYear: number; vsBudget: number; vsForecast: number; vsPriorYear: number; vsBudgetPct: number; vsForecastPct: number; vsPriorYearPct: number }

function variance(actual: number, budget: number, forecast: number, priorYear: number): VarianceCell {
  return {
    actual, budget, forecast, priorYear,
    vsBudget: actual - budget, vsForecast: actual - forecast, vsPriorYear: actual - priorYear,
    vsBudgetPct: pct(actual - budget, Math.abs(budget) || 1),
    vsForecastPct: pct(actual - forecast, Math.abs(forecast) || 1),
    vsPriorYearPct: pct(actual - priorYear, Math.abs(priorYear) || 1),
  };
}

function autoCommentary(label: string, v: VarianceCell, kind: "favorable_high" | "favorable_low" = "favorable_high"): string {
  const abs = Math.abs(v.vsBudgetPct);
  if (abs < 0.03) return `${label} broadly in line with plan (${signed(v.vsBudgetPct)}%).`;
  const fav = kind === "favorable_high" ? v.vsBudget > 0 : v.vsBudget < 0;
  const tone = fav ? "favourable" : "unfavourable";
  const piece = abs >= 0.10 ? "materially" : abs >= 0.05 ? "moderately" : "modestly";
  const yoy = v.vsPriorYear === 0 ? "" : ` YoY ${signed(v.vsPriorYearPct)}%.`;
  return `${label} is ${piece} ${tone} vs budget (${signed(v.vsBudgetPct)}%).${yoy}`;
}
function signed(n: number): string { return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}`; }

// ──────────────────────────────────────────────────────────────
// Period scope helpers.
// ──────────────────────────────────────────────────────────────
type Scope = "mtd" | "qtd" | "ytd" | "r12";

function periodsForScope(scope: Scope, anchor: Period): Period[] {
  const idx = PERIODS.findIndex((p) => p.id === anchor.id);
  if (idx < 0) return [anchor];
  if (scope === "mtd") return [anchor];
  if (scope === "qtd") {
    const qStart = Math.floor((anchor.month - 1) / 3) * 3 + 1;
    const startId = periodIso(anchor.year, qStart);
    return PERIODS.slice(0, idx + 1).filter((p) => p.year === anchor.year && p.month >= qStart && p.month <= anchor.month);
  }
  if (scope === "ytd") {
    return PERIODS.slice(0, idx + 1).filter((p) => p.year === anchor.year);
  }
  // r12
  return PERIODS.slice(Math.max(0, idx - 11), idx + 1);
}

function priorYearScope(scope: Scope, anchor: Period): Period[] {
  // Mirror scope shifted -12 months. Because PERIODS only holds 12 months,
  // we synthesise the prior period objects.
  const synth = (y: number, m: number): Period => ({ id: periodIso(y, m), year: y, month: m, label: monthLabel(y, m), endsOn: endOfMonth(y, m) });
  const cur = periodsForScope(scope, anchor);
  return cur.map((p) => synth(p.year - 1, p.month));
}

// ──────────────────────────────────────────────────────────────
// Profitability cube (engagement-level seed).
// ──────────────────────────────────────────────────────────────
type EngType = "fixed_fee" | "tm" | "subscription" | "managed_service";

interface CubeRow {
  engagementId: string;
  engagementName: string;
  client: string;
  partner: string;
  sector: string;
  engagementType: EngType;
  entityId: string;
  revenueGbp: number;
  directCostGbp: number;
  grossMarginGbp: number;
  grossMarginPct: number;
}

// Profitability cube from real per-engagement economics (invoice revenue
// vs contractor payments + billable expenses), translated USD → GBP at
// the reference rate. Engagement type isn't tracked yet → "tm" default.
function buildCube(_scopePeriods: Period[]): CubeRow[] {
  const usdToGbp = FX_BASE_TO_GBP.USD ?? 1;
  return (FACTS?.cube ?? []).map((r) => {
    const revenueGbp = round(r.revenueUsd * usdToGbp);
    const directCostGbp = round(r.directCostUsd * usdToGbp);
    const gm = revenueGbp - directCostGbp;
    return {
      engagementId: r.engagementId,
      engagementName: r.engagement,
      client: r.client,
      partner: r.partner,
      sector: r.sector,
      engagementType: "tm" as EngType,
      entityId: r.entityId,
      revenueGbp,
      directCostGbp,
      grossMarginGbp: gm,
      grossMarginPct: revenueGbp === 0 ? 0 : gm / revenueGbp,
    };
  });
}

// ──────────────────────────────────────────────────────────────
// Endpoints
// ──────────────────────────────────────────────────────────────

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/reports/periods", (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  res.json({ periods: PERIODS, current: CURRENT_PERIOD });
});

function parseQuery(req: Request) {
  const periodId = (req.query.period as string) ?? CURRENT_PERIOD.id;
  const scope = ((req.query.scope as string) ?? "ytd") as Scope;
  const entity = (req.query.entity as string) || null; // null = consolidated
  const currency = ((req.query.currency as string) ?? "GBP").toUpperCase();
  const period = periodById(periodId) ?? CURRENT_PERIOD;
  return { period, scope: ["mtd", "qtd", "ytd", "r12"].includes(scope) ? scope : "ytd" as Scope, entity, currency };
}

function entitiesIn(scope: string | null): { id: string; baseCurrency: string; shortName: string }[] {
  // No legal entities registered yet → single firm pseudo-entity so the
  // consolidated view carries the real firm-wide facts (Task #177).
  const all = ENTITIES_SEED.length > 0
    ? ENTITIES_SEED.map((e) => ({ id: e.id, baseCurrency: e.baseCurrency, shortName: e.shortName }))
    : [FIRM_PSEUDO_ENTITY];
  if (scope) return all.filter((e) => e.id === scope);
  return all;
}

// ----- P&L
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/reports/pnl", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await ensureFacts(me.orgId);
  const { period, scope, entity, currency } = parseQuery(req);
  const ents = entitiesIn(entity);
  const periods = periodsForScope(scope, period);
  const pyPeriods = priorYearScope(scope, period);
  const consolidated = !entity;

  const perEntity = ents.map((e) => {
    const actualLocal = aggregatePnl(periods.map((p) => pnlLocal(e.id, p)));
    const budgetLocal = aggregatePnl(periods.map((p) => pnlLocal(e.id, p, "budget")));
    const forecastLocal = aggregatePnl(periods.map((p) => pnlLocal(e.id, p, "forecast")));
    const pyLocal = aggregatePnl(pyPeriods.map((p) => pnlLocal(e.id, p)));
    const tr = (l: PnlLines) => {
      // Translate aggregated local to presentation; uses average of last period in scope as approximation.
      return translatePnlToGbp(l, e.baseCurrency, period);
    };
    const inGbp = {
      actual: tr(actualLocal),
      budget: tr(budgetLocal),
      forecast: tr(forecastLocal),
      priorYear: tr(pyLocal),
    };
    const inDisplay = currency === e.baseCurrency
      ? { actual: actualLocal, budget: budgetLocal, forecast: forecastLocal, priorYear: pyLocal }
      : currency === "GBP"
        ? inGbp
        : {
            actual: convertPnl(inGbp.actual, currency, period),
            budget: convertPnl(inGbp.budget, currency, period),
            forecast: convertPnl(inGbp.forecast, currency, period),
            priorYear: convertPnl(inGbp.priorYear, currency, period),
          };
    return { entityId: e.id, entityName: e.shortName, baseCurrency: e.baseCurrency, ...inDisplay, gbp: inGbp };
  });

  let consolidatedRow: { actual: PnlLines; budget: PnlLines; forecast: PnlLines; priorYear: PnlLines } | null = null;
  let elims: Eliminations | null = null;
  if (consolidated) {
    const sum = (key: "actual" | "budget" | "forecast" | "priorYear") => aggregatePnl(perEntity.map((p) => p.gbp[key]));
    const elim = aggregateElims(periods);
    elims = elim;
    const apply = (p: PnlLines): PnlLines => ({
      ...p,
      grossRevenue: p.grossRevenue,
      intercoRevenue: 0,
      netRevenue: p.netRevenue - elim.intercoRevenueGbp,
      directCost: p.directCost,
      intercoCost: 0,
      grossProfit: p.grossProfit, // intercoRev - intercoCost = 0 net
      ebitda: p.ebitda,
      ebit: p.ebit,
      pretaxIncome: p.pretaxIncome,
      tax: p.tax,
      netIncome: p.netIncome,
    });
    consolidatedRow = {
      actual: apply(sum("actual")),
      budget: apply(sum("budget")),
      forecast: apply(sum("forecast")),
      priorYear: apply(sum("priorYear")),
    };
    if (currency !== "GBP") {
      consolidatedRow = {
        actual: convertPnl(consolidatedRow.actual, currency, period),
        budget: convertPnl(consolidatedRow.budget, currency, period),
        forecast: convertPnl(consolidatedRow.forecast, currency, period),
        priorYear: convertPnl(consolidatedRow.priorYear, currency, period),
      };
    }
  }

  // Variance + commentary on the consolidated (or single entity) view.
  const headRow = consolidatedRow ?? perEntity[0];
  const v = headRow ? buildPnlVariance(headRow.actual, headRow.budget, headRow.forecast, headRow.priorYear) : null;
  const commentary = v ? buildPnlCommentary(v) : [];

  res.json({
    period: period.id, scope, currency, entity: entity ?? null, periodsCovered: periods.map((p) => p.id),
    perEntity, consolidated: consolidatedRow, eliminations: elims,
    variance: v, commentary,
  });
});

function convertPnl(p: PnlLines, target: string, period: Period): PnlLines {
  const r = target === "GBP" ? 1 : 1 / averageRateToGbp(target, period);
  const f = (n: number) => round(n / r);
  return {
    grossRevenue: f(p.grossRevenue), intercoRevenue: f(p.intercoRevenue), netRevenue: f(p.netRevenue),
    directCost: f(p.directCost), intercoCost: f(p.intercoCost), grossProfit: f(p.grossProfit),
    payroll: f(p.payroll), opex: f(p.opex), depreciation: f(p.depreciation),
    ebitda: f(p.ebitda), ebit: f(p.ebit), interestExpense: f(p.interestExpense),
    pretaxIncome: f(p.pretaxIncome), tax: f(p.tax), netIncome: f(p.netIncome),
  };
}

function aggregateElims(periods: Period[]): Eliminations {
  return periods.reduce((acc, p) => {
    const e = computeEliminationsForPeriod(p);
    return {
      intercoRevenueGbp: acc.intercoRevenueGbp + e.intercoRevenueGbp,
      intercoCostGbp: acc.intercoCostGbp + e.intercoCostGbp,
      intercoArGbp: e.intercoArGbp,    // BS items are point-in-time (use last period)
      intercoApGbp: e.intercoApGbp,
      intercoLoanGbp: e.intercoLoanGbp,
    };
  }, { intercoRevenueGbp: 0, intercoCostGbp: 0, intercoArGbp: 0, intercoApGbp: 0, intercoLoanGbp: 0 });
}

interface PnlVariance {
  netRevenue: VarianceCell;
  grossProfit: VarianceCell;
  ebitda: VarianceCell;
  ebit: VarianceCell;
  netIncome: VarianceCell;
}

function buildPnlVariance(a: PnlLines, b: PnlLines, f: PnlLines, py: PnlLines): PnlVariance {
  return {
    netRevenue: variance(a.netRevenue, b.netRevenue, f.netRevenue, py.netRevenue),
    grossProfit: variance(a.grossProfit, b.grossProfit, f.grossProfit, py.grossProfit),
    ebitda: variance(a.ebitda, b.ebitda, f.ebitda, py.ebitda),
    ebit: variance(a.ebit, b.ebit, f.ebit, py.ebit),
    netIncome: variance(a.netIncome, b.netIncome, f.netIncome, py.netIncome),
  };
}

const NO_FINANCIAL_DATA_NOTE = "No financial data has been recorded for this period yet — variance commentary is unavailable.";

function pnlAllZero(cons: { actual: PnlLines; budget: PnlLines; forecast: PnlLines; priorYear: PnlLines }): boolean {
  const keys: Array<keyof PnlLines> = ["netRevenue", "grossProfit", "payroll", "opex", "ebitda", "ebit", "netIncome"];
  return (["actual", "budget", "forecast", "priorYear"] as const).every((k) =>
    keys.every((key) => Math.abs(cons[k][key]) < 0.005),
  );
}

function buildPnlCommentary(v: PnlVariance): string[] {
  return [
    autoCommentary("Net revenue", v.netRevenue),
    autoCommentary("Gross profit", v.grossProfit),
    autoCommentary("EBITDA", v.ebitda),
    autoCommentary("Net income", v.netIncome),
  ];
}

// ----- BS
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/reports/bs", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await ensureFacts(me.orgId);
  const { period, entity, currency } = parseQuery(req);
  const ents = entitiesIn(entity);
  const consolidated = !entity;

  const perEntity = ents.map((e) => {
    const local = bsLocal(e.id, period);
    const gbp = translateBsToGbp(local, e.baseCurrency, period, PROFILES[e.id]?.openingBalances.shareCapital ?? 0);
    const display = currency === e.baseCurrency ? local : currency === "GBP" ? gbp : convertBs(gbp, currency, period);
    return { entityId: e.id, entityName: e.shortName, baseCurrency: e.baseCurrency, local, gbp, display };
  });

  let consolidatedRow: BsLines | null = null;
  let elims: Eliminations | null = null;
  if (consolidated) {
    const sum = sumBs(perEntity.map((x) => x.gbp));
    const elim = computeEliminationsForPeriod(period);
    elims = elim;
    const cons: BsLines = {
      ...sum,
      intercoAr: 0, intercoAp: 0, intercoLoanReceivable: 0, intercoLoanPayable: 0,
      totalAssets: sum.totalAssets - sum.intercoAr - sum.intercoLoanReceivable,
      totalLiabilities: sum.totalLiabilities - sum.intercoAp - sum.intercoLoanPayable,
    };
    cons.totalLiabilitiesAndEquity = cons.totalLiabilities + cons.totalEquity;
    consolidatedRow = currency !== "GBP" ? convertBs(cons, currency, period) : cons;
  }

  res.json({ period: period.id, currency, entity: entity ?? null, perEntity, consolidated: consolidatedRow, eliminations: elims });
});

function sumBs(rows: BsLines[]): BsLines {
  const sum = (k: keyof BsLines) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    cash: sum("cash"), ar: sum("ar"), intercoAr: sum("intercoAr"), wip: sum("wip"),
    ppe: sum("ppe"), intangible: sum("intangible"),
    intercoLoanReceivable: sum("intercoLoanReceivable"),
    totalAssets: sum("totalAssets"),
    ap: sum("ap"), intercoAp: sum("intercoAp"), accruals: sum("accruals"),
    debt: sum("debt"), intercoLoanPayable: sum("intercoLoanPayable"),
    totalLiabilities: sum("totalLiabilities"),
    shareCapital: sum("shareCapital"), retainedEarnings: sum("retainedEarnings"),
    fctr: sum("fctr"), totalEquity: sum("totalEquity"),
    totalLiabilitiesAndEquity: sum("totalLiabilitiesAndEquity"),
  };
}

function convertBs(b: BsLines, target: string, period: Period): BsLines {
  const r = target === "GBP" ? 1 : 1 / closingRateToGbp(target, period);
  const f = (n: number) => round(n / r);
  return {
    cash: f(b.cash), ar: f(b.ar), intercoAr: f(b.intercoAr), wip: f(b.wip),
    ppe: f(b.ppe), intangible: f(b.intangible),
    intercoLoanReceivable: f(b.intercoLoanReceivable),
    totalAssets: f(b.totalAssets),
    ap: f(b.ap), intercoAp: f(b.intercoAp), accruals: f(b.accruals),
    debt: f(b.debt), intercoLoanPayable: f(b.intercoLoanPayable),
    totalLiabilities: f(b.totalLiabilities),
    shareCapital: f(b.shareCapital), retainedEarnings: f(b.retainedEarnings),
    fctr: f(b.fctr), totalEquity: f(b.totalEquity),
    totalLiabilitiesAndEquity: f(b.totalLiabilitiesAndEquity),
  };
}

// ----- CF
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/reports/cf", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await ensureFacts(me.orgId);
  const { period, scope, entity, currency } = parseQuery(req);
  const ents = entitiesIn(entity);
  const periods = periodsForScope(scope, period);

  const perEntity = ents.map((e) => {
    const aggLocal = aggregateCf(periods.map((p) => cfLocal(e.id, p)));
    // Use bsLocal at start of scope and end of scope for opening/closing cash.
    const startBs = bsLocal(e.id, periods[0]);
    const endBs = bsLocal(e.id, periods[periods.length - 1]);
    const adj: CfLines = { ...aggLocal, openingCash: startBs.cash - aggLocal.netChangeInCash, closingCash: endBs.cash };
    const gbp = translateCfToGbp(adj, e.baseCurrency, period);
    const display = currency === e.baseCurrency ? adj : currency === "GBP" ? gbp : convertCf(gbp, currency, period);
    return { entityId: e.id, entityName: e.shortName, baseCurrency: e.baseCurrency, display, gbp };
  });

  let consolidated: CfLines | null = null;
  if (!entity) {
    const sum = aggregateCf(perEntity.map((p) => p.gbp));
    consolidated = currency !== "GBP" ? convertCf(sum, currency, period) : sum;
  }

  res.json({ period: period.id, scope, currency, entity: entity ?? null, perEntity, consolidated });
});

function aggregateCf(rows: CfLines[]): CfLines {
  const sum = (k: keyof CfLines) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    netIncome: sum("netIncome"), depreciation: sum("depreciation"),
    workingCapitalChange: sum("workingCapitalChange"), cashFromOps: sum("cashFromOps"),
    capex: sum("capex"), cashFromInvesting: sum("cashFromInvesting"),
    debtRepayment: sum("debtRepayment"), intercoFunding: sum("intercoFunding"),
    cashFromFinancing: sum("cashFromFinancing"), fxOnCash: sum("fxOnCash"),
    netChangeInCash: sum("netChangeInCash"), openingCash: sum("openingCash"), closingCash: sum("closingCash"),
  };
}

function convertCf(c: CfLines, target: string, period: Period): CfLines {
  const r = target === "GBP" ? 1 : 1 / averageRateToGbp(target, period);
  const f = (n: number) => round(n / r);
  return {
    netIncome: f(c.netIncome), depreciation: f(c.depreciation),
    workingCapitalChange: f(c.workingCapitalChange), cashFromOps: f(c.cashFromOps),
    capex: f(c.capex), cashFromInvesting: f(c.cashFromInvesting),
    debtRepayment: f(c.debtRepayment), intercoFunding: f(c.intercoFunding),
    cashFromFinancing: f(c.cashFromFinancing), fxOnCash: f(c.fxOnCash),
    netChangeInCash: f(c.netChangeInCash), openingCash: f(c.openingCash), closingCash: f(c.closingCash),
  };
}

// ----- Profitability cube
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/reports/profitability", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await ensureFacts(me.orgId);
  const { period, scope } = parseQuery(req);
  const periods = periodsForScope(scope, period);
  const cube = buildCube(periods);
  // Pre-aggregated rollups by dimension.
  const rollup = (key: keyof CubeRow) => {
    const m = new Map<string, { dim: string; revenueGbp: number; directCostGbp: number; grossMarginGbp: number; engagementCount: number }>();
    for (const r of cube) {
      const k = String(r[key]);
      const cur = m.get(k) ?? { dim: k, revenueGbp: 0, directCostGbp: 0, grossMarginGbp: 0, engagementCount: 0 };
      cur.revenueGbp += r.revenueGbp;
      cur.directCostGbp += r.directCostGbp;
      cur.grossMarginGbp += r.grossMarginGbp;
      cur.engagementCount += 1;
      m.set(k, cur);
    }
    return Array.from(m.values()).map((x) => ({ ...x, grossMarginPct: pct(x.grossMarginGbp, x.revenueGbp) })).sort((a, b) => b.revenueGbp - a.revenueGbp);
  };
  res.json({
    period: period.id, scope, periodsCovered: periods.map((p) => p.id),
    rows: cube,
    byClient: rollup("client"),
    byPartner: rollup("partner"),
    bySector: rollup("sector"),
    byEngagementType: rollup("engagementType"),
  });
});

// ----- Board pack assembly
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/reports/board-pack", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await ensureFacts(me.orgId);
  const periodId = (req.query.period as string) ?? CURRENT_PERIOD.id;
  const period = periodById(periodId) ?? CURRENT_PERIOD;
  const ytdPeriods = periodsForScope("ytd", period);
  const pyPeriods = priorYearScope("ytd", period);

  // Consolidated PnL (YTD)
  const ytdPerEntity = entitiesIn(null).map((e) => {
    const local = aggregatePnl(ytdPeriods.map((p) => pnlLocal(e.id, p)));
    const budget = aggregatePnl(ytdPeriods.map((p) => pnlLocal(e.id, p, "budget")));
    const fcst = aggregatePnl(ytdPeriods.map((p) => pnlLocal(e.id, p, "forecast")));
    const py = aggregatePnl(pyPeriods.map((p) => pnlLocal(e.id, p)));
    return {
      actual: translatePnlToGbp(local, e.baseCurrency, period),
      budget: translatePnlToGbp(budget, e.baseCurrency, period),
      forecast: translatePnlToGbp(fcst, e.baseCurrency, period),
      priorYear: translatePnlToGbp(py, e.baseCurrency, period),
    };
  });
  const elimsPnl = aggregateElims(ytdPeriods);
  const sumK = (key: "actual" | "budget" | "forecast" | "priorYear") => {
    const s = aggregatePnl(ytdPerEntity.map((x) => x[key]));
    return { ...s, intercoRevenue: 0, intercoCost: 0, netRevenue: s.netRevenue - elimsPnl.intercoRevenueGbp };
  };
  const consPnl = { actual: sumK("actual"), budget: sumK("budget"), forecast: sumK("forecast"), priorYear: sumK("priorYear") };
  const v = buildPnlVariance(consPnl.actual, consPnl.budget, consPnl.forecast, consPnl.priorYear);
  const noData = pnlAllZero(consPnl);
  const commentary = noData ? [NO_FINANCIAL_DATA_NOTE] : buildPnlCommentary(v);

  // BS at period close
  const bsPerEntity = entitiesIn(null).map((e) => translateBsToGbp(bsLocal(e.id, period), e.baseCurrency, period, PROFILES[e.id]?.openingBalances.shareCapital ?? 0));
  const bsSum = sumBs(bsPerEntity);
  const elimsBs = computeEliminationsForPeriod(period);
  const consBs: BsLines = {
    ...bsSum,
    intercoAr: 0, intercoAp: 0, intercoLoanReceivable: 0, intercoLoanPayable: 0,
    totalAssets: bsSum.totalAssets - bsSum.intercoAr - bsSum.intercoLoanReceivable,
    totalLiabilities: bsSum.totalLiabilities - bsSum.intercoAp - bsSum.intercoLoanPayable,
    totalLiabilitiesAndEquity: 0,
  };
  consBs.totalLiabilitiesAndEquity = consBs.totalLiabilities + consBs.totalEquity;

  // CF YTD
  const cfPerEntity = entitiesIn(null).map((e) => {
    const agg = aggregateCf(ytdPeriods.map((p) => cfLocal(e.id, p)));
    const startBs = bsLocal(e.id, ytdPeriods[0]);
    const endBs = bsLocal(e.id, ytdPeriods[ytdPeriods.length - 1]);
    const adj: CfLines = { ...agg, openingCash: startBs.cash - agg.netChangeInCash, closingCash: endBs.cash };
    return translateCfToGbp(adj, e.baseCurrency, period);
  });
  const consCf = aggregateCf(cfPerEntity);

  // Profitability highlights
  const cube = buildCube(ytdPeriods);
  const top5Revenue = cube.slice().sort((a, b) => b.revenueGbp - a.revenueGbp).slice(0, 5);
  const bottom5Margin = cube.slice().sort((a, b) => a.grossMarginPct - b.grossMarginPct).slice(0, 5);

  res.json({
    period: period.id, periodLabel: period.label,
    presentationCurrency: "GBP",
    sections: [
      { id: "exec_summary", title: "Executive summary", commentary },
      { id: "pnl", title: "Consolidated P&L (YTD)", consolidated: consPnl, variance: v, eliminations: elimsPnl },
      { id: "bs", title: "Consolidated Balance Sheet", consolidated: consBs, eliminations: elimsBs },
      { id: "cf", title: "Consolidated Cash Flow (YTD)", consolidated: consCf },
      { id: "profitability", title: "Profitability cube — highlights", topRevenue: top5Revenue, bottomMargin: bottom5Margin },
      { id: "outlook", title: "Outlook & key risks", risks: deriveRisks(v, consBs) },
    ],
  });
});

function deriveRisks(v: PnlVariance, bs: BsLines): string[] {
  const out: string[] = [];
  if (v.ebitda.vsBudgetPct < -0.05) out.push(`EBITDA running ${signed(v.ebitda.vsBudgetPct)}% vs budget — review delivery margin and utilisation.`);
  if (v.netRevenue.vsForecastPct < -0.03) out.push(`Revenue trailing forecast by ${signed(v.netRevenue.vsForecastPct)}% — refresh pipeline conversion.`);
  if (bs.fctr < 0 && Math.abs(bs.fctr) / Math.max(1, bs.totalEquity) > 0.05) out.push(`FX translation reserve at ${bs.fctr.toLocaleString()} GBP — potential hedge review on AED/SAR exposure.`);
  if (bs.cash < bs.ap + bs.accruals) out.push("Cash below current operating obligations — monitor 13-week forecast.");
  if (out.length === 0) out.push("No material risks flagged this period.");
  return out;
}

// ----- Board pack PDF
// @cli-skip: binary PDF export stream; no CLI tool shape
router.get("/finance/reports/board-pack.pdf", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await ensureFacts(me.orgId);
  const periodId = (req.query.period as string) ?? CURRENT_PERIOD.id;
  const period = periodById(periodId) ?? CURRENT_PERIOD;
  // Reuse the JSON assembly inline.
  const ytdPeriods = periodsForScope("ytd", period);
  const pyPeriods = priorYearScope("ytd", period);
  const ytdPerEntity = entitiesIn(null).map((e) => ({
    e,
    actual: translatePnlToGbp(aggregatePnl(ytdPeriods.map((p) => pnlLocal(e.id, p))), e.baseCurrency, period),
    budget: translatePnlToGbp(aggregatePnl(ytdPeriods.map((p) => pnlLocal(e.id, p, "budget"))), e.baseCurrency, period),
    forecast: translatePnlToGbp(aggregatePnl(ytdPeriods.map((p) => pnlLocal(e.id, p, "forecast"))), e.baseCurrency, period),
    priorYear: translatePnlToGbp(aggregatePnl(pyPeriods.map((p) => pnlLocal(e.id, p))), e.baseCurrency, period),
  }));
  const elimsPnl = aggregateElims(ytdPeriods);
  const sumK = (key: "actual" | "budget" | "forecast" | "priorYear") => {
    const s = aggregatePnl(ytdPerEntity.map((x) => x[key]));
    return { ...s, intercoRevenue: 0, intercoCost: 0, netRevenue: s.netRevenue - elimsPnl.intercoRevenueGbp };
  };
  const consPnl = { actual: sumK("actual"), budget: sumK("budget"), forecast: sumK("forecast"), priorYear: sumK("priorYear") };
  const v = buildPnlVariance(consPnl.actual, consPnl.budget, consPnl.forecast, consPnl.priorYear);
  const noData = pnlAllZero(consPnl);
  const commentary = noData ? [NO_FINANCIAL_DATA_NOTE] : buildPnlCommentary(v);
  const bsPerEntity = entitiesIn(null).map((e) => translateBsToGbp(bsLocal(e.id, period), e.baseCurrency, period, PROFILES[e.id]?.openingBalances.shareCapital ?? 0));
  const bsSum = sumBs(bsPerEntity);
  const elimsBs = computeEliminationsForPeriod(period);
  const consBs: BsLines = {
    ...bsSum,
    intercoAr: 0, intercoAp: 0, intercoLoanReceivable: 0, intercoLoanPayable: 0,
    totalAssets: bsSum.totalAssets - bsSum.intercoAr - bsSum.intercoLoanReceivable,
    totalLiabilities: bsSum.totalLiabilities - bsSum.intercoAp - bsSum.intercoLoanPayable,
    totalLiabilitiesAndEquity: 0,
  };
  consBs.totalLiabilitiesAndEquity = consBs.totalLiabilities + consBs.totalEquity;
  const cfPerEntity = entitiesIn(null).map((e) => {
    const agg = aggregateCf(ytdPeriods.map((p) => cfLocal(e.id, p)));
    const startBs = bsLocal(e.id, ytdPeriods[0]);
    const endBs = bsLocal(e.id, ytdPeriods[ytdPeriods.length - 1]);
    const adj: CfLines = { ...agg, openingCash: startBs.cash - agg.netChangeInCash, closingCash: endBs.cash };
    return translateCfToGbp(adj, e.baseCurrency, period);
  });
  const consCf = aggregateCf(cfPerEntity);
  const cube = buildCube(ytdPeriods);
  const top5Revenue = cube.slice().sort((a, b) => b.revenueGbp - a.revenueGbp).slice(0, 5);
  const bottom5Margin = cube.slice().sort((a, b) => a.grossMarginPct - b.grossMarginPct).slice(0, 5);
  const risks = deriveRisks(v, consBs);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="board-pack-${period.id}.pdf"`);
  const doc = new PDFDocument({ size: "A4", margin: 56 });
  doc.pipe(res);

  const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (BOARD_PACK_LOGO) {
    doc.image(BOARD_PACK_LOGO, { width: 120 });
    doc.moveDown(0.8);
  }
  doc.fillColor("#000").fontSize(20).text("Cognirise Group — Board Pack", { align: "left" });
  doc.fontSize(12).fillColor("#666").text(`Period: ${period.label} · Presentation currency: GBP`);
  doc.moveDown(0.5);
  doc.fillColor("#000").fontSize(11).text(`Generated ${new Date().toISOString().slice(0, 10)} for ${me.name} (${me.role})`);
  doc.moveDown(1.5);

  doc.fontSize(14).text("1. Executive summary");
  doc.moveDown(0.3);
  doc.fontSize(10);
  for (const c of commentary) { doc.text(`• ${c}`); }
  doc.moveDown(1);

  doc.fontSize(14).text("2. Consolidated P&L (YTD, GBP)");
  doc.moveDown(0.3);
  doc.fontSize(9);
  const pnlRows: Array<[string, number, number, number, number]> = [
    ["Net revenue", consPnl.actual.netRevenue, consPnl.budget.netRevenue, consPnl.forecast.netRevenue, consPnl.priorYear.netRevenue],
    ["Direct cost", -consPnl.actual.directCost, -consPnl.budget.directCost, -consPnl.forecast.directCost, -consPnl.priorYear.directCost],
    ["Gross profit", consPnl.actual.grossProfit, consPnl.budget.grossProfit, consPnl.forecast.grossProfit, consPnl.priorYear.grossProfit],
    ["Payroll", -consPnl.actual.payroll, -consPnl.budget.payroll, -consPnl.forecast.payroll, -consPnl.priorYear.payroll],
    ["Opex", -consPnl.actual.opex, -consPnl.budget.opex, -consPnl.forecast.opex, -consPnl.priorYear.opex],
    ["EBITDA", consPnl.actual.ebitda, consPnl.budget.ebitda, consPnl.forecast.ebitda, consPnl.priorYear.ebitda],
    ["Depreciation", -consPnl.actual.depreciation, -consPnl.budget.depreciation, -consPnl.forecast.depreciation, -consPnl.priorYear.depreciation],
    ["EBIT", consPnl.actual.ebit, consPnl.budget.ebit, consPnl.forecast.ebit, consPnl.priorYear.ebit],
    ["Net income", consPnl.actual.netIncome, consPnl.budget.netIncome, consPnl.forecast.netIncome, consPnl.priorYear.netIncome],
  ];
  drawTable(doc, ["Line", "Actual", "Budget", "Forecast", "PY"], pnlRows.map((r) => [r[0], fmt(r[1]), fmt(r[2]), fmt(r[3]), fmt(r[4])]));
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor("#666").text(`Eliminations: IC revenue ${fmt(elimsPnl.intercoRevenueGbp)} netted against IC cost (zero net P&L impact).`);
  doc.fillColor("#000");

  doc.addPage();
  doc.fontSize(14).text("3. Consolidated Balance Sheet (period close, GBP)");
  doc.moveDown(0.3);
  drawTable(doc, ["Line", "Amount"], [
    ["Cash", fmt(consBs.cash)],
    ["AR", fmt(consBs.ar)],
    ["WIP", fmt(consBs.wip)],
    ["PP&E", fmt(consBs.ppe)],
    ["Intangible", fmt(consBs.intangible)],
    ["Total assets", fmt(consBs.totalAssets)],
    ["AP", fmt(consBs.ap)],
    ["Accruals", fmt(consBs.accruals)],
    ["Debt", fmt(consBs.debt)],
    ["Total liabilities", fmt(consBs.totalLiabilities)],
    ["Share capital", fmt(consBs.shareCapital)],
    ["Retained earnings", fmt(consBs.retainedEarnings)],
    ["FX translation reserve", fmt(consBs.fctr)],
    ["Total equity", fmt(consBs.totalEquity)],
    ["Total L&E", fmt(consBs.totalLiabilitiesAndEquity)],
  ]);
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor("#666").text(`IC eliminations: AR/AP ${fmt(elimsBs.intercoArGbp)} · IC loans ${fmt(elimsBs.intercoLoanGbp)}.`);
  doc.fillColor("#000");

  doc.moveDown(1);
  doc.fontSize(14).text("4. Consolidated Cash Flow (YTD, GBP)");
  doc.moveDown(0.3);
  drawTable(doc, ["Line", "Amount"], [
    ["Net income", fmt(consCf.netIncome)],
    ["Depreciation", fmt(consCf.depreciation)],
    ["Working capital change", fmt(consCf.workingCapitalChange)],
    ["Cash from operations", fmt(consCf.cashFromOps)],
    ["Capex", fmt(consCf.capex)],
    ["Cash from investing", fmt(consCf.cashFromInvesting)],
    ["Debt repayment", fmt(consCf.debtRepayment)],
    ["Cash from financing", fmt(consCf.cashFromFinancing)],
    ["Net change in cash", fmt(consCf.netChangeInCash)],
  ]);

  doc.addPage();
  doc.fontSize(14).text("5. Profitability — top 5 revenue / bottom 5 margin");
  doc.moveDown(0.3);
  doc.fontSize(11).text("Top 5 by revenue (YTD)");
  drawTable(doc, ["Engagement", "Client", "Partner", "Revenue", "GM%"],
    top5Revenue.map((r) => [r.engagementName.slice(0, 36), r.client, r.partner, fmt(r.revenueGbp), fmtPct(r.grossMarginPct)]));
  doc.moveDown(0.5);
  doc.fontSize(11).text("Bottom 5 by gross margin %");
  drawTable(doc, ["Engagement", "Client", "Partner", "Revenue", "GM%"],
    bottom5Margin.map((r) => [r.engagementName.slice(0, 36), r.client, r.partner, fmt(r.revenueGbp), fmtPct(r.grossMarginPct)]));

  doc.moveDown(1);
  doc.fontSize(14).text("6. Outlook & key risks");
  doc.moveDown(0.3);
  doc.fontSize(10);
  for (const r of risks) { doc.text(`• ${r}`); }

  doc.end();
});

function drawTable(doc: PDFKit.PDFDocument, headers: string[], rows: string[][]) {
  const startX = doc.x;
  const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / headers.length;
  doc.fontSize(9).fillColor("#666");
  let y = doc.y;
  headers.forEach((h, i) => doc.text(h, startX + i * colWidth, y, { width: colWidth - 4, align: i === 0 ? "left" : "right" }));
  y += 14;
  doc.moveTo(startX, y - 2).lineTo(startX + colWidth * headers.length, y - 2).strokeColor("#999").stroke();
  doc.fillColor("#000").fontSize(9);
  for (const row of rows) {
    row.forEach((c, i) => doc.text(c, startX + i * colWidth, y, { width: colWidth - 4, align: i === 0 ? "left" : "right" }));
    y += 13;
  }
  doc.x = startX;
  doc.y = y + 4;
}

// ----- Schedules (in-memory)
interface Schedule { id: string; name: string; cron: string; nextRunOn: string; recipients: string[]; enabled: boolean; createdBy: string; createdAt: string }
// Fabricated demo schedule removed per the no-demo-data policy.
const SCHEDULES: Schedule[] = [];
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/reports/schedules", (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  res.json({ items: SCHEDULES });
});
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/reports/schedules", (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  const body = (req.body ?? {}) as Partial<Schedule> & { id?: string };
  if (!body.id) {
    res.status(400).json({ error: "missing-id" });
    return;
  }
  const existing = SCHEDULES.findIndex((s) => s.id === body.id);
  if (existing >= 0) {
    SCHEDULES[existing] = { ...SCHEDULES[existing], ...body, id: SCHEDULES[existing].id };
    res.json({ item: SCHEDULES[existing] });
    return;
  }
  const created: Schedule = {
    id: body.id, name: body.name ?? "Untitled schedule", cron: body.cron ?? "0 8 5 * *",
    nextRunOn: body.nextRunOn ?? "2026-06-05", recipients: body.recipients ?? [],
    enabled: body.enabled ?? true, createdBy: me.name, createdAt: new Date().toISOString(),
  };
  SCHEDULES.push(created);
  res.json({ item: created });
});

export default router;
