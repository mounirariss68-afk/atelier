---
name: Account-module chat capability gating
description: Why new account.* chat capabilities need requiredRoles, and the ACL-filtered account resolution pattern.
---

**Rule:** A new `module: "account"` chat capability is NOT hidden from restricted personas by default — `RESTRICTED_DENIED_MODULES` does not include "account", so partner_firm_resource / recruiter would see it in their catalog slice. Declare `requiredRoles` (partner-side roles) AND keep an in-run `isRestrictedPersona`/`isBoardObserver` guard (defense in depth).

**Why:** account.brief (Task-era work) initially leaked into PFR/recruiter slices in the gating probe; only self-only, board_observer and alliance_partner are structurally excluded by `capabilitiesForPersona`.

**How to apply:** any new CRM-read chat tool: (1) `requiredRoles` list, (2) in-run role guard, (3) resolve account names with an ACL-filtered resolver — org-scoped ilike, then `canSeeAccount` filter BEFORE capping to 5 disambiguation options (`resolveAccount` in resolvers/index.ts now ACL-filters via canSeeAccount, closing the gap that existed for account_dossier and other callers), (4) re-check `canSeeAccount` on fetch.

Also: `distillBriefView()` watchOuts legitimately contain objection/failure-scenario *text* — the balanced-view invariant is that raw `stressTest` structure/keys never cross, not the words. Test with key checks (`"stressTest"`, `"failureScenarios"`), not value sentinels.
