/**
 * FinancePlanCash13w — direct-method 13-week cash forecast (Task #415, Wave 3).
 *
 * Surfaces the per-week opening / receipts / disbursements / closing strip
 * with min-cash and (where applicable) covenant overlays, drill-down to
 * the underlying receipt and disbursement lines, and a treasurer-only
 * override / lock affordance with audit trail.
 */

import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import {
  useCash13w,
  useCash13wAudit,
  usePlanEntities,
  type CashLineRow,
  type CashWeekRow,
} from "@/lib/v5-hooks";
import { PRESENTATION_CURRENCIES, usePresentationCurrency } from "@/lib/presentationCurrency";

const API_BASE = "/api/atelier";


function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${currency} ${abs.toFixed(0)}`;
}

const SOURCE_LABEL: Record<string, string> = {
  open_ar: "Open AR",
  milestone: "Milestone",
  other: "Other",
};
const CATEGORY_LABEL: Record<string, string> = {
  payroll: "Payroll",
  vendor: "Vendor",
  tax_vat: "VAT",
  tax_ct: "CT",
  lease: "Lease",
  debt_service: "Debt",
  other: "Other",
};

export default function FinancePlanCash13w() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = usePresentationCurrency();
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = React.useState<number | null>(null);
  const [overrideLine, setOverrideLine] = React.useState<CashLineRow | null>(null);
  const [overrideError, setOverrideError] = React.useState<string | null>(null);
  const { data, refetch } = useCash13w(presentation, entityFilter);
  const { data: auditResp, refetch: refetchAudit } = useCash13wAudit();
  const auditItems = auditResp?.items ?? [];

  const week = selectedWeek != null && data ? data.weeks[selectedWeek] : null;

  const openOverride = (l: CashLineRow) => { setOverrideError(null); setOverrideLine(l); };

  async function postOverride(payload: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/finance/plan/cash-13w/override`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = `Override failed (HTTP ${res.status})`;
        try {
          const body = (await res.json()) as { message?: string; error?: string };
          if (body?.message) msg = body.message;
          else if (body?.error) msg = body.error;
        } catch { /* non-JSON body */ }
        if (res.status === 403) msg = `Forbidden — treasurer / finance / partner only.`;
        setOverrideError(msg);
        return false;
      }
      setOverrideError(null);
      return true;
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : "Network error");
      return false;
    }
  }

  const onOverrideSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!overrideLine) return;
    const fd = new FormData(e.currentTarget);
    const lockedAmountRaw = fd.get("lockedAmount");
    const lockedDateRaw = String(fd.get("lockedDate") ?? "").trim();
    const note = String(fd.get("note") ?? "");
    const locked = fd.get("locked") === "on";
    const ok = await postOverride({
      lineId: overrideLine.id,
      lockedAmount: lockedAmountRaw ? Number(lockedAmountRaw) : undefined,
      lockedDate: lockedDateRaw || undefined,
      locked,
      note,
    });
    if (ok) setOverrideLine(null);
    await Promise.all([refetch(), refetchAudit()]);
  };
  const onClearOverride = async (lineId: string) => {
    const ok = await postOverride({ lineId, clear: true });
    if (ok) setOverrideLine(null);
    await Promise.all([refetch(), refetchAudit()]);
  };

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-plan-cash13w">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="13-week cash forecast"
            lede="Direct-method receipts and disbursements over the next 13 weeks. Min-cash policy and covenant lines overlaid; weeks below threshold flagged."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
            <select
              data-testid="select-entity"
              value={entityFilter ?? "consolidated"}
              onChange={(e) => setEntityFilter(e.target.value === "consolidated" ? null : e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
            >
              <option value="consolidated">Consolidated</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.shortName}</option>
              ))}
            </select>
            <select
              data-testid="select-currency"
              value={presentation}
              onChange={(e) => setPresentation(e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
            >
              {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {!data ? (
          <Card className="p-6 text-text-mute">Loading forecast…</Card>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="cash13w-kpis">
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Opening</div>
                <div className="text-2xl font-display mt-1">{fmt(data.openingBalance, presentation)}</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Days of cash</div>
                <div className="text-2xl font-display mt-1" data-testid="kpi-days-of-cash">{data.daysOfCash}</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Total receipts (13w)</div>
                <div className="text-2xl font-display mt-1 text-success">{fmt(data.totalIn, presentation)}</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Total disbursements</div>
                <div className="text-2xl font-display mt-1 text-warning">{fmt(data.totalOut, presentation)}</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Cash gaps</div>
                <div className="text-2xl font-display mt-1" data-testid="kpi-breach-count">
                  {data.breaches.length === 0 ? (
                    <span className="text-success">none</span>
                  ) : (
                    <span className="text-danger">{data.breaches.length}</span>
                  )}
                </div>
              </Card>
            </div>

            {/* Forecast strip */}
            <Card className="p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-xs text-text-faint uppercase">Weekly closing balance</div>
                <div className="text-xs text-text-mute font-mono">
                  Min-cash: <span className="text-text">{fmt(data.minCashLine, presentation)}</span>
                  {data.covenantLine != null && (
                    <span className="ml-3">Covenant: <span className="text-text">{fmt(data.covenantLine, presentation)}</span></span>
                  )}
                </div>
              </div>
              <ForecastStrip data={data} presentation={presentation} onSelect={setSelectedWeek} selected={selectedWeek} />
            </Card>

            {/* Per-week table */}
            <Card className="overflow-hidden">
              <table className="w-full text-sm" data-testid="cash13w-table">
                <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Wk</th>
                    <th className="text-left px-3 py-2">Start</th>
                    <th className="text-right px-3 py-2">Opening</th>
                    <th className="text-right px-3 py-2">Receipts</th>
                    <th className="text-right px-3 py-2">Disbursements</th>
                    <th className="text-right px-3 py-2">Net</th>
                    <th className="text-right px-3 py-2">Closing</th>
                    <th className="text-left px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
                    <tr
                      key={w.weekIndex}
                      className={`border-t border-border-soft cursor-pointer hover:bg-bg-elevate/40 ${selectedWeek === w.weekIndex ? "bg-bg-elevate/60" : ""}`}
                      onClick={() => setSelectedWeek(w.weekIndex === selectedWeek ? null : w.weekIndex)}
                      data-testid={`cash13w-row-${w.weekIndex}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs">w{w.weekIndex}</td>
                      <td className="px-3 py-2 font-mono text-xs">{w.weekStart}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(w.openingBalance, presentation)}</td>
                      <td className="px-3 py-2 text-right font-mono text-success">{fmt(w.expectedIn, presentation)}</td>
                      <td className="px-3 py-2 text-right font-mono text-warning">−{fmt(w.expectedOut, presentation).replace("-", "")}</td>
                      <td className={`px-3 py-2 text-right font-mono ${w.netMovement < 0 ? "text-danger" : "text-success"}`}>{fmt(w.netMovement, presentation)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(w.closingBalance, presentation)}</td>
                      <td className="px-3 py-2">
                        {w.belowCovenant && <MonoChip tone="red">covenant</MonoChip>}
                        {!w.belowCovenant && w.belowMinCash && <MonoChip tone="amber">min-cash</MonoChip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Drill-down */}
            {week && <WeekDrillDown week={week} presentation={presentation} onOverride={openOverride} onClearOverride={onClearOverride} />}

            {/* Top expected receipts / disbursements */}
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="font-mono text-xs uppercase text-text-faint mb-3">Top 5 expected receipts</div>
                <ul className="divide-y divide-border-soft" data-testid="top-receipts">
                  {data.topReceipts.map((l) => (
                    <li key={l.id} className="py-2 text-sm flex items-baseline justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-text truncate">{l.label}</div>
                        <div className="text-xs text-text-mute font-mono">{l.expectedDate} · {l.confidence}</div>
                      </div>
                      <div className="text-right font-mono text-success">{fmt(l.amountInPresentation, presentation)}</div>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="p-4">
                <div className="font-mono text-xs uppercase text-text-faint mb-3">Top 5 expected disbursements</div>
                <ul className="divide-y divide-border-soft" data-testid="top-disbursements">
                  {data.topDisbursements.map((l) => (
                    <li key={l.id} className="py-2 text-sm flex items-baseline justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-text truncate">{l.label}</div>
                        <div className="text-xs text-text-mute font-mono">{l.expectedDate} · {CATEGORY_LABEL[l.category ?? "other"]}</div>
                      </div>
                      <div className="text-right font-mono text-warning">−{fmt(l.amountInPresentation, presentation).replace("-", "")}</div>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            {/* Override audit trail */}
            <Card className="p-4" data-testid="cash13w-audit">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-xs uppercase text-text-faint">Override audit trail</div>
                <div className="text-xs text-text-mute font-mono">{auditItems.length} event{auditItems.length === 1 ? "" : "s"}</div>
              </div>
              {auditItems.length === 0 ? (
                <div className="text-xs text-text-mute font-mono">No overrides applied yet. Treasurer / finance leadership can lock or override any line from the week drill-down.</div>
              ) : (
                <ul className="divide-y divide-border-soft text-sm">
                  {auditItems.slice(0, 8).map((a) => {
                    const action = a.action.endsWith(".clear") ? "cleared" : "applied";
                    const lockedAmount = a.payload.lockedAmount as number | undefined;
                    const note = a.payload.note as string | undefined;
                    const locked = a.payload.locked as boolean | undefined;
                    return (
                      <li key={a.id} className="py-2 flex items-baseline justify-between gap-3" data-testid={`audit-${a.id}`}>
                        <div className="flex-1 min-w-0">
                          <div className="text-text">
                            <span className="text-gold">{a.actor}</span>
                            {" "}
                            <span className="text-text-mute">{action} override on</span>
                            {" "}
                            <span className="font-mono text-xs">{a.target}</span>
                            {locked && <MonoChip tone="amber" className="ml-2">locked</MonoChip>}
                          </div>
                          {(lockedAmount != null || note) && (
                            <div className="text-xs text-text-mute font-mono mt-0.5">
                              {lockedAmount != null && <>amount → {lockedAmount.toLocaleString()} </>}
                              {note && <>· {note}</>}
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-text-faint whitespace-nowrap">
                          {new Date(a.ts).toLocaleString()}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <div className="text-xs text-text-mute font-mono">
              Forecast as-of {data.asOf} · {data.consolidated ? "Consolidated" : entities.find((e) => e.id === entityFilter)?.shortName ?? entityFilter} · presentation {presentation}
              <Link href="/finance/plan/backlog" className="ml-3 text-gold hover:underline">→ Backlog &amp; pipeline coverage</Link>
            </div>
          </>
        )}
      </div>

      {/* Override modal */}
      {overrideLine && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { setOverrideLine(null); setOverrideError(null); }}>
          <Card className="w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-lg mb-1">Override / lock line</div>
            <div className="text-xs text-text-mute font-mono mb-4">{overrideLine.label}</div>
            <form onSubmit={onOverrideSubmit} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-mono text-text-faint uppercase mb-1">Locked amount ({overrideLine.currency})</label>
                <input
                  name="lockedAmount" type="number" step="0.01"
                  defaultValue={overrideLine.amount}
                  className="w-full bg-bg-elevate border border-border rounded px-2 py-1 font-mono"
                  data-testid="input-locked-amount"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-text-faint uppercase mb-1">Locked date (expected)</label>
                <input
                  name="lockedDate" type="date"
                  defaultValue={overrideLine.expectedDate}
                  className="w-full bg-bg-elevate border border-border rounded px-2 py-1 font-mono"
                  data-testid="input-locked-date"
                />
                <div className="text-[10px] text-text-faint font-mono mt-1">Re-buckets the line into a different week.</div>
              </div>
              <label className="flex items-center gap-2 text-xs font-mono">
                <input type="checkbox" name="locked" defaultChecked={overrideLine.locked} data-testid="checkbox-locked" />
                Lock — engine must not re-forecast this line
              </label>
              <div>
                <label className="block text-xs font-mono text-text-faint uppercase mb-1">Note (audit)</label>
                <textarea name="note" rows={3} className="w-full bg-bg-elevate border border-border rounded px-2 py-1" data-testid="input-note" />
              </div>
              {overrideError && (
                <div className="text-xs font-mono text-danger border border-danger/40 bg-danger/5 rounded px-2 py-1.5" data-testid="override-error">
                  {overrideError}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                {overrideLine.override && (
                  <button type="button" onClick={() => onClearOverride(overrideLine.id)} className="text-xs text-text-mute hover:text-danger" data-testid="btn-clear-override">
                    Clear override
                  </button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button type="button" onClick={() => { setOverrideLine(null); setOverrideError(null); }} className="text-xs text-text-mute hover:text-text">cancel</button>
                  <PillButton variant="primary" data-testid="btn-save-override">Save override</PillButton>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

function ForecastStrip({ data, presentation, onSelect, selected }: { data: { weeks: CashWeekRow[]; minCashLine: number; covenantLine: number | null }; presentation: string; onSelect: (i: number | null) => void; selected: number | null }) {
  const closingValues = data.weeks.map((w) => w.closingBalance);
  const max = Math.max(1, ...closingValues, data.minCashLine, data.covenantLine ?? 0);
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
      {data.weeks.map((w) => {
        const h = Math.max(8, Math.round((Math.abs(w.closingBalance) / max) * 80));
        const minPct = Math.round((data.minCashLine / max) * 80);
        const covPct = data.covenantLine != null ? Math.round((data.covenantLine / max) * 80) : null;
        return (
          <button
            type="button"
            key={w.weekIndex}
            onClick={() => onSelect(w.weekIndex === selected ? null : w.weekIndex)}
            className={`flex flex-col items-center gap-1 cursor-pointer ${selected === w.weekIndex ? "ring-1 ring-gold rounded" : ""}`}
            data-testid={`forecast-strip-week-${w.weekIndex}`}
          >
            <div className="text-[9px] font-mono text-text-faint">w{w.weekIndex}</div>
            <div className="relative w-full" style={{ height: 92 }}>
              {/* Min-cash line */}
              <div className="absolute left-0 right-0 border-t border-dashed border-amber-500/60" style={{ bottom: `${minPct}px` }} />
              {covPct != null && (
                <div className="absolute left-0 right-0 border-t border-dashed border-danger/70" style={{ bottom: `${covPct}px` }} />
              )}
              <div
                className={`absolute bottom-0 left-1/4 right-1/4 rounded-sm ${w.belowCovenant ? "bg-danger" : w.belowMinCash ? "bg-amber-500" : "bg-gold"}`}
                style={{ height: `${h}px` }}
                title={`${w.weekStart}: ${fmt(w.closingBalance, presentation)}`}
              />
            </div>
            <div className="text-[9px] font-mono text-text-mute">{fmt(w.closingBalance, presentation)}</div>
          </button>
        );
      })}
    </div>
  );
}

function WeekDrillDown({ week, presentation, onOverride, onClearOverride }: { week: CashWeekRow; presentation: string; onOverride: (l: CashLineRow) => void; onClearOverride: (id: string) => void }) {
  const inLines = week.lines.filter((l) => l.direction === "in");
  const outLines = week.lines.filter((l) => l.direction === "out");
  return (
    <Card className="p-4 space-y-3" data-testid={`week-drilldown-${week.weekIndex}`}>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-display text-lg">Week {week.weekIndex} · {week.weekStart}</div>
          <div className="text-xs text-text-mute font-mono">
            Opening {fmt(week.openingBalance, presentation)} → closing {fmt(week.closingBalance, presentation)}
            {week.belowCovenant && <span className="text-danger ml-2">covenant breach</span>}
            {!week.belowCovenant && week.belowMinCash && <span className="text-amber-500 ml-2">below min-cash</span>}
          </div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="font-mono text-xs uppercase text-text-faint mb-2">Receipts ({fmt(week.expectedIn, presentation)})</div>
          {inLines.length === 0 ? (
            <div className="text-xs text-text-mute font-mono">No receipts.</div>
          ) : (
            <ul className="divide-y divide-border-soft text-sm">
              {inLines.map((l) => (
                <LineRow key={l.id} line={l} presentation={presentation} onOverride={onOverride} onClearOverride={onClearOverride} />
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="font-mono text-xs uppercase text-text-faint mb-2">Disbursements ({fmt(week.expectedOut, presentation)})</div>
          {outLines.length === 0 ? (
            <div className="text-xs text-text-mute font-mono">No disbursements.</div>
          ) : (
            <ul className="divide-y divide-border-soft text-sm">
              {outLines.map((l) => (
                <LineRow key={l.id} line={l} presentation={presentation} onOverride={onOverride} onClearOverride={onClearOverride} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function LineRow({ line, presentation, onOverride }: { line: CashLineRow; presentation: string; onOverride: (l: CashLineRow) => void; onClearOverride: (id: string) => void }) {
  const tag = line.source ? SOURCE_LABEL[line.source] : line.category ? CATEGORY_LABEL[line.category] : "";
  return (
    <li className="py-2 flex items-baseline justify-between gap-2" data-testid={`line-${line.id}`}>
      <div className="flex-1 min-w-0">
        <div className="text-text truncate">{line.label}</div>
        <div className="text-xs text-text-mute font-mono">
          {line.expectedDate} · {tag} · {line.confidence}
          {line.locked && <span className="ml-2 text-gold">locked by {line.override?.byUserName}</span>}
        </div>
      </div>
      <div className="text-right font-mono">
        <div className={line.direction === "in" ? "text-success" : "text-warning"}>
          {line.direction === "in" ? "" : "−"}{fmt(line.amountInPresentation, presentation).replace("-", "")}
        </div>
        <button
          type="button"
          onClick={() => onOverride(line)}
          className="text-[10px] text-text-mute hover:text-gold uppercase tracking-wider"
          data-testid={`btn-override-${line.id}`}
        >
          {line.locked ? "edit lock" : "override"}
        </button>
      </div>
    </li>
  );
}
