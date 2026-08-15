import * as React from "react";
import DOMPurify from "dompurify";
import {
  useAtelierListResearchFacts,
  useAtelierListPovs,
  useAtelierStartPov,
  useAtelierDraftPov,
  useAtelierListPovVersions,
  useAtelierUpdatePov,
  useAtelierRegeneratePovOutline,
  useAtelierRevisePov,
  useAtelierRecordAgentDecision,
  getAtelierListPovsQueryKey,
  getAtelierListPovVersionsQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import type { AtelierPov, AtelierPovOutlineSection, AtelierPovVersion } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Download, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ApproveEditReject } from "../ApproveEditReject";

/** Pull the most human-readable error message off a failed mutation response. */
function errText(e: unknown, fallback: string): string {
  const anyE = e as { response?: { data?: { reason?: string; error?: string } }; data?: { reason?: string; error?: string }; message?: string };
  const data = anyE?.response?.data ?? anyE?.data;
  if (data?.reason) return data.reason;
  if (data?.error) return data.error;
  if (anyE?.message) return anyE.message;
  return fallback;
}

export function PovTab({ oppId, personaName }: { oppId: string; personaName: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useAtelierListPovs(oppId);
  const startMut = useAtelierStartPov();
  const decideMut = useAtelierRecordAgentDecision();
  const [showStart, setShowStart] = React.useState(false);
  const [activePovId, setActivePovId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{ title: string; audience: string; objective: string; depth: "memo" | "full" }>({ title: "", audience: "CIO", objective: "", depth: "full" });

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
      setForm({ title: "", audience: "CIO", objective: "", depth: "full" });
      toast({ title: "Outline ready", description: "Approve to generate full draft." });
    } catch (e) {
      toast({
        title: "Could not start POV",
        description: errText(e, "The outline could not be generated. Try again shortly."),
        variant: "destructive",
      });
    }
  }

  async function decide(decision: "approve" | "edit" | "reject", rationale: string) {
    if (!active?.runId) return;
    await decideMut.mutateAsync({ runId: active.runId, data: { decision, rationale } });
    qc.invalidateQueries({ queryKey: getAtelierListPovsQueryKey(oppId) });
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
              <Label>Depth</Label>
              <div className="flex gap-2 mt-1">
                {([
                  { value: "memo", label: "Short memo", hint: "4–6 sections · tight" },
                  { value: "full", label: "Full document", hint: "8–12 sections · client-facing" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, depth: opt.value })}
                    className={`flex-1 text-left rounded-lg border px-3 py-2 transition-colors ${
                      form.depth === opt.value
                        ? "border-gold text-text bg-bg-deep"
                        : "border-border text-text-mute hover:text-text"
                    }`}
                    data-testid={`button-pov-depth-${opt.value}`}
                  >
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-[10px] font-mono text-text-faint">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="pov-obj">Objective</Label>
              <Textarea id="pov-obj" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} className="bg-bg-deep border-border text-text min-h-[80px]" placeholder="What position should this POV land?" />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
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
        <ActivePov key={active.id} pov={active} oppId={oppId} personaName={personaName} onDecision={decide} />
      )}
    </div>
  );
}

function ActivePov({
  pov,
  oppId,
  personaName,
  onDecision,
}: {
  pov: AtelierPov;
  oppId: string;
  personaName: string;
  onDecision: (d: "approve" | "edit" | "reject", r: string) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: versions } = useAtelierListPovVersions(pov.id);
  const draftMut = useAtelierDraftPov();
  const updateMut = useAtelierUpdatePov();
  const regenMut = useAtelierRegeneratePovOutline();
  const reviseMut = useAtelierRevisePov();

  // Task #1022 — outline review shows each cited fact's statement/source/date
  // so approval is a review of evidence, not a count of citations.
  const { data: factData } = useAtelierListResearchFacts(oppId);
  const factById = React.useMemo(() => {
    const m = new Map<string, NonNullable<typeof factData>[number]>();
    for (const f of factData ?? []) m.set(f.id, f);
    return m;
  }, [factData]);

  const versionList = versions ?? [];
  const [selectedVersionId, setSelectedVersionId] = React.useState<string | null>(null);
  const selected =
    versionList.find((v) => v.id === selectedVersionId) ??
    versionList.find((v) => v.id === pov.currentVersionId) ??
    versionList[0] ??
    null;

  // Header / meta editing
  const [editMeta, setEditMeta] = React.useState(false);
  const [metaForm, setMetaForm] = React.useState({ title: pov.title, objective: pov.objective ?? "" });
  React.useEffect(() => {
    setMetaForm({ title: pov.title, objective: pov.objective ?? "" });
  }, [pov.title, pov.objective]);

  const [outlineFeedback, setOutlineFeedback] = React.useState("");
  const [draftFeedback, setDraftFeedback] = React.useState("");
  // True while a background draft/revision run is in flight (start → poll → done).
  const [generating, setGenerating] = React.useState<null | "draft" | "revise">(null);
  // Task #1022 — multi-pass progress surfaced by the poller (sections →
  // critic → revision → stylist).
  const [runPhase, setRunPhase] = React.useState<string | null>(null);
  const unmountedRef = React.useRef(false);
  React.useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  /**
   * Poll the launch status until the background run finishes. Only "done" is
   * success; "idle" mid-run means the server restarted and the run was lost.
   * Bounded at ~10 minutes; stops silently on unmount.
   */
  async function pollDraftStatus(): Promise<{ status: string; error?: string; versionId?: string; versionNumber?: number }> {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if (unmountedRef.current) return { status: "cancelled" };
      try {
        const r = await fetch(`/api/atelier/povs/${encodeURIComponent(pov.id)}/draft-status`, { credentials: "include" });
        if (!r.ok) continue;
        const body = (await r.json()) as { status: string; error?: string; versionId?: string; versionNumber?: number; phase?: string | null; progressPct?: number | null };
        if (body.status === "idle") {
          return { status: "failed", error: "The run was interrupted (server restarted). Please try again." };
        }
        if (body.status !== "running") return body;
        if (body.phase) setRunPhase(body.phase);
      } catch {
        // transient network blip — keep polling
      }
    }
    return { status: "failed", error: "Timed out waiting for the run to finish. Check back shortly or try again." };
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: getAtelierListPovsQueryKey(oppId) });
    qc.invalidateQueries({ queryKey: getAtelierListPovVersionsQueryKey(pov.id) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
  }

  async function saveMeta() {
    try {
      await updateMut.mutateAsync({ povId: pov.id, data: { title: metaForm.title, objective: metaForm.objective } });
      invalidateAll();
      setEditMeta(false);
      toast({ title: "POV updated" });
    } catch (e) {
      toast({ title: "Could not update POV", description: errText(e, "Try again."), variant: "destructive" });
    }
  }

  async function regenerateOutline() {
    try {
      await regenMut.mutateAsync({ povId: pov.id, data: { feedback: outlineFeedback } });
      invalidateAll();
      setOutlineFeedback("");
      toast({ title: "Outline regenerated", description: "Review the new outline before approving." });
    } catch (e) {
      toast({ title: "Could not regenerate outline", description: errText(e, "Try again."), variant: "destructive" });
    }
  }

  async function approveOutlineAndDraft() {
    try {
      // The draft route gates on a recorded outline approval, so record the
      // human approve decision on the outline run first, then draft.
      if (pov.runId) {
        await onDecision("approve", "Outline approved");
      }
      await draftMut.mutateAsync({ povId: pov.id });
      setGenerating("draft");
      toast({ title: "Drafting started", description: "The POV Author is writing the full draft — this can take a few minutes." });
      const done = await pollDraftStatus();
      if (done.status === "done") {
        invalidateAll();
        if (done.versionId) setSelectedVersionId(done.versionId);
        toast({ title: "Draft ready", description: "Review and approve." });
      } else if (done.status === "failed") {
        toast({ title: "Could not generate draft", description: done.error ?? "Try again.", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Could not generate draft", description: errText(e, "Try again."), variant: "destructive" });
    } finally {
      setGenerating(null);
      setRunPhase(null);
    }
  }

  async function requestChanges() {
    if (!draftFeedback.trim()) {
      toast({ title: "Feedback required", description: "Describe the changes you want.", variant: "destructive" });
      return;
    }
    try {
      await reviseMut.mutateAsync({
        povId: pov.id,
        data: { feedback: draftFeedback, baseVersionId: selected?.id },
      });
      setGenerating("revise");
      toast({ title: "Revision started", description: "The POV Author is rewriting — this can take a few minutes." });
      const done = await pollDraftStatus();
      if (done.status === "done") {
        invalidateAll();
        if (done.versionId) setSelectedVersionId(done.versionId);
        setDraftFeedback("");
        toast({ title: done.versionNumber ? `Revision v${done.versionNumber} ready` : "Revision ready", description: "Review and approve." });
      } else if (done.status === "failed") {
        toast({ title: "Could not revise POV", description: done.error ?? "Try again.", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Could not revise POV", description: errText(e, "Try again."), variant: "destructive" });
    } finally {
      setGenerating(null);
      setRunPhase(null);
    }
  }

  const sanitizedBody = React.useMemo(
    () => (selected ? DOMPurify.sanitize(selected.body) : ""),
    [selected],
  );

  const exportHref = (ext: "pdf" | "pptx" | "html") =>
    selected
      ? `/api/atelier/opportunities/${oppId}/pov.${ext}?povId=${encodeURIComponent(pov.id)}&versionId=${encodeURIComponent(selected.id)}`
      : `/api/atelier/opportunities/${oppId}/pov.${ext}?povId=${encodeURIComponent(pov.id)}`;

  return (
    <div className="space-y-5">
      <Card className="p-6 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          {editMeta ? (
            <Input
              value={metaForm.title}
              onChange={(e) => setMetaForm({ ...metaForm, title: e.target.value })}
              className="bg-bg-deep border-border text-text text-lg font-semibold"
              data-testid="input-pov-title"
            />
          ) : (
            <h3 className="text-lg font-semibold text-text">{pov.title}</h3>
          )}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-xs font-mono text-text-mute">
              {pov.audience} · {pov.depth === "memo" ? "memo" : "full doc"} · {pov.status}
            </span>
            {!editMeta && (
              <button
                onClick={() => setEditMeta(true)}
                className="text-xs text-text-mute hover:text-text underline underline-offset-2"
                data-testid="button-edit-pov-meta"
              >
                Edit
              </button>
            )}
            {pov.currentVersionId && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="pill-btn pill-btn-ghost text-xs inline-flex items-center gap-1"
                    data-testid="button-download-pov"
                  >
                    <Download className="w-3.5 h-3.5" /> Download <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={exportHref("pdf")} download data-testid="button-download-pov-pdf">
                      PDF document
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("pptx")} download data-testid="button-download-pov-pptx">
                      PowerPoint deck
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("html")} download data-testid="button-download-pov-html">
                      Web page (HTML)
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {editMeta ? (
          <div className="space-y-2">
            <Textarea
              value={metaForm.objective}
              onChange={(e) => setMetaForm({ ...metaForm, objective: e.target.value })}
              className="bg-bg-deep border-border text-text min-h-[70px]"
              data-testid="input-pov-objective"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <PillButton variant="ghost" onClick={() => setEditMeta(false)}>Cancel</PillButton>
              <PillButton variant="primary" onClick={saveMeta} disabled={updateMut.isPending}>
                {updateMut.isPending ? "Saving…" : "Save"}
              </PillButton>
            </div>
          </div>
        ) : (
          <p className="text-text-mute text-sm">{pov.objective}</p>
        )}
      </Card>

      <Card className="p-6 space-y-3">
        <h4 className="text-xs uppercase tracking-widest font-mono text-text-faint">Outline</h4>
        <ol className="space-y-2 text-sm">
          {pov.outline.map((s: AtelierPovOutlineSection, i: number) => (
            <li key={s.id} className="border-l-2 border-border-soft pl-3">
              <div className="text-text font-medium flex items-center gap-2 flex-wrap">
                <span>{i + 1}. {s.heading}</span>
                {s.type && (
                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 border ${
                      s.type === "positioning"
                        ? "text-gold border-gold/40 bg-gold/10"
                        : "text-text-mute border-border-soft bg-bg-deep/50"
                    }`}
                    data-testid={`badge-outline-type-${s.id}`}
                  >
                    {s.type === "positioning" ? (s.archetype ? `positioning · ${s.archetype}` : "positioning") : "evidence"}
                  </span>
                )}
              </div>
              <div className="text-text-mute text-xs mt-0.5">{s.intent}</div>
              {s.factIds.length === 0 ? (
                <div className="text-[10px] font-mono text-text-faint mt-1">
                  {s.type === "positioning" ? "positioning — no citations required" : "cites: —"}
                </div>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {s.factIds.map((fid) => {
                    const f = factById.get(fid);
                    if (!f) {
                      return (
                        <li key={fid} className="text-[10px] font-mono text-text-faint">
                          cites {fid}
                        </li>
                      );
                    }
                    return (
                      <li key={fid} className="text-xs text-text-mute bg-bg-deep/50 rounded px-2 py-1">
                        <span className="text-text">{f.statement}</span>
                        <span className="ml-2 text-[10px] font-mono text-text-faint">
                          {f.sourceTitle ?? (f.sourceUrl ? new URL(f.sourceUrl).hostname : "unsourced")}
                          {f.retrievedAt ? ` · ${new Date(f.retrievedAt).toLocaleDateString()}` : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ol>
        {pov.status === "outline" && (
          <div className="pt-3 border-t border-border-soft space-y-3">
            <div className="space-y-2">
              <Label htmlFor="pov-outline-feedback" className="text-xs text-text-mute">Request changes to the outline</Label>
              <Textarea
                id="pov-outline-feedback"
                value={outlineFeedback}
                onChange={(e) => setOutlineFeedback(e.target.value)}
                placeholder="e.g. Lead with the cost tension, add a section on delivery risk…"
                className="bg-bg-deep border-border text-text min-h-[60px]"
                data-testid="input-outline-feedback"
              />
              <div className="flex justify-end">
                <PillButton
                  variant="ghost"
                  onClick={regenerateOutline}
                  disabled={regenMut.isPending}
                  data-testid="button-regenerate-outline"
                >
                  {regenMut.isPending ? "Regenerating…" : "Regenerate outline"}
                </PillButton>
              </div>
            </div>
            <div className="flex justify-end">
              <PillButton
                variant="primary"
                onClick={approveOutlineAndDraft}
                disabled={draftMut.isPending || generating === "draft"}
                data-testid="button-approve-outline"
              >
                {draftMut.isPending || generating === "draft"
                  ? runPhase ?? "Drafting… (a few minutes)"
                  : "Approve outline & generate draft"}
              </PillButton>
            </div>
          </div>
        )}
      </Card>

      {selected && (
        <Card className="p-6 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-xs uppercase tracking-widest font-mono text-text-faint">Draft</h4>
            <div className="flex items-center gap-3">
              {versionList.length > 1 && (
                <select
                  value={selected.id}
                  onChange={(e) => setSelectedVersionId(e.target.value)}
                  className="text-xs font-mono bg-bg-deep border border-border text-text rounded px-2 py-1"
                  data-testid="select-pov-version"
                >
                  {versionList.map((v: AtelierPovVersion) => (
                    <option key={v.id} value={v.id}>
                      v{v.versionNumber}{v.id === pov.currentVersionId ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              )}
              <span className="text-xs font-mono text-text-mute">
                v{selected.versionNumber} · citation coverage {Math.round((selected.citationCoverage ?? 0) * 100)}%
              </span>
            </div>
          </div>
          <div
            className="prose prose-invert max-w-none text-sm text-text [&_h1]:text-xl [&_h2]:text-base [&_h2]:text-gold [&_h2]:mt-4 [&_p]:text-text-mute [&_sup]:text-gold"
            dangerouslySetInnerHTML={{ __html: sanitizedBody }}
          />
          {selected.notes && <div className="text-[11px] font-mono text-warn">stylist notes: {selected.notes}</div>}

          <div className="pt-3 border-t border-border-soft space-y-2">
            <Label htmlFor="pov-draft-feedback" className="text-xs text-text-mute">Request changes to this draft</Label>
            <Textarea
              id="pov-draft-feedback"
              value={draftFeedback}
              onChange={(e) => setDraftFeedback(e.target.value)}
              placeholder="Describe what should change — a new revision (kept alongside this one) will be generated."
              className="bg-bg-deep border-border text-text min-h-[70px]"
              data-testid="input-draft-feedback"
            />
            <div className="flex justify-end">
              <PillButton
                variant="primary"
                onClick={requestChanges}
                disabled={reviseMut.isPending || generating === "revise"}
                data-testid="button-request-changes"
              >
                {reviseMut.isPending || generating === "revise"
                  ? runPhase ?? "Revising… (a few minutes)"
                  : "Request changes"}
              </PillButton>
            </div>
          </div>
        </Card>
      )}

      {pov.runId && selected && (
        <ApproveEditReject personaName={personaName} onDecision={onDecision} />
      )}
    </div>
  );
}
