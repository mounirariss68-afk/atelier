/**
 * ClientsHome — lifecycle ribbon home for the Clients lens (Task #369).
 *
 * Seven stages: Prospect → Pursue → Win → Deliver → Bill → Renew → Reference.
 * Each tile shows a live count derived from existing hooks and a deep-link
 * into that stage's page. The "next action for you" line is keyed off the
 * shape of the underlying data (stalled opps, RAID-red engagements, etc.)
 * so it stays useful without standing up new state.
 */

import { Link } from "wouter";
import {
  useAtelierListAccounts,
  useAtelierListOpportunities,
  useAtelierListEngagements,
  type SalesStage,
} from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, Eyebrow } from "@/components/ui/primitives";
import { ArrowRight } from "lucide-react";
import { CLIENT_LIFECYCLE_STAGES, type ClientStageId } from "@/lib/client-lifecycle";

interface StageTile {
  id: ClientStageId;
  label: string;
  href: string;
  blurb: string;
  count: number;
  countCaption: string;
  nextAction: string;
}

export default function ClientsHome() {
  const { data: accounts } = useAtelierListAccounts();
  const { data: opps } = useAtelierListOpportunities();
  const { data: engs } = useAtelierListEngagements();

  const accountList = accounts ?? [];
  const oppList = opps ?? [];
  const engList = engs ?? [];

  // Prospect — Tier A/B accounts are the live target list.
  const targetAccounts = accountList.filter((a) => a.tier === "A" || a.tier === "B");
  const dormantTierC = accountList.filter((a) => a.tier === "C").length;

  // Pursue — open / working-stage opps.
  const pursueStages: SalesStage[] = ["suspect", "prospect", "convert"];
  const pursueOpps = oppList.filter((o) => {
    const s = (o as { salesStage?: SalesStage }).salesStage ?? "suspect";
    return pursueStages.includes(s);
  });
  const stalledPursue = pursueOpps.filter(
    (o) => (o as { stalled?: boolean }).stalled || o.daysInStage > 21,
  ).length;

  // Win — runner / contract (verbal-yes through signed-not-mobilised).
  const winStages: SalesStage[] = ["runner", "contract"];
  const winOpps = oppList.filter((o) => {
    const s = (o as { salesStage?: SalesStage }).salesStage ?? "suspect";
    return winStages.includes(s);
  });

  // Deliver — active engagements.
  const deliverEngs = engList;
  const raidRed = engList.filter((e) => e.raidStatus === "red").length;
  const dueThisWeek = engList.reduce(
    (sum, e) => sum + (e.deliverablesDueThisWeek ?? 0),
    0,
  );

  // Bill — engagements with WIP / billable activity. Count is the same
  // engagement set; the action lives in Finance → Bill & Collect.
  const billEngs = engList.length;

  // Renew — opps tagged renewal/expansion. Until a dedicated flag exists
  // we approximate with closing-soon opps in winStages and accounts with
  // active engagements (renewal candidates).
  const renewCandidates = accountList.filter((a) => (a.activeEngagementCount ?? 0) > 0).length;

  // Reference — Tier A accounts double as live reference pool until a
  // dedicated reference-status field lands.
  const referenceAccounts = accountList.filter((a) => a.tier === "A").length;

  const tiles: StageTile[] = [
    {
      id: "prospect",
      label: "Prospect",
      href: "/clients/prospect",
      blurb: "Target list & account intelligence.",
      count: targetAccounts.length,
      countCaption: targetAccounts.length === 1 ? "tier A/B account" : "tier A/B accounts",
      nextAction:
        dormantTierC > 0
          ? `Refresh ${dormantTierC} watch-list account${dormantTierC === 1 ? "" : "s"}`
          : "Scout new logos to add to the target list",
    },
    {
      id: "pursue",
      label: "Pursue",
      href: "/clients/pursue",
      blurb: "Opportunities pipeline & qualifiers.",
      count: pursueOpps.length,
      countCaption: pursueOpps.length === 1 ? "open opp" : "open opps",
      nextAction:
        stalledPursue > 0
          ? `Unstick ${stalledPursue} stalled opp${stalledPursue === 1 ? "" : "s"}`
          : "Move the next qualifier forward",
    },
    {
      id: "win",
      label: "Win",
      href: "/clients/win",
      blurb: "Stage transitions, proposals, win/loss intake.",
      count: winOpps.length,
      countCaption: winOpps.length === 1 ? "in runner/contract" : "in runner/contract",
      nextAction:
        winOpps.length > 0
          ? "Lock the next signature or log a debrief"
          : "Nothing in the late stages right now",
    },
    {
      id: "deliver",
      label: "Deliver",
      href: "/clients/deliver",
      blurb: "Engagements, deliverables, change orders.",
      count: deliverEngs.length,
      countCaption: deliverEngs.length === 1 ? "active engagement" : "active engagements",
      nextAction:
        raidRed > 0
          ? `Address ${raidRed} RAID-red engagement${raidRed === 1 ? "" : "s"}`
          : dueThisWeek > 0
            ? `${dueThisWeek} deliverable${dueThisWeek === 1 ? "" : "s"} due this week`
            : "Delivery is on track",
    },
    {
      id: "bill",
      label: "Bill",
      href: "/clients/bill",
      blurb: "Engagement economics — billing lives in Finance.",
      count: billEngs,
      countCaption: billEngs === 1 ? "engagement on the meter" : "engagements on the meter",
      nextAction: "Review margin & WIP, then send invoices in Finance",
    },
    {
      id: "renew",
      label: "Renew",
      href: "/clients/renew",
      blurb: "Renewals pipeline & account expansion plays.",
      count: renewCandidates,
      countCaption: renewCandidates === 1 ? "live account to renew" : "live accounts to renew",
      nextAction:
        renewCandidates > 0
          ? "Schedule the next renewal conversation"
          : "No live engagements yet",
    },
    {
      id: "reference",
      label: "Reference",
      href: "/clients/reference",
      blurb: "Win/Loss themes library & reference accounts.",
      count: referenceAccounts,
      countCaption: referenceAccounts === 1 ? "tier-A reference" : "tier-A references",
      nextAction: "Curate themes & match references to live pursuits",
    },
  ];

  // Sanity: keep tiles aligned with the canonical lifecycle order.
  // (Prevents accidental re-ordering drift between the home and the ribbon.)
  const ordered = CLIENT_LIFECYCLE_STAGES.map(
    (s) => tiles.find((t) => t.id === s.id)!,
  );

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Clients"
          headline="Client lifecycle"
          lede="Prospect → Pursue → Win → Deliver → Bill → Renew → Reference. Pick a stage to drop into the work that lives there."
        />
      </PageHero>

      <div className="container-atelier py-10 space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ordered.map((t, idx) => (
            <Link
              key={t.id}
              href={t.href}
              className="block group"
              data-testid={`clients-stage-tile-${t.id}`}
            >
              <Card
                hover
                className="p-4 h-full flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <Eyebrow>
                    <span className="tabular-nums text-text-faint">
                      {String(idx + 1).padStart(2, "0")}
                    </span>{" "}
                    · {t.label}
                  </Eyebrow>
                  <ArrowRight className="w-3.5 h-3.5 text-text-faint group-hover:text-gold transition-colors" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-light text-text">{t.count}</span>
                  <span className="text-[11px] font-mono text-text-faint">{t.countCaption}</span>
                </div>
                <p className="text-xs text-text-mute leading-snug">{t.blurb}</p>
                <div className="mt-auto pt-3 border-t border-border-soft">
                  <MonoChip>Next · {t.nextAction}</MonoChip>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
