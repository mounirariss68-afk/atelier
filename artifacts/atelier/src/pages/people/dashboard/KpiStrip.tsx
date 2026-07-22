import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useRosterDirectory } from "./useRosterDirectory";

interface Kpi {
  id: string;
  eyebrow: string;
  value: string;
  caption: string;
  href: string;
  /** Tone for the chip (signal). */
  tone?: "default" | "gold" | "amber" | "red" | "green";
  chip?: string;
  /** True when the tile has no real data source behind it yet. */
  noData?: boolean;
}

export function KpiStrip() {
  const { rows: rosterPeople, error: rosterError } = useRosterDirectory();

  const headcount =
    rosterPeople === null
      ? null
      : rosterPeople.filter((p) => (p.status ?? "active") === "active").length;

  const kpis: Kpi[] = [
    {
      id: "headcount",
      eyebrow: "Headcount",
      value: rosterError ? "—" : headcount === null ? "…" : String(headcount),
      caption: rosterError
        ? "roster directory unavailable — reload to retry"
        : headcount === null
          ? "loading roster directory…"
          : "active people on the roster · live",
      href: "/people/people",
      tone: rosterError ? "red" : "green",
      chip: rosterError ? "error" : "live",
    },
    {
      id: "open-reqs",
      eyebrow: "Open requisitions",
      value: "—",
      caption: "No requisitions recorded yet",
      href: "/people/hire",
      noData: true,
    },
    {
      id: "perf-health",
      eyebrow: "Performance health",
      value: "—",
      caption: "No calibrated reviews yet",
      href: "/people/perform",
      noData: true,
    },
    {
      id: "learning",
      eyebrow: "Learning · hrs / FTE",
      value: "—",
      caption: "No learning records tracked yet",
      href: "/people/develop",
      noData: true,
    },
    {
      id: "comp",
      eyebrow: "Comp · pay-equity",
      value: "—",
      caption: "No comp-review records yet",
      href: "/people/reward",
      noData: true,
    },
  ];

  return (
    <section className="space-y-3" data-testid="dashboard-kpi-strip">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
          Workforce pulse
        </h3>
        <span
          className="font-mono text-[10px] uppercase tracking-widest text-text-faint"
          data-testid="kpi-strip-baseline-note"
        >
          Headcount reads live from the roster · other metrics await real HR data
        </span>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 2xl:grid-cols-5">
        {kpis.map((k) => (
          <Link key={k.id} href={k.href} data-testid={`kpi-${k.id}`}>
            <Card hover className="p-3 cursor-pointer h-full flex flex-col justify-between min-h-[112px]">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint truncate">
                  {k.eyebrow}
                </div>
                {k.chip ? (
                  <MonoChip tone={k.tone}>{k.chip}</MonoChip>
                ) : k.noData ? (
                  <MonoChip tone="default">no data</MonoChip>
                ) : null}
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <div
                  className={cn(
                    "text-2xl font-light leading-none",
                    k.noData ? "text-text-faint" : "text-gold",
                  )}
                >
                  {k.value}
                </div>
              </div>
              <div className="mt-2 text-[11px] text-text-mute leading-snug line-clamp-2">
                {k.caption}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
