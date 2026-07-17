/**
 * Task #55 — HR Performance & Learning management (People lens).
 *
 * Performance reviews + goals: HR authors lightweight review records and
 * controls what the employee sees via the release switch. Draft reviews
 * are HR-only; released reviews surface on the employee's /me/reviews.
 * `hrNotes` stays HR-side in every shape here too — it is only visible to
 * the personas allowed onto these routes in the first place.
 *
 * Training-material library: title / description / topic / audience with
 * either an external link or an uploaded file. Files land in object
 * storage under `atelier-training/` (bytes never live in DB rows) and are
 * streamed back through the audience-checked /me/learning/:id/download
 * route. Completion marks are per (material, user) and HR can read the
 * per-person completion overview.
 *
 * Gate: hr | founding_partner | partner (same tier that runs the rest of
 * the People lens admin surfaces).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierAuditEvents,
  atelierPerformanceReviews,
  atelierPerformanceGoals,
  atelierTrainingMaterials,
  atelierTrainingCompletions,
} from "@workspace/db";
import {
  AtelierListPerformanceReviewsResponse,
  AtelierCreatePerformanceReviewBody,
  AtelierUpdatePerformanceReviewBody,
  AtelierUpdatePerformanceReviewResponse,
  AtelierReleasePerformanceReviewBody,
  AtelierReleasePerformanceReviewResponse,
  AtelierListPerformanceGoalsResponse,
  AtelierCreatePerformanceGoalBody,
  AtelierUpdatePerformanceGoalBody,
  AtelierUpdatePerformanceGoalResponse,
  AtelierListTrainingMaterialsResponse,
  AtelierCreateTrainingMaterialBody,
  AtelierUpdateTrainingMaterialBody,
  AtelierUpdateTrainingMaterialResponse,
  AtelierArchiveTrainingMaterialResponse,
  AtelierListTrainingCompletionsResponse,
} from "@workspace/api-zod";
import { isHr, isLeadership } from "./personaRoles";
import { objectStorageClient } from "../../lib/objectStorage.js";
import { emitSelfNotification } from "./meRoutes";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureHr(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (!isHr(me.role) && !isLeadership(me.role)) {
    res.status(403).json({
      error: "hr-only",
      message: "People performance & learning admin is HR / partner-tier only.",
    });
    return null;
  }
  return me;
}

async function audit(args: {
  me: typeof atelierUsers.$inferSelect;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("audit"),
    orgId: args.me.orgId,
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.me.id,
    actorLabel: args.me.name,
    action: args.action,
    payload: args.payload ?? {},
    payloadSummary: args.summary,
    createdByUserId: args.me.id,
  });
}

// ---------------------------------------------------------------
// Training-file blob storage (object storage; bytes never in DB).
// Mirrors the CLI-attachment storage pattern in atelier-cli/attachments.
// ---------------------------------------------------------------
const TRAINING_SUBDIR = "atelier-training";

function trainingObjectName(key: string): { bucketName: string; objectName: string } {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — object storage is required for training-material file uploads.",
    );
  }
  const trimmed = dir.startsWith("/") ? dir.slice(1) : dir;
  const slash = trimmed.indexOf("/");
  const bucketName = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const basePrefix =
    slash === -1
      ? TRAINING_SUBDIR
      : `${trimmed.slice(slash + 1).replace(/\/+$/, "")}/${TRAINING_SUBDIR}`;
  return { bucketName, objectName: `${basePrefix}/${key}` };
}

export async function storeTrainingFileBytes(
  buf: Buffer,
  contentType: string,
): Promise<string> {
  const sha = createHash("sha256").update(buf).digest("hex");
  const key = `${sha.slice(0, 16)}_${randomBytes(4).toString("hex")}`;
  const { bucketName, objectName } = trainingObjectName(key);
  await objectStorageClient
    .bucket(bucketName)
    .file(objectName)
    .save(buf, { resumable: false, contentType });
  return key;
}

export async function loadTrainingFileBytes(key: string): Promise<Buffer | null> {
  const { bucketName, objectName } = trainingObjectName(key);
  try {
    const [contents] = await objectStorageClient
      .bucket(bucketName)
      .file(objectName)
      .download();
    return contents;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return null;
    throw err;
  }
}

// =============================================================
// Performance reviews
// =============================================================

async function employeeNameMap(
  orgId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: atelierEmployees.id, fullName: atelierEmployees.fullName })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.orgId, orgId), inArray(atelierEmployees.id, ids)));
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

function reviewToWire(
  r: typeof atelierPerformanceReviews.$inferSelect,
  employeeName: string,
) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName,
    cycle: r.cycle,
    reviewedOn: r.reviewedOn,
    selfRating: r.selfRating,
    managerRating: r.managerRating,
    strengths: r.strengths,
    growthAreas: r.growthAreas,
    managerSummary: r.managerSummary,
    hrNotes: r.hrNotes,
    status: r.status as "draft" | "released",
    releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
  };
}

// @cli-skip: HR admin read; no CLI shape (Task #55)
router.get("/people/performance/reviews", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const employeeId =
      typeof req.query.employeeId === "string" ? req.query.employeeId : null;
    const where = [
      eq(atelierPerformanceReviews.orgId, me.orgId),
      isNull(atelierPerformanceReviews.deletedAt),
    ];
    if (employeeId) where.push(eq(atelierPerformanceReviews.employeeId, employeeId));
    const rows = await db
      .select()
      .from(atelierPerformanceReviews)
      .where(and(...where))
      .orderBy(desc(atelierPerformanceReviews.createdAt));
    const names = await employeeNameMap(me.orgId, rows.map((r) => r.employeeId));
    res.json(
      AtelierListPerformanceReviewsResponse.parse(
        rows.map((r) => reviewToWire(r, names.get(r.employeeId) ?? "Unknown")),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; no CLI shape (Task #55)
router.post("/people/performance/reviews", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const parsed = AtelierCreatePerformanceReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    const [emp] = await db
      .select()
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.id, b.employeeId),
          eq(atelierEmployees.orgId, me.orgId),
          isNull(atelierEmployees.deletedAt),
        ),
      );
    if (!emp) {
      res.status(404).json({ error: "employee-not-found" });
      return;
    }
    const id = rid("perfrev");
    const [row] = await db
      .insert(atelierPerformanceReviews)
      .values({
        id,
        orgId: me.orgId,
        employeeId: emp.id,
        cycle: b.cycle,
        reviewedOn: b.reviewedOn ?? null,
        selfRating: b.selfRating ?? null,
        managerRating: b.managerRating ?? null,
        strengths: b.strengths ?? "",
        growthAreas: b.growthAreas ?? "",
        managerSummary: b.managerSummary ?? "",
        hrNotes: b.hrNotes ?? "",
        status: "draft",
        createdByUserId: me.id,
      })
      .returning();
    await audit({
      me,
      entityType: "performance_review",
      entityId: id,
      action: "review_created",
      summary: `${me.name} created a draft ${b.cycle} review for ${emp.fullName}`,
    });
    res
      .status(201)
      .json(AtelierUpdatePerformanceReviewResponse.parse(reviewToWire(row, emp.fullName)));
  } catch (err) {
    next(err);
  }
});

async function loadReview(
  me: typeof atelierUsers.$inferSelect,
  id: string,
): Promise<typeof atelierPerformanceReviews.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(atelierPerformanceReviews)
    .where(
      and(
        eq(atelierPerformanceReviews.id, id),
        eq(atelierPerformanceReviews.orgId, me.orgId),
        isNull(atelierPerformanceReviews.deletedAt),
      ),
    );
  return row ?? null;
}

// @cli-skip: HR admin write; no CLI shape (Task #55)
router.patch("/people/performance/reviews/:id", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const parsed = AtelierUpdatePerformanceReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const existing = await loadReview(me, req.params.id);
    if (!existing) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const b = parsed.data;
    const [row] = await db
      .update(atelierPerformanceReviews)
      .set({
        ...(b.cycle !== undefined ? { cycle: b.cycle } : {}),
        ...(b.reviewedOn !== undefined ? { reviewedOn: b.reviewedOn } : {}),
        ...(b.selfRating !== undefined ? { selfRating: b.selfRating } : {}),
        ...(b.managerRating !== undefined ? { managerRating: b.managerRating } : {}),
        ...(b.strengths !== undefined ? { strengths: b.strengths } : {}),
        ...(b.growthAreas !== undefined ? { growthAreas: b.growthAreas } : {}),
        ...(b.managerSummary !== undefined ? { managerSummary: b.managerSummary } : {}),
        ...(b.hrNotes !== undefined ? { hrNotes: b.hrNotes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(atelierPerformanceReviews.id, existing.id))
      .returning();
    const names = await employeeNameMap(me.orgId, [row.employeeId]);
    await audit({
      me,
      entityType: "performance_review",
      entityId: row.id,
      action: "review_updated",
      summary: `${me.name} edited the ${row.cycle} review`,
      payload: { changed: Object.keys(b) },
    });
    res.json(
      AtelierUpdatePerformanceReviewResponse.parse(
        reviewToWire(row, names.get(row.employeeId) ?? "Unknown"),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; no CLI shape (Task #55)
router.post("/people/performance/reviews/:id/release", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const parsed = AtelierReleasePerformanceReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const existing = await loadReview(me, req.params.id);
    if (!existing) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const released = parsed.data.released;
    const [row] = await db
      .update(atelierPerformanceReviews)
      .set({
        status: released ? "released" : "draft",
        releasedAt: released ? new Date() : null,
        releasedByUserId: released ? me.id : null,
        updatedAt: new Date(),
      })
      .where(eq(atelierPerformanceReviews.id, existing.id))
      .returning();
    const [emp] = await db
      .select()
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, row.employeeId));
    await audit({
      me,
      entityType: "performance_review",
      entityId: row.id,
      action: released ? "review_released" : "review_unreleased",
      summary: `${me.name} ${released ? "released" : "pulled back"} the ${row.cycle} review for ${emp?.fullName ?? row.employeeId}`,
    });
    // Tell the employee their review is available on their Me home.
    if (released && emp?.userId) {
      await emitSelfNotification({
        orgId: me.orgId,
        userId: emp.userId,
        kind: "review_released",
        title: `Your ${row.cycle} performance review is available`,
        body: "Open the Performance section of your workspace to read it.",
        href: "/me/performance",
      });
    }
    res.json(
      AtelierReleasePerformanceReviewResponse.parse(
        reviewToWire(row, emp?.fullName ?? "Unknown"),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// =============================================================
// Goals
// =============================================================

function goalToWire(
  g: typeof atelierPerformanceGoals.$inferSelect,
  employeeName: string,
) {
  return {
    id: g.id,
    employeeId: g.employeeId,
    employeeName,
    cycle: g.cycle,
    title: g.title,
    description: g.description,
    weightPct: g.weightPct,
    status: g.status as "on_track" | "at_risk" | "complete",
  };
}

// @cli-skip: HR admin read; no CLI shape (Task #55)
router.get("/people/performance/goals", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const employeeId =
      typeof req.query.employeeId === "string" ? req.query.employeeId : null;
    const where = [
      eq(atelierPerformanceGoals.orgId, me.orgId),
      isNull(atelierPerformanceGoals.deletedAt),
    ];
    if (employeeId) where.push(eq(atelierPerformanceGoals.employeeId, employeeId));
    const rows = await db
      .select()
      .from(atelierPerformanceGoals)
      .where(and(...where))
      .orderBy(desc(atelierPerformanceGoals.createdAt));
    const names = await employeeNameMap(me.orgId, rows.map((r) => r.employeeId));
    res.json(
      AtelierListPerformanceGoalsResponse.parse(
        rows.map((g) => goalToWire(g, names.get(g.employeeId) ?? "Unknown")),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; no CLI shape (Task #55)
router.post("/people/performance/goals", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const parsed = AtelierCreatePerformanceGoalBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    const [emp] = await db
      .select()
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.id, b.employeeId),
          eq(atelierEmployees.orgId, me.orgId),
          isNull(atelierEmployees.deletedAt),
        ),
      );
    if (!emp) {
      res.status(404).json({ error: "employee-not-found" });
      return;
    }
    const [row] = await db
      .insert(atelierPerformanceGoals)
      .values({
        id: rid("perfgoal"),
        orgId: me.orgId,
        employeeId: emp.id,
        cycle: b.cycle,
        title: b.title,
        description: b.description ?? "",
        weightPct: b.weightPct ?? 0,
        status: b.status ?? "on_track",
        createdByUserId: me.id,
      })
      .returning();
    await audit({
      me,
      entityType: "performance_goal",
      entityId: row.id,
      action: "goal_created",
      summary: `${me.name} added a ${b.cycle} goal for ${emp.fullName}`,
    });
    res
      .status(201)
      .json(AtelierUpdatePerformanceGoalResponse.parse(goalToWire(row, emp.fullName)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; no CLI shape (Task #55)
router.patch("/people/performance/goals/:id", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const parsed = AtelierUpdatePerformanceGoalBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    const [row] = await db
      .update(atelierPerformanceGoals)
      .set({
        ...(b.cycle !== undefined ? { cycle: b.cycle } : {}),
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.weightPct !== undefined ? { weightPct: b.weightPct } : {}),
        ...(b.status !== undefined ? { status: b.status } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierPerformanceGoals.id, req.params.id),
          eq(atelierPerformanceGoals.orgId, me.orgId),
          isNull(atelierPerformanceGoals.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const names = await employeeNameMap(me.orgId, [row.employeeId]);
    res.json(
      AtelierUpdatePerformanceGoalResponse.parse(
        goalToWire(row, names.get(row.employeeId) ?? "Unknown"),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// =============================================================
// Training-material library
// =============================================================

function materialToWire(
  m: typeof atelierTrainingMaterials.$inferSelect,
  completionCount: number,
) {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    topic: m.topic,
    kind: m.kind as "link" | "file",
    url: m.url,
    fileName: m.fileName,
    mime: m.mime,
    sizeBytes: m.sizeBytes,
    audience: m.audience as "all" | "employees" | "contractors",
    completionCount,
    createdAt: m.createdAt ? m.createdAt.toISOString() : null,
  };
}

async function completionCounts(
  orgId: string,
  materialIds: string[],
): Promise<Map<string, number>> {
  if (materialIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(atelierTrainingCompletions)
    .where(
      and(
        eq(atelierTrainingCompletions.orgId, orgId),
        inArray(atelierTrainingCompletions.materialId, materialIds),
      ),
    );
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.materialId, (map.get(r.materialId) ?? 0) + 1);
  return map;
}

// @cli-skip: HR admin read; no CLI shape (Task #55)
router.get("/people/training-materials", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierTrainingMaterials)
      .where(
        and(
          eq(atelierTrainingMaterials.orgId, me.orgId),
          isNull(atelierTrainingMaterials.deletedAt),
        ),
      )
      .orderBy(desc(atelierTrainingMaterials.createdAt));
    const counts = await completionCounts(me.orgId, rows.map((r) => r.id));
    res.json(
      AtelierListTrainingMaterialsResponse.parse(
        rows.map((m) => materialToWire(m, counts.get(m.id) ?? 0)),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; no CLI shape (Task #55)
router.post("/people/training-materials", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const parsed = AtelierCreateTrainingMaterialBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    if (!b.url) {
      res.status(400).json({ error: "url-required", message: "Link materials need a URL." });
      return;
    }
    const [row] = await db
      .insert(atelierTrainingMaterials)
      .values({
        id: rid("trainmat"),
        orgId: me.orgId,
        title: b.title,
        description: b.description ?? "",
        topic: b.topic ?? "",
        kind: "link",
        url: b.url,
        audience: b.audience ?? "all",
        createdByUserId: me.id,
      })
      .returning();
    await audit({
      me,
      entityType: "training_material",
      entityId: row.id,
      action: "material_added",
      summary: `${me.name} added training link "${row.title}"`,
    });
    res
      .status(201)
      .json(AtelierUpdateTrainingMaterialResponse.parse(materialToWire(row, 0)));
  } catch (err) {
    next(err);
  }
});

// File uploads — multipart, raw-fetch from the UI (not an OpenAPI JSON
// surface; the codegen client has no multipart story here).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

// @cli-skip: HR multipart upload; not an OpenAPI JSON surface (Task #55)
router.post(
  "/people/training-materials/upload",
  (req, res, next) => {
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
  },
  async (req, res, next) => {
    try {
      const me = ensureHr(req, res);
      if (!me) return;
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ error: "no-file" });
        return;
      }
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      if (!title) {
        res.status(400).json({ error: "title-required" });
        return;
      }
      const description =
        typeof req.body?.description === "string" ? req.body.description : "";
      const topic = typeof req.body?.topic === "string" ? req.body.topic : "";
      const audienceRaw =
        typeof req.body?.audience === "string" ? req.body.audience : "all";
      const audience = ["all", "employees", "contractors"].includes(audienceRaw)
        ? audienceRaw
        : "all";
      const objectKey = await storeTrainingFileBytes(
        file.buffer,
        file.mimetype || "application/octet-stream",
      );
      const [row] = await db
        .insert(atelierTrainingMaterials)
        .values({
          id: rid("trainmat"),
          orgId: me.orgId,
          title,
          description,
          topic,
          kind: "file",
          objectKey,
          fileName: file.originalname || "material",
          mime: file.mimetype || "application/octet-stream",
          sizeBytes: file.size,
          audience,
          createdByUserId: me.id,
        })
        .returning();
      await audit({
        me,
        entityType: "training_material",
        entityId: row.id,
        action: "material_added",
        summary: `${me.name} uploaded training file "${row.title}"`,
      });
      res.status(201).json(materialToWire(row, 0));
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: HR admin write; no CLI shape (Task #55)
router.patch("/people/training-materials/:id", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const parsed = AtelierUpdateTrainingMaterialBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    const [row] = await db
      .update(atelierTrainingMaterials)
      .set({
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.description !== undefined ? { description: b.description } : {}),
        ...(b.topic !== undefined ? { topic: b.topic } : {}),
        ...(b.url !== undefined ? { url: b.url } : {}),
        ...(b.audience !== undefined ? { audience: b.audience } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierTrainingMaterials.id, req.params.id),
          eq(atelierTrainingMaterials.orgId, me.orgId),
          isNull(atelierTrainingMaterials.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const counts = await completionCounts(me.orgId, [row.id]);
    res.json(
      AtelierUpdateTrainingMaterialResponse.parse(
        materialToWire(row, counts.get(row.id) ?? 0),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin write; no CLI shape (Task #55)
router.delete("/people/training-materials/:id", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const [row] = await db
      .update(atelierTrainingMaterials)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(atelierTrainingMaterials.id, req.params.id),
          eq(atelierTrainingMaterials.orgId, me.orgId),
          isNull(atelierTrainingMaterials.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    await audit({
      me,
      entityType: "training_material",
      entityId: row.id,
      action: "material_archived",
      summary: `${me.name} archived training material "${row.title}"`,
    });
    const counts = await completionCounts(me.orgId, [row.id]);
    res.json(
      AtelierArchiveTrainingMaterialResponse.parse(
        materialToWire(row, counts.get(row.id) ?? 0),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR admin read; no CLI shape (Task #55)
router.get("/people/training-materials/:id/completions", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const [m] = await db
      .select()
      .from(atelierTrainingMaterials)
      .where(
        and(
          eq(atelierTrainingMaterials.id, req.params.id),
          eq(atelierTrainingMaterials.orgId, me.orgId),
          isNull(atelierTrainingMaterials.deletedAt),
        ),
      );
    if (!m) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    // The audience = login-holding people the material targets. Employees
    // link user<->roster via user_id; contractors via lower-cased email.
    const includeEmployees = m.audience === "all" || m.audience === "employees";
    const includeContractors = m.audience === "all" || m.audience === "contractors";
    const users = await db
      .select()
      .from(atelierUsers)
      .where(eq(atelierUsers.orgId, me.orgId));
    const emps = includeEmployees
      ? await db
          .select()
          .from(atelierEmployees)
          .where(
            and(eq(atelierEmployees.orgId, me.orgId), isNull(atelierEmployees.deletedAt)),
          )
      : [];
    const cts = includeContractors
      ? await db
          .select()
          .from(atelierContractors)
          .where(
            and(
              eq(atelierContractors.orgId, me.orgId),
              isNull(atelierContractors.deletedAt),
            ),
          )
      : [];
    const byEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u]));
    const byId = new Map(users.map((u) => [u.id, u]));
    const people: Array<{ userId: string; name: string; workerType: "employee" | "contractor" }> = [];
    const seen = new Set<string>();
    for (const e of emps) {
      const u = e.userId ? byId.get(e.userId) : byEmail.get(e.email.trim().toLowerCase());
      if (u && !seen.has(u.id)) {
        seen.add(u.id);
        people.push({ userId: u.id, name: e.fullName, workerType: "employee" });
      }
    }
    for (const c of cts) {
      const u = byEmail.get(c.email.trim().toLowerCase());
      if (u && !seen.has(u.id)) {
        seen.add(u.id);
        people.push({ userId: u.id, name: c.fullName, workerType: "contractor" });
      }
    }
    const done = await db
      .select()
      .from(atelierTrainingCompletions)
      .where(
        and(
          eq(atelierTrainingCompletions.orgId, me.orgId),
          eq(atelierTrainingCompletions.materialId, m.id),
        ),
      );
    const doneByUser = new Map(done.map((d) => [d.userId, d.completedAt]));
    res.json(
      AtelierListTrainingCompletionsResponse.parse(
        people.map((p) => ({
          userId: p.userId,
          name: p.name,
          workerType: p.workerType,
          completed: doneByUser.has(p.userId),
          completedAt: doneByUser.get(p.userId)?.toISOString() ?? null,
        })),
      ),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
