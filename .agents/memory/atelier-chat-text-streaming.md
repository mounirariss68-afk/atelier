---
name: Atelier chat live text streaming
description: text_delta frame semantics, test-env gating, and narration-contract interplay for streamed Riser answers
---

**Rule:** Riser streams model text via live-only `text_delta` frames (append, or `replace:true` swap; empty replace = retraction). They bypass `record()` so they are NEVER persisted — replay/facts/recap see only the final `narration` frame, which the shared chat-core reducer uses to REPLACE the delta-built streaming trace entry (marked `streaming:true`).

**Why:** The narration contract (pre-tool prose flushes only on tool success) and replay parity both require the persisted transcript to be exactly the contract-trimmed text; deltas are presentation-only.

**How to apply:**
- Streaming defaults OFF under `NODE_ENV=test` (the many JSON-replying stub-Anthropic probes would break on `stream:true`); force with `ATELIER_CLI_STREAM_TEXT=on|off`. A streaming-capable stub must answer SSE when the request body has `stream:true` (see tests/chat/streaming-probe.ts).
- A ~120-char hold-back (`ATELIER_CLI_STREAM_HOLDBACK`) keeps typical one-line pre-tool prose from streaming at all; longer prose is retracted via empty replace the instant a tool_use block starts (`onToolUseStart`), and on model retry (`onStreamReset`), model error, widen-on-miss retry, guard-suppressed prose, and committedWriteOk suppression.
- Deltas are incrementally re-cleaned (marker strip + scrubKnownToolNames on the full accumulation, suffix-diffed); if cleaning rewrites already-sent text a `replace` frame reconciles.
- Any NEW server path that suppresses or rewrites final prose after the model step must call the step's `resetStreamDelta()` or clients keep orphaned tentative text.
