/**
 * Task #62 — E-signing core (DocuSeal-backed signature requests).
 *
 * Lifecycle:
 *   send    — a Document Library PDF is pushed to DocuSeal (template +
 *             submission, sequential signing order preserved) and a
 *             signature-request row + signer rows are recorded.
 *   sync    — the ONLY way state changes. Fetches the authoritative
 *             submission from DocuSeal and reconciles request + signer
 *             statuses. Webhooks merely trigger a sync (they are never
 *             trusted as a source of state, so spoofed payloads are
 *             harmless); a polling loop is the fallback for dev
 *             environments DocuSeal can't reach.
 *   archive — on full completion the signed PDF (+ audit log, when
 *             DocuSeal exposes one) is downloaded and stored in the
 *             Document Library via the standard createDocument pipeline,
 *             inheriting its ACL + RAG ingestion.
 *   expiry  — DocuSeal enforces expire_at server-side; the sync pass
 *             also lapses requests locally once past expiresAt so the
 *             UI never shows a stale "sent" beyond the deadline.
 *
 * Sync errors are recorded on the row (last_sync_error) AND thrown to
 * manual callers — no silent failures.
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  atelierSignatureRequests,
  atelierSignatureSigners,
  atelierSelfNotifications,
  atelierAuditEvents,
  atelierUsers,
} from "@workspace/db";
import { sendEmail } from "./email.js";
import {
  createTemplateFromPdf,
  createSubmission,
  getSubmission,
  archiveSubmission,
  resendSubmitterEmail,
  downloadDocusealFile,
  type DocusealSubmission,
} from "./docuseal.js";
import { createDocument } from "./atelier-documents.js";

export type SigRequestRow = typeof atelierSignatureRequests.$inferSelect;
export type SigSignerRow = typeof atelierSignatureSigners.$inferSelect;

export const SIG_REQUEST_STATUSES = [
  "sent",
  "partially_signed",
  "completed",
  "declined",
  "voided",
  "expired",
] as const;

const OPEN_STATUSES = ["sent", "partially_signed"] as const;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function auditSignatureRequest(args: {
  requestId: string;
  actorType?: "human" | "system";
  actorId: string;
  actorLabel: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "signature_request",
    entityId: args.requestId,
    actorType: args.actorType ?? "human",
    actorId: args.actorId,
    actorLabel: args.actorLabel,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export async function sendSignatureRequest(args: {
  orgId: string;
  actor: { id: string; name: string };
  title: string;
  message?: string | null;
  documentId: string;
  documentVersionId: string;
  fileName: string;
  pdfBytes: Buffer;
  signers: Array<{ name: string; email: string }>;
  accountId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  personId?: string | null;
  expiresAt?: Date | null;
}): Promise<{ request: SigRequestRow; signers: SigSignerRow[] }> {
  // Signature blocks go on the last page of the document.
  let lastPageIndex = 0;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(new Uint8Array(args.pdfBytes));
    lastPageIndex = Math.max(0, proxy.numPages - 1);
  } catch {
    // Unparseable PDFs fall back to page 0; DocuSeal will still reject
    // truly broken files at template creation.
  }
  const template = await createTemplateFromPdf({
    name: args.title,
    fileName: args.fileName,
    pdfBytes: args.pdfBytes,
    signerCount: args.signers.length,
    lastPageIndex,
  });
  const created = await createSubmission({
    templateId: template.id,
    signers: args.signers,
    message: args.message ?? null,
    subject: `Signature requested: ${args.title}`,
    expiresAt: args.expiresAt ?? null,
  });

  const reqId = rid("sig");
  const [request] = await db
    .insert(atelierSignatureRequests)
    .values({
      id: reqId,
      orgId: args.orgId,
      title: args.title,
      message: args.message ?? null,
      documentId: args.documentId,
      documentVersionId: args.documentVersionId,
      accountId: args.accountId ?? null,
      opportunityId: args.opportunityId ?? null,
      contactId: args.contactId ?? null,
      personId: args.personId ?? null,
      status: "sent",
      docusealTemplateId: String(template.id),
      docusealSubmissionId: String(created.submissionId),
      expiresAt: args.expiresAt ?? null,
      createdBy: args.actor.id,
      createdByLabel: args.actor.name,
      lastSyncedAt: new Date(),
    })
    .returning();

  // Match DocuSeal submitters back to our signer list by email + order.
  const byEmail = new Map<string, number[]>();
  for (const sub of created.submitters) {
    const key = sub.email.toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), sub.id]);
  }
  const signerRows: SigSignerRow[] = [];
  for (let i = 0; i < args.signers.length; i++) {
    const s = args.signers[i];
    const ids = byEmail.get(s.email.toLowerCase()) ?? [];
    const submitterId = ids.shift();
    const [row] = await db
      .insert(atelierSignatureSigners)
      .values({
        id: rid("sgn"),
        orgId: args.orgId,
        requestId: reqId,
        name: s.name,
        email: s.email,
        signingOrder: i + 1,
        status: i === 0 ? "sent" : "pending",
        docusealSubmitterId: submitterId != null ? String(submitterId) : null,
      })
      .returning();
    signerRows.push(row);
  }

  await auditSignatureRequest({
    requestId: reqId,
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: "signature_request.send",
    payload: {
      title: args.title,
      documentId: args.documentId,
      documentVersionId: args.documentVersionId,
      accountId: args.accountId ?? null,
      opportunityId: args.opportunityId ?? null,
      contactId: args.contactId ?? null,
      personId: args.personId ?? null,
      signers: args.signers.map((s, i) => ({ order: i + 1, name: s.name, email: s.email })),
      docusealSubmissionId: String(created.submissionId),
      expiresAt: args.expiresAt?.toISOString() ?? null,
    },
    summary: `Sent "${args.title}" for signature to ${args.signers.length} signer(s) via DocuSeal`,
  });

  return { request, signers: signerRows };
}

// ---------------------------------------------------------------------------
// Sync (authoritative reconcile from DocuSeal)
// ---------------------------------------------------------------------------

function mapSubmitterStatus(s: string): string {
  switch (s) {
    case "completed":
    case "declined":
    case "opened":
    case "sent":
      return s;
    default:
      return "pending";
  }
}

function deriveRequestStatus(
  submission: DocusealSubmission,
  row: SigRequestRow,
): "sent" | "partially_signed" | "completed" | "declined" | "voided" | "expired" {
  const submitters = submission.submitters ?? [];
  if (submitters.some((s) => s.status === "declined")) return "declined";
  const done = submitters.filter((s) => s.status === "completed").length;
  if (submitters.length > 0 && done === submitters.length) return "completed";
  if (submission.status === "completed") return "completed";
  if (submission.status === "declined") return "declined";
  if (submission.archived_at || submission.status === "archived") return "voided";
  if (submission.status === "expired") return "expired";
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return "expired";
  return done > 0 ? "partially_signed" : "sent";
}

/**
 * Pull the completed signed PDF (+ audit log) into the Document Library.
 * Returns the created library document id.
 */
async function archiveCompletedDocuments(
  row: SigRequestRow,
  submission: DocusealSubmission,
): Promise<string> {
  const docs = submission.documents ?? [];
  if (docs.length === 0) {
    throw new Error("DocuSeal reported completion but returned no signed documents.");
  }
  const parts: Buffer[] = [];
  for (const d of docs) parts.push(await downloadDocusealFile(d.url));
  // DocuSeal returns one combined PDF per source document; we sent one.
  const signedPdf = parts[0];

  const baseName = row.title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "agreement";
  const result = await createDocument({
    orgId: row.orgId,
    uploader: { id: row.createdBy, name: row.createdByLabel || "E-sign" },
    title: `${row.title} (signed)`,
    category: "contract",
    accountId: row.accountId ?? null,
    engagementId: null,
    notes: `Signed via DocuSeal (submission ${row.docusealSubmissionId}). Original document: ${row.documentId}.`,
    fileName: `${baseName}_signed.pdf`,
    mime: "application/pdf",
    bytes: signedPdf,
  });
  if (!result.ok) {
    throw new Error(`Failed to archive signed PDF into the Document Library: ${result.reason}`);
  }

  // DocuSeal's combined signed file already embeds the audit-trail page;
  // when a separate audit_log_url exists we archive it as its own
  // org-level library document so the evidence chain is preserved.
  if (submission.audit_log_url) {
    const auditBytes = await downloadDocusealFile(submission.audit_log_url);
    const auditResult = await createDocument({
      orgId: row.orgId,
      uploader: { id: row.createdBy, name: row.createdByLabel || "E-sign" },
      title: `${row.title} (audit trail)`,
      category: "contract",
      accountId: row.accountId ?? null,
      engagementId: null,
      notes: `DocuSeal audit trail for submission ${row.docusealSubmissionId}.`,
      fileName: `${baseName}_audit_trail.pdf`,
      mime: "application/pdf",
      bytes: auditBytes,
    });
    if (!auditResult.ok) {
      throw new Error(
        `Failed to archive DocuSeal audit trail into the Document Library: ${auditResult.reason}`,
      );
    }
  }
  return result.document.id;
}

// Terminal transitions the requesting partner should hear about promptly.
const NOTIFY_STATUSES = ["completed", "declined", "expired"] as const;

/**
 * In-app notification to the request creator when their agreement reaches
 * a terminal state. Non-blocking: a notification failure is logged but
 * must never break (or roll back) the sync itself.
 */
async function notifyRequesterOfTerminalStatus(
  row: SigRequestRow,
  status: string,
): Promise<void> {
  if (!NOTIFY_STATUSES.includes(status as (typeof NOTIFY_STATUSES)[number])) return;
  const wording =
    status === "completed"
      ? {
          kind: "agreement_signed",
          title: `Agreement signed: ${row.title}`,
          body: `All signers have completed "${row.title}". The signed contract has been archived to the Document Library.`,
        }
      : status === "declined"
        ? {
            kind: "agreement_declined",
            title: `Agreement declined: ${row.title}`,
            body: `A signer declined "${row.title}". Open Agreements to review and follow up.`,
          }
        : {
            kind: "agreement_expired",
            title: `Agreement expired: ${row.title}`,
            body: `"${row.title}" expired before all signers completed it. Open Agreements to resend if needed.`,
          };
  try {
    // Deterministic ids keep re-syncs idempotent (terminal states never
    // regress, but belt-and-braces against double-delivery).
    await db
      .insert(atelierSelfNotifications)
      .values({
        id: `selfnotif_esign_${row.id}_${status}`,
        orgId: row.orgId,
        userId: row.createdBy,
        kind: wording.kind,
        title: wording.title,
        body: wording.body,
        href: `/agreements?request=${row.id}`,
      })
      .onConflictDoNothing({ target: atelierSelfNotifications.id });
    // On completion, a companion card links straight to the archived
    // signed contract in the Document Library.
    if (status === "completed" && row.signedDocumentId) {
      await db
        .insert(atelierSelfNotifications)
        .values({
          id: `selfnotif_esign_${row.id}_contract`,
          orgId: row.orgId,
          userId: row.createdBy,
          kind: "contract_archived",
          title: `Signed contract archived: ${row.title}`,
          body: `The signed PDF for "${row.title}" is in the Document Library as "${row.title} (signed)".`,
          href: `/documents?open=${row.signedDocumentId}`,
        })
        .onConflictDoNothing({ target: atelierSelfNotifications.id });
    }
  } catch (err) {
    console.error(
      `[esign-sync] failed to notify requester for ${row.id} (${status}):`,
      err instanceof Error ? err.message : err,
    );
  }

  // Email the requester too — partners who aren't logged in shouldn't
  // have to wait for their next visit to hear about a terminal state.
  // Fully non-blocking: any failure is logged and never breaks the sync.
  try {
    const [creator] = await db
      .select({ email: atelierUsers.email, name: atelierUsers.name })
      .from(atelierUsers)
      .where(
        and(eq(atelierUsers.orgId, row.orgId), eq(atelierUsers.id, row.createdBy)),
      );
    if (!creator?.email) {
      console.error(
        `[esign-sync] no email on file for requester ${row.createdBy} (request ${row.id}, ${status}); email not sent`,
      );
      return;
    }
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const extra =
      status === "completed"
        ? "Sign in to the portal to view it in the Document Library."
        : status === "declined"
          ? "Open Agreements in the portal to review and follow up."
          : "Open Agreements in the portal to resend if needed.";
    const result = await sendEmail({
      to: creator.email,
      subject: wording.title,
      html: `<p>Hi ${esc(creator.name || "there")},</p><p>${esc(wording.body)}</p><p>${esc(extra)}</p><p>— The Atelier</p>`,
    });
    if (!result.ok) {
      console.error(
        `[esign-sync] email notification failed for ${row.id} (${status}); delivered via ${result.via}`,
      );
    }
  } catch (err) {
    console.error(
      `[esign-sync] failed to email requester for ${row.id} (${status}):`,
      err instanceof Error ? err.message : err,
    );
  }
}

export interface SyncOutcome {
  request: SigRequestRow;
  changed: boolean;
}

/** Reconcile one request against DocuSeal. Throws on DocuSeal failure. */
export async function syncSignatureRequest(requestId: string): Promise<SyncOutcome> {
  const [row] = await db
    .select()
    .from(atelierSignatureRequests)
    .where(eq(atelierSignatureRequests.id, requestId));
  if (!row) throw new Error(`signature request not found: ${requestId}`);

  // Terminal states never regress.
  if (!OPEN_STATUSES.includes(row.status as (typeof OPEN_STATUSES)[number])) {
    return { request: row, changed: false };
  }

  let submission: DocusealSubmission;
  try {
    submission = await getSubmission(Number(row.docusealSubmissionId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(atelierSignatureRequests)
      .set({ lastSyncError: msg.slice(0, 500), updatedAt: new Date() })
      .where(eq(atelierSignatureRequests.id, row.id));
    throw err;
  }

  const nextStatus = deriveRequestStatus(submission, row);
  const now = new Date();

  // Reconcile signer rows by DocuSeal submitter id (fallback: email).
  const signers = await db
    .select()
    .from(atelierSignatureSigners)
    .where(eq(atelierSignatureSigners.requestId, row.id));
  for (const sub of submission.submitters ?? []) {
    const match =
      signers.find((s) => s.docusealSubmitterId === String(sub.id)) ??
      signers.find(
        (s) =>
          s.email.toLowerCase() === sub.email.toLowerCase() &&
          s.docusealSubmitterId == null,
      );
    if (!match) continue;
    const mapped = mapSubmitterStatus(sub.status);
    if (
      match.status !== mapped ||
      match.docusealSubmitterId !== String(sub.id)
    ) {
      await db
        .update(atelierSignatureSigners)
        .set({
          status: mapped,
          docusealSubmitterId: String(sub.id),
          openedAt: sub.opened_at ? new Date(sub.opened_at) : match.openedAt,
          completedAt: sub.completed_at ? new Date(sub.completed_at) : match.completedAt,
          declinedAt: sub.declined_at ? new Date(sub.declined_at) : match.declinedAt,
          lastPayload: sub as unknown as Record<string, unknown>,
          updatedAt: now,
        })
        .where(eq(atelierSignatureSigners.id, match.id));
    }
  }

  let signedDocumentId = row.signedDocumentId;
  if (nextStatus === "completed" && !signedDocumentId) {
    signedDocumentId = await archiveCompletedDocuments(row, submission);
  }

  const changed = nextStatus !== row.status || signedDocumentId !== row.signedDocumentId;
  const [updated] = await db
    .update(atelierSignatureRequests)
    .set({
      status: nextStatus,
      signedDocumentId,
      completedAt: nextStatus === "completed" ? (row.completedAt ?? now) : row.completedAt,
      declinedAt: nextStatus === "declined" ? (row.declinedAt ?? now) : row.declinedAt,
      lastSyncError: null,
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(atelierSignatureRequests.id, row.id))
    .returning();

  if (changed && nextStatus !== row.status) {
    await notifyRequesterOfTerminalStatus(updated, nextStatus);
  }

  if (changed) {
    await auditSignatureRequest({
      requestId: row.id,
      actorType: "system",
      actorId: "docuseal-sync",
      actorLabel: "DocuSeal sync",
      action: "signature_request.status",
      payload: {
        from: row.status,
        to: nextStatus,
        signedDocumentId: signedDocumentId ?? null,
        docusealSubmissionId: row.docusealSubmissionId,
      },
      summary: `Signature request "${row.title}" moved ${row.status} → ${nextStatus}`,
    });
  }
  return { request: updated, changed };
}

/** Find our request row for a DocuSeal submission id (webhook entry). */
export async function findRequestBySubmissionId(
  submissionId: string,
): Promise<SigRequestRow | null> {
  const [row] = await db
    .select()
    .from(atelierSignatureRequests)
    .where(eq(atelierSignatureRequests.docusealSubmissionId, submissionId));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Void / remind
// ---------------------------------------------------------------------------

export async function voidSignatureRequest(args: {
  row: SigRequestRow;
  actor: { id: string; name: string };
}): Promise<SigRequestRow> {
  await archiveSubmission(Number(args.row.docusealSubmissionId));
  const now = new Date();
  const [updated] = await db
    .update(atelierSignatureRequests)
    .set({ status: "voided", voidedAt: now, updatedAt: now, lastSyncError: null })
    .where(eq(atelierSignatureRequests.id, args.row.id))
    .returning();
  await auditSignatureRequest({
    requestId: args.row.id,
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: "signature_request.void",
    payload: { docusealSubmissionId: args.row.docusealSubmissionId },
    summary: `Voided signature request "${args.row.title}"`,
  });
  return updated;
}

export async function remindSignatureRequest(args: {
  row: SigRequestRow;
  actor: { id: string; name: string };
  actorType?: "human" | "system";
}): Promise<{ reminded: number }> {
  const signers = await db
    .select()
    .from(atelierSignatureSigners)
    .where(eq(atelierSignatureSigners.requestId, args.row.id));
  const pending = signers.filter(
    (s) => s.status !== "completed" && s.status !== "declined" && s.docusealSubmitterId,
  );
  if (pending.length === 0) return { reminded: 0 };
  for (const s of pending) {
    await resendSubmitterEmail(Number(s.docusealSubmitterId));
  }
  await db
    .update(atelierSignatureRequests)
    .set({ lastRemindedAt: new Date(), updatedAt: new Date() })
    .where(eq(atelierSignatureRequests.id, args.row.id));
  await auditSignatureRequest({
    requestId: args.row.id,
    actorType: args.actorType ?? "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: "signature_request.remind",
    payload: { reminded: pending.map((s) => s.email), automatic: args.actorType === "system" },
    summary: `${args.actorType === "system" ? "Auto-sent" : "Sent"} reminder to ${pending.length} signer(s) for "${args.row.title}"`,
  });
  return { reminded: pending.length };
}

// ---------------------------------------------------------------------------
// Automatic reminders
// ---------------------------------------------------------------------------

/**
 * Days a request may sit pending before signers are automatically
 * re-emailed (and between subsequent automatic reminders). Configurable
 * via ESIGN_AUTO_REMIND_DAYS; `0` disables automatic reminders.
 */
export function autoRemindAfterDays(): number {
  const raw = process.env.ESIGN_AUTO_REMIND_DAYS;
  if (raw == null || raw.trim() === "") return 3;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 3;
  return Math.floor(n);
}

/**
 * Re-send signer emails on every open request that has been waiting
 * longer than the configured threshold since it was sent (or since the
 * last reminder, manual or automatic). Runs from the polling loop after
 * the status sync pass, so freshly-completed requests are never nagged.
 * Requests already past their expiry are skipped — the sync pass lapses
 * them instead.
 */
export async function autoRemindOverdueRequests(now = new Date()): Promise<{
  reminded: number;
  failures: Array<{ requestId: string; error: string }>;
}> {
  const days = autoRemindAfterDays();
  if (days === 0) return { reminded: 0, failures: [] };
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(atelierSignatureRequests)
    .where(inArray(atelierSignatureRequests.status, [...OPEN_STATUSES]));

  let reminded = 0;
  const failures: Array<{ requestId: string; error: string }> = [];
  for (const row of rows) {
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) continue;
    const lastTouch = row.lastRemindedAt ?? row.createdAt;
    if (lastTouch.getTime() > cutoff.getTime()) continue;
    try {
      const out = await remindSignatureRequest({
        row,
        actor: { id: "esign-auto-remind", name: "Automatic reminder" },
        actorType: "system",
      });
      if (out.reminded > 0) reminded++;
    } catch (err) {
      failures.push({
        requestId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { reminded, failures };
}

// ---------------------------------------------------------------------------
// Polling fallback
// ---------------------------------------------------------------------------

/**
 * Reconcile every open request. Used by the interval poller and by the
 * manual "Refresh statuses" action. Per-request failures are recorded on
 * the row and reported, never swallowed silently.
 */
export async function syncAllOpenRequests(): Promise<{
  synced: number;
  changed: number;
  failures: Array<{ requestId: string; error: string }>;
}> {
  const rows = await db
    .select({ id: atelierSignatureRequests.id })
    .from(atelierSignatureRequests)
    .where(inArray(atelierSignatureRequests.status, [...OPEN_STATUSES]));
  let changed = 0;
  const failures: Array<{ requestId: string; error: string }> = [];
  for (const r of rows) {
    try {
      const out = await syncSignatureRequest(r.id);
      if (out.changed) changed++;
    } catch (err) {
      failures.push({
        requestId: r.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { synced: rows.length, changed, failures };
}

let pollTimer: NodeJS.Timeout | null = null;

/** Start the polling fallback (no-op when already running or in tests). */
export function startEsignPolling(intervalMs = 5 * 60_000): void {
  if (pollTimer) return;
  if (process.env.NODE_ENV === "test") return;
  pollTimer = setInterval(() => {
    if (!process.env.DOCUSEAL_API_KEY) return;
    void syncAllOpenRequests()
      .then((out) => {
        for (const f of out.failures) {
          console.error(`[esign-poll] sync failed for ${f.requestId}: ${f.error}`);
        }
        // Auto-remind AFTER the sync pass so requests that just
        // completed/declined/expired are never nagged.
        return autoRemindOverdueRequests();
      })
      .then((out) => {
        if (out.reminded > 0) {
          console.log(`[esign-poll] auto-reminded ${out.reminded} pending request(s)`);
        }
        for (const f of out.failures) {
          console.error(`[esign-poll] auto-remind failed for ${f.requestId}: ${f.error}`);
        }
      })
      .catch((err) => {
        console.error(
          "[esign-poll] pass failed:",
          err instanceof Error ? err.message : err,
        );
      });
  }, intervalMs);
  pollTimer.unref?.();
}
