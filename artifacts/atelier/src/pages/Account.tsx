import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetAccountWorkspace,
  useAtelierRefreshAccountCartographer,
  useAtelierGetAccountWhitespace,
  useAtelierGetAccountQbr,
  useAtelierDecideProfileUpdate,
  useAtelierUpdateContactDisposition,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierContact,
  type AtelierContactRelationship,
  type AtelierContactDisposition,
  type AtelierAccountWorkspace,
  type AtelierProfileUpdateProposal,
} from "@workspace/api-client-react";
import {
  BackLink,
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  PlmPill,
  HeroStat,
  TabNav,
  TabNavItem,
  Eyebrow,
  SectionLabel,
  PillButton,
} from "@/components/ui/primitives";
import { CreateContactDialog } from "@/components/CreateContactDialog";
import { EditContactDialog } from "@/components/EditContactDialog";
import { ContactInsightsDialog } from "@/components/ContactInsightsDialog";
import { EditAccountStrategyDialog } from "@/components/EditAccountStrategyDialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Globe,
  Sparkles,
  RefreshCw,
  Users as UsersIcon,
  Briefcase,
  Layers,
  Network,
  LayoutGrid,
  FileText,
  History,
  Check,
  X,
  ExternalLink,
  Target,
  Swords,
  Building2,
  ChevronDown,
  Pencil,
  Lightbulb,
  HelpCircle,
} from "lucide-react";

type TabKey =
  | "profile"
  | "decision_makers"
  | "opportunities"
  | "engagements"
  | "relationships"
  | "whitespace"
  | "qbr"
  | "audit";

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: "profile", label: "Profile", icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: "decision_makers", label: "Decision-Makers", icon: <UsersIcon className="w-3.5 h-3.5" /> },
  { key: "opportunities", label: "Opportunities", icon: <Briefcase className="w-3.5 h-3.5" /> },
  { key: "engagements", label: "Engagements", icon: <Layers className="w-3.5 h-3.5" /> },
  { key: "relationships", label: "Relationships", icon: <Network className="w-3.5 h-3.5" /> },
  { key: "whitespace", label: "Whitespace", icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { key: "qbr", label: "QBR", icon: <FileText className="w-3.5 h-3.5" /> },
  { key: "audit", label: "Audit", icon: <History className="w-3.5 h-3.5" /> },
];

// PRD §6.2: champion + supporter = gold; neutral = mute (default);
// skeptic + blocker = danger (red).
const DISPOSITION_TONE: Record<AtelierContactDisposition, "default" | "gold" | "green" | "amber" | "red"> = {
  champion: "gold",
  supporter: "gold",
  neutral: "default",
  skeptic: "red",
  blocker: "red",
  unknown: "default",
};

// Relationship-strength meter colour: green (strong) → amber → red (weak).
function strengthFill(s: number): string {
  const v = Math.max(0, Math.min(100, s));
  if (v >= 70) return "#3BA776";
  if (v >= 40) return "#C9A24B";
  return "#a83232";
}

// PRD §4.3 — the buying committee personas Cognirise expects to map on a
// public-sector account. Surfaced as a coverage gap when not yet present.
const EXPECTED_PERSONAS = [
  "economic_buyer",
  "technical_evaluator",
  "champion",
  "procurement",
  "executive_sponsor",
] as const;

export default function Account() {
  const [, params] = useRoute("/accounts/:accountId");
  const accountId = params?.accountId || "";
  const qc = useQueryClient();

  const { data: ws, isLoading, isError } = useAtelierGetAccountWorkspace(accountId, {
    query: {
      enabled: !!accountId,
      queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId),
      // While Cartographer is auto-running on a freshly-created account
      // we poll so the Profile tab updates without a manual refresh.
      refetchInterval: (q) => {
        const data = q.state.data as AtelierAccountWorkspace | undefined;
        return data?.account?.cartographerStatus === "running" ? 4000 : false;
      },
    },
  });
  const refresh = useAtelierRefreshAccountCartographer();
  const [tab, setTab] = useState<TabKey>("profile");

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });

  if (isLoading) {
    return (
      <div className="container-atelier py-12">
        <Skeleton className="h-64 bg-bg-elevate" />
      </div>
    );
  }
  if (isError || !ws) {
    return (
      <div className="container-atelier py-12 text-danger font-mono text-sm">
        Account not found.
      </div>
    );
  }

  const a = ws.account;
  const pending = (a.pendingProfileUpdates ?? []).filter((p) => p.status === "pending");

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/crm">Back to Accounts</BackLink>

        <div className="flex items-start justify-between gap-6 flex-wrap">
          <SectionHead
            eyebrow={
              <span className="inline-flex items-center gap-2">
                <Globe className="w-3.5 h-3.5" /> {a.country} · {a.sector}
                {a.hqCity && ` · HQ ${a.hqCity}`}
              </span>
            }
            headline={a.brandName ?? a.name}
            lede={
              a.brandName && a.brandName !== a.name
                ? `${a.name}${a.notes ? ` — ${a.notes}` : ""}`
                : a.notes ?? undefined
            }
          />
          <div className="flex items-center gap-3">
            <MonoChip tone={a.tier === "A" ? "gold" : a.tier === "B" ? "green" : "default"}>
              Tier {a.tier}
            </MonoChip>
            <MonoChip>{a.status}</MonoChip>
            {a.cartographerStatus === "running" ? (
              <span
                className="pill-btn pill-btn-ghost text-xs cursor-default"
                data-testid="banner-cartographer-running"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Cartographer researching…
              </span>
            ) : (
              <button
                onClick={() =>
                  refresh.mutate(
                    { accountId, data: {} },
                    { onSuccess: () => invalidate() },
                  )
                }
                disabled={refresh.isPending}
                className="pill-btn pill-btn-ghost text-xs"
                data-testid="button-cartographer-refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
                Refresh from web
              </button>
            )}
          </div>
        </div>
        {a.cartographerStatus === "failed" && (
          <div
            className="mt-4 border border-danger/40 bg-danger/10 rounded p-3 text-xs font-mono text-danger flex items-center justify-between"
            data-testid="banner-cartographer-failed"
          >
            <span>Account Cartographer auto-run failed. Click Cartographer ★ to retry.</span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-8">
          <HeroStat value={a.openOpportunityCount} caption="Open opportunities" size="md" />
          <HeroStat value={a.activeEngagementCount} caption="Active engagements" size="md" />
          <HeroStat value={ws.contacts.length} caption="Decision-makers" size="md" />
          <HeroStat
            value={`${Math.round(a.relationshipStrength)}`}
            caption="Relationship strength /100"
            size="md"
          />
        </div>
      </PageHero>

      <div className="container-atelier pt-6">
        <TabNav>
          {TABS.map((t) => (
            <TabNavItem
              key={t.key}
              active={tab === t.key}
              onClick={() => setTab(t.key)}
              data-testid={`tab-${t.key}`}
            >
              <span className="inline-flex items-center gap-1.5">
                {t.icon}
                {t.label}
                {t.key === "decision_makers" && ws.contacts.length > 0 && (
                  <span className="text-text-faint">({ws.contacts.length})</span>
                )}
              </span>
            </TabNavItem>
          ))}
        </TabNav>
      </div>

      <div className="container-atelier py-8">
        {tab === "profile" && (
          <ProfileTab
            ws={ws}
            pending={pending}
            onDecide={(updateId, decision, editedValue) => {
              decideProfileMut(qc, accountId, updateId, decision, editedValue);
            }}
            onBulkDecide={(decision, updateIds) => {
              bulkDecideProfileMut(qc, accountId, decision, updateIds);
            }}
          />
        )}
        {tab === "decision_makers" && (
          <DecisionMakersTab
            contacts={ws.contacts}
            relationships={ws.relationships}
            accountId={accountId}
          />
        )}
        {tab === "opportunities" && <OpportunitiesTab opps={ws.opportunities} />}
        {tab === "engagements" && <EngagementsTab engs={ws.engagements} />}
        {tab === "relationships" && (
          <RelationshipsTab
            contacts={ws.contacts}
            relationships={ws.relationships}
          />
        )}
        {tab === "whitespace" && <WhitespaceTab accountId={accountId} />}
        {tab === "qbr" && <QbrTab accountId={accountId} />}
        {tab === "audit" && <AuditTab accountId={ws.account.id} events={ws.audit} />}
      </div>
    </div>
  );
}

// --- helpers ---

function decideProfileMut(
  qc: ReturnType<typeof useQueryClient>,
  accountId: string,
  updateId: string,
  decision: "approve" | "reject",
  editedValue?: unknown,
) {
  // imperative call so we don't need to thread the hook through every prop.
  // When `editedValue` is provided the partner approved an inline-edited
  // value (Task #568); the backend applies it instead of the AI's proposal.
  const body: { decision: "approve" | "reject"; editedValue?: unknown } = { decision };
  if (decision === "approve" && editedValue !== undefined) body.editedValue = editedValue;
  fetch(
    `${import.meta.env.BASE_URL}api/atelier/accounts/${accountId}/profile-updates/${updateId}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    },
  ).then(() => qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) }));
}

function bulkDecideProfileMut(
  qc: ReturnType<typeof useQueryClient>,
  accountId: string,
  decision: "approve" | "reject",
  updateIds?: string[],
) {
  const body: { decision: "approve" | "reject"; updateIds?: string[] } = { decision };
  if (updateIds && updateIds.length > 0) body.updateIds = updateIds;
  fetch(
    `${import.meta.env.BASE_URL}api/atelier/accounts/${accountId}/profile-updates/bulk-decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    },
  ).then(() => qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) }));
}

// --- tabs ---

function SourceLinks({ urls, testid }: { urls: string[]; testid: string }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {urls.slice(0, 4).map((u, j) => (
        <a
          key={j}
          href={u}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono uppercase tracking-wider text-text-faint hover:text-gold inline-flex items-center gap-1"
          data-testid={`${testid}-${j}`}
        >
          source {j + 1}
          <ExternalLink className="w-3 h-3" />
        </a>
      ))}
    </div>
  );
}

function BriefSection({
  title,
  count,
  defaultOpen = false,
  children,
  testid,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  testid: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-border-soft rounded">
      <CollapsibleTrigger
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-bg-deep/50 transition-colors"
        data-testid={`trigger-brief-${testid}`}
      >
        <span className="font-mono uppercase tracking-wider text-xs text-text-mute flex items-center gap-2">
          {title}
          {typeof count === "number" && count > 0 && <MonoChip>{count}</MonoChip>}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-text-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FactList({ facts, testid }: { facts: { text: string; evidence: string; sourceUrls: string[] }[]; testid: string }) {
  return (
    <ul className="space-y-3">
      {facts.map((f, i) => (
        <li key={i} className="text-sm text-text">
          <div>{f.text}</div>
          {f.evidence && <div className="text-text-mute text-xs mt-0.5 italic">{f.evidence}</div>}
          <SourceLinks urls={f.sourceUrls} testid={`link-${testid}-${i}`} />
        </li>
      ))}
    </ul>
  );
}

function ProfileTab({
  ws,
  pending,
  onDecide,
  onBulkDecide,
}: {
  ws: AtelierAccountWorkspace;
  pending: AtelierProfileUpdateProposal[];
  onDecide: (id: string, d: "approve" | "reject", editedValue?: unknown) => void;
  onBulkDecide: (d: "approve" | "reject", updateIds?: string[]) => void;
}) {
  const a = ws.account;
  const [editStrategy, setEditStrategy] = useState(false);
  const brief = a.researchBrief ?? null;
  const strat = a.accountStrategy ?? null;
  const competitors = a.competitors ?? [];
  const hasStrategy =
    !!strat &&
    ((strat.objectives ?? []).length > 0 ||
      (strat.targetServiceLines ?? []).length > 0 ||
      !!strat.winHypothesis ||
      (strat.keyPlays ?? []).length > 0);

  return (
    <>
      <EditAccountStrategyDialog
        account={a}
        accountId={a.id}
        open={editStrategy}
        onOpenChange={setEditStrategy}
      />

      {/* At-a-glance callout */}
      {brief?.singleMostImportant && (
        <Card className="p-5 mb-6 border-gold/40 bg-gold/5">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-gold shrink-0 mt-0.5" />
            <div>
              <Eyebrow>The one thing that matters</Eyebrow>
              <p className="text-text leading-relaxed mt-1">{brief.singleMostImportant}</p>
              {brief.whyNowHypothesis && (
                <p className="text-text-mute text-sm mt-2">
                  <span className="font-mono uppercase tracking-wider text-xs text-text-faint">
                    Why now:{" "}
                  </span>
                  {brief.whyNowHypothesis}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Cognirise Account Strategy */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <SectionLabel>
                <span className="inline-flex items-center gap-2">
                  <Target className="w-4 h-4 text-gold" /> Cognirise account strategy
                </span>
              </SectionLabel>
              <PillButton
                variant="ghost"
                onClick={() => setEditStrategy(true)}
                className="text-xs"
                data-testid="button-edit-strategy"
              >
                <Pencil className="w-3 h-3" /> Edit
              </PillButton>
            </div>
            {!hasStrategy ? (
              <p className="text-text-mute italic text-sm">
                No strategy recorded yet — click Edit to define objectives, target service lines,
                the win hypothesis, and key plays.
              </p>
            ) : (
              <div className="space-y-5">
                {(strat?.objectives ?? []).length > 0 && (
                  <div>
                    <Eyebrow>Objectives</Eyebrow>
                    <ul className="space-y-2 mt-2">
                      {(strat?.objectives ?? []).map((o) => (
                        <li key={o.id} className="flex items-start gap-2 text-text text-sm">
                          <span className="text-gold mt-1">·</span>
                          <div className="flex-1">
                            <span>{o.text}</span>
                            {(o.targetValue || o.targetDate) && (
                              <span className="ml-2 inline-flex gap-1.5">
                                {o.targetValue && <MonoChip tone="green">{o.targetValue}</MonoChip>}
                                {o.targetDate && <MonoChip tone="amber">{o.targetDate}</MonoChip>}
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(strat?.targetServiceLines ?? []).length > 0 && (
                  <div>
                    <Eyebrow>Target service lines</Eyebrow>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(strat?.targetServiceLines ?? []).map((sl, i) => (
                        <MonoChip key={i}>{sl}</MonoChip>
                      ))}
                    </div>
                  </div>
                )}
                {strat?.winHypothesis && (
                  <div>
                    <Eyebrow>Win hypothesis</Eyebrow>
                    <p className="text-text text-sm mt-1 leading-relaxed">{strat.winHypothesis}</p>
                  </div>
                )}
                {(strat?.keyPlays ?? []).length > 0 && (
                  <div>
                    <Eyebrow>Key plays</Eyebrow>
                    <ul className="space-y-1.5 mt-2">
                      {(strat?.keyPlays ?? []).map((p, i) => (
                        <li key={i} className="flex items-start gap-2 text-text text-sm">
                          <span className="text-gold mt-1">·</span>
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Competitive landscape */}
          <Card className="p-6 space-y-4">
            <SectionLabel>
              <span className="inline-flex items-center gap-2">
                <Swords className="w-4 h-4 text-gold" /> Competitive landscape
              </span>
            </SectionLabel>
            {competitors.length === 0 ? (
              <p className="text-text-mute italic text-sm">No competitors recorded.</p>
            ) : (
              <div className="space-y-3">
                {competitors.map((c) => (
                  <div key={c.id} className="border border-border-soft rounded p-3">
                    <div className="font-semibold text-text text-sm">{c.name}</div>
                    {c.holds && (
                      <p className="text-text-mute text-sm mt-1">
                        <span className="font-mono uppercase tracking-wider text-[10px] text-text-faint">
                          Holds:{" "}
                        </span>
                        {c.holds}
                      </p>
                    )}
                    {c.displacementAngle && (
                      <p className="text-text text-sm mt-1">
                        <span className="font-mono uppercase tracking-wider text-[10px] text-gold">
                          Our angle:{" "}
                        </span>
                        {c.displacementAngle}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Research brief — progressive disclosure */}
          {brief && (
            <Card className="p-6 space-y-3">
              <SectionLabel>
                <span className="inline-flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gold" /> Research brief
                </span>
              </SectionLabel>
              <div className="space-y-2">
                <BriefSection
                  title="What's changing"
                  count={brief.whatsChanging?.length}
                  defaultOpen
                  testid="whats-changing"
                >
                  <FactList facts={brief.whatsChanging ?? []} testid="whats-changing" />
                </BriefSection>

                <BriefSection
                  title="Executive tensions"
                  count={brief.executiveTensions?.length}
                  testid="executive-tensions"
                >
                  <FactList facts={brief.executiveTensions ?? []} testid="executive-tensions" />
                </BriefSection>

                <BriefSection
                  title="Service-line fit"
                  count={brief.serviceLineFit?.length}
                  testid="service-line-fit"
                >
                  <ul className="space-y-3">
                    {(brief.serviceLineFit ?? []).map((s, i) => (
                      <li key={i} className="text-sm text-text">
                        <span className="font-semibold">{s.serviceLine}</span> — {s.signal}
                        <SourceLinks urls={s.sourceUrls} testid={`link-slf-${i}`} />
                      </li>
                    ))}
                  </ul>
                </BriefSection>

                <BriefSection
                  title="Partner ecosystem"
                  count={brief.partnerEcosystem?.length}
                  testid="partner-ecosystem"
                >
                  <ul className="space-y-3">
                    {(brief.partnerEcosystem ?? []).map((p, i) => (
                      <li key={i} className="text-sm text-text">
                        <span className="font-semibold">{p.partner}</span> — {p.relationship}
                        {p.serviceLineGap && (
                          <div className="text-text-mute text-xs mt-0.5">Gap: {p.serviceLineGap}</div>
                        )}
                        <SourceLinks urls={p.sourceUrls} testid={`link-pe-${i}`} />
                      </li>
                    ))}
                  </ul>
                </BriefSection>

                <BriefSection
                  title="Mandate angles"
                  count={brief.mandateAngles?.length}
                  testid="mandate-angles"
                >
                  <div className="space-y-3">
                    {(brief.mandateAngles ?? []).map((m, i) => (
                      <div key={i} className="border border-border-soft rounded p-3">
                        <div className="font-semibold text-text text-sm">{m.title}</div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {(m.serviceLines ?? []).map((sl, j) => (
                            <MonoChip key={j}>{sl}</MonoChip>
                          ))}
                        </div>
                        <p className="text-text-mute text-xs mt-2">
                          <span className="text-text-faint">Tension:</span> {m.tension}
                        </p>
                        <p className="text-text-mute text-xs mt-1">
                          <span className="text-text-faint">Why now:</span> {m.whyNow}
                        </p>
                        <p className="text-text-mute text-xs mt-1">
                          <span className="text-text-faint">Entry:</span> {m.entryStakeholder}
                        </p>
                        <SourceLinks urls={m.sourceUrls} testid={`link-ma-${i}`} />
                      </div>
                    ))}
                  </div>
                </BriefSection>

                {(brief.openQuestions ?? []).length > 0 && (
                  <BriefSection
                    title="Open questions"
                    count={brief.openQuestions?.length}
                    testid="open-questions"
                  >
                    <ul className="space-y-2">
                      {(brief.openQuestions ?? []).map((q, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-text">
                          <HelpCircle className="w-3.5 h-3.5 text-text-faint shrink-0 mt-0.5" />
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  </BriefSection>
                )}
              </div>
            </Card>
          )}

          {/* Cognirise hypothesis */}
          <Card className="p-6 space-y-4">
            <SectionLabel>Cognirise hypothesis</SectionLabel>
            <p className="text-text leading-relaxed">
              {a.cogniriseHypothesis ?? (
                <span className="italic text-text-mute">
                  No hypothesis yet — run Cartographer ★ to seed one.
                </span>
              )}
            </p>
          </Card>

          {/* Strategic priorities */}
          <Card className="p-6 space-y-4">
            <SectionLabel>Strategic priorities</SectionLabel>
            {(a.strategicPriorities ?? []).length === 0 ? (
              <p className="text-text-mute italic text-sm">None recorded.</p>
            ) : (
              <ul className="space-y-3">
                {(a.strategicPriorities ?? []).map((p, i) => {
                  const refs = (a.strategicPriorityRefs ?? []).find((r) => r.text === p);
                  const sourceUrls = refs?.sourceUrls ?? [];
                  return (
                    <li key={i} className="flex gap-2 text-text">
                      <span className="text-gold mt-1">·</span>
                      <div className="flex-1">
                        <div>{p}</div>
                        <SourceLinks urls={sourceUrls} testid={`link-priority-source-${i}`} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Source signals */}
          <Card className="p-6 space-y-4">
            <SectionLabel>Source signals</SectionLabel>
            {(a.sourceSignals ?? []).length === 0 ? (
              <p className="text-text-mute italic text-sm">No signals yet.</p>
            ) : (
              <div className="space-y-3">
                {(a.sourceSignals ?? []).slice(-8).reverse().map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border border-border-soft rounded p-3 hover:border-gold/50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-text text-sm flex items-center gap-1.5">
                        {s.title}
                        <ExternalLink className="w-3 h-3 text-text-faint" />
                      </div>
                      <MonoChip tone={s.confidence === "green" ? "green" : s.confidence === "amber" ? "amber" : "default"}>
                        {s.kind}
                      </MonoChip>
                    </div>
                    {s.summary && (
                      <p className="text-text-mute text-sm mt-1 leading-snug">{s.summary}</p>
                    )}
                  </a>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {/* Hierarchy */}
          {(a.parent || (a.children ?? []).length > 0) && (
            <Card className="p-6 space-y-4">
              <SectionLabel>
                <span className="inline-flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-gold" /> Account hierarchy
                </span>
              </SectionLabel>
              {a.parent && (
                <div>
                  <Eyebrow>Parent</Eyebrow>
                  <Link
                    href={`/accounts/${a.parent.id}`}
                    className="block mt-1 text-text hover:text-gold transition-colors text-sm font-semibold"
                    data-testid={`link-parent-${a.parent.id}`}
                  >
                    {a.parent.brandName ?? a.parent.name}
                  </Link>
                </div>
              )}
              {(a.children ?? []).length > 0 && (
                <div>
                  <Eyebrow>Subsidiaries</Eyebrow>
                  <ul className="space-y-1.5 mt-1">
                    {(a.children ?? []).map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/accounts/${c.id}`}
                          className="flex items-center justify-between text-text hover:text-gold transition-colors text-sm"
                          data-testid={`link-child-${c.id}`}
                        >
                          <span>{c.brandName ?? c.name}</span>
                          {typeof c.tier === "number" && <MonoChip>T{c.tier}</MonoChip>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* Ownership */}
          <Card className="p-6 space-y-4">
            <SectionLabel>Ownership</SectionLabel>
            <dl className="space-y-2 text-sm">
              <Row label="Partner" value={a.partnerOwnerName ?? "—"} />
              <Row label="Tier" value={`Tier ${a.tier}`} />
              <Row label="Status" value={a.status} />
              <Row label="HQ" value={a.hqCity ?? a.country} />
              <Row label="Currency" value={a.primaryCurrency} />
              <Row label="Language" value={a.primaryLanguage} />
              <Row label="Last touch" value={a.lastTouchAt ? new Date(a.lastTouchAt).toLocaleDateString() : "—"} />
              <Row label="Last enriched" value={a.enrichedAt ? new Date(a.enrichedAt).toLocaleDateString() : "—"} />
            </dl>
          </Card>

          {/* AI proposals — partner review queue */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <SectionLabel>AI proposals for review</SectionLabel>
              {pending.length > 0 && <MonoChip tone="amber">{pending.length}</MonoChip>}
            </div>
            <p className="text-text-mute text-xs leading-relaxed">
              When you refresh from the web, the Account Cartographer{" "}
              <span className="text-text">proposes</span> changes here rather than
              writing them live. Review, edit if needed, then approve to apply.
            </p>
            {pending.length === 0 ? (
              <p className="text-text-mute italic text-sm">No pending proposals.</p>
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    onClick={() => onBulkDecide("approve")}
                    className="pill-btn pill-btn-primary text-xs"
                    data-testid="button-approve-all"
                  >
                    <Check className="w-3 h-3" /> Approve all
                  </button>
                  <button
                    onClick={() => onBulkDecide("reject")}
                    className="pill-btn pill-btn-ghost text-xs"
                    data-testid="button-reject-all"
                  >
                    <X className="w-3 h-3" /> Reject all
                  </button>
                </div>
                <div className="space-y-3">
                  {pending.map((p) => (
                    <PendingProposalCard key={p.id} proposal={p} onDecide={onDecide} />
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

// Task #568 — a single AI proposal with inline edit-before-approve. Scalar,
// string-array and contact proposals are editable; complex blobs
// (researchBrief, sourceSignals) are approve/reject as-is (still governed).
const PROPOSAL_FIELD_LABELS: Record<string, string> = {
  cogniriseHypothesis: "Cognirise win hypothesis",
  strategicPriorities: "Strategic priorities",
  researchBrief: "Research brief",
  sourceSignals: "Source signals",
  contact: "Decision-maker",
  sector: "Sector",
  hqCity: "HQ city",
  size: "Company size",
};

function PendingProposalCard({
  proposal,
  onDecide,
}: {
  proposal: AtelierProfileUpdateProposal;
  onDecide: (id: string, d: "approve" | "reject", editedValue?: unknown) => void;
}) {
  const p = proposal;
  const isScalar =
    p.field === "cogniriseHypothesis" ||
    p.field === "sector" ||
    p.field === "hqCity" ||
    p.field === "size";
  const isArray = p.field === "strategicPriorities";
  const isContact = p.field === "contact";
  const editable = isScalar || isArray || isContact;
  const label = PROPOSAL_FIELD_LABELS[p.field] ?? p.field;

  const [editing, setEditing] = useState(false);
  const [scalarVal, setScalarVal] = useState(
    typeof p.toValue === "string" ? p.toValue : "",
  );
  const [arrayVal, setArrayVal] = useState(
    Array.isArray(p.toValue) ? (p.toValue as string[]).join("\n") : "",
  );
  const contactObj = (p.toValue ?? {}) as {
    fullName?: string;
    title?: string | null;
    seniority?: string | null;
    buyerPersona?: string | null;
  };
  const [contactName, setContactName] = useState(contactObj.fullName ?? "");
  const [contactTitle, setContactTitle] = useState(contactObj.title ?? "");
  const [contactSeniority, setContactSeniority] = useState(contactObj.seniority ?? "");
  const [contactPersona, setContactPersona] = useState(contactObj.buyerPersona ?? "");

  const approve = () => {
    if (!editing) {
      onDecide(p.id, "approve");
      return;
    }
    let edited: unknown;
    if (isScalar) edited = scalarVal.trim();
    else if (isArray)
      edited = arrayVal
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    else if (isContact)
      edited = {
        ...contactObj,
        fullName: contactName.trim(),
        title: contactTitle.trim() || null,
        seniority: contactSeniority.trim() || null,
        buyerPersona: contactPersona.trim() || null,
      };
    onDecide(p.id, "approve", edited);
  };

  return (
    <div className="border border-amber/30 rounded p-3 bg-amber/5">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        {editable && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-[10px] font-mono uppercase tracking-wider text-text-faint hover:text-gold inline-flex items-center gap-1"
            data-testid={`button-edit-${p.id}`}
          >
            <Pencil className="w-3 h-3" /> {editing ? "Cancel" : "Edit"}
          </button>
        )}
      </div>
      <p className="text-text-mute text-xs mt-1">{p.rationale}</p>

      {/* Proposed value */}
      {!editing ? (
        <div className="mt-2 text-sm text-text">
          {isArray && Array.isArray(p.toValue) ? (
            <ul className="list-disc list-inside space-y-0.5">
              {(p.toValue as string[]).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ) : isContact ? (
            <div className="space-y-0.5">
              <div className="font-medium">{contactObj.fullName}</div>
              {contactObj.title && <div className="text-text-mute text-xs">{contactObj.title}</div>}
            </div>
          ) : isScalar ? (
            <p className="leading-relaxed">{String(p.toValue ?? "")}</p>
          ) : (
            <p className="text-text-mute text-xs italic">
              {p.field === "sourceSignals" && Array.isArray(p.toValue)
                ? `${(p.toValue as unknown[]).length} signal(s) proposed`
                : "Structured content — approve to apply, or reject."}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {isScalar && (
            <textarea
              value={scalarVal}
              onChange={(e) => setScalarVal(e.target.value)}
              rows={p.field === "cogniriseHypothesis" ? 4 : 2}
              className="w-full text-sm bg-surface border border-line rounded p-2 text-text"
              data-testid={`input-edit-${p.id}`}
            />
          )}
          {isArray && (
            <textarea
              value={arrayVal}
              onChange={(e) => setArrayVal(e.target.value)}
              rows={5}
              placeholder="One priority per line"
              className="w-full text-sm bg-surface border border-line rounded p-2 text-text"
              data-testid={`input-edit-${p.id}`}
            />
          )}
          {isContact && (
            <div className="space-y-2">
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Full name"
                className="w-full text-sm bg-surface border border-line rounded p-2 text-text"
                data-testid={`input-edit-name-${p.id}`}
              />
              <input
                value={contactTitle}
                onChange={(e) => setContactTitle(e.target.value)}
                placeholder="Title"
                className="w-full text-sm bg-surface border border-line rounded p-2 text-text"
                data-testid={`input-edit-title-${p.id}`}
              />
              <select
                value={contactSeniority}
                onChange={(e) => setContactSeniority(e.target.value)}
                className="w-full text-sm bg-surface border border-line rounded p-2 text-text"
                data-testid={`select-edit-seniority-${p.id}`}
              >
                <option value="">Seniority —</option>
                {["c_suite", "vp", "director", "manager", "ic"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                value={contactPersona}
                onChange={(e) => setContactPersona(e.target.value)}
                placeholder="Buyer persona"
                className="w-full text-sm bg-surface border border-line rounded p-2 text-text"
                data-testid={`input-edit-persona-${p.id}`}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={approve}
          className="pill-btn pill-btn-primary text-xs"
          data-testid={`button-approve-${p.id}`}
        >
          <Check className="w-3 h-3" /> {editing ? "Save & approve" : "Approve"}
        </button>
        <button
          onClick={() => onDecide(p.id, "reject")}
          className="pill-btn pill-btn-ghost text-xs"
          data-testid={`button-reject-${p.id}`}
        >
          <X className="w-3 h-3" /> Reject
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="font-mono uppercase tracking-wider text-xs text-text-mute">{label}</dt>
      <dd className="text-right text-text">{value}</dd>
    </div>
  );
}

function DecisionMakersTab({
  contacts,
  relationships,
  accountId,
}: {
  contacts: AtelierContact[];
  relationships: AtelierContactRelationship[];
  accountId: string;
}) {
  const updateDisp = useAtelierUpdateContactDisposition();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [insightsId, setInsightsId] = useState<string | null>(null);
  const editing = editingId ? contacts.find((c) => c.id === editingId) ?? null : null;
  const insights = insightsId ? contacts.find((c) => c.id === insightsId) ?? null : null;
  if (contacts.length === 0) {
    return (
      <Card className="p-8 text-center text-text-mute font-mono text-sm space-y-4">
        <div>No contacts mapped yet for this account.</div>
        <CreateContactDialog
          accountId={accountId}
          trigger={
            <PillButton variant="primary" data-testid="button-add-contact-empty">
              + Add contact
            </PillButton>
          }
        />
      </Card>
    );
  }
  const selected = selectedId ? contacts.find((c) => c.id === selectedId) ?? null : null;
  return (
    <div className="space-y-6">
      {editing && (
        <EditContactDialog
          contact={editing}
          accountId={accountId}
          open={!!editingId}
          onOpenChange={(o) => !o && setEditingId(null)}
        />
      )}
      {insights && (
        <ContactInsightsDialog
          contact={insights}
          accountId={accountId}
          contacts={contacts}
          relationships={relationships}
          open={!!insightsId}
          onOpenChange={(o) => !o && setInsightsId(null)}
          onEdit={() => {
            setEditingId(insights.id);
            setInsightsId(null);
          }}
        />
      )}
      <div className="flex items-center justify-between">
        <SectionLabel>Decision-makers</SectionLabel>
        <CreateContactDialog
          accountId={accountId}
          trigger={
            <PillButton variant="primary" data-testid="button-add-contact">
              + Add contact
            </PillButton>
          }
        />
      </div>
      <CoverageGapCard contacts={contacts} />
      <DecisionMakersGraph
        contacts={contacts}
        relationships={relationships}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          setInsightsId(id);
        }}
      />
      {selected && (
        <Card className="p-5 border-gold/40" data-testid={`panel-contact-${selected.id}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Eyebrow>Contact</Eyebrow>
              <div className="text-lg font-semibold text-text mt-1">{selected.fullName}</div>
              <div className="text-xs font-mono text-text-mute">
                {selected.title ?? "—"}
                {selected.seniority && ` · ${selected.seniority}`}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditingId(selected.id)}
                className="text-xs font-mono text-gold hover:underline"
                data-testid={`button-edit-contact-${selected.id}`}
              >
                edit
              </button>
              <button
                onClick={() => setSelectedId(null)}
                className="text-xs font-mono text-text-mute hover:text-text"
                data-testid="button-close-contact-panel"
              >
                close ✕
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <MonoChip tone={DISPOSITION_TONE[selected.disposition]}>{selected.disposition}</MonoChip>
            {selected.buyerPersona && <MonoChip>{selected.buyerPersona}</MonoChip>}
            <MonoChip tone="gold">Influence {selected.influenceScore}/5</MonoChip>
            {selected.email && <MonoChip>{selected.email}</MonoChip>}
            {selected.sourceUrl ? (
              <a
                href={selected.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={selected.sourceUrl}
                onClick={(e) => e.stopPropagation()}
                data-testid={`link-contact-source-${selected.id}`}
              >
                <MonoChip tone={selected.confidence === "verified" ? "green" : "amber"}>
                  {selected.confidence}
                </MonoChip>
              </a>
            ) : (
              <span title="No citation URL — title/role inferred from org-chart heuristics.">
                <MonoChip tone={selected.confidence === "verified" ? "green" : "amber"}>
                  {selected.confidence}
                </MonoChip>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3 text-xs font-mono text-text-mute">
            <div>
              <Eyebrow>Last contact</Eyebrow>
              <div className="mt-1 text-text">
                {selected.lastContactAt
                  ? new Date(selected.lastContactAt).toLocaleDateString()
                  : "—"}
              </div>
            </div>
            <div>
              <Eyebrow>LinkedIn</Eyebrow>
              <div className="mt-1">
                {selected.linkedinUrl ? (
                  <a
                    href={selected.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold hover:underline break-all"
                    data-testid={`link-linkedin-${selected.id}`}
                  >
                    {selected.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                ) : (
                  <span className="text-text-mute">—</span>
                )}
              </div>
            </div>
          </div>
          {selected.notes && (
            <p className="text-sm text-text-mute leading-snug border-t border-border-soft pt-3 mt-3">
              {selected.notes}
            </p>
          )}
        </Card>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {contacts.map((c) => (
        <Card
          key={c.id}
          onClick={() => setSelectedId(c.id)}
          className={`p-5 space-y-3 cursor-pointer transition-colors ${selectedId === c.id ? "border-gold/60" : "hover:border-border"}`}
          data-testid={`card-contact-${c.id}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-text">{c.fullName}</div>
              <div className="text-xs font-mono text-text-mute mt-0.5">
                {c.title ?? "—"}
                {c.seniority && ` · ${c.seniority}`}
              </div>
            </div>
            <MonoChip tone={DISPOSITION_TONE[c.disposition]}>{c.disposition}</MonoChip>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.buyerPersona && <MonoChip>{c.buyerPersona}</MonoChip>}
            <MonoChip tone="gold">Influence {c.influenceScore}/5</MonoChip>
            {c.email && <MonoChip>{c.email}</MonoChip>}
            {c.sourceUrl ? (
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={c.sourceUrl}
                onClick={(e) => e.stopPropagation()}
                data-testid={`link-contact-source-card-${c.id}`}
              >
                <MonoChip tone={c.confidence === "verified" ? "green" : "amber"}>
                  {c.confidence}
                </MonoChip>
              </a>
            ) : (
              <span title="No citation URL — title/role inferred from org-chart heuristics.">
                <MonoChip tone={c.confidence === "verified" ? "green" : "amber"}>
                  {c.confidence}
                </MonoChip>
              </span>
            )}
          </div>
          {c.notes && (
            <p className="text-sm text-text-mute leading-snug border-t border-border-soft pt-3">
              {c.notes}
            </p>
          )}
          <div
            className="flex flex-wrap gap-1.5 pt-2 border-t border-border-soft"
            onClick={(e) => e.stopPropagation()}
          >
            {(["champion", "supporter", "neutral", "skeptic", "blocker"] as AtelierContactDisposition[]).map((d) => (
              <button
                key={d}
                onClick={() =>
                  updateDisp.mutate(
                    { contactId: c.id, data: { disposition: d } },
                    {
                      onSuccess: () =>
                        qc.invalidateQueries({
                          queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId),
                        }),
                    },
                  )
                }
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border transition-colors ${
                  c.disposition === d
                    ? "border-gold text-gold"
                    : "border-border text-text-mute hover:border-text-mute hover:text-text"
                }`}
                data-testid={`button-disposition-${c.id}-${d}`}
              >
                {d}
              </button>
            ))}
            <button
              onClick={() => setEditingId(c.id)}
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-gold/50 text-gold hover:bg-gold/10 transition-colors ml-auto"
              data-testid={`button-edit-contact-card-${c.id}`}
            >
              edit
            </button>
          </div>
        </Card>
      ))}
      </div>
    </div>
  );
}

function CoverageGapCard({ contacts }: { contacts: AtelierContact[] }) {
  const mapped = new Set(
    contacts
      .map((c) => (c.buyerPersona ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const norm = (p: string) => p.replace(/[\s-]+/g, "_").toLowerCase();
  const missing = EXPECTED_PERSONAS.filter(
    (p) => ![...mapped].some((m) => norm(m) === p),
  );
  const covered = EXPECTED_PERSONAS.length - missing.length;
  return (
    <Card className="p-4" data-testid="card-coverage-gap">
      <div className="flex items-center justify-between">
        <Eyebrow>Buying-committee coverage</Eyebrow>
        <span
          className={`text-xs font-mono ${missing.length === 0 ? "text-green-400" : "text-amber-400"}`}
        >
          {covered}/{EXPECTED_PERSONAS.length} mapped
        </span>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {EXPECTED_PERSONAS.map((p) => {
          const isMissing = missing.includes(p);
          const label = p.replace(/_/g, " ");
          return (
            <span
              key={p}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${
                isMissing
                  ? "border-amber-500/50 text-amber-400"
                  : "border-green-600/40 text-green-400"
              }`}
              data-testid={`coverage-persona-${p}`}
            >
              {isMissing ? "○" : "●"} {label}
            </span>
          );
        })}
      </div>
      {missing.length > 0 && (
        <p className="text-xs text-text-mute font-mono mt-3 leading-snug">
          Gap: no contact mapped to {missing.map((m) => m.replace(/_/g, " ")).join(", ")}.
          Map these personas to de-risk the deal.
        </p>
      )}
    </Card>
  );
}

function DecisionMakersGraph({
  contacts,
  relationships,
  selectedId,
  onSelect,
}: {
  contacts: AtelierContact[];
  relationships: AtelierContactRelationship[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Layered layout: roots (no incoming reports_to) on top, descendants below.
  const reportsTo = relationships.filter((r) => r.type === "reports_to");
  const childToParent = new Map(reportsTo.map((r) => [r.fromContactId, r.toContactId]));
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const p = childToParent.get(id);
    return p ? 1 + depth(p, seen) : 0;
  };
  const layers: AtelierContact[][] = [];
  contacts.forEach((c) => {
    const d = depth(c.id);
    if (!layers[d]) layers[d] = [];
    layers[d].push(c);
  });
  const W = 880;
  const ROW_H = 110;
  const H = Math.max(220, layers.length * ROW_H + 40);
  const NODE_W = 150;
  const NODE_H = 56;
  const positions = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, depthIdx) => {
    const step = W / (layer.length + 1);
    layer.forEach((c, i) => {
      positions.set(c.id, { x: step * (i + 1), y: 40 + depthIdx * ROW_H });
    });
  });
  // Mirror DISPOSITION_TONE per PRD §6.2: Cognirise accent for
  // champion/supporter, mute for neutral/unknown, danger for skeptic/blocker.
  const dispositionFill: Record<string, string> = {
    champion: "#C45BB8",
    supporter: "#8A5BD6",
    neutral: "#1B2755",
    unknown: "#1B2755",
    skeptic: "#7B1F1F",
    blocker: "#7B1F1F",
  };
  return (
    <Card className="p-4 overflow-x-auto">
      <Eyebrow>Influence Map</Eyebrow>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full h-auto"
        data-testid="decision-makers-graph"
      >
        {relationships.map((r) => {
          const a = positions.get(r.fromContactId);
          const b = positions.get(r.toContactId);
          if (!a || !b) return null;
          const stroke =
            r.type === "blocks" ? "#a83232" : r.type === "partners_with" ? "#C45BB8" : "#3a4a6e";
          const dash = r.type === "partners_with" ? "4 3" : undefined;
          return (
            <line
              key={r.id}
              x1={a.x}
              y1={a.y + NODE_H / 2}
              x2={b.x}
              y2={b.y - NODE_H / 2}
              stroke={stroke}
              strokeWidth={1.5}
              strokeDasharray={dash}
              opacity={0.7}
            />
          );
        })}
        {contacts.map((c) => {
          const p = positions.get(c.id);
          if (!p) return null;
          const isSel = selectedId === c.id;
          return (
            <g
              key={c.id}
              transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`}
              onClick={() => onSelect(c.id)}
              style={{ cursor: "pointer" }}
              data-testid={`graph-node-${c.id}`}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={dispositionFill[c.disposition] ?? "#1B2755"}
                stroke={isSel ? "#C45BB8" : "#2c3a5c"}
                strokeWidth={isSel ? 2 : 1}
              />
              <text x={NODE_W / 2} y={18} textAnchor="middle" fontSize={11} fontWeight={600} fill="#EEF1FA">
                {c.fullName.length > 22 ? c.fullName.slice(0, 20) + "…" : c.fullName}
              </text>
              <text x={NODE_W / 2} y={31} textAnchor="middle" fontSize={9} fill="#9BA8C9" fontFamily="monospace">
                {(c.title ?? "—").slice(0, 24)}
              </text>
              <text x={8} y={43} fontSize={8} fill="#C45BB8" fontFamily="monospace">
                infl {c.influenceScore}/5
              </text>
              {/* Strength meter — fill width = relationship strength 0–100 */}
              <rect x={8} y={46} width={NODE_W - 16} height={5} rx={2.5} fill="#0E1530" />
              <rect
                x={8}
                y={46}
                width={Math.max(0, Math.min(100, c.relationshipStrength ?? 0)) / 100 * (NODE_W - 16)}
                height={5}
                rx={2.5}
                fill={strengthFill(c.relationshipStrength ?? 0)}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-2 text-[10px] font-mono text-text-mute">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#C45BB8] mr-1" />champion</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#8A5BD6] mr-1" />supporter</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#1B2755] mr-1" />neutral</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#7B1F1F] mr-1" />skeptic / blocker</span>
        <span><span className="inline-block w-3 h-px bg-[#3a4a6e] mr-1 align-middle" />reports_to</span>
        <span><span className="inline-block w-3 h-px bg-[#a83232] mr-1 align-middle" />blocks</span>
        <span><span className="inline-block w-3 h-px border-t border-dashed border-[#C45BB8] mr-1 align-middle" />partners_with</span>
      </div>
    </Card>
  );
}

function OpportunitiesTab({
  opps,
}: {
  opps: AtelierAccountWorkspace["opportunities"];
}) {
  if (opps.length === 0) {
    return (
      <Card className="p-8 text-center text-text-mute font-mono text-sm">
        No opportunities for this account.
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {opps.map((o) => (
        <Card key={o.id} className="p-5 hover:border-gold/50 transition-colors">
          <Link
            href={`/pipeline/${o.id}`}
            className="font-semibold text-text hover:text-gold transition-colors block"
          >
            {o.name}
          </Link>
          <div className="flex flex-wrap gap-2 mt-3">
            <PlmPill stage={o.plmStage} />
            {/* Task #296 — surface canonical sales-stage alongside PLM
                so the account view groups by the 5-band funnel too. */}
            {(o as { salesStage?: string }).salesStage && (
              <MonoChip tone="gold">
                {((o as { salesStage?: string }).salesStage ?? "")
                  .replace(/_/g, " ")
                  .toUpperCase()}
              </MonoChip>
            )}
            <MonoChip>${(o.dealValueUsd / 1000).toFixed(0)}k</MonoChip>
            {o.winProbabilityPct != null && <MonoChip tone="amber">{o.winProbabilityPct}%</MonoChip>}
            {o.leadName && <MonoChip>Lead: {o.leadName}</MonoChip>}
          </div>
          {o.nextMilestone && (
            <p className="text-sm text-text-mute mt-3">Next: {o.nextMilestone}</p>
          )}
        </Card>
      ))}
    </div>
  );
}

function EngagementsTab({
  engs,
}: {
  engs: AtelierAccountWorkspace["engagements"];
}) {
  if (engs.length === 0) {
    return (
      <Card className="p-8 text-center text-text-mute font-mono text-sm">
        No active engagements for this account.
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {engs.map((e) => (
        <Card key={e.id} className="p-5 hover:border-gold/50 transition-colors">
          <Link
            href={`/clients/deliver/engagements/${e.id}`}
            className="font-semibold text-text hover:text-gold transition-colors block"
          >
            {e.title}
          </Link>
          <div className="flex flex-wrap gap-2 mt-3">
            <MonoChip>{e.status}</MonoChip>
            {e.leadName && <MonoChip>Lead: {e.leadName}</MonoChip>}
            {e.startedAt && <MonoChip>Since {new Date(e.startedAt).toLocaleDateString()}</MonoChip>}
          </div>
        </Card>
      ))}
    </div>
  );
}

function RelationshipsTab({
  contacts,
  relationships,
}: {
  contacts: AtelierContact[];
  relationships: AtelierContactRelationship[];
}) {
  if (contacts.length === 0) {
    return (
      <Card className="p-8 text-center text-text-mute font-mono text-sm">
        No org chart yet — add contacts on the Decision-Makers tab.
      </Card>
    );
  }
  // Group: top-level (no incoming reports_to) → reports under each.
  const reportsTo = relationships.filter((r) => r.type === "reports_to");
  const partnersWith = relationships.filter((r) => r.type === "partners_with");
  const blocks = relationships.filter((r) => r.type === "blocks");
  const hasManager = new Set(reportsTo.map((r) => r.fromContactId));
  const roots = contacts.filter((c) => !hasManager.has(c.id));
  const childrenOf = (id: string) =>
    reportsTo.filter((r) => r.toContactId === id).map((r) => contacts.find((c) => c.id === r.fromContactId)!).filter(Boolean);

  const renderNode = (c: AtelierContact, depth = 0): React.ReactNode => (
    <div key={c.id} className="space-y-2" style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center gap-3 border border-border rounded-md bg-bg-elevate px-3 py-2">
        <div className="flex-1">
          <div className="text-sm font-semibold text-text">{c.fullName}</div>
          <div className="text-xs font-mono text-text-mute">{c.title ?? "—"}</div>
        </div>
        <MonoChip tone={DISPOSITION_TONE[c.disposition]}>{c.disposition}</MonoChip>
      </div>
      {childrenOf(c.id).map((child) => renderNode(child, depth + 1))}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2 p-6 space-y-4">
        <SectionLabel>Reporting structure</SectionLabel>
        <div className="space-y-3">{roots.map((r) => renderNode(r))}</div>
      </Card>
      <Card className="p-6 space-y-4">
        <SectionLabel>Cross-links</SectionLabel>
        {partnersWith.length === 0 && blocks.length === 0 ? (
          <p className="text-text-mute italic text-sm">No partners-with or blocks edges recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {partnersWith.map((r) => {
              const a = contacts.find((c) => c.id === r.fromContactId);
              const b = contacts.find((c) => c.id === r.toContactId);
              return (
                <li key={r.id} className="text-text">
                  <span className="text-text-mute font-mono text-xs">⟷ partners</span>{" "}
                  {a?.fullName} ⟷ {b?.fullName}
                </li>
              );
            })}
            {blocks.map((r) => {
              const a = contacts.find((c) => c.id === r.fromContactId);
              const b = contacts.find((c) => c.id === r.toContactId);
              return (
                <li key={r.id} className="text-danger">
                  <span className="font-mono text-xs">✕ blocks</span> {a?.fullName} → {b?.fullName}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function WhitespaceTab({ accountId }: { accountId: string }) {
  const { data, isLoading } = useAtelierGetAccountWhitespace(accountId);
  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  if (!data) return null;
  const stateColor: Record<string, string> = {
    empty: "bg-bg-elevate text-text-faint",
    identified: "bg-amber/10 text-amber border-amber/30",
    qualified: "bg-gold/10 text-gold border-gold/30",
    won: "bg-success/10 text-success border-success/40",
  };
  return (
    <div className="space-y-6">
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left font-mono uppercase tracking-wider text-xs text-text-mute"></th>
              {data.personas.map((p) => (
                <th key={p} className="p-2 font-mono uppercase tracking-wider text-xs text-text-mute">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.offerings.map((o) => (
              <tr key={o} className="border-t border-border-soft">
                <td className="p-2 font-mono text-xs text-text">{o}</td>
                {data.personas.map((p) => {
                  const cell = data.cells.find((c) => c.offering === o && c.persona === p);
                  return (
                    <td key={p} className="p-2">
                      <div
                        title={cell?.note ?? ""}
                        className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border text-center ${stateColor[cell?.state ?? "empty"]}`}
                      >
                        {cell?.state ?? "empty"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {(data.priorityMoves ?? []).length > 0 && (
        <Card className="p-6 space-y-3">
          <SectionLabel>Priority moves</SectionLabel>
          <ul className="space-y-2">
            {(data.priorityMoves ?? []).map((m, i) => (
              <li key={i} className="flex gap-2 text-text">
                <span className="text-gold mt-1">→</span>
                {m}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function QbrTab({ accountId }: { accountId: string }) {
  const { data, isLoading } = useAtelierGetAccountQbr(accountId);
  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  if (!data) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <Eyebrow>{data.periodLabel}</Eyebrow>
        {data.sections.map((s, i) => (
          <Card key={i} className="p-6 space-y-2">
            <h3 className="text-base font-semibold text-text">{s.heading}</h3>
            <p className="text-text-mute leading-relaxed">{s.body}</p>
          </Card>
        ))}
      </div>
      <div className="space-y-4">
        {(data.riskFlags ?? []).length > 0 && (
          <Card className="p-6 space-y-3 border-amber/30">
            <SectionLabel>Risk flags</SectionLabel>
            <ul className="space-y-2 text-sm">
              {(data.riskFlags ?? []).map((r, i) => (
                <li key={i} className="text-amber">⚠ {r}</li>
              ))}
            </ul>
          </Card>
        )}
        {(data.nextMoves ?? []).length > 0 && (
          <Card className="p-6 space-y-3">
            <SectionLabel>Next moves</SectionLabel>
            <ul className="space-y-2 text-sm">
              {(data.nextMoves ?? []).map((m, i) => (
                <li key={i} className="text-text">→ {m}</li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function AuditTab({
  accountId,
  events,
}: {
  accountId: string;
  events: AtelierAccountWorkspace["audit"];
}) {
  const pdfHref = `/api/atelier/audit/export.pdf?entityType=account&entityId=${encodeURIComponent(accountId)}`;
  const exportButton = (
    <a
      href={pdfHref}
      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono border border-border-soft rounded hover:border-gold/40 hover:text-gold transition"
      data-testid="account-audit-pdf"
    >
      <FileText className="w-3.5 h-3.5" /> Export PDF
    </a>
  );
  if (events.length === 0) {
    return (
      <Card className="p-8 text-center text-text-mute font-mono text-sm space-y-3">
        <div>No audit events recorded.</div>
        <div className="flex justify-center">{exportButton}</div>
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <Eyebrow>Immutable Audit Trail</Eyebrow>
        {exportButton}
      </div>
      <ul className="space-y-3">
        {events.map((e) => (
          <li key={e.id} className="border-b border-border-soft pb-3 last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-text">
                <span className="font-mono text-xs text-text-mute">{e.action}</span>{" "}
                {e.payloadSummary ?? "(no summary)"}
              </div>
              <div className="text-xs font-mono text-text-faint shrink-0">
                {new Date(e.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="text-xs text-text-faint font-mono mt-1">
              {e.actorType}/{e.actorLabel}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
