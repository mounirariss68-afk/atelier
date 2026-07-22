---
name: Chat write-capability contract
description: Invariants for isWrite chat capabilities (navigateTo, confirm pattern, self-only identity lock)
---

- Every `isWrite:true` capability is wrapped by a navigateTo validator: any commit-success `data` (ok, no confirmation/refusal/etc.) MUST carry `navigateTo: { path, when: "on_commit" }` or explicit `navigateTo: null`, or the run throws at call time. Confirmation-frame returns are exempt.
- Two-phase confirm pattern: first call returns `confirmation:{summary,diff,pending:{tool,input:{...input,confirm:true}}}`; the re-call carries `confirm:true`. Extra confirmation rounds can chain (e.g. timesheet suspicious-flag acknowledgement adds `acknowledgeFlags:true` to the pending input).
- Self-service writes (me.* in me-write-capabilities) are identity-locked: input schemas have `additionalProperties:false` and NO person/user selector; subject is always re-resolved from the session persona. Chat receipts/documents from attachments must check `attachment.userId === persona.id` before moving bytes.
- Refusal frames pass reason/suggestion through `scrubToolIdentifiers` so tool names never leak to users.

**Why:** commit-success without navigateTo throws in production; selector-free schemas are the prompt-injection defense the probe suites pin.
**How to apply:** any new chat write capability — copy the defineSelfWriteCapability pattern; run `test:cli-selfservice` to verify.
