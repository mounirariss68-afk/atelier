/**
 * Task #575 — Authorized document-chunk store + hybrid retrieval.
 *
 * This module owns the `atelier_document_chunk_embeddings` table:
 *
 *   persistChunkEmbeddings  — embed (batched) + upsert chunk rows on
 *                             ingest; also populates the pgvector
 *                             `embedding` column for HNSW ANN.
 *   purgeChunkEmbeddings    — delete by attachment (deletion lifecycle).
 *   purgeChunksByPredicate  — bulk delete by account / engagement.
 *   searchDocumentChunks    — authorized semantic + lexical (hybrid)
 *                             retrieval with persona ACL enforced in SQL
 *                             and PII redaction applied at read time.
 *   backfillChunkEmbeddings — boot backfill for attachments missing
 *                             rows or embedded under a stale provider
 *                             (handles the dim/provider migration).
 *
 * Vectors are produced by the local offline model (embeddings.ts). No
 * LLM is involved here. Generation stays on Claude downstream.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  atelierDocumentChunkEmbeddings,
  atelierCliAttachments,
  atelierExtractedDocuments,
} from "@workspace/db";
import {
  embedText,
  embedTexts,
  currentProvider,
  EMBED_DIM,
} from "../embeddings.js";
import { redactText } from "../pii-redaction.js";
import { attachmentMentionsDestructive } from "../prompt-guard.js";
import type { DocChunk } from "./chunking.js";
import type { DocKind } from "./extractors.js";

/** Roles that may read every document in their org (no per-doc ACL). */
const DOC_PRIVILEGED_ROLES = new Set(["founding_partner", "partner"]);

export interface ChunkScope {
  accountId?: string | null;
  engagementId?: string | null;
}

/** Format a number[] as a pgvector literal: `[a,b,c]`. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Embed and persist all chunks for one attachment. Re-ingest safe:
 * existing rows for the attachment are removed first so there is never a
 * stale/duplicate chunk set. Embedding is batched; the pgvector column
 * is populated from the jsonb mirror in a single follow-up UPDATE.
 */
export async function persistChunkEmbeddings(args: {
  orgId: string;
  attachmentId: string;
  fileName: string;
  kind: DocKind;
  uploaderUserId: string | null;
  scope?: ChunkScope;
  chunks: DocChunk[];
}): Promise<{ embedded: number }> {
  await db
    .delete(atelierDocumentChunkEmbeddings)
    .where(eq(atelierDocumentChunkEmbeddings.attachmentId, args.attachmentId));

  if (args.chunks.length === 0) return { embedded: 0 };

  const provider = currentProvider();
  const embeddings = await embedTexts(args.chunks.map((c) => c.text));

  const rows = args.chunks.map((c, i) => ({
    chunkId: c.chunkId,
    orgId: args.orgId,
    attachmentId: args.attachmentId,
    fileName: args.fileName,
    kind: args.kind,
    accountId: args.scope?.accountId ?? null,
    engagementId: args.scope?.engagementId ?? null,
    uploaderUserId: args.uploaderUserId,
    charStart: c.charStart,
    charEnd: c.charEnd,
    summary: c.summary,
    text: c.text,
    provider,
    dim: EMBED_DIM,
    vec: embeddings[i].vec,
  }));

  // Insert in batches to keep parameter counts sane.
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(atelierDocumentChunkEmbeddings).values(rows.slice(i, i + BATCH));
  }

  // Populate the pgvector column from the jsonb mirror (no-op when the
  // extension/column is absent — guarded by to_regclass on the column).
  await populateEmbeddingColumn(args.attachmentId);

  return { embedded: rows.length };
}

/** Copy jsonb `vec` → pgvector `embedding` for an attachment's rows. */
async function populateEmbeddingColumn(attachmentId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE atelier_document_chunk_embeddings
      SET embedding = (vec::text)::vector
      WHERE attachment_id = ${attachmentId}
        AND embedding IS NULL
    `);
  } catch (err) {
    // The `embedding` column only exists when pgvector is installed. In
    // that case ANN falls back to brute-force cosine over jsonb. Never
    // fail ingest because the optional column is missing.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/column .*embedding.* does not exist|type "vector" does not exist/i.test(msg)) {
      throw err;
    }
  }
}

export async function purgeChunkEmbeddings(attachmentId: string): Promise<number> {
  const res = await db
    .delete(atelierDocumentChunkEmbeddings)
    .where(eq(atelierDocumentChunkEmbeddings.attachmentId, attachmentId))
    .returning({ id: atelierDocumentChunkEmbeddings.chunkId });
  return res.length;
}

export async function purgeChunksByPredicate(args: {
  orgId: string;
  accountId?: string;
  engagementId?: string;
}): Promise<number> {
  const conds = [eq(atelierDocumentChunkEmbeddings.orgId, args.orgId)];
  if (args.accountId) conds.push(eq(atelierDocumentChunkEmbeddings.accountId, args.accountId));
  if (args.engagementId)
    conds.push(eq(atelierDocumentChunkEmbeddings.engagementId, args.engagementId));
  const res = await db
    .delete(atelierDocumentChunkEmbeddings)
    .where(and(...conds))
    .returning({ id: atelierDocumentChunkEmbeddings.chunkId });
  return res.length;
}

/**
 * Stamp account/engagement scope onto an attachment's chunk rows. Upload
 * happens before a document is linked to an entity, so chunks are born
 * uploader-scoped (null account/engagement); when an ingest capability
 * links the document to an opportunity/engagement, we record that scope
 * here so authorized members of that account/engagement can retrieve it
 * (and so a parent-entity delete can purge it). Org-scoped.
 */
export async function setChunkScope(args: {
  orgId: string;
  attachmentId: string;
  accountId?: string | null;
  engagementId?: string | null;
}): Promise<number> {
  const patch: { accountId?: string; engagementId?: string } = {};
  if (args.accountId) patch.accountId = args.accountId;
  if (args.engagementId) patch.engagementId = args.engagementId;
  if (Object.keys(patch).length === 0) return 0;
  const res = await db
    .update(atelierDocumentChunkEmbeddings)
    .set(patch)
    .where(
      and(
        eq(atelierDocumentChunkEmbeddings.orgId, args.orgId),
        eq(atelierDocumentChunkEmbeddings.attachmentId, args.attachmentId),
      ),
    )
    .returning({ id: atelierDocumentChunkEmbeddings.chunkId });
  return res.length;
}

/** Distinct attachment ids whose chunks fall under an account/engagement scope. */
export async function attachmentIdsByScope(args: {
  orgId: string;
  accountId?: string;
  engagementId?: string;
}): Promise<string[]> {
  const conds = [eq(atelierDocumentChunkEmbeddings.orgId, args.orgId)];
  if (args.accountId) conds.push(eq(atelierDocumentChunkEmbeddings.accountId, args.accountId));
  if (args.engagementId)
    conds.push(eq(atelierDocumentChunkEmbeddings.engagementId, args.engagementId));
  if (conds.length === 1) return []; // no scope predicate → refuse a table-wide match
  const rows = await db
    .selectDistinct({ attachmentId: atelierDocumentChunkEmbeddings.attachmentId })
    .from(atelierDocumentChunkEmbeddings)
    .where(and(...conds));
  return rows.map((r) => r.attachmentId);
}

// ---------------------------------------------------------------------------
// Authorized hybrid retrieval
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  chunkId: string;
  attachmentId: string;
  fileName: string;
  kind: string;
  charStart: number;
  charEnd: number;
  summary: string;
  /** Redacted chunk text (safe to inject). */
  text: string;
  score: number;
  /** Citation label, e.g. `report.pdf#c004`. */
  citation: string;
  /** True when the chunk text contains destructive verbs (injection guard). */
  mentionsDestructive: boolean;
}

interface RawHit {
  chunk_id: string;
  attachment_id: string;
  file_name: string;
  kind: string;
  char_start: number;
  char_end: number;
  summary: string;
  text: string;
  score: number;
  [key: string]: unknown;
}

/**
 * Build the persona ACL predicate over the chunk table. Privileged
 * roles see every doc in their org; everyone else is limited to docs
 * they uploaded plus docs scoped to an account/engagement they can
 * access. The predicate is applied in SQL so unauthorized vectors never
 * leave the database.
 */
async function aclPredicate(persona: {
  id: string;
  role: string;
}): Promise<ReturnType<typeof sql> | null> {
  if (DOC_PRIVILEGED_ROLES.has(persona.role)) return null; // no extra filter

  // Lazy import to avoid a hard cycle with the routes layer.
  const { accessibleEngagementIds } = await import(
    "../../../routes/atelier/engagementRoutes.js"
  );
  const acl = await accessibleEngagementIds({
    id: persona.id,
    role: persona.role,
  } as Parameters<typeof accessibleEngagementIds>[0]);

  if (acl.all === true) {
    // Can see all engagements → effectively org-wide for scoped docs,
    // but still hide other people's unscoped personal uploads.
    return sql`(uploader_user_id = ${persona.id} OR engagement_id IS NOT NULL OR account_id IS NOT NULL)`;
  }

  const engIds = [...acl.ids];
  // Accounts the persona can see: partner-owned OR have an accessible engagement.
  let accountIds: string[] = [];
  if (engIds.length > 0) {
    const accs = await db.execute<{ account_id: string }>(sql`
      SELECT DISTINCT account_id FROM atelier_engagements
      WHERE id IN ${engIds} AND account_id IS NOT NULL
    `);
    accountIds = accs.rows.map((r) => r.account_id);
  }
  const owned = await db.execute<{ id: string }>(sql`
    SELECT id FROM atelier_accounts WHERE partner_owner_id = ${persona.id}
  `);
  accountIds.push(...owned.rows.map((r) => r.id));

  const engClause =
    engIds.length > 0 ? sql`engagement_id IN ${engIds}` : sql`false`;
  const accClause =
    accountIds.length > 0 ? sql`account_id IN ${accountIds}` : sql`false`;
  return sql`(uploader_user_id = ${persona.id} OR ${engClause} OR ${accClause})`;
}

/**
 * Authorized hybrid retrieval: pgvector ANN (semantic) fused with a
 * pg_trgm lexical pass via Reciprocal Rank Fusion. ACL + org + provider
 * filters run in SQL; PII redaction is applied to every returned chunk.
 */
export async function searchDocumentChunks(args: {
  persona: { id: string; role: string; orgId: string };
  query: string;
  limit?: number;
  /** Optional narrowing to specific attachment ids. */
  attachmentIds?: string[];
  /**
   * Recent conversation context for multi-turn query rewriting. When
   * present it is prepended to the query before embedding so a follow-up
   * like "what about its budget?" resolves its referent and retrieves the
   * right chunks instead of embedding a context-free fragment. It only
   * shapes the semantic vector; the lexical pass still matches the raw
   * query so the hint cannot dilute keyword precision.
   */
  contextHint?: string;
}): Promise<RetrievedChunk[]> {
  const q = (args.query ?? "").trim();
  if (!q) return [];
  const k = Math.min(Math.max(args.limit ?? 8, 1), 50);
  const provider = currentProvider();

  // Query rewriting: fold recent conversation context into the embedded
  // query only.
  const hint = (args.contextHint ?? "").trim();
  const embedQuery = hint ? `${hint}\n${q}` : q;

  // Embed once, up front and OUTSIDE any try/catch. If the local model
  // cannot load this throws and the whole retrieval fails loudly — we
  // never silently degrade to a lexical-only answer (Task #575 spec).
  const qvec = (await embedText(embedQuery)).vec;

  const acl = await aclPredicate(args.persona);
  const aclSql = acl ? sql` AND ${acl}` : sql``;
  const attClause =
    args.attachmentIds && args.attachmentIds.length > 0
      ? sql` AND attachment_id IN ${args.attachmentIds}`
      : sql``;

  // --- semantic (ANN) ---
  let semantic: RawHit[] = [];
  try {
    const lit = toVectorLiteral(qvec);
    const res = await db.execute<RawHit>(sql`
      SELECT chunk_id, attachment_id, file_name, kind, char_start, char_end,
             summary, text,
             1 - (embedding <=> ${lit}::vector) AS score
      FROM atelier_document_chunk_embeddings
      WHERE org_id = ${args.persona.orgId}
        AND provider = ${provider}
        AND embedding IS NOT NULL${aclSql}${attClause}
      ORDER BY embedding <=> ${lit}::vector
      LIMIT ${k * 3}
    `);
    semantic = res.rows;
  } catch (err) {
    // pgvector missing → brute-force cosine over the jsonb vector mirror.
    // Reuses the already-computed query vector (no re-embed), so a model
    // failure has already surfaced above rather than here.
    semantic = await bruteForceCosine({
      persona: args.persona,
      qvec,
      k: k * 3,
      aclSql,
      attClause,
      provider,
    });
  }

  // --- lexical (trgm) ---
  let lexical: RawHit[] = [];
  try {
    const res = await db.execute<RawHit>(sql`
      SELECT chunk_id, attachment_id, file_name, kind, char_start, char_end,
             summary, text,
             similarity(text, ${q}) AS score
      FROM atelier_document_chunk_embeddings
      WHERE org_id = ${args.persona.orgId}
        AND provider = ${provider}
        AND text % ${q}${aclSql}${attClause}
      ORDER BY score DESC
      LIMIT ${k * 3}
    `);
    lexical = res.rows;
  } catch {
    lexical = [];
  }

  // --- Reciprocal Rank Fusion ---
  const RRF_K = 60;
  const fused = new Map<string, { hit: RawHit; score: number }>();
  const fold = (list: RawHit[]) => {
    list.forEach((hit, rank) => {
      const inc = 1 / (RRF_K + rank + 1);
      const prev = fused.get(hit.chunk_id);
      if (prev) prev.score += inc;
      else fused.set(hit.chunk_id, { hit, score: inc });
    });
  };
  fold(semantic);
  fold(lexical);

  const ranked = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);
  return ranked.map(({ hit, score }) => {
    const redacted = redactText(hit.text).text;
    const cnum = hit.chunk_id.split("#").pop() ?? hit.chunk_id;
    return {
      chunkId: hit.chunk_id,
      attachmentId: hit.attachment_id,
      fileName: hit.file_name,
      kind: hit.kind,
      charStart: hit.char_start,
      charEnd: hit.char_end,
      summary: redactText(hit.summary).text,
      text: redacted,
      score,
      citation: `${hit.file_name}#${cnum}`,
      mentionsDestructive: attachmentMentionsDestructive(hit.text),
    };
  });
}

/** Cosine fallback used only when pgvector is unavailable. */
async function bruteForceCosine(args: {
  persona: { id: string; role: string; orgId: string };
  qvec: number[];
  k: number;
  aclSql: ReturnType<typeof sql>;
  attClause: ReturnType<typeof sql>;
  provider: string;
}): Promise<RawHit[]> {
  const { cosine } = await import("../embeddings.js");
  const qvec = args.qvec;
  const res = await db.execute<RawHit & { vec: unknown }>(sql`
    SELECT chunk_id, attachment_id, file_name, kind, char_start, char_end,
           summary, text, vec
    FROM atelier_document_chunk_embeddings
    WHERE org_id = ${args.persona.orgId}
      AND provider = ${args.provider}${args.aclSql}${args.attClause}
  `);
  return res.rows
    .map((r) => {
      const v = Array.isArray(r.vec) ? (r.vec as number[]) : [];
      return { ...r, score: cosine(qvec, v) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, args.k);
}

// ---------------------------------------------------------------------------
// Boot backfill + provider migration
// ---------------------------------------------------------------------------

/**
 * Embed chunks for every extracted document that has no chunk rows under
 * the current provider. Covers both first-run population and the
 * dim/provider migration (old 1536-dim rows under a different provider
 * are replaced). Returns the number of attachments (re)embedded.
 */
export async function backfillChunkEmbeddings(opts?: {
  limit?: number;
}): Promise<{ attachments: number; chunks: number }> {
  const provider = currentProvider();
  // Attachments whose extracted doc has chunks but no current-provider
  // chunk-embedding rows.
  const candidates = await db.execute<{
    attachment_id: string;
    org_id: string;
    file_name: string;
    kind: string;
    user_id: string;
    chunks: unknown;
  }>(sql`
    SELECT a.id AS attachment_id, a.org_id, a.file_name, x.kind,
           a.user_id, x.chunks
    FROM atelier_cli_attachments a
    JOIN atelier_extracted_documents x ON x.attachment_id = a.id
    WHERE a.status = 'extracted'
      AND a.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM atelier_document_chunk_embeddings e
        WHERE e.attachment_id = a.id AND e.provider = ${provider}
      )
    ${opts?.limit ? sql`LIMIT ${opts.limit}` : sql``}
  `);

  let attachments = 0;
  let chunks = 0;
  for (const row of candidates.rows) {
    const docChunks = (Array.isArray(row.chunks) ? row.chunks : []) as DocChunk[];
    if (docChunks.length === 0) continue;
    const { embedded } = await persistChunkEmbeddings({
      orgId: row.org_id,
      attachmentId: row.attachment_id,
      fileName: row.file_name,
      kind: row.kind as DocKind,
      uploaderUserId: row.user_id,
      chunks: docChunks,
    });
    attachments += 1;
    chunks += embedded;
  }
  return { attachments, chunks };
}

/** Count current-provider chunk rows (used by tests/observability). */
export async function countChunkRows(orgId?: string): Promise<number> {
  const where = orgId
    ? and(
        eq(atelierDocumentChunkEmbeddings.orgId, orgId),
        eq(atelierDocumentChunkEmbeddings.provider, currentProvider()),
      )
    : eq(atelierDocumentChunkEmbeddings.provider, currentProvider());
  const rows = await db
    .select({ id: atelierDocumentChunkEmbeddings.chunkId })
    .from(atelierDocumentChunkEmbeddings)
    .where(where);
  return rows.length;
}

export const __retrievalTesting = { toVectorLiteral };
