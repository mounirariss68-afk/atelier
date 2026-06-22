---
name: Cartographer web-search live progress & token budget
description: Two durable traps in the Account Cartographer web_search run — frozen live caption, and a token budget shared with web search that truncates the JSON.
---

# Cartographer web_search run — durable traps

The Account Cartographer makes one Anthropic `web_search` streaming call whose
final answer is one large JSON brief. Two non-obvious failure modes:

## 1. Live caption freezes during the silent compose gap
The chat caption shows the latest live-progress step. The model emits NO stream
events in two windows, so a caption that only updates on events freezes while
the elapsed timer keeps ticking:
- between the last source read and the first answer token (model composing the
  JSON internally — can be tens of seconds);
- the long answer stream tail.

**Rule:** the heartbeat must NOT wait for the first answer token. After a source
read, if the model goes quiet, promote to a live "Analysing sources…" heartbeat;
a new search cancels/pauses it; the first answer token flips it to
"Synthesising the brief…". Backend + frontend must share ONE stable phase key so
the caption coalesces consecutive same-phase steps into one updating row —
otherwise interleaving heartbeat ticks with discrete breadcrumbs floods the
trace, so pause the heartbeat during active search.
**Why:** users reported "after reading sources the counter increases but doesn't
show what is happening" — the compose gap was uncovered.

Also: persisted run-row progress (drives the account-page bar) must be clamped
to a monotonic high-water max, because phases interleave non-monotonically and
the bar would visibly backstep. The chat caption is unaffected (shows the status
message, not pct).

AsyncLocalStorage note: timer callbacks created inside the progress-sink
`store.run(...)` DO inherit the sink, so emitting progress from a heartbeat
interval works.

## 2. Token budget is shared with web search → truncated JSON
`max_tokens` is shared between the web_search tool-use blocks + search-query
tokens AND the final JSON brief. A budget sized only for the brief gets
exhausted by the searches and truncates the JSON mid-array → `JSON.parse` throws
"Expected ',' or ']' after array element".
**Rule:** keep generous output headroom (Sonnet 4.5 allows 64K output; unused
tokens are not billed). Parse first, and only if parse fails AND
`resp.stop_reason === "max_tokens"` throw an actionable truncation error — a
response that completes exactly at the cap is still valid and must not be
rejected.
