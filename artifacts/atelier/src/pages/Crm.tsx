import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAtelierListAccounts, useAtelierGetMe } from "@workspace/api-client-react";
import { TabNav, TabNavLink } from "@/components/ui/primitives";
import {
  Card,
  MonoChip,
  PillButton,
} from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, Plus } from "lucide-react";
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

export default function Crm() {
  const { data: accounts, isLoading } = useAtelierListAccounts();
  const { data: me } = useAtelierGetMe();
  const canCreate = !!me && CREATE_ROLES.has(me.role);
  const [view, setView] = useState<"accounts" | "renewals">("accounts");
  const [tier, setTier] = useState<string>("");
  const [sector, setSector] = useState<string>("");
  const [q, setQ] = useState("");

  const sectors = useMemo(() => {
    const s = new Set<string>();
    (accounts ?? []).forEach((a) => s.add(a.sector));
    return Array.from(s).sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    return (accounts ?? []).filter((a) => {
      if (tier && a.tier !== tier) return false;
      if (sector && a.sector !== sector) return false;
      if (q) {
        const hay = `${a.brandName ?? ""} ${a.name}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [accounts, tier, sector, q]);

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
        <TabNav>
          <TabNavLink href="#" active={false} onClick={(e) => { e.preventDefault(); setView("accounts"); }}>Accounts</TabNavLink>
          <TabNavLink href="#" active onClick={(e) => e.preventDefault()}>Renewals</TabNavLink>
        </TabNav>
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
      <TabNav>
        <TabNavLink href="#" active onClick={(e) => e.preventDefault()}>Accounts</TabNavLink>
        <TabNavLink href="#" active={false} onClick={(e) => { e.preventDefault(); setView("renewals"); }}>Renewals</TabNavLink>
      </TabNav>

      <div className="container-atelier py-10 space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-text-faint">
          <span>Filter</span>
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
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search accounts…"
            className="bg-bg-elevate border border-border rounded px-2 py-1 text-text placeholder:text-text-faint normal-case tracking-normal"
            data-testid="input-crm-search"
          />
          {(tier !== "" || sector !== "" || q !== "") && (
            <button
              type="button"
              onClick={() => { setTier(""); setSector(""); setQ(""); }}
              className="text-text-mute hover:text-gold underline"
            >
              Clear
            </button>
          )}
          <span className="ml-auto text-text-mute">{filtered.length} of {accounts?.length ?? 0}</span>
        </div>

        {isLoading && <Skeleton className="h-64 bg-bg-elevate" />}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((a) => (
            <Link
              key={a.id}
              href={`/accounts/${a.id}`}
              className="block group"
              data-testid={`card-account-${a.id}`}
            >
              <Card hover className="p-5 h-full flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-text group-hover:text-gold transition-colors">
                      {a.brandName ?? a.name}
                    </div>
                    {a.brandName && a.brandName !== a.name && (
                      <div className="text-[11px] font-mono text-text-faint italic mt-0.5">
                        {a.name}
                      </div>
                    )}
                    <div className="text-xs font-mono text-text-mute mt-0.5 flex items-center gap-1.5">
                      <Globe className="w-3 h-3" />
                      {a.country} · {a.sector}
                    </div>
                  </div>
                  <MonoChip tone={TIER_TONE[a.tier] ?? "default"}>{a.tier}</MonoChip>
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.partnerOwnerName && (
                    <MonoChip>Partner: {a.partnerOwnerName}</MonoChip>
                  )}
                  <MonoChip>{a.openOpportunityCount} open opp{a.openOpportunityCount === 1 ? "" : "s"}</MonoChip>
                  <MonoChip>{a.activeEngagementCount} active eng{a.activeEngagementCount === 1 ? "" : "s"}</MonoChip>
                  {(a.pendingUpdateCount ?? 0) > 0 && (
                    <MonoChip tone="amber">{a.pendingUpdateCount} pending update{a.pendingUpdateCount === 1 ? "" : "s"}</MonoChip>
                  )}
                </div>
                <div className="mt-auto pt-3 border-t border-border-soft flex items-center justify-between text-xs font-mono text-text-faint">
                  <span>{TIER_LABEL[a.tier] ?? a.tier}</span>
                  <span>
                    Strength {Math.round(a.relationshipStrength)}/100
                  </span>
                </div>
              </Card>
            </Link>
          ))}
          {!isLoading && filtered.length === 0 && (
            <Card className="p-8 text-center text-text-mute font-mono text-sm">
              No accounts match these filters.
            </Card>
          )}
        </div>
      </div>
    </div>
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
