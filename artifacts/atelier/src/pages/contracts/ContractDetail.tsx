/**
 * Task #159 — Contract detail (`/contracts/:id`).
 *
 * One contract record's full lifecycle: field values (edit & regenerate
 * while drafting), the document chain (draft .docx / redlines / final /
 * generated PDF — all downloadable), external-review handoff (upload the
 * counterparty's returned Word file), PDF conversion + DocuSeal signing,
 * and status/date/notes management. Terminal statuses never regress.
 */
import * as React from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  useAtelierGetContract,
  getAtelierGetContractQueryKey,
  getAtelierListContractsQueryKey,
  useAtelierUpdateContract,
  useAtelierRegenerateContract,
  useAtelierSendContractForSignature,
  type AtelierContract,
  type AtelierContractDocument,
} from "@workspace/api-client-react";
import { BackLink, Card, MonoChip, PageHero, SectionHead } from "@/components/ui/primitives";
import { isUaeCountry, countryDisplayName } from "@/lib/country-uae";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, Send, RefreshCw, FileText } from "lucide-react";
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

const TERMINAL = new Set(["signed", "declined", "voided", "expired"]);

function useApiError() {
  const { toast } = useToast();
  return (title: string) => (err: unknown) => {
    const e = err as { response?: { data?: { message?: string; error?: string } } };
    toast({
      title,
      description: e.response?.data?.message ?? e.response?.data?.error ?? "Unexpected error",
      variant: "destructive",
    });
  };
}

function DocumentChain({ contract }: { contract: AtelierContract }) {
  const docs = contract.documents ?? [];
  return (
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
                  {d.fileName} · {(d.sizeBytes / 1024).toFixed(0)} KB · {d.createdByLabel} ·{" "}
                  {fmtContractDate(d.createdAt)}
                </div>
              </div>
              <a
                href={`${API_BASE}/contracts/${contract.id}/documents/${d.id}/download`}
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
  );
}

function UploadDocDialog(props: {
  open: boolean;
  onClose: () => void;
  contractId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (props.open) {
      setFile(null);
    }
  }, [props.open]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const resp = await fetch(`${API_BASE}/contracts/${props.contractId}/final`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        toast({
          title: "Upload failed",
          description: String(body?.message ?? body?.error ?? resp.status),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Final Word uploaded",
        description: "The contract is ready to send for signature.",
      });
      props.onDone();
      props.onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload final Word version</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="input-doc-file"
          />
          <p className="text-[11px] text-text-faint">
            Upload the agreed .docx after external review. It becomes the final
            version; a PDF is generated when you send it for signature.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !file} data-testid="button-upload-doc">
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendSignatureDialog(props: {
  open: boolean;
  onClose: () => void;
  contract: AtelierContract;
  onDone: () => void;
}) {
  const onErr = useApiError();
  const { toast } = useToast();
  const initialSigners = React.useCallback(
    () => [
      { name: props.contract.counterpartyLabel, email: "" },
      // Task #232 — pre-label the Cognirise side with the signing entity.
      ...(props.contract.signingEntityLabel
        ? [{ name: props.contract.signingEntityLabel, email: "" }]
        : []),
    ],
    [props.contract.counterpartyLabel, props.contract.signingEntityLabel],
  );
  const [signers, setSigners] = React.useState<Array<{ name: string; email: string }>>(
    initialSigners,
  );
  React.useEffect(() => {
    if (props.open) setSigners(initialSigners());
  }, [props.open, initialSigners]);

  const send = useAtelierSendContractForSignature({
    mutation: {
      onSuccess: () => {
        toast({ title: "Sent for signature", description: "Signers will receive an email from DocuSeal." });
        props.onDone();
        props.onClose();
      },
      onError: onErr("Could not send for signature"),
    },
  });

  const valid = signers.every((s) => s.name.trim() && /.+@.+\..+/.test(s.email.trim()));
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send for signature</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {signers.map((s, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <Input
                value={s.name}
                placeholder="Signer name"
                onChange={(e) =>
                  setSigners((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                data-testid={`input-signer-name-${i}`}
              />
              <div className="flex gap-1">
                <Input
                  value={s.email}
                  placeholder="email@example.com"
                  onChange={(e) =>
                    setSigners((p) => p.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))
                  }
                  data-testid={`input-signer-email-${i}`}
                />
                {signers.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSigners((p) => p.filter((_, j) => j !== i))}
                  >
                    ✕
                  </Button>
                )}
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSigners((p) => [...p, { name: "", email: "" }])}
            data-testid="button-add-signer"
          >
            + Add signer
          </Button>
          {props.contract.signingEntityLabel && (
            <p className="text-[11px] text-text-faint" data-testid="text-signing-entity-side">
              Cognirise side signs as{" "}
              <span className="text-text">{props.contract.signingEntityLabel}</span>.
            </p>
          )}
          <p className="text-[11px] text-text-faint">
            This emails the final PDF for e-signing and cannot be edited afterwards.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              send.mutate({
                id: props.contract.id,
                data: {
                  signers: signers.map((s) => ({ name: s.name.trim(), email: s.email.trim() })),
                },
              })
            }
            disabled={send.isPending || !valid}
            data-testid="button-send-signature"
          >
            <Send className="w-4 h-4 mr-1" />
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldValuesCard({
  contract,
  canManage,
  onRefetch,
}: {
  contract: AtelierContract;
  canManage: boolean;
  onRefetch: () => void;
}) {
  const onErr = useApiError();
  const { toast } = useToast();
  const [edit, setEdit] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const entries = Object.entries(contract.fieldValues ?? {});
  const regen = useAtelierRegenerateContract({
    mutation: {
      onSuccess: () => {
        toast({ title: "Draft regenerated" });
        setEdit(false);
        onRefetch();
      },
      onError: onErr("Could not regenerate"),
    },
  });
  const editable = canManage && (contract.status === "draft" || contract.status === "out_for_review");

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">Field values</h3>
        {editable && !edit && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValues(Object.fromEntries(entries.map(([k, v]) => [k, String(v ?? "")])));
              setEdit(true);
            }}
            data-testid="button-edit-values"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            Edit & regenerate
          </Button>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="text-sm text-text-faint">No field values.</div>
      ) : edit ? (
        <div className="space-y-2">
          {Object.entries(values).map(([k, v]) => (
            <div key={k}>
              <label className="text-[11px] text-text-faint font-mono">{k}</label>
              <Input
                value={v}
                onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                data-testid={`input-value-${k}`}
              />
            </div>
          ))}
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => regen.mutate({ id: contract.id, data: { values } })}
              disabled={regen.isPending}
              data-testid="button-regenerate"
            >
              {regen.isPending ? "Regenerating…" : "Regenerate draft"}
            </Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {entries.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-text-faint font-mono">{k}</dt>
              <dd className="text-text truncate">{String(v ?? "") || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export default function ContractDetail() {
  const [, params] = useRoute("/contracts/:id");
  const id = params?.id ?? "";
  const qc = useQueryClient();
  const onErr = useApiError();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const canManage = me?.role === "founding_partner" || me?.role === "partner";
  const { data, isLoading } = useAtelierGetContract(id);
  const contract = data?.contract;
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [notesDraft, setNotesDraft] = React.useState<string | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getAtelierGetContractQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getAtelierListContractsQueryKey() });
  };
  const patch = useAtelierUpdateContract({
    mutation: {
      onSuccess: () => {
        invalidate();
        setNotesDraft(null);
        toast({ title: "Contract updated" });
      },
      onError: onErr("Update failed"),
    },
  });

  if (isLoading || !contract) {
    return (
      <div className="mx-auto max-w-4xl px-4 md:px-6 py-6">
        <BackLink href="/contracts">Contracts</BackLink>
        <div className="mt-6 text-sm text-text-faint">
          {isLoading ? "Loading…" : "Contract not found (or not visible to you)."}
        </div>
      </div>
    );
  }

  const terminal = TERMINAL.has(contract.status);
  const counterpartyHref =
    contract.counterpartyKind === "account" && contract.accountId
      ? `/clients/accounts/${contract.accountId}`
      : contract.counterpartyKind === "person" && contract.personId
        ? `/roster/people/${contract.personId}`
        : null;

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">
      <PageHero>
        <BackLink href="/contracts" className="mb-4">Contracts</BackLink>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            <SectionHead
              eyebrow="Firm · Contracts"
              headline={contract.title}
              lede={
                <span className="inline-flex items-center gap-2 flex-wrap">
                  <ContractStatusChip status={contract.status} />
                  <span>
                    {CONTRACT_TYPE_LABELS[contract.contractType] ?? contract.contractType} ·{" "}
                    {counterpartyHref ? (
                      <Link href={counterpartyHref} className="hover:text-gold underline underline-offset-2">
                        {contract.counterpartyLabel}
                      </Link>
                    ) : (
                      contract.counterpartyLabel
                    )}{" "}
                    · owner {contract.ownerLabel}
                  </span>
                </span>
              }
            />
          </div>
          {canManage && !terminal && (
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {contract.status !== "out_for_signature" && (
                <Button variant="ghost" onClick={() => setUploadOpen(true)} data-testid="button-open-upload">
                  <Upload className="w-4 h-4 mr-1" />
                  Upload Word
                </Button>
              )}
              {contract.status === "final_uploaded" && (
                <Button onClick={() => setSendOpen(true)} data-testid="button-open-send">
                  <Send className="w-4 h-4 mr-1" />
                  Send for signature
                </Button>
              )}
            </div>
          )}
        </div>
      </PageHero>

      <div className="mx-auto w-full max-w-4xl px-4 md:px-6 py-6 space-y-5">
      {contract.status === "out_for_signature" && contract.signatureRequestId && (
        <Card className="p-4 text-sm text-text-mute">
          Out for signature — track progress on the{" "}
          <Link
            href={`/contracts/signatures?focus=${contract.signatureRequestId}`}
            className="text-gold hover:underline"
            data-testid="link-signature-request"
          >
            Agreements page
          </Link>
          . Status updates here automatically once everyone signs.
        </Card>
      )}
      {contract.status === "signed" && contract.signedLibraryDocumentId && (
        <Card className="p-4 text-sm text-text-mute">
          Signed ✓ — the executed PDF is archived in the{" "}
          <Link href="/documents" className="text-gold hover:underline">
            Document Library
          </Link>
          .
        </Card>
      )}

      <Card className="p-4" data-testid="card-signing-entity">
        <div className="text-[11px] text-text-faint">Cognirise signing entity</div>
        {contract.signingEntityLabel ? (
          <div className="text-sm text-text">
            {contract.signingEntityLabel}
            {contract.signingEntityCountry ? (
              <span className="text-text-faint"> · {contract.signingEntityCountry}</span>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-text-mute" data-testid="text-no-entity-recorded">
            No entity recorded — this contract was prepared before signing entities were
            required.
          </div>
        )}
        {contract.signingEntityCountry &&
          !isUaeCountry(contract.signingEntityCountry) && (
            <p className="text-[11px] text-amber-400 mt-1" data-testid="text-entity-caution">
              Caution: this entity is registered in{" "}
              {countryDisplayName(contract.signingEntityCountry)}, not the UAE. Check the
              governing-law and jurisdiction wording in the document.
            </p>
          )}
      </Card>

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

      <FieldValuesCard contract={contract} canManage={canManage} onRefetch={invalidate} />
      <DocumentChain contract={contract} />

      <Card className="p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-text">Notes</h3>
          {canManage && notesDraft === null && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setNotesDraft(contract.notes ?? "")}
              data-testid="button-edit-notes"
            >
              Edit
            </Button>
          )}
        </div>
        {notesDraft !== null ? (
          <div className="space-y-2">
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={4}
              data-testid="input-notes"
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setNotesDraft(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => patch.mutate({ id, data: { notes: notesDraft || null } })}
                disabled={patch.isPending}
                data-testid="button-save-notes"
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-mute whitespace-pre-wrap">
            {contract.notes || <span className="text-text-faint">No notes.</span>}
          </p>
        )}
      </Card>

      {canManage && !terminal && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-text mb-2">Manage</h3>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span className="text-text-faint text-xs">Mark as:</span>
            {(["voided", "expired"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="ghost"
                onClick={() => patch.mutate({ id, data: { status: s } })}
                disabled={patch.isPending}
                data-testid={`button-status-${s}`}
              >
                {s}
              </Button>
            ))}
            <span className="text-[11px] text-text-faint ml-2">
              Signed / declined are set automatically by the e-signature flow.
            </span>
          </div>
        </Card>
      )}

      <UploadDocDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        contractId={id}
        onDone={invalidate}
      />
      <SendSignatureDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        contract={contract}
        onDone={invalidate}
      />
      </div>
    </div>
  );
}
