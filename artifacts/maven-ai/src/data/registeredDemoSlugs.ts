// Single source of truth for which marketplace tools have a real interactive
// demo component mounted at /marketplace/:slug. Imported by:
//
//   - `pages/MarketplaceDetail.tsx` — asserts at module load that its DEMOS
//     dispatch map's keys exactly match this list, so adding a component to
//     DEMOS without registering its slug here (or vice versa) fails fast.
//   - `data/content.ts` — the catalogue validator uses this list to enforce
//     that every "live" marketplace tool has a registered demo and that no
//     orphan slug exists in the registry.
//
// Pure string constants so it can be safely imported from both sides without
// pulling in React or causing circular module evaluation.

export const REGISTERED_DEMO_SLUGS: readonly string[] = [
  "value-realization",
  "programme-war-room",
  "tender-response-studio",
  "procurement-negotiation-agent",
  "network-ops-war-room",
  "sama-compliance-sentinel",
  "citizen-services-concierge",
  "customer-care-hive",
  "sovereign-data-steward",
  "enterprise-knowledge-concierge",
  "arcelik-fiyat-istihbarati",
  "tasama-payroll-hub",
  "maven-personal-agent",
  "dge-catalogue-channel",
  "dge-complaint-recovery",
  "dge-effortless-qr",
  "dge-red-team",
  "dge-service-redesign",
  "dge-spokes-review",
] as const;

export const REGISTERED_DEMO_SLUG_SET: ReadonlySet<string> = new Set(
  REGISTERED_DEMO_SLUGS,
);
