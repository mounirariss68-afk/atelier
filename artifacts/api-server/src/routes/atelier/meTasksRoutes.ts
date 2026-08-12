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
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { db, atelierPersonalTasks, atelierSelfNotifications } from "@workspace/db";
import {
  AtelierListMyTasksResponse,
  AtelierCreateMyTaskBody,
  AtelierUpdateMyTaskBody,
  AtelierUpdateMyTaskResponse,
  AtelierDeleteMyTaskResponse,
} from "@workspace/api-zod";
import type { atelierUsers } from "@workspace/db";

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

export function personalTaskWire(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes ?? null,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    status: t.status as "open" | "done",
    overdue: t.status === "open" && !!t.dueAt && t.dueAt.getTime() < Date.now(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
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
    res.json(AtelierListMyTasksResponse.parse({ tasks: rows.map(personalTaskWire) }));
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
