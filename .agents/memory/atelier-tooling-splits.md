---
name: Vendor tooling cost splits
description: Invariants for supplier-invoice line-item mining and per-project tooling cost allocation
---

## Rules
- Mined line items are POST-CREDIT NET (they sum to the printed post-credit subtotal). Split net = item net + pro-rata VAT; the credit share is informational only. Never subtract credits a second time — split nets must tie to the invoice total to the cent (largest-remainder rounding).
- **Why:** a credit double-count once understated all tooling P&L; synthetic test fixtures masked it because they didn't mirror real invoice semantics. Money probes must use genuine invoice text, not invented figures.
- The reconciliation gate quarantines invoices that don't tie (status `unreconciled`) rather than scaling or guessing amounts. Sections split across PDF page breaks are a known unreconcilable case — they surface for manual review by design.
- Flat invoices with no per-project breakdown use the `__vendor_default__` sentinel project key and resolve via per-vendor percentage rules; the vendor-rules read endpoint returns every supported vendor even when unset so the UI can create the first rule (otherwise rules are unreachable).
- Invoices with ANY approved split are immutable to automatic re-proposal: the propose helper self-guards, mapping/rule edits skip them, re-extract 409s. Otherwise a later mapping edit + approve double-counts the same invoice in tooling totals and engagement P&L.
- Splits never auto-approve (`evaluateAutoPost` stays the sole auto authority); approval feeds engagement cost-to-date through the subs bucket. Project-name→bucket mapping is exact key match only, no fuzzy; unmapped names ride the unified finance inbox.
- Extraction+proposal is single-flight per invoice (advisory xact lock + partial unique index on proposed-split identity); any new caller must go through the shared propose helper, never insert splits directly.
- Bucket types include `account` (client; bucketRef must be an org-scoped live account id, validated at map time) and `ip_development` (ref-less). OpenAI is a flat vendor (matches "openai"/"chatgpt"). Approved account-bucket splits are the SOLE source of the Account 360 `toolingSpendUsd` rollup.
- Saved mappings are soft-deleted via the mappings DELETE route, which re-proposes affected NON-approved invoices back to zero splits and returns the project to the unmapped queue; approved invoices stay untouched.
- Unmapped-project notifications must never link someone into a 403: the tooling console is finance-leadership gated, so `notifyUnmappedProjects` notifies the submitter only if they hold founding_partner/partner/finance, otherwise it notifies finance leadership instead.
- **How to apply:** any change to extraction or split math must keep the exact-to-the-cent net-tie invariant against real vendor invoices — verify with genuine PDFs, not synthetic figures.
