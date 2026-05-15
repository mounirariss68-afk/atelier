/**
 * Agents lens — Build stage (Task #370).
 *
 * Versioned change-log per agent: prompt deltas, tool wiring,
 * candidate vs shipped status.
 */
import * as React from "react";
import { Rocket } from "lucide-react";
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  Eyebrow,
} from "@/components/ui/primitives";
import {
  useAgentVersions,
  usePromoteVersion,
  type AgentVersion,
} from "@/lib/agents-lens-seed";

const STATUS_TONE: Record<AgentVersion["status"], "default" | "gold" | "green"> = {
  draft: "default",
  candidate: "gold",
  shipped: "green",
};

export default function AgentsBuild() {
  const versions = useAgentVersions();
  const promote = usePromoteVersion();
  const [toast, setToast] = React.useState<string | null>(null);
  const byAgent = versions.reduce<Record<string, AgentVersion[]>>((acc, v) => {
    (acc[v.agentName] ||= []).push(v);
    return acc;
  }, {});

  const handlePromote = (versionId: string, env: "staging" | "prod") => {
    const row = promote(versionId, env, "You · Build owner");
    if (row) {
      setToast(
        `Promoted ${row.agentName} v${row.version} → ${env.toUpperCase()} (${row.rolloutStrategy} · ${row.trafficPct}%)`,
      );
      setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Eyebrow>Manage · Agents · Build</Eyebrow>
        <SectionHead
          headline="Build — versions and change log"
          lede="Semantic versions per agent, with prompt diffs and tool wiring. Candidates flow to Evaluate; shipped versions land in Deploy."
          className="mt-3"
        />
      </PageHero>

      {toast && (
        <div
          className="container-atelier pt-4"
          data-testid="toast-promote"
        >
          <div className="rounded border border-success/40 bg-success/10 px-4 py-2 text-sm text-success font-mono">
            {toast}
          </div>
        </div>
      )}

      <div className="container-atelier py-10 space-y-10">
        {Object.entries(byAgent).map(([agent, vers]) => (
          <div key={agent} className="space-y-3">
            <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
              {agent}
            </h3>
            <div className="space-y-3">
              {vers.map((v) => (
                <Card key={v.id} className="p-5 space-y-3" data-testid={`build-version-${v.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base text-gold">v{v.version}</span>
                      <MonoChip tone={STATUS_TONE[v.status]}>{v.status}</MonoChip>
                      <span className="text-sm text-text">{v.changeSummary}</span>
                    </div>
                    <div className="text-xs font-mono text-text-faint text-right">
                      <div>{v.author}</div>
                      <div>{new Date(v.committedAt).toLocaleString()}</div>
                    </div>
                  </div>

                  <pre className="text-xs font-mono text-text-mute bg-bg-deep border border-border-soft rounded p-3 whitespace-pre-wrap">
                    {v.promptDelta}
                  </pre>

                  {(v.toolsAdded.length > 0 || v.toolsRemoved.length > 0) && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {v.toolsAdded.map((t) => (
                        <code
                          key={`add-${t}`}
                          className="px-1.5 py-0.5 rounded border border-success/40 text-success bg-bg-deep"
                        >
                          + {t}
                        </code>
                      ))}
                      {v.toolsRemoved.map((t) => (
                        <code
                          key={`rm-${t}`}
                          className="px-1.5 py-0.5 rounded border border-danger/40 text-danger bg-bg-deep line-through"
                        >
                          − {t}
                        </code>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-border-soft pt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-text-faint">
                      Promote this version to create a Deploy row.
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handlePromote(v.id, "staging")}
                        data-testid={`button-promote-staging-${v.id}`}
                        className="inline-flex items-center gap-1.5 bg-bg-elevate text-text px-3 py-1.5 rounded text-xs font-medium border border-gold/40 hover:bg-gold/10 transition-colors"
                      >
                        <Rocket className="w-3.5 h-3.5" /> Promote → staging
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePromote(v.id, "prod")}
                        data-testid={`button-promote-prod-${v.id}`}
                        className="inline-flex items-center gap-1.5 bg-gold text-bg-deep px-3 py-1.5 rounded text-xs font-medium hover:bg-gold/90 transition-colors"
                      >
                        <Rocket className="w-3.5 h-3.5" /> Promote → prod
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
