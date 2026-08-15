// People Lens — Team Composition dashboard.
// Reads the live roster API (/api/atelier/roster/people) plus the bulk
// person-skills endpoint so every panel charts real captured data. Panels
// with no coverage yet show per-panel "not captured" notes; the coverage
// strip at the bottom tracks per-field fill rates so HR can chase gaps.
// Slice clicks deep-link to the People directory via roster cohort params.

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
import { countryName, countryCode } from "@/lib/countries";

// ------------------------------------------------------------------
// Wire types + data hooks (live roster API)
// ------------------------------------------------------------------

type WorkerKind = "employee" | "contractor" | "partner_firm_resource";
type Gender = "female" | "male" | "unspecified";
type LangProficiency = "basic" | "working" | "fluent" | "native";

interface RosterPersonWire {
  id: string;
  workerType: WorkerKind;
  fullName: string;
  seniority: string | null;
  country: string | null;
  status: string;
  startDate: string | null;
  gender: string;
  nationality: string | null;
}

interface PersonSkillWire {
  personType: "employee" | "contractor";
  personId: string;
  slug: string;
  name: string;
  kind: string; // tech | industry | function | language | tool | soft
  proficiency: number; // 1..5
}

interface CompositionRow {
  id: string;
  fullName: string;
  workerType: WorkerKind;
  seniority: string | null;
  country: string | null;
  nationality: string | null;
  gender: Gender;
  startDate: string | null;
  languages: { slug: string; label: string; proficiency: LangProficiency }[];
  hardSkills: { slug: string; label: string; proficiency: number }[];
  softSkills: { slug: string; label: string }[];
}

interface LoadState {
  rows: CompositionRow[] | null;
  error: string | null;
  /** Set when the roster loaded but the skill-graph fetch failed — skill-backed
   *  panels show an unavailable note instead of failing the whole page. */
  skillsError: string | null;
}

const GENDERS: readonly Gender[] = ["female", "male", "unspecified"];
const HARD_SKILL_KINDS = new Set(["tech", "industry", "function", "tool"]);

/** Map the skill graph's 1–5 proficiency onto the language band scale. */
function langBand(proficiency: number): LangProficiency {
  if (proficiency >= 5) return "native";
  if (proficiency >= 4) return "fluent";
  if (proficiency >= 3) return "working";
  return "basic";
}

function toGender(g: string | null | undefined): Gender {
  return (GENDERS as readonly string[]).includes(g ?? "")
    ? (g as Gender)
    : "unspecified";
}

/** Fetch the live roster + bulk person-skills and join them client-side. */
function useCompositionData(): LoadState {
  const [state, setState] = React.useState<LoadState>({ rows: null, error: null, skillsError: null });
  React.useEffect(() => {
    let cancelled = false;
    // The two fetches fail independently: a roster failure blocks the page
    // (nothing can render without it), but a skills failure only degrades
    // the language/skill panels — demographics still chart.
    Promise.allSettled([
      // Task #1171 — composition analytics cover internal workers only;
      // partner-firm contacts are not part of our workforce.
      fetch("/api/atelier/roster/people?workerType=internal", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(`roster fetch failed (${r.status})`);
        return r.json() as Promise<{ people?: RosterPersonWire[] }>;
      }),
      fetch("/api/atelier/roster/skill-graph/person-skills", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(`skills fetch failed (${r.status})`);
        return r.json() as Promise<{ personSkills?: PersonSkillWire[] }>;
      }),
    ])
      .then(([peopleSettled, skillsSettled]) => {
        if (cancelled) return;
        if (peopleSettled.status === "rejected") {
          setState({ rows: null, error: String(peopleSettled.reason), skillsError: null });
          return;
        }
        const peopleRes = peopleSettled.value;
        const skillsError =
          skillsSettled.status === "rejected" ? String(skillsSettled.reason) : null;
        const skillsByPerson = new Map<string, PersonSkillWire[]>();
        if (skillsSettled.status === "fulfilled") {
          for (const s of skillsSettled.value.personSkills ?? []) {
            const list = skillsByPerson.get(s.personId) ?? [];
            list.push(s);
            skillsByPerson.set(s.personId, list);
          }
        }
        const rows: CompositionRow[] = (peopleRes.people ?? [])
          .filter((p) => p.status === "active")
          .map((p) => {
            const skills = skillsByPerson.get(p.id) ?? [];
            return {
              id: p.id,
              fullName: p.fullName,
              workerType: p.workerType,
              seniority: p.seniority,
              country: p.country ? p.country.toUpperCase() : null,
              nationality: p.nationality ? p.nationality.toUpperCase() : null,
              gender: toGender(p.gender),
              startDate: p.startDate,
              languages: skills
                .filter((s) => s.kind === "language")
                .map((s) => ({ slug: s.slug, label: s.name, proficiency: langBand(s.proficiency) })),
              hardSkills: skills
                .filter((s) => HARD_SKILL_KINDS.has(s.kind))
                .map((s) => ({ slug: s.slug, label: s.name, proficiency: s.proficiency })),
              softSkills: skills
                .filter((s) => s.kind === "soft")
                .map((s) => ({ slug: s.slug, label: s.name })),
            };
          });
        setState({ rows, error: null, skillsError });
      })
      .catch((e) => {
        if (!cancelled) setState({ rows: null, error: String(e), skillsError: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

// ------------------------------------------------------------------
// Filters
// ------------------------------------------------------------------

interface CompositionFilters {
  country: string | "all";
  seniority: string | "all";
  workerType: WorkerKind | "all";
}

const ALL_FILTERS: CompositionFilters = { country: "all", seniority: "all", workerType: "all" };

function applyFilters(rows: CompositionRow[], f: CompositionFilters): CompositionRow[] {
  return rows.filter((r) =>
    (f.country === "all" || r.country === f.country) &&
    (f.seniority === "all" || r.seniority === f.seniority) &&
    (f.workerType === "all" || r.workerType === f.workerType)
  );
}

// ------------------------------------------------------------------
// Palette + labels
// ------------------------------------------------------------------

const GENDER_COLOR: Record<Gender, string> = {
  female: "#c9a86a",
  male: "#8aa7d6",
  unspecified: "#5b5d63",
};

const PROFICIENCY_ORDER: LangProficiency[] = ["basic", "working", "fluent", "native"];
const PROFICIENCY_COLOR: Record<LangProficiency, string> = {
  basic:   "#5b5d63",
  working: "#8aa7d6",
  fluent:  "#c9a86a",
  native:  "#7ab7a6",
};

const WORKER_LABEL: Record<WorkerKind, string> = {
  employee: "Employee",
  contractor: "Contractor",
  partner_firm_resource: "Partner-firm",
};

// Task #509 — country labels come from the shared all-countries reference.
const labelCountry = (iso: string) => countryName(iso);

function tenureYears(startDate: string): number {
  const start = new Date(startDate).getTime();
  return Math.max(0, (Date.now() - start) / (365.25 * 24 * 3600 * 1000));
}
function tenureBand(y: number): string {
  if (y < 1) return "< 1 yr";
  if (y < 3) return "1–3 yrs";
  if (y < 6) return "3–6 yrs";
  if (y < 10) return "6–10 yrs";
  return "10+ yrs";
}
const TENURE_BANDS = ["< 1 yr", "1–3 yrs", "3–6 yrs", "6–10 yrs", "10+ yrs"];

const EMPTY_CHART_CONFIG = {} satisfies ChartConfig;

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function PeopleComposition() {
  const { rows: allPeople, error, skillsError } = useCompositionData();
  const [filters, setFilters] = React.useState<CompositionFilters>(ALL_FILTERS);
  const filtered = React.useMemo(
    () => applyFilters(allPeople ?? [], filters),
    [allPeople, filters],
  );

  /** Build a directory deep-link URL combining panel-clicked cohort params
   *  with the dashboard filter bar, so the directory shows the same slice. */
  const cohortHref = React.useCallback(
    (extra: Partial<Record<"nationality" | "gender" | "country" | "seniority" | "language", string>>) => {
      const sp = new URLSearchParams();
      if (filters.workerType !== "all") sp.set("workerType", filters.workerType);
      if (filters.seniority !== "all") sp.set("seniority", filters.seniority);
      if (filters.country !== "all") sp.set("country", filters.country);
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
        lede="A live view of the active roster's makeup: demographics, languages, skills, seniority and tenure — read straight from the roster records HR maintains. Filters apply to every panel; panels note when a field hasn't been captured yet."
      />

      <div className="container-atelier py-6 space-y-6" data-testid="page-composition">
        {error ? (
          <Card className="p-6 text-sm text-warn" data-testid="composition-error">
            Couldn't load the roster: {error}
          </Card>
        ) : allPeople === null ? (
          <Card className="p-6 text-sm text-text-mute" data-testid="composition-loading">
            Loading roster…
          </Card>
        ) : allPeople.length === 0 ? (
          <PeopleEmptyState message="No active people on the roster yet. Demographic, language and skill breakdowns will appear here as HR adds people and captures those fields." />
        ) : (
          <>
            <FilterBar people={allPeople} filters={filters} onChange={setFilters} />
            <KpiStrip people={filtered} />
            <DemographicsPanel people={filtered} cohortHref={cohortHref} />
            <SeniorityStructurePanel people={filtered} cohortHref={cohortHref} />
            <LanguagesPanel people={filtered} cohortHref={cohortHref} skillsError={skillsError} />
            <SkillsPanel people={filtered} skillsError={skillsError} />
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
// Filter bar
// ------------------------------------------------------------------

function FilterBar({
  people, filters, onChange,
}: {
  people: CompositionRow[];
  filters: CompositionFilters;
  onChange: (f: CompositionFilters) => void;
}) {
  const countries = uniqueSorted(people.map((p) => p.country).filter(Boolean) as string[]);
  const seniorities = uniqueSorted(people.map((p) => p.seniority).filter(Boolean) as string[]);
  const set = (k: keyof CompositionFilters, v: string) =>
    onChange({ ...filters, [k]: v as never });

  return (
    <Card className="p-4" data-testid="composition-filters">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-mono uppercase tracking-widest text-text-mute">Filters</span>
        <Select label="Location" value={filters.country} onChange={(v) => set("country", v)}
          options={[{ value: "all", label: "All" }, ...countries.map((c) => ({ value: c, label: labelCountry(c) }))]}
          testId="filter-location" />
        <Select label="Seniority" value={filters.seniority} onChange={(v) => set("seniority", v)}
          options={[{ value: "all", label: "All" }, ...seniorities.map((s) => ({ value: s, label: s }))]}
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
// KPI strip
// ------------------------------------------------------------------

function KpiStrip({ people }: { people: CompositionRow[] }) {
  const headcount = people.length;
  const nationalities = new Set(people.map((p) => p.nationality).filter(Boolean) as string[]).size;
  const languages = new Set(people.flatMap((p) => p.languages.map((l) => l.slug))).size;
  const skills = new Set(people.flatMap((p) => p.hardSkills.map((s) => s.slug))).size;
  const withStart = people.filter((p) => p.startDate);
  const avgTenure = withStart.length === 0
    ? null
    : withStart.reduce((acc, p) => acc + tenureYears(p.startDate!), 0) / withStart.length;
  const genderCaptured = headcount === 0
    ? 0
    : Math.round((people.filter((p) => p.gender !== "unspecified").length / headcount) * 100);

  const kpis = [
    { id: "headcount",     label: "Headcount (active)",   value: String(headcount) },
    { id: "nationalities", label: "Nationalities",        value: String(nationalities) },
    { id: "languages",     label: "Languages spoken",     value: String(languages) },
    { id: "skills",        label: "Hard skills tracked",  value: String(skills) },
    { id: "gender",        label: "Gender captured",      value: `${genderCaptured}%` },
    { id: "tenure",        label: "Avg tenure (yrs)",     value: avgTenure === null ? "—" : avgTenure.toFixed(1) },
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
  people: CompositionRow[];
  cohortHref: (extra: Record<string, string>) => string;
}) {
  const [, navigate] = useLocation();
  const genderData = countBy(
    people.filter((p) => p.gender !== "unspecified"),
    (p) => p.gender,
  );
  const unspecifiedCount = people.filter((p) => p.gender === "unspecified").length;
  const nationalityData = topN(
    countBy(people.filter((p) => p.nationality), (p) => p.nationality!),
    8,
  );
  const locationData = countBy(
    people.filter((p) => p.country),
    (p) => labelCountry(p.country!),
  );
  const withStart = people.filter((p) => p.startDate);
  const tenureData = TENURE_BANDS.map((band) => ({
    name: band,
    value: withStart.filter((p) => tenureBand(tenureYears(p.startDate!)) === band).length,
  }));

  return (
    <PanelCard
      title="Demographics"
      sub="Self-identified gender, nationality, location and tenure bands from the roster. Click any slice to open the directory pre-filtered to that cohort."
      testId="composition-panel-demographics"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <ChartFrame
          label="Gender distribution"
          empty={genderData.length === 0}
          emptyNote="Gender not captured for anyone in this slice yet — HR can record it on each person's profile."
        >
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
                if (d?.name) navigate(cohortHref({ gender: d.name }));
              }}
            >
              {genderData.map((d) => (
                <Cell key={d.name} fill={GENDER_COLOR[d.name as Gender] ?? "#5b5d63"} />
              ))}
            </Pie>
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => String(v).replace("_", "-")} />
            <Tooltip />
          </PieChart>
        </ChartFrame>

        <ChartFrame
          label={nationalityData.some((d) => d.name === "Other") ? "Nationality (top 8 + other)" : "Nationality"}
          empty={nationalityData.length === 0}
          emptyNote="Nationality not captured for anyone in this slice yet — HR can record it on each person's profile."
        >
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

        <ChartFrame
          label="Location"
          empty={locationData.length === 0}
          emptyNote="No location (country) captured for anyone in this slice yet."
        >
          <BarChart
            data={locationData}
            layout="vertical"
            margin={{ left: 20 }}
            onClick={(state: { activeLabel?: string }) => {
              const label = state?.activeLabel;
              if (label) {
                const iso = countryCode(label) ?? label;
                navigate(cohortHref({ country: iso }));
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

        <ChartFrame
          label="Tenure bands"
          empty={tenureData.every((d) => d.value === 0)}
          emptyNote="No start dates captured for anyone in this slice yet, so tenure can't be derived."
        >
          <BarChart data={tenureData}>
            <CartesianGrid vertical={false} stroke="#2a2c33" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <Tooltip cursor={{ fill: "#2a2c33" }} />
            <Bar dataKey="value" fill="#7ab7a6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartFrame>
      </div>
      {unspecifiedCount > 0 && genderData.length > 0 && (
        <p className="mt-3 text-[11px] text-text-mute" data-testid="gender-unspecified-note">
          {unspecifiedCount} {unspecifiedCount === 1 ? "person hasn't" : "people haven't"}{" "}
          had gender captured yet; they're excluded from the gender chart.
        </p>
      )}
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Seniority & structure
// ------------------------------------------------------------------

function SeniorityStructurePanel({
  people, cohortHref,
}: {
  people: CompositionRow[];
  cohortHref: (extra: Record<string, string>) => string;
}) {
  const [, navigate] = useLocation();
  const seniorities = uniqueSorted(people.map((p) => p.seniority).filter(Boolean) as string[]);
  const pyramid = seniorities.map((level) => ({
    name: level,
    value: people.filter((p) => p.seniority === level).length,
  })).sort((a, b) => b.value - a.value);
  const noSeniority = people.filter((p) => !p.seniority).length;
  const workerTypeCounts = countBy(people, (p) => WORKER_LABEL[p.workerType]);

  return (
    <PanelCard
      title="Seniority & structure"
      sub="Headcount by seniority level (clickable) and by worker type. Contractors don't carry a seniority level."
      testId="composition-panel-seniority"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <ChartFrame
          label="By seniority"
          empty={pyramid.length === 0}
          emptyNote="No seniority levels captured for anyone in this slice yet."
        >
          <BarChart
            data={pyramid}
            layout="vertical"
            margin={{ left: 20 }}
            onClick={(state: { activeLabel?: string }) => {
              if (state?.activeLabel) navigate(cohortHref({ seniority: state.activeLabel }));
            }}
          >
            <CartesianGrid horizontal={false} stroke="#2a2c33" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: "#9aa0a6" }} />
            <Tooltip cursor={{ fill: "#2a2c33" }} />
            <Bar dataKey="value" fill="#c9a86a" radius={[0, 2, 2, 0]} cursor="pointer" />
          </BarChart>
        </ChartFrame>

        <Card className="p-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">By worker type</div>
          {workerTypeCounts.length === 0 ? (
            <EmptyNote>No people in this slice.</EmptyNote>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {workerTypeCounts.map((b) => (
                <li key={b.name} className="flex items-center justify-between">
                  <span className="text-text">{b.name}</span>
                  <MonoChip>{b.value}</MonoChip>
                </li>
              ))}
            </ul>
          )}
          {noSeniority > 0 && (
            <p className="mt-3 text-[10px] text-text-faint">
              {noSeniority} {noSeniority === 1 ? "person has" : "people have"} no seniority level on file.
            </p>
          )}
        </Card>
      </div>
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Languages — read from the skill graph (skills with kind = "language").
// ------------------------------------------------------------------

function LanguagesPanel({ people, cohortHref, skillsError }: {
  cohortHref: (extra: Record<string, string>) => string;
  people: CompositionRow[];
  skillsError: string | null;
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
      sub="Language coverage from the skill graph (skills recorded with kind “language” on each person's profile). Rows where only one person speaks the language are flagged as a single point of failure."
      testId="composition-panel-languages"
    >
      {skillsError ? (
        <EmptyNote>
          Couldn't load language data from the skill graph right now ({skillsError}).
          Reload the page to retry — the roster panels above are unaffected.
        </EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote>
          No languages captured yet for this slice. Languages live in the skill
          graph — add a “language” skill on a person's roster profile (Skills
          tab) and it will chart here.
        </EmptyNote>
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
// Skills (hard + soft, both from the skill graph)
// ------------------------------------------------------------------

function SkillsPanel({ people, skillsError }: { people: CompositionRow[]; skillsError: string | null }) {
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
  const hardRows: Row[] = Array.from(agg.entries())
    .map(([slug, v]) => ({ slug, label: v.label, count: v.count, avgProficiency: v.profSum / Math.max(1, v.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const softAgg = new Map<string, { label: string; count: number }>();
  for (const p of people) {
    for (const s of p.softSkills) {
      const cur = softAgg.get(s.slug) ?? { label: s.label, count: 0 };
      cur.count += 1;
      softAgg.set(s.slug, cur);
    }
  }
  const softRows = Array.from(softAgg.values()).sort((a, b) => b.count - a.count);
  const softSingle = softRows.filter((r) => r.count === 1);

  return (
    <PanelCard
      title="Skills"
      sub="Hard skills (tech / function / industry / tool) with people-count and average proficiency, plus soft-skill tag distribution — both from the verified skill graph, honouring the filters above."
      testId="composition-panel-hard-skills"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">
            Top hard skills (people · avg proficiency)
          </div>
          {skillsError ? (
            <EmptyNote>
              Couldn't load skill data right now ({skillsError}). Reload the
              page to retry.
            </EmptyNote>
          ) : hardRows.length === 0 ? (
            <EmptyNote>
              No hard skills captured yet for this slice. Add tech / function /
              industry / tool skills on a person's roster profile.
            </EmptyNote>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {hardRows.map((r) => (
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

        <div data-testid="composition-panel-soft-skills">
          <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-2">
            Soft-skill tags
          </div>
          {skillsError ? (
            <EmptyNote>
              Couldn't load skill data right now ({skillsError}). Reload the
              page to retry.
            </EmptyNote>
          ) : softRows.length === 0 ? (
            <EmptyNote>
              No soft-skill tags captured yet for this slice. Add “soft” skills
              on a person's roster profile and they'll aggregate here.
            </EmptyNote>
          ) : (
            <>
              <ul className="space-y-1.5 text-xs">
                {softRows.slice(0, 20).map((r) => (
                  <li key={r.label} className="flex items-center justify-between gap-3">
                    <span className="text-text truncate">{r.label}</span>
                    <MonoChip>{r.count} ppl</MonoChip>
                  </li>
                ))}
              </ul>
              {softSingle.length > 0 && (
                <p className="mt-3 text-[11px] text-text-mute">
                  <span className="text-warn">⚠</span> {softSingle.length} soft-skill tag
                  {softSingle.length === 1 ? "" : "s"} held by only one person:{" "}
                  {softSingle.map((s) => s.label).join(", ")}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </PanelCard>
  );
}

// ------------------------------------------------------------------
// Cross-cuts (heatmap)
// ------------------------------------------------------------------

const CROSS_CUTS = [
  { id: "gender_x_seniority", label: "Gender × seniority",
    rowKey: (p: CompositionRow) => p.gender,
    colKey: (p: CompositionRow) => p.seniority ?? "—" },
  { id: "nationality_x_worker_type", label: "Nationality × worker type",
    rowKey: (p: CompositionRow) => p.nationality ?? "—",
    colKey: (p: CompositionRow) => WORKER_LABEL[p.workerType] },
  { id: "language_x_location", label: "Language × location",
    rowKey: (p: CompositionRow) => p.languages.map((l) => l.label),
    colKey: (p: CompositionRow) => (p.country ? labelCountry(p.country) : "—") },
] as const;

function CrossCutPanel({ people }: { people: CompositionRow[] }) {
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
  const rows = Array.from(rowSet).sort();
  const cols = Array.from(colSet).sort();
  const max = Math.max(1, ...Array.from(cell.values()));

  return (
    <PanelCard
      title="Cross-cuts"
      sub="Pivot two dimensions to spot uneven coverage. Three preset axes — full pivot UI is out of scope. “—” marks people missing that field."
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
        <EmptyNote>Nothing captured yet for these two dimensions in this slice.</EmptyNote>
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
// Data coverage strip — real per-field fill rates from the roster.
// ------------------------------------------------------------------

function DataCoverageStrip({ people }: { people: CompositionRow[] }) {
  if (people.length === 0) {
    return null;
  }
  const total = people.length;
  const fields = [
    { id: "gender",      label: "Gender (self-identified)", filled: people.filter((p) => p.gender !== "unspecified").length },
    { id: "nationality", label: "Nationality",              filled: people.filter((p) => p.nationality).length },
    { id: "startDate",   label: "Start date",               filled: people.filter((p) => p.startDate).length },
    { id: "language",    label: "≥ 1 language captured",    filled: people.filter((p) => p.languages.length > 0).length },
    { id: "hardSkill",   label: "≥ 1 hard skill",            filled: people.filter((p) => p.hardSkills.length > 0).length },
    { id: "softSkill",   label: "≥ 1 soft-skill tag",        filled: people.filter((p) => p.softSkills.length > 0).length },
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
// Cross-links into the People directory.
// ------------------------------------------------------------------

function CrossLinks({ cohortHref }: { cohortHref: (extra: Record<string, string>) => string }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">Drill into</span>
        <Link href="/people/people" className="text-gold hover:underline">People directory →</Link>
        <Link href={cohortHref({ gender: "female" })} className="text-gold hover:underline" data-testid="link-female-cohort">
          Female cohort →
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
  label, children, empty, emptyNote,
}: { label: string; children: React.ReactElement; empty?: boolean; emptyNote?: string }) {
  return (
    <div className="space-y-2">
      {label && <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">{label}</div>}
      <div style={{ width: "100%", height: 220 }}>
        {empty ? (
          <div className="h-full flex items-center justify-center text-center text-xs text-text-faint border border-dashed border-border-soft rounded px-6">
            {emptyNote ?? "No data in this slice."}
          </div>
        ) : (
          <ChartContainer config={EMPTY_CHART_CONFIG} className="aspect-auto h-full w-full">
            {children}
          </ChartContainer>
        )}
      </div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-6 px-4 text-center text-xs text-text-faint border border-dashed border-border-soft rounded">
      {children}
    </div>
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function countBy<T>(rows: T[], key: (r: T) => string): { name: string; value: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function topN(data: { name: string; value: number }[], n: number): { name: string; value: number }[] {
  if (data.length <= n) return data;
  const head = data.slice(0, n);
  const rest = data.slice(n).reduce((acc, d) => acc + d.value, 0);
  return [...head, { name: "Other", value: rest }];
}
