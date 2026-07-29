# Chat reliability harness & telemetry

Standing regression suite + telemetry rollup for the chat pipeline
(replay window → session facts → clarification resolver → orchestrator →
client reducers). Built after the 2026-07-29 "non-sensical conversation"
incident (re-asked answered questions, "5 nights" / "same dates" /
"confirmed" dead ends).

## Test suites

| Script | What it pins | Style |
|---|---|---|
| `test:chat-replay` | verbatim replay-window composer | pure, offline |
| `test:chat-facts` | typed session-fact extraction/render | pure, offline |
| `test:chat-clarify` | clarification resolver parsers/outcomes | pure, offline |
| `test:chat-parity` | shared web+mobile reducer (`@workspace/chat-core`) protocol fixtures | pure, offline |
| `test:chat-convo` | **conversation-level harness**: multi-turn dialogues through the REAL orchestrator (in-process `/cli/turn` SSE, scratch DB, stub Anthropic + stub travel providers) | integration, offline |
| `test:chat-suite` | all of the above, in order (cheap → expensive) | — |

Run: `pnpm --filter @workspace/api-server run test:chat-suite`
(the conversation harness provisions the isolated `crm_test` scratch DB —
first run can exceed 2 minutes; never points at the live DB).

### Conversation harness scenarios (`tests/chat/conversation-probe.ts`)

- **S1** verbatim 2026-07-29 archetype: flight dates stated → hotels ask →
  "5 nights" → real provider search with typed dates; exactly ONE
  clarification round in the whole conversation.
- **S2** referential "same dates I specified" + double-send (second tab /
  SSE retry): explicit "already answered", no second provider call.
- **S3** "confirmed" executes the pending tool — no post-confirm dead end.
- **S4** fresh request while pending never drops the question; the
  superseded turn stays resumable and answerable later.
- **S5** Arabic-Indic ("٥ ليال") and Turkish ("5 gece") answers resolve to
  typed dates.
- **S6** LLM outage mid-clarification: typed answers still resolve
  deterministically; unparsed answers degrade to an honest re-ask.
- **S7** self-only persona isolation: employees clamped to me.* tools,
  cannot resume another user's clarification, cross-user facts load empty.

Adding a scenario: reuse `seedFlightFacts`/`askHotels`/`postTurn` helpers;
every turn must pass `assertAlive` (final frame, non-error status) — that
is the dead-end guard.

Attachment-carrying continuations are covered by `test:cli-attachments`;
protocol/client edge cases by `test:cli-parity` and mobile probes.

## Validation gate

A named validation step **`chat-reliability`** is registered (validation
workflow) running `test:chat-suite`. Run it before merging any change to:
`src/lib/atelier-cli/*` (orchestrator, resolver, facts, replay),
`lib/chat-core/*`, or `/cli/*` routes.

## Telemetry rollup

All chat reliability signals are single-line
`[cli-telemetry] {"evt":...}` JSON logs. Events:

- `clarification_issued` — `{turnId,tool,field,continuation,reaskSameField,confirmDeadEnd}`
- `clarification_resumed` — `{turnId,tool,field,controlIntent,resolver,via}`
- `clarification_superseded` — fresh request while a question was pending
- `clarification_already_answered` — duplicate-answer consumption guard
- `clarification_llm_assist` — deterministic parse gap filled by Haiku
- `replay_window`, `session_facts`, `tool_menu` — context assembly health

Rollup (dev logs land in `/tmp/logs/*.log`; production via deployment logs):

```bash
pnpm --filter @workspace/api-server run chat:telemetry-rollup /tmp/logs/*.log
# machine-readable:
pnpm --filter @workspace/api-server run chat:telemetry-rollup --json /tmp/logs/*.log
```

Health flags to watch:
- `reaskRate` — re-asked same field after an answer / issued. Spikes mean
  resolver merge regressions.
- `deadEndRate` — affirmative answers that re-asked ("confirmed" loops).
- `dupAnswerRate` — duplicate consumption attempts (client retry storms).

Ad-hoc queries without the script:

```bash
grep -o '\[cli-telemetry\] .*' app.log | sed 's/\[cli-telemetry\] //' \
  | jq -s 'group_by(.evt) | map({evt: .[0].evt, n: length})'
```
