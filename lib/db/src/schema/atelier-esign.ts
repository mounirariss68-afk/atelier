/**
 * Task #62 — E-signing via DocuSeal.
 *
 * Signature requests created in Atelier and executed on an external
 * DocuSeal instance (Cloud or self-hosted — base URL configurable).
 * These tables are the Atelier-side ledger of every request:
 *
 *   atelier_signature_requests — one row per request. Points at the
 *     source Document Library document/version that was sent, carries
 *     optional business links (account / contact / roster person),
 *     the DocuSeal submission id, lifecycle status and expiry. When a
 *     request completes, the signed PDF + audit trail are pulled back
 *     into the Document Library and `signed_document_id` records where
 *     they landed.
 *   atelier_signature_signers — one row per signer (name + email +
 *     signing order) mirroring the DocuSeal submitter, with per-signer
 *     status (pending | sent | opened | completed | declined).
 *
 * Status model (request): sent → partially_signed → completed,
 * or → declined | voided | expired. Status is synced from DocuSeal
 * via webhook trigger + polling fallback; webhooks are never trusted
 * as a source of state — they only trigger an authoritative re-fetch.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const atelierSignatureRequests = pgTable(
  "atelier_signature_requests",
  {
    id: text("id").primaryKey(), // sig_...
    orgId: text("org_id").notNull().default("aico"),
    title: text("title").notNull(),
    message: text("message"),
    /** Source Document Library document + the exact version sent out. */
    documentId: text("document_id").notNull(),
    documentVersionId: text("document_version_id").notNull(),
    /** Optional business links. Org-level request when all are null. */
    accountId: text("account_id"),
    /** Opportunity the agreement was sent from (deal-level agreements). */
    opportunityId: text("opportunity_id"),
    contactId: text("contact_id"),
    /** Roster person (employee/contractor) for offers / employment docs. */
    personId: text("person_id"),
    /** sent | partially_signed | completed | declined | voided | expired */
    status: text("status").notNull().default("sent"),
    /** DocuSeal ids: template created from the PDF + the submission. */
    docusealTemplateId: text("docuseal_template_id"),
    docusealSubmissionId: text("docuseal_submission_id").notNull(),
    expiresAt: timestamp("expires_at"),
    createdBy: text("created_by").notNull(),
    createdByLabel: text("created_by_label").notNull().default(""),
    /** Where the completed signed PDF landed in the Document Library. */
    signedDocumentId: text("signed_document_id"),
    /** Non-null while the last sync attempt against DocuSeal failed. */
    lastSyncError: text("last_sync_error"),
    lastSyncedAt: timestamp("last_synced_at"),
    voidedAt: timestamp("voided_at"),
    completedAt: timestamp("completed_at"),
    declinedAt: timestamp("declined_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_sig_req_org").on(t.orgId),
    index("idx_atelier_sig_req_status").on(t.orgId, t.status),
    index("idx_atelier_sig_req_submission").on(t.docusealSubmissionId),
    index("idx_atelier_sig_req_account").on(t.orgId, t.accountId),
    index("idx_atelier_sig_req_opp").on(t.orgId, t.opportunityId),
  ],
);

export const atelierSignatureSigners = pgTable(
  "atelier_signature_signers",
  {
    id: text("id").primaryKey(), // sgn_...
    orgId: text("org_id").notNull().default("aico"),
    requestId: text("request_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    /** 1-based signing order (DocuSeal submitters, order preserved). */
    signingOrder: integer("signing_order").notNull().default(1),
    /** pending | sent | opened | completed | declined */
    status: text("status").notNull().default("pending"),
    docusealSubmitterId: text("docuseal_submitter_id"),
    /** Raw per-signer status payload from the last sync (diagnostics). */
    lastPayload: jsonb("last_payload").$type<Record<string, unknown>>(),
    openedAt: timestamp("opened_at"),
    completedAt: timestamp("completed_at"),
    declinedAt: timestamp("declined_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_sig_signer_req").on(t.requestId),
    index("idx_atelier_sig_signer_org").on(t.orgId),
  ],
);
