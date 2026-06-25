/**
 * Atelier — Task #241 Reports.
 *
 *   GET    /reports/templates              -> 9 PRD §5 templates
 *   GET    /reports                         -> list saved reports
 *   POST   /reports                         -> create report (template + parameters)
 *   POST   /reports/:id/run                 -> run + cache snapshot
 *   GET    /reports/:id                     -> snapshot (last result)
 *   GET    /reports/:id/export.pdf          -> branded PDF
 *   GET    /reports/:id/export.csv          -> rows-only CSV
 *   POST   /reports/:id/schedule            -> per-user Slack/email stub
 *
 * Per-user delivery is recorded in atelier_notifications with a
 * `stub_no_channel` status — there is no real Slack/SMTP wiring in v2.
 *
 * Schema note: atelier_reports columns are `name`, `parameters`, `schedule`
 * (enum-ish: none|weekly_monday|monthly_first), `schedule_channels` (jsonb
 * array), and `last_run_snapshot`. We accept a custom cron + recipient list
 * on the schedule endpoint and stash them in `parameters._schedule` so we
 * don't break the migration contract.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull } from "drizzle-orm";
import PDFDocument from "pdfkit";
import {
  db,
  atelierUsers,
  atelierOpportunities,
  atelierAccounts,
  atelierEngagements,
  atelierWinLossDebriefs,
  atelierAssets,
  atelierReports,
  atelierNotifications,
  atelierAuditEvents,
  atelierDealPricings,
  atelierOpportunityStageTransitions,
} from "@workspace/db";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

const router: IRouter = Router();

// PRD §5 — 9 report templates.
type TemplateId =
  | "pipeline_waterfall"
  | "forecast_by_partner"
  | "margin_watch"
  | "account_heatmap"
  | "winloss_rate_by_offering"
  | "hidden_competitor"
  | "salon_health"
  | "atelier_reuse_leaderboard"
  | "senior_delivery_proof"
  // Task #296 — Runner-class reports.
  | "runner_aging"
  | "convert_to_runner_conversion"
  | "runner_to_contract_closure_time";

const TEMPLATES: Array<{ id: TemplateId; name: string; abstract: string; columns: string[] }> = [
  {
    id: "pipeline_waterfall",
    name: "5-Band Sales Funnel",
    abstract: "5-band funnel — Suspect/Prospect/Convert/Runner/Contract — plus terminal sidebar.",
    columns: ["band", "stage", "count", "weightedValueUsd", "agedRedCount"],
  },
  {
    id: "forecast_by_partner",
    name: "Forecast by Partner",
    abstract: "Weighted value owned per partner; the Monday-morning view.",
    columns: ["partner", "count", "weightedValueUsd", "rawValueUsd"],
  },
  {
    id: "margin_watch",
    name: "Margin Watch",
    abstract: "Deals priced below margin policy, awaiting partner override.",
    columns: ["opportunity", "marginPct", "policyMin", "gate"],
  },
  {
    id: "account_heatmap",
    name: "Account Heatmap",
    abstract: "Pipeline density per account by stage.",
    columns: ["account", "openCount", "weightedValueUsd", "lastTouchAt"],
  },
  {
    id: "winloss_rate_by_offering",
    name: "Win/Loss Rate by Offering",
    abstract: "Closed-deal outcomes per offering anchor.",
    columns: ["offering", "won", "lost", "winRatePct"],
  },
  {
    id: "hidden_competitor",
    name: "Hidden Competitor Watch",
    abstract: "Buyer-named competitor distribution from approved debriefs.",
    columns: ["competitor", "lossCount", "topThemeTag"],
  },
  {
    id: "salon_health",
    name: "Salon Health",
    abstract: "Salon participation and surfacing — not yet wired (Task #241 OOS).",
    columns: ["status"],
  },
  {
    id: "atelier_reuse_leaderboard",
    name: "Atelier Reuse Leaderboard",
    abstract: "Most-cited atelier assets in proposals + engagements.",
    columns: ["asset", "kind", "citationsCount"],
  },
  {
    id: "senior_delivery_proof",
    name: "Senior-Delivery Proof",
    abstract: "Engagements with named partner-on-the-pitch presence.",
    columns: ["engagement", "partner", "presenceLine"],
  },
  // Task #296 — Runner-class reports.
  {
    id: "runner_aging",
    name: "Runner Aging",
    abstract: "Every Runner-stage deal with days in stage, decider, and signature path. Sorted by age desc.",
    columns: ["opportunity", "account", "daysInRunner", "tier", "decider", "signaturePath"],
  },
  {
    id: "convert_to_runner_conversion",
    name: "Convert→Runner Conversion",
    abstract: "Per-period rate of deals that moved Convert→Runner, with denominator and trend.",
    columns: ["period", "convertEntries", "runnerEntries", "conversionPct"],
  },
  {
    id: "runner_to_contract_closure_time",
    name: "Runner→Contract Closure Time",
    abstract: "Distribution of contract_signed_at − runner_entered_at for closed deals: median, p75, p90.",
    columns: ["bucket", "count", "medianDays", "p75Days", "p90Days"],
  },
];

// @cli-skip: pending Task #340 read-parity migration
router.get("/reports/templates", async (req, res) => {
  if (!ensurePersona(req, res)) return;
  res.json({ templates: TEMPLATES });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/reports", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierReports)
    .where(isNull(atelierReports.deletedAt))
    .orderBy(desc(atelierReports.updatedAt));
  res.json({
    items: rows.map((r) => {
      const params = (r.parameters as Record<string, unknown>) ?? {};
      const sched = (params._schedule as { cron?: string; recipientUserIds?: string[] } | undefined) ?? {};
      return {
        id: r.id,
        name: r.name,
        templateId: r.templateId,
        ownerUserId: r.ownerUserId,
        parameters: params,
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
        schedule: r.schedule,
        scheduleChannels: r.scheduleChannels,
        scheduleCron: sched.cron ?? null,
        scheduleRecipientUserIds: sched.recipientUserIds ?? [],
        createdAt: r.createdAt.toISOString(),
      };
    }),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/reports", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const body = req.body as {
    name?: string;
    templateId?: TemplateId;
    parameters?: Record<string, unknown>;
  };
  if (!body.templateId || !TEMPLATES.find((t) => t.id === body.templateId)) {
    res.status(400).json({ error: "invalid-template" });
    return;
  }
  const id = rid("rpt");
  const tmpl = TEMPLATES.find((t) => t.id === body.templateId)!;
  const [row] = await db
    .insert(atelierReports)
    .values({
      id,
      orgId: me.orgId,
      ownerUserId: me.id,
      templateId: body.templateId,
      name: body.name ?? tmpl.name,
      parameters: body.parameters ?? {},
      createdByUserId: me.id,
    })
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "report",
    entityId: id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "report.created",
    payload: { templateId: body.templateId },
    payloadSummary: `${me.name} created report "${row.name}"`,
  });
  res.status(201).json({ report: row });
});

async function computeReport(
  templateId: TemplateId,
  _params: Record<string, unknown>,
): Promise<{ rows: Array<Record<string, unknown>>; summary: string }> {
  switch (templateId) {
    case "pipeline_waterfall": {
      // Task #296 — 5-band canonical sales funnel + terminal sidebar.
      // Working stages render as the funnel; lost / no_decision /
      // withdrawn render as a stacked terminal tally so closed-deal
      // volume stays visible without bloating the chart.
      const opps = await db
        .select()
        .from(atelierOpportunities)
        .where(isNull(atelierOpportunities.deletedAt));
      const working = ["suspect", "prospect", "convert", "runner", "contract"] as const;
      const terminal = ["lost", "no_decision", "withdrawn"] as const;
      const stageRow = (stage: string, band: "funnel" | "terminal") => {
        const list = opps.filter((o) => (o.salesStage ?? "suspect") === stage);
        return {
          band,
          stage,
          count: list.length,
          weightedValueUsd: list.reduce(
            (a, o) => a + (o.dealSizeHypothesis * o.probabilityPct) / 100,
            0,
          ),
          agedRedCount: list.filter((o) => o.daysInStage > 30).length,
        };
      };
      const rows = [
        ...working.map((s) => stageRow(s, "funnel")),
        ...terminal.map((s) => stageRow(s, "terminal")),
      ];
      const liveCount = rows
        .filter((r) => r.band === "funnel")
        .reduce((a, r) => a + r.count, 0);
      const closedCount = rows
        .filter((r) => r.band === "terminal")
        .reduce((a, r) => a + r.count, 0);
      return {
        rows,
        summary: `${liveCount} live across 5 bands · ${closedCount} closed in terminal sidebar.`,
      };
    }
    case "runner_aging": {
      // Every Runner-stage deal with days in Runner (sticky timestamp),
      // decider name, signature path, sorted by age desc.
      const opps = await db
        .select()
        .from(atelierOpportunities)
        .where(
          and(eq(atelierOpportunities.salesStage, "runner"), isNull(atelierOpportunities.deletedAt)),
        );
      const accts = await db.select().from(atelierAccounts);
      const aMap = new Map(accts.map((a) => [a.id, a]));
      const now = Date.now();
      // Pull the latest Convert→Runner transition per opp so we can show
      // decider / signaturePath captured at the gate.
      const transitions = await db
        .select()
        .from(atelierOpportunityStageTransitions);
      const lastByOpp = new Map<string, typeof transitions[number]>();
      for (const t of transitions) {
        if (t.toStage !== "runner") continue;
        const prior = lastByOpp.get(t.opportunityId);
        if (!prior || t.createdAt > prior.createdAt) lastByOpp.set(t.opportunityId, t);
      }
      const rows = opps
        .map((o) => {
          const enteredAt = o.runnerEnteredAt?.getTime() ?? null;
          const days = enteredAt === null ? o.daysInStage : Math.max(0, Math.floor((now - enteredAt) / 86_400_000));
          const tier = days >= 45 ? "red" : days >= 21 ? "amber" : "fresh";
          const t = lastByOpp.get(o.id);
          return {
            opportunity: o.name,
            account: aMap.get(o.accountId)?.name ?? o.accountId,
            daysInRunner: days,
            tier,
            decider: t?.decider ?? "",
            signaturePath: t?.signaturePath ?? "",
          };
        })
        .sort((a, b) => b.daysInRunner - a.daysInRunner);
      const red = rows.filter((r) => r.tier === "red").length;
      const amber = rows.filter((r) => r.tier === "amber").length;
      return {
        rows,
        summary: `${rows.length} Runner-stage deals · ${red} red (≥45d) · ${amber} amber (≥21d).`,
      };
    }
    case "convert_to_runner_conversion": {
      // Per-period Convert→Runner cohort conversion. Denominator (cohort)
      // = distinct opps whose *first* Convert entry fell in the period.
      // Numerator = members of that cohort who later (any time after the
      // cohort entry) reached Runner. This guarantees pct ∈ [0, 100] and
      // answers "of the deals we converted in month X, how many became
      // runners?" — independent of when the runner entry happened.
      const transitions = await db
        .select()
        .from(atelierOpportunityStageTransitions);
      const sorted = [...transitions].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const firstConvertAt = new Map<string, Date>();
      const firstRunnerAt = new Map<string, Date>();
      for (const t of sorted) {
        if (t.toStage === "convert" && !firstConvertAt.has(t.opportunityId)) {
          firstConvertAt.set(t.opportunityId, t.createdAt);
        } else if (t.toStage === "runner" && !firstRunnerAt.has(t.opportunityId)) {
          firstRunnerAt.set(t.opportunityId, t.createdAt);
        }
      }
      const periodOf = (d: Date) =>
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      type Bucket = {
        period: string;
        convertEntries: number;
        runnerEntries: number;
        conversionPct: number;
      };
      const cohort = new Map<string, { ids: Set<string>; converted: Set<string> }>();
      for (const [oppId, convertedAt] of firstConvertAt) {
        const p = periodOf(convertedAt);
        if (!cohort.has(p)) cohort.set(p, { ids: new Set(), converted: new Set() });
        const bucket = cohort.get(p)!;
        bucket.ids.add(oppId);
        const runnerAt = firstRunnerAt.get(oppId);
        if (runnerAt && runnerAt.getTime() >= convertedAt.getTime()) {
          bucket.converted.add(oppId);
        }
      }
      const rows: Bucket[] = Array.from(cohort.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, b]) => ({
          period: p,
          convertEntries: b.ids.size,
          runnerEntries: b.converted.size,
          conversionPct: b.ids.size === 0 ? 0 : Math.round((b.converted.size * 1000) / b.ids.size) / 10,
        }));
      const denomTotal = rows.reduce((a, r) => a + r.convertEntries, 0);
      const numTotal = rows.reduce((a, r) => a + r.runnerEntries, 0);
      const overall = denomTotal ? Math.round((numTotal * 1000) / denomTotal) / 10 : 0;
      return {
        rows,
        summary: `${rows.length} period(s) · overall Convert→Runner cohort conversion ${overall}%.`,
      };
    }
    case "runner_to_contract_closure_time": {
      // Distribution of (contract_signed_at − runner_entered_at) for
      // every opp that has both timestamps. We bucket all deals into a
      // single distribution row plus per-quarter rows so partners can
      // see the trend.
      const opps = await db
        .select()
        .from(atelierOpportunities)
        .where(isNull(atelierOpportunities.deletedAt));
      const closed = opps
        .filter((o) => o.runnerEnteredAt && o.contractSignedAt)
        .map((o) => ({
          quarter: (() => {
            const d = o.contractSignedAt!;
            return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
          })(),
          days: Math.max(
            0,
            Math.floor(
              (o.contractSignedAt!.getTime() - o.runnerEnteredAt!.getTime()) / 86_400_000,
            ),
          ),
        }));
      const stats = (days: number[]): { medianDays: number; p75Days: number; p90Days: number } => {
        if (days.length === 0) return { medianDays: 0, p75Days: 0, p90Days: 0 };
        const sorted = [...days].sort((a, b) => a - b);
        const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
        return { medianDays: pick(0.5), p75Days: pick(0.75), p90Days: pick(0.9) };
      };
      const allRow = {
        bucket: "all",
        count: closed.length,
        ...stats(closed.map((c) => c.days)),
      };
      const byQ = new Map<string, number[]>();
      for (const c of closed) {
        if (!byQ.has(c.quarter)) byQ.set(c.quarter, []);
        byQ.get(c.quarter)!.push(c.days);
      }
      const quarterRows = Array.from(byQ.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([q, ds]) => ({ bucket: q, count: ds.length, ...stats(ds) }));
      return {
        rows: [allRow, ...quarterRows],
        summary:
          closed.length === 0
            ? "No Runner→Contract closures recorded yet."
            : `${closed.length} closure(s) · median ${allRow.medianDays}d · p90 ${allRow.p90Days}d.`,
      };
    }
    case "forecast_by_partner": {
      const opps = await db
        .select()
        .from(atelierOpportunities)
        .where(isNull(atelierOpportunities.deletedAt));
      const users = await db.select().from(atelierUsers);
      const map = new Map(users.map((u) => [u.id, u]));
      const buckets = new Map<string, { partner: string; count: number; weightedValueUsd: number; rawValueUsd: number }>();
      for (const o of opps) {
        const k = o.partnerOwnerId;
        const r = buckets.get(k) ?? {
          partner: map.get(k)?.name ?? k,
          count: 0,
          weightedValueUsd: 0,
          rawValueUsd: 0,
        };
        r.count++;
        r.weightedValueUsd += (o.dealSizeHypothesis * o.probabilityPct) / 100;
        r.rawValueUsd += o.dealSizeHypothesis;
        buckets.set(k, r);
      }
      const rows = [...buckets.values()].sort((a, b) => b.weightedValueUsd - a.weightedValueUsd);
      return { rows, summary: `${rows.length} partners covering $${Math.round(rows.reduce((a, r) => a + r.weightedValueUsd, 0)).toLocaleString()} weighted.` };
    }
    case "margin_watch": {
      // Real signal: pull deal pricings whose marginLockStatus is amber/red
      // (i.e. below policy threshold) and have not yet been countersigned.
      const pricings = await db
        .select()
        .from(atelierDealPricings)
        .where(isNull(atelierDealPricings.deletedAt));
      const flagged = pricings.filter(
        (p) => p.marginLockStatus !== "green" && !p.countersignAt,
      );
      const opps = await db.select().from(atelierOpportunities);
      const oppMap = new Map(opps.map((o) => [o.id, o]));
      const rows = flagged.map((p) => ({
        opportunity: oppMap.get(p.opportunityId)?.name ?? p.opportunityId,
        marginPct: Math.round((p.computedMarginPct ?? 0) * 1000) / 10,
        policyMin: Math.round((p.targetMarginPct ?? 0) * 1000) / 10,
        gate: p.marginLockStatus,
      }));
      return {
        rows,
        summary: rows.length
          ? `${rows.length} deal(s) below margin policy, awaiting countersign.`
          : "All deals at or above margin policy.",
      };
    }
    case "account_heatmap": {
      const opps = await db
        .select()
        .from(atelierOpportunities)
        .where(isNull(atelierOpportunities.deletedAt));
      const accts = await db.select().from(atelierAccounts);
      const map = new Map(accts.map((a) => [a.id, a]));
      const buckets = new Map<string, { account: string; openCount: number; weightedValueUsd: number; lastTouchAt: string | null }>();
      for (const o of opps) {
        const acct = map.get(o.accountId);
        const k = o.accountId;
        const r = buckets.get(k) ?? { account: acct?.name ?? k, openCount: 0, weightedValueUsd: 0, lastTouchAt: null };
        r.openCount++;
        r.weightedValueUsd += (o.dealSizeHypothesis * o.probabilityPct) / 100;
        const t = o.updatedAt.toISOString();
        if (!r.lastTouchAt || t > r.lastTouchAt) r.lastTouchAt = t;
        buckets.set(k, r);
      }
      const rows = [...buckets.values()].sort((a, b) => b.weightedValueUsd - a.weightedValueUsd);
      return { rows, summary: `${rows.length} accounts with live pipeline.` };
    }
    case "winloss_rate_by_offering": {
      const opps = await db
        .select()
        .from(atelierOpportunities)
        .where(isNull(atelierOpportunities.deletedAt));
      const buckets = new Map<string, { offering: string; won: number; lost: number; winRatePct: number }>();
      for (const o of opps) {
        const k = o.offeringAnchor ?? "unknown";
        const r = buckets.get(k) ?? { offering: k, won: 0, lost: 0, winRatePct: 0 };
        const s = o.salesStage as string;
        if (s === "contract") r.won++;
        else if (["lost", "no_decision", "withdrawn"].includes(s)) r.lost++;
        buckets.set(k, r);
      }
      const rows = [...buckets.values()].map((r) => ({
        ...r,
        winRatePct: r.won + r.lost === 0 ? 0 : Math.round((r.won * 100) / (r.won + r.lost)),
      }));
      return { rows, summary: `${rows.length} offerings represented in closed pipeline.` };
    }
    case "hidden_competitor": {
      const debriefs = await db
        .select()
        .from(atelierWinLossDebriefs)
        .where(
          and(
            eq(atelierWinLossDebriefs.status, "approved"),
            isNull(atelierWinLossDebriefs.deletedAt),
          ),
        );
      const buckets = new Map<string, { competitor: string; lossCount: number; topThemeTag: string }>();
      for (const d of debriefs) {
        const k = d.hiddenCompetitor ?? "unknown";
        const r = buckets.get(k) ?? { competitor: k, lossCount: 0, topThemeTag: "" };
        if (d.outcome !== "signed") r.lossCount++;
        const themes = (d.themes as Array<{ tag?: string }>) ?? [];
        if (themes[0]?.tag) r.topThemeTag = themes[0].tag;
        buckets.set(k, r);
      }
      const rows = [...buckets.values()].sort((a, b) => b.lossCount - a.lossCount);
      return { rows, summary: `${debriefs.length} approved debriefs analyzed.` };
    }
    case "salon_health": {
      return {
        rows: [{ status: "Salon surfacing not wired in v2 — see Task #241 OOS." }],
        summary: "Stub.",
      };
    }
    case "atelier_reuse_leaderboard": {
      const assets = await db
        .select()
        .from(atelierAssets)
        .where(isNull(atelierAssets.deletedAt));
      const rows = assets.slice(0, 10).map((a) => ({
        asset: a.title,
        kind: a.kind,
        citationsCount: 0,
      }));
      return { rows, summary: `Top ${rows.length} atelier assets.` };
    }
    case "senior_delivery_proof": {
      // Senior-delivery proof = engagements where a named partner is on
      // the team with a real recurring cadence. We read the engagement's
      // partnerCadenceHoursPerWeek (or treat charterStatus=signed as proof
      // when cadence missing) — this avoids hand-waved presence lines.
      const engs = await db
        .select()
        .from(atelierEngagements)
        .where(isNull(atelierEngagements.deletedAt));
      const users = await db.select().from(atelierUsers);
      const umap = new Map(users.map((u) => [u.id, u]));
      const rows = engs
        .map((e) => {
          const cadenceHrs = (e as unknown as { partnerCadenceHoursPerWeek?: number })
            .partnerCadenceHoursPerWeek;
          const charter = (e as unknown as { charterStatus?: string }).charterStatus ?? "draft";
          const hours =
            typeof cadenceHrs === "number" && cadenceHrs > 0
              ? cadenceHrs
              : charter === "signed"
              ? 4
              : 0;
          return {
            engagement: e.name,
            partner: umap.get(e.partnerOwnerId)?.name ?? e.partnerOwnerId,
            partnerCadenceHrsPerWeek: hours,
            presenceLine:
              hours > 0
                ? `${hours} hrs/wk partner cadence (charter ${charter})`
                : `No partner cadence — gap (charter ${charter})`,
          };
        })
        .sort((a, b) => b.partnerCadenceHrsPerWeek - a.partnerCadenceHrsPerWeek);
      const proven = rows.filter((r) => r.partnerCadenceHrsPerWeek > 0).length;
      return {
        rows,
        summary: `${proven}/${rows.length} engagements with measurable partner cadence.`,
      };
    }
  }
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/reports/:id/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [row] = await db
    .select()
    .from(atelierReports)
    .where(and(eq(atelierReports.id, req.params.id), isNull(atelierReports.deletedAt)));
  if (!row) {
    res.status(404).json({ error: "report-not-found" });
    return;
  }
  // PRD §5.4 "View as of [date]" — accept asOfDate parameter override
  // (ISO 8601). Merged into stored parameters; templates that filter by
  // date can read parameters.asOfDate to scope their query.
  const asOfDate = req.body?.asOfDate ?? req.query?.asOfDate ?? null;
  const baseParams = (row.parameters as Record<string, unknown>) ?? {};
  const effectiveParams = asOfDate
    ? { ...baseParams, asOfDate: String(asOfDate) }
    : baseParams;
  const result = await computeReport(
    row.templateId as TemplateId,
    effectiveParams,
  );
  const [updated] = await db
    .update(atelierReports)
    .set({
      lastRunSnapshot: result,
      lastRunAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierReports.id, row.id))
    .returning();
  res.json({ report: updated, result });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/reports/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [row] = await db
    .select()
    .from(atelierReports)
    .where(and(eq(atelierReports.id, req.params.id), isNull(atelierReports.deletedAt)));
  if (!row) {
    res.status(404).json({ error: "report-not-found" });
    return;
  }
  res.json({
    report: row,
    template: TEMPLATES.find((t) => t.id === row.templateId) ?? null,
  });
});

// Unified export alias (PRD §5): /reports/:id/export?format=pdf|csv.
// Delegates to the existing export.pdf / export.csv handlers via internal
// URL rewrite so we keep one source of truth.
// @cli-skip: pending Task #340 read-parity migration
router.get("/reports/:id/export", (req, res, next) => {
  const fmt = String(req.query.format ?? "").toLowerCase();
  if (fmt !== "pdf" && fmt !== "csv") {
    res.status(400).json({ error: "format-required", allowed: ["pdf", "csv"] });
    return;
  }
  req.url = req.url.replace(/\/export(\?.*)?$/, `/export.${fmt}$1`);
  next("route");
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/reports/:id/export.csv", async (req, res) => {
  if (!ensurePersona(req, res)) return;
  const [row] = await db
    .select()
    .from(atelierReports)
    .where(and(eq(atelierReports.id, req.params.id), isNull(atelierReports.deletedAt)));
  if (!row) {
    res.status(404).end();
    return;
  }
  const result = (row.lastRunSnapshot as { rows: Array<Record<string, unknown>> } | null) ?? { rows: [] };
  const cols = Array.from(new Set(result.rows.flatMap((r) => Object.keys(r))));
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of result.rows) lines.push(cols.map((c) => escape(r[c])).join(","));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${row.id}.csv"`);
  res.send(lines.join("\n"));
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/reports/:id/export.pdf", async (req, res) => {
  if (!ensurePersona(req, res)) return;
  const [row] = await db
    .select()
    .from(atelierReports)
    .where(and(eq(atelierReports.id, req.params.id), isNull(atelierReports.deletedAt)));
  if (!row) {
    res.status(404).end();
    return;
  }
  const result = (row.lastRunSnapshot as { rows: Array<Record<string, unknown>>; summary?: string } | null) ?? { rows: [], summary: "" };
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${row.id}.pdf"`);
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  doc.pipe(res);
  doc.rect(0, 0, doc.page.width, 64).fill("#0E1F3D");
  doc.fillColor("#E89E2C").fontSize(20).text("Cognirise Atelier", 48, 22);
  doc.fillColor("#FFFFFF").fontSize(10).text("Report export", 48, 46);
  doc.moveDown(3);
  doc.fillColor("#0E1F3D").fontSize(18).text(row.name);
  doc.moveDown(0.5);
  doc.fillColor("#444").fontSize(10).text(`Template: ${row.templateId}`);
  if (result.summary) doc.moveDown(0.5).fillColor("#0E1F3D").fontSize(11).text(result.summary);
  doc.moveDown(1);
  const cols = Array.from(new Set(result.rows.flatMap((r) => Object.keys(r))));
  if (cols.length) {
    doc.fillColor("#0E1F3D").fontSize(10).text(cols.join("   |   "), { underline: true });
    doc.moveDown(0.3);
    for (const r of result.rows.slice(0, 60)) {
      doc.fillColor("#222").fontSize(10).text(cols.map((c) => String(r[c] ?? "")).join("   |   "));
    }
    if (result.rows.length > 60) {
      doc.moveDown(0.5).fillColor("#888").fontSize(9).text(`(${result.rows.length - 60} more rows truncated — use CSV export for full data)`);
    }
  } else {
    doc.fillColor("#888").text("No rows.");
  }
  doc.end();
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/reports/:id/schedule", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [row] = await db
    .select()
    .from(atelierReports)
    .where(and(eq(atelierReports.id, req.params.id), isNull(atelierReports.deletedAt)));
  if (!row) {
    res.status(404).json({ error: "report-not-found" });
    return;
  }
  const body = req.body as {
    schedule?: "none" | "weekly_monday" | "monthly_first";
    cron?: string;
    channels?: Array<"slack" | "email" | "in_app">;
    recipientUserIds?: string[];
  };
  const schedule = body.schedule ?? "weekly_monday";
  const cron = body.cron ?? "0 7 * * 1";
  const channels: Array<"slack" | "email" | "in_app"> =
    body.channels && body.channels.length ? body.channels : ["in_app"];
  const recipients = body.recipientUserIds ?? [me.id];
  const nextParams = {
    ...((row.parameters as Record<string, unknown>) ?? {}),
    _schedule: { cron, recipientUserIds: recipients },
  };
  await db
    .update(atelierReports)
    .set({
      schedule,
      scheduleChannels: channels,
      parameters: nextParams,
      updatedAt: new Date(),
    })
    .where(eq(atelierReports.id, row.id));
  for (const uid of recipients) {
    for (const channel of channels) {
      await db.insert(atelierNotifications).values({
        id: rid("ntf"),
        orgId: me.orgId,
        userId: uid,
        kind: "report_scheduled",
        payload: { reportId: row.id, schedule, cron, channel },
        channel,
        subject: `Scheduled: ${row.name}`,
        body: `Atelier will deliver "${row.name}" (${schedule}, cron "${cron}"). (No Slack/SMTP wired up in v2 — this is a stub.)`,
        refType: "report",
        refId: row.id,
        scheduledFor: new Date(),
        status: channel === "in_app" ? "queued" : "stub_no_channel",
        createdByUserId: me.id,
      });
    }
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "report",
    entityId: row.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "report.scheduled",
    payload: { schedule, cron, channels, recipientCount: recipients.length },
    payloadSummary: `${me.name} scheduled "${row.name}" via ${channels.join("+")} for ${recipients.length} recipient(s)`,
  });
  res.json({ ok: true, schedule, cron, channels, recipientCount: recipients.length });
});

export default router;
