---
name: Non-Equity Partner scoped access
description: How NEP (non_equity_partner) visibility works — grants, opp invites, chat clamps — and where new surfaces must hook in.
---

# Non-Equity Partner (NEP) scoped access

NEPs are roster CONTRACTORS (never employees / no new worker type) with a `non_equity_partner` login persona. Their CRM world is deliberately tiny.

**The rule:** every account/opportunity surface an NEP touches must resolve through the shared helpers in `src/lib/atelier-nep-access.ts` (`nepAccessFor`, `nepCanSeeAccountId`, `nepCanSeeOpportunity`) — never inline visibility logic. Access = accounts they OWN (partnerOwnerId) + explicit grants (`atelier_nep_account_grants`) + invited opportunities (`atelier_nep_opp_invites`, which also give a READ-ONLY view of the parent account). Grants/invites are soft-revoked (revokedAt) and take effect on the next request.

**Why:** NEP compensation depends on origination attribution and their view must never leak firm pipeline/finance/roster; duplicated checks drift.

**How to apply:**
- `canSeeAccount()` in accountRoutes has the NEP branch FIRST (never falls through to engagement grants) — new account surfaces that use it are covered automatically.
- The central gate in routes/atelier/index.ts has an NEP branch BEFORE the contractor branch (allowlist: /me*, /cli*, /accounts*, /opportunities*); adding NEP-reachable route families means extending that branch.
- Account/opportunity CREATE by an NEP clamps owner to self; origination (`originatedByUserId/At`) is stamped for EVERY creator at account create (both accountRoutes POST and agentRoutes inline create).
- NEP is in SELF_ONLY_CHAT_ROLES + entity.detail widened (account provider via staffedAccountIds NEP branch; opportunity provider exception).
- Provisioning: `provisionPortalLogin` auto-detects NEP from the contractor row's notes matching /non[\s-]?equity\s+partner/i.
- Frontend: NEP is NOT isSelfOnlyRole — it gets Me + a slimmed Clients lens (`clientsSectionVisibleForRole`); NEP is in both INTERNAL_ROLES and SELF_SCOPE in the screen-catalog generator.
- Probe: tests/crm/nep-access-probe.ts covers grant/invite/revoke/creation/403 surfaces.
