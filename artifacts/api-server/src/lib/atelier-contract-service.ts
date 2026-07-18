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
  type ContractTemplateField,
} from "@workspace/db";
import {
  DOCX_MIME,
  ContractFillError,
  PdfConversionError,
  fillDocxTemplate,
  convertDocxToPdf,
  loadContractBytes,
  addContractDocument,
  auditContractEntity,
  rid,
} from "./atelier-contracts.js";
import { createDocument } from "./atelier-documents.js";
import { sendSignatureRequest } from "./atelier-esign.js";
import { DocusealError, docusealConfigured } from "./docuseal.js";

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

export async function firmAutoFill(orgId: string): Promise<Record<string, string>> {
  const [profile] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.orgId, orgId), eq(atelierFirmProfile.status, "published")))
    .orderBy(desc(atelierFirmProfile.version))
    .limit(1);
  const payload = profile?.payload as { firmName?: string; contactBlock?: string } | undefined;
  return {
    firm_name: payload?.firmName || "Cognirise",
    firm_address: payload?.contactBlock || "",
  };
}

/** Merge auto-fill + explicit values against the template's field schema. */
export function buildFieldValues(args: {
  fields: ContractTemplateField[];
  counterparty: Counterparty;
  firm: Record<string, string>;
  explicit: Record<string, string>;
  effectiveDate?: string | null;
  expiryDate?: string | null;
}): { values: Record<string, string>; missingRequired: string[] } {
  const values: Record<string, string> = {};
  const dateFill: Record<string, string> = {};
  if (args.effectiveDate) dateFill.effective_date = args.effectiveDate;
  if (args.expiryDate) dateFill.expiry_date = args.expiryDate;
  for (const f of args.fields) {
    const explicit = args.explicit[f.key];
    if (explicit != null && explicit !== "") {
      values[f.key] = explicit;
      continue;
    }
    const auto =
      args.counterparty.autoFill[f.autoFill] ?? args.firm[f.autoFill] ?? dateFill[f.autoFill];
    if (auto != null && auto !== "") values[f.key] = auto;
  }
  const missingRequired = args.fields
    .filter((f) => f.required && (values[f.key] == null || values[f.key] === ""))
    .map((f) => f.key);
  return { values, missingRequired };
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
  const firm = await firmAutoFill(args.orgId);
  const { values, missingRequired } = buildFieldValues({
    fields: version.fieldSchema,
    counterparty,
    firm,
    explicit: args.values ?? {},
    effectiveDate: args.effectiveDate,
    expiryDate: args.expiryDate,
  });
  if (missingRequired.length > 0) {
    return {
      ok: false,
      code: "missing-required-fields",
      message: `Values required for: ${missingRequired.join(", ")}`,
      missing: missingRequired,
      fields: version.fieldSchema,
    };
  }
  const templateBytes = await loadContractBytes(version.blobRef);
  if (!templateBytes) {
    return { ok: false, code: "template-blob-missing", message: "Template file is missing." };
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
