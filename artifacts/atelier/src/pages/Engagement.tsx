import * as React from "react";
import { useAtelierGetEngagement, getAtelierGetEngagementQueryKey } from "@workspace/api-client-react";
import {
  SectionHead,
  PageHero,
  PlmPill,
  MonoChip,
  Card,
  BackLink,
  TabNav,
  TabNavItem,
  OwnershipPanel,
} from "@/components/ui/primitives";
import { useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditTab } from "@/components/AuditTab";
import { CharterTab } from "@/components/tabs/CharterTab";
import { WorkplanTab } from "@/components/tabs/WorkplanTab";
import { DeliverablesTab } from "@/components/tabs/DeliverablesTab";
import { ArtifactsTab } from "@/components/tabs/ArtifactsTab";
import { AgentsTab } from "@/components/tabs/AgentsTab";
import { ProcessesTab } from "@/components/tabs/ProcessesTab";
import { Code } from "lucide-react";

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
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/engagements">Back to Engagements</BackLink>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
          <SectionHead
            eyebrow={eng.accountName}
            headline={eng.name}
            lede={
              <span className="inline-flex items-center gap-3 flex-wrap">
                <PlmPill stage={eng.plmStage} />
                <MonoChip tone={eng.raidStatus === 'red' ? 'red' : eng.raidStatus === 'amber' ? 'amber' : 'green'}>
                  RAID · {eng.raidStatus}
                </MonoChip>
              </span>
            }
          />
          <OwnershipPanel
            className="shrink-0"
            rows={[
              { label: "Partner", name: eng.partnerOwnerName },
              { label: "Engagement Lead", name: eng.engagementLeadName },
              { label: "Started", name: new Date(eng.startDate).toLocaleDateString(), meta: true },
            ]}
          />
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-8">
        <TabNav>
          {TABS.map(tab => (
            <TabNavItem
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-${tab.id}`}
            >
              {tab.label}
            </TabNavItem>
          ))}
        </TabNav>

        <div className="py-4">
          {activeTab === 'charter' && <CharterTab engId={eng.id} />}
          {activeTab === 'workplan' && <WorkplanTab engId={eng.id} />}
          {activeTab === 'deliverables' && <DeliverablesTab engId={eng.id} />}
          {activeTab === 'artifacts' && <ArtifactsTab engId={eng.id} />}
          {activeTab === 'agents' && <AgentsTab engId={eng.id} />}
          {activeTab === 'audit' && <AuditTab entityType="engagement" entityId={eng.id} />}
          {activeTab === 'processes' && <ProcessesTab engId={eng.id} />}
          {activeTab === 'meetings' && (
            <Card className="p-12 flex flex-col items-center justify-center text-center border-dashed">
              <div className="w-12 h-12 bg-bg-elevate-2 rounded-full flex items-center justify-center mb-4 text-gold">
                <Code className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-text mb-2">Workspace Module: {TABS.find(t => t.id === activeTab)?.label}</h3>
              <p className="text-text-mute max-w-md">This tab ships in a later workstream. Foundation registers it in the navigation shell.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
