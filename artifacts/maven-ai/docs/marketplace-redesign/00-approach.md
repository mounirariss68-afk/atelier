# Approach — Agentic Marketplace Redesign

This doc defines the vocabulary, the new marketplace tool detail page
structure, and the new dedicated demo shell pattern that every per-tool
spec in this folder follows. It is the contract the build task
implements against.

## Why this redesign

The current 14 demos look like dashboards: a panel of sliders and
toggles that recompute static numbers. The visitor cannot see *agents*
doing anything — there is no orchestrator, no autonomous decisions,
no tool calls, no handoffs, no human-in-the-loop checkpoints firing
in real time. The marketplace must show two things instead:

1. **Deployable assets** — Maven AI ships a tight catalogue of named,
   scoped agentic products with clear buyers, KPIs and references.
2. **A genuinely agentic approach** — orchestrator agents delegate to
   specialists, specialists call tools and other agents, decisions
   route based on confidence / policy / value, and humans are pulled
   in at named checkpoints (not surfaced as a slider).

## Vocabulary

Every tool spec in this folder uses the same nouns. The build task
must surface these as labelled UI affordances.

| Term | Meaning | UI surface |
|---|---|---|
| **Orchestrator agent** | The named agent that owns the workflow end-to-end. Decides which specialist runs next, gates progress, escalates to humans. One per tool. | Top swimlane in the Agent Cockpit. Always visible. |
| **Specialist agent** | A scoped agent that owns one capability (e.g. evidence-curator, dialect-tagger). Called by the orchestrator. May call tools or other specialists. | One swimlane each. |
| **Tool / system call** | A typed call the agent makes to a system (e.g. `sap.invoices.search`, `sama.obligations.fetch`, `email.draft`). Returns structured data. | Inline pill on the agent's swimlane: name, args summary, latency, outcome. |
| **Memory** | The shared state every agent reads/writes (case file, programme state, supplier file). Distinct from the agent's private scratchpad. | "Workspace" tab in the demo: the live JSON-ish view of the case. |
| **Human checkpoint** | A named gate where the workflow pauses for a named human role to approve / reject / edit before the agents continue. | Modal overlay; entry in the Audit Log; counted in KPIs. |
| **Autonomous workflow** | A named, repeatable end-to-end sequence the orchestrator executes (e.g. "auto-triage major incident", "auto-draft savings memo"). Triggered by an event or schedule. | "Workflows" tab; storyboards on the detail page. |
| **Policy** | The declarative rules the orchestrator enforces (thresholds, scopes, refusal conditions). | Footnote chip on every routing decision. |
| **Decision** | A discrete branch the orchestrator or specialist takes (route, escalate, refuse, retry). Always logged with the rule that produced it. | Audit Log entry; pill on the swimlane. |

A demo is "agentic" only if the visitor watches all of these happen
without dragging a slider — the cockpit ticks forward on its own,
agents pick work off a queue, take decisions, call tools, hand off,
and stop at a human checkpoint.

## The new marketplace tool detail page

`/marketplace/<slug>` becomes a full tool **description page**, not a
demo. Structure (top → bottom):

1. **Hero** — Tool name, one-line positioning, named buyer persona,
   stage badge (live / pilot / preview), "Launch interactive demo"
   CTA.
2. **Problem** — 2–3 short paragraphs naming the GCC-grounded pain
   with realistic before-state numbers and a quote-style buyer
   sentence. Uses sourced benchmarks, not invented stats.
3. **Solution narrative** — How Maven AI solves it. Short, plain.
4. **Agent architecture** — A named **orchestrator** at the top, the
   specialists below, the tools / systems / MCPs each specialist
   calls, the shared memory, and the human checkpoints. Rendered as
   an inline SVG topology (RTL-aware), with a legend.
5. **Autonomous workflows** — 3–6 named workflows. Each is a small
   storyboard: trigger → ordered steps → decisions → outcome. Shows
   the visitor what the agents will do without being asked.
6. **KPI impact** — A table of 3–5 KPIs with realistic before / after
   benchmarks and per-KPI sourced footnotes (no invented stats).
7. **Sources** — Footnoted list of analyst notes, vendor case
   studies, regulator publications used for the KPI panel.
8. **Launch interactive demo** — Big footer CTA repeating the hero.

The detail page is read-only — no sliders, no toggles. All hands-on
behaviour lives in the demo.

## The new dedicated demo shell

Clicking "Launch interactive demo" routes to `/demo/<slug>`. This
route renders inside its **own layout** that hides the main site's
navbar, footer, and chat widget. The shell is:

- **Top bar** (fixed):
  - Left: Maven AI logo (clickable → exits demo back to detail page).
  - Center: tool name + a small "live demo · illustrative data"
    badge.
  - Right: language switcher, "Exit demo" button, "Reset" button.
- **Left rail** (collapsible):
  - Overview · Live Inbox / Queue · Agent Cockpit · Workflows ·
    Workspace · KPIs · Audit Log
  - Each tab counter (e.g. inbox count, open checkpoints, decisions
    in last tick) updates as the simulation ticks.
- **Main pane**: renders the active tab.
- **Bottom bar** (fixed): the simulation tick controls — Play /
  Pause / Step / Inject event / Rewind, current tick number, sim
  speed, and a small "agents currently busy" indicator.

The whole experience is full-window. The user should feel they have
launched a separate product, not scrolled to a section of a website.

## The Agent Cockpit (the heart of the demo)

The cockpit is a swimlane view, one row per agent. Each lane shows:

- The agent's name, role, avatar/icon and current state badge:
  `idle` · `thinking` · `calling tool` · `waiting for human` ·
  `handing off` · `done` · `refused`.
- The current task in flight (a short headline pulled from memory).
- The most recent decision the agent took, with the policy / rule
  that produced it as a footnote chip.
- The most recent tool call as an inline pill: `name(args) → result
  in 240ms`.
- A "talk to" affordance to inspect the agent's private scratchpad
  (its reasoning trace, retries, refusals).

The orchestrator's lane is always at the top and shows the current
workflow, the next planned step, and the next checkpoint.

When a human checkpoint fires, a modal blocks the cockpit until the
visitor takes the role of the named human (e.g. "You are the CRO.
Approve this inspection pack?"). The decision is logged and the
agents resume.

## The simulation tick engine

A single, shared, in-browser tick engine drives every demo. Per-tool
scenario configs declare:

- **Seeded events** — A timestamped list (e.g. `t=0: incident IM-1041
  arrives`, `t=3: regulator notification due in 30 minutes`,
  `t=6: customer complaint inbound`).
- **Agent behaviours** — Per agent, the rules / stubbed prompts that
  produce decisions and tool calls when the orchestrator routes work
  to them.
- **Stubbed tools** — In-memory implementations of every "system call"
  the agents make. Deterministic. Latency simulated.
- **Human checkpoints** — When and why they fire, the role the
  visitor plays, and the consequences of each option.
- **KPI deltas** — What the KPI panel updates with as workflows
  complete.

The tick engine is a small, generic orchestrator runtime; per-tool
scenarios are pure data + a few inline functions. Running for a few
minutes produces a full, exportable audit log.

## What the implementation must NOT do

- No real backend integrations, no real APIs called from the demo.
  Everything is in-browser and seeded.
- No new heavyweight dependencies. Inline SVG only.
- No "you drag a slider, numbers change" surfaces in the cockpit.
  Sliders belong (if anywhere) only on the Workspace tab as
  what-if controls, and they must trigger an autonomous workflow,
  not be the demo themselves.
- No fabricated KPI numbers. Every benchmark is sourced (see
  `03-sources.md`).
- No bypass of the human checkpoint modals — the visitor must act in
  the named role for the agents to continue.
