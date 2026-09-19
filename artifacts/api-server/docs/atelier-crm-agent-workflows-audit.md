# CRM agent workflows audit

**Audit date:** 2026-09-19
**Scope:** authenticated Atelier CRM and CRM-adjacent work: accounts, contacts,
opportunities, research, POVs, meetings, proposals, engagements, relationship
intelligence, pricing, forecasting, and partner workflows.
**Conclusion:** the product has useful bounded AI specialists and several
well-governed write paths, but it does not yet have a uniform durable agent
workflow platform. “Agent” currently denotes several materially different
execution styles.

## Executive summary

- The registry is the best declared contract, not proof of execution. It has
  Zod input/output schemas, prompts, tools, guardrails, checkpoints, evals and
  status (`lib/agents/src/registry.ts:5-22,43-102`). The shared runner starts,
  validates, completes/fails and audits runs (`artifacts/api-server/src/lib/atelier-agents/runAgent.ts:63-168`);
  however, checkpoints and evals are commonly declarative: `runAgent` does not
  pause for a human decision or run eval thresholds, and many domain routes
  implement their own approval behavior.
- The strongest current designs are bounded drafters: Scout, Executive Mapper,
  POV and Proposal flows produce proposals or drafts, but **Cartographer
  auto-on-account-create is a material trust exception**: it directly persists
  model-derived strategic priorities, hypothesis, research brief, source
  signals, industry classification and up to seven contacts. Only manual
  refresh uses the governed review queue. Pricing and forecasting correctly
  keep financial math deterministic.
- Riser now has a persisted work-item/plan/step/attempt/checkpoint/lease
  foundation and routes, but it is incomplete and not integrated with these CRM
  runners. CRM `agent_runs` remain telemetry rather than a resumable CRM
  workflow; POV and Cartographer→Executive Mapper are finite coded chains, and
  generic Riser capability dispatch can still advertise work without creating a
  CRM run (the separate Riser audit documents this boundary).
- Operational risk is concentrated in invisible partial failure, inconsistent
  approval enforcement, registry/catalog drift, fragmented tests and weak
  business-outcome measurement—not in a need to make every CRM feature more
  autonomous.

## Method and limitations

I reconciled the task brief and Agent Standard with the runtime registry,
runner, routes, database schemas, Agents Lens routes/UI, prompts, fixtures and
CRM probes. Evidence is cited as workspace-relative `file:line` ranges. This
is a static repository audit on the 2026-09-19 snapshot; it does not claim
production volume, model quality, or a database row exists merely because a
table/route exists. The original Riser production trace is not present, so
claims about Riser use its current-state audit rather than invented traces
(`artifacts/api-server/docs/atelier-cli/riser-intent-architecture-audit.md:54-92`).

## Classification rubric

| Class | Evidence requirement |
|---|---|
| Utility | Formatting, lookup, guardrail, persistence or UI helper; no independent objective |
| Deterministic automation | Rules/math/scheduled sweep; no LLM judgment |
| Single structured LLM call | One bounded prompt → schema-validated output; no autonomous loop |
| Finite chained workflow | Explicit finite code chain with known steps and usually human gates |
| Bounded tool-using agent | LLM may choose/use declared retrieval or generation tools within a bounded objective; server owns writes |
| Durable agentic workflow | Persisted plan/steps/attempts, leases, retries/resume, checkpoints and cross-session outcome; Riser has a partial foundation, but **no uniform CRM integration is verified** |

Branding, a model name, a run row, or a progress bar does not increase the
classification. The Standard explicitly separates Drafter, Sentinel, Analyst
and Rule-based kinds (`artifacts/atelier/AGENT_STANDARD.md:13-25`).

## Authoritative inventory

Aliases below are product labels or implementation aliases for one capability,
not additional agents. “State” is the observed registry/runtime state, not a
promise that the operation is complete.

The inventory fields are intentionally explicit: **autonomy / execution class**,
**human checkpoint**, **persistence / output**, and **operational state**. Where
a runtime agent has no registry entry, that fact is stated rather than inferred.

| Canonical item and aliases | Purpose / trigger | Autonomy / execution class | Human checkpoint | Persistence / output | Operational state and evidence |
|---|---|---|---|---|---|
| **Account Cartographer**; account research/enrichment, `cartographer/refresh` | Account create/chat auto-run or manual refresh; chains Mapper afterward | Single structured LLM call with code-directed web retrieval; finite chain with Mapper | **Auto-on-create bypasses checkpoint**; manual refresh queues profile/contact proposals for partner decision | Auto-create directly persists priorities, hypothesis, research brief, source signals, industry classification and up to seven contacts; manual refresh uses `pending_profile_updates` | Runtime route/runner, **no canonical registry entry**; partner-mode alias `ag_account_cartographer`; auto-create persistence is explicit (`artifacts/api-server/src/routes/atelier/accountRoutes.ts:1056-1160`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:3425-3518,3529-3620,8333-9340`) |
| **Executive Mapper**; executive sweep/coverage | Manual run and automatic post-Cartographer chain | Single structured LLM call with code-directed research; finite Cartographer→Mapper chain | Partner reviews proposed contacts/updates | Account queue + audit; status/coverage polling | Runtime `executive_mapper`, **no canonical registry entry**; research queries are assembled by server code and the chain is race/staleness-aware (`artifacts/api-server/src/lib/atelier-agents/runner.ts:3773-3842`; `artifacts/api-server/src/lib/atelier-agents/executive-mapper-chain.ts:109-234,246-314`) |
| **Pursuit Scout**; Scout/opportunity research | Opportunity creation, manual Scout, chat opportunity-create | Single structured LLM call with code-directed retrieval and synthesis | Partner reviews/approves/edits/rejects | Cited brief/facts; `atelier_briefs`, `atelier_research_facts`, profile proposals | Registry `mvp`; runtime persistence and route are real; no model-directed tool-choice runtime evidenced (`lib/agents/src/registry.ts:43-102`; `artifacts/api-server/src/lib/atelier-agents/scout-persist.ts:25-75`; `artifacts/api-server/src/routes/atelier/agentRoutes.ts:1055-1221`) |
| **POV Deep Researcher**; POV research/research pass | Manual pre-outline research by angles | Finite code-directed retrieval and structured synthesis | Partner promotes candidate facts | Research facts/run/audit | Registered, no eval declared; server builds and caps research queries before synthesis (`lib/agents/src/registry.ts:187-225`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:1401-1503`) |
| **POV Author (outline)**; POV outline | Opportunity POV creation/regeneration | Finite chained workflow (outline → draft) with bounded calls | Lead then partner checkpoint | Outline bound to promoted facts; POV row/version | MVP outline contract (`lib/agents/src/registry.ts:104-148`; `artifacts/api-server/src/routes/atelier/agentRoutes.ts:1545-1659`) |
| **POV Draft**; HTML draft/revision | Approved outline draft, regeneration/revision | Single structured LLM call inside finite POV chain | Partner before send | HTML/citations/coverage; POV versions | Registered; bespoke draft route and status (`lib/agents/src/registry.ts:150-185`; `artifacts/api-server/src/routes/atelier/agentRoutes.ts:1846-2162`) |
| **Meeting Scribe**; transcript/recording scribe | Manual meeting transcript; meeting scheduling is a separate deterministic route | Single structured LLM call | Lead reviews before engagement push | Summary, decisions, actions, 5C delta; meeting/activity persistence | Registry `mvp`; runtime runner real; no durable scheduling autonomy (`lib/agents/src/registry.ts:350-415`; `artifacts/api-server/src/routes/atelier/accountRoutes.ts:3724-3929`) |
| **Proposal Composer**; proposal writer | Opportunity proposal start/manual route | Single structured LLM call over server-provided context | Lead assignment; partner pricing/final/send gates | Sections, compliance, pricing narrative; proposal/versions/audit | Registry `mvp`; runtime is one `callClaudeJson` synthesis with progress labels, not model-directed tool-choice (`artifacts/api-server/src/lib/atelier-agents/runner.ts:2113-2156`; `lib/agents/src/registry.ts:290-348`) |
| **Charter Architect**; engagement charter | Engagement/proposal handoff | Single structured LLM call over supplied engagement context | Lead/partner review before charter commit | Charter scope, outcomes, workstreams and governance | Registry/runtime proposal-adjacent specialist (`lib/agents/src/registry.ts:417-456`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:1630-1715`) |
| **Case Study Picker** | Proposal/opportunity candidate selection | Single structured LLM call over supplied candidate pool | Engagement Lead approves chosen studies | Selected IDs, top-three evidence and rationale | Registry `registered`; proposal runtime exposes it as a progress-stage label, with no separate runner verified (`lib/agents/src/registry.ts:904-951`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:2136-2145`) |
| **Theme Curator** | Win/loss themes proposed for open proposals | Single structured LLM call over supplied debrief themes | Human reviews theme/proposal suggestions | Firm themes, emergent themes and open-proposal suggestions | Registry `registered`; runtime specialist is proposal-adjacent (`lib/agents/src/registry.ts:953-1000`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:5360-5410`) |
| **Pricing Strategist**; commercial/pricing assistant | Pricing route from opportunity team mix, duration, rate card | Single structured LLM call plus deterministic pricing math | Partner override/approval | Primary/alternatives, margin locks; `atelier_deal_pricings` | Registry `mvp`; route/runtime real; financial math deterministic (`lib/agents/src/registry.ts:775-852`; `artifacts/atelier/AGENT_STANDARD.md:272-278`) |
| **Pricing Analyst**; pricing structure simulator | Pricing scenario request | Deterministic simulations plus one narrative call | Partner selects the structure | Scenario bands, cash profile and recommendation snapshot | Registry `registered`; real contract/runtime (`lib/agents/src/registry.ts:1483-1546`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:4827-4968`) |
| **Pricing Researcher**; runtime pricing-research alias | Pricing research/context | Single structured LLM call | Human review; no autonomous terms | Research output/run | Runtime-only, no registry entry (`artifacts/api-server/src/lib/atelier-agents/runner.ts:5120-5170`) |
| **Pipeline Forecaster**; forecast/scenario | Manual or forecast surface | Deterministic automation | No model checkpoint; human owns pipeline decisions | Stage probabilities, calibration/stall flags and forecast output | Runtime route/runner only; **not registry-backed** (`artifacts/api-server/src/lib/atelier-agents/runner.ts:4340-4410`; `artifacts/api-server/src/lib/atelier-agents/pipeline.ts:1-80`) |
| **Strategy Developer**; account strategy developer | Account strategy request/manual route | Single structured LLM call | Partner approval before strategy write | Draft objectives, plays and hypothesis; account strategy JSONB | Registry `registered`; runtime/route partial and reconciliation required (`lib/agents/src/registry.ts:2125-2177`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:7229-7422`) |
| **Procurement Navigator**; procurement/vendor registration guide | Account procurement research | Finite code-directed retrieval and structured synthesis | Partner approves guide | Sources, procurement guide JSONB and audit | Registry `registered`; server constructs the research query set and validates retrieved citations (`lib/agents/src/registry.ts:2178-2240`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:7541-7608`) |
| **Relationship-Health**; relationship intelligence | Account/contact relationship review | Single structured LLM call / Analyst | Lead dismisses or acts | Score, factors, recommendations and run output | Registry `mvp`; runtime-backed; route/domain write remains human-owned (`lib/agents/src/registry.ts:1685-1733`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:7143-7180`) |
| **Next-Best-Action** | Account-management request | Single structured LLM call / bounded Analyst | Engagement Lead accepts before task creation | Ranked recommendations/run; task creation remains human | Registry `mvp`; runtime-backed (`lib/agents/src/registry.ts:1627-1683`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:6975-7125`) |
| **Pre-Meeting Briefing** | Account/meeting context request | Single structured LLM call | Engagement Lead reviews | Citable brief/run; no autonomous write | Registry `mvp`; runtime-backed (`lib/agents/src/registry.ts:1735-1780`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:7184-7208`) |
| **Whitespace Mapper** | Account whitespace scan | Single structured LLM call | Human review before action | Offering × persona matrix/run | Runtime-only, no registry entry (`artifacts/api-server/src/lib/atelier-agents/runner.ts:4229-4280`) |
| **QBR Composer** | Account quarterly business review | Single structured LLM call | Human review before client use | QBR canvas/run | Runtime-only, no registry entry (`artifacts/api-server/src/lib/atelier-agents/runner.ts:4287-4338`) |
| **Chat Orchestrator / generic Riser dispatch** | Chat prefill, capability selection, specialist handoff | Supporting utility / prompt-driven tool loop; generic dispatch is a hint, not durable work | Riser confirmation for writes; specialist gates vary | Sessions, turns and frames; bespoke calls may create real runs | Supporting utility, not a CRM registry agent (`artifacts/api-server/src/lib/atelier-cli/orchestrator-capabilities.ts:2-66,367-500`; `artifacts/api-server/docs/atelier-cli/riser-intent-architecture-audit.md:354-405`) |
| **Partner-fit context**; alliance capability matching | Scout/account/opportunity context | Utility plus deterministic filter, optionally used by Scout | No assignment checkpoint; advisory only | Allowlisted fit flags snapshotted in brief | Runtime utility real; not a registry agent (`artifacts/api-server/src/lib/atelier-agents/runner.ts:36-39,100-112`; `artifacts/api-server/src/lib/atelier-agents/scout-persist.ts:50-54`) |
| **Win/Loss Interviewer**; debrief | Closed opportunity interview | Single structured LLM call | Human reviews debrief | Debrief/themes and win/loss tables | Registry/runtime specialist state (`lib/agents/src/registry.ts:854-930`) |
| **Brand Profile Writer**; brand/boilerplate | Firm profile authoring consumed by CRM deliverables | Single structured LLM call | Partner publishes | Firm profile | Registry `mvp`; runtime/route state real but not account autonomy (`lib/agents/src/registry.ts:227-288`) |
| **Synthesis Critic**; deliverable quality gate | Proposal/POV external deliverable review | Single structured LLM call | Lead reviews issues | Flags only; audit/run, no edit | Registry `mvp`; runtime quality gate, not CRM mutation (`lib/agents/src/registry.ts:535-575`) |
| **Scout persistence / citation guardrail** | Called by REST and chat entry points | Utility | No checkpoint; called after agent output | Skips empty brief, soft-deletes prior brief, inserts facts and downgrades unsourced claims | Runtime utility real (`artifacts/api-server/src/lib/atelier-agents/scout-persist.ts:25-75`) |
| **Run staleness / launch visibility** | Every long-running agent surface | Deterministic automation/utility | No checkpoint; operational guard | Heartbeat cutoff, restart failure, duplicate-launch guard, status normalization | Runtime utility real; two-hour stale handling (`artifacts/api-server/src/lib/atelier-agents/run-staleness.ts:28-129`; `artifacts/api-server/src/lib/atelier-agents/executive-mapper-chain.ts:77-107`) |

## Journey trace and gaps

| Journey | API / web / chat / persistence | Approval and recovery | Verified gaps and risk |
|---|---|---|---|
| Account creation and enrichment | Account routes create/update/archive/merge; Cartographer refresh and profile routes; Research tab renders account research (`artifacts/api-server/src/routes/atelier/accountRoutes.ts:4302-4886`; `artifacts/atelier/src/components/tabs/ResearchTab.tsx`) | **Auto-on-create directly persists Cartographer output**; only manual refresh uses the partner decision queue; Mapper proposals remain gated; stale launch is visible | Major approval bypass: model-derived priorities, hypothesis, brief, signals, industry and up to seven contacts enter durable account/contact state without a checkpoint; fire-and-forget failure can be warning-level |
| Contacts and executive mapping | Account contacts, duplicate check, create/update/merge/disposition and relationship routes (`artifacts/api-server/src/routes/atelier/accountRoutes.ts:5229-6417`) | Mapper proposals require partner decision; duplicate checks are deterministic | Contact quality depends on source-provider success and proposal review; no universal retry/attempt lineage; near-duplicate and rename behavior needs journey tests (existing proposed tasks cover several duplicate cases) |
| Opportunity and Scout | Opportunity duplicate/create/update/archive/stage/qualifier and brief/research endpoints (`artifacts/api-server/src/routes/atelier/agentRoutes.ts:237-279,607-1055,1100-1414`) | Scout facts are promoted/accepted/merged/reverified; brief persistence rejects empty output and guards citations (`artifacts/api-server/src/lib/atelier-agents/scout-persist.ts:30-70`) | Registry says partner checkpoint, but generic runner does not enforce it; chat result presentation and automatic chain visibility are not one tested contract |
| POV | POV list/create, deep research status/run, draft status/run, versions and outline regeneration (`artifacts/api-server/src/routes/atelier/agentRoutes.ts:1545-2162`) | Lead/partner gates are declared; fact promotion precedes citable outline; draft/version routes persist | Finite chain is not a durable plan: refresh/restart/resume and cross-session checkpoint recovery are not uniform; researcher has no eval |
| Meetings | Scribe accepts transcript and produces actions/decisions; meetings/activities and meeting brief routes are domain persistence (`lib/agents/src/registry.ts:350-415`; `artifacts/api-server/src/routes/atelier/accountRoutes.ts:3724-3929`) | Lead reviews before engagement push | Scheduling is deterministic CRUD, not an autonomous scheduler; no evidence of universal transcript retry or action-item outcome tracking |
| Proposals and engagements | Proposal routes and engagement routes share proposal, charter and delivery surfaces; Proposal Composer and Charter Architect feed them | Multiple lead/partner/send gates; commit remains human-driven | Large hand-rolled runners diverge from shared lifecycle; compliance and send outcomes are not one cross-agent lineage |
| Pricing and forecasting | Pricing routes use rate cards/team mix and `atelier-pricing`; pipeline helpers use stage defaults and calibration (`artifacts/api-server/src/lib/atelier-agents/runner.ts:49-66`; `artifacts/atelier/AGENT_STANDARD.md:272-278`) | Partner override for below-margin pricing; forecast is read/decision support | Keep math deterministic. More autonomy would add financial risk unless limited to scenario narration and approval-ready alternatives |
| Relationship and partner workflows | Contact relationships, alliance capability context, partner opportunity/engagement grants and NEP account/opportunity grants are DB-backed (`lib/db/src/schema/atelier.ts:148-235`; `artifacts/api-server/src/routes/atelier/accountRoutes.ts:6417-6460`) | Leadership grant/revoke and human approval | Access grants are deterministic authorization, not agent decisions; partner-fit is advisory. Do not make assignment autonomous without policy/versioned approval |
| Chat / Riser utility path | `/cli/turn` is authenticated, persona-scoped, tool-filtered, confirm-before-write; generic agent capability may advertise dispatch | Riser confirms writes; persisted work routes support plan/step/attempt/checkpoint/lease records, but CRM specialists are not integrated | Current Riser audit still finds generic dispatch hints without guaranteed CRM run; foundation is incomplete rather than absent (`artifacts/api-server/docs/atelier-cli/riser-intent-architecture-audit.md:116-220,354-405`; `artifacts/api-server/src/routes/workflowRoutes.ts:19-128`) |

### Journey coverage (A=real evidence, D=derived/manual, P=placeholder or absent)

| Journey | API | Web | Chat | Persistence | Approval | Recovery | Tests |
|---|---|---|---|---|---|---|---|
| Account/cartographer/mapper | A | A | A (prefill path) | A (including direct auto-create writes) | **Partial: manual refresh/Mapper queued; auto-create bypasses** | D (stale/retry, no CRM resume) | D/P fragmented |
| Contacts/executive mapping | A | A | D | A | A | D | D/P duplicate probes |
| Opportunity/Scout/research | A | A | A (create capability) | A | A (fact/profile decisions) | D (empty/fail-soft) | D/P route probes |
| POV research/outline/draft | A | A | D | A | A (declared + route gates) | D (poll/stale; no resume) | D/P probes and fixtures |
| Meetings/Scribe/briefing | A | A | D | A | D/A by route | P | D/P probes |
| Proposals/engagements | A | A | D | A | A (multi-gate; Case Study Picker/Theme Curator advisory) | D | D/P fragmented |
| Pricing/forecast | A | A | D | A | A for pricing; D for forecast | P/D | D/P math probes |
| Relationship/partner workflows | A | A | A for grants/prefill | A | A for grants; D for assessments | D | D/P |

The table deliberately distinguishes a route or screen from a tested contract:
“A” means the code path is present, not that production success is measured.

## Testing, metrics and excluded adjacency

The golden harness primarily validates registry input/output shapes and walks
fixtures (`artifacts/atelier/AGENT_STANDARD.md:241-264`). CRM probes add useful
stubbed route/provider checks (for example executive-mapper chaining, Perplexity
failure/retry and POV revision), but package scripts expose only a subset and
there are live-AI probes such as `artifacts/api-server/tests/crm/tone-probe-live.ts:1-4`.
There is no uniform runner matrix for malformed output, timeout, tool failure,
restart, duplicate launch, stale polling, retry idempotency or persisted
failed→retry transitions. This is evidence for coverage risk, not a duplicate
recommendation to make the existing CRM suite deterministic.

| Measurement | Actual implementation | Manual / derived | Placeholder / absent |
|---|---|---|---|
| Run status, progress, duration, cost, confidence, source count | Stored on `atelier_agent_runs`; start/complete/error audit events (`artifacts/api-server/src/lib/atelier-agents/runAgent.ts:110-167`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:247-453`) | Confidence and source counts depend on runner/model | Riser has separate persisted work/plan/step/attempt/lease tables, but CRM runners are not integrated with them; no CRM compensation metrics |
| Stale/restarted work | Two-hour heartbeat and boot sweep map orphaned work to error (`artifacts/api-server/src/lib/atelier-agents/run-staleness.ts:28-129`) | Operator/user must relaunch; Riser lease reaping can return a step to ready | CRM resume/cross-session continuation absent; Riser foundation is not wired into CRM |
| Human approval | Domain queues and some decision routes persist actor/status/edit data | Registry checkpoint declarations are metadata; shared runner does not itself block on them | Uniform checkpoint completion/expiry metric absent |
| Quality/evals | Zod fixture shape checks; selected provider/route probes | Registry eval descriptions and Lens scorecards | Semantic pass rates, source acceptance and regression gates incomplete |
| Business outcomes | None consistently emitted across CRM agents | Conversion, acceptance, cycle time and forecast error can be calculated externally | Agent-attributed opportunity conversion, rework, POV send rate, margin override and relationship recovery absent |

Explicitly excluded adjacency: HR/recruiting (including Offer Composer and
candidate agents), finance/payroll/treasury/cash agents, compliance/security,
IP/knowledge/OSS stewardship, utilization/expense operations, and generic
delivery-only sentinels. Engagement Proposal Composer, Charter Architect,
Synthesis Critic, Burn/Margin sentinels are included only where their output
directly gates a listed proposal/engagement journey; other agents in those
groups are outside this audit. This prevents branding or catalogue proximity
from being mistaken for CRM autonomy.

## Agent-domain wiring assessment

| Surface | Actual wiring | Assessment |
|---|---|---|
| Runtime registry | `defineAgent` entries with schemas, models, tools, guardrails, checkpoints and statuses (`lib/agents/src/registry.ts:1-22`; `artifacts/atelier/AGENT_STANDARD.md:114-135`) | Real contract; status is manually declared and does not prove route/prompt/fixture parity |
| Database catalogue | Agents Lens tables for specs, versions, eval suites, deployments, incidents and retirements (`lib/db/src/schema/atelier-agents-lens.ts:38-201`) | Real storage schema, not automatic runtime registry synchronization |
| Agents Lens API | Org-scoped reads; employee-only lifecycle writes; incident detail links evidence runs/fix versions (`artifacts/api-server/src/routes/atelier/agentsLensRoutes.ts:123-256,270-482`) | Real lifecycle records and permissions; many reads are marked CLI parity pending, and rows are user-entered |
| Agents UI | Registry-driven list/profile/run contract in Standard (`artifacts/atelier/AGENT_STANDARD.md:173-187`); Lens is DB-backed | UI visibility can be present while execution/catalog parity is absent; registry and Lens can drift |
| Runs/progress/cost | `atelier_agent_runs` start, steps, output, cost, confidence, duration; audit start/complete/error (`artifacts/api-server/src/lib/atelier-agents/runAgent.ts:110-167`; `artifacts/api-server/src/lib/atelier-agents/runner.ts:247-453`) | Real per-run telemetry; separate Riser work plans/steps/attempts exist but CRM is not integrated |
| Staleness/restart | 2-hour heartbeat, boot sweep, effective error status (`artifacts/api-server/src/lib/atelier-agents/run-staleness.ts:28-129`) | Real CRM defensive recovery; Riser lease recovery exists, but CRM recovery means retry, not durable resume |
| Human decisions | Schema/runner primitives and bespoke route decision application | Partly real; registry checkpoint declarations are not automatically emitted/blocked by shared helper |
| Evals | Golden fixture harness validates shapes; registry eval descriptions are metadata (`artifacts/atelier/AGENT_STANDARD.md:241-264`) | Shape coverage is real; semantic thresholds, outcome feedback and release gates are absent/fragmented |
| Incidents | Incident table/detail can link evidence run IDs and candidate fix version (`artifacts/api-server/src/routes/atelier/agentsLensRoutes.ts:186-255`) | Real manual incident loop; no verified automatic incident creation from CRM failures |
| Metrics/outcomes | Cost, duration, confidence, source count, progress and run status are stored | Operational metrics are real/derived; customer conversion, evidence acceptance, cycle time, rework and forecast accuracy are absent or manual |

## Boundary with the Riser architecture work

The separate Riser remediation owns orchestration, versioned assistant/event
protocols, durable actions, workflow runtime, authority/policy contracts,
exactly-once/idempotency, cancellation, replay, web/mobile parity, catalog
manifest/parity, compatibility migration and shared telemetry
(`artifacts/api-server/docs/atelier-cli/riser-complete-remediation-plan.md:65-89,132-171,491-527,571-699,701-727`).
This audit does **not** re-plan or change those areas.

| Finding | Boundary |
|---|---|
| Generic agent dispatch may claim success without a real run | Riser orchestration/dispatch contract owns the shared fix; CRM must mark each CRM specialist executable or unsupported |
| Riser has a partial durable plan/step/attempt/checkpoint/lease foundation, not CRM integration | Riser workflow runtime and routes own the platform primitive (`artifacts/api-server/src/lib/assistant/workflow-runtime.ts:16-128`; `artifacts/api-server/src/routes/workflowRoutes.ts:19-128`); CRM still owns its domain-specific plan, checkpoints and side effects until integration |
| Confirmation/replay/idempotency/semantic event gaps in chat | Riser owns protocol/runtime; CRM owns domain invariants, proposal semantics and acceptance tests |
| Registry ↔ Agents Lens drift, missing CRM fixtures/evals, wrong status | CRM-specific residual; not solved by protocol work |
| Cartographer/Mapper queue semantics, Scout citation/refusal, POV fact provenance, pricing math, forecast policy | CRM-specific residual; remain domain-owned |
| CRM outcome metrics and human acceptance feedback | CRM-specific residual; Riser telemetry can transport events but cannot define business success |

## Prioritized recommendations

| Priority / risk | Recommendation and value | Prefer agentic or simpler design |
|---|---|---|
| **P0 — trust and customer-facing evidence** | Close the Cartographer auto-create exception first: either queue all model-derived priorities, hypothesis, research brief, source signals, industry and contact seeds for partner decision, or make an explicit narrowly scoped policy/checkpoint with actor, evidence, expiry and commit audit. Apply the same invariant to every CRM proposal and fail closed when absent. | More durable checkpoint orchestration is valuable; keep actual commit deterministic and human-gated. |
| **P0 — operational invisibility** | Add a CRM run contract for timeout, malformed output, provider/tool failure, launch duplication, restart, retry and poll-after-refresh, with attempt lineage and explicit terminal/retryable states. | Use the shared durable runtime when available; do not add autonomous replanning yet. |
| **P1 — contract drift** | Generate/release-check a CRM inventory manifest joining canonical registry ID, aliases, runner, route, prompt, fixture, Lens record, UI mount and status. Block duplicate aliases and stale “mvp.” | Deterministic manifest is safer than an agent deciding its own registration. |
| **P1 — evidence quality** | Add semantic CRM evals: citation provenance, refusal/empty brief, fact promotion, duplicate proposal suppression, contact seniority, proposal compliance, pricing margin and forecast calibration. | Single calls plus deterministic validators are sufficient; autonomy adds little until quality is measurable. |
| **P1 — customer value measurement** | Record accepted/rejected/edited proposals, time-to-approval, rework, source acceptance, research-to-opportunity conversion, POV send rate, proposal cycle time, margin override and forecast error. | Add feedback loops before autonomous planning; measurements are more valuable than more tool choice. |
| **P2 — selective leverage** | After the Cartographer auto-create trust exception is closed, make Cartographer→Mapper and POV resumable finite workflows; preserve Scout, Proposal Composer and Scribe as code-directed retrieval or single-call drafters, not bounded tool-choice agents. | Finite durable chains are justified by multi-minute/repeated work; avoid a general-purpose autonomous CRM operator. |
| **P2 — financial and access safety** | Keep pricing math, forecast probabilities, partner grants, ACLs, duplicate detection and archival deterministic. Let AI narrate scenarios or propose changes, never authorize them. | Simpler design is explicitly preferable: correctness, explainability and reversibility dominate autonomy. |
| **P2 — test execution hygiene** | Consolidate fragmented CRM probes into release-blocking deterministic suites and isolate opt-in live-AI probes. This recommendation is intentionally limited to test ownership/coverage gaps; the existing proposed deterministic CRM-test work is not duplicated here. | Deterministic fixtures for gates; live models only in a separately labeled evaluation lane. |

## Audit verdict

The CRM portfolio is **partially agentic by composition, not durable by
integration**: mostly code-directed retrieval, bounded structured calls,
deterministic controls and a few finite chains, alongside one material
Cartographer auto-create write exception. The immediate goal should be
trustworthy, observable, resumable human-gated execution—not blanket autonomy.
A workflow should graduate to durable agentic status only when it has a
persisted plan, attempt history, lease/recovery semantics, enforceable
checkpoints, semantic evals and a measurable customer outcome; the existing
Riser foundation is a platform substrate, not evidence that CRM has graduated.