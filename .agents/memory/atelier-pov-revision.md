---
name: Atelier POV revision loop
description: POV outline/draft/revise lifecycle invariants and async draft launch contract
---

- Outline approval must NOT set "approved" (draft route guards on status "outline"); revise loops back to drafted; PDF honours ?povId/?versionId.
- Draft and revise are ASYNC (2026-08-12): routes validate, register an in-memory `povLaunches` entry keyed on povId, run `runPovDraft` in a background IIFE, return 202 `{started:true}`. Client polls raw-fetch GET `/povs/:povId/draft-status` (idle/running/failed/done{versionId,versionNumber}).
  **Why:** full multi-section drafts run minutes; the generic 45s LLM abort killed them ("Request was aborted"), and the proxy 502s requests held >1–2 min.
  **How to apply:** only "done" is success — client treats mid-run "idle" as "server restarted, run lost". Outline PATCH + regenerate 409 (`pov-run-in-progress`) while a launch is running (draft snapshots the outline at launch). Duplicate draft/revise start → 409. Citation-coverage gate (<0.6) becomes a failed launch, not a 422.
- `callClaudeJson` accepts per-call `timeoutMs`; POV uses ATELIER_POV_TIMEOUT_MS (default 240s).
