import * as React from "react";
import {
  useAtelierGetProposal,
  useAtelierComposeProposal,
  useAtelierApproveProposalSection,
  useAtelierEditProposalSection,
  useAtelierRejectProposalSection,
  useAtelierApproveProposalPricing,
  useAtelierOverrideProposalPricing,
  useAtelierSendProposal,
  useAtelierGetMe,
  getAtelierGetProposalQueryKey,
  type AtelierProposalDetail,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, DollarSign, ShieldCheck } from "lucide-react";

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "default"> = {
  green: "green",
  amber: "amber",
  red: "red",
  approved: "green",
  draft: "default",
};

export function ProposalTab({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useAtelierGetProposal(oppId, {
    query: { enabled: !!oppId, retry: false, queryKey: getAtelierGetProposalQueryKey(oppId) },
  });
  const compose = useAtelierComposeProposal({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const approve = useAtelierApproveProposalSection({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const editSection = useAtelierEditProposalSection({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const rejectSection = useAtelierRejectProposalSection({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const [openSectionId, setOpenSectionId] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const approvePricing = useAtelierApproveProposalPricing({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const overridePricing = useAtelierOverrideProposalPricing({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const { data: me } = useAtelierGetMe();
  const send = useAtelierSendProposal({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAtelierGetProposalQueryKey(oppId) }),
    },
  });
  const [sendError, setSendError] = React.useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  const detail = data as AtelierProposalDetail | undefined;

  if (isError || !detail) {
    return (
      <Card className="p-8 text-center border-dashed bg-bg-deep" data-testid="empty-proposal">
        <FileText className="w-6 h-6 text-gold/60 mx-auto mb-2" />
        <p className="text-text-mute text-sm mb-4">No proposal composed yet.</p>
        <PillButton
          variant="primary"
          data-testid="button-compose-proposal"
          onClick={() => compose.mutate({ oppId, data: {} })}
          disabled={compose.isPending}
        >
          {compose.isPending ? "Composing…" : "Compose proposal"}
        </PillButton>
      </Card>
    );
  }

  const { proposal, sections } = detail;
  const pricing = proposal.pricingModel as
    | { totalRevenueUsd: number; totalCostUsd: number; marginPct: number; verdict: string }
    | undefined;
  const pricingIntentRaw = (proposal.pricingIntent ?? {}) as {
    pricingApprovedAt?: string;
    pricingOverrideAt?: string;
    pricingOverrideByName?: string;
    pricingOverrideRationale?: string;
  };
  const pricingApprovedAt = pricingIntentRaw.pricingApprovedAt;
  const pricingOverrideAt = pricingIntentRaw.pricingOverrideAt;
  const isPartner = me?.role === "partner";
  const pricingNeedsOverride = pricing?.verdict === "partner_override_required";
  const pricingCheckpointMet = pricingNeedsOverride ? !!pricingOverrideAt : !!pricingApprovedAt;
  const matrix = (proposal.complianceMatrix ?? []) as { rfpReqId: string; requirement: string; status: string; evidence: string }[];

  return (
    <div className="space-y-5" data-testid="tab-proposal-content">
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Proposal</div>
            <div className="font-medium text-text">{proposal.title}</div>
          </div>
          <div className="flex items-center gap-2">
            <PillButton
              variant="ghost"
              data-testid="button-recompose-proposal"
              onClick={() => compose.mutate({ oppId, data: {} })}
              disabled={compose.isPending}
            >
              Recompose
            </PillButton>
            {pricingNeedsOverride ? (
              <PillButton
                variant={pricingOverrideAt ? "ghost" : "primary"}
                data-testid="button-override-pricing"
                onClick={() => {
                  if (pricingOverrideAt) return;
                  const rationale = window.prompt(
                    "Margin is below target. Enter partner-override rationale (≥10 chars):",
                  );
                  if (!rationale || rationale.trim().length < 10) return;
                  overridePricing.mutate({ proposalId: proposal.id, data: { rationale: rationale.trim() } });
                }}
                disabled={!isPartner || overridePricing.isPending || !!pricingOverrideAt}
                title={
                  !isPartner ? "Partner-only override"
                  : pricingOverrideAt ? `Overridden by ${pricingIntentRaw.pricingOverrideByName ?? "partner"} — ${pricingIntentRaw.pricingOverrideRationale ?? ""}`
                  : "Margin below target — record partner override"
                }
              >
                {pricingOverrideAt ? "Pricing overridden" :
                  overridePricing.isPending ? "Recording…" : "Override pricing"}
              </PillButton>
            ) : (
              <PillButton
                variant={pricingApprovedAt ? "ghost" : "primary"}
                data-testid="button-approve-pricing"
                onClick={() => approvePricing.mutate({ proposalId: proposal.id })}
                disabled={!isPartner || approvePricing.isPending || !!pricingApprovedAt}
                title={
                  !isPartner ? "Partner-only checkpoint"
                  : pricingApprovedAt ? `Approved ${new Date(pricingApprovedAt).toLocaleString()}`
                  : "Approve pricing before sending"
                }
              >
                {pricingApprovedAt ? "Pricing approved" :
                  approvePricing.isPending ? "Approving…" : "Approve pricing"}
              </PillButton>
            )}
            <PillButton
              variant="primary"
              data-testid="button-send-proposal"
              onClick={() => {
                setSendError(null);
                send.mutate(
                  { proposalId: proposal.id },
                  {
                    onError: async (err: unknown) => {
                      const e = err as { response?: { json?: () => Promise<{ error?: string }> } };
                      try {
                        const body = await e.response?.json?.();
                        setSendError(body?.error ?? "send-failed");
                      } catch {
                        setSendError("send-failed");
                      }
                    },
                  },
                );
              }}
              disabled={send.isPending || proposal.status === "sent"}
            >
              {proposal.status === "sent" ? "Sent" : send.isPending ? "Sending…" : "Send to client"}
            </PillButton>
          </div>
        </div>
        {sendError && (
          <div className="text-xs text-danger font-mono" data-testid="send-error">
            Cannot send: {sendError}
          </div>
        )}
        {(proposal.winThemes ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {(proposal.winThemes ?? []).map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-gold/10 text-gold border border-gold/30">
                {t}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-xs font-mono uppercase tracking-wide text-text-mute">Sections</div>
        <div className="space-y-2">
          {sections.map((s) => {
            const isOpen = openSectionId === s.id;
            const draft = drafts[s.id] ?? (s.content ?? "");
            const lastReject = ((s.citations as unknown as { kind?: string; reason?: string; by?: string }[] | null) ?? [])
              .filter((c) => c?.kind === "rejection").slice(-1)[0];
            return (
              <div
                key={s.id}
                className="py-2 border-b border-border-soft last:border-b-0"
                data-testid={`proposal-section-${s.sectionId}`}
              >
                <div className="flex items-center gap-3">
                  <MonoChip tone={s.status === "rejected" ? "red" : (STATUS_TONE[s.status] ?? "default")}>
                    {s.status}
                  </MonoChip>
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
                    data-testid={`button-open-section-${s.sectionId}`}
                    onClick={() => setOpenSectionId(isOpen ? null : s.id)}
                  >
                    <div className="text-sm text-text">{s.name}</div>
                    <div className="text-[11px] text-text-mute font-mono">
                      owner: {s.ownerAgent}{isOpen ? " · close" : " · open drafting workspace"}
                    </div>
                  </button>
                  {s.status !== "approved" && (
                    <PillButton
                      variant="ghost"
                      data-testid={`button-approve-section-${s.sectionId}`}
                      onClick={() => approve.mutate({ sectionId: s.id })}
                      disabled={approve.isPending}
                    >
                      Approve
                    </PillButton>
                  )}
                </div>
                {lastReject?.reason && !isOpen && (
                  <div className="ml-[3.25rem] mt-1 text-[11px] text-danger font-mono">
                    rejected: {lastReject.reason}{lastReject.by ? ` — ${lastReject.by}` : ""}
                  </div>
                )}
                {isOpen && (
                  <div className="ml-[3.25rem] mt-2 space-y-2" data-testid={`workspace-section-${s.sectionId}`}>
                    <textarea
                      className="w-full min-h-[140px] text-sm bg-bg-deep border border-border-soft rounded p-2 text-text font-mono"
                      value={draft}
                      data-testid={`textarea-section-${s.sectionId}`}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                    />
                    <div className="flex flex-wrap gap-2">
                      <PillButton
                        variant="primary"
                        data-testid={`button-save-section-${s.sectionId}`}
                        onClick={() =>
                          editSection.mutate(
                            { sectionId: s.id, data: { content: draft } },
                            { onSuccess: () => setDrafts((d) => { const n = { ...d }; delete n[s.id]; return n; }) },
                          )
                        }
                        disabled={editSection.isPending || draft.trim().length < 1 || draft === (s.content ?? "")}
                        title="Saving an edit resets the section to draft"
                      >
                        {editSection.isPending ? "Saving…" : "Save edit"}
                      </PillButton>
                      <PillButton
                        variant="ghost"
                        data-testid={`button-reject-section-${s.sectionId}`}
                        onClick={() => {
                          const reason = window.prompt("Reject reason (≥5 chars):");
                          if (!reason || reason.trim().length < 5) return;
                          rejectSection.mutate({ sectionId: s.id, data: { reason: reason.trim() } });
                        }}
                        disabled={rejectSection.isPending}
                      >
                        {rejectSection.isPending ? "Rejecting…" : "Reject"}
                      </PillButton>
                      {lastReject?.reason && (
                        <span className="text-[11px] text-danger font-mono self-center">
                          last reject: {lastReject.reason}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {pricing && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-text-mute">
            <DollarSign className="w-3 h-3" /> Pricing
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span>Revenue: <span className="text-text font-medium">${Math.round(pricing.totalRevenueUsd).toLocaleString()}</span></span>
            <span>Cost: <span className="text-text font-medium">${Math.round(pricing.totalCostUsd).toLocaleString()}</span></span>
            <span>Margin: <span className="text-text font-medium">{pricing.marginPct}%</span></span>
            <MonoChip
              tone={
                pricing.verdict === "green"
                  ? "green"
                  : pricing.verdict === "amber"
                    ? "amber"
                    : "red"
              }
            >
              {pricing.verdict}
            </MonoChip>
          </div>
        </Card>
      )}

      {matrix.length > 0 && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-text-mute">
            <ShieldCheck className="w-3 h-3" /> Compliance matrix
          </div>
          <div className="space-y-1">
            {matrix.map((r) => (
              <div key={r.rfpReqId} className="flex items-center gap-3 text-xs">
                <MonoChip tone={r.status === "green" ? "green" : "red"}>{r.status}</MonoChip>
                <span className="font-mono text-text-mute">{r.rfpReqId}</span>
                <span className="text-text">{r.requirement}</span>
                <span className="text-text-faint ml-auto truncate max-w-md">{r.evidence}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
