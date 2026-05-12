import * as React from "react";
import { useAtelierGetEngagement, getAtelierGetEngagementQueryKey } from "@workspace/api-client-react";
import { SectionHead, PlmPill, MonoChip, Card } from "@/components/ui/primitives";
import { Link, useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditTab } from "@/components/AuditTab";
import { ArrowLeft, Code } from "lucide-react";

const TABS = [
  { id: 'charter', label: 'Charter' },
  { id: 'workplan', label: 'Workplan' },
  { id: 'deliverables', label: 'Deliverables' },
  { id: 'agents', label: 'Agents' },
  { id: 'processes', label: 'Processes' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'audit', label: 'Audit Trail' }
];

export default function Engagement() {
  const [, params] = useRoute("/engagements/:engId");
  const engId = params?.engId || "";
  
  const { data: eng, isLoading, isError } = useAtelierGetEngagement(engId, {
    query: { enabled: !!engId, queryKey: getAtelierGetEngagementQueryKey(engId) },
  });

  const [activeTab, setActiveTab] = React.useState('charter');

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !eng) return <div className="container-atelier py-12 text-danger">Failed to load engagement.</div>;

  return (
    <div className="container-atelier py-8 space-y-8 animate-in fade-in">
      <div>
        <Link href="/engagements" className="inline-flex items-center gap-2 text-xs font-mono text-text-mute hover:text-text mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Engagements
        </Link>
        
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead 
            eyebrow={eng.accountName}
            headline={eng.name}
            lede={<div className="flex items-center gap-4 mt-2">
              <PlmPill stage={eng.plmStage} />
              <MonoChip tone={eng.raidStatus === 'red' ? 'red' : eng.raidStatus === 'amber' ? 'amber' : 'green'}>
                RAID: {eng.raidStatus}
              </MonoChip>
            </div>}
          />
          <div className="flex flex-col items-end gap-2 text-sm text-text-mute text-right">
            <div>Partner: <span className="text-text font-medium">{eng.partnerOwnerName}</span></div>
            <div>Lead: <span className="text-text font-medium">{eng.engagementLeadName}</span></div>
            <div className="text-xs font-mono mt-2 pt-2 border-t border-border/50">
              Started: <span className="text-text">{new Date(eng.startDate).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
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
          <AuditTab entityType="engagement" entityId={eng.id} />
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
