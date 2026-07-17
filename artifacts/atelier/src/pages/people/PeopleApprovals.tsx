import * as React from "react";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { usePeopleApprovals, type PeopleApprovalRow } from "./peopleSeed";

interface UnifiedApproval {
  id: string;
  source: "people" | "timesheet";
  kind: string;
  subject: string;
  requester: string;
  approver: string;
  submittedOn: string;
  status: "pending" | "approved" | "rejected";
  amount: string | null;
}

function toUnified(r: PeopleApprovalRow): UnifiedApproval {
  return { ...r, source: "people" };
}

interface TimesheetApprovalRow {
  id: string | number;
  personName?: string;
  personId?: string;
  weekIso?: string;
  totalHours?: number;
  submittedAt?: string | null;
  managerName?: string | null;
  status?: string;
}

/**
 * People approvals inbox — merges the people-shaped approvals (promotions,
 * comp changes, hire offers, exits, leaves, policy exceptions) with the
 * existing timesheet approvals coming from
 * `/api/atelier/ledger/approvals?stage=submitted`.
 *
 * The inbox preserves the existing badge semantics for timesheet rows
 * (submitted = pending) while presenting one unified table.
 */
export default function PeopleApprovals() {
  const peopleRows = usePeopleApprovals();
  const [tsRows, setTsRows] = React.useState<TimesheetApprovalRow[]>([]);
  const [tsErr, setTsErr] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void fetch(`/api/atelier/ledger/approvals?stage=submitted`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        // Server may wrap the array under `rows` or return it directly.
        const arr: TimesheetApprovalRow[] = Array.isArray(data) ? data : (data?.rows ?? data?.weeks ?? []);
        setTsRows(arr);
      })
      .catch(() => !cancelled && setTsErr(true));
    return () => { cancelled = true; };
  }, []);

  const merged: UnifiedApproval[] = React.useMemo(() => {
    const ts: UnifiedApproval[] = tsRows.map((r) => ({
      id: `ts-${r.id}`,
      source: "timesheet",
      kind: "timesheet",
      subject: r.weekIso
        ? `${r.personName ?? "—"} · week ${r.weekIso}`
        : `${r.personName ?? "Timesheet"}`,
      requester: r.personName ?? "—",
      approver: r.managerName ?? "Manager",
      submittedOn: (r.submittedAt ?? "").slice(0, 10) || "—",
      status: (r.status === "submitted" ? "pending" : (r.status as UnifiedApproval["status"])) ?? "pending",
      amount: typeof r.totalHours === "number" ? `${r.totalHours.toFixed(1)}h` : null,
    }));
    const ppl = peopleRows.map(toUnified);
    return [...ts, ...ppl].sort((a, b) => (a.submittedOn < b.submittedOn ? 1 : -1));
  }, [peopleRows, tsRows]);

  const pendingCount = merged.filter((r) => r.status === "pending").length;

  return (
    <PeopleShell module="approvals">
      <LensPageHeader
        headline="People approvals inbox"
        lede="Promotions, comp changes, hire offers, exits, leaves, policy exceptions and timesheet approvals — one inbox."
        actions={
          <div className="flex items-center gap-2 text-xs text-text-mute">
            <MonoChip tone={pendingCount > 0 ? "gold" : "default"}>{pendingCount} pending</MonoChip>
            <MonoChip>{merged.length} total</MonoChip>
            {tsErr && <span className="text-text-faint">timesheet feed unavailable</span>}
          </div>
        }
      />
      <div className="container-atelier py-6 space-y-6">
        <LeaveApprovalsCard />
        <LeaveEntitlementsCard />
        <Card className="p-4">
          <table className="w-full text-sm">
            <thead className="text-xs text-text-mute font-mono uppercase">
              <tr>
                <th className="text-left py-2">Source</th>
                <th className="text-left">Kind</th>
                <th className="text-left">Subject</th>
                <th className="text-left">Requester → Approver</th>
                <th>Submitted</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody data-testid="people-approvals-rows">
              {merged.map((r) => (
                <tr key={r.id} className="border-t border-border-soft" data-testid={`people-approvals-row-${r.id}`}>
                  <td className="py-2"><MonoChip tone={r.source === "timesheet" ? "amber" : "default"}>{r.source}</MonoChip></td>
                  <td><MonoChip>{r.kind}</MonoChip></td>
                  <td className="text-text">{r.subject}</td>
                  <td className="text-text-mute">{r.requester} → {r.approver}</td>
                  <td className="text-center text-text-mute">{r.submittedOn}</td>
                  <td className="text-center text-text-mute">{r.amount ?? "—"}</td>
                  <td className="text-center">
                    <MonoChip tone={r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "gold"}>
                      {r.status}
                    </MonoChip>
                  </td>
                </tr>
              ))}
              {merged.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-text-faint">No approvals waiting.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </PeopleShell>
  );
}

// ---------------------------------------------------------------------
// Task #53 — leave request approvals + HR entitlement editor.
// Both cards self-hide when the caller lacks the required role (403).
// ---------------------------------------------------------------------

interface LeaveQueueRow {
  id: string;
  personName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  note: string | null;
  status: string;
  isOwn: boolean;
  createdAt: string;
}

function LeaveApprovalsCard() {
  const [rows, setRows] = React.useState<LeaveQueueRow[]>([]);
  const [allowed, setAllowed] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/atelier/roster/leave-requests?status=pending`, { credentials: "include" });
      if (r.status === 403) return void setAllowed(false);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.requests ?? []);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, action: "approve" | "reject") => {
    const reason = action === "reject" ? prompt("Rejection reason (required):") : null;
    if (action === "reject" && !reason?.trim()) return;
    setBusy(id);
    setErr(null);
    try {
      const r = await fetch(`/api/atelier/roster/leave-requests/${id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) return null;

  return (
    <Card className="p-4" data-testid="leave-approvals-card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text">Leave requests</h3>
        <MonoChip tone={rows.length > 0 ? "gold" : "default"}>{rows.length} pending</MonoChip>
      </div>
      {err && <p className="mb-2 text-sm text-red-300">{err}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-text-mute">No leave requests waiting.</p>
      ) : (
        <ul className="divide-y divide-border-soft">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid={`leave-row-${r.id}`}>
              <span className="font-medium text-text">{r.personName}</span>
              <MonoChip>{r.leaveType}</MonoChip>
              <span className="text-text-mute">{r.startDate} → {r.endDate}</span>
              <MonoChip tone="amber">{r.workingDays}d</MonoChip>
              {r.note && <span className="text-xs text-text-faint truncate max-w-[24ch]" title={r.note}>“{r.note}”</span>}
              {r.isOwn ? (
                <span className="ml-auto text-xs text-text-faint">your own request — a colleague must decide</span>
              ) : (
                <span className="ml-auto flex gap-2">
                  <PillButton onClick={() => decide(r.id, "approve")} disabled={busy === r.id} className="min-h-[44px]" data-testid={`leave-approve-${r.id}`}>
                    Approve
                  </PillButton>
                  <PillButton variant="ghost" onClick={() => decide(r.id, "reject")} disabled={busy === r.id} className="min-h-[44px]" data-testid={`leave-reject-${r.id}`}>
                    Reject
                  </PillButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface EntitlementRow {
  personId: string;
  personName: string;
  personType: string;
  employmentType?: string;
  annualDays: number;
  sickDays: number;
  configured: boolean;
  source?: string;
}

interface TypeDefaultRow {
  employmentType: string;
  annualDays: number;
  sickDays: number;
  configured: boolean;
}

interface ReportsEdge {
  id: string;
  personId: string;
  managerPersonId: string;
}

function LeaveEntitlementsCard() {
  const [rows, setRows] = React.useState<EntitlementRow[]>([]);
  const [typeRows, setTypeRows] = React.useState<TypeDefaultRow[]>([]);
  const [edges, setEdges] = React.useState<ReportsEdge[]>([]);
  const [year, setYear] = React.useState(new Date().getUTCFullYear());
  const [allowed, setAllowed] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [edits, setEdits] = React.useState<Record<string, { annualDays: string; sickDays: string }>>({});
  const [typeEdits, setTypeEdits] = React.useState<Record<string, { annualDays: string; sickDays: string }>>({});

  const load = React.useCallback(async (y: number) => {
    try {
      const r = await fetch(`/api/atelier/roster/leave-entitlements?year=${y}`, { credentials: "include" });
      if (r.status === 403) return void setAllowed(false);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.entitlements ?? []);
      setTypeRows(j.typeDefaults ?? []);
      setEdits({});
      setTypeEdits({});
      const re = await fetch(`/api/atelier/roster/reports-to`, { credentials: "include" });
      if (re.ok) {
        const je = await re.json();
        setEdges(je.edges ?? []);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  React.useEffect(() => { void load(year); }, [load, year]);

  const save = async (row: EntitlementRow) => {
    const e = edits[row.personId];
    if (!e) return;
    setBusy(row.personId);
    setErr(null);
    try {
      const r = await fetch(`/api/atelier/roster/leave-entitlements`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: row.personId,
          year,
          annualDays: Number(e.annualDays),
          sickDays: Number(e.sickDays),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      await load(year);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveTypeDefault = async (row: TypeDefaultRow) => {
    const e = typeEdits[row.employmentType];
    if (!e) return;
    setBusy(`type:${row.employmentType}`);
    setErr(null);
    try {
      const r = await fetch(`/api/atelier/roster/leave-entitlements`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employmentType: row.employmentType,
          year,
          annualDays: Number(e.annualDays),
          sickDays: Number(e.sickDays),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      await load(year);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setManagers = async (personId: string, managerPersonIds: string[]) => {
    setBusy(`mgr:${personId}`);
    setErr(null);
    try {
      const r = await fetch(`/api/atelier/roster/reports-to`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, managerPersonIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      await load(year);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) return null;

  const cell = "w-20 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text";
  const nameById = new Map(rows.map((r) => [r.personId, r.personName]));
  const employeeOptions = rows.filter((r) => r.personType === "employee");

  return (
    <Card className="p-4" data-testid="leave-entitlements-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Leave entitlements · {year}</h3>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text min-h-[44px]"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <PillButton variant="ghost" onClick={() => setOpen((v) => !v)} className="min-h-[44px]" data-testid="entitlements-toggle">
            {open ? "Hide" : "Configure"}
          </PillButton>
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      {open && (
        <div className="mt-3 space-y-5">
          <div className="overflow-x-auto">
            <p className="text-xs text-text-mute font-mono uppercase mb-1">Defaults by employment type</p>
            <table className="w-full text-sm">
              <thead className="text-xs text-text-mute font-mono uppercase">
                <tr>
                  <th className="text-left py-2">Employment type</th>
                  <th className="text-left">Annual days</th>
                  <th className="text-left">Sick days</th>
                  <th className="text-left">Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {typeRows.map((t) => {
                  const e = typeEdits[t.employmentType] ?? { annualDays: String(t.annualDays), sickDays: String(t.sickDays) };
                  const dirty = Number(e.annualDays) !== t.annualDays || Number(e.sickDays) !== t.sickDays;
                  return (
                    <tr key={t.employmentType} className="border-t border-border-soft" data-testid={`type-default-row-${t.employmentType}`}>
                      <td className="py-2 text-text">{t.employmentType.replace("_", " ")}</td>
                      <td>
                        <input type="number" min="0" max="366" className={cell} value={e.annualDays}
                          onChange={(ev) => setTypeEdits((m) => ({ ...m, [t.employmentType]: { ...e, annualDays: ev.target.value } }))} />
                      </td>
                      <td>
                        <input type="number" min="0" max="366" className={cell} value={e.sickDays}
                          onChange={(ev) => setTypeEdits((m) => ({ ...m, [t.employmentType]: { ...e, sickDays: ev.target.value } }))} />
                      </td>
                      <td><MonoChip tone={t.configured ? "gold" : "default"}>{t.configured ? "custom" : "default"}</MonoChip></td>
                      <td className="text-right">
                        <PillButton onClick={() => saveTypeDefault(t)} disabled={!dirty || busy === `type:${t.employmentType}`} className="min-h-[44px]" data-testid={`type-default-save-${t.employmentType}`}>
                          Save
                        </PillButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <p className="text-xs text-text-mute font-mono uppercase mb-1">Per person (overrides type defaults) · reporting line routes approvals</p>
            <table className="w-full text-sm">
              <thead className="text-xs text-text-mute font-mono uppercase">
                <tr>
                  <th className="text-left py-2">Person</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">Annual days</th>
                  <th className="text-left">Sick days</th>
                  <th className="text-left">Source</th>
                  <th className="text-left">Managers</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const e = edits[r.personId] ?? { annualDays: String(r.annualDays), sickDays: String(r.sickDays) };
                  const dirty = Number(e.annualDays) !== r.annualDays || Number(e.sickDays) !== r.sickDays;
                  const mgrIds = edges.filter((ed) => ed.personId === r.personId).map((ed) => ed.managerPersonId);
                  return (
                    <tr key={r.personId} className="border-t border-border-soft" data-testid={`entitlement-row-${r.personId}`}>
                      <td className="py-2 text-text">{r.personName}</td>
                      <td><MonoChip>{r.employmentType ?? r.personType}</MonoChip></td>
                      <td>
                        <input type="number" min="0" max="366" className={cell} value={e.annualDays}
                          onChange={(ev) => setEdits((m) => ({ ...m, [r.personId]: { ...e, annualDays: ev.target.value } }))} />
                      </td>
                      <td>
                        <input type="number" min="0" max="366" className={cell} value={e.sickDays}
                          onChange={(ev) => setEdits((m) => ({ ...m, [r.personId]: { ...e, sickDays: ev.target.value } }))} />
                      </td>
                      <td><MonoChip tone={r.configured ? "gold" : "default"}>{r.source ?? (r.configured ? "custom" : "default")}</MonoChip></td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1" data-testid={`managers-${r.personId}`}>
                          {mgrIds.map((mid) => (
                            <MonoChip key={mid}>
                              {nameById.get(mid) ?? mid}
                              <button
                                type="button"
                                className="ml-1 text-text-mute hover:text-red-300"
                                aria-label={`Remove manager ${nameById.get(mid) ?? mid}`}
                                disabled={busy === `mgr:${r.personId}`}
                                onClick={() => setManagers(r.personId, mgrIds.filter((x) => x !== mid))}
                              >
                                ×
                              </button>
                            </MonoChip>
                          ))}
                          <select
                            className="rounded-md border border-border bg-bg px-1 py-1 text-xs text-text"
                            value=""
                            disabled={busy === `mgr:${r.personId}`}
                            onChange={(ev) => {
                              const v = ev.target.value;
                              if (v && !mgrIds.includes(v)) void setManagers(r.personId, [...mgrIds, v]);
                            }}
                            data-testid={`manager-add-${r.personId}`}
                          >
                            <option value="">+ manager…</option>
                            {employeeOptions
                              .filter((p) => p.personId !== r.personId && !mgrIds.includes(p.personId))
                              .map((p) => (
                                <option key={p.personId} value={p.personId}>{p.personName}</option>
                              ))}
                          </select>
                          {mgrIds.length === 0 && (
                            <span className="text-xs text-text-faint">HR/founders decide</span>
                          )}
                        </div>
                      </td>
                      <td className="text-right">
                        <PillButton onClick={() => save(r)} disabled={!dirty || busy === r.personId} className="min-h-[44px]" data-testid={`entitlement-save-${r.personId}`}>
                          Save
                        </PillButton>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-text-faint">No people on the roster.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
