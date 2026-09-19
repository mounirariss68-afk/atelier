---
name: Riser protocol compatibility
description: Durable rules for canonical/legacy assistant negotiation, replay, and action fallback.
---

Canonical assistant operations require explicit compatible protocol, semantic-mode, and presentation-version offers. Headerless behavior belongs only to the legacy adapter; the protocol metadata endpoint is the discovery exception.

**Why:** Silently selecting semantic output for an undeclared client breaks version-skew safety, and canonical confirm/cancel fallbacks can otherwise return legacy wire output.

**How to apply:** Any new canonical assistant operation must use the same negotiation contract and return typed 426 metadata for missing or incompatible offers.

Semantic replay uses one authoritative persisted turn ID and monotonic sequence domain. A retry terminal must preserve the validated stored outcome (including commit state and navigation) and add only the idempotent-replay marker.

**Why:** Mixing route-local and persisted sequences caused frames or terminals to be dropped; replacing a committed/proposed outcome with a generic read changed client-visible authority.

**How to apply:** Upcast legacy persisted frames before semantic emission, allocate the retry terminal above every persisted sequence including hidden gaps, and never inject raw route frames after semantic turn frames begin.

Canonical action fallback to a legacy turn remains owner- and organization-scoped, and canonical typed evidence must be translated to the legacy typed-name field.

**Why:** Treating an unmatched action ID as an unscoped turn ID could expose cross-owner approval semantics.

**How to apply:** Resolve any fallback by ID, organization, and requester before delegation; return not found on mismatch.