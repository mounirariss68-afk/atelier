/**
 * Atelier — Task #50: Me lens self-scope routes.
 *
 * Every endpoint here answers ONLY for the caller's own identity — no ids
 * from the URL/body are accepted for reads, so there is nothing to IDOR.
 * These are the routes the self-only personas (role=employee, contractor)
 * are allowlisted for in the non-employee boundary middleware (index.ts),
 * but every persona may use them — the Me lens is visible to all.
 *
 *   GET  /me/profile                      → persona + own roster record
 *   GET  /me/notifications                → own non-dismissed cards
 *   POST /me/notifications/:id/dismiss    → dismiss one of your own cards
 *
 * `emitSelfNotification` is the write helper other surfaces call to put a
 * card on someone's Me home ("timesheet due Friday", "expense approved").
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierSelfNotifications,
  atelierPerformanceReviews,
  atelierPerformanceGoals,
  atelierTrainingMaterials,
  atelierTrainingCompletions,
} from "@workspace/db";
import {
  AtelierGetMyProfileResponse,
  AtelierListMyNotificationsResponse,
  AtelierDismissMyNotificationResponse,
  AtelierListMyReviewsResponse,
  AtelierListMyGoalsResponse,
  AtelierListMyLearningResponse,
  AtelierCompleteMyTrainingResponse,
} from "@workspace/api-zod";
import { loadTrainingFileBytes } from "./performanceRoutes";
import { personaToWire } from "./personaCookie";

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

export interface SelfPersonWire {
  id: string;
  workerType: "employee" | "contractor";
  fullName: string;
  email: string;
  title: string | null;
  startDate: string | null;
  employmentType: string | null;
  homeOffice: string | null;
  country: string | null;
  status: string | null;
}

/**
 * Resolve the caller's own roster/person record.
 *
 * Employees link via atelier_employees.user_id (backfilled at boot for the
 * founders; set at creation time by the HR add-joiner flow). Contractors
 * have no user_id column — they link by lower-cased email, the same rule
 * `resolveLinkedUserId` in rosterRoutes.ts uses in the other direction.
 * Org-scoped: only rows in the caller's own org are considered.
 */
export async function resolveSelfPerson(
  me: typeof atelierUsers.$inferSelect,
): Promise<SelfPersonWire | null> {
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
  if (emp) {
    return {
      id: emp.id,
      workerType: "employee",
      fullName: emp.fullName,
      email: emp.email,
      title: emp.title ?? null,
      startDate: emp.startDate ?? null,
      employmentType: emp.employmentType ?? null,
      homeOffice: emp.homeOffice ?? null,
      country: emp.country ?? null,
      status: emp.status ?? null,
    };
  }
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
  if (ct) {
    return {
      id: ct.id,
      workerType: "contractor",
      fullName: ct.fullName,
      email: ct.email,
      title: null,
      startDate: ct.contractStart ?? null,
      employmentType: ct.contractType ?? null,
      homeOffice: null,
      country: ct.country ?? null,
      status: ct.status ?? null,
    };
  }
  return null;
}

/**
 * Write helper — puts a card on a user's Me home. Callers pass the OWNING
 * user id explicitly; the card is only ever readable by that user.
 */
export async function emitSelfNotification(
  args: {
    orgId: string;
    userId: string;
    kind: string;
    title: string;
    body?: string;
    href?: string | null;
  },
  // Optional transaction executor so callers can emit atomically with
  // their other writes (e.g. add-joiner onboarding).
  tx: Pick<typeof db, "insert"> = db,
): Promise<string> {
  const id = rid("selfnotif");
  await tx.insert(atelierSelfNotifications).values({
    id,
    orgId: args.orgId,
    userId: args.userId,
    kind: args.kind,
    title: args.title,
    body: args.body ?? "",
    href: args.href ?? null,
  });
  return id;
}

/**
 * Task #53 — resolve the atelier_users id that owns a roster person row so
 * status-change surfaces (timesheet/leave/expense decisions) can drop a
 * card on the right person's Me home. Employees link via employees.userId;
 * contractors link by lower-cased email. Org-scoped. Returns null when the
 * person has no login — callers should just skip the notification.
 */
export async function resolveUserIdForPerson(
  orgId: string,
  personId: string,
): Promise<string | null> {
  const [emp] = await db
    .select({ userId: atelierEmployees.userId })
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, orgId),
        eq(atelierEmployees.id, personId),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp?.userId) return emp.userId;
  const [con] = await db
    .select({ email: atelierContractors.email })
    .from(atelierContractors)
    .where(
      and(
        eq(atelierContractors.orgId, orgId),
        eq(atelierContractors.id, personId),
        isNull(atelierContractors.deletedAt),
      ),
    );
  if (!con?.email) return null;
  const email = con.email.trim().toLowerCase();
  const users = await db
    .select({ id: atelierUsers.id, email: atelierUsers.email })
    .from(atelierUsers)
    .where(eq(atelierUsers.orgId, orgId));
  const hit = users.find((u) => u.email.trim().toLowerCase() === email);
  return hit?.id ?? null;
}

function notifToWire(n: typeof atelierSelfNotifications.$inferSelect) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    status: n.status as "unread" | "dismissed",
    createdAt: n.createdAt.toISOString(),
  };
}

// @cli-skip: self-scope identity read; no CLI shape (Task #50)
router.get("/me/profile", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await resolveSelfPerson(me);
    res.json(
      AtelierGetMyProfileResponse.parse({
        user: personaToWire(me),
        person,
      }),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope notification read; no CLI shape (Task #50)
router.get("/me/notifications", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierSelfNotifications)
      .where(
        and(
          eq(atelierSelfNotifications.orgId, me.orgId),
          eq(atelierSelfNotifications.userId, me.id),
          eq(atelierSelfNotifications.status, "unread"),
          isNull(atelierSelfNotifications.deletedAt),
        ),
      )
      .orderBy(desc(atelierSelfNotifications.createdAt));
    res.json(AtelierListMyNotificationsResponse.parse(rows.map(notifToWire)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope notification dismiss; no CLI shape (Task #50)
router.post("/me/notifications/:id/dismiss", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Ownership is part of the WHERE — a foreign id 404s, never leaks.
    const [row] = await db
      .update(atelierSelfNotifications)
      .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(atelierSelfNotifications.id, req.params.id),
          eq(atelierSelfNotifications.orgId, me.orgId),
          eq(atelierSelfNotifications.userId, me.id),
          isNull(atelierSelfNotifications.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json(AtelierDismissMyNotificationResponse.parse(notifToWire(row)));
  } catch (err) {
    next(err);
  }
});

// =============================================================
// Task #55 — My Performance (employees only) + My Learning
// =============================================================

/**
 * Resolve the caller for the performance section. Contractors are 403'd
 * (the section does not exist for them); everyone else resolves to their
 * own employee record — personas with no roster record get an empty list.
 */
async function resolvePerformanceSubject(
  me: typeof atelierUsers.$inferSelect,
  res: Response,
): Promise<{ employeeId: string | null } | null> {
  const person = await resolveSelfPerson(me);
  if (person?.workerType === "contractor" || me.role === "contractor") {
    res.status(403).json({
      error: "contractor-no-performance",
      message: "Performance reviews are an employee-only section.",
    });
    return null;
  }
  return { employeeId: person?.workerType === "employee" ? person.id : null };
}

// @cli-skip: self-scope performance read; no CLI shape (Task #55)
router.get("/me/reviews", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const subject = await resolvePerformanceSubject(me, res);
    if (!subject) return;
    if (!subject.employeeId) {
      res.json(AtelierListMyReviewsResponse.parse([]));
      return;
    }
    // Strictly self-scoped + released-only. hrNotes NEVER leaves the org side.
    const rows = await db
      .select()
      .from(atelierPerformanceReviews)
      .where(
        and(
          eq(atelierPerformanceReviews.orgId, me.orgId),
          eq(atelierPerformanceReviews.employeeId, subject.employeeId),
          eq(atelierPerformanceReviews.status, "released"),
          isNull(atelierPerformanceReviews.deletedAt),
        ),
      )
      .orderBy(desc(atelierPerformanceReviews.createdAt));
    res.json(
      AtelierListMyReviewsResponse.parse(
        rows.map((r) => ({
          id: r.id,
          cycle: r.cycle,
          reviewedOn: r.reviewedOn,
          selfRating: r.selfRating,
          managerRating: r.managerRating,
          strengths: r.strengths,
          growthAreas: r.growthAreas,
          managerSummary: r.managerSummary,
          status: "released" as const,
          releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
        })),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope goals read; no CLI shape (Task #55)
router.get("/me/goals", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const subject = await resolvePerformanceSubject(me, res);
    if (!subject) return;
    if (!subject.employeeId) {
      res.json(AtelierListMyGoalsResponse.parse([]));
      return;
    }
    const rows = await db
      .select()
      .from(atelierPerformanceGoals)
      .where(
        and(
          eq(atelierPerformanceGoals.orgId, me.orgId),
          eq(atelierPerformanceGoals.employeeId, subject.employeeId),
          isNull(atelierPerformanceGoals.deletedAt),
        ),
      )
      .orderBy(desc(atelierPerformanceGoals.createdAt));
    res.json(
      AtelierListMyGoalsResponse.parse(
        rows.map((g) => ({
          id: g.id,
          cycle: g.cycle,
          title: g.title,
          description: g.description,
          weightPct: g.weightPct,
          status: g.status as "on_track" | "at_risk" | "complete",
        })),
      ),
    );
  } catch (err) {
    next(err);
  }
});

/** Audience filter — which worker types a material is visible to. */
async function callerAudience(
  me: typeof atelierUsers.$inferSelect,
): Promise<"employee" | "contractor"> {
  if (me.role === "contractor") return "contractor";
  const person = await resolveSelfPerson(me);
  return person?.workerType === "contractor" ? "contractor" : "employee";
}

function audienceValuesFor(workerType: "employee" | "contractor"): string[] {
  return workerType === "contractor" ? ["all", "contractors"] : ["all", "employees"];
}

function selfMaterialToWire(
  m: typeof atelierTrainingMaterials.$inferSelect,
  completedAt: Date | null,
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
    completed: !!completedAt,
    completedAt: completedAt ? completedAt.toISOString() : null,
  };
}

/** Load one material IF it is targeted at the caller; null otherwise. */
async function loadMyMaterial(
  me: typeof atelierUsers.$inferSelect,
  id: string,
): Promise<typeof atelierTrainingMaterials.$inferSelect | null> {
  const aud = audienceValuesFor(await callerAudience(me));
  const [m] = await db
    .select()
    .from(atelierTrainingMaterials)
    .where(
      and(
        eq(atelierTrainingMaterials.id, id),
        eq(atelierTrainingMaterials.orgId, me.orgId),
        inArray(atelierTrainingMaterials.audience, aud),
        isNull(atelierTrainingMaterials.deletedAt),
      ),
    );
  return m ?? null;
}

// @cli-skip: self-scope learning read; no CLI shape (Task #55)
router.get("/me/learning", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const aud = audienceValuesFor(await callerAudience(me));
    const rows = await db
      .select()
      .from(atelierTrainingMaterials)
      .where(
        and(
          eq(atelierTrainingMaterials.orgId, me.orgId),
          inArray(atelierTrainingMaterials.audience, aud),
          isNull(atelierTrainingMaterials.deletedAt),
        ),
      )
      .orderBy(desc(atelierTrainingMaterials.createdAt));
    const done = rows.length
      ? await db
          .select()
          .from(atelierTrainingCompletions)
          .where(
            and(
              eq(atelierTrainingCompletions.orgId, me.orgId),
              eq(atelierTrainingCompletions.userId, me.id),
              inArray(
                atelierTrainingCompletions.materialId,
                rows.map((r) => r.id),
              ),
            ),
          )
      : [];
    const doneByMaterial = new Map(done.map((d) => [d.materialId, d.completedAt]));
    res.json(
      AtelierListMyLearningResponse.parse(
        rows.map((m) => selfMaterialToWire(m, doneByMaterial.get(m.id) ?? null)),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope completion write; no CLI shape (Task #55)
router.post("/me/learning/:id/complete", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const m = await loadMyMaterial(me, req.params.id);
    if (!m) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    // Idempotent — the unique (materialId, userId) index makes re-marks no-ops.
    await db
      .insert(atelierTrainingCompletions)
      .values({ id: rid("traindone"), orgId: me.orgId, materialId: m.id, userId: me.id })
      .onConflictDoNothing();
    const [row] = await db
      .select()
      .from(atelierTrainingCompletions)
      .where(
        and(
          eq(atelierTrainingCompletions.materialId, m.id),
          eq(atelierTrainingCompletions.userId, me.id),
        ),
      );
    res.json(
      AtelierCompleteMyTrainingResponse.parse(
        selfMaterialToWire(m, row?.completedAt ?? new Date()),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope binary download; not an OpenAPI JSON surface (Task #55)
router.get("/me/learning/:id/download", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const m = await loadMyMaterial(me, req.params.id);
    if (!m || m.kind !== "file" || !m.objectKey) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const bytes = await loadTrainingFileBytes(m.objectKey);
    if (!bytes) {
      res.status(404).json({ error: "file-missing" });
      return;
    }
    res.setHeader("Content-Type", m.mime || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(m.fileName || "material").replace(/"/g, "")}"`,
    );
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

export default router;
