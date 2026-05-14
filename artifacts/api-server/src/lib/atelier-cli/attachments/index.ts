/**
 * Task #334 — CLI attachment ingest pipeline.
 *
 * Public surface used by the `POST /cli/attachments` route and by the
 * capability-tool runners (`ingest_*`, `fetch_document_chunk`,
 * `qualify_opportunity_rubric`):
 *
 *   ingestAttachment   — validate → store → extract → chunk → persist
 *   loadAttachment     — fetch the (attachment, extracted) pair by id
 *   loadChunk          — resolve a chunkId without re-extracting
 *   wrapAttachmentForModel — produce the safe `<attachment>` block
 *
 * Validation policy: 25 MB hard cap; whitelisted MIME families
 * (PDF/DOCX/XLSX/CSV/PPTX/IMG/EML/TEXT). Anything else is recorded
 * with status='rejected' + `cli_attachment.reject` audit so the user
 * sees it on the timeline.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  atelierCliAttachments,
  atelierExtractedDocuments,
  atelierAuditEvents,
} from "@workspace/db";
import { createHash } from "node:crypto";
import { storeAttachmentBytes, loadAttachmentBytes } from "./storage.js";

function createSha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
import { extractAttachment, type ExtractedDoc, type DocKind } from "./extractors.js";
import { chunkDocument, findChunkById, type DocChunk, type DocDigest } from "./chunking.js";
import { detectIntent, topIntent, type DocIntent } from "./intent-detect.js";
import { wrapAttachment } from "../prompt-guard.js";

const MAX_BYTES = 25 * 1024 * 1024;
const WHITELIST = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
  "message/rfc822",
]);

function isWhitelisted(mime: string): boolean {
  if (WHITELIST.has(mime)) return true;
  if (mime.startsWith("image/")) return true;
  return false;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface IngestArgs {
  orgId: string;
  userId: string;
  userLabel: string;
  sessionId?: string | null;
  turnId?: string | null;
  fileName: string;
  mime: string;
  bytes: Buffer;
}

export interface IngestResultOk {
  ok: true;
  attachmentId: string;
  encryptedRef: string;
  kind: DocKind;
  intent: DocIntent;
  intents: ReturnType<typeof detectIntent>;
  digest: DocDigest;
  chunkCount: number;
  warnings: string[];
}
export interface IngestResultRejected {
  ok: false;
  attachmentId: string;
  reason: string;
}

export async function ingestAttachment(
  args: IngestArgs,
): Promise<IngestResultOk | IngestResultRejected> {
  const id = rid("clatt");

  // Reject early ----------------------------------------------------------
  if (args.bytes.byteLength === 0) {
    await persistRejection(args, id, "empty-file");
    return { ok: false, attachmentId: id, reason: "empty-file" };
  }
  if (args.bytes.byteLength > MAX_BYTES) {
    await persistRejection(args, id, `over-size-cap:${MAX_BYTES}`);
    return { ok: false, attachmentId: id, reason: "over-size-cap" };
  }
  if (!isWhitelisted(args.mime)) {
    await persistRejection(args, id, `mime-not-allowed:${args.mime}`);
    return { ok: false, attachmentId: id, reason: "mime-not-allowed" };
  }

  // Idempotency: identical bytes uploaded by the same org reuse the
  // existing attachment + extracted-doc rather than minting a fresh
  // row. SHA-256 of the bytes is the dedupe key. We *do* still record
  // a fresh `cli_attachment.upload` audit row so the timeline reflects
  // the new submission, but no new blob is stored and the extraction
  // is not re-run.
  const sha256 = createSha(args.bytes);
  const [existing] = await db
    .select()
    .from(atelierCliAttachments)
    .where(
      and(
        eq(atelierCliAttachments.orgId, args.orgId),
        eq(atelierCliAttachments.sha256, sha256),
        eq(atelierCliAttachments.status, "extracted"),
      ),
    )
    .limit(1);
  if (existing) {
    const [xdoc] = await db
      .select()
      .from(atelierExtractedDocuments)
      .where(eq(atelierExtractedDocuments.attachmentId, existing.id));
    if (xdoc) {
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "atelier_cli_attachment",
        entityId: existing.id,
        actorType: "human",
        actorId: args.userId,
        actorLabel: args.userLabel,
        action: "cli_attachment.upload",
        payload: {
          fileName: args.fileName,
          mime: args.mime,
          sizeBytes: args.bytes.byteLength,
          sha256,
          sessionId: args.sessionId ?? null,
          turnId: args.turnId ?? null,
          dedupedFromAttachmentId: existing.id,
        },
        payloadSummary: `Re-uploaded ${args.fileName} (deduped to ${existing.id})`,
      });
      return {
        ok: true,
        attachmentId: existing.id,
        encryptedRef: existing.encryptedRef,
        kind: xdoc.kind as DocKind,
        intent: (existing.intentHint ?? "unknown") as IngestResultOk["intent"],
        intents: [],
        digest: (xdoc.digest ?? { toc: "", chunkSummaries: [] }) as IngestResultOk["digest"],
        chunkCount: (xdoc.chunks ?? []).length,
        warnings: (xdoc.warnings ?? []) as string[],
      };
    }
  }

  // Store + extract -------------------------------------------------------
  const stored = storeAttachmentBytes(args.bytes);
  const extracted: ExtractedDoc = extractAttachment({
    fileName: args.fileName,
    mime: args.mime,
    bytes: args.bytes,
  });
  const intents = detectIntent(extracted);
  const intent = intents[0]?.intent ?? "unknown";
  const { chunks, digest } = chunkDocument({
    attachmentId: id,
    text: extracted.normalizedText,
  });

  await db.insert(atelierCliAttachments).values({
    id,
    orgId: args.orgId,
    userId: args.userId,
    sessionId: args.sessionId ?? null,
    turnId: args.turnId ?? null,
    fileName: args.fileName,
    mime: args.mime,
    sizeBytes: stored.sizeBytes,
    sha256: stored.sha256,
    encryptedRef: stored.encryptedRef,
    status: "extracted",
    intentHint: intent,
  });
  await db.insert(atelierExtractedDocuments).values({
    id: rid("xdoc"),
    orgId: args.orgId,
    attachmentId: id,
    kind: extracted.kind,
    normalizedText: extracted.normalizedText,
    tableSummary: extracted.tableSummary,
    slideTexts: extracted.slideTexts,
    emailHeaders: extracted.emailHeaders,
    chunks,
    digest,
    warnings: extracted.warnings,
  });

  // Two audit rows: upload (registers the attachment) + extract (binds
  // the detected intent + chunk count to the cli_turn or session for
  // downstream observability).
  await db.insert(atelierAuditEvents).values([
    {
      id: rid("aud"),
      entityType: "atelier_cli_attachment",
      entityId: id,
      actorType: "human",
      actorId: args.userId,
      actorLabel: args.userLabel,
      action: "cli_attachment.upload",
      payload: {
        fileName: args.fileName,
        mime: args.mime,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        sessionId: args.sessionId ?? null,
        turnId: args.turnId ?? null,
      },
      payloadSummary: `Uploaded ${args.fileName} (${stored.sizeBytes} bytes)`,
    },
    {
      id: rid("aud"),
      entityType: "atelier_cli_attachment",
      entityId: id,
      actorType: "system",
      actorId: "atelier-cli",
      actorLabel: "Atelier CLI extractor",
      action: "cli_attachment.extract",
      payload: {
        kind: extracted.kind,
        intent,
        intents,
        chunkCount: chunks.length,
        warnings: extracted.warnings,
      },
      payloadSummary: `Extracted ${extracted.kind} (${chunks.length} chunks, intent=${intent})`,
    },
  ]);

  return {
    ok: true,
    attachmentId: id,
    encryptedRef: stored.encryptedRef,
    kind: extracted.kind,
    intent,
    intents,
    digest,
    chunkCount: chunks.length,
    warnings: extracted.warnings,
  };
}

async function persistRejection(
  args: IngestArgs,
  id: string,
  reason: string,
): Promise<void> {
  await db.insert(atelierCliAttachments).values({
    id,
    orgId: args.orgId,
    userId: args.userId,
    sessionId: args.sessionId ?? null,
    turnId: args.turnId ?? null,
    fileName: args.fileName,
    mime: args.mime,
    sizeBytes: args.bytes.byteLength,
    sha256: "",
    encryptedRef: "",
    status: "rejected",
    rejectionReason: reason,
  });
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "atelier_cli_attachment",
    entityId: id,
    actorType: "human",
    actorId: args.userId,
    actorLabel: args.userLabel,
    action: "cli_attachment.reject",
    payload: { reason, fileName: args.fileName, mime: args.mime, size: args.bytes.byteLength },
    payloadSummary: `Rejected ${args.fileName}: ${reason}`,
  });
}

export interface LoadedAttachment {
  attachment: typeof atelierCliAttachments.$inferSelect;
  extracted: typeof atelierExtractedDocuments.$inferSelect | null;
}

/**
 * Org-scoped lookup. Callers MUST pass `orgId` (their persona's org).
 * A missing `orgId` is a programming error — log loudly so a
 * forgotten guard never silently crosses tenants. The legacy
 * unscoped form (omit `orgId`) is reserved for the upload route's
 * GET endpoint, which does its own org check.
 */
export async function loadAttachment(
  attachmentId: string,
  orgId?: string,
): Promise<LoadedAttachment | null> {
  const where =
    orgId === undefined
      ? eq(atelierCliAttachments.id, attachmentId)
      : and(
          eq(atelierCliAttachments.id, attachmentId),
          eq(atelierCliAttachments.orgId, orgId),
        );
  const [att] = await db.select().from(atelierCliAttachments).where(where);
  if (!att) return null;
  const [xdoc] = await db
    .select()
    .from(atelierExtractedDocuments)
    .where(eq(atelierExtractedDocuments.attachmentId, attachmentId));
  return { attachment: att, extracted: xdoc ?? null };
}

export async function loadChunk(args: {
  attachmentId: string;
  chunkId: string;
  orgId: string;
}): Promise<{ chunk: DocChunk; kind: DocKind } | null> {
  const loaded = await loadAttachment(args.attachmentId, args.orgId);
  if (!loaded?.extracted) return null;
  const chunks = (loaded.extracted.chunks ?? []) as DocChunk[];
  const chunk = findChunkById(chunks, args.chunkId);
  if (!chunk) return null;
  return { chunk, kind: loaded.extracted.kind as DocKind };
}

/** Build the inert `<attachment>` model block for an attachment id. */
export async function wrapAttachmentForModel(
  attachmentId: string,
  orgId: string,
): Promise<string | null> {
  const loaded = await loadAttachment(attachmentId, orgId);
  if (!loaded?.extracted) return null;
  const digest = (loaded.extracted.digest ?? null) as DocDigest | null;
  const intent = loaded.attachment.intentHint ?? "unknown";
  const body = [
    `kind: ${loaded.extracted.kind}`,
    `intent: ${intent}`,
    `chunks: ${(loaded.extracted.chunks ?? []).length} (use fetch_document_chunk to read one)`,
    digest ? digest.toc : "",
  ]
    .filter(Boolean)
    .join("\n");
  return wrapAttachment(loaded.attachment.fileName, body);
}

export { detectIntent, topIntent, loadAttachmentBytes };
export type { DocIntent, DocChunk, DocDigest, DocKind };
