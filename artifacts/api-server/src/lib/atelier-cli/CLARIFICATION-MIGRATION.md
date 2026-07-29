# Clarification resolver — migration-mode matrix (Task #740)

The shared clarification resolver (`clarification-resolver.ts`) owns
answer classification and typed resolution for pending clarifications.
Flag: `ATELIER_CLI_CLARIFICATION_RESOLVER` = `on` (default) | `off`
(kill switch → full legacy path: shape-heuristic gate + raw-text merge).
Model-assisted fallback has its own switch: `ATELIER_CLI_RESOLVER_LLM`
= `on` (default) | `off` (probes run with it off; any LLM failure
degrades to the legacy raw merge and NEVER clears pending state).

Wire compatibility: `needs_clarification` frames, `continuesTurnId`,
`clarificationValues`, and the persisted pending-state schema
(`field/question/tool/partial/fields/originalPrompt`) are unchanged.
No data migration is needed to flip the flag either way.

## Existing clarification-adjacent mechanisms

| Mechanism | Mode | Notes |
| --- | --- | --- |
| Shape-heuristic gate (`looksLikeClarificationAnswer` + `COMMAND_OPENERS`) | **migrates** | Resolver classifies answer vs fresh request. A fresh request no longer silently drops the question — the source turn stays resumable and the question is injected into model context (`[pending question]` primer) + `clarification_superseded` telemetry. Legacy heuristic still used when flag off. |
| Raw single-field merge (`mergeClarificationAnswer(pc.field, answer)`) | **coexists** | Final fallback when the resolver returns `unparsed` and the LLM assist declines — the tool re-validates and re-asks. Dotted-path semantics unchanged. |
| Multi-field form answers (`clarificationValues`, dotted names) | **coexists** | Take precedence over the resolver; merged exactly as before (allow-listed fields, dotted expansion via `mergeClarificationAnswer`). Covered by mobile/web form clients. |
| Typed-name confirm guard (destructive-verb typed-name confirmation) | **coexists** | Lives on the confirm protocol (pending WRITE), not the clarification path; resolver never touches `confirmPendingWrite`. `normalizeControlIntent` affirm/decline handling there is unchanged. |
| Disambiguation envelopes (`needs_disambiguation`, person/option pickers) | **coexists** | Emitted by tools as clarifications with `options`; resolver ADDS ordinal/option matching ("the second one", "ikinci", "الثاني") on top of exact replies. Envelope shape untouched. |
| Meeting-chat `needs_disambiguation` + fixed-choice normalization (foldRosterName) | **coexists** | Meeting tools keep their own normalizers; the resolver's option matching applies only when the pending `fields[].options` are present, and exact matches win first. |
| Mid-flow correction rerouting (`reRouteClarificationAnswer`, Task #570, schedule_internal/client_meeting) | **coexists** | Checked BEFORE the resolver values in the continuation, preserving "actually make it 9am" behavior verbatim. |
| Guided-travel `addReturn`/`returnDate` follow-ups | **migrates (additively)** | Date replies now resolve to ISO deterministically ("next Tuesday", "yarın", "بعد غد"); "5 nights" derives returnDate/checkOut from the anchor date; behavior identical for already-ISO answers. |
| Cancel control intent (Task #741 short-circuit) | **migrates** | Resolver `cancel` extends the same short-circuit to declines ("no", "لا") when the asked field has no yes/no options. Yes/no-optioned fields keep receiving the literal option value. |
| Confirmations while pending ("confirmed", "yes go ahead") | **migrates** | Affirm now RUNS the pending tool with the confirmed partial (+fact-derived date fills) instead of raw-merging "confirmed" into a typed field. If fields are still missing the tool re-asks (telemetry: `confirmDeadEnd`). |
| Session-facts referential answers ("same dates I specified") | **new** | Resolved against typed session facts (Task #741); requires facts mode ≠ off. Without matching facts → `unparsed` → honest re-ask. |
| Rehydration / cross-session resumability (Task #410/#184) | **coexists** | Untouched; resolver runs after rehydration. Duplicate explicit answers to an already-consumed question now get an explicit "already answered" narration (`clarification_already_answered`). |
| Attachment continuity primer | **coexists** | Deterministic continuations carry attachment refs inside `partial` as before; the 30-min `[earlier attachments]` primer applies to model turns only. |

## Telemetry (all under `[cli-telemetry]`)

- `clarification_issued` — continuation re-pause; includes `reaskSameField`, `confirmDeadEnd`.
- `clarification_resumed` — every continuation; includes resolver outcome kind + `via`.
- `clarification_superseded` — fresh request while pending (question kept resumable).
- `clarification_already_answered` — duplicate explicit continuation.
- `clarification_llm_assist` — model-assisted fallback attempted; `merged` flag.

## Ordering guarantee

Pending-clarification resolution runs BEFORE the model loop, and the
turn-opening intent classifier runs `deterministicOnly` for explicit
continuations — a pending clarification can never be diverted by tool
retrieval; the classifier only matters when the resolver ruled the
reply a fresh request.
