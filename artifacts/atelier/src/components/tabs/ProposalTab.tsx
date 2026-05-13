import * as React from "react";
import {
  useAtelierGetProposal,
  useAtelierComposeProposal,
  useAtelierApproveProposalSection,
  useAtelierSendProposal,
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
          {sections.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 py-2 border-b border-border-soft last:border-b-0"
              data-testid={`proposal-section-${s.sectionId}`}
            >
              <MonoChip tone={STATUS_TONE[s.status] ?? "default"}>{s.status}</MonoChip>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text">{s.name}</div>
                <div className="text-[11px] text-text-mute font-mono">owner: {s.ownerAgent}</div>
              </div>
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
          ))}
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
