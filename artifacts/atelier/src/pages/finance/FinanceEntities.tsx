/**
 * FinanceEntities — entities backbone (Task #372).
 *
 * The CFO/Controller surface that didn't exist before this task: the
 * legal-entity scaffold every other Finance section is keyed off. Lists
 * each entity with its country, fiscal year-end, base currency, CR / tax
 * IDs, e-invoicing IDs (ZATCA / FTA / Peppol / HMRC MTD), trade
 * licences with expiry, bank accounts, signatories, fiscal calendar and
 * inter-company / TP relationships.
 */

import * as React from "react";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import { useFinanceEntities, type FinanceEntityRow } from "@/lib/v5-hooks";

const KIND_LABEL: Record<FinanceEntityRow["kind"], string> = {
  parent: "Parent",
  subsidiary: "Subsidiary",
  branch: "Branch",
  jv: "JV",
};

const COUNTRY_LABEL: Record<FinanceEntityRow["country"], string> = {
  SA: "🇸🇦 KSA",
  AE: "🇦🇪 UAE",
  GB: "🇬🇧 United Kingdom",
};

function daysUntil(iso: string): number {
  if (!iso || iso === "—") return Number.POSITIVE_INFINITY;
  return Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function licenseTone(s: FinanceEntityRow["tradeLicenses"][number]["status"]): "green" | "amber" | "red" | "gold" {
  switch (s) {
    case "active":
      return "green";
    case "expiring_soon":
      return "amber";
    case "expired":
      return "red";
    case "renewal_in_progress":
      return "gold";
  }
}

function eInvTone(s: "live" | "sandbox" | "pending"): "green" | "amber" | "default" {
  return s === "live" ? "green" : s === "pending" ? "amber" : "default";
}

function EntityCard({ entity, all }: { entity: FinanceEntityRow; all: FinanceEntityRow[] }) {
  const parent = entity.parentId ? all.find((e) => e.id === entity.parentId) : null;
  return (
    <Card className="p-5 space-y-5" data-testid={`finance-entity-${entity.id}`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>
            {KIND_LABEL[entity.kind]} · {COUNTRY_LABEL[entity.country]}
          </Eyebrow>
          <h3 className="text-lg font-semibold mt-1">{entity.legalName}</h3>
          <div className="text-xs text-text-mute mt-1">
            {entity.shortName} · {entity.jurisdiction} · incorporated {entity.incorporatedOn}
            {parent ? <> · child of <span className="text-text">{parent.shortName}</span></> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MonoChip tone={entity.status === "active" ? "green" : "amber"}>{entity.status}</MonoChip>
          <MonoChip>{entity.baseCurrency} → {entity.reportingCurrency}</MonoChip>
          <MonoChip>{entity.staffCount} staff</MonoChip>
        </div>
      </div>

      {/* Registration + tax IDs */}
      <div className="grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">Commercial Registration</div>
          <div className="font-mono text-text">{entity.commercialRegistration.number}</div>
          <div className="text-xs text-text-mute">
            {entity.commercialRegistration.authority}
            {entity.commercialRegistration.expiresOn !== "—" ? ` · expires ${entity.commercialRegistration.expiresOn}` : ""}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">Tax IDs</div>
          <div className="text-xs space-y-0.5">
            <div><span className="text-text-mute">VAT:</span> <span className="font-mono">{entity.taxIds.vat ?? "—"}</span></div>
            <div><span className="text-text-mute">Corporate:</span> <span className="font-mono">{entity.taxIds.corporate ?? "—"}</span></div>
            <div><span className="text-text-mute">WHT agent:</span> <span className="font-mono">{entity.taxIds.whtAgent ?? "—"}</span></div>
          </div>
        </div>
      </div>

      {/* E-invoicing */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">E-invoicing IDs</div>
        <div className="flex flex-wrap gap-2">
          {entity.eInvoicing.length === 0 && <span className="text-xs text-text-faint">— none registered</span>}
          {entity.eInvoicing.map((e) => (
            <div key={e.id} className="flex items-center gap-1.5 text-xs">
              <MonoChip tone={eInvTone(e.status)}>{e.scheme}</MonoChip>
              <span className="font-mono text-text-mute">{e.id}</span>
              <span className="text-text-faint">· {e.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trade licenses */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">Trade licences &amp; renewals</div>
        {entity.tradeLicenses.length === 0 ? (
          <div className="text-xs text-text-faint">— no separate trade licences (incorporation acts as authority)</div>
        ) : (
          <div className="space-y-1.5">
            {entity.tradeLicenses.map((lic) => {
              const d = daysUntil(lic.expiresOn);
              return (
                <div
                  key={lic.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-xs border-b border-border-soft last:border-b-0 pb-1.5"
                  data-testid={`finance-license-${lic.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-text">
                      <MonoChip tone={licenseTone(lic.status)} className="mr-2">{lic.status.replace("_", " ")}</MonoChip>
                      {lic.authority} · <span className="font-mono">{lic.number}</span>
                    </div>
                    <div className="text-text-mute mt-0.5">{lic.scope}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-text">{lic.expiresOn}</div>
                    <div className="text-text-faint">
                      {d < 0 ? `${Math.abs(d)}d overdue` : d < 365 ? `in ${d}d` : `in ${Math.round(d / 365)}y`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bank accounts */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">Bank accounts</div>
        <div className="space-y-1.5">
          {entity.bankAccounts.map((b) => {
            const sigNames = b.signatories
              .map((sid) => entity.signatories.find((s) => s.id === sid)?.name)
              .filter(Boolean) as string[];
            return (
              <div key={b.id} className="text-xs flex flex-wrap justify-between gap-2 border-b border-border-soft last:border-b-0 pb-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-text">
                    {b.primary && <MonoChip tone="gold" className="mr-2">primary</MonoChip>}
                    <MonoChip className="mr-2">{b.purpose}</MonoChip>
                    {b.bank}
                  </div>
                  <div className="font-mono text-text-mute mt-0.5">{b.iban} · {b.currency}</div>
                </div>
                <div className="text-right text-text-mute">
                  <div className="text-[10px] uppercase tracking-widest text-text-faint">Signatories</div>
                  <div>{sigNames.join(", ") || "—"}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Signatories */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">Authorised signatories &amp; board resolutions</div>
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          {entity.signatories.map((s) => (
            <div key={s.id} className="flex items-baseline justify-between gap-2 border border-border-soft rounded px-2 py-1.5">
              <div>
                <div className="text-text">{s.name}</div>
                <div className="text-text-mute">{s.role}</div>
              </div>
              <div className="text-right">
                <MonoChip tone={s.authorityLevel === "A" ? "gold" : "default"}>Auth {s.authorityLevel}</MonoChip>
                {s.resolutionRef && <div className="font-mono text-text-faint mt-0.5">{s.resolutionRef}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fiscal calendar + intercompany */}
      <div className="grid sm:grid-cols-2 gap-4 text-xs">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">Fiscal calendar</div>
          <div className="space-y-0.5">
            <div><span className="text-text-mute">Year-end:</span> {entity.fiscal.yearEnd}</div>
            <div><span className="text-text-mute">VAT period:</span> {entity.fiscal.vatPeriod}</div>
            <div><span className="text-text-mute">Next close:</span> <span className="font-mono">{entity.fiscal.nextClose}</span></div>
            <div><span className="text-text-mute">Next VAT filing:</span> <span className="font-mono">{entity.fiscal.nextVatFiling}</span></div>
            <div><span className="text-text-mute">Next CT filing:</span> <span className="font-mono">{entity.fiscal.nextCtFiling}</span></div>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">Inter-company &amp; TP</div>
          {entity.interCompany.length === 0 ? (
            <div className="text-text-faint">— stand-alone</div>
          ) : (
            <div className="space-y-0.5">
              {entity.interCompany.map((ic, i) => {
                const cp = all.find((e) => e.id === ic.counterpartyId);
                return (
                  <div key={i} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-text-mute">{ic.relationship}</span>
                    <span className="text-text">{cp?.shortName ?? ic.counterpartyId}</span>
                    <MonoChip>{ic.tpMethod}</MonoChip>
                    {ic.intercoServiceFeePct != null && (
                      <span className="text-text-faint">@ {(ic.intercoServiceFeePct * 100).toFixed(1)}%</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {entity.notes && (
        <div className="text-xs text-text-mute italic border-t border-border-soft pt-3">{entity.notes}</div>
      )}
    </Card>
  );
}

export default function FinanceEntities() {
  const entities = useFinanceEntities();
  const [filter, setFilter] = React.useState<"all" | FinanceEntityRow["country"]>("all");
  const visible = filter === "all" ? entities : entities.filter((e) => e.country === filter);

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <Eyebrow>Finance · Entities</Eyebrow>
        <h1 className="headline mt-3">Legal entities backbone</h1>
        <p className="lede mt-3 max-w-3xl">
          Parent / subsidiary / branch / JV records — commercial registration,
          tax IDs, e-invoicing enrolments (ZATCA, FTA, Peppol, HMRC MTD),
          trade licences with expiry tracking, bank accounts &amp; signatories,
          fiscal calendar and inter-company / transfer-pricing method.
        </p>
        <div className="mt-6 flex flex-wrap gap-2" data-testid="finance-entities-filters">
          {(["all", "SA", "AE", "GB"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-3 py-1 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
                filter === c ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
              }`}
              data-testid={`filter-country-${c}`}
            >
              {c === "all" ? "All" : COUNTRY_LABEL[c]}
            </button>
          ))}
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-4">
        <SectionHead headline={`${visible.length} entit${visible.length === 1 ? "y" : "ies"}`} />
        {visible.length === 0 && (
          <Card className="p-6 text-sm text-text-mute">No entities match this filter.</Card>
        )}
        {visible.map((e) => (
          <EntityCard key={e.id} entity={e} all={entities} />
        ))}
      </div>
    </div>
  );
}
