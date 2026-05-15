import { Link } from "wouter";
import { Card, MonoChip } from "@/components/ui/primitives";
import { BarRows, type BarRowDatum } from "./charts";
import { useCompBands, useCompReview, useRecognition } from "../peopleSeed";

export function CompensationRewards() {
  const bands = useCompBands();
  const compReview = useCompReview();
  const recognition = useRecognition();

  const positionCounts = compReview.reduce(
    (a, r) => {
      a[r.bandPosition] = (a[r.bandPosition] ?? 0) + 1;
      return a;
    },
    {} as Record<string, number>,
  );
  const positionRows: BarRowDatum[] = (
    ["below", "p25-p50", "p50-p75", "above"] as const
  ).map((pos) => ({
    label: pos === "below" ? "Below band" : pos === "above" ? "Above band" : pos.toUpperCase(),
    value: positionCounts[pos] ?? 0,
    tone: pos === "below" ? "amber" : pos === "above" ? "gold" : "default",
  }));

  const submitted = compReview.filter((r) => r.status === "submitted").length;
  const drafts = compReview.filter((r) => r.status === "draft").length;
  const approved = compReview.filter((r) => r.status === "approved").length;
  const equityFlags = compReview.filter((r) => r.bandPosition === "below").length;

  return (
    <section className="space-y-3" data-testid="dashboard-compensation">
      <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
        Compensation &amp; rewards
      </h3>
      <div className="grid gap-3 lg:grid-cols-3">
        <Link href="/people/reward" data-testid="comp-bands">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Band coverage
            </div>
            <div className="text-3xl font-light text-gold leading-none">{bands.length}</div>
            <div className="mt-1 text-xs text-text-mute">
              levels published · jurisdictions {Array.from(new Set(bands.map((b) => b.jurisdiction))).join(", ")}
            </div>
            <div className="mt-3 space-y-1 text-xs">
              {bands.slice(0, 4).map((b) => (
                <div key={b.id} className="flex justify-between text-text-mute">
                  <span className="truncate">{b.level}</span>
                  <span className="font-mono text-text-faint">
                    ${b.baseP25K}–{b.baseP75K}k
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </Link>

        <Link href="/people/reward/review" data-testid="comp-review">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Comp-review status
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="text-center">
                <div className="text-xl font-light text-gold leading-none">{drafts}</div>
                <div className="text-[10px] font-mono uppercase text-text-faint mt-1">Draft</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-light text-gold leading-none">{submitted}</div>
                <div className="text-[10px] font-mono uppercase text-text-faint mt-1">Submitted</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-light text-success leading-none">{approved}</div>
                <div className="text-[10px] font-mono uppercase text-text-faint mt-1">Approved</div>
              </div>
            </div>
            <div className="text-xs text-text-mute">
              Pay-equity:{" "}
              {equityFlags > 0 ? (
                <MonoChip tone="amber">{equityFlags} below-band flag{equityFlags === 1 ? "" : "s"}</MonoChip>
              ) : (
                <MonoChip tone="green">No flags</MonoChip>
              )}
            </div>
          </Card>
        </Link>

        <Link href="/people/reward" data-testid="comp-position">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Band position · proposed cycle
            </div>
            {compReview.length === 0 ? (
              <div className="text-xs text-text-faint">No comp-review rows.</div>
            ) : (
              <BarRows rows={positionRows} />
            )}
            <div className="mt-3 text-[10px] text-text-faint">
              {recognition.length} recognition award{recognition.length === 1 ? "" : "s"} this quarter
            </div>
          </Card>
        </Link>
      </div>
    </section>
  );
}
