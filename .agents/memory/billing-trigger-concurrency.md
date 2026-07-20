---
name: Billing trigger draft concurrency
description: Why draftInvoiceForTrigger must claim the trigger row FOR UPDATE
---

Rule: any code path that turns a billing trigger into an invoice must re-read the trigger inside a transaction with SELECT ... FOR UPDATE and bail unless status=ready and invoice_id is null.

**Why:** cron + manual + milestone-event runs can overlap; a stale-snapshot check let two runs draft duplicate invoices for one trigger (caught in code review).

**How to apply:** keep all trigger reads/writes on the tx handle, defer audit inserts until after commit, and keep the concurrency check in the billing probe (two parallel /billing/run calls, exactly one draft).
