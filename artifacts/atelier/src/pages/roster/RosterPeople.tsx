import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Users, Filter } from "lucide-react";

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

export default function RosterPeople() {
  const [people, setPeople] = React.useState<PersonRow[] | null>(null);
  const [filter, setFilter] = React.useState<WorkerType | "all">("all");
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("workerType", filter);
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/atelier/roster/people?${params.toString()}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((d) => setPeople(d.people ?? []))
      .catch(() => setPeople([]));
  }, [filter, q]);

  const counts = React.useMemo(() => {
    const c = { all: 0, employee: 0, contractor: 0, partner_firm_resource: 0 };
    (people ?? []).forEach((p) => {
      c.all++;
      c[p.workerType]++;
    });
    return c;
  }, [people]);

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
              onClick={() => setFilter(v)}
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
