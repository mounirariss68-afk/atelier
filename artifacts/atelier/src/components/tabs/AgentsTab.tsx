import * as React from "react";
import {
  useAtelierListAgents,
  useAtelierListAgentDesigns,
  getAtelierListAgentDesignsQueryKey,
  type AtelierAgentDesign,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Star, ShieldCheck } from "lucide-react";

const DELIVERY_STAGES = new Set(["Deliver", "Compound", "Mobilize", "Cross-cutting"]);

const RISK_TONE: Record<string, "green" | "amber" | "red"> = {
  low: "green",
  med: "amber",
  high: "red",
};

export function AgentsTab({ engId }: { engId: string }) {
  const { data: agents, isLoading, isError } = useAtelierListAgents();
  const { data: designs } = useAtelierListAgentDesigns(engId, {
    query: { enabled: !!engId, queryKey: getAtelierListAgentDesignsQueryKey(engId) },
  });
  const approvedDesigns = ((designs ?? []) as AtelierAgentDesign[]).filter(
    (d) => d.status === "approved",
  );

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  if (isError) return <div className="text-danger">Failed to load agents.</div>;

  const all = agents ?? [];
  const deliverPhase = all.filter((a) => DELIVERY_STAGES.has(a.stage));
  const grouped = new Map<string, typeof all>();
  for (const a of deliverPhase) {
    if (!grouped.has(a.group)) grouped.set(a.group, []);
    grouped.get(a.group)!.push(a);
  }

  return (
    <div className="space-y-6" data-testid="tab-agents-content">
      <Card className="p-4 bg-bg-deep border-border-soft">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute mb-1">
          Agents in this engagement
        </div>
        <div className="text-sm text-text">
          Showing {deliverPhase.length} delivery-phase catalog agents available to engagement{" "}
          <span className="font-mono">{engId}</span>
          {approvedDesigns.length > 0 && (
            <>, plus {approvedDesigns.length} engagement-scoped runtime design{approvedDesigns.length === 1 ? "" : "s"} promoted from Process Discovery</>
          )}
          .
        </div>
      </Card>

      {approvedDesigns.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
            Engagement runtime — promoted from process discovery
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {approvedDesigns.map((d) => {
              const design = (d.design ?? {}) as {
                name?: string; purpose?: string; riskClass?: string;
                tools?: string[]; guardrails?: string[]; humanCheckpoints?: string[];
              };
              return (
                <Card key={d.id} className="p-4 border-gold/30 bg-gold/[0.02]" data-testid={`agent-runtime-${d.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-gold" />
                      <div className="font-medium text-text">{design.name ?? "Approved agent"}</div>
                    </div>
                    <MonoChip tone={RISK_TONE[design.riskClass ?? "low"] ?? "default"}>
                      risk: {design.riskClass ?? "low"}
                    </MonoChip>
                  </div>
                  <p className="text-xs text-text-mute mt-2">{design.purpose}</p>
                  <div className="text-[11px] text-text-mute flex items-center gap-1 mt-2">
                    <ShieldCheck className="w-3 h-3 text-gold" />
                    Human checkpoint: {(design.humanCheckpoints ?? []).join(" · ") || "—"}
                  </div>
                  <div className="text-[10px] font-mono uppercase text-text-mute mt-2">
                    promoted · engagement runtime
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {Array.from(grouped.entries()).map(([group, list]) => (
        <div key={group} className="space-y-3">
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
            {group.replace(/_/g, " ")}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {list.map((a) => (
              <Card
                key={a.id}
                className="p-4 hover:border-gold/40 transition-colors"
                data-testid={`agent-card-${a.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-gold shrink-0" />
                    <div className="font-medium text-text">{a.name}</div>
                    {a.starred && <Star className="w-3.5 h-3.5 text-gold fill-gold" />}
                  </div>
                  <MonoChip
                    tone={a.status === "mvp" ? "green" : a.status === "registered" ? "amber" : "default"}
                  >
                    {a.status}
                  </MonoChip>
                </div>
                <p className="text-xs text-text-mute mt-2 leading-relaxed">{a.purpose}</p>
                <div className="mt-3 flex items-center justify-between text-[10px] font-mono text-text-mute uppercase">
                  <span>{a.model}</span>
                  <span>{a.runsLast30d} runs / 30d</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
      {deliverPhase.length === 0 && (
        <Card className="p-8 text-center border-dashed bg-bg-deep">
          <p className="text-text-mute text-sm">
            No delivery-phase agents registered yet.
          </p>
        </Card>
      )}
    </div>
  );
}
