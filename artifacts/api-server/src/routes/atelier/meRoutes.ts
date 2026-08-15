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
import { contentDispositionFilename } from "../../lib/httpFilename.js";
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
  atelierTimesheetWeeks,
  atelierAgentRuns,
} from "@workspace/db";
import { listJobsForUser } from "../../lib/background-jobs.js";
import { agentRunIsFresh } from "../../lib/atelier-agents/run-staleness.js";
import { listAgentLaunchesForUser } from "../../lib/atelier-agents/launch-visibility.js";
import { mirrorSelfNotificationPush } from "../../lib/expoPush.js";
import {
  AtelierGetMyProfileResponse,
  AtelierListMyNotificationsResponse,
  AtelierDismissMyNotificationResponse,
  AtelierListMyReviewsResponse,
  AtelierListMyGoalsResponse,
  AtelierCompleteMyTrainingResponse,
  AtelierGetMyPerformanceResponse,
  AtelierListMyLearningResponse,
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
  // Task #51 — self-service profile fields.
  preferredName: string | null;
  personalEmail: string | null;
  cellPhones: { country: string; number: string }[];
  homeAddress: string | null;
  officeAddress: string | null;
  bio: string | null;
  nationality: string | null;
  gender: string;
  avatarUrl: string | null;
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
      // Task #51 — self-service profile fields.
      preferredName: emp.preferredName ?? null,
      personalEmail: emp.personalEmail ?? null,
      cellPhones: (emp.cellPhones ?? []) as { country: string; number: string }[],
      homeAddress: emp.homeAddress ?? null,
      officeAddress: emp.officeAddress ?? null,
      bio: emp.bio ?? null,
      nationality: emp.nationality ?? null,
      gender: emp.gender ?? "unspecified",
      avatarUrl: emp.avatarUrl ?? null,
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
      // Task #51 — self-service profile fields.
      preferredName: null,
      personalEmail: ct.personalEmail ?? null,
      cellPhones: (ct.cellPhones ?? []) as { country: string; number: string }[],
      homeAddress: ct.homeAddress ?? null,
      officeAddress: ct.officeAddress ?? null,
      bio: ct.bio ?? null,
      nationality: ct.nationality ?? null,
      gender: ct.gender ?? "unspecified",
      avatarUrl: ct.avatarUrl ?? null,
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
  // Task #1017 — insert is conflict-guarded + returning() so the device
  // push below fires ONLY for a newly inserted card (same idempotency key
  // as the in-app bell: the notification id).
  const inserted = await tx
    .insert(atelierSelfNotifications)
    .values({
      id,
      orgId: args.orgId,
      userId: args.userId,
      kind: args.kind,
      title: args.title,
      body: args.body ?? "",
      href: args.href ?? null,
    })
    .onConflictDoNothing({ target: atelierSelfNotifications.id })
    .returning({ id: atelierSelfNotifications.id });
  // Mirror to registered devices (Task #1017). Fire-and-forget so the
  // caller's request never waits on the Expo API; mirror honors the
  // owner's per-category opt-out and never throws. Skipped when the
  // caller supplied a transaction executor — the tx may still roll back,
  // and a push for an uncommitted card would be a lie (current tx callers
  // are onboarding "welcome" cards, where a device push is pointless: the
  // joiner has no registered device yet).
  if (tx === db && inserted.length) {
    void mirrorSelfNotificationPush({
      id,
      userId: args.userId,
      kind: args.kind,
      title: args.title,
      body: args.body ?? "",
      href: args.href ?? null,
    });
  }
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

// @cli-skip: covered by CLI capability me.profile (Task #405)
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

// @cli-skip: covered by CLI capability me.notifications (Task #405)
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

// Task #1020 — global background-work indicator. Self-scoped: only jobs
// the caller started. Returns durable background jobs (running + recently
// finished) PLUS any still-running durable agent runs the caller triggered
// that aren't already represented by a running job on the same target
// (strategy developer, procurement navigator, account mappers, …), so all
// long-running agent work surfaces in one place.
// @cli-skip: transient job-status poll for the shell indicator; no CLI shape (Task #1020)
router.get("/me/background-jobs", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const jobs = await listJobsForUser(me.id);
    const runningTargets = new Set(
      jobs.filter((j) => j.status === "running").map((j) => j.targetId),
    );
    const runs = await db
      .select({
        id: atelierAgentRuns.id,
        agentId: atelierAgentRuns.agentId,
        targetId: atelierAgentRuns.targetId,
        targetLabel: atelierAgentRuns.targetLabel,
        statusMessage: atelierAgentRuns.statusMessage,
        createdAt: atelierAgentRuns.createdAt,
      })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.triggeredByUserId, me.id),
          eq(atelierAgentRuns.status, "running"),
          // Task #1046 — a "running" row whose heartbeat stopped hours ago
          // is a dead run (crashed process); never show it as working.
          agentRunIsFresh(),
          isNull(atelierAgentRuns.deletedAt),
        ),
      )
      .orderBy(desc(atelierAgentRuns.createdAt))
      .limit(10);
    const extra = runs
      .filter((r) => !r.targetId || !runningTargets.has(r.targetId))
      .map((r) => ({
        id: `run_${r.id}`,
        kind: r.agentId,
        label: r.targetLabel || r.statusMessage || "Agent run",
        status: "running" as const,
        error: null,
        resultHref: `/agents/monitor/runs/${r.id}`,
        startedAt: r.createdAt.toISOString(),
        finishedAt: null,
      }));
    // Task #1193 — in-flight launches (Cartographer / Executive Mapper) whose
    // durable run row does not exist yet. Deduped against DB run rows on the
    // same (agent, target) and running jobs on the same target so nothing
    // shows twice once the row lands.
    const shownRunKeys = new Set(runs.map((r) => `${r.agentId}:${r.targetId}`));
    const launches = listAgentLaunchesForUser(me.id)
      .filter(
        (l) =>
          !shownRunKeys.has(`${l.agentId}:${l.targetId}`) &&
          !runningTargets.has(l.targetId),
      )
      .map((l) => ({
        id: `launch_${l.agentId}_${l.targetId}`,
        kind: l.agentId,
        label:
          l.targetLabel ||
          (l.agentId === "executive_mapper"
            ? "Executive Mapper"
            : l.agentId === "account_cartographer"
              ? "Account research"
              : "Agent run"),
        status: "running" as const,
        error: null,
        resultHref: "/agents/monitor",
        startedAt: new Date(l.startedAt).toISOString(),
        finishedAt: null,
      }));
    res.json({
      jobs: [
        ...jobs.map((j) => ({
          id: j.id,
          kind: j.kind,
          label: j.label,
          status: j.status,
          error: j.error,
          resultHref: j.resultHref,
          startedAt: j.createdAt.toISOString(),
          finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
        })),
        ...extra,
        ...launches,
      ],
    });
  } catch (err) {
    next(err);
  }
});

// Task #55 — My Performance (employees only) + My Learning

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

// @cli-skip: covered by CLI capability me.reviews (Task #405)
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

// @cli-skip: covered by CLI capability me.goals (Task #405)
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

// ---------------------------------------------------------------------------
// Task #58 — /me/performance below answers ONLY for the caller's own rows via
// resolveSelfPerson; no ids from the URL/query/body are accepted.
// (The read-only /me/time, /me/expenses and compensation /me/pay endpoints
// from Task #58 were superseded by the richer self-service surfaces in
// meSelfServiceRoutes.ts and payRoutes.ts.)
// ---------------------------------------------------------------------------

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

// @cli-skip: self-scope performance stats read; no CLI shape (Task #58)
router.get("/me/performance", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await resolveSelfPerson(me);
    let seniority: string | null = null;
    let utilizationTargetPct: number | null = null;
    if (person?.workerType === "employee") {
      const [emp] = await db
        .select()
        .from(atelierEmployees)
        .where(
          and(
            eq(atelierEmployees.orgId, me.orgId),
            eq(atelierEmployees.id, person.id),
            isNull(atelierEmployees.deletedAt),
          ),
        );
      seniority = emp?.seniority ?? null;
      utilizationTargetPct = emp?.utilizationTargetPct ?? null;
    }
    // Utilization actuals over the caller's 12 most recent tracked weeks.
    let totalHours12w = 0;
    let billableHours12w = 0;
    let weeksTracked = 0;
    if (person) {
      const weeks = await db
        .select()
        .from(atelierTimesheetWeeks)
        .where(
          and(
            eq(atelierTimesheetWeeks.orgId, me.orgId),
            eq(atelierTimesheetWeeks.personId, person.id),
            isNull(atelierTimesheetWeeks.deletedAt),
          ),
        )
        .orderBy(desc(atelierTimesheetWeeks.weekIso))
        .limit(12);
      weeksTracked = weeks.length;
      for (const w of weeks) {
        totalHours12w += w.totalHours;
        billableHours12w += w.billableHours;
      }
    }
    const utilizationPct =
      totalHours12w > 0
        ? Math.round((billableHours12w / totalHours12w) * 100)
        : null;
    res.json(
      AtelierGetMyPerformanceResponse.parse({
        seniority,
        utilizationTargetPct,
        totalHours12w,
        billableHours12w,
        utilizationPct,
        weeksTracked,
      }),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: covered by CLI capability me.learning (Task #405)
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
      contentDispositionFilename("attachment", m.fileName || "material"),
    );
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

export default router;
