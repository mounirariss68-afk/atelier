---
name: Meeting-chat clarification hardening
description: Accent-folded roster matching, tolerant location/time normalization, mobile disambiguation state
---
- Roster name matching in chat must be accent-insensitive: never raw ILIKE for people names — fetch org-scoped rows and filter via `foldRosterName` (handles Turkish ı/İ dotless-i, which NFKD alone does NOT fix). Used in both internal-meeting attendee resolution and `resolvePerson`.
- Fixed-choice clarification answers must pass through a normalizer (`normalizeLocationAnswer`) before enum validation; unrecognized/conflicting → null → re-ask with `suggestions` chips (never silently drop and re-loop identically).
- Times normalize via `normalizeTimeInput` ("8am","0800","8.00"→"HH:MM") before wall-clock conversion.
- Mobile chat: `needs_disambiguation` is a first-class TurnStatus; final "partial" frame must PRESERVE it (mirrors web). Clarification resubmits must reset text/trace/toolResults/result on the reused turn key or narration/cards duplicate.
- Mobile fixed-choice clarification chips submit DIRECTLY once every field has a value (no separate Send tap); free-text fields keep the Send button.
- Hijack guard: `looksLikeClarificationAnswer` rejects prompts opening with COMMAND_OPENERS (includes scheduling verbs setup/book/reschedule/cancel/invite/plan/check).
**Why:** production loop bugs — "gokhan" not matching, location question infinite loop with tripled narration, mobile disambiguation dead end.
**How to apply:** any new chat tool asking fixed-choice questions or resolving people by name must reuse these helpers, not re-implement ILIKE/strict enums.
