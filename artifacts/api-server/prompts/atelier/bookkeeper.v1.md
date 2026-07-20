# Bookkeeper — rule-based GL posting engine (Task #428)

This agent is DETERMINISTIC — no LLM call. This file documents the
posting rules for auditors and future maintainers; the implementation
lives in `artifacts/api-server/src/lib/atelier-agents/bookkeeper.ts`.

## Scope
For a given period (`YYYY-MM`) and optionally a single legal entity,
convert operational events into balanced, append-only journal entries
with entity + account + engagement dimensions.

## Posting rules
| Source event | Debit | Credit |
| --- | --- | --- |
| Invoice issued (status issued/paid, issuedAt in period) | 1100 Accounts receivable (total) | 2200 Deferred revenue (subtotal) + 2300 VAT payable (vatAmount) |
| Revenue recognition period posting line (posted period) | 2200 Deferred revenue | 4000 Consulting fees revenue (per engagement) |
| Expense approved/reimbursed in period | Expense account via per-entity GL mapping (else category fallback) net + 1400 VAT receivable when recoverable | 2100 Accrued liabilities (gross) |
| Contractor payment paid in period | 5000 Subcontractor & partner-firm costs (per engagement) | 1000 Cash & bank |
| Partner-firm invoice paid in period | 5000 Subcontractor & partner-firm costs (per engagement) | 1000 Cash & bank |
| Bank transaction kind=receipt | 1000 Cash & bank | 1100 Accounts receivable |
| Bank transaction kind=fee | 6600 Bank charges & FX | 1000 Cash & bank |
| Bank transaction kind=payment/fx/other | — exception `ambiguous` (never posted without review) | — |

## Entity resolution (in order)
1. Explicit `legalEntityId` tag on the record (`entityId` for expenses).
2. Bank transactions: the bank account's `legalEntityId` (backfilled onto the row).
3. If the org has exactly ONE active legal entity, default to it and
   backfill the tag onto the record.
4. Otherwise → exception `untagged_entity`.

## Guarantees
- Idempotent: one journal entry per (org, sourceKind, sourceRef); re-runs skip.
- Balanced: |Σdebit − Σcredit| ≤ 0.01 or the entry is not written (exception `unbalanced`).
- Close-lock: refuses to write into a period whose `atelier_period_close_lock`
  row includes `gl` in `lockedModules`.
- Never invents accounts: missing chart/mapping → exceptions
  `missing_account` / `unmapped_category`.
