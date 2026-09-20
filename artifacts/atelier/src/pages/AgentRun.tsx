import * as React from "react";
import { Link, useRoute } from "wouter";
import { Activity, CheckCircle2, Edit3, FileText, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAtelierGetAgentRun, useAtelierListAgents, useAtelierRecordAgentDecision, getAtelierGetAgentRunQueryKey, getAtelierListAgentRunsQueryKey, type AtelierAgentRunDetail } from "@workspace/api-client-react";
import { BackLink, Card, MonoChip, PageHero, SectionHead } from "@/components/ui/primitives";

export default function AgentRun() {
  const [, params] = useRoute("/agents/runs/:runId");
  const runId = params?.runId ?? "";
  const agents = useAtelierListAgents();
  const run = useAtelierGetAgentRun(runId, { query: { enabled: !!runId, queryKey: getAtelierGetAgentRunQueryKey(runId), refetchInterval: 4000 } });
  const agent = agents.data?.find((item) => item.id === run.data?.agentId);
  if (run.isLoading || agents.isLoading) return <div className="container-atelier py-12 text-text-mute">Loading persisted run…</div>;
  if (run.isError || !run.data) return <div className="container-atelier py-12 text-danger">This run is unavailable or you do not have access to it.</div>;
  const detail = run.data;
  return <div className="animate-in fade-in">
    <PageHero><BackLink href={agent ? `/agents/${agent.id}` : "/agents"}>Back to agent</BackLink><SectionHead eyebrow={agent?.group ?? "Agent run"} headline={agent?.name ?? detail.agentId} lede={<div className="flex items-center gap-3 mt-2"><Status status={detail.status} /><span className="font-mono text-xs text-text-mute">{detail.id}</span></div>} /></PageHero>
    <div className="container-atelier py-8 space-y-6">
      <RunEvidence detail={detail} />
      <DecisionCard runId={runId} detail={detail} />
    </div>
  </div>;
}

function Status({ status }: { status: string }) { return <MonoChip tone={status === "complete" ? "green" : status === "error" ? "default" : "gold"}>{status}</MonoChip>; }

function RunEvidence({ detail }: { detail: AtelierAgentRunDetail }) {
  const evidence = [
    ["Target", detail.targetLabel ?? detail.targetId ?? detail.targetType],
    ["Progress", typeof detail.progressPct === "number" ? `${detail.progressPct}%` : undefined],
    ["Duration", typeof detail.durationMs === "number" ? `${Math.round(detail.durationMs / 100) / 10}s` : undefined],
    ["Cost", typeof detail.costUsd === "number" ? `$${detail.costUsd.toFixed(4)}` : undefined],
    ["Sources", typeof detail.sourcesCount === "number" ? String(detail.sourcesCount) : undefined],
    ["Confidence", detail.confidence ?? undefined],
  ].filter((entry): entry is [string, string] => !!entry[1]);
  return <div className="space-y-6">
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">{evidence.map(([label, value]) => <Card key={label} className="p-3"><div className="text-[10px] uppercase font-mono text-text-faint">{label}</div><div className="text-sm text-text mt-1 break-words">{value}</div></Card>)}</div>
    {detail.statusMessage && <Card className="p-4 text-sm text-text-mute border-gold/30">{detail.statusMessage}</Card>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="p-5 space-y-3"><h2 className="font-mono text-sm uppercase tracking-widest text-text-mute flex items-center gap-2"><FileText className="w-4 h-4" />Output</h2>{detail.output === undefined ? <p className="text-sm text-text-mute">{detail.status === "running" ? "Run in flight; output will appear when complete." : "No output was recorded."}</p> : <pre data-testid="text-run-output" className="text-xs font-mono text-text bg-bg-deep/60 border border-border-soft rounded p-3 max-h-96 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(detail.output, null, 2)}</pre>}</Card>
      <Card className="p-5 space-y-3"><h2 className="font-mono text-sm uppercase tracking-widest text-text-mute flex items-center gap-2"><Activity className="w-4 h-4" />Trace</h2>{detail.steps?.length ? <ol className="space-y-2 text-sm text-text-mute">{detail.steps.map((step, index) => <li key={index} className="border-l-2 border-border-soft pl-3">{typeof step === "string" ? step : JSON.stringify(step)}</li>)}</ol> : <p className="text-sm text-text-mute">No trace steps were recorded.</p>}</Card>
    </div>
  </div>;
}

function DecisionCard({ runId, detail }: { runId: string; detail: AtelierAgentRunDetail }) {
  const qc = useQueryClient();
  const [rationale, setRationale] = React.useState("");
  const decide = useAtelierRecordAgentDecision({ mutation: { onSuccess: async () => { await qc.invalidateQueries({ queryKey: getAtelierGetAgentRunQueryKey(runId) }); await qc.invalidateQueries({ queryKey: getAtelierListAgentRunsQueryKey(detail.agentId) }); setRationale(""); } } });
  const decisions = (detail.humanDecisions ?? []) as Array<{ decision?: string; rationale?: string; actorLabel?: string; decidedAt?: string }>;
  const resolved = decisions.some((item) => item.decision === "approve" || item.decision === "reject");
  const canDecide = detail.status === "complete" || detail.status === "blocked";
  return <Card className="p-5 space-y-3" data-testid="card-decisions"><div className="flex justify-between"><h2 className="font-mono text-sm uppercase tracking-widest text-text-mute">Human decisions</h2><span className="text-xs text-text-faint">{decisions.length} recorded</span></div><p className="text-sm text-text-mute">Decisions are stored with this run and remain visible after refresh.</p><textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={2} placeholder="Rationale (optional)…" className="w-full bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm text-text" /><div className="flex flex-wrap gap-2"><button disabled={!canDecide || resolved || decide.isPending} onClick={() => decide.mutate({ runId, data: { decision: "approve", rationale: rationale.trim() || undefined } })} className="inline-flex items-center gap-1.5 bg-success text-bg-deep px-3 py-1.5 rounded text-xs disabled:opacity-50"><CheckCircle2 className="w-3.5 h-3.5" />Approve</button><button disabled={!canDecide || resolved || decide.isPending} onClick={() => decide.mutate({ runId, data: { decision: "edit", rationale: rationale.trim() || undefined } })} className="inline-flex items-center gap-1.5 glass-surface text-text px-3 py-1.5 rounded text-xs disabled:opacity-50"><Edit3 className="w-3.5 h-3.5" />Edit</button><button disabled={!canDecide || resolved || decide.isPending} onClick={() => decide.mutate({ runId, data: { decision: "reject", rationale: rationale.trim() || undefined } })} className="inline-flex items-center gap-1.5 bg-danger text-bg-deep px-3 py-1.5 rounded text-xs disabled:opacity-50"><XCircle className="w-3.5 h-3.5" />Reject</button></div>{!canDecide && <p className="text-xs text-text-faint">Available after the run reaches a decision-ready state.</p>}{decisions.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-text-mute">Decision history</summary><ul className="mt-2 space-y-1 font-mono">{decisions.map((item, index) => <li key={index} className="text-text-faint"><span className="text-text">{item.decision}</span>{item.actorLabel && <> · {item.actorLabel}</>}{item.decidedAt && <> · {item.decidedAt}</>}{item.rationale && <> — {item.rationale}</>}</li>)}</ul></details>}</Card>;
}