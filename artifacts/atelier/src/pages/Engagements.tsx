import { useAtelierListEngagements } from "@workspace/api-client-react";
import { SectionHead, Card, PlmPill, MonoChip } from "@/components/ui/primitives";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Clock, CheckCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function Engagements() {
  const { data: engagements, isLoading, isError } = useAtelierListEngagements();

  if (isLoading) {
    return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  }

  if (isError || !engagements) {
    return <div className="container-atelier py-12 text-danger">Failed to load engagements.</div>;
  }

  return (
    <div className="container-atelier py-12 space-y-8 animate-in fade-in">
      <SectionHead 
        headline="Active Engagements"
        lede="Ongoing delivery and compounding IP."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {engagements.map((eng) => (
          <Card key={eng.id} className="p-5 space-y-4 hover:border-gold/50 transition-colors group flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex justify-between items-start gap-2">
                <Link href={`/engagements/${eng.id}`} className="font-semibold text-lg text-text group-hover:text-gold transition-colors block leading-tight">
                  {eng.name}
                </Link>
              </div>
              <div className="text-sm text-text-mute font-mono">{eng.accountName}</div>
              
              <div className="flex flex-wrap gap-2 pt-1">
                <PlmPill stage={eng.plmStage} />
                <MonoChip tone={eng.raidStatus === 'red' ? 'red' : eng.raidStatus === 'amber' ? 'amber' : 'green'}>
                  RAID: {eng.raidStatus}
                </MonoChip>
              </div>
            </div>

            <div className="pt-4 border-t border-border-soft flex items-end justify-between">
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
          </Card>
        ))}

        {engagements.length === 0 && (
          <div className="col-span-full py-12 text-center text-text-mute font-mono border border-dashed border-border rounded-lg">
            No active engagements found.
          </div>
        )}
      </div>
    </div>
  );
}
