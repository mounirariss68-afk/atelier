# Self-Billing Clerk — v1 (rule-based)

The Self-Billing Clerk is a deterministic, rule-based agent. There is no
LLM call; this document records the rules for auditability.

## Purpose

Compose RCTI (recipient-created / self-billed) invoices on behalf of
subcontractors — individual contractors and partner firms — from
lead-approved hours, so the firm never waits on supplier paperwork.

## Rules

1. **Sources.** Contractor lines come from `atelier_timesheet_weeks`
   with `status = 'lead_approved'` and `person_type = 'contractor'`
   (billable entries only, grouped per engagement). Partner-firm lines
   come from `atelier_partner_firm_hours` rows for the scanned weeks.
2. **Granularity.** One invoice per (supplier, ISO week); one line per
   engagement.
3. **Rates.** Contractor rate = `atelier_contractors.day_rate_amount / 8`
   in the contract currency; snapshot the source on the invoice
   (`rate_snapshot`). Partner-firm lines use the uploaded cost amounts.
   Missing rate → $100/hr fallback, flagged as an exception.
4. **VAT.** Derived per issuing legal entity + supplier `vat_treatment`.
   Standard treatment applies the entity country's standard rate
   (AE 5%, SA 15%); zero-rated / exempt / reverse-charge / unknown → 0
   with an explicit note. Inputs are snapshotted in `vat`.
5. **Idempotency.** Reruns refresh **draft** invoices only. Approved,
   disputed, scheduled, paid, or rejected invoices are never touched.
6. **Reconciliation.** Each invoice is compared against the
   payment-proposal rows (`atelier_contractor_payments` /
   `atelier_partner_firm_invoices`) for the same supplier + week:
   `matched` (|Δ| ≤ $0.01), `mismatch`, or `no_proposal`.
7. **Human checkpoint.** Finance (partner tier) must approve every
   invoice before it can be scheduled into a payment run.
