/**
 * Atelier — Codex (Contract Lifecycle Management) workspace.
 * Task #360 (L2C Wave 1, Step 2 — frontend).
 *
 * Three sections, switchable via /codex, /codex/clauses, /codex/counterparties:
 *   - Contracts   (default) — list with state + counterparty
 *   - Clauses              — clause library, drafts + published
 *   - Counterparties       — registry by kind
 *
 * Reads go through plain fetch (the codex routes aren't in the OpenAPI
 * codegen yet); RBAC is server-enforced and a 403 surfaces inline.
 */

import * as React from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  PageHero,
  SectionHead,
  TabNav,
  TabNavItem,
  Card,
  MonoChip,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Users, Library } from "lucide-react";

const API = "/api/atelier";

interface Counterparty {
  id: string;
  kind: string;
  legalName: string;
  displayName: string;
  jurisdiction: string;
  paymentTermsDays: number;
  kycState?: string;
}

interface Clause {
  id: string;
  family: string;
  title: string;
  version: number;
  status: string;
  riskTier: string;
  jurisdictionTags: string[];
  instrumentTypes: string[];
  updatedAt: string;
}

interface Contract {
  id: string;
  instrumentType: string;
  title: string;
  status: string;
  counterpartyId: string;
  engagementId: string | null;
  contractValue: number | null;
  contractValueUsd: number | null;
  currency: string | null;
  governingLaw: string | null;
  termStart: string | null;
  termEnd: string | null;
  updatedAt: string;
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
  internal_review: "amber",
  two_partner_countersigned: "gold",
  external_dispatched: "amber",
  counterparty_review: "amber",
  fully_executed: "green",
  active: "green",
  expiring: "amber",
  renewed: "gold",
  expired: "default",
  terminated: "red",
  published: "green",
  retired: "default",
};

export default function Codex() {
  const [, params] = useRoute("/codex/:section");
  const section = (params?.section ?? "contracts") as
    | "contracts"
    | "clauses"
    | "counterparties";

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="Codex"
          headline="Contract Lifecycle Management"
          lede="Counterparties, clause library, and the chain of instruments that bind every engagement."
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-8">
        <TabNav>
          <TabNavItem
            active={section === "contracts"}
            onClick={() => (window.location.href = "/codex")}
            data-testid="tab-codex-contracts"
          >
            <FileText className="w-3.5 h-3.5 mr-1.5 inline" /> Contracts
          </TabNavItem>
          <TabNavItem
            active={section === "clauses"}
            onClick={() => (window.location.href = "/codex/clauses")}
            data-testid="tab-codex-clauses"
          >
            <Library className="w-3.5 h-3.5 mr-1.5 inline" /> Clauses
          </TabNavItem>
          <TabNavItem
            active={section === "counterparties"}
            onClick={() => (window.location.href = "/codex/counterparties")}
            data-testid="tab-codex-counterparties"
          >
            <Users className="w-3.5 h-3.5 mr-1.5 inline" /> Counterparties
          </TabNavItem>
        </TabNav>

        <div className="py-2">
          {section === "contracts" && <ContractsSection />}
          {section === "clauses" && <ClausesSection />}
          {section === "counterparties" && <CounterpartiesSection />}
        </div>
      </div>
    </div>
  );
}

function ContractsSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["codex", "contracts"],
    queryFn: () => fetchJson<{ items: Contract[] }>("/codex/contracts"),
  });
  const cps = useQuery({
    queryKey: ["codex", "counterparties"],
    queryFn: () =>
      fetchJson<{ items: Counterparty[] }>("/codex/counterparties"),
  });
  const cpById = React.useMemo(() => {
    const m = new Map<string, Counterparty>();
    (cps.data?.items ?? []).forEach((c) => m.set(c.id, c));
    return m;
  }, [cps.data]);

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  if (error)
    return <ErrorBox label="Contracts unavailable" detail={String(error)} />;

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed bg-bg-deep">
        <FileText className="w-8 h-8 text-gold mx-auto mb-3" />
        <p className="text-text-mute">No contracts yet.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="codex-contracts-list">
      <div className="text-xs font-mono uppercase tracking-wide text-text-mute">
        {items.length} contract{items.length === 1 ? "" : "s"}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((c) => {
          const cp = cpById.get(c.counterpartyId);
          return (
            <Link
              key={c.id}
              href={`/codex/contracts/${c.id}`}
              className="block"
              data-testid={`contract-row-${c.id}`}
            >
              <Card className="p-4 hover:border-gold/50 transition-colors space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-text leading-snug truncate">
                      {c.title}
                    </div>
                    <div className="text-[11px] font-mono text-text-faint mt-0.5 uppercase tracking-wider">
                      {c.instrumentType}
                      {cp ? ` · ${cp.displayName}` : ""}
                    </div>
                  </div>
                  <MonoChip tone={STATUS_TONE[c.status] ?? "default"}>
                    {c.status}
                  </MonoChip>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-text-mute">
                  <span>{c.governingLaw || "—"}</span>
                  <span>
                    {c.contractValueUsd != null
                      ? `$${Math.round(c.contractValueUsd).toLocaleString()}`
                      : c.contractValue != null
                        ? `${c.currency ?? ""} ${Math.round(c.contractValue).toLocaleString()}`
                        : "—"}
                  </span>
                </div>
                {(c.termStart || c.termEnd) && (
                  <div className="text-[11px] font-mono text-text-faint">
                    {c.termStart ?? "?"} → {c.termEnd ?? "?"}
                  </div>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ClausesSection() {
  const [q, setQ] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["codex", "clauses", statusFilter, q],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (statusFilter) sp.set("status", statusFilter);
      if (q.trim()) sp.set("q", q.trim());
      const qs = sp.toString();
      return fetchJson<{ items: Clause[] }>(
        `/codex/clauses${qs ? `?${qs}` : ""}`,
      );
    },
  });

  if (error)
    return <ErrorBox label="Clauses unavailable" detail={String(error)} />;

  const items = data?.items ?? [];

  return (
    <div className="space-y-4" data-testid="codex-clauses-list">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or body…"
          className="flex-1 bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
          data-testid="input-clause-search"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
          data-testid="select-clause-status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="retired">Retired</option>
        </select>
      </div>
      {isLoading ? (
        <Skeleton className="h-48 bg-bg-elevate" />
      ) : items.length === 0 ? (
        <Card className="p-12 text-center border-dashed bg-bg-deep">
          <p className="text-text-mute">No clauses match.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((cl) => (
            <Card
              key={cl.id}
              className="p-3 flex items-start justify-between gap-3"
              data-testid={`clause-row-${cl.id}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text leading-snug">
                  {cl.title}
                </div>
                <div className="text-[11px] font-mono text-text-faint mt-0.5 uppercase tracking-wider">
                  {cl.family} v{cl.version}
                  {cl.jurisdictionTags.length > 0 &&
                    ` · ${cl.jurisdictionTags.join(", ")}`}
                </div>
                {cl.instrumentTypes.length > 0 && (
                  <div className="text-[10px] font-mono text-text-mute mt-1 flex flex-wrap gap-1">
                    {cl.instrumentTypes.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded bg-bg-elevate-2 border border-border-soft uppercase"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <MonoChip tone={STATUS_TONE[cl.status] ?? "default"}>
                  {cl.status}
                </MonoChip>
                <span
                  className={
                    cl.riskTier === "high"
                      ? "text-[10px] font-mono uppercase text-danger"
                      : cl.riskTier === "medium"
                        ? "text-[10px] font-mono uppercase text-warning"
                        : "text-[10px] font-mono uppercase text-text-faint"
                  }
                >
                  {cl.riskTier} risk
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CounterpartiesSection() {
  const [kind, setKind] = React.useState<string>("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["codex", "counterparties", kind],
    queryFn: () =>
      fetchJson<{ items: Counterparty[] }>(
        `/codex/counterparties${kind ? `?kind=${kind}` : ""}`,
      ),
  });
  if (error)
    return (
      <ErrorBox label="Counterparties unavailable" detail={String(error)} />
    );
  const items = data?.items ?? [];
  return (
    <div className="space-y-4" data-testid="codex-counterparties-list">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        className="bg-bg-elevate border border-border rounded-md px-3 py-2 text-sm text-text"
        data-testid="select-counterparty-kind"
      >
        <option value="">All kinds</option>
        <option value="client">Client</option>
        <option value="partner_firm">Partner firm</option>
        <option value="contractor">Contractor</option>
        <option value="regulator">Regulator</option>
        <option value="other">Other</option>
      </select>
      {isLoading ? (
        <Skeleton className="h-48 bg-bg-elevate" />
      ) : items.length === 0 ? (
        <Card className="p-12 text-center border-dashed bg-bg-deep">
          <p className="text-text-mute">No counterparties yet.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((cp) => (
            <Card
              key={cp.id}
              className="p-4 space-y-1.5"
              data-testid={`counterparty-row-${cp.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-text leading-snug">
                    {cp.displayName}
                  </div>
                  <div className="text-[11px] font-mono text-text-faint truncate">
                    {cp.legalName}
                  </div>
                </div>
                <MonoChip tone="default">{cp.kind}</MonoChip>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-text-mute">
                <span>{cp.jurisdiction || "—"}</span>
                <span>net {cp.paymentTermsDays}d</span>
              </div>
              {cp.kycState && (
                <div className="text-[10px] font-mono uppercase tracking-wider">
                  KYC:{" "}
                  <span
                    className={
                      cp.kycState === "approved"
                        ? "text-success"
                        : cp.kycState === "blocked"
                          ? "text-danger"
                          : "text-warning"
                    }
                  >
                    {cp.kycState}
                  </span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorBox({ label, detail }: { label: string; detail: string }) {
  return (
    <Card className="p-6 border border-danger/40 bg-danger/5 text-sm">
      <div className="font-semibold text-danger">{label}</div>
      <div className="text-[11px] font-mono text-text-mute mt-1 break-all">
        {detail}
      </div>
    </Card>
  );
}
