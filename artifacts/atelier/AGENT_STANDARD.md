# Atelier Agent Standard

> **The single source of truth for how an agent in Atelier is structured,
> built, registered, run, and audited.** Every Layer 2 (design) and Layer 3
> (implementation) agent task references this document. New agent code that
> deviates from this contract should be rejected at review.

This standard is **Atelier-only** for now. Other artifacts (Cognirise demos,
etc.) may adopt it later; the contract is intentionally portable.

---

## 1. Agent kinds

Pick one. The kind drives trigger, lifecycle, UI affordances, and eval design.

| Kind            | Description                                                                                                                | Examples                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Drafter**     | Produces a *proposal* a human reviews and approves before any side-effect lands. Most "front of house" agents are Drafters. | Pursuit Scout, POV Author, Proposal Composer  |
| **Sentinel**    | Triggered by schedule or event; emits notifications, alerts, or Pane A items. Never edits domain data without a Drafter.   | Burn Sentinel, Publish Sentinel               |
| **Analyst**     | Produces structured insights / aggregates / scores from existing data. Read-mostly; no domain mutations.                   | Utilization Analyst, Synthesis Critic         |
| **Rule-based**  | Deterministic, no LLM. Lives in the same lifecycle so it shows up in the same audit log and runs list.                     | Time Steward, Pipeline Forecaster             |

Rule-based agents skip prompt + model fields but **still** publish a registry
entry, write `atelier_agent_runs`, and emit `atelier_audit_events`.

---

## 2. Required artifacts per agent

Every agent ships with **all** of the following or its task is not done:

1. **Registry entry** in `lib/agents/src/registry.ts` via `defineAgent({ … })`.
2. **Prompt file** at `artifacts/api-server/prompts/<agent_id>/v<n>.md` (Drafter / Sentinel / Analyst only).
3. **Input + Output Zod schemas** declared inline in the registry entry.
4. **Context fetcher** — a small async function that loads everything the
   prompt needs (DB rows, related runs, knowledge hits) before the LLM call.
5. **Runner hook** in `artifacts/api-server/src/lib/atelier-agents/` —
   ideally one `run<AgentName>` exported function calling the shared
   `runAgent(...)` lifecycle helper.
6. **Route handler** in `artifacts/api-server/src/routes/atelier/agentRoutes.ts`
   (or a domain-specific route file) that triggers the agent and returns the
   run id.
7. **UI mount** — automatic via `Agents.tsx` + `AgentProfile.tsx` +
   `AgentRun.tsx` driven from the registry. Bespoke UI is opt-in only and
   must be justified in the registry entry.
8. **Eval / golden fixture** at
   `artifacts/api-server/tests/agents/<agent_id>/golden.json` with at least
   one realistic input + the expected *shape* (Zod-validated, not exact text).

---

## 3. Locked file layout

```
lib/agents/src/registry.ts                                # registry + types
lib/agents/src/types.ts
artifacts/api-server/prompts/<agent_id>/v<n>.md           # prompts (versioned)
artifacts/api-server/src/lib/atelier-agents/
    runAgent.ts                                           # shared lifecycle helper
    runner.ts                                             # per-agent run<X> hooks
    loader.ts                                             # prompt loader
    pipeline.ts, ledgerNudges.ts, …                      # supporting modules
artifacts/api-server/src/routes/atelier/agentRoutes.ts    # HTTP triggers
artifacts/api-server/tests/agents/<agent_id>/golden.json  # fixtures
artifacts/atelier/src/pages/Agents.tsx                    # registry-driven list
artifacts/atelier/src/pages/AgentProfile.tsx              # registry-driven detail
artifacts/atelier/src/pages/AgentRun.tsx                  # registry-driven run view
```

Paths are **locked**. Do not invent siblings. New shared logic goes inside
`atelier-agents/` so it is co-located with the runner.

---

## 4. Lifecycle contract

Every agent run — Drafter, Sentinel, Analyst, or Rule-based — flows through
the same eight phases:

```
start
  → fetch context
    → call LLM (skipped for rule-based)
      → validate output against Zod schema
        → persist proposal / result
          → emit audit event(s)
            → notify (optional)
              → human checkpoint(s) (Drafter / Sentinel only)
                → commit or reject
                  → emit final audit event
```

Phase responsibilities:

| Phase                   | Owner                | Stores into                          |
| ----------------------- | -------------------- | ------------------------------------ |
| `start`                 | `runAgent`           | `atelier_agent_runs` (status=running)|
| `fetch context`         | per-agent runner     | (read-only)                          |
| `call LLM`              | `runAgent`           | (no persistence)                     |
| `validate output`       | `runAgent`           | (Zod throws → fail)                  |
| `persist proposal`      | per-agent runner     | domain tables (e.g. `atelier_briefs`)|
| `emit audit events`     | `runAgent`           | `atelier_audit_events`               |
| `notify`                | per-agent runner     | `atelier_notifications`              |
| `human checkpoint`      | UI + `recordDecision`| `atelier_agent_runs.humanDecisions`  |
| `commit / reject`       | UI                   | domain tables                        |

The shared helper guarantees: `start` and `complete`/`fail` audit events
always fire, output is always validated against the registry's Zod schema,
budget is enforced, and `mock_fallback` results are flagged as synthetic.

---

## 5. Schema, model, tools, guardrails, evals

- **Schema.** Input + output schemas live inline in the registry entry as
  Zod schemas. They are the contract between the prompt, the runner, the
  route handler, the UI form, and the fixtures. If the prompt's JSON
  output drifts from the schema, the run fails.
- **Model.** One model per agent, declared in the registry entry. Use
  `claude-sonnet-4-6` for reasoning-heavy work, `claude-haiku-4-5` for
  scribes / classifiers, `claude-opus-4-6` for critic-style judges. Model
  changes are a registry edit + an audit-trail note, not a runner edit.
- **Tools.** Listed in the registry entry. The runner is responsible for
  hooking the tools up; the LLM is told what is available via the prompt.
  Numeric / financial math is **never** delegated to a tool — it is owned
  by deterministic helpers (e.g. `lib/atelier-pricing`).
- **Guardrails.** Free-text rules in the registry entry. Each must be
  enforceable in code, not just documented (e.g. citation guardrail
  downgrades any unsourced fact).
- **Human checkpoints.** Declared in the registry entry. `runAgent`
  emits a `human_checkpoint` event when the run reaches one; the UI
  renders approve / edit / reject from `humanCheckpoints[*].decider`.
- **Evals.** At least one. A passing eval is required to move from
  `status: registered` to `status: mvp`.

---

## 6. Storage rules

| Concern              | Table                         | Notes                                                        |
| -------------------- | ----------------------------- | ------------------------------------------------------------ |
| Run lifecycle row    | `atelier_agent_runs`          | One row per `runAgent(...)` call. Holds `output`, `steps`, `toolCalls`, `cost`, `confidence`. |
| State changes        | `atelier_audit_events`        | Every transition: `agent.start`, `agent.complete`, `agent.error`, `agent.mock_fallback`, plus any domain-specific `*.create / *.update / *.approve`. |
| Domain results       | Domain tables (see below)     | Drafter results land here on commit; Sentinel alerts land in `atelier_pane_a_items`; Analyst snapshots land in their dedicated tables. |
| Notifications        | `atelier_notifications`       | Sent only from a runner's notify step.                       |

Common domain tables: `atelier_briefs`, `atelier_research_facts`,
`atelier_povs`, `atelier_pov_versions`, `atelier_proposals`,
`atelier_meetings`, `atelier_charters`, `atelier_deal_pricings`,
`atelier_pane_a_items`, `atelier_utilization_snapshots`,
`atelier_win_loss_debriefs`, `atelier_themes`, `atelier_expense_drafts`.

---

## 7. Naming, IDs, versioning

- **Agent IDs:** `ag_<snake_case>` — e.g. `ag_pursuit_scout`,
  `ag_burn_sentinel`. Existing v1 callsites that pass the bare
  `pursuit_scout` to `startRun` are preserved for back-compat but new
  callsites must use the `ag_` prefix. The runner translates either form
  into the canonical id when looking up the registry entry.
- **Prompt files:** `prompts/<agent_id_without_ag_prefix>/v<n>.md` — e.g.
  `prompts/pursuit_scout/v1.md`. Bumping a major prompt change creates
  `v2.md` and the registry entry's `systemPromptRef` is updated in the
  same PR.
- **Registry entries:** semver-ish via the prompt version + the
  `inputSchema` / `outputSchema` shape. Schema-breaking changes require
  bumping the prompt version and migrating golden fixtures.

---

## 8. UI contract

- Atelier UI (`Agents.tsx`, `AgentProfile.tsx`, `AgentRun.tsx`) is
  **registry-driven by default**. Adding a new entry to `ATELIER_AGENTS`
  automatically:
  - lists it on the Agents page (grouped by `group`),
  - renders its profile (purpose, model, guardrails, tools, checkpoints),
  - renders its runs with status / confidence / cost,
  - generates a JSON-schema preview of the input + output from the Zod
    schemas.
- **Bespoke UI is opt-in.** When the standard view is insufficient
  (e.g. POV Author's three-step chain; Pricing Strategist's table view),
  add `uiComponent: "<route>"` and a one-line `uiRationale` to the
  registry entry. Atelier `AgentRun.tsx` will render a link to that
  route instead of the generic shell.

---

## 9. Definition of Done — Atelier agent

Every agent task — design or implementation — is done **only** when all of
these are true:

- [ ] Registry entry merged in `lib/agents/src/registry.ts` with truthful
      input + output Zod schemas matching what the runner / prompt produce.
- [ ] Prompt file present at `artifacts/api-server/prompts/<id>/v1.md`
      (skip for rule-based).
- [ ] Runner hook exported from `artifacts/api-server/src/lib/atelier-agents/runner.ts`
      and uses the shared `runAgent(...)` lifecycle helper (or documents
      the deviation in a code comment).
- [ ] Route handler triggers the runner and returns `{ runId }`.
- [ ] UI confirmed: appears in the Agents list, profile renders, runs
      stream into the run view (or the bespoke `uiComponent` link works).
- [ ] Audit events emit `agent.start` and `agent.complete` (or
      `agent.error` / `agent.mock_fallback`).
- [ ] Golden fixture at `artifacts/api-server/tests/agents/<id>/golden.json`
      passes shape validation under `pnpm test:agents`.
- [ ] At least one eval declared in the registry entry.
- [ ] Status correctly set: `mvp` for production-grade, `registered` for
      partial, `stub` for catalog-only placeholders.

---

## 10. Design-spec template (Layer 2)

Each Layer 2 task fills in this template before any code is written:

```
### Agent: <Name>
- **id:** ag_<snake_case>
- **kind:** Drafter | Sentinel | Analyst | Rule-based
- **trigger:** manual button | scheduled (cron) | event (e.g. opportunity.create)
- **persona:** which Atelier persona invokes / receives this
- **inputs:** plain-English description → Zod sketch
- **outputs:** plain-English description → Zod sketch
- **data sources:** DB tables, knowledge corpora, prior agent runs
- **side effects:** which domain tables / notifications / Pane A items it writes
- **human checkpoints:** ordered list with decider role and blocking flag
- **prompt outline:** sections of the system prompt, what each enforces
- **success criteria:** how we know it works in production
- **eval ideas:** at least one numeric or shape-based check
- **UI:** generic registry-driven OR bespoke (`uiComponent` + rationale)
```

A Layer 3 task is the implementation of one filled-in design spec.

---

## 11. Testing — golden fixtures

Convention: `artifacts/api-server/tests/agents/<agent_id>/golden.json`

```jsonc
{
  "agentId": "ag_pursuit_scout",
  "input": { /* one realistic example matching inputSchema */ },
  "expectedOutputShape": "use registry outputSchema",
  "notes": "Optional notes on what this fixture protects."
}
```

`pnpm test:agents` walks every fixture, validates `input` against the
registry's `inputSchema`, and validates `expectedOutput` against the
`outputSchema`. As of this task every fixture ships a real
`expectedOutput`, so a registry schema change cannot land without
either fixing fixtures or being noticed by the test. Set
`ATELIER_AGENT_STRICT_OUTPUT=1` (the test:agents script does this in
CI) to make `runAgent`'s input check throw on mismatch instead of
warn.

Add additional fixtures (`golden-2.json`, `golden-edge-empty.json`, …)
as they become useful. One per agent is the minimum.

### Migration status — runner.ts → runAgent

The 13 runners listed below are migrated to compose `runAgent(...)`:
Pursuit Scout, POV Outline, POV Draft, Meeting Scribe, Charter
Architect, Synthesis Critic, Agent Architect, Prototype Forge, Win/Loss
Interviewer, Theme Curator, Utilization Analyst, Expense Auditor, plus
one historical helper. Two large MVP runners — Proposal Composer and
Pricing Strategist — are intentionally still hand-rolled because they
own deterministic side effects (compliance matrix persistence,
deterministic pricing math owned by `lib/atelier-pricing`) that don't
slot cleanly into the helper without a separate refactor. They are
still validated against the same registry contract through
`completeRun()`'s output-schema check.

---

## 12. Where to look in the code

- Lifecycle helper: `artifacts/api-server/src/lib/atelier-agents/runAgent.ts`
- Registry: `lib/agents/src/registry.ts`
- Types: `lib/agents/src/types.ts`
- Per-agent runners: `artifacts/api-server/src/lib/atelier-agents/runner.ts`
- Routes: `artifacts/api-server/src/routes/atelier/agentRoutes.ts`
- UI: `artifacts/atelier/src/pages/{Agents,AgentProfile,AgentRun}.tsx`
- Fixtures: `artifacts/api-server/tests/agents/<id>/golden.json`

When in doubt, copy the **Pursuit Scout** wiring end-to-end. It is the
canonical example of a Drafter agent.
