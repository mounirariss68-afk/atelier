import * as React from "react";
import { Link } from "wouter";
import { useAtelierListAgents } from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, SectionLabel } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Bot, Cpu, Star } from "lucide-react";

export default function Agents() {
  const query = useAtelierListAgents();
  if (query.isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (query.isError) return <div className="container-atelier py-12 text-danger">The agent catalogue is unavailable. Try again shortly.</div>;
  const agents = query.data ?? [];
  const available = agents.filter((agent) => agent.status !== "stub");
  const unavailable = agents.filter((agent) => agent.status === "stub");
  const groups = Array.from(new Set(available.map((agent) => agent.group)));

  return (
    <div className="animate-in fade-in">
      <PageHero><SectionHead headline="Agent catalogue" lede="Executable agents registered for this organisation. Runs and decisions are persisted by the server." /></PageHero>
      <div className="container-atelier py-10 space-y-10">
        {available.length === 0 ? (
          <Card className="p-8 border-dashed text-text-mute">No executable agents are available to this organisation.</Card>
        ) : groups.map((group) => (
          <section key={group} className="space-y-4">
            <SectionLabel>{group}</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {available.filter((agent) => agent.group === group).map((agent) => (
                <Link key={agent.id} href={`/agents/${agent.id}`}>
                  <Card className="h-full p-5 space-y-4 hover:border-gold/50 transition-colors" data-testid={`agent-card-${agent.id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-text"><Bot className="w-4 h-4 text-gold" /><span className="font-semibold">{agent.name}</span>{agent.starred && <Star className="w-3.5 h-3.5 text-gold fill-gold" />}</div>
                      <MonoChip tone={agent.status === "mvp" ? "green" : "gold"}>{agent.status}</MonoChip>
                    </div>
                    <p className="text-sm text-text-mute leading-relaxed">{agent.purpose}</p>
                    <div className="flex items-center justify-between text-xs font-mono text-text-faint">
                      <span className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" />{agent.model}</span>
                      <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" />{agent.runsLast30d} runs / 30d</span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))}
        {unavailable.length > 0 && (
          <section className="space-y-3">
            <SectionLabel>Unavailable</SectionLabel>
            <Card className="p-5 border-dashed space-y-3">
              <p className="text-sm text-text-mute">These registry entries are not executable and cannot be run from Atelier.</p>
              {unavailable.map((agent) => <div key={agent.id} className="flex items-center justify-between text-sm"><span className="text-text">{agent.name}</span><MonoChip>{agent.status}</MonoChip></div>)}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}