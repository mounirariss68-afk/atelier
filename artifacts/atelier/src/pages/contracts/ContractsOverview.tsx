/**
 * Task #274 — Contracts lens Overview (`/contracts`).
 *
 * The unified contract journey in one glance: lifecycle bucket counts
 * (Drafts · Out for Signature · Active · Archive) linking into their
 * section pages, the most recently touched contract records, and any
 * *standalone* e-signature requests (requests not attached to a
 * contract record — sent directly from the Document Library, an
 * account or an opportunity).
 */
import * as React from "react";
import { Link, useLocation } from "wouter";
import {
  useAtelierGetMe,
  useAtelierListContracts,
  useAtelierListSignatureRequests,
  getAtelierListSignatureRequestsQueryKey,
  type AtelierContract,
  type AtelierSignatureRequest,
} from "@workspace/api-client-react";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Plus, PenLine, FileText } from "lucide-react";
import {
  ContractRow,
  fmtContractDate,
} from "@/components/contracts/ContractsPanel";
import {
  NewContractDialog,
  CONTRACT_SECTION_STATUSES,
} from "@/pages/contracts/ContractsHome";

const ESIGN_STATUS_LABEL: Record<string, string> = {
  sent: "Sent",
  partially_signed: "Partially signed",
  completed: "Completed",
  declined: "Declined",
  voided: "Voided",
  expired: "Expired",
};

const BUCKETS: Array<{
  key: keyof typeof CONTRACT_SECTION_STATUSES | "signatures";
  label: string;
  href: string;
  statuses: readonly string[];
}> = [
  { key: "drafts", label: "Drafts", href: "/contracts/drafts", statuses: CONTRACT_SECTION_STATUSES.drafts },
  { key: "signatures", label: "Out for Signature", href: "/contracts/signatures", statuses: ["out_for_signature"] },
  { key: "active", label: "Active", href: "/contracts/active", statuses: CONTRACT_SECTION_STATUSES.active },
  { key: "archive", label: "Archive", href: "/contracts/archive", statuses: CONTRACT_SECTION_STATUSES.archive },
];

function StandaloneRequestRow({ r }: { r: AtelierSignatureRequest }) {
  return (
    <Link
      href={`/contracts/signatures?request=${r.id}`}
      className="flex items-center gap-3 rounded-md border border-border bg-bg-elevate/50 px-3 py-2 hover:border-gold/50 transition-colors"
      data-testid={`row-standalone-esign-${r.id}`}
    >
      <PenLine className="w-4 h-4 text-text-faint shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-text">{r.title}</div>
        <div className="truncate text-[11px] text-text-faint">
          Sent {fmtContractDate(r.createdAt)} by {r.createdByLabel}
          {(r.signers ?? []).length > 0
            ? ` · ${(r.signers ?? []).length} signer${(r.signers ?? []).length === 1 ? "" : "s"}`
            : ""}
        </div>
      </div>
      <MonoChip
        tone={
          r.status === "completed"
            ? "green"
            : r.status === "declined"
              ? "red"
              : r.status === "sent" || r.status === "partially_signed"
                ? "amber"
                : "default"
        }
      >
        {ESIGN_STATUS_LABEL[r.status] ?? r.status}
      </MonoChip>
    </Link>
  );
}

export default function ContractsOverview() {
  const [, navigate] = useLocation();
  const { data: me } = useAtelierGetMe();
  const canManage = me?.role === "founding_partner" || me?.role === "partner";
  const [newOpen, setNewOpen] = React.useState(false);

  const { data: cData, isLoading: contractsLoading } = useAtelierListContracts();
  const contracts: AtelierContract[] = cData?.contracts ?? [];

  // Signature requests are a leadership-only API; the lens itself is
  // partner-tier so this is normally always enabled.
  const { data: sData, isLoading: requestsLoading } = useAtelierListSignatureRequests(
    undefined,
    {
      query: {
        enabled: !!me && canManage,
        queryKey: getAtelierListSignatureRequestsQueryKey(),
      },
    },
  );

  // "Standalone" = not attached to a contract record: sent straight
  // from the Document Library / an account / an opportunity.
  const linkedRequestIds = React.useMemo(
    () => new Set(contracts.map((c) => c.signatureRequestId).filter(Boolean) as string[]),
    [contracts],
  );
  const standalone = (sData?.requests ?? []).filter((r) => !linkedRequestIds.has(r.id));

  const counts = React.useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const c of contracts) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    return BUCKETS.map((b) => ({
      ...b,
      count: b.statuses.reduce((s, st) => s + (byStatus.get(st) ?? 0), 0),
    }));
  }, [contracts]);

  const recent = React.useMemo(
    () =>
      [...contracts]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 8),
    [contracts],
  );

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">
      <LensPageHeader
        headline="Contracts"
        lede="Prepare, sign and track the firm’s contracts — NDAs, MoUs, employment and partnership agreements."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setNewOpen(true)} data-testid="button-new-contract">
              <Plus className="w-4 h-4 mr-1" /> New contract
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {counts.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => navigate(b.href)}
              className="text-left rounded-md border border-border bg-bg-elevate/50 px-4 py-3 hover:border-gold/50 transition-colors"
              data-testid={`card-contracts-bucket-${b.key}`}
            >
              <div className="font-mono text-2xl text-text">
                {contractsLoading ? "…" : b.count}
              </div>
              <div className="text-xs text-text-mute mt-0.5">{b.label}</div>
            </button>
          ))}
        </div>

        <Card className="p-5" data-testid="panel-recent-contracts">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text flex items-center gap-2">
              <FileText className="w-4 h-4 text-text-faint" /> Recent contracts
            </h3>
          </div>
          {contractsLoading ? (
            <div className="text-sm text-text-faint">Loading…</div>
          ) : recent.length === 0 ? (
            <div className="text-sm text-text-faint" data-testid="text-contracts-empty">
              No contracts yet. Prepare one from a template, or upload a template first
              under <Link href="/contracts/templates" className="text-gold hover:underline">Templates</Link>.
            </div>
          ) : (
            <div className="space-y-2">
              {recent.map((c) => (
                <ContractRow key={c.id} c={c} />
              ))}
            </div>
          )}
        </Card>

        {canManage && (
          <Card className="p-5" data-testid="panel-standalone-esign">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text flex items-center gap-2">
                <PenLine className="w-4 h-4 text-text-faint" /> Standalone signature requests
              </h3>
              <Link
                href="/contracts/signatures"
                className="text-[11px] text-text-faint hover:text-gold"
              >
                All e-signatures →
              </Link>
            </div>
            <p className="text-[11px] text-text-faint mb-3">
              Documents sent for e-signature without a contract record — e.g. straight from
              the Document Library, an account or an opportunity.
            </p>
            {requestsLoading ? (
              <div className="text-sm text-text-faint">Loading…</div>
            ) : standalone.length === 0 ? (
              <div className="text-sm text-text-faint" data-testid="text-standalone-esign-empty">
                No standalone signature requests.
              </div>
            ) : (
              <div className="space-y-2">
                {standalone.map((r) => (
                  <StandaloneRequestRow key={r.id} r={r} />
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
      <NewContractDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
