import * as React from "react";
import { useAtelierListEngagements, getAtelierListEngagementsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PlmPill, MonoChip, PillButton } from "@/components/ui/primitives";
import { RecordCard } from "@/components/ui/record-card";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, CheckCircle, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const RAID_FILTERS = ["all", "red", "amber", "green"] as const;
type RaidFilter = (typeof RAID_FILTERS)[number];
const PAGE_SIZE = 9;

export default function Engagements() {
  const qc = useQueryClient();
  const { data: engagements, isLoading, isError } = useAtelierListEngagements();

  const [query, setQuery] = React.useState("");
  const [raidFilter, setRaidFilter] = React.useState<RaidFilter>("all");
  const [page, setPage] = React.useState(1);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (engagements ?? []).filter((eng) => {
      if (raidFilter !== "all" && eng.raidStatus !== raidFilter) return false;
      if (!q) return true;
      return (
        eng.name.toLowerCase().includes(q) ||
        eng.accountName.toLowerCase().includes(q)
      );
    });
  }, [engagements, query, raidFilter]);

  // Reset to the first page whenever the active filters change so the
  // user never lands on an out-of-range (empty) page.
  React.useEffect(() => {
    setPage(1);
  }, [query, raidFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (isLoading) {
    return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  }

  if (isError || !engagements) {
    return (
      <div className="container-atelier py-12 flex flex-col items-center gap-4 text-center">
        <p className="text-danger font-mono">Failed to load engagements.</p>
        <PillButton
          variant="primary"
          onClick={() => qc.invalidateQueries({ queryKey: getAtelierListEngagementsQueryKey() })}
        >
          Retry
        </PillButton>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        headline="Active Engagements"
        lede="Ongoing delivery and compounding IP."
      />

      <div className="container-atelier pt-8 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-text-mute absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or account…"
            className="w-full bg-bg-elevate border border-border rounded-md pl-9 pr-3 py-2 text-sm text-text"
            data-testid="input-engagement-search"
          />
        </div>
        <div className="flex items-center gap-2">
          {RAID_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setRaidFilter(f)}
              className={`text-xs font-mono uppercase px-3 py-1.5 rounded-md border transition-colors ${
                raidFilter === f
                  ? "border-gold text-gold bg-gold/10"
                  : "border-border text-text-mute hover:text-text"
              }`}
              data-testid={`filter-raid-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="container-atelier py-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {paged.map((eng) => (
          <RecordCard
            key={eng.id}
            href={`/clients/deliver/engagements/${eng.id}`}
            title={eng.name}
            subtitle={<span className="font-mono">{eng.accountName}</span>}
            chips={
              <>
                <PlmPill stage={eng.plmStage} />
                <MonoChip tone={eng.raidStatus === 'red' ? 'red' : eng.raidStatus === 'amber' ? 'amber' : 'green'}>
                  RAID: {eng.raidStatus}
                </MonoChip>
              </>
            }
            footer={
              <div className="flex items-end justify-between pt-2">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs font-mono text-text-mute">
                    <Clock className="w-3.5 h-3.5" />
                    Due this week: <span className="text-text">{eng.deliverablesDueThisWeek}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono text-text-mute">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Ends {new Date(eng.plannedEndDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric'})}
                  </div>
                </div>

                <div className="flex -space-x-2">
                  <Avatar className="w-8 h-8 border-2 border-bg-elevate" title={eng.partnerOwnerName}>
                    <AvatarFallback className="text-xs bg-bg-deep text-gold">
                      {eng.partnerOwnerName.split(' ').map(n=>n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <Avatar className="w-8 h-8 border-2 border-bg-elevate" title={eng.engagementLeadName}>
                    <AvatarFallback className="text-xs bg-bg-deep text-text-mute">
                      {eng.engagementLeadName.split(' ').map(n=>n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </div>
            }
          />
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-text-mute font-mono border border-dashed border-border rounded-lg">
            {engagements.length === 0
              ? "No active engagements found."
              : "No engagements match your search."}
          </div>
        )}
      </div>

      {pageCount > 1 && (
        <div className="container-atelier pb-12 flex items-center justify-center gap-3">
          <PillButton
            variant="ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            data-testid="btn-prev-page"
          >
            ← Prev
          </PillButton>
          <span className="text-xs font-mono text-text-mute">
            Page {safePage} of {pageCount}
          </span>
          <PillButton
            variant="ghost"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            data-testid="btn-next-page"
          >
            Next →
          </PillButton>
        </div>
      )}
    </div>
  );
}
