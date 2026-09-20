---
name: Account enrichment approval boundary
description: Durable policy for reviewed account creation and later AI-generated enrichment.
---

Base-account creation saves only fields explicitly reviewed in the create flow. Research already shown and approved in chat may persist verbatim without another model call. Every later automated or manual enrichment producer must append through one row-locked proposal queue with the same rejection, edit, expiry, evidence, and audit semantics.

**Why:** AI enrichment previously direct-wrote account fields and contacts after a fast create, while separate producers could race on the JSON queue and silently restore stale pending items.

**How to apply:** New account-enrichment agents must use the shared atomic enqueue path. Generated proposals expire consistently, rejected equivalents stay suppressed, expired items are not actionable or counted, and contact approval preserves evidence plus the approving human.