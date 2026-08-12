/**
 * MeTasks — Task #1002: personal tasks & reminders panel (Me lens).
 *
 * Strictly self-scope: /me/tasks only ever answers for the caller.
 * Add / edit / complete / snooze / delete lightweight to-dos and timed
 * reminders. Riser can create these too ("remind me to call Dr. Hassan
 * at 5pm") — chat confirm cards deep-link here. Due/overdue reminders
 * surface through the notification bell and the Home roll-up.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierListMyTasks,
  useAtelierCreateMyTask,
  useAtelierUpdateMyTask,
  useAtelierDeleteMyTask,
  getAtelierListMyTasksQueryKey,
  type AtelierPersonalTask,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import {
  Plus,
  Check,
  RotateCcw,
  Clock,
  Trash2,
  Pencil,
  BellRing,
} from "lucide-react";

function fmtDue(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Local datetime-local value → UTC ISO (browser handles the zone). */
function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MeTasks() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useAtelierListMyTasks();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getAtelierListMyTasksQueryKey() });
  const createMut = useAtelierCreateMyTask({
    mutation: { onSuccess: invalidate },
  });
  const updateMut = useAtelierUpdateMyTask({
    mutation: { onSuccess: invalidate },
  });
  const deleteMut = useAtelierDeleteMyTask({
    mutation: { onSuccess: invalidate },
  });

  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const [editDue, setEditDue] = React.useState("");

  const tasks = data?.tasks ?? [];
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done").slice(0, 8);

  const add = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    createMut.mutate(
      { data: { title: trimmed, dueAt: localToIso(due) } },
      {
        onSuccess: () => {
          setTitle("");
          setDue("");
        },
      },
    );
  };

  const snooze = (t: AtelierPersonalTask, kind: "hour" | "tomorrow") => {
    const base =
      t.dueAt && new Date(t.dueAt).getTime() > Date.now()
        ? new Date(t.dueAt)
        : new Date();
    let next: Date;
    if (kind === "hour") next = new Date(base.getTime() + 60 * 60 * 1000);
    else {
      next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    }
    updateMut.mutate({ id: t.id, data: { dueAt: next.toISOString() } });
  };

  const saveEdit = (t: AtelierPersonalTask) => {
    const trimmed = editTitle.trim();
    if (!trimmed) return;
    updateMut.mutate(
      { id: t.id, data: { title: trimmed, dueAt: localToIso(editDue) } },
      { onSuccess: () => setEditingId(null) },
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3" data-testid="card-me-tasks-add">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text flex items-center gap-2">
            <BellRing className="w-4 h-4 text-gold/80" /> My tasks & reminders
          </h3>
          {open.length > 0 && <MonoChip>{open.length} open</MonoChip>}
        </div>
        <p className="text-xs text-text-faint">
          Personal to-dos only you can see. Add a due time to get a reminder
          in your notifications — or just tell Riser, e.g. “remind me to call
          Dr. Hassan at 5pm”.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="What do you need to do?"
            className="flex-1 min-w-[200px] rounded border border-border-soft bg-transparent px-3 py-1.5 text-sm text-text placeholder:text-text-faint"
            data-testid="input-me-task-title"
          />
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="rounded border border-border-soft bg-transparent px-2 py-1.5 text-sm text-text"
            data-testid="input-me-task-due"
          />
          <button
            onClick={add}
            disabled={!title.trim() || createMut.isPending}
            className="inline-flex items-center gap-1.5 rounded bg-gold/90 px-3 py-1.5 text-sm font-medium text-navy disabled:opacity-50"
            data-testid="button-me-task-add"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </Card>

      <Card className="p-5 space-y-1" data-testid="card-me-tasks-list">
        {isLoading && <p className="text-xs text-text-faint">Loading…</p>}
        {isError && (
          <p className="text-xs text-danger">
            Couldn't load your tasks. Refresh to try again.
          </p>
        )}
        {!isLoading && !isError && open.length === 0 && (
          <p className="text-xs text-text-faint" data-testid="text-me-tasks-empty">
            Nothing open — enjoy the quiet, or add something above.
          </p>
        )}
        <div className="divide-y divide-border-soft">
          {open.map((t) => (
            <div key={t.id} className="py-2.5" data-testid={`row-me-task-${t.id}`}>
              {editingId === t.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="flex-1 min-w-[180px] rounded border border-border-soft bg-transparent px-2 py-1 text-sm text-text"
                    data-testid={`input-me-task-edit-title-${t.id}`}
                  />
                  <input
                    type="datetime-local"
                    value={editDue}
                    onChange={(e) => setEditDue(e.target.value)}
                    className="rounded border border-border-soft bg-transparent px-2 py-1 text-sm text-text"
                  />
                  <button
                    onClick={() => saveEdit(t)}
                    className="text-xs font-mono text-gold"
                    data-testid={`button-me-task-save-${t.id}`}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs font-mono text-text-faint"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() =>
                      updateMut.mutate({ id: t.id, data: { status: "done" } })
                    }
                    title="Mark done"
                    className="shrink-0 w-5 h-5 rounded-full border border-border-soft flex items-center justify-center hover:border-gold hover:text-gold text-transparent"
                    data-testid={`button-me-task-done-${t.id}`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text truncate">{t.title}</p>
                    {t.dueAt && (
                      <p
                        className={`text-[11px] font-mono ${t.overdue ? "text-danger" : "text-text-faint"}`}
                      >
                        <Clock className="inline w-3 h-3 mr-1 -mt-0.5" />
                        {fmtDue(t.dueAt)}
                        {t.overdue ? " · overdue" : ""}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => snooze(t, "hour")}
                    className="text-[11px] font-mono text-text-faint hover:text-gold shrink-0"
                    title="Snooze one hour"
                    data-testid={`button-me-task-snooze-hour-${t.id}`}
                  >
                    +1h
                  </button>
                  <button
                    onClick={() => snooze(t, "tomorrow")}
                    className="text-[11px] font-mono text-text-faint hover:text-gold shrink-0"
                    title="Snooze to tomorrow 09:00"
                    data-testid={`button-me-task-snooze-tomorrow-${t.id}`}
                  >
                    Tomorrow
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(t.id);
                      setEditTitle(t.title);
                      setEditDue(isoToLocalInput(t.dueAt));
                    }}
                    className="text-text-faint hover:text-gold shrink-0"
                    title="Edit"
                    data-testid={`button-me-task-edit-${t.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteMut.mutate({ id: t.id })}
                    className="text-text-faint hover:text-danger shrink-0"
                    title="Delete"
                    data-testid={`button-me-task-delete-${t.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {done.length > 0 && (
        <Card className="p-5 space-y-1" data-testid="card-me-tasks-done">
          <p className="text-xs font-mono uppercase tracking-wider text-text-faint">
            Recently completed
          </p>
          <div className="divide-y divide-border-soft">
            {done.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2.5 py-2"
                data-testid={`row-me-task-done-${t.id}`}
              >
                <Check className="w-3.5 h-3.5 text-gold/70 shrink-0" />
                <span className="flex-1 min-w-0 text-sm text-text-faint line-through truncate">
                  {t.title}
                </span>
                <button
                  onClick={() =>
                    updateMut.mutate({ id: t.id, data: { status: "open" } })
                  }
                  className="text-text-faint hover:text-gold shrink-0"
                  title="Reopen"
                  data-testid={`button-me-task-reopen-${t.id}`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
