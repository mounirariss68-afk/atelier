import { useState } from "react";
import {
  useAtelierListOpportunities,
  useAtelierUpdateOpportunityStage,
  getAtelierListOpportunitiesQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { SectionHead, PageHero, Card, PlmPill, PillButton } from "@/components/ui/primitives";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutGrid, List as ListIcon, AlertTriangle, Plus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CreateOpportunityDialog } from "@/components/CreateOpportunityDialog";
import { QualifierSheet } from "@/components/QualifierSheet";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";

const PLM_STAGES = ["identify", "shape", "pursue", "won", "lost", "no_go"] as const;
type Stage = (typeof PLM_STAGES)[number];

import type { Opportunity } from "@workspace/api-client-react";
type OppItem = Opportunity;

function StageColumn({ stage, children, count }: { stage: Stage; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage}` });
  return (
    <div
      ref={setNodeRef}
      className={`min-w-[300px] w-[300px] shrink-0 flex flex-col gap-3 snap-start rounded-md p-2 transition-colors ${
        isOver ? "bg-gold/5 outline-2 outline-dashed outline-gold/40" : ""
      }`}
    >
      <div className="flex items-center justify-between pb-2 border-b border-gold/30">
        <span className="font-mono text-sm tracking-widest uppercase text-text-mute">{stage.replace("_", " ")}</span>
        <span className="font-mono text-xs text-text-faint">{count}</span>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function OppCard({ opp }: { opp: OppItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `opp:${opp.id}` });
  return (
    <Card
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`p-4 space-y-3 hover:border-gold/50 transition-all group cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
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
            <AvatarFallback className="text-[10px] bg-bg-deep text-gold">
              {opp.partnerOwnerName.split(" ").map((n: string) => n[0]).join("")}
            </AvatarFallback>
          </Avatar>
          <Avatar className="w-6 h-6 border-2 border-bg-elevate">
            <AvatarFallback className="text-[10px] bg-bg-deep text-text-mute">
              {opp.engagementLeadName.split(" ").map((n: string) => n[0]).join("")}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </Card>
  );
}

export default function Pipeline() {
  const { data: opps, isLoading } = useAtelierListOpportunities();
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [qualifyOpp, setQualifyOpp] = useState<{ id: string; name: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const updateStage = useAtelierUpdateOpportunityStage();
  const qc = useQueryClient();
  const { toast } = useToast();

  async function commitMove(oppId: string, opp: OppItem, toStage: Stage) {
    if (toStage === opp.plmStage) return;
    try {
      await updateStage.mutateAsync({ oppId, data: { toStage } });
      qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
      toast({ title: `Moved to ${toStage}` });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 412 && toStage === "pursue") {
        // 5C qualifier required.
        setQualifyOpp({ id: opp.id, name: opp.name });
        toast({
          title: "5C Qualifier required",
          description: "Complete the 5C and approve to move into Pursue.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Could not move", description: String(err), variant: "destructive" });
      }
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const oppKey = String(e.active.id);
    const overKey = e.over?.id ? String(e.over.id) : "";
    if (!oppKey.startsWith("opp:") || !overKey.startsWith("stage:")) return;
    const oppId = oppKey.slice(4);
    const toStage = overKey.slice(6) as Stage;
    const opp = opps?.find((o) => o.id === oppId);
    if (!opp) return;
    void commitMove(oppId, opp, toStage);
  }

  if (isLoading) {
    return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  }

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-3.5rem)]">
      <PageHero>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <SectionHead headline="Opportunity Pipeline" lede="Active originations and pursuits. Drag a card to change stage. Pursue requires a signed 5C." />
          <div className="flex items-center gap-3 shrink-0">
            <CreateOpportunityDialog
              trigger={
                <PillButton variant="primary">
                  <span className="inline-flex items-center gap-1"><Plus className="w-3 h-3" /> New opportunity</span>
                </PillButton>
              }
            />
            <div className="flex items-center gap-2 bg-bg-elevate p-1 rounded-full border border-border">
              <button
                onClick={() => setView("kanban")}
                className={`p-2 rounded-full transition-colors ${view === "kanban" ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView("table")}
                className={`p-2 rounded-full transition-colors ${view === "table" ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"}`}
              >
                <ListIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-8 flex-1 flex flex-col">
        {view === "kanban" ? (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="flex-1 flex gap-4 overflow-x-auto pb-6 snap-x">
              {PLM_STAGES.map((stage) => {
                const stageOpps = (opps ?? []).filter((o) => o.plmStage === stage);
                return (
                  <StageColumn key={stage} stage={stage} count={stageOpps.length}>
                    {stageOpps.map((opp) => <OppCard key={opp.id} opp={opp} />)}
                  </StageColumn>
                );
              })}
            </div>
          </DndContext>
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
                  {opps?.map((opp) => (
                    <tr key={opp.id} className="hover:bg-bg-elevate-2 transition-colors">
                      <td className="p-4">
                        <Link href={`/pipeline/${opp.id}`} className="font-medium text-text hover:text-gold transition-colors">
                          {opp.name}
                        </Link>
                        {opp.daysInStage > 30 && (
                          <span className="ml-2 text-[10px] text-danger font-mono border border-danger/30 rounded px-1">
                            {opp.daysInStage}d aged
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-text-mute">{opp.accountName}</td>
                      <td className="p-4"><PlmPill stage={opp.plmStage} /></td>
                      <td className="p-4 font-mono">${(opp.dealSizeUsd / 1000).toFixed(0)}k</td>
                      <td className="p-4 font-mono text-text-mute">{opp.probabilityPct}%</td>
                      <td className="p-4 text-text-mute">
                        {opp.partnerOwnerName.split(" ")[0]} / {opp.engagementLeadName.split(" ")[0]}
                      </td>
                      <td className="p-4 text-text-mute text-xs truncate max-w-[200px]">{opp.nextMilestone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {qualifyOpp && (
        <QualifierSheet
          oppId={qualifyOpp.id}
          open={true}
          onOpenChange={(o) => { if (!o) setQualifyOpp(null); }}
          onCommitted={async (decision) => {
            if (decision === "go") {
              const opp = opps?.find((o) => o.id === qualifyOpp.id);
              if (opp) {
                await updateStage.mutateAsync({ oppId: qualifyOpp.id, data: { toStage: "pursue" } });
                qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
                qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
                toast({ title: "Moved to Pursue" });
              }
            }
            setQualifyOpp(null);
          }}
        />
      )}
    </div>
  );
}
