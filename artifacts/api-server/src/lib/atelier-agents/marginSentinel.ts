/**
 * Atelier — Margin Sentinel (Task #434). Burn Sentinel pattern.
 *
 * Deterministic sweep over the realization report: for every engagement
 * with a sold-position baseline, it checks
 *   • realization rate (recognised revenue ÷ sold price) crossing BELOW
 *     85% (amber) and 70% (red) once delivery is materially underway
 *     (delivered hours ≥ 25% of sold hours — early engagements always
 *     look "under-realized" and would be pure noise), and
 *   • leakage total crossing 15% of the sold price.
 *
 * Each (engagement, band) fires at most once — the alert's Pane A row id
 * is deterministic (`panea_margin_<engId>_<band>`), the audit row is the
 * previous-state record (actor ag_margin_sentinel, action
 * ledger.margin.threshold_crossed), and all inserts are
 * onConflictDoNothing. Alerts flow to the Partner Owner via Pane A +
 * notification, never email-only.
 *
 * Scheduled from the ledgerNudges 15-minute ticker with a daily gate
 * (06:00 GST slice), and runnable on demand from the finance route.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAuditEvents,
  atelierPaneAItems,
  atelierNotifications,
  atelierSoldPositionSnapshot,
} from "@workspace/db";
import { startRun, completeRun, failRun } from "./runner.js";
import { computeRealizationReport } from "../atelier-margin-reporting.js";

const REALIZATION_BANDS = [
  { band: "real85", label: "Realization below 85%", test: (r: number) => r < 0.85, priority: "medium" as const, sortKey: 60 },
  { band: "real70", label: "Realization below 70%", test: (r: number) => r < 0.7, priority: "high" as const, sortKey: 90 },
];
const LEAKAGE_PCT_THRESHOLD = 0.15;
const MIN_DELIVERY_PROGRESS = 0.25;

function nowInGst(): { hour: number; minute: number } {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

export async function runMarginSentinelTick(opts: { force?: boolean; orgId?: string } = {}): Promise<{
  alertsWritten: number;
  engagementsScanned: number;
}> {
  if (!opts.force) {
    const { hour, minute } = nowInGst();
    // Daily gate: 06:00 GST slice of the 15-minute ticker.
    if (hour !== 6 || minute >= 15) return { alertsWritten: 0, engagementsScanned: 0 };
  }
  const startedAt = Date.now();
  const runId = await startRun({
    agentId: "ag_margin_sentinel",
    triggeredByUserId: null,
    targetType: "finance.margin_sentinel",
    targetId: "firm",
    targetLabel: opts.orgId ? `Realization sweep (${opts.orgId})` : "Firm-wide realization sweep",
    actorLabel: "Margin Sentinel",
    inputs: { force: !!opts.force, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
  });
  // Phase 0 (Oct 2026 audit): any failure after startRun used to leave the
  // run in `running` until the 2-hour stale reaper. Fail the run explicitly.
  try {

    // Tenant scoping: user-triggered runs pass an explicit orgId and process
    // ONLY that org. The scheduled ticker (no orgId) sweeps every org that has
    // sold-position snapshots (no baseline means nothing to alert on), but each
    // org is still processed in isolation — reads, previous-state lookups and
    // writes are all org-bounded.
    let orgIds: string[];
    if (opts.orgId) {
      orgIds = [opts.orgId];
    } else {
      const orgRows = await db
        .selectDistinct({ orgId: atelierSoldPositionSnapshot.orgId })
        .from(atelierSoldPositionSnapshot)
        .where(isNull(atelierSoldPositionSnapshot.deletedAt));
      orgIds = orgRows.map((o) => o.orgId);
    }
    let alertsWritten = 0;
    let engagementsScanned = 0;

    for (const orgId of orgIds) {
    const { rows } = await computeRealizationReport({ orgId });
    engagementsScanned += rows.length;

    // Previous-state record: which bands already fired per engagement (org-bounded).
    const prevRows = await db
      .select({ entityId: atelierAuditEvents.entityId, payload: atelierAuditEvents.payload })
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.orgId, orgId),
          eq(atelierAuditEvents.actorId, "ag_margin_sentinel"),
          eq(atelierAuditEvents.action, "ledger.margin.threshold_crossed"),
        ),
      );
    const firedBands = new Map<string, Set<string>>();
    for (const r of prevRows) {
      const band = (r.payload as { band?: string } | null)?.band;
      if (!band) continue;
      const set = firedBands.get(r.entityId) ?? new Set<string>();
      set.add(band);
      firedBands.set(r.entityId, set);
    }

    for (const row of rows) {
      if (!row.sold || row.sold.priceUsd <= 0 || row.realizationRate === null) continue;
      // Skip engagements barely started — early ratios are noise.
      const progress = row.sold.hours > 0 ? row.delivered.hoursBillable / row.sold.hours : 1;
      if (progress < MIN_DELIVERY_PROGRESS) continue;

      const already = firedBands.get(row.engagementId) ?? new Set<string>();
      const crossings: Array<{ band: string; label: string; priority: "medium" | "high"; sortKey: number; detail: string }> = [];
      for (const b of REALIZATION_BANDS) {
        if (b.test(row.realizationRate) && !already.has(b.band)) {
          crossings.push({
            band: b.band,
            label: b.label,
            priority: b.priority,
            sortKey: b.sortKey,
            detail: `Realization at ${(row.realizationRate * 100).toFixed(0)}% ($${Math.round(row.delivered.revenueRecognised).toLocaleString()} recognised vs $${Math.round(row.sold.priceUsd).toLocaleString()} sold).`,
          });
        }
      }
      const leakagePct = row.leakage ? row.leakage.totalUsd / row.sold.priceUsd : 0;
      if (row.leakage && leakagePct >= LEAKAGE_PCT_THRESHOLD && !already.has("leak15")) {
        const l = row.leakage;
        crossings.push({
          band: "leak15",
          label: `Leakage at ${(leakagePct * 100).toFixed(0)}% of sold price`,
          priority: "high",
          sortKey: 85,
          detail: `Leakage $${Math.round(l.totalUsd).toLocaleString()} — rate variance $${Math.round(l.rateVarianceUsd).toLocaleString()}, hours overrun $${Math.round(l.hoursOverrunUsd).toLocaleString()}, write-offs $${Math.round(l.scopeWriteOffsUsd).toLocaleString()}, unrecovered expenses $${Math.round(l.expenseNonRecoveryUsd).toLocaleString()}.`,
        });
      }

      for (const c of crossings) {
        const paneId = `panea_margin_${row.engagementId}_${c.band}`;
        const targetUserId = row.partnerOwnerId;
        if (!targetUserId) continue;
        const inserted = await db
          .insert(atelierPaneAItems)
          .values({
            id: paneId,
            orgId,
            userId: targetUserId,
            title: `Margin Sentinel · ${row.engagementName} — ${c.label}`,
            summary: c.detail,
            priority: c.priority,
            hrefKind: "engagement_economics",
            hrefTargetId: row.engagementId,
            dueLabel: "Now",
            sortKey: c.sortKey,
          })
          .onConflictDoNothing({ target: atelierPaneAItems.id })
          .returning({ id: atelierPaneAItems.id });
        if (!inserted.length) continue;
        alertsWritten++;
        await db
          .insert(atelierAuditEvents)
          .values({
            id: `aud_margin_${row.engagementId}_${c.band}`,
            orgId,
            entityType: "engagement",
            entityId: row.engagementId,
            actorType: "agent",
            actorId: "ag_margin_sentinel",
            actorLabel: "Margin Sentinel",
            action: "ledger.margin.threshold_crossed",
            payload: {
              band: c.band,
              realizationRate: row.realizationRate,
              leakage: row.leakage,
              soldPriceUsd: row.sold.priceUsd,
              revenueRecognised: row.delivered.revenueRecognised,
            },
            payloadSummary: `Margin Sentinel: ${row.engagementName} — ${c.label}.`,
          })
          .onConflictDoNothing({ target: atelierAuditEvents.id });
        await db
          .insert(atelierNotifications)
          .values({
            id: `notif_margin_${row.engagementId}_${c.band}`,
            orgId,
            userId: targetUserId,
            kind: "margin_alert",
            payload: { engagementId: row.engagementId, band: c.band, realizationRate: row.realizationRate },
            subject: `Margin alert: ${row.engagementName} — ${c.label}`,
            body: c.detail,
            refType: "engagement",
            refId: row.engagementId,
            status: "queued",
          })
          .onConflictDoNothing({ target: atelierNotifications.id });
      }
    }
    }

    await completeRun({
      runId,
      output: { alertsWritten, engagementsScanned },
      confidence: alertsWritten > 0 ? "amber" : "green",
      costUsd: 0,
      durationMs: Date.now() - startedAt,
      sourcesCount: engagementsScanned,
      actorLabel: "Margin Sentinel",
      targetType: "finance.margin_sentinel",
      targetId: "firm",
      targetLabel: opts.orgId ? `Realization sweep (${opts.orgId})` : "Firm-wide realization sweep",
    });
    return { alertsWritten, engagementsScanned };
  } catch (err) {
    await failRun(runId, err, { actorLabel: "Margin Sentinel", targetType: "finance.margin_sentinel", targetId: "firm" });
    throw err;
  }

}
