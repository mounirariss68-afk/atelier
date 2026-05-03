# Demo Experience Design Spec

This doc specifies the dedicated full-screen demo shell that every
tool's demo runs inside, and the simulation-tick engine that drives
the agents.

## Routing & layout

- New route: `/demo/:slug`.
- Renders inside a dedicated layout component (`DemoExperience`)
  that does **not** mount the main site `Navbar`, `Footer`, or
  `ChatWidget`.
- Background: full-bleed dark navy (`#0E2841`), ivory text. The shell
  feels like a standalone product, not a website page.

## Top bar (fixed, 56px tall)

- **Left**: Maven AI logo. Clickable → returns to
  `/marketplace/:slug` (the detail page).
- **Center**: Tool name. To its right, a small chip:
  `live demo · illustrative data only`.
- **Right** (in order):
  - Language toggle (EN / AR).
  - Reset (re-seeds the simulation from t=0).
  - Exit demo (returns to `/marketplace/:slug`).

## Left rail (240px, collapsible to 56px)

Tabs in this order, each with a live count badge:

1. **Overview** — Tool name, one-line problem, the named cast (icons
   only), and a "How does this work?" link that opens the agent
   topology overlay.
2. **Live Inbox / Queue** — The autonomous work the orchestrator is
   pulling from. Per-tool the noun changes (Incidents, Cases,
   Initiatives, Tenders, Suppliers, etc.). Items have status pills.
3. **Agent Cockpit** — The swimlane view. Default tab.
4. **Workflows** — The list of named autonomous workflows. Each can
   be expanded to see its trigger, its steps, and the runs the
   orchestrator has executed in this session.
5. **Workspace** — The shared memory the agents read / write. Live
   JSON-ish view (key/value cards), the source of truth for the case
   file. Some keys are editable as what-if controls and editing them
   triggers the orchestrator to re-plan.
6. **KPIs** — The before / after KPI panel for this tool, with the
   "after" updating as workflows complete. Sources footnoted.
7. **Audit Log** — Every decision, every tool call, every checkpoint
   outcome, with timestamp, agent, policy and rationale. Exportable
   as JSON.

## Main pane

Renders the active tab. Tabs are independent components. The Agent
Cockpit is the headline tab — designed to be visually rich and
unmistakably agentic.

### Agent Cockpit anatomy

```
┌───────────────────────────────────────────────────────────┐
│ ORCHESTRATOR · "case-conductor"                           │
│ workflow: auto-triage major incident · step 3/7           │
│ next: route to customer-impact-scorer · ETA t+1           │
│ ────────────────────────────────────────────────────────  │
│ tool calls (last 30s):                                    │
│  • policy.lookup("incident-class") → P1 in 80ms           │
│  • memory.write("incident.IM-1041.class") → ok            │
│ decision: classify P1 (rule: customers > 50k OR data)     │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ alarm-collector            [calling tool]                 │
│ task: ingest IM-1041 · IM-1042 · IM-1043                  │
│ tool: nms.alarms.poll(window=60s) → 3 alarms in 120ms     │
│ handed off to: customer-impact-scorer                     │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ customer-impact-scorer     [thinking]                     │
│ task: score IM-1041 customer impact                       │
│ tool: crm.affected_msisdns(IM-1041) → 84,310              │
│ decision: severity=major (rule: > 50k customers)          │
│ handed off to: regulator-flagger                          │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ regulator-flagger          [waiting for human]            │
│ task: file CITC notification · clock 28 min remaining     │
│ HITL: NOC Director must approve filing                    │
│ ⚠ checkpoint open                                         │
└───────────────────────────────────────────────────────────┘
```

Each lane has:

- A coloured left edge per state (`idle` grey, `thinking` amber,
  `calling tool` teal, `waiting for human` red, `done` green,
  `refused` purple).
- An expand-on-click panel that shows the agent's private scratchpad
  (its current reasoning steps, retries, refusals) and the last 5
  tool calls in full.
- Lanes are stacked vertically, in the order the orchestrator
  triggered them. The orchestrator's lane is always at the top.

## Bottom bar (fixed, 56px tall)

Simulation tick controls (left-aligned):

- **Play / Pause** toggle.
- **Step** (advances one tick).
- **Inject event** (opens a small picker of seeded events the
  scenario allows the visitor to fire — e.g. "fire major incident",
  "fire VIP complaint").
- **Rewind to t=0** (same as Reset).

Right-aligned:

- Tick number (`t = 14`).
- Sim speed (1x / 2x / 4x).
- "agents busy: 3/6" indicator.

## Human checkpoint modal

When a checkpoint fires, the cockpit dims and a modal opens:

- Title: the role the visitor is taking (e.g. "You are the CRO.").
- Body: the agent's prepared draft (memo, packet, action) with
  inline edit, plus the rationale and the policy that produced it.
- Footer buttons: **Approve** · **Reject (with reason)** · **Edit
  & approve**.
- The decision is logged in the Audit Log with the visitor's choice
  and the agents resume on the next tick.

The visitor cannot dismiss the modal without choosing — this is
intentional. It is the moment the demo earns the word "agentic".

## The simulation tick engine

A small, shared in-browser runtime. One module, used by every demo.

### Public API (sketch)

```ts
type AgentId = string;
type TickEvent = {
  at: number;
  kind: "seed" | "manual";
  payload: any;
};
type AgentBehaviour = {
  onTask(task: Task, mem: Memory, tools: Tools): Promise<AgentResult>;
};
type Scenario = {
  slug: string;
  seedEvents: TickEvent[];
  agents: Record<AgentId, AgentBehaviour>;
  tools: Tools;                  // stubbed in-memory implementations
  workflows: Record<string, Workflow>;
  initialMemory: Memory;
  initialKpis: Kpi[];
};
type EngineApi = {
  state(): EngineState;
  play(): void;
  pause(): void;
  step(): void;
  inject(ev: TickEvent): void;
  reset(): void;
  subscribe(cb: (s: EngineState) => void): () => void;
};
```

`EngineState` carries the per-agent lane state, the memory, the
workflow runs, the KPI deltas, the open human checkpoint (if any),
and the audit log. The cockpit and every other tab subscribe to it.

### Tick semantics

- Each tick advances the clock by one simulated second (default).
- On every tick, the engine:
  1. Drains the seed/manual event queue and routes new tasks via
     the orchestrator's planning function.
  2. Advances any agent currently in `thinking` / `calling tool`
     state by its declared step duration.
  3. If an agent finishes a task, fires its `onComplete` hook (which
     may write to memory, hand off to another agent, fire a
     workflow step, or open a checkpoint).
  4. If a human checkpoint is open, the engine pauses (no further
     ticks) until the visitor responds.
- All tool calls are stubbed and return deterministic results based
  on the scenario data + the current memory.
- Latencies are simulated to make the cockpit feel alive (50–500ms
  per call), not real network calls.

### Per-tool scenario shape

Each tool ships:

- A `scenarios/<slug>.ts` data file declaring `Scenario`.
- A `surfaces/<slug>/` folder with the small bespoke UI for that
  tool's Live Inbox, Workflows detail, and Workspace tabs (the
  cockpit / KPIs / audit log are shared).

This means **all the agentic plumbing is shared** and per-tool work
is just data + a small set of bespoke surface components.

## Bilingual & RTL

- Every label, button, modal, and audit-log entry is bilingual.
- The shell flips to RTL when AR is selected: top bar mirrors, left
  rail becomes right rail, swimlane state edges flip side, modal
  stays centered.
- All scenario data uses `BiText` for human-visible strings (agent
  names, decisions, drafts, KPI labels).

## Out of scope for this design

- Persistence across sessions (no save / resume).
- Real auth or user accounts in the demo shell.
- Real backend or ML inference — the simulation is a deterministic
  data-driven runtime.
- Mobile-first responsive demo. The shell targets desktop ≥ 1280px.
  Below that, the demo gracefully falls back to a stacked single-pane
  cockpit and a notice that the full experience is desktop-only.
