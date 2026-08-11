import * as React from "react";
import {
  useAtelierGetMe,
  useAtelierListCredentials,
  useAtelierListAssets,
  getAtelierListAssetsQueryKey,
  useAtelierListPrompts,
  useAtelierListPersonas,
  useAtelierConciergeSearch,
} from "@workspace/api-client-react";
import { BackLink, SectionHead, PageHero, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
import { useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Search, FileText, Users, KeyRound, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SUB_ROUTES = [
  { id: "assets", label: "Assets" },
  { id: "prompts", label: "Prompts" },
  { id: "credentials", label: "Credentials" },
  { id: "people", label: "People" },
  { id: "win-themes", label: "Win Themes" },
];

interface WinTheme {
  id: string;
  tag: string;
  name: string;
  description: string | null;
  polarity: string;
  supportCount: number;
  positioningLine: string | null;
  offeringTags: string[] | null;
  sectorTags: string[] | null;
  lastSeenAt: string | null;
}

function WinThemesView() {
  const [themes, setThemes] = React.useState<WinTheme[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const reload = React.useCallback(() => {
    fetch("/api/atelier/win-themes", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setThemes(d.themes ?? []));
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);
  const curate = async () => {
    setBusy(true);
    try {
      await fetch("/api/atelier/win-themes/curate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      reload();
    } finally {
      setBusy(false);
    }
  };
  if (!themes) return <div className="py-8 text-text-mute">Loading…</div>;
  return (
    <div className="mt-8 space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-text-mute">
          The firm's library of repeatable win/loss themes — clustered from approved debriefs by
          the Theme Curator.
        </p>
        <button
          onClick={curate}
          disabled={busy}
          className="px-3 py-1 rounded text-xs font-mono bg-gold text-bg disabled:opacity-50"
        >
          {busy ? "Curating…" : "Run Theme Curator"}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {themes.map((t) => (
          <Card key={t.id} className="p-4 space-y-2 border-l-4 border-l-gold">
            <div className="flex items-center justify-between">
              <div className="font-medium text-text">{t.name}</div>
              <MonoChip>{t.polarity}</MonoChip>
            </div>
            <div className="flex gap-1 flex-wrap text-xs">
              <MonoChip>{t.tag}</MonoChip>
              <MonoChip>{t.supportCount} debriefs</MonoChip>
            </div>
            {t.description && <p className="text-sm text-text-mute">{t.description}</p>}
            {t.positioningLine && (
              <p className="text-sm italic text-gold border-l-2 border-l-gold/40 pl-2">
                "{t.positioningLine}"
              </p>
            )}
          </Card>
        ))}
        {themes.length === 0 && (
          <Card className="p-6 text-text-mute">
            No themes yet. Run the Theme Curator after approving some debriefs.
          </Card>
        )}
      </div>
    </div>
  );
}

function AssetsView() {
  const { toast } = useToast();
  const { data: assets, isLoading, isError } = useAtelierListAssets({
    query: { queryKey: getAtelierListAssetsQueryKey() },
  });
  const [filter, setFilter] = React.useState("");
  const focusId = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("focus");
  }, []);
  const focusRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (focusId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusId, assets]);
  const [conciergeQ, setConciergeQ] = React.useState("");
  const concierge = useAtelierConciergeSearch();

  if (isLoading)
    return (
      <div className="py-8 space-y-4">
        <Skeleton className="h-24 bg-bg-elevate" />
        <Skeleton className="h-24 bg-bg-elevate" />
      </div>
    );
  if (isError || !assets) return <div className="py-8 text-danger">Failed to load assets.</div>;

  const filtered = assets.filter(
    (a) =>
      a.title.toLowerCase().includes(filter.toLowerCase()) ||
      a.kind.includes(filter.toLowerCase()),
  );

  return (
    <div className="mt-8 space-y-6">
      <Card className="p-5 space-y-3 border-l-4 border-l-gold">
        <h3 className="font-mono text-sm tracking-widest uppercase text-gold flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> Knowledge Concierge
        </h3>
        <div className="flex gap-2">
          <Input
            placeholder='Try "diagnostic memo" or "pricing"…'
            value={conciergeQ}
            onChange={(e) => setConciergeQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && conciergeQ.trim())
                concierge.mutate({ data: { query: conciergeQ } });
            }}
            className="bg-bg-elevate border-border text-text"
            data-testid="input-concierge"
          />
          <Button
            disabled={!conciergeQ.trim() || concierge.isPending}
            onClick={() => concierge.mutate({ data: { query: conciergeQ } })}
            data-testid="button-concierge-search"
          >
            Search
          </Button>
        </div>
        {concierge.data && (
          <div className="space-y-2 pt-2">
            {concierge.data.results.length === 0 && (
              <p className="text-sm text-text-mute">No matches.</p>
            )}
            {concierge.data.results.map((hit) => (
              <div
                key={hit.asset.id}
                className="text-sm border border-border-soft rounded-md p-3 glass-surface"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-text">{hit.asset.title}</span>
                  <MonoChip>score {hit.score}</MonoChip>
                </div>
                <p className="text-xs text-text-mute mt-1 line-clamp-2">{hit.snippet}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="max-w-md relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-mute" />
        <Input
          placeholder="Filter assets…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="pl-9 bg-bg-elevate border-border text-text placeholder:text-text-faint"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map((asset) => (
          <Card
            key={asset.id}
            ref={asset.id === focusId ? focusRef : undefined}
            data-testid={`asset-card-${asset.id}`}
            className={`p-5 flex flex-col justify-between transition-colors ${
              asset.id === focusId
                ? "border-gold ring-2 ring-gold/40"
                : "hover:border-gold/50"
            }`}
          >
            <div className="space-y-3">
              <div className="flex justify-between items-start gap-4">
                <div className="flex flex-wrap gap-2">
                  <MonoChip>{asset.kind.replace("_", " ")}</MonoChip>
                </div>
                <button
                  onClick={() =>
                    toast({
                      title: "Asset Pulled",
                      description: `"${asset.title}" copied to your workspace.`,
                    })
                  }
                  className="text-text-mute hover:text-gold transition-colors p-1 shrink-0"
                  title="Pull into workspace"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
              <h4 className="font-semibold text-text leading-tight">{asset.title}</h4>
              <p className="text-sm text-text-mute line-clamp-2">{asset.abstract}</p>
            </div>
            <div className="mt-4 pt-4 border-t border-border-soft flex justify-between items-center text-xs font-mono">
              <span className="text-gold/70 truncate max-w-[200px]">{asset.provenance}</span>
              <span className="text-text-faint">
                {new Date(asset.createdAt).toLocaleDateString()}
              </span>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-text-mute font-mono border border-dashed border-border rounded-lg">
            No assets match your search.
          </div>
        )}
      </div>
    </div>
  );
}

function PromptsView() {
  const { data, isLoading, isError } = useAtelierListPrompts();
  if (isLoading) return <Skeleton className="h-64 mt-8 bg-bg-elevate" />;
  if (isError || !data) return <div className="py-8 text-danger">Failed to load prompts.</div>;
  return (
    <div className="mt-8 space-y-3">
      <p className="text-sm text-text-mute">
        Filesystem-backed prompt registry. Each prompt is the contract between the agent runner and
        the underlying model.
      </p>
      {data.map((p) => (
        <Card
          key={p.agentId}
          id={`prompt-${p.agentId}`}
          className="p-5 border-border hover:border-gold/40 transition-colors scroll-mt-24"
          data-testid={`prompt-${p.agentId}`}
        >
          <div className="flex justify-between items-start gap-4 mb-3">
            <div className="flex items-center gap-3">
              <FileText className="w-4 h-4 text-gold" />
              <h4 className="font-semibold text-text">{p.agentId}</h4>
              <MonoChip tone={p.status === "production" ? "green" : "gold"}>
                {p.status} · v{p.version}
              </MonoChip>
            </div>
            <span className="text-xs font-mono text-text-faint">
              {p.bytes.toLocaleString()} B · {new Date(p.updatedAt).toLocaleDateString()}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs font-mono text-text-mute mb-3">
            {p.model && <span>model: {p.model}</span>}
            {p.author && <span>author: {p.author}</span>}
            {p.evalSetId && <span>evals: {p.evalSetId}</span>}
            {p.owner && <span>owner: {p.owner}</span>}
          </div>
          <pre className="text-xs text-text-mute bg-bg-deep/60 border border-border-soft rounded p-3 whitespace-pre-wrap line-clamp-6 font-mono">
            {p.bodyPreview}
          </pre>
        </Card>
      ))}
    </div>
  );
}

function CredentialsView() {
  const { data: me } = useAtelierGetMe();
  const { data: credentials, isLoading } = useAtelierListCredentials();
  const [showCreate, setShowCreate] = React.useState(false);
  const isPartner = (me?.role === "partner" || me?.role === "founding_partner");
  if (isLoading) return <Skeleton className="h-64 mt-8 bg-bg-elevate" />;
  const list = credentials ?? [];
  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-text-mute">
          Reusable proof: anonymized case studies and outcome metrics the firm cites in proposals.
          {!isPartner && " Read-only — partners curate."}
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {isPartner && (
            <span className="text-xs font-mono text-gold/70">Partner-curated</span>
          )}
          {isPartner && (
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="text-[10px] font-mono uppercase tracking-wider px-3 py-1 rounded border border-gold/40 text-gold hover:bg-gold/10"
              data-testid="button-new-credential"
            >
              {showCreate ? "Cancel" : "+ New credential"}
            </button>
          )}
        </div>
      </div>
      {isPartner && showCreate && (
        <CreateCredentialForm onClose={() => setShowCreate(false)} />
      )}
      {list.length === 0 && !showCreate && (
        <Card className="p-8 text-center border-dashed bg-bg-deep">
          <p className="text-text-mute">
            No credentials yet. {isPartner ? "Use “New credential” above to publish one." : "Ask a partner to publish one."}
          </p>
        </Card>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {list.map((c) => (
          <Card
            key={c.id}
            className={`p-5 border-border ${isPartner ? "cursor-pointer hover:bg-bg-elevate-2 transition-colors" : ""}`}
            onClick={isPartner ? () => editCredential(c.id) : undefined}
            data-testid={`credential-${c.id}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="w-4 h-4 text-gold" />
              <MonoChip>{c.engagementType}</MonoChip>
              <MonoChip>{c.sector}</MonoChip>
              <MonoChip tone={c.anonymizationStatus === "attributed" ? "gold" : undefined}>
                {c.anonymizationStatus}
              </MonoChip>
            </div>
            <h4 className="font-semibold text-text mb-1">{c.title}</h4>
            <p className="text-xs font-mono text-text-faint mb-2">{c.clientName}</p>
            <p className="text-sm text-text-mute line-clamp-3">
              {c.anonymizationStatus === "attributed" && c.attributedAbstract
                ? c.attributedAbstract
                : c.redactedAbstract}
            </p>
            {c.outcomeMetrics && c.outcomeMetrics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.outcomeMetrics.slice(0, 3).map((m, i) => (
                  <span key={i} className="text-xs font-mono px-2 py-0.5 rounded border border-border-soft text-gold/80">
                    {m.label}: {m.value}
                  </span>
                ))}
              </div>
            )}
            {isPartner && (
              <div
                className="mt-4 pt-3 border-t border-border-soft flex justify-end gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => deleteCredential(c.id, c.title)}
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-border text-text-mute hover:border-red-500 hover:text-red-400"
                  data-testid={`button-delete-credential-${c.id}`}
                >
                  Retire
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function CreateCredentialForm({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = React.useState("");
  const [clientName, setClientName] = React.useState("");
  const [sector, setSector] = React.useState("");
  const [engagementType, setEngagementType] = React.useState("agentic_build");
  const [anonymizationStatus, setAnonymizationStatus] = React.useState("redacted");
  const [redactedAbstract, setRedactedAbstract] = React.useState("");
  const [attributedAbstract, setAttributedAbstract] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!title.trim() || !clientName.trim() || !sector.trim() || !redactedAbstract.trim()) {
      setErr("Title, client, sector, and redacted abstract are required.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/atelier/credentials`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: title.trim(),
          clientName: clientName.trim(),
          sector: sector.trim(),
          engagementType,
          anonymizationStatus,
          redactedAbstract: redactedAbstract.trim(),
          attributedAbstract: attributedAbstract.trim() || undefined,
        }),
      });
      if (!r.ok) {
        setErr(`Create failed (${r.status})`);
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full bg-bg-deep border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-gold";
  const labelCls = "block text-[10px] font-mono uppercase tracking-wider text-text-mute mb-1";

  return (
    <Card className="p-5 border-gold/30 bg-bg-deep" data-testid="form-new-credential">
      <h4 className="font-semibold text-text mb-4">New credential</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Title *</label>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-credential-title" />
        </div>
        <div>
          <label className={labelCls}>Client name *</label>
          <input className={inputCls} value={clientName} onChange={(e) => setClientName(e.target.value)} data-testid="input-credential-client" />
        </div>
        <div>
          <label className={labelCls}>Sector *</label>
          <input className={inputCls} value={sector} onChange={(e) => setSector(e.target.value)} data-testid="input-credential-sector" />
        </div>
        <div>
          <label className={labelCls}>Engagement type</label>
          <select className={inputCls} value={engagementType} onChange={(e) => setEngagementType(e.target.value)} data-testid="select-credential-engagement-type">
            <option value="agentic_build">agentic_build</option>
            <option value="pov">pov</option>
            <option value="transformation">transformation</option>
            <option value="advisory">advisory</option>
            <option value="other">other</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Anonymization</label>
          <select className={inputCls} value={anonymizationStatus} onChange={(e) => setAnonymizationStatus(e.target.value)} data-testid="select-credential-anonymization">
            <option value="redacted">redacted</option>
            <option value="attributed">attributed</option>
            <option value="under_nda">under_nda</option>
          </select>
        </div>
      </div>
      <div className="mt-3">
        <label className={labelCls}>Redacted abstract *</label>
        <textarea className={inputCls} rows={3} value={redactedAbstract} onChange={(e) => setRedactedAbstract(e.target.value)} data-testid="input-credential-redacted" />
      </div>
      <div className="mt-3">
        <label className={labelCls}>Attributed abstract (optional)</label>
        <textarea className={inputCls} rows={2} value={attributedAbstract} onChange={(e) => setAttributedAbstract(e.target.value)} data-testid="input-credential-attributed" />
      </div>
      {err && <p className="mt-3 text-xs text-red-400 font-mono">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={submitting}
          className="text-[10px] font-mono uppercase tracking-wider px-3 py-1 rounded border border-border text-text-mute hover:border-text disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="text-[10px] font-mono uppercase tracking-wider px-3 py-1 rounded border border-gold text-gold hover:bg-gold/10 disabled:opacity-50"
          data-testid="button-submit-credential"
        >
          {submitting ? "Publishing…" : "Publish credential"}
        </button>
      </div>
    </Card>
  );
}

async function editCredential(id: string) {
  const newTitle = window.prompt("New title (leave blank to cancel):");
  if (!newTitle) return;
  const r = await fetch(`/api/atelier/credentials/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ title: newTitle }),
  });
  if (!r.ok) {
    window.alert(`Update failed (${r.status})`);
    return;
  }
  window.location.reload();
}

async function deleteCredential(id: string, title: string) {
  if (!window.confirm(`Retire credential "${title}"? This is a soft-delete and is auditable.`)) return;
  const r = await fetch(`/api/atelier/credentials/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!r.ok) {
    window.alert(`Delete failed (${r.status})`);
    return;
  }
  window.location.reload();
}

function PeopleView() {
  const { data: personas, isLoading } = useAtelierListPersonas();
  if (isLoading) return <Skeleton className="h-64 mt-8 bg-bg-elevate" />;
  return (
    <div className="mt-8 space-y-4">
      <p className="text-sm text-text-mute">
        Active firm personas. Switch personas in the user menu to test role-based access.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(personas ?? []).map((p) => (
          <Card key={p.id} className="p-5 border-border" data-testid={`persona-${p.id}`}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full glass-surface border border-gold/30 flex items-center justify-center text-gold">
                <Users className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-text">{p.name}</h4>
                <p className="text-xs text-text-mute font-mono">{p.roleLabel}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <MonoChip>{p.role}</MonoChip>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function AtelierIndex() {
  const [, params] = useRoute("/atelier/:section");
  const section = params?.section || "assets";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/" className="mb-4" data-testid="link-back">
          Home
        </BackLink>
        <SectionHead
          eyebrow="Firm · Atelier"
          headline="Knowledge Atelier"
          lede="The firm's compounded IP and reusable assets."
        />
      </PageHero>

      <div className="container-atelier py-10">
        <TabNav>
          {SUB_ROUTES.map((sub) => (
            <TabNavLink
              key={sub.id}
              href={`/atelier/${sub.id}`}
              active={section === sub.id}
            >
              {sub.label}
            </TabNavLink>
          ))}
        </TabNav>

        {section === "assets" && <AssetsView />}
        {section === "prompts" && <PromptsView />}
        {section === "credentials" && <CredentialsView />}
        {section === "people" && <PeopleView />}
        {section === "win-themes" && <WinThemesView />}
      </div>
    </div>
  );
}
