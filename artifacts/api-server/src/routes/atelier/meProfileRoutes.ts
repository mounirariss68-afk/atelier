/**
 * Task #51 — Me lens: self-service profile, ID documents, dependents and
 * emergency contacts.
 *
 * Every endpoint here is strictly self-scope: the person row is resolved
 * from the caller's own identity (employee → atelier_employees.user_id,
 * contractor → lower-cased email), never from URL/body ids — so there is
 * nothing to IDOR. Document scans live in private object storage
 * (persondoc:<key> in file_ref) and are streamed only through
 * authenticated routes: the owner here, or HR-tier roles via the roster
 * download route (rosterRoutes.ts).
 *
 *   PATCH  /me/profile                      → edit own contact/address/bio
 *   GET    /me/documents                    → own ID/residency docs + scans
 *   POST   /me/documents                    → upload scan + details (multipart)
 *   PATCH  /me/documents/:id                → edit details / replace metadata
 *   DELETE /me/documents/:id                → soft-delete own doc
 *   GET    /me/documents/:id/download       → stream own scan
 *   GET    /me/dependents                   → own dependents
 *   POST   /me/dependents                   → add dependent
 *   PATCH  /me/dependents/:id               → edit dependent
 *   DELETE /me/dependents/:id               → remove dependent (+ its docs)
 *   GET    /me/emergency-contacts           → own emergency contacts
 *   POST   /me/emergency-contacts           → add emergency contact
 *   PATCH  /me/emergency-contacts/:id       → edit emergency contact
 *   DELETE /me/emergency-contacts/:id       → remove emergency contact
 *   POST   /me/photo                        → upload profile photo (multipart)
 *   GET    /people-photos/:personType/:personId → stream photo (any persona, own org)
 *
 * Sensitive HR-controlled fields (employment type, compensation, banking)
 * are NOT accepted by the PATCH whitelist below — self-edit covers
 * personal data only. All mutations are audited.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import multer from "multer";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierPersonDocuments,
  atelierDependents,
  atelierEmergencyContacts,
  atelierAuditEvents,
  atelierPersons,
} from "@workspace/db";
import {
  storePersonDocBytes,
  loadPersonDocBytes,
  dropPersonDocBytes,
  PERSON_DOC_PREFIX,
} from "../../lib/personDocStorage.js";
import {
  loadBioTemplate,
  generateBusinessCardPdf,
  BIO_TEMPLATE_FILENAME,
  PPTX_MIME,
} from "../../lib/atelier-business-card.js";
import { assertAuditAction } from "./auditContract";
// Task #538 — mirror preferredName self-edits onto the person record.
import { writePersonAndSync } from "../../lib/atelier-person-sync";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

// ------------------------------------------------------------------
// Self person resolution (raw rows — the wire shaping happens per-route)
// ------------------------------------------------------------------
type SelfPersonRow =
  | { workerType: "employee"; row: typeof atelierEmployees.$inferSelect }
  | { workerType: "contractor"; row: typeof atelierContractors.$inferSelect };

async function resolveSelfPersonRow(
  me: typeof atelierUsers.$inferSelect,
): Promise<SelfPersonRow | null> {
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, me.orgId),
        eq(atelierEmployees.userId, me.id),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp) return { workerType: "employee", row: emp };
  const email = me.email.trim().toLowerCase();
  const cts = await db
    .select()
    .from(atelierContractors)
    .where(
      and(
        eq(atelierContractors.orgId, me.orgId),
        isNull(atelierContractors.deletedAt),
      ),
    );
  const ct = cts.find((c) => c.email.trim().toLowerCase() === email);
  if (ct) return { workerType: "contractor", row: ct };
  return null;
}

async function requireSelfPerson(
  req: Request,
  res: Response,
): Promise<{ me: typeof atelierUsers.$inferSelect; person: SelfPersonRow } | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const person = await resolveSelfPersonRow(me);
  if (!person) {
    res.status(404).json({
      error: "no-roster-record",
      message:
        "No roster record is linked to your login yet. Ask HR to link your profile.",
    });
    return null;
  }
  return { me, person };
}

async function audit(args: {
  me: typeof atelierUsers.$inferSelect;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  assertAuditAction(args.action);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: args.me.orgId,
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.me.id,
    actorLabel: args.me.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ------------------------------------------------------------------
// PATCH /me/profile — self-editable personal fields ONLY.
// ------------------------------------------------------------------
const CellPhone = z.object({
  country: z.string().min(1).max(60),
  number: z.string().min(3).max(40),
});
const ProfilePatch = z
  .object({
    preferredName: z.string().max(200).nullable().optional(),
    personalEmail: z.string().max(320).nullable().optional(),
    cellPhones: z.array(CellPhone).max(3).optional(),
    homeAddress: z.string().max(1000).nullable().optional(),
    officeAddress: z.string().max(1000).nullable().optional(),
    bio: z.string().max(4000).nullable().optional(),
    nationality: z.string().max(2).nullable().optional(),
    gender: z.enum(["female", "male", "unspecified"]).optional(),
  })
  .strict();

export function selfPersonWire(p: SelfPersonRow) {
  const base = {
    id: p.row.id,
    workerType: p.workerType,
    fullName: p.row.fullName,
    email: p.row.email,
    country: p.row.country ?? null,
    status: p.row.status ?? null,
    personalEmail: p.row.personalEmail ?? null,
    cellPhones: (p.row.cellPhones ?? []) as Array<{ country: string; number: string }>,
    homeAddress: p.row.homeAddress ?? null,
    officeAddress: p.row.officeAddress ?? null,
    bio: p.row.bio ?? null,
    nationality: p.row.nationality ?? null,
    gender: p.row.gender ?? "unspecified",
    avatarUrl: p.row.avatarUrl ?? null,
  };
  if (p.workerType === "employee") {
    return {
      ...base,
      title: p.row.title ?? null,
      preferredName: p.row.preferredName ?? null,
      startDate: p.row.startDate ?? null,
      employmentType: p.row.employmentType ?? null,
      homeOffice: p.row.homeOffice ?? null,
    };
  }
  return {
    ...base,
    title: null,
    preferredName: null,
    startDate: p.row.contractStart ?? null,
    employmentType: p.row.contractType ?? null,
    homeOffice: null,
  };
}

// @cli-skip: self-scope profile edit; no CLI shape (Task #51)
router.patch("/me/profile", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const parsed = ProfilePatch.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const patch = parsed.data;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    const row = ctx.person.row as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (ctx.person.workerType === "contractor" && k === "preferredName") continue;
      if (v === undefined) continue;
      if (JSON.stringify(row[k] ?? null) === JSON.stringify(v ?? null)) continue;
      changes[k] = { from: row[k] ?? null, to: v ?? null };
      upd[k] = v;
    }
    if (Object.keys(changes).length > 0) {
      if (ctx.person.workerType === "employee") {
        await db
          .update(atelierEmployees)
          .set(upd)
          .where(eq(atelierEmployees.id, ctx.person.row.id));
      } else {
        await db
          .update(atelierContractors)
          .set(upd)
          .where(eq(atelierContractors.id, ctx.person.row.id));
      }
      // Task #538 — mirror a preferredName self-edit onto the linked person
      // record (employees only; the contractor skip above preserves the
      // existing rule that contractors cannot edit preferredName).
      if ("preferredName" in changes && ctx.person.workerType === "employee") {
        const personId = (ctx.person.row as { personId?: string | null }).personId ?? null;
        if (personId) {
          const [p] = await db
            .select()
            .from(atelierPersons)
            .where(and(eq(atelierPersons.id, personId), eq(atelierPersons.orgId, ctx.me.orgId)))
            .limit(1);
          if (p) {
            await writePersonAndSync(db, {
              orgId: ctx.me.orgId,
              personId,
              structured: {
                honorific: p.honorific,
                firstName: p.firstName,
                middleName: p.middleName,
                lastName: p.lastName,
                preferredName: (patch.preferredName ?? null) as string | null,
              },
            });
          }
        }
      }
      await audit({
        me: ctx.me,
        entityType: ctx.person.workerType,
        entityId: ctx.person.row.id,
        action: "person.profile.self_updated",
        payload: { changes },
        summary: `${ctx.me.name} updated their own profile (${Object.keys(changes).join(", ")})`,
      });
    }
    const fresh = await resolveSelfPersonRow(ctx.me);
    res.json({ person: fresh ? selfPersonWire(fresh) : null });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Documents — passport / national ID / residency + dependent scans.
// ------------------------------------------------------------------
const SELF_DOC_KINDS = new Set([
  "passport",
  "national_id",
  "residency",
  "visa",
  "dependent_doc",
  "other",
]);
const DOC_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const DOC_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOC_MAX_BYTES, files: 1 },
});
// Task #531 — national ID uploads carry two labeled files (front + back).
const docPairUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOC_MAX_BYTES, files: 2 },
});
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
});

function multerWrapped(
  handler: ReturnType<typeof docUpload.single>,
): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  return (req, res, next) => {
    handler(req, res, (err?: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({
          error: err.code.toLowerCase().replace(/_/g, "-"),
          message: err.message,
        });
        return;
      }
      res.status(400).json({ error: "upload-error", message: String(err) });
    });
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function optDate(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "string" && ISO_DATE.test(v)) return v;
  return undefined;
}

function docWire(d: typeof atelierPersonDocuments.$inferSelect) {
  const expiresAt = d.expiresAt ? d.expiresAt.toISOString().slice(0, 10) : null;
  const daysToExpiry = d.expiresAt
    ? Math.ceil((d.expiresAt.getTime() - Date.now()) / 86_400_000)
    : null;
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    docNumber: d.docNumber ?? null,
    issuedAt: d.issuedAt ?? null,
    issuingCountry: d.issuingCountry ?? null,
    expiresAt,
    daysToExpiry,
    dependentId: d.dependentId ?? null,
    fileName: d.fileName ?? null,
    mime: d.mime ?? null,
    sizeBytes: d.sizeBytes ?? null,
    hasFile: !!d.fileRef || !!d.fileUrl,
    // Task #531 — national ID back side. `combined` means a single PDF was
    // accepted in place of separate front/back scans.
    hasBackFile: !!d.backFileRef,
    backFileName: d.backFileName ?? null,
    backMime: d.backMime ?? null,
    backSizeBytes: d.backSizeBytes ?? null,
    sides:
      d.kind === "national_id"
        ? d.backFileRef
          ? "front_back"
          : d.fileRef || d.fileUrl
            ? d.mime === "application/pdf"
              ? "combined"
              : "front_only"
            : "none"
        : null,
    uploadedAt: d.uploadedAt.toISOString(),
    notes: d.notes ?? null,
  };
}

async function ownDoc(
  ctx: { person: SelfPersonRow },
  docId: string,
): Promise<typeof atelierPersonDocuments.$inferSelect | null> {
  const [doc] = await db
    .select()
    .from(atelierPersonDocuments)
    .where(
      and(
        eq(atelierPersonDocuments.id, docId),
        eq(atelierPersonDocuments.personType, ctx.person.workerType),
        eq(atelierPersonDocuments.personId, ctx.person.row.id),
        isNull(atelierPersonDocuments.deletedAt),
      ),
    );
  return doc ?? null;
}

// @cli-skip: self-scope document list; no CLI shape (Task #51)
router.get("/me/documents", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const docs = await db
      .select()
      .from(atelierPersonDocuments)
      .where(
        and(
          eq(atelierPersonDocuments.personType, ctx.person.workerType),
          eq(atelierPersonDocuments.personId, ctx.person.row.id),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPersonDocuments.uploadedAt));
    res.json({
      documents: docs
        .filter((d) => d.kind !== "profile_photo" && d.kind !== "biography")
        .map(docWire),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope multipart upload; no CLI shape (Task #51)
router.post(
  "/me/documents",
  multerWrapped(
    docPairUpload.fields([
      { name: "file", maxCount: 1 },
      { name: "fileBack", maxCount: 1 },
    ]) as unknown as ReturnType<typeof docUpload.single>,
  ),
  async (req, res, next) => {
    try {
      const ctx = await requireSelfPerson(req, res);
      if (!ctx) return;
      const b = (req.body ?? {}) as Record<string, string>;
      const kind = String(b.kind ?? "");
      if (!SELF_DOC_KINDS.has(kind)) {
        res.status(400).json({ error: "invalid-kind", allowed: [...SELF_DOC_KINDS] });
        return;
      }
      const title = String(b.title ?? "").trim();
      if (!title || title.length > 200) {
        res.status(400).json({ error: "invalid-title" });
        return;
      }
      const issuedAt = optDate(b.issuedAt);
      const expiresAt = optDate(b.expiresAt);
      if (issuedAt === undefined && b.issuedAt !== undefined) {
        res.status(400).json({ error: "invalid-issuedAt" });
        return;
      }
      if (expiresAt === undefined && b.expiresAt !== undefined) {
        res.status(400).json({ error: "invalid-expiresAt" });
        return;
      }
      let dependentId: string | null = null;
      if (b.dependentId) {
        const [dep] = await db
          .select()
          .from(atelierDependents)
          .where(
            and(
              eq(atelierDependents.id, String(b.dependentId)),
              eq(atelierDependents.personType, ctx.person.workerType),
              eq(atelierDependents.personId, ctx.person.row.id),
              isNull(atelierDependents.deletedAt),
            ),
          );
        if (!dep) {
          res.status(404).json({ error: "dependent-not-found" });
          return;
        }
        dependentId = dep.id;
      }
      const files = (req as Request & {
        files?: Record<string, Express.Multer.File[]>;
      }).files;
      const file = files?.file?.[0];
      const fileBack = files?.fileBack?.[0];
      // Task #531 — national ID cards need both sides: either two labeled
      // files (front + back) or a single combined PDF. Other kinds keep the
      // single-file contract and never accept a back side.
      if (fileBack && kind !== "national_id") {
        res.status(400).json({ error: "back-side-not-allowed", kind });
        return;
      }
      if (fileBack && !file) {
        res.status(400).json({ error: "front-side-required" });
        return;
      }
      if (
        kind === "national_id" &&
        file &&
        !fileBack &&
        file.mimetype !== "application/pdf"
      ) {
        res.status(400).json({
          error: "back-side-required",
          message:
            "Upload both the front and back of the national ID card, or a single combined PDF.",
        });
        return;
      }
      for (const f of [file, fileBack]) {
        if (f && !DOC_MIMES.has(f.mimetype)) {
          res.status(415).json({ error: "unsupported-file-type", allowed: [...DOC_MIMES] });
          return;
        }
      }
      let fileRef: string | null = null;
      let fileName: string | null = null;
      let mime: string | null = null;
      let sizeBytes: number | null = null;
      if (file) {
        const stored = await storePersonDocBytes(file.buffer, file.mimetype);
        fileRef = stored.fileRef;
        fileName = file.originalname || "scan";
        mime = file.mimetype;
        sizeBytes = stored.sizeBytes;
      }
      let backFileRef: string | null = null;
      let backFileName: string | null = null;
      let backMime: string | null = null;
      let backSizeBytes: number | null = null;
      if (fileBack) {
        const stored = await storePersonDocBytes(fileBack.buffer, fileBack.mimetype);
        backFileRef = stored.fileRef;
        backFileName = fileBack.originalname || "scan-back";
        backMime = fileBack.mimetype;
        backSizeBytes = stored.sizeBytes;
      }
      const id = rid("pdoc");
      const [doc] = await db
        .insert(atelierPersonDocuments)
        .values({
          id,
          orgId: ctx.me.orgId,
          personType: ctx.person.workerType,
          personId: ctx.person.row.id,
          kind,
          title,
          docNumber: b.docNumber ? String(b.docNumber).slice(0, 100) : null,
          issuedAt: issuedAt ?? null,
          issuingCountry: b.issuingCountry ? String(b.issuingCountry).slice(0, 100) : null,
          expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00Z`) : null,
          dependentId,
          fileRef,
          fileName,
          mime,
          sizeBytes,
          backFileRef,
          backFileName,
          backMime,
          backSizeBytes,
          notes: b.notes ? String(b.notes).slice(0, 2000) : null,
          uploadedByUserId: ctx.me.id,
          createdByUserId: ctx.me.id,
        })
        .returning();
      await audit({
        me: ctx.me,
        entityType: "person_document",
        entityId: id,
        action: "person_document.self_uploaded",
        payload: { kind, title, dependentId, hasFile: !!fileRef, hasBackFile: !!backFileRef },
        summary: `${ctx.me.name} added their own ${kind} document "${title}"`,
      });
      res.status(201).json({ document: docWire(doc) });
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: self-scope document edit; no CLI shape (Task #51)
router.patch("/me/documents/:id", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const doc = await ownDoc(ctx, req.params.id);
    if (!doc || doc.kind === "profile_photo") {
      res.status(404).json({ error: "doc-not-found" });
      return;
    }
    const Patch = z
      .object({
        title: z.string().min(1).max(200).optional(),
        docNumber: z.string().max(100).nullable().optional(),
        issuedAt: z.string().regex(ISO_DATE).nullable().optional(),
        issuingCountry: z.string().max(100).nullable().optional(),
        expiresAt: z.string().regex(ISO_DATE).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict();
    const parsed = Patch.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const p = parsed.data;
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    if (p.title !== undefined) upd.title = p.title;
    if (p.docNumber !== undefined) upd.docNumber = p.docNumber;
    if (p.issuedAt !== undefined) upd.issuedAt = p.issuedAt;
    if (p.issuingCountry !== undefined) upd.issuingCountry = p.issuingCountry;
    if (p.expiresAt !== undefined)
      upd.expiresAt = p.expiresAt ? new Date(`${p.expiresAt}T00:00:00Z`) : null;
    if (p.notes !== undefined) upd.notes = p.notes;
    const [updated] = await db
      .update(atelierPersonDocuments)
      .set(upd)
      .where(eq(atelierPersonDocuments.id, doc.id))
      .returning();
    await audit({
      me: ctx.me,
      entityType: "person_document",
      entityId: doc.id,
      action: "person_document.self_updated",
      payload: { fields: Object.keys(p) },
      summary: `${ctx.me.name} updated their ${doc.kind} document "${doc.title}"`,
    });
    res.json({ document: docWire(updated) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope document delete; no CLI shape (Task #51)
router.delete("/me/documents/:id", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const doc = await ownDoc(ctx, req.params.id);
    if (!doc || doc.kind === "profile_photo") {
      res.status(404).json({ error: "doc-not-found" });
      return;
    }
    await db
      .update(atelierPersonDocuments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierPersonDocuments.id, doc.id));
    await audit({
      me: ctx.me,
      entityType: "person_document",
      entityId: doc.id,
      action: "person_document.self_deleted",
      payload: { kind: doc.kind, title: doc.title },
      summary: `${ctx.me.name} removed their ${doc.kind} document "${doc.title}"`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope scan replace; no CLI shape (Task #51)
// Replace (or attach) the scan on an existing document without losing the
// record or its audit continuity — e.g. after a passport renewal.
router.post(
  "/me/documents/:id/file",
  multerWrapped(docUpload.single("file")),
  async (req, res, next) => {
    try {
      const ctx = await requireSelfPerson(req, res);
      if (!ctx) return;
      const doc = await ownDoc(ctx, String(req.params.id));
      if (!doc || doc.kind === "profile_photo") {
        res.status(404).json({ error: "doc-not-found" });
        return;
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: "file-required" });
        return;
      }
      if (!DOC_MIMES.has(file.mimetype)) {
        res.status(415).json({ error: "unsupported-file-type", allowed: [...DOC_MIMES] });
        return;
      }
      // Task #531 — `side=back` attaches/replaces the back of a national ID
      // without touching the front or the record metadata.
      const side = String((req.body as Record<string, string> | undefined)?.side ?? "front");
      if (side !== "front" && side !== "back") {
        res.status(400).json({ error: "invalid-side", allowed: ["front", "back"] });
        return;
      }
      if (side === "back" && doc.kind !== "national_id") {
        res.status(400).json({ error: "back-side-not-allowed", kind: doc.kind });
        return;
      }
      const stored = await storePersonDocBytes(file.buffer, file.mimetype);
      const oldRef = side === "back" ? doc.backFileRef : doc.fileRef;
      const upd =
        side === "back"
          ? {
              backFileRef: stored.fileRef,
              backFileName: file.originalname || "scan-back",
              backMime: file.mimetype,
              backSizeBytes: stored.sizeBytes,
            }
          : {
              fileRef: stored.fileRef,
              fileName: file.originalname || "scan",
              mime: file.mimetype,
              sizeBytes: stored.sizeBytes,
            };
      const [updated] = await db
        .update(atelierPersonDocuments)
        .set({
          ...upd,
          uploadedAt: new Date(),
          uploadedByUserId: ctx.me.id,
          updatedAt: new Date(),
        })
        .where(eq(atelierPersonDocuments.id, doc.id))
        .returning();
      // Drop the superseded object AFTER the row points at the new one.
      if (oldRef)
        await dropPersonDocBytes(oldRef).catch((err) =>
          req.log.warn({ err, fileRef: oldRef }, "person-doc old scan cleanup failed"),
        );
      await audit({
        me: ctx.me,
        entityType: "person_document",
        entityId: doc.id,
        action: "person_document.self_scan_replaced",
        payload: { kind: doc.kind, title: doc.title, replaced: !!oldRef, side },
        summary: `${ctx.me.name} replaced the ${side} scan on their ${doc.kind} document "${doc.title}"`,
      });
      res.json({ document: docWire(updated) });
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: self-scope document stream; no CLI shape (Task #51)
router.get("/me/documents/:id/download", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const doc = await ownDoc(ctx, req.params.id);
    if (!doc) {
      res.status(404).json({ error: "doc-not-found" });
      return;
    }
    // Task #531 — `?side=back` streams the back of a national ID card.
    const side = String(req.query.side ?? "front");
    if (side !== "front" && side !== "back") {
      res.status(400).json({ error: "invalid-side", allowed: ["front", "back"] });
      return;
    }
    if (side === "back") {
      if (!doc.backFileRef || !doc.backFileRef.startsWith(PERSON_DOC_PREFIX)) {
        res.status(404).json({ error: "no-file" });
        return;
      }
    } else if (!doc.fileRef || !doc.fileRef.startsWith(PERSON_DOC_PREFIX)) {
      if (doc.fileUrl) {
        res.redirect(302, doc.fileUrl);
        return;
      }
      res.status(404).json({ error: "no-file" });
      return;
    }
    const ref = side === "back" ? doc.backFileRef! : doc.fileRef!;
    const bytes = await loadPersonDocBytes(ref);
    if (!bytes) {
      res.status(404).json({ error: "file-missing" });
      return;
    }
    await audit({
      me: ctx.me,
      entityType: "person_document",
      entityId: doc.id,
      action: "document.downloaded",
      payload: { personId: ctx.person.row.id, docId: doc.id, kind: doc.kind, self: true, side },
      summary: `${ctx.me.name} downloaded their own ${doc.kind} document`,
    });
    const mime = side === "back" ? doc.backMime : doc.mime;
    const fname = side === "back" ? doc.backFileName : doc.fileName;
    res.setHeader("Content-Type", mime || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      contentDispositionFilename("attachment", fname || "document"),
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Task #52 — Biography PPTX (download template → fill offline → upload)
// and the business-card PDF with the person's real vCard QR.
//
// Uploaded bios are atelier_person_documents rows with kind "biography"
// (excluded from the generic /me/documents list above). Re-uploads create
// a NEW row (version = prior count + 1) so history is preserved; bytes
// live in private object storage and stream only through the owner route
// (/me/documents/:id/download works for biography rows) or the HR-tier
// roster download route.
// ------------------------------------------------------------------
const BIO_MAX_BYTES = 40 * 1024 * 1024; // the template itself is ~37 MB
const bioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BIO_MAX_BYTES, files: 1 },
});

function isPptxUpload(file: Express.Multer.File): boolean {
  if (file.mimetype === PPTX_MIME) return true;
  // Browsers occasionally send octet-stream; accept when the extension
  // AND the OOXML zip magic (PK\x03\x04) both agree.
  return (
    file.mimetype === "application/octet-stream" &&
    /\.pptx$/i.test(file.originalname || "") &&
    file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  );
}

// @cli-skip: self-scope static template download; no CLI shape (Task #52)
router.get("/me/bio/template", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const bytes = loadBioTemplate();
    res.setHeader("Content-Type", PPTX_MIME);
    res.setHeader(
      "Content-Disposition",
      contentDispositionFilename("attachment", BIO_TEMPLATE_FILENAME),
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

async function ownBioRows(ctx: {
  person: SelfPersonRow;
}): Promise<Array<typeof atelierPersonDocuments.$inferSelect>> {
  return db
    .select()
    .from(atelierPersonDocuments)
    .where(
      and(
        eq(atelierPersonDocuments.personType, ctx.person.workerType),
        eq(atelierPersonDocuments.personId, ctx.person.row.id),
        eq(atelierPersonDocuments.kind, "biography"),
        isNull(atelierPersonDocuments.deletedAt),
      ),
    )
    .orderBy(desc(atelierPersonDocuments.uploadedAt));
}

function bioWire(d: typeof atelierPersonDocuments.$inferSelect) {
  return {
    ...docWire(d),
    downloadUrl: `/api/atelier/me/documents/${d.id}/download`,
  };
}

// @cli-skip: self-scope biography list; no CLI shape (Task #52)
router.get("/me/bio", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const rows = await ownBioRows(ctx);
    res.json({ biographies: rows.map(bioWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope multipart biography upload; no CLI shape (Task #52)
router.post(
  "/me/bio",
  multerWrapped(bioUpload.single("file")),
  async (req, res, next) => {
    try {
      const ctx = await requireSelfPerson(req, res);
      if (!ctx) return;
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: "file-required" });
        return;
      }
      if (!isPptxUpload(file)) {
        res.status(415).json({ error: "unsupported-file-type", allowed: [PPTX_MIME] });
        return;
      }
      const prior = await ownBioRows(ctx);
      const version = prior.length + 1;
      const stored = await storePersonDocBytes(file.buffer, PPTX_MIME);
      const id = rid("pdoc");
      const [doc] = await db
        .insert(atelierPersonDocuments)
        .values({
          id,
          orgId: ctx.me.orgId,
          personType: ctx.person.workerType,
          personId: ctx.person.row.id,
          kind: "biography",
          title: `Biography v${version}`,
          fileRef: stored.fileRef,
          fileName: file.originalname || `biography-v${version}.pptx`,
          mime: PPTX_MIME,
          sizeBytes: stored.sizeBytes,
          uploadedByUserId: ctx.me.id,
          createdByUserId: ctx.me.id,
        })
        .returning();
      await audit({
        me: ctx.me,
        entityType: "person_document",
        entityId: id,
        action: "person_document.self_uploaded",
        payload: { kind: "biography", version, fileName: doc.fileName },
        summary: `${ctx.me.name} uploaded their biography (v${version})`,
      });
      res.status(201).json({ biography: bioWire(doc), version });
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: self-scope generated PDF download; no CLI shape (Task #52)
// Task #352 — ?variant=print adds 3 mm bleed + crop marks for print shops;
// default (standard) stays the exact 90×50 mm card.
router.get("/me/business-card.pdf", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const rawVariant = String(req.query.variant ?? "standard");
    if (rawVariant !== "standard" && rawVariant !== "print") {
      res.status(400).json({ error: "invalid-variant", allowed: ["standard", "print"] });
      return;
    }
    const variant = rawVariant;
    const row = ctx.person.row;
    const { pdf, filename } = await generateBusinessCardPdf(
      {
        fullName: row.fullName,
        title: ctx.person.workerType === "employee" ? (ctx.person.row.title ?? null) : null,
        email: row.email ?? null,
        cellPhones: (row.cellPhones ?? []) as Array<{ country: string; number: string }>,
        officeAddress: row.officeAddress ?? null,
      },
      variant,
    );
    await audit({
      me: ctx.me,
      entityType: ctx.person.workerType,
      entityId: row.id,
      action: "document.downloaded",
      payload: { personId: row.id, kind: "business_card_pdf", self: true, variant },
      summary: `${ctx.me.name} generated their business-card PDF (${variant})`,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Dependents
// ------------------------------------------------------------------
const DependentBody = z
  .object({
    fullName: z.string().min(1).max(200),
    relationship: z.enum(["spouse", "child", "parent", "other"]),
    dateOfBirth: z.string().regex(ISO_DATE).nullable().optional(),
    nationality: z.string().max(2).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

function dependentWire(d: typeof atelierDependents.$inferSelect) {
  return {
    id: d.id,
    fullName: d.fullName,
    relationship: d.relationship,
    dateOfBirth: d.dateOfBirth ?? null,
    nationality: d.nationality ?? null,
    notes: d.notes ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

// @cli-skip: self-scope dependents list; no CLI shape (Task #51)
router.get("/me/dependents", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(atelierDependents)
      .where(
        and(
          eq(atelierDependents.personType, ctx.person.workerType),
          eq(atelierDependents.personId, ctx.person.row.id),
          isNull(atelierDependents.deletedAt),
        ),
      )
      .orderBy(desc(atelierDependents.createdAt));
    res.json({ dependents: rows.map(dependentWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope dependent create; no CLI shape (Task #51)
router.post("/me/dependents", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const parsed = DependentBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const id = rid("dep");
    const [row] = await db
      .insert(atelierDependents)
      .values({
        id,
        orgId: ctx.me.orgId,
        personType: ctx.person.workerType,
        personId: ctx.person.row.id,
        fullName: parsed.data.fullName,
        relationship: parsed.data.relationship,
        dateOfBirth: parsed.data.dateOfBirth ?? null,
        nationality: parsed.data.nationality ?? null,
        notes: parsed.data.notes ?? null,
        createdByUserId: ctx.me.id,
      })
      .returning();
    await audit({
      me: ctx.me,
      entityType: "dependent",
      entityId: id,
      action: "person.dependent.created",
      payload: { fullName: parsed.data.fullName, relationship: parsed.data.relationship },
      summary: `${ctx.me.name} added dependent ${parsed.data.fullName}`,
    });
    res.status(201).json({ dependent: dependentWire(row) });
  } catch (err) {
    next(err);
  }
});

async function ownDependent(
  ctx: { person: SelfPersonRow },
  id: string,
): Promise<typeof atelierDependents.$inferSelect | null> {
  const [dep] = await db
    .select()
    .from(atelierDependents)
    .where(
      and(
        eq(atelierDependents.id, id),
        eq(atelierDependents.personType, ctx.person.workerType),
        eq(atelierDependents.personId, ctx.person.row.id),
        isNull(atelierDependents.deletedAt),
      ),
    );
  return dep ?? null;
}

// @cli-skip: self-scope dependent edit; no CLI shape (Task #51)
router.patch("/me/dependents/:id", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const dep = await ownDependent(ctx, req.params.id);
    if (!dep) {
      res.status(404).json({ error: "dependent-not-found" });
      return;
    }
    const parsed = DependentBody.partial().strict().safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) upd[k] = v;
    }
    const [row] = await db
      .update(atelierDependents)
      .set(upd)
      .where(eq(atelierDependents.id, dep.id))
      .returning();
    await audit({
      me: ctx.me,
      entityType: "dependent",
      entityId: dep.id,
      action: "person.dependent.updated",
      payload: { fields: Object.keys(parsed.data) },
      summary: `${ctx.me.name} updated dependent ${dep.fullName}`,
    });
    res.json({ dependent: dependentWire(row) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope dependent delete; no CLI shape (Task #51)
router.delete("/me/dependents/:id", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const dep = await ownDependent(ctx, req.params.id);
    if (!dep) {
      res.status(404).json({ error: "dependent-not-found" });
      return;
    }
    const now = new Date();
    await db
      .update(atelierDependents)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(atelierDependents.id, dep.id));
    // Cascade: soft-delete the dependent's document rows too.
    await db
      .update(atelierPersonDocuments)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(atelierPersonDocuments.dependentId, dep.id),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      );
    await audit({
      me: ctx.me,
      entityType: "dependent",
      entityId: dep.id,
      action: "person.dependent.deleted",
      payload: { fullName: dep.fullName },
      summary: `${ctx.me.name} removed dependent ${dep.fullName}`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Emergency contacts
// ------------------------------------------------------------------
const EmergencyContactBody = z
  .object({
    name: z.string().min(1).max(200),
    relationship: z.string().min(1).max(100),
    phones: z.array(z.string().min(3).max(40)).min(1).max(3),
    email: z.string().max(320).nullable().optional(),
  })
  .strict();

function contactWire(c: typeof atelierEmergencyContacts.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    relationship: c.relationship,
    phones: (c.phones ?? []) as string[],
    email: c.email ?? null,
  };
}

// @cli-skip: self-scope emergency contacts; no CLI shape (Task #51)
router.get("/me/emergency-contacts", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(atelierEmergencyContacts)
      .where(
        and(
          eq(atelierEmergencyContacts.personType, ctx.person.workerType),
          eq(atelierEmergencyContacts.personId, ctx.person.row.id),
          isNull(atelierEmergencyContacts.deletedAt),
        ),
      )
      .orderBy(desc(atelierEmergencyContacts.createdAt));
    res.json({ contacts: rows.map(contactWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope emergency contact create; no CLI shape (Task #51)
router.post("/me/emergency-contacts", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const parsed = EmergencyContactBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const id = rid("ec");
    const [row] = await db
      .insert(atelierEmergencyContacts)
      .values({
        id,
        orgId: ctx.me.orgId,
        personType: ctx.person.workerType,
        personId: ctx.person.row.id,
        name: parsed.data.name,
        relationship: parsed.data.relationship,
        phones: parsed.data.phones,
        email: parsed.data.email ?? null,
        createdByUserId: ctx.me.id,
      })
      .returning();
    await audit({
      me: ctx.me,
      entityType: "emergency_contact",
      entityId: id,
      action: "person.emergency_contact.created",
      payload: { name: parsed.data.name, relationship: parsed.data.relationship },
      summary: `${ctx.me.name} added emergency contact ${parsed.data.name}`,
    });
    res.status(201).json({ contact: contactWire(row) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope emergency contact edit; no CLI shape (Task #51)
router.patch("/me/emergency-contacts/:id", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const [ec] = await db
      .select()
      .from(atelierEmergencyContacts)
      .where(
        and(
          eq(atelierEmergencyContacts.id, req.params.id),
          eq(atelierEmergencyContacts.personType, ctx.person.workerType),
          eq(atelierEmergencyContacts.personId, ctx.person.row.id),
          isNull(atelierEmergencyContacts.deletedAt),
        ),
      );
    if (!ec) {
      res.status(404).json({ error: "contact-not-found" });
      return;
    }
    const parsed = EmergencyContactBody.partial().strict().safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const upd: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) upd[k] = v;
    }
    const [row] = await db
      .update(atelierEmergencyContacts)
      .set(upd)
      .where(eq(atelierEmergencyContacts.id, ec.id))
      .returning();
    await audit({
      me: ctx.me,
      entityType: "emergency_contact",
      entityId: ec.id,
      action: "person.emergency_contact.updated",
      payload: { fields: Object.keys(parsed.data) },
      summary: `${ctx.me.name} updated emergency contact ${ec.name}`,
    });
    res.json({ contact: contactWire(row) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope emergency contact delete; no CLI shape (Task #51)
router.delete("/me/emergency-contacts/:id", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const [ec] = await db
      .select()
      .from(atelierEmergencyContacts)
      .where(
        and(
          eq(atelierEmergencyContacts.id, req.params.id),
          eq(atelierEmergencyContacts.personType, ctx.person.workerType),
          eq(atelierEmergencyContacts.personId, ctx.person.row.id),
          isNull(atelierEmergencyContacts.deletedAt),
        ),
      );
    if (!ec) {
      res.status(404).json({ error: "contact-not-found" });
      return;
    }
    await db
      .update(atelierEmergencyContacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierEmergencyContacts.id, ec.id));
    await audit({
      me: ctx.me,
      entityType: "emergency_contact",
      entityId: ec.id,
      action: "person.emergency_contact.deleted",
      payload: { name: ec.name },
      summary: `${ctx.me.name} removed emergency contact ${ec.name}`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// Profile photo — stored privately, served through the authenticated
// people-photos route so it can be reused wherever the person appears.
// ------------------------------------------------------------------

// @cli-skip: self-scope photo upload; no CLI shape (Task #51)
router.post(
  "/me/photo",
  multerWrapped(photoUpload.single("file")),
  async (req, res, next) => {
    try {
      const ctx = await requireSelfPerson(req, res);
      if (!ctx) return;
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: "no-file" });
        return;
      }
      if (!PHOTO_MIMES.has(file.mimetype)) {
        res.status(415).json({ error: "unsupported-file-type", allowed: [...PHOTO_MIMES] });
        return;
      }
      const stored = await storePersonDocBytes(file.buffer, file.mimetype);
      const now = new Date();
      // Retire any previous photo row (and its bytes) for this person.
      const oldPhotos = await db
        .select()
        .from(atelierPersonDocuments)
        .where(
          and(
            eq(atelierPersonDocuments.personType, ctx.person.workerType),
            eq(atelierPersonDocuments.personId, ctx.person.row.id),
            eq(atelierPersonDocuments.kind, "profile_photo"),
            isNull(atelierPersonDocuments.deletedAt),
          ),
        );
      for (const old of oldPhotos) {
        await db
          .update(atelierPersonDocuments)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(atelierPersonDocuments.id, old.id));
        if (old.fileRef)
          await dropPersonDocBytes(old.fileRef).catch((err) =>
            req.log.warn({ err, fileRef: old.fileRef }, "person-doc old photo cleanup failed"),
          );
      }
      const id = rid("pdoc");
      await db.insert(atelierPersonDocuments).values({
        id,
        orgId: ctx.me.orgId,
        personType: ctx.person.workerType,
        personId: ctx.person.row.id,
        kind: "profile_photo",
        title: "Profile photo",
        fileRef: stored.fileRef,
        fileName: file.originalname || "photo",
        mime: file.mimetype,
        sizeBytes: stored.sizeBytes,
        uploadedByUserId: ctx.me.id,
        createdByUserId: ctx.me.id,
      });
      const avatarUrl = `/api/atelier/people-photos/${ctx.person.workerType}/${ctx.person.row.id}?v=${now.getTime()}`;
      if (ctx.person.workerType === "employee") {
        await db
          .update(atelierEmployees)
          .set({ avatarUrl, updatedAt: now })
          .where(eq(atelierEmployees.id, ctx.person.row.id));
      } else {
        await db
          .update(atelierContractors)
          .set({ avatarUrl, updatedAt: now })
          .where(eq(atelierContractors.id, ctx.person.row.id));
      }
      // Mirror onto the login row so the persona chip picks it up too.
      await db
        .update(atelierUsers)
        .set({ avatarUrl })
        .where(eq(atelierUsers.id, ctx.me.id));
      await audit({
        me: ctx.me,
        entityType: ctx.person.workerType,
        entityId: ctx.person.row.id,
        action: "person.photo.updated",
        payload: { docId: id, sizeBytes: stored.sizeBytes },
        summary: `${ctx.me.name} updated their profile photo`,
      });
      res.status(201).json({ avatarUrl });
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: authenticated org-scoped photo stream; no CLI shape (Task #51)
router.get("/people-photos/:personType/:personId", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const { personType, personId } = req.params;
    if (personType !== "employee" && personType !== "contractor") {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const [photo] = await db
      .select()
      .from(atelierPersonDocuments)
      .where(
        and(
          eq(atelierPersonDocuments.orgId, me.orgId),
          eq(atelierPersonDocuments.personType, personType),
          eq(atelierPersonDocuments.personId, personId),
          eq(atelierPersonDocuments.kind, "profile_photo"),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPersonDocuments.uploadedAt))
      .limit(1);
    if (!photo?.fileRef) {
      res.status(404).json({ error: "no-photo" });
      return;
    }
    const bytes = await loadPersonDocBytes(photo.fileRef);
    if (!bytes) {
      res.status(404).json({ error: "no-photo" });
      return;
    }
    res.setHeader("Content-Type", photo.mime || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

export default router;
