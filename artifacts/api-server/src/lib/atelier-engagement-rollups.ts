/**
 * Phase 1 (Oct 2026 audit) — live engagement rollups.
 *
 * `atelier_engagements.raid_status` and `deliverables_due_this_week` are
 * columns that nothing in the application writes: they hold whatever the
 * seed put there, so every engagement card, the Home pane and the chat
 * `home_summary` reported a frozen RAID colour and a frozen "due this week"
 * count. Both are now derived from the live RAID and deliverable tables.
 *
 * - RAID status = worst severity among OPEN RAID items (red > amber > green);
 *   green when there are none.
 * - Deliverables due this week = not-done deliverables whose due date falls
 *   in the current ISO week (Mon–Sun, firm timezone Asia/Dubai, UTC+4, no DST).
 * - Overdue = not-done deliverables due before today.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, atelierDeliverables, atelierRaidItems } from "@workspace/db";

export type RaidColour = "green" | "amber" | "red";

export interface EngagementRollup {
  raidStatus: RaidColour;
  openRaidCount: number;
  openRaidRed: number;
  openRaidAmber: number;
  deliverablesDueThisWeek: number;
  deliverablesOverdue: number;
  deliverablesOpen: number;
}

/** Deliverable statuses that mean "nothing left to deliver". */
const DONE_DELIVERABLE_STATUSES = new Set([
  "published",
  "delivered",
  "accepted",
  "client_accepted",
  "final",
  "completed",
  "closed",
  "archived",
  "cancelled",
  "withdrawn",
]);

const DUBAI_OFFSET_MS = 4 * 3_600_000;

/** Monday and Sunday (YYYY-MM-DD) of the current week in the firm timezone. */
export function currentFirmWeek(now: Date = new Date()): { monday: string; sunday: string; today: string } {
  const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
  const day = (local.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return {
    monday: monday.toISOString().slice(0, 10),
    sunday: sunday.toISOString().slice(0, 10),
    today: local.toISOString().slice(0, 10),
  };
}

const EMPTY: EngagementRollup = {
  raidStatus: "green",
  openRaidCount: 0,
  openRaidRed: 0,
  openRaidAmber: 0,
  deliverablesDueThisWeek: 0,
  deliverablesOverdue: 0,
  deliverablesOpen: 0,
};

/** Live rollups for any number of engagements in two queries. */
export async function loadEngagementRollups(
  orgId: string,
  engagementIds: ReadonlyArray<string>,
  now: Date = new Date(),
): Promise<Map<string, EngagementRollup>> {
  const out = new Map<string, EngagementRollup>();
  const ids = Array.from(new Set(engagementIds.filter(Boolean)));
  for (const id of ids) out.set(id, { ...EMPTY });
  if (ids.length === 0) return out;
  const week = currentFirmWeek(now);
  const [raid, deliverables] = await Promise.all([
    db
      .select({
        engagementId: atelierRaidItems.engagementId,
        severity: atelierRaidItems.severity,
        status: atelierRaidItems.status,
      })
      .from(atelierRaidItems)
      .where(
        and(
          eq(atelierRaidItems.orgId, orgId),
          inArray(atelierRaidItems.engagementId, ids),
          isNull(atelierRaidItems.deletedAt),
          eq(atelierRaidItems.status, "open"),
        ),
      ),
    db
      .select({
        engagementId: atelierDeliverables.engagementId,
        status: atelierDeliverables.status,
        dueDate: atelierDeliverables.dueDate,
      })
      .from(atelierDeliverables)
      .where(
        and(
          eq(atelierDeliverables.orgId, orgId),
          inArray(atelierDeliverables.engagementId, ids),
          isNull(atelierDeliverables.deletedAt),
        ),
      ),
  ]);
  for (const r of raid) {
    const agg = out.get(r.engagementId);
    if (!agg) continue;
    agg.openRaidCount += 1;
    if (r.severity === "red") agg.openRaidRed += 1;
    else if (r.severity === "amber") agg.openRaidAmber += 1;
  }
  for (const d of deliverables) {
    const agg = out.get(d.engagementId);
    if (!agg || DONE_DELIVERABLE_STATUSES.has(d.status)) continue;
    agg.deliverablesOpen += 1;
    const due = d.dueDate ? d.dueDate.slice(0, 10) : null;
    if (!due) continue;
    if (due >= week.monday && due <= week.sunday) agg.deliverablesDueThisWeek += 1;
    if (due < week.today) agg.deliverablesOverdue += 1;
  }
  for (const agg of out.values()) {
    agg.raidStatus = agg.openRaidRed > 0 ? "red" : agg.openRaidAmber > 0 ? "amber" : "green";
  }
  return out;
}

/** Convenience for one engagement. */
export async function loadEngagementRollup(orgId: string, engagementId: string, now: Date = new Date()): Promise<EngagementRollup> {
  return (await loadEngagementRollups(orgId, [engagementId], now)).get(engagementId) ?? { ...EMPTY };
}
