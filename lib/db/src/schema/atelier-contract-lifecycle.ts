/**
 * Task #159 — Contract lifecycle (templates → prepare → redline → sign → track).
 *
 * Distinct from the Codex/CLM commercial-contract tables (atelier_contract):
 * these tables model the DOCUMENT lifecycle — Word templates uploaded by
 * partners, generated fill-ins, external redlining, final upload, PDF
 * conversion, DocuSeal signature and archival.
 *
 *   atelier_contract_templates          — one row per logical template
 *     (mutual NDA, employment contract, ...). Versioned; the current
 *     version's detected field schema drives generation.
 *   atelier_contract_template_versions  — immutable uploads. `blobRef`
 *     is the object-storage pointer (`enc:cdoc:<key>`); `fieldSchema`
 *     is the LLM-detected (partner-reviewable) fill-in map.
 *   atelier_contract_records            — one row per contract being
 *     negotiated/signed. Polymorphic counterparty: roster person
 *     (employment/contractor), contact (individual NDA) or account
 *     (mutual NDA / MoU / partnership agreement). Lifecycle:
 *     draft → out_for_review → final_uploaded → out_for_signature →
 *     signed (terminal), plus declined | voided | expired (terminal).
 *   atelier_contract_documents          — the document version chain on
 *     a record: generated_draft (docx) → final_docx → converted_pdf →
 *     signed_pdf. Blobs in object storage, never in rows.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** One detected fill-in spot in a template version. */
export interface ContractTemplateField {
  /** Stable machine key, e.g. "counterparty_name". */
  key: string;
  /** Human label shown on review screens / confirm cards. */
  label: string;
  /** The EXACT literal text in the document this field replaces. */
  placeholder: string;
  /** text | date | money | number */
  dataType: string;
  /**
   * CRM auto-fill hint: counterparty_name | counterparty_address |
   * counterparty_email | counterparty_country | firm_name | firm_address |
   * firm_governing_law | firm_jurisdiction |
   * effective_date | expiry_date | fee | term | none
   */
  autoFill: string;
  required: boolean;
  /** Optional detection note (e.g. ambiguity) surfaced on review. */
  note?: string;
  /**
   * Task #291 — when the template says "choose one of N options"
   * (e.g. Relationship Type), the exact option list. Renders as a
   * dropdown in the chat clarification card and the create form.
   */
  options?: string[];
  /**
   * Task #291 — field role:
   *   standard      — normal fill-in (default when absent).
   *   second_party  — the receiving party's signature-block field
   *                   (signature date etc.). Never asked at creation;
   *                   left for signing time (DocuSeal date field).
   *   reference     — auto-generated reference number (…-YYYY-NNN).
   *                   Never asked; the next series number is assigned
   *                   at prepare time.
   */
  role?: "standard" | "second_party" | "reference";
  /**
   * Task #291 — default hint for date fields; "today" prefills the
   * input with today's date (e.g. the firm-side signature date).
   */
  defaultHint?: "today";
}

/**
 * Reconciliation of the PREVIOUS version's reviewed field schema against a
 * newly-uploaded version's document. Computed once at version-upload time so
 * reviewers can see which confirmed fields survived and which no longer match.
 */
export interface PriorFieldReview {
  /** Version number the reviewed schema came from. */
  fromVersionNumber: number;
  /** Prior reviewed fields, each tagged with its fate in the new document. */
  fields: Array<
    ContractTemplateField & {
      /** carried_over — placeholder still matches the new document; missing — it does not. */
      status: "carried_over" | "missing";
    }
  >;
}

export const atelierContractTemplates = pgTable(
  "atelier_contract_templates",
  {
    id: text("id").primaryKey(), // ctpl_...
    orgId: text("org_id").notNull().default("aico"),
    name: text("name").notNull(),
    /**
     * individual_nda | mutual_nda | partnership_mou | partnership_agreement |
     * non_equity_partner_employment | employment | contractor_agreement | other
     */
    contractType: text("contract_type").notNull().default("other"),
    /** draft (fields not yet reviewed) | active | archived */
    status: text("status").notNull().default("draft"),
    currentVersionId: text("current_version_id"),
    createdBy: text("created_by").notNull(),
    createdByLabel: text("created_by_label").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_ctpl_org").on(t.orgId),
    index("idx_atelier_ctpl_type").on(t.orgId, t.contractType),
  ],
);

export const atelierContractTemplateVersions = pgTable(
  "atelier_contract_template_versions",
  {
    id: text("id").primaryKey(), // ctv_...
    orgId: text("org_id").notNull().default("aico"),
    templateId: text("template_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** `enc:cdoc:<key>` object-storage pointer to the .docx bytes. */
    blobRef: text("blob_ref").notNull(),
    /** LLM-detected, partner-reviewable fill-in map. */
    fieldSchema: jsonb("field_schema").$type<ContractTemplateField[]>().notNull(),
    /** detected (awaiting review) | reviewed */
    fieldStatus: text("field_status").notNull().default("detected"),
    detectionWarnings: jsonb("detection_warnings").$type<string[]>(),
    /**
     * Set only when the previous current version had a REVIEWED schema:
     * that schema reconciled against this version's document (which prior
     * fields carried over vs. no longer match). Null on v1 / unreviewed prior.
     */
    priorFieldReview: jsonb("prior_field_review").$type<PriorFieldReview>(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_ctv_template").on(t.templateId),
    uniqueIndex("uniq_atelier_ctv_version").on(t.templateId, t.versionNumber),
  ],
);

export const atelierContractRecords = pgTable(
  "atelier_contract_records",
  {
    id: text("id").primaryKey(), // ctr_...
    orgId: text("org_id").notNull().default("aico"),
    title: text("title").notNull(),
    contractType: text("contract_type").notNull().default("other"),
    templateId: text("template_id"),
    templateVersionId: text("template_version_id"),
    /** person (roster) | contact | account */
    counterpartyKind: text("counterparty_kind").notNull(),
    personId: text("person_id"),
    contactId: text("contact_id"),
    accountId: text("account_id"),
    /** Denormalised display name of the counterparty at creation time. */
    counterpartyLabel: text("counterparty_label").notNull().default(""),
    /**
     * draft | out_for_review | final_uploaded | out_for_signature |
     * signed | declined | voided | expired
     */
    status: text("status").notNull().default("draft"),
    /** Field key → value used to generate the draft. */
    fieldValues: jsonb("field_values").$type<Record<string, string>>(),
    ownerUserId: text("owner_user_id").notNull(),
    ownerLabel: text("owner_label").notNull().default(""),
    effectiveDate: timestamp("effective_date"),
    expiryDate: timestamp("expiry_date"),
    /** Latest document version on the chain (convenience pointer). */
    currentDocumentId: text("current_document_id"),
    /** atelier_signature_requests.id once sent for signature. */
    signatureRequestId: text("signature_request_id"),
    /** Document Library id of the archived signed PDF. */
    signedLibraryDocumentId: text("signed_library_document_id"),
    /** Task #232 — Cognirise signing entity (firm-profile legalEntities id). */
    signingEntityId: text("signing_entity_id"),
    /** Snapshot of the signing entity's legal name at prepare time. */
    signingEntityLabel: text("signing_entity_label"),
    /** Snapshot of the signing entity's country (caution note when ≠ UAE). */
    signingEntityCountry: text("signing_entity_country"),
    notes: text("notes"),
    /**
     * Task #335 — "Send for signature" (internal): a contract manager who is
     * NOT an authorised signatory of the signing entity flags the contract as
     * awaiting a firm signatory. Cleared on send / regenerate-driven edits.
     */
    firmSignatureRequestedAt: timestamp("firm_signature_requested_at"),
    firmSignatureRequestedBy: text("firm_signature_requested_by"),
    firmSignatureRequestedByLabel: text("firm_signature_requested_by_label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_ctr_org").on(t.orgId),
    index("idx_atelier_ctr_status").on(t.orgId, t.status),
    index("idx_atelier_ctr_person").on(t.orgId, t.personId),
    index("idx_atelier_ctr_contact").on(t.orgId, t.contactId),
    index("idx_atelier_ctr_account").on(t.orgId, t.accountId),
    index("idx_atelier_ctr_owner").on(t.orgId, t.ownerUserId),
    index("idx_atelier_ctr_sigreq").on(t.signatureRequestId),
    index("idx_atelier_ctr_expiry").on(t.orgId, t.expiryDate),
  ],
);

/**
 * Task #291 — issued reference-number series, per template per year.
 * The next series number is allocated race-safely via
 * INSERT … ON CONFLICT DO UPDATE SET last_series = last_series + 1
 * RETURNING, so concurrent contract creations never share a number.
 * Year rollover starts a fresh row (series resets to 001).
 */
export const atelierContractReferenceSequences = pgTable(
  "atelier_contract_reference_sequences",
  {
    id: text("id").primaryKey(), // crseq_...
    orgId: text("org_id").notNull().default("aico"),
    templateId: text("template_id").notNull(),
    year: integer("year").notNull(),
    lastSeries: integer("last_series").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uniq_atelier_crseq_template_year").on(t.templateId, t.year)],
);

/**
 * Task #335 — authorised signatories per Cognirise signing entity.
 * `entityId` references EITHER a firm-profile legal entity (`le_…`) or a
 * legal-entity-registry row (`lent_…`) — the merged signing-entity list is
 * the source of truth, so no FK. `userIds` are atelier_users ids; only these
 * users may execute the firm-side "Sign & send" step for contracts prepared
 * under the entity (empty/missing row = legacy behaviour: any partner-tier
 * manager may sign).
 */
export const atelierSigningEntitySignatories = pgTable(
  "atelier_signing_entity_signatories",
  {
    id: text("id").primaryKey(), // sesig_...
    orgId: text("org_id").notNull().default("aico"),
    entityId: text("entity_id").notNull(),
    userIds: jsonb("user_ids").$type<string[]>().notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedByLabel: text("updated_by_label").notNull().default(""),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uniq_atelier_sesig_entity").on(t.orgId, t.entityId)],
);

export const atelierContractDocuments = pgTable(
  "atelier_contract_documents",
  {
    id: text("id").primaryKey(), // cdoc_...
    orgId: text("org_id").notNull().default("aico"),
    contractId: text("contract_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    /** generated_draft | final_docx | converted_pdf | signed_pdf */
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** `enc:cdoc:<key>` object-storage pointer. */
    blobRef: text("blob_ref").notNull(),
    createdBy: text("created_by").notNull(),
    createdByLabel: text("created_by_label").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_cdoc_contract").on(t.contractId),
    uniqueIndex("uniq_atelier_cdoc_version").on(t.contractId, t.versionNumber),
  ],
);

/**
 * Task #1137 — salary digitization proposals from signed employment
 * contracts.
 *
 * When an employment (or non_equity_partner_employment) contract reaches
 * `signed` via the e-sign sync AND its counterparty resolves to an
 * atelier_employees row, a proposal row is created and an extractor runs
 * fire-and-forget: it reads the signed contract's structured fieldValues
 * first (deterministic) and falls back to a single fail-loud LLM pass over
 * the signed document text. NOTHING is ever written to payroll silently —
 * the proposal is reviewed under the same audited semantics as the payroll
 * PATCH before comp fields change.
 *
 * `extracted` holds the four comp figures + an effective date; every field
 * carries a `sourceSnippets` attribution (field label + value for the
 * structured path, verbatim document quote for the LLM path). One live
 * (processing|pending) proposal per contract; a re-trigger returns it.
 */
export interface ContractSalaryExtracted {
  /** Annual base compensation. */
  baseCompensation?: number;
  /** ISO-4217 currency code (uppercase). */
  baseCurrency?: string;
  /** Monthly basic wage (statutory). */
  basicWageMonthly?: number;
  /** Monthly housing allowance (statutory). */
  housingAllowanceMonthly?: number;
  /** ISO date (YYYY-MM-DD) the compensation takes effect. */
  effectiveDate?: string;
}

export interface ContractSalarySnippet {
  /** Verbatim quote (LLM path) or "label: value" (field-values path). */
  snippet: string;
  /** Attribution: template field key/label, or "document". */
  attribution: string;
}

export const atelierContractSalaryProposals = pgTable(
  "atelier_contract_salary_proposals",
  {
    id: text("id").primaryKey(), // csp_...
    orgId: text("org_id").notNull().default("aico"),
    contractId: text("contract_id").notNull(),
    /** atelier_employees.id (counterparty resolved to an employee). */
    personId: text("person_id").notNull(),
    /** processing | pending | approved | rejected | failed */
    status: text("status").notNull().default("processing"),
    /** field_values | llm_text | null (until extraction resolves). */
    source: text("source"),
    /** Extracted comp figures (see ContractSalaryExtracted). */
    extracted: jsonb("extracted").$type<ContractSalaryExtracted>(),
    /** Per-field snippet + attribution (keyed by extracted field). */
    sourceSnippets:
      jsonb("source_snippets").$type<Record<string, ContractSalarySnippet>>(),
    /** Populated when status = failed: the fail-loud reason. */
    error: text("error"),
    decidedBy: text("decided_by"),
    decidedByLabel: text("decided_by_label"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    /** On approve: {field, from, to}[] actually applied to payroll. */
    appliedChanges:
      jsonb("applied_changes").$type<
        Array<{ field: string; from: unknown; to: unknown }>
      >(),
    /**
     * On approve: the RESOLVED approved comp patch — extracted values merged
     * with reviewer overrides, limited to fields actually proposed (present in
     * the approve body OR extracted non-null; explicit-null clears included).
     * This is the drift BASELINE (distinct from appliedChanges, which only
     * records fields that changed at approval time). computeCompDrift compares
     * current payroll against this map so a later manual edit of a field that
     * was a no-op at approval still surfaces as drift.
     */
    approvedValues:
      jsonb("approved_values").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_csp_org").on(t.orgId),
    index("idx_atelier_csp_contract").on(t.contractId),
    index("idx_atelier_csp_person").on(t.orgId, t.personId),
    index("idx_atelier_csp_status").on(t.orgId, t.status),
    // Task #1137 — race-safe "one live proposal per contract": at most one
    // processing|pending row per contract. Insert with onConflictDoNothing
    // against this index so a lost race returns the existing live row rather
    // than creating a duplicate.
    uniqueIndex("uniq_atelier_csp_live_per_contract")
      .on(t.contractId)
      .where(sql`${t.status} in ('processing', 'pending')`),
  ],
);
