import * as React from "react";
import { useAtelierGetOpportunity, getAtelierGetOpportunityQueryKey } from "@workspace/api-client-react";
import { SectionHead, PlmPill, MonoChip, Card } from "@/components/ui/primitives";
import { Link, useRoute, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { PromptSheet } from "@/components/PromptSheet";
import { AuditTab } from "@/components/AuditTab";
import { ArrowLeft, Edit3, FileText, Mic, Search, Code, Users } from "lucide-react";

const TABS = [
  { id: 'brief', label: 'Brief' },
  { id: 'research', label: 'Research' },
  { id: 'pov', label: 'POV Studio' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'audit', label: 'Audit Trail' }
];

export default function Opportunity() {
  const [, params] = useRoute("/pipeline/:oppId");
  const [location, setLocation] = useLocation();
  const oppId = params?.oppId || "";
  
  const { data: opp, isLoading, isError } = useAtelierGetOpportunity(oppId, {
    query: { enabled: !!oppId, queryKey: getAtelierGetOpportunityQueryKey(oppId) },
  });

  // Default to brief tab if just /pipeline/:oppId
  // Wait, wouter nested routing without nesting:
  // we'll just handle state locally or via hash for now to keep it simple, 
  // or use search params. Let's use a local state for tabs in the MVP shell.
  const [activeTab, setActiveTab] = React.useState('brief');

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !opp) return <div className="container-atelier py-12 text-danger">Failed to load opportunity.</div>;

  return (
    <div className="container-atelier py-8 space-y-8 animate-in fade-in">
      <div>
        <Link href="/pipeline" className="inline-flex items-center gap-2 text-xs font-mono text-text-mute hover:text-text mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Pipeline
        </Link>
        
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead 
            eyebrow={opp.accountName}
            headline={opp.name}
            lede={<div className="flex items-center gap-4 mt-2">
              <PlmPill stage={opp.plmStage} />
              <MonoChip>Prob: {opp.probabilityPct}%</MonoChip>
              <span className="text-gold font-mono">${(opp.dealSizeUsd / 1000).toFixed(0)}k</span>
            </div>}
          />
          <div className="flex flex-col items-end gap-2 text-sm text-text-mute text-right">
            <div>Partner: <span className="text-text font-medium">{opp.partnerOwnerName}</span></div>
            <div>Lead: <span className="text-text font-medium">{opp.engagementLeadName}</span></div>
            <div className="text-xs font-mono mt-2 pt-2 border-t border-border/50">
              Next: <span className="text-text">{opp.nextMilestone}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap gap-3 p-4 bg-bg-elevate border border-gold/30 rounded-lg">
        <PromptSheet 
          agentName="POV Author" 
          trigger={<button className="flex items-center gap-2 text-sm font-medium text-text hover:text-gold transition-colors px-3 py-2 rounded hover:bg-bg-deep"><Edit3 className="w-4 h-4"/> Draft a POV</button>} 
        />
        <PromptSheet 
          agentName="Proposal Composer" 
          trigger={<button className="flex items-center gap-2 text-sm font-medium text-text hover:text-gold transition-colors px-3 py-2 rounded hover:bg-bg-deep"><FileText className="w-4 h-4"/> Build the proposal</button>} 
        />
        <PromptSheet 
          agentName="Meeting Scribe" 
          trigger={<button className="flex items-center gap-2 text-sm font-medium text-text hover:text-gold transition-colors px-3 py-2 rounded hover:bg-bg-deep"><Mic className="w-4 h-4"/> Capture this meeting</button>} 
        />
        <PromptSheet 
          agentName="Pursuit Scout" 
          trigger={<button className="flex items-center gap-2 text-sm font-medium text-text hover:text-gold transition-colors px-3 py-2 rounded hover:bg-bg-deep"><Search className="w-4 h-4"/> Research this account</button>} 
        />
        <PromptSheet 
          agentName="Prototype Forge" 
          trigger={<button className="flex items-center gap-2 text-sm font-medium text-text hover:text-gold transition-colors px-3 py-2 rounded hover:bg-bg-deep"><Code className="w-4 h-4"/> Prototype this</button>} 
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-6 overflow-x-auto scrollbar-thin">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${activeTab === tab.id ? 'border-gold text-gold' : 'border-transparent text-text-mute hover:text-text'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="py-4">
        {activeTab === 'audit' ? (
          <AuditTab entityType="opportunity" entityId={opp.id} />
        ) : (
          <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed bg-bg-deep">
            <div className="w-12 h-12 bg-bg-elevate rounded-full flex items-center justify-center mb-4 text-gold">
              <Code className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-text mb-2">Workspace Module: {TABS.find(t=>t.id===activeTab)?.label}</h3>
            <p className="text-text-mute max-w-md">This tab ships in a later workstream. Foundation registers it in the navigation shell.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
