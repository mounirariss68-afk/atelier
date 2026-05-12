import {
  useAtelierListAccounts,
  useAtelierListOpportunities,
  useAtelierListEngagements,
} from "@workspace/api-client-react";
import { SectionHead, Card, PlmPill, MonoChip } from "@/components/ui/primitives";
import { Link, useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Globe, Briefcase, Layers } from "lucide-react";

export default function Account() {
  const [, params] = useRoute("/accounts/:accountId");
  const accountId = params?.accountId || "";

  const { data: accounts, isLoading, isError } = useAtelierListAccounts();
  const { data: opps } = useAtelierListOpportunities();
  const { data: engs } = useAtelierListEngagements();

  if (isLoading) {
    return (
      <div className="container-atelier py-12">
        <Skeleton className="h-64 bg-bg-elevate" />
      </div>
    );
  }

  const account = accounts?.find((a) => a.id === accountId);
  if (isError || !account) {
    return (
      <div className="container-atelier py-12 text-danger">
        Account not found.
      </div>
    );
  }

  const accountOpps = (opps ?? []).filter((o) => o.accountId === accountId);
  const accountEngs = (engs ?? []).filter((e) => e.accountId === accountId);

  return (
    <div className="container-atelier py-8 space-y-8 animate-in fade-in">
      <Link
        href="/pipeline"
        className="inline-flex items-center gap-2 text-xs font-mono text-text-mute hover:text-text mb-2 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </Link>

      <SectionHead
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Globe className="w-3.5 h-3.5" />
            {account.country} · {account.sector}
          </span>
        }
        headline={account.name}
        lede={account.notes ?? undefined}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-wider text-text-mute flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5" />
            Opportunities ({accountOpps.length})
          </h2>
          {accountOpps.length === 0 && (
            <Card className="p-5 text-text-mute font-mono text-sm">
              No opportunities for this account.
            </Card>
          )}
          {accountOpps.map((o) => (
            <Card key={o.id} className="p-4 hover:border-gold/50 transition-colors">
              <Link
                href={`/pipeline/${o.id}`}
                className="font-semibold text-text hover:text-gold transition-colors block"
              >
                {o.name}
              </Link>
              <div className="flex flex-wrap gap-2 mt-2">
                <PlmPill stage={o.plmStage} />
                <MonoChip>${(o.dealSizeUsd / 1000).toFixed(0)}k</MonoChip>
                <MonoChip tone="amber">{o.probabilityPct}%</MonoChip>
              </div>
            </Card>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-wider text-text-mute flex items-center gap-2">
            <Layers className="w-3.5 h-3.5" />
            Engagements ({accountEngs.length})
          </h2>
          {accountEngs.length === 0 && (
            <Card className="p-5 text-text-mute font-mono text-sm">
              No active engagements for this account.
            </Card>
          )}
          {accountEngs.map((e) => (
            <Card key={e.id} className="p-4 hover:border-gold/50 transition-colors">
              <Link
                href={`/engagements/${e.id}`}
                className="font-semibold text-text hover:text-gold transition-colors block"
              >
                {e.name}
              </Link>
              <div className="flex flex-wrap gap-2 mt-2">
                <PlmPill stage={e.plmStage} />
                <MonoChip
                  tone={
                    e.raidStatus === "red"
                      ? "red"
                      : e.raidStatus === "amber"
                        ? "amber"
                        : "green"
                  }
                >
                  RAID: {e.raidStatus}
                </MonoChip>
              </div>
            </Card>
          ))}
        </section>
      </div>
    </div>
  );
}
