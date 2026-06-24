---
name: Atelier account deletion lifecycle
description: How account removal works — reversible Archive (default) vs restricted Permanent delete — and the invariants tests rely on.
---

# Account removal is two distinct operations

**Archive (the default, reversible):** flips `status='archived'` while `deletedAt`
stays NULL so the workspace still resolves (read-only). Cascade on archive:
open opportunities → soft-deleted (`deletedAt` set); active engagements →
`plmStage='closed'`. The **prior child state** is recorded in the archive audit
payload so Restore reverts each child precisely (opp deletedAt cleared, eng
plmStage restored to its pre-archive value — NOT a blanket "active").
Roles allowed: founding_partner | partner. Idempotent: archiving an already-
archived account returns ok with `alreadyArchived:true` (success no-op).

**Permanent delete (restricted):** founding_partner ONLY. Financial-gated —
if the account has financial records (invoices/etc.) it returns
`errorCode:"financial_records_exist"` and does nothing unless `override:true`.
Two-phase typed-name confirm + document purge. Idempotent: deleting an already-
removed target returns ok with `alreadyRemoved:true` (NOT a raw not_found).

**Why:** users were losing accounts to irreversible deletes; archive gives a
safe default and permanent delete is the rare, gated escape hatch.

**How to apply:**
- Pure DB logic lives in `src/lib/atelier-account-lifecycle.ts` (loadAccountAnyState,
  accountFinancialFootprint, archiveAccount, restoreAccount, permanentlyDeleteAccount).
  These do NO role gating — callers (HTTP routes + CLI capabilities) gate.
- `GET /accounts` excludes archived by default; `?status=archived` / `?status=all`
  to include. CLI capabilities `account_archive` / `account_restore` /
  `account_delete` are self-defending (in-run role guards).

# Harness quirk worth remembering
`POST /opportunities` (REST) has a stricter create contract than name+desc+accountId.
In the CRM harness, seed cascade-test opportunities/engagements via direct
`db.insert(...)` with all notNull columns (slug, plmStage, partnerOwnerId,
engagementLeadId, dealSizeHypothesis, probabilityPct, nextMilestone, sourceLead)
rather than the REST endpoint.
