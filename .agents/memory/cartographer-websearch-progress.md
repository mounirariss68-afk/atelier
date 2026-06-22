---
name: Cartographer web-search live progress
description: Why the Account Cartographer chat caption freezes mid-run and how the heartbeat must be shaped to avoid it.
---

# Cartographer web-search live progress (chat caption never freezes)

`callClaudeJsonWithWebSearch` (atelier-agents/runner.ts) streams an Anthropic
web_search run. It emits live phases via `emitPhase` → `reportProgress`
(ambient AsyncLocalStorage sink) → chat SSE `progress` frames → CommandBar
caption. The caption shows the latest trace entry of `kind:"step"`.

**The trap:** there are TWO silent windows where the model emits NO stream
events, so a caption that only updates on events freezes while the elapsed
timer keeps ticking:
1. Between the last `web_search_tool_result` and the first answer `text_delta`,
   the model composes the large JSON answer internally — can be tens of seconds.
2. The long answer stream tail itself.

**Rule:** the live heartbeat must NOT wait for the first `text_delta`. After each
search result, arm a short (~2s) timer that promotes the caption to a live
"Analysing sources… (Ns)" heartbeat if no new search starts; a new search must
cancel that timer AND pause the heartbeat; the first `text_delta` flips the
label to "Synthesising the brief… (Ns)". Always clear timer + interval in the
stream's `finally`.

**Why:** users reported "after reading the sources, the seconds counter
increases but doesn't show what is happening" — window 1 was uncovered.

**How to apply (two coupling constraints):**
- Backend and frontend must agree on a stable `phase` key (`"synthesis"`). The
  CommandBar coalesces *consecutive* same-phase steps into ONE updating row.
  Different keys (or none) append distinct rows; interleaving heartbeat ticks
  with discrete breadcrumbs floods the trace — so pause the heartbeat during
  active search, only run it in the quiet compose/stream tail.
- Persisted run-row `progressPct` (atelier_agent_runs, drives the account-page
  bar) MUST be clamped to a high-water max inside `emitPhase`. Phases
  interleave non-monotonically (heartbeat 80–96, then a later search emits 35),
  which would visibly backstep the bar. The chat caption is unaffected (it
  shows the status message, not pct).

AsyncLocalStorage note: timer callbacks (`setTimeout`/`setInterval`) created
inside `runWithProgressSink`'s `store.run(...)` DO inherit the sink, so emitting
progress from a heartbeat interval works.
