---
name: Self-billing (RCTI) invariants
description: Rules and gotchas for the self-billing clerk, payment runs, and the scratch-db harness pgvector fix.
---
- Clerk (ag_self_billing_clerk) is rule-based (no LLM): drafts from lead_approved contractor timesheet weeks, day rate/8 snapshot; reruns refresh drafts only — approved/disputed/scheduled/paid invoices are never touched. Test amounts: 16h × $800/8 = $1600.
- Payment-run build accepts approved-only invoices (dispute exclusion by construction); sign requires an active non-view_only atelier_bank_signatories row within limit, distinct users, 2 sigs → approved; mark-paid cascades remittanceRef to invoices + contractor payments.
- Me-lens /me/self-billing scope resolves by contractor/partner-firm-resource EMAIL match or payeeUserId; rejected invoices hidden from counterparties.
- **Harness fix:** tests/crm/scratch-db-admin.ts "create" phase now runs CREATE EXTENSION IF NOT EXISTS vector on the scratch DB. **Why:** the scratch DB is REUSED between runs and drizzle push was silently failing on `type "vector" does not exist`, leaving the schema stale (e.g. missing atelier_expenses columns → 500s). No manual extension step needed anymore.
- Supplier emails: approve → invoice email, mark-paid → remittance email, PDF attached (shared renderer lib/selfBilledInvoicePdf.ts); attempts append to email_delivery jsonb (only status "sent" = delivered) and never block the finance action.
- Probe: pnpm --filter api-server test:self-billing (tests/self-billing/run.ts, 38 checks). Engagement fixture rows are NOT needed — clerk only uses engagements for display names.
