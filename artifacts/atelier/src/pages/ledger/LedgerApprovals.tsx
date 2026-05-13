import * as React from "react";
import { Link } from "wouter";
import { Card, MonoChip, PageHero, PillButton, SectionHead } from "@/components/ui/primitives";

interface Entry {
  id: string;
  workDate: string;
  engagementId: string | null;
  hours: number;
  billable: boolean;
  narrative: string | null;
  source: "human" | "agent_drafted";
  signalIds: string[];
  status: string;
}

interface Signal {
  id: string;
  workDate: string;
  signalType: string;
  evidenceSummary: string;
  weightHours: number;
  engagementHint: string | null;
}

interface WeekRow {
  id: string;
  personId: string;
  personName: string;
  weekIso: string;
  status: string;
  totalHours: number;
  billableHours: number;
  suspiciousFlags: string[];
  submittedAt: string | null;
  engagementEntries: Entry[];
  engagementSignals: Signal[];
}

interface Group {
  engagementId: string | null;
  engagementName: string;
  weeks: WeekRow[];
}

interface ApprovalsResp {
  stage: string;
  groups: Group[];
}

const STAGES: Array<{ key: string; label: string }> = [
  { key: "submitted", label: "Awaiting lead" },
  { key: "lead_approved", label: "Awaiting partner" },
  { key: "partner_approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export default function LedgerApprovals() {
  const [stage, setStage] = React.useState("submitted");
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [rejectFor, setRejectFor] = React.useState<WeekRow | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/atelier/ledger/approvals?stage=${stage}`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      }
      const data: ApprovalsResp = await r.json();
      setGroups(data.groups ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stage]);

  React.useEffect(() => { load(); }, [load]);

  const approve = async (row: WeekRow, role: "lead" | "partner") => {
    setBusyId(row.id);
    try {
      const r = await fetch(`/api/atelier/ledger/approvals/${row.id}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.reason || j.error || `HTTP ${r.status}`);
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async () => {
    if (!rejectFor || !rejectReason.trim()) return;
    setBusyId(rejectFor.id);
    try {
      const r = await fetch(`/api/atelier/ledger/approvals/${rejectFor.id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.reason || j.error || `HTTP ${r.status}`);
        return;
      }
      setRejectFor(null);
      setRejectReason("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (key: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHero>
        <SectionHead
          eyebrow={<MonoChip tone="gold">Ledger</MonoChip>}
          headline="Timesheet approvals"
          lede="Sun 21:00 GST submit · Tue 12:00 GST approve. Lead → Partner ladder. Grouped by engagement."
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <PillButton
              key={s.key}
              variant={stage === s.key ? "primary" : "ghost"}
              onClick={() => setStage(s.key)}
              className="min-h-[44px]"
            >
              {s.label}
            </PillButton>
          ))}
        </div>
      </PageHero>

      {error && <Card className="border-red-500/40 p-3 text-sm text-red-300">{error}</Card>}
      {loading ? (
        <div className="text-text-mute">Loading…</div>
      ) : groups.length === 0 ? (
        <Card className="p-4 text-text-mute">Nothing in this stage.</Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.engagementId ?? "internal"} className="p-3">
              <div className="flex items-baseline justify-between border-b border-border pb-2">
                <div className="font-semibold">{g.engagementName}</div>
                <MonoChip tone="default">{g.weeks.length} week{g.weeks.length === 1 ? "" : "s"}</MonoChip>
              </div>
              <div className="mt-3 space-y-3">
                {g.weeks.map((row) => {
                  const key = `${g.engagementId ?? "internal"}__${row.id}`;
                  const open = expanded.has(key);
                  const engHours = row.engagementEntries.reduce((s, e) => s + Number(e.hours || 0), 0);
                  return (
                    <div key={key} className="rounded border border-border bg-surface/30 p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-[160px]">
                          <Link href={`/ledger/timesheets/${row.personId}/${row.weekIso}`} className="font-semibold hover:text-gold">
                            {row.personName}
                          </Link>
                          <div className="text-xs text-text-mute">{row.weekIso}</div>
                        </div>
                        <MonoChip>{engHours.toFixed(1)}h on this engagement</MonoChip>
                        <MonoChip tone="green">{Number(row.billableHours).toFixed(1)}h bill (week)</MonoChip>
                        {row.suspiciousFlags.length > 0 && (
                          <MonoChip tone="amber" title={row.suspiciousFlags.join(", ")}>
                            {row.suspiciousFlags.length} flag(s)
                          </MonoChip>
                        )}
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          aria-expanded={open}
                          className="rounded border border-border px-2 py-1 text-xs text-text-mute hover:border-gold/60 min-h-[44px]"
                        >
                          {open ? "Hide evidence" : "Show evidence"}
                        </button>
                        <div className="ml-auto flex gap-2">
                          {row.status === "submitted" && (
                            <PillButton onClick={() => approve(row, "lead")} disabled={busyId === row.id} className="min-h-[44px]">
                              Lead approve
                            </PillButton>
                          )}
                          {row.status === "lead_approved" && (
                            <PillButton onClick={() => approve(row, "partner")} disabled={busyId === row.id} className="min-h-[44px]">
                              Partner approve
                            </PillButton>
                          )}
                          {(row.status === "submitted" || row.status === "lead_approved") && (
                            <PillButton variant="ghost" onClick={() => setRejectFor(row)} className="min-h-[44px]">
                              Reject
                            </PillButton>
                          )}
                        </div>
                      </div>
                      {open && (
                        <div className="mt-3 space-y-3 border-t border-border pt-3">
                          <div>
                            <div className="text-xs font-mono uppercase text-text-mute">Entries on this engagement</div>
                            <div className="mt-1 space-y-1">
                              {row.engagementEntries.length === 0 && (
                                <div className="text-xs italic text-text-mute">No entries.</div>
                              )}
                              {row.engagementEntries.map((e) => (
                                <div key={e.id} className="flex items-center gap-2 text-xs">
                                  <MonoChip tone={e.billable ? "green" : "default"}>{Number(e.hours).toFixed(1)}h</MonoChip>
                                  <span className="text-text-mute">{e.workDate}</span>
                                  {e.source === "agent_drafted" && <MonoChip tone="gold">AI</MonoChip>}
                                  <span className="truncate">{e.narrative ?? "—"}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-mono uppercase text-text-mute">Signal evidence</div>
                            <div className="mt-1 space-y-1">
                              {row.engagementSignals.length === 0 && (
                                <div className="text-xs italic text-text-mute">No signals captured.</div>
                              )}
                              {row.engagementSignals.map((s) => (
                                <div key={s.id} className="flex items-baseline gap-2 text-xs">
                                  <MonoChip tone="gold">{s.signalType}</MonoChip>
                                  <span className="text-text-mute">{s.weightHours}h · {s.workDate}</span>
                                  <span className="truncate">{s.evidenceSummary}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRejectFor(null)}>
          <div className="w-full max-w-md rounded border border-border bg-bg p-4" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold">Reject {rejectFor.personName} · {rejectFor.weekIso}</div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="mt-2 h-24 w-full rounded border border-border bg-surface/40 p-2 text-sm"
              placeholder="Reason (required) — sent back to the submitter."
            />
            <div className="mt-3 flex gap-2 justify-end">
              <PillButton variant="ghost" onClick={() => setRejectFor(null)} className="min-h-[44px]">Cancel</PillButton>
              <PillButton onClick={reject} disabled={!rejectReason.trim() || busyId === rejectFor.id} className="min-h-[44px]">
                Reject week
              </PillButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
