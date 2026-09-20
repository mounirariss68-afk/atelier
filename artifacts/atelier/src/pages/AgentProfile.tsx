import { Link, useRoute } from "wouter";
import { Activity, ArrowUpRight, Cpu, FileText, Link2, ShieldCheck, UserCheck, Wrench } from "lucide-react";
import { useAtelierListAgents, useAtelierListAgentRuns, getAtelierListAgentRunsQueryKey, type AgentCatalogEntry, type AtelierAgentSchemaField } from "@workspace/api-client-react";
import { BackLink, Card, MonoChip, PageHero, SectionHead } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

export default function AgentProfile() {
  const [, params] = useRoute("/agents/:agentId");
  const agentId = params?.agentId ?? "";
  const agents = useAtelierListAgents();
  const runs = useAtelierListAgentRuns(agentId, { query: { enabled: !!agentId, queryKey: getAtelierListAgentRunsQueryKey(agentId) } });
  if (agents.isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (agents.isError) return <div className="container-atelier py-12 text-danger">This agent profile is unavailable.</div>;
  const agent = (agents.data ?? []).find((item) => item.id === agentId);
  if (!agent) return <div className="container-atelier py-12 text-text-mute">This agent is not available to your organisation.</div>;
  const runRows = runs.data ?? [];
  const available = agent.status !== "stub";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/agents">Back to catalogue</BackLink>
        <SectionHead eyebrow={`${agent.group} · ${agent.stage}`} headline={agent.name} lede={agent.purpose} />
        <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-text-mute">
          <MonoChip tone={available ? (agent.status === "mvp" ? "green" : "gold") : "default"}>{available ? agent.status : "unavailable"}</MonoChip>
          <span className="flex items-center gap-2"><Cpu className="w-4 h-4" />{agent.model}</span>
        </div>
      </PageHero>
      <div className="container-atelier py-10 space-y-8">
        {!available && <Card className="p-5 border-dashed text-text-mute">This registry entry is not executable. No run controls are available.</Card>}
        <OperationalMetadata agent={agent} />
        {(agent.inputs?.length || agent.outputs?.length) ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {agent.inputs && agent.inputs.length > 0 && <SchemaCard title="Inputs" fields={agent.inputs} />}
            {agent.outputs && agent.outputs.length > 0 && <SchemaCard title="Outputs" fields={agent.outputs} />}
          </div>
        ) : null}
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-3"><h2 className="font-mono text-sm uppercase tracking-widest text-text-mute flex items-center gap-2"><Activity className="w-4 h-4" />Run history</h2><span className="text-xs text-text-faint">{agent.runsLast30d} runs / 30d</span></div>
          {runs.isLoading ? <Skeleton className="h-24 bg-bg-elevate" /> : runs.isError ? <p className="text-sm text-danger">Run history could not be loaded.</p> : runRows.length === 0 ? <p className="text-sm text-text-mute">No persisted runs for this agent.</p> : (
            <div className="border border-border-soft rounded-md divide-y divide-border-soft">{runRows.map((run) => <Link key={run.id} href={`/agents/runs/${run.id}`} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-bg-elevate/40"><div className="min-w-0"><div className="text-sm text-text truncate">{run.message}</div><div className="text-xs text-text-faint font-mono">{new Date(run.startedAt).toLocaleString()}{run.targetLabel && ` · ${run.targetLabel}`}</div></div><div className="flex items-center gap-3"><MonoChip tone={run.status === "complete" ? "green" : run.status === "error" ? "default" : "gold"}>{run.status}</MonoChip><ArrowUpRight className="w-4 h-4 text-text-faint" /></div></Link>)}</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function OperationalMetadata({ agent }: { agent: AgentCatalogEntry }) {
  const metadata = [
    agent.tools?.length ? {
      label: "Tools",
      icon: <Wrench className="w-4 h-4" />,
      content: <div className="flex flex-wrap gap-1.5">{agent.tools.map((tool) => <MonoChip key={tool}>{tool}</MonoChip>)}</div>,
    } : null,
    agent.guardrails?.length ? {
      label: "Guardrails",
      icon: <ShieldCheck className="w-4 h-4" />,
      content: <ul className="space-y-1 text-sm text-text-mute list-disc list-inside">{agent.guardrails.map((guardrail) => <li key={guardrail}>{guardrail}</li>)}</ul>,
    } : null,
    agent.humanCheckpoints?.length ? {
      label: "Human checkpoints",
      icon: <UserCheck className="w-4 h-4" />,
      content: <ul className="space-y-1 text-sm text-text-mute list-disc list-inside">{agent.humanCheckpoints.map((checkpoint, index) => <li key={index}>{typeof checkpoint === "string" ? checkpoint : JSON.stringify(checkpoint)}</li>)}</ul>,
    } : null,
    agent.promptRef ? {
      label: "Prompt reference",
      icon: <Link2 className="w-4 h-4" />,
      content: <code className="text-sm text-gold break-all">{agent.promptRef}</code>,
    } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  // The runtime registry/API does not supply a version identifier. Do not
  // infer one from lifecycle tables or expose a misleading placeholder.
  if (metadata.length === 0) return null;
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="agent-operational-metadata">{metadata.map((item) => <Card key={item.label} className="p-5 space-y-3"><h2 className="font-mono text-sm uppercase tracking-widest text-text-mute flex items-center gap-2">{item.icon}{item.label}</h2>{item.content}</Card>)}</div>;
}

function SchemaCard({ title, fields }: { title: string; fields: AtelierAgentSchemaField[] | undefined }) {
  if (!fields?.length) return null;
  return <Card className="p-5 space-y-3"><h2 className="font-mono text-sm uppercase tracking-widest text-text-mute flex items-center gap-2"><FileText className="w-4 h-4" />{title}</h2><div className="border border-border-soft rounded divide-y divide-border-soft">{fields.map((field) => <div key={field.name} className="px-3 py-2 flex justify-between gap-3"><div><div className="text-sm font-mono text-text">{field.name}{field.required && <span className="text-danger ml-1">*</span>}</div>{field.description && <div className="text-xs text-text-mute">{field.description}</div>}</div><MonoChip>{field.type}</MonoChip></div>)}</div></Card>;
}