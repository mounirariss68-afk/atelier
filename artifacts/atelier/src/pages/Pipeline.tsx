import { useState } from "react";
import { useAtelierListOpportunities } from "@workspace/api-client-react";
import { SectionHead, Card, PlmPill, PillButton } from "@/components/ui/primitives";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutGrid, List as ListIcon, AlertTriangle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const PLM_STAGES = ['identify', 'shape', 'pursue', 'won', 'lost', 'no_go'] as const;

export default function Pipeline() {
  const { data: opps, isLoading } = useAtelierListOpportunities();
  const [view, setView] = useState<'kanban' | 'table'>('kanban');

  if (isLoading) {
    return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  }

  return (
    <div className="container-atelier py-12 space-y-8 flex flex-col h-full min-h-[calc(100vh-3.5rem)]">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <SectionHead 
          headline="Opportunity Pipeline"
          lede="Active originations and pursuits."
        />
        <div className="flex items-center gap-2 bg-bg-elevate p-1 rounded-full border border-border shrink-0">
          <button 
            onClick={() => setView('kanban')}
            className={`p-2 rounded-full transition-colors ${view === 'kanban' ? 'bg-bg-deep text-gold' : 'text-text-mute hover:text-text'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setView('table')}
            className={`p-2 rounded-full transition-colors ${view === 'table' ? 'bg-bg-deep text-gold' : 'text-text-mute hover:text-text'}`}
          >
            <ListIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {view === 'kanban' ? (
        <div className="flex-1 flex gap-6 overflow-x-auto pb-6 snap-x">
          {PLM_STAGES.map(stage => {
            const stageOpps = opps?.filter(o => o.plmStage === stage) || [];
            return (
              <div key={stage} className="min-w-[320px] w-[320px] shrink-0 flex flex-col gap-4 snap-start">
                <div className="flex items-center justify-between pb-2 border-b border-gold/30">
                  <span className="font-mono text-sm tracking-widest uppercase text-text-mute">{stage.replace('_', ' ')}</span>
                  <span className="font-mono text-xs text-text-faint">{stageOpps.length}</span>
                </div>
                <div className="flex flex-col gap-4">
                  {stageOpps.map(opp => (
                    <Card key={opp.id} className="p-4 space-y-4 hover:border-gold/50 transition-colors group">
                      <div className="flex justify-between items-start gap-2">
                        <Link href={`/pipeline/${opp.id}`} className="font-medium text-text group-hover:text-gold transition-colors block leading-tight">
                          {opp.name}
                        </Link>
                        {opp.daysInStage > 30 && (
                          <div className="text-danger flex shrink-0" title={`${opp.daysInStage} days in stage`}>
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <div className="text-sm text-text-mute font-mono">{opp.accountName}</div>
                      <div className="flex justify-between items-end pt-2 border-t border-border-soft">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-text-faint font-mono">Value</span>
                          <span className="text-sm font-semibold text-text">${(opp.dealSizeUsd / 1000).toFixed(0)}k</span>
                        </div>
                        <div className="flex -space-x-2">
                          <Avatar className="w-6 h-6 border-2 border-bg-elevate">
                            <AvatarFallback className="text-[10px] bg-bg-deep text-gold">{opp.partnerOwnerName.split(' ').map(n=>n[0]).join('')}</AvatarFallback>
                          </Avatar>
                          <Avatar className="w-6 h-6 border-2 border-bg-elevate">
                            <AvatarFallback className="text-[10px] bg-bg-deep text-text-mute">{opp.engagementLeadName.split(' ').map(n=>n[0]).join('')}</AvatarFallback>
                          </Avatar>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-bg-deep font-mono text-xs text-text-mute uppercase tracking-wider border-b border-border">
                <tr>
                  <th className="p-4 font-normal">Opportunity</th>
                  <th className="p-4 font-normal">Account</th>
                  <th className="p-4 font-normal">Stage</th>
                  <th className="p-4 font-normal">Value</th>
                  <th className="p-4 font-normal">Probability</th>
                  <th className="p-4 font-normal">Team</th>
                  <th className="p-4 font-normal">Next Milestone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {opps?.map(opp => (
                  <tr key={opp.id} className="hover:bg-bg-elevate-2 transition-colors">
                    <td className="p-4">
                      <Link href={`/pipeline/${opp.id}`} className="font-medium text-text hover:text-gold transition-colors">
                        {opp.name}
                      </Link>
                      {opp.daysInStage > 30 && <span className="ml-2 text-[10px] text-danger font-mono border border-danger/30 rounded px-1">{opp.daysInStage}d aged</span>}
                    </td>
                    <td className="p-4 text-text-mute">{opp.accountName}</td>
                    <td className="p-4"><PlmPill stage={opp.plmStage} /></td>
                    <td className="p-4 font-mono">${(opp.dealSizeUsd / 1000).toFixed(0)}k</td>
                    <td className="p-4 font-mono text-text-mute">{opp.probabilityPct}%</td>
                    <td className="p-4 text-text-mute">{opp.partnerOwnerName.split(' ')[0]} / {opp.engagementLeadName.split(' ')[0]}</td>
                    <td className="p-4 text-text-mute text-xs truncate max-w-[200px]">{opp.nextMilestone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
