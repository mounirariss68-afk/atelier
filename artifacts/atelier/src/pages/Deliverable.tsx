import * as React from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, FileText, Wand2, Send, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  useAtelierGetDeliverable,
  useAtelierDraftDeliverable,
  useAtelierCritiqueDeliverable,
  useAtelierSendDeliverable,
  useAtelierGetMe,
  getAtelierGetDeliverableQueryKey,
  getAtelierListAuditQueryKey,
  getAtelierListDeliverablesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { SectionHead, PageHero, MonoChip, Card, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditTab } from "@/components/AuditTab";
import { useToast } from "@/hooks/use-toast";

const TABS = [
  { id: "draft", label: "Draft + Critique" },
  { id: "versions", label: "Version diff" },
  { id: "audit", label: "Audit Trail" },
];

export default function Deliverable() {
  const [, params] = useRoute("/engagements/:engId/deliverables/:delId");
  const engId = params?.engId ?? "";
  const delId = params?.delId ?? "";
  const [activeTab, setActiveTab] = React.useState("draft");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const { data, isLoading, isError } = useAtelierGetDeliverable(delId);
  const draft = useAtelierDraftDeliverable();
  const critique = useAtelierCritiqueDeliverable();
  const send = useAtelierSendDeliverable();

  function inv() {
    qc.invalidateQueries({ queryKey: getAtelierGetDeliverableQueryKey(delId) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    qc.invalidateQueries({ queryKey: getAtelierListDeliverablesQueryKey(engId) });
  }

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (isError || !data) return <div className="container-atelier py-12 text-danger">Failed to load deliverable.</div>;

  const d = data.deliverable;
  const versions = data.versions ?? [];
  const current = versions.find((v) => v.id === d.currentVersionId) ?? versions[0];
  const previous = versions.find((v) => v.versionNumber === (current?.versionNumber ?? 0) - 1);

  async function onScaffold(includeDefects: boolean) {
    await draft.mutateAsync({
      delId,
      data: { scaffold: true, includeDefects, notes: includeDefects ? "Seeded with defects to exercise the Critic" : "Clean scaffold" },
    });
    inv();
    toast({ title: "Drafted", description: includeDefects ? "Scaffold with seeded defects." : "Clean scaffold." });
  }

  async function onCritique() {
    const r = await critique.mutateAsync({ delId, data: { audience: "Client executive" } });
    inv();
    toast({
      title: `Critic: ${r.readiness.toUpperCase()}`,
      description: `${r.issues.length} issues · pyramid ${Math.round(r.pyramidScore * 100)}% · evidence ${r.evidenceCoveragePct}%`,
    });
  }

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Link
          href={`/engagements/${engId}`}
          className="inline-flex items-center gap-2 text-xs font-mono text-text-mute hover:text-text mb-6 transition-colors"
          data-testid="link-back-engagement"
        >
          <ArrowLeft className="w-4 h-4" /> Back to engagement
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead
            eyebrow={d.type}
            headline={d.name}
            lede={
              <div className="flex items-center gap-3 mt-2">
                <MonoChip
                  tone={
                    d.status === "sent" ? "green" :
                    d.status === "approved" ? "gold" :
                    d.status === "in_review" ? "amber" : "default"
                  }
                >
                  {d.status}
                </MonoChip>
                {d.criticReadiness && (
                  <MonoChip
                    tone={d.criticReadiness === "green" ? "green" : d.criticReadiness === "amber" ? "amber" : "red"}
                  >
                    Critic: {d.criticReadiness}
                  </MonoChip>
                )}
                <span className="font-mono text-xs text-text-mute">{d.id}</span>
              </div>
            }
          />
          <SendBar
            delId={delId}
            engId={engId}
            readiness={d.criticReadiness}
            partnerApprovedByName={d.partnerApprovedByName ?? null}
            sentAt={d.sentAt ?? null}
            isPartner={me?.role === "partner"}
            sending={send.isPending}
            onSend={async (override, rationale) => {
              try {
                await send.mutateAsync({
                  delId,
                  data: { override, rationale: rationale || undefined },
                });
                inv();
                toast({ title: "Sent to client", description: override ? "HAPA override recorded." : "Critic GREEN." });
              } catch (err) {
                const msg =
                  (err && typeof err === "object" && "data" in err && (err as { data?: { reason?: string } }).data?.reason) ||
                  (err && typeof err === "object" && "message" in err && (err as { message?: string }).message) ||
                  "Send blocked";
                toast({ title: "Send blocked", description: String(msg), variant: "destructive" });
              }
            }}
          />
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-8">
        <div className="border-b border-border">
          <div className="flex gap-6 overflow-x-auto scrollbar-thin">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                data-testid={`tab-deliverable-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  activeTab === tab.id ? "border-gold text-gold" : "border-transparent text-text-mute hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="py-4">
          {activeTab === "audit" && <AuditTab entityType="deliverable" entityId={delId} />}

          {activeTab === "draft" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                <Card className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
                      Current draft {current ? `· v${current.versionNumber}` : ""}
                    </div>
                    <div className="flex gap-2">
                      <PillButton
                        variant="ghost"
                        onClick={() => onScaffold(false)}
                        disabled={draft.isPending}
                        data-testid="btn-scaffold-clean"
                      >
                        <Wand2 className="w-3.5 h-3.5 mr-1.5" /> Clean scaffold
                      </PillButton>
                      <PillButton
                        variant="ghost"
                        onClick={() => onScaffold(true)}
                        disabled={draft.isPending}
                        data-testid="btn-scaffold-defects"
                      >
                        <Wand2 className="w-3.5 h-3.5 mr-1.5" /> Scaffold w/ defects
                      </PillButton>
                      <PillButton
                        variant="primary"
                        onClick={onCritique}
                        disabled={critique.isPending || !current}
                        data-testid="btn-critique"
                      >
                        {critique.isPending ? "Critiquing…" : "Run Synthesis Critic"}
                      </PillButton>
                    </div>
                  </div>
                  {!current ? (
                    <div className="py-12 text-center text-text-mute font-mono">
                      No draft yet. Use one of the scaffold actions to create v1.
                    </div>
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap font-mono text-text bg-bg-deep p-4 rounded-md max-h-[600px] overflow-auto">
                      {current.body}
                    </pre>
                  )}
                </Card>
              </div>
              <div className="space-y-4">
                <CriticPanel
                  readiness={d.criticReadiness}
                  pyramidScore={data.pyramidScore ?? null}
                  evidenceCoveragePct={data.evidenceCoveragePct ?? null}
                  offHypothesisSections={data.offHypothesisSections ?? []}
                  issues={data.latestCriticIssues as never}
                />
              </div>
            </div>
          )}

          {activeTab === "versions" && (
            <Card className="p-5 space-y-4">
              {versions.length < 1 ? (
                <div className="text-text-mute font-mono py-6">No versions yet.</div>
              ) : (
                <>
                  <div className="text-xs font-mono uppercase text-text-mute">
                    {versions.length} version{versions.length === 1 ? "" : "s"}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <DiffPane label="Previous" v={previous ?? null} />
                    <DiffPane label="Current" v={current ?? null} />
                  </div>
                  {previous && current && (
                    <SimpleDiff prev={previous.body} curr={current.body} />
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function CriticPanel({
  readiness,
  pyramidScore,
  evidenceCoveragePct,
  offHypothesisSections,
  issues,
}: {
  readiness: "green" | "amber" | "red" | null;
  pyramidScore: number | null;
  evidenceCoveragePct: number | null;
  offHypothesisSections: string[];
  issues: { id?: string; type?: string; severity?: string; location?: string; description?: string; suggestion?: string }[];
}) {
  return (
    <Card className="p-5 space-y-4" data-testid="critic-panel">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono uppercase text-text-mute">Synthesis Critic</div>
        {readiness ? (
          <MonoChip tone={readiness === "green" ? "green" : readiness === "amber" ? "amber" : "red"}>
            {readiness}
          </MonoChip>
        ) : (
          <MonoChip>not run</MonoChip>
        )}
      </div>
      {(pyramidScore !== null || evidenceCoveragePct !== null) && (
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          <div className="bg-bg-deep p-2 rounded">
            Pyramid<br />
            <span className="text-text text-base">{pyramidScore !== null ? `${Math.round(pyramidScore * 100)}%` : "—"}</span>
          </div>
          <div className="bg-bg-deep p-2 rounded">
            Evidence<br />
            <span className="text-text text-base">{evidenceCoveragePct !== null ? `${evidenceCoveragePct}%` : "—"}</span>
          </div>
        </div>
      )}
      {offHypothesisSections.length > 0 && (
        <div className="text-xs">
          <div className="font-mono text-text-mute uppercase mb-1">Off-hypothesis sections</div>
          <div className="flex flex-wrap gap-1">
            {offHypothesisSections.map((s, i) => <MonoChip key={i} tone="amber">{s}</MonoChip>)}
          </div>
        </div>
      )}
      <div className="space-y-2">
        <div className="text-xs font-mono text-text-mute uppercase">{issues.length} issue{issues.length === 1 ? "" : "s"}</div>
        {issues.length === 0 && readiness === "green" && (
          <div className="text-positive text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> No issues raised.
          </div>
        )}
        {issues.map((iss, i) => (
          <div
            key={iss.id ?? i}
            className="border border-border-soft rounded-md p-3 bg-bg-deep space-y-1"
            data-testid={`critic-issue-${i}`}
          >
            <div className="flex items-center justify-between">
              <MonoChip tone={iss.severity === "high" ? "red" : iss.severity === "med" ? "amber" : "default"}>
                {iss.severity ?? "—"}
              </MonoChip>
              <span className="text-[10px] font-mono text-text-mute">
                {iss.location}
                {iss.type ? ` · ${iss.type}` : ""}
              </span>
            </div>
            <div className="text-sm text-text">{iss.description}</div>
            {iss.suggestion && (
              <div className="text-xs text-text-mute italic">→ {iss.suggestion}</div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function DiffPane({ label, v }: { label: string; v: { versionNumber: number; body: string } | null }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-mono uppercase text-text-mute">{label}{v ? ` · v${v.versionNumber}` : ""}</div>
      <pre className="text-[11px] whitespace-pre-wrap font-mono text-text bg-bg-deep p-3 rounded-md max-h-[420px] overflow-auto">
        {v?.body ?? "(none)"}
      </pre>
    </div>
  );
}

function SimpleDiff({ prev, curr }: { prev: string; curr: string }) {
  const a = prev.split("\n");
  const b = curr.split("\n");
  const max = Math.max(a.length, b.length);
  const lines: { kind: "same" | "add" | "del"; text: string }[] = [];
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      if (a[i] !== undefined) lines.push({ kind: "same", text: a[i] });
    } else {
      if (a[i] !== undefined) lines.push({ kind: "del", text: a[i] });
      if (b[i] !== undefined) lines.push({ kind: "add", text: b[i] });
    }
  }
  return (
    <div className="border border-border-soft rounded-md bg-bg-deep p-3 max-h-[400px] overflow-auto" data-testid="version-diff">
      <div className="text-xs font-mono uppercase text-text-mute mb-2">Diff</div>
      <pre className="text-[11px] font-mono leading-relaxed">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "add" ? "text-positive bg-positive/5"
              : l.kind === "del" ? "text-danger bg-danger/5"
              : "text-text-mute"
            }
          >
            <span className="inline-block w-4">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

function SendBar({
  readiness,
  partnerApprovedByName,
  sentAt,
  isPartner,
  sending,
  onSend,
}: {
  delId: string;
  engId: string;
  readiness: "green" | "amber" | "red" | null;
  partnerApprovedByName: string | null;
  sentAt: string | null;
  isPartner: boolean;
  sending: boolean;
  onSend: (override: boolean, rationale: string) => Promise<void>;
}) {
  const [showOverride, setShowOverride] = React.useState(false);
  const [rationale, setRationale] = React.useState("");

  if (sentAt) {
    return (
      <div className="rounded-md border border-positive/40 bg-positive/5 px-4 py-3 text-sm text-positive flex items-center gap-2" data-testid="send-bar-sent">
        <ShieldCheck className="w-4 h-4" />
        Sent {new Date(sentAt).toLocaleString()}
        {partnerApprovedByName && <span className="text-text-mute ml-2">· by {partnerApprovedByName}</span>}
      </div>
    );
  }

  if (readiness === "green") {
    return (
      <div className="flex flex-col items-end gap-2" data-testid="send-bar-green">
        <PillButton
          variant="primary"
          onClick={() => onSend(false, "")}
          disabled={sending}
          data-testid="btn-send-green"
        >
          <Send className="w-3.5 h-3.5 mr-1.5" /> {sending ? "Sending…" : "Send to client"}
        </PillButton>
        <span className="text-[10px] font-mono uppercase text-positive">Critic GREEN — lock open</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2 max-w-sm" data-testid="send-bar-locked">
      <div className="rounded-md border border-amber/40 bg-amber/5 px-3 py-2 text-xs text-amber flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5" />
        Partner Authority Lock — Critic readiness {readiness?.toUpperCase() ?? "PENDING"}
      </div>
      {!isPartner ? (
        <span className="text-[10px] font-mono text-text-mute uppercase">
          Only Partner persona may override
        </span>
      ) : !showOverride ? (
        <PillButton
          variant="ghost"
          onClick={() => setShowOverride(true)}
          data-testid="btn-show-override"
        >
          Override as Partner…
        </PillButton>
      ) : (
        <div className="w-full space-y-2 bg-bg-deep border border-border-soft rounded-md p-3">
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            placeholder="Rationale (≥ 8 chars; permanently logged in HAPA audit)"
            className="w-full bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-xs text-text"
            data-testid="input-override-rationale"
          />
          <div className="flex justify-end gap-2">
            <PillButton variant="ghost" onClick={() => setShowOverride(false)}>Cancel</PillButton>
            <PillButton
              variant="primary"
              onClick={() => onSend(true, rationale)}
              disabled={sending || rationale.trim().length < 8}
              data-testid="btn-send-override"
            >
              <Send className="w-3.5 h-3.5 mr-1.5" /> {sending ? "Overriding…" : "Override + Send"}
            </PillButton>
          </div>
        </div>
      )}
    </div>
  );
}
