/**
 * Task #348 — Real result-card renderers for the assistant transcript.
 *
 * Each `tool_result` frame from the orchestrator carries the raw `data`
 * payload returned by a CLI capability. The catalog tags every read with
 * a `resultCard` shape (kpi_strip / ranked_list / time_series /
 * entity_card / audit_timeline). This file owns the visual treatment
 * for each shape so "show pipeline by stage" becomes a real KPI strip
 * instead of a JSON dump.
 *
 * The renderers stay defensive about the payload — capabilities differ
 * subtly (e.g. kpi_strip may carry `stages[]` from pipeline.by_stage or
 * a flat object of numbers from forecast.summary), so each renderer
 * accepts `unknown` and degrades gracefully when fields are missing.
 */

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CliCapability, CliLocale } from "./types";

type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return null;
}
function asStr(v: unknown): string {
  return v == null ? "" : String(v);
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000)
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (!Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

function fmtUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000)
    return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000)
    return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(n)}`;
}

function humanLabel(key: string): string {
  return key
    .replace(/[_.]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Usd\b/, "USD")
    .replace(/Pct\b/, "%")
    .replace(/^./, (c) => c.toUpperCase());
}

function relativeTime(iso: string, locale: CliLocale): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return locale === "ar" ? "الآن" : "now";
  if (mins < 60) return locale === "ar" ? `منذ ${mins} د` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return locale === "ar" ? `منذ ${hrs} س` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return locale === "ar" ? `منذ ${days} يوم` : `${days}d ago`;
}

const SEV_DOT: Record<string, string> = {
  red: "bg-danger",
  amber: "bg-warning",
  green: "bg-success",
  error: "bg-danger",
  blocked: "bg-danger",
  running: "bg-warning",
  complete: "bg-success",
  success: "bg-success",
};

/* ─────────────────────────── dispatcher ─────────────────────────── */

export function ToolResultCardList({
  toolResults,
  capabilities,
  locale,
}: {
  toolResults: NonNullable<import("./types").CliTurn["toolResults"]>;
  capabilities: CliCapability[];
  locale: CliLocale;
}) {
  return (
    <div className="space-y-2.5" data-testid="cli-tool-results">
      {toolResults.map((tr, i) => {
        const cap = capabilities.find((c) => c.toolName === tr.tool) ?? null;
        return (
          <ToolResultCard
            key={`${tr.tool}-${i}`}
            tool={tr.tool}
            ok={tr.ok}
            data={tr.data}
            errorMessage={tr.errorMessage}
            shape={cap?.resultCard ?? null}
            description={cap?.description ?? null}
            locale={locale}
          />
        );
      })}
    </div>
  );
}

function ToolResultCard({
  tool,
  ok,
  data,
  errorMessage,
  shape,
  description,
  locale,
}: {
  tool: string;
  ok: boolean;
  data: unknown;
  errorMessage?: string;
  shape: string | null;
  description: string | null;
  locale: CliLocale;
}) {
  const titleLabel = description ? description.split(".")[0] : humanLabel(tool);
  return (
    <div
      className="bg-bg-elevate border border-border rounded-md overflow-hidden"
      data-testid="cli-tool-result-card"
      data-tool={tool}
      data-shape={shape ?? "unknown"}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-soft text-[11px] font-mono text-text-faint">
        <span className="truncate" title={titleLabel}>
          {titleLabel}
        </span>
        <span className="ml-2 inline-flex items-center gap-1.5 shrink-0">
          <span className="uppercase tracking-wider text-text-mute">
            {shape ?? tool}
          </span>
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              ok ? "bg-success" : "bg-danger",
            )}
            aria-hidden
          />
        </span>
      </div>
      <div className="p-3">
        {!ok ? (
          <div className="text-xs text-danger" data-testid="cli-tool-error">
            {errorMessage ?? (locale === "ar" ? "فشلت الأداة" : "tool failed")}
          </div>
        ) : (
          <ShapeBody shape={shape} data={asObj(data)} locale={locale} />
        )}
      </div>
    </div>
  );
}

function ShapeBody({
  shape,
  data,
  locale,
}: {
  shape: string | null;
  data: Json;
  locale: CliLocale;
}) {
  switch (shape) {
    case "kpi_strip":
      return <KpiStrip data={data} locale={locale} />;
    case "ranked_list":
      return <RankedList data={data} locale={locale} />;
    case "time_series":
      return <TimeSeries data={data} locale={locale} />;
    case "entity_card":
      return <EntityCard data={data} locale={locale} />;
    case "audit_timeline":
      return <AuditTimeline data={data} locale={locale} />;
    default:
      return <FallbackJson data={data} />;
  }
}

/* ─────────────────────────── kpi_strip ─────────────────────────── */

function KpiStrip({ data, locale }: { data: Json; locale: CliLocale }) {
  // pipeline.by_stage variant: { stages: [{ stage, count, weightedValueUsd, agedRedCount }] }
  const stages = asArr(data.stages) as Json[];
  if (stages.length > 0) {
    const max = Math.max(
      1,
      ...stages.map((s) => asNum(s.weightedValueUsd) ?? asNum(s.count) ?? 0),
    );
    return (
      <div data-testid="kpi-strip-stages">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {stages.map((s) => {
            const stage = asStr(s.stage);
            const count = asNum(s.count) ?? 0;
            const weighted = asNum(s.weightedValueUsd) ?? 0;
            const aged = asNum(s.agedRedCount) ?? 0;
            const fillPct = Math.max(2, Math.round((weighted / max) * 100));
            return (
              <div
                key={stage}
                className="bg-bg-deep border border-border-soft rounded p-2 flex flex-col gap-1"
                data-testid="kpi-stage"
              >
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint truncate">
                  {stage}
                </div>
                <div className="text-lg font-semibold leading-none">
                  {count}
                </div>
                <div className="text-[11px] text-text-mute">
                  {fmtUsd(weighted)}
                </div>
                <div
                  className="h-1 rounded-full bg-bg-elevate-2 overflow-hidden"
                  aria-hidden
                >
                  <div
                    className="h-full bg-gold"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
                {aged > 0 && (
                  <div className="text-[10px] font-mono text-danger">
                    {aged} {locale === "ar" ? "متقادم" : "aged"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Generic: render each numeric / short-string field as a tile.
  const tiles = Object.entries(data).filter(([, v]) => {
    if (asNum(v) !== null) return true;
    if (typeof v === "string" && v.length > 0 && v.length <= 24) return true;
    return false;
  });
  if (tiles.length === 0) return <FallbackJson data={data} />;
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
      data-testid="kpi-strip-flat"
    >
      {tiles.map(([k, v]) => {
        const n = asNum(v);
        const isUsd = /usd|amount|value/i.test(k);
        const isPct = /pct|percent|%/i.test(k);
        const display =
          n != null
            ? isUsd
              ? fmtUsd(n)
              : isPct
                ? `${n.toFixed(1)}%`
                : fmtNum(n)
            : asStr(v);
        return (
          <div
            key={k}
            className="bg-bg-deep border border-border-soft rounded p-2"
            data-testid="kpi-tile"
          >
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint truncate">
              {humanLabel(k)}
            </div>
            <div className="text-base font-semibold mt-0.5">{display}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── ranked_list ─────────────────────────── */

function RankedList({ data, locale }: { data: Json; locale: CliLocale }) {
  const items = asArr(data.items) as Json[];
  const total = asNum(data.total);
  if (items.length === 0) {
    return (
      <div className="text-xs text-text-mute italic" data-testid="ranked-empty">
        {locale === "ar" ? "لا توجد عناصر" : "No items."}
      </div>
    );
  }
  // Detect a numeric "rank" field used to draw a bar.
  const numericKey =
    items.some((it) => asNum(it.weightedValueUsd) !== null)
      ? "weightedValueUsd"
      : items.some((it) => asNum(it.usdAmount) !== null)
        ? "usdAmount"
        : items.some((it) => asNum(it.totalHours) !== null)
          ? "totalHours"
          : items.some((it) => asNum(it.ageDays) !== null)
            ? "ageDays"
            : null;
  const max = numericKey
    ? Math.max(1, ...items.map((it) => asNum(it[numericKey]) ?? 0))
    : 0;

  return (
    <div data-testid="ranked-list">
      {total != null && total > items.length && (
        <div className="text-[11px] text-text-faint mb-1.5">
          {locale === "ar"
            ? `يعرض ${items.length} من ${total}`
            : `Showing ${items.length} of ${total}`}
        </div>
      )}
      <ul className="space-y-1">
        {items.slice(0, 20).map((it, idx) => {
          const id = asStr(it.id);
          const label = asStr(it.label) || id || `#${idx + 1}`;
          const href = asStr(it.href);
          const sev = asStr(it.severity || it.policyStatus || it.raidStatus || it.status).toLowerCase();
          const dot = SEV_DOT[sev];
          const meta = renderItemMeta(it, locale);
          const n = numericKey ? asNum(it[numericKey]) : null;
          const fillPct =
            n != null && max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0;
          const Container: React.ElementType = href ? "a" : "div";
          const containerProps = href
            ? {
                href,
                className:
                  "block bg-bg-deep border border-border-soft hover:border-gold/50 rounded px-2 py-1.5 transition-colors",
              }
            : {
                className:
                  "block bg-bg-deep border border-border-soft rounded px-2 py-1.5",
              };
          return (
            <li key={id || idx} data-testid="ranked-row">
              <Container {...containerProps}>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-mono text-text-faint mt-0.5 w-5 shrink-0 text-end">
                    {idx + 1}
                  </span>
                  {dot && (
                    <span
                      className={cn(
                        "w-1.5 h-1.5 mt-1.5 rounded-full shrink-0",
                        dot,
                      )}
                      aria-hidden
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm leading-snug truncate">{label}</div>
                    {meta && (
                      <div className="text-[11px] font-mono text-text-faint mt-0.5">
                        {meta}
                      </div>
                    )}
                  </div>
                  {href && (
                    <ExternalLink className="w-3 h-3 text-text-faint mt-1 shrink-0" />
                  )}
                </div>
                {n != null && (
                  <div
                    className="h-1 mt-1.5 rounded-full bg-bg-elevate-2 overflow-hidden"
                    aria-hidden
                  >
                    <div
                      className="h-full bg-gold"
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                )}
              </Container>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function renderItemMeta(it: Json, locale: CliLocale): string | null {
  const parts: string[] = [];
  const pushIf = (cond: unknown, s: string) => {
    if (cond != null && cond !== "" && cond !== false) parts.push(s);
  };
  if (asNum(it.weightedValueUsd) != null)
    pushIf(true, fmtUsd(asNum(it.weightedValueUsd)!));
  else if (asNum(it.usdAmount) != null)
    pushIf(true, fmtUsd(asNum(it.usdAmount)!));
  if (asNum(it.totalHours) != null)
    pushIf(true, `${asNum(it.totalHours)}h`);
  if (asNum(it.daysInStage) != null)
    pushIf(true, `${asNum(it.daysInStage)}d in stage`);
  if (asNum(it.ageDays) != null)
    pushIf(true, locale === "ar" ? `منذ ${asNum(it.ageDays)} يوم` : `${asNum(it.ageDays)}d old`);
  if (typeof it.plmStage === "string") pushIf(true, asStr(it.plmStage));
  if (typeof it.plannedEndDate === "string")
    pushIf(true, `→ ${asStr(it.plannedEndDate)}`);
  if (typeof it.dueDate === "string" && it.dueDate)
    pushIf(true, `due ${asStr(it.dueDate)}`);
  if (typeof it.expiryDate === "string" && it.expiryDate)
    pushIf(true, `exp ${asStr(it.expiryDate)}`);
  if (typeof it.nextMilestone === "string" && it.nextMilestone)
    pushIf(true, asStr(it.nextMilestone));
  if (typeof it.message === "string" && it.message)
    pushIf(true, asStr(it.message));
  if (typeof it.kind === "string") pushIf(true, asStr(it.kind));
  if (Array.isArray(it.flags) && it.flags.length > 0)
    pushIf(true, `⚑ ${(it.flags as unknown[]).length}`);
  if (Array.isArray(it.findings) && it.findings.length > 0)
    pushIf(true, `${(it.findings as unknown[]).length} findings`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/* ─────────────────────────── time_series ─────────────────────────── */

function TimeSeries({ data, locale }: { data: Json; locale: CliLocale }) {
  const series = asArr(data.series) as Json[];
  if (series.length === 0) {
    return (
      <div className="text-xs text-text-mute italic" data-testid="series-empty">
        {locale === "ar" ? "لا بيانات في السلسلة" : "No series data."}
      </div>
    );
  }
  // Pull the first numeric field as the value (hours / value / amount).
  const valueKey =
    ["hours", "value", "amount", "billable"].find((k) =>
      series.some((row) => asNum(row[k]) !== null),
    ) ?? null;
  const labelKey =
    ["weekIso", "week", "date", "x", "label"].find((k) =>
      series.some((row) => typeof row[k] === "string"),
    ) ?? null;
  const points = series.map((row, i) => ({
    label: labelKey ? asStr(row[labelKey]) : `#${i + 1}`,
    value: valueKey ? (asNum(row[valueKey]) ?? 0) : 0,
    cumulative: asNum(row.cumulativeHours),
  }));
  const max = Math.max(1, ...points.map((p) => p.value));
  const total =
    asNum(data.totalHours) ??
    points.reduce((a, p) => a + p.value, 0);

  // Inline SVG bar chart — keeps dependencies zero and renders on the
  // brand palette. Width tracks the parent via viewBox + preserveAspectRatio.
  const W = 360;
  const H = 84;
  const pad = 4;
  const barGap = 2;
  const barW = Math.max(2, (W - pad * 2 - barGap * (points.length - 1)) / points.length);
  return (
    <div data-testid="time-series">
      <div className="flex items-end justify-between text-[11px] text-text-mute mb-1">
        <span className="font-mono">
          {points[0].label} → {points[points.length - 1].label}
        </span>
        <span>
          {locale === "ar" ? "الإجمالي" : "Total"}:{" "}
          <span className="text-text font-semibold">{fmtNum(total)}</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-20"
        preserveAspectRatio="none"
        role="img"
        aria-label="time series chart"
      >
        {points.map((p, i) => {
          const x = pad + i * (barW + barGap);
          const h = Math.max(1, Math.round((p.value / max) * (H - pad * 2)));
          const y = H - pad - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={h}
              className="fill-gold/80"
              data-testid="series-bar"
            >
              <title>
                {p.label}: {fmtNum(p.value)}
              </title>
            </rect>
          );
        })}
      </svg>
      {/* Compact tabular fallback for screen readers & precise reads. */}
      <details className="mt-1.5 text-[11px] text-text-mute">
        <summary className="cursor-pointer hover:text-text">
          {locale === "ar" ? "عرض القيم" : "Show values"}
        </summary>
        <div className="mt-1 max-h-32 overflow-y-auto font-mono">
          {points.map((p, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span>{p.label}</span>
              <span>
                {fmtNum(p.value)}
                {p.cumulative != null && (
                  <span className="text-text-faint"> · Σ {fmtNum(p.cumulative)}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/* ─────────────────────────── entity_card ─────────────────────────── */

function EntityCard({ data, locale }: { data: Json; locale: CliLocale }) {
  const name = asStr(data.name) || asStr(data.label) || asStr(data.id);
  const href = asStr(data.href);
  const skip = new Set(["id", "name", "label", "href", "weeks", "events"]);
  const rows = Object.entries(data).filter(
    ([k, v]) => !skip.has(k) && v != null && v !== "",
  );
  // utilization.person ships a `weeks` array — render a tiny sparkline.
  const weeks = asArr(data.weeks) as Json[];
  const flags = asArr(data.flags) as unknown[];

  return (
    <div data-testid="entity-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{name || "—"}</div>
          {data.id != null && (
            <div className="text-[11px] font-mono text-text-faint truncate">
              {asStr(data.id)}
            </div>
          )}
        </div>
        {href && (
          <a
            href={href}
            className="text-[11px] inline-flex items-center gap-1 text-text-mute hover:text-gold shrink-0"
            data-testid="entity-href"
          >
            {locale === "ar" ? "افتح" : "Open"}
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      {rows.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          {rows.slice(0, 8).map(([k, v]) => {
            if (Array.isArray(v)) {
              return (
                <React.Fragment key={k}>
                  <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px]">
                    {humanLabel(k)}
                  </dt>
                  <dd className="text-text">
                    {v.length === 0 ? "—" : `${v.length}`}
                  </dd>
                </React.Fragment>
              );
            }
            const n = asNum(v);
            const isUsd = /usd|amount|value/i.test(k);
            const isPct = /pct|percent|%/i.test(k);
            const display =
              n != null
                ? isUsd
                  ? fmtUsd(n)
                  : isPct
                    ? `${n.toFixed(1)}%`
                    : fmtNum(n)
                : asStr(v);
            return (
              <React.Fragment key={k}>
                <dt className="text-text-faint font-mono uppercase tracking-wider text-[10px]">
                  {humanLabel(k)}
                </dt>
                <dd className="text-text truncate" title={display}>
                  {display}
                </dd>
              </React.Fragment>
            );
          })}
        </dl>
      )}
      {weeks.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
            {locale === "ar" ? "آخر الأسابيع" : "Recent weeks"}
          </div>
          <Sparkline
            points={weeks
              .slice()
              .reverse()
              .map((w) => ({
                label: asStr(w.weekIso),
                value: asNum(w.billable) ?? 0,
              }))}
          />
        </div>
      )}
      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {flags.slice(0, 6).map((f, i) => (
            <span
              key={i}
              className="text-[10px] font-mono bg-warning/15 text-warning border border-warning/30 rounded px-1.5 py-0.5"
            >
              ⚑ {asStr(f)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Sparkline({
  points,
}: {
  points: Array<{ label: string; value: number }>;
}) {
  if (points.length === 0) return null;
  const W = 200;
  const H = 32;
  const max = Math.max(1, ...points.map((p) => p.value));
  const pad = 2;
  const barGap = 1;
  const barW = Math.max(2, (W - pad * 2 - barGap * (points.length - 1)) / points.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-8"
      preserveAspectRatio="none"
      role="img"
      aria-label="sparkline"
    >
      {points.map((p, i) => {
        const x = pad + i * (barW + barGap);
        const h = Math.max(1, Math.round((p.value / max) * (H - pad * 2)));
        const y = H - pad - h;
        return (
          <rect key={i} x={x} y={y} width={barW} height={h} className="fill-gold/70">
            <title>
              {p.label}: {p.value}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

/* ─────────────────────────── audit_timeline ─────────────────────────── */

function AuditTimeline({ data, locale }: { data: Json; locale: CliLocale }) {
  const events = asArr(data.events) as Json[];
  if (events.length === 0) {
    return (
      <div className="text-xs text-text-mute italic" data-testid="audit-empty">
        {locale === "ar" ? "لا أحداث" : "No events."}
      </div>
    );
  }
  return (
    <ol
      className="relative border-s border-border-soft ms-1.5 ps-3 space-y-2"
      data-testid="audit-timeline"
    >
      {events.slice(0, 20).map((e, i) => {
        const ts = asStr(e.ts);
        const action = asStr(e.action);
        const actor = asStr(e.actor);
        const actorType = asStr(e.actorType);
        const summary = asStr(e.summary);
        const auditId = asStr(e.id);
        const isAgent = actorType === "agent";
        return (
          <li key={auditId || i} className="relative" data-testid="audit-row">
            <span
              className={cn(
                "absolute -start-[17px] top-1.5 w-2 h-2 rounded-full border border-bg-deep",
                isAgent ? "bg-gold" : "bg-text-mute",
              )}
              aria-hidden
            />
            <div className="flex items-baseline gap-2 text-[11px]">
              <span className="font-mono text-text-faint shrink-0">
                {ts ? relativeTime(ts, locale) : ""}
              </span>
              <span className="font-mono text-gold truncate">{action}</span>
              {actor && (
                <span className="text-text-mute truncate">· {actor}</span>
              )}
            </div>
            {summary && (
              <div className="text-[12px] text-text leading-snug mt-0.5">
                {summary}
              </div>
            )}
            {auditId && (
              <a
                href={`/admin?audit=${encodeURIComponent(auditId)}`}
                className="text-[10px] font-mono text-text-faint hover:text-gold inline-flex items-center gap-0.5 mt-0.5"
                data-testid="audit-link"
              >
                <ExternalLink className="w-3 h-3" />
                {locale === "ar" ? "السجل" : "audit"}
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────────────────── fallback ─────────────────────────── */

function FallbackJson({ data }: { data: Json }) {
  return (
    <pre
      className="text-[11px] font-mono text-text-mute bg-bg-deep border border-border-soft rounded p-2 overflow-x-auto max-h-48"
      data-testid="cli-result-fallback-json"
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
