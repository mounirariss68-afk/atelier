# Riser complete remediation plan

**Status:** proposed for approval  
**Prepared:** 2026-09-19  
**Source audit:** [Riser intent architecture audit](./riser-intent-architecture-audit.md)  
**Scope:** complete remediation of every issue identified by the architecture
audit and two subsequent challenge passes

## 1. Approval decision

Approval of this plan authorizes implementation of all five stages and all 27
closure items below. No stage or item is optional. Staging controls dependency
order and rollout risk; it does not defer identified issues to a later plan.

Riser is considered remediated only when:

1. C1–C27 are implemented;
2. every stage exit gate passes;
3. migration and rollback rehearsals pass with active conversations, pending
   actions, and running work;
4. all 326 current catalog entries pass the new manifest and parity gates;
5. old supported web/mobile clients remain safe during the compatibility
   window;
6. the release-blocking evaluation thresholds pass; and
7. the legacy CLI protocol is retired only after measured client adoption and
   replay compatibility prove it is safe.

## 2. What the two additional passes added

### Pass 2: what the original audit plan missed

The first audit identified the main architectural defects, but its roadmap did
not fully close:

- strict ingress validation and caller-supplied intent isolation;
- stale confirmations and policy changes between preview and commit;
- unsafe generated agent schemas and over-broad agent role declarations;
- exactly-once behavior across disconnects and partial failures;
- idempotency key scope, storage, conflicts, and retention;
- cancellation, deadlines, orphan reconciliation, and post-cancel effects;
- secret/PII handling across prompts, storage, logs, telemetry, and providers;
- SSE event replay, ordering, terminal recovery, and proxy behavior;
- persisted legacy turn, clarification, and pending-write migration;
- capability manifest pinning and full route/service parity;
- operator kill switches and manual recovery;
- concrete SLOs, alerts, canary gates, and rollback triggers; and
- release-blocking fixture ownership rather than aggregate target percentages.

### Pass 3: what was still missing after Pass 2

The combined work still needed implementation-grade closure:

- named versioned contracts and state machines;
- exact dependency ordering;
- expand/dual-write/backfill/cutover/contract data migrations;
- version negotiation and web/mobile skew handling;
- rollback behavior while writes or workflows are active;
- per-item security invariants;
- deterministic acceptance tests for every issue;
- owners and operational runbooks; and
- a rule that no item may be accepted merely because code exists.

This plan adds those missing elements.

## 3. Non-negotiable design rules

1. **The model interprets; the server authorizes.** Model output may propose
   intents, plans, arguments, narration, and presentation. It cannot grant
   authority, establish identity, confirm a write, or declare execution
   success.
2. **Every write is action-bound.** A durable, immutable action record binds
   requester, organization, input digest, target revisions, catalog/schema
   versions, policy decision, expiry, confirmation evidence, and result.
3. **Execution evidence is not presentation.** A successful tool result does
   not automatically create a card.
4. **No phantom work.** A specialist handoff returns a real authorized run/work
   id or an explicit unsupported result.
5. **Conversation and work are separate.** Conversation events may reference
   work, but closing or deleting a conversation cannot erase work or audit
   lineage.
6. **Atomic operations stay atomic.** The workflow runtime is used only for
   long-running or genuinely multi-step work.
7. **Compatibility is additive.** New readers and upcasters ship before new
   writers. Old supported clients remain safe throughout the migration.
8. **Rollback is a state transition, not only a code revert.** Rollback freezes
   new plans, reconciles active actions/runs, and finishes or compensates work
   according to declared policy.
9. **Security gates have zero tolerance.** Aggregate quality thresholds never
   excuse an authorization, tenant-isolation, confirmation, or duplicate-write
   failure.

## 4. Target contracts

### 4.1 Assistant protocol

Create a shared package for versioned Zod schemas:

```text
AssistantRequestV1
AssistantEventV1
InterpretedIntentV1
CapabilityCandidateV1
ResolverResultV1
PolicyDecisionV1
ActionPreviewV1
ConfirmationRequiredV1
ExecutionResultV1
PresentationV1
TurnCompletedV1
PublicErrorV1
```

Every event carries:

```ts
{
  protocolVersion: 1;
  conversationId: string;
  turnId: string;
  eventId: string;
  sequence: number;
  occurredAt: string;
  correlationId: string;
  type: string;
  data: unknown;
}
```

Unknown additive events are ignored safely by clients. Unknown versions are
rejected or negotiated; they are never guessed.

### 4.2 Durable action state machine

```text
draft
 → previewed
 → awaiting_confirmation
 → confirmed
 → executing
 → succeeded | failed | partially_succeeded | compensated

awaiting_confirmation → cancelled | expired | invalidated
confirmed → invalidated (before executor claim only)
```

Terminal states are immutable. The executor claims a confirmed action with a
fencing token. Confirmation never directly performs an unrecorded side effect.

Required action fields:

```text
id, orgId, requesterId, conversationId, sourceTurnId
capabilityId, catalogVersion, inputSchemaVersion, inputDigest
canonicalInputEncrypted, targetRefsAndRevisions
policyVersion, policyDecisionDigest, obligations
riskClass, irreversible, outboundChannels
previewSnapshot, typedEvidenceDigest, expiresAt
state, stateVersion, idempotencyKey, executorFence
result, publicError, auditEventIds
createdAt, confirmedAt, claimedAt, completedAt
```

### 4.3 Durable workflow state

```text
WorkItem → Plan(versioned) → Step(DAG) → Attempt
                              └→ Checkpoint
```

Every step has scoped authority, tool/data perimeter, budget, dependencies,
retry policy, lease/fencing token, result schema, and optional compensation.

## 5. Stage sequence

```text
S0 Safety and compatibility foundation
  ↓
S1 Semantic interpretation and authority
  ↓
S2 Durable actions, protocol, presentation, and parity
  ↓
S3 Durable multi-step workflows
  ↓
S4 Cutover, deprecation, and operational completion
```

S0 readers/upcasters ship before any new persisted shape. S1 cannot weaken
existing policy. S2 completes atomic action correctness before S3 introduces
workflow concurrency. S4 is the only stage allowed to retire legacy paths.

## 6. Complete closure register

### S0 — Safety and compatibility foundation

#### C1. Strict ingress and bounded context

**Problem:** request bodies and nested context are partially cast or
individually checked rather than validated as one strict versioned envelope.

**Fix**

- Add strict `AssistantRequestV1` Zod validation.
- Reject unknown fields and bound prompt, history, page context, attachment ids,
  clarification values, locale, timezone, and continuation identifiers.
- Allowlist page-context fields.
- Re-resolve attachments by organization, owner/visibility, status, and
  supported media class before orchestration.
- Return stable public error codes; keep internal details server-side with a
  correlation id.

**Primary code areas**

- `src/routes/atelier/cliRoutes.ts`
- new shared assistant protocol package
- attachment resolution services

**Migration:** current `/cli/turn` adapter upcasts the old body into V1.  
**Rollback:** strict validation may be disabled only for a logged compatibility
cohort; org/attachment validation remains mandatory.  
**Security invariant:** malformed or foreign context never reaches a model,
resolver, or capability.  
**Gate:** fuzz nested/oversized/unknown fields and foreign attachment ids;
expect typed 4xx and zero orchestration/provider calls.

#### C2. Remove caller-supplied intent from authority

**Problem:** the request contract accepts a client `intent` value even though
server interpretation must be authoritative.

**Fix**

- Remove it from the new request contract.
- The legacy adapter may retain it only as quarantined diagnostic metadata.
- Prove candidate selection, model tier, policy, and writes are identical with
  benign, malicious, or absent caller intent.

**Migration:** old requests are accepted, but the field is ignored and logged
without content.  
**Rollback:** restore adapter parsing only; never restore authority.  
**Security invariant:** forged intent cannot widen tools or authorization.  
**Gate:** differential forged-intent suite produces identical authorized
behavior.

#### C19. Legacy turn, frame, clarification, and pending-write replay

**Problem:** persisted legacy states must survive protocol and action migration.

**Fix**

- Add a deterministic versioned upcaster for every persisted turn status and
  frame type.
- Preserve original payload plus source protocol, prompt, catalog, schema, and
  policy versions where known.
- Map eligible legacy pending writes to durable actions without executing them.
- Resume clarifications by stable turn/action id rather than “most recent.”
- Keep the upcaster through the full retention/deprecation window.

**Primary code areas**

- `src/lib/atelier-cli/index.ts`
- `lib/chat-core`
- turn/session persistence schema
- mobile/web rehydration hooks

**Migration:** expand schema → dual-read legacy/new → backfill deterministic
metadata → verify counts/digests → enable new writes.  
**Rollback:** keep original payloads and legacy readers; never down-convert away
new audit data.  
**Security invariant:** upcasting cannot widen original authority or silently
confirm a pending write.  
**Gate:** replay fixtures for every legacy status, including pending
clarification, pending confirmation, cancelled, partial, error, and completed;
zero lost or duplicate writes.

#### C21. Secret and PII lifecycle

**Problem:** sensitive data can pass through prompts, clarification state,
frames, logs, summaries, telemetry, and external providers without one complete
classification and retention contract.

**Fix**

- Classify data fields and providers.
- Normalize and minimize before provider calls.
- Encrypt sensitive persisted action/work inputs.
- Redact logs, public errors, frames, summaries, and telemetry.
- Define key ownership, access audit, retention, deletion, and legal holds.
- Prohibit secret values in correlation metadata and model-output logs.
- Add provider allowlists by data class.

**Primary code areas**

- assistant protocol schemas
- logging/telemetry helpers
- turn/action/work persistence
- provider adapters

**Migration:** add encrypted columns and redaction version; quarantine and
delete legacy telemetry where permitted.  
**Rollback:** disable the affected provider/capability and quarantine logs,
rather than emitting sensitive data through an old path.  
**Security invariant:** unauthorized users, operators, clients, providers, and
logs never receive restricted values.  
**Gate:** planted canary-secret fixtures are absent from prohibited prompts,
logs, traces, events, errors, cards, summaries, and telemetry.

**S0 exit gate**

- C1, C2, C19, and C21 pass.
- Legacy clients still work through the adapter.
- No new persistent writer is enabled.
- Security review approves the request, error, data-classification, and replay
  contracts.

### S1 — Semantic interpretation and authority

#### C3. Typed interpretation, abstention, ambiguity, and multi-intent

**Problem:** classifier strings are cast rather than fully runtime validated;
abstention, negation, conflicting intents, and destructive ambiguity are
underspecified.

**Fix**

- Runtime-validate model output with `InterpretedIntentV1`.
- Represent operation, goal, mentions, constraints, confidence, ambiguity
  class, abstention reason, and multiple intents.
- Add explicit semantics for negation, corrections, code-switching, referential
  continuations, conflicting writes, and destructive ambiguity.
- Invalid model output receives one bounded repair attempt, then deterministic
  fallback or clarification.
- The interpreter never emits canonical ids or policy decisions.

**Primary code areas**

- `src/lib/atelier-cli/intent-router.ts`
- orchestrator prompt and parser
- evaluation fixtures

**Migration:** dual emit legacy classification and typed interpretation for
comparison; legacy selection remains authoritative until gates pass.  
**Rollback:** route by model/router version; retain typed telemetry.  
**Security invariant:** interpretation cannot grant authority.  
**Gate:** invalid enums, paraphrases, negation, Arabic/French/Turkish,
code-switching, corrections, multi-intent, and destructive ambiguity fixtures
all validate, clarify, or abstain safely.

#### C4. Remove brittle semantic fallbacks and arbitrary tool selection

**Problem:** ordered regex semantics, duplicated opener rules, prose-based
no-tool detection, and alphabetical filler can select unrelated capabilities.

**Fix**

- Consolidate slash and `/new` parsing into compatibility adapters.
- Retain deterministic rules only for control messages, typed clarification
  parsing, safety escalation, and bounded provider-outage fallback.
- Replace prose scanning with typed `selected`, `clarify`, `unsupported`,
  `abstain`, and `provider_unavailable` outcomes.
- Remove alphabetical filler.
- Calibrate embedding thresholds per intent/capability family.
- Never widen outside persona/policy eligibility.

**Primary code areas**

- `intent-router.ts`
- `capability-retriever.ts`
- clarification resolver/openers
- `index.ts`

**Migration:** shadow old and new selection, recording disagreement without
executing shadow choices.  
**Rollback:** feature-flag the previous ranked selector only; arbitrary filler
stays disabled.  
**Security invariant:** provider or embedding failure cannot select an
unrelated or unauthorized capability.  
**Gate:** top-1 ≥95%, top-3 ≥99%, unsupported abstention ≥98%, and zero
unrelated tools during provider/embedding outage.

#### C5. Canonical resolver contract and stale-target handling

**Problem:** resolution needs an explicit typed boundary for ambiguity, tenant
scope, stale ids, renames, deletes, and commit-time changes.

**Fix**

- Return `unique`, `ambiguous`, `not_found`, or `stale`.
- Only the server produces canonical ids.
- Attach organization, entity type, visibility decision, and target revision.
- Resolve under persona ACL before capping candidates.
- Re-resolve/revalidate target and revision at commit.

**Primary code areas**

- entity resolver and detail capabilities
- action preview/commit adapter

**Migration:** add resolver version and target revisions to events/actions.  
**Rollback:** old resolver may serve reads behind a kill switch; writes require
the new contract.  
**Security invariant:** model-provided or foreign ids never cross tenant/ACL
boundaries.  
**Gate:** foreign, deleted, renamed, stale-revision, invisible, and ambiguous
targets cannot commit; valid unique targets succeed.

#### C6. Central, persisted, rechecked policy decisions

**Problem:** role/ACL/risk checks exist but are not represented as one versioned
decision with obligations that can be rechecked at execution.

**Fix**

- Add `PolicyDecisionV1`: allow with obligations, deny, or clarify.
- Include persona, organization, record ACL, role, capability effects, target
  risk, confirmation class, outbound/irreversible obligations, and policy
  version.
- Persist a decision digest on actions/workflow steps.
- Re-evaluate immediately before executor claim and fail closed on drift.

**Primary code areas**

- capability catalog role filtering
- route/service ACL helpers
- action/workflow runtime

**Migration:** shadow central decisions against current gates before
enforcement.  
**Rollback:** fall back to the old policy adapter only if it denies at least as
strictly; never allow on policy outage.  
**Security invariant:** authorization is deterministic and current at commit.  
**Gate:** full persona × sensitive-capability matrix; role removal, ACL change,
deactivation, org change, and risk escalation after preview all deny.

#### C7. Real specialist dispatch

**Problem:** generated agent capabilities can claim dispatch without starting
trackable work.

**Fix**

- Replace dispatch hints with an atomic adapter that validates input/policy,
  creates a run/work row and audit event, and returns its real id.
- If an agent is not executable, return typed `unsupported`.
- Bind run/work to organization, requester, target, budget, catalog/schema
  versions, and parent lineage.
- Remove any `dispatched:true` result not backed by durable state.

**Primary code areas**

- `src/lib/atelier-cli/agent-capabilities.ts`
- `src/lib/atelier-agents/runAgent.ts`
- agent routes and registry

**Migration:** mark non-executable generated entries unsupported until their
real adapters pass.  
**Rollback:** disable generic agent capabilities; bespoke authorized routes
remain.  
**Security invariant:** no success or progress claim without authorized durable
work.  
**Gate:** every catalog agent either returns a real run/work id with audit and
terminal state or returns unsupported.

#### C8. Safe generated agent schemas

**Problem:** schema introspection can collapse unions, enums, defaults, and
nested constraints or fall back to permissive additional properties.

**Fix**

- Generate checked JSON/Zod schemas from the registry.
- Preserve unions, enums, defaults, nested bounds, discriminators, and unknown
  property behavior.
- Hash the executable validator.
- Fail capability registration closed if a schema cannot be represented.

**Primary code areas**

- `agent-capabilities.ts`
- agent registry/types
- catalog bootstrap

**Migration:** compare old/new schemas and require reviewed adapters for
breaking changes.  
**Rollback:** reject the affected capability rather than use a permissive
schema.  
**Security invariant:** malformed or unknown arguments never reach preview,
confirmation, or execution.  
**Gate:** catalog hash equals runtime validator; generated invalid-input corpus
is rejected.

#### C22. Atomic budgets and rate ownership

**Problem:** limits are not one atomic hierarchy across organization, persona,
work, child agent, provider, and concurrency.

**Fix**

- Add budget ledger reservations, commits, refunds, and exhaustion events.
- Propagate parent budget ids and hard ceilings to children.
- Add provider-call, token/cost, wall-time, tool-call, and concurrency limits.
- Fail closed on budget-ledger outage for costly or write-capable work.

**Migration:** map current limits into ledger policy; shadow reservations before
enforcement.  
**Rollback:** preserve existing hard rate limits and deny new long work.  
**Security invariant:** no child or provider storm bypasses parent/org limits.  
**Gate:** concurrent reservations never exceed quotas; exhaustion prevents
further calls and is audited.

#### C26. Operator controls and incident recovery

**Problem:** there is no complete audited control plane for disabling,
quarantining, reconciling, or manually recovering assistant work.

**Fix**

- Add organization and capability deny switches.
- Add model/provider/version quarantine.
- Add dead-letter and reconciliation views.
- Add audited manual recovery transitions that cannot fabricate approval.
- Define in-flight behavior per switch: finish, pause, cancel, or compensate.

**Migration:** policy decisions record active switch versions.  
**Rollback:** controls themselves fail closed and preserve previous state.  
**Security invariant:** operators cannot silently approve or mutate results.  
**Gate:** disabled capabilities cannot select or commit; every operator action
is scoped, authorized, reasoned, and audited.

**S1 exit gate**

- C3–C8, C22, and C26 pass.
- Policy isolation is 100%.
- Provider failure never selects an unrelated capability.
- No phantom dispatch exists.
- New semantic selection may proceed to S2 action preview, but legacy writes
  remain available until S2 exactly-once gates pass.

### S2 — Durable actions, events, presentation, parity, and evidence

#### C9. Durable confirmation lifecycle

**Problem:** pending tool/input envelopes do not fully bind policy, schemas,
targets, expiry, typed evidence, and single-use state.

**Fix**

- Implement the durable action schema/state machine in section 4.2.
- Preview snapshots are immutable and digest-bound.
- Confirmation checks owner/org, expiry, state version, input digest, schema,
  catalog, policy, target revisions, typed evidence, and obligations.
- Changed conditions invalidate the action and require a new preview.

**Primary code areas**

- action tables/schema
- `/assistant/actions/:id/confirm|cancel`
- legacy `/cli/confirm` adapter
- executors

**Migration:** expand tables → dual-write pending action plus legacy envelope →
backfill eligible old pending writes → dual-read with action precedence →
disable legacy writes.  
**Rollback:** stop new action creation; old pending envelopes remain readable
through upcaster; never discard new action/audit rows.  
**Security invariant:** forged, stale, expired, replayed, or changed actions
cannot commit.  
**Gate:** refresh/relaunch, concurrent confirm, expiry, wrong user, wrong typed
name, deleted target, schema change, and role removal all produce zero
unauthorized commits.

#### C10. Exactly-once execution and partial-failure recovery

**Problem:** disconnect and retry correctness need a complete transaction,
idempotency, outbox, and ambiguous-outcome contract.

**Fix**

- Define canonical idempotency scope:
  organization + requester + action + capability/schema + target.
- Store request hash and reject key reuse with different input.
- Atomically claim action and persist result/audit/outbox with the business
  effect where the database permits.
- For external effects, use durable outbox/inbox and provider idempotency keys.
- Classify retryable, permanent, ambiguous, and compensation-required errors.
- Return the same stored result for valid replays.

**Migration:** add unique indexes, outbox/inbox, result storage, and
reconciliation workers before enabling new executors.  
**Rollback:** legacy confirm adapter targets the same action/executor; reconcile
ambiguous states before restoring writes.  
**Security invariant:** at most one side effect for an action key and no success
without durable audit/result.  
**Gate:** crash/disconnect at every commit boundary and 100 concurrent replays
produce one effect and one stable result.

#### C11. Cancellation, deadlines, expiry, and abandonment

**Problem:** cancellation does not uniformly propagate through turns,
providers, jobs, DB work, and external side effects.

**Fix**

- Propagate cancellation tokens and deadlines.
- Add `cancelled` and `expired` terminal states.
- Define the atomic commit boundary after which cancellation returns the
  committed result rather than pretending reversal.
- Add lease reapers and orphan reconciliation.
- Declare compensation or manual recovery for post-boundary failures.

**Migration:** add terminal states/events and upcast legacy abandoned states.  
**Rollback:** cancellation may be disabled only by denying new long work.  
**Security invariant:** cancellation cannot cause a later unapproved effect.  
**Gate:** cancel during model, provider, DB claim, external outbox, and commit
phases; no post-cancel effect unless the atomic commit had already occurred.

#### C12. Replayable semantic event stream

**Problem:** SSE lacks a complete ordered replay/resume contract.

**Fix**

- Emit `AssistantEventV1` with monotonic per-turn sequence and stable event id.
- Support `Last-Event-ID`, bounded retention, heartbeat, terminal cursor, and a
  status/events endpoint.
- Persist durable events before emission where needed for recovery.
- Dedupe by event id in shared `chat-core`.
- Replaying an event can never execute an action.

**Primary code areas**

- assistant routes
- turn/event persistence
- `lib/chat-core`
- web/mobile transport hooks

**Migration:** server emits new semantic events and legacy `CliFrame` through
an adapter; clients negotiate supported protocol.  
**Rollback:** continue serving legacy frames from durable events.  
**Security invariant:** replay is read-only and scoped to the authorized
conversation.  
**Gate:** disconnect/reconnect at every frame boundary; no missing or duplicate
text, result, card, clarification, confirmation, or terminal event.

#### C13. Explicit, relevant, validated presentation

**Problem:** successful tool results become cards without intent relevance or
minimum meaningful data.

**Fix**

- Add a presentation registry with versioned schemas per card type.
- Each presentation declares `answersIntentIds`, capability/result source,
  primary or supplementary relationship, minimum-data version, and relevance
  reason.
- Validate allowed capability/card combinations.
- Suppress intermediate resolver/gate/prefill results.
- Empty lists render only when explicitly requested and meaningful.
- Unknown card types are non-authoritative safe generic results or omitted;
  they never imply success.

**Primary code areas**

- catalog/card registry
- orchestrator result synthesis
- `lib/chat-core`
- web/mobile result renderers

**Migration:** dual emit legacy result and semantic presentation; new clients
render only presentation events; old clients receive server-filtered legacy
cards.  
**Rollback:** cohort flag can restore legacy rendering for legacy clients only;
server relevance and data-disclosure checks remain.  
**Security invariant:** cards cannot disclose unrelated data or imply
authorization/execution.  
**Gate:** CEO answer plus unrelated/empty positions emits no card; explicit
empty-list request renders a valid empty state; relevance ≥99.5%, unexpected
empty cards zero.

#### C14. Web/mobile semantic and visual parity

**Problem:** shared reduction exists, but clients retain independent
suppression/rendering behavior and can drift.

**Fix**

- Move event reduction and presentation-registry dispatch into shared
  `chat-core`.
- Keep platform-native visual components, but require the same semantic state,
  card eligibility, error outcomes, confirmations, and unknown-event behavior.
- Add capability/event negotiation and minimum supported versions.
- Remove client-only policy/success inference.

**Migration:** support old web/mobile + new server and new clients + legacy
adapter until adoption gates pass.  
**Rollback:** cohort routing restores adapter without changing action state.  
**Security invariant:** no client infers commit or authority from navigation or
presentation.  
**Gate:** golden fixtures produce 100% semantic parity across web/mobile,
including reconnect, old/new version skew, unknown events, and cards.

#### C15. Generated catalog manifest and all-entry gates

**Problem:** the runtime registry is authoritative, but there is no
release-blocking generated manifest and complete parity check for all entries.

**Fix**

- Generate a reviewed manifest containing stable id, tool, source, schema
  version/hash, effects, read/write class, roles, policy class, confirmation,
  irreversibility, outbound channels, card contracts, and implementation
  version.
- Registration is atomic and fails closed for duplicates, invalid schemas, or
  missing policy/presentation contracts.
- Diff the manifest in CI.
- Pin actions and workflow steps to a manifest version.
- Require an approved, reasoned divergence record where parity is intentionally
  absent.

**Migration:** create adapters for actions pinned to old input schemas; never
mutate an old manifest in place.  
**Rollback:** route to a prior valid manifest; incompatible capabilities become
unsupported.  
**Security invariant:** role/effect/schema drift cannot reach production
without review.  
**Gate:** all 326 current entries pass schema, policy, confirmation, effect,
executor, and presentation checks.

#### C16. Route and assistant execution equivalence

**Problem:** source labels do not prove the app route and assistant use the same
business logic or authority.

**Fix**

- Inventory every user-facing read/write route and every catalog capability.
- Move shared operations into one executor/service contract.
- Test route versus capability for auth, validation, record scope, side effects,
  confirmation, idempotency, audit, navigation metadata, and public errors.
- Record intentional differences with owner, reason, and expiry/review date.

**Migration:** convert one capability family at a time behind conformance tests.  
**Rollback:** disable a divergent assistant capability; do not keep an unsafe
fork.  
**Security invariant:** alternate surfaces cannot gain broader authority.  
**Gate:** exhaustive conformance suite reports zero unexplained divergence.

#### C23. Complete, privacy-safe observability

**Problem:** existing telemetry cannot measure no-tool turns, interpretation
accuracy, card relevance, full action state, or workflow recovery.

**Fix**

- Define versioned events for interpretation, candidate selection, abstention,
  resolution, policy, preview, confirm, execute, replay, workflow attempts,
  leases, retries, compensation, presentation proposed/emitted/suppressed, and
  terminal outcomes.
- Correlate conversation, turn, intent, action, work, step, attempt, catalog,
  schema, policy, model, and deployment versions without raw sensitive content.
- Define retention, sampling, unsampled security events, dashboards, SLOs,
  alerts, and incident links.

**Migration:** dual emit old/new telemetry and validate counts before switching
dashboards.  
**Rollback:** telemetry failure cannot authorize work; audit remains durable.  
**Security invariant:** telemetry contains no secrets and has no control-plane
authority.  
**Gate:** completeness checker, trace reconstruction, redaction fixtures, alert
firing, and dashboard queries for no-tool/card relevance/replay gaps.

#### C24. Release-blocking evaluation

**Problem:** target percentages alone do not define fixture versions,
denominators, seeds, severity overrides, or CI behavior.

**Fix**

- Implement `riser-eval/v1` fixture schema and runner.
- Version datasets, expected semantic outputs, model/router/catalog versions,
  seeds, baseline, denominator, and confidence/statistical method.
- Set per-capability minimums and zero-tolerance security classes.
- Record named failing fixtures.
- Gate model, prompt, router, catalog, policy, protocol, and renderer changes in
  CI and canary.

**Migration:** introduce the runner in reporting-only mode against a versioned
baseline, fix all zero-tolerance failures, then make the gates blocking by
change class before production canary.

**Required thresholds**

- policy/tenant isolation: 100%;
- forged or unconfirmed commits: 0;
- exactly-once concurrent replay: 100%;
- supported intent operation accuracy: ≥97%;
- capability top-1: ≥95%, top-3: ≥99%;
- unsupported abstention: ≥98%;
- clarification precision: ≥95%;
- card relevance precision: ≥99.5%;
- unexpected empty cards: 0;
- web/mobile semantic parity: 100%;
- provider faults selecting unrelated capabilities: 0.

**Rollback:** block or revert the offending model/router/catalog/policy version.  
**Security invariant:** aggregate scores never override a zero-tolerance
failure.  
**Gate:** CI and canary fail on any threshold or named severity-one fixture.

**S2 exit gate**

- C9–C16, C23, and C24 pass.
- Durable action exactly-once and replay gates pass.
- All 326 catalog entries pass the manifest/parity checks.
- CEO/unrelated-card and web/mobile golden fixtures pass.
- Dashboards and release-blocking evaluation are live before production
  canary.

### S3 — Durable multi-step workflows

#### C17. Durable work, plans, steps, attempts, and checkpoints

**Problem:** conversation turns and run/status rows do not form a uniform
durable plan runtime.

**Fix**

- Add WorkItem, versioned Plan, Step DAG, Attempt, and Checkpoint tables with
  foreign keys and state constraints.
- Validate acyclic dependencies.
- Bind each step to a catalog manifest, policy decision, scoped authority,
  tools/data perimeter, budget, retry policy, result schema, and optional
  compensation.
- Add lease owner, expiry, and monotonically increasing fencing token.
- Preserve parent/child delegation and evidence lineage.
- Require typed human checkpoint decisions before blocked steps resume.

**Migration:** dual-write selected genuinely multi-step operations; map
identifiable existing agent/background runs to attempts without inventing fake
plans for historical atomic work.  
**Rollback:** freeze new plans, retain/read all work state, and let active steps
finish or compensate according to policy.  
**Security invariant:** every step is independently policy checked and cannot
exceed its authority/data/budget grant.  
**Gate:** DAG cycle, dependency failure, duplicate worker, fence loss,
crash/restart, checkpoint, resume, and compensation tests pass.

#### C18. Workflow execution, retry, recovery, and aggregation

**Problem:** retries, recovery, budget propagation, provider degradation,
escalation, and final aggregation are bespoke rather than uniform.

**Fix**

- Add queue/lease workers with heartbeats and fencing.
- Classify attempts as retryable, permanent, ambiguous, blocked, cancelled, or
  compensation-required.
- Bound retry count, time, cost, and tool/provider calls.
- Pause on provider degradation where safe.
- Escalate exhausted/ambiguous/irreversible failures to audited operator or
  human checkpoints.
- Aggregate final results only from validated step outputs and evidence.
- Reconcile stale leases and process restarts.

**Migration:** adapt existing `atelier_agent_runs` and background jobs behind
the workflow attempt interface while preserving ids and links.  
**Rollback:** stop new work, freeze/reconcile leases, then finish, fail, or
compensate in-flight steps; never delete lineage.  
**Security invariant:** child work cannot exceed parent authority or budget and
cannot falsely report completion.  
**Gate:** kill/restart, timeout, provider outage, budget exhaustion, duplicate
delivery, ambiguous external result, compensation, and final synthesis tests
show no orphan, duplicate effect, or false success.

**S3 exit gate**

- C17 and C18 pass.
- Atomic operations remain on the action executor.
- Long operations survive crash/restart and cross-session resume.
- Retry, compensation, checkpoint, lease, budget, and final-synthesis gates
  pass.

### S4 — Cutover, deprecation, and operational completion

#### C20. Channel-neutral APIs and compatibility cutover

**Problem:** `/cli/*`, `CliFrame`, slash aliases, and conversation-bound work
remain the public architecture.

**Fix**

- Add:
  - `POST /api/assistant/turns`
  - `GET /api/assistant/conversations/:id/events`
  - `POST /api/assistant/actions/:id/confirm`
  - `POST /api/assistant/actions/:id/cancel`
  - `POST /api/workflows`
  - `GET /api/workflows/:id`
  - `GET /api/workflows/:id/events`
  - checkpoint decision and cancellation endpoints.
- Apply exactly the same auth, policy, action, and audit contracts.
- Keep `/cli/*` as a measured compatibility adapter.
- Keep slash commands as optional syntax compiled into normal intents.
- Use client/protocol negotiation and minimum supported versions.

**Migration:** use this sequence:

1. expand readers/upcasters;
2. dual emit semantic and legacy events;
3. dual-write/verify action and selected work state;
4. release new clients;
5. canary new endpoints by cohort;
6. cut over default traffic;
7. retain compatibility until adoption/replay gates pass;
8. contract old writes, then old reads;
9. retain immutable audit/upcasters for the retention period.

**Rollback:** route cohorts to the adapter; freeze new workflows if needed;
never delete durable actions/work.  
**Security invariant:** new endpoints cannot weaken old auth, ACL, confirmation,
or idempotency.  
**Gate:** old clients/new server and new clients/adapter both pass auth,
replay, confirmation, idempotency, and semantic parity fixtures.

#### C25. Staged rollout and tested rollback

**Problem:** code rollback alone cannot safely reverse persisted actions,
events, and running work.

**Fix**

- Add feature flags by protocol, model/router, catalog, policy, action executor,
  workflow family, organization, and client cohort.
- Define automated halt/rollback alarms for security, duplicate commits,
  irrelevant cards, replay gaps, false dispatch, errors, latency, and cost.
- Rollback procedure:
  1. deny new affected actions/plans;
  2. preserve reads/status;
  3. freeze and fence workers;
  4. classify in-flight state;
  5. finish, fail, or compensate according to policy;
  6. reconcile outbox/provider results;
  7. restore compatible routing;
  8. verify audit continuity before writes resume.
- Do not run destructive cleanup during canary.

**Migration:** every stage follows expand → shadow/dual operation →
backfill/verify → cohort canary → cutover → compatibility retention → cleanup;
each transition records its schema/protocol/catalog versions and measured exit
criteria.
**Rollback:** use the eight-step state-aware procedure above; a code/config
revert alone is not an accepted rollback.
**Security invariant:** rollback and operator intervention cannot grant
authority, skip confirmation, lose audit lineage, or execute a side effect
twice.
**Gate:** rehearse rollback at every stage with a pending confirmation, SSE
reconnect, executing external write, running agent/workflow, schema version
skew, and active migration; zero double execution or audit loss.

#### C27. Ownership, documentation, and operational readiness

**Problem:** contracts and stages need accountable owners and complete
operator/client/developer documentation.

**Fix**

- Assign accountable owners for:
  - assistant schemas and compatibility;
  - interpretation/retrieval/evaluation;
  - resolver and policy;
  - action execution/idempotency;
  - catalog and all-entry parity;
  - web/mobile/chat-core;
  - workflow runtime and specialist adapters;
  - security/privacy;
  - data migrations;
  - SRE/telemetry/incident response.
- Publish versioned API/event/schema references, generated catalog manifest,
  migration guides, rollback runbooks, capability authoring rules, client
  compatibility policy, security boundary, and deprecation timeline.
- Add docs/manifest/runbook link checks to CI.

**Migration:** version documentation with the contracts it describes; publish
new and legacy compatibility instructions together, then retire legacy
instructions only after the corresponding supported clients and adapters are
retired.
**Rollback:** retain previous versioned documentation while consumers remain.  
**Security invariant:** docs state the real authority boundary and never imply
the model authorizes or that presentation proves execution.  
**Gate:** documentation-complete CI and owner sign-off for every stage.

**S4 exit gate**

- C20, C25, and C27 pass.
- All previous stage gates remain green.
- Canary and rollback rehearsals pass.
- Client adoption and legacy replay telemetry meet the approved sunset
  threshold.
- `/cli/*` write retirement occurs only after there are no supported clients
  depending on it.
- Final security, data migration, mobile/web, workflow, and SRE sign-off is
  recorded.

## 7. Implementation workstreams and ownership

These workstreams execute the one plan in parallel where dependencies allow.
They are not separate future plans.

| Workstream | Closure items | Accountable discipline |
|---|---|---|
| Protocol and compatibility | C1, C2, C12, C14, C19, C20 | Assistant platform + web/mobile |
| Interpretation and selection | C3, C4, C24 | Applied AI |
| Identity, resolver, and policy | C5, C6, C21, C26 | Security/platform |
| Specialist dispatch and catalog | C7, C8, C15, C16 | Agent platform + domain owners |
| Durable actions | C9, C10, C11 | Platform/backend |
| Presentation | C13, C14 | Assistant platform + design clients |
| Budgets and operations | C22, C23, C25 | Platform/SRE |
| Workflow runtime | C17, C18 | Workflow platform |
| Governance and docs | C27 | Technical program owner + all owners |

Before implementation begins, named people or teams replace discipline labels.
No workstream may self-approve its own security or migration exit gate.

## 8. Delivery slices inside the stages

To keep changes reviewable without dropping scope:

1. **Foundation slice:** protocol package, strict ingress, public errors,
   redaction, legacy fixture corpus, upcasters.
2. **Semantic slice:** typed interpretation, typed selection outcomes, resolver
   result, policy decision, shadow evaluation.
3. **Dispatch slice:** generated schema safety, real specialist dispatch,
   operator switches, budget reservations.
4. **Action slice:** action schema/state machine, confirmation adapter,
   idempotency/outbox, cancellation/reconciliation.
5. **Event/presentation slice:** durable event sequence/replay, card registry,
   shared client reducer, CEO regression.
6. **Catalog/parity slice:** generated manifest and complete 326-entry
   conformance.
7. **Workflow slice:** work schema, leases/fencing, attempts, checkpoints,
   retries/compensation/aggregation.
8. **Cutover slice:** Assistant/Workflow APIs, cohort releases, canary,
   rollback, legacy retirement.

Each slice ships behind disabled or shadow-mode flags until its stage gate
passes.

## 9. Verification matrix

| Risk | Required proof |
|---|---|
| Tenant/role escape | full persona × sensitive capability × foreign target matrix |
| Forged confirmation | owner/org/action digest/typed evidence mismatch produces zero effects |
| Stale preview | target/schema/catalog/policy changes invalidate action |
| Duplicate effect | 100 concurrent confirms and disconnect/retry produce one effect |
| Lost terminal result | SSE reconnect and status recovery return the persisted terminal event |
| Irrelevant card | CEO/person answer fixture suppresses positions and other unrelated cards |
| Empty card | only explicit meaningful empty-result intent may render |
| Phantom agent | every dispatch has durable run/work or unsupported |
| Schema drift | manifest and executable validator hash match |
| Surface privilege drift | route/capability conformance has no unexplained divergence |
| Provider outage | typed degraded/unsupported outcome; zero unrelated tools |
| Secret leakage | canary values absent from prohibited data paths |
| Budget bypass | child/provider concurrency cannot exceed reserved parent/org ceilings |
| Worker split brain | fencing prevents stale worker commit |
| Failed compensation | terminal escalation with preserved evidence and operator action |
| Client skew | old/new server/client compatibility matrix |
| Migration rollback | active action, stream, external write, and workflow drill |

## 10. Required implementation artifacts

The implementation is not complete without:

- versioned Zod schemas and generated API references;
- database migrations and reversible/forward-only migration notes;
- legacy replay fixture corpus and upcasters;
- generated catalog manifest and reviewed diff;
- complete route/capability conformance report;
- `riser-eval/v1` fixtures, runner, baseline, and CI gate;
- web/mobile golden semantic fixtures;
- threat model for the new trust boundaries;
- provider data-classification matrix;
- dashboards, alerts, SLOs, and redaction checks;
- action/workflow reconciliation and dead-letter tools;
- canary and rollback runbooks;
- client deprecation/adoption dashboard; and
- owner sign-off record for every stage.

## 11. Explicitly rejected shortcuts

- Do not remove deterministic authorization, validation, confirmation,
  idempotency, audit, or domain invariants.
- Do not fix card relevance only in clients.
- Do not interpret “tool succeeded” or `navigateTo` as user-visible completion.
- Do not preserve `dispatched:true` as a compatibility lie.
- Do not add a workflow wrapper around atomic reads and writes.
- Do not migrate pending confirmations without preserving owner, policy,
  target, expiry, and typed evidence.
- Do not cut clients over before replay/version-skew tests.
- Do not use aggregate evaluation scores to waive a security failure.
- Do not delete legacy readers, manifests, or upcasters during canary.
- Do not call the remediation complete after S0, S1, or the high-visibility
  card fix; completion requires S0–S4 and C1–C27.

## 12. Approval checklist

Approve only if all answers are “yes”:

- [ ] The five-stage sequence is accepted.
- [ ] C1–C27 are all in scope.
- [ ] Deterministic security and execution controls remain server-owned.
- [ ] The compatibility period supports old web/mobile clients safely.
- [ ] Durable actions are completed before workflow rollout.
- [ ] Only long/multi-step work enters the workflow runtime.
- [ ] Full 326-entry catalog parity is a release gate.
- [ ] Evaluation and telemetry are delivered before production canary.
- [ ] Rollback drills with active state are mandatory.
- [ ] Named accountable owners will be assigned before implementation.
- [ ] Legacy `/cli/*` retirement is evidence-driven, not date-assumed.
- [ ] Final completion requires every stage gate and artifact in this plan.
