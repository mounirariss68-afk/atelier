import * as React from "react";
import { Card, MonoChip } from "@/components/ui/primitives";
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
      <div className="container-atelier py-6">
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
