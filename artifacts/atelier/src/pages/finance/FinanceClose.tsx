/**
 * FinanceClose — period close, reconciliations, adjusting entries and
 * two-partner sign-off (Task #416, Wave 4).
 *
 * Per-entity close workspace with five tabs:
 *   1. Overview — KPIs (days to close, checklist %, open recs, sign-off)
 *   2. Checklist — standard task library with maker/checker + dependencies
 *   3. Reconciliations — bank / AR / AP / IC / payroll / VAT control accounts
 *   4. Adjustments — accruals, deferrals, FX revaluation (maker-checker)
 *   5. Sign-off & audit trail — two-partner lock + immutable event log
 *
 * State lives in the in-memory close store (finance-close-seed.ts) and
 * is shared across the dashboard mini-cards on FinanceHome.
 */

import * as React from "react";
import { useSyncExternalStore } from "react";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip, PillButton } from "@/components/ui/primitives";
import { useFinanceEntities, type FinanceEntityRow } from "@/lib/v5-hooks";
import {
  subscribeCloseStore,
  getCloseSnapshot,
  completeTask,
  reopenTask,
  reviewRec,
  signRec,
  postAdjustment,
  signPeriod,
  openPeriod,
  statusForEntity,
  userById,
  type CloseUser,
  type ClosePeriod,
  type CloseTask,
  type Reconciliation,
  type AdjustingEntry,
  type CloseStatusForEntity,
  type ControlAccountKind,
} from "@/data/finance-close-seed";
import { Lock, CheckCircle2, AlertTriangle, Clock, ShieldCheck } from "lucide-react";

const CONTROL_LABEL: Record<ControlAccountKind, string> = {
  bank: "Bank",
  ar: "AR control",
  ap: "AP control",
  ic: "Inter-co",
  payroll: "Payroll",
  vat: "VAT control",
};

function useCloseStore() {
  return useSyncExternalStore(subscribeCloseStore, getCloseSnapshot, getCloseSnapshot);
}

function fmtMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relativeDays(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (d === 0) return "today";
  if (d > 0) return `in ${d}d`;
  return `${Math.abs(d)}d ago`;
}

// ────────────────────────── Persona picker ──────────────────────────
function PersonaPicker({ users, value, onChange }: { users: CloseUser[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs font-mono text-text-mute">
      Acting as
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text"
        data-testid="close-persona-picker"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
        ))}
      </select>
    </label>
  );
}

// ────────────────────────── KPI tiles ──────────────────────────
function KpiTile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "amber" | "red" | "green" | "gold" }) {
  const ring = tone === "red" ? "border-danger/40 bg-danger/5"
    : tone === "amber" ? "border-amber-500/40 bg-amber-500/5"
    : tone === "green" ? "border-emerald-500/40 bg-emerald-500/5"
    : tone === "gold" ? "border-gold/40 bg-gold/5"
    : "border-border-soft";
  return (
    <Card className={`p-4 ${ring}`}>
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">{label}</div>
      <div className="text-2xl font-light text-text mt-1">{value}</div>
      {sub && <div className="text-xs text-text-mute mt-1">{sub}</div>}
    </Card>
  );
}

function OverviewPanel({
  status, period, adjustments,
}: {
  status: CloseStatusForEntity;
  period: ClosePeriod | null;
  adjustments: AdjustingEntry[];
}) {
  if (!period) {
    return <Card className="p-6 text-sm text-text-mute">No close period open for this entity.</Card>;
  }
  const daysToneTarget = status.daysToCloseActual != null && status.daysToCloseActual <= status.daysToCloseTarget ? "green" : "amber";
  const draftAdjs = adjustments.filter((a) => a.status === "draft").length;
  const postedAdjs = adjustments.filter((a) => a.status === "posted").length;
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3" data-testid="close-overview-tiles">
      <KpiTile
        label="Days to close"
        value={<>{status.daysToCloseActual ?? "—"} <span className="text-base text-text-mute">/ {status.daysToCloseTarget}</span></>}
        sub={status.daysToCloseActual == null ? `Target ${period.targetCloseOn}` : `Actual close ${period.actualCloseOn}`}
        tone={status.daysToCloseActual == null ? "default" : daysToneTarget}
      />
      <KpiTile
        label="Checklist progress"
        value={`${status.checklistPct}%`}
        sub={`${period.periodLabel} · status ${period.status.replace("_", " ")}`}
        tone={status.checklistPct === 100 ? "green" : status.checklistPct >= 50 ? "gold" : "amber"}
      />
      <KpiTile
        label="Open reconciliations"
        value={`${status.openRecs} / ${status.totalRecs}`}
        sub={status.openRecs === 0 ? "All recs signed" : `${status.totalRecs - status.openRecs} signed`}
        tone={status.openRecs === 0 ? "green" : "amber"}
      />
      <KpiTile
        label="Open adjustments"
        value={`${draftAdjs} / ${adjustments.length}`}
        sub={draftAdjs === 0 ? `${postedAdjs} posted` : `${draftAdjs} draft, ${postedAdjs} posted`}
        tone={draftAdjs === 0 ? "green" : "amber"}
      />
      <KpiTile
        label="Sign-off"
        value={
          <span className="flex items-center gap-2">
            {status.signOffsCount} / {status.signOffsRequired}
            {period.locked && <Lock className="w-4 h-4 text-emerald-400" />}
          </span>
        }
        sub={period.locked ? "Period locked (immutable)" : "Two distinct partner roles required"}
        tone={period.locked ? "green" : status.signOffsCount > 0 ? "gold" : "default"}
      />
    </div>
  );
}

// ────────────────────────── Checklist tab ──────────────────────────
function TaskDrawer({
  task, allTasks, period, actor, onClose,
}: {
  task: CloseTask;
  allTasks: CloseTask[];
  period: ClosePeriod;
  actor: CloseUser;
  onClose: () => void;
}) {
  const owner = userById(task.ownerId);
  const prep = task.preparedById ? userById(task.preparedById) : null;
  const rev = task.reviewedById ? userById(task.reviewedById) : null;
  const deps = task.dependsOn
    .map((d) => allTasks.find((t) => t.id === d))
    .filter(Boolean) as CloseTask[];
  const blockers = deps.filter((d) => d.status !== "done" && d.status !== "na");
  return (
    <div
      className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-50 flex justify-end"
      onClick={onClose}
      data-testid="close-task-drawer"
    >
      <div
        className="w-full max-w-md h-full bg-bg-elevate border-l border-border-soft overflow-y-auto p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>Task {task.code}</Eyebrow>
            <h3 className="text-lg text-text font-medium mt-1">{task.title}</h3>
          </div>
          <button onClick={onClose} className="text-text-mute hover:text-text text-xl leading-none" data-testid="close-task-drawer-close">×</button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[10px] uppercase font-mono text-text-faint">Owner</div>
            <div className="text-text mt-0.5">{owner?.name ?? "—"}</div>
            <div className="text-text-mute">{owner?.role ?? ""}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono text-text-faint">Due</div>
            <div className="font-mono text-text mt-0.5">{task.dueDate}</div>
            <div className="text-text-mute">{relativeDays(task.dueDate)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono text-text-faint">Status</div>
            <MonoChip tone={task.status === "done" ? "green" : task.status === "in_progress" ? "gold" : "default"}>
              {task.status.replace("_", " ")}
            </MonoChip>
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono text-text-faint">Completed</div>
            <div className="font-mono text-text mt-0.5">{task.completedOn ?? "—"}</div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase font-mono text-text-faint mb-1">Maker / checker</div>
          <div className="text-xs text-text">Prepared by: {prep ? `${prep.name} (${prep.role})` : "—"}</div>
          <div className="text-xs text-text">Reviewed by: {rev ? `${rev.name} (${rev.role})` : "—"}</div>
        </div>

        <div>
          <div className="text-[10px] uppercase font-mono text-text-faint mb-1">Dependencies</div>
          {deps.length === 0 ? (
            <div className="text-xs text-text-faint">— none</div>
          ) : (
            <ul className="space-y-1">
              {deps.map((d) => (
                <li key={d.id} className="text-xs flex items-baseline justify-between gap-2 border-b border-border-soft pb-1">
                  <span className="text-text">{d.code} · {d.title}</span>
                  <MonoChip tone={d.status === "done" ? "green" : "amber"}>{d.status.replace("_", " ")}</MonoChip>
                </li>
              ))}
            </ul>
          )}
          {blockers.length > 0 && task.status !== "done" && (
            <div className="text-[11px] text-amber-400 mt-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Blocked by {blockers.length} open dependenc{blockers.length === 1 ? "y" : "ies"}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase font-mono text-text-faint mb-1">Evidence</div>
          {task.evidenceLink ? (
            <div className="text-xs font-mono text-text-mute break-all">{task.evidenceLink}</div>
          ) : (
            <div className="text-xs text-text-faint">— no evidence attached</div>
          )}
        </div>

        {!period.locked && (
          <div className="pt-3 border-t border-border-soft flex gap-2">
            {task.status !== "done" && (
              <PillButton
                variant="primary"
                disabled={blockers.length > 0}
                onClick={() => { completeTask(task.id, actor); onClose(); }}
                data-testid="drawer-btn-complete"
              >
                Complete task
              </PillButton>
            )}
            {task.status === "done" && (
              <PillButton variant="ghost" onClick={() => { reopenTask(task.id, actor); onClose(); }} data-testid="drawer-btn-reopen">
                Reopen
              </PillButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistPanel({ tasks, period, actor }: { tasks: CloseTask[]; period: ClosePeriod; actor: CloseUser }) {
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null);
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;
  return (
    <>
    <Card className="overflow-hidden">
      <table className="w-full text-sm" data-testid="close-checklist">
        <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
          <tr>
            <th className="text-left px-3 py-2">#</th>
            <th className="text-left px-3 py-2">Task</th>
            <th className="text-left px-3 py-2">Owner</th>
            <th className="text-left px-3 py-2">Due</th>
            <th className="text-left px-3 py-2">Depends on</th>
            <th className="text-left px-3 py-2">Maker / Checker</th>
            <th className="text-left px-3 py-2">Evidence</th>
            <th className="text-left px-3 py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const owner = userById(t.ownerId);
            const prep = t.preparedById ? userById(t.preparedById)?.name : null;
            const rev = t.reviewedById ? userById(t.reviewedById)?.name : null;
            const blocked = t.dependsOn.some((d) => {
              const dep = tasks.find((x) => x.id === d);
              return dep && dep.status !== "done" && dep.status !== "na";
            });
            const tone =
              t.status === "done" ? "green" :
              t.status === "in_progress" ? "gold" :
              t.status === "na" ? "default" : "default";
            return (
              <tr
                key={t.id}
                className="border-t border-border-soft hover:bg-bg-elevate/40 cursor-pointer"
                data-testid={`close-task-${t.code}`}
                onClick={() => setOpenTaskId(t.id)}
              >
                <td className="px-3 py-2 font-mono text-xs text-text-mute">{t.code}</td>
                <td className="px-3 py-2 text-text underline-offset-2 hover:underline">{t.title}</td>
                <td className="px-3 py-2 text-text-mute">{owner?.name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{t.dueDate}</td>
                <td className="px-3 py-2 text-xs text-text-faint">
                  {t.dependsOn.length === 0 ? "—" : t.dependsOn.map((d) => d.split("_").pop()).join(", ")}
                </td>
                <td className="px-3 py-2 text-xs text-text-mute">
                  {prep ? <>P: {prep}</> : "—"}
                  {rev && <><br />R: {rev}</>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {t.evidenceLink ? <span className="font-mono text-text-faint">{t.evidenceLink.replace("evidence://", "")}</span> : "—"}
                </td>
                <td className="px-3 py-2">
                  <MonoChip tone={tone}>{t.status.replace("_", " ")}</MonoChip>
                  {blocked && t.status === "pending" && (
                    <div className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> blocked
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {!period.locked && t.status !== "done" && (
                    <PillButton
                      variant="primary"
                      disabled={blocked}
                      onClick={() => completeTask(t.id, actor)}
                      data-testid={`btn-complete-${t.code}`}
                    >
                      Complete
                    </PillButton>
                  )}
                  {!period.locked && t.status === "done" && (
                    <PillButton
                      variant="ghost"
                      onClick={() => reopenTask(t.id, actor)}
                      data-testid={`btn-reopen-${t.code}`}
                    >
                      Reopen
                    </PillButton>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
    {openTask && (
      <TaskDrawer
        task={openTask}
        allTasks={tasks}
        period={period}
        actor={actor}
        onClose={() => setOpenTaskId(null)}
      />
    )}
    </>
  );
}

// ────────────────────────── Reconciliations tab ──────────────────────────
function ReconciliationsPanel({ recs, period, actor }: { recs: Reconciliation[]; period: ClosePeriod; actor: CloseUser }) {
  return (
    <div className="space-y-3" data-testid="close-recs">
      {recs.length === 0 && <Card className="p-6 text-sm text-text-mute">No reconciliations seeded for this period.</Card>}
      {recs.map((r) => {
        const variance = Math.round((r.ledgerBalance - r.sourceBalance) * 100) / 100;
        const itemsTotal = r.items.reduce((s, i) => s + i.amount, 0);
        const residual = Math.round((variance - itemsTotal) * 100) / 100;
        const prep = r.preparedById ? userById(r.preparedById)?.name : null;
        const rev = r.reviewedById ? userById(r.reviewedById)?.name : null;
        const tone = r.status === "signed" ? "green" : r.status === "in_review" ? "gold" : "amber";
        const blockSign = r.preparedById === actor.id;
        return (
          <Card key={r.id} className="p-4 space-y-3" data-testid={`close-rec-${r.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow>{CONTROL_LABEL[r.controlAccount]}</Eyebrow>
                <div className="text-base text-text font-medium mt-0.5">{r.label}</div>
                <div className="text-xs text-text-mute">Source: {r.sourceLabel}</div>
              </div>
              <MonoChip tone={tone}>{r.status.replace("_", " ")}</MonoChip>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <div className="border border-border-soft rounded p-2">
                <div className="text-[10px] uppercase font-mono text-text-faint">Ledger balance</div>
                <div className="font-mono text-text mt-0.5">{fmtMoney(r.ledgerBalance, r.currency)}</div>
              </div>
              <div className="border border-border-soft rounded p-2">
                <div className="text-[10px] uppercase font-mono text-text-faint">Source-of-truth</div>
                <div className="font-mono text-text mt-0.5">{fmtMoney(r.sourceBalance, r.currency)}</div>
              </div>
              <div className={`border rounded p-2 ${Math.abs(residual) < 0.01 ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                <div className="text-[10px] uppercase font-mono text-text-faint">Variance (residual)</div>
                <div className="font-mono text-text mt-0.5">
                  {fmtMoney(variance, r.currency)}
                  {r.items.length > 0 && (
                    <span className="text-xs text-text-mute"> · residual {fmtMoney(residual, r.currency)}</span>
                  )}
                </div>
              </div>
            </div>

            {r.items.length > 0 && (
              <div className="text-xs">
                <div className="text-[10px] uppercase font-mono text-text-faint mb-1">Reconciling items</div>
                <ul className="space-y-1">
                  {r.items.map((i) => (
                    <li key={i.id} className="flex justify-between border-b border-border-soft pb-1">
                      <span className="text-text">{i.description}</span>
                      <span className="font-mono text-text-mute">{fmtMoney(i.amount, r.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="text-text-mute">
                <span>Prepared by: {prep ?? "—"}</span>
                <span className="mx-2 text-text-faint">·</span>
                <span>Reviewed by: {rev ?? "—"}</span>
                {r.signedOn && <><span className="mx-2 text-text-faint">·</span><span>Signed {r.signedOn.slice(0, 10)}</span></>}
              </div>
              {!period.locked && (
                <div className="flex gap-2">
                  {r.status === "open" && (
                    <PillButton variant="ghost" onClick={() => reviewRec(r.id, actor)} data-testid={`btn-review-${r.id}`}>
                      Mark in-review
                    </PillButton>
                  )}
                  {r.status === "in_review" && (
                    <PillButton
                      variant="primary"
                      disabled={blockSign}
                      onClick={() => signRec(r.id, actor)}
                      data-testid={`btn-sign-rec-${r.id}`}
                      title={blockSign ? "Maker cannot also be the checker" : "Sign reconciliation"}
                    >
                      Sign
                    </PillButton>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ────────────────────────── Adjustments tab ──────────────────────────
function AdjustmentsPanel({ adjustments, period, actor }: { adjustments: AdjustingEntry[]; period: ClosePeriod; actor: CloseUser }) {
  return (
    <Card className="overflow-hidden" data-testid="close-adjustments">
      <table className="w-full text-sm">
        <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
          <tr>
            <th className="text-left px-3 py-2">Kind</th>
            <th className="text-left px-3 py-2">Narrative</th>
            <th className="text-left px-3 py-2">Dr / Cr</th>
            <th className="text-right px-3 py-2">Amount</th>
            <th className="text-left px-3 py-2">Maker / Checker</th>
            <th className="text-left px-3 py-2">Source</th>
            <th className="text-left px-3 py-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {adjustments.length === 0 && (
            <tr><td colSpan={8} className="px-3 py-8 text-center text-text-mute">No adjusting entries posted yet.</td></tr>
          )}
          {adjustments.map((a) => {
            const prep = a.postedById ? userById(a.postedById)?.name : null;
            const rev = a.reviewedById ? userById(a.reviewedById)?.name : null;
            const tone = a.status === "posted" ? "green" : a.status === "draft" ? "amber" : "default";
            const blockPost = a.postedById === actor.id;
            return (
              <tr key={a.id} className="border-t border-border-soft" data-testid={`close-adj-${a.id}`}>
                <td className="px-3 py-2"><MonoChip tone="gold">{a.kind.replace("_", " ")}</MonoChip></td>
                <td className="px-3 py-2 text-text">{a.narrative}</td>
                <td className="px-3 py-2 font-mono text-xs text-text-mute">
                  Dr {a.debitAccount}<br />Cr {a.creditAccount}
                </td>
                <td className="px-3 py-2 text-right font-mono">{fmtMoney(a.amount, a.currency)}</td>
                <td className="px-3 py-2 text-xs text-text-mute">
                  P: {prep ?? "—"}<br />R: {rev ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs"><MonoChip>journal · close</MonoChip></td>
                <td className="px-3 py-2"><MonoChip tone={tone}>{a.status}</MonoChip></td>
                <td className="px-3 py-2 text-right">
                  {!period.locked && a.status === "draft" && (
                    <PillButton
                      variant="primary"
                      disabled={blockPost}
                      onClick={() => postAdjustment(a.id, actor)}
                      data-testid={`btn-post-adj-${a.id}`}
                      title={blockPost ? "Maker cannot also be the checker" : "Post adjusting entry"}
                    >
                      Post
                    </PillButton>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// ────────────────────────── Sign-off + audit tab ──────────────────────────
function SignOffPanel({
  period, actor, status,
}: {
  period: ClosePeriod;
  actor: CloseUser;
  status: CloseStatusForEntity;
}) {
  const store = useCloseStore();
  const signOffs = store.signOffs.filter((s) => s.periodId === period.id);
  const auditAll = store.audit.filter((a) => a.periodId === period.id).slice().reverse();
  const [comment, setComment] = React.useState("Reviewed P&L flux and sub-ledgers. Approve.");
  const [reason, setReason] = React.useState<string | null>(null);

  // Audit filters
  const [filterActor, setFilterActor] = React.useState<string>("all");
  const [filterType, setFilterType] = React.useState<string>("all");
  const [filterFrom, setFilterFrom] = React.useState<string>("");
  const [filterTo, setFilterTo] = React.useState<string>("");
  const [drillId, setDrillId] = React.useState<string | null>(null);

  const auditActors = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const e of auditAll) map.set(e.actorId, e.actorName);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [auditAll]);
  const auditTypes = React.useMemo(
    () => Array.from(new Set(auditAll.map((e) => e.type))),
    [auditAll],
  );
  const audit = auditAll.filter((e) => {
    if (filterActor !== "all" && e.actorId !== filterActor) return false;
    if (filterType !== "all" && e.type !== filterType) return false;
    if (filterFrom && e.ts.slice(0, 10) < filterFrom) return false;
    if (filterTo && e.ts.slice(0, 10) > filterTo) return false;
    return true;
  });

  const blockers: string[] = [];
  if (status.checklistPct < 100) blockers.push(`${100 - status.checklistPct}% of tasks open`);
  if (status.openRecs > 0) blockers.push(`${status.openRecs} unsigned reconciliation(s)`);
  const draftAdjs = store.adjustments.filter((a) => a.periodId === period.id && a.status === "draft").length;
  if (draftAdjs > 0) blockers.push(`${draftAdjs} draft adjusting entr${draftAdjs === 1 ? "y" : "ies"}`);
  if (!actor.partnerTier) blockers.push("acting persona is not partner-tier");
  if (signOffs.some((s) => s.signerId === actor.id)) blockers.push("this partner has already signed");
  if (signOffs.some((s) => s.signerRole === actor.role)) blockers.push(`a signer with role "${actor.role}" already exists — second signer must be a different role`);

  const onSign = () => {
    const r = signPeriod(period.id, actor, comment);
    setReason(r.ok ? null : r.reason ?? "unknown");
  };

  return (
    <div className="space-y-4" data-testid="close-signoff">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-gold" />
          <Eyebrow>Two-partner sign-off</Eyebrow>
          {period.locked && <MonoChip tone="green"><Lock className="w-3 h-3 inline -mt-0.5 mr-1" /> Locked</MonoChip>}
        </div>
        <div className="text-sm text-text-mute">
          Two distinct partner-tier signatures are required to lock {period.periodLabel}. Once locked, the period
          becomes immutable and every action is preserved in the audit trail below.
        </div>

        <div className="grid sm:grid-cols-2 gap-2">
          {[0, 1].map((i) => {
            const s = signOffs[i];
            return (
              <div key={i} className={`border rounded p-3 ${s ? "border-emerald-500/40 bg-emerald-500/5" : "border-border-soft"}`}>
                <div className="text-[10px] font-mono uppercase text-text-faint">Signer {i + 1}</div>
                {s ? (
                  <>
                    <div className="text-sm text-text mt-0.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> {s.signerName}
                    </div>
                    <div className="text-xs text-text-mute">{s.signerRole} · {s.signedOn.slice(0, 10)}</div>
                    <div className="text-xs text-text mt-1 italic">"{s.comment}"</div>
                  </>
                ) : (
                  <div className="text-sm text-text-mute mt-0.5 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Awaiting partner</div>
                )}
              </div>
            );
          })}
        </div>

        {!period.locked && (
          <div className="space-y-2 pt-2 border-t border-border-soft">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="w-full bg-bg-elevate border border-border-soft rounded px-2 py-1.5 text-sm text-text"
              placeholder="Sign-off comment (visible in audit trail)"
              data-testid="close-signoff-comment"
            />
            {blockers.length > 0 && (
              <div className="text-xs text-amber-400 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5" />
                <span>Blocked: {blockers.join(" · ")}</span>
              </div>
            )}
            <PillButton
              variant="primary"
              disabled={blockers.length > 0}
              onClick={onSign}
              data-testid="btn-sign-period"
            >
              Sign as {actor.name}
            </PillButton>
            {reason && reason !== "unknown" && (
              <div className="text-xs text-danger">Sign-off rejected: {reason.replace("_", " ")}</div>
            )}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="p-3 border-b border-border-soft flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Audit trail · {audit.length} of {auditAll.length} event{auditAll.length === 1 ? "" : "s"}</Eyebrow>
          <span className="text-[10px] font-mono uppercase text-text-faint">append-only</span>
        </div>
        <div className="p-3 border-b border-border-soft flex flex-wrap gap-2 text-xs items-end" data-testid="close-audit-filters">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-text-faint">Actor</span>
            <select
              value={filterActor} onChange={(e) => setFilterActor(e.target.value)}
              className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text"
              data-testid="audit-filter-actor"
            >
              <option value="all">All actors</option>
              {auditActors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-text-faint">Event type</span>
            <select
              value={filterType} onChange={(e) => setFilterType(e.target.value)}
              className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text"
              data-testid="audit-filter-type"
            >
              <option value="all">All types</option>
              {auditTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-text-faint">From</span>
            <input
              type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
              className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text"
              data-testid="audit-filter-from"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-mono text-text-faint">To</span>
            <input
              type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
              className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text"
              data-testid="audit-filter-to"
            />
          </label>
          {(filterActor !== "all" || filterType !== "all" || filterFrom || filterTo) && (
            <button
              onClick={() => { setFilterActor("all"); setFilterType("all"); setFilterFrom(""); setFilterTo(""); }}
              className="text-text-mute hover:text-text underline text-xs px-2 py-1"
              data-testid="audit-filter-clear"
            >
              Clear
            </button>
          )}
        </div>
        <ul className="divide-y divide-border-soft" data-testid="close-audit">
          {audit.length === 0 && <li className="p-4 text-sm text-text-mute">No events match the current filters.</li>}
          {audit.map((e) => {
            const open = drillId === e.id;
            return (
              <li key={e.id} data-testid={`close-audit-${e.id}`}>
                <button
                  type="button"
                  onClick={() => setDrillId(open ? null : e.id)}
                  className={`w-full text-left px-4 py-2 text-xs flex flex-wrap items-baseline gap-2 hover:bg-bg-elevate/40 ${open ? "bg-bg-elevate/40" : ""}`}
                  data-testid={`close-audit-row-${e.id}`}
                >
                  <span className="font-mono text-text-faint">{e.ts.replace("T", " ").slice(0, 19)}</span>
                  <MonoChip>{e.type}</MonoChip>
                  <span className="text-text-mute">{e.actorName}</span>
                  <span className="text-text">{e.summary}</span>
                </button>
                {open && (
                  <div className="px-4 pb-3 text-xs text-text-mute grid sm:grid-cols-2 gap-3" data-testid={`close-audit-detail-${e.id}`}>
                    <div>
                      <div className="text-[10px] uppercase font-mono text-text-faint mb-1">Before</div>
                      <pre className="bg-bg-elevate rounded p-2 overflow-auto text-[11px] text-text">{e.before == null ? "—" : JSON.stringify(e.before, null, 2)}</pre>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-mono text-text-faint mb-1">After</div>
                      <pre className="bg-bg-elevate rounded p-2 overflow-auto text-[11px] text-text">{e.after == null ? "—" : JSON.stringify(e.after, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

// ────────────────────────── Top-level page ──────────────────────────
type Tab = "overview" | "checklist" | "recs" | "adjustments" | "signoff";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "checklist", label: "Checklist" },
  { id: "recs", label: "Reconciliations" },
  { id: "adjustments", label: "Adjusting entries" },
  { id: "signoff", label: "Sign-off & audit" },
];

export default function FinanceClose() {
  const entities = useFinanceEntities();
  const store = useCloseStore();

  // Show all finance entities; those without a seeded period render an explicit
  // "no period open" empty state below.
  const periodEntityIds = React.useMemo(
    () => new Set(store.periods.map((p) => p.entityId)),
    [store.periods],
  );

  // Read deep-link entity from ?entity=… so dashboard mini-cards open the
  // intended entity directly. Falls back to the first entity with a period.
  const initialEntity = React.useMemo(() => {
    if (typeof window === "undefined") return "";
    const q = new URLSearchParams(window.location.search).get("entity") ?? "";
    if (q && entities.some((e) => e.id === q)) return q;
    return entities.find((e) => periodEntityIds.has(e.id))?.id ?? entities[0]?.id ?? "";
  }, [entities, periodEntityIds]);

  const [entityId, setEntityId] = React.useState<string>(initialEntity);
  React.useEffect(() => {
    if (!entityId && initialEntity) setEntityId(initialEntity);
  }, [entityId, initialEntity]);

  const [tab, setTab] = React.useState<Tab>("overview");
  const [actorId, setActorId] = React.useState<string>("u_yara_n");

  const entity: FinanceEntityRow | undefined = entities.find((e) => e.id === entityId);
  const status = entityId ? statusForEntity(entityId) : null;
  const period = status?.period ?? null;
  const actor = store.users.find((u) => u.id === actorId) ?? store.users[0];

  const tasksFor = period ? store.tasks.filter((t) => t.periodId === period.id) : [];
  const recsFor = period ? store.recs.filter((r) => r.periodId === period.id) : [];
  const adjsFor = period ? store.adjustments.filter((a) => a.periodId === period.id) : [];

  return (
    <div className="animate-in fade-in" data-testid="page-finance-close">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Close"
          headline="Period close"
          lede="Per-entity close checklist, reconciliations, adjusting entries (accruals · deferrals · FX revaluation) and the two-partner sign-off that locks the period and writes the immutable audit trail."
        />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2" data-testid="close-entity-picker">
            {entities.map((e) => (
              <button
                key={e.id}
                onClick={() => setEntityId(e.id)}
                className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
                  entityId === e.id ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
                }`}
                data-testid={`close-entity-${e.id}`}
              >
                {e.shortName}
              </button>
            ))}
          </div>
          <PersonaPicker users={store.users} value={actorId} onChange={setActorId} />
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        {!entity && <Card className="p-6 text-sm text-text-mute">Select an entity above.</Card>}
        {entity && status && (
          <>
            {!period && (
              <Card className="p-6 text-sm text-text-mute">
                No close period found for {entity.shortName}.
              </Card>
            )}
            {period && period.status === "not_started" && (
              <Card className="p-4 flex items-center justify-between gap-4 border-amber-500/40 bg-amber-500/5">
                <div>
                  <Eyebrow>Period not yet started</Eyebrow>
                  <div className="text-sm text-text mt-1">
                    {entity.shortName} · {period.periodLabel} · target close {period.targetCloseOn} ({period.targetCloseDays}-day target)
                  </div>
                </div>
                <PillButton
                  variant="primary"
                  onClick={() => openPeriod(period.id, actor)}
                  data-testid="btn-open-period"
                >
                  Open period
                </PillButton>
              </Card>
            )}

            <div className="flex flex-wrap gap-1 border-b border-border-soft" data-testid="close-tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-2 text-xs font-mono uppercase tracking-widest border-b-2 transition-colors ${
                    tab === t.id
                      ? "border-gold text-text"
                      : "border-transparent text-text-mute hover:text-text"
                  }`}
                  data-testid={`close-tab-${t.id}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "overview" && <OverviewPanel status={status} period={period} adjustments={adjsFor} />}
            {tab === "checklist" && period && <ChecklistPanel tasks={tasksFor} period={period} actor={actor} />}
            {tab === "recs" && period && <ReconciliationsPanel recs={recsFor} period={period} actor={actor} />}
            {tab === "adjustments" && period && <AdjustmentsPanel adjustments={adjsFor} period={period} actor={actor} />}
            {tab === "signoff" && period && <SignOffPanel period={period} actor={actor} status={status} />}
          </>
        )}
      </div>
    </div>
  );
}
