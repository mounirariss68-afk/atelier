/**
 * Task #1297 — Non-Equity Partner access management card.
 *
 * Rendered on the account page (account grants) and the opportunity page
 * (opportunity invites) for founders/partners only. Uses raw fetch — the
 * NEP-access routes are a bespoke leadership admin surface, not part of
 * the generated OpenAPI client.
 */
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { API_BASE } from "@/lib/v5-hooks";
import { PillButton } from "@/components/ui/primitives";

type NepUser = { id: string; name: string; email: string | null };
type Row = { id: string; userId: string; userName: string | null; userEmail: string | null; createdAt: string };

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`NEP access ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function NepAccessCard({
  kind,
  targetId,
  role,
}: {
  /** "account" → grants; "opportunity" → invites */
  kind: "account" | "opportunity";
  targetId: string;
  role: string | null | undefined;
}) {
  const leader = role === "founding_partner" || role === "partner";
  const base =
    kind === "account"
      ? `/accounts/${targetId}/nep-access`
      : `/opportunities/${targetId}/nep-invites`;
  const qc = useQueryClient();
  const qk = ["nep-access", kind, targetId];
  const { data } = useQuery<{ grants?: Row[]; invites?: Row[]; nepUsers: NepUser[] }>({
    queryKey: qk,
    queryFn: () => jfetch(base),
    enabled: leader,
  });
  const add = useMutation({
    mutationFn: (userId: string) =>
      jfetch(base, { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => jfetch(`${base}/${userId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  });
  const [picking, setPicking] = React.useState(false);
  if (!leader) return null;
  const rows = (kind === "account" ? data?.grants : data?.invites) ?? [];
  const nepUsers = data?.nepUsers ?? [];
  if (nepUsers.length === 0) return null; // no NEP logins in the org yet
  const current = new Set(rows.map((r) => r.userId));
  const candidates = nepUsers.filter((u) => !current.has(u.id));
  return (
    <div className="glass-card rounded-xl p-4" data-testid={`nep-access-card-${kind}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-text-faint">
            Non-Equity Partner access
          </div>
          <div className="text-[11px] text-text-faint mt-0.5">
            {kind === "account"
              ? "NEPs granted full detail on this account."
              : "NEPs invited to work this opportunity (includes a read-limited view of its account)."}
          </div>
        </div>
        {candidates.length > 0 && (
          <PillButton variant="ghost" onClick={() => setPicking((v) => !v)} data-testid="nep-access-add">
            <span className="inline-flex items-center gap-1">
              <UserPlus className="w-3 h-3" /> {kind === "account" ? "Add" : "Invite"}
            </span>
          </PillButton>
        )}
      </div>
      {picking && candidates.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {candidates.map((u) => (
            <button
              key={u.id}
              className="text-xs px-2 py-1 rounded-full border border-border hover:bg-bg-elevate-2"
              onClick={() => {
                add.mutate(u.id);
                setPicking(false);
              }}
              data-testid={`nep-access-candidate-${u.id}`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="text-xs text-text-faint">None yet.</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between text-sm" data-testid={`nep-access-row-${r.userId}`}>
              <span>
                {r.userName ?? r.userId}
                {r.userEmail ? <span className="text-text-faint text-xs ml-2">{r.userEmail}</span> : null}
              </span>
              <button
                className="text-text-faint hover:text-text"
                title={kind === "account" ? "Remove access" : "Revoke invite"}
                onClick={() => remove.mutate(r.userId)}
                data-testid={`nep-access-remove-${r.userId}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
