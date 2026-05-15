import { useAtelierListAgents } from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip, SectionLabel } from "@/components/ui/primitives";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Star, Activity, Cpu } from "lucide-react";

export default function Agents() {
  const { data: agents, isLoading, isError } = useAtelierListAgents();

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !agents) return <div className="container-atelier py-12 text-danger">Failed to load agent registry.</div>;

  const groups = Array.from(new Set(agents.map(a => a.group)));

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead 
          headline="Agent Registry"
          lede="The named AI agents available in The Atelier."
        />
      </PageHero>

      <div className="container-atelier py-10 space-y-10">
        {groups.map(group => {
          const groupAgents = agents.filter(a => a.group === group);
          return (
            <div key={group} className="space-y-4">
              <SectionLabel>{group}</SectionLabel>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {groupAgents.map(agent => (
                  <Link key={agent.id} href={`/agents/design/${agent.id}`}>
                    <Card hover className="p-5 h-full flex flex-col justify-between group">
                      <div className="space-y-3">
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex items-center gap-2">
                            {agent.starred && <Star className="w-4 h-4 text-gold fill-gold" />}
                            <h4 className="font-semibold text-lg text-text group-hover:text-gold transition-colors">{agent.name}</h4>
                          </div>
                          <MonoChip tone={agent.status === 'mvp' ? 'green' : agent.status === 'registered' ? 'gold' : 'default'}>
                            {agent.status}
                          </MonoChip>
                        </div>
                        <p className="text-sm text-text-mute leading-relaxed">{agent.purpose}</p>
                      </div>
                      
                      <div className="mt-4 pt-4 border-t border-border-soft flex items-center justify-between text-xs font-mono text-text-faint">
                        <div className="flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5" />
                          {agent.model}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5" />
                          {agent.runsLast30d} runs (30d)
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
