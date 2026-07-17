---
name: CRM harness live-LLM flakiness
description: Why the api-server test:crm harness fails intermittently and how to keep it deterministic.
---

The `@workspace/api-server` `test:crm` harness CRUD logic is correct — its intermittent
failures (opportunity persist, archive seed, etc.) come from REAL Anthropic calls the
harness triggers, not assertion bugs. `ATELIER_MOCK_AGENTS=1` is set by the harness but
honored by NO code; agents always call the real API.

**Rule:** keep harness write paths that aren't testing an agent decoupled from live LLM
runs. Opportunity creates pass `runScout: false` — BOTH the REST route and the chat opportunity_create capability await `runPursuitScout` (~45s
otherwise). Account creates still fire a background Cartographer (fire-and-forget, no skip
flag) — that's tolerated because it never blocks the HTTP response or a check.

**Why:** the awaited scout / saturated pg pool under concurrent background cartographers is
what makes later checks flaky. Aborting agents fast (e.g. `ATELIER_AGENT_TIMEOUT_MS=2000
ATELIER_WEBSEARCH_TIMEOUT_MS=2000`) makes the whole suite pass quickly — a good way to
verify CRUD logic without waiting for real LLM latency.

**Known race:** the "reviewed research create did NOT trigger a Cartographer agent run"
check counts ALL `atelier_agent_runs` for the account, but the reviewed-research create
path fire-and-forgets the Executive Mapper, which ALSO writes an agent_runs row for that
account id. Whether the check sees 0 or 1 rows is pure timing (live LLM job vs the next
DB read) — a failure there is this race, not a dedupe/create regression.

**Agent JSON parsing:** `extractFirstJsonObject()` (brace-depth + string-aware) is the
shared extractor used by both `callClaudeJson` and `callClaudeJsonWithWebSearch`; it
recovers prose-WRAPPED JSON. Genuine refusals / pure prose (common for fictional test
accounts: "I cannot provide…", "Based on the limited info…") yield `null` →
`AgentNonJsonResponseError`. Callers (e.g. auto-on-create cartographer) treat that +
abort errors as an EXPECTED "no enrichment" miss and log calm `console.info`, not a
`console.warn` stack trace.
