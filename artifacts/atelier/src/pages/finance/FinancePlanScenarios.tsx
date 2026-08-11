/**
 * FinancePlanScenarios — base / upside / downside / KSA-led variant
 * comparison vs base case (Task #420, Wave 8).
 */
import * as React from "react";
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useCommitFpaScenario, useFpaCommittedScenario, useFpaScenarios, usePlanEntities, useUncommitFpaScenario } from "@/lib/v5-hooks";
import { PRESENTATION_CURRENCIES, usePresentationCurrency } from "@/lib/presentationCurrency";


function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${currency} ${abs.toFixed(0)}`;
}
function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function pctDelta(n: number): string { return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`; }

const TONE: Record<string, "default" | "green" | "amber" | "red" | "gold"> = {
  base: "default", upside: "green", downside: "red", ksa_only: "gold",
};

export default function FinancePlanScenarios() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = usePresentationCurrency();
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const { data } = useFpaScenarios(presentation, entityFilter);
  const commitsQ = useFpaCommittedScenario();
  const commitMut = useCommitFpaScenario();
  const uncommitMut = useUncommitFpaScenario();
  const [commitFor, setCommitFor] = React.useState<string | null>(null);
  const [commitNote, setCommitNote] = React.useState("");
  const [commitErr, setCommitErr] = React.useState<string | null>(null);
  const [showUncommit, setShowUncommit] = React.useState(false);
  const [uncommitNote, setUncommitNote] = React.useState("");
  const [uncommitErr, setUncommitErr] = React.useState<string | null>(null);
  const committedId = data?.committedScenarioId ?? null;
  const canCommit = !!data?.canCommit;
  const current = commitsQ.data?.current ?? data?.committedScenario ?? null;
  const canUncommit = !!commitsQ.data?.canUncommit && current != null;
  const churnWindowDays = commitsQ.data?.churnWindowDays ?? 14;

  async function submitCommit() {
    if (!commitFor) return;
    setCommitErr(null);
    try {
      await commitMut.mutateAsync({ scenarioId: commitFor, note: commitNote.trim() || undefined });
      setCommitFor(null); setCommitNote("");
    } catch (e) {
      setCommitErr(e instanceof Error ? e.message : "Commit failed");
    }
  }

  async function submitUncommit() {
    setUncommitErr(null);
    try {
      await uncommitMut.mutateAsync({ note: uncommitNote.trim() || undefined });
      setShowUncommit(false); setUncommitNote("");
    } catch (e) {
      setUncommitErr(e instanceof Error ? e.message : "Unlock failed");
    }
  }

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-plan-scenarios">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Scenarios vs base case"
            lede="What-if comparisons across utilisation, rate, FX and attrition deltas. Each scenario re-runs the driver model end-to-end against the same headcount plan."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
            <select value={entityFilter ?? "consolidated"} onChange={(e) => setEntityFilter(e.target.value === "consolidated" ? null : e.target.value)} className="bg-bg-elevate border border-border rounded px-2 py-1" data-testid="select-entity">
              <option value="consolidated">Consolidated</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
            </select>
            <select value={presentation} onChange={(e) => setPresentation(e.target.value)} className="bg-bg-elevate border border-border rounded px-2 py-1" data-testid="select-currency">
              {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {!data ? <Card className="p-6 text-text-mute">Loading scenarios…</Card> : (
          <>
            {current && (
              <Card className="p-3 border-gold/40 bg-gold/5" data-testid="committed-banner">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="text-xs font-mono">
                    <MonoChip tone="gold">COMMITTED</MonoChip>
                    <span className="ml-2 text-text">{current.scenarioLabel}</span>
                    <span className="text-text-mute"> · {current.periodLabel || "FY2026"} · committed by {current.byUserName} ({current.byRole}) on {new Date(current.committedAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {current.note && <div className="text-[11px] text-text-mute italic max-w-md truncate" title={current.note}>“{current.note}”</div>}
                    {canUncommit && (
                      <button
                        type="button"
                        onClick={() => { setShowUncommit(true); setUncommitNote(""); setUncommitErr(null); }}
                        disabled={uncommitMut.isPending}
                        className="text-[11px] font-mono px-2 py-1 rounded border border-gold/50 text-gold hover:bg-gold/10 disabled:opacity-50"
                        data-testid="button-uncommit"
                      >
                        Unlock committed forecast
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {showUncommit && (
              <Card className="p-4 border-gold/40" data-testid="uncommit-confirm">
                <div className="text-sm font-display mb-2">
                  Unlock the committed forecast?
                </div>
                <div className="text-xs text-text-mute mb-3">
                  This reverts variance reporting (firm economics) and the budget page to no committed forecast (base case). The action is recorded in the audit trail and visible to all personas.
                </div>
                <textarea
                  value={uncommitNote}
                  onChange={(e) => setUncommitNote(e.target.value.slice(0, 1000))}
                  placeholder="Reason (optional) — e.g. mid-period re-plan, board-pack revision."
                  className="w-full bg-bg-elevate border border-border rounded p-2 text-xs font-mono"
                  rows={2}
                  data-testid="input-uncommit-note"
                />
                {uncommitErr && <div className="text-xs text-danger mt-2">{uncommitErr}</div>}
                <div className="flex items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={submitUncommit}
                    disabled={uncommitMut.isPending}
                    className="text-xs font-mono px-3 py-1.5 rounded bg-gold text-bg disabled:opacity-50"
                    data-testid="button-uncommit-confirm"
                  >
                    {uncommitMut.isPending ? "Unlocking…" : "Confirm unlock"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowUncommit(false); setUncommitNote(""); setUncommitErr(null); }}
                    disabled={uncommitMut.isPending}
                    className="text-xs font-mono px-3 py-1.5 rounded border border-border"
                    data-testid="button-uncommit-cancel"
                  >
                    Cancel
                  </button>
                </div>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="scenario-cards">
              {data.comparisons.map((c) => {
                const isCommitted = c.scenarioId === committedId;
                return (
                <Card key={c.scenarioId} className={`p-4 border ${isCommitted ? "border-gold/60 ring-1 ring-gold/40" : c.scenarioId === "base" ? "border-border" : c.deltas.ebitdaPct >= 0 ? "border-success/40" : "border-danger/40"}`} data-testid={`scenario-card-${c.scenarioId}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-display">{c.scenarioLabel}</div>
                      {isCommitted && <MonoChip tone="gold" data-testid={`badge-committed-${c.scenarioId}`}>COMMITTED</MonoChip>}
                    </div>
                    <MonoChip tone={TONE[c.scenarioId] ?? "default"}>{c.scenarioId}</MonoChip>
                  </div>
                  <div className="text-[11px] text-text-mute mt-1 leading-snug">{c.description}</div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                    <div>
                      <div className="text-[10px] uppercase text-text-faint font-mono">Revenue</div>
                      <div className="font-mono">{fmt(c.revenue, presentation)}</div>
                      {c.scenarioId !== "base" && <div className={`font-mono text-[11px] ${c.deltas.revenuePct >= 0 ? "text-success" : "text-danger"}`}>{pctDelta(c.deltas.revenuePct)}</div>}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-text-faint font-mono">EBITDA</div>
                      <div className={`font-mono ${c.ebitda >= 0 ? "text-success" : "text-danger"}`}>{fmt(c.ebitda, presentation)}</div>
                      {c.scenarioId !== "base" && <div className={`font-mono text-[11px] ${c.deltas.ebitdaPct >= 0 ? "text-success" : "text-danger"}`}>{pctDelta(c.deltas.ebitdaPct)}</div>}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-text-faint font-mono">Gross margin</div>
                      <div className="font-mono">{pct(c.grossMarginPct)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-text-faint font-mono">EBITDA margin</div>
                      <div className="font-mono">{pct(c.ebitdaMarginPct)}</div>
                      {c.scenarioId !== "base" && <div className={`font-mono text-[11px] ${c.deltas.ebitdaMarginPctPts >= 0 ? "text-success" : "text-danger"}`}>{c.deltas.ebitdaMarginPctPts >= 0 ? "+" : ""}{(c.deltas.ebitdaMarginPctPts * 100).toFixed(1)} pts</div>}
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border-soft">
                    {isCommitted ? (
                      <div className="text-[11px] font-mono text-gold/90" data-testid={`committed-tag-${c.scenarioId}`}>
                        ✓ Committed forecast
                      </div>
                    ) : canCommit ? (
                      <button
                        type="button"
                        onClick={() => { setCommitFor(c.scenarioId); setCommitNote(""); setCommitErr(null); }}
                        disabled={commitMut.isPending}
                        className="text-[11px] font-mono px-2 py-1 rounded border border-gold/40 text-gold hover:bg-gold/10 disabled:opacity-50"
                        data-testid={`button-commit-${c.scenarioId}`}
                      >
                        Commit as forecast
                      </button>
                    ) : (
                      <div className="text-[10px] font-mono text-text-faint">Finance leadership only</div>
                    )}
                  </div>
                </Card>
                );
              })}
            </div>

            {commitFor && (
              <Card className="p-4 border-gold/40" data-testid="commit-confirm">
                <div className="text-sm font-display mb-2">
                  Commit {data.comparisons.find((x) => x.scenarioId === commitFor)?.scenarioLabel ?? commitFor} as the official forecast?
                </div>
                <div className="text-xs text-text-mute mb-3">
                  This locks variance reporting (firm economics) and the budget page to this scenario. The change is recorded in the audit trail and visible to all personas.
                </div>
                <textarea
                  value={commitNote}
                  onChange={(e) => setCommitNote(e.target.value.slice(0, 1000))}
                  placeholder="Note (optional) — rationale, board approval ref, etc."
                  className="w-full bg-bg-elevate border border-border rounded p-2 text-xs font-mono"
                  rows={2}
                  data-testid="input-commit-note"
                />
                {commitErr && <div className="text-xs text-danger mt-2">{commitErr}</div>}
                <div className="flex items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={submitCommit}
                    disabled={commitMut.isPending}
                    className="text-xs font-mono px-3 py-1.5 rounded bg-gold text-bg disabled:opacity-50"
                    data-testid="button-commit-confirm"
                  >
                    {commitMut.isPending ? "Committing…" : "Confirm commit"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCommitFor(null); setCommitNote(""); setCommitErr(null); }}
                    disabled={commitMut.isPending}
                    className="text-xs font-mono px-3 py-1.5 rounded border border-border"
                    data-testid="button-commit-cancel"
                  >
                    Cancel
                  </button>
                </div>
              </Card>
            )}

            {commitsQ.data && commitsQ.data.history.length > 0 && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-mono text-xs uppercase text-text-faint">Commit audit trail</div>
                  <div className="font-mono text-[10px] text-text-faint">Churn window: ≤ {churnWindowDays} days</div>
                </div>
                <table className="w-full text-xs" data-testid="commit-history">
                  <thead className="text-[10px] font-mono uppercase text-text-faint">
                    <tr className="border-b border-border-soft">
                      <th className="text-left px-2 py-1.5">When</th>
                      <th className="text-left px-2 py-1.5">Action</th>
                      <th className="text-left px-2 py-1.5">Scenario</th>
                      <th className="text-left px-2 py-1.5">Period</th>
                      <th className="text-left px-2 py-1.5">By</th>
                      <th className="text-left px-2 py-1.5">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commitsQ.data.history.map((h) => {
                      const isUncommit = h.kind === "uncommit";
                      return (
                      <tr key={h.id} className={`border-t border-border-soft ${h.churn ? "bg-danger/5" : ""}`} data-testid={`commit-history-row-${h.id}`}>
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">{new Date(h.committedAt).toLocaleString()}</td>
                        <td className="px-2 py-1.5">
                          <MonoChip tone={isUncommit ? "amber" : "gold"}>{isUncommit ? "UNCOMMIT" : "COMMIT"}</MonoChip>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={isUncommit ? "text-text-mute italic" : ""}>{h.scenarioLabel}</span>
                          {h.scenarioId && <span className="text-text-faint font-mono"> ({h.scenarioId})</span>}
                          {h.churn && (
                            <MonoChip tone="red" className="ml-2" data-testid={`badge-churn-${h.id}`}>
                              Superseded in {h.supersededWithinDays}d
                            </MonoChip>
                          )}
                        </td>
                        <td className="px-2 py-1.5 font-mono">{h.periodLabel || "—"}</td>
                        <td className="px-2 py-1.5">{h.byUserName} <span className="text-text-faint font-mono">· {h.byRole}</span></td>
                        <td className="px-2 py-1.5 text-text-mute italic max-w-md truncate" title={h.note}>{h.note || "—"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Quarterly revenue by scenario</div>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <LineChart data={(data.comparisons[0]?.quarter ?? []).map((q, qi) => {
                    const row: Record<string, number | string> = { name: q.quarter };
                    for (const c of data.comparisons) row[c.scenarioLabel] = Math.round((c.quarter[qi]?.revenue) ?? 0);
                    return row;
                  })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(Math.abs(v) / 1_000_000).toFixed(1)}m`} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} formatter={(v: number) => fmt(v, presentation)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.comparisons.map((c, i) => (
                      <Line key={c.scenarioId} type="monotone" dataKey={c.scenarioLabel} stroke={["#94a3b8", "#34d399", "#fb7185", "#fbbf24"][i % 4]} strokeWidth={2} dot={{ r: 3 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Quarterly EBITDA by scenario</div>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <BarChart data={(data.comparisons[0]?.quarter ?? []).map((q, qi) => {
                    const row: Record<string, number | string> = { name: q.quarter };
                    for (const c of data.comparisons) row[c.scenarioLabel] = Math.round((c.quarter[qi]?.ebitda) ?? 0);
                    return row;
                  })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(Math.abs(v) / 1_000_000).toFixed(1)}m`} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} formatter={(v: number) => fmt(v, presentation)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.comparisons.map((c, i) => (
                      <Bar key={c.scenarioId} dataKey={c.scenarioLabel} fill={["#94a3b8", "#34d399", "#fb7185", "#fbbf24"][i % 4]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"} · presentation {presentation}
              <Link href="/finance/plan/budget" className="ml-3 text-gold hover:underline">→ Budget detail</Link>
              <Link href="/finance/plan/bonus" className="ml-3 text-gold hover:underline">→ Bonus accrual</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
