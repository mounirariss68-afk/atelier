import * as React from "react";
import { useParams } from "wouter";
import { Check, HelpCircle, StickyNote, Plus, X, ChevronsRight } from "lucide-react";
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
  // Me-lens only: approved leave intersecting this week, so timesheet and
  // leave can never visually disagree. Absent on the ledger surface.
  approvedLeave?: Array<{
    id: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    dates: string[];
  }>;
}

interface EngagementOption {
  id: string;
  name: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const INTERNAL_KEY = "__internal__";
const INTERNAL_LABEL = "Internal / non-billable";

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

/** Round to the nearest 0.25 and clamp to the 0.25–14 range used by the
 *  legacy manual-entry form. Returns null for "clear this cell". */
function normalizeHours(raw: string): number | null {
  const n = parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const stepped = Math.round(n * 4) / 4;
  if (stepped < 0.25) return null;
  return Math.min(stepped, 14);
}

function fmtHours(n: number): string {
  if (!n) return "";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

// A single row/day cell, derived from the (at most one expected) entries that
// match the row's engagement on that day.
interface CellModel {
  entries: Entry[];
  hours: number;
  primaryId: string | null;
  isDraft: boolean;
  isAiConfirmed: boolean;
  signalIds: string[];
  narrative: string;
}

interface RowModel {
  key: string; // engagementId or INTERNAL_KEY
  engagementId: string | null;
  label: string;
  cells: CellModel[]; // length 7, one per day
  total: number;
  hasEntries: boolean;
}

// Task #53 — the grid is reused by the Me lens (self-service personas who
// can only reach /me/* routes). Props swap the API base + the engagement
// option source; defaults preserve the original /ledger behaviour.
interface TimesheetProps {
  apiBase?: string;
  engagementsUrl?: string;
  eyebrow?: string;
}

export default function Timesheet({
  apiBase = "/api/atelier/ledger/timesheets",
  engagementsUrl = "/api/atelier/engagements",
  eyebrow = "Firm \u00b7 Ledger",
}: TimesheetProps = {}) {
  // Past-week routes pass /:personId/:weekIso. When absent we load the
  // active persona's current week via /ledger/timesheets/current.
  const params = useParams<{ personId?: string; weekIso?: string }>();
  const personId = params.personId;
  const weekIso = params.weekIso;
  const fetchUrl = personId && weekIso
    ? `${apiBase}/${personId}/${weekIso}`
    : `${apiBase}/current`;

  const [data, setData] = React.useState<WeekResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [drawerSignalIds, setDrawerSignalIds] = React.useState<string[] | null>(null);
  const [submitFlags, setSubmitFlags] = React.useState<string[] | null>(null);
  const [engagements, setEngagements] = React.useState<EngagementOption[]>([]);
  // Rows the user has explicitly added (or touched) this session, so a row
  // stays visible even before/after it holds any entries.
  const [extraRows, setExtraRows] = React.useState<Set<string>>(new Set());
  const [narrativeCell, setNarrativeCell] = React.useState<{ rowKey: string; date: string } | null>(null);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }, [fetchUrl]);

  React.useEffect(() => { load(); }, [load]);

  // Load engagements for the add-row dropdown. The endpoint returns a bare
  // array; tolerate a { engagements } envelope too.
  React.useEffect(() => {
    fetch(engagementsUrl, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: unknown) => {
        const list: Array<{ id: string; name: string }> = Array.isArray(j)
          ? (j as Array<{ id: string; name: string }>)
          : ((j as { engagements?: Array<{ id: string; name: string }> })?.engagements ?? []);
        setEngagements(list.map((e) => ({ id: e.id, name: e.name })));
      })
      .catch(() => setEngagements([]));
  }, [engagementsUrl]);

  const runSteward = async () => {
    if (!data) return;
    const r = await fetch(`${apiBase}/${data.week.id}/draft`, { method: "POST", credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.reason || j.error || `HTTP ${r.status}`);
      return;
    }
    await load(true);
  };

  const submit = async (acknowledgeFlags: boolean) => {
    if (!data) return;
    const r = await fetch(`${apiBase}/${data.week.id}/submit`, {
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
    await load(true);
  };

  // --- Mutations -------------------------------------------------------
  const apiErr = async (r: Response) => {
    const j = await r.json().catch(() => ({}));
    setError(j.reason || j.error || `HTTP ${r.status}`);
  };

  // Commit a typed value into a cell: create / update / clear the underlying
  // entry for that engagement + day. Multiple stray entries in one cell are
  // consolidated into the primary so the grid stays one-value-per-cell.
  const commitCell = async (row: RowModel, date: string, cell: CellModel, raw: string) => {
    if (!data) return;
    const next = normalizeHours(raw);
    const current = cell.hours;
    if (next === null) {
      if (cell.entries.length === 0) return; // nothing to clear
    } else if (next === current && cell.entries.length <= 1) {
      return; // no change
    }
    const weekId = data.week.id;
    try {
      if (next === null) {
        // Clear: delete every entry in the cell.
        for (const e of cell.entries) {
          const r = await fetch(`${apiBase}/entries/${e.id}`, {
            method: "DELETE", credentials: "include",
          });
          if (!r.ok) return apiErr(r);
        }
      } else {
        // Remove any extra entries beyond the primary (consolidate).
        for (const e of cell.entries.slice(1)) {
          const r = await fetch(`${apiBase}/entries/${e.id}`, {
            method: "DELETE", credentials: "include",
          });
          if (!r.ok) return apiErr(r);
        }
        const body = {
          id: cell.primaryId ?? undefined,
          workDate: date,
          hours: next,
          engagementId: row.engagementId,
          narrative: cell.narrative || null,
        };
        const r = await fetch(`${apiBase}/${weekId}/entries`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) return apiErr(r);
      }
      await load(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirmCell = async (cell: CellModel) => {
    if (!data) return;
    const weekId = data.week.id;
    for (const e of cell.entries) {
      if (!(e.source === "agent_drafted" && e.status === "draft")) continue;
      const r = await fetch(
        `${apiBase}/${weekId}/entries/${e.id}/confirm`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) return apiErr(r);
    }
    await load(true);
  };

  const saveNarrative = async (row: RowModel, date: string, cell: CellModel, text: string) => {
    if (!data || !cell.primaryId) return;
    const r = await fetch(`${apiBase}/${data.week.id}/entries`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: cell.primaryId,
        workDate: date,
        hours: cell.hours,
        engagementId: row.engagementId,
        narrative: text || null,
      }),
    });
    if (!r.ok) return apiErr(r);
    setNarrativeCell(null);
    await load(true);
  };

  // --- Keyboard navigation across cells --------------------------------
  // Holds the last value copied via ⌘/Ctrl+C so it can be pasted into another
  // cell. A raw string so paste reuses the same normalize/validate path.
  const copyBufferRef = React.useRef<string | null>(null);
  const cellRefs = React.useRef(new Map<string, HTMLInputElement | null>());
  const setCellRef = React.useCallback(
    (r: number, c: number) => (el: HTMLInputElement | null) => {
      cellRefs.current.set(`${r}:${c}`, el);
    },
    [],
  );

  if (loading) return <div className="p-6 text-text-mute">Loading timesheet…</div>;
  if (error && !data) return <div className="p-6 text-red-400">Error: {error}</div>;
  if (!data) return null;

  const w = data.week;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(w.weekStartDate, i));
  const editable = w.status === "draft" || w.status === "rejected";

  const signalsById = new Map(data.signals.map((s) => [s.id, s]));
  const drawerSignals = drawerSignalIds?.map((id) => signalsById.get(id)).filter(Boolean) as Signal[] | undefined;
  const engName = (id: string | null) =>
    id == null ? INTERNAL_LABEL : engagements.find((e) => e.id === id)?.name ?? id;

  // --- Build rows ------------------------------------------------------
  const rowKeys = new Set<string>();
  for (const e of data.entries) rowKeys.add(e.engagementId ?? INTERNAL_KEY);
  for (const k of extraRows) rowKeys.add(k);

  const rows: RowModel[] = [...rowKeys].map((key) => {
    const engagementId = key === INTERNAL_KEY ? null : key;
    const cells: CellModel[] = dates.map((d) => {
      const matches = data.entries.filter(
        (e) => (e.engagementId ?? INTERNAL_KEY) === key && e.workDate === d,
      );
      const hours = matches.reduce((s, e) => s + Number(e.hours || 0), 0);
      return {
        entries: matches,
        hours,
        primaryId: matches[0]?.id ?? null,
        isDraft: matches.some((e) => e.source === "agent_drafted" && e.status === "draft"),
        isAiConfirmed: matches.some((e) => e.source === "agent_drafted" && e.status === "confirmed"),
        signalIds: matches.flatMap((e) => e.signalIds),
        narrative: matches.find((e) => e.narrative)?.narrative ?? "",
      };
    });
    const total = cells.reduce((s, c) => s + c.hours, 0);
    return {
      key,
      engagementId,
      label: engName(engagementId),
      cells,
      total,
      hasEntries: cells.some((c) => c.entries.length > 0),
    };
  });
  // Stable order: billable engagement rows by label, internal row last.
  rows.sort((a, b) => {
    if (a.key === INTERNAL_KEY) return 1;
    if (b.key === INTERNAL_KEY) return -1;
    return a.label.localeCompare(b.label);
  });

  const dayTotals = dates.map((_, c) => rows.reduce((s, r) => s + r.cells[c].hours, 0));
  const weekTotal = dayTotals.reduce((s, h) => s + h, 0);

  const navigate = (r: number, c: number, dir: "up" | "down" | "left" | "right" | "next" | "prev") => {
    const R = rows.length;
    let nr = r, nc = c;
    if (dir === "up") nr = r - 1;
    else if (dir === "down") nr = r + 1;
    else if (dir === "left") nc = c - 1;
    else if (dir === "right") nc = c + 1;
    else if (dir === "next") { nc = c + 1; if (nc > 6) { nc = 0; nr = r + 1; } }
    else if (dir === "prev") { nc = c - 1; if (nc < 0) { nc = 6; nr = r - 1; } }
    nr = Math.max(0, Math.min(R - 1, nr));
    nc = Math.max(0, Math.min(6, nc));
    cellRefs.current.get(`${nr}:${nc}`)?.focus();
  };

  // Fill a value across the row's weekdays (Mon–Fri, cols 0–4). Each target
  // cell goes through the same normalize/consolidate/upsert path as a single
  // typed cell, so validation (0.25 step, max 14) is identical.
  const fillRowWeekdays = async (row: RowModel, raw: string) => {
    if (!data) return;
    const next = normalizeHours(raw);
    if (next === null) return; // nothing meaningful to fill
    const weekId = data.week.id;
    try {
      for (let c = 0; c < 5; c++) {
        const cell = row.cells[c];
        if (next === cell.hours && cell.entries.length <= 1) continue; // unchanged
        for (const e of cell.entries.slice(1)) {
          const r = await fetch(`${apiBase}/entries/${e.id}`, {
            method: "DELETE", credentials: "include",
          });
          if (!r.ok) return apiErr(r);
        }
        const body = {
          id: cell.primaryId ?? undefined,
          workDate: dates[c],
          hours: next,
          engagementId: row.engagementId,
          narrative: cell.narrative || null,
        };
        const r = await fetch(`${apiBase}/${weekId}/entries`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) return apiErr(r);
      }
      await load(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Add-row dropdown options: engagements + internal not already shown.
  const addOptions: Array<{ value: string; label: string }> = [];
  if (!rowKeys.has(INTERNAL_KEY)) addOptions.push({ value: INTERNAL_KEY, label: INTERNAL_LABEL });
  for (const e of engagements) {
    if (!rowKeys.has(e.id)) addOptions.push({ value: e.id, label: e.name });
  }

  const gridTemplate = `minmax(160px, 1.6fr) repeat(7, minmax(72px, 1fr)) minmax(74px, 0.9fr)`;

  const narrativeRow = narrativeCell ? rows.find((r) => r.key === narrativeCell.rowKey) : null;
  const narrativeColIdx = narrativeCell ? dates.indexOf(narrativeCell.date) : -1;
  const narrativeCellModel = narrativeRow && narrativeColIdx >= 0 ? narrativeRow.cells[narrativeColIdx] : null;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHero>
        <SectionHead
          eyebrow={eyebrow}
          headline={`Timesheet — ${w.weekIso}`}
          lede={`${w.personName} · week of ${w.weekStartDate}`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MonoChip tone={statusTone(w.status)}>{w.status.replace("_", " ")}</MonoChip>
          <MonoChip>{weekTotal.toFixed(1)}h total</MonoChip>
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
        {(data?.approvedLeave?.length ?? 0) > 0 && (
          <Card className="mt-3 border-emerald-500/40 bg-emerald-500/5 p-3 text-sm" data-testid="approved-leave-banner">
            <span className="text-emerald-300 font-medium">On leave this week: </span>
            <span className="text-text">
              {data!.approvedLeave!.map((l) => `${l.leaveType} ${l.dates[0]}${l.dates.length > 1 ? ` → ${l.dates[l.dates.length - 1]}` : ""}`).join(" · ")}
            </span>
          </Card>
        )}
      </PageHero>

      <div className="flex flex-wrap items-center gap-2">
        <PillButton onClick={runSteward} disabled={!editable} className="min-h-[44px]">
          Run Time Steward
        </PillButton>
        <PillButton onClick={() => submit(false)} disabled={!editable} className="min-h-[44px]">
          Submit week
        </PillButton>
        {editable && (
          <span className="text-xs text-text-mute">
            Type hours into a cell · arrows / Tab / Enter to move · ⌘/Ctrl+C then ⌘/Ctrl+V to copy a value · the » button fills it across Mon–Fri · edits save on blur
          </span>
        )}
      </div>

      {error && data && (
        <Card className="border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">{error}</Card>
      )}

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

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[760px]">
          {/* Header */}
          <div
            className="grid border-b border-border bg-bg-elevate/60 text-xs font-mono uppercase tracking-wide text-text-mute"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="sticky left-0 z-10 bg-bg-elevate px-3 py-2">Engagement / activity</div>
            {dates.map((d, i) => (
              <div key={d} className="px-2 py-2 text-center">
                <div className="text-text">{DAY_LABELS[i]}</div>
                <div className="text-[10px] text-text-faint">{d.slice(5)}</div>
              </div>
            ))}
            <div className="px-2 py-2 text-center text-text">Total</div>
          </div>

          {/* Body rows */}
          {rows.map((row, r) => (
            <div
              key={row.key}
              className="grid border-b border-border-soft last:border-b-0 hover:bg-surface/30"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="sticky left-0 z-10 flex items-center gap-2 bg-bg px-3 py-2">
                <span className={row.engagementId ? "h-2 w-2 shrink-0 rounded-full bg-success" : "h-2 w-2 shrink-0 rounded-full bg-text-faint"} />
                <span className="truncate text-sm text-text" title={row.label}>{row.label}</span>
                {editable && !row.hasEntries && (
                  <button
                    type="button"
                    onClick={() => setExtraRows((s) => { const n = new Set(s); n.delete(row.key); return n; })}
                    className="ml-auto rounded p-1 text-text-faint hover:text-red-300"
                    aria-label="Remove empty row"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {row.cells.map((cell, c) => (
                <HourCell
                  key={dates[c]}
                  cell={cell}
                  editable={editable}
                  inputRef={setCellRef(r, c)}
                  onCommit={(raw) => commitCell(row, dates[c], cell, raw)}
                  onNavigate={(dir) => navigate(r, c, dir)}
                  onConfirm={() => confirmCell(cell)}
                  onWhy={() => setDrawerSignalIds(cell.signalIds)}
                  onNote={() => setNarrativeCell({ rowKey: row.key, date: dates[c] })}
                  onFill={(raw) => fillRowWeekdays(row, raw)}
                  onCopy={(raw) => { copyBufferRef.current = raw; }}
                  onPaste={() => copyBufferRef.current}
                />
              ))}
              <div className="flex items-center justify-center px-2 py-2 text-sm tabular-nums text-text">
                {row.total ? row.total.toFixed(2).replace(/\.?0+$/, "") : "—"}
              </div>
            </div>
          ))}

          {/* Footer totals */}
          <div
            className="grid border-t border-border bg-bg-elevate/60 text-sm font-medium"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="sticky left-0 z-10 bg-bg-elevate px-3 py-2 text-xs font-mono uppercase tracking-wide text-text-mute">
              Daily total
            </div>
            {dayTotals.map((h, i) => (
              <div
                key={i}
                className={`px-2 py-2 text-center tabular-nums ${h > 14 ? "text-amber-300" : "text-text"}`}
              >
                {h ? h.toFixed(2).replace(/\.?0+$/, "") : "—"}
              </div>
            ))}
            <div className="px-2 py-2 text-center tabular-nums text-gold">
              {weekTotal ? weekTotal.toFixed(2).replace(/\.?0+$/, "") : "—"}
            </div>
          </div>
        </div>
      </div>

      {editable && addOptions.length > 0 && (
        <AddRowControl
          options={addOptions}
          onAdd={(key) => setExtraRows((s) => new Set(s).add(key))}
        />
      )}

      {rows.length === 0 && (
        <div className="text-sm italic text-text-mute">
          No hours yet. Run the Time Steward to pre-fill a draft, or add an engagement row.
        </div>
      )}

      {/* Narrative popover */}
      {narrativeCell && narrativeRow && narrativeCellModel && (
        <NarrativeModal
          title={`${narrativeRow.label} · ${narrativeCell.date.slice(5)}`}
          initial={narrativeCellModel.narrative}
          canSave={!!narrativeCellModel.primaryId && editable}
          onCancel={() => setNarrativeCell(null)}
          onSave={(text) => saveNarrative(narrativeRow, narrativeCell.date, narrativeCellModel, text)}
        />
      )}

      {/* Signal evidence drawer */}
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
              {drawerSignals.length === 0 && (
                <div className="text-sm italic text-text-mute">No signals recorded for this cell.</div>
              )}
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

// --- Hour cell --------------------------------------------------------
function HourCell({
  cell,
  editable,
  inputRef,
  onCommit,
  onNavigate,
  onConfirm,
  onWhy,
  onNote,
  onFill,
  onCopy,
  onPaste,
}: {
  cell: CellModel;
  editable: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onCommit: (raw: string) => void;
  onNavigate: (dir: "up" | "down" | "left" | "right" | "next" | "prev") => void;
  onConfirm: () => void;
  onWhy: () => void;
  onNote: () => void;
  onFill: (raw: string) => void;
  onCopy: (raw: string) => void;
  onPaste: () => string | null;
}) {
  const valueStr = fmtHours(cell.hours);
  const [val, setVal] = React.useState(valueStr);
  const focusedRef = React.useRef(false);

  React.useEffect(() => {
    if (!focusedRef.current) setVal(valueStr);
  }, [valueStr]);

  const hasSignals = cell.signalIds.length > 0;
  const hasNarrative = !!cell.narrative;
  const hasValue = val.trim() !== "";

  if (!editable) {
    return (
      <div className="relative flex items-center justify-center border-l border-border-soft px-2 py-2">
        <span className={`text-sm tabular-nums ${cell.hours ? "text-text" : "text-text-faint"}`}>
          {cell.hours ? valueStr : "·"}
        </span>
        {cell.isDraft && <span className="absolute left-1 top-1 text-[8px] font-mono text-gold">AI</span>}
        {cell.isAiConfirmed && <Check className="absolute left-1 top-1 h-2.5 w-2.5 text-success" />}
        {hasNarrative && <StickyNote className="absolute bottom-1 right-1 h-2.5 w-2.5 text-text-faint" />}
      </div>
    );
  }

  return (
    <div className="group relative border-l border-border-soft">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={val}
        aria-label="Hours"
        onChange={(e) => setVal(e.target.value)}
        onFocus={(e) => { focusedRef.current = true; e.currentTarget.select(); }}
        onBlur={() => { focusedRef.current = false; onCommit(val); }}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          if (e.key === "Enter") { e.preventDefault(); onNavigate("down"); }
          else if (e.key === "Tab") { e.preventDefault(); onNavigate(e.shiftKey ? "prev" : "next"); }
          else if (e.key === "ArrowUp") { e.preventDefault(); onNavigate("up"); }
          else if (e.key === "ArrowDown") { e.preventDefault(); onNavigate("down"); }
          else if (e.key === "ArrowLeft") {
            if (el.selectionStart === 0 && el.selectionEnd === 0) { e.preventDefault(); onNavigate("left"); }
          } else if (e.key === "ArrowRight") {
            if (el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
              e.preventDefault(); onNavigate("right");
            }
          } else if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C")) {
            onCopy(val); // remember value; OS still copies any selected text
          } else if ((e.metaKey || e.ctrlKey) && (e.key === "v" || e.key === "V")) {
            // Only intercept when we have an in-grid copied value; otherwise
            // let the browser paste clipboard text into the input normally.
            const pasted = onPaste();
            if (pasted != null) { e.preventDefault(); setVal(pasted); }
          } else if (e.key === "Escape") { setVal(valueStr); el.blur(); }
        }}
        className={`h-11 w-full bg-transparent px-2 text-center text-sm tabular-nums text-text outline-none focus:bg-surface/60 focus:ring-1 focus:ring-gold/60 ${cell.isDraft ? "bg-gold/10" : ""}`}
      />
      {cell.isDraft && (
        <span className="pointer-events-none absolute left-1 top-0.5 text-[8px] font-mono text-gold">AI</span>
      )}
      {cell.isAiConfirmed && (
        <Check className="pointer-events-none absolute left-1 top-1 h-2.5 w-2.5 text-success" />
      )}
      {hasNarrative && !cell.isDraft && !cell.isAiConfirmed && (
        <StickyNote className="pointer-events-none absolute left-1 top-1 h-2.5 w-2.5 text-text-faint" />
      )}
      {/* Per-cell affordances — surface on hover / focus to keep the grid clean */}
      <div className="absolute bottom-0.5 right-0.5 hidden items-center gap-0.5 rounded bg-bg/80 px-0.5 group-hover:flex group-focus-within:flex">
        {hasValue && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFill(val)}
            className="rounded p-0.5 text-text-mute hover:bg-surface hover:text-gold"
            title="Fill this value across weekdays (Mon–Fri)"
            aria-label="Fill this value across weekdays"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        )}
        {cell.isDraft && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onConfirm}
            className="rounded p-0.5 text-gold hover:bg-gold/20"
            title="Confirm AI-drafted hours"
            aria-label="Confirm AI-drafted hours"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
        {hasSignals && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onWhy}
            className="rounded p-0.5 text-text-mute hover:bg-surface hover:text-gold"
            title="Why? — show signal evidence"
            aria-label="Why? Show signal evidence"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        )}
        {cell.primaryId && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onNote}
            className={`rounded p-0.5 hover:bg-surface ${hasNarrative ? "text-gold" : "text-text-mute hover:text-gold"}`}
            title="Note — view or edit narrative"
            aria-label="Note — view or edit narrative"
          >
            <StickyNote className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Add-row dropdown -------------------------------------------------
function AddRowControl({
  options,
  onAdd,
}: {
  options: Array<{ value: string; label: string }>;
  onAdd: (key: string) => void;
}) {
  const [value, setValue] = React.useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Plus className="h-4 w-4 text-text-mute" />
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v) { onAdd(v); setValue(""); }
        }}
        aria-label="Add engagement or activity row"
        className="min-h-[44px] rounded border border-dashed border-border bg-surface/60 px-3 py-2 text-sm text-text hover:border-gold/60"
      >
        <option value="">Add engagement / activity row…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// --- Narrative modal --------------------------------------------------
function NarrativeModal({
  title,
  initial,
  canSave,
  onCancel,
  onSave,
}: {
  title: string;
  initial: string;
  canSave: boolean;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = React.useState(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <Card className="w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Note — {title}</div>
          <button type="button" onClick={onCancel} className="text-text-mute hover:text-text" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          rows={4}
          placeholder="What did you do? (e.g. thinking through pricing approach)"
          disabled={!canSave}
          className="mt-3 w-full rounded border border-border bg-surface/60 px-3 py-2 text-sm text-text outline-none focus:ring-1 focus:ring-gold/60 disabled:opacity-60"
        />
        <div className="mt-3 flex justify-end gap-2">
          <PillButton variant="ghost" onClick={onCancel} className="min-h-[44px]">Cancel</PillButton>
          {canSave && (
            <PillButton onClick={() => onSave(text)} className="min-h-[44px]">Save note</PillButton>
          )}
        </div>
      </Card>
    </div>
  );
}
