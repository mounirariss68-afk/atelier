/**
 * ClientsStages — thin per-stage wrapper pages for the Clients lens
 * (Task #369). Each page composes the existing commercial-loop component
 * (no functional rebuild) and adds the lifecycle ribbon at the top so
 * the user always knows which stage they're in.
 *
 * Stage routes:
 *   /clients/prospect  → Crm (accounts target list)
 *   /clients/pursue    → Pipeline (opportunities + forecast)
 *   /clients/win       → WinLossLibrary (debriefs intake view)
 *   /clients/deliver   → Engagements (active engagements list)
 *   /clients/bill      → Bill placeholder + Finance handoff
 *   /clients/renew     → Renewals view (filtered Pipeline)
 *   /clients/reference → WinLossLibrary (themes / reference library)
 *
 * Engagement workspace re-mount under `/clients/deliver/engagements/:id`
 * is deferred per the task's sequencing note (waits for L2C Wave 1, #360).
 * Until then the existing `/engagements/:engId` route stays canonical and
 * `/clients/deliver` links to it directly.
 */

import { Link, useLocation } from "wouter";
import { ArrowRight, FileText, ExternalLink } from "lucide-react";
import { CLIENT_LIFECYCLE_STAGES, type ClientStageId } from "@/lib/client-lifecycle";
import { Card, MonoChip, PageHero, SectionHead, Eyebrow } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import Crm from "@/pages/Crm";
import Pipeline from "@/pages/Pipeline";
import Engagements from "@/pages/Engagements";
import WinLossLibrary from "@/pages/WinLossLibrary";

function LifecycleRibbon({ active }: { active: ClientStageId }) {
  const [location] = useLocation();
  return (
    <div
      className="container-atelier pt-6"
      data-testid="clients-lifecycle-ribbon"
    >
      <div className="flex flex-wrap items-center gap-1.5 border border-border-soft rounded-md bg-bg-elevate/40 p-1.5">
        {CLIENT_LIFECYCLE_STAGES.map((s, i) => {
          const isActive =
            s.id === active ||
            location === s.href ||
            location.startsWith(s.href + "/");
          return (
            <Link
              key={s.id}
              href={s.href}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-widest transition-colors",
                isActive
                  ? "bg-bg-deep text-gold"
                  : "text-text-mute hover:text-text",
              )}
              data-testid={`clients-ribbon-${s.id}`}
            >
              <span className="tabular-nums text-text-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              {s.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function StageShell({
  stage,
  children,
}: {
  stage: ClientStageId;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-in fade-in">
      <LifecycleRibbon active={stage} />
      {children}
    </div>
  );
}

export function ClientsProspect() {
  return (
    <StageShell stage="prospect">
      <Crm />
    </StageShell>
  );
}

export function ClientsPursue() {
  return (
    <StageShell stage="pursue">
      <Pipeline />
    </StageShell>
  );
}

/**
 * `/clients/win` re-homes the Win/Loss intake surface — the debrief
 * library is the workbench for late-stage closes (signed / lost /
 * withdrawn). We default the WinLossLibrary to its `debriefs` view here
 * (intake-first); the curated themes library lives at /clients/reference.
 */
export function ClientsWin() {
  return (
    <StageShell stage="win">
      <WinLossLibrary defaultView="debriefs" />
    </StageShell>
  );
}

export function ClientsDeliver() {
  return (
    <StageShell stage="deliver">
      <Engagements />
    </StageShell>
  );
}

/**
 * `/clients/bill` is intentionally a read-only commercial summary — the
 * full billing workflow lives in the Finance lens (Bill & Collect). We
 * surface the engagement economics entry points and a deep-link into
 * Finance so users don't bounce hunting for it.
 */
export function ClientsBill() {
  return (
    <StageShell stage="bill">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Clients · Bill"
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
            href="/clients/deliver"
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
    </StageShell>
  );
}

/**
 * `/clients/renew` overlaps Opportunities filtered to renewals + account
 * expansion plays. Until a dedicated renewal-type field lands on opps we
 * scope this to accounts with active engagements (the live renewal pool)
 * and link into the pursue pipeline for the hands-on work.
 */
export function ClientsRenew() {
  return (
    <StageShell stage="renew">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Clients · Renew"
          headline="Renewals & expansion"
          lede="The accounts whose contracts are live — renewals, expansion plays, and the next conversation."
        />
      </PageHero>
      <div className="container-atelier py-10 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <Eyebrow>Renewals pipeline</Eyebrow>
          <p className="text-sm text-text-mute leading-snug">
            Renewal-type opportunities live in the main pipeline. Use the
            stage / owner filters to scope to renewals.
          </p>
          <Link
            href="/clients/pursue"
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
          >
            Open pipeline <ArrowRight className="w-3 h-3" />
          </Link>
        </Card>
        <Card className="p-5 space-y-3">
          <Eyebrow>Account expansion</Eyebrow>
          <p className="text-sm text-text-mute leading-snug">
            Whitespace and QBR plays live on each account workspace.
          </p>
          <Link
            href="/clients/prospect"
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
          >
            Browse accounts <ArrowRight className="w-3 h-3" />
          </Link>
        </Card>
      </div>
    </StageShell>
  );
}

/**
 * `/clients/reference` re-homes the Win/Loss themes library + reference
 * accounts pool. Press is firm-wide IP and stays under the Firm submenu.
 */
export function ClientsReference() {
  return (
    <StageShell stage="reference">
      <WinLossLibrary />
    </StageShell>
  );
}
