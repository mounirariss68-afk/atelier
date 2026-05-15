import * as React from "react";
import { useParams } from "wouter";
import { Card, MonoChip, PageHero, PillButton, SectionHead } from "@/components/ui/primitives";

interface Entry {
  id: string;
  workDate: string;
  engagementId: string | null;
  activityCode: string | null;
  hours: number;
  billable: boolean;
  narrative: string | null;
  source: "human" | "agent_drafted";
  draftedByAgentId: string | null;
  signalIds: string[];
  status: string;
}

interface Signal {
  id: string;
  workDate: string;
  signalType: string;
  sourceRefType: string;
  sourceRefId: string;
  engagementHint: string | null;
  evidenceSummary: string;
  weightHours: number;
  observedAt: string;
}

interface WeekResp {
  week: {
    id: string;
    personId: string;
    personType: string;
    personName: string;
    weekIso: string;
    weekStartDate: string;
    status: string;
    totalHours: number;
    billableHours: number;
    suspiciousFlags: string[];
    submittedAt: string | null;
    leadApprovedAt: string | null;
    partnerApprovedAt: string | null;
    rejectionReason: string | null;
  };
  entries: Entry[];
  signals: Signal[];
}

interface EngagementOption {
  id: string;
  name: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function statusTone(s: string): "default" | "amber" | "green" | "gold" | "red" {
  if (s === "draft") return "default";
  if (s === "submitted") return "amber";
  if (s === "lead_approved") return "gold";
  if (s === "partner_approved") return "green";
  if (s === "rejected") return "red";
  return "default";
}

export default function Timesheet() {
  // Past-week routes pass /:personId/:weekIso. When absent we load the
  // active persona's current week via /ledger/timesheets/current.
  const params = useParams<{ personId?: string; weekIso?: string }>();
  const personId = params.personId;
  const weekIso = params.weekIso;
  const fetchUrl = personId && weekIso
    ? `/api/atelier/ledger/timesheets/${personId}/${weekIso}`
    : `/api/atelier/ledger/timesheets/current`;

  const [data, setData] = React.useState<WeekResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [drawerSignalIds, setDrawerSignalIds] = React.useState<string[] | null>(null);
  const [submitFlags, setSubmitFlags] = React.useState<string[] | null>(null);
  const [busyEntryId, setBusyEntryId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState<string | null>(null); // workDate
  const [engagements, setEngagements] = React.useState<EngagementOption[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(fetchUrl, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      }
      setData(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fetchUrl]);

  React.useEffect(() => { load(); }, [load]);

  // Load engagements for the manual-entry dropdown (small list, OK to fetch once).
  React.useEffect(() => {
    fetch("/api/atelier/engagements", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { engagements: [] }))
      .then((j: { engagements?: Array<{ id: string; name: string }> }) =>
        setEngagements((j.engagements ?? []).map((e) => ({ id: e.id, name: e.name }))),
      )
      .catch(() => setEngagements([]));
  }, []);

  const runSteward = async () => {
    if (!data) return;
    const r = await fetch(`/api/atelier/ledger/timesheets/${data.week.id}/draft`, { method: "POST", credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.reason || j.error || `HTTP ${r.status}`);
      return;
    }
    await load();
  };

  const submit = async (acknowledgeFlags: boolean) => {
    if (!data) return;
    const r = await fetch(`/api/atelier/ledger/timesheets/${data.week.id}/submit`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgeFlags }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409 && j.error === "suspicious-pattern") {
      setSubmitFlags(j.flags ?? []);
      return;
    }
    if (!r.ok) {
      setError(j.reason || j.error || `HTTP ${r.status}`);
      return;
    }
    setSubmitFlags(null);
    await load();
  };

  const confirmEntry = async (entry: Entry) => {
    if (!data) return;
    setBusyEntryId(entry.id);
    try {
      const r = await fetch(
        `/api/atelier/ledger/timesheets/${data.week.id}/entries/${entry.id}/confirm`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.reason || j.error || `HTTP ${r.status}`);
        return;
      }
      await load();
    } finally {
      setBusyEntryId(null);
    }
  };

  const deleteEntry = async (entry: Entry) => {
    setBusyEntryId(entry.id);
    try {
      const r = await fetch(`/api/atelier/ledger/timesheets/entries/${entry.id}`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.reason || j.error || `HTTP ${r.status}`);
        return;
      }
      await load();
    } finally {
      setBusyEntryId(null);
    }
  };

  const addManualEntry = async (workDate: string, hours: number, engagementId: string | null, narrative: string) => {
    if (!data || !hours || hours <= 0) return;
    const r = await fetch(`/api/atelier/ledger/timesheets/${data.week.id}/entries`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workDate, hours, engagementId, narrative, billable: !!engagementId }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.reason || j.error || `HTTP ${r.status}`);
      return;
    }
    setAddOpen(null);
    await load();
  };

  if (loading) return <div className="p-6 text-text-mute">Loading timesheet…</div>;
  if (error) return <div className="p-6 text-red-400">Error: {error}</div>;
  if (!data) return null;

  const w = data.week;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(w.weekStartDate, i));
  const entriesByDate = new Map<string, Entry[]>();
  for (const e of data.entries) {
    const arr = entriesByDate.get(e.workDate) ?? [];
    arr.push(e);
    entriesByDate.set(e.workDate, arr);
  }
  const signalsById = new Map(data.signals.map((s) => [s.id, s]));
  const drawerSignals = drawerSignalIds?.map((id) => signalsById.get(id)).filter(Boolean) as Signal[] | undefined;
  const editable = w.status === "draft" || w.status === "rejected";

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Ledger"
          headline={`Timesheet — ${w.weekIso}`}
          lede={`${w.personName} · week of ${w.weekStartDate}`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MonoChip tone={statusTone(w.status)}>{w.status.replace("_", " ")}</MonoChip>
          <MonoChip>{w.totalHours.toFixed(1)}h total</MonoChip>
          <MonoChip tone="green">{w.billableHours.toFixed(1)}h billable</MonoChip>
          {w.suspiciousFlags.length > 0 && (
            <MonoChip tone="amber">{w.suspiciousFlags.length} flag(s)</MonoChip>
          )}
        </div>
        {w.rejectionReason && (
          <Card className="mt-3 border-red-500/40 p-3 text-sm text-red-300">
            Rejected: {w.rejectionReason}
          </Card>
        )}
      </PageHero>

      <div className="flex flex-wrap gap-2">
        <PillButton onClick={runSteward} disabled={!editable} className="min-h-[44px]">
          Run Time Steward
        </PillButton>
        <PillButton onClick={() => submit(false)} disabled={!editable} className="min-h-[44px]">
          Submit week
        </PillButton>
      </div>

      {submitFlags && submitFlags.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5 p-4">
          <div className="text-sm font-semibold text-amber-300">Suspicious pattern detected</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-text-mute">
            {submitFlags.map((f) => (
              <li key={f} className="font-mono">{f}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <PillButton onClick={() => submit(true)} className="min-h-[44px]">Acknowledge & submit</PillButton>
            <PillButton variant="ghost" onClick={() => setSubmitFlags(null)} className="min-h-[44px]">Cancel</PillButton>
          </div>
        </Card>
      )}

      <div className="overflow-x-auto">
        <div className="grid min-w-[700px] grid-cols-7 gap-2">
          {dates.map((d, i) => {
            const dayEntries = entriesByDate.get(d) ?? [];
            const dayHours = dayEntries.reduce((s, e) => s + Number(e.hours || 0), 0);
            return (
              <Card key={d} className="min-h-[200px] p-3">
                <div className="flex items-baseline justify-between">
                  <div className="text-xs font-mono uppercase text-text-mute">{DAY_LABELS[i]}</div>
                  <div className="text-xs text-text-mute">{d.slice(5)}</div>
                </div>
                <div className="mt-1 text-lg font-semibold">{dayHours.toFixed(1)}h</div>
                <div className="mt-2 space-y-2">
                  {dayEntries.map((e) => {
                    const isAgentDraft = e.source === "agent_drafted" && e.status === "draft";
                    return (
                      <div
                        key={e.id}
                        className="rounded border border-border bg-surface/40 p-2 text-xs"
                      >
                        <div className="flex items-center gap-1">
                          <MonoChip tone={e.billable ? "green" : "default"}>{Number(e.hours).toFixed(1)}h</MonoChip>
                          {e.source === "agent_drafted" && (
                            <MonoChip tone={e.status === "confirmed" ? "green" : "gold"}>
                              {e.status === "confirmed" ? "AI ✓" : "AI"}
                            </MonoChip>
                          )}
                        </div>
                        <div className="mt-1 truncate text-text-mute">{e.engagementId ?? e.activityCode ?? "—"}</div>
                        {e.narrative && <div className="mt-1 line-clamp-2 text-text">{e.narrative}</div>}
                        {editable && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {isAgentDraft && (
                              <button
                                type="button"
                                onClick={() => confirmEntry(e)}
                                disabled={busyEntryId === e.id}
                                className="rounded bg-gold/20 px-2 py-1 text-[11px] text-gold hover:bg-gold/30 min-h-[44px]"
                                aria-label="Confirm this AI-drafted entry"
                              >
                                Confirm
                              </button>
                            )}
                            {e.signalIds.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setDrawerSignalIds(e.signalIds)}
                                className="rounded border border-border px-2 py-1 text-[11px] text-text-mute hover:border-gold/60 min-h-[44px]"
                              >
                                Why?
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteEntry(e)}
                              disabled={busyEntryId === e.id}
                              className="ml-auto rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 min-h-[44px]"
                              aria-label="Delete entry"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {dayEntries.length === 0 && (
                    <div className="text-xs italic text-text-mute">No entries.</div>
                  )}
                </div>
                {editable && (
                  addOpen === d ? (
                    <ManualEntryForm
                      engagements={engagements}
                      onCancel={() => setAddOpen(null)}
                      onSubmit={(hours, engId, narrative) => addManualEntry(d, hours, engId, narrative)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddOpen(d)}
                      className="mt-2 w-full rounded border border-dashed border-border py-1 text-xs text-text-mute hover:border-gold/60 min-h-[44px]"
                    >
                      + Add hours
                    </button>
                  )
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {drawerSignals && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40" onClick={() => setDrawerSignalIds(null)}>
          <div
            className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-bg p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold">Signal evidence</div>
              <button type="button" onClick={() => setDrawerSignalIds(null)} className="text-text-mute min-h-[44px] px-2">Close</button>
            </div>
            <div className="mt-3 space-y-3">
              {drawerSignals.map((s) => (
                <Card key={s.id} className="p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <MonoChip tone="gold">{s.signalType}</MonoChip>
                    <span className="text-xs text-text-mute">{s.weightHours}h · {s.workDate}</span>
                  </div>
                  <div className="mt-1">{s.evidenceSummary}</div>
                  {s.engagementHint && (
                    <div className="mt-1 font-mono text-xs text-text-mute">→ {s.engagementHint}</div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualEntryForm({
  engagements,
  onCancel,
  onSubmit,
}: {
  engagements: EngagementOption[];
  onCancel: () => void;
  onSubmit: (hours: number, engagementId: string | null, narrative: string) => void;
}) {
  const [hours, setHours] = React.useState("1.0");
  const [engId, setEngId] = React.useState<string>("");
  const [narrative, setNarrative] = React.useState("");
  return (
    <div className="mt-2 space-y-2 rounded border border-gold/40 bg-gold/5 p-2">
      <input
        type="number" step="0.25" min="0.25" max="14"
        value={hours} onChange={(e) => setHours(e.target.value)}
        placeholder="Hours" aria-label="Hours"
        className="w-full rounded border border-border bg-surface/60 px-2 py-1 text-xs"
      />
      <select
        value={engId} onChange={(e) => setEngId(e.target.value)}
        aria-label="Engagement"
        className="w-full rounded border border-border bg-surface/60 px-2 py-1 text-xs"
      >
        <option value="">Internal / non-billable</option>
        {engagements.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <input
        type="text" value={narrative} onChange={(e) => setNarrative(e.target.value)}
        placeholder="What did you do? (e.g. 1.5h thinking through pricing)"
        aria-label="Narrative"
        className="w-full rounded border border-border bg-surface/60 px-2 py-1 text-xs"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onSubmit(Number(hours), engId || null, narrative)}
          className="flex-1 rounded bg-gold/20 py-1 text-xs text-gold hover:bg-gold/30 min-h-[44px]"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-2 py-1 text-xs text-text-mute hover:border-gold/60 min-h-[44px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
