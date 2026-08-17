---
name: LLM reply-budget truncation defense
description: How Atelier LLM JSON extractors must handle stop_reason max_tokens
---

Rule: any Anthropic call whose reply is parsed as JSON must check `resp.stop_reason === "max_tokens"` — a token-capped reply is syntactically broken JSON and otherwise surfaces as a misleading "non-json" failure (which blanked invoice scanning once).

**Why:** the supplier-invoice parser at 1024 tokens silently truncated itemized invoices → `parse-non-json` → all-fields-blank clarification. Named detection + recovery fixed it.

**How to apply:**
- Give ample budget (8192) AND still detect max_tokens; budget alone is not a fix.
- Supplier-invoice parser recovers with ONE header-only retry ("Do NOT itemize" system override), forces `lineItems: null`, sets `lineItemsTruncated: true`; caller copy says itemization was skipped, never "no line rows printed". Double truncation → named parse-failed.
- Both calls share ONE 90s deadline (deadlineAt param) — retries must not double latency contracts.
- Failure logs: bounded metadata only (errorCode, stop_reason incl. null on catch paths, lengths). NEVER log model output or document-derived labels — invoice PII.
- Probe stub (`tests/crm/chat-finance-docs-probe.ts`) has `invoiceForcedReplies` queue (text+stopReason per call) + `sawHeaderOnlyOverride`; retry payload deliberately includes lineItems to prove the forced-null guard.
- Clarification copy distinguishes "no readable text" vs "AI reader failed (code) — retry or type the fields" via a captured parseErrorCode.
