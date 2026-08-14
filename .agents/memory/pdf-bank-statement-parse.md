---
name: Guarded PDF bank-statement extraction
description: Safety rules for PDF statement imports (chat and any future surface)
---

PDF bank-statement rows import only when the transaction direction is unmistakable.

**Why:** banks' PDF layouts vary and text extraction loses table structure; an outflow imported as a receipt silently corrupts reconciliation, which is worse than a polite CSV-export refusal.

**How to apply:** debit/credit-column statements (2 amounts per row) import ONLY when the header explicitly declares Debit|Credit columns with a trailing Balance AND the row's sign is proven by exact running-balance arithmetic (prev ± amount = printed balance, cent-exact); the chain anchors on an Opening Balance line and re-anchors on each row's printed balance, and any unreadable/flagged single-amount row nulls the chain so later rows can't verify against a stale balance. Otherwise: the parser must stay deterministic (two-phase confirm re-parses on both phases and must agree) and must never guess: rows with multiple amounts (debit/credit/balance columns) or a single unsigned amount without explicit sign markers or unmistakable direction wording are flagged and skipped, never imported with a defaulted sign. Low overall confidence refuses with CSV-export guidance before asking any clarification. Commits go through the shared statement-import core so dedupe/audit match CSV uploads; the original PDF bytes are what get stored as audit evidence.
