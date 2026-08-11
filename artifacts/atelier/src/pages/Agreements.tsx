/**
 * Task #62 — e-signing via DocuSeal.
 * Task #274 — folded into the Contracts lens as the "Out for
 * Signature" section at `/contracts/signatures` (the old `/agreements`
 * URL permanent-redirects here).
 *
 * Partner-tier surface: send a Document Library PDF out for signature,
 * watch signer progress, remind pending signers, void requests, and
 * jump to the archived signed PDF once complete. Also lists contract
 * records currently out for signature so the whole "waiting on ink"
 * picture lives on one page. All state comes from the server; the
 * "Refresh" action triggers an authoritative reconcile against DocuSeal.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMe,
  useAtelierListSignatureRequests,
  getAtelierListSignatureRequestsQueryKey,
  useAtelierVoidSignatureRequest,
  useAtelierRemindSignatureRequest,
  useAtelierSyncAllSignatureRequests,
  useAtelierListContracts,
  getAtelierListContractsQueryKey,
  type AtelierSignatureRequest,
} from "@workspace/api-client-react";
import { SendForSignatureDialog } from "@/components/esign/SendForSignatureDialog";
import { ContractRow } from "@/components/contracts/ContractsPanel";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  RefreshCw,
  BellRing,
  Ban,
  FileText,
} from "lucide-react";

const selectCls =
  "h-9 rounded-md border border-border glass-surface px-2 text-sm text-text outline-none focus-visible:border-gold";

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

function RequestCard({
  request,
  highlighted,
}: {
  request: AtelierSignatureRequest;
  highlighted?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (highlighted) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);
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

  // Task #514 — branded invite fallback: when the Cognirise email could
  // not be delivered, the sender copies the live signing link instead.
  const [copyingSigner, setCopyingSigner] = React.useState<string | null>(null);
  const copySigningLink = async (signerId: string) => {
    setCopyingSigner(signerId);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/atelier/esign/requests/${request.id}/signers/${signerId}/signing-link`,
        { credentials: "include" },
      );
      const body = (await res.json()) as { url?: string; message?: string; error?: string };
      if (!res.ok || !body.url) {
        toast({
          title: "Signing link unavailable",
          description: body.message ?? body.error ?? "Unexpected error",
          variant: "destructive",
        });
        return;
      }
      await navigator.clipboard.writeText(body.url);
      toast({
        title: "Signing link copied",
        description: "Share it with the signer directly — the invite email was not delivered.",
      });
    } catch {
      toast({ title: "Could not copy the signing link", variant: "destructive" });
    } finally {
      setCopyingSigner(null);
    }
  };

  return (
    <Card
      ref={cardRef}
      className={`p-4 ${highlighted ? "border-gold ring-1 ring-gold/40" : ""}`}
      data-testid={`card-esign-${request.id}`}
    >
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
            {open && request.lastRemindedAt
              ? ` · last reminded ${fmtDate(request.lastRemindedAt)}`
              : ""}
          </div>
          {request.lastSyncError ? (
            <div className="mt-1 text-xs text-red-400" data-testid={`text-esign-syncerror-${request.id}`}>
              Last sync failed: {request.lastSyncError}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {request.signedDocumentId ? (
            <Link href={`/documents?open=${request.signedDocumentId}`}>
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
            <span className="flex items-center gap-2 text-xs text-text-mute shrink-0 ml-3">
              {request.emailMode === "branded" && s.inviteEmailStatus === "undelivered" &&
              s.status !== "completed" && s.status !== "declined" && open ? (
                <>
                  <span
                    className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400"
                    data-testid={`badge-undelivered-${s.id}`}
                  >
                    Email not delivered
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    disabled={copyingSigner === s.id}
                    onClick={() => void copySigningLink(s.id)}
                    data-testid={`button-copy-signlink-${s.id}`}
                  >
                    Copy signing link
                  </Button>
                </>
              ) : null}
              {request.emailMode === "branded" && s.inviteEmailStatus === "delivered" ? (
                <span className="text-emerald-400/90" title="Invite email delivered">
                  Emailed
                </span>
              ) : null}
              <span>
                {SIGNER_STATUS[s.status] ?? s.status}
                {s.completedAt ? ` · ${fmtDate(s.completedAt)}` : ""}
              </span>
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
  // Deep-link support: `/contracts/signatures?request=<id>` (used by
  // e-sign notifications; `?focus=` is accepted as an alias) highlights
  // and scrolls to that request's card.
  const highlightId = React.useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("request") ?? p.get("focus");
  }, []);
  // Set once the deep-linked request is confirmed missing; dismissible.
  const [missingNotice, setMissingNotice] = React.useState(false);
  const missingChecked = React.useRef(false);

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

  // Deep-link target check: once the unfiltered list has loaded, if the
  // `?request=<id>` target isn't in it, the agreement was voided-and-purged
  // (or never existed) — show a small dismissible notice instead of nothing.
  React.useEffect(() => {
    if (!highlightId || missingChecked.current || !data || statusFilter) return;
    missingChecked.current = true;
    if (!data.requests.some((r) => r.id === highlightId)) setMissingNotice(true);
  }, [highlightId, data, statusFilter]);

  // Task #274 — contract records currently out for signature, so this
  // section shows the full "waiting on ink" picture, not just raw
  // e-sign requests.
  const { data: contractsData } = useAtelierListContracts(
    { status: "out_for_signature" },
    {
      query: {
        enabled: !!me && isLeadership,
        queryKey: getAtelierListContractsQueryKey({ status: "out_for_signature" }),
      },
    },
  );
  const contractsOut = contractsData?.contracts ?? [];

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
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)]">
      <LensPageHeader
        headline="Out for Signature"
        lede="Send documents for e-signature via DocuSeal and track signing progress until the ink is dry."
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

      <div className="mx-auto w-full max-w-4xl p-4 md:p-6 space-y-4">
      {missingNotice ? (
        <Card
          className="p-3 text-sm text-text-mute flex items-center justify-between gap-3"
          data-testid="notice-agreement-missing"
        >
          <span>That agreement no longer exists — it may have been voided and removed.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMissingNotice(false)}
            data-testid="button-dismiss-agreement-missing"
          >
            Dismiss
          </Button>
        </Card>
      ) : null}

      {contractsOut.length > 0 ? (
        <Card className="p-4" data-testid="panel-contracts-out-for-signature">
          <h3 className="text-sm font-semibold text-text mb-2">
            Contracts out for signature
          </h3>
          <div className="space-y-2">
            {contractsOut.map((c) => (
              <ContractRow key={c.id} c={c} />
            ))}
          </div>
        </Card>
      ) : null}

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
        <Card className="p-6 text-sm text-text-mute" data-testid="text-esign-empty">
          <p className="text-text font-medium">No signature requests yet.</p>
          <p className="mt-1">
            Before sending real agreements, run this one-time smoke test with your own
            inbox to confirm signature emails actually arrive:
          </p>
          <ol className="mt-3 space-y-1.5 list-decimal list-inside" data-testid="list-esign-smoketest">
            <li>
              Click <span className="text-text">Send for signature</span>, pick any PDF from
              the Document Library, and add yourself as the signer using a real email
              address you can check.
            </li>
            <li>Open your inbox and confirm the Cognirise signature email arrived (check spam too).</li>
            <li>Follow the emailed link and sign the document.</li>
            <li>
              Back here, click <span className="text-text">Refresh statuses</span> — the
              request should show <span className="text-text">Completed</span>.
            </li>
            <li>
              Click <span className="text-text">Signed PDF</span> to confirm the signed copy
              (with audit trail) was archived to the Document Library.
            </li>
          </ol>
          <p className="mt-3 text-xs text-text-faint">
            Pending signers are automatically re-emailed after 3 days without a signature by
            default (and again every 3 days until they sign, decline, or the request expires).
            Server admins can tune or disable this via the ESIGN_AUTO_REMIND_DAYS setting.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} highlighted={r.id === highlightId} />
          ))}
        </div>
      )}

      <SendForSignatureDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </div>
    </div>
  );
}
