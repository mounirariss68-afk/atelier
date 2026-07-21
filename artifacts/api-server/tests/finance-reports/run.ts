/**
 * Finance reports — pure GL statement math tests (Task #433).
 *
 * No DB needed: exercises classifyFlow/classifyStock, buildGlStatements,
 * buildPnlFromFlows/buildBsFromStocks/buildCfFromStocks and
 * computeWorkingCapital on synthetic aggregate rows, asserting the
 * accounting identities the routes rely on:
 *   1. Balance sheet balances by construction.
 *   2. Cash flow ties to the cash-account movement.
 *   3. Intercompany lines eliminate to zero on consolidation.
 *   4. Closed periods are stable: appending later journals never
 *      changes an earlier period's flows or closing stocks.
 */
import {
  classifyFlow,
  classifyStock,
  buildGlStatements,
  buildPnlFromFlows,
  buildBsFromStocks,
  buildCfFromStocks,
  computeWorkingCapital,
  zeroStocks,
  type GlAggRow,
} from "../../src/routes/atelier/financeGlStatements";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
function near(a: number, b: number, eps = 0.02): boolean { return Math.abs(a - b) <= eps; }

// ── 1. Classification ────────────────────────────────────────
console.log("classification");
check("revenue → grossRevenue", classifyFlow("revenue", "4000", "Consulting fees") === "grossRevenue");
check("IC revenue tagged", classifyFlow("revenue", "4900", "Intercompany management fees") === "intercoRevenue");
check("IC prefix tagged", classifyFlow("expense", "6900", "IC: shared services charge") === "intercoCost");
check("5xxx expense → directCost", classifyFlow("expense", "5100", "Subcontractor costs") === "directCost");
check("depreciation by name", classifyFlow("expense", "6400", "Depreciation expense") === "depreciation");
check("interest by name", classifyFlow("expense", "7100", "Interest expense") === "interestExpense");
check("corporate tax by name", classifyFlow("expense", "7900", "Corporate tax charge") === "tax");
check("payroll by name", classifyFlow("expense", "6100", "Salaries and wages") === "payroll");
check("fallback expense → opex", classifyFlow("expense", "6600", "Office rent") === "opex");
check("asset 10xx → cash", classifyStock("asset", "1000", "Main bank account") === "cash");
check("asset 12xx → wip", classifyStock("asset", "1200", "Unbilled WIP") === "wip");
check("asset ppe by name", classifyStock("asset", "1500", "Plant and equipment") === "ppe");
check("asset fallback → ar", classifyStock("asset", "1100", "Trade receivables") === "ar");
check("IC loan receivable", classifyStock("asset", "1800", "Intercompany loan to SaudiCo") === "intercoLoanReceivable");
check("liability 20xx → ap", classifyStock("liability", "2000", "Accounts payable") === "ap");
check("liability debt by name", classifyStock("liability", "2500", "Bank loan facility") === "debt");
check("liability fallback → accruals", classifyStock("liability", "2300", "Deferred revenue") === "accruals");
check("IC payable", classifyStock("liability", "2800", "Inter-company payable") === "intercoAp");
check("equity 30xx → shareCapital", classifyStock("equity", "3000", "Ordinary share capital") === "shareCapital");
check("equity fallback → otherEquity", classifyStock("equity", "3900", "Merger reserve") === "otherEquity");
check("revenue has no stock bucket", classifyStock("revenue", "4000", "Fees") === null);

// ── Synthetic journal aggregates for one entity, two months ──
// 2026-06: invoice 100k (AR/revenue), collect 60k, direct cost 30k on
// AP, pay 10k of AP, capital 50k cash-in, depreciation 5k.
const E = "ent_uk";
const rows: GlAggRow[] = [
  // June — P&L
  { entityId: E, periodLabel: "2026-06", accountCode: "4000", accountName: "Consulting fees", accountType: "revenue", debit: 0, credit: 100_000 },
  { entityId: E, periodLabel: "2026-06", accountCode: "5100", accountName: "Subcontractor costs", accountType: "expense", debit: 30_000, credit: 0 },
  { entityId: E, periodLabel: "2026-06", accountCode: "6400", accountName: "Depreciation expense", accountType: "expense", debit: 5_000, credit: 0 },
  // June — BS
  { entityId: E, periodLabel: "2026-06", accountCode: "1100", accountName: "Trade receivables", accountType: "asset", debit: 100_000, credit: 60_000 },
  { entityId: E, periodLabel: "2026-06", accountCode: "1000", accountName: "Main bank account", accountType: "asset", debit: 110_000, credit: 10_000 }, // 60 collect + 50 capital − 10 AP pay
  { entityId: E, periodLabel: "2026-06", accountCode: "1500", accountName: "Plant and equipment", accountType: "asset", debit: 0, credit: 5_000 }, // depreciation credit
  { entityId: E, periodLabel: "2026-06", accountCode: "2000", accountName: "Accounts payable", accountType: "liability", debit: 10_000, credit: 30_000 },
  { entityId: E, periodLabel: "2026-06", accountCode: "3000", accountName: "Ordinary share capital", accountType: "equity", debit: 0, credit: 50_000 },
  // July — more activity: bill 40k, collect 120k, opex 8k paid cash
  { entityId: E, periodLabel: "2026-07", accountCode: "4000", accountName: "Consulting fees", accountType: "revenue", debit: 0, credit: 40_000 },
  { entityId: E, periodLabel: "2026-07", accountCode: "6600", accountName: "Office rent", accountType: "expense", debit: 8_000, credit: 0 },
  { entityId: E, periodLabel: "2026-07", accountCode: "1100", accountName: "Trade receivables", accountType: "asset", debit: 40_000, credit: 120_000 },
  { entityId: E, periodLabel: "2026-07", accountCode: "1000", accountName: "Main bank account", accountType: "asset", debit: 120_000, credit: 8_000 },
];

console.log("buildGlStatements + statement math");
const stmts = buildGlStatements(rows, ["2026-05", "2026-06", "2026-07"]);
const ent = stmts[E];
check("entity present", !!ent && ent.hasJournals);
check("pre-journal period has zero stocks", JSON.stringify(ent.stocks["2026-05"]) === JSON.stringify(zeroStocks()));

// P&L June
const pnlJun = buildPnlFromFlows(ent.flows["2026-06"]);
check("June net revenue 100k", near(pnlJun.netRevenue, 100_000));
check("June net income 65k", near(pnlJun.netIncome, 65_000), `got ${pnlJun.netIncome}`);

// ── 2. BS balances by construction ───────────────────────────
for (const label of ["2026-06", "2026-07"]) {
  const bs = buildBsFromStocks(ent.stocks[label]);
  check(`${label} BS balances`, near(bs.totalAssets, bs.totalLiabilitiesAndEquity), `${bs.totalAssets} vs ${bs.totalLiabilitiesAndEquity}`);
  check(`${label} fctr is zero (local books)`, bs.fctr === 0);
}
const bsJun = buildBsFromStocks(ent.stocks["2026-06"]);
check("June cash 100k", near(bsJun.cash, 100_000), `got ${bsJun.cash}`);
check("June AR 40k", near(bsJun.ar, 40_000), `got ${bsJun.ar}`);
check("June AP 20k", near(bsJun.ap, 20_000), `got ${bsJun.ap}`);
check("June RE = cum NI 65k", near(bsJun.retainedEarnings, 65_000), `got ${bsJun.retainedEarnings}`);

// ── 3. CF ties to the cash movement ──────────────────────────
const cfJun = buildCfFromStocks(ent.stocks["2026-05"], ent.stocks["2026-06"], pnlJun);
check("June CF net change = Δcash", near(cfJun.netChangeInCash, bsJun.cash - 0));
check("June CF closes to BS cash", near(cfJun.closingCash, bsJun.cash));
check("June CF no residual", near(cfJun.fxOnCash, 0), `got ${cfJun.fxOnCash}`);
const pnlJul = buildPnlFromFlows(ent.flows["2026-07"]);
const cfJul = buildCfFromStocks(ent.stocks["2026-06"], ent.stocks["2026-07"], pnlJul);
const bsJul = buildBsFromStocks(ent.stocks["2026-07"]);
check("July CF ties: opening + net = closing", near(cfJul.openingCash + cfJul.netChangeInCash, bsJul.cash));
check("July CF no residual", near(cfJul.fxOnCash, 0), `got ${cfJul.fxOnCash}`);
check("July ops-only cash change 112k", near(cfJul.netChangeInCash, 112_000), `got ${cfJul.netChangeInCash}`);

// ── 4. Closed-period stability ───────────────────────────────
const laterRows: GlAggRow[] = [
  ...rows,
  { entityId: E, periodLabel: "2026-08", accountCode: "4000", accountName: "Consulting fees", accountType: "revenue", debit: 0, credit: 999_999 },
  { entityId: E, periodLabel: "2026-08", accountCode: "1100", accountName: "Trade receivables", accountType: "asset", debit: 999_999, credit: 0 },
];
const stmts2 = buildGlStatements(laterRows, ["2026-05", "2026-06", "2026-07", "2026-08"]);
check("closed June flows unchanged by later postings",
  JSON.stringify(stmts2[E].flows["2026-06"]) === JSON.stringify(ent.flows["2026-06"]));
check("closed June stocks unchanged by later postings",
  JSON.stringify(stmts2[E].stocks["2026-06"]) === JSON.stringify(ent.stocks["2026-06"]));
check("closed July stocks unchanged by later postings",
  JSON.stringify(stmts2[E].stocks["2026-07"]) === JSON.stringify(ent.stocks["2026-07"]));

// ── 5. Intercompany eliminates to zero across entities ───────
console.log("eliminations");
const A = "ent_a", B = "ent_b";
const icRows: GlAggRow[] = [
  { entityId: A, periodLabel: "2026-06", accountCode: "4900", accountName: "Intercompany management fees", accountType: "revenue", debit: 0, credit: 12_000 },
  { entityId: A, periodLabel: "2026-06", accountCode: "1700", accountName: "Intercompany receivable", accountType: "asset", debit: 12_000, credit: 0 },
  { entityId: B, periodLabel: "2026-06", accountCode: "6900", accountName: "Intercompany management fee charge", accountType: "expense", debit: 12_000, credit: 0 },
  { entityId: B, periodLabel: "2026-06", accountCode: "2800", accountName: "Intercompany payable", accountType: "liability", debit: 0, credit: 12_000 },
];
const icStmts = buildGlStatements(icRows, ["2026-06"]);
const icRev = icStmts[A].flows["2026-06"].intercoRevenue;
const icCost = icStmts[B].flows["2026-06"].intercoCost;
check("IC revenue = IC cost (nets to zero)", near(icRev, icCost) && icRev > 0, `${icRev} vs ${icCost}`);
const icAr = icStmts[A].stocks["2026-06"].intercoAr;
const icAp = icStmts[B].stocks["2026-06"].intercoAp;
check("IC AR = IC AP (nets to zero)", near(icAr, icAp) && icAr > 0, `${icAr} vs ${icAp}`);
// Consolidated group P&L net of eliminations: A's IC revenue − B's IC cost = 0 net impact.
const groupNet = buildPnlFromFlows(icStmts[A].flows["2026-06"]).netIncome + buildPnlFromFlows(icStmts[B].flows["2026-06"]).netIncome;
check("group net income unaffected by IC fee", near(groupNet, 0), `got ${groupNet}`);

// ── 6. Working-capital metrics ───────────────────────────────
console.log("working capital");
const wc = computeWorkingCapital({ ar: 90_000, wip: 30_000, ap: 45_000, revenue: 270_000, spend: 135_000, days: 90 });
check("DSO 30d", near(wc.dso ?? -1, 30), `got ${wc.dso}`);
check("WIP days 10d", near(wc.wipDays ?? -1, 10), `got ${wc.wipDays}`);
check("DPO 30d", near(wc.dpo ?? -1, 30), `got ${wc.dpo}`);
check("lockup 40d", near(wc.lockupDays ?? -1, 40), `got ${wc.lockupDays}`);
const wcZero = computeWorkingCapital({ ar: 10, wip: 0, ap: 5, revenue: 0, spend: 0, days: 30 });
check("zero revenue → null day metrics", wcZero.dso === null && wcZero.wipDays === null && wcZero.dpo === null && wcZero.lockupDays === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
