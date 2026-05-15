import * as React from "react";
import { Link, useLocation } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Users, Filter, X } from "lucide-react";
import { useCompositionPeople } from "@/pages/people/peopleSeed";

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
  const [filter, setFilter] = React.useState<WorkerType | "all">(() => {
    if (typeof window === "undefined") return "all";
    const wt = new URLSearchParams(window.location.search).get("workerType");
    return (wt as WorkerType) ?? "all";
  });
  const [q, setQ] = React.useState("");
  const [cohort, setCohort] = React.useState<Record<CohortKey, string>>(readCohortFromUrl);
  // Task #412 — language data lives in the People Lens snapshot, not the
  // roster API yet, so we intersect the API result by name on the client
  // when a `?language=<slug>` deep-link from the Composition dashboard is
  // active. Names match against the seeded composition snapshot.
  const compositionPeople = useCompositionPeople();
  const languageNameSet = React.useMemo(() => {
    if (!cohort.language) return null;
    const names = new Set<string>();
    for (const p of compositionPeople) {
      if (p.languages.some((l) => l.slug === cohort.language)) {
        names.add(p.fullName.trim().toLowerCase());
      }
    }
    return names;
  }, [cohort.language, compositionPeople]);

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
        const list: PersonRow[] = d.people ?? [];
        if (languageNameSet) {
          setPeople(list.filter((p) => languageNameSet.has(p.fullName.trim().toLowerCase())));
        } else {
          setPeople(list);
        }
      })
      .catch(() => setPeople([]));
  }, [filter, q, cohort, languageNameSet]);

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
    <div className="px-4 md:px-8 py-6 max-w-screen-2xl mx-auto">
      <PageHero>
        <SectionHead
          headline="The Roster — Firm-wide People"
          lede="Employees, contractors, and partner-firm seconded resources — one accessor, one access policy."
        />
      </PageHero>

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
        <div className="ml-auto w-72">
          <Input
            placeholder="Search name, email, role…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="roster-search"
          />
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
              {COHORT_LABEL[k]}: {cohort[k]}
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
        <Card className="p-8 mt-6 text-center text-text-mute">
          <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
          No people match the current filter.
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mt-6">
        {(people ?? []).map((p) => (
          <Link key={p.id} href={`/roster/people/${p.id}`} className="block">
              <Card
                className={`p-4 space-y-2 border-l-4 ${WORKER_COLOR[p.workerType]} hover:bg-bg-elevate-2 cursor-pointer transition-colors`}
                data-testid={`person-card-${p.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-text">{p.fullName}</div>
                    {p.title && (
                      <div className="text-xs text-text-mute">{p.title}</div>
                    )}
                  </div>
                  <MonoChip>{WORKER_LABEL[p.workerType]}</MonoChip>
                </div>
                <div className="flex flex-wrap gap-1 text-xs">
                  {p.seniority && <MonoChip>{p.seniority}</MonoChip>}
                  {p.country && <MonoChip>{p.country}</MonoChip>}
                  {p.nationality && <MonoChip>nat · {p.nationality}</MonoChip>}
                  {p.partnerFirmName && (
                    <MonoChip>{p.partnerFirmName}</MonoChip>
                  )}
                  {p.vendorEntity && <MonoChip>{p.vendorEntity}</MonoChip>}
                  <MonoChip>{p.status}</MonoChip>
                </div>
                {p.email && (
                  <div className="text-xs text-text-faint truncate">
                    {p.email}
                  </div>
                )}
              </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
