/**
 * Task #875 — Partner contracts & billing hub.
 *
 * Two portal-facing linkage tables:
 *
 * - `atelier_partner_contract_shares`: explicit share records exposing an
 *   internal contract-lifecycle record (atelier_contract_records) to a
 *   partner firm's portal. Sharing is always an internal, audited action;
 *   revoke is a soft stamp so history is retained.
 *
 * - `atelier_partner_doc_inbox`: documents uploaded BY a partner firm from
 *   the portal (e.g. a countersigned copy). Rows sit in "pending" until an
 *   internal reviewer accepts (creating a contract record + auto-share) or
 *   rejects with a note. Bytes live in private object storage via the
 *   contract blob helpers (`enc:cdoc:` refs).
 *
 * Partner-submitted AP invoices live on `atelier_partner_firm_invoices`
 * (source = "partner_submitted") — see schema/atelier.ts.
 */
import { pgTable, text, integer, timestamp, index, jsonb } from "drizzle-orm/pg-core";

const ORG = (name: string) => text(name).notNull().default("aico");

export const atelierPartnerContractShares = pgTable(
  "atelier_partner_contract_shares",
  {
    id: text("id").primaryKey(), // pcs_...
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    /** atelier_contract_records.id */
    contractId: text("contract_id").notNull(),
    note: text("note"),
    sharedByUserId: text("shared_by_user_id").notNull(),
    sharedByLabel: text("shared_by_label").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id"),
  },
  (t) => [
    index("idx_atelier_pcs_firm").on(t.orgId, t.partnerFirmId),
    index("idx_atelier_pcs_contract").on(t.contractId),
  ],
);

export const atelierPartnerDocInbox = pgTable(
  "atelier_partner_doc_inbox",
  {
    id: text("id").primaryKey(), // pdi_...
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    uploadedByUserId: text("uploaded_by_user_id").notNull(),
    uploadedByLabel: text("uploaded_by_label").notNull().default(""),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** `enc:cdoc:<key>` object-storage pointer (contract blob helpers). */
    blobRef: text("blob_ref").notNull(),
    note: text("note"),
    /** pending | accepted | rejected */
    status: text("status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedByLabel: text("reviewed_by_label"),
    reviewedAt: timestamp("reviewed_at"),
    reviewNote: text("review_note"),
    /** atelier_contract_records.id created on accept. */
    contractId: text("contract_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pdi_firm").on(t.orgId, t.partnerFirmId),
    index("idx_atelier_pdi_status").on(t.orgId, t.status),
  ],
);
