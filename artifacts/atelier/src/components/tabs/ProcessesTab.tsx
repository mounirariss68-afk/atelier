import * as React from "react";
import {
  useAtelierListProcesses,
  useAtelierAnalyzeProcess,
  useAtelierListAgentDesigns,
  useAtelierApproveAgentDesign,
  getAtelierListProcessesQueryKey,
  getAtelierListAgentDesignsQueryKey,
  type AtelierProcess,
  type AtelierAgentDesign,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Workflow, ShieldCheck, AlertTriangle } from "lucide-react";

const RISK_TONE: Record<string, "green" | "amber" | "red"> = { low: "green", med: "amber", high: "red" };
const AGENTIFIABLE_TONE: Record<string, "green" | "amber" | "red"> = { yes: "green", partial: "amber", no: "red" };

export function ProcessesTab({ engId }: { engId: string }) {
  const qc = useQueryClient();
  const { data: processes, isLoading } = useAtelierListProcesses(engId, {
    query: { enabled: !!engId, queryKey: getAtelierListProcessesQueryKey(engId) },
  });
  const { data: designs } = useAtelierListAgentDesigns(engId, {
    query: { enabled: !!engId, queryKey: getAtelierListAgentDesignsQueryKey(engId) },
  });
  const analyze = useAtelierAnalyzeProcess({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierListProcessesQueryKey(engId) });
        qc.invalidateQueries({ queryKey: getAtelierListAgentDesignsQueryKey(engId) });
      },
    },
  });
  const approve = useAtelierApproveAgentDesign({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierListAgentDesignsQueryKey(engId) }),
    },
  });

  const [name, setName] = React.useState("");
  const [scopeHint, setScopeHint] = React.useState("");
  const [source, setSource] = React.useState("");
  const [sourceType, setSourceType] = React.useState<"text" | "transcript" | "bpmn" | "image">("text");
  const [imageName, setImageName] = React.useState<string | null>(null);

  const onPickImage = React.useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setSource(typeof reader.result === "string" ? reader.result : "");
      setImageName(file.name);
      setSourceType("image");
    };
    reader.readAsDataURL(file);
  }, []);

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  const list = (processes ?? []) as AtelierProcess[];
  const designsList = (designs ?? []) as AtelierAgentDesign[];

  return (
    <div className="space-y-6" data-testid="tab-processes-content">
      <Card className="p-4 space-y-3">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Capture a process</div>
        <p className="text-sm text-text-mute">
          Paste a description, transcript, or notes. The Agent Architect will normalize steps,
          judge agentifiability per step, and propose ≥3 candidate agents (each with a human
          checkpoint).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            data-testid="input-process-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Process name (e.g., Customer refund triage)"
            className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text"
          />
          <input
            data-testid="input-process-scope"
            value={scopeHint}
            onChange={(e) => setScopeHint(e.target.value)}
            placeholder="Scope hint (e.g., top-3 services)"
            className="rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-mute font-mono uppercase">source:</span>
          {(["text", "transcript", "bpmn", "image"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="sourceType"
                value={t}
                checked={sourceType === t}
                onChange={() => { setSourceType(t); if (t !== "image") setImageName(null); }}
                data-testid={`radio-source-${t}`}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
        {sourceType === "image" ? (
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="image/*"
              data-testid="input-process-image"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickImage(f); }}
              className="text-xs text-text-mute"
            />
            {imageName && <span className="text-xs text-text-mute font-mono">{imageName}</span>}
          </div>
        ) : (
          <textarea
            data-testid="input-process-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            rows={6}
            placeholder={
              sourceType === "transcript"
                ? "Paste meeting transcript (Speaker: text). Lines without colons are kept verbatim."
                : sourceType === "bpmn"
                  ? "Paste BPMN XML. <userTask name=…>/<task name=…> nodes will be extracted in order."
                  : "Paste the process description (≥10 chars). Use periods or new lines between steps."
            }
            className="w-full rounded border border-border-soft bg-bg-deep px-3 py-2 text-sm text-text font-mono"
          />
        )}
        <div className="flex justify-end">
          <PillButton
            variant="primary"
            data-testid="button-analyze-process"
            disabled={
              analyze.isPending ||
              (sourceType === "image" ? source.length < 50 : source.trim().length < 10)
            }
            onClick={() =>
              analyze.mutate({
                engId,
                data: {
                  name: name || undefined,
                  scopeHint: scopeHint || undefined,
                  source,
                  sourceType,
                  depth: "design",
                },
              })
            }
          >
            {analyze.isPending ? "Analyzing…" : "Analyze with Agent Architect"}
          </PillButton>
        </div>
      </Card>

      {list.length === 0 ? (
        <Card className="p-8 text-center border-dashed bg-bg-deep">
          <Workflow className="w-6 h-6 text-gold/60 mx-auto mb-2" />
          <p className="text-text-mute text-sm">No processes captured yet for this engagement.</p>
        </Card>
      ) : (
        list.map((p) => (
          <Card key={p.id} className="p-4 space-y-3" data-testid={`process-${p.id}`}>
            <div className="flex items-center justify-between">
              <div className="font-medium text-text">{p.name}</div>
              <span className="text-xs font-mono text-text-mute">{(p.steps ?? []).length} steps</span>
            </div>
            {p.diagram && (
              <pre className="text-[11px] font-mono whitespace-pre-wrap bg-bg-deep border border-border-soft rounded p-3 overflow-x-auto">
                {p.diagram}
              </pre>
            )}
            <div className="space-y-1">
              {(p.steps ?? []).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <MonoChip tone={AGENTIFIABLE_TONE[s.agentifiable] ?? "default"}>{s.agentifiable}</MonoChip>
                  <span className="font-mono text-text-mute">{s.category}</span>
                  <span className="text-text">{s.name}</span>
                  <span className="text-text-faint ml-auto">{s.currentOwner}</span>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}

      {designsList.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Candidate agent designs</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {designsList.map((d) => {
              const design = (d.design ?? {}) as {
                name?: string; purpose?: string; riskClass?: string;
                tools?: string[]; guardrails?: string[]; humanCheckpoints?: string[];
              };
              return (
                <Card key={d.id} className="p-4 space-y-2" data-testid={`agent-design-${d.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-text">{design.name ?? "Candidate agent"}</div>
                      <p className="text-xs text-text-mute mt-1">{design.purpose}</p>
                    </div>
                    <MonoChip tone={RISK_TONE[design.riskClass ?? "low"] ?? "default"}>
                      {design.riskClass ?? "low"}
                    </MonoChip>
                  </div>
                  <div className="text-[11px] font-mono text-text-mute">
                    Tools: {(design.tools ?? []).join(", ") || "—"}
                  </div>
                  <div className="text-[11px] text-text-mute flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-gold" />
                    {(design.guardrails ?? []).slice(0, 2).join(" · ") || "—"}
                  </div>
                  <div className="text-[11px] text-text-mute flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-500" />
                    Human: {(design.humanCheckpoints ?? []).join(" · ")}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <MonoChip tone={d.status === "approved" ? "green" : "default"}>{d.status}</MonoChip>
                    {d.status !== "approved" && (
                      <PillButton
                        variant="ghost"
                        data-testid={`button-approve-design-${d.id}`}
                        onClick={() => approve.mutate({ engId, designId: d.id })}
                        disabled={approve.isPending}
                      >
                        Approve
                      </PillButton>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
