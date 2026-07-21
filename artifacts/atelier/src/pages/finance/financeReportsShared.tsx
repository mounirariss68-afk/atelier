/**
 * Finance Reports — shared filter bar + helpers (Task #417, Wave 5).
 *
 * The five report surfaces (P&L, BS, CF, Profitability cube, Board pack)
 * all share the same period / entity / currency selectors so we keep the
 * affordances in one place.
 */
import * as React from "react";
import { useFinanceEntities } from "@/lib/v5-hooks";
import { MonoChip } from "@/components/ui/primitives";
import {
  PRESENTATION_CURRENCIES as SHARED_PRESENTATION_CURRENCIES,
  getStoredPresentationCurrency,
  setStoredPresentationCurrency,
  fmtPresentationMoney,
} from "@/lib/presentationCurrency";

export type Scope = "mtd" | "qtd" | "ytd" | "r12";
export const SCOPES: { id: Scope; label: string }[] = [
  { id: "mtd", label: "MTD" }, { id: "qtd", label: "QTD" },
  { id: "ytd", label: "YTD" }, { id: "r12", label: "R12" },
];
// USD-first list; selection persists per user (Task #296).
export const PRESENTATION_CURRENCIES: string[] = [...SHARED_PRESENTATION_CURRENCIES];

export const fmtMoney = fmtPresentationMoney;
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}
export function signedPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const v = (n * 100).toFixed(1);
  return n >= 0 ? `+${v}%` : `${v}%`;
}

export interface ReportFilters {
  period: string;
  scope: Scope;
  entity: string | null;
  currency: string;
}

export function useReportFilters(defaultPeriod: string | null): [ReportFilters, (next: Partial<ReportFilters>) => void] {
  const [state, setState] = React.useState<ReportFilters>({
    period: defaultPeriod ?? "",
    scope: "ytd",
    entity: null,
    currency: getStoredPresentationCurrency(),
  });
  React.useEffect(() => {
    if (defaultPeriod && !state.period) setState((s) => ({ ...s, period: defaultPeriod }));
  }, [defaultPeriod, state.period]);
  const update = (next: Partial<ReportFilters>) => {
    if (next.currency) setStoredPresentationCurrency(next.currency);
    setState((s) => ({ ...s, ...next }));
  };
  return [state, update];
}

export function ReportFilterBar({
  filters, periods, onChange, showScope = true,
}: {
  filters: ReportFilters;
  periods: { id: string; label: string }[];
  onChange: (next: Partial<ReportFilters>) => void;
  showScope?: boolean;
}) {
  const entities = useFinanceEntities();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="finance-reports-filter-bar">
      <div className="flex items-center gap-2">
        <MonoChip>Period</MonoChip>
        <select
          value={filters.period}
          onChange={(e) => onChange({ period: e.target.value })}
          className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
          data-testid="filter-period"
        >
          {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      {showScope && (
        <div className="flex items-center gap-1">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              onClick={() => onChange({ scope: s.id })}
              data-testid={`filter-scope-${s.id}`}
              className={`px-2 py-1 rounded text-xs font-mono uppercase tracking-widest border ${
                filters.scope === s.id ? "border-gold bg-gold/10 text-gold" : "border-border-soft text-text-mute hover:text-text"
              }`}
            >{s.label}</button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <MonoChip>Entity</MonoChip>
        <select
          value={filters.entity ?? ""}
          onChange={(e) => onChange({ entity: e.target.value || null })}
          className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
          data-testid="filter-entity"
        >
          <option value="">Consolidated</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <MonoChip>Currency</MonoChip>
        <select
          value={filters.currency}
          onChange={(e) => onChange({ currency: e.target.value })}
          className="bg-bg border border-border-soft rounded px-2 py-1 text-text"
          data-testid="filter-currency"
        >
          {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  );
}

/** Chip flagging that periods in scope lack a GL close lock (Task #433). */
export function PreliminaryChip({ preliminary }: { preliminary?: boolean }) {
  if (!preliminary) return null;
  return (
    <span
      className="px-2 py-0.5 rounded border border-amber-400/40 bg-amber-400/10 text-amber-400 font-mono text-[10px] uppercase tracking-widest"
      data-testid="chip-preliminary"
      title="One or more periods in scope have not completed GL close — figures may change."
    >Preliminary</span>
  );
}

export function VarianceCellChip({ pct, kind = "favorable_high" }: { pct: number; kind?: "favorable_high" | "favorable_low" }) {
  const fav = kind === "favorable_high" ? pct >= 0 : pct <= 0;
  const tone = Math.abs(pct) < 0.03 ? "text-text-mute" : fav ? "text-emerald-400" : "text-amber-400";
  return <span className={`font-mono text-xs ${tone}`}>{signedPct(pct)}</span>;
}
