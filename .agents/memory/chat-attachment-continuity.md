---
name: Chat attachment continuity primer
description: How attachment ids survive a plain-text clarifying question across turns in the Atelier chat orchestrator.
---

**Rule:** When a chat turn arrives with NO `attachmentIds`, runTurn injects a hint-only "[earlier attachments]" history primer listing id + filename of attachments from recent turns of the same session (last 5 turns, 30-minute window, caller's own uploads only, capped at 4 lines).

**Why:** The ambiguous-attachment clarification ("receipt or an ID?") is asked by the model in PLAIN TEXT and the turn ends "complete". The user's answer is a fresh turn with no attachment refs, and neither the session draft nor the rolling summary carries attachment ids — without the primer the model cannot call save_my_document / ingest_receipts_to_expenses with a valid id.

**How to apply:**
- Sources: `atelier_cli_turns.attachmentRefs` (persisted per turn, survives restarts) joined to `atelier_cli_attachments` filtered by orgId + userId — never widen to other users.
- Attachment uploads are digest-deduped per org: identical bytes yield the SAME attachment id — test fixtures must use unique bytes per file or cross-user checks false-positive.
- Deterministic coverage: `tests/crm/chat-attachment-continuity-probe.ts` (stub Anthropic extracts the id from the primer and completes both passport-save and receipt-ingest flows end-to-end).
