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
