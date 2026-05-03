# Programme War Room — `programme-war-room`

## Buyer & pain
- **Buyer**: PMO Lead / CIO running a multi-workstream transformation
  programme (typically 6–12 workstreams, 80+ deliverables).
- **Named pain**: The Monday morning programme pack takes 2–3 PMO
  analysts a full day to assemble, is stale by Wednesday, and rarely
  surfaces the three things the steering committee actually needs to
  decide.

## Problem statement
- GCC megaprogramme PMOs spend **40–55%** of their week consolidating
  status from workstream leads and reformatting it for steering [M2].
- McKinsey's 2024 *State of AI* finds programme management is one of
  the top three functions where gen-AI productivity gains are
  consistently realised across regions [S1].
- Buyer quote (representative, GCC ministry CIO):
  *"By the time the steering pack lands, the data is wrong and I am
  asking the wrong questions."*

## Solution
An orchestrator (`war-room-conductor`) continuously pulls workstream
updates, classifies RAID items, recompiles ETC drift in weeks, drafts
the steering pack autonomously, and surfaces the top three asks
before each steering meeting. PMO Lead is the human checkpoint.

## Agent architecture

```
                ┌────────────────────────────┐
                │ ORCHESTRATOR                │
                │ war-room-conductor          │
                └────────────────────────────┘
                  │     │      │      │
        ┌─────────┘     │      │      └────────┐
        ▼               ▼      ▼               ▼
 ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌─────────────┐
 │ programme-  │ │ raid-    │ │ etc-       │ │ ask-        │
 │ watcher     │ │ classifier│ │ recompiler │ │ extractor   │
 └────────────┘ └──────────┘ └────────────┘ └─────────────┘
        │           │             │              │
        ▼           ▼             ▼              ▼
   pmo.workstreams.poll, raid.tag, plan.diff, asks.rank
                                                │
                                                ▼
                                  ┌────────────────────┐
                                  │ steering-drafter    │
                                  └────────────────────┘
                                                │
                                                ▼
                              HUMAN CHECKPOINT: PMO Lead sign-off
```

- **Orchestrator**: `war-room-conductor`.
- **Specialists**: `programme-watcher`, `raid-classifier`,
  `etc-recompiler`, `ask-extractor`, `steering-drafter`.
- **Tools**: `pmo.workstreams.poll`, `raid.tag`, `plan.diff`,
  `asks.rank`, `pack.compile`, `memory.read/write`.
- **Memory**: programme state (workstream RAG, RAID register, ETC
  baseline & drift, ask queue, steering pack draft).
- **Human checkpoint**: **PMO Lead sign-off** on the steering pack.

## Autonomous workflows
1. **Continuous status sweep** — Every sim hour, `programme-watcher`
   polls each workstream feed for changes, no human required.
2. **RAID auto-triage** — New RAID items are classified by
   `raid-classifier` and routed to the appropriate workstream lead
   with a draft mitigation; lead checkpoint at "accept mitigation".
3. **ETC drift detection** — `etc-recompiler` runs nightly, flags
   any workstream whose ETC drifts > 2 weeks vs baseline.
4. **Steering-pack assembly** — Two days before steering, the
   orchestrator runs the full chain and opens the PMO Lead
   checkpoint with the draft pack and top three asks.
5. **Cross-workstream conflict detection** — Detects shared-resource
   conflicts (same engineer booked twice) and proposes a swap.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Steering pack assembly time | 1–2 person-days | < 30 minutes | [M2, S1] |
| RAID time-to-mitigation | 7–10 days | 2–3 days | [M2] |
| ETC drift detected at | drift week + 4 | within 24 hours | [M2] |
| Steering-meeting deferred decisions | 30–40% | 10–15% | [M2] |

## Demo scenario script
- Seed: 8 workstreams, 32 deliverables, 14 RAID items. Two hidden
  shared-resource conflicts and one silent ETC drift the visitor
  will watch the agents discover.
- The visitor opens the cockpit, presses Play. Within a few sim
  hours the agents detect the drift, classify two new RAID items,
  spot a conflict, and assemble the steering pack.
- PMO Lead checkpoint fires. Visitor reviews, edits, approves.

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/programme-war-room`.
3. Workflows tab shows all five workflows and their last runs.
4. Cockpit shows orchestrator + 5 specialists with state, decisions,
   and tool calls.
5. PMO Lead checkpoint modal fires on assembly.
6. Audit Log exportable.
7. Bilingual EN/AR, RTL clean.
