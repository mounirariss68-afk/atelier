/**
 * Task #61 — Document Library.
 *
 * First-class document store for externally-produced files (proposals,
 * deliverables, contracts, templates). Blobs live in private object
 * storage (never in DB rows); these tables hold metadata, versions and
 * per-person access grants.
 *
 *   atelier_documents          — one row per logical document. Optional
 *     account/engagement scope (org-level when both are null). Carries
 *     the AI-retrieval toggle and a source/external-ref pair so a future
 *     OneDrive/SharePoint sync can mark synced records without a schema
 *     change.
 *   atelier_document_versions  — immutable version rows. `blobRef` is the
 *     object-storage pointer (`enc:doc:<key>`); blobs are deduped by
 *     sha256 across versions, so deletion refcounts before dropping.
 *     Chunk embeddings are keyed on the VERSION id (attachment_id column
 *     of atelier_document_chunk_embeddings), so a new version supersedes
 *     the prior version's chunks by purging them.
 *   atelier_document_access    — per-person grants for org-level
 *     documents (no account/engagement scope). Scoped documents inherit
 *     the account/engagement ACL instead.
 */

import {
  pgTable,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const atelierDocuments = pgTable(
  "atelier_documents",
  {
    id: text("id").primaryKey(), // doc_...
    orgId: text("org_id").notNull().default("aico"),
    title: text("title").notNull(),
    /** proposal | client_deliverable | contract | template | other */
    category: text("category").notNull().default("other"),
    accountId: text("account_id"),
    engagementId: text("engagement_id"),
    /** Task #249 — optional link to a legal-entity registry record. */
    entityId: text("entity_id"),
    /**
     * Task #287 — detected/overridden document kind for entity-linked
     * documents (trade_license | memorandum_of_association | ejari_tenancy |
     * establishment_card | commercial_register | chamber_membership |
     * initial_approval | follow_up_receipt | tax_registration |
     * tax_registration_ct | tax_registration_vat | other).
     * Null = unclassified (surfaced, never hidden).
     */
    docKind: text("doc_kind"),
    uploaderUserId: text("uploader_user_id").notNull(),
    uploaderLabel: text("uploader_label").notNull().default(""),
    /** Points at the latest version row. */
    currentVersionId: text("current_version_id"),
    /** Per-document AI-retrieval opt-out (default on). */
    aiRetrieval: boolean("ai_retrieval").notNull().default(true),
    /** upload | onedrive | sharepoint | ... (future sync connectors). */
    source: text("source").notNull().default("upload"),
    externalRef: text("external_ref"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_docs_org").on(t.orgId),
    index("idx_atelier_docs_account").on(t.orgId, t.accountId),
    index("idx_atelier_docs_engagement").on(t.orgId, t.engagementId),
    index("idx_atelier_docs_uploader").on(t.orgId, t.uploaderUserId),
  ],
);

export const atelierDocumentVersions = pgTable(
  "atelier_document_versions",
  {
    id: text("id").primaryKey(), // dver_...
    orgId: text("org_id").notNull().default("aico"),
    documentId: text("document_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** `enc:doc:<key>` object-storage pointer; deduped across versions by sha. */
    blobRef: text("blob_ref").notNull(),
    uploaderUserId: text("uploader_user_id").notNull(),
    /** DocKind from extraction (pdf | docx | ... | unknown). */
    extractedKind: text("extracted_kind"),
    chunkCount: integer("chunk_count").notNull().default(0),
    extractionWarnings: jsonb("extraction_warnings").$type<string[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_doc_versions_doc").on(t.documentId),
    index("idx_atelier_doc_versions_sha").on(t.orgId, t.sha256),
    uniqueIndex("uniq_atelier_doc_version_num").on(t.documentId, t.versionNumber),
  ],
);

export const atelierDocumentAccess = pgTable(
  "atelier_document_access",
  {
    id: text("id").primaryKey(), // dacc_...
    orgId: text("org_id").notNull().default("aico"),
    documentId: text("document_id").notNull(),
    userId: text("user_id").notNull(),
    grantedBy: text("granted_by").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_doc_access_doc").on(t.documentId),
    index("idx_atelier_doc_access_user").on(t.orgId, t.userId),
    uniqueIndex("uniq_atelier_doc_access").on(t.documentId, t.userId),
  ],
);
