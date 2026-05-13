import * as React from "react";
import { Link } from "wouter";
import { Card, PageHero, SectionHead, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

interface DebriefRow {
  id: string;
  opportunityId: string;
  opportunityName: string;
  outcome: string;
  status: string;
  hiddenCompetitor: string | null;
  themeCount: number;
  dueAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export default function WinLossLibrary() {
  const [items, setItems] = React.useState<DebriefRow[] | null>(null);
  React.useEffect(() => {
    fetch("/api/atelier/win-loss/debriefs", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, []);
  if (!items)
    return (
      <div className="p-8">
        <Skeleton className="h-32 bg-bg-elevate" />
      </div>
    );
  return (
    <div className="p-6 md:p-10 space-y-6 max-w-6xl">
      <PageHero
        eyebrow="WIN/LOSS · LIBRARY"
        title="All debriefs"
        subtitle="Closed-deal Win/Loss debriefs across the firm."
      />
      <SectionHead title={`${items.length} debriefs`} />
      <div className="grid gap-3">
        {items.map((it) => (
          <Card key={it.id} className="p-4 hover:border-gold/50 transition-colors">
            <Link
              href={`/opportunities/${it.opportunityId}/win-loss`}
              className="flex flex-wrap gap-3 items-center justify-between"
            >
              <div className="space-y-1">
                <div className="font-medium text-text">{it.opportunityName}</div>
                <div className="flex gap-2 items-center text-xs">
                  <MonoChip>{it.outcome}</MonoChip>
                  <MonoChip>{it.status}</MonoChip>
                  {it.hiddenCompetitor && <MonoChip>vs {it.hiddenCompetitor}</MonoChip>}
                  <span className="text-text-faint">{it.themeCount} themes</span>
                </div>
              </div>
              <div className="text-xs text-text-mute font-mono">
                {it.approvedAt
                  ? `Approved ${new Date(it.approvedAt).toLocaleDateString()}`
                  : it.dueAt
                  ? `Due ${new Date(it.dueAt).toLocaleDateString()}`
                  : new Date(it.createdAt).toLocaleDateString()}
              </div>
            </Link>
          </Card>
        ))}
        {items.length === 0 && (
          <Card className="p-6 text-text-mute">
            No debriefs yet. They appear automatically when opps close.
          </Card>
        )}
      </div>
    </div>
  );
}
