/**
 * Atelier — Task #241 Forecast roll-ups.
 *
 *   GET /forecast?by=partner|offering|sector|stage|quarter
 *
 * Each row exposes count, weightedValueUsd, and (where appropriate) a
 * breakdown by sales stage. Forecast values are derived from
 * dealSizeHypothesis * probabilityPct, matching the home pipeline math.
 *
 * Task #8 hardening:
 *  - Every query is explicitly org-scoped (previously relied solely on
 *    connection-level RLS, which the app connection bypasses).
 *  - Financial redaction: personas without account-wide financial authority
 *    over an opportunity's account see it counted but with its money values
 *    excluded from all roll-ups (rows carry redactedCount so the UI can say
 *    "N deals withheld" instead of silently under-reporting).
 *  - Currency awareness: totals are grouped per account primaryCurrency in
 *    totals.byCurrency and flagged mixedCurrency so the UI never presents a
 *    cross-currency sum under a bare "$" label.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { isNull, gte, and, eq } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierOpportunities,
  atelierAccounts,
  atelierOpportunityStageTransitions,
} from "@workspace/db";
import { rejectNonEmployeePersona } from "./rosterRoutes";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { accessibleEngagementIds } from "./engagementRoutes";

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

const router: IRouter = Router();
// Task #254 — Forecast is firm-internal pipeline math; non-employee personas
// (contractor / partner-firm resource) are explicitly out of scope.
// NOTE: applied per-route (not via router.use) because mounting a sub-router
// with router.use(forecastRoutes) at the parent root would otherwise let this
// middleware fire for ALL atelier paths, blocking even allowlisted routes
// like /me. The centralized boundary in atelier/index.ts handles the rest.

function quarterKey(d: Date): string {
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${y} Q${q}`;
}

// Resolve the quarter bucket for an opportunity. Task #653 — the expected
// close date is the authoritative forecast horizon, so prefer `closeDate` and
// only fall back to `nextMilestoneDate` when no close date is set. A malformed
// or empty date (e.g. "TBD", "", or a non-ISO string) parses to an Invalid
// Date whose getFullYear()/getMonth() are NaN — that produced a bogus
// "NaN QNaN" bucket. Guard with isNaN and fall back to "Unscheduled" so the
// forecast roll-up stays clean and crash-free.
function quarterBucketForOpp(o: {
  closeDate: string | null;
  nextMilestoneDate: string | null;
}): string {
  const raw = o.closeDate ?? o.nextMilestoneDate;
  if (!raw) return "Unscheduled";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "Unscheduled";
  return quarterKey(d);
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/forecast", rejectNonEmployeePersona, async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const by = String(req.query.by ?? "partner");
  // Task #8 — explicit org scoping on every query (defence in depth on top
  // of RLS; the pooled app connection is BYPASSRLS in some environments).
  const opps = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.orgId, me.orgId),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  const accts = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.orgId, me.orgId));
  const acctMap = new Map(accts.map((a) => [a.id, a]));
  const users = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.orgId, me.orgId));
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Task #8 — per-opportunity financial visibility, mirroring the account
  // financials gate (accountRoutes): account-wide authority = firm-wide
  // engagement access OR owning the account; restricted / board personas
  // never see money. Redacted opportunities stay in `count` (occupancy is
  // not financial) but contribute nothing to any *ValueUsd figure.
  const access = await accessibleEngagementIds(me);
  const personaMaySeeMoney =
    !isRestrictedPersona(me.role ?? null) && !isBoardObserver(me.role ?? null);
  const myUserId = me.id;
  function canSeeMoney(o: (typeof opps)[number]): boolean {
    if (!personaMaySeeMoney) return false;
    if (access.all) return true;
    const acct = acctMap.get(o.accountId);
    return acct?.partnerOwnerId === myUserId;
  }
  const currencyOf = (o: (typeof opps)[number]): string =>
    acctMap.get(o.accountId)?.primaryCurrency ?? "USD";

  type Row = {
    key: string;
    label: string;
    count: number;
    weightedValueUsd: number;
    rawValueUsd: number;
    byStage: Record<string, number>;
    redactedCount: number;
    byCurrency: Record<string, { weightedValue: number; rawValue: number; count: number }>;
  };
  const buckets = new Map<string, Row>();
  function bump(key: string, label: string, o: typeof opps[number]) {
    const r =
      buckets.get(key) ??
      {
        key,
        label,
        count: 0,
        weightedValueUsd: 0,
        rawValueUsd: 0,
        byStage: {},
        redactedCount: 0,
        byCurrency: {},
      };
    r.count += 1;
    if (canSeeMoney(o)) {
      const ccy = currencyOf(o);
      r.weightedValueUsd += (o.dealSizeHypothesis * o.probabilityPct) / 100;
      r.rawValueUsd += o.dealSizeHypothesis;
      const c = r.byCurrency[ccy] ?? { weightedValue: 0, rawValue: 0, count: 0 };
      c.weightedValue += (o.dealSizeHypothesis * o.probabilityPct) / 100;
      c.rawValue += o.dealSizeHypothesis;
      c.count += 1;
      r.byCurrency[ccy] = c;
    } else {
      r.redactedCount += 1;
    }
    r.byStage[o.salesStage] = (r.byStage[o.salesStage] ?? 0) + 1;
    buckets.set(key, r);
  }
  for (const o of opps) {
    if (by === "partner") {
      const u = userMap.get(o.partnerOwnerId);
      bump(o.partnerOwnerId, u?.name ?? o.partnerOwnerId, o);
    } else if (by === "offering") {
      const oa = o.offeringAnchor ?? "unknown";
      bump(oa, oa, o);
    } else if (by === "sector") {
      const a = acctMap.get(o.accountId);
      const sec = a?.sector ?? "unknown";
      bump(sec, sec, o);
    } else if (by === "stage") {
      bump(o.salesStage, o.salesStage, o);
    } else if (by === "category") {
      // Task #653 — forecast category (pipeline | best_case | commit |
      // closed | omitted) expresses deal confidence independently of stage
      // and probability; roll it up as its own bucketing dimension.
      const fc = o.forecastCategory ?? "pipeline";
      bump(fc, fc, o);
    } else if (by === "quarter") {
      const q = quarterBucketForOpp(o);
      bump(q, q, o);
    } else {
      res.status(400).json({ error: "invalid-by" });
      return;
    }
  }
  const rows = [...buckets.values()].sort(
    (a, b) => b.weightedValueUsd - a.weightedValueUsd,
  );
  const totals = rows.reduce(
    (acc, r) => ({
      count: acc.count + r.count,
      weightedValueUsd: acc.weightedValueUsd + r.weightedValueUsd,
      rawValueUsd: acc.rawValueUsd + r.rawValueUsd,
      redactedCount: acc.redactedCount + r.redactedCount,
    }),
    { count: 0, weightedValueUsd: 0, rawValueUsd: 0, redactedCount: 0 },
  );
  // Task #8 — currency-aware totals: sums grouped per account currency plus
  // a mixedCurrency flag so the UI never labels a cross-currency sum "USD".
  const totalsByCurrency: Record<
    string,
    { weightedValue: number; rawValue: number; count: number }
  > = {};
  for (const r of rows) {
    for (const [ccy, c] of Object.entries(r.byCurrency)) {
      const t = totalsByCurrency[ccy] ?? { weightedValue: 0, rawValue: 0, count: 0 };
      t.weightedValue += c.weightedValue;
      t.rawValue += c.rawValue;
      t.count += c.count;
      totalsByCurrency[ccy] = t;
    }
  }
  const mixedCurrency = Object.keys(totalsByCurrency).length > 1;

  // Week-over-week deltas: rebuild the same buckets at "as-of last Monday"
  // by rewinding probabilityPct to the priorProbabilityPct of any stage
  // transition that happened in the last 7 days. Opps with no transitions
  // are assumed unchanged.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oppIds = new Set(opps.map((o) => o.id));
  const recentTrans = (
    await db
      .select()
      .from(atelierOpportunityStageTransitions)
      .where(gte(atelierOpportunityStageTransitions.createdAt, sevenDaysAgo))
  ).filter((t) => oppIds.has(t.opportunityId)); // Task #8 — org scope via this org's opps.
  const lastWeekProb = new Map<string, number>(); // oppId -> earliest prior prob in window
  for (const t of recentTrans) {
    const cur = lastWeekProb.get(t.opportunityId);
    if (cur === undefined && typeof t.priorProbabilityPct === "number") {
      lastWeekProb.set(t.opportunityId, t.priorProbabilityPct);
    }
  }
  const lastWeekBuckets = new Map<string, number>(); // key -> weighted
  function priorBump(key: string, o: typeof opps[number]) {
    if (!canSeeMoney(o)) return; // Task #8 — deltas honour redaction too.
    const prevProb = lastWeekProb.has(o.id)
      ? lastWeekProb.get(o.id)!
      : o.probabilityPct;
    const w = (o.dealSizeHypothesis * prevProb) / 100;
    lastWeekBuckets.set(key, (lastWeekBuckets.get(key) ?? 0) + w);
  }
  for (const o of opps) {
    if (by === "partner") priorBump(o.partnerOwnerId, o);
    else if (by === "offering") priorBump(o.offeringAnchor ?? "unknown", o);
    else if (by === "sector") priorBump(acctMap.get(o.accountId)?.sector ?? "unknown", o);
    else if (by === "stage") priorBump(o.salesStage, o);
    else if (by === "category") priorBump(o.forecastCategory ?? "pipeline", o);
    else if (by === "quarter") {
      const q = quarterBucketForOpp(o);
      priorBump(q, o);
    }
  }
  const rowsWithDelta = rows.map((r) => {
    const prev = lastWeekBuckets.get(r.key) ?? 0;
    const deltaWeightedValueUsd = r.weightedValueUsd - prev;
    return { ...r, deltaWeightedValueUsd, weightedValueUsdLastWeek: prev };
  });

  // Top-3 movers across the bucketing dimension.
  const movers = [...rowsWithDelta]
    .sort((a, b) => Math.abs(b.deltaWeightedValueUsd) - Math.abs(a.deltaWeightedValueUsd))
    .slice(0, 3)
    .map((r) => ({
      key: r.key,
      label: r.label,
      deltaWeightedValueUsd: r.deltaWeightedValueUsd,
      direction: r.deltaWeightedValueUsd >= 0 ? "up" : "down",
    }));

  // Conversion funnel — Task #296 canonical 5-band working stages.
  // Terminal stages (lost / no_decision / withdrawn) are excluded;
  // they show up in the Reports terminal sidebar instead.
  //
  // Task #653 — proper conversion math. `count` is current-stage occupancy;
  // `reached` is the cumulative number of (working) opps that have made it to
  // this stage *or beyond* (the conversion denominator). The stage-to-stage
  // `conversionRate` is reached[next] / reached[current] — i.e. of everything
  // that reached this stage, the share that progressed past it. Without the
  // cumulative denominator a raw occupancy count understates conversion because
  // it ignores deals that already moved on to later stages.
  const FUNNEL = ["suspect", "prospect", "convert", "runner", "contract"];
  const stageRank = new Map(FUNNEL.map((s, i) => [s, i]));
  const occupancy = FUNNEL.map(
    (s) => opps.filter((o) => o.salesStage === s).length,
  );
  // reached[i] = # working opps whose stage rank >= i.
  const reached = FUNNEL.map((_s, i) =>
    opps.filter((o) => {
      const r = stageRank.get(o.salesStage);
      return r !== undefined && r >= i;
    }).length,
  );
  const funnel = FUNNEL.map((s, i) => ({
    stage: s,
    count: occupancy[i],
    reached: reached[i],
    // Conversion from this stage to the next (null at the last band).
    conversionRate:
      i < FUNNEL.length - 1
        ? reached[i] > 0
          ? reached[i + 1] / reached[i]
          : 0
        : null,
  }));

  const lastWeekTotalWeighted = [...lastWeekBuckets.values()].reduce((a, b) => a + b, 0);
  res.json({
    by,
    rows: rowsWithDelta,
    totals: {
      ...totals,
      weightedValueUsdLastWeek: lastWeekTotalWeighted,
      deltaWeightedValueUsd: totals.weightedValueUsd - lastWeekTotalWeighted,
      byCurrency: totalsByCurrency,
      mixedCurrency,
    },
    movers,
    funnel,
  });
});

export default router;
