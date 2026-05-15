/**
 * FinanceHome — Finance lens index (Task #372).
 *
 * Section ribbon for the eight Finance sections (Entities · Record · Bill
 * & Collect · Pay · Close · Plan · Report · Comply) with counts pulled
 * from the Entities backbone and "next action for you" tiles surfacing
 * the imminent licence renewals, period closes and tax filings the
 * CFO/Controller cares about today.
 */

import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import {
  useFinanceEntities,
  useExpectedDisbursements,
  useStalledApprovals,
  type FinanceEntityRow,
} from "@/lib/v5-hooks";
import { ArrowRight } from "lucide-react";

interface SectionTile {
  id: string;
  label: string;
  href: string;
  blurb: string;
}

const SECTIONS: SectionTile[] = [
  { id: "entities", label: "Entities", href: "/finance/entities", blurb: "Legal entities, CR, tax IDs, e-invoicing, licences, banks, signatories." },
  { id: "ledger", label: "Record", href: "/finance/ledger", blurb: "Chart of accounts, journals, AR / AP / FA / inter-company sub-ledgers." },
  { id: "billing", label: "Bill & Collect", href: "/finance/billing", blurb: "Rate cards, e-invoice clearance, AR aging, dunning, cash app, rev-rec." },
  { id: "payables", label: "Pay", href: "/finance/payables", blurb: "Vendors, PO / non-PO, expenses, VAT / WHT, payment runs." },
  { id: "close", label: "Close", href: "/finance/close", blurb: "Period close checklist, reconciliations, adjusting entries, sign-offs." },
  { id: "plan", label: "Plan (FP&A)", href: "/finance/plan", blurb: "Budget, re-forecasts, 13-week cash, renewals, scenarios, long-range." },
  { id: "reports", label: "Report", href: "/finance/reports", blurb: "P&L · BS · CF, firm/engagement economics, board pack, scheduled exports." },
  { id: "comply", label: "Comply", href: "/finance/comply", blurb: "Tax filings calendar, statutory accounts, transfer pricing, controls." },
];

function daysUntil(iso: string): number {
  const target = new Date(iso).getTime();
  const now = Date.now();
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

function fmtRelative(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 30) return `in ${days}d`;
  const months = Math.round(days / 30);
  return `in ${months}mo`;
}

interface NextAction {
  id: string;
  section: string;
  href: string;
  title: string;
  detail: string;
  due: string;
  tone: "red" | "amber" | "gold" | "default";
  daysOut: number;
}

function buildNextActions(entities: FinanceEntityRow[]): NextAction[] {
  const out: NextAction[] = [];
  for (const e of entities) {
    for (const lic of e.tradeLicenses) {
      const d = daysUntil(lic.expiresOn);
      if (d <= 180) {
        out.push({
          id: `lic-${lic.id}`,
          section: "Comply",
          href: `/finance/entities`,
          title: `${lic.authority} licence renewal — ${e.shortName}`,
          detail: `${lic.scope} · ${lic.number}`,
          due: `${lic.expiresOn} (${fmtRelative(d)})`,
          tone: d < 0 ? "red" : d <= 60 ? "amber" : d <= 120 ? "gold" : "default",
          daysOut: d,
        });
      }
    }
    const closeD = daysUntil(e.fiscal.nextClose);
    if (closeD <= 30) {
      out.push({
        id: `close-${e.id}`,
        section: "Close",
        href: `/finance/close`,
        title: `Period close — ${e.shortName}`,
        detail: `Fiscal year ends ${e.fiscal.yearEnd}`,
        due: `${e.fiscal.nextClose} (${fmtRelative(closeD)})`,
        tone: closeD < 0 ? "red" : closeD <= 7 ? "amber" : "default",
        daysOut: closeD,
      });
    }
    const vatD = daysUntil(e.fiscal.nextVatFiling);
    if (vatD <= 30) {
      out.push({
        id: `vat-${e.id}`,
        section: "Comply",
        href: `/finance/comply`,
        title: `${e.fiscal.vatPeriod === "monthly" ? "Monthly" : "Quarterly"} VAT filing — ${e.shortName}`,
        detail: e.taxIds.vat ?? "—",
        due: `${e.fiscal.nextVatFiling} (${fmtRelative(vatD)})`,
        tone: vatD < 0 ? "red" : vatD <= 7 ? "amber" : "default",
        daysOut: vatD,
      });
    }
  }
  out.sort((a, b) => a.daysOut - b.daysOut);
  return out.slice(0, 6);
}

function toneClasses(t: NextAction["tone"]): string {
  switch (t) {
    case "red":
      return "border-danger/40 bg-danger/5";
    case "amber":
      return "border-amber-500/40 bg-amber-500/5";
    case "gold":
      return "border-gold/40 bg-gold/5";
    default:
      return "border-border-soft";
  }
}

export default function FinanceHome() {
  const entities = useFinanceEntities();
  const disbursements = useExpectedDisbursements();
  const stalled = useStalledApprovals();
  const nextActions = React.useMemo(() => buildNextActions(entities), [entities]);

  const counts = React.useMemo(() => {
    const licCount = entities.reduce((n, e) => n + e.tradeLicenses.length, 0);
    const bankCount = entities.reduce((n, e) => n + e.bankAccounts.length, 0);
    const expiring = entities.reduce(
      (n, e) => n + e.tradeLicenses.filter((l) => l.status === "expiring_soon" || l.status === "renewal_in_progress").length,
      0,
    );
    return { entities: entities.length, licCount, bankCount, expiring };
  }, [entities]);

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Overview"
          headline="Finance"
          lede="The CFO / Controller surface — entities, ledgers, FP&A, close, comply. Eight sections shaped around the standard finance operating model: record-to-report, order-to-cash, procure-to-pay, plan, comply."
        />
        <div className="mt-6 flex flex-wrap gap-3 text-xs font-mono text-text-mute">
          <MonoChip>{counts.entities} entit{counts.entities === 1 ? "y" : "ies"}</MonoChip>
          <MonoChip>{counts.licCount} licence(s)</MonoChip>
          <MonoChip tone={counts.expiring > 0 ? "amber" : "default"}>{counts.expiring} expiring / renewing</MonoChip>
          <MonoChip>{counts.bankCount} bank account(s)</MonoChip>
        </div>
      </PageHero>

      <div className="container-atelier py-10 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section>
            <SectionHead headline="Sections" />
            <div className="grid sm:grid-cols-2 gap-3 mt-3" data-testid="finance-section-ribbon">
              {SECTIONS.map((s) => (
                <Link key={s.id} href={s.href}>
                  <Card
                    className="p-4 hover:border-gold/40 transition-colors cursor-pointer h-full flex flex-col gap-2"
                    data-testid={`finance-section-${s.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <Eyebrow>{s.label}</Eyebrow>
                      <ArrowRight className="w-3.5 h-3.5 text-text-faint" />
                    </div>
                    <p className="text-sm text-text-mute leading-snug">{s.blurb}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section data-testid="finance-top-disbursements">
            <SectionHead headline="Top-5 expected disbursements" />
            <Card className="mt-3 p-3">
              {disbursements.length === 0 ? (
                <p className="text-sm text-text-mute">Nothing scheduled. The next payment run is empty.</p>
              ) : (
                <ul className="divide-y divide-border-soft">
                  {disbursements.map((d) => (
                    <li key={d.invoiceId} className="py-2 first:pt-0 last:pb-0">
                      <Link href="/finance/payables/payment-runs">
                        <div className="flex items-baseline justify-between gap-2 cursor-pointer hover:text-gold transition-colors">
                          <div className="min-w-0">
                            <div className="text-sm text-text font-medium truncate">{d.vendorName}</div>
                            <div className="text-[10px] font-mono text-text-faint uppercase tracking-widest">
                              {d.invoiceNumber} · due {d.dueDate}
                              {d.paymentRunNumber && ` · ${d.paymentRunNumber}`}
                            </div>
                          </div>
                          <span className="font-mono text-sm shrink-0">${d.amountUsd.toLocaleString()}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
          {stalled.length > 0 && (
            <section data-testid="finance-stalled-approvals">
              <SectionHead headline={`Stalled approvals (${stalled.length})`} />
              <Card className="mt-3 p-3 border-amber-500/40 bg-amber-500/5">
                <ul className="divide-y divide-border-soft">
                  {stalled.slice(0, 6).map((s) => (
                    <li key={s.id} className="py-2 first:pt-0 last:pb-0">
                      <Link href="/finance/payables/po">
                        <div className="flex items-baseline justify-between gap-2 cursor-pointer hover:text-gold transition-colors">
                          <div className="min-w-0">
                            <div className="text-sm text-text font-medium truncate">{s.vendorName} · {s.invoiceNumber}</div>
                            <div className="text-[10px] font-mono text-text-faint uppercase tracking-widest">
                              {s.kind === "po_mismatch" ? "match exception" : `stalled ${s.ageDays}d`} · {s.detail}
                            </div>
                          </div>
                          <span className="font-mono text-sm shrink-0">${s.amountUsd.toLocaleString()}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
          <section>
            <SectionHead headline="Next action for you" />
            <div className="space-y-2 mt-3" data-testid="finance-next-actions">
              {nextActions.length === 0 && (
                <Card className="p-4 text-sm text-text-mute">Nothing imminent. The board pack is due at the next period close.</Card>
              )}
              {nextActions.map((a) => (
                <Link key={a.id} href={a.href}>
                  <Card className={`p-3 cursor-pointer hover:border-gold/40 transition-colors ${toneClasses(a.tone)}`} data-testid={`finance-action-${a.id}`}>
                    <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-text-faint">
                      <span>{a.section}</span>
                      <span>{a.due}</span>
                    </div>
                    <div className="mt-1 text-sm text-text font-medium leading-tight">{a.title}</div>
                    <div className="text-xs text-text-mute mt-1">{a.detail}</div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
