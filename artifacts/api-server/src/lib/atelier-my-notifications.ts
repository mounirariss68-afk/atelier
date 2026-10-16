/**
 * Phase 0 (Oct 2026 audit) — one reader for "my notifications".
 *
 * Two tables carry user-addressed alerts. `atelier_self_notifications` is the
 * one the Me lens and the mobile app read. `atelier_notifications` is written
 * by eight modules (Burn and Margin Sentinel, Payroll Clerk, Self-billing
 * Clerk, payment proposer, deliverable acceptance, engagement financials,
 * report scheduling) and, until now, read by nothing — so agent alerts
 * addressed to a founder never surfaced. This module merges both so the HTTP
 * route and the Riser capability show the same list, and dismisses in
 * whichever table holds the row. Report-scheduling stubs (`stub_no_channel`)
 * are excluded: nothing was ever going to deliver them.
 */
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { db, atelierNotifications, atelierSelfNotifications } from "@workspace/db";

export type MyNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  status: "unread" | "dismissed";
  createdAt: Date;
  source: "self" | "agent";
};

function agentHref(refType: string | null, refId: string | null): string | null {
  if (!refType || !refId) return null;
  switch (refType) {
    case "engagement":
      return `/engagements/${refId}`;
    case "opportunity":
      return `/opportunities/${refId}`;
    case "account":
      return `/accounts/${refId}`;
    case "payroll_run":
      return `/finance/payroll`;
    case "self_billed_invoice":
    case "payment_run":
      return `/finance/payables`;
    case "report":
      return `/reports`;
    default:
      return null;
  }
}

export async function listMyUnreadNotifications(args: {
  orgId: string;
  userId: string;
  limit?: number;
}): Promise<MyNotification[]> {
  const limit = args.limit ?? 100;
  const [selfRows, agentRows] = await Promise.all([
    db
      .select()
      .from(atelierSelfNotifications)
      .where(
        and(
          eq(atelierSelfNotifications.orgId, args.orgId),
          eq(atelierSelfNotifications.userId, args.userId),
          eq(atelierSelfNotifications.status, "unread"),
          isNull(atelierSelfNotifications.deletedAt),
        ),
      )
      .orderBy(desc(atelierSelfNotifications.createdAt))
      .limit(limit),
    db
      .select()
      .from(atelierNotifications)
      .where(
        and(
          eq(atelierNotifications.orgId, args.orgId),
          eq(atelierNotifications.userId, args.userId),
          isNull(atelierNotifications.readAt),
          isNull(atelierNotifications.deletedAt),
          or(isNull(atelierNotifications.status), ne(atelierNotifications.status, "stub_no_channel")),
        ),
      )
      .orderBy(desc(atelierNotifications.createdAt))
      .limit(limit),
  ]);
  const merged: MyNotification[] = [
    ...selfRows.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href: n.href,
      status: n.status as "unread" | "dismissed",
      createdAt: n.createdAt,
      source: "self" as const,
    })),
    ...agentRows.map((n) => {
      const payload = (n.payload ?? {}) as Record<string, unknown>;
      const title =
        n.subject ??
        (typeof payload.title === "string" ? payload.title : null) ??
        n.kind.replace(/_/g, " ");
      const body = n.body ?? (typeof payload.message === "string" ? payload.message : "");
      return {
        id: n.id,
        kind: n.kind,
        title,
        body,
        href: agentHref(n.refType, n.refId),
        status: "unread" as const,
        createdAt: n.createdAt,
        source: "agent" as const,
      };
    }),
  ];
  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return merged.slice(0, limit);
}

/** Dismiss one of the caller's notifications in whichever table holds it. */
export async function dismissMyNotification(args: {
  orgId: string;
  userId: string;
  id: string;
}): Promise<MyNotification | null> {
  const now = new Date();
  const [selfRow] = await db
    .update(atelierSelfNotifications)
    .set({ status: "dismissed", dismissedAt: now, updatedAt: now })
    .where(
      and(
        eq(atelierSelfNotifications.id, args.id),
        eq(atelierSelfNotifications.orgId, args.orgId),
        eq(atelierSelfNotifications.userId, args.userId),
        isNull(atelierSelfNotifications.deletedAt),
      ),
    )
    .returning();
  if (selfRow) {
    return {
      id: selfRow.id,
      kind: selfRow.kind,
      title: selfRow.title,
      body: selfRow.body,
      href: selfRow.href,
      status: "dismissed",
      createdAt: selfRow.createdAt,
      source: "self",
    };
  }
  const [agentRow] = await db
    .update(atelierNotifications)
    .set({ readAt: now, updatedAt: now })
    .where(
      and(
        eq(atelierNotifications.id, args.id),
        eq(atelierNotifications.orgId, args.orgId),
        eq(atelierNotifications.userId, args.userId),
        isNull(atelierNotifications.deletedAt),
      ),
    )
    .returning();
  if (!agentRow) return null;
  return {
    id: agentRow.id,
    kind: agentRow.kind,
    title: agentRow.subject ?? agentRow.kind.replace(/_/g, " "),
    body: agentRow.body ?? "",
    href: agentHref(agentRow.refType, agentRow.refId),
    status: "dismissed",
    createdAt: agentRow.createdAt,
    source: "agent",
  };
}
