# Value Realization Tracker — `value-realization` (flagship)

## Buyer & pain
- **Buyer**: CFO and Transformation Lead of a GCC operator, bank, or
  ministry running a 2–4 year transformation portfolio.
- **Named pain**: Steering committees see initiative status pages
  but cannot see *value* — what was promised, what landed, what
  leaked, and what the CFO can defend on the next earnings call. By
  the time leakage shows up in actuals, the quarter is gone.

## Problem statement
- Average GCC megaprogramme captures **35–45%** of the value cases
  promised at funding [M2]. The rest leaks through scope creep,
  dependency slips, benefit-baseline drift, and sponsor turnover.
- McKinsey's 2024 *State of AI* finds that fewer than 30% of
  enterprise gen-AI initiatives reach measurable EBITDA impact
  within 12 months of launch [S1]. Boston Consulting's *Where's the
  Value in AI?* puts the same number at ~25% across all AI
  programmes [S6].
- Buyer quote (representative, GCC operator CFO):
  *"I have 64 initiatives. I do not have 64 owners who can tell me
  what they are still going to land this quarter."*

## Solution
A continuously-running orchestrator (`portfolio-conductor`) watches
every initiative in the programme, derives a UVR (Unit of Value
Realised) score per initiative, autonomously detects leakage as it
emerges, drafts a CFO one-pager when value-at-risk crosses policy,
and routes the pack to the CFO for sign-off before steering.

## Agent architecture

```
              ┌─────────────────────────────┐
              │ ORCHESTRATOR                 │
              │ portfolio-conductor          │
              └─────────────────────────────┘
                 │   │   │   │
       ┌─────────┘   │   │   └──────────────┐
       ▼             ▼   ▼                  ▼
 ┌────────────┐ ┌──────────┐ ┌──────────────────┐
 │ portfolio-  │ │ uvr-     │ │ leakage-          │
 │ watcher     │ │ scorer   │ │ detective         │
 └────────────┘ └──────────┘ └──────────────────┘
       │             │              │
       ▼             ▼              ▼
   tools:        tools:         tools:
   pmo.repo,     bench.lookup,  variance.scan,
   memory.read   memory.write   policy.check
                                       │
                                       ▼
                            ┌──────────────────┐
                            │ cfo-narrator     │
                            └──────────────────┘
                                       │
                                       ▼
                          HUMAN CHECKPOINT: CFO sign-off
```

- **Orchestrator**: `portfolio-conductor` — owns the workflow,
  decides when to run each specialist, gates the human checkpoint.
- **Specialists**:
  - `portfolio-watcher` — pulls initiative status from the PMO repo
    every tick.
  - `uvr-scorer` — computes per-initiative UVR (promised vs landed
    vs at-risk).
  - `leakage-detective` — flags drift and attributes the cause
    (scope, dependency, benefit-baseline, sponsor).
  - `cfo-narrator` — drafts the CFO one-pager when the policy
    triggers.
- **Tools**: `pmo.initiatives.list`, `pmo.initiative.get`,
  `bench.lookup`, `variance.scan`, `policy.check`,
  `memory.read/write`, `pack.compile`.
- **Memory**: shared portfolio state — initiative file (status,
  UVR, leakage tags), policy file, CFO narrative draft.
- **Human checkpoint**: **CFO sign-off** before the pack goes to
  steering. CFO can approve, reject (with reason), or edit & approve.

## Autonomous workflows
1. **Tick monitor** — Every sim minute the orchestrator runs
   `portfolio-watcher → uvr-scorer` across all initiatives, updates
   the heatmap, no human required.
2. **Auto-flag at-risk** — When `leakage-detective` finds an
   initiative whose at-risk value crosses policy (default 8% of
   committed value or 90 days drift), it creates a "value-at-risk"
   case in the inbox.
3. **Auto-draft CFO one-pager** — When ≥3 at-risk cases are open or
   total VaR > 5% of programme value, `cfo-narrator` autonomously
   compiles the one-pager and opens the CFO sign-off checkpoint.
4. **Sponsor nudge** — When a sponsor has not responded to a flag
   for 5 sim days, the orchestrator drafts a sponsor email and
   routes it (Service Director checkpoint).
5. **Quarter-close** — On programmable trigger, the orchestrator
   runs the full chain end-to-end and opens the CFO checkpoint.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Value capture rate | 35–45% | 65–75% | [M2, S6] |
| Time to detect at-risk initiative | 30–60 days | < 1 day | [M2] |
| CFO one-pager assembly time | 4–6 days | < 30 minutes | [M2] |
| Steering decisions deferred per cycle | 4–6 | 1–2 | [M2] |
| Sponsor response cycle | 8–12 days | 2–3 days | [M2] |

## Demo scenario script
- Seed: 12 initiatives across 3 transformation programmes. Three of
  them have hidden leakage (silent dependency slip, baseline reset,
  scope creep) the visitor will see the agents detect.
- t=0 → orchestrator runs the tick monitor, all initiatives green.
- t=2 → `leakage-detective` flags initiative I-007 (silent
  dependency slip on shared platform team). Inbox count = 1.
- t=5 → second flag (baseline reset on I-013). Inbox = 2.
- t=8 → third flag (scope creep on I-021), policy fires VaR >
  threshold, `cfo-narrator` autonomously drafts the one-pager.
  Checkpoint opens.
- Visitor takes the CFO role, reviews the pack, edits one number,
  approves. Audit Log records the decision.
- t=10 → orchestrator marks the workflow complete, KPI panel updates.

## Acceptance criteria
1. Detail page renders hero, problem, solution, agent topology, all
   five autonomous workflows, KPI table with citations.
2. Demo opens at `/demo/value-realization` in the dedicated shell.
3. Orchestrator's lane is always visible in the cockpit and shows
   the current workflow + next planned step.
4. Inbox tab shows the live VaR cases as they are detected.
5. CFO checkpoint modal blocks the cockpit until the visitor acts.
6. Audit Log records every decision and tool call with policy chip.
7. KPI panel updates as workflows complete; sources footnoted.
8. Bilingual EN/AR, RTL clean.
