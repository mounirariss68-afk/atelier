/**
 * MeDelegates — Task #386: partner "My delegates" surface.
 *
 * Partners grant scoped delegations (timesheets / expenses / meetings &
 * tasks) to roster-designated Executive Assistants, and review the items
 * their EAs entered on their behalf: approve (applies the entry, then it
 * follows the normal ladders) or send back with a reason.
 *
 * Uses raw fetch — the /me/delegates/* routes are a bespoke surface (the
 * accepted pattern for non-openapi Atelier routes).
 */
import * as React from "react";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";

const API = "/api/atelier/me";

const SCOPE_LABELS: Record<string, string> = {
  timesheets: "Timesheets",
  expenses: "Expenses",
  meetings_tasks: "Meetings & tasks",
};

interface Delegation {
  id: string;
  eaUserId: string;
  eaName: string;
  scopes: string[];
  status: string;
  revokedReason: string | null;
  createdAt: string;
}

interface Candidate {
  userId: string;
  name: string;
  email: string;
  workerType: string;
}

export interface PendingItem {
  id: string;
  eaName: string;
  partnerName: string;
  kind: string;
  payload: Record<string, unknown>;
  hasReceipt: boolean;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  overlap?: { kind: string; count: number; totalHours?: number } | null;
}

export function describeItemPayload(kind: string, p: Record<string, unknown>): string {
  if (kind === "timesheet_entry")
    return `${p.hours}h on ${p.workDate}${p.narrative ? ` — ${p.narrative}` : ""}`;
  if (kind === "expense")
    return `${p.merchant} — ${p.currency} ${Number(p.amount).toFixed(2)} on ${p.expenseDate}${p.description ? ` (${p.description})` : ""}`;
  return `${p.title}${p.date ? ` — ${p.date}${p.time ? ` ${p.time}` : ""}` : ""}${p.notes ? ` (${p.notes})` : ""}`;
}

export default function MeDelegates() {
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [delegations, setDelegations] = React.useState<Delegation[]>([]);
  const [items, setItems] = React.useState<PendingItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pickEa, setPickEa] = React.useState("");
  const [pickScopes, setPickScopes] = React.useState<string[]>([]);
  const [rejectFor, setRejectFor] = React.useState<string | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [rd, rr] = await Promise.all([
        fetch(`${API}/delegates`, { credentials: "include" }),
        fetch(`${API}/delegates/review`, { credentials: "include" }),
      ]);
      if (!rd.ok) {
        const j = await rd.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${rd.status}`);
      }
      const jd = await rd.json();
      setCandidates(jd.candidates ?? []);
      setDelegations(jd.delegations ?? []);
      const jr = rr.ok ? await rr.json() : { items: [] };
      setItems(jr.items ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const post = async (path: string, body?: unknown, method = "POST") => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}${path}`, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.message || j.error || `HTTP ${r.status}`);
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const activeDelegations = delegations.filter((d) => d.status === "active");
  const pending = items.filter((i) => i.status === "pending");

  if (loading) return <p className="text-sm text-text-faint">Loading…</p>;

  return (
    <div className="space-y-6" data-testid="me-delegates">
      {error ? (
        <Card className="p-3 text-sm text-red-400" data-testid="me-delegates-error">
          {error}
        </Card>
      ) : null}

      {/* Review queue */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">
          Waiting for your review{" "}
          {pending.length > 0 ? <MonoChip tone="gold">{pending.length}</MonoChip> : null}
        </h3>
        {pending.length === 0 ? (
          <Card className="p-4 text-sm text-text-mute" data-testid="me-delegates-review-empty">
            Nothing from your delegates right now.
          </Card>
        ) : (
          <div className="space-y-2" data-testid="me-delegates-review">
            {pending.map((i) => (
              <Card key={i.id} className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <MonoChip tone="gold">{i.kind.replace(/_/g, " ")}</MonoChip>
                  <span className="text-sm text-text">{describeItemPayload(i.kind, i.payload)}</span>
                </div>
                <div className="text-xs text-text-faint">
                  entered by {i.eaName} (EA) on your behalf
                  {i.hasReceipt ? (
                    <>
                      {" · "}
                      <a
                        className="text-gold hover:underline"
                        href={`${API}/ea-items/${i.id}/receipt`}
                        target="_blank"
                        rel="noreferrer"
                        data-testid={`delegate-receipt-${i.id}`}
                      >
                        receipt
                      </a>
                    </>
                  ) : null}
                </div>
                {i.overlap ? (
                  <div className="text-xs text-amber-400" data-testid={`delegate-overlap-${i.id}`}>
                    {i.overlap.kind === "same_day_entries"
                      ? `Heads up: you already have ${i.overlap.count} entr${i.overlap.count === 1 ? "y" : "ies"} (${i.overlap.totalHours}h) on that day.`
                      : `Heads up: you have ${i.overlap.count} expense${i.overlap.count === 1 ? "" : "s"} within 3 days of that date.`}
                  </div>
                ) : null}
                {rejectFor === i.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text"
                      placeholder="Why are you sending this back?"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      data-testid={`delegate-reject-reason-${i.id}`}
                    />
                    <PillButton
                      disabled={busy || !rejectReason.trim()}
                      onClick={async () => {
                        if (await post(`/delegates/review/${i.id}/reject`, { reason: rejectReason.trim() })) {
                          setRejectFor(null);
                          setRejectReason("");
                        }
                      }}
                      data-testid={`delegate-reject-confirm-${i.id}`}
                    >
                      Send back
                    </PillButton>
                    <PillButton disabled={busy} onClick={() => setRejectFor(null)}>
                      Cancel
                    </PillButton>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <PillButton
                      disabled={busy}
                      onClick={() => void post(`/delegates/review/${i.id}/approve`)}
                      data-testid={`delegate-approve-${i.id}`}
                    >
                      Approve
                    </PillButton>
                    <PillButton
                      disabled={busy}
                      onClick={() => setRejectFor(i.id)}
                      data-testid={`delegate-reject-${i.id}`}
                    >
                      Send back…
                    </PillButton>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Grants */}
      <div>
        <h3 className="text-sm font-semibold text-text mb-2">My delegates</h3>
        {activeDelegations.length === 0 ? (
          <Card className="p-4 text-sm text-text-mute" data-testid="me-delegates-empty">
            You have no active delegates. Grant one below — only people HR has
            designated as Executive Assistants can be delegates.
          </Card>
        ) : (
          <div className="space-y-2" data-testid="me-delegates-list">
            {activeDelegations.map((d) => (
              <Card key={d.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-text font-medium">{d.eaName}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    {d.scopes.map((s) => (
                      <MonoChip key={s} tone="gold">
                        {SCOPE_LABELS[s] ?? s}
                      </MonoChip>
                    ))}
                  </div>
                </div>
                <PillButton
                  disabled={busy}
                  onClick={() => void post(`/delegates/${d.id}/revoke`)}
                  data-testid={`delegate-revoke-${d.id}`}
                >
                  Revoke
                </PillButton>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* New grant */}
      <Card className="p-4 space-y-3" data-testid="me-delegates-new">
        <h3 className="text-sm font-semibold text-text">Add a delegate</h3>
        {candidates.length === 0 ? (
          <p className="text-sm text-text-mute">
            No Executive Assistants on the roster yet — ask HR to designate one.
          </p>
        ) : (
          <>
            <select
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text"
              value={pickEa}
              onChange={(e) => setPickEa(e.target.value)}
              data-testid="delegate-ea-select"
            >
              <option value="">Choose an Executive Assistant…</option>
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name} ({c.workerType})
                </option>
              ))}
            </select>
            <div className="flex items-center gap-4">
              {Object.entries(SCOPE_LABELS).map(([scope, label]) => (
                <label key={scope} className="flex items-center gap-2 text-sm text-text-mute">
                  <input
                    type="checkbox"
                    checked={pickScopes.includes(scope)}
                    onChange={(e) =>
                      setPickScopes((prev) =>
                        e.target.checked ? [...prev, scope] : prev.filter((s) => s !== scope),
                      )
                    }
                    data-testid={`delegate-scope-${scope}`}
                  />
                  {label}
                </label>
              ))}
            </div>
            <PillButton
              disabled={busy || !pickEa || pickScopes.length === 0}
              onClick={async () => {
                if (await post("/delegates", { eaUserId: pickEa, scopes: pickScopes })) {
                  setPickEa("");
                  setPickScopes([]);
                }
              }}
              data-testid="delegate-grant"
            >
              Grant delegation
            </PillButton>
          </>
        )}
      </Card>

      {/* Recent decisions */}
      {items.some((i) => i.status !== "pending") ? (
        <div>
          <h3 className="text-sm font-semibold text-text mb-2">Recent decisions</h3>
          <div className="space-y-2">
            {items
              .filter((i) => i.status !== "pending")
              .slice(0, 10)
              .map((i) => (
                <Card key={i.id} className="p-3 flex items-center gap-2 text-sm">
                  <MonoChip tone={i.status === "approved" ? "green" : "red"}>{i.status}</MonoChip>
                  <span className="text-text-mute truncate">
                    {i.kind.replace(/_/g, " ")} — {describeItemPayload(i.kind, i.payload)}
                  </span>
                </Card>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
