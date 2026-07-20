/**
 * FinanceSectionRibbon — secondary navigation block (Task #413).
 *
 * Extracted from the previous FinanceHome (Task #372). The eight Finance
 * sections (Entities · Record · Bill & Collect · Pay · Close · Plan ·
 * Report · Comply) used to be the front door of the lens; in Wave 1 the
 * CFO dashboard takes that slot and this ribbon is rendered below it as a
 * secondary navigation block. Same routes, same blurbs — preserved
 * verbatim so deep-links keep resolving.
 */

import * as React from "react";
import { Link } from "wouter";
import { Card, Eyebrow, SectionHead } from "@/components/ui/primitives";
import { ArrowRight } from "lucide-react";

interface SectionTile { id: string; label: string; href: string; blurb: string; }

const SECTIONS: SectionTile[] = [
  { id: "entities", label: "Entities", href: "/finance/entities", blurb: "Legal entities, CR, tax IDs, e-invoicing, licences, banks, signatories." },
  { id: "ledger", label: "Record", href: "/finance/ledger", blurb: "Chart of accounts, journals, AR / AP / FA / inter-company sub-ledgers." },
  { id: "billing", label: "Bill & Collect", href: "/finance/billing", blurb: "Rate cards, e-invoice clearance, AR aging, dunning, cash app, rev-rec." },
  { id: "payables", label: "Pay", href: "/finance/payables", blurb: "Vendors, PO / non-PO, expenses, VAT / WHT, payment runs." },
  { id: "close", label: "Close", href: "/finance/close", blurb: "Period close checklist, reconciliations, adjusting entries, sign-offs." },
  { id: "plan", label: "Plan (FP&A)", href: "/finance/plan", blurb: "Budget, re-forecasts, 13-week cash, renewals, scenarios, long-range." },
  { id: "reports", label: "Report", href: "/finance/reports", blurb: "P&L · BS · CF, firm/engagement economics, margin & realization, board pack." },
  { id: "comply", label: "Comply", href: "/finance/comply", blurb: "Tax filings calendar, statutory accounts, transfer pricing, controls." },
];

export default function FinanceSectionRibbon() {
  return (
    <section className="container-atelier py-8 border-t border-border-soft">
      <SectionHead
        eyebrow="Navigate"
        headline="Finance sections"
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4" data-testid="finance-section-ribbon">
        {SECTIONS.map((s) => (
          <Link key={s.id} href={s.href}>
            <Card
              className="p-3 hover:border-gold/40 transition-colors cursor-pointer h-full flex flex-col gap-1.5"
              data-testid={`finance-section-${s.id}`}
            >
              <div className="flex items-center justify-between">
                <Eyebrow>{s.label}</Eyebrow>
                <ArrowRight className="w-3.5 h-3.5 text-text-faint" />
              </div>
              <p className="text-xs text-text-mute leading-snug">{s.blurb}</p>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
