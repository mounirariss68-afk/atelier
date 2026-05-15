import * as React from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/primitives";
import { BarRows, Donut, type BarRowDatum, type DonutSegment } from "./charts";
import { useOrgUnits } from "../peopleSeed";
import { useRosterDirectory } from "./useRosterDirectory";

const SENIORITY_PALETTE = [
  "var(--gold)",
  "var(--gold-soft)",
  "var(--gold-deep)",
  "var(--text-mute)",
  "var(--success)",
  "var(--warn)",
];

function prettySeniority(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WorkforceComposition() {
  const orgUnits = useOrgUnits();
  const { rows: rosterPeople } = useRosterDirectory();

  const businessUnits: BarRowDatum[] = orgUnits
    .filter((o) => o.parentId !== null)
    .map((o) => ({
      label: o.name,
      value: o.headcount,
      caption: o.openRoles > 0 ? `· ${o.openRoles} open` : undefined,
      tone: o.openRoles > 2 ? ("amber" as const) : ("default" as const),
    }))
    .sort((a, b) => b.value - a.value);

  const locationRows: BarRowDatum[] = React.useMemo(() => {
    if (!rosterPeople) return [];
    const counts = new Map<string, number>();
    rosterPeople.forEach((p) => {
      const c = (p.country ?? "Unspecified").trim() || "Unspecified";
      counts.set(c, (counts.get(c) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, value]) => ({ label, value, tone: "default" as const }))
      .sort((a, b) => b.value - a.value);
  }, [rosterPeople]);

  const senioritySegments: DonutSegment[] = React.useMemo(() => {
    if (!rosterPeople) return [];
    const counts = new Map<string, number>();
    rosterPeople.forEach((p) => {
      const s = (p.seniority ?? "Unspecified").trim() || "Unspecified";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({
        label: prettySeniority(label),
        value,
        color: SENIORITY_PALETTE[i % SENIORITY_PALETTE.length],
      }));
  }, [rosterPeople]);

  const seniorityTotal = senioritySegments.reduce((s, x) => s + x.value, 0);

  return (
    <section className="space-y-3" data-testid="dashboard-composition">
      <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
        Workforce composition
      </h3>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Link href="/people/org" data-testid="composition-by-unit">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              By business unit
            </div>
            {businessUnits.length === 0 ? (
              <div className="text-xs text-text-faint">No org units in seed.</div>
            ) : (
              <BarRows rows={businessUnits} />
            )}
          </Card>
        </Link>

        <Link href="/people/people" data-testid="composition-by-level">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              By level / seniority
            </div>
            {rosterPeople === null ? (
              <div className="text-xs text-text-faint">Loading roster…</div>
            ) : senioritySegments.length === 0 ? (
              <div className="text-xs text-text-faint">
                No seniority recorded on the roster directory.
              </div>
            ) : (
              <Donut
                segments={senioritySegments}
                centerLabel={seniorityTotal}
                centerCaption="people"
              />
            )}
            <div className="mt-3 font-mono text-[9px] uppercase tracking-widest text-text-faint">
              from roster directory · live
            </div>
          </Card>
        </Link>

        <Link href="/people/people" data-testid="composition-by-tenure">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              By tenure band
            </div>
            <div className="text-xs text-text-faint leading-relaxed">
              Hire-date is not yet captured on the roster directory.
              Add <span className="font-mono text-text-mute">hireDate</span>{" "}
              to enable this band.
            </div>
          </Card>
        </Link>

        <Link href="/people/people" data-testid="composition-by-diversity">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Gender / diversity mix
            </div>
            <div className="text-xs text-text-faint leading-relaxed">
              Gender, ethnicity and other DEI attributes are not yet captured
              on the roster directory. Add{" "}
              <span className="font-mono text-text-mute">gender</span> /{" "}
              <span className="font-mono text-text-mute">ethnicity</span>{" "}
              fields to enable this panel — handled the same way as tenure
              and attrition history.
            </div>
          </Card>
        </Link>

        <Link href="/people/people" data-testid="composition-by-location">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              By location
            </div>
            {rosterPeople === null ? (
              <div className="text-xs text-text-faint">Loading roster…</div>
            ) : locationRows.length === 0 ? (
              <div className="text-xs text-text-faint">
                No country data on the roster directory.
              </div>
            ) : (
              <BarRows rows={locationRows} />
            )}
            <div className="mt-3 font-mono text-[9px] uppercase tracking-widest text-text-faint">
              from roster directory · live
            </div>
          </Card>
        </Link>
      </div>
    </section>
  );
}
