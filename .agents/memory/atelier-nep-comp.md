---
name: NEP margin-share compensation
description: Non-salaried NEP comp — durable invariants for plans, tiers, entitlements, payables wiring.
---
Non-salaried non-equity partner comp rides the CONTRACTOR machinery (plans key to the contractor roster row; time charges flow via day rate → timesheets → self-billing).

- **Signed-agreement invariants** (legal commitments — never "simplify" without a revised agreement): sale tier has NO time limit and doesn't require origination; origination-only tier is window-limited from the client's FIRST engagement; the NEP's OWN time charges are deducted as a direct delivery cost; payability gates on BOTH full collection AND explicit client acceptance, due 30 days after the later.
- **Effective dating is strict**: no plan covers dates before the first `effectiveFrom` (no retroactive fallback — back-date explicitly for agreed retroactivity). The rate-consumption boundary is the WORK date: pricing paths (self-billing clerk, payment proposer) resolve the day rate from the plan effective on the work week — never the roster field alone — so future revisions activate exactly on their effective date; the roster field is only a synced convenience for currently effective terms.
- **Recompute is idempotent** and only rewrites accruing/payable rows — approved/scheduled/paid entitlements are frozen. Margin-share run items follow the contractor no-system-IBAN policy: bank cells export blank and are flagged `missingBank` so signatories see it pre-approval.
- **Relationship classification is canonical person data, not authorization.** Employee, contractor, equity-partner, non-equity-partner, and partner-firm-resource status must be stored against the stable person id; never infer it from a login role, display name, or the presence of a contractor row. Equity partner means `profit_sharing` with `rules_pending` until approved effective-dated terms exist, and must not create payout percentages or entitlements.
- **NEP plans require signed provenance.** Every plan revision must point to the signed, person-linked governing contract and its current signed document/version. Legacy NEPs are classified through an explicit idempotent stable-id mapping path, never by role or name.
- **Why:** authorization roles can change independently of the commercial relationship, and implicit contractor/name matching can misclassify people or generate compensation without agreed terms.
- **How to apply:** any new direct-delivery cost/revenue source must be wired into the shared engagement-economics computation or margins silently overstate. New org_id tables (these included) MUST be added to the `atelier-rls.sql` org-table list AND get idempotent RLS in their versioned migration — route-level org filters don't satisfy review.

Test: `pnpm --filter @workspace/api-server run test:nep-comp` (one-shot, scratch DB). The NEP plan seed script is dev-applied only — re-run on prod at go-live (DB rows never merge).
