import * as React from "react";
import type { AtelierMeeting } from "@workspace/api-client-react";
import {
  useAtelierListOpportunityMeetings,
  useAtelierSubmitMeeting,
  useAtelierRecordAgentDecision,
  useAtelierGetAgentRun,
  getAtelierListOpportunityMeetingsQueryKey,
  getAtelierListAuditQueryKey,
  getAtelierGetAgentRunQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileUp } from "lucide-react";
import { ApproveEditReject } from "../ApproveEditReject";

function PendingApprovalBanner({ runId }: { runId: string | null }) {
  const { data: run } = useAtelierGetAgentRun(runId ?? "", {
    query: { enabled: !!runId, queryKey: getAtelierGetAgentRunQueryKey(runId ?? "") },
  });
  if (!runId) return null;
  const decisions = ((run?.humanDecisions as Array<{ decision?: string }> | undefined) ?? []);
  const approved = decisions.some((d) => d?.decision === "approve");
  const isMockFallback = run?.status === "blocked";
  if (approved && !isMockFallback) {
    return (
      <div className="rounded border border-success/40 bg-success/10 px-3 py-2 text-xs font-mono text-success">
        ✓ Approved · committed to opportunity memory.
      </div>
    );
  }
  return (
    <div className={`rounded border px-3 py-2 text-xs font-mono ${
      isMockFallback ? "border-danger/50 bg-danger/10 text-danger" : "border-gold/40 bg-gold/5 text-gold"
    }`}>
      {isMockFallback ? "⚠ MOCK FALLBACK" : "● PENDING APPROVAL"} ·{" "}
      {isMockFallback
        ? "Claude was unavailable — scribe output below is synthetic. Review carefully and approve only if the underlying transcript supports each item."
        : "Decisions and actions below are NOT yet in opportunity memory. Use Approve/Edit/Reject to commit or send back."}
    </div>
  );
}

export function MeetingsTab({ oppId, personaName }: { oppId: string; personaName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useAtelierListOpportunityMeetings(oppId);
  const submit = useAtelierSubmitMeeting();
  const decideMut = useAtelierRecordAgentDecision();
  const [showSubmit, setShowSubmit] = React.useState(false);
  const [active, setActive] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    title: "",
    kind: "discovery" as "discovery" | "workshop" | "steering" | "kickoff",
    transcript: "",
  });

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  const meetings = data ?? [];
  const activeMeeting = meetings.find((m: AtelierMeeting) => m.id === active) ?? meetings[0] ?? null;

  async function run() {
    if (form.transcript.trim().length < 50) {
      toast({ title: "Transcript too short", description: "Paste at least a few exchanges.", variant: "destructive" });
      return;
    }
    const created = await submit.mutateAsync({
      oppId,
      data: { title: form.title || "Untitled meeting", kind: form.kind, mode: "paste", transcript: form.transcript, date: new Date().toISOString().slice(0, 10) },
    });
    qc.invalidateQueries({ queryKey: getAtelierListOpportunityMeetingsQueryKey(oppId) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    setActive(created.id);
    setShowSubmit(false);
    setForm({ title: "", kind: "discovery", transcript: "" });
    toast({ title: "Scribe complete", description: "Decisions and actions extracted." });
  }

  async function decide(decision: "approve" | "edit" | "reject", rationale: string) {
    if (!activeMeeting?.runId) {
      toast({ title: `Recorded ${decision}` });
      return;
    }
    await decideMut.mutateAsync({ runId: activeMeeting.runId, data: { decision, rationale } });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    qc.invalidateQueries({ queryKey: getAtelierGetAgentRunQueryKey(activeMeeting.runId) });
    toast({
      title: `Recorded ${decision}`,
      description:
        decision === "approve"
          ? "Meeting promoted to opportunity memory."
          : "Meeting kept as draft — not yet in opportunity memory.",
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto">
          {meetings.map((m: AtelierMeeting) => (
            <button
              key={m.id}
              onClick={() => setActive(m.id)}
              className={`text-xs font-mono uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors ${
                (activeMeeting?.id === m.id)
                  ? "border-gold text-gold bg-bg-deep"
                  : "border-border text-text-mute hover:text-text"
              }`}
            >
              {m.kind} · {m.date}
            </button>
          ))}
        </div>
        <PillButton variant="primary" onClick={() => setShowSubmit((s) => !s)}>
          <span className="inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Capture meeting</span>
        </PillButton>
      </div>

      {showSubmit && (
        <Card className="p-5 space-y-3 border-gold/40">
          <h4 className="text-sm font-semibold text-text inline-flex items-center gap-2">
            <FileUp className="w-4 h-4" /> Paste a transcript
          </h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="m-title">Title</Label>
              <Input id="m-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-bg-deep border-border text-text" placeholder="e.g. Discovery #2" />
            </div>
            <div>
              <Label htmlFor="m-kind">Kind</Label>
              <select
                id="m-kind"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}
                className="w-full bg-bg-deep border border-border rounded text-text px-3 py-2 text-sm"
              >
                <option value="discovery">Discovery</option>
                <option value="workshop">Workshop</option>
                <option value="steering">Steering</option>
                <option value="kickoff">Kick-off</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="m-tr">Transcript</Label>
            <Textarea id="m-tr" value={form.transcript} onChange={(e) => setForm({ ...form, transcript: e.target.value })} className="bg-bg-deep border-border text-text min-h-[200px] font-mono text-xs" placeholder="Paste raw transcript…" />
          </div>
          <div className="flex justify-end gap-2">
            <PillButton variant="ghost" onClick={() => setShowSubmit(false)}>Cancel</PillButton>
            <PillButton variant="primary" onClick={run} disabled={submit.isPending}>
              {submit.isPending ? "Scribing…" : "Run Scribe"}
            </PillButton>
          </div>
        </Card>
      )}

      {!activeMeeting ? (
        <Card className="p-12 text-center border-dashed bg-bg-deep">
          <h3 className="text-lg font-semibold text-text mb-2">No meetings captured</h3>
          <p className="text-text-mute">Paste a transcript to extract decisions, actions, and 5C deltas.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          <PendingApprovalBanner runId={activeMeeting.runId ?? null} />
          <Card className="p-6 space-y-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold text-text">{activeMeeting.title}</h3>
              <span className="text-xs font-mono text-text-mute">{activeMeeting.kind} · {activeMeeting.date}</span>
            </div>
            <p className="text-text-mute text-sm">{activeMeeting.summary}</p>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5 space-y-2">
              <h4 className="text-xs uppercase tracking-widest font-mono text-text-faint">Decisions</h4>
              {(activeMeeting.decisions as Array<{ id?: string; statement?: string; decidedBy?: string }>).map((d, i) => (
                <div key={d.id ?? i} className="border-l-2 border-success/40 pl-3 text-sm">
                  <div className="text-text">{d.statement}</div>
                  {d.decidedBy && <div className="text-[10px] font-mono text-text-faint mt-0.5">by {d.decidedBy}</div>}
                </div>
              ))}
              {((activeMeeting.decisions as unknown[]) ?? []).length === 0 && (
                <p className="text-xs text-text-faint">No decisions extracted.</p>
              )}
            </Card>
            <Card className="p-5 space-y-2">
              <h4 className="text-xs uppercase tracking-widest font-mono text-text-faint">Action items</h4>
              {(activeMeeting.actionItems as Array<{ id?: string; statement?: string; owner?: string; due?: string | null }>).map((a, i) => (
                <div key={a.id ?? i} className="border-l-2 border-gold/40 pl-3 text-sm">
                  <div className="text-text">{a.statement}</div>
                  <div className="text-[10px] font-mono text-text-faint mt-0.5">
                    owner: {a.owner ?? "UNOWNED"}{a.due ? ` · due ${a.due}` : ""}
                  </div>
                </div>
              ))}
              {((activeMeeting.actionItems as unknown[]) ?? []).length === 0 && (
                <p className="text-xs text-text-faint">No actions captured.</p>
              )}
            </Card>
          </div>

          {activeMeeting.runId && (
            <ApproveEditReject personaName={personaName} onDecision={decide} />
          )}
        </div>
      )}
    </div>
  );
}
