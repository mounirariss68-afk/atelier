/**
 * ActivityTab — unified account timeline + activity/task layer (Task #631).
 *
 * Surfaces a first-class activity/task list (with inline add, complete, edit,
 * delete) alongside a merged, newest-first timeline that folds in human
 * insights, logged meetings, opportunity stage moves, and agent runs for the
 * account. An open-task roll-up (overdue-flagged) sits at the top.
 *
 * Reads come from GET /timeline; every mutation returns the refreshed timeline
 * payload which replaces the cache in one shot. Creating activity is allowed
 * for anyone who can see the account; completing / editing / deleting a row is
 * gated client-side to the row's owner, its creator, or the account team
 * (server enforces the same rule).
 */
import * as React from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetAccountTimeline,
  useAtelierCreateActivity,
  useAtelierUpdateActivity,
  useAtelierDeleteActivity,
  useAtelierGetMe,
  useAtelierListUsers,
  getAtelierGetAccountTimelineQueryKey,
  type AtelierAccountTimeline,
  type AtelierActivity,
  type AtelierActivityType,
  type AtelierTimelineEntry,
} from "@workspace/api-client-react";
import { Card, Eyebrow, SectionLabel, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity as ActivityIcon,
  CheckSquare,
  Phone,
  Mail,
  CalendarClock,
  ListTodo,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  MessageSquare,
  ArrowRightLeft,
  Sparkles,
  Clock,
} from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  task: "Task",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
};
const TYPE_ICON: Record<string, React.ReactNode> = {
  task: <CheckSquare className="w-3.5 h-3.5" />,
  call: <Phone className="w-3.5 h-3.5" />,
  email: <Mail className="w-3.5 h-3.5" />,
  meeting: <CalendarClock className="w-3.5 h-3.5" />,
};
const KIND_LABEL: Record<string, string> = {
  activity: "Activity",
  insight: "Insight",
  meeting: "Meeting",
  stage_move: "Stage",
  agent_run: "Agent",
};
const KIND_ICON: Record<string, React.ReactNode> = {
  activity: <ActivityIcon className="w-3.5 h-3.5" />,
  insight: <MessageSquare className="w-3.5 h-3.5" />,
  meeting: <CalendarClock className="w-3.5 h-3.5" />,
  stage_move: <ArrowRightLeft className="w-3.5 h-3.5" />,
  agent_run: <Sparkles className="w-3.5 h-3.5" />,
};
const KIND_TONE: Record<string, string> = {
  activity: "text-gold border-gold/30 bg-gold/10",
  insight: "text-sky-300 border-sky-400/30 bg-sky-400/10",
  meeting: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  stage_move: "text-violet-300 border-violet-400/30 bg-violet-400/10",
  agent_run: "text-amber-300 border-amber-400/30 bg-amber-400/10",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${tone}`}
    >
      {children}
    </span>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function ActivityTab({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const { data: me } = useAtelierGetMe();
  const { data, isLoading, isError } = useAtelierGetAccountTimeline(accountId, {
    query: { queryKey: getAtelierGetAccountTimelineQueryKey(accountId) },
  });
  const key = getAtelierGetAccountTimelineQueryKey(accountId);
  const onSuccess = (d: AtelierAccountTimeline) => qc.setQueryData(key, d);

  if (isLoading) {
    return <Skeleton className="h-64 bg-bg-elevate" />;
  }
  if (isError || !data) {
    return (
      <p className="text-danger font-mono text-sm py-8 text-center">
        Could not load the account timeline.
      </p>
    );
  }

  const canMutate = (a: AtelierActivity): boolean =>
    !!me &&
    (a.ownerId === me.id || a.createdByUserId === me.id || !!data.canManage);

  return (
    <div className="space-y-6">
      <Eyebrow className="flex items-center gap-2">
        <ActivityIcon className="w-3.5 h-3.5" /> Activity & timeline
      </Eyebrow>

      <OpenTasksRollup tasks={data.openTasks} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActivitiesSection
          activities={data.activities}
          accountId={accountId}
          onSuccess={onSuccess}
          canMutate={canMutate}
        />
        <TimelineSection timeline={data.timeline} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Open-task roll-up
// ------------------------------------------------------------------
function OpenTasksRollup({ tasks }: { tasks: AtelierActivity[] }) {
  if (tasks.length === 0) return null;
  const overdue = tasks.filter((t) => t.overdue);
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-2">
          <ListTodo className="w-3.5 h-3.5" /> Open tasks
        </SectionLabel>
        <div className="flex items-center gap-2">
          <Pill tone="text-text-mute border-border-soft bg-bg-soft">
            {tasks.length} open
          </Pill>
          {overdue.length > 0 && (
            <Pill tone="text-red-300 border-red-400/30 bg-red-400/10">
              <Clock className="w-3 h-3" /> {overdue.length} overdue
            </Pill>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {tasks.slice(0, 8).map((t) => (
          <span
            key={t.id}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-mono ${
              t.overdue
                ? "text-red-300 border-red-400/30 bg-red-400/10"
                : "text-text-mute border-border-soft bg-bg-soft"
            }`}
          >
            {TYPE_ICON[t.type]}
            <span className="text-text">{t.title.slice(0, 40)}</span>
            {t.ownerName && <span className="text-text-faint">· {t.ownerName}</span>}
            {t.dueDate && <span>· {t.dueDate}</span>}
          </span>
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Activities (first-class list with CRUD)
// ------------------------------------------------------------------
function ActivitiesSection({
  activities,
  accountId,
  onSuccess,
  canMutate,
}: {
  activities: AtelierActivity[];
  accountId: string;
  onSuccess: (d: AtelierAccountTimeline) => void;
  canMutate: (a: AtelierActivity) => boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-2">
          <CheckSquare className="w-3.5 h-3.5" /> Activities & tasks
        </SectionLabel>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs text-gold hover:text-gold/80 flex items-center gap-1 font-mono"
        >
          <Plus className="w-3.5 h-3.5" /> Log activity
        </button>
      </div>
      {adding && (
        <ActivityComposer
          accountId={accountId}
          onSuccess={(d) => {
            onSuccess(d);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {activities.length === 0 ? (
        <p className="text-text-mute text-sm font-mono py-4 text-center">
          No activity logged yet. Add the first task, call, email, or meeting.
        </p>
      ) : (
        <div className="space-y-2">
          {activities.map((a) => (
            <ActivityRow
              key={a.id}
              activity={a}
              accountId={accountId}
              onSuccess={onSuccess}
              canMutate={canMutate(a)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function ActivityComposer({
  accountId,
  onSuccess,
  onCancel,
}: {
  accountId: string;
  onSuccess: (d: AtelierAccountTimeline) => void;
  onCancel: () => void;
}) {
  const { data: users } = useAtelierListUsers();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<AtelierActivityType>("task");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [body, setBody] = useState("");
  const createMut = useAtelierCreateActivity({ mutation: { onSuccess } });
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    createMut.mutate({
      accountId,
      data: {
        title: t,
        type,
        ownerId: ownerId || null,
        dueDate: dueDate || null,
        body: body.trim() || null,
      },
    });
  };
  return (
    <div className="rounded-lg border border-border-soft bg-bg-soft p-3 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What happened / what needs to happen?"
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-sm text-text"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AtelierActivityType)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="task">Task</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
        </select>
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="">Owner…</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text resize-none"
      />
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onCancel} className="text-xs text-text-mute hover:text-text font-mono">
          Cancel
        </button>
        <PillButton onClick={submit} disabled={!title.trim() || createMut.isPending}>
          {createMut.isPending ? "Saving…" : "Add"}
        </PillButton>
      </div>
    </div>
  );
}

function ActivityRow({
  activity,
  accountId,
  onSuccess,
  canMutate,
}: {
  activity: AtelierActivity;
  accountId: string;
  onSuccess: (d: AtelierAccountTimeline) => void;
  canMutate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const updateMut = useAtelierUpdateActivity({ mutation: { onSuccess } });
  const deleteMut = useAtelierDeleteActivity({ mutation: { onSuccess } });
  const done = activity.status === "done";

  if (editing && canMutate) {
    return (
      <ActivityEditor
        activity={activity}
        accountId={accountId}
        onSuccess={(d) => {
          onSuccess(d);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-lg border border-border-soft bg-bg-base p-3">
      <div className="flex items-start gap-3">
        {canMutate ? (
          <button
            onClick={() =>
              updateMut.mutate({
                accountId,
                activityId: activity.id,
                data: { status: done ? "open" : "done" },
              })
            }
            disabled={updateMut.isPending}
            className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
              done
                ? "bg-emerald-400/20 border-emerald-400/40 text-emerald-300"
                : "border-border-soft text-transparent hover:border-gold"
            }`}
            title={done ? "Mark open" : "Mark done"}
          >
            <Check className="w-3 h-3" />
          </button>
        ) : (
          <span
            className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
              done
                ? "bg-emerald-400/20 border-emerald-400/40 text-emerald-300"
                : "border-border-soft text-transparent"
            }`}
          >
            <Check className="w-3 h-3" />
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone="text-text-mute border-border-soft bg-bg-soft">
              {TYPE_ICON[activity.type]} {TYPE_LABEL[activity.type] ?? activity.type}
            </Pill>
            {activity.overdue && (
              <Pill tone="text-red-300 border-red-400/30 bg-red-400/10">
                <Clock className="w-3 h-3" /> Overdue
              </Pill>
            )}
            <span
              className={`text-sm font-medium ${done ? "line-through text-text-mute" : "text-text"}`}
            >
              {activity.title}
            </span>
          </div>
          {activity.body && (
            <p className="mt-1 text-xs text-text-mute whitespace-pre-wrap">{activity.body}</p>
          )}
          <div className="mt-1 flex items-center gap-3 text-xs text-text-mute font-mono flex-wrap">
            {activity.ownerName && <span>{activity.ownerName}</span>}
            {activity.dueDate && <span>Due {activity.dueDate}</span>}
            {activity.parentLabel && (
              <span className="text-gold/80">↳ {activity.parentLabel.slice(0, 36)}</span>
            )}
          </div>
        </div>
        {canMutate && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="text-text-faint hover:text-gold p-1"
              title="Edit activity"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => deleteMut.mutate({ accountId, activityId: activity.id })}
              className="text-text-faint hover:text-red-400 p-1"
              title="Delete activity"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityEditor({
  activity,
  accountId,
  onSuccess,
  onCancel,
}: {
  activity: AtelierActivity;
  accountId: string;
  onSuccess: (d: AtelierAccountTimeline) => void;
  onCancel: () => void;
}) {
  const { data: users } = useAtelierListUsers();
  const [title, setTitle] = useState(activity.title);
  const [type, setType] = useState<AtelierActivityType>(activity.type);
  const [ownerId, setOwnerId] = useState(activity.ownerId ?? "");
  const [dueDate, setDueDate] = useState(activity.dueDate ?? "");
  const [body, setBody] = useState(activity.body ?? "");
  const updateMut = useAtelierUpdateActivity({ mutation: { onSuccess } });
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    updateMut.mutate({
      accountId,
      activityId: activity.id,
      data: {
        title: t,
        type,
        ownerId: ownerId || null,
        dueDate: dueDate || null,
        body: body.trim() || null,
      },
    });
  };
  return (
    <div className="rounded-lg border border-gold/30 bg-bg-soft p-3 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-sm text-text"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AtelierActivityType)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="task">Task</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
        </select>
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="">Owner…</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Notes (optional)"
        rows={2}
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text resize-none"
      />
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs text-text-mute hover:text-text font-mono flex items-center gap-1"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
        <PillButton onClick={submit} disabled={!title.trim() || updateMut.isPending}>
          {updateMut.isPending ? "Saving…" : "Save"}
        </PillButton>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Unified timeline
// ------------------------------------------------------------------
function TimelineSection({ timeline }: { timeline: AtelierTimelineEntry[] }) {
  return (
    <Card className="p-5 space-y-4">
      <SectionLabel className="flex items-center gap-2">
        <ActivityIcon className="w-3.5 h-3.5" /> Unified timeline
      </SectionLabel>
      {timeline.length === 0 ? (
        <p className="text-text-mute text-sm font-mono py-4 text-center">
          Nothing on the timeline yet.
        </p>
      ) : (
        <div className="space-y-0">
          {timeline.map((e, i) => (
            <div key={e.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 flex items-center justify-center w-6 h-6 rounded-full border ${
                    KIND_TONE[e.kind] ?? "text-text-mute border-border-soft bg-bg-soft"
                  }`}
                >
                  {KIND_ICON[e.kind] ?? <ActivityIcon className="w-3.5 h-3.5" />}
                </span>
                {i < timeline.length - 1 && (
                  <span className="flex-1 w-px bg-border-soft my-1" />
                )}
              </div>
              <div className="flex-1 min-w-0 pb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Pill tone={KIND_TONE[e.kind] ?? "text-text-mute border-border-soft bg-bg-soft"}>
                    {e.subtype ?? KIND_LABEL[e.kind] ?? e.kind}
                  </Pill>
                  <span className="text-sm text-text font-medium">{e.title}</span>
                </div>
                {e.detail && (
                  <p className="mt-0.5 text-xs text-text-mute font-mono">{e.detail}</p>
                )}
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-faint font-mono">
                  <span>{fmtDate(e.date)}</span>
                  {e.actorName && <span>· {e.actorName}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
