/**
 * Task #332 — Outbound rate limits for high-blast-radius CLI verbs.
 *
 * Sending an email, posting to Slack, or publishing to the Salon
 * costs the firm reputation per-call — we cap how often a single
 * persona can fan-out per day and require typed-recipient
 * confirmation on every call regardless of cap remaining.
 *
 * Counters live in the `atelier_audit_events` table (no new table —
 * we mine the existing audit row stream by `(actorId, action, day)`).
 * That keeps retention + GDPR erasure semantics consistent with the
 * rest of the platform.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db, atelierAuditEvents } from "@workspace/db";

export type OutboundChannel = "email" | "slack" | "salon_publish";

const DAILY_CAPS: Record<OutboundChannel, number> = {
  email: 50,
  slack: 100,
  salon_publish: 10,
};

const ACTION_BY_CHANNEL: Record<OutboundChannel, string> = {
  email: "cli.outbound.email",
  slack: "cli.outbound.slack",
  salon_publish: "cli.outbound.salon",
};

export interface QuotaSnapshot {
  channel: OutboundChannel;
  used: number;
  cap: number;
  remaining: number;
  withinCap: boolean;
}

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function getQuota(
  userId: string,
  channel: OutboundChannel,
): Promise<QuotaSnapshot> {
  const since = startOfUtcDay();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.actorId, userId),
        eq(atelierAuditEvents.action, ACTION_BY_CHANNEL[channel]),
        gte(atelierAuditEvents.createdAt, since),
      ),
    );
  const used = row?.n ?? 0;
  const cap = DAILY_CAPS[channel];
  return { channel, used, cap, remaining: Math.max(cap - used, 0), withinCap: used < cap };
}

/**
 * Enforce + record. Returns `{ allowed, snapshot }`. The caller
 * writes its own `cli.outbound.<channel>` audit row alongside the
 * domain row (so retention + GDPR scrub by `actorId` cleans both).
 */
export async function checkAndRecord(
  userId: string,
  channel: OutboundChannel,
): Promise<{ allowed: boolean; snapshot: QuotaSnapshot }> {
  const snap = await getQuota(userId, channel);
  return { allowed: snap.withinCap, snapshot: snap };
}

export function dailyCapFor(channel: OutboundChannel): number {
  return DAILY_CAPS[channel];
}
