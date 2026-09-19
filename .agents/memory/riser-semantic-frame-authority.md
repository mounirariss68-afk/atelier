---
name: Riser semantic frame authority
description: Authority, compatibility, replay, and recovery rules for semantic assistant frames across web and mobile.
---

Current assistant mode trusts only validated, server-authored semantic envelopes. Raw tool payloads never authorize commit, navigation, terminal state, cache invalidation, or successful presentation. A semantic presentation is authoritative only with a coherent read outcome (`kind: read`, `committed: false`). Unknown, malformed, envelope-less, incompatible, duplicated-sequence, or event/outcome-incompatible frames are no-ops before any effects.

**Why:** Treating raw results or rejected frames as authoritative allowed forged navigation, duplicate side effects, and replay/live divergence. Negotiation races and history that began with an envelope-less frame could also silently enter the legacy path.

**How to apply:** Start clients in negotiation-pending and block submission until mode is known. Keep legacy behavior behind the explicit headerless adapter. Preflight all persisted frames to seed replay mode before reducing the first frame. Route web and mobile replay/presentation decisions through their production adapters and run one golden corpus through both. Recover post-frame disconnects only by polling/replaying persisted state; never resend confirmation or any write.