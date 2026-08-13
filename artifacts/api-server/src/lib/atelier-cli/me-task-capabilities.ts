/**
 * Task #1002 — personal tasks & reminders chat capabilities.
 *
 * Riser tools to capture, list, complete, and reschedule the caller's
 * OWN to-dos / timed reminders ("remind me to call Dr. Hassan at 5pm")
 * — no more meeting workaround for solo reminders.
 *
 * Security model mirrors the other me.* capabilities: the subject is
 * ALWAYS the authenticated session persona (resolveSelfSubject), input
 * schemas carry no person/user selector (`additionalProperties: false`),
 * and every query predicates on org + owner userId. Because the ids are
 * `me.*`, the SELF_ONLY_CHAT_ROLES clamp automatically surfaces them to
 * employee/contractor chat on web and mobile.
 *
 * Time handling: natural-language times resolve SERVER-SIDE in the
 * caller's timezone (replay-stable `tz` input first, then the turn's
 * ctx.timezone, Dubai fallback) via the shared chat-tz helpers. A bare
 * time with no date means "the next occurrence of that wall time".
 */
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import { resolveSelfSubject } from "./me-capabilities.js";
import { defineSelfWriteCapability } from "./me-write-capabilities.js";
import {
  normalizeChatTz,
  isValidTimeZone,
  wallToUtcInTz,
  fmtInTz,
  todayInTz,
  tomorrowInTz,
  tzShortLabel,
} from "./chat-tz.js";
import {
  listPersonalTasks,
  createPersonalTask,
  updatePersonalTask,
  personalTaskWire,
  assignPersonalTask,
} from "../../routes/atelier/meTasksRoutes.js";
import { scopedPersonMatches, loadMe } from "./people-read-capabilities.js";
import { isRestrictedPersona } from "../../routes/atelier/personaRoles.js";
import type { ToolContext, ToolResult } from "./index.js";

type TaskRow = Awaited<ReturnType<typeof listPersonalTasks>>[number];

const TASKS_HREF = "/me/tasks";

// ---------------------------------------------------------------------
// Time parsing — tolerant "5pm" / "17:00" / "5:30 pm" → "HH:MM".
// ---------------------------------------------------------------------
export function parseTimeAnswer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3];
  if (min > 59) return null;
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (!mer && (h < 0 || h > 23)) return null;
  if (mer && (h < 0 || h > 23)) return null;
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve (dueDate?, dueTime?, tz) → UTC instant. Rules:
 *  - "today"/"tomorrow" resolve against the caller's wall clock;
 *  - a bare time with NO date means the NEXT occurrence of that wall
 *    time (today if still ahead, else tomorrow) — "remind me at 5pm"
 *    said at 6pm lands tomorrow, never in the past;
 *  - a date with no time defaults to 09:00.
 * Returns null when no due information was given at all.
 */
export function resolveDueInstant(
  input: Record<string, unknown>,
  ctx: Pick<ToolContext, "timezone">,
  now: Date = new Date(),
): { dueAt: Date | null; tz: string } | { error: string } {
  const tz = isValidTimeZone(input.tz)
    ? (input.tz as string)
    : normalizeChatTz((ctx as { timezone?: unknown }).timezone);
  const rawDate = typeof input.dueDate === "string" ? input.dueDate.trim().toLowerCase() : "";
  const rawTime = typeof input.dueTime === "string" ? input.dueTime.trim() : "";
  if (!rawDate && !rawTime) return { dueAt: null, tz };

  let ymd: string | null = null;
  if (rawDate === "today") ymd = todayInTz(tz, now);
  else if (rawDate === "tomorrow") ymd = tomorrowInTz(tz, now);
  else if (rawDate) {
    if (!ISO_DATE.test(rawDate)) {
      return { error: `Use an ISO date (YYYY-MM-DD) or "today"/"tomorrow" — got "${rawDate}".` };
    }
    ymd = rawDate;
  }

  let hm: string | null = null;
  if (rawTime) {
    hm = parseTimeAnswer(rawTime);
    if (!hm) return { error: `I couldn't read "${rawTime}" as a time — try "17:00" or "5pm".` };
  }

  if (!ymd && hm) {
    // Bare time → next occurrence of that wall time.
    const today = todayInTz(tz, now);
    const candidate = wallToUtcInTz(today, hm, tz);
    if (!candidate) return { error: "That date/time didn't resolve — try again." };
    if (candidate.getTime() > now.getTime() - 60_000) return { dueAt: candidate, tz };
    const tomorrow = wallToUtcInTz(tomorrowInTz(tz, now), hm, tz);
    return { dueAt: tomorrow, tz };
  }
  const instant = wallToUtcInTz(ymd!, hm ?? "09:00", tz);
  if (!instant) return { error: "That date/time didn't resolve — try again." };
  return { dueAt: instant, tz };
}

function dueLabel(dueAt: Date | null, tz: string): string {
  if (!dueAt) return "no due time";
  return `${fmtInTz(dueAt, tz)} (${tzShortLabel(tz)})`;
}

// ---------------------------------------------------------------------
// Shared resolver — pick ONE of the caller's own OPEN tasks by id or
// title text. Pool is already self-scoped, so candidates cannot leak.
// ---------------------------------------------------------------------
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").trim();

function taskOption(t: TaskRow, tz: string) {
  return {
    id: t.id,
    label: t.title,
    secondary: t.dueAt ? `due ${fmtInTz(t.dueAt, tz)}` : "no due time",
  };
}

export function resolveOwnOpenTask(
  open: TaskRow[],
  input: Record<string, unknown>,
  tz: string,
):
  | { outcome: "match"; row: TaskRow }
  | { outcome: "none" }
  | { outcome: "pick"; prompt: string; options: ReturnType<typeof taskOption>[] } {
  const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
  const q = typeof input.q === "string" ? input.q.trim() : "";
  if (taskId) {
    const row = open.find((t) => t.id === taskId);
    if (row) return { outcome: "match", row };
    if (open.length === 0) return { outcome: "none" };
    return {
      outcome: "pick",
      prompt: "I couldn't find that task on your list — did you mean one of these?",
      options: open.slice(0, 6).map((t) => taskOption(t, tz)),
    };
  }
  if (open.length === 0) return { outcome: "none" };
  if (q) {
    const nq = fold(q);
    const hits = open.filter((t) => fold(t.title).includes(nq));
    if (hits.length === 1) return { outcome: "match", row: hits[0]! };
    if (hits.length > 1) {
      return {
        outcome: "pick",
        prompt: `Several open tasks match "${q}" — which one?`,
        options: hits.slice(0, 6).map((t) => taskOption(t, tz)),
      };
    }
    return {
      outcome: "pick",
      prompt: `Nothing on your list matches "${q}" — did you mean one of these?`,
      options: open.slice(0, 6).map((t) => taskOption(t, tz)),
    };
  }
  if (open.length === 1) return { outcome: "match", row: open[0]! };
  return {
    outcome: "pick",
    prompt: "Which task do you mean?",
    options: open.slice(0, 6).map((t) => taskOption(t, tz)),
  };
}

function ctxTz(ctx: ToolContext, input: Record<string, unknown>): string {
  return isValidTimeZone(input.tz)
    ? (input.tz as string)
    : normalizeChatTz((ctx as unknown as { timezone?: unknown }).timezone);
}

// ---------------------------------------------------------------------
// me.tasks — read: the caller's own list ("what's on my list?")
// ---------------------------------------------------------------------
defineCapability({
  id: "me.tasks",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "my_tasks",
  description:
    "The caller's own personal tasks and reminders: open items first (overdue-flagged, due times in the caller's timezone), then recently completed ones. Always self-scoped.",
  slashAliases: { en: ["/my-tasks", "/my-reminders"], fr: ["/mes-taches"] },
  representativePrompts: {
    en: ["What's on my list?", "Show my reminders"],
    ar: ["ما هي مهامي؟"],
    fr: ["Qu'y a-t-il sur ma liste ?"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["What's on my list?"],
    ar: ["ما هي مهامي؟"],
    fr: ["Affiche mes rappels"],
  },
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["open", "done", "all"],
        description: "Filter — defaults to open items.",
      },
      tz: { type: "string", description: "IANA timezone for rendering due times." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  irreversible: false,
  async run(input, ctx) {
    const subject = await resolveSelfSubject(ctx);
    if (!subject) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: "Your login could not be resolved to a user record.",
      };
    }
    const tz = ctxTz(ctx, input ?? {});
    const status = typeof input?.status === "string" ? input.status : "open";
    const rows = await listPersonalTasks(subject.user.orgId, subject.user.id);
    const filtered =
      status === "all" ? rows : rows.filter((t) => t.status === (status === "done" ? "done" : "open"));
    return {
      ok: true,
      data: {
        items: filtered.slice(0, 30).map((t) => {
          const w = personalTaskWire(t);
          return {
            id: t.id,
            label: t.title,
            status: w.status,
            due: t.dueAt ? fmtInTz(t.dueAt, tz) : null,
            overdue: w.overdue,
            notes: t.notes ?? null,
            href: TASKS_HREF,
          };
        }),
        total: filtered.length,
        tasksPageHref: TASKS_HREF,
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.task_create — "remind me to call Dr. Hassan at 5pm"
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.task_create",
  module: "roster",
  toolName: "create_my_task",
  description:
    "Add a personal task or timed reminder for the signed-in user only (\"remind me to call Dr. Hassan at 5pm\"). Times resolve in the caller's timezone; a bare time means its next occurrence. NOT a meeting — use this for solo to-dos and reminders.",
  slashAliases: { en: ["/remind-me", "/new-task"], fr: ["/rappelle-moi"] },
  representativePrompts: {
    en: ["Remind me to call Dr. Hassan at 5pm", "Add renew my parking permit to my list"],
    ar: ["ذكرني بالاتصال بالدكتور حسن الساعة الخامسة مساء"],
    fr: ["Rappelle-moi d'appeler le Dr Hassan à 17h"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Remind me to call Dr. Hassan at 5pm"],
    ar: ["ذكرني بالاتصال بالدكتور حسن"],
    fr: ["Rappelle-moi d'appeler le Dr Hassan"],
  },
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "What to do / be reminded of." },
      notes: { type: "string", description: "Optional extra detail." },
      dueDate: {
        type: "string",
        description: 'Due date: ISO YYYY-MM-DD, "today", or "tomorrow". Omit for an undated to-do.',
      },
      dueTime: { type: "string", description: 'Due time like "17:00" or "5pm".' },
      tz: { type: "string", description: "IANA timezone the times were spoken in." },
      confirm: { type: "boolean" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject, ctx) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) {
      return { ok: false, errorCode: "missing_title", errorMessage: "What should the reminder say?" };
    }
    const resolved = resolveDueInstant(input, ctx as ToolContext);
    if ("error" in resolved) {
      return { ok: false, errorCode: "invalid_due", errorMessage: resolved.error };
    }
    const { dueAt, tz } = resolved;
    if (input.confirm !== true) {
      return {
        ok: true,
        data: { preview: { title, due: dueLabel(dueAt, tz) } },
        confirmation: {
          summary: `Add "${title}" to your list — ${dueLabel(dueAt, tz)}?`,
          diff: {
            create: {
              table: "atelier_personal_tasks",
              values: { title, dueAt: dueAt ? dueAt.toISOString() : null },
            },
          },
          // Pin the resolved tz so a confirm replay can't drift zones.
          pending: { tool: "create_my_task", input: { ...input, tz, confirm: true } },
        },
      };
    }
    const row = await createPersonalTask({
      orgId: subject.user.orgId,
      userId: subject.user.id,
      title,
      notes: typeof input.notes === "string" ? input.notes : null,
      dueAt,
    });
    return {
      ok: true,
      data: {
        id: row.id,
        label: row.title,
        status: "open",
        due: dueAt ? fmtInTz(dueAt, tz) : null,
        href: TASKS_HREF,
        navigateTo: { path: TASKS_HREF, when: "on_commit" as const },
        note: dueAt
          ? `Reminder set for ${dueLabel(dueAt, tz)} — you'll get a notification when it's due.`
          : "Added to your list.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.task_complete — "mark the Hassan call done"
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.task_complete",
  module: "roster",
  toolName: "complete_my_task",
  description:
    "Mark one of the caller's own personal tasks/reminders as done (\"mark the Hassan call done\"). Clears its due-reminder notification. Trivially reversible from the Me → Tasks page.",
  slashAliases: { en: ["/task-done"], fr: ["/tache-faite"] },
  representativePrompts: {
    en: ["Mark the Hassan call done", "I finished the parking permit task"],
    ar: ["أنجزت مهمة الاتصال"],
    fr: ["Marque l'appel Hassan comme fait"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Mark the Hassan call done"],
    ar: ["أنجزت المهمة"],
    fr: ["Marque la tâche comme faite"],
  },
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Id of the caller's own task (optional)." },
      q: { type: "string", description: "Title words to pick the task when the id is unknown." },
      tz: { type: "string" },
    },
    additionalProperties: false,
  },
  // Single-phase like notification dismiss: completing your own to-do is
  // trivially reversible (re-open from the Tasks panel).
  twoPhaseConfirm: false,
  irreversible: false,
  async runSelf(input, subject, ctx) {
    const tz = ctxTz(ctx as ToolContext, input);
    const rows = await listPersonalTasks(subject.user.orgId, subject.user.id);
    const open = rows.filter((t) => t.status === "open");
    const resolved = resolveOwnOpenTask(open, input, tz);
    if (resolved.outcome === "none") {
      return {
        ok: false,
        errorCode: "no_open_tasks",
        errorMessage: "Your list has no open tasks right now.",
      };
    }
    if (resolved.outcome === "pick") {
      return {
        ok: true,
        data: { prompt: resolved.prompt, options: resolved.options, navigateTo: null },
        disambiguation: { kind: "personal_task", field: "taskId", options: resolved.options },
      };
    }
    const row = await updatePersonalTask({
      orgId: subject.user.orgId,
      userId: subject.user.id,
      taskId: resolved.row.id,
      patch: { status: "done" },
    });
    if (!row) {
      return { ok: false, errorCode: "not_found", errorMessage: "That task is no longer on your list." };
    }
    return {
      ok: true,
      data: {
        id: row.id,
        label: row.title,
        status: "done",
        href: TASKS_HREF,
        navigateTo: null,
        note: "Done — crossed off your list.",
      },
    };
  },
});

// ---------------------------------------------------------------------
// me.task_reschedule — "move the Hassan call to tomorrow 10am" / snooze
// ---------------------------------------------------------------------
defineSelfWriteCapability({
  id: "me.task_reschedule",
  module: "roster",
  toolName: "reschedule_my_task",
  description:
    "Move the due time of one of the caller's own tasks/reminders (\"push the Hassan call to tomorrow 10am\", \"snooze it an hour\"). Times resolve in the caller's timezone; the old due-notification is cleared and a fresh one fires at the new time.",
  slashAliases: { en: ["/snooze", "/reschedule-task"], fr: ["/reporter-tache"] },
  representativePrompts: {
    en: ["Move the Hassan call to tomorrow at 10am", "Snooze my parking reminder to 6pm"],
    ar: ["أجل التذكير إلى الغد"],
    fr: ["Reporte le rappel à demain 10h"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Move the Hassan call to tomorrow at 10am"],
    ar: ["أجل التذكير إلى الغد"],
    fr: ["Reporte le rappel à demain"],
  },
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Id of the caller's own task (optional)." },
      q: { type: "string", description: "Title words to pick the task when the id is unknown." },
      dueDate: {
        type: "string",
        description: 'New due date: ISO YYYY-MM-DD, "today", or "tomorrow".',
      },
      dueTime: { type: "string", description: 'New due time like "17:00" or "5pm".' },
      tz: { type: "string", description: "IANA timezone the times were spoken in." },
      confirm: { type: "boolean" },
    },
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject, ctx) {
    const tz = ctxTz(ctx as ToolContext, input);
    const rows = await listPersonalTasks(subject.user.orgId, subject.user.id);
    const open = rows.filter((t) => t.status === "open");
    const resolvedTask = resolveOwnOpenTask(open, input, tz);
    if (resolvedTask.outcome === "none") {
      return {
        ok: false,
        errorCode: "no_open_tasks",
        errorMessage: "Your list has no open tasks to reschedule.",
      };
    }
    if (resolvedTask.outcome === "pick") {
      return {
        ok: true,
        data: { prompt: resolvedTask.prompt, options: resolvedTask.options, navigateTo: null },
        disambiguation: { kind: "personal_task", field: "taskId", options: resolvedTask.options },
      };
    }
    const resolvedDue = resolveDueInstant(input, ctx as ToolContext);
    if ("error" in resolvedDue) {
      return { ok: false, errorCode: "invalid_due", errorMessage: resolvedDue.error };
    }
    if (!resolvedDue.dueAt) {
      return {
        ok: false,
        errorCode: "missing_due",
        errorMessage: "When should I move it to? Give me a date and/or time.",
      };
    }
    const task = resolvedTask.row;
    const newDue = resolvedDue.dueAt;
    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            title: task.title,
            from: task.dueAt ? dueLabel(task.dueAt, tz) : "no due time",
            to: dueLabel(newDue, tz),
          },
        },
        confirmation: {
          summary: `Move "${task.title}" to ${dueLabel(newDue, tz)}?`,
          diff: {
            update: {
              table: "atelier_personal_tasks",
              id: task.id,
              set: { dueAt: newDue.toISOString() },
            },
          },
          pending: {
            tool: "reschedule_my_task",
            input: { ...input, taskId: task.id, tz, confirm: true },
          },
        },
      };
    }
    const row = await updatePersonalTask({
      orgId: subject.user.orgId,
      userId: subject.user.id,
      taskId: task.id,
      patch: { dueAt: newDue, dueAtSet: true },
    });
    if (!row) {
      return { ok: false, errorCode: "not_found", errorMessage: "That task is no longer on your list." };
    }
    return {
      ok: true,
      data: {
        id: row.id,
        label: row.title,
        status: row.status,
        due: fmtInTz(newDue, tz),
        href: TASKS_HREF,
        navigateTo: { path: TASKS_HREF, when: "on_commit" as const },
        note: `Rescheduled to ${dueLabel(newDue, tz)}.`,
      },
    };
  },
});

// ---------------------------------------------------------------------
// tasks.assign — Task #1011: hand a task to a colleague.
//
// Deliberately NOT a me.* capability: the SELF_ONLY_CHAT_ROLES clamp
// keeps it away from employee/contractor chat, and the runtime gate
// below (restricted-persona denial + roster-scope person matching)
// mirrors the REST route exactly. The task row is owned by the ASSIGNEE
// and lands as "pending" until they accept or decline from Me → Tasks.
// ---------------------------------------------------------------------
defineCapability({
  id: "tasks.assign",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "assign_task",
  description:
    'Hand a personal task to a colleague in the caller\'s roster scope ("ask Sara to send the deck by Friday"). The assignee gets a notification and can accept or decline; the assigner can track status on Me → Tasks. NOT for the caller\'s own list (use create_my_task) and NOT a meeting.',
  slashAliases: { en: ["/assign-task", "/delegate"], fr: ["/deleguer-tache"] },
  representativePrompts: {
    en: ["Ask Sara to send the deck tomorrow", "Assign the expense follow-up to Riser"],
    ar: ["اطلب من سارة إرسال العرض غدا"],
    fr: ["Demande à Sara d'envoyer le deck demain"],
  },
  surfaceOn: ["home", "roster", "global"],
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Ask Sara to send the deck tomorrow"],
    ar: ["كلف زميلا بمهمة"],
    fr: ["Délègue une tâche à un collègue"],
  },
  inputSchema: {
    type: "object",
    properties: {
      person: { type: "string", description: "Name of the colleague to hand the task to." },
      personId: { type: "string", description: "Roster person id (from a disambiguation pick)." },
      title: { type: "string", description: "What they should do." },
      notes: { type: "string", description: "Optional extra detail." },
      dueDate: {
        type: "string",
        description: 'Due date: ISO YYYY-MM-DD, "today", or "tomorrow". Omit for an undated task.',
      },
      dueTime: { type: "string", description: 'Due time like "17:00" or "5pm".' },
      tz: { type: "string", description: "IANA timezone the times were spoken in." },
      confirm: { type: "boolean" },
    },
    required: ["title"],
    additionalProperties: false,
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  irreversible: false,
  async run(input, ctx): Promise<ToolResult> {
    if (isRestrictedPersona(ctx.persona.role)) {
      return {
        ok: false,
        errorCode: "forbidden",
        errorMessage: "Handing tasks to colleagues is not available to your role.",
      };
    }
    const me = await loadMe(ctx);
    if (!me) return { ok: false, errorCode: "forbidden", errorMessage: "No active persona." };
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) {
      return { ok: false, errorCode: "missing_title", errorMessage: "What should the task say?" };
    }
    const resolvedDue = resolveDueInstant(input, ctx as ToolContext);
    if ("error" in resolvedDue) {
      return { ok: false, errorCode: "invalid_due", errorMessage: resolvedDue.error };
    }
    const { dueAt, tz } = resolvedDue;

    // Resolve the assignee within the caller's roster scope ONLY.
    const personId = typeof input.personId === "string" ? input.personId.trim() : "";
    const personQ = typeof input.person === "string" ? input.person.trim() : "";
    let targetPersonId = personId;
    let targetName = "";
    if (!targetPersonId) {
      if (!personQ) {
        return {
          ok: false,
          errorCode: "missing_person",
          errorMessage: "Who should I hand this task to?",
        };
      }
      const matches = await scopedPersonMatches(me, personQ);
      if (matches.length === 0) {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `I couldn't find "${personQ}" among the people you can delegate to.`,
        };
      }
      if (matches.length > 1) {
        const options = matches.slice(0, 6).map((p) => ({
          id: p.id,
          label: p.fullName ?? p.preferredName ?? p.id,
          secondary: p.title ?? p.workerType ?? "",
        }));
        return {
          ok: true,
          data: {
            prompt: `Several people match "${personQ}" — who do you mean?`,
            options,
            navigateTo: null,
          },
          disambiguation: { kind: "roster_person", options },
        };
      }
      targetPersonId = matches[0]!.id;
      targetName = matches[0]!.fullName ?? personQ;
    }

    if (input.confirm !== true) {
      return {
        ok: true,
        data: {
          preview: {
            title,
            assignee: targetName || targetPersonId,
            due: dueLabel(dueAt, tz),
          },
        },
        confirmation: {
          summary: `Hand "${title}" to ${targetName || "this colleague"} — ${dueLabel(dueAt, tz)}? They'll be asked to accept or decline.`,
          diff: {
            create: {
              table: "atelier_personal_tasks",
              values: {
                title,
                assigneePersonId: targetPersonId,
                dueAt: dueAt ? dueAt.toISOString() : null,
                assignmentStatus: "pending",
              },
            },
          },
          pending: {
            tool: "assign_task",
            input: { ...input, personId: targetPersonId, person: targetName || personQ, tz, confirm: true },
          },
        },
      };
    }

    const result = await assignPersonalTask({
      assigner: me,
      personId: targetPersonId,
      title,
      notes: typeof input.notes === "string" ? input.notes : null,
      dueAt,
    });
    if (!result.ok) {
      if (result.error === "out_of_scope") {
        return {
          ok: false,
          errorCode: "forbidden",
          errorMessage: "That person is outside the people you can delegate to.",
        };
      }
      if (result.error === "self_assign") {
        return {
          ok: false,
          errorCode: "invalid_target",
          errorMessage: "That's you — use your own list for that (\"remind me to…\").",
        };
      }
      return {
        ok: false,
        errorCode: "no_login",
        errorMessage: "That person has no portal login yet, so they can't receive tasks.",
      };
    }
    return {
      ok: true,
      data: {
        id: result.task.id,
        label: result.task.title,
        assignee: result.assigneeName,
        assignmentStatus: "pending",
        due: dueAt ? fmtInTz(dueAt, tz) : null,
        href: TASKS_HREF,
        navigateTo: { path: TASKS_HREF, when: "on_commit" as const },
        note: `Handed to ${result.assigneeName} — they've been notified and can accept or decline. Track it under Me → Tasks.`,
      },
    };
  },
});
