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
import { BackLink, Card, PageHero, SectionHead } from "@/components/ui/primitives";
import { Download, FileText, PenLine } from "lucide-react";
import {
  ContractStatusChip,
  CONTRACT_TYPE_LABELS,
  fmtContractDate,
} from "@/components/contracts/ContractsPanel";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

/** Task #166 — signature history returned beside the contract. */
interface MeSignatureSigner {
  id: string;
  name: string;
  email: string;
  signingOrder: number;
  status: string;
  openedAt: string | null;
  completedAt: string | null;
  declinedAt: string | null;
}
interface MeSignatureRequest {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  declinedAt: string | null;
  expiresAt: string | null;
  signers: MeSignatureSigner[];
}

/** Task #318 — template field labels/roles (same shape as GET /contracts/:id). */
interface MeContractField {
  key: string;
  label: string;
  role: string;
}

const SIGNER_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  opened: "Opened",
  completed: "Signed",
  declined: "Declined",
};
const SIGNER_STATUS_CLASSES: Record<string, string> = {
  completed: "text-emerald-400",
  declined: "text-red-400",
};

const REQUEST_STATUS_LABELS: Record<string, string> = {
  sent: "Out for signature",
  partially_signed: "Partially signed",
  completed: "Fully signed",
  declined: "Declined",
  voided: "Voided",
  expired: "Expired",
};

const DOC_KIND_LABELS: Record<string, string> = {
  generated_draft: "Draft (generated)",
  final_docx: "Final Word",
  converted_pdf: "Converted PDF",
  signed_pdf: "Signed PDF",
};

export default function MeContractDetail() {
  const [, params] = useRoute("/me/contracts/:id");
  const id = params?.id ?? "";

  const { data, isLoading, error } = useQuery<{
    contract: AtelierContract;
    signatureRequest: MeSignatureRequest | null;
    fields?: MeContractField[];
  }>({
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
  const sigRequest = data?.signatureRequest ?? null;

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
  // Task #318 — group the counterparty's typed answers (captured at
  // e-signing) under their human-readable labels, mirroring the
  // partner-facing contract detail page.
  const fields = data?.fields ?? [];
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const secondPartyKeys = new Set(
    fields.filter((f) => f.role === "second_party").map((f) => f.key),
  );
  const signedEntries = Object.entries(contract.fieldValues ?? {}).filter(([k]) =>
    secondPartyKeys.has(k),
  );
  const labelFor = (k: string) => fieldByKey.get(k)?.label || k;
  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">
      <PageHero>
        <BackLink href="/me" className="mb-4">Me</BackLink>
        <SectionHead
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
      </PageHero>

      <div className="mx-auto w-full max-w-4xl px-4 md:px-6 py-6 space-y-5">
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

      {sigRequest ? (
        <Card className="p-5" data-testid="card-signatures">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text inline-flex items-center gap-2">
              <PenLine className="w-4 h-4 text-text-faint" />
              Signatures
            </h3>
            <span className="text-[11px] text-text-mute" data-testid="text-signature-status">
              {REQUEST_STATUS_LABELS[sigRequest.status] ?? sigRequest.status}
              {sigRequest.completedAt ? ` · ${fmtContractDate(sigRequest.completedAt)}` : ""}
            </span>
          </div>
          <div className="space-y-2">
            {sigRequest.signers.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-md border border-border bg-bg-elevate/50 px-3 py-2"
                data-testid={`row-signer-${s.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text truncate">{s.name}</div>
                  <div className="text-[11px] text-text-faint truncate">{s.email}</div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-xs font-medium ${SIGNER_STATUS_CLASSES[s.status] ?? "text-text-mute"}`}
                  >
                    {SIGNER_STATUS_LABELS[s.status] ?? s.status}
                  </div>
                  {s.completedAt ? (
                    <div className="text-[11px] text-text-faint">
                      {fmtContractDate(s.completedAt)}
                    </div>
                  ) : s.declinedAt ? (
                    <div className="text-[11px] text-text-faint">
                      {fmtContractDate(s.declinedAt)}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {sigRequest.signers.length === 0 ? (
              <div className="text-sm text-text-faint">No signers recorded.</div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {signedEntries.length > 0 ? (
        <Card className="p-5" data-testid="section-signed-by-counterparty">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-text">
              Signed by {contract.counterpartyLabel || "counterparty"}
            </h3>
            <p className="text-[11px] text-text-faint">Captured during e-signing.</p>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {signedEntries.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[11px] text-text-faint">{labelFor(k)}</dt>
                <dd className="text-text truncate" data-testid={`text-signed-${k}`}>
                  {String(v ?? "") || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}

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
    </div>
  );
}
