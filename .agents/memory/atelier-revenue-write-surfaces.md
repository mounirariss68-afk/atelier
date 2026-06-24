---
name: Atelier account-revenue write surfaces
description: Where annualRevenue can actually be written and why the financials gate must cover CREATE, not just PATCH
---

# Atelier account-revenue write surfaces

Only **two** server paths actually persist `atelierAccounts.annualRevenue`:
- `POST /accounts` (create) and `PATCH /accounts/:id` (edit), both in `accountRoutes.ts`.

CLI/agent tools (`account.create`, `account_update`, cartographer refresh/proposals,
`persistReviewedResearch`) do NOT write `annualRevenue` directly. The chat
"Review & Create" flow surfaces a researched revenue figure in the draft, but it
is submitted through `POST /accounts` — so gating the create route covers the CLI
prefill path too.

**Rule:** the account-financials gate (`accountWide && !restricted && !board`,
where `accountWide = access.all || ownerId === me.id`) must be enforced on BOTH
create and edit. Gating only PATCH is a bypass: a non-financial creator in
CREATE_ROLES (e.g. a scoped `senior_manager`) could otherwise seed revenue at
create time. On create the "owner" is the would-be `partnerOwnerId`
(`input.partnerOwnerId ?? (partner/founding_partner ? me.id : null)`).

**Why:** revenue is a money surface; the Edit Company Details (PATCH) gate is
meaningless if revenue can be set elsewhere. Denials return
`403 {error:"financials-forbidden"}`; a revenue-free create still succeeds
(senior_manager is in CREATE_ROLES), so the gate locks money, not creation.
