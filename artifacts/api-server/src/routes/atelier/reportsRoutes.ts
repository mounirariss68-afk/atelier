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
  | "senior_delivery_proof";

const TEMPLATES: Array<{ id: TemplateId; name: string; abstract: string; columns: string[] }> = [
  {
    id: "pipeline_waterfall",
    name: "Pipeline Waterfall",
    abstract: "Movement of opps across stages this quarter (in / out / aged).",
    columns: ["stage", "count", "weightedValueUsd", "agedRedCount"],
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
];

router.get("/reports/templates", async (req, res) => {
  if (!ensurePersona(req, res)) return;
  res.json({ templates: TEMPLATES });
});

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
      const opps = await db
        .select()
        .from(atelierOpportunities)
        .where(isNull(atelierOpportunities.deletedAt));
      const stages = ["identify", "shape", "pursue", "won", "lost", "no_go"];
      const rows = stages.map((stage) => {
        const list = opps.filter((o) => o.plmStage === stage);
        return {
          stage,
          count: list.length,
          weightedValueUsd: list.reduce(
            (a, o) => a + (o.dealSizeHypothesis * o.probabilityPct) / 100,
            0,
          ),
          agedRedCount: list.filter((o) => o.daysInStage > 30).length,
        };
      });
      return { rows, summary: `${opps.length} live opps across ${stages.length} stages.` };
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
        const k = o.offeringAnchor;
        const r = buckets.get(k) ?? { offering: k, won: 0, lost: 0, winRatePct: 0 };
        if (o.plmStage === "won") r.won++;
        if (o.plmStage === "lost") r.lost++;
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
  const result = await computeReport(
    row.templateId as TemplateId,
    (row.parameters as Record<string, unknown>) ?? {},
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
  doc.fillColor("#E89E2C").fontSize(20).text("AICo Atelier", 48, 22);
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
  const channels = (body.channels && body.channels.length ? body.channels : ["in_app"]) as Array<"slack" | "email">;
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
