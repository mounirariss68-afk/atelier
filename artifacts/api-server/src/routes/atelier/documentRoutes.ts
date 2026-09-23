/**
 * Task #61 — Document Library routes.
 *
 *   GET    /documents                       — list (ACL-filtered) + filters
 *   POST   /documents                       — multipart upload (file + metadata)
 *   GET    /documents/:id                   — detail incl. versions + grants
 *   PATCH  /documents/:id                   — title/category/notes/aiRetrieval
 *   DELETE /documents/:id                   — purge (blobs, chunks, versions)
 *   POST   /documents/:id/versions          — multipart new-version upload
 *   GET    /documents/:id/download          — stream bytes (?versionId=)
 *   POST   /documents/:id/access            — grant org-doc access to a user
 *   DELETE /documents/:id/access/:userId    — revoke a grant
 *
 * ACL model (per task spec — 403 on direct access, filtered on list):
 *   - founding_partner / partner: every document in the org.
 *   - uploader: their own documents.
 *   - account-scoped docs: `canSeeAccount` (same predicate as the account
 *     pages).
 *   - engagement-scoped docs: engagement access grant OR visibility of the
 *     engagement's account.
 *   - org-level docs (no scope): privileged roles + explicit per-person
 *     grants in atelier_document_access.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import multer from "multer";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAccounts,
  atelierEngagements,
  atelierDocuments,
  atelierDocumentVersions,
  atelierDocumentAccess,
  atelierAuditEvents,
  atelierLegalEntities,
} from "@workspace/db";
import {
  createDocument,
  addDocumentVersion,
  setDocumentAiRetrieval,
  purgeDocument,
  loadDocBytes,
  hasDocumentGrant,
  auditDocument,
  DOC_CATEGORIES,
  DOC_KINDS,
  DOC_MAX_BYTES,
  type DocCategory,
  type LegalDocKind,
} from "../../lib/atelier-documents.js";
import { canSeeAccount } from "./accountRoutes";
import { accessibleEngagementIds } from "./engagementRoutes";
import { isFoundingPartner, isPartner } from "./personaRoles";

type Me = typeof atelierUsers.$inferSelect;
type EngAccess = Awaited<ReturnType<typeof accessibleEngagementIds>>;
type DocRow = typeof atelierDocuments.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

const docPrivileged = (role: string | null | undefined): boolean =>
  isFoundingPartner(role) || isPartner(role);

async function engagementAccountId(engagementId: string, orgId: string): Promise<string | null> {
  const [eng] = await db
    .select({ accountId: atelierEngagements.accountId })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, engagementId), eq(atelierEngagements.orgId, orgId)));
  return eng?.accountId ?? null;
}

export async function canSeeDocument(me: Me, access: EngAccess, doc: DocRow): Promise<boolean> {
  if (docPrivileged(me.role)) return true;
  if (doc.uploaderUserId === me.id) return true;
  if (doc.engagementId) {
    if (access.all === true || access.ids.has(doc.engagementId)) return true;
    const accId = doc.accountId ?? (await engagementAccountId(doc.engagementId, me.orgId));
    if (accId) return canSeeAccount(access, me, accId);
    return false;
  }
  if (doc.accountId) return canSeeAccount(access, me, doc.accountId);
  // Org-level document: explicit grant required.
  return hasDocumentGrant(doc.id, me.id);
}

const TAX_DOCUMENT_KINDS = new Set(["tax_registration_ct", "tax_registration_vat"]);

/**
 * Tax certificate pointers are owned by the legal-entity registry.  A generic
 * document PATCH must not be able to create a second, untracked pointer (or
 * silently move a certificate between entities).
 */
async function validateTaxDocumentMutation(args: {
  me: Me;
  document: DocRow;
  nextEntityId: string | null;
  nextDocKind: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const currentIsTax = TAX_DOCUMENT_KINDS.has(args.document.docKind ?? "");
  const nextIsTax = TAX_DOCUMENT_KINDS.has(args.nextDocKind ?? "");
  if (!currentIsTax && !nextIsTax) return { ok: true };

  const currentEntityId = args.document.entityId;
  const ids = [currentEntityId, args.nextEntityId].filter((id): id is string => !!id);
  const entities = ids.length
    ? await db
        .select({
          id: atelierLegalEntities.id,
          status: atelierLegalEntities.status,
          registrations: atelierLegalEntities.registrations,
        })
        .from(atelierLegalEntities)
        .where(and(eq(atelierLegalEntities.orgId, args.me.orgId), inArray(atelierLegalEntities.id, ids)))
    : [];
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const currentEntity = currentEntityId ? byId.get(currentEntityId) : undefined;
  const currentRegistrations = (currentEntity?.registrations ?? []) as unknown as Array<{
    type: string;
    certificateDocumentId?: string | null;
  }>;
  const currentPointer = currentRegistrations.some(
    (registration) =>
      registration.type === args.document.docKind &&
      registration.certificateDocumentId === args.document.id,
  ) ?? false;

  if (currentIsTax && currentPointer && (args.nextEntityId !== currentEntityId || args.nextDocKind !== args.document.docKind)) {
    return {
      ok: false,
      status: 409,
      error: "tax-certificate-pointer-owned",
    };
  }
  if (!nextIsTax) return { ok: true };

  const nextEntity = args.nextEntityId ? byId.get(args.nextEntityId) : undefined;
  const nextRegistrations = (nextEntity?.registrations ?? []) as unknown as Array<{
    type: string;
    certificateDocumentId?: string | null;
  }>;
  const nextPointer = nextRegistrations.some(
    (registration) =>
      registration.type === args.nextDocKind &&
      registration.certificateDocumentId === args.document.id,
  ) ?? false;
  if (!nextEntity || nextEntity.status === "archived" || !nextPointer) {
    return {
      ok: false,
      status: 409,
      error: "tax-certificate-must-be-linked-through-entity-registry",
    };
  }
  return { ok: true };
}

async function currentTaxCertificatePointer(args: {
  orgId: string;
  documentId: string;
}): Promise<{ entityId: string; type: string } | null> {
  const entities = await db
    .select({
      id: atelierLegalEntities.id,
      registrations: atelierLegalEntities.registrations,
    })
    .from(atelierLegalEntities)
    .where(and(
      eq(atelierLegalEntities.orgId, args.orgId),
      ne(atelierLegalEntities.status, "archived"),
    ));
  for (const entity of entities) {
    const registrations = (entity.registrations ?? []) as unknown as Array<{
      type?: string;
      certificateDocumentId?: string | null;
    }>;
    const registration = registrations.find(
      (item) =>
        TAX_DOCUMENT_KINDS.has(item.type ?? "") &&
        item.certificateDocumentId === args.documentId,
    );
    if (registration?.type) return { entityId: entity.id, type: registration.type };
  }
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOC_MAX_BYTES, files: 1 },
});

function uploadSingle(req: Request, res: Response, next: (err?: unknown) => void): void {
  upload.single("file")(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        error: err.code.toLowerCase().replace(/_/g, "-"),
        message: err.message,
      });
      return;
    }
    res.status(400).json({ error: "upload-error", message: String(err) });
  });
}

function docShape(doc: DocRow, current?: typeof atelierDocumentVersions.$inferSelect | null) {
  return {
    id: doc.id,
    title: doc.title,
    category: doc.category,
    accountId: doc.accountId,
    engagementId: doc.engagementId,
    entityId: doc.entityId,
    docKind: doc.docKind,
    uploaderUserId: doc.uploaderUserId,
    uploaderLabel: doc.uploaderLabel,
    currentVersionId: doc.currentVersionId,
    aiRetrieval: doc.aiRetrieval,
    notes: doc.notes,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    currentVersion: current
      ? {
          id: current.id,
          versionNumber: current.versionNumber,
          fileName: current.fileName,
          mime: current.mime,
          sizeBytes: current.sizeBytes,
          sha256: current.sha256,
          extractedKind: current.extractedKind,
          chunkCount: current.chunkCount,
          createdAt: current.createdAt,
        }
      : null,
  };
}

const router: IRouter = Router();

// @cli-skip: pending Task #340 read-parity migration
router.get("/documents", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);

  const conds = [eq(atelierDocuments.orgId, me.orgId), eq(atelierDocuments.status, "active")];
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;
  const engagementId = typeof req.query.engagementId === "string" ? req.query.engagementId : null;
  const category = typeof req.query.category === "string" ? req.query.category : null;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : null;
  if (accountId) conds.push(eq(atelierDocuments.accountId, accountId));
  if (engagementId) conds.push(eq(atelierDocuments.engagementId, engagementId));
  if (category) conds.push(eq(atelierDocuments.category, category));
  if (entityId) conds.push(eq(atelierDocuments.entityId, entityId));

  const rows = await db
    .select()
    .from(atelierDocuments)
    .where(and(...conds))
    .orderBy(desc(atelierDocuments.updatedAt));

  const visible: DocRow[] = [];
  for (const doc of rows) {
    if (await canSeeDocument(me, access, doc)) visible.push(doc);
  }

  const versionIds = visible
    .map((d) => d.currentVersionId)
    .filter((v): v is string => !!v);
  const versions = versionIds.length
    ? await db
        .select()
        .from(atelierDocumentVersions)
        .where(inArray(atelierDocumentVersions.id, versionIds))
    : [];
  const byId = new Map(versions.map((v) => [v.id, v]));

  res.json({
    documents: visible.map((d) =>
      docShape(d, d.currentVersionId ? byId.get(d.currentVersionId) : null),
    ),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/documents", uploadSingle, async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "no-file" });
    return;
  }
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title || title.length > 200) {
    res.status(400).json({ error: "invalid-title" });
    return;
  }
  const category = typeof req.body?.category === "string" ? req.body.category : "other";
  if (!DOC_CATEGORIES.includes(category as DocCategory)) {
    res.status(400).json({ error: "invalid-category" });
    return;
  }
  const accountId =
    typeof req.body?.accountId === "string" && req.body.accountId ? req.body.accountId : null;
  const engagementId =
    typeof req.body?.engagementId === "string" && req.body.engagementId
      ? req.body.engagementId
      : null;
  const entityId =
    typeof req.body?.entityId === "string" && req.body.entityId ? req.body.entityId : null;
  const notes =
    typeof req.body?.notes === "string" && req.body.notes ? req.body.notes.slice(0, 2000) : null;
  const aiRetrieval = req.body?.aiRetrieval !== "false" && req.body?.aiRetrieval !== false;
  let docKind: LegalDocKind | null = null;
  if (typeof req.body?.docKind === "string" && req.body.docKind) {
    // Legal classification is partner-gated even at upload time.
    if (!docPrivileged(me.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!DOC_KINDS.includes(req.body.docKind as LegalDocKind)) {
      res.status(400).json({ error: "invalid-doc-kind" });
      return;
    }
    docKind = req.body.docKind as LegalDocKind;
    if (TAX_DOCUMENT_KINDS.has(docKind)) {
      res.status(409).json({
        error: "tax-certificate-must-be-linked-through-entity-registry",
      });
      return;
    }
  }

  if (entityId) {
    const [ent] = await db
      .select({ id: atelierLegalEntities.id })
      .from(atelierLegalEntities)
      .where(
        and(eq(atelierLegalEntities.id, entityId), eq(atelierLegalEntities.orgId, me.orgId)),
      );
    if (!ent) {
      res.status(404).json({ error: "entity-not-found" });
      return;
    }
  }

  const access = await accessibleEngagementIds(me);
  if (accountId) {
    const [acc] = await db
      .select({ id: atelierAccounts.id })
      .from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, accountId), eq(atelierAccounts.orgId, me.orgId)));
    if (!acc) {
      res.status(404).json({ error: "account-not-found" });
      return;
    }
    if (!(await canSeeAccount(access, me, accountId))) {
      res.status(403).json({ error: "forbidden-account" });
      return;
    }
  }
  if (engagementId) {
    const accId = await engagementAccountId(engagementId, me.orgId);
    if (accId === null) {
      res.status(404).json({ error: "engagement-not-found" });
      return;
    }
    const canSeeEng =
      access.all === true ||
      access.ids.has(engagementId) ||
      (await canSeeAccount(access, me, accId));
    if (!canSeeEng) {
      res.status(403).json({ error: "forbidden-engagement" });
      return;
    }
    if (accountId && accId !== accountId) {
      res.status(400).json({ error: "engagement-account-mismatch" });
      return;
    }
  }
  // Org-level documents (no scope) are firm assets — restricted to
  // privileged roles at creation time; others must scope their uploads.
  if (!accountId && !engagementId && !docPrivileged(me.role)) {
    res.status(403).json({ error: "org-level-requires-privileged-role" });
    return;
  }

  const result = await createDocument({
    orgId: me.orgId,
    uploader: { id: me.id, name: me.name },
    title,
    category: category as DocCategory,
    accountId,
    engagementId,
    entityId,
    docKind,
    aiRetrieval,
    notes,
    fileName: file.originalname || "upload",
    mime: file.mimetype || "application/octet-stream",
    bytes: file.buffer,
  });
  if (!result.ok) {
    res.status(422).json({ error: result.reason });
    return;
  }
  res.status(201).json({
    document: docShape(result.document, result.version),
    rag: result.rag,
  });
});

async function loadVisibleDoc(
  req: Request,
  res: Response,
): Promise<{ me: Me; access: EngAccess; doc: DocRow } | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const [doc] = await db
    .select()
    .from(atelierDocuments)
    .where(and(eq(atelierDocuments.id, String(req.params.id ?? "")), eq(atelierDocuments.orgId, me.orgId)));
  if (!doc || doc.status === "deleted") {
    res.status(404).json({ error: "not-found" });
    return null;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeDocument(me, access, doc))) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return { me, access, doc };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/documents/:id", async (req, res) => {
  const ctx = await loadVisibleDoc(req, res);
  if (!ctx) return;
  const versions = await db
    .select()
    .from(atelierDocumentVersions)
    .where(eq(atelierDocumentVersions.documentId, ctx.doc.id))
    .orderBy(desc(atelierDocumentVersions.versionNumber));
  const grants = await db
    .select()
    .from(atelierDocumentAccess)
    .where(
      and(
        eq(atelierDocumentAccess.documentId, ctx.doc.id),
        eq(atelierDocumentAccess.status, "active"),
      ),
    );
  const audit = await db
    .select()
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.entityType, "atelier_document"),
        eq(atelierAuditEvents.entityId, ctx.doc.id),
      ),
    )
    .orderBy(desc(atelierAuditEvents.createdAt))
    .limit(50);
  const current = versions.find((v) => v.id === ctx.doc.currentVersionId) ?? null;
  res.json({
    document: docShape(ctx.doc, current),
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      fileName: v.fileName,
      mime: v.mime,
      sizeBytes: v.sizeBytes,
      sha256: v.sha256,
      uploaderUserId: v.uploaderUserId,
      extractedKind: v.extractedKind,
      chunkCount: v.chunkCount,
      extractionWarnings: v.extractionWarnings ?? [],
      createdAt: v.createdAt,
    })),
    access: grants.map((g) => ({
      id: g.id,
      userId: g.userId,
      grantedBy: g.grantedBy,
      createdAt: g.createdAt,
    })),
    audit: audit.map((a) => ({
      id: a.id,
      action: a.action,
      actorLabel: a.actorLabel,
      summary: a.payloadSummary,
      createdAt: a.createdAt,
    })),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.patch("/documents/:id", async (req, res) => {
  const ctx = await loadVisibleDoc(req, res);
  if (!ctx) return;
  const { me, doc } = ctx;
  if (!docPrivileged(me.role) && doc.uploaderUserId !== me.id) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const patch: Partial<{
    title: string;
    category: string;
    notes: string | null;
    entityId: string | null;
    docKind: string | null;
    updatedAt: Date;
  }> = {};
  const changes: Record<string, unknown> = {};
  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    patch.title = req.body.title.trim().slice(0, 200);
    changes.title = patch.title;
  }
  if (typeof req.body?.category === "string") {
    if (!DOC_CATEGORIES.includes(req.body.category as DocCategory)) {
      res.status(400).json({ error: "invalid-category" });
      return;
    }
    patch.category = req.body.category;
    changes.category = patch.category;
  }
  if (req.body?.notes !== undefined) {
    patch.notes = typeof req.body.notes === "string" ? req.body.notes.slice(0, 2000) : null;
    changes.notes = patch.notes;
  }
  if (req.body?.entityId !== undefined) {
    const next =
      typeof req.body.entityId === "string" && req.body.entityId ? req.body.entityId : null;
    if (next) {
      const [ent] = await db
        .select({ id: atelierLegalEntities.id })
        .from(atelierLegalEntities)
        .where(and(eq(atelierLegalEntities.id, next), eq(atelierLegalEntities.orgId, me.orgId)));
      if (!ent) {
        res.status(404).json({ error: "entity-not-found" });
        return;
      }
    }
    patch.entityId = next;
    changes.entityId = next;
  }
  // Task #287 — manual classification override (null clears back to
  // unclassified; validated against the known kinds otherwise). Legal
  // classification is partner-gated: uploader-level PATCH access is not
  // enough to reclassify legal documents.
  if (req.body?.docKind !== undefined) {
    if (!docPrivileged(me.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const nextKind =
      typeof req.body.docKind === "string" && req.body.docKind ? req.body.docKind : null;
    if (nextKind && !DOC_KINDS.includes(nextKind as LegalDocKind)) {
      res.status(400).json({ error: "invalid-doc-kind" });
      return;
    }
    patch.docKind = nextKind;
    changes.docKind = nextKind;
  }
  if (req.body?.entityId !== undefined || req.body?.docKind !== undefined) {
    const taxMutation = await validateTaxDocumentMutation({
      me,
      document: doc,
      nextEntityId: patch.entityId !== undefined ? (patch.entityId as string | null) : doc.entityId,
      nextDocKind: patch.docKind !== undefined ? (patch.docKind as string | null) : doc.docKind,
    });
    if (!taxMutation.ok) {
      res.status(taxMutation.status).json({ error: taxMutation.error });
      return;
    }
  }
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = new Date();
    await db.update(atelierDocuments).set(patch).where(eq(atelierDocuments.id, doc.id));
    await auditDocument({
      documentId: doc.id,
      actorId: me.id,
      actorLabel: me.name,
      action: "document.update",
      payload: { changes },
      summary: `Updated document "${patch.title ?? doc.title}" (${Object.keys(changes).join(", ")})`,
    });
  }
  if (typeof req.body?.aiRetrieval === "boolean" && req.body.aiRetrieval !== doc.aiRetrieval) {
    await setDocumentAiRetrieval({ document: doc, on: req.body.aiRetrieval, actor: { id: me.id, name: me.name } });
  }
  const [updated] = await db
    .select()
    .from(atelierDocuments)
    .where(eq(atelierDocuments.id, doc.id));
  res.json({ document: docShape(updated) });
});

// @cli-skip: pending Task #340 read-parity migration
router.delete("/documents/:id", async (req, res) => {
  const ctx = await loadVisibleDoc(req, res);
  if (!ctx) return;
  const { me, doc } = ctx;
  if (!docPrivileged(me.role) && doc.uploaderUserId !== me.id) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (await currentTaxCertificatePointer({ orgId: me.orgId, documentId: doc.id })) {
    res.status(409).json({ error: "tax-certificate-pointer-owned" });
    return;
  }
  const result = await purgeDocument({
    orgId: me.orgId,
    documentId: doc.id,
    actor: { id: me.id, name: me.name },
  });
  if (!result.ok) {
    res.status(result.reason === "tax-certificate-pointer-owned" ? 409 : 404)
      .json({ error: result.reason ?? "not-found" });
    return;
  }
  res.json({ status: "deleted", id: doc.id });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/documents/:id/versions", uploadSingle, async (req, res) => {
  const ctx = await loadVisibleDoc(req, res);
  if (!ctx) return;
  const { me, doc } = ctx;
  // Visibility is not mutation authority: a user may read an account or
  // explicitly granted document without being allowed to supersede it.
  if (!docPrivileged(me.role) && doc.uploaderUserId !== me.id) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (await currentTaxCertificatePointer({ orgId: me.orgId, documentId: doc.id })) {
    res.status(409).json({ error: "tax-certificate-pointer-owned" });
    return;
  }
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "no-file" });
    return;
  }
  const result = await addDocumentVersion({
    orgId: me.orgId,
    document: doc,
    uploader: { id: me.id, name: me.name },
    fileName: file.originalname || "upload",
    mime: file.mimetype || "application/octet-stream",
    bytes: file.buffer,
  });
  if (!result.ok) {
    res.status(422).json({ error: result.reason });
    return;
  }
  res.status(201).json({
    version: {
      id: result.version.id,
      versionNumber: result.version.versionNumber,
      fileName: result.version.fileName,
      mime: result.version.mime,
      sizeBytes: result.version.sizeBytes,
      sha256: result.version.sha256,
      chunkCount: result.version.chunkCount,
      createdAt: result.version.createdAt,
    },
    rag: result.rag,
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/documents/:id/download", async (req, res) => {
  const ctx = await loadVisibleDoc(req, res);
  if (!ctx) return;
  const { me, doc } = ctx;
  const versionId =
    typeof req.query.versionId === "string" && req.query.versionId
      ? req.query.versionId
      : doc.currentVersionId;
  if (!versionId) {
    res.status(404).json({ error: "no-version" });
    return;
  }
  const [version] = await db
    .select()
    .from(atelierDocumentVersions)
    .where(
      and(
        eq(atelierDocumentVersions.id, versionId),
        eq(atelierDocumentVersions.documentId, doc.id),
      ),
    );
  if (!version) {
    res.status(404).json({ error: "version-not-found" });
    return;
  }
  const bytes = await loadDocBytes(version.blobRef);
  if (!bytes) {
    res.status(410).json({ error: "blob-missing" });
    return;
  }
  const inline = req.query.disposition === "inline";
  await auditDocument({
    documentId: doc.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "document.download",
    payload: {
      versionId: version.id,
      versionNumber: version.versionNumber,
      fileName: version.fileName,
      mode: inline ? "view" : "download",
    },
    summary: inline
      ? `Viewed "${version.fileName}" (v${version.versionNumber})`
      : `Downloaded "${version.fileName}" (v${version.versionNumber})`,
  });
  res.setHeader("Content-Type", version.mime || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    contentDispositionFilename(inline ? "inline" : "attachment", version.fileName),
  );
  res.send(bytes);
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/documents/:id/access", async (req, res) => {
  const ctx = await loadVisibleDoc(req, res);
  if (!ctx) return;
  const { me, doc } = ctx;
  if (!docPrivileged(me.role) && doc.uploaderUserId !== me.id) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  // Per-person grants exist ONLY for org-level documents. Scoped documents
  // are governed by the account/engagement ACL — a grant here would let the
  // retrieval layer bypass that boundary.
  if (doc.accountId || doc.engagementId) {
    res.status(400).json({ error: "grants-org-level-only" });
    return;
  }
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!userId) {
    res.status(400).json({ error: "missing-user-id" });
    return;
  }
  const [target] = await db
    .select({ id: atelierUsers.id, name: atelierUsers.name })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, userId), eq(atelierUsers.orgId, me.orgId)));
  if (!target) {
    res.status(404).json({ error: "user-not-found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierDocumentAccess)
    .where(
      and(
        eq(atelierDocumentAccess.documentId, doc.id),
        eq(atelierDocumentAccess.userId, userId),
      ),
    );
  if (existing) {
    if (existing.status !== "active") {
      await db
        .update(atelierDocumentAccess)
        .set({ status: "active", grantedBy: me.id })
        .where(eq(atelierDocumentAccess.id, existing.id));
    }
  } else {
    await db.insert(atelierDocumentAccess).values({
      id: `dacc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      orgId: me.orgId,
      documentId: doc.id,
      userId,
      grantedBy: me.id,
    });
  }
  await auditDocument({
    documentId: doc.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "document.access_grant",
    payload: { userId, userName: target.name },
    summary: `Granted ${target.name} access to "${doc.title}"`,
  });
  res.status(201).json({ status: "granted", userId });
});

// @cli-skip: pending Task #340 read-parity migration
router.delete("/documents/:id/access/:userId", async (req, res) => {
  const ctx = await loadVisibleDoc(req, res);
  if (!ctx) return;
  const { me, doc } = ctx;
  if (!docPrivileged(me.role) && doc.uploaderUserId !== me.id) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  await db
    .update(atelierDocumentAccess)
    .set({ status: "revoked" })
    .where(
      and(
        eq(atelierDocumentAccess.documentId, doc.id),
        eq(atelierDocumentAccess.userId, req.params.userId),
      ),
    );
  await auditDocument({
    documentId: doc.id,
    actorId: me.id,
    actorLabel: me.name,
    action: "document.access_revoke",
    payload: { userId: req.params.userId },
    summary: `Revoked document access for user ${req.params.userId}`,
  });
  res.json({ status: "revoked", userId: req.params.userId });
});

export default router;
