---
name: Atelier account research priority-refs shape
description: Two similar-looking sourced-fact shapes exist; the account's strategicPriorityRefs is NOT a research-brief fact.
---

The Atelier account column `strategic_priority_refs` (and the chat→create reviewed-research payload that fills it) is `{ text, sourceUrls }` — NO `evidence` field.

This is distinct from `AtelierResearchBriefFact` (`{ text, evidence, sourceUrls }`, `evidence` REQUIRED), which is only used inside the full `researchBrief` (whatsChanging, executiveTensions, …).

**Why:** When persisting reviewed Cartographer research onto a new account, the create-input research schema's `strategicPriorityRefs` was first pointed at `AtelierResearchBriefFact`. The client builds those refs without `evidence`, so `safeParse` rejected the whole create body with 400 invalid-body and the "persist exactly what was reviewed" path silently never ran.

**How to apply:** When adding/editing any create- or update-time schema that carries sourced strategic priorities, use the inline `{ text, sourceUrls }` shape (mirror the account proposed-update schema in `openapi.yaml`), never the evidence-requiring brief fact. Reserve `AtelierResearchBriefFact` for the research brief itself.
