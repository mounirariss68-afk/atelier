/**
 * FinanceComplyInsurance — Insurance register (Task #419).
 */
import * as React from "react";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip, BackLink } from "@/components/ui/primitives";
import { useInsurancePolicies, useFinanceEntities, type InsurancePolicyRow } from "@/lib/v5-hooks";

function statusTone(s: InsurancePolicyRow["status"]): "green" | "amber" | "red" | "gold" {
  switch (s) {
    case "active": return "green";
    case "expiring_soon": return "amber";
    case "renewal_in_progress": return "gold";
    case "expired": return "red";
  }
}

function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function FinanceComplyInsurance() {
  const policies = useInsurancePolicies();
  const entities = useFinanceEntities();

  const sorted = [...policies].sort((a, b) => a.periodTo.localeCompare(b.periodTo));
  const expired = policies.filter((p) => p.status === "expired").length;
  const expiring = policies.filter((p) => p.status === "expiring_soon" || p.status === "renewal_in_progress").length;
  const totalCoverage = policies.reduce((s, p) => s + p.coverageUsdK, 0);
  const totalPremium = policies.reduce((s, p) => s + p.premiumUsdK, 0);

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <div className="container-atelier">
          <BackLink href="/finance/comply">Finance · Comply</BackLink>
        </div>
        <Eyebrow>Manage · Finance · Comply · Insurance</Eyebrow>
        <h1 className="headline mt-3">Insurance register</h1>
        <p className="lede mt-3 max-w-3xl">
          PI, D&amp;O, employer's liability, cyber and office cover — policy
          number, insurer, period, coverage, premium and renewal date. Feeds
          the compliance calendar so renewals don't lapse.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-xs font-mono">
          <MonoChip>{policies.length} policies</MonoChip>
          <MonoChip tone={expired > 0 ? "red" : "green"}>{expired} expired</MonoChip>
          <MonoChip tone={expiring > 0 ? "amber" : "default"}>{expiring} expiring / renewing</MonoChip>
          <MonoChip>${totalCoverage.toLocaleString()}k cover</MonoChip>
          <MonoChip>${totalPremium.toLocaleString()}k premium</MonoChip>
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-3">
        <SectionHead headline={`${sorted.length} policies`} />
        {sorted.map((p) => {
          const ent = entities.find((e) => e.id === p.entityId);
          const d = daysUntil(p.periodTo);
          return (
            <Card key={p.id} className="p-4 space-y-2" data-testid={`insurance-${p.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Eyebrow>{ent?.shortName ?? p.entityId} · {p.kind}</Eyebrow>
                  <div className="text-base font-medium text-text mt-0.5">{p.insurer}</div>
                  <div className="font-mono text-xs text-text-mute">{p.policyNumber}</div>
                </div>
                <div className="text-right shrink-0">
                  <MonoChip tone={statusTone(p.status)}>{p.status.replace("_", " ")}</MonoChip>
                  <div className="font-mono text-xs text-text mt-1.5">renews {p.periodTo}</div>
                  <div className="font-mono text-[10px] text-text-faint">
                    {d < 0 ? `${Math.abs(d)}d overdue` : d <= 60 ? `in ${d}d` : `in ${Math.round(d / 30)}mo`}
                  </div>
                </div>
              </div>
              <div className="grid sm:grid-cols-4 gap-3 text-xs pt-2 border-t border-border-soft">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Period</div>
                  <div className="text-text font-mono mt-0.5">{p.periodFrom} → {p.periodTo}</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Coverage</div>
                  <div className="text-text font-mono mt-0.5">${p.coverageUsdK.toLocaleString()}k</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Premium / Excess</div>
                  <div className="text-text font-mono mt-0.5">${p.premiumUsdK}k / ${p.excessUsdK}k</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Renewal owner</div>
                  <div className="text-text mt-0.5">{p.renewalOwner}</div>
                </div>
              </div>
              {p.notes && <div className="text-xs text-text-mute italic">{p.notes}</div>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
