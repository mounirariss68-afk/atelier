import * as React from "react";
import { useAtelierListAgents } from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Star } from "lucide-react";

const DELIVERY_STAGES = new Set(["Deliver", "Compound", "Mobilize", "Cross-cutting"]);

export function AgentsTab({ engId }: { engId: string }) {
  const { data: agents, isLoading, isError } = useAtelierListAgents();

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
          Showing {deliverPhase.length} delivery-phase agents available to engagement{" "}
          <span className="font-mono">{engId}</span>. Per-engagement design overrides ship
          in the Agents Studio (later workstream).
        </div>
      </Card>

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
