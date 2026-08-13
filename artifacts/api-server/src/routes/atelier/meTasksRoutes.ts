/**
 * Task #1002 — Personal tasks & reminders (Me lens, self-scope).
 *
 * Lightweight to-dos / timed reminders owned by exactly one user.
 * Every read/write predicates on org + userId (ownership lives in the
 * WHERE — a foreign id 404s, never leaks). Due/overdue reminders are
 * surfaced by the personal-task reminder tick (ledgerNudges.ts) as
 * self-notification cards; completing / rescheduling / deleting a task
 * clears its reminder cards so nags never outlive the item.
 *
 * The CRUD helpers are exported so the chat capabilities
 * (me-task-capabilities.ts) share the exact same validation + guards.
 */
import { Router } from "express";
import { and, desc, eq, inArray, isNull, like, ne, or, type SQL } from "drizzle-orm";
import {
  db,
  atelierPersonalTasks,
  atelierSelfNotifications,
  atelierEmployees,
  atelierUsers,
} from "@workspace/db";
import {
  AtelierListMyTasksResponse,
  AtelierCreateMyTaskBody,
  AtelierUpdateMyTaskBody,
  AtelierUpdateMyTaskResponse,
  AtelierDeleteMyTaskResponse,
  AtelierAssignTaskBody,
  AtelierListAssignedTasksResponse,
} from "@workspace/api-zod";
import { canViewPersonViaRosterScope } from "./rosterRoutes.js";
import { mirrorSelfNotificationPush } from "../../lib/expoPush.js";

const router: Router = Router();
export default router;

type UserRow = typeof atelierUsers.$inferSelect;
type TaskRow = typeof atelierPersonalTasks.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function ensurePersona(req: any, res: any): UserRow | null {
  const me = req.atelierPersona as UserRow | undefined;
  if (!me) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return me;
}

export function personalTaskWire(t: TaskRow, assignedByName?: string | null) {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes ?? null,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    status: t.status as "open" | "done",
    overdue: t.status === "open" && !!t.dueAt && t.dueAt.getTime() < Date.now(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    // Task #1011 — delegation metadata (null for self-created tasks).
    assignmentStatus: (t.assignmentStatus as "pending" | "accepted" | "declined" | null) ?? null,
    assignedByName: assignedByName ?? null,
  };
}

/**
 * Task #1011 — a declined handed-over task disappears from the assignee's
 * surfaces (list, roll-up, reminders) but stays visible to the ASSIGNER
 * via /me/tasks/assigned. Shared predicate so every assignee-facing query
 * agrees.
 */
export function notDeclinedAssignment(): SQL {
  return or(
    isNull(atelierPersonalTasks.assignmentStatus),
    ne(atelierPersonalTasks.assignmentStatus, "declined"),
  )!;
}

/** Own tasks, open first (due-soonest), then done (newest). */
export async function listPersonalTasks(orgId: string, userId: string): Promise<TaskRow[]> {
  const rows = await db
    .select()
    .from(atelierPersonalTasks)
    .where(
      and(
        eq(atelierPersonalTasks.orgId, orgId),
        eq(atelierPersonalTasks.userId, userId),
        isNull(atelierPersonalTasks.deletedAt),
        notDeclinedAssignment(),
      ),
    )
    .orderBy(desc(atelierPersonalTasks.createdAt));
  return rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "open") {
      const ad = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bd = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

function parseDueAt(v: unknown): Date | null | { error: string } {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return { error: "dueAt must be an ISO datetime string or null" };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { error: "dueAt is not a valid ISO datetime" };
  return d;
}

export async function createPersonalTask(args: {
  orgId: string;
  userId: string;
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
}): Promise<TaskRow> {
  const id = rid("ptask");
  const [row] = await db
    .insert(atelierPersonalTasks)
    .values({
      id,
      orgId: args.orgId,
      userId: args.userId,
      title: args.title.trim().slice(0, 300),
      notes: args.notes ? args.notes.slice(0, 2000) : null,
      dueAt: args.dueAt ?? null,
      status: "open",
    })
    .returning();
  return row!;
}

/**
 * Clear any reminder cards emitted for a task (deterministic id prefix
 * `selfnotif_ptask_<taskId>_`). Called on complete/reschedule/delete so
 * a stale nag never survives the state change; a rescheduled task gets
 * a fresh card (new deterministic id) when the new time comes due.
 */
export async function dismissTaskReminders(orgId: string, userId: string, taskId: string): Promise<void> {
  await db
    .update(atelierSelfNotifications)
    .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(atelierSelfNotifications.orgId, orgId),
        eq(atelierSelfNotifications.userId, userId),
        eq(atelierSelfNotifications.status, "unread"),
        like(atelierSelfNotifications.id, `selfnotif_ptask_${taskId}_%`),
      ),
    );
}

/** Ownership-in-WHERE fetch: returns null (→404) for foreign/missing ids. */
export async function getOwnPersonalTask(
  orgId: string,
  userId: string,
  taskId: string,
): Promise<TaskRow | null> {
  const [row] = await db
    .select()
    .from(atelierPersonalTasks)
    .where(
      and(
        eq(atelierPersonalTasks.id, taskId),
        eq(atelierPersonalTasks.orgId, orgId),
        eq(atelierPersonalTasks.userId, userId),
        isNull(atelierPersonalTasks.deletedAt),
      ),
    );
  return row ?? null;
}

export async function updatePersonalTask(args: {
  orgId: string;
  userId: string;
  taskId: string;
  patch: {
    title?: string;
    notes?: string | null;
    dueAt?: Date | null;
    dueAtSet?: boolean;
    status?: "open" | "done";
  };
}): Promise<TaskRow | null> {
  const existing = await getOwnPersonalTask(args.orgId, args.userId, args.taskId);
  if (!existing) return null;
  const set: Partial<TaskRow> & { updatedAt: Date } = { updatedAt: new Date() };
  if (args.patch.title !== undefined) set.title = args.patch.title.trim().slice(0, 300);
  if (args.patch.notes !== undefined) set.notes = args.patch.notes ? args.patch.notes.slice(0, 2000) : null;
  if (args.patch.dueAtSet) set.dueAt = args.patch.dueAt ?? null;
  if (args.patch.status !== undefined) {
    set.status = args.patch.status;
    set.completedAt = args.patch.status === "done" ? new Date() : null;
  }
  const [row] = await db
    .update(atelierPersonalTasks)
    .set(set)
    .where(
      and(
        eq(atelierPersonalTasks.id, args.taskId),
        eq(atelierPersonalTasks.orgId, args.orgId),
        eq(atelierPersonalTasks.userId, args.userId),
        isNull(atelierPersonalTasks.deletedAt),
      ),
    )
    .returning();
  if (!row) return null;
  // Completing or moving the due time clears any live reminder card.
  if (args.patch.status === "done" || args.patch.dueAtSet) {
    await dismissTaskReminders(args.orgId, args.userId, args.taskId);
  }
  return row;
}

// @cli-skip: covered by CLI capability me.tasks (Task #1002)
router.get("/me/tasks", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await listPersonalTasks(me.orgId, me.id);
    const names = await assignerNames(me.orgId, rows);
    res.json(
      AtelierListMyTasksResponse.parse({
        tasks: rows.map((t) => personalTaskWire(t, t.assignedById ? names.get(t.assignedById) ?? "a colleague" : null)),
      }),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: chat parity via me.task_create (me-chat-parity.ts)
router.post("/me/tasks", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const parsed = AtelierCreateMyTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", detail: parsed.error.issues[0]?.message });
      return;
    }
    const due = parseDueAt(parsed.data.dueAt);
    if (due && "error" in due) {
      res.status(400).json({ error: "invalid-body", detail: due.error });
      return;
    }
    const row = await createPersonalTask({
      orgId: me.orgId,
      userId: me.id,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      dueAt: due,
    });
    res.status(201).json(AtelierUpdateMyTaskResponse.parse(personalTaskWire(row)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: chat parity via me.task_complete / me.task_reschedule (me-chat-parity.ts)
router.patch("/me/tasks/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const parsed = AtelierUpdateMyTaskBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", detail: parsed.error.issues[0]?.message });
      return;
    }
    const hasDue = Object.prototype.hasOwnProperty.call(req.body ?? {}, "dueAt");
    const due = hasDue ? parseDueAt(parsed.data.dueAt) : null;
    if (due && "error" in due) {
      res.status(400).json({ error: "invalid-body", detail: due.error });
      return;
    }
    const row = await updatePersonalTask({
      orgId: me.orgId,
      userId: me.id,
      taskId: req.params.id,
      patch: {
        title: parsed.data.title,
        notes: Object.prototype.hasOwnProperty.call(req.body ?? {}, "notes")
          ? parsed.data.notes ?? null
          : undefined,
        dueAt: hasDue ? (due as Date | null) : undefined,
        dueAtSet: hasDue,
        status: parsed.data.status,
      },
    });
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json(AtelierUpdateMyTaskResponse.parse(personalTaskWire(row)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: parity-excluded list housekeeping (me-chat-parity.ts)
router.delete("/me/tasks/:id", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const [row] = await db
      .update(atelierPersonalTasks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(atelierPersonalTasks.id, req.params.id),
          eq(atelierPersonalTasks.orgId, me.orgId),
          eq(atelierPersonalTasks.userId, me.id),
          isNull(atelierPersonalTasks.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    await dismissTaskReminders(me.orgId, me.id, row.id);
    res.json(AtelierDeleteMyTaskResponse.parse({ ok: true }));
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Task #1011 — hand a task to a colleague (with accept / decline).
//
// Assignment respects roster visibility: the caller may only delegate to
// a roster person their scope covers (full viewers: fp/hr/finance;
// everyone else: their transitive reports). The task row is owned by the
// ASSIGNEE (userId) so lists / roll-up / reminders work unchanged; the
// assigner keeps a status view via GET /me/tasks/assigned. Declined
// tasks vanish from the assignee's surfaces but stay visible (with
// status) to the assigner.
// =====================================================================

/** Batch-resolve assigner display names for wire building. */
export async function assignerNames(orgId: string, rows: TaskRow[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(rows.map((t) => t.assignedById).filter((v): v is string => !!v)));
  if (ids.length === 0) return new Map();
  const users = await db
    .select({ id: atelierUsers.id, name: atelierUsers.name })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.orgId, orgId), inArray(atelierUsers.id, ids)));
  return new Map(users.map((u) => [u.id, u.name] as const));
}

/**
 * Resolve a roster person id → their portal login (atelier_users.id).
 * Employees link via employees.user_id; contractors and other roster
 * people fall back to an org-scoped email match. Null = no login.
 */
export async function resolveAssigneeUserId(
  orgId: string,
  personId: string,
): Promise<{ userId: string; name: string } | null> {
  const [emp] = await db
    .select({ userId: atelierEmployees.userId, name: atelierEmployees.fullName, email: atelierEmployees.email })
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.id, personId),
        eq(atelierEmployees.orgId, orgId),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (!emp) return null;
  if (emp.userId) {
    const [u] = await db
      .select({ id: atelierUsers.id, name: atelierUsers.name })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, emp.userId), eq(atelierUsers.orgId, orgId)));
    if (u) return { userId: u.id, name: emp.name ?? u.name };
  }
  if (emp.email) {
    const [u] = await db
      .select({ id: atelierUsers.id, name: atelierUsers.name })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.email, emp.email.toLowerCase()), eq(atelierUsers.orgId, orgId)));
    if (u) return { userId: u.id, name: emp.name ?? u.name };
  }
  return null;
}

/**
 * In-app card (+ device push mirror) for delegation lifecycle events.
 * Deterministic id → idempotent across replays; same shape the reminder
 * tick uses so mobile deep-links behave identically.
 */
async function notifyDelegation(args: {
  orgId: string;
  userId: string;
  id: string;
  kind: string;
  title: string;
  body: string;
}): Promise<void> {
  const inserted = await db
    .insert(atelierSelfNotifications)
    .values({
      id: args.id,
      orgId: args.orgId,
      userId: args.userId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      href: "/me/tasks",
    })
    .onConflictDoNothing({ target: atelierSelfNotifications.id })
    .returning({ id: atelierSelfNotifications.id });
  if (!inserted.length) return;
  // Best-effort device push through the shared preference-aware mirror —
  // users who opted out of task alerts get the in-app card only.
  await mirrorSelfNotificationPush({
    id: args.id,
    userId: args.userId,
    kind: args.kind,
    title: args.title,
    body: args.body,
    href: "/me/tasks",
  });
}

/** Shared with the chat capability (tasks.assign) — same guards, one path. */
export async function assignPersonalTask(args: {
  assigner: UserRow;
  personId: string;
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
}): Promise<
  | { ok: true; task: TaskRow; assigneeName: string }
  | { ok: false; error: "out_of_scope" | "no_login" | "self_assign" }
> {
  const allowed = await canViewPersonViaRosterScope(args.assigner, args.personId);
  if (!allowed) return { ok: false, error: "out_of_scope" };
  const assignee = await resolveAssigneeUserId(args.assigner.orgId, args.personId);
  if (!assignee) return { ok: false, error: "no_login" };
  if (assignee.userId === args.assigner.id) return { ok: false, error: "self_assign" };
  const id = rid("ptask");
  const [task] = await db
    .insert(atelierPersonalTasks)
    .values({
      id,
      orgId: args.assigner.orgId,
      userId: assignee.userId,
      title: args.title.trim().slice(0, 300),
      notes: args.notes ? args.notes.slice(0, 2000) : null,
      dueAt: args.dueAt ?? null,
      status: "open",
      assignedById: args.assigner.id,
      assignmentStatus: "pending",
    })
    .returning();
  await notifyDelegation({
    orgId: args.assigner.orgId,
    userId: assignee.userId,
    id: `selfnotif_ptaskassign_${id}`,
    kind: "personal_task_assigned",
    title: `${args.assigner.name} assigned you a task`,
    body: task!.title,
  });
  return { ok: true, task: task!, assigneeName: assignee.name };
}

/** Accept or decline a pending handed-over task (assignee only). */
export async function respondToAssignedTask(args: {
  orgId: string;
  userId: string;
  taskId: string;
  response: "accepted" | "declined";
}): Promise<TaskRow | null> {
  const [row] = await db
    .update(atelierPersonalTasks)
    .set({ assignmentStatus: args.response, updatedAt: new Date() })
    .where(
      and(
        eq(atelierPersonalTasks.id, args.taskId),
        eq(atelierPersonalTasks.orgId, args.orgId),
        eq(atelierPersonalTasks.userId, args.userId),
        eq(atelierPersonalTasks.assignmentStatus, "pending"),
        isNull(atelierPersonalTasks.deletedAt),
      ),
    )
    .returning();
  if (!row) return null;
  if (args.response === "declined") {
    await dismissTaskReminders(args.orgId, args.userId, row.id);
  }
  if (row.assignedById) {
    const [assignee] = await db
      .select({ name: atelierUsers.name })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, args.userId), eq(atelierUsers.orgId, args.orgId)));
    await notifyDelegation({
      orgId: args.orgId,
      userId: row.assignedById,
      id: `selfnotif_ptaskresp_${row.id}_${args.response}`,
      kind: `personal_task_${args.response}`,
      title:
        args.response === "accepted"
          ? `${assignee?.name ?? "Your colleague"} accepted your task`
          : `${assignee?.name ?? "Your colleague"} declined your task`,
      body: row.title,
    });
  }
  return row;
}

// @cli-skip: chat parity via tasks.assign (me-chat-parity.ts)
router.post("/me/tasks/assign", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const parsed = AtelierAssignTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", detail: parsed.error.issues[0]?.message });
      return;
    }
    const due = parseDueAt(parsed.data.dueAt);
    if (due && "error" in due) {
      res.status(400).json({ error: "invalid-body", detail: due.error });
      return;
    }
    const result = await assignPersonalTask({
      assigner: me,
      personId: parsed.data.personId,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      dueAt: due,
    });
    if (!result.ok) {
      if (result.error === "out_of_scope") {
        res.status(403).json({ error: "forbidden", detail: "That person is outside your roster scope." });
      } else if (result.error === "self_assign") {
        res.status(400).json({ error: "invalid-body", detail: "Use POST /me/tasks for your own list." });
      } else {
        res.status(400).json({ error: "no-login", detail: "That person has no portal login to receive tasks." });
      }
      return;
    }
    res.status(201).json(AtelierUpdateMyTaskResponse.parse(personalTaskWire(result.task, me.name)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: assignee accept/decline is a one-tap UI action (parity-excluded, me-chat-parity.ts)
router.post("/me/tasks/:id/respond", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const response = req.body?.response;
    if (response !== "accepted" && response !== "declined") {
      res.status(400).json({ error: "invalid-body", detail: 'response must be "accepted" or "declined"' });
      return;
    }
    const row = await respondToAssignedTask({
      orgId: me.orgId,
      userId: me.id,
      taskId: req.params.id,
      response,
    });
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    const names = await assignerNames(me.orgId, [row]);
    res.json(
      AtelierUpdateMyTaskResponse.parse(
        personalTaskWire(row, row.assignedById ? names.get(row.assignedById) ?? "a colleague" : null),
      ),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: assigner status view, read-only (delegation status shown by tasks.assign result card)
router.get("/me/tasks/assigned", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db
      .select({ task: atelierPersonalTasks, assigneeName: atelierUsers.name })
      .from(atelierPersonalTasks)
      .leftJoin(atelierUsers, eq(atelierUsers.id, atelierPersonalTasks.userId))
      .where(
        and(
          eq(atelierPersonalTasks.orgId, me.orgId),
          eq(atelierPersonalTasks.assignedById, me.id),
          isNull(atelierPersonalTasks.deletedAt),
        ),
      )
      .orderBy(desc(atelierPersonalTasks.createdAt));
    res.json(
      AtelierListAssignedTasksResponse.parse({
        tasks: rows.slice(0, 100).map(({ task: t, assigneeName }) => ({
          ...personalTaskWire(t),
          assigneeName: assigneeName ?? "a colleague",
        })),
      }),
    );
  } catch (err) {
    next(err);
  }
});
