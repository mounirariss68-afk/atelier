import { Link, useRoute } from "wouter";
import * as React from "react";
import { Activity, ArrowUpRight, Cpu, FileText, Link2, Pencil, ShieldCheck, UserCheck, Wrench } from "lucide-react";
import {
  useAtelierGetAgentPrompt,
  useAtelierGetMe,
  useAtelierListAgents,
  useAtelierListAgentRuns,
  useAtelierUpdateAgentPrompt,
  getAtelierGetAgentPromptQueryKey,
  getAtelierListAgentRunsQueryKey,
  type AgentCatalogEntry,
  type AgentCatalogEntryHumanCheckpointsItem,
  type AtelierAgentPrompt,
  type AtelierAgentSchemaField,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BackLink, Card, MonoChip, PageHero, SectionHead } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function AgentProfile() {
  const [, params] = useRoute("/agents/:agentId");
  const agentId = params?.agentId ?? "";
  const isRiser = agentId === "ag_riser_orchestrator";
  const agents = useAtelierListAgents();
  const runs = useAtelierListAgentRuns(agentId, { query: { enabled: !!agentId && !isRiser, queryKey: getAtelierListAgentRunsQueryKey(agentId) } });
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
          <MonoChip tone={available ? (agent.status === "core" || agent.status === "mvp" ? "green" : "gold") : "default"}>{available ? agent.status : "unavailable"}</MonoChip>
          <span className="flex items-center gap-2"><Cpu className="w-4 h-4" />{agent.model}</span>
        </div>
      </PageHero>
      <div className="container-atelier py-10 space-y-8">
        {!available && <Card className="p-5 border-dashed text-text-mute">This registry entry is not executable. No run controls are available.</Card>}
        <OperationalMetadata agent={agent} />
        {available && <PromptEditor agentId={agent.id} promptRef={agent.promptRef} />}
        {(agent.inputs?.length || agent.outputs?.length) ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {agent.inputs && agent.inputs.length > 0 && <SchemaCard title="Inputs" fields={agent.inputs} />}
            {agent.outputs && agent.outputs.length > 0 && <SchemaCard title="Outputs" fields={agent.outputs} />}
          </div>
        ) : null}
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-3"><h2 className="font-mono text-sm uppercase tracking-widest text-text-mute flex items-center gap-2"><Activity className="w-4 h-4" />{isRiser ? "Activity" : "Run history"}</h2><span className="text-xs text-text-faint">{agent.runsLast30d} {isRiser ? "turns" : "runs"} / 30d</span></div>
          {isRiser ? <p className="text-sm text-text-mute">Riser activity is persisted in chat history. Specialist agent runs remain in the run history below their own profiles.</p> : runs.isLoading ? <Skeleton className="h-24 bg-bg-elevate" /> : runs.isError ? <p className="text-sm text-danger">Run history could not be loaded.</p> : runRows.length === 0 ? <p className="text-sm text-text-mute">No persisted runs for this agent.</p> : (
            <div className="border border-border-soft rounded-md divide-y divide-border-soft">{runRows.map((run) => <Link key={run.id} href={`/agents/runs/${run.id}`} className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-bg-elevate/40"><div className="min-w-0"><div className="text-sm text-text truncate">{run.message}</div><div className="text-xs text-text-faint font-mono">{new Date(run.startedAt).toLocaleString()}{run.targetLabel && ` · ${run.targetLabel}`}</div></div><div className="flex items-center gap-3"><MonoChip tone={run.status === "complete" ? "green" : run.status === "error" ? "default" : "gold"}>{run.status}</MonoChip><ArrowUpRight className="w-4 h-4 text-text-faint" /></div></Link>)}</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function checkpointText(checkpoint: AgentCatalogEntryHumanCheckpointsItem): {
  label: string;
  decider?: string;
  blocking?: boolean;
} {
  const label = typeof checkpoint.label === "string"
    ? checkpoint.label
    : typeof checkpoint.id === "string"
      ? checkpoint.id.replace(/^cp_/, "").replaceAll("_", " ")
      : "Human review";
  return {
    label,
    decider: typeof checkpoint.decider === "string"
      ? checkpoint.decider.replaceAll("_", " ")
      : undefined,
    blocking: typeof checkpoint.blocking === "boolean" ? checkpoint.blocking : undefined,
  };
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
      content: <ul className="space-y-3">{agent.humanCheckpoints.map((checkpoint, index) => {
        const display = checkpointText(checkpoint);
        return <li key={typeof checkpoint.id === "string" ? checkpoint.id : index} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text">{display.label}</span>
          {display.decider && <MonoChip>{display.decider}</MonoChip>}
          {display.blocking !== undefined && <MonoChip tone={display.blocking ? "gold" : "default"}>{display.blocking ? "blocking" : "advisory"}</MonoChip>}
        </li>;
      })}</ul>,
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

function PromptEditor({ agentId, promptRef }: { agentId: string; promptRef?: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const prompt = useAtelierGetAgentPrompt(agentId, {
    query: { queryKey: getAtelierGetAgentPromptQueryKey(agentId) },
  });
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const canEdit = me?.role === "founding_partner" || me?.role === "partner";

  React.useEffect(() => {
    if (!editing && prompt.data?.body !== undefined) setDraft(prompt.data.body);
  }, [editing, prompt.data?.body]);

  const update = useAtelierUpdateAgentPrompt({
    mutation: {
      onSuccess: (saved: AtelierAgentPrompt) => {
        queryClient.setQueryData(getAtelierGetAgentPromptQueryKey(agentId), saved);
        setDraft(saved.body);
        setEditing(false);
        toast({ title: "Prompt updated", description: `Version ${saved.version} is now active for your organisation.` });
      },
      onError: (error) => {
        toast({
          title: "Prompt update failed",
          description: error instanceof Error ? error.message : "Try again.",
          variant: "destructive",
        });
      },
    },
  });

  return <Card className="p-6 space-y-4" data-testid="agent-prompt-editor">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-mono text-sm uppercase tracking-widest text-text-mute flex items-center gap-2">
          <FileText className="w-4 h-4" />Full prompt
        </h2>
        {prompt.data && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-faint">
          <MonoChip tone={prompt.data.source === "override" ? "gold" : "default"}>{prompt.data.source === "override" ? "organisation override" : "platform default"}</MonoChip>
          <span>Version {prompt.data.version}</span>
          {promptRef && <code className="break-all">{promptRef}</code>}
        </div>}
      </div>
      {canEdit && prompt.data && !editing && <Button variant="outline" size="sm" onClick={() => {
        setDraft(prompt.data.body);
        setEditing(true);
      }}><Pencil className="w-4 h-4 mr-2" />Edit prompt</Button>}
    </div>
    {prompt.isLoading ? <Skeleton className="h-48 bg-bg-elevate" /> : prompt.isError ? (
      <p className="text-sm text-danger">The full prompt is unavailable. Its referenced prompt file may be missing.</p>
    ) : editing ? (
      <div className="space-y-3">
        <textarea
          aria-label="Full agent prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={24}
          className="w-full rounded-md border border-border-soft bg-bg-elevate/40 p-4 font-mono text-sm leading-relaxed text-text focus:outline-none focus:ring-2 focus:ring-gold/40"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => {
            setDraft(prompt.data?.body ?? "");
            setEditing(false);
          }} disabled={update.isPending}>Cancel</Button>
          <Button onClick={() => update.mutate({ agentId, data: { body: draft } })} disabled={update.isPending || !draft.trim() || draft === prompt.data?.body}>
            {update.isPending ? "Saving…" : "Save as new active version"}
          </Button>
        </div>
      </div>
    ) : (
      <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-border-soft bg-bg-elevate/35 p-4 font-mono text-sm leading-relaxed text-text">{prompt.data?.body}</pre>
    )}
  </Card>;
}

function SchemaCard({ title, fields }: { title: string; fields: AtelierAgentSchemaField[] | undefined }) {
  if (!fields?.length) return null;
  return <Card className="p-5 space-y-3"><h2 className="font-mono text-sm uppercase tracking-widest text-text-mute flex items-center gap-2"><FileText className="w-4 h-4" />{title}</h2><div className="border border-border-soft rounded divide-y divide-border-soft">{fields.map((field) => <div key={field.name} className="px-3 py-2 flex justify-between gap-3"><div><div className="text-sm font-mono text-text">{field.name}{field.required && <span className="text-danger ml-1">*</span>}</div>{field.description && <div className="text-xs text-text-mute">{field.description}</div>}</div><MonoChip>{field.type}</MonoChip></div>)}</div></Card>;
}