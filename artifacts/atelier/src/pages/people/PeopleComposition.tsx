// People Lens — Team Composition dashboard (Task #412).
// Snapshot-style view: filters apply to every panel, charts use the
// shared ChartContainer wrapper, slice clicks deep-link to the People
// directory via roster cohort params.

import * as React from "react";
import { Link, useLocation } from "wouter";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, MonoChip } from "@/components/ui/primitives";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { PeopleShell } from "./PeopleShell";
import { PeopleEmptyState } from "./PeopleEmptyState";
import {
  COMPOSITION_AS_OF, COMPOSITION_SOFT_SKILLS,
  useCompositionPeople, useOrgUnits, useReviews, useGoals, useSuccession, useSkillGaps,
} from "./peopleSeed";
import type {
  CompositionPerson, CompositionGender, LangProficiency, SeniorityLevel, WorkerKind,
} from "./peopleSeed";

// ------------------------------------------------------------------
// Filter bar — shared state object every panel reads from.
// ------------------------------------------------------------------

interface CompositionFilters {
  businessUnit: string | "all";
  location: string | "all";
  seniority: SeniorityLevel | "all";
  workerType: WorkerKind | "all";
}

const ALL_FILTERS: CompositionFilters = {
  businessUnit: "all", location: "all", seniority: "all", workerType: "all",
};

function applyFilters(rows: CompositionPerson[], f: CompositionFilters): CompositionPerson[] {
  return rows.filter((r) =>
    (f.businessUnit === "all" || r.businessUnit === f.businessUnit) &&
    (f.location === "all" || r.location === f.location) &&
    (f.seniority === "all" || r.seniority === f.seniority) &&
    (f.workerType === "all" || r.workerType === f.workerType)
  );
}

// ------------------------------------------------------------------
// Atelier-token chart palette (navy/gold + amber/teal/violet for mix).
// ------------------------------------------------------------------

const GENDER_COLOR: Record<CompositionGender, string> = {
  female: "#c9a86a",
  male: "#8aa7d6",
  non_binary: "#a78bbb",
  unspecified: "#5b5d63",
};

const PROFICIENCY_ORDER: LangProficiency[] = ["basic", "working", "fluent", "native"];
const PROFICIENCY_COLOR: Record<LangProficiency, string> = {
  basic:   "#5b5d63",
  working: "#8aa7d6",
  fluent:  "#c9a86a",
  native:  "#7ab7a6",
};

const SENIORITY_ORDER: SeniorityLevel[] = [
  "Analyst", "Consultant", "Senior Consultant", "Manager", "Senior Manager", "Principal", "Partner",
];

// Tenure bands (years).
function tenureYears(startDate: string): number {
  const start = new Date(startDate).getTime();
  const now = new Date(COMPOSITION_AS_OF).getTime();
  return Math.max(0, (now - start) / (365.25 * 24 * 3600 * 1000));
}
function tenureBand(y: number): string {
  if (y < 1) return "< 1 yr";
  if (y < 3) return "1–3 yrs";
  if (y < 6) return "3–6 yrs";
  if (y < 10) return "6–10 yrs";
  return "10+ yrs";
}
const TENURE_BANDS = ["< 1 yr", "1–3 yrs", "3–6 yrs", "6–10 yrs", "10+ yrs"];

const COUNTRY_LABEL: Record<string, string> = {
  AE: "United Arab Emirates", SA: "Saudi Arabia", EG: "Egypt", JO: "Jordan",
  QA: "Qatar", LB: "Lebanon", IN: "India", PT: "Portugal", GB: "United Kingdom",
  DE: "Germany", ES: "Spain", FR: "France", SG: "Singapore", JP: "Japan",
  BR: "Brazil", NG: "Nigeria", PL: "Poland", TR: "Türkiye",
};
const labelCountry = (iso: string) => COUNTRY_LABEL[iso] ?? iso;

// Empty `ChartConfig` — we drive colours via `fill=` on each series so the
// theme-token machinery in chart.tsx is opt-in per chart later if needed.
const EMPTY_CHART_CONFIG = {} satisfies ChartConfig;

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function PeopleComposition() {
  const allPeople = useCompositionPeople();
  const orgUnits = useOrgUnits();
  const reviews = useReviews();
  const goals = useGoals();
  const succession = useSuccession();
  const skillGaps = useSkillGaps();
  const [, navigate] = useLocation();

  const [filters, setFilters] = React.useState<CompositionFilters>(ALL_FILTERS);
  const filtered = React.useMemo(() => applyFilters(allPeople, filters), [allPeople, filters]);
  const inScopeNames = React.useMemo(
    () => new Set(filtered.map((p) => p.fullName)),
    [filtered],
  );

  /** Build a directory deep-link URL that combines panel-clicked cohort
   *  filters with whatever the dashboard filter bar already has set, so
   *  the directory reflects exactly the same slice the user is looking at. */
  const cohortHref = React.useCallback(
    (extra: Partial<Record<"nationality" | "gender" | "country" | "seniority" | "workerType", string>>) => {
      const sp = new URLSearchParams();
      if (filters.workerType !== "all") sp.set("workerType", filters.workerType);
      if (filters.seniority !== "all") sp.set("seniority", filters.seniority);
      for (const [k, v] of Object.entries(extra)) {
        if (v) sp.set(k, v);
      }
      return `/people/people${sp.toString() ? `?${sp.toString()}` : ""}`;
    },
    [filters],
  );

  return (
    <PeopleShell module="composition">
      <LensPageHeader
        eyebrow="People · Composition"
        headline="Team composition — who do we have?"
        lede="A snapshot of the firm's makeup: demographics, languages, hard- and soft-skills, performance distribution, seniority pyramid and tenure. Filters apply to every panel; numbers reflect data we have on file today."
      />

      <div className="container-atelier py-6 space-y-6" data-testid="page-composition">
        {allPeople.length === 0 ? (
          <PeopleEmptyState message="No composition snapshot yet. Demographic, language and skill breakdowns will appear here once HR captures those fields for the roster." />
        ) : (
          <>
            <SnapshotBanner />
            <FilterBar people={allPeople} filters={filters} onChange={setFilters} />
            <KpiStrip people={filtered} succession={succession} />
            <DemographicsPanel people={filtered} cohortHref={cohortHref} />
            <SeniorityStructurePanel people={filtered} orgUnits={orgUnits} cohortHref={cohortHref} />
            <LanguagesPanel people={filtered} cohortHref={cohortHref} />
            <HardSkillsPanel people={filtered} skillGaps={skillGaps} />
            <SoftSkillsPanel people={filtered} />
            <PerformancePanel
              people={filtered}
              inScopeNames={inScopeNames}
              reviews={reviews}
              goals={goals}
              succession={succession}
            />
            <CrossCutPanel people={filtered} />
            <DataCoverageStrip people={filtered} />
            <CrossLinks cohortHref={cohortHref} />
          </>
        )}
      </div>
    </PeopleShell>
  );
}

// ------------------------------------------------------------------
// Honest data-source banner (addresses snapshot vs live-data drift).
// ------------------------------------------------------------------

function SnapshotBanner() {
  return (
    <Card className="p-3 border-l-4 border-l-gold/70" data-testid="composition-snapshot-banner">
      <div className="text-[11px] text-text-mute leading-relaxed">
        <span className="font-mono text-[10px] uppercase tracking-widest text-gold mr-2">
          Snapshot
        </span>
        Demographic, language and skill fields are populated from the
        seeded People Lens snapshot while HR fills in the new
        <span className="font-mono text-text"> gender</span> and
        <span className="font-mono text-text"> nationality</span> columns
        added to the roster tables in this task. As real data lands the
        page will read straight from the roster API; the data-coverage
        strip below tracks what's been captured today.
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Filter bar
// ------------------------------------------------------------------

function FilterBar({
  people, filters, onChange,
}: {
  people: CompositionPerson[];
  filters: CompositionFilters;
  onChange: (f: CompositionFilters) => void;
}) {
  const businessUnits = uniqueSorted(people.map((p) => p.businessUnit));
  const locations = uniqueSorted(people.map((p) => p.location));
  const set = (k: keyof CompositionFilters, v: string) =>
    onChange({ ...filters, [k]: v as never });

  return (
    <Card className="p-4" data-testid="composition-filters">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-mono uppercase tracking-widest text-text-mute">Filters</span>
        <Select label="Business unit" value={filters.businessUnit} onChange={(v) => set("businessUnit", v)}
          options={[{ value: "all", label: "All" }, ...businessUnits.map((b) => ({ value: b, label: b }))]}
          testId="filter-bu" />
        <Select label="Location" value={filters.location} onChange={(v) => set("location", v)}
          options={[{ value: "all", label: "All" }, ...locations.map((b) => ({ value: b, label: b }))]}
          testId="filter-location" />
        <Select label="Seniority" value={filters.seniority} onChange={(v) => set("seniority", v)}
          options={[{ value: "all", label: "All" }, ...SENIORITY_ORDER.map((b) => ({ value: b, label: b }))]}
          testId="filter-seniority" />
        <Select label="Worker type" value={filters.workerType} onChange={(v) => set("workerType", v)}
          options={[
            { value: "all", label: "All" },
            { value: "employee", label: "Employee" },
            { value: "contractor", label: "Contractor" },
            { value: "partner_firm_resource", label: "Partner-firm" },
          ]}
          testId="filter-worker-type" />
        {Object.entries(filters).some(([k, v]) => v !== ALL_FILTERS[k as keyof CompositionFilters]) && (
          <button
            onClick={() => onChange(ALL_FILTERS)}
            className="ml-auto px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-widest text-text-mute hover:text-gold border border-border-soft"
            data-testid="filter-reset"
          >
            Reset
          </button>
        )}
      </div>
    </Card>
  );
}

function Select({
  label, value, onChange, options, testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase text-text-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-xs"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------
// KPI strip — top of page
// ------------------------------------------------------------------

function KpiStrip({ people, succession }: {
  people: CompositionPerson[];
  succession: ReturnType<typeof useSuccession>;
}) {
  const headcount = people.length;
  const nationalities = new Set(people.map((p) => p.nationality).filter(Boolean) as string[]).size;
  const languages = new Set(people.flatMap((p) => p.languages.map((l) => l.slug))).size;
  const skills = new Set(people.flatMap((p) => p.hardSkills.map((s) => s.slug))).size;
  // Filter-aware: count succession slots whose ready-now bench includes
  // at least one person currently in scope. When the slice has no people
  // the metric is meaningless, so report it as 0 / hide the denominator.
  const inScope = new Set(people.map((p) => p.fullName));
  const slotsInScope = succession.filter((s) =>
    s.readyNow.some((n) => inScope.has(n)) ||
    s.readyOneYear.some((n) => inScope.has(n)) ||
    s.readyTwoToThreeYears.some((n) => inScope.has(n)) ||
    inScope.has(s.incumbent),
  );
  const readyNowPct = slotsInScope.length === 0
    ? 0
    : Math.round(
        (slotsInScope.filter((s) => s.readyNow.some((n) => inScope.has(n))).length /
          slotsInScope.length) *
          100,
      );
  const avgTenure = headcount === 0
    ? 0
    : people.reduce((acc, p) => acc + tenureYears(p.startDate), 0) / headcount;

  const kpis = [
    { id: "headcount",   label: "Headcount",            value: String(headcount) },
    { id: "nationalities", label: "Nationalities",      value: String(nationalities) },
    { id: "languages",   label: "Languages spoken",     value: String(languages) },
    { id: "skills",      label: "Hard skills tracked",  value: String(skills) },
    { id: "successor",   label: "Roles w/ ready-now",   value: `${readyNowPct}%` },
    { id: "tenure",      label: "Avg tenure (yrs)",     value: avgTenure.toFixed(1) },
  ];

  return (
    <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="composition-panel-kpi">
      {kpis.map((k) => (
        <Card key={k.id} className="p-4" data-testid={`composition-kpi-${k.id}`}>
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">{k.label}</div>
          <div className="mt-1 text-3xl font-light tracking-tight text-gold">{k.value}</div>
        </Card>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------
// Demographics
// ------------------------------------------------------------------

function DemographicsPanel({
  people, cohortHref,
}: {
  people: CompositionPerson[];
  cohortHref: (extra: Record<string, string>) => string;
}) {
  const [, navigate] = useLocation();
  const genderData = countBy(people, (p) => p.gender);
  const nationalityData = topN(
    countBy(people.filter((p) => p.nationality), (p) => p.nationality!),
    8,
  );
  const locationData = countBy(people, (p) => p.location);
  const tenureData = TENURE_BANDS.map((band) => ({
    name: band,
    value: people.filter((p) => tenureBand(tenureYears(p.startDate)) === band).length,
  }));

  return (
    <PanelCard
      title="Demographics"
      sub="Self-identified gender, nationality, location and tenure bands. Click any slice to open the directory pre-filtered to that cohort."
      testId="composition-panel-demographics"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <ChartFrame label="Gender distribution" empty={genderData.length === 0}>
          <PieChart>
            <Pie
              data={genderData}
              dataKey="value"
              nameKey="name"
              innerRadius={45}
              outerRadius={75}
              stroke="none"
              cursor="pointer"
              onClick={(d: { name?: string }) => {
                if (d?.name && d.name !== "unspecified") {
                  navigate(cohortHref({ gender: d.name }));
                }
              }}
            >
              {genderData.map((d) => (
                <Cell key={d.name} fill={GENDER_COLOR[d.name as CompositionGender] ?? "#5b5d63"} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => String(v).replace("_", "-")} />
            <Tooltip />
          </PieChart>
        </ChartFrame>

        <ChartFrame label="Nationality (top 8)" empty={nationalityData.length === 0}>
          <BarChart
            data={nationalityData}
            layout="vertical"
            margin={{ left: 20 }}
            onClick={(state: { activeLabel?: string }) => {
              const label = state?.activeLabel;
              if (label && label !== "Other") navigate(cohortHref({ nationality: label }));
            }}
          >
            <CartesianGrid horizontal={false} stroke="#2a2c33" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: "#9aa0a6" }}
                   tickFormatter={labelCountry} />
            <Tooltip cursor={{ fill: "#2a2c33" }} formatter={(v) => [`${v} people`, "Count"]} labelFormatter={labelCountry} />
            <Bar dataKey="value" fill="#c9a86a" radius={[0, 2, 2, 0]} cursor="pointer" />
          </BarChart>
        </ChartFrame>

        <ChartFrame label="Location" empty={locationData.length === 0}>
          <BarChart
            data={locationData}
            layout="vertical"
            margin={{ left: 20 }}
            onClick={(state: { activeLabel?: string }) => {
              const label = state?.activeLabel;
              if (label) {
                // Location strings look like "Dubai · AE" — extract ISO suffix.
                const iso = label.split("·").pop()?.trim();
                if (iso) navigate(cohortHref({ country: iso }));
              }
            }}
          >
            <CartesianGrid horizontal={false} stroke="#2a2c33" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <Tooltip cursor={{ fill: "#2a2c33" }} />
            <Bar dataKey="value" fill="#8aa7d6" radius={[0, 2, 2, 0]} cursor="pointer" />
          </BarChart>
        </ChartFrame>

        <ChartFrame label="Tenure bands" empty={tenureData.every((d) => d.value === 0)}>
          <BarChart data={tenureData}>
            <CartesianGrid vertical={false} stroke="#2a2c33" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <Tooltip cursor={{ fill: "#2a2c33" }} />
            <Bar dataKey="value" fill="#7ab7a6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartFrame>
      </div>
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Seniority & structure
// ------------------------------------------------------------------

function SeniorityStructurePanel({
  people, orgUnits, cohortHref,
}: {
  people: CompositionPerson[];
  orgUnits: ReturnType<typeof useOrgUnits>;
  cohortHref: (extra: Record<string, string>) => string;
}) {
  const [, navigate] = useLocation();
  const pyramid = SENIORITY_ORDER.map((level) => ({
    name: level,
    value: people.filter((p) => p.seniority === level).length,
  }));

  // Span of control — count of direct reports per manager.
  const reportsByMgr = new Map<string, number>();
  for (const p of people) {
    if (p.managerId) reportsByMgr.set(p.managerId, (reportsByMgr.get(p.managerId) ?? 0) + 1);
  }
  const managers = Array.from(reportsByMgr.entries())
    .map(([mgrId, n]) => ({ mgrId, n, name: people.find((x) => x.id === mgrId)?.fullName ?? mgrId }))
    .sort((a, b) => b.n - a.n);

  const buCounts = countBy(people, (p) => p.businessUnit);

  return (
    <PanelCard
      title="Seniority & structure"
      sub="Pyramid by level (clickable), span-of-control per manager, and headcount by business unit."
      testId="composition-panel-seniority"
    >
      <div className="grid gap-6 md:grid-cols-3">
        <ChartFrame label="Seniority pyramid" empty={pyramid.every((d) => d.value === 0)}>
          <BarChart
            data={[...pyramid].reverse()}
            layout="vertical"
            margin={{ left: 20 }}
            onClick={(state: { activeLabel?: string }) => {
              if (state?.activeLabel) navigate(cohortHref({ seniority: state.activeLabel }));
            }}
          >
            <CartesianGrid horizontal={false} stroke="#2a2c33" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <Tooltip cursor={{ fill: "#2a2c33" }} />
            <Bar dataKey="value" fill="#c9a86a" radius={[0, 2, 2, 0]} cursor="pointer" />
          </BarChart>
        </ChartFrame>

        <Card className="p-3 col-span-1">
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">Span of control</div>
          {managers.length === 0 ? (
            <EmptyNote>No reporting relationships in this slice.</EmptyNote>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {managers.map((m) => (
                <li key={m.mgrId} className="flex items-center justify-between">
                  <span className="text-text">{m.name}</span>
                  <MonoChip tone={m.n > 6 ? "amber" : "default"}>{m.n} reports</MonoChip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">By business unit</div>
          {buCounts.length === 0 ? (
            <EmptyNote>No data in this slice.</EmptyNote>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {buCounts.map((b) => {
                const ou = orgUnits.find((o) => o.name === b.name);
                return (
                  <li key={b.name} className="flex items-center justify-between">
                    <div>
                      <div className="text-text">{b.name}</div>
                      {ou && <div className="text-[10px] text-text-faint">head · {ou.headName}</div>}
                    </div>
                    <MonoChip>{b.value}</MonoChip>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Languages
// ------------------------------------------------------------------

function LanguagesPanel({ people, cohortHref }: {
  cohortHref: (extra: Record<string, string>) => string;
  people: CompositionPerson[];
}) {
  const [, navigate] = useLocation();
  type Row = { slug: string; label: string; basic: number; working: number; fluent: number; native: number; total: number };
  const map = new Map<string, Row>();
  for (const p of people) {
    for (const lang of p.languages) {
      const r = map.get(lang.slug) ?? { slug: lang.slug, label: lang.label, basic: 0, working: 0, fluent: 0, native: 0, total: 0 };
      r[lang.proficiency] += 1;
      r.total += 1;
      map.set(lang.slug, r);
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => b.total - a.total);
  const single = rows.filter((r) => r.total === 1);

  return (
    <PanelCard
      title="Languages"
      sub="Coverage matrix by proficiency band. Click a language row to open the directory pre-filtered to speakers of that language; rows where only one person speaks the language are flagged as a single point of failure."
      testId="composition-panel-languages"
    >
      {rows.length === 0 ? (
        <EmptyNote>No language coverage captured for this slice.</EmptyNote>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="font-mono text-[10px] uppercase text-text-faint">
                <tr>
                  <th className="text-left py-2">Language</th>
                  {PROFICIENCY_ORDER.map((p) => (
                    <th key={p} className="text-center px-2">{p}</th>
                  ))}
                  <th className="text-center px-2">Total</th>
                  <th className="text-center px-2">SPoF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.slug}
                    className="border-t border-border-soft cursor-pointer hover:bg-bg-elevate-2"
                    onClick={() => navigate(cohortHref({ language: r.slug }))}
                    data-testid={`language-row-${r.slug}`}
                  >
                    <td className="py-2 text-text">{r.label}</td>
                    {PROFICIENCY_ORDER.map((p) => (
                      <td key={p} className="text-center text-text-mute">
                        {r[p] > 0 ? (
                          <span
                            className="inline-block min-w-6 px-1.5 py-0.5 rounded font-mono text-[10px]"
                            style={{ backgroundColor: `${PROFICIENCY_COLOR[p]}33`, color: PROFICIENCY_COLOR[p] }}
                          >
                            {r[p]}
                          </span>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </td>
                    ))}
                    <td className="text-center font-mono text-text">{r.total}</td>
                    <td className="text-center">
                      {r.total === 1 && <MonoChip tone="amber">single</MonoChip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {single.length > 0 && (
            <p className="mt-3 text-[11px] text-text-mute">
              <span className="text-warn">⚠</span> {single.length}{" "}
              language{single.length === 1 ? "" : "s"} spoken by only one person:{" "}
              {single.map((s) => s.label).join(", ")}.
            </p>
          )}
        </>
      )}
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Hard skills
// ------------------------------------------------------------------

function HardSkillsPanel({
  people, skillGaps,
}: {
  people: CompositionPerson[];
  skillGaps: ReturnType<typeof useSkillGaps>;
}) {
  type Row = { slug: string; label: string; count: number; avgProficiency: number };
  const agg = new Map<string, { label: string; count: number; profSum: number }>();
  for (const p of people) {
    for (const s of p.hardSkills) {
      const cur = agg.get(s.slug) ?? { label: s.label, count: 0, profSum: 0 };
      cur.count += 1;
      cur.profSum += s.proficiency;
      agg.set(s.slug, cur);
    }
  }
  const rows: Row[] = Array.from(agg.entries())
    .map(([slug, v]) => ({ slug, label: v.label, count: v.count, avgProficiency: v.profSum / Math.max(1, v.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const inScopeSupplyBySlug = new Map<string, number>();
  for (const p of people) {
    for (const s of p.hardSkills) {
      inScopeSupplyBySlug.set(s.slug, (inScopeSupplyBySlug.get(s.slug) ?? 0) + 1);
      const k = s.label.toLowerCase();
      inScopeSupplyBySlug.set(k, (inScopeSupplyBySlug.get(k) ?? 0) + 1);
    }
  }
  const supplyVsDemand = skillGaps.map((g) => {
    const supply = inScopeSupplyBySlug.get(g.skill.toLowerCase()) ?? 0;
    return { name: g.skill, supply, demand: g.demandRoles, gap: g.demandRoles - supply };
  });

  return (
    <PanelCard
      title="Hard skills"
      sub="Top hard skills by people-count with average proficiency, plus in-scope supply vs role-demand. Both columns honour the active filters above; demand comes from the open-roles skill-gap report."
      testId="composition-panel-hard-skills"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">
            Top hard skills (people · avg proficiency)
          </div>
          {rows.length === 0 ? (
            <EmptyNote>No hard-skill data captured for this slice.</EmptyNote>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {rows.map((r) => (
                <li key={r.slug} className="flex items-center justify-between gap-3">
                  <span className="text-text truncate">{r.label}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <MonoChip>{r.count} ppl</MonoChip>
                    <span className="font-mono text-[10px] text-text-mute">p{r.avgProficiency.toFixed(1)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">
            In-scope supply vs open-role demand
          </div>
          <ChartFrame label="" empty={supplyVsDemand.length === 0}>
            <BarChart data={supplyVsDemand} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid horizontal={false} stroke="#2a2c33" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
              <Tooltip cursor={{ fill: "#2a2c33" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="supply" name="In-scope supply" fill="#8aa7d6" radius={[0, 2, 2, 0]} />
              <Bar dataKey="demand" name="Role demand" fill="#c9a86a" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ChartFrame>
        </div>
      </div>
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Soft skills
// ------------------------------------------------------------------

function SoftSkillsPanel({ people }: { people: CompositionPerson[] }) {
  const data = COMPOSITION_SOFT_SKILLS.map((tag) => ({
    name: tag, value: people.filter((p) => p.softSkills.includes(tag)).length,
  })).sort((a, b) => b.value - a.value);
  const single = data.filter((d) => d.value === 1);

  return (
    <PanelCard
      title="Soft skills"
      sub="Distribution of soft-skill tags across the team. Tags carried by only one person are flagged as a single point of failure."
      testId="composition-panel-soft-skills"
    >
      <ChartFrame label="" empty={data.every((d) => d.value === 0)}>
        <BarChart data={data}>
          <CartesianGrid vertical={false} stroke="#2a2c33" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9aa0a6" }} interval={0} angle={-12} textAnchor="end" height={60} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
          <Tooltip cursor={{ fill: "#2a2c33" }} />
          <Bar dataKey="value" fill="#a78bbb" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ChartFrame>
      {single.length > 0 && (
        <p className="mt-3 text-[11px] text-text-mute">
          <span className="text-warn">⚠</span> {single.length} soft-skill tag
          {single.length === 1 ? "" : "s"} held by only one person:{" "}
          {single.map((s) => s.name).join(", ")}.
        </p>
      )}
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Performance — review ratings, goal status, and 9-box (rating × potential).
//
// Review ratings come from `useReviews` filtered to the in-scope people
// (matched by name — names are unique in the snapshot). Goal status is
// the same intersection on `useGoals`. 9-box potential is derived from
// `useSuccession` per the task spec: a person is `ready_now` if they
// appear in any slot's `readyNow`, otherwise `ready_1y` / `ready_2_3y`,
// otherwise `not_yet`.
// ------------------------------------------------------------------

type Potential = "ready_now" | "ready_1y" | "ready_2_3y" | "not_yet";

function potentialFromSuccession(
  name: string,
  succession: ReturnType<typeof useSuccession>,
): Potential {
  for (const slot of succession) if (slot.readyNow.includes(name)) return "ready_now";
  for (const slot of succession) if (slot.readyOneYear.includes(name)) return "ready_1y";
  for (const slot of succession) if (slot.readyTwoToThreeYears.includes(name)) return "ready_2_3y";
  return "not_yet";
}

function PerformancePanel({
  people, inScopeNames, reviews, goals, succession,
}: {
  people: CompositionPerson[];
  inScopeNames: Set<string>;
  reviews: ReturnType<typeof useReviews>;
  goals: ReturnType<typeof useGoals>;
  succession: ReturnType<typeof useSuccession>;
}) {
  // Reviews intersected with in-scope people.
  const scopedReviews = reviews.filter((r) => inScopeNames.has(r.personName));
  const ratingBuckets = ["exceeds", "meets", "developing", "not-yet-rated"] as const;
  const ratingDist = ratingBuckets.map((b) => ({
    name: b,
    value: b === "not-yet-rated"
      ? scopedReviews.filter((r) => !r.managerRating).length
      : scopedReviews.filter((r) => r.managerRating === b).length,
  }));

  // Goals intersected with in-scope people.
  const scopedGoals = goals.filter((g) => inScopeNames.has(g.personName));
  const goalStatusOrder = ["on-track", "at-risk", "off-track", "complete"] as const;
  const goalDist = goalStatusOrder.map((s) => ({
    name: s,
    value: scopedGoals.filter((g) => g.status === s).length,
  }));

  // 9-box: rating × potential, both derived for scoped people.
  const perfRows: ("exceeds" | "meets" | "developing")[] = ["exceeds", "meets", "developing"];
  const potCols: Potential[] = ["ready_now", "ready_1y", "ready_2_3y", "not_yet"];
  const ratedReviews = scopedReviews.filter((r) => r.managerRating);
  const cell = (rating: string, pot: Potential) =>
    ratedReviews.filter(
      (r) => r.managerRating === rating && potentialFromSuccession(r.personName, succession) === pot,
    ).length;

  return (
    <PanelCard
      title="Performance"
      sub="Manager-rating distribution from reviews in the open cycle, goal-status mix and a rating × potential 9-box. Potential is derived live from succession readiness; everything is restricted to people in this slice."
      testId="composition-panel-performance"
    >
      <div className="grid gap-6 md:grid-cols-3">
        <ChartFrame label="Manager rating" empty={ratingDist.every((d) => d.value === 0)}>
          <BarChart data={ratingDist}>
            <CartesianGrid vertical={false} stroke="#2a2c33" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <Tooltip cursor={{ fill: "#2a2c33" }} />
            <Bar dataKey="value" fill="#c9a86a" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartFrame>

        <ChartFrame label="Goal status (cycle)" empty={goalDist.every((d) => d.value === 0)}>
          <BarChart data={goalDist}>
            <CartesianGrid vertical={false} stroke="#2a2c33" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <Tooltip cursor={{ fill: "#2a2c33" }} />
            <Bar dataKey="value" fill="#7ab7a6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartFrame>

        <Card className="p-3" data-testid="composition-9box">
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">9-box · rating × potential</div>
          <div className="grid grid-cols-5 gap-1 text-[10px]">
            <div></div>
            {potCols.map((c) => (
              <div key={c} className="text-center font-mono uppercase text-text-faint">{c.replace("_", " ")}</div>
            ))}
            {perfRows.map((row) => (
              <React.Fragment key={row}>
                <div className="font-mono uppercase text-text-faint text-right pr-1">{row}</div>
                {potCols.map((col) => {
                  const n = cell(row, col);
                  const intensity = n === 0 ? 0 : Math.min(0.85, 0.2 + n * 0.15);
                  return (
                    <div
                      key={col}
                      className="aspect-square flex items-center justify-center rounded text-text font-mono text-xs"
                      style={{ backgroundColor: n === 0 ? "#1a1c20" : `rgba(201,168,106,${intensity})` }}
                    >
                      {n || ""}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-text-faint">
            Reviews in scope: <span className="text-text-mute">{scopedReviews.length}</span> ·
            people in scope: <span className="text-text-mute">{people.length}</span>.
            Not-yet-rated rows excluded from the grid.
          </p>
        </Card>
      </div>
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Cross-cuts (heatmap)
// ------------------------------------------------------------------

const CROSS_CUTS = [
  { id: "gender_x_seniority", label: "Gender × seniority",
    rowKey: (p: CompositionPerson) => p.gender,
    colKey: (p: CompositionPerson) => p.seniority,
    rows: ["female", "male", "non_binary", "unspecified"] as string[],
    cols: SENIORITY_ORDER as readonly string[] },
  { id: "nationality_x_bu", label: "Nationality × business unit",
    rowKey: (p: CompositionPerson) => p.nationality ?? "—",
    colKey: (p: CompositionPerson) => p.businessUnit,
    rows: null as readonly string[] | null,
    cols: null as readonly string[] | null },
  { id: "language_x_location", label: "Language × location",
    rowKey: (p: CompositionPerson) => p.languages.map((l) => l.label),
    colKey: (p: CompositionPerson) => p.location,
    rows: null as readonly string[] | null,
    cols: null as readonly string[] | null },
] as const;

function CrossCutPanel({ people }: { people: CompositionPerson[] }) {
  const [active, setActive] = React.useState<typeof CROSS_CUTS[number]["id"]>("gender_x_seniority");
  const cut = CROSS_CUTS.find((c) => c.id === active)!;

  const rowSet = new Set<string>();
  const colSet = new Set<string>();
  const cell = new Map<string, number>();

  for (const p of people) {
    const rk = cut.rowKey(p);
    const ck = cut.colKey(p);
    const cks = Array.isArray(ck) ? ck : [ck];
    const rks = Array.isArray(rk) ? rk : [rk];
    for (const r of rks) {
      for (const c of cks) {
        rowSet.add(r); colSet.add(c);
        const k = `${r}\u0000${c}`;
        cell.set(k, (cell.get(k) ?? 0) + 1);
      }
    }
  }
  const rows = (cut.rows ?? Array.from(rowSet).sort()) as string[];
  const cols = (cut.cols ?? Array.from(colSet).sort()) as string[];
  const max = Math.max(1, ...Array.from(cell.values()));

  return (
    <PanelCard
      title="Cross-cuts"
      sub="Pivot two dimensions to spot uneven coverage. Three preset axes — full pivot UI is out of scope."
      testId="composition-panel-cross-cuts"
    >
      <div className="flex flex-wrap gap-2 mb-3">
        {CROSS_CUTS.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(c.id)}
            className={`px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-widest border ${
              active === c.id ? "bg-gold text-bg border-gold" : "border-border-soft text-text-mute hover:text-text"
            }`}
            data-testid={`crosscut-${c.id}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {rows.length === 0 || cols.length === 0 ? (
        <EmptyNote>No data to cross-cut in this slice.</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th></th>
                {cols.map((c) => (
                  <th key={c} className="px-2 py-1 font-mono text-[10px] uppercase text-text-faint text-left">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r}>
                  <td className="pr-3 py-1 font-mono text-[10px] uppercase text-text-faint whitespace-nowrap">
                    {r.replace("_", "-")}
                  </td>
                  {cols.map((c) => {
                    const n = cell.get(`${r}\u0000${c}`) ?? 0;
                    const intensity = n === 0 ? 0 : 0.15 + (n / max) * 0.7;
                    return (
                      <td key={c} className="px-1 py-1">
                        <div
                          className="w-10 h-7 rounded flex items-center justify-center font-mono text-text"
                          style={{ backgroundColor: n === 0 ? "#1a1c20" : `rgba(201,168,106,${intensity})` }}
                        >
                          {n || ""}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Data coverage strip
// ------------------------------------------------------------------

function DataCoverageStrip({ people }: { people: CompositionPerson[] }) {
  if (people.length === 0) {
    return null;
  }
  const total = people.length;
  const fields = [
    { id: "gender",      label: "Gender (self-identified)", filled: people.filter((p) => p.gender !== "unspecified").length },
    { id: "nationality", label: "Nationality",              filled: people.filter((p) => p.nationality).length },
    { id: "language",    label: "≥ 1 language captured",    filled: people.filter((p) => p.languages.length > 0).length },
    { id: "hardSkill",   label: "≥ 1 hard skill",            filled: people.filter((p) => p.hardSkills.length > 0).length },
    { id: "softSkill",   label: "≥ 1 soft-skill tag",        filled: people.filter((p) => p.softSkills.length > 0).length },
    { id: "rating",      label: "Manager rating set",        filled: people.filter((p) => p.performanceRating).length },
  ];

  return (
    <Card className="p-4" data-testid="composition-panel-data-coverage">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">Data coverage</span>
        <span className="text-[10px] text-text-mute">— per-field completeness across {total} people in view</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {fields.map((f) => {
          const pct = Math.round((f.filled / total) * 100);
          const tone: "green" | "amber" | "red" = pct >= 75 ? "green" : pct >= 40 ? "amber" : "red";
          return (
            <div key={f.id} data-testid={`coverage-${f.id}`}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-text-mute">{f.label}</span>
                <MonoChip tone={tone}>{pct}%</MonoChip>
              </div>
              <div className="mt-1 h-1.5 w-full bg-bg-deep rounded overflow-hidden">
                <div
                  className="h-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: tone === "green" ? "#7ab7a6" : tone === "amber" ? "#c9a86a" : "#bb8b8b",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Cross-links into the People directory and the CHRO overview.
// ------------------------------------------------------------------

function CrossLinks({ cohortHref }: { cohortHref: (extra: Record<string, string>) => string }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">Drill into</span>
        <Link href="/people/people" className="text-gold hover:underline">People directory →</Link>
        <Link href={cohortHref({ nationality: "EG" })} className="text-gold hover:underline" data-testid="link-egyptian-cohort">
          Egyptian nationals →
        </Link>
        <Link href={cohortHref({ gender: "female" })} className="text-gold hover:underline" data-testid="link-female-cohort">
          Female cohort →
        </Link>
        <Link href={cohortHref({ seniority: "Partner" })} className="text-gold hover:underline" data-testid="link-partner-cohort">
          Partners →
        </Link>
        <Link href="/people/perform" className="text-gold hover:underline">CHRO overview →</Link>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Small reusable bits
// ------------------------------------------------------------------

function PanelCard({
  title, sub, testId, children,
}: { title: string; sub?: string; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId}>
      <div className="mb-3">
        <h3 className="text-text font-semibold">{title}</h3>
        {sub && <p className="text-xs text-text-mute mt-1">{sub}</p>}
      </div>
      <Card className="p-4">{children}</Card>
    </section>
  );
}

function ChartFrame({
  label, children, empty, inline,
}: { label: string; children: React.ReactElement; empty?: boolean; inline?: boolean }) {
  return (
    <div className={inline ? "" : "space-y-2"}>
      {label && <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">{label}</div>}
      <div style={{ width: "100%", height: 220 }}>
        {empty ? (
          <div className="h-full flex items-center justify-center text-xs text-text-faint border border-dashed border-border-soft rounded">
            No data in this slice.
          </div>
        ) : (
          // ChartContainer wraps its child in a Recharts ResponsiveContainer
          // and applies the firm-wide chart CSS resets / theme hooks. We pass
          // an empty config because we set series colours inline via `fill=`.
          <ChartContainer config={EMPTY_CHART_CONFIG} className="aspect-auto h-full w-full">
            {children}
          </ChartContainer>
        )}
      </div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-text-faint italic">{children}</div>;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function uniqueSorted<T extends string>(xs: T[]): T[] {
  return Array.from(new Set(xs)).sort();
}

function countBy<T>(xs: T[], key: (x: T) => string): { name: string; value: number }[] {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function topN(rows: { name: string; value: number }[], n: number): { name: string; value: number }[] {
  if (rows.length <= n) return rows;
  const head = rows.slice(0, n - 1);
  const tail = rows.slice(n - 1);
  const other = tail.reduce((acc, r) => acc + r.value, 0);
  return [...head, { name: "Other", value: other }];
}
