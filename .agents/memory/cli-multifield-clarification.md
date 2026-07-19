---
name: CLI multi-field clarification protocol
description: How multi-field clarification cards work in the Atelier chat CLI (fields array, clarificationValues, dotted-path merge)
---

- A ToolResult clarification may carry `fields: [{field,label,hint?}]` (all missing fields) beside the legacy `field`/`question`. The card renders one labeled input per field only when `fields.length > 1`; single-field + suggestion chips keep the classic path.
- Client submits `clarificationValues` (map field→string) beside a human-readable prompt; server merges only keys in the allowed set (pc.field ∪ pc.fields), skips blanks, and the tool re-issues a NARROWED clarification for what's still missing.
- **Why:** dotted names like `values.fee` must expand into nested objects via `mergeClarificationAnswer` — a literal top-level `"values.fee"` key is silently ignored by contract_prepare and re-loops the same question (this was a real pre-existing bug for single-field answers too).
- **How to apply:** any new capability that wants a multi-input card just sets `fields` on its clarification; sanitize untrusted persisted `fields` via `sanitizeClarificationFields`. The gate treats non-empty clarificationValues as answer-shaped (won't drop the pending clarification).
