/**
 * Task #1173 — Partner notification center helper.
 *
 * `notifyPartnerFirm` inserts one in-app notification row for a partner
 * firm and (optionally) fans out ONE branded email per ACTIVE
 * alliance-partner login of that firm. Email delivery is fire-after-commit
 * and log-only: it must NEVER throw back into the caller's transaction —
 * so call this AFTER the surrounding write has committed.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, gte, lte, isNotNull, gt } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierPartnerFirms,
  atelierPartnerNotifications,
  atelierComplianceRecords,
} from "@workspace/db";
import { sendEmail } from "./email";
import { buildCogniriseEmail } from "./cognirise-email-templates";
import { logger } from "./logger";

export type PartnerNotificationKind =
  | "grant_shared"
  | "grant_revoked"
  | "contract_shared"
  | "contract_renewal"
  | "contract_signature"
  | "bank_change_decided"
  | "invoice_status"
  // Task #1174 — partner delivery view + shared documents.
  | "engagement_shared"
  | "engagement_revoked"
  | "document_shared"
  // Task #1175 — a partner-submitted profile change request was decided.
  | "change_request_decided";

export interface NotifyPartnerFirmArgs {
  orgId: string;
  partnerFirmId: string;
  kind: PartnerNotificationKind;
  title: string;
  body?: string | null;
  /** Portal-relative deep link, e.g. "/partner/billing". */
  href?: string | null;
  /**
   * When set, ONE branded email is sent per active alliance-partner login
   * of the firm (sender "system"), and `emailedAt` is stamped on the row.
   */
  email?: { subject: string; paragraphs: string[] };
  /**
   * When null (whole-firm) the notification targets every login; when set
   * the row is attributed to a single login (still firm-scoped).
   */
  userId?: string | null;
}

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

/**
 * Insert a partner notification row and optionally email active logins.
 * Returns the inserted row id (or null if the insert itself failed — the
 * caller may choose to ignore this, as notifications are best-effort).
 */
export async function notifyPartnerFirm(
  args: NotifyPartnerFirmArgs,
): Promise<string | null> {
  const id = rid("pnotif");
  try {
    await db.insert(atelierPartnerNotifications).values({
      id,
      orgId: args.orgId,
      partnerFirmId: args.partnerFirmId,
      userId: args.userId ?? null,
      kind: args.kind,
      title: args.title,
      body: args.body ?? null,
      href: args.href ?? null,
    });
  } catch (err) {
    // Notifications are best-effort; never surface into the caller.
    logger.warn({ err, kind: args.kind, firm: args.partnerFirmId }, "partner notification insert failed");
    return null;
  }

  if (args.email) {
    // Fan out AFTER the row exists; failures are log-only.
    void emailActiveLogins(id, args).catch((err) =>
      logger.warn({ err, kind: args.kind, firm: args.partnerFirmId }, "partner notification email fan-out failed"),
    );
  }
  return id;
}

async function emailActiveLogins(
  notificationId: string,
  args: NotifyPartnerFirmArgs,
): Promise<void> {
  if (!args.email) return;
  const logins = await db
    .select({ name: atelierUsers.name, email: atelierUsers.email })
    .from(atelierUsers)
    .where(
      and(
        eq(atelierUsers.orgId, args.orgId),
        eq(atelierUsers.role, "alliance_partner"),
        eq(atelierUsers.partnerFirmId, args.partnerFirmId),
        isNull(atelierUsers.deletedAt),
      ),
    );
  if (logins.length === 0) return;

  let anySent = false;
  for (const login of logins) {
    if (!login.email || !login.email.includes("@")) continue;
    const firstName = login.name.trim().split(/\s+/)[0] || "there";
    try {
      const built = buildCogniriseEmail({
        title: args.title,
        greeting: `Dear ${firstName},`,
        paragraphs: args.email.paragraphs,
        bodyText: [`Dear ${firstName},`, "", ...args.email.paragraphs, "", "Warm regards, The Cognirise team"].join("\n"),
      });
      const result = await sendEmail({
        sender: "system",
        to: login.email,
        subject: args.email.subject,
        html: built.html,
        text: built.text,
        attachments: built.attachments,
      });
      if (result.ok) anySent = true;
    } catch (err) {
      logger.warn({ err, to: login.email }, "partner notification email failed");
    }
  }

  if (anySent) {
    await db
      .update(atelierPartnerNotifications)
      .set({ emailedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierPartnerNotifications.id, notificationId))
      .catch((err) => logger.warn({ err }, "partner notification emailedAt stamp failed"));
  }
}

/**
 * Task #1173 — daily contract-renewal scan. Finds partner-firm master
 * agreements (atelier_compliance_records, kind "master_agreement",
 * partner_firm_id set) whose expiryDate falls within the next 30 days and
 * raises ONE `contract_renewal` notification per firm. Dedupe: skips a firm
 * that already has a contract_renewal row created in the last 35 days.
 * Rerun-safe.
 */
export async function runPartnerContractRenewalScan(opts?: {
  orgId?: string;
  now?: Date;
}): Promise<{ scanned: number; notified: number; skipped: number }> {
  const orgId = opts?.orgId ?? "aico";
  const now = opts?.now ?? new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const in30Iso = new Date(now.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  const dedupeCutoff = new Date(now.getTime() - 35 * 86400_000);

  const rows = await db
    .select({
      partnerFirmId: atelierComplianceRecords.partnerFirmId,
      expiryDate: atelierComplianceRecords.expiryDate,
    })
    .from(atelierComplianceRecords)
    .where(
      and(
        eq(atelierComplianceRecords.orgId, orgId),
        eq(atelierComplianceRecords.kind, "master_agreement"),
        isNotNull(atelierComplianceRecords.partnerFirmId),
        isNull(atelierComplianceRecords.deletedAt),
        isNotNull(atelierComplianceRecords.expiryDate),
        gte(atelierComplianceRecords.expiryDate, todayIso),
        lte(atelierComplianceRecords.expiryDate, in30Iso),
      ),
    );

  let notified = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const firmId = r.partnerFirmId as string;
    if (seen.has(firmId)) continue;
    seen.add(firmId);

    const href = "/partner/company";
    // Dedupe: an existing contract_renewal row within 35 days.
    const [recent] = await db
      .select({ id: atelierPartnerNotifications.id })
      .from(atelierPartnerNotifications)
      .where(
        and(
          eq(atelierPartnerNotifications.orgId, orgId),
          eq(atelierPartnerNotifications.partnerFirmId, firmId),
          eq(atelierPartnerNotifications.kind, "contract_renewal"),
          eq(atelierPartnerNotifications.href, href),
          gt(atelierPartnerNotifications.createdAt, dedupeCutoff),
        ),
      );
    if (recent) {
      skipped++;
      continue;
    }
    const [firm] = await db
      .select({ name: atelierPartnerFirms.name })
      .from(atelierPartnerFirms)
      .where(
        and(
          eq(atelierPartnerFirms.id, firmId),
          eq(atelierPartnerFirms.orgId, orgId),
          isNull(atelierPartnerFirms.deletedAt),
        ),
      );
    if (!firm) {
      skipped++;
      continue;
    }
    await notifyPartnerFirm({
      orgId,
      partnerFirmId: firmId,
      kind: "contract_renewal",
      title: "Your partnership agreement is approaching renewal",
      body: `Your master agreement expires on ${r.expiryDate}. Your Cognirise contact will be in touch about renewal.`,
      href,
      email: {
        subject: "Your partnership agreement is approaching renewal — Cognirise",
        paragraphs: [
          `The master agreement for ${firm.name} expires on ${r.expiryDate}.`,
          "Your Cognirise contact will be in touch about renewal.",
        ],
      },
    });
    notified++;
  }
  return { scanned: rows.length, notified, skipped };
}
