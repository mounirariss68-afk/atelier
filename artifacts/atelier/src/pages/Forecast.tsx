import * as React from "react";
import { Card, PageHero, SectionHead } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

interface ForecastRow {
  key: string;
  label: string;
  count: number;
  weightedValueUsd: number;
  rawValueUsd: number;
  byStage: Record<string, number>;
}

const TABS: Array<{ id: string; label: string }> = [
  { id: "partner", label: "By partner" },
  { id: "offering", label: "By offering" },
  { id: "sector", label: "By sector" },
  { id: "stage", label: "By stage" },
  { id: "quarter", label: "By quarter" },
];

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

export default function Forecast() {
  const [by, setBy] = React.useState<string>("partner");
  const [data, setData] = React.useState<{ rows: ForecastRow[]; totals: { count: number; weightedValueUsd: number; rawValueUsd: number } } | null>(null);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    setData(null);
    setError(false);
    let alive = true;
    fetch(`/api/atelier/forecast?by=${by}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => { if (alive) setData(j); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [by]);
  return (
    <div>
      <PageHero>
        <SectionHead
          eyebrow="FORECAST"
          headline="Pipeline roll-ups"
          lede="Weighted value derived from deal hypothesis × probability."
        />
      </PageHero>
      <div className="p-6 md:p-10 space-y-6 max-w-6xl">
      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setBy(t.id)}
            className={`px-3 py-1 rounded text-sm font-mono transition-colors ${
              by === t.id ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!data ? (
        error ? (
          <Card className="p-8 text-center border-danger/40">
            <div className="text-danger font-medium">Couldn't load the forecast.</div>
            <button
              type="button"
              onClick={() => setBy((b) => b)}
              className="mt-3 px-3 py-1 rounded text-sm font-mono bg-bg-elevate text-text-mute hover:text-text"
            >
              Retry
            </button>
          </Card>
        ) : (
          <Skeleton className="h-32 bg-bg-elevate" />
        )
      ) : (
        <>
          <Card className="p-4">
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div>
                <div className="text-text-faint font-mono text-xs uppercase">Opps</div>
                <div className="text-2xl font-semibold mt-1">{data.totals.count}</div>
              </div>
              <div>
                <div className="text-text-faint font-mono text-xs uppercase">Weighted</div>
                <div className="text-2xl font-semibold mt-1 text-gold">{fmtUsd(data.totals.weightedValueUsd)}</div>
              </div>
              <div>
                <div className="text-text-faint font-mono text-xs uppercase">Raw</div>
                <div className="text-2xl font-semibold mt-1">{fmtUsd(data.totals.rawValueUsd)}</div>
              </div>
            </div>
          </Card>
          <SectionHead title={`Roll-up by ${by}`} />
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevate/50 text-text-mute font-mono text-xs uppercase">
                <tr>
                  <th className="text-left p-3">Bucket</th>
                  <th className="text-right p-3">Count</th>
                  <th className="text-right p-3">Weighted</th>
                  <th className="text-right p-3">Raw</th>
                  <th className="text-left p-3">By stage</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className="border-t border-border-soft">
                    <td className="p-3 font-medium">{r.label}</td>
                    <td className="p-3 text-right">{r.count}</td>
                    <td className="p-3 text-right text-gold">{fmtUsd(r.weightedValueUsd)}</td>
                    <td className="p-3 text-right text-text-mute">{fmtUsd(r.rawValueUsd)}</td>
                    <td className="p-3 text-xs font-mono text-text-mute">
                      {Object.entries(r.byStage).map(([s, c]) => `${s}:${c}`).join(" · ")}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-text-faint text-sm italic">No data for this grouping.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
      </div>
    </div>
  );
}
