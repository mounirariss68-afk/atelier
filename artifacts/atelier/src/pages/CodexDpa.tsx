/**
 * Atelier — Codex DPA detail page (Task #512).
 *
 * Renders one Data Processing Addendum: status, counterparty,
 * engagement, data classes, processor chain, signed/expires/last-
 * reviewed dates, and free-form notes. Read-only — DPA Sentinel
 * runs through the chat capability `codex.dpa_review`.
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
import { ShieldCheck } from "lucide-react";

const API = "/api/atelier";

interface Dpa {
  id: string;
  engagementId: string;
  contractId: string | null;
  counterpartyId: string;
  dataClasses: string[];
  processorChain: Array<{ name: string; role: string; jurisdiction: string }>;
  status: string;
  signedAt: string | null;
  expiresAt: string | null;
  lastReviewedAt: string | null;
  notes: string;
  updatedAt: string;
}

interface Counterparty {
  id: string;
  displayName: string;
  legalName: string;
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

export default function CodexDpa() {
  const [, params] = useRoute("/contracts/codex/dpas/:id");
  const id = params?.id ?? "";
  const dpa = useQuery({
    queryKey: ["codex", "dpa", id],
    queryFn: () => fetchJson<Dpa>(`/codex/dpas/${id}`),
    enabled: !!id,
  });
  const cp = useQuery({
    queryKey: ["codex", "counterparty", dpa.data?.counterpartyId],
    queryFn: () =>
      fetchJson<Counterparty>(
        `/codex/counterparties/${dpa.data?.counterpartyId}`,
      ),
    enabled: !!dpa.data?.counterpartyId,
  });

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <BackLink href="/contracts/codex/dpas">All DPAs</BackLink>
        <SectionHead
          eyebrow="Firm · Codex · DPA"
          headline={
            dpa.isLoading
              ? "Loading…"
              : dpa.data
                ? `DPA ${dpa.data.id}`
                : "DPA not found"
          }
          lede={cp.data ? cp.data.legalName : undefined}
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        {dpa.error && (
          <Card className="p-6 border border-danger/40 bg-danger/5 text-sm">
            <div className="font-semibold text-danger">DPA unavailable</div>
            <div className="text-[11px] font-mono text-text-mute mt-1 break-all">
              {String(dpa.error)}
            </div>
          </Card>
        )}
        {dpa.isLoading && <Skeleton className="h-64 bg-bg-elevate" />}
        {dpa.data && (
          <>
            <Card className="p-6 space-y-4" data-testid="dpa-detail">
              <div className="flex items-center gap-2 flex-wrap">
                <ShieldCheck className="w-4 h-4 text-gold" />
                <MonoChip tone={STATUS_TONE[dpa.data.status] ?? "default"}>
                  {dpa.data.status}
                </MonoChip>
                {dpa.data.dataClasses.map((c) => (
                  <span
                    key={c}
                    className="px-1.5 py-0.5 rounded bg-bg-elevate-2 border border-border-soft text-[10px] font-mono uppercase"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <Field
                  label="Counterparty"
                  value={
                    cp.data ? (
                      <Link
                        href={`/contracts/codex/counterparties/${cp.data.id}`}
                        className="text-gold hover:underline"
                      >
                        {cp.data.displayName}
                      </Link>
                    ) : (
                      dpa.data.counterpartyId
                    )
                  }
                />
                <Field label="Engagement" value={dpa.data.engagementId} />
                <Field
                  label="Instrument"
                  value={
                    dpa.data.contractId ? (
                      <Link
                        href={`/contracts/codex/contracts/${dpa.data.contractId}`}
                        className="text-gold hover:underline"
                      >
                        {dpa.data.contractId}
                      </Link>
                    ) : (
                      "—"
                    )
                  }
                />
                <Field
                  label="Signed"
                  value={dpa.data.signedAt?.slice(0, 10) ?? "—"}
                />
                <Field
                  label="Expires"
                  value={dpa.data.expiresAt?.slice(0, 10) ?? "—"}
                />
                <Field
                  label="Last reviewed"
                  value={dpa.data.lastReviewedAt?.slice(0, 10) ?? "—"}
                />
              </div>
            </Card>
            {dpa.data.processorChain.length > 0 && (
              <Card className="p-6">
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-3">
                  Processor chain
                </div>
                <div className="space-y-2">
                  {dpa.data.processorChain.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-sm border-b border-border-soft last:border-0 pb-2 last:pb-0"
                    >
                      <div>
                        <div className="text-text">{p.name}</div>
                        <div className="text-[11px] font-mono text-text-mute uppercase tracking-wider">
                          {p.role}
                        </div>
                      </div>
                      <MonoChip tone="default">{p.jurisdiction}</MonoChip>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            {dpa.data.notes && (
              <Card className="p-6">
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-2">
                  Notes
                </div>
                <div className="text-sm text-text whitespace-pre-wrap">
                  {dpa.data.notes}
                </div>
              </Card>
            )}
          </>
        )}
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
