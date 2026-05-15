/**
 * ClientsStages — per-section wrapper pages for the Clients lens.
 *
 * Section routes (flat IA — see `client-lifecycle.ts`):
 *   /clients/accounts       → Crm (accounts target list & intelligence)
 *   /clients/opportunities  → Pipeline (opps + forecast)
 *   /clients/engagements    → Engagements (active engagements list)
 *   /clients/billing        → Billing summary + Finance handoff
 *   /clients/references     → WinLossLibrary (themes & reference accounts)
 *
 * Each wrapper composes the existing surface (no functional rebuild) so
 * the lens shell can re-home commercial-loop work without forking pages.
 */

import { Link } from "wouter";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Card, MonoChip, PageHero, SectionHead, Eyebrow } from "@/components/ui/primitives";
import Crm from "@/pages/Crm";
import Pipeline from "@/pages/Pipeline";
import Engagements from "@/pages/Engagements";
import WinLossLibrary from "@/pages/WinLossLibrary";

export function ClientsAccounts() {
  return (
    <div className="animate-in fade-in">
      <Crm />
    </div>
  );
}

export function ClientsOpportunities() {
  return (
    <div className="animate-in fade-in">
      <Pipeline />
    </div>
  );
}

export function ClientsEngagements() {
  return (
    <div className="animate-in fade-in">
      <Engagements />
    </div>
  );
}

/**
 * `/clients/billing` is a read-only commercial summary — the full
 * bill-and-collect workflow lives in the Finance lens. We surface the
 * engagement-economics entry points and deep-link into Finance so users
 * don't bounce hunting for them.
 */
export function ClientsBilling() {
  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Clients · Billing"
          headline="Engagement economics"
          lede="The commercial view of in-flight engagements — margin, WIP, billable. The full bill-and-collect workflow lives in the Finance lens."
        />
      </PageHero>
      <div className="container-atelier py-10 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <Eyebrow>Engagement economics</Eyebrow>
          <p className="text-sm text-text-mute leading-snug">
            Per-engagement margin, WIP and burn-down. Open an engagement to
            review its economics tab.
          </p>
          <Link
            href="/clients/engagements"
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
          >
            Open engagements <ArrowRight className="w-3 h-3" />
          </Link>
        </Card>
        <Card className="p-5 space-y-3">
          <Eyebrow>Finance · Bill & Collect</Eyebrow>
          <p className="text-sm text-text-mute leading-snug">
            Invoicing, AR, collections. Lives in the Finance lens.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/wallet/invoices"
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
            >
              Invoices <ExternalLink className="w-3 h-3" />
            </Link>
            <Link
              href="/wallet/ar"
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
            >
              AR <ExternalLink className="w-3 h-3" />
            </Link>
            <Link
              href="/wallet/wip"
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
            >
              WIP <ExternalLink className="w-3 h-3" />
            </Link>
            <Link
              href="/wallet/margin"
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
            >
              Margin <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </Card>
      </div>
      <div className="container-atelier pb-10">
        <MonoChip>Tip — filter Opportunities by deal type to see renewals & expansions</MonoChip>
      </div>
    </div>
  );
}

export function ClientsReferences() {
  return (
    <div className="animate-in fade-in">
      <WinLossLibrary />
    </div>
  );
}
