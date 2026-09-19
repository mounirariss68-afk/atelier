---
name: Riser explicit presentation
description: Durable contract separating tool evidence from client-visible presentation.
---

Only server-approved, versioned capability/source/card triples may become explicit presentation frames. Clients must validate the same triple and minimum-data contract rather than infer a card from tool success.

**Why:** Tool execution proves that a capability ran; it does not prove that its result is relevant, complete, or safe to render for the user’s current intent. Incidental read results caused unrelated cards, while suppressed evidence still needed to remain durable for audit and replay analysis.

**How to apply:** When adding a managed presentation family, update the shared versioned pairing registry, server relevance/minimum-data checks, adversarial reducer fixtures, and both clients. Persist suppressed/failing/over-budget results as evidence, but filter that evidence at every client boundary: live streams, idempotent replay, and session-history JSON.