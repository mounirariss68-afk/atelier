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
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
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
            onDecide={(updateId, decision) => {
              decideProfileMut(qc, accountId, updateId, decision);
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
) {
  // imperative call so we don't need to thread the hook through every prop
  fetch(
    `${import.meta.env.BASE_URL}api/atelier/accounts/${accountId}/profile-updates/${updateId}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ decision }),
    },
  ).then(() => qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) }));
}

// --- tabs ---

function ProfileTab({
  ws,
  pending,
  onDecide,
}: {
  ws: AtelierAccountWorkspace;
  pending: AtelierProfileUpdateProposal[];
  onDecide: (id: string, d: "approve" | "reject") => void;
}) {
  const a = ws.account;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card className="p-6 space-y-4">
          <SectionLabel>AICo hypothesis</SectionLabel>
          <p className="text-text leading-relaxed">
            {a.aicoHypothesis ?? (
              <span className="italic text-text-mute">
                No hypothesis yet — run Cartographer ★ to seed one.
              </span>
            )}
          </p>
        </Card>

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
                      {sourceUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {sourceUrls.slice(0, 4).map((u, j) => (
                            <a
                              key={j}
                              href={u}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] font-mono uppercase tracking-wider text-text-faint hover:text-gold inline-flex items-center gap-1"
                              data-testid={`link-priority-source-${i}-${j}`}
                            >
                              source {j + 1}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

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

        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <SectionLabel>Pending Cartographer updates</SectionLabel>
            {pending.length > 0 && <MonoChip tone="amber">{pending.length}</MonoChip>}
          </div>
          {pending.length === 0 ? (
            <p className="text-text-mute italic text-sm">No pending proposals.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((p) => (
                <div key={p.id} className="border border-amber/30 rounded p-3 bg-amber/5">
                  <Eyebrow>{p.field}</Eyebrow>
                  <p className="text-text text-sm mt-1">{p.rationale}</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => onDecide(p.id, "approve")}
                      className="pill-btn pill-btn-primary text-xs"
                      data-testid={`button-approve-${p.id}`}
                    >
                      <Check className="w-3 h-3" /> Approve
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
              ))}
            </div>
          )}
        </Card>
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
  if (contacts.length === 0) {
    return (
      <Card className="p-8 text-center text-text-mute font-mono text-sm">
        No contacts mapped yet for this account.
      </Card>
    );
  }
  const selected = selectedId ? contacts.find((c) => c.id === selectedId) ?? null : null;
  return (
    <div className="space-y-6">
      <DecisionMakersGraph
        contacts={contacts}
        relationships={relationships}
        selectedId={selectedId}
        onSelect={setSelectedId}
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
            <button
              onClick={() => setSelectedId(null)}
              className="text-xs font-mono text-text-mute hover:text-text"
              data-testid="button-close-contact-panel"
            >
              close ✕
            </button>
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
          </div>
        </Card>
      ))}
      </div>
    </div>
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
  // Mirror DISPOSITION_TONE per PRD §6.2: gold for champion/supporter,
  // mute for neutral/unknown, danger for skeptic/blocker.
  const dispositionFill: Record<string, string> = {
    champion: "#9C6A1F",
    supporter: "#7A5316",
    neutral: "#1E2A47",
    unknown: "#1E2A47",
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
            r.type === "blocks" ? "#a83232" : r.type === "partners_with" ? "#E89E2C" : "#3a4a6e";
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
                fill={dispositionFill[c.disposition] ?? "#1E2A47"}
                stroke={isSel ? "#E89E2C" : "#2c3a5c"}
                strokeWidth={isSel ? 2 : 1}
              />
              <text x={NODE_W / 2} y={22} textAnchor="middle" fontSize={11} fontWeight={600} fill="#F5EBD6">
                {c.fullName.length > 22 ? c.fullName.slice(0, 20) + "…" : c.fullName}
              </text>
              <text x={NODE_W / 2} y={38} textAnchor="middle" fontSize={9} fill="#C9C2B0" fontFamily="monospace">
                {(c.title ?? "—").slice(0, 24)}
              </text>
              <text x={NODE_W / 2} y={50} textAnchor="middle" fontSize={9} fill="#E89E2C" fontFamily="monospace">
                infl {c.influenceScore}/5
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-2 text-[10px] font-mono text-text-mute">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#9C6A1F] mr-1" />champion</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#7A5316] mr-1" />supporter</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#1E2A47] mr-1" />neutral</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#7B1F1F] mr-1" />skeptic / blocker</span>
        <span><span className="inline-block w-3 h-px bg-[#3a4a6e] mr-1 align-middle" />reports_to</span>
        <span><span className="inline-block w-3 h-px bg-[#a83232] mr-1 align-middle" />blocks</span>
        <span><span className="inline-block w-3 h-px border-t border-dashed border-[#E89E2C] mr-1 align-middle" />partners_with</span>
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
