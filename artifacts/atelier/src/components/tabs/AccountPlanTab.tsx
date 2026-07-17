/**
 * AccountPlanTab — account planning & execution layer (Task #571).
 *
 * Surfaces the account action plan, account-level risk register, goal
 * progress against strategy objectives, and a one-click QBR / account-plan
 * PDF export. AI next-best-actions (from the Account 360 rollup) can be
 * promoted into owned, tracked actions.
 *
 * Reads come embedded in the account workspace; writes use the Task #571
 * CRUD mutations and replace the workspace cache on success. Write controls
 * are only shown to personas who can manage the account plan (partner-tier,
 * the account owner, or an account-team manager/delivery lead).
 */
import * as React from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  useAtelierListUsers,
  useAtelierGetAccount360,
  useAtelierCreateAccountAction,
  useAtelierUpdateAccountAction,
  useAtelierDeleteAccountAction,
  useAtelierCreateAccountRisk,
  useAtelierUpdateAccountRisk,
  useAtelierDeleteAccountRisk,
  useAtelierUpsertAccountGoalProgress,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierAccountWorkspace,
  type AtelierAccountAction,
  type AtelierAccountRisk,
  type AtelierAccountGoalProgress,
  type AtelierAccountNextBestAction,
} from "@workspace/api-client-react";
import { Card, Eyebrow, SectionLabel, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Target,
  ListChecks,
  AlertTriangle,
  Trash2,
  Plus,
  Download,
  Sparkles,
  Check,
  Pencil,
  X,
} from "lucide-react";
const apiBase = `${import.meta.env?.BASE_URL ?? "/"}api`;

const ACTION_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};
const ACTION_STATUS_ORDER = ["open", "in_progress", "done", "cancelled"] as const;
const PRIORITY_LABEL: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
const PRIORITY_TONE: Record<string, string> = {
  high: "text-red-300 border-red-400/30 bg-red-400/10",
  medium: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  low: "text-text-mute border-border-soft bg-bg-soft",
};
const RISK_KIND_LABEL: Record<string, string> = {
  risk: "Risk",
  assumption: "Assumption",
  issue: "Issue",
  dependency: "Dependency",
};
const RISK_STATUS_ORDER = ["open", "mitigating", "closed"] as const;
const RISK_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  mitigating: "Mitigating",
  closed: "Closed",
};
const SEVERITY_TONE: Record<string, string> = {
  red: "bg-red-400",
  amber: "bg-amber-400",
  green: "bg-emerald-400",
};
const GOAL_STATUS_LABEL: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  achieved: "Achieved",
};
const GOAL_STATUS_TONE: Record<string, string> = {
  on_track: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  at_risk: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  off_track: "text-red-300 border-red-400/30 bg-red-400/10",
  achieved: "text-sky-300 border-sky-400/30 bg-sky-400/10",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${tone}`}
    >
      {children}
    </span>
  );
}

export function AccountPlanTab({
  ws,
  accountId,
}: {
  ws: AtelierAccountWorkspace;
  accountId: string;
}) {
  const qc = useQueryClient();
  const { data: me } = useAtelierGetMe();
  const wsKey = getAtelierGetAccountWorkspaceQueryKey(accountId);
  const onSuccess = (data: AtelierAccountWorkspace) => qc.setQueryData(wsKey, data);

  const actions = ws.actionPlan ?? [];
  const risks = ws.riskRegister ?? [];
  const goals = ws.goalProgress ?? [];

  // Manage gate mirrors the server-side canManageAccountPlan: partner-tier,
  // the account owner, or an account-team manager / delivery lead.
  const team = ws.accountTeam ?? [];
  const myTeamRole = me ? team.find((t) => t.userId === me.id)?.roleOnAccount : undefined;
  const canManage = !!me && (
    ["founding_partner", "partner", "senior_manager"].includes(me.role) ||
    ws.account.partnerOwnerId === me.id ||
    (!!myTeamRole && ["account_manager", "delivery_lead", "partner"].includes(myTeamRole))
  );

  const objectives = ws.account.accountStrategy?.objectives ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Eyebrow className="flex items-center gap-2">
          <ListChecks className="w-3.5 h-3.5" /> Account plan & execution
        </Eyebrow>
        <a
          href={`${apiBase}/atelier/accounts/${accountId}/plan.pdf`}
          target="_blank"
          rel="noreferrer"
        >
          <PillButton className="flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export QBR PDF
          </PillButton>
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ActionPlanSection
            actions={actions}
            accountId={accountId}
            canManage={canManage}
            objectives={objectives}
            onSuccess={onSuccess}
          />
          <RiskRegisterSection
            risks={risks}
            accountId={accountId}
            canManage={canManage}
            onSuccess={onSuccess}
          />
        </div>
        <div className="lg:col-span-1 space-y-6">
          <GoalProgressSection
            goals={goals}
            accountId={accountId}
            canManage={canManage}
            onSuccess={onSuccess}
          />
          {canManage && (
            <NextBestActionsSection
              accountId={accountId}
              existing={actions}
              onSuccess={onSuccess}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Action plan
// ------------------------------------------------------------------
function ActionPlanSection({
  actions,
  accountId,
  canManage,
  objectives,
  onSuccess,
}: {
  actions: AtelierAccountAction[];
  accountId: string;
  canManage: boolean;
  objectives: Array<{ id: string; text: string }>;
  onSuccess: (d: AtelierAccountWorkspace) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-2">
          <ListChecks className="w-3.5 h-3.5" /> Action plan
        </SectionLabel>
        {canManage && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="text-xs text-gold hover:text-gold/80 flex items-center gap-1 font-mono"
          >
            <Plus className="w-3.5 h-3.5" /> Add action
          </button>
        )}
      </div>
      {adding && canManage && (
        <ActionComposer
          accountId={accountId}
          objectives={objectives}
          onSuccess={(d) => {
            onSuccess(d);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {actions.length === 0 ? (
        <p className="text-text-mute text-sm font-mono py-4 text-center">
          No actions yet. {canManage ? "Add the first move for this account." : ""}
        </p>
      ) : (
        <div className="space-y-2">
          {actions.map((a) => (
            <ActionRow
              key={a.id}
              action={a}
              accountId={accountId}
              canManage={canManage}
              objectives={objectives}
              onSuccess={onSuccess}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function ActionComposer({
  accountId,
  objectives,
  onSuccess,
  onCancel,
}: {
  accountId: string;
  objectives: Array<{ id: string; text: string }>;
  onSuccess: (d: AtelierAccountWorkspace) => void;
  onCancel: () => void;
}) {
  const { data: users } = useAtelierListUsers();
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [dueDate, setDueDate] = useState("");
  const [objectiveId, setObjectiveId] = useState("");
  const createMut = useAtelierCreateAccountAction({
    mutation: { onSuccess },
  });
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    createMut.mutate({
      accountId,
      data: {
        title: t,
        ownerId: ownerId || null,
        priority,
        dueDate: dueDate || null,
        linkedObjectiveId: objectiveId || null,
      },
    });
  };
  return (
    <div className="rounded-lg border border-border-soft bg-bg-soft p-3 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs to happen?"
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-sm text-text"
      />
      <div className="grid grid-cols-2 gap-2">
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
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as "high" | "medium" | "low")}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        />
        <select
          value={objectiveId}
          onChange={(e) => setObjectiveId(e.target.value)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="">Link objective…</option>
          {objectives.map((o) => (
            <option key={o.id} value={o.id}>
              {o.text.slice(0, 48)}
            </option>
          ))}
        </select>
      </div>
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

function ActionRow({
  action,
  accountId,
  canManage,
  objectives,
  onSuccess,
}: {
  action: AtelierAccountAction;
  accountId: string;
  canManage: boolean;
  objectives: Array<{ id: string; text: string }>;
  onSuccess: (d: AtelierAccountWorkspace) => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateMut = useAtelierUpdateAccountAction({ mutation: { onSuccess } });
  const deleteMut = useAtelierDeleteAccountAction({ mutation: { onSuccess } });
  const done = action.status === "done" || action.status === "cancelled";
  const objectiveText =
    action.linkedObjectiveText ??
    objectives.find((o) => o.id === action.linkedObjectiveId)?.text ??
    null;

  if (editing && canManage) {
    return (
      <ActionEditor
        action={action}
        accountId={accountId}
        objectives={objectives}
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={PRIORITY_TONE[action.priority] ?? PRIORITY_TONE.medium}>
              {PRIORITY_LABEL[action.priority] ?? action.priority}
            </Pill>
            {action.source === "promoted" && (
              <Pill tone="text-sky-300 border-sky-400/30 bg-sky-400/10">AI</Pill>
            )}
            <span
              className={`text-sm font-medium ${done ? "line-through text-text-mute" : "text-text"}`}
            >
              {action.title}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-text-mute font-mono flex-wrap">
            {action.ownerName && <span>{action.ownerName}</span>}
            {action.dueDate && <span>Due {action.dueDate}</span>}
            {objectiveText && (
              <span className="text-gold/80">↳ {objectiveText.slice(0, 40)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canManage ? (
            <select
              value={action.status}
              onChange={(e) =>
                updateMut.mutate({
                  accountId,
                  actionId: action.id,
                  data: { status: e.target.value as AtelierAccountAction["status"] },
                })
              }
              className="bg-bg-soft border border-border-soft rounded px-1.5 py-1 text-[10px] text-text font-mono"
            >
              {ACTION_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {ACTION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            <Pill tone="text-text-mute border-border-soft bg-bg-soft">
              {ACTION_STATUS_LABEL[action.status] ?? action.status}
            </Pill>
          )}
          {canManage && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="text-text-faint hover:text-gold p-1"
                title="Edit action"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => deleteMut.mutate({ accountId, actionId: action.id })}
                className="text-text-faint hover:text-red-400 p-1"
                title="Delete action"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionEditor({
  action,
  accountId,
  objectives,
  onSuccess,
  onCancel,
}: {
  action: AtelierAccountAction;
  accountId: string;
  objectives: Array<{ id: string; text: string }>;
  onSuccess: (d: AtelierAccountWorkspace) => void;
  onCancel: () => void;
}) {
  const { data: users } = useAtelierListUsers();
  const [title, setTitle] = useState(action.title);
  const [ownerId, setOwnerId] = useState(action.ownerId ?? "");
  const [priority, setPriority] = useState<"high" | "medium" | "low">(
    (action.priority as "high" | "medium" | "low") ?? "medium",
  );
  const [dueDate, setDueDate] = useState(action.dueDate ?? "");
  const [objectiveId, setObjectiveId] = useState(action.linkedObjectiveId ?? "");
  const updateMut = useAtelierUpdateAccountAction({ mutation: { onSuccess } });
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    updateMut.mutate({
      accountId,
      actionId: action.id,
      data: {
        title: t,
        ownerId: ownerId || null,
        priority,
        dueDate: dueDate || null,
        linkedObjectiveId: objectiveId || null,
      },
    });
  };
  return (
    <div className="rounded-lg border border-gold/30 bg-bg-soft p-3 space-y-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs to happen?"
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-sm text-text"
      />
      <div className="grid grid-cols-2 gap-2">
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
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as "high" | "medium" | "low")}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        />
        <select
          value={objectiveId}
          onChange={(e) => setObjectiveId(e.target.value)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="">Link objective…</option>
          {objectives.map((o) => (
            <option key={o.id} value={o.id}>
              {o.text.slice(0, 48)}
            </option>
          ))}
        </select>
      </div>
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
// Risk register
// ------------------------------------------------------------------
function RiskRegisterSection({
  risks,
  accountId,
  canManage,
  onSuccess,
}: {
  risks: AtelierAccountRisk[];
  accountId: string;
  canManage: boolean;
  onSuccess: (d: AtelierAccountWorkspace) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <SectionLabel className="flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> Account risk register
        </SectionLabel>
        {canManage && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="text-xs text-gold hover:text-gold/80 flex items-center gap-1 font-mono"
          >
            <Plus className="w-3.5 h-3.5" /> Log risk
          </button>
        )}
      </div>
      {adding && canManage && (
        <RiskComposer
          accountId={accountId}
          onSuccess={(d) => {
            onSuccess(d);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      {risks.length === 0 ? (
        <p className="text-text-mute text-sm font-mono py-4 text-center">
          No account-level risks logged.
        </p>
      ) : (
        <div className="space-y-2">
          {risks.map((r) => (
            <RiskRow
              key={r.id}
              risk={r}
              accountId={accountId}
              canManage={canManage}
              onSuccess={onSuccess}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function RiskComposer({
  accountId,
  onSuccess,
  onCancel,
}: {
  accountId: string;
  onSuccess: (d: AtelierAccountWorkspace) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"risk" | "assumption" | "issue" | "dependency">("risk");
  const [severity, setSeverity] = useState<"green" | "amber" | "red">("amber");
  const [mitigation, setMitigation] = useState("");
  const createMut = useAtelierCreateAccountRisk({ mutation: { onSuccess } });
  const submit = () => {
    const d = description.trim();
    if (!d) return;
    createMut.mutate({
      accountId,
      data: { description: d, kind, severity, mitigation: mitigation.trim() || null },
    });
  };
  return (
    <div className="rounded-lg border border-border-soft bg-bg-soft p-3 space-y-2">
      <input
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the risk / assumption / issue / dependency"
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-sm text-text"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="risk">Risk</option>
          <option value="assumption">Assumption</option>
          <option value="issue">Issue</option>
          <option value="dependency">Dependency</option>
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as typeof severity)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="red">Red</option>
          <option value="amber">Amber</option>
          <option value="green">Green</option>
        </select>
      </div>
      <input
        value={mitigation}
        onChange={(e) => setMitigation(e.target.value)}
        placeholder="Mitigation (optional)"
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-sm text-text"
      />
      <div className="flex items-center gap-2 justify-end">
        <button onClick={onCancel} className="text-xs text-text-mute hover:text-text font-mono">
          Cancel
        </button>
        <PillButton onClick={submit} disabled={!description.trim() || createMut.isPending}>
          {createMut.isPending ? "Saving…" : "Log"}
        </PillButton>
      </div>
    </div>
  );
}

function RiskRow({
  risk,
  accountId,
  canManage,
  onSuccess,
}: {
  risk: AtelierAccountRisk;
  accountId: string;
  canManage: boolean;
  onSuccess: (d: AtelierAccountWorkspace) => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateMut = useAtelierUpdateAccountRisk({ mutation: { onSuccess } });
  const deleteMut = useAtelierDeleteAccountRisk({ mutation: { onSuccess } });
  const closed = risk.status === "closed";

  if (editing && canManage) {
    return (
      <RiskEditor
        risk={risk}
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
        <span
          className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY_TONE[risk.severity] ?? SEVERITY_TONE.amber}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone="text-text-mute border-border-soft bg-bg-soft">
              {RISK_KIND_LABEL[risk.kind] ?? risk.kind}
            </Pill>
            <span className={`text-sm ${closed ? "line-through text-text-mute" : "text-text"}`}>
              {risk.description}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-text-mute font-mono flex-wrap">
            {risk.ownerName && <span>{risk.ownerName}</span>}
            {risk.dueDate && <span>Due {risk.dueDate}</span>}
            {risk.mitigation && <span className="italic">Mitigation: {risk.mitigation}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canManage ? (
            <select
              value={risk.status}
              onChange={(e) =>
                updateMut.mutate({
                  accountId,
                  riskId: risk.id,
                  data: { status: e.target.value as AtelierAccountRisk["status"] },
                })
              }
              className="bg-bg-soft border border-border-soft rounded px-1.5 py-1 text-[10px] text-text font-mono"
            >
              {RISK_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {RISK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            <Pill tone="text-text-mute border-border-soft bg-bg-soft">
              {RISK_STATUS_LABEL[risk.status] ?? risk.status}
            </Pill>
          )}
          {canManage && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="text-text-faint hover:text-gold p-1"
                title="Edit risk"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => deleteMut.mutate({ accountId, riskId: risk.id })}
                className="text-text-faint hover:text-red-400 p-1"
                title="Delete risk"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RiskEditor({
  risk,
  accountId,
  onSuccess,
  onCancel,
}: {
  risk: AtelierAccountRisk;
  accountId: string;
  onSuccess: (d: AtelierAccountWorkspace) => void;
  onCancel: () => void;
}) {
  const { data: users } = useAtelierListUsers();
  const [description, setDescription] = useState(risk.description);
  const [kind, setKind] = useState<"risk" | "assumption" | "issue" | "dependency">(
    (risk.kind as "risk" | "assumption" | "issue" | "dependency") ?? "risk",
  );
  const [severity, setSeverity] = useState<"green" | "amber" | "red">(
    (risk.severity as "green" | "amber" | "red") ?? "amber",
  );
  const [ownerId, setOwnerId] = useState(risk.ownerId ?? "");
  const [dueDate, setDueDate] = useState(risk.dueDate ?? "");
  const [mitigation, setMitigation] = useState(risk.mitigation ?? "");
  const updateMut = useAtelierUpdateAccountRisk({ mutation: { onSuccess } });
  const submit = () => {
    const d = description.trim();
    if (!d) return;
    updateMut.mutate({
      accountId,
      riskId: risk.id,
      data: {
        description: d,
        kind,
        severity,
        ownerId: ownerId || null,
        dueDate: dueDate || null,
        mitigation: mitigation.trim() || null,
      },
    });
  };
  return (
    <div className="rounded-lg border border-gold/30 bg-bg-soft p-3 space-y-2">
      <input
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe the risk / assumption / issue / dependency"
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-sm text-text"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="risk">Risk</option>
          <option value="assumption">Assumption</option>
          <option value="issue">Issue</option>
          <option value="dependency">Dependency</option>
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as typeof severity)}
          className="bg-bg-base border border-border-soft rounded px-2 py-1.5 text-xs text-text"
        >
          <option value="red">Red</option>
          <option value="amber">Amber</option>
          <option value="green">Green</option>
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
      <input
        value={mitigation}
        onChange={(e) => setMitigation(e.target.value)}
        placeholder="Mitigation (optional)"
        className="w-full bg-bg-base border border-border-soft rounded px-2 py-1.5 text-sm text-text"
      />
      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs text-text-mute hover:text-text font-mono flex items-center gap-1"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
        <PillButton onClick={submit} disabled={!description.trim() || updateMut.isPending}>
          {updateMut.isPending ? "Saving…" : "Save"}
        </PillButton>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Goal progress
// ------------------------------------------------------------------
function GoalProgressSection({
  goals,
  accountId,
  canManage,
  onSuccess,
}: {
  goals: AtelierAccountGoalProgress[];
  accountId: string;
  canManage: boolean;
  onSuccess: (d: AtelierAccountWorkspace) => void;
}) {
  return (
    <Card className="p-5 space-y-4">
      <SectionLabel className="flex items-center gap-2">
        <Target className="w-3.5 h-3.5" /> Goal progress
      </SectionLabel>
      {goals.length === 0 ? (
        <p className="text-text-mute text-sm font-mono py-4 text-center">
          No strategy objectives defined yet.
        </p>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => (
            <GoalRow
              key={g.objectiveId}
              goal={g}
              accountId={accountId}
              canManage={canManage}
              onSuccess={onSuccess}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function GoalRow({
  goal,
  accountId,
  canManage,
  onSuccess,
}: {
  goal: AtelierAccountGoalProgress;
  accountId: string;
  canManage: boolean;
  onSuccess: (d: AtelierAccountWorkspace) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [currentValue, setCurrentValue] = useState(goal.currentValue ?? "");
  const [status, setStatus] = useState(goal.status);
  const [note, setNote] = useState(goal.note ?? "");
  const upsertMut = useAtelierUpsertAccountGoalProgress({
    mutation: {
      onSuccess: (d) => {
        onSuccess(d);
        setEditing(false);
      },
    },
  });
  const save = () =>
    upsertMut.mutate({
      accountId,
      objectiveId: goal.objectiveId,
      data: { currentValue: currentValue.trim() || null, status, note: note.trim() || null },
    });
  return (
    <div className="rounded-lg border border-border-soft bg-bg-base p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-text">{goal.text}</span>
        <Pill tone={GOAL_STATUS_TONE[goal.status] ?? GOAL_STATUS_TONE.on_track}>
          {GOAL_STATUS_LABEL[goal.status] ?? goal.status}
        </Pill>
      </div>
      <div className="text-xs text-text-mute font-mono">
        {goal.currentValue ?? "—"}
        {goal.targetValue ? ` of ${goal.targetValue}` : ""}
        {goal.targetDate ? ` · by ${goal.targetDate}` : ""}
      </div>
      {goal.note && !editing && <div className="text-xs text-text-mute italic">{goal.note}</div>}
      {canManage && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-[11px] text-gold hover:text-gold/80 font-mono"
        >
          Update progress
        </button>
      )}
      {editing && (
        <div className="space-y-2 pt-1">
          <input
            value={currentValue}
            onChange={(e) => setCurrentValue(e.target.value)}
            placeholder="Current value"
            className="w-full bg-bg-soft border border-border-soft rounded px-2 py-1 text-xs text-text"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="w-full bg-bg-soft border border-border-soft rounded px-2 py-1 text-xs text-text"
          >
            <option value="on_track">On track</option>
            <option value="at_risk">At risk</option>
            <option value="off_track">Off track</option>
            <option value="achieved">Achieved</option>
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full bg-bg-soft border border-border-soft rounded px-2 py-1 text-xs text-text"
          />
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-text-mute hover:text-text font-mono"
            >
              Cancel
            </button>
            <PillButton onClick={save} disabled={upsertMut.isPending}>
              {upsertMut.isPending ? "Saving…" : "Save"}
            </PillButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// AI next-best-actions → promote into owned actions
// ------------------------------------------------------------------
function NextBestActionsSection({
  accountId,
  existing,
  onSuccess,
}: {
  accountId: string;
  existing: AtelierAccountAction[];
  onSuccess: (d: AtelierAccountWorkspace) => void;
}) {
  const { data, isLoading } = useAtelierGetAccount360(accountId);
  const createMut = useAtelierCreateAccountAction({ mutation: { onSuccess } });
  const nbas: AtelierAccountNextBestAction[] = data?.nextBestActions ?? [];
  // Hide suggestions already promoted (matched by sourceRef on existing actions).
  const promotedRefs = new Set(
    existing.filter((a) => a.source === "promoted" && a.sourceRef).map((a) => a.sourceRef),
  );
  const open = nbas.filter((n) => !promotedRefs.has(n.id));

  if (isLoading) return <Skeleton className="h-40 bg-bg-elevate" />;
  if (!data || open.length === 0) return null;

  return (
    <Card className="p-5 space-y-3 border-sky-400/20 bg-sky-400/[0.02]">
      <SectionLabel className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5" /> AI next-best-actions
      </SectionLabel>
      <p className="text-xs text-text-mute">
        Suggested by the Account 360 engine. Promote one to add it to the owned
        action plan.
      </p>
      <div className="space-y-2">
        {open.map((n) => (
          <div
            key={n.id}
            className="rounded-lg border border-border-soft bg-bg-base p-3 space-y-2"
          >
            <div className="text-sm text-text">{n.label}</div>
            {n.detail && <div className="text-xs text-text-mute">{n.detail}</div>}
            <button
              onClick={() =>
                createMut.mutate({
                  accountId,
                  data: {
                    title: n.label,
                    detail: n.detail ?? null,
                    priority: n.priority,
                    source: "promoted",
                    sourceRef: n.id,
                  },
                })
              }
              disabled={createMut.isPending}
              className="text-xs text-gold hover:text-gold/80 flex items-center gap-1 font-mono"
            >
              <Check className="w-3.5 h-3.5" /> Promote to action
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
