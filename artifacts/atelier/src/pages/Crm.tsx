import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAtelierListAccounts } from "@workspace/api-client-react";
import {
  PageHero,
  SectionHead,
  Card,
  MonoChip,
  HeroStat,
} from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, Search, Users } from "lucide-react";

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
      if (q && !a.name.toLowerCase().includes(q.toLowerCase())) return false;
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

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Users className="w-3.5 h-3.5" /> Accounts
            </span>
          }
          headline="Accounts"
          lede="The firm's living roster of client relationships — Profile, Decision-Makers, Pursuits, Engagements, Whitespace, QBR — one per account."
        />
        <div className="grid grid-cols-3 gap-8 mt-8">
          <HeroStat value={accounts?.length ?? 0} caption="Accounts" size="md" />
          <HeroStat value={tierA} caption="Tier A · Marquee" size="md" />
          <HeroStat value={`${totalOpps}/${totalEngs}`} caption="Open opps · Active engs" size="md" />
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        <Card flat className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-text-mute" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search accounts…"
              className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-text-faint"
              data-testid="input-crm-search"
            />
          </div>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="bg-bg-elevate border border-border rounded px-2 py-1 text-xs font-mono uppercase tracking-wider text-text"
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
            className="bg-bg-elevate border border-border rounded px-2 py-1 text-xs font-mono uppercase tracking-wider text-text"
            data-testid="select-sector"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Card>

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
                      {a.name}
                    </div>
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
