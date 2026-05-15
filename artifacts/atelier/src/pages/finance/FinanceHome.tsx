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
  useStatutoryFilings,
  useInsurancePolicies,
  useInternalControls,
  useCash13w,
  useBacklogCoverage,
  type FinanceEntityRow,
  type StatutoryFilingRow,
  type InsurancePolicyRow,
  type InternalControlRow,
} from "@/lib/v5-hooks";
import { ArrowRight } from "lucide-react";

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `USD ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `USD ${(abs / 1_000).toFixed(0)}k`;
  return `USD ${abs.toFixed(0)}`;
}

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

// Quarterly cadence approximated as 90d, monthly as 30d, etc. — used to
// flag a control as overdue if it hasn't been re-tested within its
// declared cadence window. Per-transaction controls are continuous and
// surface only via their open exceptions.
const CADENCE_DAYS: Record<InternalControlRow["frequency"], number | null> = {
  per_transaction: null,
  daily: 1,
  monthly: 30,
  quarterly: 90,
  annual: 365,
};

function buildNextActions(
  entities: FinanceEntityRow[],
  filings: StatutoryFilingRow[],
  insurance: InsurancePolicyRow[],
  controls: InternalControlRow[],
): NextAction[] {
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

  // Statutory filings — surface anything not yet filed and either overdue
  // or due within 60 days. The Comply register is authoritative; the home
  // page just promotes the most-imminent items into the inbox.
  for (const f of filings) {
    if (f.status === "filed") continue;
    const d = daysUntil(f.dueOn);
    if (d > 60) continue;
    const ent = entities.find((e) => e.id === f.entityId);
    out.push({
      id: `stat-${f.id}`,
      section: "Comply",
      href: "/finance/comply/statutory",
      title: `${f.kind} — ${ent?.shortName ?? f.entityId}`,
      detail: `${f.authority} · owner ${f.owner}`,
      due: `${f.dueOn} (${fmtRelative(d)})`,
      tone: d < 0 ? "red" : d <= 14 ? "amber" : d <= 30 ? "gold" : "default",
      daysOut: d,
    });
  }

  // Insurance — anything expired or expiring within 60 days.
  for (const p of insurance) {
    const d = daysUntil(p.periodTo);
    if (d > 60 && p.status !== "expired") continue;
    const ent = entities.find((e) => e.id === p.entityId);
    out.push({
      id: `ins-${p.id}`,
      section: "Comply",
      href: "/finance/comply/insurance",
      title: `${p.kind} renewal — ${ent?.shortName ?? p.entityId}`,
      detail: `${p.insurer} · ${p.policyNumber}`,
      due: `${p.periodTo} (${fmtRelative(d)})`,
      tone: p.status === "expired" || d < 0 ? "red" : d <= 14 ? "amber" : d <= 30 ? "gold" : "default",
      daysOut: d,
    });
  }

  // Internal controls — produce an action for any control with open
  // exceptions, and for any cadence-based control that has slipped past
  // its declared evidence window. Per-transaction controls have no
  // declared window and surface only via open exceptions.
  for (const c of controls) {
    if (c.exceptionsOpen > 0) {
      out.push({
        id: `ctl-exc-${c.id}`,
        section: "Comply",
        href: "/finance/comply/controls",
        title: `Control exception — ${c.title}`,
        detail: `${c.exceptionsOpen} open · owner ${c.owner}`,
        due: `since ${c.lastTestedOn}`,
        tone: "amber",
        daysOut: -1,
      });
    }
    const window = CADENCE_DAYS[c.frequency];
    if (window != null) {
      const sinceTested = daysUntil(c.lastTestedOn) * -1;
      const overdueBy = sinceTested - window;
      if (overdueBy > 0) {
        out.push({
          id: `ctl-evd-${c.id}`,
          section: "Comply",
          href: "/finance/comply/controls",
          title: `Control evidence due — ${c.title}`,
          detail: `${c.frequency.replace("_", " ")} cadence · last tested ${c.lastTestedOn}`,
          due: `${overdueBy}d past cadence`,
          tone: overdueBy > 30 ? "red" : "amber",
          daysOut: -overdueBy,
        });
      }
    }
  }

  out.sort((a, b) => a.daysOut - b.daysOut);
  return out.slice(0, 8);
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
  const filings = useStatutoryFilings();
  const insurance = useInsurancePolicies();
  const controls = useInternalControls();
  const nextActions = React.useMemo(
    () => buildNextActions(entities, filings, insurance, controls),
    [entities, filings, insurance, controls],
  );
  const { data: cash } = useCash13w("USD", null);
  const { data: backlog } = useBacklogCoverage("USD", null);

  const counts = React.useMemo(() => {
    const licCount = entities.reduce((n, e) => n + e.tradeLicenses.length, 0);
    const bankCount = entities.reduce((n, e) => n + e.bankAccounts.length, 0);
    const expiring = entities.reduce(
      (n, e) => n + e.tradeLicenses.filter((l) => l.status === "expiring_soon" || l.status === "renewal_in_progress").length,
      0,
    );
    const statOpen = filings.filter((f) => f.status !== "filed").length;
    const insExpired = insurance.filter((p) => p.status === "expired").length;
    const ctlExceptions = controls.reduce((n, c) => n + c.exceptionsOpen, 0);
    return { entities: entities.length, licCount, bankCount, expiring, statOpen, insExpired, ctlExceptions };
  }, [entities, filings, insurance, controls]);

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
          <MonoChip tone={counts.statOpen > 0 ? "amber" : "default"}>{counts.statOpen} statutory open</MonoChip>
          <MonoChip tone={counts.insExpired > 0 ? "red" : "default"}>{counts.insExpired} insurance expired</MonoChip>
          <MonoChip tone={counts.ctlExceptions > 0 ? "amber" : "green"}>{counts.ctlExceptions} control exception(s)</MonoChip>
        </div>
      </PageHero>

      <div className="container-atelier py-10 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section data-testid="finance-plan-kpis">
            <SectionHead headline="Plan — at a glance" />
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              <Link href="/finance/plan/cash-13w">
                <Card className={`p-4 cursor-pointer hover:border-gold/40 transition-colors h-full ${cash && cash.breaches.length > 0 ? "border-danger/40 bg-danger/5" : ""}`} data-testid="kpi-tile-days-of-cash">
                  <Eyebrow>Days of cash</Eyebrow>
                  <div className="text-3xl font-display mt-1">{cash ? cash.daysOfCash : "—"}</div>
                  <div className="text-xs text-text-mute mt-1">
                    Opening {cash ? fmtUsd(cash.openingBalance) : "—"} · {cash ? `${cash.breaches.length} cash gap${cash.breaches.length === 1 ? "" : "s"}` : "loading…"}
                  </div>
                </Card>
              </Link>
              <Link href="/finance/plan/cash-13w">
                <Card className="p-4 cursor-pointer hover:border-gold/40 transition-colors h-full" data-testid="kpi-tile-receipts-13w">
                  <Eyebrow>Receipts (13w)</Eyebrow>
                  <div className="text-3xl font-display mt-1 text-success">{cash ? fmtUsd(cash.totalIn) : "—"}</div>
                  <div className="text-xs text-text-mute mt-1">vs. {cash ? fmtUsd(cash.totalOut) : "—"} disbursements</div>
                </Card>
              </Link>
              <Link href="/finance/plan/backlog">
                <Card className="p-4 cursor-pointer hover:border-gold/40 transition-colors h-full" data-testid="kpi-tile-backlog-months">
                  <Eyebrow>Backlog coverage</Eyebrow>
                  <div className="text-3xl font-display mt-1">{backlog ? `${backlog.totals.backlogCoverageMonths.toFixed(1)} mo` : "—"}</div>
                  <div className="text-xs text-text-mute mt-1">Signed backlog {backlog ? fmtUsd(backlog.totals.backlogUsd) : "—"}</div>
                </Card>
              </Link>
              <Link href="/finance/plan/backlog">
                <Card className={`p-4 cursor-pointer hover:border-gold/40 transition-colors h-full ${backlog && backlog.totals.coverageRatio < backlog.targetCoverage ? "border-amber-500/40 bg-amber-500/5" : ""}`} data-testid="kpi-tile-coverage-ratio">
                  <Eyebrow>Plan coverage</Eyebrow>
                  <div className="text-3xl font-display mt-1">{backlog ? `${backlog.totals.coverageRatio.toFixed(2)}×` : "—"}</div>
                  <div className="text-xs text-text-mute mt-1">
                    Target {backlog ? `${backlog.targetCoverage.toFixed(1)}×` : "—"} · weighted pipeline {backlog ? fmtUsd(backlog.totals.weightedPipelineUsd) : "—"}
                  </div>
                </Card>
              </Link>
            </div>
            {cash && (cash.topReceipts.length > 0 || cash.topDisbursements.length > 0) && (
              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <Card className="p-3" data-testid="kpi-top-receipts">
                  <div className="text-[11px] font-mono uppercase text-text-faint mb-2">Top expected receipts</div>
                  <ul className="space-y-1.5 text-sm">
                    {cash.topReceipts.slice(0, 3).map((l) => (
                      <li key={l.id} className="flex items-baseline justify-between gap-2">
                        <span className="text-text truncate">{l.label}</span>
                        <span className="font-mono text-success whitespace-nowrap">{fmtUsd(l.amountInPresentation)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card className="p-3" data-testid="kpi-top-disbursements">
                  <div className="text-[11px] font-mono uppercase text-text-faint mb-2">Top expected disbursements</div>
                  <ul className="space-y-1.5 text-sm">
                    {cash.topDisbursements.slice(0, 3).map((l) => (
                      <li key={l.id} className="flex items-baseline justify-between gap-2">
                        <span className="text-text truncate">{l.label}</span>
                        <span className="font-mono text-warning whitespace-nowrap">−{fmtUsd(l.amountInPresentation).replace("-", "")}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            )}
          </section>

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
