import * as React from "react";
import {
  useAtelierListAssets,
  getAtelierListAssetsQueryKey,
  useAtelierListPrompts,
  useAtelierListPersonas,
  useAtelierConciergeSearch,
} from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";
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
];

function AssetsView() {
  const { toast } = useToast();
  const { data: assets, isLoading, isError } = useAtelierListAssets({
    query: { queryKey: getAtelierListAssetsQueryKey() },
  });
  const [filter, setFilter] = React.useState("");
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
                className="text-sm border border-border-soft rounded-md p-3 bg-bg-elevate"
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
            className="p-5 flex flex-col justify-between hover:border-gold/50 transition-colors"
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
          <pre className="text-xs text-text-mute bg-bg-deep border border-border-soft rounded p-3 whitespace-pre-wrap line-clamp-6 font-mono">
            {p.bodyPreview}
          </pre>
        </Card>
      ))}
    </div>
  );
}

function CredentialsView() {
  const { data: assets, isLoading } = useAtelierListAssets();
  if (isLoading) return <Skeleton className="h-64 mt-8 bg-bg-elevate" />;
  const CRED_KINDS = ["template", "framework", "learning"];
  const credentials = (assets ?? []).filter((a) => CRED_KINDS.includes(a.kind));
  return (
    <div className="mt-8 space-y-4">
      <p className="text-sm text-text-mute">
        Reusable proof: case studies, points of view, and diagnostic templates the firm cites in
        proposals.
      </p>
      {credentials.length === 0 && (
        <Card className="p-8 text-center border-dashed bg-bg-deep">
          <p className="text-text-mute">No credential assets yet. Promote a POV from a deliverable to seed this list.</p>
        </Card>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {credentials.map((c) => (
          <Card key={c.id} className="p-5 border-border" data-testid={`credential-${c.id}`}>
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="w-4 h-4 text-gold" />
              <MonoChip>{c.kind.replace("_", " ")}</MonoChip>
            </div>
            <h4 className="font-semibold text-text mb-2">{c.title}</h4>
            <p className="text-sm text-text-mute line-clamp-3">{c.abstract}</p>
            <div className="mt-3 pt-3 border-t border-border-soft text-xs font-mono text-gold/70">
              {c.provenance}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
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
              <div className="w-10 h-10 rounded-full bg-bg-elevate border border-gold/30 flex items-center justify-center text-gold">
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
        <SectionHead
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
      </div>
    </div>
  );
}
