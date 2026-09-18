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
  useAtelierListJointPipeline,
  getAtelierListJointPipelineQueryKey,
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
import { fmtMoney } from "@/lib/utils";
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
import { Folder, ArrowRight, AlertTriangle, Pencil, Archive, PenLine } from "lucide-react";
import { SendForSignatureDialog } from "@/components/esign/SendForSignatureDialog";
import { OpportunityAgreements } from "@/components/esign/OpportunityAgreements";
import { NepAccessCard } from "@/components/NepAccessCard";
import { OpportunityPartnerTags } from "@/components/OpportunityPartnerPicker";

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

const FORECAST_CATEGORY_LABEL: Record<string, string> = {
  omitted: "Omitted",
  pipeline: "Pipeline",
  best_case: "Best case",
  commit: "Commit",
  closed: "Closed",
};

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

  // Task #1020 — background-job notifications deep-link to a specific tab
  // (e.g. ?tab=pov after a draft finishes); honor it on first render.
  const [activeTab, setActiveTab] = React.useState<TabId>(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t && TABS.some((tab) => tab.id === t) ? (t as TabId) : "brief";
  });
  const [qualifierOpen, setQualifierOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [esignOpen, setEsignOpen] = React.useState(false);

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
  // Task #8 — deal values are denominated in the account's primaryCurrency,
  // surfaced on the wire as `currency`; format with it instead of a hardcoded
  // USD label (we never fabricate an FX conversion client-side).
  const dealLabel = fmtMoney(opp.dealSizeUsd, (opp as { currency?: string }).currency ?? "USD");
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
                // Task #973 — HeroStat's caption row is already flex-wrap;
                // tagged to mirror Account's row-account-chips pattern.
                <span
                  className="contents"
                  data-testid="row-opportunity-chips"
                >
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
                </span>
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
              {
                label: "Expected close",
                name: opp.closeDate
                  ? new Date(opp.closeDate).toLocaleDateString()
                  : "Unscheduled",
                meta: true,
              },
              {
                label: "Forecast",
                name: FORECAST_CATEGORY_LABEL[opp.forecastCategory ?? "pipeline"] ?? "Pipeline",
                meta: true,
              },
            ]}
          />
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        {!!opp.partnerFirms?.length && (
          <div className="space-y-2" data-testid="opportunity-partner-tags">
            <p className="text-[11px] font-mono uppercase tracking-widest text-text-faint">External partner firms</p>
            <OpportunityPartnerTags firms={opp.partnerFirms} />
          </div>
        )}
        {/* Single action row — real actions only. All navigation (POV Studio,
            Proposal, Meetings, Research, …) lives exclusively in the tab bar
            below; each tab carries its own primary CTA. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" data-testid="row-opportunity-actions">
            <PillButton variant="primary" onClick={() => setMoveOpen(true)} data-testid="button-move-stage">
              <span className="inline-flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5" /> Move stage
              </span>
            </PillButton>
            {(me?.role === "founding_partner" || me?.role === "partner") && (
              <PillButton
                variant="ghost"
                onClick={() => setEsignOpen(true)}
                data-testid="button-send-for-signature"
              >
                <span className="inline-flex items-center gap-1.5">
                  <PenLine className="w-3.5 h-3.5" /> Send for signature
                </span>
              </PillButton>
            )}
            <PrototypeButton oppId={opp.id} oppName={opp.name} />
          </div>
          {/* Quiet lifecycle controls — secondary to the pill actions. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-text-mute hover:text-gold transition-colors"
              data-testid="button-edit-opportunity"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-text-mute hover:text-danger transition-colors"
              data-testid="button-archive-opportunity"
            >
              <Archive className="w-3.5 h-3.5" /> Archive
            </button>
          </div>
        </div>

        {(me?.role === "founding_partner" || me?.role === "partner") && (
          <OpportunityAgreements oppId={opp.id} />
        )}

        <OpportunityPartnerInvolvement oppId={opp.id} role={me?.role} />

        {(me?.role === "founding_partner" || me?.role === "partner") && (
          <OpportunityPartnerPortalAccess oppId={opp.id} />
        )}

        {/* Task #1297 — invite non-equity partners into this opportunity. */}
        <NepAccessCard kind="opportunity" targetId={opp.id} role={me?.role} />


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
        dealSizeUsd={opp.dealSizeUsd}
        currentNextMilestone={opp.nextMilestone}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />
      <OpportunityEditDialog opp={opp} open={editOpen} onOpenChange={setEditOpen} />
      <SendForSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        lockedAccount={{ id: opp.accountId, name: opp.accountName }}
        opportunityId={opp.id}
        defaultTitle={`Agreement — ${opp.name}`}
      />

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

// Task #513 — partner involvement surfaced on the opportunity itself.
// Only roles allowed through the /partners lens gate may query the co-sell
// registry; everyone else sees nothing (no 403 noise).
const PARTNERS_READER_ROLES = new Set([
  "founding_partner",
  "partner",
  "senior_manager",
  "consultant",
  "finance",
  "hr",
  "compliance_officer",
]);

// ---- Partner portal access (Task #873) --------------------------------------
// Leadership-only: grant/revoke a partner firm's portal visibility of THIS
// opportunity. A grant is exactly what makes the opportunity (plus a
// redacted client overview) appear for that firm's external logins.
// Raw fetch — bespoke routes, not in the OpenAPI spec.
function OpportunityPartnerPortalAccess({ oppId }: { oppId: string }) {
  const API = `${import.meta.env.BASE_URL}api/atelier`;
  type GrantRow = {
    id: string;
    partnerFirmId: string;
    firmName: string;
    firmArchived: boolean;
    createdAt: string;
    revokedAt: string | null;
  };
  const [grants, setGrants] = React.useState<GrantRow[] | null>(null);
  const [firms, setFirms] = React.useState<Array<{ id: string; name: string }> | null>(null);
  const [firmId, setFirmId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    void fetch(`${API}/opportunities/${oppId}/partner-grants`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { grants: GrantRow[] }) => setGrants(j.grants))
      .catch(() => setMsg("Couldn't load partner access."));
  }, [API, oppId]);
  React.useEffect(() => load(), [load]);
  React.useEffect(() => {
    void fetch(`${API}/partners/firms`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { items?: Array<{ id: string; name: string }> }) =>
        setFirms((j.items ?? []).map((f) => ({ id: f.id, name: f.name }))),
      )
      .catch(() => setFirms([]));
  }, [API]);

  const active = (grants ?? []).filter((g) => !g.revokedAt);

  const assign = () => {
    if (!firmId) return;
    setBusy(true);
    setMsg(null);
    void fetch(`${API}/opportunities/${oppId}/partner-grants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ partnerFirmId: firmId }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Assigning failed.");
        setFirmId("");
        load();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  const revoke = (grantId: string) => {
    setBusy(true);
    setMsg(null);
    void fetch(`${API}/opportunities/${oppId}/partner-grants/${grantId}/revoke`, {
      method: "POST",
      credentials: "include",
    })
      .then((r) => {
        if (!r.ok) throw new Error("Revoking failed.");
        load();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div
      className="rounded-md border border-border-soft bg-bg-elevate/60 p-4 space-y-3"
      data-testid="panel-partner-portal-access"
    >
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
        Partner portal access
      </div>
      <p className="text-xs text-text-mute">
        Granted firms' external logins see this opportunity (and a redacted
        client overview) in the partner portal. Revoking removes visibility
        immediately.
      </p>
      {grants == null ? (
        <p className="text-xs text-text-faint">Loading…</p>
      ) : active.length === 0 ? (
        <p className="text-xs text-text-mute">No partner firm has portal access.</p>
      ) : (
        <ul className="space-y-1">
          {active.map((g) => (
            <li key={g.id} className="flex items-center gap-2 text-sm" data-testid={`row-partner-grant-${g.id}`}>
              <span className="font-medium text-text">{g.firmName}</span>
              {g.firmArchived && <span className="text-xs text-warning">firm archived</span>}
              <button
                type="button"
                className="text-xs text-danger hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => revoke(g.id)}
                data-testid={`button-revoke-grant-${g.id}`}
              >
                revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="bg-bg-deep border border-border rounded px-2 py-1 text-xs"
          value={firmId}
          onChange={(e) => setFirmId(e.target.value)}
          data-testid="select-partner-grant-firm"
        >
          <option value="">Select partner firm…</option>
          {(firms ?? [])
            .filter((f) => !active.some((g) => g.partnerFirmId === f.id))
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="text-xs font-mono uppercase tracking-widest text-gold hover:text-gold/80 disabled:opacity-50"
          disabled={busy || !firmId}
          onClick={assign}
          data-testid="button-assign-partner-grant"
        >
          grant access
        </button>
      </div>
      {msg && <p className="text-xs text-text-faint">{msg}</p>}
    </div>
  );
}

const LEAD_PARTY_LABEL: Record<string, string> = {
  cognirise: "Cognirise-led",
  partner: "Partner-led",
  joint: "Jointly led",
};

function OpportunityPartnerInvolvement({ oppId, role }: { oppId: string; role?: string }) {
  const canSee = !!role && PARTNERS_READER_ROLES.has(role);
  const { data } = useAtelierListJointPipeline(
    { opportunityId: oppId },
    {
      query: {
        enabled: canSee && !!oppId,
        queryKey: getAtelierListJointPipelineQueryKey({ opportunityId: oppId }),
      },
    },
  );
  const entries = data?.items ?? [];
  if (!canSee || entries.length === 0) return null;

  return (
    <div
      className="rounded-md border border-border-soft bg-bg-elevate/60 p-4 space-y-3"
      data-testid="panel-partner-involvement"
    >
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
        Partner involvement · co-sell
      </div>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center gap-2 text-sm"
            data-testid={`row-partner-involvement-${e.id}`}
          >
            <span className="font-medium text-text">
              {e.partnerFirmName ?? e.partnerFirmId}
            </span>
            {e.partnerSourced && <MonoChip tone="gold">Partner-sourced</MonoChip>}
            {e.leadParty && <MonoChip>{LEAD_PARTY_LABEL[e.leadParty] ?? e.leadParty}</MonoChip>}
            {(typeof e.cognirisePct === "number" || typeof e.partnerPct === "number") && (
              <span className="text-xs font-mono text-text-mute">
                Split {e.cognirisePct == null ? "Not set" : `${e.cognirisePct}%`} / {e.partnerPct == null ? "Not set" : `${e.partnerPct}%`}
              </span>
            )}
            {e.allianceLetterStatus && e.allianceLetterStatus !== "none" && (
              <span className="text-xs text-text-faint">
                Alliance letter: {e.allianceLetterStatus}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
