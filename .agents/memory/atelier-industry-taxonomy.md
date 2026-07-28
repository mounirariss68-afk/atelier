---
name: Account industry taxonomy resolver & ownership edits
description: Rules for writing account industry codes and for editing ownership fields via the generic account PATCH.
---

**Rule (industry):** Every path that persists an account industry (post-create Cartographer auto-run, reviewed-research create, refresh proposal builder AND its approval applier) must go through the shared taxonomy resolver in the atelier-agents lib. It maps Cognirise codes, display labels, and legacy NAICS 2-digit prefixes to the 9-code taxonomy; unmappable input returns null and the caller skips the write / emits no proposal — never store a raw NAICS code.

**Why:** The agent prompt historically asked for NAICS-style codes; some persistence paths dropped them and others would have leaked raw codes into the column. The prompt now lists the Cognirise codes, but the deterministic resolver is the safety net (the proposal applier re-resolves so an edited/stale proposal cannot bypass it).

**How to apply:** Any new research/persistence surface touching `industryCode`/`subIndustryCode` must call the resolver. The auto-run only fills when the account's industry is still null (never clobbers a reviewed classification).

**Rule (ownership edits):** The generic account PATCH accepts partner owner/tier/status/HQ/currency/language, gated by the account-create roles + `canSeeAccount`; partner owner must resolve to a partner-tier user in-org. The status enum excludes "archived", AND archived accounts reject all ownership edits with 409 — archive/restore lifecycle routes are the only way in or out of archived state (a plain status PATCH must never silently restore). Ownership changes go into the audit `changes` array but deliberately stay out of the firmographic-history label map so the Company-Details "Recent changes" card remains firmographics-only.

Probe: `pnpm --filter @workspace/api-server run test:ownership-industry`.
