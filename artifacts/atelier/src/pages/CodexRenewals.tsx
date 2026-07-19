/**
 * Atelier — Codex renewals view (Task #512).
 *
 * Lists every active contract and DPA in (or near) the renewal
 * window so partners can spot expirations at a glance. The Renewal
 * Watchdog agent (chat capability `codex.renewal_watchdog_run`)
 * lands users here on completion.
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
import { CalendarClock } from "lucide-react";

const API = "/api/atelier";

interface Contract {
  id: string;
  title: string;
  instrumentType: string;
  status: string;
  counterpartyId: string;
  termEnd: string | null;
  contractValueUsd: number | null;
  currency: string | null;
}

interface Dpa {
  id: string;
  status: string;
  counterpartyId: string;
  engagementId: string;
  expiresAt: string | null;
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
  active: "green",
  expiring: "amber",
  signed: "green",
  reviewed: "gold",
  expired: "default",
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
}

function bucket(days: number | null): "overdue" | "soon" | "later" | "none" {
  if (days == null) return "none";
  if (days < 0) return "overdue";
  if (days <= 90) return "soon";
  return "later";
}

const BUCKET_TONE: Record<
  "overdue" | "soon" | "later" | "none",
  "default" | "gold" | "green" | "amber" | "red"
> = {
  overdue: "red",
  soon: "amber",
  later: "default",
  none: "default",
};

export default function CodexRenewals() {
  const contracts = useQuery({
    queryKey: ["codex", "contracts"],
    queryFn: () => fetchJson<{ items: Contract[] }>(`/codex/contracts`),
  });
  const dpas = useQuery({
    queryKey: ["codex", "dpas"],
    queryFn: () => fetchJson<{ items: Dpa[] }>(`/codex/dpas`),
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

  const activeContracts = (contracts.data?.items ?? [])
    .filter((c) => c.status === "active" || c.status === "expiring")
    .map((c) => ({ ...c, days: daysUntil(c.termEnd) }))
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));

  const activeDpas = (dpas.data?.items ?? [])
    .filter((d) =>
      ["signed", "active", "reviewed"].includes(d.status),
    )
    .map((d) => ({ ...d, days: daysUntil(d.expiresAt) }))
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));

  const isLoading = contracts.isLoading || dpas.isLoading;
  const error = contracts.error || dpas.error;

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/contracts/codex">Codex</BackLink>
        <SectionHead
          eyebrow="Firm · Codex · Renewals"
          headline="Renewal watch"
          lede="Active contracts and DPAs ranked by days remaining. The Renewal Watchdog daemon updates this view nightly."
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-8">
        {error && (
          <Card className="p-6 border border-danger/40 bg-danger/5 text-sm">
            <div className="font-semibold text-danger">
              Renewal data unavailable
            </div>
            <div className="text-[11px] font-mono text-text-mute mt-1 break-all">
              {String(error)}
            </div>
          </Card>
        )}

        <section data-testid="renewals-contracts">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="w-4 h-4 text-gold" />
            <h2 className="text-sm font-mono uppercase tracking-wider text-text">
              Contracts ({activeContracts.length})
            </h2>
          </div>
          {isLoading ? (
            <Skeleton className="h-32 bg-bg-elevate" />
          ) : activeContracts.length === 0 ? (
            <Card className="p-6 border-dashed bg-bg-deep text-sm text-text-mute">
              No active contracts.
            </Card>
          ) : (
            <div className="space-y-2">
              {activeContracts.map((c) => {
                const b = bucket(c.days);
                return (
                  <Link
                    key={c.id}
                    href={`/contracts/codex/contracts/${c.id}`}
                    className="block"
                    data-testid={`renewal-contract-${c.id}`}
                  >
                    <Card className="p-3 flex items-center justify-between gap-3 hover:border-gold/50 transition-colors">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text leading-snug truncate">
                          {c.title}
                        </div>
                        <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider">
                          {c.instrumentType}
                          {cpName.get(c.counterpartyId)
                            ? ` · ${cpName.get(c.counterpartyId)}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono text-text-mute">
                          {c.termEnd ?? "no term"}
                        </span>
                        <MonoChip tone={BUCKET_TONE[b]}>
                          {c.days == null
                            ? "—"
                            : c.days < 0
                              ? `${Math.abs(c.days)}d overdue`
                              : `${c.days}d left`}
                        </MonoChip>
                        <MonoChip tone={STATUS_TONE[c.status] ?? "default"}>
                          {c.status}
                        </MonoChip>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section data-testid="renewals-dpas">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="w-4 h-4 text-gold" />
            <h2 className="text-sm font-mono uppercase tracking-wider text-text">
              DPAs ({activeDpas.length})
            </h2>
          </div>
          {isLoading ? (
            <Skeleton className="h-32 bg-bg-elevate" />
          ) : activeDpas.length === 0 ? (
            <Card className="p-6 border-dashed bg-bg-deep text-sm text-text-mute">
              No active data-processing addenda.
            </Card>
          ) : (
            <div className="space-y-2">
              {activeDpas.map((d) => {
                const b = bucket(d.days);
                return (
                  <Link
                    key={d.id}
                    href={`/contracts/codex/dpas/${d.id}`}
                    className="block"
                    data-testid={`renewal-dpa-${d.id}`}
                  >
                    <Card className="p-3 flex items-center justify-between gap-3 hover:border-gold/50 transition-colors">
                      <div className="min-w-0">
                        <div className="text-sm font-mono text-text">{d.id}</div>
                        <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider">
                          {cpName.get(d.counterpartyId) ?? d.counterpartyId}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-mono text-text-mute">
                          {d.expiresAt?.slice(0, 10) ?? "no expiry"}
                        </span>
                        <MonoChip tone={BUCKET_TONE[b]}>
                          {d.days == null
                            ? "—"
                            : d.days < 0
                              ? `${Math.abs(d.days)}d overdue`
                              : `${d.days}d left`}
                        </MonoChip>
                        <MonoChip tone={STATUS_TONE[d.status] ?? "default"}>
                          {d.status}
                        </MonoChip>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
