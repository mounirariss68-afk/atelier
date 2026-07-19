/**
 * MeTime — Task #53: self-service Time tab on the Me lens.
 *
 * Reuses the ledger Timesheet grid pointed at the self-scoped
 * /me/timesheets/* API, plus a leave section: balance, request form
 * (annual/sick/unpaid/other) and request history with cancel.
 */
import * as React from "react";
import Timesheet, { type TimesheetWeekMeta } from "@/pages/ledger/Timesheet";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";

const API = "/api/atelier/me";

interface LeaveRequest {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  note: string | null;
  status: string;
  decisionReason: string | null;
  createdAt: string;
}

interface LeaveBalance {
  year: number;
  annualDays: number;
  sickDays: number;
  usedAnnual: number;
  pendingAnnual: number;
  remainingAnnual: number;
  usedSick: number;
  pendingSick: number;
  remainingSick: number;
}

const LEAVE_TYPES = [
  { value: "annual", label: "Annual leave" },
  { value: "sick", label: "Sick leave" },
  { value: "unpaid", label: "Unpaid leave" },
  { value: "other", label: "Other" },
];

function statusTone(s: string): "default" | "amber" | "green" | "gold" | "red" {
  if (s === "pending") return "amber";
  if (s === "approved") return "green";
  if (s === "rejected") return "red";
  return "default";
}

const inputCls =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text min-h-[44px] focus:outline-none focus:ring-1 focus:ring-gold/50";

export default function MeTime({
  onWeekMeta,
}: {
  /** Lets the Me page hero show "Timesheet — {week}" instead of a second hero band. */
  onWeekMeta?: (meta: TimesheetWeekMeta | null) => void;
} = {}) {
  return (
    <div className="space-y-8">
      <Timesheet
        apiBase={`${API}/timesheets`}
        engagementsUrl={`${API}/expense-contexts`}
        hideHero
        onWeekMeta={onWeekMeta}
      />
      <LeaveSection />
    </div>
  );
}

function LeaveSection() {
  const [requests, setRequests] = React.useState<LeaveRequest[]>([]);
  const [balance, setBalance] = React.useState<LeaveBalance | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    leaveType: "annual",
    startDate: "",
    endDate: "",
    note: "",
  });

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`${API}/leave`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      setRequests(j.requests ?? []);
      setBalance(j.balance ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!form.startDate || !form.endDate) {
      setError("Pick a start and end date.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/leave`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveType: form.leaveType,
          startDate: form.startDate,
          endDate: form.endDate,
          note: form.note || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      setForm({ leaveType: "annual", startDate: "", endDate: "", note: "" });
      setShowForm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/leave/${id}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.reason || j.error || `HTTP ${r.status}`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="me-leave">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Leave</h3>
        <PillButton onClick={() => setShowForm((v) => !v)} className="min-h-[44px]">
          {showForm ? "Close" : "Request leave"}
        </PillButton>
      </div>

      {balance && (
        <div className="flex flex-wrap gap-2" data-testid="me-leave-balance">
          <MonoChip tone="gold">
            Annual {balance.remainingAnnual}/{balance.annualDays}d left
          </MonoChip>
          {balance.pendingAnnual > 0 && (
            <MonoChip tone="amber">{balance.pendingAnnual}d pending</MonoChip>
          )}
          <MonoChip tone="green">
            Sick {balance.remainingSick}/{balance.sickDays}d left
          </MonoChip>
          <MonoChip>{balance.year}</MonoChip>
        </div>
      )}

      {error && (
        <Card className="border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">{error}</Card>
      )}

      {showForm && (
        <Card className="p-4 space-y-3" data-testid="me-leave-form">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Type</span>
              <select
                className={inputCls}
                value={form.leaveType}
                onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value }))}
                data-testid="leave-type"
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">First day</span>
              <input
                type="date"
                className={inputCls}
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                data-testid="leave-start"
              />
            </label>
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Last day</span>
              <input
                type="date"
                className={inputCls}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                data-testid="leave-end"
              />
            </label>
          </div>
          <label className="block text-xs text-text-mute space-y-1">
            <span className="font-mono uppercase tracking-wider text-[10px]">Note (optional)</span>
            <input
              type="text"
              className={inputCls}
              value={form.note}
              placeholder="Anything your approver should know"
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              data-testid="leave-note"
            />
          </label>
          <p className="text-xs text-text-faint">
            Weekends are not counted — only Mon–Fri days are debited.
          </p>
          <PillButton onClick={submit} disabled={busy} className="min-h-[44px]" data-testid="leave-submit">
            {busy ? "Sending…" : "Send request"}
          </PillButton>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <p className="p-4 text-sm text-text-faint">Loading leave…</p>
        ) : requests.length === 0 ? (
          <p className="p-4 text-sm text-text-mute" data-testid="me-leave-empty">
            No leave requests yet.
          </p>
        ) : (
          <ul className="divide-y divide-border-soft" data-testid="me-leave-list">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <MonoChip tone={statusTone(r.status)}>{r.status}</MonoChip>
                <MonoChip>{r.leaveType}</MonoChip>
                <span className="text-text">
                  {r.startDate} → {r.endDate}
                </span>
                <span className="text-text-mute">{r.workingDays}d</span>
                {r.decisionReason && (
                  <span className="text-xs text-text-faint">“{r.decisionReason}”</span>
                )}
                {r.status === "pending" && (
                  <button
                    className="ml-auto font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-red-300 min-h-[44px] px-2"
                    onClick={() => cancel(r.id)}
                    disabled={busy}
                    data-testid={`leave-cancel-${r.id}`}
                  >
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
