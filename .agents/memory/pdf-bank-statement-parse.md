---
name: Guarded PDF bank-statement extraction
description: Safety rules for PDF statement imports (chat and any future surface)
---

PDF bank-statement rows import only when the transaction direction is unmistakable.

**Why:** banks' PDF layouts vary and text extraction loses table structure; an outflow imported as a receipt silently corrupts reconciliation, which is worse than a polite CSV-export refusal.

**How to apply:** the parser must stay deterministic (two-phase confirm re-parses on both phases and must agree) and must never guess: rows with multiple amounts (debit/credit/balance columns) or a single unsigned amount without explicit sign markers or unmistakable direction wording are flagged and skipped, never imported with a defaulted sign. Low overall confidence refuses with CSV-export guidance before asking any clarification. Commits go through the shared statement-import core so dedupe/audit match CSV uploads; the original PDF bytes are what get stored as audit evidence.
