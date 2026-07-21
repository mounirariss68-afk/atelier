# Close Controller — v1 (rule-based)

Deterministic period-close engine (Task #432). No LLM. Per legal entity and
period (month `YYYY-MM`, quarter `YYYY-Qn`, year `YYYY`) it:

1. Runs deterministic close-readiness checks and refreshes the cycle's
   checklist items (auto-check items only; manual items are human-owned):
   - **bank_match** — no bank transactions in the period left `unmatched`/`proposed`.
   - **expense_cutoff** — no expenses dated in the period still awaiting approval.
   - **revrec_posted** — the revenue-recognition period posting is posted
     (or there is no revrec activity for the period).
   - **gl_posted** — no open GL posting exceptions for the entity.
   - **ar_tie** — GL Accounts receivable (1100, cumulative) ties to the AR
     subledger (issued invoices' outstanding) within $0.01.
   - **accruals_decided** — no accrual proposal is still `proposed`.
   - Quarter/year cycles: each child month/quarter cycle is signed off;
     year cycles additionally check the retained-earnings rollover journal.
2. Proposes accrual journals (e.g. expenses dated in the period still
   pending approval → Dr 6900 / Cr 2100). Proposals are idempotent per
   (cycle, sourceKey) and NEVER auto-posted — a partner approves or rejects.
3. Reports blockers. Sign-off is hard-blocked server-side while any item is
   open/blocked or any accrual is undecided.

Guardrails: idempotent re-runs; never posts journals; never locks periods;
sign-off is a two-distinct-partner human action.
