# Riser intent architecture audit

**Status:** current-state audit and target design  
**Snapshot:** 2026-09-19  
**Scope:** authenticated Atelier Riser, its specialist-agent handoffs, and the
public-site assistant only far enough to distinguish the two systems  
**Non-goal:** this document does not change prompts, routes, handlers, or clients

## 1. Executive summary

Riser is not one system.

1. The website assistant is a stateless, knowledge-grounded marketing Q&A
   endpoint. It has no Atelier persona, operational tools, approvals, or durable
   work state (`src/routes/chat.ts:52-120,281-432`).
2. Atelier Riser is an authenticated, persona-scoped, session-persisted
   tool-use loop with deterministic capability filtering, validation,
   clarification, two-phase confirmation, execution, and shared web/mobile
   frames (`src/routes/atelier/cliRoutes.ts:1-20,55-64,102-309`;
   `lib/chat-core/src/types.ts:1-55`).
3. The specialist-agent platform is a registry plus several execution styles.
   Some agents have real bespoke runners and routes; some use the shared
   `runAgent` lifecycle; some are stubs; and the generic Riser agent
   capabilities without durable adapters are explicitly unsupported and
   excluded from executable retrieval
   (`src/lib/atelier-cli/agent-capabilities.ts:1-24,119-188`). An agent label,
   run row, or progress table is therefore not proof of a durable agentic
   workflow.

The current separation between probabilistic interpretation and deterministic
policy is directionally correct. Removing deterministic logic would weaken role
isolation, confirmation, idempotency, and business invariants. The required
change is narrower:

- move brittle semantic meaning (ordered keyword and regex interpretation,
  tool-selection guesses, and card relevance) into a typed interpretation and
  selection contract;
- retain deterministic identity resolution, persona and ACL filtering, schema
  validation, confirmation, idempotency, audit, rate/budget limits, and domain
  invariants;
- replace the CLI-centered API and vocabulary with a channel-neutral Assistant
  API and a separate durable Workflow API;
- make presentation an explicit, relevance-checked semantic event rather than
  an automatic side effect of every successful tool result.

The CEO/positions failure is structurally possible and reproducible from the
current contracts: if a turn emits a correct CEO narration and any additional
successful tool result tagged `ranked_list`, both clients retain and render the
list even if it is unrelated. No server or client layer evaluates whether the
card answers the user's request. The repository does not contain the original
production trace, so the exact tool that produced that historical card remains
unknown. The verified defect is the missing relevance boundary, not a specific
CEO resolver.

## 2. Evidence and method

Material claims in this report are based on:

- source paths and line ranges cited inline;
- a runtime catalog export produced by importing
  `bootstrap-capabilities.ts` and calling `listCapabilities()`;
- existing deterministic probes and parity suites;
- a contract-level replay of the CEO/card frame sequence against the documented
  server and shared reducer shapes.

Runtime catalog snapshot:

```text
entries=326  reads=108  writes=218  auto-registered-agents=60
```

The export command used was:

```bash
cd artifacts/api-server
pnpm exec tsx -e '(async()=>{await import("./src/lib/atelier-cli/bootstrap-capabilities.ts");
const {listCapabilities}=await import("./src/lib/atelier-cli/capability-catalog.ts");
const xs=listCapabilities();
console.log(JSON.stringify(xs.map(c=>({id:c.id,tool:c.toolName,module:c.module,
mode:c.isWrite?"write":"read",confirm:c.twoPhaseConfirm,
irreversible:c.irreversible,outbound:c.outboundChannel,
roles:c.requiredRoles??["default"],card:c.resultCard,source:c.source})),null,2));})()'
```

The catalog is authoritative at runtime: duplicate ids/tool names fail
registration, schemas are hashed, and successful writes are wrapped by the
navigation contract (`capability-catalog.ts:327-447`). The authenticated
`GET /api/atelier/cli/capabilities` endpoint exposes the role-filtered matrix
used by both clients (`cliRoutes.ts:777-817`; web `useCli.ts:165-175`; mobile
`useChat.ts:43-79`).

Known evidence limitation: the original CEO production SSE frames and persisted
turn were not found. This report does not invent that missing trace.

## 3. Two assistants, two responsibilities

| Dimension | Website assistant | Atelier Riser |
|---|---|---|
| Ingress | `POST /api/chat` | `POST /api/atelier/cli/turn` |
| Identity | IP rate limit; no Atelier persona in handler | active authenticated persona required |
| Purpose | Cognirise website/services Q&A | read and operate the authenticated platform |
| Grounding | hard-coded site knowledge and content package | session replay/facts, attachments, page context, DB-backed capabilities |
| Tools | none | role-filtered catalog and tool-use loop |
| Writes | none | preview, confirm, execute, audit |
| State | request history supplied by caller | persisted sessions, turns, pending clarification/write |
| Output | token SSE, `done`, validated site suggestions | semantic SSE frames shared by web/mobile |
| Provider failure | Anthropic → OpenAI → offline website template | classifier fallback exists; orchestrator/tool failures are structured |

Website evidence: `routes/chat.ts:81-120,133-152,155-279,281-432,581-599`.
Atelier evidence: `cliRoutes.ts:102-309,313-374`; shared frame types
`lib/chat-core/src/types.ts:12-55`.

The adjacent `/api/chat/personal-agent` route is also not Atelier Riser. It is a
demo-oriented prompt-driven endpoint with no Atelier capability protocol
(`routes/chat.ts:435-579`).

## 4. Current Atelier request path

### 4.1 Ingress and context

`/cli/turn` validates persona, prompt size, locale preamble, attachments,
timezone, continuation ids, and clarification values before invoking `runTurn`
(`cliRoutes.ts:102-203,217-293`). Attachment ids are re-resolved by org and
status; invalid ids are dropped with visible narration (`:232-263`).

CLI-era syntax still exists at ingress: `/new` is regex-parsed and stripped
before model interpretation (`:197-203`).

### 4.2 Interpretation

`classifyIntentTyped` asks Haiku for a typed `verb`, `kind`, entity hints, and
confidence (`intent-router.ts:23-81,176-280`). Two bounded attempts degrade to
the deterministic classifier instead of killing the turn (`:218-300`).

The deterministic fallback is ordered regex/keyword matching, and entity hints
come from quoted text, capitalized phrases, and id patterns (`:83-158`). The
classifier result controls tier and write-tool visibility, so it is more than
telemetry despite comments calling it advisory (`:15-18`; retriever
`capability-retriever.ts:332-390`).

Gap: model values are cast to TypeScript unions rather than runtime-enum
validated (`intent-router.ts:254-275`). A malformed model value can enter the
typed envelope.

### 4.3 Capability selection

The retriever:

- starts from the persona-filtered catalog;
- always includes coordinator and navigation tools;
- applies deterministic per-kind floors;
- hides writes for read/trivial intents;
- strips legacy writes owned by `propose_write`;
- ranks the remaining tools by local embeddings;
- adaptively expands near ties;
- widens once on a model no-capability claim;
- uses an alphabetical filler only when no eligible embeddings score
  (`capability-retriever.ts:37-95,99-145,328-469`).

This is deterministic selection policy around probabilistic interpretation.
Persona clamps still win over floors and widening (`:376-415`).

### 4.4 Resolution and execution

The model chooses from selected tools. Coordinator writes conventionally follow
resolve → optional specialist prefill → gate → propose
(`prompts/chat_orchestrator/v1.md:27-86`). The executor remains responsible for
org scoping, ACLs, validation, and domain rules. For example,
`resolve_entity` uses the hybrid resolver and emits unique match,
disambiguation, or clarification (`orchestrator-capabilities.ts:209-350`).

The prompt policy is not a workflow engine. The runner does not hold a typed
plan graph for those steps; the model decides call order in one loop
(`orchestrator-capabilities.ts:34-40`).

### 4.5 Confirmation and commit

Writes return a persisted pending tool/input envelope and a confirmation diff.
The separate confirm endpoint serializes through the same user queue and
forwards typed-name evidence for irreversible actions
(`cliRoutes.ts:313-358`). `async:true` is explicitly inert and cannot bypass
approval (`index.ts:284-291`).

Non-bypassable controls that must remain deterministic:

- role/persona catalog clamp;
- record-level ACL and org scope;
- input schema and domain validation;
- entity resolution and ambiguity handling;
- two-phase confirmation;
- typed-name check for high-risk actions;
- idempotency/concurrency controls;
- outbound rate limits;
- audit events and result navigation contract;
- domain invariants inside shared services.

### 4.6 Narration and presentation

Server frames carry `{step, tool, ok, data, errorCode, errorMessage}` for tool
results (`index.ts:6121-6141`). It suppresses failing read cards, suppresses
`propose_write` previews, exact-deduplicates, and caps successful read cards at
six, but does not assess semantic relevance (`index.ts:3622-3636,5349-5354,
6111-6141`).

Narration guards trim restatement, unfulfilled write promises, dead-end document
advice, and contradicted classification confidence
(`narration-contract.ts:1-203`). These are useful output backstops, not a typed
response synthesizer.

## 5. CLI-era assumptions to remove

| Assumption | Evidence/effect | Target treatment |
|---|---|---|
| Product/API named CLI | `/cli/*`, `CliFrame`, `CliTurnStatus`, catalog docs and comments | Rename public contract to Assistant; retain aliases internally during migration |
| Slash aliases are catalog identity | every capability carries localized `slashAliases` | compatibility input only; not capability selection |
| `/new` is regex control syntax | `cliRoutes.ts:197-203`; router reset regex | explicit `conversation.start` event; keep `/new` parser as adapter |
| User-supplied `intent` field | `RunTurnInput.intent` and HTTP body | remove from trust boundary; only server interpretation is authoritative |
| Tool result implies card | clients map retained results directly to renderers | require explicit `presentation` event with relevance/minimum-data validation |
| Prompt is orchestration policy | `chat_orchestrator/v1.md`; model orders coordinator tools | typed plan/step runtime for multi-step work |
| “Agent capability” means invocation | generic agent capability returns a dispatch hint | uniform dispatch API with real run id or explicit `unsupported` |
| Session equals work | turns hold pending clarification/write and replay | conversation state separate from durable work item state |
| Page navigation is completion | `navigateTo` is mandatory for write success | navigation remains optional presentation metadata, never execution proof |
| Tool names leak into compatibility and telemetry | scrubbers and slash palette are tool-centered | stable capability ids and semantic event names; tool names internal |

Slash commands may remain as an adapter that compiles into the same interpreted
intent envelope. They must not define product architecture or receive broader
authority than natural language.

## 6. Capability matrix

### 6.1 Contract dimensions

Every catalog row contains id, schema version/hash, module, tool name,
description, aliases/examples, JSON schema, read/write flag, two-phase flag,
outbound channel, result card, irreversible flag, initiator/approver roles,
surfaces, source, and implementation (`capability-catalog.ts:206-314`).

Legend below:

- **route source:** the route and assistant are intended to share one handler;
- **cli-only source:** wrapper/service parity must be verified per entry;
- **agent source:** currently a confirmation plus dispatch hint, not guaranteed
  execution;
- **client support:** both clients receive the same result through
  `chat-core`; known card shapes are typed, unknown shapes fall back to generic
  rendering. This is transport parity, not semantic or visual parity.

### 6.2 Complete live-catalog module matrix

The table accounts for all 326 registered rows in the runtime export.
“Confirm” and “irreversible” are row counts, not policy inference.

| Module | Total | Read | Write | Confirm | Irrev. | Principal role slices | Declared card families |
|---|---:|---:|---:|---:|---:|---|---|
| account | 23 | 10 | 13 | 7 | 4 | default, leadership, finance/HR/compliance, alliance | account/entity/ranked/audit/brief |
| admin | 1 | 1 | 0 | 0 | 0 | alliance | ranked |
| agent | 9 | 1 | 8 | 6 | 0 | leadership, senior manager, consultant | agent/entity/ranked |
| bank | 7 | 1 | 6 | 6 | 1 | founding partner, partner, finance | entity/bank recon/none |
| cash | 4 | 1 | 3 | 1 | 0 | leadership, finance/default | cash receipt/entity |
| change_order | 5 | 0 | 5 | 4 | 2 | leadership, finance, delivery | change-order/entity |
| codex | 14 | 3 | 11 | 8 | 3 | leadership, finance, compliance | contract/clause/redline/entity/ranked |
| deliverable | 12 | 0 | 12 | 12 | 1 | leadership and delivery | email/agent |
| deliverable_acceptance | 3 | 0 | 3 | 3 | 2 | leadership, finance, delivery | acceptance |
| engagement | 27 | 7 | 20 | 18 | 1 | default, leadership, delivery, alliance | ranked/charter/deliverable/entity/meeting/agent |
| finance | 2 | 1 | 1 | 0 | 0 | default and finance leadership | entity/KPI |
| firm_profile | 8 | 3 | 5 | 3 | 0 | leadership plus scoped firm roles | profile/entity |
| knowledge | 24 | 9 | 15 | 13 | 0 | leadership, delivery, alliance | asset/entity/ranked/traveller/agent |
| leakage | 1 | 1 | 0 | 0 | 0 | default perimeter | none |
| ledger | 27 | 13 | 14 | 10 | 3 | leadership and finance | KPI/entity/time-series/ranked/timesheet/pool |
| margin | 1 | 1 | 0 | 0 | 0 | default perimeter | none |
| meta | 25 | 12 | 13 | 11 | 2 | default plus agent-invocation roles | capability/recap/explain/refined/undo/audit/entity/docs |
| opportunity | 32 | 10 | 22 | 22 | 0 | broad scoped CRM roles and alliance | KPI/ranked/gate/rubric/opportunity/POV/meeting/agent |
| pipeline | 1 | 0 | 1 | 0 | 0 | default perimeter | entity |
| pricing | 2 | 0 | 2 | 0 | 0 | default perimeter | entity |
| proposal | 11 | 0 | 11 | 9 | 2 | leadership and senior manager | proposal/section/email/entity |
| raid | 5 | 1 | 4 | 3 | 0 | delivery and leadership | RAID/ranked/entity |
| renewal | 2 | 1 | 1 | 1 | 0 | leadership and finance | renewal/ranked |
| report | 1 | 1 | 0 | 0 | 0 | alliance | ranked |
| revrec | 5 | 0 | 5 | 2 | 2 | leadership and finance | none |
| roster | 51 | 20 | 31 | 29 | 0 | identity-locked/default scoped | ranked/entity/contact |
| treasury | 1 | 1 | 0 | 0 | 0 | leadership, finance, board observer | cash forecast |
| wallet | 15 | 7 | 8 | 8 | 3 | scoped delivery and finance roles | ranked/expense/invoice/AR/dunning |
| win_loss | 6 | 2 | 4 | 0 | 0 | default perimeter | entity/ranked |
| wip | 1 | 1 | 0 | 0 | 0 | default perimeter | none |
| **Total** | **326** | **108** | **218** | **176** | **26** | role-filtered | typed or generic fallback |

The exact per-entry matrix is the runtime catalog exposed by
`GET /api/atelier/cli/capabilities`, plus fields intentionally omitted from the
client response (implementation, full role policy, irreversible flag). For
audit/release evidence, use the export command in section 2 rather than counting
`defineCapability` text: source-call counts undercount generated agent rows and
can overcount helpers.

### 6.3 App parity and verified gaps

- Route co-location is the intended strongest parity:
  `defineRouteCapability` mounts the Express route and registers the same run
  function (`docs/atelier-cli/registering-a-capability.md:18-82`).
- The route linter and CLI parity matrix catch missing declarations, but the
  checked UI matrix is much smaller than the live catalog: 28 writes and 20
  reads (`tests/cli-parity/matrix.json`; `tests/cli-parity/run.ts:63-160`).
- `/me` mutations require either a capability or a reasoned platform exclusion
  (`me-chat-parity.ts:1-39`; `src/scripts/atelier-lint-routes.ts:119-206`).
- Self-service capabilities are identity locked; model-supplied user selectors
  are not trusted.
- The 60 auto-generated agent capabilities are a material false-parity risk:
  commit returns `dispatched:true` and a note, but does not call an agent route
  or create a run (`agent-capabilities.ts:144-187`).
- A generic fallback card means “client did not crash,” not that the operation
  has a meaningful web/mobile presentation.

### 6.4 Contract/NDA representative verification

The contract lifecycle is real, but not uniform:

- `contract_prepare`: founding partner/partner, write, two phase, internal
  side effect, resolves template/counterparty, auto-fills fields, clarifies
  required values, and calls shared `prepareContract`
  (`contract-capabilities.ts:250-313,316-626`).
- `contract_send_signature`: partner roles, write, two phase, outbound email,
  irreversible e-sign handoff (`contract-capabilities.ts:630-677` and shared
  `sendContract` service).
- `contract_status`: read-only lifecycle query in the same capability module.
- Heavy uploads/downloads remain REST/UI handoffs by design
  (`contract-capabilities.ts:23-29`).

This is genuine capability parity because the write wrappers call shared
contract services. It is not evidence that every generic agent capability has
the same parity.

## 7. Semantic-routing audit

| Mechanism | Actual effect | Decision |
|---|---|---|
| Haiku typed classifier | verb/kind/hints; controls model tier and write visibility | **Retain, narrow:** runtime validate enums; add abstain/multi-intent |
| Ordered verb/kind regex | outage fallback; first match wins | **Replace as primary semantics; retain bounded fallback** |
| Regex entity hints | quoted/capitalized/id fragments, max five | **Narrow:** use as candidates, not authoritative entities |
| Local embedding rank | selects persona-eligible tools | **Retain** with calibrated relevance threshold |
| Always-on meta tools | coordinator/navigation never disappear | **Retain** |
| Per-kind floors | prevent common capabilities vanishing | **Retain as availability policy**, not semantic answer |
| Document ownership regex | reorders personal/company document tools | **Narrow** and evaluate negation/locales |
| Read-intent write hiding | least-privilege tool menu | **Retain** |
| Legacy write stripping | forces writes through coordinator | **Retain** |
| No-tool prose regex | triggers one widened menu retry | **Replace** with typed `selection.abstain/no_capability` |
| Alphabetic cold filler | arbitrary tools when no scores exist | **Remove**; return provider/catalog unavailable |
| Clarification parsers | typed dates, numbers, options, controls | **Retain** before model fallback |
| Fresh-request opener regex | decides whether answer supersedes question | **Consolidate** duplicated opener sets |
| Narration regex guards | suppress promises, contradictions, leakage | **Retain as defense**, not primary synthesis |
| Attachment destructive regex | raises typed-name requirement | **Retain as conservative safety signal** |

The existing offline fallback probe verifies that classifier outage degrades to
`create/account` at confidence 0.4 instead of throwing
(`tests/crm/intent-router-fallback-probe.ts:1-53`).

## 8. Specialist agents versus agentic workflows

### 8.1 What exists

The registry declares schemas, tools, guardrails, human checkpoints, evals, and
statuses (`lib/agents/src/types.ts:37-68`). Run rows can store status, progress,
steps, tool calls, decisions, output, cost, and duration (`:70-137`).

The shared runner validates input, creates a run/audit row, reports progress,
executes one supplied body, validates output, completes/audits, or fails/audits
(`src/lib/atelier-agents/runAgent.ts:63-168`). Historical bespoke runners use
similar primitives (`runner.ts:1-24,200-365`).

Background jobs add atomic launch locks, durable terminal status, heartbeat-based
stale reaping, restart failure, and notification
(`src/lib/background-jobs.ts:1-25,41-191,242-337`).

Human decisions are persisted and audited, and bespoke routes may apply domain
state after approval (`runner.ts:1564-1607`; `agentRoutes.ts:2705-2806`).

### 8.2 Criteria matrix

| Criterion | Atelier Riser turn | Specialist-agent platform | True target workflow |
|---|---|---|---|
| Goal decomposition | model-selected tool sequence in one run | bespoke multi-phase code in some agents | persisted typed DAG/plan |
| Durable plan | no | no uniform plan; steps are mostly progress history | versioned plan and step records |
| Tool use | yes, selected catalog | yes for implemented runners; declared strings for stubs | scoped tools per delegated step |
| State | conversation turns/facts/pending write | run row and domain outputs | conversation + durable work state |
| Delegation | prompt/tool handoff | bespoke chaining in places | uniform child-work envelopes |
| Authority | persona/catalog/ACL/confirm | route and service gates vary by runner | explicit capability grant per step |
| Human checkpoint | write confirmation | decision rows and bespoke approval effects | typed blocking checkpoint with resume |
| Async execution | limited; writes never async-bypass confirm | background jobs on selected routes | durable queue, leases, ownership |
| Retries | classifier retry, provider-specific retries | ad hoc by runner/provider | per-step retry policy and attempt history |
| Recovery | replay/idempotent confirm | stale/restart jobs fail and ask retry | resume/replan/compensate/escalate |
| Compensation | undo capability for eligible writes | no uniform compensation contract | declared compensator per side effect |
| Budgets | session/turn/tool/wall limits | per-user daily agent spend | workflow + step cost/time/tool budgets |
| Observability | frames, turns, audit, limited telemetry | progress/run/audit rows | lineage across parent/child/attempt/result |
| Result synthesis | model final prose plus raw cards | domain-specific outputs | workflow aggregator with evidence |
| Cross-session/channel | session replay and facts | run id can be polled | work item attach/resume from any channel |

### 8.3 Classification

- **Single-run LLM job:** most `runAgent` executions.
- **Prompt-driven tool loop:** Atelier Riser `runTurn`.
- **Bespoke coded chain:** POV phases, Cartographer→Executive Mapper, and other
  explicitly chained routes.
- **Route handoff:** generic auto-registered agent capability.
- **Status table:** `atelier_agent_runs` and background jobs; useful durability,
  not a plan runtime by themselves.
- **Partial workflow:** background jobs with lock, heartbeat, terminal status,
  polling, and notification.
- **True agentic workflow:** not yet present as a uniform platform abstraction.

## 9. CEO answer plus irrelevant positions card

### 9.1 Contract-level reproduction

The minimal reproducible semantic sequence is:

```json
{"type":"narration","data":{"text":"The CEO is Aisha Example."}}
{"type":"tool_result","data":{
  "step":2,
  "tool":"roster_list",
  "ok":true,
  "data":{"shape":"ranked_list","title":"Positions","items":[]}
}}
{"type":"final","data":{"status":"success"}}
```

This shape is valid under the current server contract
(`index.ts:6121-6141`). The shared reducer appends the successful result without
checking its relation to the question (`lib/chat-core/src/reducer.ts:189-245`).
Web dispatches `ranked_list` to `RankedList`; empty items render “No items”
(`ResultCardRenderers.tsx:551-639,722-735,2815-2833`). Mobile uses the same
reducer, renders every retained result after streaming, and also routes
`ranked_list` to its list renderer (`atelier-mobile/lib/chatFrames.ts:1-47`;
`app/(tabs)/index.tsx:695-701`; `components/ResultCards.tsx:2134-2207`).

Therefore the observed UX requires no reducer race or client corruption. One
extra successful tool call is enough.

### 9.2 Exact known and unknown boundary

Verified:

- successful tool results automatically become card candidates;
- catalog/result `shape` selects the renderer;
- there is exact dedupe and a quantity cap, but no intent/card relevance check;
- neither client requires minimum meaningful content before showing every card;
- web and mobile have small suppression differences, not a common relevance
  contract.

Unknown:

- which tool produced the original positions result;
- whether that tool was selected by embedding retrieval, a floor, widening, or
  the model after seeing the menu;
- the persisted production frame payload.

### 9.3 Required correction

A tool result is execution evidence, not presentation intent. The orchestrator
must emit a separate typed `presentation.card` event only when:

1. `answersIntentIds` includes an active requested intent;
2. the card type is allowed for that operation;
3. a server-side minimum-data validator passes;
4. the result is not merely intermediate resolution/prefill/gate evidence;
5. synthesis has not selected a better card for the same answer.

For `ranked_list`, minimum meaningful data is a non-empty item list unless the
user explicitly asked for a list and the empty state itself answers the
question. An unrelated or incidental empty list produces no card.

## 10. Canonical protocol

Use a versioned envelope. The following is a semantic contract, not a model
prompt:

```ts
type AssistantEnvelopeV1 =
  | { v: 1; type: "intent.interpreted"; conversationId: string; turnId: string;
      intents: InterpretedIntent[]; locale: string; modelEvidence: ModelEvidence }
  | { v: 1; type: "capability.candidates"; turnId: string;
      intentId: string; candidates: CapabilityCandidate[]; abstention?: Abstention }
  | { v: 1; type: "resolution.required"; workId?: string; intentId: string;
      fields: RequiredField[]; ambiguity?: Ambiguity }
  | { v: 1; type: "policy.decided"; actionId: string; decision: PolicyDecision }
  | { v: 1; type: "action.preview"; action: ActionPreview }
  | { v: 1; type: "action.confirmation_required"; confirmation: Confirmation }
  | { v: 1; type: "action.result"; result: ExecutionResult }
  | { v: 1; type: "workflow.progress"; workId: string; progress: WorkProgress }
  | { v: 1; type: "response.narration"; response: Narration }
  | { v: 1; type: "presentation.card"; presentation: ResultPresentation }
  | { v: 1; type: "turn.completed"; outcome: TurnOutcome };

interface InterpretedIntent {
  id: string;
  goal: string;
  operation: "read"|"create"|"update"|"link"|"transition"|"delete"|"navigate"|"workflow";
  entities: EntityMention[];
  constraints: Record<string, unknown>;
  confidence: number;
  ambiguity: Ambiguity | null;
  abstention: Abstention | null;
}

interface CapabilityCandidate {
  capabilityId: string;
  operation: InterpretedIntent["operation"];
  score: number;
  reason: string;
  requiredFields: RequiredField[];
  produces: string[];
}

type PolicyDecision =
  | { effect: "allow"; obligations: PolicyObligation[] }
  | { effect: "deny"; code: string; safeReason: string }
  | { effect: "clarify"; fields: RequiredField[] };

interface Confirmation {
  id: string;
  actionDigest: string;
  summary: string;
  diff: unknown;
  irreversible: boolean;
  outboundChannels: string[];
  typedEvidence?: { label: string; expectedDigest: string };
  expiresAt: string;
}

interface ExecutionResult {
  actionId: string;
  capabilityId: string;
  status: "succeeded"|"partially_succeeded"|"failed"|"compensated";
  data: unknown;
  auditEventIds: string[];
  navigation?: { path: string };
  retryable: boolean;
}

interface ResultPresentation {
  id: string;
  answersIntentIds: string[];
  cardType: string;
  data: unknown;
  minimumDataVersion: number;
  relevanceReason: string;
}
```

State transitions:

```text
received
 → interpreted
 → selected | unsupported | clarify
 → resolved
 → policy_allowed | policy_denied
 → previewed
 → confirmation_required (writes)
 → executing
 → succeeded | partially_succeeded | failed
 → synthesized
 → completed
```

Rules:

- The LLM may propose interpretation, decomposition, capability candidates,
  arguments, narration, and presentation candidates.
- The orchestrator validates all typed model output and owns state transitions.
- The resolver owns canonical ids and ambiguity.
- The catalog owns schemas and declared effects.
- Policy owns role/ACL/risk decisions and cannot be overridden by model text.
- Executors own idempotency and business invariants.
- Clients render semantic events; they do not infer authorization or success.
- Abstention and unsupported capability are valid terminal outcomes. The model
  must not force a tool or card.

## 11. Target agentic workflow architecture

### Components and ownership

| Component | Owns | Must not own |
|---|---|---|
| Interpreter LLM | goals, operations, mentions, ambiguity candidates | ids, authority, confirmation |
| Conversational orchestrator | turn state, clarification, selection, synthesis | domain writes |
| Workflow runtime | durable work/plan/step/attempt state, leases, retry, resume | semantic authorization |
| Specialist agent | bounded delegated objective and evidence-backed result | parent authority or undeclared tools |
| Resolver | canonical ids, scoped candidates, ambiguity | business approval |
| Capability catalog | schemas, effects, role declarations, result contracts | live record-level ACL by itself |
| Policy layer | persona, ACL, risk, obligations, approval rules | prose generation |
| Executor | validation, idempotency, transaction, audit, compensation hook | intent guessing |
| Web/mobile clients | equivalent semantic event rendering and input collection | execution truth |

### Durable work model

```text
WorkItem
  id, goal, requester, conversationLinks[], status, budget, policyContext
Plan
  id, workId, version, createdBy, rationale, status
Step
  id, planId, dependencies[], capabilityId|delegateAgentId,
  input, authorityGrant, status, retryPolicy, compensation
Attempt
  id, stepId, leaseOwner, leaseExpiresAt, startedAt, endedAt,
  result, error, cost, auditLineage
Checkpoint
  id, workId|stepId, type, requiredDecider, decision, evidence, expiresAt
```

Required behavior:

- planning can decompose a goal but policy validates every executable step;
- delegation receives only a scoped objective, tools, budget, data perimeter,
  and return schema;
- long work returns `workId` immediately and streams/polls durable progress;
- retries are per step, bounded, classified, and recorded;
- side-effecting steps declare idempotency keys and optional compensation;
- provider outage pauses/retries eligible work and reports a typed degraded
  state; it never silently picks an unrelated tool;
- plan changes create versions with lineage;
- results aggregate from successful step outputs and evidence, not status text;
- any session/channel may attach to authorized work by id;
- conversation deletion does not delete durable work or audit lineage.

## 12. Channel-neutral migration

### API split

```text
POST /api/assistant/turns
POST /api/assistant/actions/:id/confirm
POST /api/assistant/actions/:id/cancel
GET  /api/assistant/conversations/:id/events

POST /api/workflows
GET  /api/workflows/:id
GET  /api/workflows/:id/events
POST /api/workflows/:id/checkpoints/:checkpointId/decide
POST /api/workflows/:id/cancel
```

Migration:

1. Introduce v1 semantic envelopes behind current `/cli/*` routes.
2. Adapt existing `CliFrame` to/from semantic events; do not fork web/mobile.
3. Add explicit presentation validation and stop deriving cards directly from
   raw tool results.
4. Move pending writes to action records referenced by conversation events.
5. Introduce WorkItem/Plan/Step only for genuinely multi-step or long-running
   operations.
6. Make specialist dispatch return a real `workId/runId` or typed unsupported
   result.
7. Add `/assistant/*` and `/workflows/*`; keep `/cli/*` as a deprecated adapter.
8. Keep slash aliases as optional parser input that emits the same typed intent.
9. Remove CLI terminology from clients, docs, telemetry, and durable status
   names after compatibility consumers migrate.

## 13. Evaluation and observability

### Versioned benchmark

Create `riser-eval/v1` fixtures with expected interpretation, selection, policy,
execution, narration, and presentation evaluated independently.

| Suite | Required coverage |
|---|---|
| Paraphrase | at least 20 paraphrases per high-volume operation |
| Ambiguity | entity, operation, date, amount, pronoun, multi-intent |
| Locale | English, Arabic, French, Turkish; locale digits and code-switching |
| Adversarial | prompt injection, forged confirm, cross-org ids, role escalation |
| Selection | exact capability, acceptable alternatives, abstention |
| Unsupported | honest no-capability without unrelated tool/card |
| Provider faults | classifier, embeddings, LLM, external API, DB timeout |
| Role matrix | every persona × sensitive capability family |
| Confirmation | replay, expiry, concurrent confirm, typed-name mismatch |
| Narration | no fabricated success, no contradiction, evidence attribution |
| Presentation | intent linkage, minimum data, empty/redundant/unrelated cards |
| Continuation | clarification, work resume, cross-session and cross-channel |

Initial acceptance thresholds:

- policy/role isolation: **100%**;
- forged/unconfirmed write commits: **0**;
- write idempotency under concurrent replay: **100%**;
- intent operation accuracy on supported fixtures: **≥97%**;
- capability top-1: **≥95%**, top-3 **≥99%**;
- unsupported-intent abstention: **≥98%**;
- clarification precision: **≥95%**;
- card relevance precision: **≥99.5%**;
- empty-card false emission: **0** unless explicitly expected;
- web/mobile semantic event parity: **100%**;
- provider-fault turns ending in unrelated capability: **0**.

Production telemetry must include versioned, privacy-safe events for:

- interpretation outcome/confidence/abstention;
- selected and rejected capability ids with reason codes;
- retrieval score distribution and widening;
- policy decisions and obligations;
- clarification issue/resume count;
- action preview/confirm/execute/replay;
- workflow step attempts, leases, retries, compensation, escalation;
- narration grounding checks;
- presentation proposed/emitted/suppressed and suppression reason;
- final outcome, latency, cost, and provider degradation.

Current telemetry is clarification-focused and explicitly cannot derive no-tool
turns (`tests/chat/telemetry-rollup.ts:1-15,61-105`). The reliability harness is
a strong base but does not yet measure interpretation or card relevance
(`CHAT-RELIABILITY.md:9-64`).

## 14. Prioritized remediation roadmap

> **Superseded by the complete approval plan.** Two additional challenge passes
> found missing implementation detail around strict ingress, stale authority,
> generated agent schemas, durable actions, exactly-once execution, legacy
> replay, SSE resume, secret handling, complete catalog parity, workflow
> recovery, operator controls, rollout, and rollback. The authoritative
> implementation plan is
> [Riser complete remediation plan](./riser-complete-remediation-plan.md). It
> contains 27 mandatory closure items across five dependency-ordered stages.
> The original high-level roadmap is retained below as historical context only.

### P0 — immediate correctness defects

1. Add server-side presentation relevance and minimum-data validation.
2. Runtime-validate classifier enums and emit typed abstention.
3. Replace prose-regex no-tool detection with a typed selector outcome.
4. Make generic agent capabilities return a real dispatch/run id or explicit
   unsupported status; never claim `dispatched:true` without a run.
5. Add the CEO/person-answer regression fixture with unrelated/empty ranked-list
   suppression on both clients.

Dependencies: semantic event adapter and card minimum-data registry.  
Risk: hiding cards currently relied on as incidental navigation; measure and
allow an explicit supplementary-card relation during migration.

### P1 — architectural consolidation

1. Introduce AssistantEnvelope v1 and shared client handling.
2. Separate action records from conversation turns.
3. Consolidate duplicate regex/openers and remove alphabetical tool filler.
4. Make capability selection return typed candidates/abstention with scores.
5. Publish one generated runtime capability manifest in CI and diff it.

Dependencies: version negotiation and compatibility frame adapter.  
Risk: historical replay requires deterministic conversion of legacy frames.

### P2 — capability parity

1. Convert cli-only wrappers to route/shared-service capabilities or document
   verified divergence.
2. Expand parity assertions from the small curated matrix to all 326 runtime
   entries, including role, confirm, effect, and presentation contracts.
3. Unify web/mobile card suppressions and typed renderer coverage.
4. Replace generic agent route hints with uniform specialist dispatch.

Dependencies: generated catalog manifest and dispatch API.  
Risk: source labels alone do not prove shared business logic.

### P3 — workflow runtime

1. Add WorkItem/Plan/Step/Attempt/Checkpoint records and leases.
2. Migrate only multi-step/long-running operations first.
3. Add retry classification, compensation hooks, escalation, parent/child
   lineage, and budget propagation.
4. Add cross-session/channel attachment and result synthesis.

Dependencies: action/policy contracts and stable capability ids.  
Risk: do not wrap simple atomic reads/writes in unnecessary workflow machinery.

### P4 — evaluation and operations

1. Ship `riser-eval/v1`, locale/adversarial fixtures, and fault injection.
2. Add interpretation, policy, execution, and presentation dashboards.
3. Establish canary thresholds and rollback rules for model/router versions.
4. Review unknowns using captured production traces, never anecdotal inference.

## 15. Rejected designs

- **Remove all deterministic routing and controls:** rejected. It would hand
  authority, confirmation, and business invariants to probabilistic output.
- **Keep adding keyword rules as primary semantics:** rejected. It cannot scale
  to paraphrases, locales, negation, and multi-intent requests.
- **Treat every agent registry row as executable autonomy:** rejected by the
  generic dispatch-hint implementation and stub statuses.
- **Use status tables as the workflow runtime:** rejected. Status without plan,
  attempts, authority grants, retry, recovery, and compensation is not a
  workflow.
- **Let clients infer relevant cards from tool names/shapes:** rejected. The
  CEO/positions defect is the direct result.
- **Preserve CLI as the product model:** rejected. Slash syntax remains an
  optional compatibility adapter only.

## 16. Evidence gaps and their required closure

These are not deferred planning items. The complete remediation plan assigns
each evidence gap to a mandatory implementation and release gate:

| Evidence gap | Required closure |
|---|---|
| Original CEO incident turn/tool/frames are unavailable | C13 fixes the code-proven relevance defect; C23 adds sanitized trace correlation; C24 adds the deterministic CEO regression |
| Production widening/fallback distribution is unknown | C4 removes arbitrary filler and types fallback outcomes; C23 measures selection/widening; C24 gates provider-outage behavior |
| Per-capability usage and generic-card rates are unknown | C13 records presentation suppression/emission; C15 publishes the complete manifest; C23 dashboards usage and fallback |
| Generated agent intent/executability is unclear | C7 requires every entry to create real work or return unsupported; C15 gates every catalog row |
| Bespoke long-running recovery varies | C17–C18 migrate eligible work to one durable attempt/recovery contract and test every adapted family |
| Cross-channel demand/retention is unmeasured | C12 supplies replay semantics; C20 supplies channel-neutral APIs; C23 measures adoption; C25 makes cutover evidence-based |

Evidence must be collected through privacy-safe telemetry, deterministic probes,
and named fixtures—not estimated from comments. None of these gaps permits the
associated remediation item to be skipped.