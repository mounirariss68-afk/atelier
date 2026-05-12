import { useAtelierListAgents } from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Link, useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Cpu, Shield, Wrench, UserCheck } from "lucide-react";

export default function AgentProfile() {
  const [, params] = useRoute("/agents/:agentId");
  const agentId = params?.agentId || "";
  
  const { data: agents, isLoading, isError } = useAtelierListAgents();
  
  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !agents) return <div className="container-atelier py-12 text-danger">Failed to load agent.</div>;

  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) return <div className="container-atelier py-12 text-text-mute">Agent not found.</div>;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Link href="/agents" className="inline-flex items-center gap-2 text-xs font-mono text-text-mute hover:text-text mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Registry
        </Link>
        
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead 
            eyebrow={`${agent.group} · ${agent.stage}`}
            headline={<span className="flex items-center gap-3">{agent.name} {agent.starred && <span className="text-gold text-2xl">★</span>}</span>}
            lede={agent.purpose}
          />
          <div className="flex flex-col items-end gap-3 text-right shrink-0">
            <MonoChip tone={agent.status === 'mvp' ? 'green' : agent.status === 'registered' ? 'gold' : 'default'}>
              STATUS: {agent.status}
            </MonoChip>
            <div className="flex items-center gap-2 text-sm text-text-mute font-mono">
              <Cpu className="w-4 h-4 text-text-faint" /> {agent.model}
            </div>
            <PillButton variant="primary" className="mt-2">View Analytics</PillButton>
          </div>
        </div>
      </PageHero>

      <div className="container-atelier py-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="p-6 space-y-4 border-dashed bg-bg-deep">
            <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
              <Wrench className="w-4 h-4" /> Tools & Capabilities
            </h3>
            <p className="text-text-mute text-sm">Detailed tool registry and input schemas will be populated in a subsequent workstream.</p>
          </Card>
          
          <Card className="p-6 space-y-4 border-dashed bg-bg-deep">
            <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
              <UserCheck className="w-4 h-4" /> Human Checkpoints
            </h3>
            <p className="text-text-mute text-sm">Defined approval gates and delegation rules for this agent.</p>
          </Card>
        </div>
        
        <div className="space-y-6">
          <Card className="p-6 space-y-4 border-gold/30">
            <h3 className="font-mono text-sm tracking-widest uppercase text-gold flex items-center gap-2">
              <Shield className="w-4 h-4" /> Guardrails
            </h3>
            <ul className="space-y-2 text-sm text-text-mute list-disc list-inside pl-2">
              <li>Must cite sources for factual claims</li>
              <li>No PII transmission to third-party endpoints</li>
              <li>Enforce pyramid-principle structure</li>
            </ul>
          </Card>
          
          <Card className="p-6 space-y-4">
            <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
              Recent Runs
            </h3>
            <div className="text-3xl font-light text-text">{agent.runsLast30d}</div>
            <div className="text-xs text-text-faint font-mono uppercase tracking-wider">Runs in last 30 days</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
