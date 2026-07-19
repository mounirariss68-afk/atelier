/**
 * Atelier — Finance Plan (FP&A) routes (Task #415, Wave 3).
 *
 * Two surfaces:
 *  1. /finance/plan/cash-13w  — direct-method 13-week cash forecast.
 *  2. /finance/plan/backlog   — signed backlog + weighted pipeline coverage.
 *
 * Both consume hand-curated demo seed (consistent with the Wave-1 entities
 * backbone in `financeEntitiesRoutes.ts`) — no GL / banking integrations
 * are in scope here. The 13-week engine buckets receipts and disbursements
 * into rolling weeks (Mon-anchored) starting from the most recent Monday,
 * translates to the requested presentation currency, and overlays a
 * per-entity min-cash policy and (where applicable) covenant line.
 *
 * Override / lock layer with audit trail backs the "treasurer can lock
 * or override a line" behaviour. Both the override state and the audit
 * trail are persisted to Postgres (atelier_cash_line_overrides +
 * atelier_cash_audit, see migration 0037) so locks and overrides survive
 * an API server restart and stay visible to all personas. The forecast
 * engine reads the overrides from a process-local cache that is hydrated
 * at module load and write-through-updated on POST /override.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, atelierUsers, atelierCashLineOverrides, atelierCashAudit, atelierFinancePlanCommits } from "@workspace/db";
import { ENTITIES_SEED } from "./financeEntitiesRoutes";
import { loadFinanceFacts, FIRM_ENTITY_ID } from "./financeRealFacts";
import { hydrateFpaFromFacts } from "./financePlanFpaEngine";
import {
  computeBudget as computeFpaBudget,
  computeHeadcount as computeFpaHeadcount,
  computeRenewals as computeFpaRenewals,
  computeBonus as computeFpaBonus,
  compareScenarios as compareFpaScenarios,
  SCENARIOS as FPA_SCENARIOS,
  getCommittedScenarioId,
  setCommittedScenarioId,
} from "./financePlanFpaEngine";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}
function denyRecruiter(me: Me, res: Response): boolean {
  if (me.role === "recruiter") {
    res.status(403).json({ error: "recruiter-scope" });
    return true;
  }
  return false;
}
function isFinanceLeadership(me: Me): boolean {
  return ["founding_partner", "partner", "finance", "senior_manager"].includes(me.role);
}

// ──────────────────────────────────────────────────────────────
// FX (presentation currency translation). Demo rates only.
// ──────────────────────────────────────────────────────────────
const FX_TO_USD: Record<string, number> = {
  USD: 1.0,
  GBP: 1.27,
  AED: 0.272,
  SAR: 0.267,
  EUR: 1.08,
};
function toUsd(amount: number, currency: string): number {
  const r = FX_TO_USD[currency] ?? 1;
  return amount * r;
}
function convert(amountUsd: number, target: string): number {
  const r = FX_TO_USD[target] ?? 1;
  return amountUsd / r;
}

// ──────────────────────────────────────────────────────────────
// Week bucketing (Monday-anchored, rolling 13 weeks from "as of").
// "As of" is fixed to 2026-05-11 (Monday before May 15) so the demo
// is deterministic — receipts / disbursements seeded against this
// fall predictably across the 13-week strip.
// ──────────────────────────────────────────────────────────────
// Anchor for the rolling 13-week strip. Defaults to the most recent Monday
// (UTC) so real AR/AP/payroll dates land inside the window; override at boot
// via ATELIER_PLAN_AS_OF=YYYY-MM-DD (must be a Monday) for deterministic tests.
const AS_OF_MONDAY: string = (() => {
  const env = process.env.ATELIER_PLAN_AS_OF;
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) {
    const d = new Date(`${env}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.getUTCDay() === 1) return env;
  }
  const now = new Date();
  const dow = now.getUTCDay() || 7; // Mon=1 … Sun=7
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (dow - 1)));
  return monday.toISOString().slice(0, 10);
})();

function dateAdd(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekIndexFor(iso: string): number {
  const ms = new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${AS_OF_MONDAY}T00:00:00Z`).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 7));
}
function weekStarts(): string[] {
  return Array.from({ length: 13 }, (_, i) => dateAdd(AS_OF_MONDAY, i * 7));
}

// ──────────────────────────────────────────────────────────────
// Entities — derived from the Wave-1 entities backbone
// (financeEntitiesRoutes.ENTITIES_SEED). The plan layer adds an
// overlay of opening cash balance, min-cash policy and covenant
// floor per entity, so id, shortName, baseCurrency stay in sync
// with the rest of the Finance lens.
// ──────────────────────────────────────────────────────────────
interface PlanEntity {
  id: string;
  shortName: string;
  baseCurrency: string;
  openingBalanceLocal: number;
  minCashPolicyLocal: number;
  covenantFloorLocal: number | null;
}
// Fabricated demo cash overlay removed per the no-demo-data policy; entities
// fall back to zero opening balance and no policy lines.
const PLAN_OVERLAY: Record<string, { openingBalanceLocal: number; minCashPolicyLocal: number; covenantFloorLocal: number | null }> = {};
const ENTITIES: PlanEntity[] = ENTITIES_SEED.map((e) => {
  const o = PLAN_OVERLAY[e.id] ?? { openingBalanceLocal: 0, minCashPolicyLocal: 0, covenantFloorLocal: null };
  return {
    id: e.id,
    shortName: e.shortName,
    baseCurrency: e.baseCurrency,
    openingBalanceLocal: o.openingBalanceLocal,
    minCashPolicyLocal: o.minCashPolicyLocal,
    covenantFloorLocal: o.covenantFloorLocal,
  };
});

// ──────────────────────────────────────────────────────────────
// Cash-line primitives (receipts + disbursements).
// ──────────────────────────────────────────────────────────────
type ReceiptSource = "open_ar" | "milestone" | "other";
type DisbursementCategory = "payroll" | "vendor" | "tax_vat" | "tax_ct" | "lease" | "debt_service" | "other";

interface CashLine {
  id: string;
  entityId: string;
  currency: string;
  amount: number; // positive
  expectedDate: string; // ISO
  confidence: "high" | "medium" | "low";
  label: string;
  detail?: string;
}
interface ReceiptLine extends CashLine { source: ReceiptSource; counterparty: string }
interface DisbursementLine extends CashLine { category: DisbursementCategory; vendor: string }

// Cash lines are hydrated from real records on every request (short-TTL
// cached in financeRealFacts): open AR on issued invoices + earned revenue
// milestones (receipts); roster payroll, unpaid contractor payments and
// approved-unreimbursed expenses (disbursements). See Task #177.
const RECEIPTS: ReceiptLine[] = [];
const DISBURSEMENTS: DisbursementLine[] = [];

async function hydratePlanFacts(orgId: string): Promise<void> {
  const facts = await loadFinanceFacts(orgId);
  RECEIPTS.length = 0;
  RECEIPTS.push(...facts.receipts);
  DISBURSEMENTS.length = 0;
  DISBURSEMENTS.push(...facts.disbursements);
  BACKLOG.length = 0;
  BACKLOG.push(...facts.backlog);
  PIPELINE.length = 0;
  PIPELINE.push(...facts.pipeline);
  // Firm pseudo-entity: opening cash = cumulative real receipts − payouts.
  const openingUsd = facts.balances.cashCollectedUsd - facts.balances.cashPaidOutUsd;
  const firm: PlanEntity = {
    id: FIRM_ENTITY_ID,
    shortName: "Cognirise",
    baseCurrency: "USD",
    openingBalanceLocal: Math.round(openingUsd),
    minCashPolicyLocal: 0,
    covenantFloorLocal: null,
  };
  const idx = ENTITIES.findIndex((e) => e.id === FIRM_ENTITY_ID);
  if (idx >= 0) ENTITIES[idx] = firm; else ENTITIES.push(firm);
  hydrateFpaFromFacts(facts);
}

// ──────────────────────────────────────────────────────────────
// Tax disbursements — derived from each entity's fiscal calendar
// (ENTITIES_SEED.fiscal.nextVatFiling / nextCtFiling). For monthly
// VAT entities we project the following month's filing too so it
// lands inside the 13-week window.
// ──────────────────────────────────────────────────────────────
const VAT_AUTHORITY: Record<string, string> = { GB: "HMRC", SA: "ZATCA", AE: "FTA" };
// Fabricated demo VAT amounts removed per the no-demo-data policy.
const VAT_AMOUNT_LOCAL: Record<string, number> = {};
// Fabricated demo corporate-tax amounts removed per the no-demo-data policy.
const CT_AMOUNT_LOCAL: Record<string, number> = {};
function nextMonthSameDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const m = d.getUTCMonth();
  d.setUTCMonth(m + 1);
  return d.toISOString().slice(0, 10);
}
const TAX_DISBURSEMENTS: DisbursementLine[] = (() => {
  const out: DisbursementLine[] = [];
  for (const e of ENTITIES_SEED) {
    const vatAmt = VAT_AMOUNT_LOCAL[e.id] ?? 0;
    if (vatAmt > 0 && e.fiscal.nextVatFiling) {
      out.push({
        id: `dis_tax_vat_${e.id}_1`, entityId: e.id, currency: e.baseCurrency, amount: vatAmt,
        expectedDate: e.fiscal.nextVatFiling, confidence: "high", category: "tax_vat",
        label: `VAT filing — ${VAT_AUTHORITY[e.country] ?? "tax authority"} (${e.shortName})`,
        vendor: VAT_AUTHORITY[e.country] ?? "Tax authority",
      });
      if (e.fiscal.vatPeriod === "monthly") {
        out.push({
          id: `dis_tax_vat_${e.id}_2`, entityId: e.id, currency: e.baseCurrency, amount: vatAmt,
          expectedDate: nextMonthSameDay(e.fiscal.nextVatFiling), confidence: "high", category: "tax_vat",
          label: `VAT filing (next month) — ${VAT_AUTHORITY[e.country] ?? "tax authority"} (${e.shortName})`,
          vendor: VAT_AUTHORITY[e.country] ?? "Tax authority",
        });
      }
    }
    const ctAmt = CT_AMOUNT_LOCAL[e.id] ?? 0;
    if (ctAmt > 0 && e.fiscal.nextCtFiling) {
      out.push({
        id: `dis_tax_ct_${e.id}`, entityId: e.id, currency: e.baseCurrency, amount: ctAmt,
        expectedDate: e.fiscal.nextCtFiling, confidence: "medium", category: "tax_ct",
        label: `Corporate tax filing (${e.shortName})`,
        vendor: VAT_AUTHORITY[e.country] ?? "Tax authority",
      });
    }
  }
  return out;
})();
DISBURSEMENTS.push(...TAX_DISBURSEMENTS);

// ──────────────────────────────────────────────────────────────
// Override / lock layer (in-memory). lineId → override.
// ──────────────────────────────────────────────────────────────
interface Override {
  lineId: string;
  lockedAmount?: number;  // overrides forecast amount (in the line's local currency)
  lockedDate?: string;    // overrides expected date
  locked: boolean;        // true → engine must not re-forecast this line
  note: string;
  byUserId: string;
  byUserName: string;
  byRole: string;
  at: string;
}
interface AuditEntry {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  payload: Record<string, unknown>;
}
// In-memory cache of overrides, hydrated from Postgres at module load and
// kept in sync via write-through on POST /override. The forecast engine
// reads this cache synchronously (resolveLine), so writes must update both
// the database (for restart-survival + cross-process visibility) and the
// cache (so the next computeForecast call sees the change).
const OVERRIDES = new Map<string, Override>();

function rowToOverride(r: typeof atelierCashLineOverrides.$inferSelect): Override {
  return {
    lineId: r.lineId,
    lockedAmount: r.lockedAmount ?? undefined,
    lockedDate: r.lockedDate ?? undefined,
    locked: r.locked,
    note: r.note ?? "",
    byUserId: r.byUserId,
    byUserName: r.byUserName,
    byRole: r.byRole,
    at: (r.at instanceof Date ? r.at : new Date(r.at)).toISOString(),
  };
}

let hydrationPromise: Promise<void> | null = null;
function ensureHydrated(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      try {
        const rows = await db.select().from(atelierCashLineOverrides);
        OVERRIDES.clear();
        for (const r of rows) OVERRIDES.set(r.lineId, rowToOverride(r));
      } catch (err) {
        // Reset so a later request can retry hydration if the DB was
        // transiently unavailable at boot.
        hydrationPromise = null;
        throw err;
      }
    })();
  }
  return hydrationPromise;
}
// Kick off hydration eagerly; the promise is awaited by handlers too.
void ensureHydrated().catch((err) => {
  console.error("[financePlanRoutes] failed to hydrate cash overrides:", err);
});

// ──────────────────────────────────────────────────────────────
// Committed FP&A scenario — hydrated from atelier_finance_plan_commits.
// Most recent row wins. The engine's getCommittedScenarioId() ref is
// kept in sync so any caller (variance reporters, budget page) can read
// the committed id synchronously.
// ──────────────────────────────────────────────────────────────
let commitsHydration: Promise<void> | null = null;
function ensureCommitsHydrated(): Promise<void> {
  if (!commitsHydration) {
    commitsHydration = (async () => {
      try {
        const rows = await db
          .select()
          .from(atelierFinancePlanCommits)
          .orderBy(desc(atelierFinancePlanCommits.committedAt))
          .limit(1);
        // Map sentinel "uncommit" rows back to null explicitly so the engine ref
        // stays in sync without relying on setCommittedScenarioId's unknown-id
        // rejection as a side effect.
        const latestId = rows[0]?.scenarioId ?? null;
        setCommittedScenarioId(latestId === UNCOMMIT_SENTINEL ? null : latestId);
      } catch (err) {
        commitsHydration = null;
        throw err;
      }
    })();
  }
  return commitsHydration;
}
void ensureCommitsHydrated().catch((err) => {
  console.error("[financePlanRoutes] failed to hydrate plan commits:", err);
});

// Sentinel scenarioId used when finance leadership explicitly clears the
// committed forecast (DELETE /finance/plan/scenarios/commit). Stored as a
// row in atelier_finance_plan_commits so the audit trail captures both
// commit and uncommit events; treated as "no current commit" by the
// engine + readers.
const UNCOMMIT_SENTINEL = "__uncommitted__";
const UNCOMMIT_LABEL = "Forecast unlocked";

// Window (in days) within which a follow-on commit/uncommit is treated
// as "churn" and visually flagged on the audit trail. Mid-period CFO
// flips inside this window almost always warrant a variance note.
export const COMMIT_CHURN_DAYS = 14;

async function readCommitHistory(limit = 50) {
  const rows = await db
    .select()
    .from(atelierFinancePlanCommits)
    .orderBy(desc(atelierFinancePlanCommits.committedAt))
    .limit(limit);
  // rows are ordered newest → oldest. A row is "superseded with churn"
  // when the *next* (newer) commit/uncommit landed within COMMIT_CHURN_DAYS.
  return rows.map((r, i) => {
    const at = r.committedAt instanceof Date ? r.committedAt : new Date(r.committedAt);
    const newer = i > 0 ? rows[i - 1] : null;
    let supersededByKind: "commit" | "uncommit" | null = null;
    let supersededWithinDays: number | null = null;
    if (newer) {
      const newerAt = newer.committedAt instanceof Date ? newer.committedAt : new Date(newer.committedAt);
      const days = Math.max(0, Math.floor((newerAt.getTime() - at.getTime()) / (1000 * 60 * 60 * 24)));
      supersededWithinDays = days;
      supersededByKind = newer.scenarioId === UNCOMMIT_SENTINEL ? "uncommit" : "commit";
    }
    const isUncommit = r.scenarioId === UNCOMMIT_SENTINEL;
    return {
      id: r.id,
      kind: (isUncommit ? "uncommit" : "commit") as "commit" | "uncommit",
      scenarioId: isUncommit ? null : r.scenarioId,
      scenarioLabel: isUncommit ? UNCOMMIT_LABEL : r.scenarioLabel,
      periodLabel: r.periodLabel ?? "",
      note: r.note ?? "",
      byUserId: r.byUserId,
      byUserName: r.byUserName,
      byRole: r.byRole,
      committedAt: at.toISOString(),
      supersededByKind,
      supersededWithinDays,
      churn: supersededWithinDays != null && supersededWithinDays <= COMMIT_CHURN_DAYS,
    };
  });
}

interface CommitInfo {
  scenarioId: string;
  scenarioLabel: string;
  periodLabel: string;
  note: string;
  byUserName: string;
  byRole: string;
  committedAt: string;
}
async function readCurrentCommit(): Promise<CommitInfo | null> {
  await ensureCommitsHydrated();
  const id = getCommittedScenarioId();
  if (!id) return null;
  const rows = await db
    .select()
    .from(atelierFinancePlanCommits)
    .orderBy(desc(atelierFinancePlanCommits.committedAt))
    .limit(1);
  const r = rows[0];
  if (!r || r.scenarioId === UNCOMMIT_SENTINEL) return null;
  return {
    scenarioId: r.scenarioId,
    scenarioLabel: r.scenarioLabel,
    periodLabel: r.periodLabel ?? "",
    note: r.note ?? "",
    byUserName: r.byUserName,
    byRole: r.byRole,
    committedAt: (r.committedAt instanceof Date ? r.committedAt : new Date(r.committedAt)).toISOString(),
  };
}

async function persistAudit(actor: string, action: string, target: string, payload: Record<string, unknown>) {
  const id = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  await db.insert(atelierCashAudit).values({ id, actor, action, target, payload });
}

// ──────────────────────────────────────────────────────────────
// Cash forecast engine
// ──────────────────────────────────────────────────────────────
type Direction = "in" | "out";
interface ResolvedLine {
  id: string;
  direction: Direction;
  weekIndex: number;
  weekStart: string;
  entityId: string;
  currency: string;
  amount: number;          // local
  amountUsd: number;       // converted
  amountInPresentation: number;
  source?: ReceiptSource;
  category?: DisbursementCategory;
  counterparty?: string;
  vendor?: string;
  label: string;
  detail?: string;
  confidence: "high" | "medium" | "low";
  expectedDate: string;
  locked: boolean;
  override?: Override;
}

function resolveLine<T extends CashLine>(line: T, direction: Direction, presentation: string): ResolvedLine | null {
  const ovr = OVERRIDES.get(line.id);
  const amount = ovr?.lockedAmount ?? line.amount;
  const expectedDate = ovr?.lockedDate ?? line.expectedDate;
  const wi = weekIndexFor(expectedDate);
  if (wi < 0 || wi > 12) return null;
  const usd = toUsd(amount, line.currency);
  return {
    id: line.id, direction, weekIndex: wi, weekStart: dateAdd(AS_OF_MONDAY, wi * 7),
    entityId: line.entityId, currency: line.currency, amount, amountUsd: usd,
    amountInPresentation: convert(usd, presentation),
    counterparty: (line as ReceiptLine).counterparty, vendor: (line as DisbursementLine).vendor,
    source: (line as ReceiptLine).source, category: (line as DisbursementLine).category,
    label: line.label, detail: line.detail, confidence: line.confidence,
    expectedDate, locked: !!ovr?.locked, override: ovr ?? undefined,
  };
}

interface WeekRollup {
  weekIndex: number;
  weekStart: string;
  openingBalance: number;
  expectedIn: number;
  expectedOut: number;
  netMovement: number;
  closingBalance: number;
  inBySource: Record<ReceiptSource, number>;
  outByCategory: Record<DisbursementCategory, number>;
  belowMinCash: boolean;
  belowCovenant: boolean;
  lines: ResolvedLine[];
}
interface ForecastResp {
  asOf: string;
  presentationCurrency: string;
  entityFilter: string | null;
  consolidated: boolean;
  openingBalance: number;
  minCashLine: number;
  covenantLine: number | null;
  weeks: WeekRollup[];
  breaches: { weekIndex: number; kind: "min_cash" | "covenant"; gapAmount: number }[];
  topReceipts: ResolvedLine[];
  topDisbursements: ResolvedLine[];
  daysOfCash: number; // closing-week-0 balance / avg weekly disbursements * 7
  totalIn: number;
  totalOut: number;
}

function computeForecast(presentation: string, entityFilter: string | null): ForecastResp {
  const entities = entityFilter ? ENTITIES.filter((e) => e.id === entityFilter) : ENTITIES;
  // Opening
  const openingUsd = entities.reduce((s, e) => s + toUsd(e.openingBalanceLocal, e.baseCurrency), 0);
  const opening = convert(openingUsd, presentation);
  const minCashUsd = entities.reduce((s, e) => s + toUsd(e.minCashPolicyLocal, e.baseCurrency), 0);
  const minCash = convert(minCashUsd, presentation);
  const covenantUsd = entities.reduce((s, e) => s + (e.covenantFloorLocal != null ? toUsd(e.covenantFloorLocal, e.baseCurrency) : 0), 0);
  const hasCovenant = entities.some((e) => e.covenantFloorLocal != null);
  const covenant = hasCovenant ? convert(covenantUsd, presentation) : null;

  const inLines = RECEIPTS
    .filter((r) => !entityFilter || r.entityId === entityFilter)
    .map((r) => resolveLine(r, "in", presentation))
    .filter((x): x is ResolvedLine => x !== null);
  const outLines = DISBURSEMENTS
    .filter((d) => !entityFilter || d.entityId === entityFilter)
    .map((d) => resolveLine(d, "out", presentation))
    .filter((x): x is ResolvedLine => x !== null);

  const weeks: WeekRollup[] = weekStarts().map((ws, i) => ({
    weekIndex: i, weekStart: ws,
    openingBalance: 0, expectedIn: 0, expectedOut: 0, netMovement: 0, closingBalance: 0,
    inBySource: { open_ar: 0, milestone: 0, other: 0 },
    outByCategory: { payroll: 0, vendor: 0, tax_vat: 0, tax_ct: 0, lease: 0, debt_service: 0, other: 0 },
    belowMinCash: false, belowCovenant: false, lines: [],
  }));

  for (const l of inLines) {
    const w = weeks[l.weekIndex]; w.expectedIn += l.amountInPresentation;
    if (l.source) w.inBySource[l.source] += l.amountInPresentation;
    w.lines.push(l);
  }
  for (const l of outLines) {
    const w = weeks[l.weekIndex]; w.expectedOut += l.amountInPresentation;
    if (l.category) w.outByCategory[l.category] += l.amountInPresentation;
    w.lines.push(l);
  }

  let running = opening;
  const breaches: ForecastResp["breaches"] = [];
  for (const w of weeks) {
    w.openingBalance = running;
    w.netMovement = w.expectedIn - w.expectedOut;
    w.closingBalance = w.openingBalance + w.netMovement;
    w.belowMinCash = w.closingBalance < minCash;
    w.belowCovenant = covenant != null && w.closingBalance < covenant;
    if (w.belowMinCash) breaches.push({ weekIndex: w.weekIndex, kind: "min_cash", gapAmount: minCash - w.closingBalance });
    if (w.belowCovenant) breaches.push({ weekIndex: w.weekIndex, kind: "covenant", gapAmount: (covenant ?? 0) - w.closingBalance });
    running = w.closingBalance;
  }

  const totalIn = weeks.reduce((s, w) => s + w.expectedIn, 0);
  const totalOut = weeks.reduce((s, w) => s + w.expectedOut, 0);
  const avgWeeklyOut = totalOut / 13;
  const daysOfCash = avgWeeklyOut > 0 ? Math.round((opening / avgWeeklyOut) * 7) : 999;

  const topReceipts = [...inLines].sort((a, b) => b.amountInPresentation - a.amountInPresentation).slice(0, 5);
  const topDisbursements = [...outLines].sort((a, b) => b.amountInPresentation - a.amountInPresentation).slice(0, 5);

  return {
    asOf: AS_OF_MONDAY, presentationCurrency: presentation,
    entityFilter, consolidated: !entityFilter,
    openingBalance: opening, minCashLine: minCash, covenantLine: covenant,
    weeks, breaches, topReceipts, topDisbursements,
    daysOfCash, totalIn, totalOut,
  };
}

// ──────────────────────────────────────────────────────────────
// Backlog & pipeline
// ──────────────────────────────────────────────────────────────
interface BacklogContract {
  id: string;
  client: string;
  sector: string;
  partnerOwner: string;
  entityId: string;
  currency: string;
  signedTotalLocal: number;
  recognisedToDateLocal: number;
  remainingLocal: number;       // signed backlog
  expectedBurnPerQuarterLocal: number;
  endsOn: string;
}
interface PipelineDeal {
  id: string;
  name: string;
  client: string;
  sector: string;
  partnerOwner: string;
  entityId: string;
  currency: string;
  acvLocal: number;
  stage: "discover" | "qualify" | "shape" | "propose" | "negotiate" | "verbal";
  stageProbability: number;     // 0..1
  expectedClose: string;
}
interface RevenuePlan {
  quarterLabel: string;        // "Q3 2026"
  startsOn: string;
  endsOn: string;
  planUsd: number;
}

// Fabricated demo backlog removed per the no-demo-data policy.
const BACKLOG: BacklogContract[] = [];
// Fabricated demo pipeline removed per the no-demo-data policy.
const PIPELINE: PipelineDeal[] = [];
// Fabricated demo revenue plan removed per the no-demo-data policy.
const REVENUE_PLAN: RevenuePlan[] = [];

interface BacklogResp {
  asOf: string;
  presentationCurrency: string;
  entityFilter: string | null;
  totals: {
    backlogUsd: number;
    weightedPipelineUsd: number;
    backlogPlusWeightedUsd: number;
    next2qPlanUsd: number;
    coverageRatio: number;        // backlog+weighted / next-2q plan
    backlogCoverageMonths: number;// remaining backlog / monthly burn
  };
  byEntity: { entityId: string; entityName: string; backlogUsd: number; weightedUsd: number }[];
  bySector: { sector: string; backlogUsd: number; weightedUsd: number }[];
  byPartner: { partner: string; backlogUsd: number; weightedUsd: number }[];
  byStage: { stage: string; weightedUsd: number; rawUsd: number; count: number }[];
  topDeals: { id: string; name: string; client: string; partner: string; stage: string; rawUsd: number; weightedUsd: number; expectedClose: string }[];
  contracts: { id: string; client: string; sector: string; partner: string; entityId: string; remainingUsd: number; endsOn: string; quartersOfRunway: number }[];
  revenuePlan: RevenuePlan[];
  targetCoverage: number;          // 3.0×
}
function computeBacklog(presentation: string, entityFilter: string | null): BacklogResp {
  const ENTITY_NAME: Record<string, string> = Object.fromEntries(ENTITIES.map((e) => [e.id, e.shortName]));
  const contracts = BACKLOG.filter((b) => !entityFilter || b.entityId === entityFilter);
  const deals = PIPELINE.filter((p) => !entityFilter || p.entityId === entityFilter);

  const remainingUsd = (b: BacklogContract) => toUsd(b.remainingLocal, b.currency);
  const burnUsd      = (b: BacklogContract) => toUsd(b.expectedBurnPerQuarterLocal, b.currency);
  const acvUsd       = (p: PipelineDeal)    => toUsd(p.acvLocal, p.currency);

  const backlogUsd = contracts.reduce((s, b) => s + remainingUsd(b), 0);
  const weightedUsd = deals.reduce((s, d) => s + acvUsd(d) * d.stageProbability, 0);
  const next2qPlanUsd = REVENUE_PLAN.reduce((s, q) => s + q.planUsd, 0);
  const burn = contracts.reduce((s, b) => s + burnUsd(b), 0);
  const monthlyBurn = burn / 3;

  const byEntity = Object.values(
    contracts.reduce<Record<string, { entityId: string; entityName: string; backlogUsd: number; weightedUsd: number }>>(
      (acc, b) => {
        const k = b.entityId;
        acc[k] = acc[k] ?? { entityId: k, entityName: ENTITY_NAME[k] ?? k, backlogUsd: 0, weightedUsd: 0 };
        acc[k].backlogUsd += remainingUsd(b);
        return acc;
      }, {}),
  );
  for (const d of deals) {
    const k = d.entityId;
    let row = byEntity.find((r) => r.entityId === k);
    if (!row) { row = { entityId: k, entityName: ENTITY_NAME[k] ?? k, backlogUsd: 0, weightedUsd: 0 }; byEntity.push(row); }
    row.weightedUsd += acvUsd(d) * d.stageProbability;
  }

  const bucket = <T>(items: T[], keyFn: (t: T) => string, valFn: (t: T, kind: "b" | "w") => number, kind: "b" | "w") => {
    const out: Record<string, { key: string; backlogUsd: number; weightedUsd: number }> = {};
    for (const it of items) {
      const k = keyFn(it);
      out[k] = out[k] ?? { key: k, backlogUsd: 0, weightedUsd: 0 };
      const v = valFn(it, kind);
      if (kind === "b") out[k].backlogUsd += v; else out[k].weightedUsd += v;
    }
    return out;
  };
  const sectorMap = bucket(contracts, (b) => b.sector, (b) => remainingUsd(b), "b");
  for (const d of deals) {
    const k = d.sector;
    sectorMap[k] = sectorMap[k] ?? { key: k, backlogUsd: 0, weightedUsd: 0 };
    sectorMap[k].weightedUsd += acvUsd(d) * d.stageProbability;
  }
  const partnerMap = bucket(contracts, (b) => b.partnerOwner, (b) => remainingUsd(b), "b");
  for (const d of deals) {
    const k = d.partnerOwner;
    partnerMap[k] = partnerMap[k] ?? { key: k, backlogUsd: 0, weightedUsd: 0 };
    partnerMap[k].weightedUsd += acvUsd(d) * d.stageProbability;
  }

  const stageMap: Record<string, { stage: string; weightedUsd: number; rawUsd: number; count: number }> = {};
  for (const d of deals) {
    stageMap[d.stage] = stageMap[d.stage] ?? { stage: d.stage, weightedUsd: 0, rawUsd: 0, count: 0 };
    stageMap[d.stage].rawUsd += acvUsd(d);
    stageMap[d.stage].weightedUsd += acvUsd(d) * d.stageProbability;
    stageMap[d.stage].count += 1;
  }

  const topDeals = [...deals]
    .map((d) => ({
      id: d.id, name: d.name, client: d.client, partner: d.partnerOwner, stage: d.stage,
      rawUsd: acvUsd(d), weightedUsd: acvUsd(d) * d.stageProbability, expectedClose: d.expectedClose,
    }))
    .sort((a, b) => b.weightedUsd - a.weightedUsd)
    .slice(0, 5);

  const contractRows = contracts.map((b) => ({
    id: b.id, client: b.client, sector: b.sector, partner: b.partnerOwner, entityId: b.entityId,
    remainingUsd: remainingUsd(b), endsOn: b.endsOn,
    quartersOfRunway: burnUsd(b) > 0 ? Math.round((remainingUsd(b) / burnUsd(b)) * 10) / 10 : 0,
  })).sort((a, b) => b.remainingUsd - a.remainingUsd);

  const presentScale = (usd: number) => convert(usd, presentation);
  return {
    asOf: AS_OF_MONDAY, presentationCurrency: presentation, entityFilter,
    totals: {
      backlogUsd: presentScale(backlogUsd),
      weightedPipelineUsd: presentScale(weightedUsd),
      backlogPlusWeightedUsd: presentScale(backlogUsd + weightedUsd),
      next2qPlanUsd: presentScale(next2qPlanUsd),
      coverageRatio: next2qPlanUsd > 0 ? Math.round(((backlogUsd + weightedUsd) / next2qPlanUsd) * 100) / 100 : 0,
      backlogCoverageMonths: monthlyBurn > 0 ? Math.round((backlogUsd / monthlyBurn) * 10) / 10 : 0,
    },
    byEntity: byEntity.map((r) => ({ ...r, backlogUsd: presentScale(r.backlogUsd), weightedUsd: presentScale(r.weightedUsd) }))
      .sort((a, b) => (b.backlogUsd + b.weightedUsd) - (a.backlogUsd + a.weightedUsd)),
    bySector: Object.values(sectorMap).map((r) => ({ sector: r.key, backlogUsd: presentScale(r.backlogUsd), weightedUsd: presentScale(r.weightedUsd) }))
      .sort((a, b) => (b.backlogUsd + b.weightedUsd) - (a.backlogUsd + a.weightedUsd)),
    byPartner: Object.values(partnerMap).map((r) => ({ partner: r.key, backlogUsd: presentScale(r.backlogUsd), weightedUsd: presentScale(r.weightedUsd) }))
      .sort((a, b) => (b.backlogUsd + b.weightedUsd) - (a.backlogUsd + a.weightedUsd)),
    byStage: Object.values(stageMap).map((r) => ({ ...r, weightedUsd: presentScale(r.weightedUsd), rawUsd: presentScale(r.rawUsd) })),
    topDeals: topDeals.map((d) => ({ ...d, rawUsd: presentScale(d.rawUsd), weightedUsd: presentScale(d.weightedUsd) })),
    contracts: contractRows.map((c) => ({ ...c, remainingUsd: presentScale(c.remainingUsd) })),
    revenuePlan: REVENUE_PLAN.map((q) => ({ ...q, planUsd: presentScale(q.planUsd) })),
    targetCoverage: 3.0,
  };
}

// ──────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────
function pickPresentation(req: Request): string {
  const c = String(req.query.currency ?? "USD").toUpperCase();
  return FX_TO_USD[c] ? c : "USD";
}
function pickEntity(req: Request): string | null {
  const e = req.query.entity ? String(req.query.entity) : null;
  if (!e || e === "consolidated" || e === "all") return null;
  return ENTITIES.some((x) => x.id === e) ? e : null;
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/cash-13w", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await Promise.all([ensureHydrated(), hydratePlanFacts(me.orgId)]);
  const out = computeForecast(pickPresentation(req), pickEntity(req));
  res.json(out);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/cash-13w/lines", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await Promise.all([ensureHydrated(), hydratePlanFacts(me.orgId)]);
  const presentation = pickPresentation(req);
  const ef = pickEntity(req);
  const inLines = RECEIPTS.filter((r) => !ef || r.entityId === ef)
    .map((r) => resolveLine(r, "in", presentation)).filter((x): x is ResolvedLine => x !== null);
  const outLines = DISBURSEMENTS.filter((d) => !ef || d.entityId === ef)
    .map((d) => resolveLine(d, "out", presentation)).filter((x): x is ResolvedLine => x !== null);
  res.json({ receipts: inLines, disbursements: outLines, asOf: AS_OF_MONDAY, presentationCurrency: presentation });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/plan/cash-13w/override", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!isFinanceLeadership(me)) {
    return res.status(403).json({ error: "forbidden", message: "Treasurer / finance / partner only." });
  }
  const body = req.body as { lineId?: string; lockedAmount?: number; lockedDate?: string; locked?: boolean; note?: string; clear?: boolean };
  if (!body?.lineId || typeof body.lineId !== "string") {
    return res.status(400).json({ error: "invalid", message: "lineId required" });
  }
  const exists = RECEIPTS.some((r) => r.id === body.lineId) || DISBURSEMENTS.some((d) => d.id === body.lineId);
  if (!exists) return res.status(404).json({ error: "not-found", message: "line not found" });
  if (body.lockedAmount !== undefined) {
    if (typeof body.lockedAmount !== "number" || !Number.isFinite(body.lockedAmount) || body.lockedAmount < 0) {
      return res.status(400).json({ error: "invalid", message: "lockedAmount must be a finite, non-negative number" });
    }
  }
  if (body.lockedDate !== undefined) {
    if (typeof body.lockedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.lockedDate)) {
      return res.status(400).json({ error: "invalid", message: "lockedDate must be ISO YYYY-MM-DD" });
    }
    const d = new Date(`${body.lockedDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: "invalid", message: "lockedDate is not a valid date" });
    }
  }
  if (body.note !== undefined && typeof body.note === "string" && body.note.length > 1000) {
    return res.status(400).json({ error: "invalid", message: "note exceeds 1000 chars" });
  }
  await Promise.all([ensureHydrated(), hydratePlanFacts(me.orgId)]);
  if (body.clear) {
    await db.delete(atelierCashLineOverrides).where(eq(atelierCashLineOverrides.lineId, body.lineId));
    OVERRIDES.delete(body.lineId);
    await persistAudit(me.name, "cash13w.override.clear", body.lineId, { by: me.id });
    return res.json({ ok: true, cleared: true });
  }
  const nowIso = new Date().toISOString();
  const ovr: Override = {
    lineId: body.lineId,
    lockedAmount: body.lockedAmount,
    lockedDate: body.lockedDate,
    locked: !!body.locked,
    note: body.note ?? "",
    byUserId: me.id, byUserName: me.name, byRole: me.role,
    at: nowIso,
  };
  await db.insert(atelierCashLineOverrides).values({
    lineId: ovr.lineId,
    lockedAmount: ovr.lockedAmount ?? null,
    lockedDate: ovr.lockedDate ?? null,
    locked: ovr.locked,
    note: ovr.note,
    byUserId: ovr.byUserId,
    byUserName: ovr.byUserName,
    byRole: ovr.byRole,
    at: new Date(nowIso),
  }).onConflictDoUpdate({
    target: atelierCashLineOverrides.lineId,
    set: {
      lockedAmount: ovr.lockedAmount ?? null,
      lockedDate: ovr.lockedDate ?? null,
      locked: ovr.locked,
      note: ovr.note,
      byUserId: ovr.byUserId,
      byUserName: ovr.byUserName,
      byRole: ovr.byRole,
      at: new Date(nowIso),
    },
  });
  OVERRIDES.set(body.lineId, ovr);
  await persistAudit(me.name, "cash13w.override.apply", body.lineId, {
    lockedAmount: body.lockedAmount, lockedDate: body.lockedDate, locked: body.locked, note: body.note,
  });
  res.json({ ok: true, override: ovr });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/cash-13w/audit", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  const rows = await db.select().from(atelierCashAudit).orderBy(desc(atelierCashAudit.ts)).limit(50);
  const items: AuditEntry[] = rows.map((r) => ({
    id: r.id,
    ts: (r.ts instanceof Date ? r.ts : new Date(r.ts)).toISOString(),
    actor: r.actor,
    action: r.action,
    target: r.target,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }));
  res.json({ items });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/backlog", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await hydratePlanFacts(me.orgId);
  res.json(computeBacklog(pickPresentation(req), pickEntity(req)));
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/entities", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await hydratePlanFacts(me.orgId);
  res.json({ items: ENTITIES });
});

// ──────────────────────────────────────────────────────────────
// Wave 8 (Task #420) — FP&A driver-based plan surfaces
// ──────────────────────────────────────────────────────────────
function pickScenario(req: Request): string {
  const s = String(req.query.scenario ?? "base");
  return FPA_SCENARIOS.some((x) => x.id === s) ? s : "base";
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/budget", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  const scenarioId = pickScenario(req);
  await hydratePlanFacts(me.orgId);
  const out = computeFpaBudget(scenarioId, pickPresentation(req), pickEntity(req));
  const committed = await readCurrentCommit();
  res.json({
    ...out,
    committedScenarioId: committed?.scenarioId ?? null,
    committedScenario: committed,
    isCommittedScenario: committed?.scenarioId === scenarioId,
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/headcount", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await hydratePlanFacts(me.orgId);
  res.json(computeFpaHeadcount(pickScenario(req), pickEntity(req)));
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/scenarios", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await hydratePlanFacts(me.orgId);
  const base = compareFpaScenarios(pickPresentation(req), pickEntity(req));
  const committed = await readCurrentCommit();
  res.json({
    ...base,
    committedScenarioId: committed?.scenarioId ?? null,
    committedScenario: committed,
    canCommit: isFinanceLeadership(me),
  });
});

// ──────────────────────────────────────────────────────────────
// Commit a scenario as the official forecast (Task #446).
// Finance-leadership only. Append-only: every commit gets its own row,
// the most recent row is the active "committed" forecast.
// ──────────────────────────────────────────────────────────────
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/finance/plan/scenarios/commit", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!isFinanceLeadership(me)) {
    return res.status(403).json({ error: "forbidden", message: "Finance leadership only." });
  }
  const body = (req.body ?? {}) as { scenarioId?: string | null; note?: string; periodLabel?: string };
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 1000)) {
    return res.status(400).json({ error: "invalid", message: "note must be a string ≤ 1000 chars" });
  }
  if (body.periodLabel !== undefined && (typeof body.periodLabel !== "string" || body.periodLabel.length > 64)) {
    return res.status(400).json({ error: "invalid", message: "periodLabel must be a string ≤ 64 chars" });
  }
  // POST with scenarioId: null is an alias for DELETE (uncommit). Lets clients
  // that can't issue DELETE — or want to send a body with reason — use POST.
  if (body.scenarioId === null) {
    const out = await uncommitForecast(me, body.note, body.periodLabel);
    return res.json(out);
  }
  if (!body?.scenarioId || typeof body.scenarioId !== "string") {
    return res.status(400).json({ error: "invalid", message: "scenarioId required (or pass null to uncommit)" });
  }
  const scenario = FPA_SCENARIOS.find((s) => s.id === body.scenarioId);
  if (!scenario) {
    return res.status(400).json({ error: "invalid", message: "unknown scenarioId" });
  }
  await ensureCommitsHydrated();
  const nowIso = new Date().toISOString();
  const id = `fpc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const periodLabel = body.periodLabel ?? "FY2026";
  const note = body.note ?? "";
  await db.insert(atelierFinancePlanCommits).values({
    id,
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    periodLabel,
    note,
    byUserId: me.id,
    byUserName: me.name,
    byRole: me.role,
    committedAt: new Date(nowIso),
  });
  setCommittedScenarioId(scenario.id);
  await persistAudit(me.name, "fpa.scenario.commit", scenario.id, {
    scenarioId: scenario.id, scenarioLabel: scenario.label, note, periodLabel, by: me.id, role: me.role,
  });
  res.json({
    ok: true,
    committed: {
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      periodLabel,
      note,
      byUserName: me.name,
      byRole: me.role,
      committedAt: nowIso,
    },
  });
});

// DELETE /finance/plan/scenarios/commit — clear the committed forecast and
// write an uncommit row to the audit trail. Variance reports + budget /
// scenarios pages immediately stop locking to a committed scenario.
async function uncommitForecast(me: Me, noteIn?: string, periodLabelIn?: string) {
  await ensureCommitsHydrated();
  const previousId = getCommittedScenarioId();
  const nowIso = new Date().toISOString();
  const id = `fpc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const periodLabel = periodLabelIn ?? "FY2026";
  const note = noteIn ?? "";
  await db.insert(atelierFinancePlanCommits).values({
    id,
    scenarioId: UNCOMMIT_SENTINEL,
    scenarioLabel: UNCOMMIT_LABEL,
    periodLabel,
    note,
    byUserId: me.id,
    byUserName: me.name,
    byRole: me.role,
    committedAt: new Date(nowIso),
  });
  setCommittedScenarioId(null);
  await persistAudit(me.name, "fpa.scenario.uncommit", previousId ?? "(none)", {
    previousScenarioId: previousId, note, periodLabel, by: me.id, role: me.role,
  });
  return {
    ok: true as const,
    uncommitted: true as const,
    previousScenarioId: previousId,
    periodLabel,
    note,
    byUserName: me.name,
    byRole: me.role,
    committedAt: nowIso,
  };
}

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.delete("/finance/plan/scenarios/commit", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!isFinanceLeadership(me)) {
    return res.status(403).json({ error: "forbidden", message: "Finance leadership only." });
  }
  const body = (req.body ?? {}) as { note?: string; periodLabel?: string };
  if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 1000)) {
    return res.status(400).json({ error: "invalid", message: "note must be a string ≤ 1000 chars" });
  }
  if (body.periodLabel !== undefined && (typeof body.periodLabel !== "string" || body.periodLabel.length > 64)) {
    return res.status(400).json({ error: "invalid", message: "periodLabel must be a string ≤ 64 chars" });
  }
  const out = await uncommitForecast(me, body.note, body.periodLabel);
  res.json(out);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/scenarios/commit", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  const current = await readCurrentCommit();
  const history = await readCommitHistory(50);
  res.json({
    current,
    history,
    canCommit: isFinanceLeadership(me),
    canUncommit: isFinanceLeadership(me) && current != null,
    churnWindowDays: COMMIT_CHURN_DAYS,
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/renewals", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await hydratePlanFacts(me.orgId);
  res.json(computeFpaRenewals(pickPresentation(req), pickEntity(req)));
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/plan/bonus", async (req, res) => {
  const me = ensurePersona(req, res); if (!me) return;
  if (denyRecruiter(me, res)) return;
  await hydratePlanFacts(me.orgId);
  res.json(computeFpaBonus(pickScenario(req), pickPresentation(req), pickEntity(req)));
});

export default router;
