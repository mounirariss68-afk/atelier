import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAtelierListAccounts, useAtelierGetMe } from "@workspace/api-client-react";
import { TabNav, TabNavLink } from "@/components/ui/primitives";
import {
  Card,
  MonoChip,
  PillButton,
} from "@/components/ui/primitives";
import { RecordCard } from "@/components/ui/record-card";
import { ViewToggle, useViewMode, RecordRow } from "@/components/ui/view-toggle";
import { useReferenceBootstrap } from "@/components/ReferenceCombobox";
import { localizedIndustryName } from "@/lib/reference-data";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, Plus, Users, Building2, MapPin, ChevronDown, ChevronUp, UserX } from "lucide-react";
import { CreateAccountDialog } from "@/components/CreateAccountDialog";

// Task #292 — Account creation: partner-tier + senior_manager.
const CREATE_ROLES = new Set(["founding_partner", "partner", "senior_manager"]);

const TIER_TONE: Record<string, "gold" | "green" | "amber" | "default"> = {
  A: "gold",
  B: "green",
  C: "amber",
  D: "default",
};

const TIER_LABEL: Record<string, string> = {
  A: "Tier A · Marquee",
  B: "Tier B · Active",
  C: "Tier C · Watch",
  D: "Tier D · Dormant",
};

// Task #614 — compact firmographic readout on the account cards so partners
// can size accounts at a glance. annualRevenue stays off the list (it is a
// gated money surface, shown only on the account page behind the
// account-financials gate).
const ENTITY_ROLE_LABEL: Record<string, string> = {
  hq: "Global HQ",
  subsidiary: "Subsidiary",
  branch: "Branch",
  office: "Office",
};

// Task #210 — surface stale executive maps (>30d since the last completed
// Executive Mapper sweep) on the accounts list, not just inside each account.
// Bespoke raw-fetch route (not in the OpenAPI spec), same pattern as the
// other account-agent surfaces (see atelier-account-agent-ui memory).
function useStaleExecMaps() {
  return useQuery({
    queryKey: ["atelier-exec-mapper-coverage-staleness"],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/atelier/accounts/executive-mapper/coverage-staleness`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`coverage-staleness fetch failed (${res.status})`);
      return (await res.json()) as {
        staleDays: number;
        entries: { accountId: string; lastRunAt: string; ageDays: number; stale: boolean }[];
      };
    },
  });
}

export default function Crm() {
  const [lifecycle, setLifecycle] = useState<"active" | "archived">("active");
  const { data: accounts, isLoading } = useAtelierListAccounts(
    lifecycle === "archived" ? { status: "archived" } : undefined,
  );
  const { data: me } = useAtelierGetMe();
  const { data: staleMaps } = useStaleExecMaps();
  const staleMapAges = useMemo(() => {
    const m = new Map<string, number>();
    (staleMaps?.entries ?? []).forEach((e) => {
      if (e.stale) m.set(e.accountId, e.ageDays);
    });
    return m;
  }, [staleMaps]);
  const canCreate = !!me && CREATE_ROLES.has(me.role);
  const [view, setView] = useState<"accounts" | "renewals">("accounts");
  const [tier, setTier] = useState<string>("");
  const [sector, setSector] = useState<string>("");
  const [industry, setIndustry] = useState<string>("");
  const [owner, setOwner] = useState<string>("");
  const [q, setQ] = useState("");
  // Task #723 — list/card toggle, persisted per page.
  const [viewMode, setViewMode] = useViewMode("crm-accounts");

  const sectors = useMemo(() => {
    const s = new Set<string>();
    (accounts ?? []).forEach((a) => s.add(a.sector));
    return Array.from(s).sort();
  }, [accounts]);

  // Task #723 — industry filter options resolved through the same taxonomy
  // the account detail page uses (reference-data bootstrap). Options are
  // derived from the codes actually present on the loaded accounts, so the
  // dropdown only ever offers slices that exist.
  const hasIndustryCodes = (accounts ?? []).some((a) => !!a.industryCode);
  const { data: refData } = useReferenceBootstrap(hasIndustryCodes);
  const industryOptions = useMemo(() => {
    const codes = new Set<string>();
    (accounts ?? []).forEach((a) => {
      if (a.industryCode) codes.add(a.industryCode);
    });
    return Array.from(codes)
      .map((code) => {
        const row = refData?.industries.find((i) => i.code === code) ?? null;
        return { code, label: row ? localizedIndustryName(row, "en") : code };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [accounts, refData]);

  const owners = useMemo(() => {
    const s = new Set<string>();
    (accounts ?? []).forEach((a) => {
      if (a.partnerOwnerName) s.add(a.partnerOwnerName);
    });
    return Array.from(s).sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    return (accounts ?? []).filter((a) => {
      if (tier && a.tier !== tier) return false;
      if (sector && a.sector !== sector) return false;
      if (industry && a.industryCode !== industry) return false;
      if (owner && a.partnerOwnerName !== owner) return false;
      if (q) {
        const hay = `${a.brandName ?? ""} ${a.name}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [accounts, tier, sector, industry, owner, q]);

  // Task #723 — group the filtered set under country headings (with counts);
  // accounts without a country fall into a trailing "No country" group.
  const NO_COUNTRY = "No country";
  const grouped = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const a of filtered) {
      const key = a.country?.trim() || NO_COUNTRY;
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => {
      if (a === NO_COUNTRY) return 1;
      if (b === NO_COUNTRY) return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const totalOpps = (accounts ?? []).reduce(
    (s, a) => s + (a.openOpportunityCount ?? 0),
    0,
  );
  const totalEngs = (accounts ?? []).reduce(
    (s, a) => s + (a.activeEngagementCount ?? 0),
    0,
  );
  const tierA = (accounts ?? []).filter((a) => a.tier === "A").length;

  if (view === "renewals") {
    return (
      <div className="animate-in fade-in" data-testid="page-crm-renewals">
        <LensPageHeader headline="Renewals & NRR" lede="Open renewal motions, risk tier, and net-revenue-retention delta." />
        <div className="container-atelier">
          <TabNav>
            <TabNavLink href="#" active={false} onClick={(e) => { e.preventDefault(); setView("accounts"); }}>Accounts</TabNavLink>
            <TabNavLink href="#" active onClick={(e) => e.preventDefault()}>Renewals</TabNavLink>
          </TabNav>
        </div>
        <div className="container-atelier py-10">
          <RenewalsTab />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        headline="Accounts"
        lede="The firm's living roster of client relationships — Profile, Decision-Makers, Pursuits, Engagements, Whitespace, QBR — one per account."
        actions={
          canCreate ? (
            <CreateAccountDialog
              trigger={
                <PillButton variant="primary" data-testid="button-new-account">
                  <span className="inline-flex items-center gap-1"><Plus className="w-3 h-3" /> New account</span>
                </PillButton>
              }
            />
          ) : null
        }
      />
      <div className="container-atelier pt-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Accounts</div>
            <div className="text-2xl font-light text-text mt-1">{accounts?.length ?? 0}</div>
          </Card>
          <Card className="p-4 border-gold/40">
            <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Tier A · Marquee</div>
            <div className="text-2xl font-light text-gold mt-1">{tierA}</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Open opps · Active engs</div>
            <div className="text-2xl font-light text-text mt-1">{totalOpps}/{totalEngs}</div>
          </Card>
        </div>
      </div>
      <div className="container-atelier">
        <TabNav>
          <TabNavLink href="#" active onClick={(e) => e.preventDefault()}>Accounts</TabNavLink>
          <TabNavLink href="#" active={false} onClick={(e) => { e.preventDefault(); setView("renewals"); }}>Renewals</TabNavLink>
        </TabNav>
      </div>

      <div className="container-atelier py-10 space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-text-faint">
          <span>Filter</span>
          <div className="inline-flex rounded border border-border overflow-hidden" data-testid="lifecycle-toggle">
            <button
              type="button"
              onClick={() => setLifecycle("active")}
              className={`px-2 py-1 ${lifecycle === "active" ? "bg-gold/20 text-gold" : "bg-bg-elevate text-text-mute hover:text-text"}`}
              data-testid="lifecycle-active"
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setLifecycle("archived")}
              className={`px-2 py-1 border-l border-border ${lifecycle === "archived" ? "bg-gold/20 text-gold" : "bg-bg-elevate text-text-mute hover:text-text"}`}
              data-testid="lifecycle-archived"
            >
              Archived
            </button>
          </div>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
            data-testid="select-tier"
          >
            <option value="">All tiers</option>
            <option value="A">Tier A</option>
            <option value="B">Tier B</option>
            <option value="C">Tier C</option>
            <option value="D">Tier D</option>
          </select>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
            data-testid="select-sector"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {industryOptions.length > 0 && (
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
              data-testid="select-industry"
            >
              <option value="">All industries</option>
              {industryOptions.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.label}
                </option>
              ))}
            </select>
          )}
          {owners.length > 0 && (
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
              data-testid="select-owner"
            >
              <option value="">All partners</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search accounts…"
            className="bg-bg-elevate border border-border rounded px-2 py-1 text-text placeholder:text-text-faint normal-case tracking-normal"
            data-testid="input-crm-search"
          />
          {(tier !== "" || sector !== "" || industry !== "" || owner !== "" || q !== "") && (
            <button
              type="button"
              onClick={() => { setTier(""); setSector(""); setIndustry(""); setOwner(""); setQ(""); }}
              className="text-text-mute hover:text-gold underline"
            >
              Clear
            </button>
          )}
          <span className="ml-auto text-text-mute">{filtered.length} of {accounts?.length ?? 0}</span>
          <ViewToggle mode={viewMode} onChange={setViewMode} data-testid="view-toggle-accounts" />
        </div>

        {lifecycle === "active" && <CoverageRollupCard />}

        {isLoading && <Skeleton className="h-64 bg-bg-elevate" />}

        {grouped.map(([country, group]) => (
          <div key={country} className="space-y-3" data-testid={`country-group-${country}`}>
            <div className="flex items-baseline gap-2 border-b border-border-soft pb-1.5">
              <span className="text-[11px] font-mono uppercase tracking-widest text-text-mute">
                {country}
              </span>
              <span className="text-[11px] font-mono text-text-faint" data-testid={`country-count-${country}`}>
                {group.length}
              </span>
            </div>
            {viewMode === "list" ? (
              <div className="space-y-2">
                {group.map((a) => (
                  <RecordRow
                    key={a.id}
                    href={`/accounts/${a.id}`}
                    data-testid={`row-account-${a.id}`}
                    title={a.brandName ?? a.name}
                    subtitle={
                      <span className="font-mono">
                        {a.country} · {a.sector}
                      </span>
                    }
                    chips={
                      <>
                        {a.partnerOwnerName && <MonoChip>Partner: {a.partnerOwnerName}</MonoChip>}
                        <MonoChip>{a.openOpportunityCount} opp{a.openOpportunityCount === 1 ? "" : "s"}</MonoChip>
                        <MonoChip>{a.activeEngagementCount} eng{a.activeEngagementCount === 1 ? "" : "s"}</MonoChip>
                        {(a.pendingUpdateCount ?? 0) > 0 && (
                          <MonoChip tone="amber">{a.pendingUpdateCount} pending</MonoChip>
                        )}
                        {staleMapAges.has(a.id) && (
                          <MonoChip tone="amber">map stale · {staleMapAges.get(a.id)}d</MonoChip>
                        )}
                      </>
                    }
                    trailing={
                      <>
                        <span className="text-[11px] font-mono text-text-faint hidden sm:inline">
                          Strength {Math.round(a.relationshipStrength)}/100
                        </span>
                        <MonoChip tone={TIER_TONE[a.tier] ?? "default"}>{a.tier}</MonoChip>
                      </>
                    }
                  />
                ))}
              </div>
            ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {group.map((a) => (
            <div key={a.id} data-testid={`card-account-${a.id}`} className="h-full">
              <RecordCard
                href={`/accounts/${a.id}`}
                title={a.brandName ?? a.name}
                subtitle={
                  <>
                    {a.brandName && a.brandName !== a.name && (
                      <span className="block text-[11px] font-mono text-text-faint italic">
                        {a.name}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 font-mono">
                      <Globe className="w-3 h-3" />
                      {a.country} · {a.sector}
                    </span>
                  </>
                }
                trailing={<MonoChip tone={TIER_TONE[a.tier] ?? "default"}>{a.tier}</MonoChip>}
                chips={
                  <>
                    {a.partnerOwnerName && (
                      <MonoChip>Partner: {a.partnerOwnerName}</MonoChip>
                    )}
                    <MonoChip>{a.openOpportunityCount} open opp{a.openOpportunityCount === 1 ? "" : "s"}</MonoChip>
                    <MonoChip>{a.activeEngagementCount} active eng{a.activeEngagementCount === 1 ? "" : "s"}</MonoChip>
                    {(a.pendingUpdateCount ?? 0) > 0 && (
                      <MonoChip tone="amber">{a.pendingUpdateCount} pending update{a.pendingUpdateCount === 1 ? "" : "s"}</MonoChip>
                    )}
                    {staleMapAges.has(a.id) && (
                      <MonoChip tone="amber" data-testid={`chip-stale-map-${a.id}`}>
                        <span className="inline-flex items-center gap-1">
                          <UserX className="w-3 h-3" />
                          buyer map stale · {staleMapAges.get(a.id)}d
                        </span>
                      </MonoChip>
                    )}
                  </>
                }
                footer={
                  <div className="flex items-center justify-between text-xs font-mono text-text-faint">
                    <span>{TIER_LABEL[a.tier] ?? a.tier}</span>
                    <span>Strength {Math.round(a.relationshipStrength)}/100</span>
                  </div>
                }
              >
                {(a.employeeCount != null ||
                  a.entityRole ||
                  (a.countryPresence?.length ?? 0) > 0) && (
                  <div
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-text-mute"
                    data-testid={`firmographics-${a.id}`}
                  >
                    {a.employeeCount != null && (
                      <span
                        className="inline-flex items-center gap-1"
                        data-testid={`firmo-employees-${a.id}`}
                      >
                        <Users className="w-3 h-3" />
                        {a.employeeCount.toLocaleString()} emp
                      </span>
                    )}
                    {a.entityRole && (
                      <span
                        className="inline-flex items-center gap-1"
                        data-testid={`firmo-role-${a.id}`}
                      >
                        <Building2 className="w-3 h-3" />
                        {ENTITY_ROLE_LABEL[a.entityRole] ?? a.entityRole}
                      </span>
                    )}
                    {(a.countryPresence?.length ?? 0) > 0 && (
                      <span
                        className="inline-flex items-center gap-1"
                        data-testid={`firmo-countries-${a.id}`}
                      >
                        <MapPin className="w-3 h-3" />
                        {a.countryPresence!.length}{" "}
                        {a.countryPresence!.length === 1 ? "country" : "countries"}
                      </span>
                    )}
                  </div>
                )}
              </RecordCard>
            </div>
          ))}
        </div>
            )}
          </div>
        ))}
        {!isLoading && filtered.length === 0 && (
          <Card className="p-8 text-center text-text-mute font-mono text-sm">
            No accounts match these filters.
          </Card>
        )}
      </div>
    </div>
  );
}

// Task #207 — cross-account critical buyer-role coverage rollup. Reads the
// bespoke /executive-mapper/coverage-rollup route (raw fetch, same pattern as
// the per-account coverage block on the Account page). Accounts with the
// biggest gaps sort first so the card doubles as a prioritisation list.
interface CoverageRollupAccount {
  accountId: string;
  name: string;
  brandName: string | null;
  tier: string;
  runAt: string | null;
  mappedCount: number | null;
  missingRoles: Array<{ role: string; label: string }>;
}

function CoverageRollupCard() {
  const [expanded, setExpanded] = useState(false);
  const { data } = useQuery({
    queryKey: ["atelier-exec-mapper-coverage-rollup"],
    queryFn: async () => {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/atelier/executive-mapper/coverage-rollup`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`coverage rollup fetch failed (${res.status})`);
      return (await res.json()) as {
        totalRoles: number;
        accounts: CoverageRollupAccount[];
      };
    },
  });
  if (!data || data.accounts.length === 0) return null;

  const swept = data.accounts
    .filter((a) => a.mappedCount != null)
    .sort((a, b) => (a.mappedCount ?? 0) - (b.mappedCount ?? 0));
  const unswept = data.accounts.filter((a) => a.mappedCount == null);
  // Nothing swept yet — no coverage data to summarise, stay out of the way.
  if (swept.length === 0) return null;

  const fullyMapped = swept.filter((a) => a.missingRoles.length === 0).length;
  const COLLAPSED_ROWS = 5;
  const rows = expanded ? swept : swept.slice(0, COLLAPSED_ROWS);

  return (
    <Card className="p-5 space-y-3" data-testid="card-coverage-rollup">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">
          Critical buyer-role coverage
        </div>
        <span className="text-[10px] font-mono text-text-faint">
          {fullyMapped}/{swept.length} accounts fully mapped
          {unswept.length > 0 ? ` · ${unswept.length} not yet swept` : ""}
        </span>
      </div>
      <p className="text-text-mute text-xs leading-relaxed">
        From each account's latest executive mapping sweep — the accounts with
        the biggest gaps in the {data.totalRoles} critical buyer roles sort
        first.
      </p>
      <div className="space-y-2">
        {rows.map((a) => (
          <Link
            key={a.accountId}
            href={`/accounts/${a.accountId}`}
            className="block group"
            data-testid={`rollup-account-${a.accountId}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-soft pt-2 first:border-t-0 first:pt-0">
              <span className="text-sm text-text group-hover:text-gold transition-colors">
                {a.brandName ?? a.name}
              </span>
              <span
                className={`text-[11px] font-mono ${a.missingRoles.length === 0 ? "text-success" : "text-text-faint"}`}
                data-testid={`rollup-count-${a.accountId}`}
              >
                {a.mappedCount}/{data.totalRoles} mapped
              </span>
              {a.missingRoles.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {a.missingRoles.slice(0, 6).map((m) => (
                    <MonoChip key={m.role} data-testid={`rollup-gap-${a.accountId}-${m.role}`}>
                      {m.label}
                    </MonoChip>
                  ))}
                  {a.missingRoles.length > 6 && (
                    <span className="text-[10px] font-mono text-text-faint self-center">
                      +{a.missingRoles.length - 6} more
                    </span>
                  )}
                </span>
              )}
              {a.missingRoles.length === 0 && (
                <MonoChip tone="green">All critical roles mapped</MonoChip>
              )}
            </div>
          </Link>
        ))}
      </div>
      {(swept.length > COLLAPSED_ROWS || unswept.length > 0) && (
        <div className="flex items-center justify-between pt-1">
          {swept.length > COLLAPSED_ROWS ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] font-mono uppercase tracking-wider text-text-faint hover:text-gold inline-flex items-center gap-1"
              data-testid="button-rollup-toggle"
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" /> Show fewer
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" /> Show all {swept.length} accounts
                </>
              )}
            </button>
          ) : (
            <span />
          )}
          {unswept.length > 0 && (
            <span className="text-[10px] font-mono text-text-faint">
              Not yet swept:{" "}
              {unswept
                .slice(0, 4)
                .map((a) => a.brandName ?? a.name)
                .join(", ")}
              {unswept.length > 4 ? ` +${unswept.length - 4} more` : ""}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

interface RenewalRow {
  id: string;
  accountId: string | null;
  status: string;
  riskTier: string;
  currentArrUsd: number;
  proposedArrUsd: number;
  nrrDeltaPct: number;
  renewalDueAt: string | null;
}

function RenewalsTab() {
  const [rows, setRows] = useState<RenewalRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await fetch("/api/atelier/crm/renewals?status=open", { credentials: "include" });
    const j = await r.json();
    setRows(j?.data?.rows ?? []);
  };
  useEffect(() => { void load(); }, []);

  const autoOpen = async () => {
    setBusy(true);
    try {
      await fetch("/api/atelier/crm/renewals/auto-open", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ horizonDays: 90 }),
      });
      await load();
    } finally { setBusy(false); }
  };

  const totalArr = rows.reduce((s, r) => s + r.currentArrUsd, 0);
  const totalProposed = rows.reduce((s, r) => s + r.proposedArrUsd, 0);
  const nrr = totalArr > 0 ? Math.round(((totalProposed - totalArr) / totalArr) * 1000) / 10 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="grid grid-cols-3 gap-3 flex-1 mr-4">
          <Card className="p-3">
            <div className="text-[11px] font-mono uppercase text-text-faint">Open renewals</div>
            <div className="text-2xl font-light">{rows.length}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[11px] font-mono uppercase text-text-faint">Current ARR</div>
            <div className="text-2xl font-light">${totalArr.toFixed(0)}</div>
          </Card>
          <Card className="p-3 border-gold/40">
            <div className="text-[11px] font-mono uppercase text-text-faint">NRR Δ</div>
            <div className={`text-2xl font-light ${nrr >= 0 ? "text-success" : "text-danger"}`}>{nrr >= 0 ? "+" : ""}{nrr}%</div>
          </Card>
        </div>
        <PillButton variant="ghost" disabled={busy} data-testid="btn-renewal-auto-open" onClick={autoOpen}>
          {busy ? "Sweeping…" : "Auto-open T-90"}
        </PillButton>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm" data-testid="renewals-rows">
          <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
            <tr>
              <th className="text-left px-3 py-2">Renewal</th>
              <th className="text-left px-3 py-2">Account</th>
              <th className="text-right px-3 py-2">Current ARR</th>
              <th className="text-right px-3 py-2">Proposed</th>
              <th className="text-right px-3 py-2">NRR Δ</th>
              <th className="text-left px-3 py-2">Risk</th>
              <th className="text-left px-3 py-2">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-text-mute">No open renewals. Click <span className="font-mono">Auto-open T-90</span>.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border-soft">
                <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.accountId ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">${r.currentArrUsd.toFixed(0)}</td>
                <td className="px-3 py-2 text-right font-mono">${r.proposedArrUsd.toFixed(0)}</td>
                <td className={`px-3 py-2 text-right font-mono ${r.nrrDeltaPct >= 0 ? "text-success" : "text-danger"}`}>
                  {r.nrrDeltaPct >= 0 ? "+" : ""}{r.nrrDeltaPct}%
                </td>
                <td className="px-3 py-2"><MonoChip tone={r.riskTier === "red" ? "red" : r.riskTier === "amber" ? "amber" : "green"}>{r.riskTier}</MonoChip></td>
                <td className="px-3 py-2 font-mono text-xs">{r.renewalDueAt ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
