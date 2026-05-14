import * as React from "react";
import {
  useAtelierListAgents,
  useAtelierListAgentDesigns,
  useAtelierPromoteAgentDesign,
  useAtelierAgentsUsageCounts,
  useAtelierGetMe,
  getAtelierListAgentDesignsQueryKey,
  getAtelierListAgentsQueryKey,
  type AtelierAgentDesign,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Star, ShieldCheck, Activity } from "lucide-react";

const DELIVERY_STAGES = new Set(["Deliver", "Compound", "Mobilize", "Cross-cutting"]);

const RISK_TONE: Record<string, "green" | "amber" | "red"> = {
  low: "green",
  med: "amber",
  high: "red",
};

export function AgentsTab({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { data: agents, isLoading, isError } = useAtelierListAgents();
  const { data: me } = useAtelierGetMe();
  const { data: designs } = useAtelierListAgentDesigns(engId, {
    query: { enabled: !!engId, queryKey: getAtelierListAgentDesignsQueryKey(engId) },
  });
  const allDesigns = (designs ?? []) as AtelierAgentDesign[];
  const approvedDesigns = allDesigns.filter((d) => d.status === "approved");
  const promotedDesigns = allDesigns.filter((d) => d.status === "promoted");
  const promote = useAtelierPromoteAgentDesign({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierListAgentsQueryKey() });
        qc.invalidateQueries({ queryKey: getAtelierListAgentDesignsQueryKey(engId) });
      },
    },
  });
  const isPartner = (me?.role === "partner" || me?.role === "founding_partner");
  const { data: usageRows } = useAtelierAgentsUsageCounts();
  const designAgents = (agents ?? []).filter((a) => a.group === "Engagement");
  const usageByName = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of (usageRows ?? []) as Array<{ agentId: string; count: number }>) {
      counts.set(row.agentId, row.count);
    }
    const byName = new Map<string, number>();
    for (const a of designAgents) {
      byName.set(a.name, (byName.get(a.name) ?? 0) + (counts.get(a.id) ?? 0));
    }
    return byName;
  }, [usageRows, designAgents]);

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
            <>, plus {approvedDesigns.length} engagement-bound runtime agent{approvedDesigns.length === 1 ? "" : "s"} (not yet in the global Atelier registry)</>
          )}
          {promotedDesigns.length > 0 && (
            <>, and {promotedDesigns.length} promoted to the global Atelier registry</>
          )}
          .
        </div>
      </Card>

      {approvedDesigns.length > 0 && (
        <div className="space-y-3" data-testid="engagement-runtime-section">
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute flex items-center gap-2">
            Engagement runtime — engagement-bound (not in global registry)
            <MonoChip tone="amber">isolation: engagement-only</MonoChip>
          </div>
          <div className="text-[11px] text-text-mute -mt-1">
            These agents run only inside engagement <span className="font-mono">{engId}</span>.
            They never appear in the global /agents catalog or in other engagements until a Partner
            promotes them.
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
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-[10px] font-mono uppercase text-text-mute flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      runs: {usageByName.get(design.name ?? "") ?? 0}
                    </div>
                    <PillButton
                      variant={isPartner ? "primary" : "ghost"}
                      data-testid={`promote-${d.id}`}
                      disabled={!isPartner || promote.isPending}
                      onClick={() => promote.mutate({ engId, designId: d.id })}
                    >
                      {isPartner ? "Promote to Atelier" : "Partner-only"}
                    </PillButton>
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
