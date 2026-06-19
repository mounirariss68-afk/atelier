import * as React from "react";
import {
  useAtelierGetOpportunity,
  useAtelierGetMe,
  useAtelierGetStageHistory,
  useAtelierArchiveOpportunity,
  getAtelierGetOpportunityQueryKey,
  getAtelierGetStageHistoryQueryKey,
  getAtelierListOpportunitiesQueryKey,
  getAtelierListAuditQueryKey,
  getAtelierGetPipelineForecastQueryKey,
  type SalesStage,
} from "@workspace/api-client-react";
import {
  SectionHead,
  PageHero,
  MonoChip,
  PillButton,
  BackLink,
  TabNav,
  TabNavItem,
  HeroStat,
  OwnershipPanel,
} from "@/components/ui/primitives";
import { useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditTab } from "@/components/AuditTab";
import { BriefTab } from "@/components/tabs/BriefTab";
import { ResearchTab } from "@/components/tabs/ResearchTab";
import { PovTab } from "@/components/tabs/PovTab";
import { MeetingsTab } from "@/components/tabs/MeetingsTab";
import { ProposalTab } from "@/components/tabs/ProposalTab";
import { CommercialsTab } from "@/components/tabs/CommercialsTab";
import { PrototypeButton } from "@/components/tabs/PrototypeButton";
import { QualifierSheet } from "@/components/QualifierSheet";
import { StageTransitionDialog } from "@/components/StageTransitionDialog";
import { OpportunityEditDialog } from "@/components/OpportunityEditDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { SALES_STAGE_LABEL, STALLED_THRESHOLD_DAYS, stageTone } from "@/lib/sales-stages";
import { FileText, FilePlus2, Mic, Telescope, Folder, ArrowRight, AlertTriangle, Pencil, Archive } from "lucide-react";

const TABS = [
  { id: "brief", label: "Brief" },
  { id: "research", label: "Research" },
  { id: "pov", label: "POV Studio" },
  { id: "meetings", label: "Meetings" },
  { id: "proposal", label: "Proposal" },
  { id: "commercials", label: "Commercials" },
  { id: "artifacts", label: "Artifacts" },
  { id: "audit", label: "Audit Trail" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function Opportunity() {
  const [, paramsV2] = useRoute("/opportunities/:oppId");
  const [, paramsV1] = useRoute("/pipeline/:oppId");
  const oppId = paramsV2?.oppId ?? paramsV1?.oppId ?? "";

  const { data: opp, isLoading, isError } = useAtelierGetOpportunity(oppId, {
    query: { enabled: !!oppId, queryKey: getAtelierGetOpportunityQueryKey(oppId) },
  });
  const { data: me } = useAtelierGetMe();
  const { data: history } = useAtelierGetStageHistory(oppId, {
    query: { enabled: !!oppId, queryKey: getAtelierGetStageHistoryQueryKey(oppId) },
  });

  const [activeTab, setActiveTab] = React.useState<TabId>("brief");
  const [qualifierOpen, setQualifierOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const archive = useAtelierArchiveOpportunity();

  async function handleArchive() {
    try {
      await archive.mutateAsync({ oppId, data: {} });
      qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierGetPipelineForecastQueryKey() });
      toast({ title: "Opportunity archived", description: "Removed from the active pipeline." });
      setArchiveOpen(false);
      navigate("/pipeline");
    } catch (err: unknown) {
      toast({ title: "Could not archive", description: String(err), variant: "destructive" });
    }
  }

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !opp) return <div className="container-atelier py-12 text-danger">Failed to load opportunity.</div>;

  const personaName = me?.name ?? "You";
  const dealLabel = `$${(opp.dealSizeUsd / 1000).toFixed(0)}k`;
  const salesStage: SalesStage =
    (opp as { salesStage?: SalesStage }).salesStage ?? ("lead" as SalesStage);
  const isStalled =
    (opp as { stalled?: boolean }).stalled ??
    opp.daysInStage > STALLED_THRESHOLD_DAYS;
  const recentTransitions = (Array.isArray(history) ? history : []).slice(0, 5);

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/pipeline">Back to Pipeline</BackLink>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
          <div className="space-y-6 min-w-0 flex-1">
            <SectionHead
              eyebrow={opp.accountName}
              headline={opp.name}
            />
            <HeroStat
              value={dealLabel}
              caption={
                <>
                  <MonoChip tone={stageTone(salesStage)}>{SALES_STAGE_LABEL[salesStage]}</MonoChip>
                  <MonoChip>Prob {opp.probabilityPct}%</MonoChip>
                  {isStalled && (
                    <MonoChip tone="red">
                      <span className="inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {opp.daysInStage}d stalled
                      </span>
                    </MonoChip>
                  )}
                  <span className="text-text-faint">Deal value</span>
                </>
              }
            />

            {recentTransitions.length > 0 && (
              <div className="rounded-md border border-border-soft bg-bg-elevate/60 p-3 space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
                  Stage history · last {recentTransitions.length}
                </div>
                <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] font-mono">
                  {recentTransitions.map((t, i) => (
                    <li key={t.id ?? i} className="inline-flex items-center gap-2">
                      <span className="text-text-mute">
                        {t.fromStage ? SALES_STAGE_LABEL[t.fromStage] : "—"}
                      </span>
                      <ArrowRight className="w-3 h-3 text-text-faint" />
                      <span className="text-gold">{SALES_STAGE_LABEL[t.toStage]}</span>
                      <span className="text-text-faint">
                        · {new Date(t.createdAt).toLocaleDateString()}
                      </span>
                      {i < recentTransitions.length - 1 && (
                        <span className="text-text-faint mx-1">|</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <OwnershipPanel
            className="shrink-0"
            rows={[
              { label: "Partner", name: opp.partnerOwnerName },
              { label: "Engagement Lead", name: opp.engagementLeadName },
              { label: "Next milestone", name: opp.nextMilestone, meta: true },
            ]}
          />
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        {/* Primary creative-work toolbar — anchored next to the tabs.
            Gold accent reserved for the Draft POV primary action. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <PillButton variant="primary" onClick={() => setActiveTab("pov")}>
              <span className="inline-flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Draft POV</span>
            </PillButton>
            <PillButton variant="ghost" onClick={() => setActiveTab("proposal")}>
              <span className="inline-flex items-center gap-1.5"><FilePlus2 className="w-3.5 h-3.5" /> Build proposal</span>
            </PillButton>
            <PillButton variant="ghost" onClick={() => setActiveTab("meetings")}>
              <span className="inline-flex items-center gap-1.5"><Mic className="w-3.5 h-3.5" /> Capture meeting</span>
            </PillButton>
            <PrototypeButton oppId={opp.id} oppName={opp.name} />
            <PillButton variant="ghost" onClick={() => setMoveOpen(true)}>
              <span className="inline-flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5" /> Move stage
              </span>
            </PillButton>
          </div>
          {/* Secondary references row — research + lifecycle controls. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("research")}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-text-mute hover:text-gold transition-colors"
            >
              <Telescope className="w-3.5 h-3.5" /> Research account
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-text-mute hover:text-gold transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-text-mute hover:text-danger transition-colors"
            >
              <Archive className="w-3.5 h-3.5" /> Archive
            </button>
          </div>
        </div>

        <TabNav>
          {TABS.map((tab) => (
            <TabNavItem
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </TabNavItem>
          ))}
        </TabNav>

        <div className="py-2">
          {activeTab === "brief" && (
            <BriefTab oppId={opp.id} onOpenQualifier={() => setQualifierOpen(true)} />
          )}
          {activeTab === "research" && <ResearchTab oppId={opp.id} />}
          {activeTab === "pov" && <PovTab oppId={opp.id} personaName={personaName} />}
          {activeTab === "meetings" && <MeetingsTab oppId={opp.id} personaName={personaName} />}
          {activeTab === "proposal" && <ProposalTab oppId={opp.id} />}
          {activeTab === "commercials" && <CommercialsTab oppId={opp.id} />}
          {activeTab === "artifacts" && (() => {
            const evidence = (Array.isArray(history) ? history : []).flatMap((t) =>
              (t.evidenceArtifactIds ?? []).map((artId) => ({
                artId,
                stage: t.toStage,
                at: t.createdAt,
                by: t.transitionedByName ?? null,
              })),
            );
            if (evidence.length === 0) {
              return (
                <div className="rounded-lg border border-dashed border-border bg-bg-elevate/40 p-12 text-center">
                  <Folder className="w-8 h-8 text-gold/60 mx-auto mb-3" />
                  <h3 className="text-lg font-semibold text-text mb-1">Artifacts</h3>
                  <p className="text-text-mute text-sm max-w-xl mx-auto">
                    Evidence and artifacts attached to stage transitions on{" "}
                    <span className="font-mono text-text">{opp.name}</span> appear here. Attach
                    references from the <span className="text-gold font-mono">Move stage</span> dialog.
                  </p>
                  <p className="text-xs text-text-faint mt-4 font-mono">No artifacts attached yet.</p>
                </div>
              );
            }
            return (
              <div className="rounded-lg border border-border-soft bg-bg-elevate/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-border-soft flex items-center gap-2">
                  <Folder className="w-4 h-4 text-gold/70" />
                  <h3 className="text-sm font-semibold text-text">Stage-transition evidence</h3>
                  <span className="text-xs text-text-faint font-mono">· {evidence.length}</span>
                </div>
                <ul className="divide-y divide-border-soft">
                  {evidence.map((e, i) => (
                    <li key={`${e.artId}-${i}`} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                      <span className="font-mono text-text truncate">{e.artId}</span>
                      <span className="text-xs text-text-faint font-mono shrink-0">
                        {SALES_STAGE_LABEL[e.stage]} · {new Date(e.at).toLocaleDateString()}
                        {e.by ? ` · ${e.by}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          {activeTab === "audit" && <AuditTab entityType="opportunity" entityId={opp.id} />}
        </div>
      </div>

      <QualifierSheet oppId={opp.id} open={qualifierOpen} onOpenChange={setQualifierOpen} />
      <StageTransitionDialog
        oppId={opp.id}
        oppName={opp.name}
        currentStage={salesStage}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />
      <OpportunityEditDialog opp={opp} open={editOpen} onOpenChange={setEditOpen} />
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent className="bg-bg-elevate border-border text-text">
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this opportunity?</AlertDialogTitle>
            <AlertDialogDescription className="text-text-mute">
              <span className="font-mono text-text">{opp.name}</span> will be removed from the
              active pipeline and forecast. This is a soft delete — it stays in the audit trail and
              can be restored by an admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleArchive();
              }}
              disabled={archive.isPending}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {archive.isPending ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
