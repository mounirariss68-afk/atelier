---
name: Won-deal commercial baseline
description: Durable rules for converting a won opportunity into signed commercial records.
---

Contract entry is the sole authoritative commercial handoff. It must atomically create or validate the engagement, signed SOW, immutable sold-position snapshot, and baseline billing rule from the persisted pricing basis.

**Why:** Separate or best-effort writes can leave a won deal without a complete baseline, allow mutable rate-card or policy data to change approved economics, or create duplicate downstream records during retries.

**How to apply:** Recompute against the persisted basis, fail closed on any mismatch or missing approval, keep live what-if and saved pricing on the shared simulator, and represent post-sign economic changes through audited change-order/rebaseline records rather than rewriting the baseline.