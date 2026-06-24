---
name: Atelier account/contact merge
description: Design decisions and gotchas for the duplicate-merge feature (accounts + contacts)
---

# Atelier duplicate MERGE (accounts + contacts)

Merge lib lives in `artifacts/api-server/src/lib/atelier-merge.ts`; routes are
`POST /accounts/:accountId/merge` and `POST /contacts/:contactId/merge`. Builds
on the earlier duplicate-detection (warn-and-link) feature.

## Contract (durable design)
- **Survivor = path id; duplicate = body id** (`duplicateAccountId` /
  `duplicateContactId`). Survivor is kept, duplicate is folded in then archived
  (soft-delete via `deletedAt`/status flip — never hard-deleted here).
- **Idempotent**: re-merging an already-archived duplicate returns
  `status: "already_merged"` (not an error).
- **Self-merge → 400** (same-record guard). Contact merge also requires both
  contacts share an account → 400 different-accounts otherwise.
- Returns per-table `counts` of re-pointed rows.

## Gating decision
Both merges gate on **CREATE_ROLES** (founding_partner / partner /
senior_manager) + `canSeeAccount`. **Why:** merge is more consequential than a
plain contact create (which only needs canSeeAccount), so contacts use the
stricter create gate, not the looser one. Account merge checks visibility on
**BOTH** accounts. Frontend mirrors this with a `canMerge` flag matching the
same three roles.

## Re-point gotchas
- `contactRelationships` has **no `updatedAt`** column — only set the FK on
  repoints, don't blanket-set updatedAt across child tables (type errors).
- Account merge also re-points hierarchy `parentAccountId`, audit events, and
  `agent_runs`, not just the obvious CRM child tables.
- `MergeContactRow` exposes `fullName`, NOT `name` (accounts use `name`).

## Verification note
Seed/dev DB has no account with 2+ contacts, so a REST happy-path *contact*
merge isn't reproducible there — verify via the parallel account-merge path +
the route's JSON error shapes (`contact-not-found`, etc.).
