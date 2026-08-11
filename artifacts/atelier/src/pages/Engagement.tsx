import * as React from "react";
import { useAtelierGetEngagement, getAtelierGetEngagementQueryKey } from "@workspace/api-client-react";
import {
  SectionHead,
  PageHero,
  PlmPill,
  MonoChip,
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
import { DocumentLibraryPanel } from "@/pages/Documents";
import { AgentsTab } from "@/components/tabs/AgentsTab";
import { useQueryClient } from "@tanstack/react-query";
import { useFinanceEntities } from "@/lib/v5-hooks";
import { useToast } from "@/hooks/use-toast";
import { ProcessesTab } from "@/components/tabs/ProcessesTab";
import { FinancialsTab } from "@/components/tabs/FinancialsTab";

const TABS = [
  { id: 'charter', label: 'Charter' },
  { id: 'workplan', label: 'Workplan' },
  { id: 'deliverables', label: 'Deliverables' },
  { id: 'financials', label: 'Financials' },
  { id: 'agents', label: 'Agents' },
  { id: 'processes', label: 'Processes' },
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'documents', label: 'Documents' },
  { id: 'audit', label: 'Audit Trail' }
];

const TAB_IDS = new Set(TABS.map((t) => t.id));

export default function Engagement() {
  // Task #375 — workspace re-mount under the Clients lens. The canonical
  // path is `/clients/deliver/engagements/:engId(/:tab)?`; the legacy
  // `/engagements/:engId` route still resolves here so deep-links from
  // dossiers, audit logs and notification emails keep working until the
  // App-level redirects do their work. Any of these routes may carry an
  // optional `:tab` segment for deep-linking into a specific tab
  // (charter / workplan / deliverables / agents / processes / meetings /
  // artifacts / audit) including the L2C Wave 1 surfaces (CLM,
  // change-orders, acceptances) which live inside those tabs.
  const [matchLens, lensParams] = useRoute<{ engId: string; tab?: string }>(
    "/clients/deliver/engagements/:engId/:tab?",
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
      setLocation(`/clients/deliver/engagements/${engId}/${tabId}`, { replace: true });
    }
  }

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !eng) return <div className="container-atelier py-12 text-danger">Failed to load engagement.</div>;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/clients/deliver/engagements">Back to Engagements</BackLink>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-8">
          {/* Task #973 — same overflow treatment as the Account header: the
              headline column must be allowed to shrink (min-w-0) so a long
              engagement name wraps instead of pushing the ownership panel
              off screen; the chip row inside the lede already flex-wraps. */}
          <SectionHead
            className="min-w-0 flex-1"
            eyebrow={eng.accountName}
            headline={eng.name}
            lede={
              <span
                className="inline-flex items-center gap-3 flex-wrap"
                data-testid="row-engagement-chips"
              >
                <PlmPill stage={eng.plmStage} />
                <MonoChip tone={eng.raidStatus === 'red' ? 'red' : eng.raidStatus === 'amber' ? 'amber' : 'green'}>
                  RAID · {eng.raidStatus}
                </MonoChip>
              </span>
            }
          />
          <div
            className="shrink min-w-0 flex flex-col items-end gap-3"
            data-testid="row-engagement-actions"
          >
            <OwnershipPanel
              rows={[
                { label: "Partner", name: eng.partnerOwnerName },
                { label: "Engagement Lead", name: eng.engagementLeadName },
                { label: "Started", name: new Date(eng.startDate).toLocaleDateString(), meta: true },
              ]}
            />
            <LegalEntitySelector engId={eng.id} legalEntityId={eng.legalEntityId ?? null} />
          </div>
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
          {activeTab === 'financials' && <FinancialsTab engId={eng.id} />}
          {activeTab === 'artifacts' && <ArtifactsTab engId={eng.id} />}
          {activeTab === 'documents' && <DocumentLibraryPanel engagementId={eng.id} />}
          {activeTab === 'agents' && <AgentsTab engId={eng.id} />}
          {activeTab === 'audit' && <AuditTab entityType="engagement" entityId={eng.id} />}
          {activeTab === 'processes' && <ProcessesTab engId={eng.id} />}
        </div>
      </div>
    </div>
  );
}

// Task #654 — explicit legal entity on the engagement (invoicing/delivery
// entity for margin reporting). Raw fetch: PATCH /engagements/:id is a
// bespoke route not in the OpenAPI spec for writes.
function LegalEntitySelector({ engId, legalEntityId }: { engId: string; legalEntityId: string | null }) {
  const entities = useFinanceEntities();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  if (entities.length === 0) return null;

  const onChange = async (value: string) => {
    setBusy(true);
    try {
      const base = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;
      const res = await fetch(`${base}/engagements/${engId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legalEntityId: value || null }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
      toast({ title: value ? "Legal entity updated" : "Legal entity cleared" });
      void qc.invalidateQueries({ queryKey: getAtelierGetEngagementQueryKey(engId) });
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex items-center gap-2 flex-wrap justify-end text-[10px] font-mono uppercase tracking-widest text-text-faint" data-testid="engagement-entity-selector">
      Legal entity
      <select
        value={legalEntityId ?? ""}
        onChange={(e) => void onChange(e.target.value)}
        disabled={busy}
        className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-[11px] font-mono text-text normal-case tracking-normal"
        data-testid="select-engagement-entity"
      >
        <option value="">— inferred from invoices —</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>{e.shortName}</option>
        ))}
      </select>
    </label>
  );
}
