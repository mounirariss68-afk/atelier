/**
 * MeContractDetail — Task #161: read-only Me-lens contract detail
 * (`/me/contracts/:id`).
 *
 * Employee/contractor personas are server-gated to /me/*, so this page
 * uses the bespoke self-scope routes (GET /me/contracts/:id + the
 * matching document download route) rather than the partner-tier
 * codegen hooks. It shows the contract's status, dates and document
 * chain (all downloadable) — no manage actions.
 */
import * as React from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  type AtelierContract,
  type AtelierContractDocument,
} from "@workspace/api-client-react";
import { BackLink, Card } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Download, FileText } from "lucide-react";
import {
  ContractStatusChip,
  CONTRACT_TYPE_LABELS,
  fmtContractDate,
} from "@/components/contracts/ContractsPanel";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

const DOC_KIND_LABELS: Record<string, string> = {
  generated_draft: "Draft (generated)",
  final_docx: "Final Word",
  converted_pdf: "Converted PDF",
  signed_pdf: "Signed PDF",
};

export default function MeContractDetail() {
  const [, params] = useRoute("/me/contracts/:id");
  const id = params?.id ?? "";

  const { data, isLoading, error } = useQuery<{ contract: AtelierContract }>({
    queryKey: ["me-contract", id],
    enabled: !!id,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/me/contracts/${id}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`me/contracts/${id} failed (${res.status})`);
      return res.json();
    },
  });
  const contract = data?.contract;

  if (isLoading || !contract) {
    return (
      <div className="mx-auto max-w-4xl px-4 md:px-6 py-6">
        <BackLink href="/me">Me</BackLink>
        <div className="mt-6 text-sm text-text-faint" data-testid="text-me-contract-state">
          {isLoading
            ? "Loading…"
            : error
              ? "Contract not found (or not one of yours)."
              : "Contract not found."}
        </div>
      </div>
    );
  }

  const docs = contract.documents ?? [];
  return (
    <div className="mx-auto max-w-4xl px-4 md:px-6 py-6 space-y-5">
      <BackLink href="/me">Me</BackLink>
      <LensPageHeader
        eyebrow="Me · My contracts"
        headline={contract.title}
        lede={
          <span className="inline-flex items-center gap-2 flex-wrap">
            <ContractStatusChip status={contract.status} />
            <span>
              {CONTRACT_TYPE_LABELS[contract.contractType] ?? contract.contractType} · with{" "}
              {contract.counterpartyLabel}
            </span>
          </span>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-[11px] text-text-faint">Effective date</div>
          <div className="text-sm text-text">{fmtContractDate(contract.effectiveDate)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] text-text-faint">Expiry date</div>
          <div className="text-sm text-text">{fmtContractDate(contract.expiryDate)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] text-text-faint">Last updated</div>
          <div className="text-sm text-text">{fmtContractDate(contract.updatedAt)}</div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-text mb-3">Documents</h3>
        {docs.length === 0 ? (
          <div className="text-sm text-text-faint">No documents yet.</div>
        ) : (
          <div className="space-y-2">
            {docs.map((d: AtelierContractDocument) => (
              <div
                key={d.id}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                  d.id === contract.currentDocumentId
                    ? "border-gold/50 bg-gold/5"
                    : "border-border bg-bg-elevate/50"
                }`}
                data-testid={`row-document-${d.id}`}
              >
                <FileText className="w-4 h-4 text-text-faint shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text truncate">
                    v{d.versionNumber} · {DOC_KIND_LABELS[d.kind] ?? d.kind}
                    {d.id === contract.currentDocumentId ? (
                      <span className="ml-2 text-[10px] text-gold">current</span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-text-faint truncate">
                    {d.fileName} · {(d.sizeBytes / 1024).toFixed(0)} KB ·{" "}
                    {fmtContractDate(d.createdAt)}
                  </div>
                </div>
                <a
                  href={`${API_BASE}/me/contracts/${contract.id}/documents/${d.id}/download`}
                  className="p-1.5 text-text-mute hover:text-gold shrink-0"
                  title="Download"
                  data-testid={`link-download-doc-${d.id}`}
                >
                  <Download className="w-4 h-4" />
                </a>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
