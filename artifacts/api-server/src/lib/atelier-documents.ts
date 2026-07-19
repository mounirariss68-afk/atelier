/**
 * Task #61 — Document Library core.
 *
 * Externally-produced files (proposals, deliverables, contracts,
 * templates) uploaded into Atelier. Blobs live in private object storage
 * (`enc:doc:<key>`), metadata/versions/grants live in Postgres, and every
 * readable version is routed through the existing extraction → chunking →
 * embedding pipeline so `searchDocumentChunks` can retrieve it. Chunk
 * rows are keyed on the VERSION id (the `attachment_id` column of
 * atelier_document_chunk_embeddings), so superseding a version = purging
 * the old version's chunk rows.
 *
 * Blob dedupe: identical bytes (same org + sha256) share one stored
 * object. Deletion therefore refcounts: a blob is only dropped when no
 * other live version row references the same blobRef.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql, desc } from "drizzle-orm";
import {
  db,
  atelierDocuments,
  atelierDocumentVersions,
  atelierDocumentAccess,
  atelierAuditEvents,
} from "@workspace/db";
import { objectStorageClient } from "./objectStorage.js";
import { extractAttachment, intakeRejection } from "./atelier-cli/attachments/extractors.js";
import { sanitizeMetadata } from "./atelier-cli/attachments/sanitize.js";
import { chunkDocument } from "./atelier-cli/attachments/chunking.js";
import {
  persistChunkEmbeddings,
  purgeChunkEmbeddings,
} from "./atelier-cli/attachments/retrieval.js";
import type { DocKind } from "./atelier-cli/attachments/extractors.js";

export const DOC_ENC_PREFIX = "enc:doc:";
const BLOB_SUBDIR = "atelier-documents";

/** Larger cap than chat attachments — deliverables can be heavy decks. */
export const DOC_MAX_BYTES = 50 * 1024 * 1024;

export const DOC_CATEGORIES = [
  "proposal",
  "client_deliverable",
  "contract",
  "template",
  "corporate_legal",
  "other",
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

const MIME_WHITELIST = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
  "message/rfc822",
]);

export function documentMimeRejection(args: {
  fileName: string;
  mime: string;
}): string | null {
  const hardening = intakeRejection(args);
  if (hardening) return hardening;
  if (MIME_WHITELIST.has(args.mime)) return null;
  if (args.mime.startsWith("image/")) return null;
  return `mime-not-allowed:${args.mime}`;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Blob storage (dedupe by sha, refcounted delete)
// ---------------------------------------------------------------------------

function resolveTarget(): { bucketName: string; basePrefix: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — object storage is required for the Document Library.",
    );
  }
  const trimmed = dir.startsWith("/") ? dir.slice(1) : dir;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { bucketName: trimmed, basePrefix: BLOB_SUBDIR };
  return {
    bucketName: trimmed.slice(0, slash),
    basePrefix: `${trimmed.slice(slash + 1).replace(/\/+$/, "")}/${BLOB_SUBDIR}`,
  };
}

function objectNameForKey(key: string): { bucketName: string; objectName: string } {
  const { bucketName, basePrefix } = resolveTarget();
  return { bucketName, objectName: `${basePrefix}/${key}` };
}

async function storeDocBytes(buf: Buffer): Promise<{ blobRef: string; sha256: string }> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const key = `${sha256.slice(0, 16)}_${randomBytes(4).toString("hex")}`;
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buf, { resumable: false, contentType: "application/octet-stream" });
  return { blobRef: `${DOC_ENC_PREFIX}${key}`, sha256 };
}

export async function loadDocBytes(blobRef: string): Promise<Buffer | null> {
  if (!blobRef.startsWith(DOC_ENC_PREFIX)) return null;
  const key = blobRef.slice(DOC_ENC_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  try {
    const [contents] = await objectStorageClient.bucket(bucketName).file(objectName).download();
    return contents;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null;
    throw err;
  }
}

async function dropDocBytes(blobRef: string): Promise<void> {
  if (!blobRef.startsWith(DOC_ENC_PREFIX)) return;
  const key = blobRef.slice(DOC_ENC_PREFIX.length);
  const { bucketName, objectName } = objectNameForKey(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .delete({ ignoreNotFound: true });
}

/** Drop a blob only if no OTHER live version row still references it. */
async function dropBlobIfUnreferenced(blobRef: string, excludeVersionIds: string[]): Promise<void> {
  const others = await db
    .select({ id: atelierDocumentVersions.id })
    .from(atelierDocumentVersions)
    .where(eq(atelierDocumentVersions.blobRef, blobRef))
    .limit(excludeVersionIds.length + 1);
  const exclude = new Set(excludeVersionIds);
  if (others.some((v) => !exclude.has(v.id))) return;
  await dropDocBytes(blobRef);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function auditDocument(args: {
  documentId: string;
  actorId: string;
  actorLabel: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "atelier_document",
    entityId: args.documentId,
    actorType: "human",
    actorId: args.actorId,
    actorLabel: args.actorLabel,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ---------------------------------------------------------------------------
// RAG ingestion for one version
// ---------------------------------------------------------------------------

interface RagResult {
  kind: DocKind;
  chunkCount: number;
  warnings: string[];
}

/**
 * Extract + chunk + embed one version's bytes. Documents are NOT
 * rejected on unreadable content (download is the primary purpose);
 * unreadable versions simply produce zero chunks. Embedding failures
 * are recorded as warnings, never thrown — the blob and metadata are
 * already durable.
 */
async function ingestVersionForRag(args: {
  orgId: string;
  versionId: string;
  fileName: string;
  mime: string;
  bytes: Buffer;
  uploaderUserId: string;
  accountId: string | null;
  engagementId: string | null;
  aiRetrieval: boolean;
}): Promise<RagResult> {
  const warnings: string[] = [];
  let kind: DocKind = "unknown";
  let chunkCount = 0;
  try {
    const extracted = await extractAttachment({
      fileName: args.fileName,
      mime: args.mime,
      bytes: args.bytes,
    });
    kind = extracted.kind;
    warnings.push(...extracted.warnings);
    if (extracted.normalizedText.trim().length > 0) {
      const { chunks } = await chunkDocument({
        attachmentId: args.versionId,
        text: extracted.normalizedText,
      });
      if (chunks.length > 0) {
        await persistChunkEmbeddings({
          orgId: args.orgId,
          attachmentId: args.versionId,
          fileName: args.fileName,
          kind,
          uploaderUserId: args.uploaderUserId,
          scope: { accountId: args.accountId, engagementId: args.engagementId },
          chunks,
        });
        chunkCount = chunks.length;
        if (!args.aiRetrieval) {
          await setVersionRetrievable(args.versionId, false);
        }
      }
    }
  } catch (err) {
    warnings.push(
      `rag-ingest-failed:${err instanceof Error ? err.message.slice(0, 120) : "error"}`,
    );
  }
  return { kind, chunkCount, warnings };
}

async function setVersionRetrievable(versionId: string, on: boolean): Promise<void> {
  await db.execute(sql`
    UPDATE atelier_document_chunk_embeddings
    SET retrievable = ${on}, updated_at = now()
    WHERE attachment_id = ${versionId}
  `);
}

// ---------------------------------------------------------------------------
// Create / version / update / delete
// ---------------------------------------------------------------------------

/**
 * Task #287 — legal-function document kinds for entity-linked documents.
 * Drives the three-tier presentation on the entity detail page
 * (constitutional / active compliance / formation history). Null docKind
 * = unclassified (always surfaced, never hidden).
 */
export const DOC_KINDS = [
  "trade_license",
  "commercial_register",
  "chamber_membership",
  "establishment_card",
  "initial_approval",
  "follow_up_receipt",
  "memorandum_of_association",
  "ejari_tenancy",
  "tax_registration",
  "other",
] as const;
export type LegalDocKind = (typeof DOC_KINDS)[number];

export interface DocumentUploadArgs {
  orgId: string;
  uploader: { id: string; name: string };
  title: string;
  category: DocCategory;
  accountId?: string | null;
  engagementId?: string | null;
  entityId?: string | null;
  docKind?: LegalDocKind | null;
  aiRetrieval?: boolean;
  notes?: string | null;
  fileName: string;
  mime: string;
  bytes: Buffer;
}

export async function createDocument(args: DocumentUploadArgs): Promise<
  | { ok: true; document: typeof atelierDocuments.$inferSelect; version: typeof atelierDocumentVersions.$inferSelect; rag: RagResult }
  | { ok: false; reason: string }
> {
  if (args.bytes.byteLength === 0) return { ok: false, reason: "empty-file" };
  if (args.bytes.byteLength > DOC_MAX_BYTES) return { ok: false, reason: "over-size-cap" };
  const reject = documentMimeRejection({ fileName: args.fileName, mime: args.mime });
  if (reject) return { ok: false, reason: reject };

  const sanitized = sanitizeMetadata({
    fileName: args.fileName,
    mime: args.mime,
    bytes: args.bytes,
  });
  const bytes = sanitized.bytes;
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Blob dedupe (blobs, not document records): reuse an existing stored
  // object when the same bytes already live under this org.
  const [dupe] = await db
    .select({ blobRef: atelierDocumentVersions.blobRef })
    .from(atelierDocumentVersions)
    .where(
      and(
        eq(atelierDocumentVersions.orgId, args.orgId),
        eq(atelierDocumentVersions.sha256, sha256),
      ),
    )
    .limit(1);
  const blobRef = dupe ? dupe.blobRef : (await storeDocBytes(bytes)).blobRef;

  const docId = rid("doc");
  const verId = rid("dver");
  const aiRetrieval = args.aiRetrieval !== false;

  const rag = await ingestVersionForRag({
    orgId: args.orgId,
    versionId: verId,
    fileName: args.fileName,
    mime: args.mime,
    bytes,
    uploaderUserId: args.uploader.id,
    accountId: args.accountId ?? null,
    engagementId: args.engagementId ?? null,
    aiRetrieval,
  });

  const [doc] = await db
    .insert(atelierDocuments)
    .values({
      id: docId,
      orgId: args.orgId,
      title: args.title,
      category: args.category,
      accountId: args.accountId ?? null,
      engagementId: args.engagementId ?? null,
      entityId: args.entityId ?? null,
      docKind: args.docKind ?? null,
      uploaderUserId: args.uploader.id,
      uploaderLabel: args.uploader.name,
      currentVersionId: verId,
      aiRetrieval,
      notes: args.notes ?? null,
    })
    .returning();
  const [version] = await db
    .insert(atelierDocumentVersions)
    .values({
      id: verId,
      orgId: args.orgId,
      documentId: docId,
      versionNumber: 1,
      fileName: args.fileName,
      mime: args.mime,
      sizeBytes: bytes.byteLength,
      sha256,
      blobRef,
      uploaderUserId: args.uploader.id,
      extractedKind: rag.kind,
      chunkCount: rag.chunkCount,
      extractionWarnings: rag.warnings,
    })
    .returning();

  await auditDocument({
    documentId: docId,
    actorId: args.uploader.id,
    actorLabel: args.uploader.name,
    action: "document.upload",
    payload: {
      title: args.title,
      category: args.category,
      accountId: args.accountId ?? null,
      engagementId: args.engagementId ?? null,
      fileName: args.fileName,
      mime: args.mime,
      sizeBytes: bytes.byteLength,
      sha256,
      dedupedBlob: !!dupe,
      chunkCount: rag.chunkCount,
      aiRetrieval,
    },
    summary: `Uploaded document "${args.title}" (${args.fileName}, ${bytes.byteLength} bytes, ${rag.chunkCount} chunks)`,
  });

  return { ok: true, document: doc, version, rag };
}

export async function addDocumentVersion(args: {
  orgId: string;
  document: typeof atelierDocuments.$inferSelect;
  uploader: { id: string; name: string };
  fileName: string;
  mime: string;
  bytes: Buffer;
}): Promise<
  | { ok: true; version: typeof atelierDocumentVersions.$inferSelect; rag: RagResult }
  | { ok: false; reason: string }
> {
  if (args.bytes.byteLength === 0) return { ok: false, reason: "empty-file" };
  if (args.bytes.byteLength > DOC_MAX_BYTES) return { ok: false, reason: "over-size-cap" };
  const reject = documentMimeRejection({ fileName: args.fileName, mime: args.mime });
  if (reject) return { ok: false, reason: reject };

  const doc = args.document;
  const sanitized = sanitizeMetadata({
    fileName: args.fileName,
    mime: args.mime,
    bytes: args.bytes,
  });
  const bytes = sanitized.bytes;
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const [dupe] = await db
    .select({ blobRef: atelierDocumentVersions.blobRef })
    .from(atelierDocumentVersions)
    .where(
      and(
        eq(atelierDocumentVersions.orgId, args.orgId),
        eq(atelierDocumentVersions.sha256, sha256),
      ),
    )
    .limit(1);
  const blobRef = dupe ? dupe.blobRef : (await storeDocBytes(bytes)).blobRef;

  const [latest] = await db
    .select({ versionNumber: atelierDocumentVersions.versionNumber })
    .from(atelierDocumentVersions)
    .where(eq(atelierDocumentVersions.documentId, doc.id))
    .orderBy(desc(atelierDocumentVersions.versionNumber))
    .limit(1);
  const nextNumber = (latest?.versionNumber ?? 0) + 1;

  const verId = rid("dver");
  const rag = await ingestVersionForRag({
    orgId: args.orgId,
    versionId: verId,
    fileName: args.fileName,
    mime: args.mime,
    bytes,
    uploaderUserId: args.uploader.id,
    accountId: doc.accountId,
    engagementId: doc.engagementId,
    aiRetrieval: doc.aiRetrieval,
  });

  const [version] = await db
    .insert(atelierDocumentVersions)
    .values({
      id: verId,
      orgId: args.orgId,
      documentId: doc.id,
      versionNumber: nextNumber,
      fileName: args.fileName,
      mime: args.mime,
      sizeBytes: bytes.byteLength,
      sha256,
      blobRef,
      uploaderUserId: args.uploader.id,
      extractedKind: rag.kind,
      chunkCount: rag.chunkCount,
      extractionWarnings: rag.warnings,
    })
    .returning();

  // Supersede: the prior current version's chunks leave retrieval.
  if (doc.currentVersionId && doc.currentVersionId !== verId) {
    await purgeChunkEmbeddings(doc.currentVersionId);
  }
  await db
    .update(atelierDocuments)
    .set({ currentVersionId: verId, updatedAt: new Date() })
    .where(eq(atelierDocuments.id, doc.id));

  await auditDocument({
    documentId: doc.id,
    actorId: args.uploader.id,
    actorLabel: args.uploader.name,
    action: "document.version_upload",
    payload: {
      versionId: verId,
      versionNumber: nextNumber,
      fileName: args.fileName,
      sizeBytes: bytes.byteLength,
      sha256,
      dedupedBlob: !!dupe,
      chunkCount: rag.chunkCount,
      supersededVersionId: doc.currentVersionId,
    },
    summary: `Uploaded v${nextNumber} of "${doc.title}" (${args.fileName})`,
  });

  return { ok: true, version, rag };
}

/** Flip the per-document AI-retrieval toggle (also flips chunk rows). */
export async function setDocumentAiRetrieval(args: {
  document: typeof atelierDocuments.$inferSelect;
  on: boolean;
  actor: { id: string; name: string };
}): Promise<void> {
  await db
    .update(atelierDocuments)
    .set({ aiRetrieval: args.on, updatedAt: new Date() })
    .where(eq(atelierDocuments.id, args.document.id));
  if (args.document.currentVersionId) {
    await setVersionRetrievable(args.document.currentVersionId, args.on);
  }
  await auditDocument({
    documentId: args.document.id,
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: "document.update",
    payload: { aiRetrieval: args.on },
    summary: `${args.on ? "Enabled" : "Disabled"} AI retrieval for "${args.document.title}"`,
  });
}

/**
 * Full purge of one document: chunk embeddings for every version, blobs
 * (refcounted), version rows, grants, and a soft-deleted document row
 * (kept for the audit trail). Idempotent.
 */
export async function purgeDocument(args: {
  orgId: string;
  documentId: string;
  actor: { id: string; name: string };
  /** Suppress the per-document audit row (bulk scope purges write their own). */
  silent?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const [doc] = await db
    .select()
    .from(atelierDocuments)
    .where(
      and(eq(atelierDocuments.id, args.documentId), eq(atelierDocuments.orgId, args.orgId)),
    );
  if (!doc) return { ok: false, reason: "not_found" };
  if (doc.status === "deleted") return { ok: true };

  const versions = await db
    .select()
    .from(atelierDocumentVersions)
    .where(eq(atelierDocumentVersions.documentId, doc.id));
  const versionIds = versions.map((v) => v.id);

  let purgedChunks = 0;
  for (const vid of versionIds) purgedChunks += await purgeChunkEmbeddings(vid);

  const uniqueBlobs = [...new Set(versions.map((v) => v.blobRef))];
  if (versionIds.length > 0) {
    await db
      .delete(atelierDocumentVersions)
      .where(inArray(atelierDocumentVersions.id, versionIds));
  }
  for (const blobRef of uniqueBlobs) {
    await dropBlobIfUnreferenced(blobRef, versionIds);
  }
  await db
    .update(atelierDocumentAccess)
    .set({ status: "revoked" })
    .where(eq(atelierDocumentAccess.documentId, doc.id));
  await db
    .update(atelierDocuments)
    .set({ status: "deleted", deletedAt: new Date(), currentVersionId: null })
    .where(eq(atelierDocuments.id, doc.id));

  if (!args.silent) {
    await auditDocument({
      documentId: doc.id,
      actorId: args.actor.id,
      actorLabel: args.actor.name,
      action: "document.delete",
      payload: { title: doc.title, versions: versionIds.length, purgedChunks },
      summary: `Deleted document "${doc.title}" (${versionIds.length} versions, ${purgedChunks} chunks purged)`,
    });
  }
  return { ok: true };
}

/**
 * Parent-entity deletion lifecycle: purge every library document scoped
 * to an account or engagement. Refuses to run without a scope predicate.
 */
export async function purgeDocumentsByScope(args: {
  orgId: string;
  accountId?: string;
  engagementId?: string;
  actorId: string;
  actorLabel: string;
}): Promise<{ documents: number }> {
  if (!args.accountId && !args.engagementId) return { documents: 0 };
  const conds = [
    eq(atelierDocuments.orgId, args.orgId),
    eq(atelierDocuments.status, "active"),
  ];
  if (args.accountId) conds.push(eq(atelierDocuments.accountId, args.accountId));
  if (args.engagementId) conds.push(eq(atelierDocuments.engagementId, args.engagementId));
  const docs = await db
    .select({ id: atelierDocuments.id, title: atelierDocuments.title })
    .from(atelierDocuments)
    .where(and(...conds));
  for (const d of docs) {
    await purgeDocument({
      orgId: args.orgId,
      documentId: d.id,
      actor: { id: args.actorId, name: args.actorLabel },
      silent: true,
    });
    await auditDocument({
      documentId: d.id,
      actorId: args.actorId,
      actorLabel: args.actorLabel,
      action: "document.delete",
      payload: {
        title: d.title,
        cascade: true,
        accountId: args.accountId ?? null,
        engagementId: args.engagementId ?? null,
      },
      summary: `Purged document "${d.title}" with its parent ${args.accountId ? "account" : "engagement"}`,
    });
  }
  return { documents: docs.length };
}

/** Active grant lookup (org-level document ACL). */
export async function hasDocumentGrant(documentId: string, userId: string): Promise<boolean> {
  const [g] = await db
    .select({ id: atelierDocumentAccess.id })
    .from(atelierDocumentAccess)
    .where(
      and(
        eq(atelierDocumentAccess.documentId, documentId),
        eq(atelierDocumentAccess.userId, userId),
        eq(atelierDocumentAccess.status, "active"),
      ),
    )
    .limit(1);
  return !!g;
}
