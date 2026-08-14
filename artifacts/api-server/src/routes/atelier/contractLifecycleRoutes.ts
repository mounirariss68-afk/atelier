/**
 * Task #159 — Contract lifecycle routes.
 *
 * Templates (partner-tier only):
 *   GET    /contract-templates                    — list
 *   POST   /contract-templates                    — multipart .docx upload + LLM field detection
 *   GET    /contract-templates/:id                — detail incl. versions + field schema
 *   PATCH  /contract-templates/:id                — rename / retype / archive
 *   PUT    /contract-templates/:id/fields         — review & save field schema (activates template)
 *   POST   /contract-templates/:id/versions       — multipart new version (re-detects fields)
 *   GET    /contract-templates/:id/download       — stream the .docx (?versionId=)
 *
 * Contract records:
 *   GET    /contracts                             — list (ACL-filtered) + filters
 *   POST   /contracts                             — prepare from template (fills the .docx)
 *   GET    /contracts/:id                         — detail incl. document chain
 *   PATCH  /contracts/:id                         — status transitions / dates / notes
 *   POST   /contracts/:id/regenerate              — re-fill draft with updated values
 *   POST   /contracts/:id/final                   — multipart final .docx upload (post-redline)
 *   POST   /contracts/:id/send-for-signature      — convert to PDF + DocuSeal via e-sign flow
 *   GET    /contracts/:id/documents/:docId/download
 *
 * Access model:
 *   - manage (create/transition/send): partner-tier (canApproveAsPartner).
 *   - read: partner-tier; the record owner; account-linked records respect
 *     canSeeAccount; person-linked records are readable by that person
 *     (their roster row's userId) — powers the Me lens view.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import multer from "multer";
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAccounts,
  atelierContacts,
  atelierEmployees,
  atelierFirmProfile,
  atelierContractTemplates,
  atelierContractTemplateVersions,
  atelierContractRecords,
  atelierContractDocuments,
  atelierSignatureRequests,
  atelierSignatureSigners,
  type ContractTemplateField,
  type PriorFieldReview,
} from "@workspace/db";
import { canApproveAsPartner, canEditPeople, isFinance } from "./personaRoles";
import {
  createSalaryProposal,
  findLiveProposal,
  isSalaryEligible,
  runSalaryExtraction,
} from "../../lib/atelier-contract-salary-service.js";
import { assertAuditAction } from "./auditContract.js";
import { emitSelfNotification } from "./meRoutes.js";
import { canSeeAccount } from "./accountRoutes";
import { accessibleEngagementIds } from "./engagementRoutes";
import {
  CONTRACT_TYPES,
  CONTRACT_STATUSES,
  CONTRACT_MAX_BYTES,
  DOCX_MIME,
  TERMINAL_CONTRACT_STATUSES,
  canTransition,
  rid,
  looksLikeDocx,
  extractDocxText,
  detectTemplateFields,
  verifyPlaceholders,
  findMissingPlaceholders,
  normalizeFieldSchema,
  ContractFieldDetectionError,
  ContractFillError,
  PdfConversionError,
  fillDocxTemplate,
  convertDocxToPdf,
  loadContractBytes,
  storeContractBytes,
  addContractDocument,
  auditContractEntity,
  sweepExpiredContracts,
  backfillSecondPartyValues,
} from "../../lib/atelier-contracts.js";
import {
  loadTemplate,
  loadContract,
  listEntitySignatories,
  resolveCounterparty,
  firmAutoFill,
  buildFieldValues,
  prepareContract,
  sendContract,
  allocateReferenceSeries,
  formatReferenceValue,
  type Counterparty,
} from "../../lib/atelier-contract-service.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";

type Me = typeof atelierUsers.$inferSelect;
type TemplateRow = typeof atelierContractTemplates.$inferSelect;
type TemplateVersionRow = typeof atelierContractTemplateVersions.$inferSelect;
type ContractRow = typeof atelierContractRecords.$inferSelect;
type ContractDocRow = typeof atelierContractDocuments.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

/** Partner-tier gate for all contract management surfaces. */
function ensureContractManager(me: Me, res: Response): boolean {
  if (canApproveAsPartner(me.role)) return true;
  res.status(403).json({
    error: "contract-role",
    message: "Only partners and founding partners may manage contracts.",
  });
  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONTRACT_MAX_BYTES },
});

function uploadSingle(req: Request, res: Response, next: (err?: unknown) => void): void {
  upload.single("file")(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: "upload-error", message: err.message });
      return;
    }
    res.status(400).json({ error: "upload-error", message: String(err) });
  });
}

function requireDocxUpload(req: Request, res: Response): Buffer | null {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file || file.buffer.length === 0) {
    res.status(400).json({ error: "missing-file", message: "Upload a .docx file as `file`." });
    return null;
  }
  const name = (file.originalname || "").toLowerCase();
  if (!name.endsWith(".docx") || !looksLikeDocx(file.buffer)) {
    res.status(400).json({
      error: "not-docx",
      message: "Contract templates and final uploads must be Word .docx files.",
    });
    return null;
  }
  return file.buffer;
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

function versionShape(v: TemplateVersionRow) {
  return {
    id: v.id,
    templateId: v.templateId,
    versionNumber: v.versionNumber,
    fileName: v.fileName,
    sizeBytes: v.sizeBytes,
    // Task #291 — old reviewed schemas gain role/defaultHint via
    // deterministic re-detection at read time; explicit metadata wins.
    fieldSchema: normalizeFieldSchema(v.fieldSchema),
    fieldStatus: v.fieldStatus,
    detectionWarnings: v.detectionWarnings ?? [],
    priorFieldReview: v.priorFieldReview ?? null,
    createdBy: v.createdBy,
    createdAt: v.createdAt,
  };
}

function templateShape(t: TemplateRow, current?: TemplateVersionRow | null, versions?: TemplateVersionRow[]) {
  return {
    id: t.id,
    name: t.name,
    contractType: t.contractType,
    status: t.status,
    currentVersionId: t.currentVersionId,
    createdBy: t.createdBy,
    createdByLabel: t.createdByLabel,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    ...(current !== undefined ? { currentVersion: current ? versionShape(current) : null } : {}),
    ...(versions ? { versions: versions.map(versionShape) } : {}),
  };
}

function docShape(d: ContractDocRow) {
  return {
    id: d.id,
    contractId: d.contractId,
    versionNumber: d.versionNumber,
    kind: d.kind,
    fileName: d.fileName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    createdBy: d.createdBy,
    createdByLabel: d.createdByLabel,
    createdAt: d.createdAt,
  };
}

function contractShape(c: ContractRow, documents?: ContractDocRow[]) {
  return {
    id: c.id,
    title: c.title,
    contractType: c.contractType,
    templateId: c.templateId,
    templateVersionId: c.templateVersionId,
    counterpartyKind: c.counterpartyKind,
    personId: c.personId,
    contactId: c.contactId,
    accountId: c.accountId,
    counterpartyLabel: c.counterpartyLabel,
    signingEntityId: c.signingEntityId,
    signingEntityLabel: c.signingEntityLabel,
    signingEntityCountry: c.signingEntityCountry,
    status: c.status,
    fieldValues: c.fieldValues ?? {},
    ownerUserId: c.ownerUserId,
    ownerLabel: c.ownerLabel,
    effectiveDate: c.effectiveDate,
    expiryDate: c.expiryDate,
    currentDocumentId: c.currentDocumentId,
    signatureRequestId: c.signatureRequestId,
    signedLibraryDocumentId: c.signedLibraryDocumentId,
    notes: c.notes,
    firmSignatureRequestedAt: c.firmSignatureRequestedAt,
    firmSignatureRequestedBy: c.firmSignatureRequestedBy,
    firmSignatureRequestedByLabel: c.firmSignatureRequestedByLabel,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    ...(documents ? { documents: documents.map(docShape) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Read ACL
// ---------------------------------------------------------------------------

async function canSeeContract(me: Me, c: ContractRow): Promise<boolean> {
  if (canApproveAsPartner(me.role)) return true;
  if (c.ownerUserId === me.id) return true;
  // Task #346 — an authorised signatory of the contract's signing entity can
  // read the contract while their firm signature is being requested, even if
  // they aren't partner-tier; otherwise the "awaiting your signature" home
  // card and notification would link to a 403.
  if (c.firmSignatureRequestedAt && c.signingEntityId) {
    const signatories = await listEntitySignatories(me.orgId, c.signingEntityId);
    if (signatories.some((s) => s.userId === me.id)) return true;
  }
  if (c.personId) {
    const [emp] = await db
      .select({ userId: atelierEmployees.userId })
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, c.personId));
    if (emp?.userId === me.id) return true;
  }
  if (c.accountId) {
    const access = await accessibleEngagementIds(me);
    return canSeeAccount(access, me, c.accountId);
  }
  return false;
}

async function detectForUpload(buf: Buffer): Promise<{
  fields: ContractTemplateField[];
  warnings: string[];
}> {
  const text = await extractDocxText(buf);
  if (text.trim().length === 0) {
    throw new ContractFieldDetectionError("The document contains no extractable text.");
  }
  const detected = await detectTemplateFields(text);
  const warnings = [...detected.warnings, ...verifyPlaceholders(detected.fields, text)];
  return { fields: detected.fields, warnings };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: IRouter = Router();

// ------------------------- Templates -------------------------

// @cli-skip: contract-template management is UI-driven (Task #159)
router.get("/contract-templates", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const templates = await db
    .select()
    .from(atelierContractTemplates)
    .where(eq(atelierContractTemplates.orgId, me.orgId))
    .orderBy(desc(atelierContractTemplates.createdAt));
  const versionIds = templates.map((t) => t.currentVersionId).filter((x): x is string => !!x);
  const versions =
    versionIds.length > 0
      ? await db
          .select()
          .from(atelierContractTemplateVersions)
          .where(inArray(atelierContractTemplateVersions.id, versionIds))
      : [];
  const byId = new Map(versions.map((v) => [v.id, v]));
  res.json({
    templates: templates.map((t) =>
      templateShape(t, t.currentVersionId ? (byId.get(t.currentVersionId) ?? null) : null),
    ),
  });
});

const templateCreateFields = z.object({
  name: z.string().trim().min(1).max(200),
  contractType: z.enum(CONTRACT_TYPES).default("other"),
});

// @cli-skip: contract-template management is UI-driven (Task #159)
router.post("/contract-templates", uploadSingle, async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const buf = requireDocxUpload(req, res);
  if (!buf) return;
  const parsed = templateCreateFields.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const file = (req as Request & { file?: Express.Multer.File }).file!;

  let detection: { fields: ContractTemplateField[]; warnings: string[] };
  try {
    detection = await detectForUpload(buf);
  } catch (err) {
    if (err instanceof ContractFieldDetectionError) {
      res.status(422).json({ error: "field-detection-failed", message: err.message });
      return;
    }
    throw err;
  }
  const { blobRef, sha256 } = await storeContractBytes(buf);
  const templateId = rid("ctpl");
  const versionId = rid("ctv");
  const [template] = await db
    .insert(atelierContractTemplates)
    .values({
      id: templateId,
      orgId: me.orgId,
      name: parsed.data.name,
      contractType: parsed.data.contractType,
      status: "draft",
      currentVersionId: versionId,
      createdBy: me.id,
      createdByLabel: me.name,
    })
    .returning();
  const [version] = await db
    .insert(atelierContractTemplateVersions)
    .values({
      id: versionId,
      orgId: me.orgId,
      templateId,
      versionNumber: 1,
      fileName: file.originalname || "template.docx",
      sizeBytes: buf.length,
      sha256,
      blobRef,
      fieldSchema: detection.fields,
      fieldStatus: "detected",
      detectionWarnings: detection.warnings,
      createdBy: me.id,
    })
    .returning();
  await auditContractEntity({
    entityType: "atelier_contract_template",
    entityId: templateId,
    actorId: me.id,
    actorLabel: me.name,
    action: "contract_template.create",
    payload: {
      name: parsed.data.name,
      contractType: parsed.data.contractType,
      fileName: version.fileName,
      detectedFields: detection.fields.length,
      warnings: detection.warnings,
    },
    summary: `Uploaded contract template "${parsed.data.name}" (${detection.fields.length} fields detected)`,
  });
  res.status(201).json({ template: templateShape(template, version) });
});

// @cli-skip: contract-template management is UI-driven (Task #159)
router.get("/contract-templates/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const template = await loadTemplate(me.orgId, req.params.id);
  if (!template) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const versions = await db
    .select()
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.templateId, template.id))
    .orderBy(desc(atelierContractTemplateVersions.versionNumber));
  const current = versions.find((v) => v.id === template.currentVersionId) ?? null;
  res.json({ template: templateShape(template, current, versions) });
});

const templatePatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  contractType: z.enum(CONTRACT_TYPES).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

// @cli-skip: contract-template management is UI-driven (Task #159)
router.patch("/contract-templates/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const template = await loadTemplate(me.orgId, req.params.id);
  if (!template) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const parsed = templatePatch.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  if (parsed.data.status === "active") {
    const [current] = template.currentVersionId
      ? await db
          .select()
          .from(atelierContractTemplateVersions)
          .where(eq(atelierContractTemplateVersions.id, template.currentVersionId))
      : [];
    if (!current || current.fieldStatus !== "reviewed") {
      res.status(409).json({
        error: "fields-not-reviewed",
        message: "Review and save the detected fields before activating this template.",
      });
      return;
    }
  }
  const [updated] = await db
    .update(atelierContractTemplates)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(atelierContractTemplates.id, template.id))
    .returning();
  await auditContractEntity({
    entityType: "atelier_contract_template",
    entityId: template.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "contract_template.update",
    payload: { changes: parsed.data },
    summary: `Updated contract template "${updated.name}"`,
  });
  res.json({ template: templateShape(updated) });
});

const fieldSchemaBody = z.object({
  fields: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(200),
        placeholder: z.string().min(1).max(500),
        dataType: z.enum(["text", "date", "money", "number"]),
        autoFill: z.string().trim().max(60),
        required: z.boolean(),
        note: z.string().max(500).optional(),
        // Task #291 — dropdown options, field role, date default.
        options: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        role: z.enum(["standard", "second_party", "reference"]).optional(),
        defaultHint: z.literal("today").optional(),
      }),
    )
    .max(80),
});

// @cli-skip: contract-template management is UI-driven (Task #159)
router.put("/contract-templates/:id/fields", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const template = await loadTemplate(me.orgId, req.params.id);
  if (!template || !template.currentVersionId) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const parsed = fieldSchemaBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const keys = parsed.data.fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    res.status(400).json({ error: "duplicate-keys", message: "Field keys must be unique." });
    return;
  }
  // Validate every placeholder against the actual document BEFORE the
  // template activates — the same matching used at generation time — so
  // a contract can never fail later with "Could not locate placeholder".
  const [currentVersion] = await db
    .select()
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.id, template.currentVersionId));
  if (!currentVersion) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const templateBytes = await loadContractBytes(currentVersion.blobRef);
  if (!templateBytes) {
    res.status(409).json({
      error: "template-blob-missing",
      message: "The template document could not be loaded from storage.",
    });
    return;
  }
  const missingPlaceholders = await findMissingPlaceholders(
    templateBytes,
    parsed.data.fields.map((f) => f.placeholder),
  );
  if (missingPlaceholders.length > 0) {
    const missingSet = new Set(missingPlaceholders);
    const mismatched = parsed.data.fields.filter((f) => missingSet.has(f.placeholder));
    res.status(422).json({
      error: "placeholder-mismatch",
      message: `${mismatched.length} field${mismatched.length === 1 ? "" : "s"} cannot be matched to the document text. Fix or remove the highlighted fields — contract generation would fail with these placeholders.`,
      mismatches: mismatched.map((f) => ({
        key: f.key,
        label: f.label,
        placeholder: f.placeholder,
      })),
    });
    return;
  }
  const [version] = await db
    .update(atelierContractTemplateVersions)
    .set({ fieldSchema: parsed.data.fields, fieldStatus: "reviewed" })
    .where(eq(atelierContractTemplateVersions.id, template.currentVersionId))
    .returning();
  const activated = template.status === "draft";
  const [updated] = await db
    .update(atelierContractTemplates)
    .set({ ...(activated ? { status: "active" as const } : {}), updatedAt: new Date() })
    .where(eq(atelierContractTemplates.id, template.id))
    .returning();
  await auditContractEntity({
    entityType: "atelier_contract_template",
    entityId: template.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "contract_template.fields_reviewed",
    payload: { fieldCount: parsed.data.fields.length, activated },
    summary: `Reviewed ${parsed.data.fields.length} fill-in fields on "${template.name}"${activated ? " (template activated)" : ""}`,
  });
  res.json({ template: templateShape(updated, version) });
});

// @cli-skip: contract-template management is UI-driven (Task #159)
router.post("/contract-templates/:id/versions", uploadSingle, async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const template = await loadTemplate(me.orgId, String(req.params.id));
  if (!template) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const buf = requireDocxUpload(req, res);
  if (!buf) return;
  const file = (req as Request & { file?: Express.Multer.File }).file!;
  let detection: { fields: ContractTemplateField[]; warnings: string[] };
  try {
    detection = await detectForUpload(buf);
  } catch (err) {
    if (err instanceof ContractFieldDetectionError) {
      res.status(422).json({ error: "field-detection-failed", message: err.message });
      return;
    }
    throw err;
  }
  const prior = await db
    .select()
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.templateId, template.id));
  const nextNumber = prior.reduce((mx, r) => Math.max(mx, r.versionNumber), 0) + 1;
  // Reconcile the previous version's REVIEWED schema against the new
  // document so reviewers can see which confirmed fields carried over and
  // which no longer match — instead of silently discarding the old review.
  let priorFieldReview: PriorFieldReview | null = null;
  const previous = prior.find((v) => v.id === template.currentVersionId) ?? null;
  if (previous && previous.fieldStatus === "reviewed" && previous.fieldSchema.length > 0) {
    const missing = new Set(
      await findMissingPlaceholders(
        buf,
        previous.fieldSchema.map((f) => f.placeholder),
      ),
    );
    priorFieldReview = {
      fromVersionNumber: previous.versionNumber,
      fields: previous.fieldSchema.map((f) => ({
        ...f,
        status: missing.has(f.placeholder) ? ("missing" as const) : ("carried_over" as const),
      })),
    };
  }
  const { blobRef, sha256 } = await storeContractBytes(buf);
  const [version] = await db
    .insert(atelierContractTemplateVersions)
    .values({
      id: rid("ctv"),
      orgId: me.orgId,
      templateId: template.id,
      versionNumber: nextNumber,
      fileName: file.originalname || "template.docx",
      sizeBytes: buf.length,
      sha256,
      blobRef,
      fieldSchema: detection.fields,
      fieldStatus: "detected",
      detectionWarnings: detection.warnings,
      priorFieldReview,
      createdBy: me.id,
    })
    .returning();
  const [updated] = await db
    .update(atelierContractTemplates)
    .set({ currentVersionId: version.id, status: "draft", updatedAt: new Date() })
    .where(eq(atelierContractTemplates.id, template.id))
    .returning();
  await auditContractEntity({
    entityType: "atelier_contract_template",
    entityId: template.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "contract_template.new_version",
    payload: {
      versionNumber: nextNumber,
      fileName: version.fileName,
      detectedFields: detection.fields.length,
      ...(priorFieldReview
        ? {
            priorReviewReconciled: {
              fromVersionNumber: priorFieldReview.fromVersionNumber,
              carriedOver: priorFieldReview.fields.filter((f) => f.status === "carried_over")
                .length,
              missing: priorFieldReview.fields.filter((f) => f.status === "missing").length,
            },
          }
        : {}),
    },
    summary: `Uploaded v${nextNumber} of contract template "${template.name}"`,
  });
  res.status(201).json({ template: templateShape(updated, version) });
});

// @cli-skip: binary download surface (Task #159)
router.get("/contract-templates/:id/download", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const template = await loadTemplate(me.orgId, req.params.id);
  if (!template) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const versionId =
    typeof req.query.versionId === "string" ? req.query.versionId : template.currentVersionId;
  if (!versionId) {
    res.status(404).json({ error: "no-version" });
    return;
  }
  const [version] = await db
    .select()
    .from(atelierContractTemplateVersions)
    .where(
      and(
        eq(atelierContractTemplateVersions.id, versionId),
        eq(atelierContractTemplateVersions.templateId, template.id),
      ),
    );
  if (!version) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const bytes = await loadContractBytes(version.blobRef);
  if (!bytes) {
    res.status(410).json({ error: "blob-missing" });
    return;
  }
  res.setHeader("Content-Type", DOCX_MIME);
  res.setHeader(
    "Content-Disposition",
    contentDispositionFilename("attachment", version.fileName),
  );
  res.send(bytes);
});

// ------------------------- Contract records -------------------------

// Task #159 — Me-lens view. Employee/contractor personas are hard-gated
// to /me/* by the atelier router, so their own contracts are surfaced
// here (contracts linked to their roster row).
// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.get("/me/contracts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  await sweepExpiredContracts(me.orgId);
  const emps = await db
    .select({ id: atelierEmployees.id })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.orgId, me.orgId), eq(atelierEmployees.userId, me.id)));
  const ids = emps.map((e) => e.id);
  if (ids.length === 0) {
    res.json({ contracts: [] });
    return;
  }
  const rows = await db
    .select()
    .from(atelierContractRecords)
    .where(
      and(
        eq(atelierContractRecords.orgId, me.orgId),
        inArray(atelierContractRecords.personId, ids),
      ),
    )
    .orderBy(desc(atelierContractRecords.createdAt));
  res.json({ contracts: rows.map((c) => contractShape(c)) });
});

/**
 * Task #311/#318 — template field labels/roles for a contract, shared by
 * the partner detail (GET /contracts/:id) and the self-scope detail
 * (GET /me/contracts/:id) so both can group the counterparty's
 * captured-at-signing answers under human-readable labels.
 */
async function loadContractFieldMeta(
  templateVersionId: string | null,
): Promise<Array<{ key: string; label: string; role: string }>> {
  if (!templateVersionId) return [];
  const [version] = await db
    .select({ fieldSchema: atelierContractTemplateVersions.fieldSchema })
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.id, templateVersionId));
  if (!version) return [];
  return normalizeFieldSchema(version.fieldSchema).map((f) => ({
    key: f.key,
    label: f.label || f.key,
    role: f.role ?? "standard",
  }));
}

/**
 * Task #161 — resolve the caller's roster row ids (org-scoped). Powers the
 * self-scope /me/contracts/* routes below.
 */
async function myRosterIds(me: Me): Promise<string[]> {
  const emps = await db
    .select({ id: atelierEmployees.id })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.orgId, me.orgId), eq(atelierEmployees.userId, me.id)));
  return emps.map((e) => e.id);
}

/**
 * Task #161 — load a contract for the /me/contracts/:id surfaces. Only
 * contracts linked (personId) to the caller's own roster row are visible;
 * anything else is 403 (exists in org) / 404 (doesn't exist).
 */
async function loadMyContract(
  me: Me,
  contractId: string,
  res: Response,
): Promise<ContractRow | null> {
  const contract = await loadContract(me.orgId, contractId);
  if (!contract) {
    res.status(404).json({ error: "not-found" });
    return null;
  }
  const ids = await myRosterIds(me);
  if (!contract.personId || !ids.includes(contract.personId)) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return contract;
}

/**
 * Task #166 — signature history for a contract's e-sign request, shaped
 * for the Me-lens read-only detail (who signed, when, request status).
 * Returns null when the contract was never sent for signature.
 */
async function loadMySignatureHistory(
  orgId: string,
  signatureRequestId: string | null,
): Promise<Record<string, unknown> | null> {
  if (!signatureRequestId) return null;
  const [request] = await db
    .select()
    .from(atelierSignatureRequests)
    .where(
      and(
        eq(atelierSignatureRequests.id, signatureRequestId),
        eq(atelierSignatureRequests.orgId, orgId),
      ),
    );
  if (!request) return null;
  const signers = await db
    .select()
    .from(atelierSignatureSigners)
    .where(eq(atelierSignatureSigners.requestId, request.id));
  signers.sort((a, b) => a.signingOrder - b.signingOrder);
  return {
    id: request.id,
    title: request.title,
    status: request.status,
    createdAt: request.createdAt,
    completedAt: request.completedAt,
    declinedAt: request.declinedAt,
    expiresAt: request.expiresAt,
    signers: signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      signingOrder: s.signingOrder,
      status: s.status,
      openedAt: s.openedAt,
      completedAt: s.completedAt,
      declinedAt: s.declinedAt,
    })),
  };
}

// Task #161 — Me-lens read-only contract detail (documents chain + status).
// Task #166 — includes signature history (signers + completion) when the
// contract has been sent for e-signature.
// Task #318 — includes the template field labels/roles (same shape as
// GET /contracts/:id) so the self-scope page can render the counterparty's
// captured-at-signing answers under human-readable labels.
// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.get("/me/contracts/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const contract = await loadMyContract(me, req.params.id, res);
  if (!contract) return;
  // Task #318 — same repair safety net as the partner detail route: merge
  // in the counterparty's typed answers if the completion webhook missed them.
  const backfilled = await backfillSecondPartyValues(contract);
  if (backfilled) contract.fieldValues = backfilled;
  const documents = await db
    .select()
    .from(atelierContractDocuments)
    .where(eq(atelierContractDocuments.contractId, contract.id))
    .orderBy(desc(atelierContractDocuments.versionNumber));
  const signatureRequest = await loadMySignatureHistory(me.orgId, contract.signatureRequestId);
  const fields = await loadContractFieldMeta(contract.templateVersionId);
  res.json({ contract: contractShape(contract, documents), signatureRequest, fields });
});

// Task #161 — Me-lens document download (own signed PDF etc.).
// @cli-skip: binary download surface (Task #159)
router.get("/me/contracts/:id/documents/:docId/download", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const contract = await loadMyContract(me, req.params.id, res);
  if (!contract) return;
  const [doc] = await db
    .select()
    .from(atelierContractDocuments)
    .where(
      and(
        eq(atelierContractDocuments.id, req.params.docId),
        eq(atelierContractDocuments.contractId, contract.id),
      ),
    );
  if (!doc) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const bytes = await loadContractBytes(doc.blobRef);
  if (!bytes) {
    res.status(410).json({ error: "blob-missing" });
    return;
  }
  res.setHeader("Content-Type", doc.mime);
  res.setHeader(
    "Content-Disposition",
    contentDispositionFilename("attachment", doc.fileName),
  );
  res.send(bytes);
});

// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.get("/contracts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  await sweepExpiredContracts(me.orgId);
  const q = req.query;
  const conds = [eq(atelierContractRecords.orgId, me.orgId)];
  if (typeof q.status === "string" && q.status) {
    conds.push(eq(atelierContractRecords.status, q.status));
  }
  if (typeof q.contractType === "string" && q.contractType) {
    conds.push(eq(atelierContractRecords.contractType, q.contractType));
  }
  if (typeof q.personId === "string" && q.personId) {
    conds.push(eq(atelierContractRecords.personId, q.personId));
  }
  if (typeof q.contactId === "string" && q.contactId) {
    conds.push(eq(atelierContractRecords.contactId, q.contactId));
  }
  if (typeof q.accountId === "string" && q.accountId) {
    conds.push(eq(atelierContractRecords.accountId, q.accountId));
  }
  if (typeof q.ownerUserId === "string" && q.ownerUserId) {
    conds.push(eq(atelierContractRecords.ownerUserId, q.ownerUserId));
  }
  if (typeof q.counterparty === "string" && q.counterparty.trim()) {
    conds.push(ilike(atelierContractRecords.counterpartyLabel, `%${q.counterparty.trim()}%`));
  }
  const rows = await db
    .select()
    .from(atelierContractRecords)
    .where(and(...conds))
    .orderBy(desc(atelierContractRecords.createdAt));
  const visible: ContractRow[] = [];
  for (const c of rows) {
    if (await canSeeContract(me, c)) visible.push(c);
  }
  res.json({ contracts: visible.map((c) => contractShape(c)) });
});

// Task #346 — contracts where a firm signatory has been requested and the
// viewer is authorised to sign (or any partner-tier manager when the entity
// has no restriction configured). Powers the "Contracts awaiting your
// signature" home-page card. NOTE: must be registered before GET
// /contracts/:id or Express would treat "awaiting-my-signature" as an :id.
// @cli-skip: contract lifecycle is UI-driven (Task #346)
router.get("/contracts/awaiting-my-signature", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierContractRecords)
    .where(
      and(
        eq(atelierContractRecords.orgId, me.orgId),
        isNotNull(atelierContractRecords.firmSignatureRequestedAt),
      ),
    )
    .orderBy(desc(atelierContractRecords.firmSignatureRequestedAt));
  // sendContract clears firmSignatureRequestedAt, but guard against terminal
  // statuses anyway so a cancelled/expired contract never lingers here.
  const live = rows.filter((c) => !TERMINAL_CONTRACT_STATUSES.has(c.status));
  const signatoryCache = new Map<string, Array<{ userId: string }>>();
  const mine: ContractRow[] = [];
  for (const c of live) {
    if (!c.signingEntityId) {
      // No signing entity: legacy record — any partner-tier manager may sign.
      if (canApproveAsPartner(me.role)) mine.push(c);
      continue;
    }
    let signatories = signatoryCache.get(c.signingEntityId);
    if (!signatories) {
      signatories = await listEntitySignatories(me.orgId, c.signingEntityId);
      signatoryCache.set(c.signingEntityId, signatories);
    }
    if (signatories.length === 0) {
      // Empty list = no restriction configured; any partner-tier manager.
      if (canApproveAsPartner(me.role)) mine.push(c);
    } else if (signatories.some((s) => s.userId === me.id)) {
      mine.push(c);
    }
  }
  res.json({
    contracts: mine.map((c) => ({
      id: c.id,
      title: c.title,
      contractType: c.contractType,
      status: c.status,
      counterpartyLabel: c.counterpartyLabel,
      signingEntityLabel: c.signingEntityLabel,
      requestedAt: c.firmSignatureRequestedAt,
      requestedByLabel: c.firmSignatureRequestedByLabel,
    })),
  });
});

// Task #313 — typeahead search over team members, contacts and accounts so
// the "Prepare a contract" dialog no longer requires pasting a raw record id.
// NOTE: must be registered before GET /contracts/:id or Express would treat
// "counterparty-search" as an :id. (It is — /contracts/:id is defined below.)
// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.get("/contracts/counterparty-search", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const kind = typeof req.query.kind === "string" ? req.query.kind : "";
  if (kind !== "person" && kind !== "contact" && kind !== "account") {
    res.status(400).json({ error: "invalid-kind", message: "kind must be person, contact or account." });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20;
  const pat = `%${q}%`;
  let results: Array<{ kind: string; id: string; label: string; sublabel: string | null }> = [];
  if (kind === "person") {
    const conds = [eq(atelierEmployees.orgId, me.orgId)];
    if (q) {
      conds.push(
        or(
          ilike(atelierEmployees.fullName, pat),
          ilike(atelierEmployees.email, pat),
          ilike(atelierEmployees.preferredName, pat),
          // Task #538 — match structured person preferred/display name too.
          sql`EXISTS (SELECT 1 FROM atelier_persons p WHERE p.id = ${atelierEmployees.personId} AND (p.preferred_name ILIKE ${pat} OR p.display_name ILIKE ${pat}))`,
        )!,
      );
    }
    const rows = await db
      .select({
        id: atelierEmployees.id,
        fullName: atelierEmployees.fullName,
        title: atelierEmployees.title,
        email: atelierEmployees.email,
        employmentStatus: atelierEmployees.employmentStatus,
      })
      .from(atelierEmployees)
      .where(and(...conds))
      .orderBy(atelierEmployees.fullName)
      .limit(limit);
    results = rows.map((p) => ({
      kind,
      id: p.id,
      label: p.fullName,
      sublabel:
        [p.title, p.email].filter(Boolean).join(" · ") +
          (p.employmentStatus && p.employmentStatus !== "active" ? ` (${p.employmentStatus})` : "") ||
        null,
    }));
  } else if (kind === "contact") {
    const conds = [eq(atelierContacts.orgId, me.orgId)];
    if (q) {
      conds.push(
        or(
          ilike(atelierContacts.fullName, pat),
          ilike(atelierContacts.email, pat),
          // Task #538 — match structured person preferred/display name too.
          sql`EXISTS (SELECT 1 FROM atelier_persons p WHERE p.id = ${atelierContacts.personId} AND (p.preferred_name ILIKE ${pat} OR p.display_name ILIKE ${pat}))`,
        )!,
      );
    }
    const rows = await db
      .select({
        id: atelierContacts.id,
        fullName: atelierContacts.fullName,
        title: atelierContacts.title,
        accountName: atelierAccounts.name,
      })
      .from(atelierContacts)
      .leftJoin(atelierAccounts, eq(atelierAccounts.id, atelierContacts.accountId))
      .where(and(...conds))
      .orderBy(atelierContacts.fullName)
      .limit(limit);
    results = rows.map((c) => ({
      kind,
      id: c.id,
      label: c.fullName,
      sublabel: [c.title, c.accountName].filter(Boolean).join(" · ") || null,
    }));
  } else {
    const conds = [eq(atelierAccounts.orgId, me.orgId)];
    if (q) {
      conds.push(or(ilike(atelierAccounts.name, pat), ilike(atelierAccounts.brandName, pat))!);
    }
    const rows = await db
      .select({
        id: atelierAccounts.id,
        name: atelierAccounts.name,
        hqCity: atelierAccounts.hqCity,
        country: atelierAccounts.country,
        status: atelierAccounts.status,
      })
      .from(atelierAccounts)
      .where(and(...conds))
      .orderBy(atelierAccounts.name)
      .limit(limit);
    results = rows.map((a) => ({
      kind,
      id: a.id,
      label: a.name,
      sublabel:
        [[a.hqCity, a.country].filter(Boolean).join(", "), a.status !== "active" ? `(${a.status})` : ""]
          .filter(Boolean)
          .join(" ") || null,
    }));
  }
  res.json({ results });
});

const contractCreateBody = z.object({
  templateId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(300).optional(),
  counterparty: z.object({
    kind: z.enum(["person", "contact", "account"]),
    id: z.string().trim().min(1),
  }),
  // Task #237 — required: every contract must record its Cognirise signing entity.
  signingEntityId: z.string().trim().min(1).max(120),
  values: z.record(z.string().max(2000)).default({}),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(4000).optional(),
});

// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.post("/contracts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const parsed = contractCreateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const result = await prepareContract({
    orgId: me.orgId,
    actor: { id: me.id, name: me.name },
    templateId: body.templateId,
    counterparty: body.counterparty,
    signingEntityId: body.signingEntityId,
    title: body.title ?? null,
    values: body.values,
    effectiveDate: body.effectiveDate ?? null,
    expiryDate: body.expiryDate ?? null,
    notes: body.notes ?? null,
  });
  if (!result.ok) {
    const status =
      result.code === "template-not-found" ||
      result.code === "counterparty-not-found" ||
      result.code === "signing-entity-not-found"
        ? 404
        : result.code === "template-not-active" || result.code === "template-version-missing"
          ? 409
          : result.code === "template-blob-missing"
            ? 410
            : 422;
    res.status(status).json({
      error: result.code.replace(/_/g, "-"),
      message: result.message,
      ...(result.missing ? { missing: result.missing } : {}),
      ...(result.fields ? { fields: result.fields } : {}),
    });
    return;
  }
  res.status(201).json({ contract: contractShape(result.contract, [result.doc]) });
});

// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.get("/contracts/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  await sweepExpiredContracts(me.orgId);
  const contract = await loadContract(me.orgId, req.params.id);
  if (!contract || !(await canSeeContract(me, contract))) {
    res.status(contract ? 403 : 404).json({ error: contract ? "forbidden" : "not-found" });
    return;
  }
  // Task #310 — safety net: if the one-shot completed→signed merge ever
  // missed the counterparty's typed answers, repair them on detail open
  // (status untouched; DocuSeal errors are swallowed inside).
  const backfilled = await backfillSecondPartyValues(contract);
  if (backfilled) contract.fieldValues = backfilled;
  const documents = await db
    .select()
    .from(atelierContractDocuments)
    .where(eq(atelierContractDocuments.contractId, contract.id))
    .orderBy(desc(atelierContractDocuments.versionNumber));
  // Task #311 — surface the template's field labels/roles so the UI can
  // group the counterparty's captured-at-signing answers under their
  // human-readable labels instead of raw keys.
  const fields = await loadContractFieldMeta(contract.templateVersionId);
  // Task #335 — firm-side signing authority for this contract's signing
  // entity: who may "Sign & send" and whether the viewer is one of them.
  const signatories = contract.signingEntityId
    ? await listEntitySignatories(me.orgId, contract.signingEntityId)
    : [];
  const signing = {
    signatories: signatories.map((s) => ({ userId: s.userId, name: s.name })),
    // Empty list = legacy behaviour: any partner-tier manager may sign.
    viewerIsAuthorisedSignatory:
      canApproveAsPartner(me.role) &&
      (signatories.length === 0 || signatories.some((s) => s.userId === me.id)),
  };
  res.json({ contract: contractShape(contract, documents), fields, signing });
});

const contractPatch = z.object({
  status: z.enum(CONTRACT_STATUSES).optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  title: z.string().trim().min(1).max(300).optional(),
});

// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.patch("/contracts/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const contract = await loadContract(me.orgId, req.params.id);
  if (!contract) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const parsed = contractPatch.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  if (body.status && body.status !== contract.status) {
    if (TERMINAL_CONTRACT_STATUSES.has(contract.status)) {
      res.status(409).json({
        error: "terminal-status",
        message: `Contract is ${contract.status} — terminal statuses never change.`,
      });
      return;
    }
    // Signature-driven statuses flow from the e-sign sync, not manual edits.
    if (["signed", "declined", "expired", "out_for_signature"].includes(body.status)) {
      res.status(409).json({
        error: "signature-driven-status",
        message: "That status is set by the signature flow, not manually.",
      });
      return;
    }
    if (!canTransition(contract.status, body.status)) {
      res.status(409).json({
        error: "invalid-transition",
        message: `Cannot move ${contract.status} → ${body.status}.`,
      });
      return;
    }
  }
  const [updated] = await db
    .update(atelierContractRecords)
    .set({
      ...(body.status ? { status: body.status } : {}),
      ...(body.title ? { title: body.title } : {}),
      ...(body.effectiveDate !== undefined
        ? { effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : null }
        : {}),
      ...(body.expiryDate !== undefined
        ? { expiryDate: body.expiryDate ? new Date(body.expiryDate) : null }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(atelierContractRecords.id, contract.id))
    .returning();
  await auditContractEntity({
    entityType: "atelier_contract_record",
    entityId: contract.id,
    actorId: me.id,
    actorLabel: me.name,
    action: body.status && body.status !== contract.status ? "contract.status" : "contract.update",
    payload: { changes: body, from: contract.status },
    summary:
      body.status && body.status !== contract.status
        ? `Contract "${updated.title}" moved ${contract.status} → ${body.status}`
        : `Updated contract "${updated.title}"`,
  });
  res.json({ contract: contractShape(updated) });
});

const regenerateBody = z.object({
  values: z.record(z.string().max(2000)).default({}),
});

// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.post("/contracts/:id/regenerate", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const contract = await loadContract(me.orgId, req.params.id);
  if (!contract) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (!["draft", "out_for_review"].includes(contract.status)) {
    res.status(409).json({
      error: "not-editable",
      message: "Only draft or in-review contracts can be regenerated.",
    });
    return;
  }
  if (!contract.templateVersionId) {
    res.status(409).json({ error: "no-template", message: "This contract has no template." });
    return;
  }
  const parsed = regenerateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const [version] = await db
    .select()
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.id, contract.templateVersionId));
  if (!version) {
    res.status(410).json({ error: "template-version-missing" });
    return;
  }
  const values = { ...(contract.fieldValues ?? {}), ...parsed.data.values };
  // Task #291 — second-party/reference fields are never user-supplied:
  // they don't count as missing (the reference value assigned at prepare
  // time is already in contract.fieldValues and carries over).
  const schemaForRegen = normalizeFieldSchema(version.fieldSchema);
  const missingRequired = schemaForRegen
    .filter((f) => (f.role ?? "standard") === "standard")
    .filter((f) => f.required && (values[f.key] == null || values[f.key] === ""))
    .map((f) => f.key);
  if (missingRequired.length > 0) {
    res.status(422).json({
      error: "missing-required-fields",
      missing: missingRequired,
      fields: schemaForRegen,
    });
    return;
  }
  // Task #330 — drafts prepared before their template's reference field
  // was classified never got a number (the raw placeholder shipped
  // verbatim). Allocate one on regenerate when the value is absent or
  // still equals the placeholder; otherwise the assigned number carries
  // over unchanged.
  for (const f of schemaForRegen.filter((x) => x.role === "reference")) {
    const cur = values[f.key];
    if ((cur == null || cur === "" || cur === f.placeholder) && contract.templateId) {
      const year = new Date().getFullYear();
      const series = await allocateReferenceSeries({
        orgId: me.orgId,
        templateId: contract.templateId,
        year,
      });
      values[f.key] = formatReferenceValue(f.placeholder, year, series);
    }
  }
  const templateBytes = await loadContractBytes(version.blobRef);
  if (!templateBytes) {
    res.status(410).json({ error: "template-blob-missing" });
    return;
  }
  let draft: Buffer;
  try {
    draft = await fillDocxTemplate({ templateBytes, fields: version.fieldSchema, values });
  } catch (err) {
    if (err instanceof ContractFillError) {
      res.status(422).json({ error: "fill-failed", message: err.message, missing: err.missing });
      return;
    }
    throw err;
  }
  const doc = await addContractDocument({
    contractId: contract.id,
    kind: "generated_draft",
    fileName: `${contract.title.replace(/[^\w.\- ]+/g, "_")}.docx`,
    mime: DOCX_MIME,
    bytes: draft,
    actor: { id: me.id, label: me.name },
  });
  const [updated] = await db
    .update(atelierContractRecords)
    .set({ fieldValues: values, currentDocumentId: doc.id, updatedAt: new Date() })
    .where(eq(atelierContractRecords.id, contract.id))
    .returning();
  await auditContractEntity({
    entityType: "atelier_contract_record",
    entityId: contract.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "contract.regenerate",
    payload: { values: parsed.data.values },
    summary: `Regenerated draft for contract "${contract.title}"`,
  });
  res.status(201).json({ contract: contractShape(updated, [doc]) });
});

// @cli-skip: multipart final-docx upload is UI-driven (Task #159)
router.post("/contracts/:id/final", uploadSingle, async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const contract = await loadContract(me.orgId, String(req.params.id));
  if (!contract) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (TERMINAL_CONTRACT_STATUSES.has(contract.status) || contract.status === "out_for_signature") {
    res.status(409).json({
      error: "not-editable",
      message: `Cannot upload a final version while the contract is ${contract.status}.`,
    });
    return;
  }
  const buf = requireDocxUpload(req, res);
  if (!buf) return;
  const file = (req as Request & { file?: Express.Multer.File }).file!;
  const doc = await addContractDocument({
    contractId: contract.id,
    kind: "final_docx",
    fileName: file.originalname || "final.docx",
    mime: DOCX_MIME,
    bytes: buf,
    actor: { id: me.id, label: me.name },
  });
  const [updated] = await db
    .update(atelierContractRecords)
    .set({ status: "final_uploaded", currentDocumentId: doc.id, updatedAt: new Date() })
    .where(eq(atelierContractRecords.id, contract.id))
    .returning();
  await auditContractEntity({
    entityType: "atelier_contract_record",
    entityId: contract.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "contract.final_upload",
    payload: { fileName: doc.fileName, from: contract.status },
    summary: `Uploaded final Word version for contract "${contract.title}"`,
  });
  res.status(201).json({ contract: contractShape(updated, [doc]) });
});

const sendBody = z.object({
  signers: z
    .array(z.object({ name: z.string().trim().min(1), email: z.string().trim().email() }))
    .min(1)
    .max(10),
  title: z.string().trim().min(1).max(300).optional(),
  message: z.string().max(4000).optional(),
  expiresAt: z.string().datetime().optional(),
  /**
   * Task #335 — "Sign & send": the caller signs in-app FIRST (they are the
   * first signer), then DocuSeal emails the counterparty. Only authorised
   * signatories of the contract's signing entity may use this flow (when
   * the entity has a configured list; empty list = legacy: any partner).
   */
  signFirst: z.boolean().default(false),
});

// @cli-skip: e-sign handoff is UI/chat-capability-driven (Task #159)
router.post("/contracts/:id/send-for-signature", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const parsed = sendBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  // Task #335/#345 — the authorised-signatory gate for the firm-side
  // signing step lives inside sendContract (shared service) so no
  // surface (REST, chat/CLI, agents) can bypass it. The route only
  // passes the caller identity + intent through.
  const result = await sendContract({
    orgId: me.orgId,
    actor: { id: me.id, name: me.name },
    contractId: String(req.params.id),
    signers: parsed.data.signers,
    title: parsed.data.title ?? null,
    message: parsed.data.message ?? null,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    caller: { userId: me.id, email: me.email ?? null },
    signFirst: parsed.data.signFirst,
  });
  if (!result.ok) {
    const status =
      result.code === "docuseal-not-configured"
        ? 503
        : result.code === "not-found"
          ? 404
          : result.code === "invalid-status" || result.code === "no-document"
            ? 409
            : result.code === "duplicate-signers"
              ? 400
              : result.code === "not-authorised-signatory" ||
                  result.code === "sign-first-not-caller"
                ? 403
                : result.code === "document-missing" || result.code === "blob-missing"
                  ? 410
                  : 502;
    res.status(status).json({ error: result.code, message: result.message });
    return;
  }
  // Task #335 — a successful send resolves any pending internal
  // "awaiting firm signatory" request.
  if (result.contract.firmSignatureRequestedAt) {
    await db
      .update(atelierContractRecords)
      .set({
        firmSignatureRequestedAt: null,
        firmSignatureRequestedBy: null,
        firmSignatureRequestedByLabel: null,
      })
      .where(eq(atelierContractRecords.id, result.contract.id));
    result.contract.firmSignatureRequestedAt = null;
    result.contract.firmSignatureRequestedBy = null;
    result.contract.firmSignatureRequestedByLabel = null;
  }
  if (parsed.data.signFirst) {
    await auditContractEntity({
      entityType: "atelier_contract_record",
      entityId: result.contract.id,
      actorId: me.id,
      actorLabel: me.name,
      action: "contract.sign_first",
      payload: { signingEntityId: result.contract.signingEntityId },
      summary: `${me.name} signed & sent contract "${result.contract.title}" as authorised signatory`,
    });
  }
  res.status(201).json({
    contract: contractShape(result.contract, [result.pdfDoc]),
    signatureRequestId: result.signatureRequestId,
  });
});

/**
 * Task #335 — "Send for signature" (internal request). A contract manager
 * who is NOT an authorised signatory of the contract's signing entity flags
 * the contract as awaiting a firm signatory and notifies every authorised
 * signatory, who then executes "Sign & send" themselves.
 */
// @cli-skip: contract lifecycle is UI-driven (Task #335)
router.post("/contracts/:id/request-signature", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensureContractManager(me, res)) return;
  const contract = await loadContract(me.orgId, String(req.params.id));
  if (!contract) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (!["draft", "out_for_review", "final_uploaded"].includes(contract.status)) {
    res.status(409).json({
      error: "invalid-status",
      message: `Cannot request a firm signature while the contract is ${contract.status}.`,
    });
    return;
  }
  if (!contract.currentDocumentId) {
    res.status(409).json({
      error: "no-document",
      message: "Prepare or upload a document before requesting signature.",
    });
    return;
  }
  const signatories = contract.signingEntityId
    ? await listEntitySignatories(me.orgId, contract.signingEntityId)
    : [];
  if (signatories.length === 0) {
    res.status(409).json({
      error: "no-signatories",
      message:
        "This signing entity has no authorised signatories configured — configure them on the Firm Profile page, or use Sign & send directly.",
    });
    return;
  }
  const now = new Date();
  const [updated] = await db
    .update(atelierContractRecords)
    .set({
      firmSignatureRequestedAt: now,
      firmSignatureRequestedBy: me.id,
      firmSignatureRequestedByLabel: me.name,
      updatedAt: now,
    })
    .where(eq(atelierContractRecords.id, contract.id))
    .returning();
  for (const s of signatories) {
    if (s.userId === me.id) continue;
    await emitSelfNotification({
      orgId: me.orgId,
      userId: s.userId,
      kind: "contract_signature_requested",
      title: `Signature needed: ${contract.title}`,
      body: `${me.name} asked you to sign "${contract.title}" (${contract.signingEntityLabel ?? "firm"} side) and send it to ${contract.counterpartyLabel || "the counterparty"}.`,
      href: `/contracts/${contract.id}`,
    });
  }
  await auditContractEntity({
    entityType: "atelier_contract_record",
    entityId: contract.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "contract.signature_requested",
    payload: {
      signingEntityId: contract.signingEntityId,
      notified: signatories.filter((s) => s.userId !== me.id).map((s) => s.userId),
    },
    summary: `${me.name} requested a firm signatory for contract "${contract.title}"`,
  });
  res.json({
    contract: contractShape(updated),
    notified: signatories.map((s) => ({ userId: s.userId, name: s.name })),
  });
});

// Task #1137 — on-demand back-process: (re)run salary digitization for a
// signed employment contract whose counterparty is an employee. Gated on the
// payroll editor set (people editors + finance). Returns the existing live
// proposal via 409 (idempotent), else creates one + kicks extraction (202).
// @cli-skip: UI-workflow write; payroll-adjacent extraction — CLI exposure needs confirm-flow design
router.post("/contracts/:id/salary-extract", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!(canEditPeople(me.role) || isFinance(me.role))) {
    res.status(403).json({
      error: "payroll-role",
      message: "Only people editors and finance may digitize contract salary.",
    });
    return;
  }
  const contract = await loadContract(me.orgId, String(req.params.id));
  if (!contract) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (contract.status !== "signed") {
    res.status(409).json({
      error: "invalid-status",
      message: "Salary can only be digitized from a signed contract.",
    });
    return;
  }
  const { eligible, employeeId } = await isSalaryEligible(contract);
  if (!eligible || !employeeId) {
    res.status(409).json({
      error: "not-eligible",
      message:
        "Salary digitization applies to employment contracts whose counterparty is an employee.",
    });
    return;
  }
  const live = await findLiveProposal(me.orgId, contract.id);
  if (live) {
    res.status(409).json({
      error: "proposal-in-flight",
      message: "A salary proposal for this contract is already being processed or awaiting review.",
      proposalId: live.id,
    });
    return;
  }
  const { proposal, created } = await createSalaryProposal({
    orgId: me.orgId,
    contractId: contract.id,
    personId: employeeId,
  });
  // Lost the create race (a concurrent request beat us) — treat identically
  // to the pre-check 409: no audit, no second extraction.
  if (!created) {
    res.status(409).json({
      error: "proposal-in-flight",
      message: "A salary proposal for this contract is already being processed or awaiting review.",
      proposalId: proposal.id,
    });
    return;
  }
  assertAuditAction("contract.salary.extract_requested");
  await auditContractEntity({
    entityType: "atelier_contract_record",
    entityId: contract.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "contract.salary.extract_requested",
    payload: { proposalId: proposal.id, personId: employeeId },
    summary: `${me.name} requested salary digitization for contract "${contract.title}"`,
  });
  // Fire-and-forget — never block the request thread on the LLM.
  void runSalaryExtraction(proposal.id).catch((err) =>
    console.error(
      `[contracts] salary extraction crashed for ${proposal.id}:`,
      err instanceof Error ? err.message : err,
    ),
  );
  res.status(202).json({ proposalId: proposal.id });
});

// @cli-skip: binary download surface (Task #159)
router.get("/contracts/:id/documents/:docId/download", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const contract = await loadContract(me.orgId, req.params.id);
  if (!contract || !(await canSeeContract(me, contract))) {
    res.status(contract ? 403 : 404).json({ error: contract ? "forbidden" : "not-found" });
    return;
  }
  const [doc] = await db
    .select()
    .from(atelierContractDocuments)
    .where(
      and(
        eq(atelierContractDocuments.id, req.params.docId),
        eq(atelierContractDocuments.contractId, contract.id),
      ),
    );
  if (!doc) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const bytes = await loadContractBytes(doc.blobRef);
  if (!bytes) {
    res.status(410).json({ error: "blob-missing" });
    return;
  }
  res.setHeader("Content-Type", doc.mime);
  res.setHeader(
    "Content-Disposition",
    contentDispositionFilename("attachment", doc.fileName),
  );
  res.send(bytes);
});

export default router;
export { canSeeContract };
