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
import { sendEmail, getBrandedFromAddress } from "./email.js";
import {
  createTemplateFromPdf,
  createSubmission,
  getSubmission,
  archiveSubmission,
  resendSubmitterEmail,
  submitterEmbedSrc,
  downloadDocusealFile,
  type DocusealSubmission,
  type SignaturePlacement,
  type ExtraSignerField,
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

/**
 * Thrown when custom placements target pages beyond page 1 but the PDF's
 * page count could not be determined from either the server-side parse or
 * the client-reported count. Routes map this to a 400.
 */
export class PageCountUnknownError extends Error {
  constructor() {
    super(
      "The PDF's page count could not be determined, so signature boxes beyond page 1 cannot be verified. Re-open the placement editor or place boxes on page 1.",
    );
    this.name = "PageCountUnknownError";
  }
}

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
// Branded signer invites (Task #514)
//
// New requests are created with DocuSeal's own emails disabled
// (send_email: false) and Atelier emails signers itself from the
// Cognirise address via the Resend-backed sendEmail helper. Sequential
// signing is preserved: only the currently-actionable signer (lowest
// signing order with every earlier signer completed) is ever invited,
// and the next one is emailed by the sync pass once the prior signer
// completes. Delivery is recorded honestly on the signer row:
// "delivered" only when Resend actually accepted the email — a log-only
// send counts as "undelivered" and the UI offers the signing link.
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The signer who may act now: lowest order, all earlier ones completed. */
export function currentActionableSigner(signers: SigSignerRow[]): SigSignerRow | null {
  const ordered = [...signers].sort((a, b) => a.signingOrder - b.signingOrder);
  for (const s of ordered) {
    if (s.status === "completed") continue;
    if (s.status === "declined") return null;
    return s;
  }
  return null;
}

/**
 * Live signing link for one signer — slugs are never persisted, so the
 * submission is re-fetched from DocuSeal. Returns null when the signer
 * cannot be matched or DocuSeal provides no link.
 */
export async function signerSigningLink(
  row: SigRequestRow,
  signer: SigSignerRow,
): Promise<string | null> {
  const submission = await getSubmission(Number(row.docusealSubmissionId));
  const sub =
    (submission.submitters ?? []).find(
      (s) => signer.docusealSubmitterId != null && String(s.id) === signer.docusealSubmitterId,
    ) ??
    (submission.submitters ?? []).find(
      (s) => s.email.toLowerCase() === signer.email.toLowerCase(),
    );
  return sub ? submitterEmbedSrc(sub) : null;
}

/**
 * Send (or re-send) the Cognirise-branded invite email to one signer and
 * record the delivery outcome on the signer row. Never throws — email
 * failure must not fail the send/sync; it is surfaced via
 * invite_email_status instead.
 */
async function deliverBrandedInvite(args: {
  row: SigRequestRow;
  signer: SigSignerRow;
  signingLink: string | null;
  reminder?: boolean;
}): Promise<"delivered" | "undelivered"> {
  const { row, signer, signingLink } = args;
  let status: "delivered" | "undelivered" = "undelivered";
  // Branded invites must come from a validated Cognirise address — never
  // the onboarding/dev fallback sender. No valid address = undelivered.
  const brandedFrom = await getBrandedFromAddress().catch(() => null);
  if (!signingLink) {
    console.error(
      `[esign-email] no signing link available for signer ${signer.id} on request ${row.id}; invite not sent`,
    );
  } else if (!brandedFrom) {
    console.error(
      `[esign-email] invite to ${signer.email} for ${row.id} NOT sent: no valid branded from-address configured (set RESEND_BRANDED_FROM or RESEND_FROM to a real address) — surface the signing link to the sender`,
    );
  } else {
    try {
      const intro = args.reminder
        ? `This is a reminder that your signature is still needed on <strong>${esc(row.title)}</strong>.`
        : `You have been asked to review and sign <strong>${esc(row.title)}</strong>.`;
      const message = row.message
        ? `<p style="white-space:pre-wrap;">${esc(row.message)}</p>`
        : "";
      const expiry = row.expiresAt
        ? `<p>This request expires on ${row.expiresAt.toISOString().slice(0, 10)}.</p>`
        : "";
      const result = await sendEmail({
        from: brandedFrom,
        to: signer.email,
        subject: `${args.reminder ? "Reminder — signature" : "Signature"} requested: ${row.title}`,
        html:
          `<p>Dear ${esc(signer.name || "Signer")},</p>` +
          `<p>${intro}</p>` +
          message +
          `<p><a href="${signingLink}" style="display:inline-block;padding:10px 18px;background:#101828;color:#ffffff;text-decoration:none;border-radius:6px;">Review &amp; sign</a></p>` +
          `<p>Or open this link directly:<br/><a href="${signingLink}">${signingLink}</a></p>` +
          expiry +
          `<p>Kind regards,<br/>Cognirise</p>`,
      });
      // Honest delivery semantics: only a real Resend send counts.
      status = result.ok && result.via === "resend" ? "delivered" : "undelivered";
      if (status === "undelivered") {
        console.error(
          `[esign-email] invite to ${signer.email} for ${row.id} NOT delivered (via ${result.via}) — surface the signing link to the sender`,
        );
      }
    } catch (err) {
      console.error(
        `[esign-email] invite to ${signer.email} for ${row.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  await db
    .update(atelierSignatureSigners)
    .set({ inviteEmailStatus: status, inviteEmailAt: new Date(), updatedAt: new Date() })
    .where(eq(atelierSignatureSigners.id, signer.id));
  return status;
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
  /**
   * Sender-chosen signature boxes, one per signer in signing order
   * (normalized page-fraction coords, 1-based page). When omitted the
   * default two-column layout on the last page is used. Pages beyond
   * the document's actual page count are clamped to the last page.
   */
  placements?: SignaturePlacement[] | null;
  /**
   * Optional extra date/initials boxes tied to signers by 0-based
   * index. Pages beyond the document's page count are clamped.
   */
  extraFields?: ExtraSignerField[] | null;
  /**
   * Page count reported by the sender's client (pdf.js). Used as the
   * clamp bound only when the server itself cannot parse the PDF.
   */
  clientPageCount?: number | null;
}): Promise<{ request: SigRequestRow; signers: SigSignerRow[] }> {
  // Default: signature blocks go on the last page of the document.
  let lastPageIndex = 0;
  let pageCount: number | null = null;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(new Uint8Array(args.pdfBytes));
    pageCount = proxy.numPages;
    lastPageIndex = Math.max(0, proxy.numPages - 1);
  } catch {
    // Unparseable PDFs: fall back to the client-reported page count (if
    // any) so custom placements can still be clamped to real pages.
    // DocuSeal will still reject truly broken files at template creation.
    if (
      typeof args.clientPageCount === "number" &&
      Number.isInteger(args.clientPageCount) &&
      args.clientPageCount >= 1
    ) {
      pageCount = args.clientPageCount;
      lastPageIndex = args.clientPageCount - 1;
    }
  }
  // Clamp custom placements to real pages. When the page count is unknown
  // from BOTH sources, a placement beyond page 1 is rejected rather than
  // passed through — DocuSeal behavior for out-of-range pages is undefined
  // and the box could silently land nowhere.
  if (
    pageCount == null &&
    args.placements?.some((p) => Math.max(1, Math.round(p.page)) > 1)
  ) {
    throw new PageCountUnknownError();
  }
  const placements =
    args.placements && args.placements.length > 0
      ? args.placements.map((p) => ({
          ...p,
          page:
            pageCount != null
              ? Math.min(Math.max(1, p.page), pageCount)
              : Math.max(1, p.page),
        }))
      : null;
  const extraFields =
    args.extraFields && args.extraFields.length > 0
      ? args.extraFields.map((f) => ({
          ...f,
          page:
            pageCount != null
              ? Math.min(Math.max(1, f.page), pageCount)
              : Math.max(1, f.page),
        }))
      : null;
  const template = await createTemplateFromPdf({
    name: args.title,
    fileName: args.fileName,
    pdfBytes: args.pdfBytes,
    signerCount: args.signers.length,
    lastPageIndex,
    placements,
    extraFields,
  });
  const created = await createSubmission({
    templateId: template.id,
    signers: args.signers,
    message: args.message ?? null,
    subject: `Signature requested: ${args.title}`,
    expiresAt: args.expiresAt ?? null,
    // Task #514 — Atelier emails signers itself (Cognirise-branded).
    sendEmail: false,
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
      emailMode: "branded",
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

  // Task #514 — invite the FIRST signer only (sequential signing); the
  // sync pass invites the next signer once the prior one completes. The
  // signing link comes straight from the creation response so no extra
  // DocuSeal round-trip is needed here.
  if (signerRows.length > 0) {
    const first = signerRows[0];
    const sub =
      created.submitters.find(
        (s) => first.docusealSubmitterId != null && String(s.id) === first.docusealSubmitterId,
      ) ??
      created.submitters.find((s) => s.email.toLowerCase() === first.email.toLowerCase());
    const outcome = await deliverBrandedInvite({
      row: request,
      signer: first,
      signingLink: sub ? submitterEmbedSrc(sub) : null,
    });
    first.inviteEmailStatus = outcome;
    first.inviteEmailAt = new Date();
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
      placements: placements ?? null,
      extraFields: extraFields ?? null,
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
        href: `/contracts/signatures?request=${row.id}`,
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

  // Task #514 — branded sequential invites: once the prior signer has
  // completed, email the next actionable signer (exactly once — the
  // null invite_email_status is the idempotency guard). The signing
  // link comes from the submission already fetched above.
  if (
    row.emailMode === "branded" &&
    OPEN_STATUSES.includes(nextStatus as (typeof OPEN_STATUSES)[number])
  ) {
    const freshSigners = await db
      .select()
      .from(atelierSignatureSigners)
      .where(eq(atelierSignatureSigners.requestId, row.id));
    const actionable = currentActionableSigner(freshSigners);
    if (actionable && actionable.inviteEmailStatus == null) {
      const sub =
        (submission.submitters ?? []).find(
          (s) =>
            actionable.docusealSubmitterId != null &&
            String(s.id) === actionable.docusealSubmitterId,
        ) ??
        (submission.submitters ?? []).find(
          (s) => s.email.toLowerCase() === actionable.email.toLowerCase(),
        );
      await deliverBrandedInvite({
        row: updated,
        signer: actionable,
        signingLink: sub ? submitterEmbedSrc(sub) : null,
      });
    }
  }

  if (changed && nextStatus !== row.status) {
    await notifyRequesterOfTerminalStatus(updated, nextStatus);
  }

  if (changed) {
    // Task #159 — flip any linked contract record on terminal statuses.
    const { syncContractFromSignatureRequest } = await import("./atelier-contracts.js");
    // Task #306 — the submission carries each submitter's typed values;
    // on completion the contract sync merges the counterparty's answers
    // into the contract record's fieldValues.
    await syncContractFromSignatureRequest(updated, submission);
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
  // Task #159 — flip any linked contract record to voided.
  const { syncContractFromSignatureRequest } = await import("./atelier-contracts.js");
  await syncContractFromSignatureRequest(updated);
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
  let pending: SigSignerRow[];
  if (args.row.emailMode === "branded") {
    // Task #514 — branded requests: re-send OUR Cognirise email to the
    // currently-actionable signer only (sequential signing; later
    // signers must not be nudged before their turn).
    const actionable = currentActionableSigner(signers);
    pending = actionable ? [actionable] : [];
    if (pending.length === 0) return { reminded: 0 };
    const link = await signerSigningLink(args.row, pending[0]);
    await deliverBrandedInvite({
      row: args.row,
      signer: pending[0],
      signingLink: link,
      reminder: true,
    });
  } else {
    pending = signers.filter(
      (s) => s.status !== "completed" && s.status !== "declined" && s.docusealSubmitterId,
    );
    if (pending.length === 0) return { reminded: 0 };
    for (const s of pending) {
      await resendSubmitterEmail(Number(s.docusealSubmitterId));
    }
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
