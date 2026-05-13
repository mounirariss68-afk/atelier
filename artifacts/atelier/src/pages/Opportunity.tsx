import * as React from "react";
import {
  useAtelierGetOpportunity,
  useAtelierGetMe,
  useAtelierGetStageHistory,
  getAtelierGetOpportunityQueryKey,
  getAtelierGetStageHistoryQueryKey,
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
  MockFallbackBanner,
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
import { SALES_STAGE_LABEL, STALLED_THRESHOLD_DAYS, stageTone } from "@/lib/sales-stages";
import { FileText, FilePlus2, Mic, Telescope, Folder, ArrowRight, AlertTriangle } from "lucide-react";

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
        {/* Banner is gated on a real fallback signal. Until the API surfaces
            `agent.mock_fallback` (see api-server/src/lib/atelier-agents/runner.ts
            `source: "mock_fallback"`) on a client-readable field, we keep this
            inactive so the assertive copy never displays speculatively. */}
        <MockFallbackBanner active={false} />

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
          {/* Secondary references row — research + scoring. */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("research")}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-text-mute hover:text-gold transition-colors"
            >
              <Telescope className="w-3.5 h-3.5" /> Research account
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
          {activeTab === "artifacts" && (
            <div className="rounded-lg border border-dashed border-border bg-bg-elevate/40 p-12 text-center">
              <Folder className="w-8 h-8 text-gold/60 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-text mb-1">Artifacts</h3>
              <p className="text-text-mute text-sm max-w-xl mx-auto">
                Proposals, decks, prototypes and exports linked to <span className="font-mono text-text">{opp.name}</span> live here. Use
                {" "}<span className="text-gold font-mono">Build proposal</span> or <span className="text-gold font-mono">Prototype</span> from the
                toolbar to spin up a new artifact, or drag-drop assets to attach existing ones.
              </p>
              <p className="text-xs text-text-faint mt-4 font-mono">No artifacts attached yet.</p>
            </div>
          )}
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
    </div>
  );
}
