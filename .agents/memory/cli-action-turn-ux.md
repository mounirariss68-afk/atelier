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
- `useCli.test.ts` "tool_result for a different tool does not lift navigateTo" FAILS. Reason: the client now lifts `data.navigateTo` for ANY tool's result, not just `propose_write`; the test predates that generalization and was never updated.
- **Why it matters:** if you see this 1 failure after editing CLI render code, it is not yours — confirm `useCli.ts` is untouched before chasing it.

## Live agent progress streaming into chat
- Every chat-dispatched agent streams live step breadcrumbs + a ticking mm:ss timer into the turn, replacing a static "Thinking…". Mechanism is an ambient AsyncLocalStorage sink (`atelier-agents/progress-sink.ts`): `runWithProgressSink(sink, fn)` wraps tool execution in the CLI; `reportProgress(pct,msg)` anywhere inside flows to the active sink → a `{type:"progress"}` SSE CliFrame.
- **Why ALS:** one chokepoint covers all agents with no per-capability plumbing; harness agents emit via `ctx.progress`→`progressRun`, direct callers via `progressRun`, and the cartographer's single atomic web_search emits sub-steps because `callClaudeJsonWithWebSearch` uses `anthropic.messages.stream`.
- **Double-emit pitfall:** `reportProgress` lives in exactly ONE place per path — inside `progressRun`. Do NOT also call `reportProgress` from `runAgent`'s `ctx.progress` (it calls `progressRun`), or every harness step emits twice. Only call `reportProgress` directly where `progressRun` is NOT also invoked (e.g. research_only / `runId` null).
- **Structured progress payloads:** `reportProgress(pct,msg,data?)` / `ProgressSink` carry an optional `data` object forwarded verbatim into the SSE progress frame (`{...data}` spread alongside pct/message). Used so the web-search "Read N sources" step ships its deduped `{url,title}[]` and the trace breadcrumb can expand to clickable source links. The 3rd arg is optional → all existing `reportProgress(pct,msg)` callers stay compatible.
- **Untrusted source URLs:** source URLs come from external web-search results. Any URL rendered as an `<a href>` MUST pass `isSafeHttpUrl` (http/https only) — gate at ingest (`useCli` progress handler) AND defensively at render. A bare `typeof url === "string"` check is NOT enough (a `javascript:` scheme would become a live link).
