/**
 * Task #732 — vendor-registration renewal reminders.
 *
 * A lapsed Etimad / Ariba registration silently blocks getting paid, so this
 * scan surfaces upcoming procurement-registration renewals on the responsible
 * partner's Me-home pending list (Pane A), with an optional email nudge.
 *
 * Two triggers:
 *   - "due":         the human-tracked status is "renewal_due".
 *   - "approaching": status is "registered" AND the approved guide's renewal
 *     cadence (free text like "annual", "every 2 years", "12 months") is
 *     parseable, and statusUpdatedAt + cadence falls within the warning
 *     window (30 days) or has already passed. Unparseable cadences are
 *     skipped — never guessed.
 *
 * Targeting: the account's partnerOwner; when no owner is set, all founding
 * partners. Pane items use deterministic ids + onConflictDoNothing so the
 * daily re-run is idempotent, and the email nudge fires only when the pane
 * item was NEWLY inserted (so nobody gets nagged daily). Emails go out with
 * sender "system" per the sendEmail sender rules.
 */

import { eq, and, isNull, inArray, like } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierPaneAItems,
  atelierAuditEvents,
  atelierUsers,
} from "@workspace/db";
import { sendEmail } from "./email";
import { logger } from "./logger";

const AGENT_ID = "ag_procurement_renewal";
const AGENT_LABEL = "Procurement Renewal Reminder";
/** Days before a computed renewal date at which "approaching" kicks in. */
const APPROACHING_WINDOW_DAYS = 30;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type ProcurementBlob = NonNullable<
  (typeof atelierAccounts.$inferSelect)["procurement"]
>;

/**
 * Parse a free-text renewal cadence into months. Conservative: returns null
 * for anything it cannot confidently read (we then simply don't compute an
 * "approaching" date — the human-tracked "renewal_due" status still works).
 */
export function parseRenewalCadenceMonths(renewal: string | null | undefined): number | null {
  if (!renewal) return null;
  const t = renewal.toLowerCase();
  const years = t.match(/(?:every\s+)?(\d+)\s*(?:calendar\s+)?(?:year|yr)s?/);
  if (years) {
    const n = Number(years[1]);
    return Number.isFinite(n) && n > 0 && n <= 10 ? n * 12 : null;
  }
  const months = t.match(/(?:every\s+)?(\d+)\s*months?/);
  if (months) {
    const n = Number(months[1]);
    return Number.isFinite(n) && n > 0 && n <= 120 ? n : null;
  }
  if (/annual|yearly|every year|per year|once a year/.test(t)) return 12;
  if (/biennial|every other year/.test(t)) return 24;
  return null;
}

function addMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type RenewalFinding = {
  accountId: string;
  accountLabel: string;
  bucket: "due" | "approaching";
  channelName: string | null;
  renewalText: string | null;
  /** Computed renewal date (approaching only). */
  renewalDate: string | null;
  partnerOwnerId: string | null;
};

/** Pure evaluation of one account's procurement blob. Exported for tests. */
export function evaluateProcurementRenewal(args: {
  procurement: ProcurementBlob | null;
  now?: Date;
}): { bucket: "due" | "approaching"; renewalDate: string | null } | null {
  const p = args.procurement;
  if (!p) return null;
  const now = args.now ?? new Date();
  const channelRenewal = p.guide?.renewal ?? null;
  if (p.status === "renewal_due") {
    return { bucket: "due", renewalDate: null };
  }
  if (p.status !== "registered") return null;
  const cadence = parseRenewalCadenceMonths(channelRenewal);
  if (cadence == null) return null;
  // Best available anchor for "when the registration was last confirmed":
  // the moment a human set the status to registered.
  const anchor = p.statusUpdatedAt ? new Date(p.statusUpdatedAt) : null;
  if (!anchor || Number.isNaN(anchor.getTime())) return null;
  const renewalAt = addMonths(anchor, cadence);
  const daysUntil = (renewalAt.getTime() - now.getTime()) / 86400_000;
  if (daysUntil > APPROACHING_WINDOW_DAYS) return null;
  return { bucket: "approaching", renewalDate: isoDay(renewalAt) };
}

export const PROCUREMENT_RENEWAL_PANE_PREFIX = "pane_procren_";

const paneItemId = (accountId: string, bucket: string, userId: string) =>
  `${PROCUREMENT_RENEWAL_PANE_PREFIX}${accountId}_${bucket}_${userId}`;

/**
 * Resolve any open procurement-renewal pane items for an account — called
 * when the tracked status moves away from renewal_due / registered (renewed,
 * re-registration in progress, archived…), so stale nags disappear.
 */
export async function resolveProcurementRenewalPaneItems(accountId: string): Promise<number> {
  const rows = await db
    .update(atelierPaneAItems)
    .set({ resolvedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        like(atelierPaneAItems.id, `${PROCUREMENT_RENEWAL_PANE_PREFIX}${accountId}_%`),
        isNull(atelierPaneAItems.resolvedAt),
      ),
    )
    .returning({ id: atelierPaneAItems.id });
  return rows.length;
}

/**
 * Scan accounts for due/approaching vendor-registration renewals and emit
 * Pane A items (plus a one-time email nudge) to the responsible partner.
 * Idempotent — safe to re-run daily or on demand for a single account.
 */
export async function runProcurementRenewalScan(args?: {
  accountId?: string;
  sendEmails?: boolean;
  now?: Date;
}): Promise<{ scanned: number; findings: number; emitted: number; emailed: number; runId: string }> {
  const now = args?.now ?? new Date();
  const sendEmails = args?.sendEmails ?? true;
  const where = args?.accountId
    ? and(eq(atelierAccounts.id, args.accountId), isNull(atelierAccounts.deletedAt))
    : isNull(atelierAccounts.deletedAt);
  const accounts = await db.select().from(atelierAccounts).where(where);

  const findings: RenewalFinding[] = [];
  for (const a of accounts) {
    // Archived/dormant-archived accounts never nag.
    if ((a.status ?? "active") === "archived") continue;
    const hit = evaluateProcurementRenewal({ procurement: a.procurement ?? null, now });
    if (!hit) continue;
    findings.push({
      accountId: a.id,
      accountLabel: a.brandName ?? a.name,
      bucket: hit.bucket,
      channelName: a.procurement?.guide?.channel?.name ?? null,
      renewalText: a.procurement?.guide?.renewal ?? null,
      renewalDate: hit.renewalDate,
      partnerOwnerId: a.partnerOwnerId ?? null,
    });
  }

  // Resolve recipients: partner owner, else all founding partners.
  const ownerIds = [
    ...new Set(findings.map((f) => f.partnerOwnerId).filter((x): x is string => !!x)),
  ];
  const owners = ownerIds.length
    ? await db
        .select({ id: atelierUsers.id, name: atelierUsers.name, email: atelierUsers.email })
        .from(atelierUsers)
        .where(and(inArray(atelierUsers.id, ownerIds), isNull(atelierUsers.deletedAt)))
    : [];
  const ownerById = new Map(owners.map((u) => [u.id, u]));
  const founders = await db
    .select({ id: atelierUsers.id, name: atelierUsers.name, email: atelierUsers.email })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.role, "founding_partner"), isNull(atelierUsers.deletedAt)));

  let emitted = 0;
  let emailed = 0;
  for (const f of findings) {
    const owner = f.partnerOwnerId ? ownerById.get(f.partnerOwnerId) : undefined;
    const recipients = owner ? [owner] : founders;
    const channel = f.channelName ? ` (${f.channelName})` : "";
    const title =
      f.bucket === "due"
        ? `Vendor registration renewal due — ${f.accountLabel}${channel}`
        : `Vendor registration renewal approaching — ${f.accountLabel}${channel}`;
    const summary =
      f.bucket === "due"
        ? `Registration status is renewal due. A lapsed registration blocks invoicing — renew before it expires.${f.renewalText ? ` Renewal cycle: ${f.renewalText}` : ""}`
        : `Per the researched guide's renewal cycle${f.renewalText ? ` (${f.renewalText})` : ""}, renewal is expected around ${f.renewalDate}. Confirm and renew before it lapses.`;
    const dueLabel = f.renewalDate ?? isoDay(now);
    // A finding supersedes the other bucket: when a registration moves from
    // "approaching" to formally renewal_due (or back), resolve the stale
    // bucket's items so users never see duplicate reminders for one account.
    const otherBucket = f.bucket === "due" ? "approaching" : "due";
    await db
      .update(atelierPaneAItems)
      .set({ resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          like(
            atelierPaneAItems.id,
            `${PROCUREMENT_RENEWAL_PANE_PREFIX}${f.accountId}_${otherBucket}_%`,
          ),
          isNull(atelierPaneAItems.resolvedAt),
        ),
      );
    for (const u of recipients) {
      const inserted = await db
        .insert(atelierPaneAItems)
        .values({
          id: paneItemId(f.accountId, f.bucket, u.id),
          userId: u.id,
          title,
          summary,
          priority: f.bucket === "due" ? "high" : "medium",
          hrefKind: "account",
          hrefTargetId: f.accountId,
          dueLabel,
          sortKey: f.bucket === "due" ? 0 : 1,
        })
        .onConflictDoNothing()
        .returning({ id: atelierPaneAItems.id });
      if (inserted.length === 0) continue;
      emitted++;
      if (!sendEmails || !u.email) continue;
      try {
        const result = await sendEmail({
          to: u.email,
          subject: title,
          text: `${summary}\n\nAccount: ${f.accountLabel}\nOpen the Procurement tab to review and renew.`,
          html: `<p>${summary}</p><p><strong>Account:</strong> ${f.accountLabel}</p><p>Open the account's Procurement tab to review and renew.</p>`,
          sender: "system",
        });
        // via:"log-only" means NOT delivered — count only real sends.
        if (result.ok && result.via === "resend") emailed++;
      } catch (err) {
        logger.warn(
          { accountId: f.accountId, to: u.email, err: err instanceof Error ? err.message : String(err) },
          "procurement renewal email nudge failed",
        );
      }
    }
  }

  const runId = rid("run");
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "agent_run",
    entityId: runId,
    actorType: "agent",
    actorId: AGENT_ID,
    actorLabel: AGENT_LABEL,
    action: "procurement.renewal_scan",
    payload: {
      scanned: accounts.length,
      findings: findings.length,
      emitted,
      emailed,
      accountId: args?.accountId ?? null,
    },
    payloadSummary: `${AGENT_LABEL} scanned ${accounts.length} accounts, found ${findings.length} upcoming renewals, emitted ${emitted} reminders.`,
  });
  return { scanned: accounts.length, findings: findings.length, emitted, emailed, runId };
}
