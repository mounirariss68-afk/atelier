import * as React from "react";
import {
  useAtelierGetOpportunity,
  useAtelierGetMe,
  getAtelierGetOpportunityQueryKey,
} from "@workspace/api-client-react";
import { SectionHead, PageHero, PlmPill, MonoChip, PillButton } from "@/components/ui/primitives";
import { Link, useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditTab } from "@/components/AuditTab";
import { BriefTab } from "@/components/tabs/BriefTab";
import { ResearchTab } from "@/components/tabs/ResearchTab";
import { PovTab } from "@/components/tabs/PovTab";
import { MeetingsTab } from "@/components/tabs/MeetingsTab";
import { QualifierSheet } from "@/components/QualifierSheet";
import { ArrowLeft, Shield } from "lucide-react";

const TABS = [
  { id: "brief", label: "Brief" },
  { id: "research", label: "Research" },
  { id: "pov", label: "POV Studio" },
  { id: "meetings", label: "Meetings" },
  { id: "audit", label: "Audit Trail" },
] as const;

export default function Opportunity() {
  const [, params] = useRoute("/pipeline/:oppId");
  const oppId = params?.oppId || "";

  const { data: opp, isLoading, isError } = useAtelierGetOpportunity(oppId, {
    query: { enabled: !!oppId, queryKey: getAtelierGetOpportunityQueryKey(oppId) },
  });
  const { data: me } = useAtelierGetMe();

  const [activeTab, setActiveTab] = React.useState<(typeof TABS)[number]["id"]>("brief");
  const [qualifierOpen, setQualifierOpen] = React.useState(false);

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !opp) return <div className="container-atelier py-12 text-danger">Failed to load opportunity.</div>;

  const personaName = me?.name ?? "You";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Link href="/pipeline" className="inline-flex items-center gap-2 text-xs font-mono text-text-mute hover:text-text mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Pipeline
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead
            eyebrow={opp.accountName}
            headline={opp.name}
            lede={
              <div className="flex items-center gap-4 mt-2">
                <PlmPill stage={opp.plmStage} />
                <MonoChip>Prob: {opp.probabilityPct}%</MonoChip>
                <span className="text-gold font-mono">${(opp.dealSizeUsd / 1000).toFixed(0)}k</span>
              </div>
            }
          />
          <div className="flex flex-col items-end gap-2 text-sm text-text-mute text-right">
            <div>Partner: <span className="text-text font-medium">{opp.partnerOwnerName}</span></div>
            <div>Lead: <span className="text-text font-medium">{opp.engagementLeadName}</span></div>
            <div className="text-xs font-mono mt-2 pt-2 border-t border-border/50">
              Next: <span className="text-text">{opp.nextMilestone}</span>
            </div>
          </div>
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        <div className="flex flex-wrap gap-3 p-4 bg-bg-elevate border border-gold/30 rounded-lg items-center justify-between">
          <div className="text-sm text-text-mute">
            Opportunity workspace · all agent runs and human decisions are logged to the audit trail.
          </div>
          <PillButton variant="ghost" onClick={() => setQualifierOpen(true)}>
            <span className="inline-flex items-center gap-1"><Shield className="w-3 h-3" /> 5C Qualifier</span>
          </PillButton>
        </div>

        <div className="border-b border-border">
          <div className="flex gap-6 overflow-x-auto scrollbar-thin">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.id ? "border-gold text-gold" : "border-transparent text-text-mute hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="py-2">
          {activeTab === "brief" && <BriefTab oppId={opp.id} />}
          {activeTab === "research" && <ResearchTab oppId={opp.id} />}
          {activeTab === "pov" && <PovTab oppId={opp.id} personaName={personaName} />}
          {activeTab === "meetings" && <MeetingsTab oppId={opp.id} personaName={personaName} />}
          {activeTab === "audit" && <AuditTab entityType="opportunity" entityId={opp.id} />}
        </div>
      </div>

      <QualifierSheet oppId={opp.id} open={qualifierOpen} onOpenChange={setQualifierOpen} />
    </div>
  );
}
