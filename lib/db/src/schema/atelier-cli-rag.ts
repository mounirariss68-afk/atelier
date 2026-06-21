/**
 * Task #411 — Atelier Chat RAG (capability + entity embeddings).
 *
 * Two embedding tables drive the production architecture:
 *
 *   atelier_capability_embeddings  — one row per registered capability
 *     (toolName). Populated at process boot from the catalog. Used by
 *     the per-turn capability retriever to pick the top-K tools the
 *     model actually sees, instead of handing it all 107.
 *
 *   atelier_entity_embeddings      — one row per resolvable entity in
 *     the orchestrator coverage set (account / opportunity / contact /
 *     engagement / deliverable / meeting / proposal / pov / ...).
 *     Populated lazily on entity write via the audit hook (and by a
 *     background backfill on first boot). Used as the pgvector ANN
 *     fallback in the hybrid `resolve_entity` resolver, behind the
 *     pg_trgm exact / near-exact pass.
 *
 * Vector storage: a real pgvector column when the `vector` extension
 * is installed (production); a `jsonb` shadow column otherwise so the
 * schema can be `pnpm db:push`ed in environments where the extension
 * is unavailable. The retriever reads whichever column is populated;
 * the embedding helper writes both during the rollout window.
 *
 * Vector dim is 1536 (OpenAI text-embedding-3-small) by default. A
 * shorter deterministic fallback is used when no embedding provider
 * is configured — see embeddings.ts.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Task #575 — Document-chunk embeddings (production RAG).
 *
 * One row per chunk of an ingested CLI attachment. Populated on ingest
 * (embed-on-ingest) and by a boot backfill. Drives authorized
 * semantic + hybrid (pg_trgm) document retrieval. The ACL columns
 * (orgId / accountId / engagementId / uploaderUserId / kind) are
 * denormalised onto the row so retrieval can filter by persona scope in
 * SQL before any vector ever leaves the database.
 *
 * Vector storage mirrors the capability/entity tables: `vec` is the
 * jsonb source of truth; atelier-cli-rag.sql adds a real pgvector
 * column + HNSW index when the extension is present (it is, 0.8.0).
 */
export const atelierDocumentChunkEmbeddings = pgTable(
  "atelier_document_chunk_embeddings",
  {
    /** `<attachmentId>#cNNN` — stable, immutable chunk id. */
    chunkId: text("chunk_id").primaryKey(),
    orgId: text("org_id").notNull().default("aico"),
    attachmentId: text("attachment_id").notNull(),
    fileName: text("file_name").notNull(),
    /** DocKind: pdf | docx | xlsx | csv | pptx | image | eml | text | unknown */
    kind: text("kind").notNull(),
    /** ACL scope (nullable when the attachment is not account/engagement bound). */
    accountId: text("account_id"),
    engagementId: text("engagement_id"),
    /** Persona who uploaded the source attachment (ownership ACL). */
    uploaderUserId: text("uploader_user_id"),
    /** Char offsets into the extracted document text. */
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    /** Short human summary (first sentence) for citations / digests. */
    summary: text("summary").notNull(),
    /** The chunk text that was embedded (redaction happens at read time). */
    text: text("text").notNull(),
    provider: text("provider").notNull(),
    dim: integer("dim").notNull(),
    vec: jsonb("vec").$type<number[]>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_chunk_emb_attachment").on(t.attachmentId),
    index("idx_atelier_chunk_emb_org").on(t.orgId),
    index("idx_atelier_chunk_emb_account").on(t.orgId, t.accountId),
    index("idx_atelier_chunk_emb_engagement").on(t.orgId, t.engagementId),
    index("idx_atelier_chunk_emb_uploader").on(t.orgId, t.uploaderUserId),
    index("idx_atelier_chunk_emb_provider").on(t.provider),
  ],
);

export const atelierCapabilityEmbeddings = pgTable(
  "atelier_capability_embeddings",
  {
    capabilityId: text("capability_id").primaryKey(),
    toolName: text("tool_name").notNull(),
    /** Canonical text fed to the embedder (description + prompts). */
    summaryText: text("summary_text").notNull(),
    /** Provider id, e.g. "openai:text-embedding-3-small" or "fallback:hashbow-768". */
    provider: text("provider").notNull(),
    /** Vector dim of `vec`. */
    dim: integer("dim").notNull(),
    /** Vector as JSON array (number[]). pgvector mirror is added by atelier-cli-rag.sql when available. */
    vec: jsonb("vec").$type<number[]>().notNull(),
    schemaHash: text("schema_hash").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_cap_emb_tool").on(t.toolName),
    index("idx_atelier_cap_emb_provider").on(t.provider),
  ],
);

export const atelierEntityEmbeddings = pgTable(
  "atelier_entity_embeddings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default("aico"),
    /** account | opportunity | engagement | contact | deliverable | meeting | proposal | pov | partner_firm | win_theme | win_loss_debrief | brief | agent_design | rate_card | renewal | contract | invoice | timesheet_entry | change_order | raid_item | expense */
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    /** Display label used by resolver disambiguation cards. */
    label: text("label").notNull(),
    /** Free-text summary the embedder ingests (label + secondary fields). */
    summaryText: text("summary_text").notNull(),
    provider: text("provider").notNull(),
    dim: integer("dim").notNull(),
    vec: jsonb("vec").$type<number[]>().notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_atelier_ent_emb_target").on(t.kind, t.targetId, t.orgId),
    index("idx_atelier_ent_emb_org_kind").on(t.orgId, t.kind),
  ],
);
