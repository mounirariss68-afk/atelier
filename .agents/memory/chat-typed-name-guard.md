---
name: Chat typed-name guard is risk-based
description: When chat writes require typed-name re-confirmation, and how clients key off it
---
Typed-name re-confirmation for chat writes is RISK-based, not attachment-based. In an attachment turn it fires only when: attachment body has destructive verbs (scanned from atelier_extracted_documents.normalizedText, fail-safe true on scan error), the user prompt has destructive verbs, the tool is irreversible, has an outboundChannel, or has a destructive tool name. Benign self-scoped saves (save_my_document) get plain Confirm/Cancel.

**Why:** the old rule ("benign prompt ⇒ force typed name") made users retype their full name to save their own visa scan; the jailbreak defense only needs to fire when actual risk signals are present.

**How to apply:** keep both enforcement points consistent — preview stamps requiresTypedName/typedNameExpected onto pendingWrite; confirm phase re-checks pending.requiresTypedName OR isIrreversibleTool. Client wiring: mobile keys off boolean `requiresTypedName`; web keys off top-level STRING `typedNameRequired` in the needs_confirmation frame (server must lift it out of diff — web never reads diff.typedNameRequired).
