/**
 * Atelier — Codex contract workspace.
 * Task #360 (L2C Wave 1, Step 2 — frontend).
 *
 * Renders one contract end-to-end:
 *   - Header (instrument, status, value, term, governing law)
 *   - Parties (signers + signing method + state)
 *   - Clauses (instantiated body, position-ordered)
 *   - Two-partner countersign panel
 *      • partner-tier persona may countersign (first-call sets B, second
 *        call by B flips state to both_signed and auto-transitions
 *        contract → two_partner_countersigned)
 *      • non-partner personas see read-only state
 *   - Versions / state transition controls (partner|finance only)
 *   - Audit timeline (entityType=contract, entityId)
 */

import * as React from "react";
import { Link, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  useAtelierListPersonas,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import {
  PageHero,
  BackLink,
  SectionHead,
  Card,
  MonoChip,
  PillButton,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, FileSignature, Users, Library } from "lucide-react";

const API = "/api/atelier";

interface ContractDetail {
  contract: {
    id: string;
    instrumentType: string;
    title: string;
    status: string;
    counterpartyId: string;
    engagementId: string | null;
    contractValue: number | null;
    contractValueUsd: number | null;
    currency: string | null;
    governingLaw: string | null;
    termStart: string | null;
    termEnd: string | null;
    paymentTermsDays: number;
  };
  parties: Array<{
    id: string;
    roleOnContract: string;
    signerName: string;
    signerEmail: string;
    signerTitle: string;
    signMethod: string;
    signState: string;
  }>;
  clauses: Array<{
    id: string;
    position: number;
    title: string;
    body: string;
    sourceClauseId: string | null;
  }>;
  versions: Array<{
    id: string;
    version: number;
    snapshotReason: string;
    createdAt: string;
  }>;
  countersign: {
    id: string;
    partnerAUserId: string;
    partnerBUserId: string;
    partnerASignedAt: string | null;
    partnerBSignedAt: string | null;
    state: string;
    rationaleText: string;
  } | null;
}

const STATUS_TONE: Record<string, "default" | "gold" | "green" | "amber" | "red"> = {
  draft: "default",
  internal_review: "amber",
  two_partner_countersigned: "gold",
  external_dispatched: "amber",
  counterparty_review: "amber",
  fully_executed: "green",
  active: "green",
  expiring: "amber",
  renewed: "gold",
  expired: "default",
  terminated: "red",
};

// Mirror of CONTRACT_TRANSITIONS in api-server/src/routes/atelier/codexRoutes.ts.
// `internal_review -> two_partner_countersigned` is intentionally omitted from
// the generic transition row because that move happens via the dedicated
// two-partner countersign panel (after both partners sign), not as a free-form
// state push.
const NEXT_STATES: Record<string, string[]> = {
  draft: ["internal_review", "terminated"],
  internal_review: ["draft", "terminated"],
  two_partner_countersigned: ["external_dispatched", "internal_review", "terminated"],
  external_dispatched: ["counterparty_review", "internal_review", "terminated"],
  counterparty_review: ["fully_executed", "internal_review", "terminated"],
  fully_executed: ["active", "terminated"],
  active: ["expiring", "terminated"],
  expiring: ["renewed", "expired", "active", "terminated"],
  renewed: ["terminated"],
};

export default function CodexContract() {
  const [, params] = useRoute("/contracts/codex/contracts/:id");
  const id = params?.id ?? "";
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const { data: personas } = useAtelierListPersonas();

  const { data, isLoading, error } = useQuery({
    queryKey: ["codex-contract", id],
    queryFn: async () => {
      const r = await fetch(`${API}/codex/contracts/${id}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as ContractDetail;
    },
    enabled: !!id,
  });
  // Audit hook's enum doesn't include "contract"; call the route directly.
  const { data: audit } = useQuery({
    queryKey: ["audit", "contract", id],
    queryFn: async () => {
      // The audit endpoint's entityType enum doesn't include "contract", so
      // we filter by entityId only — contract IDs are globally unique.
      const r = await fetch(
        `${API}/audit?entityId=${encodeURIComponent(id)}&limit=50`,
        { credentials: "include" },
      );
      if (!r.ok) return [] as Array<{
        id: string;
        action: string;
        ts: string;
        payloadSummary?: string | null;
      }>;
      return (await r.json()) as Array<{
        id: string;
        action: string;
        ts: string;
        payloadSummary?: string | null;
      }>;
    },
    enabled: !!id,
  });

  const transition = useMutation({
    mutationFn: async (to: string) => {
      const r = await fetch(`${API}/codex/contracts/${id}/transition`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message ?? `transition_${r.status}`);
      }
      return r.json();
    },
    onSuccess: (_d, to) => {
      toast({ title: "Contract", description: `Moved → ${to}` });
      qc.invalidateQueries({ queryKey: ["codex-contract", id] });
      qc.invalidateQueries({ queryKey: ["audit", "contract", id] });
      qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    },
    onError: (e: Error) =>
      toast({ title: "Transition failed", description: e.message, variant: "destructive" }),
  });

  const [partnerB, setPartnerB] = React.useState("");
  const [csRationale, setCsRationale] = React.useState("");
  const countersign = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (partnerB) body.partnerBUserId = partnerB;
      if (csRationale) body.rationaleText = csRationale;
      const r = await fetch(`${API}/codex/contracts/${id}/countersign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `countersign_${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Countersign", description: "Signature recorded." });
      setCsRationale("");
      qc.invalidateQueries({ queryKey: ["codex-contract", id] });
      qc.invalidateQueries({ queryKey: ["audit", "contract", id] });
      qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    },
    onError: (e: Error) =>
      toast({ title: "Countersign failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading)
    return (
      <div className="container-atelier py-12">
        <Skeleton className="h-64 bg-bg-elevate" />
      </div>
    );
  if (error || !data)
    return (
      <div className="container-atelier py-12 text-danger">
        Failed to load contract.
      </div>
    );

  const c = data.contract;
  const isPartner =
    me?.role === "founding_partner" || me?.role === "partner";
  const canWrite = isPartner || me?.role === "finance";
  const cs = data.countersign;
  const partnerOptions = (personas ?? []).filter(
    (p) =>
      (p.role === "founding_partner" || p.role === "partner") &&
      p.id !== me?.id,
  );

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/contracts/codex">Back to Codex</BackLink>
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <SectionHead
            eyebrow={c.instrumentType.toUpperCase()}
            headline={c.title}
            lede={`${c.governingLaw || "—"} · net ${c.paymentTermsDays}d${c.engagementId ? ` · engagement ${c.engagementId}` : ""}`}
          />
          <div className="flex flex-col items-end gap-2">
            <MonoChip tone={STATUS_TONE[c.status] ?? "default"}>
              {c.status}
            </MonoChip>
            <div className="text-[11px] font-mono text-text-mute">
              {c.contractValueUsd != null
                ? `$${Math.round(c.contractValueUsd).toLocaleString()}`
                : c.contractValue != null
                  ? `${c.currency ?? ""} ${Math.round(c.contractValue).toLocaleString()}`
                  : "value masked"}
            </div>
            {(c.termStart || c.termEnd) && (
              <div className="text-[11px] font-mono text-text-faint">
                {c.termStart ?? "?"} → {c.termEnd ?? "?"}
              </div>
            )}
          </div>
        </div>
      </PageHero>

      <div className="container-atelier py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Clauses */}
          <Card className="p-5 space-y-3" data-testid="contract-clauses">
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono uppercase tracking-wide text-text-mute flex items-center gap-1.5">
                <Library className="w-3.5 h-3.5" /> Clauses
              </div>
              <span className="text-[11px] font-mono text-text-faint">
                {data.clauses.length} clause
                {data.clauses.length === 1 ? "" : "s"}
              </span>
            </div>
            {data.clauses.length === 0 ? (
              <div className="text-text-mute text-sm italic">
                No clauses instantiated yet.
              </div>
            ) : (
              <div className="space-y-3">
                {data.clauses.map((cl) => (
                  <div
                    key={cl.id}
                    className="border border-border-soft rounded-md p-3 bg-bg-deep/60"
                    data-testid={`contract-clause-${cl.id}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-sm font-semibold text-text">
                        {cl.position}. {cl.title}
                      </div>
                      {cl.sourceClauseId && (
                        <span className="text-[10px] font-mono text-text-faint">
                          src {cl.sourceClauseId}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-text-mute leading-relaxed whitespace-pre-wrap">
                      {cl.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Audit timeline */}
          <Card className="p-5 space-y-3" data-testid="contract-audit">
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
              Audit timeline
            </div>
            {(audit ?? []).length === 0 ? (
              <div className="text-text-mute text-sm italic">No events.</div>
            ) : (
              <ul className="space-y-2">
                {(audit ?? []).slice(0, 30).map((ev) => (
                  <li
                    key={ev.id}
                    className="text-[12px] border-l-2 border-border-soft pl-3 py-0.5"
                  >
                    <div className="font-mono text-[10px] uppercase text-text-faint tracking-wider">
                      {ev.action} · {new Date(ev.ts).toLocaleString()}
                    </div>
                    <div className="text-text">{ev.payloadSummary}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Side rail */}
        <div className="space-y-6">
          {/* Parties */}
          <Card className="p-5 space-y-3" data-testid="contract-parties">
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Parties
            </div>
            {data.parties.length === 0 ? (
              <div className="text-text-mute text-sm italic">
                No signers added.
              </div>
            ) : (
              <ul className="space-y-2">
                {data.parties.map((p) => (
                  <li
                    key={p.id}
                    className="border border-border-soft rounded-md p-2.5 bg-bg-deep/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text truncate">
                          {p.signerName}
                        </div>
                        <div className="text-[11px] font-mono text-text-mute truncate">
                          {p.signerEmail}
                        </div>
                        {p.signerTitle && (
                          <div className="text-[11px] font-mono text-text-faint truncate">
                            {p.signerTitle}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <MonoChip
                          tone={
                            p.signState === "signed"
                              ? "green"
                              : p.signState === "declined"
                                ? "red"
                                : "default"
                          }
                        >
                          {p.signState}
                        </MonoChip>
                        <span className="text-[10px] font-mono uppercase text-text-faint">
                          {p.roleOnContract} · {p.signMethod}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Two-partner countersign */}
          <Card className="p-5 space-y-3" data-testid="contract-countersign">
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute flex items-center gap-1.5">
              <FileSignature className="w-3.5 h-3.5" /> Two-partner countersign
            </div>
            {!cs ? (
              isPartner &&
              (c.status === "draft" || c.status === "internal_review") ? (
                <div className="space-y-2">
                  <label className="text-[11px] font-mono uppercase text-text-mute">
                    Co-signing partner
                  </label>
                  <select
                    value={partnerB}
                    onChange={(e) => setPartnerB(e.target.value)}
                    className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text"
                    data-testid="select-partner-b"
                  >
                    <option value="">— select partner —</option>
                    {partnerOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.roleLabel})
                      </option>
                    ))}
                  </select>
                  <label className="text-[11px] font-mono uppercase text-text-mute">
                    Rationale
                  </label>
                  <textarea
                    value={csRationale}
                    onChange={(e) => setCsRationale(e.target.value)}
                    className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text min-h-[60px]"
                    placeholder="Why are we signing this?"
                    data-testid="input-countersign-rationale"
                  />
                  <PillButton
                    variant="primary"
                    onClick={() => countersign.mutate()}
                    disabled={!partnerB || countersign.isPending}
                    data-testid="btn-countersign-partner-a"
                  >
                    {countersign.isPending ? "Signing…" : "Sign as partner A"}
                  </PillButton>
                </div>
              ) : (
                <div className="text-text-mute text-sm italic">
                  Awaiting first partner signature.
                </div>
              )
            ) : (
              <div className="space-y-2 text-sm">
                <Row label="State" value={cs.state} mono />
                <Row
                  label="Partner A"
                  value={`${cs.partnerAUserId} · ${cs.partnerASignedAt ? new Date(cs.partnerASignedAt).toLocaleString() : "—"}`}
                  mono
                />
                <Row
                  label="Partner B"
                  value={`${cs.partnerBUserId} · ${cs.partnerBSignedAt ? new Date(cs.partnerBSignedAt).toLocaleString() : "pending"}`}
                  mono
                />
                {cs.rationaleText && (
                  <div className="text-[12px] text-text-mute italic border-l-2 border-border-soft pl-2">
                    “{cs.rationaleText}”
                  </div>
                )}
                {cs.state === "partner_a_signed" &&
                  isPartner &&
                  me?.id === cs.partnerBUserId && (
                    <div className="space-y-2 pt-2 border-t border-border-soft">
                      <textarea
                        value={csRationale}
                        onChange={(e) => setCsRationale(e.target.value)}
                        className="w-full bg-bg-deep border border-border rounded-md px-2 py-1.5 text-sm text-text min-h-[50px]"
                        placeholder="Optional addendum"
                        data-testid="input-countersign-rationale-b"
                      />
                      <PillButton
                        variant="primary"
                        onClick={() => countersign.mutate()}
                        disabled={countersign.isPending}
                        data-testid="btn-countersign-partner-b"
                      >
                        {countersign.isPending
                          ? "Signing…"
                          : "Co-sign as partner B"}
                      </PillButton>
                    </div>
                  )}
              </div>
            )}
          </Card>

          {/* State transitions */}
          {canWrite && (NEXT_STATES[c.status] ?? []).length > 0 && (
            <Card className="p-5 space-y-2" data-testid="contract-transitions">
              <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
                Transitions
              </div>
              <div className="flex flex-wrap gap-2">
                {NEXT_STATES[c.status].map((to) => (
                  <PillButton
                    key={to}
                    variant={to === "terminated" ? "ghost" : "primary"}
                    onClick={() => transition.mutate(to)}
                    disabled={transition.isPending}
                    data-testid={`btn-contract-transition-${to}`}
                    className={
                      to === "terminated"
                        ? "text-danger hover:border-danger"
                        : ""
                    }
                  >
                    <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
                    {to}
                  </PillButton>
                ))}
              </div>
            </Card>
          )}

          {/* Versions */}
          {data.versions.length > 0 && (
            <Card className="p-5 space-y-2" data-testid="contract-versions">
              <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
                Versions
              </div>
              <ul className="space-y-1 text-[12px] font-mono">
                {data.versions.slice(0, 10).map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between text-text-mute"
                  >
                    <span>v{v.version}</span>
                    <span className="text-text-faint">{v.snapshotReason}</span>
                    <span>{new Date(v.createdAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {c.engagementId && (
            <Link
              href={`/clients/deliver/engagements/${c.engagementId}`}
              className="block text-[11px] font-mono uppercase tracking-wider text-gold hover:underline"
            >
              Open engagement →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2 text-[12px]">
      <span className="text-text-faint font-mono uppercase tracking-wider text-[10px] shrink-0 pt-0.5">
        {label}
      </span>
      <span
        className={
          mono ? "font-mono text-text text-right break-all" : "text-text text-right"
        }
      >
        {value}
      </span>
    </div>
  );
}
