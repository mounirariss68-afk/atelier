---
name: Atelier CLI action-turn UX contract
description: How write/action turns render in the Atelier chat assistant and a known-stale useCli test
---

## Action-turn rendering contract
- A committed write emits a tool_result whose `data.shape === "write_success"` (with `summary` + optional `navigateTo`). The client renders this as one calm success card, NOT the raw `{stage,verb,payload,…}` echo.
- The `propose_write` PREVIEW tool_result is suppressed server-side (it was a debug echo). The confirm box (`needs_confirmation` + `turn.pending`) is the single anchor for an action turn.
- Destructive deletes carry `diff.impact = { dependencies:[{kind,count}], total }`; the confirm card renders this so a delete is never a silent surprise. `verb === "delete"` intentionally has NO `on_propose` navigateTo, and its commit nav points to the parent/list path (not the deleted entity → would 404).
- Client treats a turn as an "action turn" (hides trace/breadcrumbs + single-step plan) when `status==="needs_confirmation" || turn.pending || toolResults has a propose_write`.

## Known-stale test (pre-existing, NOT a regression)
- `useCli.test.ts` "tool_result for a different tool does not lift navigateTo" FAILS. Reason: the read-side navigateTo lift (Task #499 generalization) lifts `data.navigateTo` for ANY tool, not just `propose_write`. The test predates #499 and was never updated.
- **Why it matters:** if you see this 1 failure after editing CLI render code, it is not yours — confirm `useCli.ts` is untouched before chasing it.
