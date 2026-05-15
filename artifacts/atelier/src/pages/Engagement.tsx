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
  CopyLinkButton,
} from "@/components/ui/primitives";
import { useRoute, useLocation } from "wouter";
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

const TAB_IDS = new Set(TABS.map((t) => t.id));

export default function Engagement() {
  // Task #375 — workspace re-mount under the Clients lens. The canonical
  // path is `/clients/engagements/:engId(/:tab)?`; the legacy
  // `/engagements/:engId` route still resolves here so deep-links from
  // dossiers, audit logs and notification emails keep working until the
  // App-level redirects do their work. Either route may carry an
  // optional `:tab` segment for deep-linking into a specific tab
  // (charter / workplan / deliverables / agents / processes / meetings /
  // artifacts / audit) including the L2C Wave 1 surfaces (CLM,
  // change-orders, acceptances) which live inside those tabs.
  const [matchLens, lensParams] = useRoute<{ engId: string; tab?: string }>(
    "/clients/engagements/:engId/:tab?",
  );
  const [, legacyParams] = useRoute<{ engId: string; tab?: string }>(
    "/engagements/:engId/:tab?",
  );
  const params = matchLens ? lensParams : legacyParams;
  const engId = params?.engId ?? "";
  const tabParam = params?.tab;
  const urlTab = tabParam && TAB_IDS.has(tabParam) ? tabParam : null;
  const [, setLocation] = useLocation();

  const { data: eng, isLoading, isError } = useAtelierGetEngagement(engId, {
    query: { enabled: !!engId, queryKey: getAtelierGetEngagementQueryKey(engId) },
  });

  const [activeTab, setActiveTab] = React.useState(urlTab ?? 'charter');

  // Sync state when the URL tab changes (e.g. back/forward navigation or
  // a deep-link click from another surface).
  React.useEffect(() => {
    if (urlTab && urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlTab]);

  function selectTab(tabId: string) {
    setActiveTab(tabId);
    if (engId) {
      setLocation(`/clients/engagements/${engId}/${tabId}`, { replace: true });
    }
  }

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !eng) return <div className="container-atelier py-12 text-danger">Failed to load engagement.</div>;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/clients/engagements">Back to Engagements</BackLink>

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
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <TabNav className="flex-1 min-w-0">
            {TABS.map(tab => (
              <TabNavItem
                key={tab.id}
                active={activeTab === tab.id}
                onClick={() => selectTab(tab.id)}
                data-testid={`tab-${tab.id}`}
              >
                {tab.label}
              </TabNavItem>
            ))}
          </TabNav>
          {/* Task #388 — copy a deep-link to the active workspace tab so it
              can be pasted into email/chat. The path matches the canonical
              `/clients/engagements/:id/:tab` URL the router resolves. */}
          <CopyLinkButton
            path={`/clients/engagements/${eng.id}/${activeTab}`}
            label="Copy tab link"
            toastTitle="Tab link copied"
            toastDescription={`Shareable link to the ${TABS.find(t => t.id === activeTab)?.label ?? activeTab} tab is on your clipboard.`}
            data-testid={`btn-copy-link-tab-${activeTab}`}
            className="shrink-0"
          />
        </div>

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
