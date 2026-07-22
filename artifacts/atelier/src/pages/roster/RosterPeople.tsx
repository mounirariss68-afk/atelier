import * as React from "react";
import { Link, useLocation } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { RecordCard } from "@/components/ui/record-card";
import { Input } from "@/components/ui/input";
import { Users, Filter, X } from "lucide-react";
import { countryName } from "@/lib/countries";

type WorkerType = "employee" | "contractor" | "partner_firm_resource";

interface PersonRow {
  id: string;
  workerType: WorkerType;
  fullName: string;
  email: string | null;
  role: string | null;
  seniority: string | null;
  title: string | null;
  country: string | null;
  status: string;
  partnerFirmName?: string | null;
  vendorEntity?: string | null;
  // Task #412 — surfaced so the directory can show cohort chips when a
  // composition deep-link narrows the listing (e.g. `?nationality=EG`).
  gender?: string | null;
  nationality?: string | null;
}

const WORKER_LABEL: Record<WorkerType, string> = {
  employee: "Employee",
  contractor: "Contractor",
  partner_firm_resource: "Partner-firm",
};

const WORKER_COLOR: Record<WorkerType, string> = {
  employee: "border-l-gold",
  contractor: "border-l-blue-500",
  partner_firm_resource: "border-l-purple-500",
};

// Task #412 — cohort filters drive the People directory from URL params.
// They round-trip through the API; chip strip below mirrors them so the
// user always sees what slice they're looking at and can clear it.
const COHORT_KEYS = ["nationality", "gender", "country", "seniority", "language"] as const;
type CohortKey = (typeof COHORT_KEYS)[number];

function readCohortFromUrl(): Record<CohortKey, string> {
  if (typeof window === "undefined") {
    return { nationality: "", gender: "", country: "", seniority: "", language: "" };
  }
  const sp = new URLSearchParams(window.location.search);
  return {
    nationality: sp.get("nationality") ?? "",
    gender: sp.get("gender") ?? "",
    country: sp.get("country") ?? "",
    seniority: sp.get("seniority") ?? "",
    language: sp.get("language") ?? "",
  };
}

const COHORT_LABEL: Record<CohortKey, string> = {
  nationality: "Nationality",
  gender: "Gender",
  country: "Location",
  seniority: "Seniority",
  language: "Language",
};

export default function RosterPeople() {
  const [, navigate] = useLocation();
  const [people, setPeople] = React.useState<PersonRow[] | null>(null);
  const [viewerScope, setViewerScope] = React.useState<"full" | "reports">("full");
  const [filter, setFilter] = React.useState<WorkerType | "all">(() => {
    if (typeof window === "undefined") return "all";
    const wt = new URLSearchParams(window.location.search).get("workerType");
    return (wt as WorkerType) ?? "all";
  });
  const [q, setQ] = React.useState("");
  const [cohort, setCohort] = React.useState<Record<CohortKey, string>>(readCohortFromUrl);

  /** Reflect filter state back into the URL so the slice is shareable
   *  and survives reloads. The directory + Composition dashboard share
   *  this contract. */
  const syncUrl = React.useCallback(
    (next: { filter?: WorkerType | "all"; cohort?: Record<CohortKey, string> }) => {
      const sp = new URLSearchParams();
      const wt = next.filter ?? filter;
      const co = next.cohort ?? cohort;
      if (wt !== "all") sp.set("workerType", wt);
      for (const k of COHORT_KEYS) {
        if (co[k]) sp.set(k, co[k]);
      }
      const qs = sp.toString();
      navigate(`/people/people${qs ? `?${qs}` : ""}`, { replace: true });
    },
    [filter, cohort, navigate],
  );

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("workerType", filter);
    if (q.trim()) params.set("q", q.trim());
    for (const k of COHORT_KEYS) {
      if (cohort[k]) params.set(k, cohort[k]);
    }
    fetch(`/api/atelier/roster/people?${params.toString()}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => {
        setPeople(d.people ?? []);
        // Task #221 — manager-scoped viewers see only their reports tree;
        // non-managers get an empty, explained state.
        setViewerScope(d.viewerScope === "reports" ? "reports" : "full");
      })
      .catch(() => setPeople([]));
  }, [filter, q, cohort]);

  const counts = React.useMemo(() => {
    const c = { all: 0, employee: 0, contractor: 0, partner_firm_resource: 0 };
    (people ?? []).forEach((p) => {
      c.all++;
      c[p.workerType]++;
    });
    return c;
  }, [people]);

  const activeChips = COHORT_KEYS.filter((k) => cohort[k]);

  return (
    <div>
      <PageHero>
        <SectionHead
          headline="The Roster — Firm-wide People"
          lede="Employees, contractors, and partner-firm seconded resources — one accessor, one access policy."
        />
      </PageHero>
      <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <div className="flex items-center gap-2 text-text-mute text-xs font-mono uppercase">
          <Filter className="w-3 h-3" /> Worker type
        </div>
        {(["all", "employee", "contractor", "partner_firm_resource"] as const).map(
          (v) => (
            <button
              key={v}
              onClick={() => {
                setFilter(v);
                syncUrl({ filter: v });
              }}
              className={`px-3 py-1 rounded text-xs font-mono border transition-colors ${
                filter === v
                  ? "bg-gold text-bg border-gold"
                  : "border-border text-text-mute hover:text-text"
              }`}
              data-testid={`filter-${v}`}
            >
              {v === "all" ? "All" : WORKER_LABEL[v]}{" "}
              <span className="opacity-60">({counts[v]})</span>
            </button>
          ),
        )}
        <div className="ml-auto flex items-center gap-3">
          {viewerScope === "full" && (
            // Task #387 — one-click print-ready card bundle (zip of PRINT-
            // variant PDFs for all active employees with card contact
            // fields). Server gates on full-roster view and audits.
            <a
              href="/api/atelier/roster/business-cards.zip"
              className="whitespace-nowrap px-3 py-1.5 rounded text-xs font-mono uppercase tracking-widest border border-border text-text-mute hover:text-text hover:border-gold transition-colors"
              data-testid="download-all-business-cards"
              title="Zip of print-ready business-card PDFs for all active employees"
            >
              Download all cards ↓
            </a>
          )}
          <div className="w-72">
            <Input
              placeholder="Search name, email, role…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="roster-search"
            />
          </div>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="cohort-chips">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            Cohort
          </span>
          {activeChips.map((k) => (
            <button
              key={k}
              onClick={() => {
                const next = { ...cohort, [k]: "" };
                setCohort(next);
                syncUrl({ cohort: next });
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-widest bg-gold/10 border border-gold/40 text-gold hover:bg-gold/20"
              data-testid={`cohort-chip-${k}`}
            >
              {COHORT_LABEL[k]}: {(k === "nationality" || k === "country") ? countryName(cohort[k]) : cohort[k]}
              <X className="w-3 h-3" />
            </button>
          ))}
          <button
            onClick={() => {
              const empty = { nationality: "", gender: "", country: "", seniority: "", language: "" };
              setCohort(empty);
              syncUrl({ cohort: empty });
            }}
            className="ml-1 text-[10px] font-mono uppercase tracking-widest text-text-mute hover:text-text"
            data-testid="cohort-clear-all"
          >
            Clear all
          </button>
        </div>
      )}

      {!people && <div className="py-12 text-text-mute">Loading…</div>}
      {people && people.length === 0 && (
        <Card className="p-8 mt-6 text-center text-text-mute" data-testid="roster-empty-state">
          <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
          {viewerScope === "reports"
            ? "You can see the people who report to you here. No direct or indirect reports are currently linked to your profile."
            : "No people match the current filter."}
        </Card>
      )}
      {people && people.length > 0 && viewerScope === "reports" && (
        <p className="mt-4 text-xs text-text-mute font-mono uppercase tracking-widest">
          Showing your reporting line only — business profile fields
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-6">
        {(people ?? []).map((p) => (
          <RecordCard
            key={p.id}
            href={`/roster/people/${p.id}`}
            accentClass={WORKER_COLOR[p.workerType]}
            title={p.fullName}
            subtitle={p.title}
            trailing={<MonoChip>{WORKER_LABEL[p.workerType]}</MonoChip>}
            chips={
              <>
                {p.seniority && <MonoChip>{p.seniority}</MonoChip>}
                {p.country && <MonoChip>{countryName(p.country)}</MonoChip>}
                {p.nationality && <MonoChip>nat · {countryName(p.nationality)}</MonoChip>}
                {p.partnerFirmName && <MonoChip>{p.partnerFirmName}</MonoChip>}
                {p.vendorEntity && <MonoChip>{p.vendorEntity}</MonoChip>}
                <MonoChip>{p.status}</MonoChip>
              </>
            }
            data-testid={`person-card-${p.id}`}
          >
            {p.email && (
              <div className="text-xs text-text-faint truncate">{p.email}</div>
            )}
          </RecordCard>
        ))}
      </div>
      </div>
    </div>
  );
}
