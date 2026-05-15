/**
 * FinancePlanScenarios — what-if vs base case (Task #440).
 *
 * Three sliders (utilisation, day-rate, FX shock) feed the same 13-week
 * + backlog engine and surface the impact on closing balance, min-cash
 * breaches and the next-2Q coverage ratio. Pure GET, no persistence —
 * the assumptions live in component state and re-key the query.
 */

import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useScenario, usePlanEntities, type ScenarioAssumptions, type ScenarioSnapshot } from "@/lib/v5-hooks";

const PRESENTATION_CURRENCIES = ["USD", "GBP", "AED", "SAR", "EUR"];

function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${currency} ${abs.toFixed(0)}`;
}
function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;
}

interface PresetDef {
  id: string;
  label: string;
  blurb: string;
  assumptions: ScenarioAssumptions;
}
const PRESETS: PresetDef[] = [
  { id: "base",     label: "Base",                blurb: "No assumptions changed.",                                  assumptions: { utilisationDelta: 0,    rateDelta: 0,    fxShock: 0    } },
  { id: "downside", label: "Downside",            blurb: "Util −10%, rate flat, FX −10%.",                            assumptions: { utilisationDelta: -0.10, rateDelta: 0,    fxShock: -0.10 } },
  { id: "stress",   label: "Severe stress",       blurb: "Util −20%, rate −5%, FX −15%.",                             assumptions: { utilisationDelta: -0.20, rateDelta: -0.05, fxShock: -0.15 } },
  { id: "upside",   label: "Upside (rate)",       blurb: "Util +5%, rate +6%, FX flat.",                              assumptions: { utilisationDelta:  0.05, rateDelta:  0.06, fxShock:  0    } },
  { id: "fx",       label: "FX shock only",       blurb: "Pure −15% FX devaluation of non-USD.",                      assumptions: { utilisationDelta:  0,    rateDelta:  0,    fxShock: -0.15 } },
];

export default function FinancePlanScenarios() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = React.useState("USD");
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const [util, setUtil] = React.useState(0);
  const [rate, setRate] = React.useState(0);
  const [fx, setFx] = React.useState(0);
  const assumptions: ScenarioAssumptions = { utilisationDelta: util, rateDelta: rate, fxShock: fx };
  const { data } = useScenario(presentation, entityFilter, assumptions);

  const applyPreset = (p: PresetDef) => {
    setUtil(p.assumptions.utilisationDelta);
    setRate(p.assumptions.rateDelta);
    setFx(p.assumptions.fxShock);
  };
  const reset = () => { setUtil(0); setRate(0); setFx(0); };

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-finance-plan-scenarios">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Scenarios"
            lede="Stress-test the 13-week cash forecast and next-2Q coverage ratio against utilisation, day-rate and FX assumptions. Compare base vs scenario side-by-side."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
            <select
              value={entityFilter ?? "consolidated"}
              onChange={(e) => setEntityFilter(e.target.value === "consolidated" ? null : e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
              data-testid="select-entity"
            >
              <option value="consolidated">Consolidated</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
            </select>
            <select
              value={presentation}
              onChange={(e) => setPresentation(e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
              data-testid="select-currency"
            >
              {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {/* Assumptions */}
        <Card className="p-4" data-testid="assumptions-panel">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="font-mono text-xs uppercase text-text-faint">Assumptions</div>
            <div className="flex items-center gap-1 text-[11px] font-mono">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  className="px-2 py-1 rounded border border-border text-text-mute hover:text-text hover:border-gold/40"
                  title={p.blurb}
                  data-testid={`preset-${p.id}`}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={reset}
                className="px-2 py-1 rounded border border-border text-text-mute hover:text-text"
                data-testid="preset-reset"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <Slider
              testId="slider-util"
              label="Utilisation Δ"
              hint="Scales milestone receipts and the next-2Q revenue plan."
              value={util}
              min={-0.5}
              max={0.5}
              step={0.05}
              onChange={setUtil}
            />
            <Slider
              testId="slider-rate"
              label="Day-rate Δ"
              hint="Uplift / discount across all receipts, backlog and weighted pipeline."
              value={rate}
              min={-0.3}
              max={0.3}
              step={0.01}
              onChange={setRate}
            />
            <Slider
              testId="slider-fx"
              label="FX shock (vs USD)"
              hint="Applied to non-USD lines on translation. Positive = USD weakens."
              value={fx}
              min={-0.25}
              max={0.25}
              step={0.01}
              onChange={setFx}
            />
          </div>

          {data ? (
            <ul className="mt-4 text-xs text-text-mute space-y-1">
              {data.notes.map((n, i) => <li key={i}>• {n}</li>)}
            </ul>
          ) : null}
        </Card>

        {!data ? (
          <Card className="p-6 text-text-mute">Running scenario…</Card>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="scenario-kpis">
              <DeltaKpi label="Closing wk-13" base={data.base.closingWeek12} scen={data.scenario.closingWeek12} presentation={presentation} testId="kpi-closing" higherIsBetter />
              <DeltaKpi label="Min weekly closing" base={data.base.minWeeklyClosing} scen={data.scenario.minWeeklyClosing} presentation={presentation} testId="kpi-min-closing" higherIsBetter />
              <BreachKpi label="Min-cash breaches" baseN={data.base.minCashBreaches} scenN={data.scenario.minCashBreaches} testId="kpi-breaches" />
              <CoverageKpi base={data.base.coverageRatio} scen={data.scenario.coverageRatio} testId="kpi-coverage" />
            </div>

            {/* Cash strip */}
            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">13-week closing balance — base vs scenario</div>
              <CashStrip data={data} presentation={presentation} />
            </Card>

            {/* Snapshot table */}
            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Side-by-side snapshot</div>
              <table className="w-full text-sm" data-testid="snapshot-table">
                <thead className="text-[11px] font-mono uppercase text-text-faint">
                  <tr>
                    <th className="text-left px-2 py-1">Metric</th>
                    <th className="text-right px-2 py-1">Base</th>
                    <th className="text-right px-2 py-1">Scenario</th>
                    <th className="text-right px-2 py-1">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <SnapshotRow label="Opening cash"           base={data.base.openingBalance} scen={data.scenario.openingBalance} presentation={presentation} />
                  <SnapshotRow label="Total receipts (13w)"   base={data.base.totalIn}        scen={data.scenario.totalIn}        presentation={presentation} />
                  <SnapshotRow label="Total disbursements"    base={data.base.totalOut}       scen={data.scenario.totalOut}       presentation={presentation} invert />
                  <SnapshotRow label="Closing wk-13"          base={data.base.closingWeek12}  scen={data.scenario.closingWeek12}  presentation={presentation} />
                  <SnapshotRow label="Min weekly closing"     base={data.base.minWeeklyClosing}scen={data.scenario.minWeeklyClosing}presentation={presentation} />
                  <SnapshotRow label="Min-cash line"          base={data.base.minCashLine}    scen={data.scenario.minCashLine}    presentation={presentation} muted />
                  {data.base.covenantLine != null ? (
                    <SnapshotRow label="Covenant floor"       base={data.base.covenantLine!}  scen={data.scenario.covenantLine ?? 0} presentation={presentation} muted />
                  ) : null}
                  <BreachRow base={data.base.minCashBreaches}  scen={data.scenario.minCashBreaches}  label="Min-cash breaches (weeks)" />
                  <BreachRow base={data.base.covenantBreaches} scen={data.scenario.covenantBreaches} label="Covenant breaches (weeks)" />
                  <SnapshotRow label="Backlog + weighted pipeline" base={data.base.backlogPlusWeightedUsd} scen={data.scenario.backlogPlusWeightedUsd} presentation={presentation} />
                  <SnapshotRow label="Next-2Q plan"           base={data.base.next2qPlanUsd}  scen={data.scenario.next2qPlanUsd}  presentation={presentation} muted />
                  <CoverageSnapshotRow base={data.base.coverageRatio} scen={data.scenario.coverageRatio} />
                </tbody>
              </table>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"} · presentation {presentation}
              <Link href="/finance/plan/cash-13w" className="ml-3 text-gold hover:underline">→ 13-week cash</Link>
              <Link href="/finance/plan/backlog" className="ml-3 text-gold hover:underline">→ Backlog &amp; pipeline</Link>
              <Link href="/finance/plan/renewals" className="ml-3 text-gold hover:underline">→ Renewals</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Slider({ testId, label, hint, value, min, max, step, onChange }: {
  testId: string; label: string; hint: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-mono uppercase text-text-faint">{label}</div>
        <div className={`text-sm font-mono ${value === 0 ? "text-text-mute" : value > 0 ? "text-success" : "text-amber-500"}`} data-testid={`${testId}-value`}>
          {pct(value)}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gold"
      />
      <div className="text-[11px] text-text-mute leading-snug">{hint}</div>
    </div>
  );
}

function deltaTone(delta: number, higherIsBetter: boolean): string {
  if (delta === 0) return "text-text-mute";
  const positive = higherIsBetter ? delta > 0 : delta < 0;
  return positive ? "text-success" : "text-danger";
}
function DeltaKpi({ label, base, scen, presentation, testId, higherIsBetter = true }: {
  label: string; base: number; scen: number; presentation: string; testId: string; higherIsBetter?: boolean;
}) {
  const delta = scen - base;
  return (
    <Card className="p-3" data-testid={testId}>
      <div className="text-[11px] font-mono uppercase text-text-faint">{label}</div>
      <div className={`text-2xl font-display mt-1 ${scen < 0 ? "text-danger" : ""}`}>{fmt(scen, presentation)}</div>
      <div className="text-xs font-mono mt-1">
        <span className="text-text-mute">base {fmt(base, presentation)} · </span>
        <span className={deltaTone(delta, higherIsBetter)}>Δ {delta >= 0 ? "+" : ""}{fmt(delta, presentation)}</span>
      </div>
    </Card>
  );
}
function BreachKpi({ label, baseN, scenN, testId }: { label: string; baseN: number; scenN: number; testId: string }) {
  const delta = scenN - baseN;
  return (
    <Card className="p-3" data-testid={testId}>
      <div className="text-[11px] font-mono uppercase text-text-faint">{label}</div>
      <div className={`text-2xl font-display mt-1 ${scenN > 0 ? "text-amber-500" : ""}`}>{scenN}</div>
      <div className="text-xs font-mono mt-1">
        <span className="text-text-mute">base {baseN} · </span>
        <span className={deltaTone(delta, false)}>Δ {delta >= 0 ? "+" : ""}{delta}</span>
      </div>
    </Card>
  );
}
function CoverageKpi({ base, scen, testId }: { base: number; scen: number; testId: string }) {
  const delta = scen - base;
  return (
    <Card className="p-3" data-testid={testId}>
      <div className="text-[11px] font-mono uppercase text-text-faint">Coverage ratio</div>
      <div className={`text-2xl font-display mt-1 ${scen >= 3 ? "text-success" : scen >= 2 ? "text-amber-500" : "text-danger"}`} data-testid={`${testId}-value`}>{scen.toFixed(2)}×</div>
      <div className="text-xs font-mono mt-1">
        <span className="text-text-mute">base {base.toFixed(2)}× · </span>
        <span className={deltaTone(delta, true)}>Δ {delta >= 0 ? "+" : ""}{delta.toFixed(2)}×</span>
      </div>
    </Card>
  );
}

function SnapshotRow({ label, base, scen, presentation, muted, invert }: {
  label: string; base: number; scen: number; presentation: string; muted?: boolean; invert?: boolean;
}) {
  const delta = scen - base;
  return (
    <tr className="border-t border-border-soft">
      <td className={`px-2 py-1.5 ${muted ? "text-text-mute" : ""}`}>{label}</td>
      <td className="px-2 py-1.5 text-right font-mono">{fmt(base, presentation)}</td>
      <td className="px-2 py-1.5 text-right font-mono">{fmt(scen, presentation)}</td>
      <td className={`px-2 py-1.5 text-right font-mono ${deltaTone(delta, !invert)}`}>{delta >= 0 ? "+" : ""}{fmt(delta, presentation)}</td>
    </tr>
  );
}
function BreachRow({ label, base, scen }: { label: string; base: number; scen: number }) {
  const delta = scen - base;
  return (
    <tr className="border-t border-border-soft">
      <td className="px-2 py-1.5">{label}</td>
      <td className="px-2 py-1.5 text-right font-mono">{base}</td>
      <td className="px-2 py-1.5 text-right font-mono">{scen}</td>
      <td className={`px-2 py-1.5 text-right font-mono ${deltaTone(delta, false)}`}>{delta >= 0 ? "+" : ""}{delta}</td>
    </tr>
  );
}
function CoverageSnapshotRow({ base, scen }: { base: number; scen: number }) {
  const delta = scen - base;
  return (
    <tr className="border-t border-border-soft">
      <td className="px-2 py-1.5">Coverage ratio</td>
      <td className="px-2 py-1.5 text-right font-mono">{base.toFixed(2)}×</td>
      <td className="px-2 py-1.5 text-right font-mono">{scen.toFixed(2)}×</td>
      <td className={`px-2 py-1.5 text-right font-mono ${deltaTone(delta, true)}`}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)}×</td>
    </tr>
  );
}

function CashStrip({ data, presentation }: { data: { weeks: { weekIndex: number; weekStart: string; baseClosing: number; scenarioClosing: number; scenarioBelowMinCash: boolean }[]; scenario: ScenarioSnapshot; base: ScenarioSnapshot }; presentation: string }) {
  const all = data.weeks.flatMap((w) => [w.baseClosing, w.scenarioClosing]);
  const minCash = data.scenario.minCashLine;
  const max = Math.max(1, ...all, data.base.minCashLine, minCash);
  const min = Math.min(0, ...all);
  const range = max - min || 1;
  const h = 140;
  const w = 720;
  const cols = data.weeks.length;
  const colW = w / cols;
  const y = (v: number) => h - ((v - min) / range) * h;
  const path = (key: "baseClosing" | "scenarioClosing") => data.weeks
    .map((wk, i) => `${i === 0 ? "M" : "L"} ${i * colW + colW / 2} ${y(wk[key])}`)
    .join(" ");
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-full" preserveAspectRatio="none" style={{ minWidth: 480, height: 180 }}>
        {/* min-cash line (scenario) */}
        <line x1={0} y1={y(minCash)} x2={w} y2={y(minCash)} stroke="currentColor" strokeDasharray="4 4" className="text-amber-500" strokeWidth={1} />
        {/* zero line */}
        <line x1={0} y1={y(0)} x2={w} y2={y(0)} stroke="currentColor" className="text-border" strokeWidth={1} />
        {/* base path */}
        <path d={path("baseClosing")} fill="none" stroke="currentColor" className="text-text-mute" strokeWidth={1.5} strokeDasharray="3 3" />
        {/* scenario path */}
        <path d={path("scenarioClosing")} fill="none" stroke="currentColor" className="text-gold" strokeWidth={2} />
        {/* breach markers */}
        {data.weeks.map((wk, i) =>
          wk.scenarioBelowMinCash ? (
            <circle key={i} cx={i * colW + colW / 2} cy={y(wk.scenarioClosing)} r={3.5} className="fill-amber-500" />
          ) : null,
        )}
      </svg>
      <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-text-faint">
        <span><span className="inline-block w-3 h-px bg-text-mute mr-1" />Base</span>
        <span><span className="inline-block w-3 h-px bg-gold mr-1" />Scenario</span>
        <span><span className="inline-block w-3 h-px bg-amber-500 mr-1" />Min-cash {fmt(minCash, presentation)}</span>
        <span>13 weeks · {data.weeks[0]?.weekStart} → {data.weeks[data.weeks.length - 1]?.weekStart}</span>
      </div>
    </div>
  );
}
