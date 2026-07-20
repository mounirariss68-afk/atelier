/**
 * CFO dashboard primitives (Task #413).
 *
 * - MetricTile: KPI hero tile with value · vs plan · RAG · "i" affordance ·
 *   drill-down link. Renders as a placeholder when `wave` is set (Wave-N
 *   copy chip with same dimensions as the live tiles). Sparkline is only
 *   shown when real history is supplied — synthetic series are not used.
 * - CfoFilterBar: Entity multi-select / Period (MTD QTD YTD R12) / Currency
 *   (Presentation / Local-by-entity / Side-by-side, with a presentation
 *   currency select — USD default, Task #296) / as-of date with
 *   per-source freshness chips. Persists to URL query so a CFO can
 *   bookmark "their" view.
 * - useCfoFilters: small hook that reads/writes the filter state into the
 *   URL via `window.history.replaceState`.
 * - formatMoney / formatDelta / RagDot: shared helpers used by every tile.
 *
 * Currency semantics
 *   "present" → user-selected presentation currency (USD default; persists
 *               via localStorage across pages and sessions).
 *   "local"   → entity-local currency. Resolved per dashboard render: when
 *               the entity filter selects exactly one entity, that entity's
 *               baseCurrency is used; otherwise the dashboard falls back to
 *               the presentation currency and surfaces a chip explaining it.
 *   "side"    → side-by-side: presentation currency alongside the resolved
 *               local currency so the CFO can compare.
 */

import * as React from "react";
import { Link } from "wouter";
import { ArrowRight, Info, Check } from "lucide-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import {
  PRESENTATION_CURRENCIES,
  getStoredPresentationCurrency,
  setStoredPresentationCurrency,
  isPresentationCurrency,
} from "@/lib/presentationCurrency";

/* ============================================================
   Filter types + URL persistence
   ============================================================ */

/**
 * Entity ids are dynamic — real legal-entity ids from the signing-entity
 * registry (plus the "all" sentinel). The old hardcoded demo union was
 * removed per the no-dummy-data policy (Task #256).
 */
export type CfoEntityId = string;
export type CfoPeriod = "mtd" | "qtd" | "ytd" | "r12";
export type CfoCurrency = "present" | "local" | "side";

export interface CfoFilters {
  entities: CfoEntityId[];
  period: CfoPeriod;
  currency: CfoCurrency;
  /** Presentation currency code (USD default, persisted per user). */
  presCcy: string;
  asOf: string;
}

export interface CfoEntityOption {
  id: CfoEntityId;
  label: string;
}

export const ALL_ENTITIES_OPTION: CfoEntityOption = { id: "all", label: "All entities" };

/**
 * Drop entity ids (e.g. from a stale bookmarked URL) that no longer exist
 * in the registry. Falls back to ["all"] when nothing valid remains.
 */
export function sanitizeEntitySelection(selection: CfoEntityId[], knownIds: string[]): CfoEntityId[] {
  const known = new Set<string>(["all", ...knownIds]);
  const kept = selection.filter((id) => known.has(id));
  return kept.length === 0 ? ["all"] : kept;
}

const PERIOD_LABEL: Record<CfoPeriod, string> = {
  mtd: "MTD",
  qtd: "QTD",
  ytd: "YTD",
  r12: "Rolling 12",
};

export const PERIOD_DAYS: Record<CfoPeriod, number> = {
  mtd: 30,
  qtd: 90,
  ytd: 365,
  r12: 365,
};

const CURRENCY_LABEL: Record<CfoCurrency, string> = {
  present: "Presentation",
  local: "Local",
  side: "Side-by-side",
};

const DEFAULTS: CfoFilters = {
  entities: ["all"],
  period: "ytd",
  currency: "present",
  presCcy: "USD",
  asOf: new Date().toISOString().slice(0, 10),
};

function readUrl(): CfoFilters {
  if (typeof window === "undefined") return DEFAULTS;
  const q = new URLSearchParams(window.location.search);
  const ents = (q.get("ent") ?? "all").split(",").filter(Boolean) as CfoEntityId[];
  const period = (q.get("p") ?? "ytd") as CfoPeriod;
  // Legacy bookmarks may carry ccy=GBP — treat any non-mode value as "present".
  const ccyRaw = q.get("ccy") ?? "present";
  const currency: CfoCurrency = ccyRaw === "local" ? "local" : ccyRaw === "side" ? "side" : "present";
  const pccyRaw = q.get("pccy");
  const presCcy = isPresentationCurrency(pccyRaw) ? pccyRaw : getStoredPresentationCurrency();
  const asOf = q.get("asof") ?? DEFAULTS.asOf;
  return {
    entities: ents.length > 0 ? ents : ["all"],
    period: ["mtd", "qtd", "ytd", "r12"].includes(period) ? period : "ytd",
    currency,
    presCcy,
    asOf,
  };
}

function writeUrl(f: CfoFilters) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("ent", f.entities.join(","));
  url.searchParams.set("p", f.period);
  url.searchParams.set("ccy", f.currency);
  url.searchParams.set("pccy", f.presCcy);
  url.searchParams.set("asof", f.asOf);
  window.history.replaceState(null, "", url.toString());
}

export function useCfoFilters(): [CfoFilters, (next: Partial<CfoFilters>) => void] {
  const [state, setState] = React.useState<CfoFilters>(() => readUrl());
  const update = React.useCallback((next: Partial<CfoFilters>) => {
    setState((prev) => {
      const merged = { ...prev, ...next };
      if (next.presCcy) setStoredPresentationCurrency(next.presCcy);
      writeUrl(merged);
      return merged;
    });
  }, []);
  return [state, update];
}

/* ============================================================
   Money / number formatting
   ============================================================ */

const FX_TO_USD: Record<string, number> = {
  USD: 1,
  GBP: 1.27,
  AED: 0.272,
  SAR: 0.267,
  EUR: 1.08,
};

const SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", AED: "AED ", SAR: "SAR " };

function symbolFor(code: string): string { return SYMBOLS[code] ?? `${code} `; }

function convert(valueUsd: number, code: string): number {
  const rate = FX_TO_USD[code] ?? 1;
  return valueUsd / rate;
}

function compactNumber(value: number, symbol: string): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${symbol}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export interface CcyOpts { localCode?: string; compact?: boolean; presCcy?: string }

/** Resolve the "primary" code shown for a tile given the user's currency mode. */
export function resolvePrimaryCode(ccy: CfoCurrency, localCode?: string, presCcy = "USD"): string {
  if (ccy === "local") return localCode ?? presCcy;
  return presCcy;
}

export function toCurrency(valueUsd: number, ccy: CfoCurrency, opts?: CcyOpts): { value: number; symbol: string; code: string } {
  const code = resolvePrimaryCode(ccy, opts?.localCode, opts?.presCcy);
  return { value: convert(valueUsd, code), symbol: symbolFor(code), code };
}

export function formatMoney(valueUsd: number, ccy: CfoCurrency, opts?: CcyOpts): string {
  const compact = opts?.compact !== false;
  const presCcy = opts?.presCcy ?? "USD";
  const primaryCode = resolvePrimaryCode(ccy, opts?.localCode, presCcy);
  const primary = compact
    ? compactNumber(convert(valueUsd, primaryCode), symbolFor(primaryCode))
    : `${symbolFor(primaryCode)}${convert(valueUsd, primaryCode).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  if (ccy !== "side") return primary;

  // Side-by-side: presentation ccy + local. Falls back when local==presentation.
  const secondCode = opts?.localCode && opts.localCode !== presCcy
    ? opts.localCode
    : presCcy === "USD" ? "GBP" : "USD";
  const secondary = compact
    ? compactNumber(convert(valueUsd, secondCode), symbolFor(secondCode))
    : `${symbolFor(secondCode)}${convert(valueUsd, secondCode).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `${primary} · ${secondary}`;
}

export function formatPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatDelta(deltaUsd: number, kind: "money" | "pct" | "abs" = "money", ccy: CfoCurrency = "present", opts?: CcyOpts): string {
  const sign = deltaUsd > 0 ? "+" : deltaUsd < 0 ? "" : "";
  if (kind === "pct") return `${sign}${(deltaUsd * 100).toFixed(1)} pts`;
  if (kind === "abs") return `${sign}${deltaUsd.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  return `${sign}${formatMoney(deltaUsd, ccy === "side" ? "present" : ccy, opts)}`;
}

/* ============================================================
   RAG dot + sparkline (real-data-only)
   ============================================================ */

export type Rag = "green" | "amber" | "red" | "gold" | "neutral";

export const RagDot = ({ tone, className }: { tone: Rag; className?: string }) => {
  const color =
    tone === "green" ? "bg-success" :
    tone === "amber" ? "bg-warn" :
    tone === "red" ? "bg-danger" :
    tone === "gold" ? "bg-gold" :
    "bg-text-faint";
  return <span className={cn("inline-block w-2 h-2 rounded-full", color, className)} aria-hidden />;
};

export function Sparkline({ values, tone = "neutral" }: { values: number[]; tone?: Rag }) {
  if (!values || values.length < 2) {
    return <div className="h-6 w-full bg-bg-elevate/40 rounded" aria-hidden />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 100;
  const h = 22;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(h - ((v - min) / range) * h).toFixed(2)}`).join(" ");
  const stroke =
    tone === "green" ? "#34d399" :
    tone === "amber" ? "#fbbf24" :
    tone === "red" ? "#f87171" :
    tone === "gold" ? "#d4a754" :
    "#94a3b8";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-6" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

/* ============================================================
   MetricTile — the KPI hero primitive
   ============================================================ */

export interface MetricTileProps {
  testId?: string;
  label: string;
  value: React.ReactNode;
  unit?: React.ReactNode;
  vsPlan?: { delta: number; kind?: "money" | "pct" | "abs"; tone?: Rag };
  rag?: Rag;
  /** Real history series only — synthetic data is not accepted. Omit when no history exists. */
  spark?: number[];
  href?: string;
  info?: {
    definition: string;
    formula?: string;
    source: string;
    freshness: string;
  };
  /** When set, renders as a placeholder (Wave N) tile with identical dimensions. */
  wave?: { wave: number; note?: string };
  /** Optional scope chip — surfaced when entity filter cannot be applied to the underlying source. */
  scopeNote?: string;
  ccy?: CfoCurrency;
  localCode?: string;
  presCcy?: string;
  /** Pre-formatted "vs plan" label — overrides formatDelta when the value is already in presentation currency. */
  vsPlanLabel?: string;
}

export function MetricTile(props: MetricTileProps) {
  const { testId, label, value, unit, vsPlan, rag = "neutral", spark, href, info, wave, scopeNote, ccy = "present", localCode, presCcy, vsPlanLabel } = props;
  const [showInfo, setShowInfo] = React.useState(false);
  const isPlaceholder = !!wave;

  const inner = (
    <Card
      className={cn(
        "p-3 h-full flex flex-col gap-2 transition-colors min-h-[148px]",
        isPlaceholder ? "opacity-60 border-dashed" : "hover:border-gold/40",
        href && !isPlaceholder ? "cursor-pointer" : "",
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint flex items-start gap-1.5 min-w-0 flex-1">
          <RagDot tone={rag} />
          <span className="break-words leading-tight">{label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {info && !isPlaceholder && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowInfo((s) => !s); }}
              className="text-text-faint hover:text-text"
              aria-label={`About ${label}`}
              title="Definition · source · freshness"
              data-testid={testId ? `${testId}-info` : undefined}
            >
              <Info className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={cn("font-light leading-none tracking-tight truncate", isPlaceholder ? "text-text-faint text-2xl" : "text-text text-2xl")}>
            {isPlaceholder ? "—" : value}
          </div>
          {wave && <MonoChip className="shrink-0">Wave {wave.wave}</MonoChip>}
        </div>
        {unit && !isPlaceholder && <div className="text-[11px] font-mono text-text-mute leading-tight break-words">{unit}</div>}
      </div>

      <div className="text-[10px] font-mono text-text-mute flex flex-wrap gap-x-2 gap-y-0.5">
        {!isPlaceholder && vsPlan && (
          <span className={cn(vsPlan.tone === "red" && "text-danger", vsPlan.tone === "green" && "text-success", vsPlan.tone === "amber" && "text-warn")}>
            {vsPlanLabel ?? `${formatDelta(vsPlan.delta, vsPlan.kind ?? "money", ccy, { localCode, presCcy })} vs plan`}
          </span>
        )}
        {!isPlaceholder && scopeNote && <span className="text-text-faint italic">{scopeNote}</span>}
        {isPlaceholder && wave?.note && <span className="italic text-text-faint">{wave.note}</span>}
      </div>

      {!isPlaceholder && spark && spark.length >= 2 && <Sparkline values={spark} tone={rag} />}
      {(isPlaceholder || !spark || spark.length < 2) && (
        <div className="h-6 w-full bg-bg-elevate/30 rounded" />
      )}

      {showInfo && info && (
        <div className="absolute z-20 mt-32 max-w-xs rounded border border-border bg-bg-deep p-3 text-[11px] text-text-mute shadow-xl space-y-1">
          <div className="font-mono uppercase text-[9px] tracking-widest text-text-faint">{label}</div>
          <div className="text-text">{info.definition}</div>
          {info.formula && <div className="font-mono text-[10px]">= {info.formula}</div>}
          <div className="text-text-faint">Source: {info.source}</div>
          <div className="text-text-faint">Freshness: {info.freshness}</div>
        </div>
      )}
    </Card>
  );

  if (href && !isPlaceholder) {
    return (
      <Link href={href} className="block relative">
        {inner}
      </Link>
    );
  }
  return <div className="relative">{inner}</div>;
}

/* ============================================================
   FreshnessChip — per-source data freshness pill
   ============================================================ */

export function FreshnessChip({ source, ageMin, status }: { source: string; ageMin: number; status: "live" | "stale" | "missing" }) {
  const tone = status === "live" ? "green" : status === "stale" ? "amber" : "red";
  const ageLabel = ageMin < 60 ? `${ageMin}m` : ageMin < 1440 ? `${Math.round(ageMin / 60)}h` : `${Math.round(ageMin / 1440)}d`;
  return (
    <div className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-text-mute" data-testid={`freshness-${source.toLowerCase()}`}>
      <RagDot tone={tone} />
      <span className="text-text-faint">{source}</span>
      <span>·</span>
      <span>{status === "missing" ? "—" : ageLabel}</span>
    </div>
  );
}

/* ============================================================
   CfoFilterBar
   ============================================================ */

export interface FilterBarSource { name: string; ageMin: number; status: "live" | "stale" | "missing" }

export function CfoFilterBar({
  filters,
  setFilters,
  sources,
  entityOptions,
}: {
  filters: CfoFilters;
  setFilters: (next: Partial<CfoFilters>) => void;
  sources: FilterBarSource[];
  /** Real legal entities from the registry; "All entities" is always prepended. */
  entityOptions: CfoEntityOption[];
}) {
  const options = [ALL_ENTITIES_OPTION, ...entityOptions.filter((o) => o.id !== "all")];
  const toggleEntity = (id: CfoEntityId) => {
    if (id === "all") {
      setFilters({ entities: ["all"] });
      return;
    }
    const current = filters.entities.filter((e) => e !== "all");
    const next = current.includes(id) ? current.filter((e) => e !== id) : [...current, id];
    setFilters({ entities: next.length === 0 ? ["all"] : next });
  };

  return (
    <div
      className="container-atelier py-3 border-y border-border-soft bg-bg-deep/60 backdrop-blur-sm sticky top-0 z-30"
      data-testid="cfo-filter-bar"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Entities */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">Entity</span>
          {options.map((opt) => {
            const active = filters.entities.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleEntity(opt.id)}
                data-testid={`cfo-filter-entity-${opt.id}`}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors border",
                  active
                    ? "bg-gold text-bg border-gold"
                    : "bg-bg-elevate text-text-mute border-border hover:text-text",
                )}
              >
                {active && <Check className="w-3 h-3" />}
                {opt.label}
              </button>
            );
          })}
          {entityOptions.length === 0 && (
            <span className="text-[10px] font-mono text-text-faint italic" data-testid="cfo-filter-no-entities">
              no legal entities registered
            </span>
          )}
        </div>

        {/* Period */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">Period</span>
          {(Object.keys(PERIOD_LABEL) as CfoPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setFilters({ period: p })}
              data-testid={`cfo-filter-period-${p}`}
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors border",
                filters.period === p ? "bg-gold text-bg border-gold" : "bg-bg-elevate text-text-mute border-border hover:text-text",
              )}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        {/* Currency */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">Ccy</span>
          {(Object.keys(CURRENCY_LABEL) as CfoCurrency[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilters({ currency: c })}
              data-testid={`cfo-filter-ccy-${c}`}
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors border",
                filters.currency === c ? "bg-gold text-bg border-gold" : "bg-bg-elevate text-text-mute border-border hover:text-text",
              )}
            >
              {CURRENCY_LABEL[c]}
            </button>
          ))}
          <select
            value={filters.presCcy}
            onChange={(e) => setFilters({ presCcy: e.target.value })}
            className="bg-bg-elevate border border-border rounded px-2 py-0.5 text-[11px] font-mono text-text"
            data-testid="cfo-filter-pccy"
            aria-label="Presentation currency"
          >
            {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* As-of */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">As of</span>
          <input
            type="date"
            value={filters.asOf}
            onChange={(e) => setFilters({ asOf: e.target.value })}
            className="bg-bg-elevate border border-border rounded px-2 py-0.5 text-[11px] font-mono text-text"
            data-testid="cfo-filter-asof"
          />
        </div>

        {/* Freshness */}
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {sources.map((s) => (
            <FreshnessChip key={s.name} source={s.name} ageMin={s.ageMin} status={s.status} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PanelHead — small section header for dashboard rows
   ============================================================ */

export function PanelHead({ title, drillHref, right }: { title: string; drillHref?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-2">
      <h3 className="text-[11px] font-mono uppercase tracking-widest text-text-faint">{title}</h3>
      <div className="flex items-center gap-2 text-[11px]">
        {right}
        {drillHref && (
          <Link href={drillHref} className="text-text-mute hover:text-gold inline-flex items-center gap-1 font-mono">
            Drill in <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
