import * as React from "react";
import {
  useAtelierListPovs,
  useAtelierStartPov,
  useAtelierDraftPov,
  useAtelierListPovVersions,
  useAtelierRecordAgentDecision,
  getAtelierListPovsQueryKey,
  getAtelierListPovVersionsQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import type { AtelierPov, AtelierPovOutlineSection, AtelierPovVersionSectionsItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { ApproveEditReject } from "../ApproveEditReject";

export function PovTab({ oppId, personaName }: { oppId: string; personaName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useAtelierListPovs(oppId);
  const startMut = useAtelierStartPov();
  const draftMut = useAtelierDraftPov();
  const decideMut = useAtelierRecordAgentDecision();
  const [showStart, setShowStart] = React.useState(false);
  const [activePovId, setActivePovId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ title: "", audience: "CIO", objective: "" });

  React.useEffect(() => {
    if (!activePovId && data && data.length > 0) setActivePovId(data[0].id);
  }, [data, activePovId]);

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  const povs = data ?? [];
  const active = povs.find((p) => p.id === activePovId) ?? null;

  async function start() {
    if (!form.title.trim() || !form.objective.trim()) {
      toast({ title: "Title & objective required", variant: "destructive" });
      return;
    }
    try {
      const created = await startMut.mutateAsync({ oppId, data: form });
      qc.invalidateQueries({ queryKey: getAtelierListPovsQueryKey(oppId) });
      qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
      setActivePovId(created.id);
      setShowStart(false);
      setForm({ title: "", audience: "CIO", objective: "" });
      toast({ title: "Outline ready", description: "Approve to generate full draft." });
    } catch (e) {
      toast({
        title: "Could not start POV",
        description: "Promote at least one research fact first.",
        variant: "destructive",
      });
    }
  }

  async function generateDraft() {
    if (!active) return;
    await draftMut.mutateAsync({ povId: active.id });
    qc.invalidateQueries({ queryKey: getAtelierListPovsQueryKey(oppId) });
    qc.invalidateQueries({ queryKey: getAtelierListPovVersionsQueryKey(active.id) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    toast({ title: "Draft generated", description: "Review and approve." });
  }

  async function decide(decision: "approve" | "edit" | "reject", rationale: string) {
    if (!active?.runId) return;
    await decideMut.mutateAsync({ runId: active.runId, data: { decision, rationale } });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    toast({ title: `Recorded ${decision}` });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-x-auto">
          {povs.map((p: AtelierPov) => (
            <button
              key={p.id}
              onClick={() => setActivePovId(p.id)}
              className={`text-xs font-mono uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors ${
                activePovId === p.id
                  ? "border-gold text-gold bg-bg-deep"
                  : "border-border text-text-mute hover:text-text"
              }`}
            >
              {p.title.slice(0, 32)}{p.title.length > 32 ? "…" : ""} · {p.status}
            </button>
          ))}
        </div>
        <PillButton variant="primary" onClick={() => setShowStart((s) => !s)}>
          <span className="inline-flex items-center gap-1"><Plus className="w-3 h-3" /> New POV</span>
        </PillButton>
      </div>

      {showStart && (
        <Card className="p-5 space-y-3 border-gold/40">
          <h4 className="text-sm font-semibold text-text">Brief the POV Author</h4>
          <p className="text-xs text-text-mute">Outline drafts on submit (Phase A). Approve outline to generate full sections (Phases B/C/D).</p>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="pov-title">Title</Label>
              <Input id="pov-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-bg-deep border-border text-text" />
            </div>
            <div>
              <Label htmlFor="pov-aud">Audience</Label>
              <Input id="pov-aud" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className="bg-bg-deep border-border text-text" />
            </div>
            <div>
              <Label htmlFor="pov-obj">Objective</Label>
              <Textarea id="pov-obj" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} className="bg-bg-deep border-border text-text min-h-[80px]" placeholder="What position should this POV land?" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <PillButton variant="ghost" onClick={() => setShowStart(false)}>Cancel</PillButton>
            <PillButton variant="primary" onClick={start} disabled={startMut.isPending}>
              {startMut.isPending ? "Drafting outline…" : "Generate outline"}
            </PillButton>
          </div>
        </Card>
      )}

      {!active ? (
        <Card className="p-12 text-center border-dashed bg-bg-deep">
          <h3 className="text-lg font-semibold text-text mb-2">No POVs yet</h3>
          <p className="text-text-mute mb-4">Promote at least one research fact, then start a POV.</p>
        </Card>
      ) : (
        <ActivePov pov={active} onGenerateDraft={generateDraft} draftPending={draftMut.isPending} personaName={personaName} onDecision={decide} />
      )}
    </div>
  );
}

function ActivePov({
  pov,
  onGenerateDraft,
  draftPending,
  personaName,
  onDecision,
}: {
  pov: AtelierPov;
  onGenerateDraft: () => void;
  draftPending: boolean;
  personaName: string;
  onDecision: (d: "approve" | "edit" | "reject", r: string) => void;
}) {
  const { data: versions } = useAtelierListPovVersions(pov.id);
  const latest = versions?.[0] ?? null;

  return (
    <div className="space-y-5">
      <Card className="p-6 space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-text">{pov.title}</h3>
          <span className="text-xs font-mono text-text-mute">{pov.audience} · {pov.status}</span>
        </div>
        <p className="text-text-mute text-sm">{pov.objective}</p>
      </Card>

      <Card className="p-6 space-y-3">
        <h4 className="text-xs uppercase tracking-widest font-mono text-text-faint">Outline</h4>
        <ol className="space-y-2 text-sm">
          {pov.outline.map((s: AtelierPovOutlineSection, i: number) => (
            <li key={s.id} className="border-l-2 border-border-soft pl-3">
              <div className="text-text font-medium">{i + 1}. {s.heading}</div>
              <div className="text-text-mute text-xs mt-0.5">{s.intent}</div>
              <div className="text-[10px] font-mono text-text-faint mt-1">cites: {s.factIds.length || "—"}</div>
            </li>
          ))}
        </ol>
        {pov.status === "outline" && (
          <div className="pt-3 border-t border-border-soft flex justify-end">
            <PillButton variant="primary" onClick={onGenerateDraft} disabled={draftPending}>
              {draftPending ? "Drafting…" : "Approve outline & generate draft"}
            </PillButton>
          </div>
        )}
      </Card>

      {latest && (
        <Card className="p-6 space-y-3">
          <div className="flex items-baseline justify-between">
            <h4 className="text-xs uppercase tracking-widest font-mono text-text-faint">Draft v{latest.versionNumber}</h4>
            <span className="text-xs font-mono text-text-mute">
              citation coverage {Math.round((latest.citationCoverage ?? 0) * 100)}%
            </span>
          </div>
          <div
            className="prose prose-invert max-w-none text-sm text-text [&_h1]:text-xl [&_h2]:text-base [&_h2]:text-gold [&_h2]:mt-4 [&_p]:text-text-mute [&_sup]:text-gold"
            dangerouslySetInnerHTML={{ __html: latest.body }}
          />
          {latest.notes && <div className="text-[11px] font-mono text-warn">stylist notes: {latest.notes}</div>}
        </Card>
      )}

      {pov.runId && (
        <ApproveEditReject personaName={personaName} onDecision={onDecision} />
      )}
    </div>
  );
}
