/**
 * Task #159 — Contract lifecycle shared service.
 *
 * Orchestration logic shared by the REST routes
 * (routes/atelier/contractLifecycleRoutes.ts) and the chat capabilities
 * (lib/atelier-cli/contract-capabilities.ts). Lives in lib/ so the
 * capability catalog never has to import a route module (cycle risk).
 *
 * All functions are org-scoped; callers are responsible for role gating
 * (partner-tier) before invoking the mutating services.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierContacts,
  atelierEmployees,
  atelierFirmProfile,
  atelierContractTemplates,
  atelierContractTemplateVersions,
  atelierContractRecords,
  atelierContractDocuments,
  atelierLegalEntities,
  type ContractTemplateField,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { atelierContractReferenceSequences } from "@workspace/db";
import {
  DOCX_MIME,
  ContractFillError,
  PdfConversionError,
  fillDocxTemplate,
  convertDocxToPdf,
  loadContractBytes,
  addContractDocument,
  auditContractEntity,
  normalizeFieldSchema,
  isTokenStyleReferencePlaceholder,
  rid,
} from "./atelier-contracts.js";
import { createDocument } from "./atelier-documents.js";
import { sendSignatureRequest } from "./atelier-esign.js";
import { DocusealError, docusealConfigured, defaultSignaturePlacement } from "./docuseal.js";

export type TemplateRow = typeof atelierContractTemplates.$inferSelect;
export type TemplateVersionRow = typeof atelierContractTemplateVersions.$inferSelect;
export type ContractRow = typeof atelierContractRecords.$inferSelect;
export type ContractDocRow = typeof atelierContractDocuments.$inferSelect;

export type Counterparty = {
  kind: "person" | "contact" | "account";
  id: string;
  label: string;
  accountId: string | null;
  autoFill: Record<string, string>;
};

export async function loadTemplate(orgId: string, id: string): Promise<TemplateRow | null> {
  const [t] = await db
    .select()
    .from(atelierContractTemplates)
    .where(and(eq(atelierContractTemplates.id, id), eq(atelierContractTemplates.orgId, orgId)));
  return t ?? null;
}

export async function loadContract(orgId: string, id: string): Promise<ContractRow | null> {
  const [c] = await db
    .select()
    .from(atelierContractRecords)
    .where(and(eq(atelierContractRecords.id, id), eq(atelierContractRecords.orgId, orgId)));
  return c ?? null;
}

export async function resolveCounterparty(
  orgId: string,
  kind: string,
  id: string,
): Promise<Counterparty | null> {
  if (kind === "person") {
    const [p] = await db
      .select()
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.id, id), eq(atelierEmployees.orgId, orgId)));
    if (!p) return null;
    return {
      kind,
      id,
      label: p.fullName,
      accountId: null,
      autoFill: {
        counterparty_name: p.fullName,
        counterparty_email: p.email ?? "",
        counterparty_address: p.homeAddress ?? p.officeAddress ?? "",
        counterparty_country: p.country ?? "",
      },
    };
  }
  if (kind === "contact") {
    const [c] = await db
      .select()
      .from(atelierContacts)
      .where(and(eq(atelierContacts.id, id), eq(atelierContacts.orgId, orgId)));
    if (!c) return null;
    return {
      kind,
      id,
      label: c.fullName,
      accountId: c.accountId,
      autoFill: {
        counterparty_name: c.fullName,
        counterparty_email: c.email ?? "",
      },
    };
  }
  if (kind === "account") {
    const [a] = await db
      .select()
      .from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, id), eq(atelierAccounts.orgId, orgId)));
    if (!a) return null;
    return {
      kind,
      id,
      label: a.name,
      accountId: a.id,
      autoFill: {
        counterparty_name: a.name,
        counterparty_address: [a.hqCity, a.country].filter(Boolean).join(", "),
        counterparty_country: a.country ?? "",
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Task #232 — Signing-entity registry (firm profile payload.legalEntities)
// ---------------------------------------------------------------------------

export type SigningEntity = {
  id: string;
  name: string;
  jurisdiction: string;
  registeredAddress: string;
  country: string;
  governingLaw: string;
  courts: string;
  isDefault: boolean;
};

type RawLegalEntity = {
  id?: string;
  name: string;
  jurisdiction: string;
  registeredAddress?: string;
  country?: string;
  governingLaw?: string;
  courts?: string;
  isDefault?: boolean;
};

function entitySlugId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `le_${slug || "entity"}`;
}

/**
 * Normalize the firm-profile legalEntities array into signing entities.
 * Legacy rows ({name, jurisdiction} only) get a deterministic slug id and
 * empty rich fields. Exactly one default: the first isDefault wins; when
 * none is flagged, the first entity is treated as the default.
 */
export function normalizeSigningEntities(raw: unknown): SigningEntity[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SigningEntity[] = [];
  for (const e of raw as RawLegalEntity[]) {
    if (!e || typeof e.name !== "string" || !e.name.trim()) continue;
    let id = typeof e.id === "string" && e.id.trim() ? e.id.trim() : entitySlugId(e.name);
    while (seen.has(id)) id = `${id}_2`;
    seen.add(id);
    out.push({
      id,
      name: e.name.trim(),
      jurisdiction: String(e.jurisdiction ?? "").trim(),
      registeredAddress: String(e.registeredAddress ?? "").trim(),
      country: String(e.country ?? "").trim(),
      governingLaw: String(e.governingLaw ?? "").trim(),
      courts: String(e.courts ?? "").trim(),
      isDefault: e.isDefault === true,
    });
  }
  const firstDefault = out.findIndex((e) => e.isDefault);
  out.forEach((e, i) => {
    e.isDefault = firstDefault === -1 ? i === 0 : i === firstDefault;
  });
  return out;
}

export async function loadPublishedFirmProfile(
  orgId: string,
): Promise<typeof atelierFirmProfile.$inferSelect | null> {
  const [profile] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.orgId, orgId), eq(atelierFirmProfile.status, "published")))
    .orderBy(desc(atelierFirmProfile.version))
    .limit(1);
  return profile ?? null;
}

export async function listSigningEntities(orgId: string): Promise<SigningEntity[]> {
  const profile = await loadPublishedFirmProfile(orgId);
  const payload = profile?.payload as { legalEntities?: unknown } | undefined;
  const fromProfile = normalizeSigningEntities(payload?.legalEntities);
  // Task #249 — the legal-entity registry (atelier_legal_entities) is a
  // second source of signing entities: every active registry entity is
  // signable, keyed by its stable lent_ id. Profile entities keep default
  // precedence; when the profile registry is empty the first registry
  // entity becomes the default.
  const rows = await db
    .select()
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, orgId), eq(atelierLegalEntities.status, "active")))
    .orderBy(desc(atelierLegalEntities.createdAt));
  const seen = new Set(fromProfile.map((e) => e.id));
  const merged = [...fromProfile];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    merged.push({
      id: r.id,
      name: r.legalNameEn,
      jurisdiction: r.jurisdiction || "",
      registeredAddress: r.registeredAddress || "",
      country: r.country || "",
      governingLaw: r.governingLaw || "",
      courts: r.courts || "",
      isDefault: false,
    });
  }
  if (merged.length > 0 && !merged.some((e) => e.isDefault)) {
    merged[0].isDefault = true;
  }
  return merged;
}

/**
 * Resolve a signing entity by id, or the default entity when id is null.
 * Returns null when the registry is empty (legacy behaviour: plain
 * firm-profile autofill) or the id is unknown ({found:false}).
 */
export async function resolveSigningEntity(
  orgId: string,
  entityId: string | null,
): Promise<{ found: boolean; entity: SigningEntity | null }> {
  const entities = await listSigningEntities(orgId);
  if (entityId) {
    const entity = entities.find((e) => e.id === entityId) ?? null;
    return { found: !!entity, entity };
  }
  return { found: true, entity: entities.find((e) => e.isDefault) ?? null };
}

export async function firmAutoFill(
  orgId: string,
  entity?: SigningEntity | null,
): Promise<Record<string, string>> {
  const profile = await loadPublishedFirmProfile(orgId);
  const payload = profile?.payload as { firmName?: string; contactBlock?: string } | undefined;
  if (entity) {
    return {
      firm_name: entity.name,
      firm_address: entity.registeredAddress || payload?.contactBlock || "",
      firm_governing_law: entity.governingLaw || "",
      firm_jurisdiction: entity.courts || entity.jurisdiction || "",
    };
  }
  return {
    firm_name: payload?.firmName || "Cognirise",
    firm_address: payload?.contactBlock || "",
  };
}

/**
 * Merge auto-fill + explicit values against the template's field schema.
 *
 * Task #291 — non-standard roles are never asked for at creation:
 *   second_party — the counterparty's signature-block fields are left
 *     blank in the draft and completed at e-sign time (DocuSeal date
 *     boxes); they never count as missing and explicit values for
 *     them are ignored.
 *   reference    — auto-generated at prepare (commit) time; explicit
 *     values are ignored so a preview label can't burn or fake a
 *     series number.
 */
export function buildFieldValues(args: {
  fields: ContractTemplateField[];
  counterparty: Counterparty;
  firm: Record<string, string>;
  explicit: Record<string, string>;
  effectiveDate?: string | null;
  expiryDate?: string | null;
}): { values: Record<string, string>; missingRequired: string[] } {
  const fields = normalizeFieldSchema(args.fields);
  const values: Record<string, string> = {};
  const dateFill: Record<string, string> = {};
  if (args.effectiveDate) dateFill.effective_date = args.effectiveDate;
  if (args.expiryDate) dateFill.expiry_date = args.expiryDate;
  for (const f of fields) {
    if (f.role === "second_party" || f.role === "reference") continue;
    const explicit = args.explicit[f.key];
    if (explicit != null && explicit !== "") {
      values[f.key] = explicit;
      continue;
    }
    const auto =
      args.counterparty.autoFill[f.autoFill] ?? args.firm[f.autoFill] ?? dateFill[f.autoFill];
    if (auto != null && auto !== "") values[f.key] = auto;
    else if (f.dataType === "date" && f.defaultHint === "today") {
      values[f.key] = new Date().toISOString().slice(0, 10);
    }
  }
  const missingRequired = fields
    .filter((f) => (f.role ?? "standard") === "standard")
    .filter((f) => f.required && (values[f.key] == null || values[f.key] === ""))
    .map((f) => f.key);
  return { values, missingRequired };
}

// ---------------------------------------------------------------------------
// Task #291 — reference-number allocation (per template, per year)
// ---------------------------------------------------------------------------

/**
 * Allocate the next reference series number for a template + year.
 * Race-safe: a single INSERT … ON CONFLICT DO UPDATE SET
 * last_series = last_series + 1 RETURNING — concurrent callers each get
 * a distinct number. Year rollover inserts a fresh row starting at 1.
 */
export async function allocateReferenceSeries(args: {
  orgId: string;
  templateId: string;
  year: number;
}): Promise<number> {
  const rows = (await db
    .insert(atelierContractReferenceSequences)
    .values({
      id: rid("crseq"),
      orgId: args.orgId,
      templateId: args.templateId,
      year: args.year,
      lastSeries: 1,
    })
    .onConflictDoUpdate({
      target: [
        atelierContractReferenceSequences.templateId,
        atelierContractReferenceSequences.year,
      ],
      set: {
        lastSeries: sql`${atelierContractReferenceSequences.lastSeries} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastSeries: atelierContractReferenceSequences.lastSeries })) as Array<{
    lastSeries: number;
  }>;
  return rows[0].lastSeries;
}

/**
 * Format a reference value in the template's own style: reuse the
 * placeholder's prefix/separator when it looks like "AGR-2026-003",
 * otherwise fall back to "YYYY-NNN".
 */
export function formatReferenceValue(placeholder: string, year: number, series: number): string {
  const padded = String(series).padStart(3, "0");
  const m = placeholder.match(/^(.*?)(19|20)\d{2}([-_/.])\d{3}(?!\d)/);
  if (m) return `${m[1]}${year}${m[3]}${padded}`;
  // Token-style placeholders, e.g. "[CGNR-NDA-U-[YEAR]-[###]]" →
  // "CGNR-NDA-U-2026-001": substitute the year/series tokens, then strip
  // one wrapping bracket pair when the whole placeholder is bracketed.
  if (isTokenStyleReferencePlaceholder(placeholder)) {
    let out = placeholder
      .replace(/\[(?:YEAR|YYYY)\]/gi, String(year))
      .replace(/\[(?:#+|N{2,}|No\.?)\]/gi, padded);
    if (out.startsWith("[") && out.endsWith("]")) out = out.slice(1, -1);
    return out.trim();
  }
  return `${year}-${padded}`;
}

// ---------------------------------------------------------------------------
// prepareContract — the "prepare a contract from a template" workflow
// ---------------------------------------------------------------------------

export type PrepareContractError = {
  ok: false;
  code:
    | "template-not-found"
    | "template-not-active"
    | "template-version-missing"
    | "counterparty-not-found"
    | "signing-entity-not-found"
    | "missing-required-fields"
    | "template-blob-missing"
    | "fill-failed";
  message: string;
  missing?: string[];
  fields?: ContractTemplateField[];
};

export type PrepareContractResult =
  | { ok: true; contract: ContractRow; doc: ContractDocRow }
  | PrepareContractError;

export async function prepareContract(args: {
  orgId: string;
  actor: { id: string; name: string };
  templateId: string;
  counterparty: { kind: string; id: string };
  /** Task #232 — Cognirise signing entity. Omitted/null → the default entity. */
  signingEntityId?: string | null;
  title?: string | null;
  values?: Record<string, string>;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
}): Promise<PrepareContractResult> {
  const template = await loadTemplate(args.orgId, args.templateId);
  if (!template || template.status === "archived") {
    return { ok: false, code: "template-not-found", message: "Template not found." };
  }
  if (template.status !== "active" || !template.currentVersionId) {
    return {
      ok: false,
      code: "template-not-active",
      message: "The template's fields must be reviewed and the template activated first.",
    };
  }
  const [version] = await db
    .select()
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.id, template.currentVersionId));
  if (!version) {
    return { ok: false, code: "template-version-missing", message: "Template version missing." };
  }
  const counterparty = await resolveCounterparty(
    args.orgId,
    args.counterparty.kind,
    args.counterparty.id,
  );
  if (!counterparty) {
    return { ok: false, code: "counterparty-not-found", message: "Counterparty not found." };
  }
  const { found, entity } = await resolveSigningEntity(args.orgId, args.signingEntityId ?? null);
  if (!found) {
    return {
      ok: false,
      code: "signing-entity-not-found",
      message: "The selected signing entity was not found in the firm's registry.",
    };
  }
  // Task #237 — every contract must record which Cognirise legal entity signs it.
  if (!entity) {
    return {
      ok: false,
      code: "signing-entity-not-found",
      message:
        "No Cognirise signing entity is configured. Add a legal entity (and mark one as default) under Settings → Firm profile before preparing contracts.",
    };
  }
  const firm = await firmAutoFill(args.orgId, entity);
  const { values, missingRequired } = buildFieldValues({
    fields: version.fieldSchema,
    counterparty,
    firm,
    explicit: args.values ?? {},
    effectiveDate: args.effectiveDate,
    expiryDate: args.expiryDate,
  });
  if (missingRequired.length > 0) {
    // Task #314 — use human labels and explain that auto-fill came up empty
    // (usually a signing entity with blank details) instead of a bare key list.
    const schema = normalizeFieldSchema(version.fieldSchema);
    const labels = missingRequired.map(
      (k) => schema.find((f) => f.key === k)?.label ?? k,
    );
    return {
      ok: false,
      code: "missing-required-fields",
      message: `Values are required for: ${labels.join(", ")}. These could not be auto-filled — check the selected signing entity's details or enter the values manually.`,
      missing: missingRequired,
      fields: schema,
    };
  }
  const templateBytes = await loadContractBytes(version.blobRef);
  if (!templateBytes) {
    return { ok: false, code: "template-blob-missing", message: "Template file is missing." };
  }
  // Task #291 — auto-assign reference numbers at commit time (never on
  // previews). One series per template per year, race-safe.
  const normalizedFields = normalizeFieldSchema(version.fieldSchema);
  const referenceFields = normalizedFields.filter((f) => f.role === "reference");
  for (const f of referenceFields) {
    const year = new Date().getFullYear();
    const series = await allocateReferenceSeries({
      orgId: args.orgId,
      templateId: template.id,
      year,
    });
    values[f.key] = formatReferenceValue(f.placeholder, year, series);
  }
  let draft: Buffer;
  try {
    draft = await fillDocxTemplate({ templateBytes, fields: version.fieldSchema, values });
  } catch (err) {
    if (err instanceof ContractFillError) {
      return { ok: false, code: "fill-failed", message: err.message, missing: err.missing };
    }
    throw err;
  }
  const contractId = rid("ctr");
  const title = args.title || `${template.name} — ${counterparty.label}`;
  await db.insert(atelierContractRecords).values({
    id: contractId,
    orgId: args.orgId,
    title,
    contractType: template.contractType,
    templateId: template.id,
    templateVersionId: version.id,
    counterpartyKind: counterparty.kind,
    personId: counterparty.kind === "person" ? counterparty.id : null,
    contactId: counterparty.kind === "contact" ? counterparty.id : null,
    accountId:
      counterparty.kind === "account"
        ? counterparty.id
        : counterparty.kind === "contact"
          ? counterparty.accountId
          : null,
    counterpartyLabel: counterparty.label,
    signingEntityId: entity?.id ?? null,
    signingEntityLabel: entity?.name ?? null,
    signingEntityCountry: entity?.country ?? null,
    status: "draft",
    fieldValues: values,
    ownerUserId: args.actor.id,
    ownerLabel: args.actor.name,
    effectiveDate: args.effectiveDate ? new Date(args.effectiveDate) : null,
    expiryDate: args.expiryDate ? new Date(args.expiryDate) : null,
    notes: args.notes ?? null,
  });
  const doc = await addContractDocument({
    contractId,
    kind: "generated_draft",
    fileName: `${title.replace(/[^\w.\- ]+/g, "_")}.docx`,
    mime: DOCX_MIME,
    bytes: draft,
    actor: { id: args.actor.id, label: args.actor.name },
  });
  const [updated] = await db
    .update(atelierContractRecords)
    .set({ currentDocumentId: doc.id, updatedAt: new Date() })
    .where(eq(atelierContractRecords.id, contractId))
    .returning();
  await auditContractEntity({
    entityType: "atelier_contract_record",
    entityId: contractId,
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: "contract.create",
    payload: {
      templateId: template.id,
      templateVersionId: version.id,
      counterparty: { kind: counterparty.kind, id: counterparty.id, label: counterparty.label },
      signingEntity: entity ? { id: entity.id, name: entity.name, country: entity.country } : null,
      values,
    },
    summary: `Prepared contract "${title}" from template "${template.name}"`,
  });
  return { ok: true, contract: updated, doc };
}

// ---------------------------------------------------------------------------
// sendContract — convert latest docx → PDF, register in library, DocuSeal
// ---------------------------------------------------------------------------

export type SendContractError = {
  ok: false;
  code:
    | "docuseal-not-configured"
    | "not-found"
    | "invalid-status"
    | "duplicate-signers"
    | "no-document"
    | "document-missing"
    | "blob-missing"
    | "pdf-conversion-failed"
    | "library-store-failed"
    | "docuseal-error";
  message: string;
};

export type SendContractResult =
  | { ok: true; contract: ContractRow; pdfDoc: ContractDocRow; signatureRequestId: string }
  | SendContractError;

/**
 * Task #298 — pick the signer who is the contract's counterparty so the
 * second-party fill-in boxes are assigned to them. Matches the signer
 * email against the contract's person/contact record; falls back to the
 * first signer (the client is added before the firm-side partner by
 * convention, and single-signer sends are the common case).
 */
async function resolveCounterpartySignerIndex(
  contract: ContractRow,
  signers: Array<{ name: string; email: string }>,
): Promise<number> {
  let cpEmail: string | null = null;
  if (contract.counterpartyKind === "person" && contract.personId) {
    const [p] = await db
      .select({ email: atelierEmployees.email })
      .from(atelierEmployees)
      .where(
        and(eq(atelierEmployees.id, contract.personId), eq(atelierEmployees.orgId, contract.orgId)),
      );
    cpEmail = p?.email ?? null;
  } else if (contract.counterpartyKind === "contact" && contract.contactId) {
    const [c] = await db
      .select({ email: atelierContacts.email })
      .from(atelierContacts)
      .where(
        and(eq(atelierContacts.id, contract.contactId), eq(atelierContacts.orgId, contract.orgId)),
      );
    cpEmail = c?.email ?? null;
  }
  if (cpEmail) {
    const idx = signers.findIndex((s) => s.email.toLowerCase() === cpEmail!.toLowerCase());
    if (idx >= 0) return idx;
  }
  return 0;
}

export async function sendContract(args: {
  orgId: string;
  actor: { id: string; name: string };
  contractId: string;
  signers: Array<{ name: string; email: string }>;
  title?: string | null;
  message?: string | null;
  expiresAt?: Date | null;
}): Promise<SendContractResult> {
  if (!docusealConfigured()) {
    return {
      ok: false,
      code: "docuseal-not-configured",
      message: "DocuSeal is not configured — set DOCUSEAL_API_KEY.",
    };
  }
  const contract = await loadContract(args.orgId, args.contractId);
  if (!contract) {
    return { ok: false, code: "not-found", message: "Contract not found." };
  }
  if (
    contract.status !== "final_uploaded" &&
    contract.status !== "draft" &&
    contract.status !== "out_for_review"
  ) {
    return {
      ok: false,
      code: "invalid-status",
      message: `Cannot send a ${contract.status} contract for signature.`,
    };
  }
  const emails = args.signers.map((s) => s.email.toLowerCase());
  if (new Set(emails).size !== emails.length) {
    return { ok: false, code: "duplicate-signers", message: "Signer emails must be unique." };
  }
  if (!contract.currentDocumentId) {
    return { ok: false, code: "no-document", message: "The contract has no document yet." };
  }
  const [latestDoc] = await db
    .select()
    .from(atelierContractDocuments)
    .where(eq(atelierContractDocuments.id, contract.currentDocumentId));
  if (!latestDoc) {
    return { ok: false, code: "document-missing", message: "The contract document is missing." };
  }
  const docxBytes = await loadContractBytes(latestDoc.blobRef);
  if (!docxBytes) {
    return { ok: false, code: "blob-missing", message: "The contract file is missing." };
  }

  // 1. Convert the latest Word document to PDF (LibreOffice headless).
  let pdfBytes: Buffer;
  try {
    pdfBytes = await convertDocxToPdf(docxBytes);
  } catch (err) {
    if (err instanceof PdfConversionError) {
      return { ok: false, code: "pdf-conversion-failed", message: err.message };
    }
    throw err;
  }
  const pdfDoc = await addContractDocument({
    contractId: contract.id,
    kind: "converted_pdf",
    fileName: `${contract.title.replace(/[^\w.\- ]+/g, "_")}.pdf`,
    mime: "application/pdf",
    bytes: pdfBytes,
    actor: { id: args.actor.id, label: args.actor.name },
  });

  // 2. Register the PDF in the Document Library (the e-sign flow archives
  //    the signed result against a library document).
  const libDoc = await createDocument({
    orgId: args.orgId,
    uploader: { id: args.actor.id, name: args.actor.name },
    title: args.title ?? contract.title,
    category: "contract",
    accountId: contract.accountId,
    aiRetrieval: false,
    notes: `Contract record ${contract.id} — sent for signature`,
    fileName: pdfDoc.fileName,
    mime: "application/pdf",
    bytes: pdfBytes,
  });
  if (!libDoc.ok) {
    return { ok: false, code: "library-store-failed", message: libDoc.reason };
  }

  // Task #291/#298 — the template's counterparty ("second party")
  // signature-block fields are left as blanks in the prepared document,
  // so matching DocuSeal boxes are stamped near the signature block:
  //   date fields — a "Date signed" box beneath EVERY signer's signature
  //     (DocuSeal fills date fields automatically at signing);
  //   other fields (printed name, title, …) — a labelled text box the
  //     COUNTERPARTY signer completes while signing.
  type ContractExtraField = {
    signerIndex: number;
    type: "date" | "text";
    label?: string | null;
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
  };
  let extraFields: ContractExtraField[] | null = null;
  if (contract.templateVersionId) {
    const [tv] = await db
      .select()
      .from(atelierContractTemplateVersions)
      .where(eq(atelierContractTemplateVersions.id, contract.templateVersionId));
    const spFields = normalizeFieldSchema(tv?.fieldSchema ?? []).filter(
      (f) => f.role === "second_party",
    );
    const hasSecondPartyDate = spFields.some((f) => f.dataType === "date");
    const spTextFields = spFields.filter((f) => f.dataType !== "date");
    const built: ContractExtraField[] = [];
    if (hasSecondPartyDate) {
      for (let i = 0; i < args.signers.length; i++) {
        const sig = defaultSignaturePlacement(i, 0); // page overwritten below
        built.push({
          signerIndex: i,
          type: "date" as const,
          // Same column as the signature box, directly beneath it. The
          // e-sign layer clamps the page to the document's last page.
          page: 9999,
          x: sig.x,
          y: Math.min(0.95, sig.y + 0.055),
          w: 0.18,
          h: 0.03,
        });
      }
    }
    if (spTextFields.length > 0) {
      // The counterparty is the signer whose email matches the contract's
      // person/contact record; when no email matches (or the counterparty
      // is a whole account), the first signer is assumed — the firm-side
      // partner is added after the client in practice.
      const cpIndex = await resolveCounterpartySignerIndex(contract, args.signers);
      const sig = defaultSignaturePlacement(cpIndex, 0);
      const base = sig.y + 0.055 + (hasSecondPartyDate ? 0.035 : 0);
      spTextFields.forEach((f, k) => {
        built.push({
          signerIndex: cpIndex,
          type: "text" as const,
          label: f.label || f.key,
          page: 9999,
          x: sig.x,
          y: Math.min(0.95, base + k * 0.035),
          w: 0.32,
          h: 0.03,
        });
      });
    }
    if (built.length > 0) extraFields = built;
  }

  // 3. Hand off to the existing DocuSeal e-sign flow.
  try {
    const sent = await sendSignatureRequest({
      orgId: args.orgId,
      actor: { id: args.actor.id, name: args.actor.name },
      title: args.title ?? contract.title,
      message: args.message ?? null,
      documentId: libDoc.document.id,
      documentVersionId: libDoc.version.id,
      fileName: pdfDoc.fileName,
      pdfBytes,
      signers: args.signers,
      accountId: contract.accountId,
      contactId: contract.contactId,
      personId: contract.personId,
      expiresAt: args.expiresAt ?? null,
      extraFields,
    });
    const [updated] = await db
      .update(atelierContractRecords)
      .set({
        status: "out_for_signature",
        signatureRequestId: sent.request.id,
        currentDocumentId: pdfDoc.id,
        updatedAt: new Date(),
      })
      .where(eq(atelierContractRecords.id, contract.id))
      .returning();
    await auditContractEntity({
      entityType: "atelier_contract_record",
      entityId: contract.id,
      actorId: args.actor.id,
      actorLabel: args.actor.name,
      action: "contract.send_for_signature",
      payload: {
        signatureRequestId: sent.request.id,
        signers: args.signers.map((s) => s.email),
        from: contract.status,
      },
      summary: `Sent contract "${contract.title}" for signature (${args.signers.length} signer(s))`,
    });
    return { ok: true, contract: updated, pdfDoc, signatureRequestId: sent.request.id };
  } catch (err) {
    if (err instanceof DocusealError) {
      return { ok: false, code: "docuseal-error", message: err.message };
    }
    throw err;
  }
}
