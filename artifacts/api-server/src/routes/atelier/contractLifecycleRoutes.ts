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
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
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
  type ContractTemplateField,
} from "@workspace/db";
import { canApproveAsPartner } from "./personaRoles";
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
} from "../../lib/atelier-contracts.js";
import {
  loadTemplate,
  loadContract,
  resolveCounterparty,
  firmAutoFill,
  buildFieldValues,
  prepareContract,
  sendContract,
  type Counterparty,
} from "../../lib/atelier-contract-service.js";

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
    fieldSchema: v.fieldSchema,
    fieldStatus: v.fieldStatus,
    detectionWarnings: v.detectionWarnings ?? [],
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
    .select({ v: atelierContractTemplateVersions.versionNumber })
    .from(atelierContractTemplateVersions)
    .where(eq(atelierContractTemplateVersions.templateId, template.id));
  const nextNumber = prior.reduce((mx, r) => Math.max(mx, r.v), 0) + 1;
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
    `attachment; filename="${version.fileName.replace(/[^\w.\- ]+/g, "_")}"`,
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

// Task #161 — Me-lens read-only contract detail (documents chain + status).
// @cli-skip: contract lifecycle is UI/chat-capability-driven (Task #159)
router.get("/me/contracts/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const contract = await loadMyContract(me, req.params.id, res);
  if (!contract) return;
  const documents = await db
    .select()
    .from(atelierContractDocuments)
    .where(eq(atelierContractDocuments.contractId, contract.id))
    .orderBy(desc(atelierContractDocuments.versionNumber));
  res.json({ contract: contractShape(contract, documents) });
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
    `attachment; filename="${doc.fileName.replace(/[^\w.\- ]+/g, "_")}"`,
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

const contractCreateBody = z.object({
  templateId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(300).optional(),
  counterparty: z.object({
    kind: z.enum(["person", "contact", "account"]),
    id: z.string().trim().min(1),
  }),
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
    title: body.title ?? null,
    values: body.values,
    effectiveDate: body.effectiveDate ?? null,
    expiryDate: body.expiryDate ?? null,
    notes: body.notes ?? null,
  });
  if (!result.ok) {
    const status =
      result.code === "template-not-found" || result.code === "counterparty-not-found"
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
  const documents = await db
    .select()
    .from(atelierContractDocuments)
    .where(eq(atelierContractDocuments.contractId, contract.id))
    .orderBy(desc(atelierContractDocuments.versionNumber));
  res.json({ contract: contractShape(contract, documents) });
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
  const missingRequired = version.fieldSchema
    .filter((f) => f.required && (values[f.key] == null || values[f.key] === ""))
    .map((f) => f.key);
  if (missingRequired.length > 0) {
    res.status(422).json({
      error: "missing-required-fields",
      missing: missingRequired,
      fields: version.fieldSchema,
    });
    return;
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
  const result = await sendContract({
    orgId: me.orgId,
    actor: { id: me.id, name: me.name },
    contractId: String(req.params.id),
    signers: parsed.data.signers,
    title: parsed.data.title ?? null,
    message: parsed.data.message ?? null,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
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
              : result.code === "document-missing" || result.code === "blob-missing"
                ? 410
                : 502;
    res.status(status).json({ error: result.code, message: result.message });
    return;
  }
  res.status(201).json({
    contract: contractShape(result.contract, [result.pdfDoc]),
    signatureRequestId: result.signatureRequestId,
  });
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
    `attachment; filename="${doc.fileName.replace(/[^\w.\- ]+/g, "_")}"`,
  );
  res.send(bytes);
});

export default router;
export { canSeeContract };
