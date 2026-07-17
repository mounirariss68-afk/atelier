---
name: Executive Mapper agent
description: People-only leadership research agent feeding the same governed contact-proposal queue as the Cartographer; LinkedIn URL rules.
---
The Executive Mapper reuses the Cartographer's decision-maker shape, proposal queue, entity-scope guard and contact applier — it is NOT a parallel pipeline.

**Why:** one governed review queue (account `pendingProfileUpdates`) keeps partner approval flow single; duplicating shapes would fork the applier.

**How to apply:**
- LinkedIn URLs pass through `normaliseLinkedinProfileUrl` (only `linkedin.com/in/<slug>`, else null); the contact-update applier writes `linkedinUrl` only when truthy so an empty agent result never blanks an existing link.
- `buildExecutiveMapperProposals` drops known contacts unless they gain a LinkedIn URL or a changed title — enforce enrichment-only re-listing in code, not just the prompt.
- `guardCartographerEntityScope` is generic over any `{decisionMakers}` output; reuse it for any people-producing agent.
- The run route is bespoke (not in openapi); frontend triggers it with raw fetch like other account-agent routes.
