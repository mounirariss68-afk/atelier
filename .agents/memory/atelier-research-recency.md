---
name: Research recency layer
description: Recent-news coverage and staleness flagging live in the shared research layer, never per-agent
---
The rule: recency behavior (date-anchored prompts, recency-filtered supplemental news queries, dossier staleness detection) is centralized in the shared research call; agents opt in by passing their entity name rather than duplicating logic per agent.

**Why:** Cartographer once missed major month-old events (own-network completion, ownership change) because no recency filter or date anchoring existed anywhere. The fix was made universal so every research agent benefits. A later review round found the staleness check could be falsely satisfied by year tokens in generated query headings and citation titles/URLs — freshness must be judged on answer text only.

**How to apply:** new research-using agents should pass their entity label so the recency supplement fires; skip only for multi-entity sweeps or non-entity market research that already sets its own recency filter. If the dossier format changes, keep the staleness check scanning answer text only (never headings or source metadata).
