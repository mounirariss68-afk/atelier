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

const GENDER_PALETTE: Record<string, string> = {
  Female: "var(--gold)",
  Male: "var(--gold-deep)",
  "Non-binary": "var(--success)",
  Unspecified: "var(--text-mute)",
};

function prettySeniority(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyGender(g: string): string {
  const k = g.trim().toLowerCase();
  if (!k || k === "unspecified") return "Unspecified";
  if (k === "non_binary" || k === "non-binary") return "Non-binary";
  return k.charAt(0).toUpperCase() + k.slice(1);
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

  const genderSegments: DonutSegment[] = React.useMemo(() => {
    if (!rosterPeople) return [];
    const counts = new Map<string, number>();
    rosterPeople.forEach((p) => {
      const label = prettyGender(p.gender ?? "unspecified");
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({
        label,
        value,
        color:
          GENDER_PALETTE[label] ??
          SENIORITY_PALETTE[i % SENIORITY_PALETTE.length],
      }));
  }, [rosterPeople]);

  const genderTotal = genderSegments.reduce((s, x) => s + x.value, 0);

  const tenureRows: BarRowDatum[] = React.useMemo(() => {
    if (!rosterPeople) return [];
    const bands: { label: string; minYears: number; maxYears: number }[] = [
      { label: "< 1 yr",   minYears: 0,  maxYears: 1 },
      { label: "1–3 yrs",  minYears: 1,  maxYears: 3 },
      { label: "3–5 yrs",  minYears: 3,  maxYears: 5 },
      { label: "5–10 yrs", minYears: 5,  maxYears: 10 },
      { label: "10+ yrs",  minYears: 10, maxYears: Infinity },
    ];
    const counts = bands.map(() => 0);
    const now = Date.now();
    const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
    let withDate = 0;
    rosterPeople.forEach((p) => {
      if (!p.startDate) return;
      const t = Date.parse(p.startDate);
      if (Number.isNaN(t)) return;
      withDate += 1;
      const years = (now - t) / MS_PER_YEAR;
      const idx = bands.findIndex((b) => years >= b.minYears && years < b.maxYears);
      if (idx >= 0) counts[idx]! += 1;
    });
    if (withDate === 0) return [];
    return bands.map((b, i) => ({
      label: b.label,
      value: counts[i]!,
      tone: "default" as const,
    }));
  }, [rosterPeople]);

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
              <div className="text-xs text-text-faint">No business units recorded yet.</div>
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
            {rosterPeople === null ? (
              <div className="text-xs text-text-faint">Loading roster…</div>
            ) : tenureRows.length === 0 ? (
              <div className="text-xs text-text-faint">
                No start-date data on the roster directory.
              </div>
            ) : (
              <BarRows rows={tenureRows} />
            )}
            <div className="mt-3 font-mono text-[9px] uppercase tracking-widest text-text-faint">
              from roster directory · live
            </div>
          </Card>
        </Link>

        <Link href="/people/people" data-testid="composition-by-diversity">
          <Card hover className="p-4 cursor-pointer h-full">
            <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
              Gender / diversity mix
            </div>
            {rosterPeople === null ? (
              <div className="text-xs text-text-faint">Loading roster…</div>
            ) : genderSegments.length === 0 ? (
              <div className="text-xs text-text-faint">
                No gender data on the roster directory.
              </div>
            ) : (
              <Donut
                segments={genderSegments}
                centerLabel={genderTotal}
                centerCaption="people"
              />
            )}
            <div className="mt-3 font-mono text-[9px] uppercase tracking-widest text-text-faint">
              from roster directory · live
            </div>
            <div className="mt-1 text-[10px] text-text-faint leading-relaxed">
              Ethnicity is not yet captured on the roster.
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
