---
name: Partner contracts & billing hub
description: Invariants for the alliance-partner portal contracts/billing surfaces and partner-submitted AP invoices.
---

# Partner contracts & billing hub

- `atelier_partner_firm_invoices` carries TWO lifecycles keyed on `source`:
  `"proposal"` rows (co-deliver payment proposals, wallet approve acts only on
  status "proposed") vs `"partner_submitted"` rows (portal AP invoices:
  submitted → under_review → approved → scheduled → paid / rejected).
  `engagementId` is nullable for submitted rows; `weekIso` is NOT NULL — portal
  submits stuff periodLabel/invoiceDate/date-string into it.
- **Why:** the task mandated building on the existing stubbed AP tables, not a
  parallel model; keeping both lifecycles in one table means every consumer
  must filter on `source`.
- **How to apply:** any new query over partner-firm invoices must filter
  `source`, or proposal rows leak into AP surfaces (and vice versa).

- Portal contract visibility = e-sign agreements via the shared
  `partnerAgreementItems()` normalized-name join PLUS explicit share rows in
  `atelier_partner_contract_shares` (soft revoke). Doc-inbox accept creates a
  contract record and auto-shares it. Downloads pick signed_pdf > converted_pdf.
- Bank gate: AP approve 409s `bank-details-missing` and payment-run build
  returns `skippedMissingBank` unless the firm has `bankIban` (finance-approved
  onboarding is the only write path). Payment-run build/cancel/mark-paid handle
  itemType `partner_firm_invoice` (build accepts `partnerInvoiceIds`).
- All routes are raw-fetch `@cli-skip` (not in OpenAPI). Portal gates on
  role alliance_partner + resolved firm; internal share/inbox on the partners
  edit gate; AP review on the finance write gate.
- Probe suite: `pnpm --filter @workspace/api-server run test:partner-billing`
  (submit POST wraps the row in `item`, review responses in `invoice`).
