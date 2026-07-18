/**
 * Task #120 — deal-level agreements panel.
 *
 * Shows the signature requests sent from a specific opportunity (the
 * "Send for signature" action on the deal page), with live status and
 * a pointer to the archived signed PDF once complete. Partner-tier
 * only — the e-sign API 403s for other roles, so callers must gate
 * rendering on the viewer's role.
 */

import {
  useAtelierListSignatureRequests,
  getAtelierListSignatureRequestsQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { FileText, PenLine } from "lucide-react";

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

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function OpportunityAgreements({ oppId }: { oppId: string }) {
  const params = { opportunityId: oppId };
  const { data, isLoading, isError } = useAtelierListSignatureRequests(params, {
    query: {
      enabled: !!oppId,
      queryKey: getAtelierListSignatureRequestsQueryKey(params),
    },
  });

  if (isLoading) return null;
  if (isError) {
    return (
      <div
        className="rounded-md border border-border-soft bg-bg-elevate/40 p-3 text-xs text-danger"
        data-testid="text-opp-agreements-error"
      >
        Could not load this deal's agreements.
      </div>
    );
  }

  const requests = data?.requests ?? [];
  if (requests.length === 0) return null;

  return (
    <div
      className="rounded-md border border-border-soft bg-bg-elevate/40 overflow-hidden"
      data-testid="panel-opp-agreements"
    >
      <div className="px-4 py-3 border-b border-border-soft flex items-center gap-2">
        <PenLine className="w-4 h-4 text-gold/70" />
        <h3 className="text-sm font-semibold text-text">Agreements on this deal</h3>
        <span className="text-xs text-text-faint font-mono">· {requests.length}</span>
        <Link
          href="/agreements"
          className="ml-auto text-[11px] font-mono uppercase tracking-widest text-text-mute hover:text-gold transition-colors"
          data-testid="link-opp-agreements-all"
        >
          All agreements
        </Link>
      </div>
      <ul className="divide-y divide-border-soft">
        {requests.map((r) => {
          const meta =
            STATUS_META[r.status] ?? {
              label: r.status,
              cls: "bg-bg-elevate text-text-mute border-border",
            };
          return (
            <li
              key={r.id}
              className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
              data-testid={`row-opp-agreement-${r.id}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-text truncate" data-testid={`text-opp-agreement-title-${r.id}`}>
                    {r.title}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
                    data-testid={`badge-opp-agreement-status-${r.id}`}
                  >
                    {meta.label}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-text-faint">
                  Sent {fmtDate(r.createdAt)} by {r.createdByLabel}
                  {r.completedAt ? ` · completed ${fmtDate(r.completedAt)}` : ""}
                </div>
              </div>
              {r.signedDocumentId ? (
                <Link
                  href="/documents"
                  className="inline-flex items-center gap-1 shrink-0 text-xs text-text-mute hover:text-gold transition-colors"
                  data-testid={`link-opp-agreement-signed-${r.id}`}
                >
                  <FileText className="w-3.5 h-3.5" /> Signed PDF
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
