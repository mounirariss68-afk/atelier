import * as React from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/primitives";

/**
 * Task #983 — KPI band card. Structure follows the "Ministry Pulse"
 * reference: small mono label, large headline figure, one-line context
 * caption, a tinted rounded icon chip top-right, and an embedded
 * mini-graphic along the bottom edge (accent ratio underline or a soft
 * area sparkline). Colors, typography and translucency are the existing
 * Cognirise glass theme — only the card anatomy comes from the reference.
 */

export type KpiAccent = "gold" | "gold-soft" | "gold-deep" | "success" | "warn" | "danger";

const ACCENT: Record<KpiAccent, { text: string; chipBg: string; bar: string; barTrack: string; stroke: string; fill: string }> = {
  gold: { text: "text-gold", chipBg: "bg-gold/12 border-gold/25", bar: "bg-gold", barTrack: "bg-gold/15", stroke: "var(--gold)", fill: "var(--gold)" },
  "gold-soft": { text: "text-gold-soft", chipBg: "bg-gold-soft/12 border-gold-soft/25", bar: "bg-gold-soft", barTrack: "bg-gold-soft/15", stroke: "var(--gold-soft)", fill: "var(--gold-soft)" },
  "gold-deep": { text: "text-gold-deep", chipBg: "bg-gold-deep/12 border-gold-deep/25", bar: "bg-gold-deep", barTrack: "bg-gold-deep/15", stroke: "var(--gold-deep)", fill: "var(--gold-deep)" },
  success: { text: "text-success", chipBg: "bg-success/12 border-success/25", bar: "bg-success", barTrack: "bg-success/15", stroke: "var(--success)", fill: "var(--success)" },
  warn: { text: "text-warn", chipBg: "bg-warn/12 border-warn/25", bar: "bg-warn", barTrack: "bg-warn/15", stroke: "var(--warn)", fill: "var(--warn)" },
  danger: { text: "text-danger", chipBg: "bg-danger/12 border-danger/25", bar: "bg-danger", barTrack: "bg-danger/15", stroke: "var(--danger)", fill: "var(--danger)" },
};

export type KpiGraphic =
  | { kind: "ratio"; value: number } // 0..1; renders a thin accent underline
  | { kind: "spark"; points: number[] }; // soft area sparkline along the bottom

/** Soft area sparkline hugging the card's bottom edge. Degrades to a flat
 * baseline when every point is zero/absent — no fake data. */
function Sparkline({ points, accent }: { points: number[]; accent: KpiAccent }) {
  const a = ACCENT[accent];
  const w = 100;
  const h = 24;
  const max = Math.max(...points, 0);
  const n = Math.max(points.length, 2);
  const ys = (points.length >= 2 ? points : [0, 0]).map((p) =>
    max > 0 ? h - 3 - (p / max) * (h - 6) : h - 3,
  );
  const xs = ys.map((_, i) => (i / (n - 1)) * w);
  const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const gradId = React.useId();
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="absolute inset-x-0 bottom-0 h-6 w-full pointer-events-none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={a.fill} stopOpacity="0.28" />
          <stop offset="100%" stopColor={a.fill} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke={a.stroke} strokeOpacity="0.75" strokeWidth="1.2" />
    </svg>
  );
}

function RatioBar({ value, accent }: { value: number; accent: KpiAccent }) {
  const a = ACCENT[accent];
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className={cn("absolute inset-x-4 bottom-3 h-[3px] rounded-full overflow-hidden", a.barTrack)} aria-hidden>
      <div className={cn("h-full rounded-full transition-[width]", a.bar)} style={{ width: `${pct}%`, opacity: 0.85 }} />
    </div>
  );
}

export function KpiCard({
  label,
  value,
  caption,
  icon,
  accent = "gold",
  graphic,
  className,
  "data-testid": testId,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  caption?: React.ReactNode;
  icon?: React.ReactNode;
  accent?: KpiAccent;
  graphic?: KpiGraphic;
  className?: string;
  "data-testid"?: string;
}) {
  const a = ACCENT[accent];
  return (
    <Card className={cn("relative overflow-hidden p-4 pb-6 min-h-[104px]", className)} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-mute truncate">{label}</div>
          <div className="text-2xl md:text-[1.7rem] font-semibold tracking-tight text-text leading-none">{value}</div>
          {caption && (
            <div className="text-[11px] text-text-faint leading-snug truncate pt-0.5">{caption}</div>
          )}
        </div>
        {icon && (
          <span
            className={cn(
              "shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4",
              a.chipBg,
              a.text,
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      {graphic?.kind === "spark" && <Sparkline points={graphic.points} accent={accent} />}
      {graphic?.kind === "ratio" && <RatioBar value={graphic.value} accent={accent} />}
    </Card>
  );
}
