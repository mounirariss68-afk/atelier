---
name: Semantic source authority
description: Durable boundaries for semantic projections, canonical source lifecycle, and ambiguous outbound-provider outcomes.
---

Semantic indexes are disposable, untrusted projections. They may rank candidates only after the actor’s domain ACL and the live source row’s currentness have been revalidated; an embedding or graph edge never proves identity, visibility, or authority.

**Why:** Projection invalidation can lag source replacement/deletion, and stale semantic rows otherwise disclose archived labels or evidence.

**How to apply:** Join retrieval back to the current authoritative source and apply actor ACL before ranking or returning labels. New projection tables need tenant RLS even though application authorization remains authoritative.

Tax-certificate currentness belongs to the legal-entity registry pointer. Registry claims and destructive document lifecycle changes must share a database serialization boundary, with blob deletion deferred until after the authoritative transaction commits.

**Why:** Route-level check-then-mutate guards leave a race where a document can become canonical while versions or bytes are being removed.

**How to apply:** Protect both sides with the same transaction lock and database invariant; preserve replaced documents as historical evidence.

An outbound provider timeout or interrupted execution is not a safe retry signal. Return the fenced terminal state; if provider acceptance cannot be ruled out, persist an unknown outcome and block blind retry.

**Why:** Microsoft Graph does not provide a general exactly-once guarantee for these mail operations, and concurrent confirmations can overlap an active worker.

**How to apply:** Pin exact source revisions at preview, revalidate before claim, fence execution, treat fresh claims as in progress, recover only stale claims, and reconcile unknown outcomes before another attempt.