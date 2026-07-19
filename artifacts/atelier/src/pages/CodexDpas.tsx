/**
 * Atelier — Codex DPA list page (Task #512).
 *
 * Lists every Data Processing Addendum across all statuses with a
 * status filter. Distinct from /codex/renewals, which only shows
 * active items ranked by days-to-expiry. Provides the canonical
 * "All DPAs" landing for the back link on the DPA detail page.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  PageHero,
  BackLink,
  SectionHead,
  Card,
  MonoChip,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";

const API = "/api/atelier";

interface Dpa {
  id: string;
  status: string;
  counterpartyId: string;
  engagementId: string;
  expiresAt: string | null;
  signedAt: string | null;
  updatedAt: string;
}

interface Counterparty {
  id: string;
  displayName: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

const STATUS_TONE: Record<
  string,
  "default" | "gold" | "green" | "amber" | "red"
> = {
  required: "amber",
  drafted: "default",
  signed: "green",
  active: "green",
  reviewed: "gold",
  expired: "default",
};

export default function CodexDpas() {
  const [status, setStatus] = React.useState<string>("");
  const dpas = useQuery({
    queryKey: ["codex", "dpas", "all", status],
    queryFn: () =>
      fetchJson<{ items: Dpa[] }>(
        `/codex/dpas${status ? `?status=${status}` : ""}`,
      ),
  });
  const cps = useQuery({
    queryKey: ["codex", "counterparties"],
    queryFn: () =>
      fetchJson<{ items: Counterparty[] }>(`/codex/counterparties`),
  });
  const cpName = React.useMemo(() => {
    const m = new Map<string, string>();
    (cps.data?.items ?? []).forEach((c) => m.set(c.id, c.displayName));
    return m;
  }, [cps.data]);

  const items = dpas.data?.items ?? [];

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/contracts/codex">Codex</BackLink>
        <SectionHead
          eyebrow="Firm · Codex · DPAs"
          headline="Data Processing Addenda"
          lede="Every DPA across counterparties, in every status. For the renewal-window view, see Renewals."
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-4">
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
            data-testid="select-dpa-status"
          >
            <option value="">All statuses</option>
            <option value="required">Required</option>
            <option value="drafted">Drafted</option>
            <option value="signed">Signed</option>
            <option value="active">Active</option>
            <option value="reviewed">Reviewed</option>
            <option value="expired">Expired</option>
          </select>
          <Link
            href="/contracts/codex/renewals"
            className="text-[11px] font-mono text-gold hover:underline"
          >
            View renewals →
          </Link>
        </div>
        {dpas.error && (
          <Card className="p-6 border border-danger/40 bg-danger/5 text-sm">
            <div className="font-semibold text-danger">DPAs unavailable</div>
            <div className="text-[11px] font-mono text-text-mute mt-1 break-all">
              {String(dpas.error)}
            </div>
          </Card>
        )}
        {dpas.isLoading ? (
          <Skeleton className="h-48 bg-bg-elevate" />
        ) : items.length === 0 ? (
          <Card className="p-12 text-center border-dashed bg-bg-deep">
            <ShieldCheck className="w-8 h-8 text-gold mx-auto mb-3" />
            <p className="text-text-mute">No DPAs match.</p>
          </Card>
        ) : (
          <div className="space-y-2" data-testid="codex-dpas-list">
            <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
              {items.length} DPA{items.length === 1 ? "" : "s"}
            </div>
            {items.map((d) => (
              <Link
                key={d.id}
                href={`/contracts/codex/dpas/${d.id}`}
                className="block"
                data-testid={`dpa-row-${d.id}`}
              >
                <Card className="p-3 flex items-center justify-between gap-3 hover:border-gold/50 transition-colors">
                  <div className="min-w-0">
                    <div className="text-sm font-mono text-text">{d.id}</div>
                    <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider">
                      {cpName.get(d.counterpartyId) ?? d.counterpartyId}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.expiresAt && (
                      <span className="text-[11px] font-mono text-text-mute">
                        exp {d.expiresAt.slice(0, 10)}
                      </span>
                    )}
                    <MonoChip tone={STATUS_TONE[d.status] ?? "default"}>
                      {d.status}
                    </MonoChip>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
