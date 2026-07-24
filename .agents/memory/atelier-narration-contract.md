---
name: Chat narration/card output contract
description: Deterministic backstops keeping Atelier chat prose consistent with result cards
---
Rule: the orchestrator loop buffers pre-tool narration and flushes it only after the tool succeeds (dropped on failure/unknown tool); post-commit recaps are suppressed; final prose that restates the rendered card payload is trimmed to its first sentence via the pure helpers in the narration-contract module (kept side-effect-free so they can be unit tested without DB/LLM). Identical tool_result frames are deduped server-side (frame key = tool|ok|errorCode|payload) AND client-side (web card list + mobile reducer, which still appends a trace tick for the duplicate).

**Why:** the model tended to narrate results already shown in cards, and confirm replays / re-emits stacked duplicate cards; deterministic backstops are the regression-proof layer, the prompt contract alone is not.

**How to apply:** new tool-result emit paths must go through record() (server) and the shared dedupe in ToolResultCardList / chatFrames; any new closing-prose surface should reuse trimNarrationForCard rather than reimplementing restatement checks. Loop-level behavior is pinned by the stub-Anthropic chat-output-contract probe.
