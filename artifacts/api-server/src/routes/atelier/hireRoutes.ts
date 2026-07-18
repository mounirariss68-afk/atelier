/**
 * Atelier — Task #125: Hiring CRUD (open roles, candidates + CV upload,
 * interview panels + structured feedback, offers + joiner handoff).
 *
 * All routes gate on hr | partner | founding_partner and are org-scoped
 * to the actor. Every mutation writes an audit event. Candidate files
 * live in private object storage via the shared person-document blob
 * helper (atelier_person_documents rows with person_type='candidate');
 * bytes only ever stream through the authenticated download route.
 *
 * Offer → joiner handoff: when an offer is accepted, the UI hands off to
 * the joiner form with prefilled fields; once the login is created the
 * offer is PATCHed with joinerUserId so the chain candidate → offer →
 * login stays traceable.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAuditEvents,
  atelierPersonDocuments,
  atelierStudioOpenRoles,
  atelierStudioCandidates,
  atelierStudioInterviewPanels,
  atelierStudioOffers,
} from "@workspace/db";
import {
  AtelierCreateHireRoleBody,
  AtelierUpdateHireRoleBody,
  AtelierCreateHireCandidateBody,
  AtelierUpdateHireCandidateBody,
  AtelierCreateHireInterviewBody,
  AtelierUpdateHireInterviewBody,
  AtelierCreateHireOfferBody,
  AtelierUpdateHireOfferBody,
} from "@workspace/api-zod";
import {
  storePersonDocBytes,
  loadPersonDocBytes,
} from "../../lib/personDocStorage";
import { isFoundingPartner, isHr, isPartner } from "./personaRoles";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureHiringActor(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (!isHr(me.role) && !isPartner(me.role) && !isFoundingPartner(me.role)) {
    res.status(403).json({
      error: "forbidden",
      message: "Only HR or a partner can manage hiring.",
    });
    return null;
  }
  return me;
}

function audit(args: {
  actor: typeof atelierUsers.$inferSelect;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<unknown> {
  return db.insert(atelierAuditEvents).values({
    id: `audit_${randomUUID()}`,
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

function roleWire(r: typeof atelierStudioOpenRoles.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    level: r.level,
    location: r.location,
    targetStart: r.targetStart,
    urgency: r.urgency,
    summary: r.summary,
    status: r.status,
    activeCandidates: r.activeCandidates,
  };
}

function candidateWire(c: typeof atelierStudioCandidates.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    roleId: c.roleId ?? null,
    roleTitle: c.roleTitle,
    stage: c.stage,
    source: c.source,
    currentRole: c.currentRole,
    currentEmployer: c.currentEmployer,
  };
}

function interviewWire(p: typeof atelierStudioInterviewPanels.$inferSelect) {
  return {
    id: p.id,
    candidateId: p.candidateId ?? null,
    candidateName: p.candidateName,
    roleTitle: p.roleTitle,
    scheduledFor: p.scheduledFor,
    status: p.status,
    stages: p.stages.map((s) => ({
      stage: s.stage,
      interviewer: s.interviewer,
      durationMin: s.durationMin,
      focus: s.focus,
      score: s.score ?? null,
      notes: s.notes ?? null,
    })),
  };
}

function offerWire(o: typeof atelierStudioOffers.$inferSelect) {
  return {
    id: o.id,
    candidateId: o.candidateId ?? null,
    candidateName: o.candidateName,
    roleTitle: o.roleTitle,
    jurisdiction: o.jurisdiction,
    startDate: o.startDate,
    totalAtTargetUsdK: o.totalAtTargetUsdK,
    marketP25: o.marketP25,
    marketP75: o.marketP75,
    status: o.status,
    bandFlag: o.bandFlag ?? null,
    joinerUserId: o.joinerUserId ?? null,
  };
}

async function loadRow<
  T extends
    | typeof atelierStudioOpenRoles
    | typeof atelierStudioCandidates
    | typeof atelierStudioInterviewPanels
    | typeof atelierStudioOffers,
>(table: T, orgId: string, id: string): Promise<T["$inferSelect"] | null> {
  const [row] = await db
    .select()
    .from(table as never)
    .where(
      and(eq(table.id, id), eq(table.orgId, orgId), isNull(table.deletedAt)),
    );
  return (row as T["$inferSelect"] | undefined) ?? null;
}

/** Recount live (non-terminal) candidates on a role. */
async function refreshActiveCandidates(orgId: string, roleId: string | null) {
  if (!roleId) return;
  const rows = await db
    .select()
    .from(atelierStudioCandidates)
    .where(
      and(
        eq(atelierStudioCandidates.orgId, orgId),
        eq(atelierStudioCandidates.roleId, roleId),
        isNull(atelierStudioCandidates.deletedAt),
      ),
    );
  const active = rows.filter(
    (c) => c.stage !== "rejected" && c.stage !== "hired",
  ).length;
  await db
    .update(atelierStudioOpenRoles)
    .set({ activeCandidates: active, updatedAt: new Date() })
    .where(
      and(
        eq(atelierStudioOpenRoles.id, roleId),
        eq(atelierStudioOpenRoles.orgId, orgId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Open roles
// ---------------------------------------------------------------------------

// @cli-skip: HR hiring admin surface; no CLI shape (Task #125)
router.get("/hire/roles", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierStudioOpenRoles)
      .where(
        and(
          eq(atelierStudioOpenRoles.orgId, me.orgId),
          isNull(atelierStudioOpenRoles.deletedAt),
        ),
      )
      .orderBy(desc(atelierStudioOpenRoles.createdAt));
    res.json({ items: rows.map(roleWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR hiring admin mutation; no CLI shape (Task #125)
router.post("/hire/roles", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const parsed = AtelierCreateHireRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    const id = rid("role");
    await db.insert(atelierStudioOpenRoles).values({
      id,
      orgId: me.orgId,
      title: b.title.trim(),
      level: b.level.trim(),
      location: b.location.trim(),
      targetStart: b.targetStart?.trim() ?? "",
      urgency: b.urgency ?? "medium",
      summary: b.summary?.trim() ?? "",
      status: "open",
    });
    const row = await loadRow(atelierStudioOpenRoles, me.orgId, id);
    await audit({
      actor: me,
      entityType: "hire_role",
      entityId: id,
      action: "hire_role.create",
      payload: { title: b.title, level: b.level, location: b.location },
      summary: `${me.name} opened the ${b.title} position`,
    });
    res.status(201).json(roleWire(row!));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR hiring admin mutation; no CLI shape (Task #125)
router.patch("/hire/roles/:id", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const parsed = AtelierUpdateHireRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const existing = await loadRow(atelierStudioOpenRoles, me.orgId, String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: "not-found", message: "No such position." });
      return;
    }
    const b = parsed.data;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (b.title !== undefined) set.title = b.title.trim();
    if (b.level !== undefined) set.level = b.level.trim();
    if (b.location !== undefined) set.location = b.location.trim();
    if (b.targetStart !== undefined) set.targetStart = b.targetStart.trim();
    if (b.urgency !== undefined) set.urgency = b.urgency;
    if (b.summary !== undefined) set.summary = b.summary.trim();
    if (b.status !== undefined) set.status = b.status;
    await db
      .update(atelierStudioOpenRoles)
      .set(set)
      .where(eq(atelierStudioOpenRoles.id, existing.id));
    const row = await loadRow(atelierStudioOpenRoles, me.orgId, existing.id);
    await audit({
      actor: me,
      entityType: "hire_role",
      entityId: existing.id,
      action: "hire_role.update",
      payload: { changes: b },
      summary: `${me.name} updated the ${row!.title} position${b.status ? ` (status → ${b.status})` : ""}`,
    });
    res.json(roleWire(row!));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

// @cli-skip: HR hiring admin surface; no CLI shape (Task #125)
router.get("/hire/candidates", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierStudioCandidates)
      .where(
        and(
          eq(atelierStudioCandidates.orgId, me.orgId),
          isNull(atelierStudioCandidates.deletedAt),
        ),
      )
      .orderBy(desc(atelierStudioCandidates.createdAt));
    res.json({ items: rows.map(candidateWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR hiring admin mutation; no CLI shape (Task #125)
router.post("/hire/candidates", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const parsed = AtelierCreateHireCandidateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    let roleTitle = "";
    if (b.roleId) {
      const role = await loadRow(atelierStudioOpenRoles, me.orgId, b.roleId);
      if (!role) {
        res.status(400).json({ error: "invalid-role", message: "That position does not exist." });
        return;
      }
      roleTitle = role.title;
    }
    const id = rid("cand");
    await db.insert(atelierStudioCandidates).values({
      id,
      orgId: me.orgId,
      name: b.name.trim(),
      email: b.email?.trim() ?? "",
      phone: b.phone?.trim() ?? "",
      notes: b.notes?.trim() ?? "",
      roleId: b.roleId ?? null,
      roleTitle,
      stage: b.stage ?? "sourced",
      source: b.source?.trim() ?? "",
      currentRole: b.currentRole?.trim() ?? "",
      currentEmployer: b.currentEmployer?.trim() ?? "",
      activeOrPassive: "active",
    });
    await refreshActiveCandidates(me.orgId, b.roleId ?? null);
    const row = await loadRow(atelierStudioCandidates, me.orgId, id);
    await audit({
      actor: me,
      entityType: "hire_candidate",
      entityId: id,
      action: "hire_candidate.create",
      payload: { name: b.name, roleId: b.roleId ?? null },
      summary: `${me.name} added candidate ${b.name}${roleTitle ? ` for ${roleTitle}` : ""}`,
    });
    res.status(201).json(candidateWire(row!));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR hiring admin mutation; no CLI shape (Task #125)
router.patch("/hire/candidates/:id", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const parsed = AtelierUpdateHireCandidateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const existing = await loadRow(atelierStudioCandidates, me.orgId, String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: "not-found", message: "No such candidate." });
      return;
    }
    const b = parsed.data;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name.trim();
    if (b.email !== undefined) set.email = b.email.trim();
    if (b.phone !== undefined) set.phone = b.phone.trim();
    if (b.notes !== undefined) set.notes = b.notes.trim();
    if (b.stage !== undefined) set.stage = b.stage;
    if (b.source !== undefined) set.source = b.source.trim();
    if (b.currentRole !== undefined) set.currentRole = b.currentRole.trim();
    if (b.currentEmployer !== undefined) set.currentEmployer = b.currentEmployer.trim();
    if (b.roleId !== undefined) {
      if (b.roleId === null || b.roleId === "") {
        set.roleId = null;
        set.roleTitle = "";
      } else {
        const role = await loadRow(atelierStudioOpenRoles, me.orgId, b.roleId);
        if (!role) {
          res.status(400).json({ error: "invalid-role", message: "That position does not exist." });
          return;
        }
        set.roleId = b.roleId;
        set.roleTitle = role.title;
      }
    }
    await db
      .update(atelierStudioCandidates)
      .set(set)
      .where(eq(atelierStudioCandidates.id, existing.id));
    // Recount on both the old and (possibly) new role.
    await refreshActiveCandidates(me.orgId, existing.roleId ?? null);
    if (b.roleId !== undefined && b.roleId !== existing.roleId) {
      await refreshActiveCandidates(me.orgId, b.roleId || null);
    }
    const row = await loadRow(atelierStudioCandidates, me.orgId, existing.id);
    await audit({
      actor: me,
      entityType: "hire_candidate",
      entityId: existing.id,
      action: "hire_candidate.update",
      payload: { changes: b },
      summary: `${me.name} updated candidate ${row!.name}${b.stage ? ` (stage → ${b.stage})` : ""}`,
    });
    res.json(candidateWire(row!));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Candidate documents (CV etc.) — private object storage
// ---------------------------------------------------------------------------

const CV_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const CV_MAX_BYTES = 15 * 1024 * 1024;
const CV_KINDS = new Set(["cv", "cover_letter", "portfolio", "other"]);

const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CV_MAX_BYTES, files: 1 },
});

function cvUploadWrapped(
  handler: ReturnType<typeof cvUpload.single>,
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

/**
 * Content sniff: reject files whose bytes don't match the claimed type.
 * PDFs must start with %PDF-, PNG/JPEG/WebP with their magic numbers,
 * DOCX with the ZIP signature. Garbage bytes with a plausible mime get
 * a 415 instead of poisoning the document store.
 */
function bytesMatchMime(buf: Buffer, mime: string): boolean {
  if (buf.length < 8) return false;
  switch (mime) {
    case "application/pdf":
      return buf.subarray(0, 5).toString("latin1") === "%PDF-";
    case "image/png":
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8;
    case "image/webp":
      return (
        buf.subarray(0, 4).toString("latin1") === "RIFF" &&
        buf.subarray(8, 12).toString("latin1") === "WEBP"
      );
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return buf[0] === 0x50 && buf[1] === 0x4b;
    default:
      return false;
  }
}

function candidateDocWire(d: typeof atelierPersonDocuments.$inferSelect) {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    fileName: d.fileName ?? null,
    mime: d.mime ?? null,
    sizeBytes: d.sizeBytes ?? null,
    uploadedAt: d.uploadedAt.toISOString(),
  };
}

// @cli-skip: HR hiring admin surface; no CLI shape (Task #125)
router.get("/hire/candidates/:id/documents", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const cand = await loadRow(atelierStudioCandidates, me.orgId, String(req.params.id));
    if (!cand) {
      res.status(404).json({ error: "not-found", message: "No such candidate." });
      return;
    }
    const docs = await db
      .select()
      .from(atelierPersonDocuments)
      .where(
        and(
          eq(atelierPersonDocuments.orgId, me.orgId),
          eq(atelierPersonDocuments.personType, "candidate"),
          eq(atelierPersonDocuments.personId, cand.id),
          isNull(atelierPersonDocuments.deletedAt),
        ),
      )
      .orderBy(asc(atelierPersonDocuments.uploadedAt));
    res.json({ documents: docs.map(candidateDocWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: multipart HR upload; no CLI shape (Task #125)
router.post(
  "/hire/candidates/:id/documents",
  cvUploadWrapped(cvUpload.single("file")),
  async (req, res, next) => {
    try {
      const me = ensureHiringActor(req, res);
      if (!me) return;
      const cand = await loadRow(atelierStudioCandidates, me.orgId, String(req.params.id));
      if (!cand) {
        res.status(404).json({ error: "not-found", message: "No such candidate." });
        return;
      }
      const file = req.file;
      if (!file || !file.buffer?.length) {
        res.status(400).json({ error: "no-file", message: "Attach a file to upload." });
        return;
      }
      const mime = (file.mimetype || "").toLowerCase();
      if (!CV_MIMES.has(mime) || !bytesMatchMime(file.buffer, mime)) {
        res.status(415).json({
          error: "unsupported-file-type",
          message: "Upload a PDF, Word document (.docx) or image (JPEG/PNG/WebP).",
        });
        return;
      }
      const kindRaw = typeof req.body?.kind === "string" ? req.body.kind : "cv";
      const kind = CV_KINDS.has(kindRaw) ? kindRaw : "cv";
      const title =
        (typeof req.body?.title === "string" && req.body.title.trim().slice(0, 200)) ||
        file.originalname ||
        "Candidate document";
      const stored = await storePersonDocBytes(file.buffer, mime);
      const id = rid("cdoc");
      await db.insert(atelierPersonDocuments).values({
        id,
        orgId: me.orgId,
        personType: "candidate",
        personId: cand.id,
        kind,
        title,
        fileRef: stored.fileRef,
        fileName: file.originalname || null,
        mime,
        sizeBytes: stored.sizeBytes,
        uploadedByUserId: me.id,
      });
      const [row] = await db
        .select()
        .from(atelierPersonDocuments)
        .where(eq(atelierPersonDocuments.id, id));
      await audit({
        actor: me,
        entityType: "hire_candidate",
        entityId: cand.id,
        action: "hire_candidate.document_upload",
        payload: { documentId: id, kind, fileName: file.originalname ?? null, sizeBytes: stored.sizeBytes },
        summary: `${me.name} uploaded ${kind} "${title}" for candidate ${cand.name}`,
      });
      res.status(201).json(candidateDocWire(row!));
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: binary download; no CLI shape (Task #125)
router.get(
  "/hire/candidates/:id/documents/:docId/download",
  async (req, res, next) => {
    try {
      const me = ensureHiringActor(req, res);
      if (!me) return;
      const cand = await loadRow(atelierStudioCandidates, me.orgId, String(req.params.id));
      if (!cand) {
        res.status(404).json({ error: "not-found", message: "No such candidate." });
        return;
      }
      const [doc] = await db
        .select()
        .from(atelierPersonDocuments)
        .where(
          and(
            eq(atelierPersonDocuments.id, String(req.params.docId)),
            eq(atelierPersonDocuments.orgId, me.orgId),
            eq(atelierPersonDocuments.personType, "candidate"),
            eq(atelierPersonDocuments.personId, cand.id),
            isNull(atelierPersonDocuments.deletedAt),
          ),
        );
      if (!doc || !doc.fileRef) {
        res.status(404).json({ error: "not-found", message: "No such document." });
        return;
      }
      const bytes = await loadPersonDocBytes(doc.fileRef);
      if (!bytes) {
        res.status(404).json({ error: "file-missing", message: "The stored file could not be loaded." });
        return;
      }
      res.setHeader("Content-Type", doc.mime || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${(doc.fileName || doc.title).replace(/"/g, "")}"`,
      );
      res.send(bytes);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Interview panels
// ---------------------------------------------------------------------------

// @cli-skip: HR hiring admin surface; no CLI shape (Task #125)
router.get("/hire/interviews", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierStudioInterviewPanels)
      .where(
        and(
          eq(atelierStudioInterviewPanels.orgId, me.orgId),
          isNull(atelierStudioInterviewPanels.deletedAt),
        ),
      )
      .orderBy(desc(atelierStudioInterviewPanels.createdAt));
    res.json({ items: rows.map(interviewWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR hiring admin mutation; no CLI shape (Task #125)
router.post("/hire/interviews", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const parsed = AtelierCreateHireInterviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    const cand = await loadRow(atelierStudioCandidates, me.orgId, b.candidateId);
    if (!cand) {
      res.status(400).json({ error: "invalid-candidate", message: "That candidate does not exist." });
      return;
    }
    const id = rid("panel");
    await db.insert(atelierStudioInterviewPanels).values({
      id,
      orgId: me.orgId,
      candidateId: cand.id,
      candidateName: cand.name,
      roleTitle: cand.roleTitle,
      scheduledFor: b.scheduledFor.trim(),
      status: "scheduled",
      stages: b.stages.map((s) => ({
        stage: s.stage,
        interviewer: s.interviewer,
        durationMin: s.durationMin,
        focus: s.focus,
        score: s.score ?? null,
        notes: s.notes ?? null,
      })),
    });
    const row = await loadRow(atelierStudioInterviewPanels, me.orgId, id);
    await audit({
      actor: me,
      entityType: "hire_interview",
      entityId: id,
      action: "hire_interview.create",
      payload: { candidateId: cand.id, scheduledFor: b.scheduledFor, stageCount: b.stages.length },
      summary: `${me.name} scheduled a ${b.stages.length}-stage interview panel for ${cand.name}`,
    });
    res.status(201).json(interviewWire(row!));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR hiring admin mutation; no CLI shape (Task #125)
router.patch("/hire/interviews/:id", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const parsed = AtelierUpdateHireInterviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const existing = await loadRow(atelierStudioInterviewPanels, me.orgId, String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: "not-found", message: "No such interview panel." });
      return;
    }
    const b = parsed.data;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (b.scheduledFor !== undefined) set.scheduledFor = b.scheduledFor.trim();
    if (b.status !== undefined) set.status = b.status;
    if (b.stages !== undefined) {
      set.stages = b.stages.map((s) => ({
        stage: s.stage,
        interviewer: s.interviewer,
        durationMin: s.durationMin,
        focus: s.focus,
        score: s.score ?? null,
        notes: s.notes ?? null,
      }));
    }
    await db
      .update(atelierStudioInterviewPanels)
      .set(set)
      .where(eq(atelierStudioInterviewPanels.id, existing.id));
    const row = await loadRow(atelierStudioInterviewPanels, me.orgId, existing.id);
    await audit({
      actor: me,
      entityType: "hire_interview",
      entityId: existing.id,
      action: "hire_interview.update",
      payload: { changes: b },
      summary: `${me.name} updated the interview panel for ${existing.candidateName}${b.status ? ` (status → ${b.status})` : ""}`,
    });
    res.json(interviewWire(row!));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

// @cli-skip: HR hiring admin surface; no CLI shape (Task #125)
router.get("/hire/offers", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierStudioOffers)
      .where(
        and(
          eq(atelierStudioOffers.orgId, me.orgId),
          isNull(atelierStudioOffers.deletedAt),
        ),
      )
      .orderBy(desc(atelierStudioOffers.createdAt));
    res.json({ items: rows.map(offerWire) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR hiring admin mutation; no CLI shape (Task #125)
router.post("/hire/offers", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const parsed = AtelierCreateHireOfferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    const cand = await loadRow(atelierStudioCandidates, me.orgId, b.candidateId);
    if (!cand) {
      res.status(400).json({ error: "invalid-candidate", message: "That candidate does not exist." });
      return;
    }
    const id = rid("offer");
    await db.insert(atelierStudioOffers).values({
      id,
      orgId: me.orgId,
      candidateId: cand.id,
      candidateName: cand.name,
      roleTitle: b.roleTitle.trim(),
      jurisdiction: b.jurisdiction?.trim() ?? "",
      startDate: b.startDate.trim(),
      totalAtTargetUsdK: b.totalAtTargetUsdK ?? 0,
      marketP25: b.marketP25 ?? 0,
      marketP75: b.marketP75 ?? 0,
      status: "draft",
      bandFlag: b.bandFlag?.trim() || null,
    });
    const row = await loadRow(atelierStudioOffers, me.orgId, id);
    await audit({
      actor: me,
      entityType: "hire_offer",
      entityId: id,
      action: "hire_offer.create",
      payload: { candidateId: cand.id, roleTitle: b.roleTitle, startDate: b.startDate },
      summary: `${me.name} drafted an offer for ${cand.name} (${b.roleTitle})`,
    });
    res.status(201).json(offerWire(row!));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR hiring admin mutation; no CLI shape (Task #125)
router.patch("/hire/offers/:id", async (req, res, next) => {
  try {
    const me = ensureHiringActor(req, res);
    if (!me) return;
    const parsed = AtelierUpdateHireOfferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const existing = await loadRow(atelierStudioOffers, me.orgId, String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: "not-found", message: "No such offer." });
      return;
    }
    const b = parsed.data;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (b.roleTitle !== undefined) set.roleTitle = b.roleTitle.trim();
    if (b.jurisdiction !== undefined) set.jurisdiction = b.jurisdiction.trim();
    if (b.startDate !== undefined) set.startDate = b.startDate.trim();
    if (b.totalAtTargetUsdK !== undefined) set.totalAtTargetUsdK = b.totalAtTargetUsdK;
    if (b.marketP25 !== undefined) set.marketP25 = b.marketP25;
    if (b.marketP75 !== undefined) set.marketP75 = b.marketP75;
    if (b.bandFlag !== undefined) set.bandFlag = b.bandFlag?.trim() || null;
    if (b.status !== undefined) set.status = b.status;
    if (b.joinerUserId !== undefined) {
      // Joiner link must point at a real, org-scoped user identity.
      const [user] = await db
        .select()
        .from(atelierUsers)
        .where(
          and(
            eq(atelierUsers.id, b.joinerUserId),
            eq(atelierUsers.orgId, me.orgId),
            isNull(atelierUsers.deletedAt),
          ),
        );
      if (!user) {
        res.status(400).json({ error: "invalid-joiner", message: "No such user to link." });
        return;
      }
      set.joinerUserId = b.joinerUserId;
    }
    await db
      .update(atelierStudioOffers)
      .set(set)
      .where(eq(atelierStudioOffers.id, existing.id));
    // Accepted offer moves the linked candidate to "hired"; declined /
    // withdrawn moves them back out of the offer stage record-keeping-wise.
    if (b.status === "accepted" && existing.candidateId) {
      await db
        .update(atelierStudioCandidates)
        .set({ stage: "hired", updatedAt: new Date() })
        .where(
          and(
            eq(atelierStudioCandidates.id, existing.candidateId),
            eq(atelierStudioCandidates.orgId, me.orgId),
          ),
        );
      const [cand] = await db
        .select()
        .from(atelierStudioCandidates)
        .where(eq(atelierStudioCandidates.id, existing.candidateId));
      await refreshActiveCandidates(me.orgId, cand?.roleId ?? null);
    }
    const row = await loadRow(atelierStudioOffers, me.orgId, existing.id);
    await audit({
      actor: me,
      entityType: "hire_offer",
      entityId: existing.id,
      action: "hire_offer.update",
      payload: { changes: b },
      summary: `${me.name} updated the offer for ${existing.candidateName}${b.status ? ` (status → ${b.status})` : ""}${b.joinerUserId ? "; linked joiner login" : ""}`,
    });
    res.json(offerWire(row!));
  } catch (err) {
    next(err);
  }
});

export default router;
