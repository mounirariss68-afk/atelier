/**
 * Task #112 — agreements linked to an account.
 *
 * Rendered on the account Documents tab for partner-tier users: lists
 * every signature request tied to the account so completed contracts
 * are visibly linked from the account record. The signed PDF itself is
 * archived into the account's document library (category "contract").
 */

import * as React from "react";
import { Link } from "wouter";
import {
  useAtelierGetMe,
  useAtelierListSignatureRequests,
  getAtelierListSignatureRequestsQueryKey,
} from "@workspace/api-client-react";

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

export function AccountAgreementsPanel({ accountId }: { accountId: string }) {
  const { data: me } = useAtelierGetMe();
  const isLeadership = me?.role === "founding_partner" || me?.role === "partner";

  const params = { accountId };
  const { data } = useAtelierListSignatureRequests(params, {
    query: {
      enabled: !!me && isLeadership && !!accountId,
      queryKey: getAtelierListSignatureRequestsQueryKey(params),
    },
  });

  // Non-leadership roles can't read the e-sign surface at all; render nothing.
  if (!isLeadership) return null;

  const requests = data?.requests ?? [];
  if (requests.length === 0) return null;

  return (
    <div
      className="mb-6 rounded-md border border-border-soft bg-bg-elevate/50 p-4"
      data-testid="panel-account-agreements"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
          Agreements · {requests.length}
        </div>
        <Link
          href="/contracts/signatures"
          className="text-xs font-mono uppercase tracking-widest text-text-mute hover:text-gold transition-colors"
          data-testid="link-account-agreements-all"
        >
          Manage in Agreements →
        </Link>
      </div>
      <div className="space-y-1.5">
        {requests.map((r) => {
          const meta = STATUS_META[r.status] ?? {
            label: r.status,
            cls: "bg-bg-elevate text-text-mute border-border",
          };
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded border border-border/50 bg-bg/40 px-3 py-2 text-sm"
              data-testid={`row-account-agreement-${r.id}`}
            >
              <div className="min-w-0">
                <span className="text-text truncate">{r.title}</span>
                <span className="ml-2 text-xs text-text-faint">
                  Sent {fmtDate(r.createdAt)}
                  {r.completedAt ? ` · completed ${fmtDate(r.completedAt)}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.signedDocumentId ? (
                  <span
                    className="text-[11px] text-emerald-400"
                    title="Signed PDF archived in this account's document library below"
                    data-testid={`text-agreement-signed-${r.id}`}
                  >
                    Signed PDF in library
                  </span>
                ) : null}
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
                >
                  {meta.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
