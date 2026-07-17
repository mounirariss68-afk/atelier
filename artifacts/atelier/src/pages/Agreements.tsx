/**
 * Task #62 — Agreements (e-signing via DocuSeal).
 *
 * Partner-tier surface at `/agreements`: send a Document Library PDF
 * out for signature, watch signer progress, remind pending signers,
 * void requests, and jump to the archived signed PDF once complete.
 * All state comes from the server; the "Refresh" action triggers an
 * authoritative reconcile against DocuSeal.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  useAtelierListDocuments,
  useAtelierListAccounts,
  useAtelierListSignatureRequests,
  getAtelierListSignatureRequestsQueryKey,
  getAtelierListDocumentsQueryKey,
  useAtelierCreateSignatureRequest,
  useAtelierVoidSignatureRequest,
  useAtelierRemindSignatureRequest,
  useAtelierSyncAllSignatureRequests,
  type AtelierSignatureRequest,
} from "@workspace/api-client-react";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Card } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  PenLine,
  Plus,
  RefreshCw,
  BellRing,
  Ban,
  FileText,
  Trash2,
} from "lucide-react";

const selectCls =
  "h-9 rounded-md border border-border bg-bg-elevate px-2 text-sm text-text outline-none focus-visible:border-gold";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  partially_signed: {
    label: "Partially signed",
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  completed: {
    label: "Completed",
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  declined: { label: "Declined", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  voided: { label: "Voided", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  expired: { label: "Expired", cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
};

const SIGNER_STATUS: Record<string, string> = {
  pending: "Waiting",
  sent: "Emailed",
  opened: "Opened",
  completed: "Signed",
  declined: "Declined",
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, cls: "bg-bg-elevate text-text-mute border-border" };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
      data-testid={`badge-status-${status}`}
    >
      {meta.label}
    </span>
  );
}

interface SignerDraft {
  name: string;
  email: string;
}

function NewRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: docsData } = useAtelierListDocuments(undefined, {
    query: { enabled: open, queryKey: getAtelierListDocumentsQueryKey() },
  });
  const { data: accounts } = useAtelierListAccounts();

  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [documentId, setDocumentId] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [expiresInDays, setExpiresInDays] = React.useState("");
  const [signers, setSigners] = React.useState<SignerDraft[]>([{ name: "", email: "" }]);

  const pdfDocs = React.useMemo(
    () =>
      (docsData?.documents ?? []).filter(
        (d) => d.currentVersion?.mime === "application/pdf" && d.status === "active",
      ),
    [docsData],
  );

  const create = useAtelierCreateSignatureRequest({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAtelierListSignatureRequestsQueryKey() });
        toast({ title: "Signature request sent" });
        onOpenChange(false);
        setTitle("");
        setMessage("");
        setDocumentId("");
        setAccountId("");
        setExpiresInDays("");
        setSigners([{ name: "", email: "" }]);
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { message?: string; error?: string } } };
        toast({
          title: "Could not send request",
          description:
            e.response?.data?.message ?? e.response?.data?.error ?? "Unexpected error",
          variant: "destructive",
        });
      },
    },
  });

  const valid =
    title.trim().length > 0 &&
    documentId &&
    signers.length > 0 &&
    signers.every((s) => s.name.trim() && /.+@.+\..+/.test(s.email.trim()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send for signature</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-mute">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Consulting agreement — Acme"
              maxLength={200}
              data-testid="input-esign-title"
            />
          </div>
          <div>
            <label className="text-xs text-text-mute">Document (PDF from the library)</label>
            <select
              className={`${selectCls} w-full`}
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              data-testid="select-esign-document"
            >
              <option value="">Select a PDF…</option>
              {pdfDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
            {pdfDocs.length === 0 ? (
              <p className="mt-1 text-xs text-text-faint">
                No PDF documents in the library yet — upload one under Documents first.
              </p>
            ) : null}
          </div>
          <div>
            <label className="text-xs text-text-mute">Signers (in signing order)</label>
            <div className="space-y-2">
              {signers.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-4 text-xs text-text-faint font-mono">{i + 1}.</span>
                  <Input
                    value={s.name}
                    onChange={(e) =>
                      setSigners((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)),
                      )
                    }
                    placeholder="Name"
                    className="flex-1"
                    data-testid={`input-signer-name-${i}`}
                  />
                  <Input
                    value={s.email}
                    onChange={(e) =>
                      setSigners((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, email: e.target.value } : p)),
                      )
                    }
                    placeholder="email@example.com"
                    className="flex-1"
                    data-testid={`input-signer-email-${i}`}
                  />
                  {signers.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setSigners((prev) => prev.filter((_, j) => j !== i))}
                      data-testid={`button-remove-signer-${i}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {signers.length < 10 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSigners((prev) => [...prev, { name: "", email: "" }])}
                  data-testid="button-add-signer"
                >
                  <Plus className="w-4 h-4 mr-1" /> Add signer
                </Button>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-mute">Account (optional)</label>
              <select
                className={`${selectCls} w-full`}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                data-testid="select-esign-account"
              >
                <option value="">None</option>
                {(accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-mute">Expires in (days, optional)</label>
              <Input
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="e.g. 30"
                data-testid="input-esign-expires"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-mute">Message to signers (optional)</label>
            <textarea
              className="w-full min-h-[70px] rounded-md border border-border bg-bg-elevate px-2 py-1.5 text-sm text-text outline-none focus-visible:border-gold"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              data-testid="input-esign-message"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-esign-cancel">
              Cancel
            </Button>
            <Button
              disabled={!valid || create.isPending}
              onClick={() =>
                create.mutate({
                  data: {
                    title: title.trim(),
                    message: message.trim() || undefined,
                    documentId,
                    signers: signers.map((s) => ({
                      name: s.name.trim(),
                      email: s.email.trim(),
                    })),
                    accountId: accountId || undefined,
                    expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
                  },
                })
              }
              data-testid="button-esign-send"
            >
              <PenLine className="w-4 h-4 mr-1" />
              {create.isPending ? "Sending…" : "Send for signature"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RequestCard({ request }: { request: AtelierSignatureRequest }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: getAtelierListSignatureRequestsQueryKey() });

  const onError = (err: unknown) => {
    const e = err as { response?: { data?: { message?: string; error?: string } } };
    toast({
      title: "Action failed",
      description: e.response?.data?.message ?? e.response?.data?.error ?? "Unexpected error",
      variant: "destructive",
    });
  };

  const voidReq = useAtelierVoidSignatureRequest({
    mutation: { onSuccess: () => { invalidate(); toast({ title: "Request voided" }); }, onError },
  });
  const remind = useAtelierRemindSignatureRequest({
    mutation: {
      onSuccess: (out) => {
        toast({ title: `Reminder sent to ${out.reminded} signer${out.reminded === 1 ? "" : "s"}` });
      },
      onError,
    },
  });

  const open = request.status === "sent" || request.status === "partially_signed";

  return (
    <Card className="p-4" data-testid={`card-esign-${request.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-text truncate" data-testid={`text-esign-title-${request.id}`}>
              {request.title}
            </span>
            <StatusBadge status={request.status} />
          </div>
          <div className="mt-1 text-xs text-text-faint">
            Sent {fmtDate(request.createdAt)} by {request.createdByLabel}
            {request.expiresAt ? ` · expires ${fmtDate(request.expiresAt)}` : ""}
            {request.completedAt ? ` · completed ${fmtDate(request.completedAt)}` : ""}
          </div>
          {request.lastSyncError ? (
            <div className="mt-1 text-xs text-red-400" data-testid={`text-esign-syncerror-${request.id}`}>
              Last sync failed: {request.lastSyncError}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {request.signedDocumentId ? (
            <Link href="/documents">
              <Button variant="outline" size="sm" data-testid={`button-esign-signeddoc-${request.id}`}>
                <FileText className="w-4 h-4 mr-1" /> Signed PDF
              </Button>
            </Link>
          ) : null}
          {open ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={remind.isPending}
                onClick={() => remind.mutate({ id: request.id })}
                title="Re-send the signature email to pending signers"
                data-testid={`button-esign-remind-${request.id}`}
              >
                <BellRing className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={voidReq.isPending}
                onClick={() => {
                  if (window.confirm("Void this signature request? Pending signers will no longer be able to sign.")) {
                    voidReq.mutate({ id: request.id });
                  }
                }}
                title="Void this request"
                data-testid={`button-esign-void-${request.id}`}
              >
                <Ban className="w-4 h-4" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-1.5">
        {(request.signers ?? []).map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between text-sm rounded-md border border-border/60 bg-bg-elevate/50 px-2.5 py-1.5"
            data-testid={`row-signer-${s.id}`}
          >
            <div className="min-w-0 truncate">
              <span className="font-mono text-[11px] text-text-faint mr-2">{s.signingOrder}.</span>
              <span className="text-text">{s.name}</span>
              <span className="text-text-faint ml-2 text-xs">{s.email}</span>
            </div>
            <span className="text-xs text-text-mute shrink-0 ml-3">
              {SIGNER_STATUS[s.status] ?? s.status}
              {s.completedAt ? ` · ${fmtDate(s.completedAt)}` : ""}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function Agreements() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useAtelierGetMe();
  const isLeadership = me?.role === "founding_partner" || me?.role === "partner";

  const [statusFilter, setStatusFilter] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const listParams = statusFilter ? { status: statusFilter } : undefined;
  const { data, isLoading, error } = useAtelierListSignatureRequests(listParams, {
    query: {
      enabled: !!me && isLeadership,
      queryKey: getAtelierListSignatureRequestsQueryKey(listParams),
    },
  });

  const syncAll = useAtelierSyncAllSignatureRequests({
    mutation: {
      onSuccess: (out) => {
        void qc.invalidateQueries({ queryKey: getAtelierListSignatureRequestsQueryKey() });
        toast({
          title: "Statuses refreshed",
          description:
            out.failures.length > 0
              ? `${out.failures.length} request(s) failed to sync`
              : `${out.synced} checked, ${out.changed} updated`,
          variant: out.failures.length > 0 ? "destructive" : undefined,
        });
      },
      onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
    },
  });

  if (me && !isLeadership) {
    return (
      <div className="p-6">
        <Card className="p-6 text-sm text-text-mute" data-testid="text-esign-forbidden">
          Agreements are managed by partners and founding partners.
        </Card>
      </div>
    );
  }

  const requests = data?.requests ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <LensPageHeader
        headline="Agreements"
        lede="Send documents for e-signature via DocuSeal and track signing progress."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={syncAll.isPending}
              onClick={() => syncAll.mutate()}
              data-testid="button-esign-refresh"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${syncAll.isPending ? "animate-spin" : ""}`} />
              Refresh statuses
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="button-esign-new">
              <Plus className="w-4 h-4 mr-1" /> Send for signature
            </Button>
          </div>
        }
      />

      {data && !data.configured ? (
        <Card className="p-4 text-sm text-amber-400 border-amber-500/30" data-testid="text-esign-unconfigured">
          DocuSeal is not configured yet — the DOCUSEAL_API_KEY secret is missing, so new
          requests cannot be sent.
        </Card>
      ) : null}

      <div className="flex items-center gap-2">
        <select
          className={selectCls}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="select-esign-status-filter"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([v, m]) => (
            <option key={v} value={v}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <Card className="p-4 text-sm text-red-400">Failed to load signature requests.</Card>
      ) : isLoading ? (
        <Card className="p-4 text-sm text-text-mute">Loading…</Card>
      ) : requests.length === 0 ? (
        <Card className="p-6 text-sm text-text-mute text-center" data-testid="text-esign-empty">
          No signature requests yet. Send a Document Library PDF out for signature to get
          started.
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}

      <NewRequestDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
