/**
 * Atelier — pricing trend guidance (Task #435).
 *
 * Curated, static advisory content on consulting pricing-structure trends.
 * Served via GET /atelier/pricing/trends and fed to the Pricing Analyst
 * prompt as qualitative grounding. No live market feeds (out of scope) —
 * this is editorial content maintained with the codebase.
 */

export interface PricingTrendEntry {
  id: string;
  structure: string; // PricingStructureKind or "general"
  title: string;
  guidance: string;
  direction: "rising" | "stable" | "declining";
  bestFor: string[];
  watchouts: string[];
}

export const PRICING_TREND_GUIDANCE: PricingTrendEntry[] = [
  {
    id: "trend_outcome_shift",
    structure: "outcome_based",
    title: "Buyers pushing for outcome-linked fees",
    direction: "rising",
    guidance:
      "Enterprise buyers — especially in AI transformation — increasingly ask for fees tied to measurable outcomes. Firms that lead with a base+at-risk split (70/30) win against pure T&M competitors while protecting downside. Insist on a jointly-owned KPI baseline before signing; disputes about measurement are the #1 reason at-risk tranches go unpaid.",
    bestFor: ["Deals with a sponsor-owned, measurable KPI", "Competitive pursuits against larger firms"],
    watchouts: ["Never exceed 40% fee at risk without a countersign", "Outcome verification lag delays cash 4-8 weeks"],
  },
  {
    id: "trend_capped_tnm",
    structure: "capped_tnm",
    title: "Procurement defaults to capped T&M",
    direction: "rising",
    guidance:
      "Procurement teams treat capped T&M as 'fixed fee with honesty'. Caps at 110-115% of estimate are market standard; below 105% you are absorbing all delivery risk without fixed-fee pricing power. Pair any cap with a written change-control clause.",
    bestFor: ["Procurement-led buying committees", "Scope known but volatile in detail"],
    watchouts: ["Cap + scope creep = silent margin erosion", "Track burn weekly against the cap"],
  },
  {
    id: "trend_fixed_fee_installments",
    structure: "fixed_fee",
    title: "Front-loaded installments defend cash",
    direction: "stable",
    guidance:
      "Fixed fee remains the cleanest structure for well-scoped diagnostics and design phases. Market norm is shifting from 33/33/33 to 40/40/20 with mobilization invoiced at signature — protects cash and filters unserious buyers.",
    bestFor: ["Well-scoped 4-12 week phases", "New client relationships"],
    watchouts: ["Scope discipline is the margin lever — ring-fence out-of-scope asks"],
  },
  {
    id: "trend_milestone",
    structure: "milestone",
    title: "Milestone billing needs acceptance criteria",
    direction: "stable",
    guidance:
      "Milestone structures win with delivery-focused buyers but slip when acceptance criteria are vague. Define acceptance in the SOW per milestone, and cap the acceptance window (5-10 business days, deemed accepted after).",
    bestFor: ["Build/implementation engagements", "Multi-phase transformations"],
    watchouts: ["Client-side delay pushes cash right — model worst-case slippage"],
  },
  {
    id: "trend_retainer",
    structure: "retainer",
    title: "Advisory retainers compound relationships",
    direction: "rising",
    guidance:
      "Post-engagement retainers (advisory access + defined monthly capacity) are the highest-margin follow-on structure. Anchor at 15-25% of the preceding engagement's monthly run-rate. Invoice in advance; scope as capacity, not deliverables.",
    bestFor: ["Post-delivery relationship continuation", "Fractional leadership roles"],
    watchouts: ["Unbounded demand erodes the blend — define the monthly capacity ceiling"],
  },
  {
    id: "trend_hybrid",
    structure: "hybrid",
    title: "Base + success fee is the AI-deal default",
    direction: "rising",
    guidance:
      "For AI value-creation work, base+success hybrids (base covers cost + thin margin; success fee at 1.5-2x the at-risk tranche) let both sides share upside. Success fee should key on the same value case used in the proposal — never introduce a new metric at contracting.",
    bestFor: ["AI value-creation engagements with quantified value cases", "Deals where budget is capped but upside is real"],
    watchouts: ["Base fee must clear cost + overhead on its own in the worst case"],
  },
  {
    id: "trend_tnm",
    structure: "tnm",
    title: "Pure T&M losing ground except in staff-augmentation",
    direction: "declining",
    guidance:
      "Uncapped T&M is increasingly confined to staff-augmentation and open-ended discovery. It remains the right answer when scope is genuinely unknowable — but expect buyers to ask for a cap; pre-empt with a capped-T&M offer at 110%.",
    bestFor: ["Genuinely unscopeable discovery", "Staff augmentation"],
    watchouts: ["Signals low confidence in outcome pricing conversations"],
  },
  {
    id: "trend_rate_discipline",
    structure: "general",
    title: "Rate-card discipline beats discounting",
    direction: "stable",
    guidance:
      "Winning firms hold rate-card integrity and flex structure instead of rate. When pressured on price, change the structure (scope, blend, at-risk share) — never the day rates. Every discount anchored today reprices the relationship forever.",
    bestFor: ["All pursuits"],
    watchouts: ["Discounts compound across renewals — trade structure, not rate"],
  },
];
