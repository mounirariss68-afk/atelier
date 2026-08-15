/**
 * Alliance Evaluation panel (Task #526).
 *
 * Renders the Alliance Cartographer's framework-native evaluation for one
 * partner firm: archetype + partnership stage, fit scorecard (weighted
 * dimensions + verdict), due-diligence gates, risk register, phasing, and
 * the agent-proposal review queue (approve applies, reject records).
 *
 * Agent trigger/status/decide routes are bespoke (not in openapi) — raw
 * fetch with 202 + poll, same pattern as the Account AI tab.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Sparkles, RefreshCw, Check, X, ExternalLink } from "lucide-react";
import {
  getAtelierListPartnerFirmsQueryKey,
  type AtelierPartnerFirm,
} from "@workspace/api-client-react";

const API = `${import.meta.env.BASE_URL}api/atelier`;

type AgentStatus = {
  status: string;
  phase?: string | null;
  runId?: string | null;
  proposedCount?: number;
  summary?: string;
};

type StatusPayload = {
  agents: Record<string, AgentStatus>;
  pendingProposals: number;
};

function verdictTone(v?: string): "gold" | "green" | "amber" | "red" | "default" {
  if (v === "proceed") return "green";
  if (v === "limited") return "amber";
  if (v === "decline") return "red";
  return "default";
}

function gateTone(s?: string): "gold" | "green" | "amber" | "red" | "default" {
  if (s === "pass") return "green";
  if (s === "conditional") return "amber";
  if (s === "fail") return "red";
  return "default";
}

function evidenceLabel(e?: string): string | null {
  if (!e || e === "evidenced") return null;
  return e; // "inferred" | "unverified" — flag the softer evidence levels
}

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

export function AllianceVerdictChip({ firm }: { firm: AtelierPartnerFirm }) {
  const v = firm.fitScorecard?.verdict;
  if (!v) return null;
  return <MonoChip tone={verdictTone(v)}>{v}</MonoChip>;
}

export function AllianceEvaluationPanel({
  firm,
  canEdit,
}: {
  firm: AtelierPartnerFirm;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<StatusPayload | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [deciding, setDeciding] = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const invalidateFirms = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: getAtelierListPartnerFirmsQueryKey() });
  }, [qc]);

  const fetchStatus = React.useCallback(async (): Promise<StatusPayload | null> => {
    try {
      const r = await fetch(`${API}/partners/firms/${firm.id}/agents/status`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = (await r.json()) as StatusPayload;
      setStatus(j);
      return j;
    } catch {
      setErr("Could not load agent status.");
      return null;
    }
  }, [firm.id]);

  const anyRunning =
    status != null &&
    Object.values(status.agents).some((a) => a.status === "running");

  // Initial load + poll while an agent is running.
  React.useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  React.useEffect(() => {
    if (!anyRunning) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        // A run just finished — refresh the firm record for new proposals.
        invalidateFirms();
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void fetchStatus(), 5000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [anyRunning, fetchStatus, invalidateFirms]);

  const launch = async (agent: "alliance-cartographer" | "alliance-mapper") => {
    setErr(null);
    try {
      const r = await fetch(`${API}/partners/firms/${firm.id}/agents/${agent}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      if (r.status === 409) {
        setErr("A run is already in progress for this partner.");
      } else if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { message?: string } | null;
        setErr(j?.message ?? "Could not start the agent run.");
      }
      await fetchStatus();
    } catch {
      setErr("Could not start the agent run.");
    }
  };

  const decide = async (proposalId: string, action: "approve" | "reject") => {
    setErr(null);
    setDeciding(proposalId);
    try {
      const r = await fetch(
        `${API}/partners/firms/${firm.id}/proposals/${proposalId}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action }),
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { message?: string } | null;
        setErr(j?.message ?? `Could not ${action} the proposal.`);
      }
      invalidateFirms();
      await fetchStatus();
    } catch {
      setErr(`Could not ${action} the proposal.`);
    } finally {
      setDeciding(null);
    }
  };

  const sc = firm.fitScorecard;
  const dd = firm.dueDiligence;
  const risks = firm.riskRegister ?? [];
  const phasing = firm.phasing;
  const pending = (firm.pendingUpdates ?? []).filter((u) => u.status === "pending");
  const carto = status?.agents?.alliance_cartographer;
  const mapper = status?.agents?.alliance_executive_mapper;
  const hasEvaluation = !!(sc || dd || risks.length || phasing);

  return (
    <div
      className="mt-2 border-t border-border-soft pt-3 space-y-4"
      data-testid={`panel-evaluation-${firm.id}`}
    >
      {/* header: archetype/stage + run buttons */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            Evaluation
          </span>
          {firm.archetype && <MonoChip tone="gold">{firm.archetype.replace(/_/g, " ")}</MonoChip>}
          {firm.partnershipStage && (
            <MonoChip tone={firm.partnershipStage === "agreed" ? "green" : "amber"}>
              {firm.partnershipStage}
            </MonoChip>
          )}
          {firm.partnershipStage === "agreed" && firm.agreementStage && (
            <MonoChip
              tone={firm.agreementStage === "signed" || firm.agreementStage === "signing" ? "gold" : "default"}
            >
              agreement · {firm.agreementStage}
            </MonoChip>
          )}
          {sc?.verdict && (
            <MonoChip tone={verdictTone(sc.verdict)}>
              {sc.verdict}
              {sc.weightedTotal != null ? ` · ${sc.weightedTotal.toFixed(1)}/5` : ""}
            </MonoChip>
          )}
          {dd?.overall && <MonoChip tone={gateTone(dd.overall)}>DD {dd.overall.replace("_", " ")}</MonoChip>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <PillButton
              variant="ghost"
              disabled={anyRunning}
              onClick={() => void launch("alliance-cartographer")}
              data-testid={`button-run-cartographer-${firm.id}`}
            >
              <Sparkles className="w-3.5 h-3.5 mr-1 inline" />
              {carto?.status === "running" ? "Evaluating…" : "Run evaluation"}
            </PillButton>
            <PillButton
              variant="ghost"
              disabled={anyRunning}
              onClick={() => void launch("alliance-mapper")}
              data-testid={`button-run-mapper-${firm.id}`}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1 inline" />
              {mapper?.status === "running" ? "Sweeping…" : "Executive sweep"}
            </PillButton>
          </div>
        )}
      </div>

      {/* live run status */}
      {(carto?.status === "running" || mapper?.status === "running") && (
        <p className="text-xs text-gold/90 animate-pulse" data-testid={`text-run-phase-${firm.id}`}>
          {carto?.status === "running"
            ? `Alliance Cartographer — ${carto.phase ?? "working…"}`
            : `Executive Mapper — ${mapper?.phase ?? "working…"}`}
        </p>
      )}
      {carto?.status === "failed" && (
        <p className="text-xs text-red-400">Last evaluation failed: {carto.phase ?? "unknown error"}</p>
      )}
      {mapper?.status === "failed" && (
        <p className="text-xs text-red-400">Last executive sweep failed: {mapper.phase ?? "unknown error"}</p>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}

      {!hasEvaluation && pending.length === 0 && (
        <p className="text-xs text-text-faint">
          No evaluation yet.{" "}
          {canEdit ? "Run the evaluation to score this partner against the alliance framework." : ""}
        </p>
      )}

      {/* fit scorecard */}
      {sc?.dimensions && sc.dimensions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            Fit scorecard{sc.scoredAt ? ` · ${fmtDate(sc.scoredAt)}` : ""}
          </div>
          <div className="space-y-1">
            {sc.dimensions.map((d) => (
              <div key={d.id ?? d.label} className="flex items-start gap-2 text-xs">
                <MonoChip tone={(d.score ?? 0) >= 4 ? "green" : (d.score ?? 0) >= 3 ? "amber" : "red"}>
                  {d.score ?? "—"}
                </MonoChip>
                <div className="min-w-0">
                  <span className="text-text">{d.label}</span>
                  {d.weight != null && (
                    <span className="text-text-faint"> · w{Math.round(d.weight * 100)}%</span>
                  )}
                  {evidenceLabel(d.evidence) && (
                    <span className="text-amber-400/80"> · {evidenceLabel(d.evidence)}</span>
                  )}
                  {d.rationale && <div className="text-text-faint">{d.rationale}</div>}
                </div>
              </div>
            ))}
          </div>
          {sc.watchouts && sc.watchouts.length > 0 && (
            <div className="text-xs text-amber-400/90">
              Watch-outs: {sc.watchouts.join(" · ")}
            </div>
          )}
        </div>
      )}

      {/* due-diligence gates */}
      {dd?.gates && dd.gates.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            Due diligence{dd.assessedAt ? ` · ${fmtDate(dd.assessedAt)}` : ""}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dd.gates.map((g) => (
              <span key={g.id ?? g.label} title={g.notes ?? undefined}>
                <MonoChip tone={gateTone(g.status)}>
                  {g.label}: {(g.status ?? "?").replace("_", " ")}
                </MonoChip>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* risk register */}
      {risks.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Risks</div>
          {risks.map((r) => (
            <div key={r.id ?? r.risk} className="text-xs flex items-start gap-2">
              <MonoChip tone={r.severity === "high" ? "red" : r.severity === "med" ? "amber" : "default"}>
                {r.severity ?? "?"}
              </MonoChip>
              <div className="min-w-0">
                <span className="text-text">{r.risk}</span>
                {r.mitigation && <span className="text-text-faint"> — {r.mitigation}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* phasing */}
      {phasing?.phase && (
        <div className="text-xs">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-2">
            Phase
          </span>
          <MonoChip tone="gold">{phasing.phase}</MonoChip>
          {phasing.milestone && <span className="text-text-mute ml-2">{phasing.milestone}</span>}
          {phasing.note && <div className="text-text-faint mt-0.5">{phasing.note}</div>}
        </div>
      )}

      {/* capability profile — Task #871 (approved research; feeds Riser retrieval) */}
      {(() => {
        const cp = firm.capabilityProfile as
          | {
              summary?: string;
              domains?: Array<{ id?: string; label?: string; description?: string; sourceUrls?: string[] }>;
            }
          | null
          | undefined;
        if (!cp || (!cp.summary && !(cp.domains?.length))) return null;
        return (
          <div className="space-y-1.5" data-testid="section-capability-profile">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
              Capability profile
            </div>
            {cp.summary && <div className="text-xs text-text-mute">{cp.summary}</div>}
            {(cp.domains ?? []).map((d) => (
              <div key={d.id ?? d.label} className="text-xs flex items-start gap-2">
                <MonoChip tone="gold">{d.label}</MonoChip>
                <div className="min-w-0">
                  <span className="text-text">{d.description}</span>
                  {(d.sourceUrls ?? []).slice(0, 2).map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="text-text-faint underline ml-1 break-all">
                      source
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* proposal review queue */}
      {pending.length > 0 && (
        <Card className="p-3 space-y-2 border-gold/30">
          <div className="text-[10px] font-mono uppercase tracking-widest text-gold">
            Agent proposals awaiting review ({pending.length})
          </div>
          {pending.map((p) => {
            // Task #971 — an enrichment of a known contact must read as an
            // update to that person, never a new-person suggestion.
            const meta = p.meta as
              | { updateKind?: string; existingContactName?: string }
              | null
              | undefined;
            const isEnrichment =
              p.field === "contact" && meta?.updateKind === "enrichment";
            const chip =
              p.field === "contact"
                ? isEnrichment
                  ? "existing contact — update"
                  : "new contact"
                : p.field;
            return (
            <div
              key={p.id}
              className="flex flex-wrap items-start justify-between gap-3 text-xs border-b border-border-soft last:border-0 pb-2 last:pb-0"
              data-testid={`row-proposal-${p.id}`}
            >
              <div className="min-w-0">
                <div className="text-text">
                  <MonoChip>{chip}</MonoChip>
                  {isEnrichment && meta?.existingContactName && (
                    <span className="text-text-faint ml-2">
                      updates {meta.existingContactName}
                    </span>
                  )}
                  {p.proposedBy && (
                    <span className="text-text-faint ml-2">
                      by {String(p.proposedBy).replace(/_/g, " ")}
                      {p.proposedAt ? ` · ${fmtDate(p.proposedAt)}` : ""}
                    </span>
                  )}
                </div>
                {p.rationale && <div className="text-text-faint mt-0.5">{p.rationale}</div>}
              </div>
              {canEdit && (
                <div className="flex gap-2 shrink-0">
                  <button
                    className="text-xs font-mono uppercase tracking-widest text-green-400/90 hover:text-green-300 inline-flex items-center gap-1 disabled:opacity-50"
                    disabled={deciding === p.id}
                    onClick={() => void decide(p.id!, "approve")}
                    data-testid={`button-approve-${p.id}`}
                  >
                    <Check className="w-3 h-3" /> approve
                  </button>
                  <button
                    className="text-xs font-mono uppercase tracking-widest text-text-faint hover:text-red-400 inline-flex items-center gap-1 disabled:opacity-50"
                    disabled={deciding === p.id}
                    onClick={() => void decide(p.id!, "reject")}
                    data-testid={`button-reject-${p.id}`}
                  >
                    <X className="w-3 h-3" /> reject
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </Card>
      )}

      {/* source links from the scorecard, deduped */}
      {sc?.dimensions && (
        <SourceLinks
          urls={[
            ...new Set(
              sc.dimensions.flatMap((d) => d.sourceUrls ?? []).concat(
                (dd?.gates ?? []).flatMap((g) => g.sourceUrls ?? []),
              ),
            ),
          ]}
        />
      )}
    </div>
  );
}

function SourceLinks({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {urls.slice(0, 8).map((u) => {
        let host = u;
        try {
          host = new URL(u).hostname.replace(/^www\./, "");
        } catch {
          /* keep raw */
        }
        return (
          <a
            key={u}
            href={u}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-text-faint hover:text-gold inline-flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" /> {host}
          </a>
        );
      })}
    </div>
  );
}
