import * as React from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  width = 80,
  height = 24,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1];
  const first = values[0];
  const trendUp = last >= first;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={trendUp ? "var(--success)" : "var(--danger)"}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}

export interface BarRowDatum {
  label: string;
  value: number;
  /** Optional secondary annotation (e.g. "of 38"). */
  caption?: string;
  tone?: "default" | "gold" | "amber" | "red" | "green";
}

export function BarRows({
  rows,
  max,
  className,
  showValue = true,
}: {
  rows: BarRowDatum[];
  max?: number;
  className?: string;
  showValue?: boolean;
}) {
  const peak = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={cn("space-y-2", className)}>
      {rows.map((r) => {
        const pct = (r.value / peak) * 100;
        const fill =
          r.tone === "gold"
            ? "var(--gold)"
            : r.tone === "amber"
              ? "var(--warn)"
              : r.tone === "red"
                ? "var(--danger)"
                : r.tone === "green"
                  ? "var(--success)"
                  : "var(--gold-deep)";
        return (
          <div key={r.label} className="text-xs">
            <div className="flex items-baseline justify-between gap-3 mb-0.5">
              <span className="text-text-mute truncate">{r.label}</span>
              {showValue && (
                <span className="font-mono text-text-faint shrink-0">
                  {r.value}
                  {r.caption ? <span className="text-text-faint/70"> {r.caption}</span> : null}
                </span>
              )}
            </div>
            <div className="h-1.5 rounded-sm bg-bg-deep overflow-hidden">
              <div
                style={{ width: `${pct}%`, background: fill }}
                className="h-full transition-all"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  size = 96,
  thickness = 14,
  centerLabel,
  centerCaption,
  className,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: React.ReactNode;
  centerCaption?: React.ReactNode;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--bg-deep)"
            strokeWidth={thickness}
          />
          {segments.map((s, i) => {
            const len = (s.value / total) * c;
            const dasharray = `${len} ${c - len}`;
            const offset = -acc;
            acc += len;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={dasharray}
                strokeDashoffset={offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
          })}
        </svg>
        {(centerLabel || centerCaption) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerLabel && (
              <div className="text-lg font-light text-gold leading-none">{centerLabel}</div>
            )}
            {centerCaption && (
              <div className="text-[9px] font-mono uppercase tracking-widest text-text-faint mt-1">
                {centerCaption}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="space-y-1 text-xs flex-1 min-w-0">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-sm shrink-0"
              style={{ background: s.color }}
            />
            <span className="text-text-mute truncate flex-1">{s.label}</span>
            <span className="font-mono text-text-faint shrink-0">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface FunnelStep {
  id: string;
  label: string;
  value: number;
  caption?: string;
  href?: string;
  /** "next action" sentence to surface inline. */
  next?: string;
}

export function Funnel({
  steps,
  className,
}: {
  steps: FunnelStep[];
  className?: string;
}) {
  const peak = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className={cn("grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-border rounded-md overflow-hidden", className)}>
      {steps.map((s) => {
        const heightPct = Math.max(8, (s.value / peak) * 100);
        const inner = (
          <div
            className={cn(
              "bg-bg-elevate p-3 flex flex-col justify-between min-h-[124px] h-full",
              s.href && "hover:bg-bg-elevate-2 cursor-pointer transition-colors",
            )}
            data-testid={`tile-stage-${s.id}`}
            data-funnel-step={s.id}
          >
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                {s.label}
              </div>
              <div className="mt-1 text-xl font-light text-gold leading-none">{s.value}</div>
              {s.caption && (
                <div className="mt-1 text-[10px] text-text-faint leading-tight">{s.caption}</div>
              )}
            </div>
            <div>
              <div className="h-1 mt-3 rounded-sm bg-bg-deep">
                <div
                  className="h-full bg-gold/70 rounded-sm"
                  style={{ width: `${heightPct}%` }}
                />
              </div>
              {s.next && (
                <div className="mt-2 text-[11px] text-text-mute leading-snug line-clamp-2">
                  {s.next}
                </div>
              )}
            </div>
          </div>
        );
        return s.href ? (
          <Link key={s.id} href={s.href}>
            {inner}
          </Link>
        ) : (
          <React.Fragment key={s.id}>{inner}</React.Fragment>
        );
      })}
    </div>
  );
}
