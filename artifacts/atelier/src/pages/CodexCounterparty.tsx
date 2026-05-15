/**
 * Atelier — Codex counterparty detail page (Task #512).
 *
 * Renders one counterparty (legal name, jurisdiction, KYC, payment
 * terms, address, notes) with cross-links into its contracts and
 * DPAs. Read-only; the chat/CLI is the write surface.
 */

import * as React from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  PageHero,
  BackLink,
  SectionHead,
  Card,
  MonoChip,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";

const API = "/api/atelier";

interface Counterparty {
  id: string;
  kind: string;
  legalName: string;
  displayName: string;
  jurisdiction: string;
  vatNumber: string;
  paymentTermsDays: number;
  kycState?: string;
  notes?: string;
  billToAddress?: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    country: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

interface Contract {
  id: string;
  title: string;
  instrumentType: string;
  status: string;
  counterpartyId: string;
  contractValueUsd: number | null;
  termEnd: string | null;
}

interface Dpa {
  id: string;
  status: string;
  counterpartyId: string;
  engagementId: string;
  expiresAt: string | null;
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
  draft: "default",
  active: "green",
  expiring: "amber",
  expired: "default",
  terminated: "red",
  signed: "green",
  reviewed: "gold",
  required: "amber",
  drafted: "default",
};

export default function CodexCounterparty() {
  const [, params] = useRoute("/codex/counterparties/:id");
  const id = params?.id ?? "";
  const cp = useQuery({
    queryKey: ["codex", "counterparty", id],
    queryFn: () => fetchJson<Counterparty>(`/codex/counterparties/${id}`),
    enabled: !!id,
  });
  const contracts = useQuery({
    queryKey: ["codex", "contracts", "byCp", id],
    queryFn: () => fetchJson<{ items: Contract[] }>(`/codex/contracts`),
    enabled: !!id,
  });
  const dpas = useQuery({
    queryKey: ["codex", "dpas", "byCp", id],
    queryFn: () =>
      fetchJson<{ items: Dpa[] }>(`/codex/dpas?counterpartyId=${id}`),
    enabled: !!id,
  });

  const cpContracts = (contracts.data?.items ?? []).filter(
    (c) => c.counterpartyId === id,
  );
  const cpDpas = dpas.data?.items ?? [];

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/codex/counterparties">All counterparties</BackLink>
        <SectionHead
          eyebrow="Firm · Codex · Counterparty"
          headline={
            cp.isLoading
              ? "Loading…"
              : cp.data?.displayName ?? "Counterparty not found"
          }
          lede={cp.data?.legalName}
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        {cp.error && (
          <Card className="p-6 border border-danger/40 bg-danger/5 text-sm">
            <div className="font-semibold text-danger">
              Counterparty unavailable
            </div>
            <div className="text-[11px] font-mono text-text-mute mt-1 break-all">
              {String(cp.error)}
            </div>
          </Card>
        )}
        {cp.isLoading && <Skeleton className="h-48 bg-bg-elevate" />}
        {cp.data && (
          <Card className="p-6 space-y-3" data-testid="counterparty-detail">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gold" />
                <MonoChip tone="default">{cp.data.kind}</MonoChip>
                {cp.data.kycState && (
                  <MonoChip
                    tone={
                      cp.data.kycState === "approved"
                        ? "green"
                        : cp.data.kycState === "blocked"
                          ? "red"
                          : "amber"
                    }
                  >
                    KYC {cp.data.kycState}
                  </MonoChip>
                )}
              </div>
              <div className="text-[11px] font-mono text-text-mute">
                net {cp.data.paymentTermsDays}d
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <Field label="Jurisdiction" value={cp.data.jurisdiction || "—"} />
              <Field label="VAT" value={cp.data.vatNumber || "—"} />
              {cp.data.billToAddress && (
                <Field
                  label="Bill-to"
                  value={[
                    cp.data.billToAddress.line1,
                    cp.data.billToAddress.line2,
                    cp.data.billToAddress.city,
                    cp.data.billToAddress.region,
                    cp.data.billToAddress.postalCode,
                    cp.data.billToAddress.country,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                />
              )}
            </div>
            {cp.data.notes && (
              <div className="text-sm text-text-mute whitespace-pre-wrap border-t border-border-soft pt-3">
                {cp.data.notes}
              </div>
            )}
          </Card>
        )}

        <div>
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute mb-2">
            Contracts ({cpContracts.length})
          </div>
          {cpContracts.length === 0 ? (
            <Card className="p-6 border-dashed bg-bg-deep text-sm text-text-mute">
              No contracts with this counterparty yet.
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {cpContracts.map((c) => (
                <Link
                  key={c.id}
                  href={`/codex/contracts/${c.id}`}
                  className="block"
                  data-testid={`cp-contract-${c.id}`}
                >
                  <Card className="p-4 hover:border-gold/50 transition-colors space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-text leading-snug">
                        {c.title}
                      </div>
                      <MonoChip tone={STATUS_TONE[c.status] ?? "default"}>
                        {c.status}
                      </MonoChip>
                    </div>
                    <div className="text-[11px] font-mono text-text-faint uppercase tracking-wider">
                      {c.instrumentType}
                      {c.termEnd ? ` · ends ${c.termEnd}` : ""}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-mono uppercase tracking-wide text-text-mute mb-2">
            DPAs ({cpDpas.length})
          </div>
          {cpDpas.length === 0 ? (
            <Card className="p-6 border-dashed bg-bg-deep text-sm text-text-mute">
              No data-processing addenda recorded.
            </Card>
          ) : (
            <div className="space-y-2">
              {cpDpas.map((d) => (
                <Link
                  key={d.id}
                  href={`/codex/dpas/${d.id}`}
                  className="block"
                  data-testid={`cp-dpa-${d.id}`}
                >
                  <Card className="p-3 flex items-center justify-between gap-3 hover:border-gold/50 transition-colors">
                    <div className="text-sm font-mono">{d.id}</div>
                    <div className="flex items-center gap-2">
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
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="text-sm text-text mt-0.5">{value}</div>
    </div>
  );
}
