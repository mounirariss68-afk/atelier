// Seed data for the /atelier/ip catalog (v5).

export const CODE_ASSETS = [
  { id: "ca_001", name: "atelier-agents (runner + lifecycle helper)", repoUrl: "github.com/aico/atelier-agents", owner: "Hamza R.", license: "AICo Internal", summary: "Shared lifecycle runner that every Atelier agent composes against.", usedInEngagements: ["eng_alpha", "eng_beta", "eng_arcelik"], freshness: "fresh" as const },
  { id: "ca_002", name: "comms-indexer", repoUrl: "github.com/aico/comms-indexer", owner: "Yusuf Ç.", license: "AICo Internal", summary: "Mail / IM corpus indexer used by Pursuit Scout, DSAR Concierge, and Theme Curator.", usedInEngagements: ["eng_alpha", "eng_gamma"], freshness: "fresh" as const },
  { id: "ca_003", name: "pricing-sandbox (margin + bundle simulator)", repoUrl: "github.com/aico/pricing-sandbox", owner: "Aisha M.", license: "AICo Internal", summary: "Standalone simulator the Pricing Strategist composes against. Reused on Arçelik demo.", usedInEngagements: ["eng_arcelik", "eng_delta"], freshness: "stale" as const },
  { id: "ca_004", name: "audit-pdf", repoUrl: "github.com/aico/audit-pdf", owner: "Yusuf Ç.", license: "MIT (open-sourced)", summary: "PDF generator for engagement audit packs. Open-sourced 2025-Q4.", usedInEngagements: ["eng_alpha", "eng_beta", "eng_gamma", "eng_delta"], freshness: "fresh" as const },
  { id: "ca_005", name: "winloss-clusterer", repoUrl: "github.com/aico/winloss-clusterer", owner: "Mounir", license: "AICo Internal", summary: "Theme Curator's clustering primitive over win/loss debriefs.", usedInEngagements: [], freshness: "stale" as const },
];

export const OSS_DEPENDENCIES = [
  { id: "od_001", name: "react", version: "19.0.0", ecosystem: "npm", license: "MIT", compatibility: "ok" as const, repos: ["atelier", "maven-ai"], rationale: null, exceptionUntil: null },
  { id: "od_002", name: "drizzle-orm", version: "0.40.0", ecosystem: "npm", license: "Apache-2.0", compatibility: "ok" as const, repos: ["api-server"], rationale: null, exceptionUntil: null },
  { id: "od_003", name: "marked", version: "12.0.2", ecosystem: "npm", license: "MIT", compatibility: "ok" as const, repos: ["api-server"], rationale: null, exceptionUntil: null },
  { id: "od_004", name: "node-postgres", version: "8.11.0", ecosystem: "npm", license: "MIT", compatibility: "ok" as const, repos: ["api-server"], rationale: null, exceptionUntil: null },
  { id: "od_005", name: "nice-pkg-with-gpl", version: "1.4.2", ecosystem: "npm", license: "GPL-3.0", compatibility: "block" as const, repos: ["pricing-sandbox"], rationale: "Strong copyleft incompatible with proprietary client deliverable scope.", exceptionUntil: null },
  { id: "od_006", name: "icu4c-bindings", version: "0.7.1", ecosystem: "npm", license: "Unknown", compatibility: "block" as const, repos: ["atelier"], rationale: "License classification missing — pending vendor response.", exceptionUntil: null },
  { id: "od_007", name: "weak-copyleft-lib", version: "2.0.0", ecosystem: "npm", license: "MPL-2.0", compatibility: "warn" as const, repos: ["audit-pdf"], rationale: "Permitted with notice — notice block needs to be added to release.", exceptionUntil: "2026-08-01" },
];

export const DEMO_ENVIRONMENTS = [
  { id: "de_001", name: "Arçelik · Pricing Intelligence", url: "demo.aico.com/arcelik", owner: "Aisha M.", lastDeployAt: "2026-05-10", shows: "Margin simulator, bundle optimiser, dealer portal — full demo path.", uptime30d: 0.998, scriptDrift: 0, freshness: "fresh" as const },
  { id: "de_002", name: "Atelier · Employee Portal", url: "demo.aico.com/atelier", owner: "Hamza R.", lastDeployAt: "2026-05-13", shows: "Full-firm Atelier walkthrough including v4 Comms Indexer.", uptime30d: 0.991, scriptDrift: 1, freshness: "fresh" as const },
  { id: "de_003", name: "Maven AI · public marketing", url: "maven.ai", owner: "Mounir", lastDeployAt: "2026-04-22", shows: "Public-facing brand site with case index.", uptime30d: 1.0, scriptDrift: 0, freshness: "fresh" as const },
  { id: "de_004", name: "Pricing Strategist · standalone POV", url: "demo.aico.com/pricing-pov", owner: "Aisha M.", lastDeployAt: "2026-02-18", shows: "Pricing Strategist agent in isolation with sample mandate.", uptime30d: 0.967, scriptDrift: 3, freshness: "stale" as const },
  { id: "de_005", name: "Win-Loss Library · sample", url: "demo.aico.com/winloss-sample", owner: "Mounir", lastDeployAt: "2025-11-04", shows: "Win-Loss debrief flow with 6 sample debriefs.", uptime30d: 0.882, scriptDrift: 5, freshness: "broken" as const },
];

export const IP_LICENSE_GRANTS = [
  { id: "ig_001", assetName: "atelier-agents (runner)", grantee: "Arçelik", engagementId: "eng_arcelik", grantedAt: "2026-03-12", expiresAt: "2027-03-12", scope: "Internal use within Arçelik for the duration of the engagement; no redistribution.", approvedBy: "Mounir", status: "active" as const },
  { id: "ig_002", assetName: "pricing-sandbox", grantee: "Arçelik", engagementId: "eng_arcelik", grantedAt: "2026-03-12", expiresAt: "2026-09-12", scope: "Single-tenant deployment; source escrow on engagement end.", approvedBy: "Mounir", status: "expiring" as const },
  { id: "ig_003", assetName: "comms-indexer", grantee: "GCC sovereign fund (engagement alpha)", engagementId: "eng_alpha", grantedAt: "2025-09-04", expiresAt: "2026-09-04", scope: "Internal use within engagement scope; no third-party access.", approvedBy: "Gökhan", status: "expiring" as const },
  { id: "ig_004", assetName: "audit-pdf", grantee: "Open source · MIT", engagementId: "—", grantedAt: "2025-11-15", expiresAt: "perpetual", scope: "MIT release; firm retains copyright on reference brand assets used in templates.", approvedBy: "Mounir", status: "active" as const },
];
