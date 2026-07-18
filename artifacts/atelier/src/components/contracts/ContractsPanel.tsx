/**
 * Task #159 — Reusable contract-tracking panel.
 *
 * Renders the contract records linked to one entity (account, contact,
 * or roster person) — or, with no scope props, the caller's visible
 * contracts. Used on the Account page, the roster person page, the Me
 * lens, and the central /contracts overview.
 */
import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useAtelierListContracts,
  type AtelierContract,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { FileText } from "lucide-react";

export const CONTRACT_STATUS_META: Record<string, { label: string; tone: "default" | "gold" | "green" | "amber" | "red" }> = {
  draft: { label: "Draft", tone: "default" },
  out_for_review: { label: "Out for review", tone: "amber" },
  final_uploaded: { label: "Final uploaded", tone: "gold" },
  out_for_signature: { label: "Out for signature", tone: "amber" },
  signed: { label: "Signed", tone: "green" },
  declined: { label: "Declined", tone: "red" },
  voided: { label: "Voided", tone: "default" },
  expired: { label: "Expired", tone: "default" },
};

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  individual_nda: "Individual NDA",
  mutual_nda: "Mutual NDA",
  partnership_mou: "Partnership MoU",
  partnership_agreement: "Partnership agreement",
  non_equity_partner_employment: "Non-equity partner employment",
  employment: "Employment contract",
  contractor_agreement: "Contractor agreement",
  other: "Other",
};

export function ContractStatusChip({ status }: { status: string }) {
  const meta = CONTRACT_STATUS_META[status] ?? { label: status, tone: "default" as const };
  return (
    <MonoChip tone={meta.tone} data-testid={`chip-contract-status-${status}`}>
      {meta.label}
    </MonoChip>
  );
}

export function fmtContractDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ContractRow({ c, linked = true }: { c: AtelierContract; linked?: boolean }) {
  const inner = (
    <>
      <FileText className="w-4 h-4 text-text-faint shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-text">{c.title}</div>
        <div className="truncate text-[11px] text-text-faint">
          {CONTRACT_TYPE_LABELS[c.contractType] ?? c.contractType} · {c.counterpartyLabel} · owner{" "}
          {c.ownerLabel} ·{" "}
          {c.expiryDate ? `expires ${fmtContractDate(c.expiryDate)}` : fmtContractDate(c.updatedAt)}
        </div>
      </div>
      <ContractStatusChip status={c.status} />
    </>
  );
  const cls =
    "flex items-center gap-3 rounded-md border border-border bg-bg-elevate/50 px-3 py-2";
  if (!linked) {
    return (
      <div className={cls} data-testid={`row-contract-${c.id}`}>
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={`/contracts/${c.id}`}
      className={`${cls} hover:border-gold/50 transition-colors`}
      data-testid={`row-contract-${c.id}`}
    >
      {inner}
    </Link>
  );
}

export function ContractsPanel(props: {
  accountId?: string;
  contactId?: string;
  personId?: string;
  /**
   * Me-lens mode: employee/contractor personas are server-gated to
   * /me/*, so this fetches GET /me/contracts (bespoke route, not in the
   * OpenAPI spec) instead of the codegen list hook, and renders rows
   * unlinked (the /contracts/:id detail page is partner-tier).
   */
  mine?: boolean;
  title?: string;
  emptyText?: string;
}) {
  if (props.mine) {
    return <MineContractsPanel title={props.title} emptyText={props.emptyText} />;
  }
  return (
    <ScopedContractsPanel
      accountId={props.accountId}
      contactId={props.contactId}
      personId={props.personId}
      title={props.title}
      emptyText={props.emptyText}
    />
  );
}

function ScopedContractsPanel(props: {
  accountId?: string;
  contactId?: string;
  personId?: string;
  title?: string;
  emptyText?: string;
}) {
  const { data, isLoading } = useAtelierListContracts({
    ...(props.accountId ? { accountId: props.accountId } : {}),
    ...(props.contactId ? { contactId: props.contactId } : {}),
    ...(props.personId ? { personId: props.personId } : {}),
  });
  return (
    <PanelBody
      title={props.title}
      emptyText={props.emptyText}
      isLoading={isLoading}
      contracts={data?.contracts ?? []}
      linked
      showAllLink
    />
  );
}

function MineContractsPanel(props: { title?: string; emptyText?: string }) {
  const { data, isLoading } = useQuery<{ contracts: AtelierContract[] }>({
    queryKey: ["me-contracts"],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env?.BASE_URL ?? "/"}api/atelier/me/contracts`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`me/contracts failed (${res.status})`);
      return res.json();
    },
  });
  return (
    <PanelBody
      title={props.title}
      emptyText={props.emptyText}
      isLoading={isLoading}
      contracts={data?.contracts ?? []}
      linked={false}
      showAllLink={false}
    />
  );
}

function PanelBody(props: {
  title?: string;
  emptyText?: string;
  isLoading: boolean;
  contracts: AtelierContract[];
  linked: boolean;
  showAllLink: boolean;
}) {
  return (
    <Card className="p-5" data-testid="panel-contracts">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">{props.title ?? "Contracts"}</h3>
        {props.showAllLink && (
          <Link href="/contracts" className="text-[11px] text-text-faint hover:text-gold">
            All contracts →
          </Link>
        )}
      </div>
      {props.isLoading ? (
        <div className="text-sm text-text-faint">Loading…</div>
      ) : props.contracts.length === 0 ? (
        <div className="text-sm text-text-faint" data-testid="text-contracts-empty">
          {props.emptyText ?? "No contracts yet."}
        </div>
      ) : (
        <div className="space-y-2">
          {props.contracts.map((c) => (
            <ContractRow key={c.id} c={c} linked={props.linked} />
          ))}
        </div>
      )}
    </Card>
  );
}
