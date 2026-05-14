# Agent Design Spec: Workplan Architect

> Layer 2 design spec. Follows the template in
> `artifacts/atelier/AGENT_STANDARD.md` §10. No code or registry changes.

### Agent: Workplan Architect

- **id:** `ag_workplan_architect`
- **kind:** Drafter
- **trigger:** Manual button on an engagement, fired once after Charter
  Architect has produced a charter + hypothesis tree. May be re-run
  after a scope change. Not scheduled.
- **persona:** Engagement Lead invokes; Engagement Lead + Partner
  receive. Workstream Leads see assignments via notifications.

#### Inputs (plain English → Zod sketch)

The agent reads:

- the engagement's latest **Charter Architect** run (objectives, scope,
  workstreams, hypothesis tree branches with leaf evidence asks),
- the won proposal summary (for committed deliverables / SOW dates),
- the engagement team roster (roles + capacity flags),
- any prior workplan run for the same engagement (so a re-run is a
  delta, not a wipe).

```ts
inputSchema: z.object({
  engagementId: z.string(),
  charterRunId: z.string(),                 // pin to a specific charter
  startDate: z.string(),                    // ISO date, kickoff
  targetEndDate: z.string(),                // ISO date, SOW end
  team: z.array(z.object({
    userId: z.string(),
    role: z.enum(["lead", "manager", "consultant", "analyst", "sme"]),
    capacityPctPerWeek: z.number().min(0).max(100),
  })),
  cadence: z.enum(["weekly", "biweekly"]).default("weekly"),
  priorWorkplanRunId: z.string().optional(),
})
```

#### Outputs (plain English → Zod sketch)

A structured workplan: ordered phases mapped to charter workstreams,
each containing deliverables with owner, reviewer, due date, and the
hypothesis-tree leaves the deliverable is meant to test. Plus a flat
list of milestones for steering reviews.

```ts
outputSchema: z.object({
  workplanTitle: z.string(),
  phases: z.array(z.object({
    id: z.string(),
    name: z.string(),
    workstreamRef: z.string(),               // charter workstream id
    startDate: z.string(),
    endDate: z.string(),
    deliverables: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      ownerUserId: z.string(),
      reviewerUserId: z.string().nullable(),
      due: z.string(),
      effortDays: z.number().positive(),
      hypothesisLeafRefs: z.array(z.string()), // charter tree leaf ids
      dependsOn: z.array(z.string()),          // other deliverable ids
      acceptanceCriteria: z.array(z.string()).min(1),
    })),
  })).min(1),
  milestones: z.array(z.object({
    id: z.string(),
    name: z.string(),
    date: z.string(),
    kind: z.enum(["steering", "client_review", "internal_qa", "go_live"]),
  })),
  capacityFlags: z.array(z.object({
    userId: z.string(),
    weekOf: z.string(),
    loadPct: z.number(),                      // > 100 ⇒ overallocation
  })),
  meceFlags: z.array(z.string()),             // gaps / overlaps vs charter
})
```

#### Data sources

- `atelier_charters` (charter row + serialized hypothesis tree),
- `atelier_agent_runs` (`ag_charter_architect` output for the pinned run),
- `atelier_engagements` + roster,
- prior `ag_workplan_architect` run (if `priorWorkplanRunId` provided),
- read-only references to the `atelier_proposals` row attached to the
  engagement.

#### Side effects

- Writes a draft into a new domain table `atelier_workplans`
  (proposed in this spec; field shape mirrors `outputSchema`). The
  table holds `status: draft | approved | superseded`, the original
  `agentRunId`, and the human-edited final.
- Emits `agent.start`, `agent.complete`, plus domain audit events
  `workplan.draft`, and (after checkpoint) `workplan.approve` /
  `workplan.reject`.
- Notifies each `ownerUserId` via `atelier_notifications` after
  approval, not before.

#### Human checkpoints (ordered, blocking)

1. **Engagement Lead** — review deliverables, owners, dates, MECE flags.
   Blocking. Lead may edit any field inline before approving.
2. **Partner** — sign off on milestones + go-live date. Blocking only
   when the engagement is flagged `partnerSignoffRequired` on the
   charter. Otherwise skipped.

`humanCheckpoints[*].decider` therefore = `lead` then optionally
`partner`.

#### Prompt outline (`prompts/workplan_architect/v1.md`)

- **Role.** "You are Workplan Architect. You convert a Charter
  Architect output into a sequenced, owner-assigned, dated workplan."
- **Inputs section.** Charter (objectives, scope, workstreams,
  hypothesis tree leaves + evidence asks), team roster + capacity,
  start / target end, cadence.
- **How you work.** Three sub-steps:
  1. *Phase Mapper* — one phase per charter workstream, in topological
     order on hypothesis-tree dependencies.
  2. *Deliverable Decomposer* — for each phase, emit 2–6 deliverables.
     Every deliverable cites at least one `hypothesisLeafRef`. Every
     deliverable carries acceptance criteria written as testable
     statements (verb-led, observable).
  3. *Schedule + Capacity Pass* — assign owner + reviewer from the
     roster; pack into the cadence; emit `capacityFlags` for any week
     where a user exceeds their `capacityPctPerWeek`.
- **Hard rules.**
  - Every charter objective is covered by ≥1 deliverable. Otherwise
    add to `meceFlags`.
  - No deliverable depends on a deliverable in a *later* phase.
  - Dates fall inside `[startDate, targetEndDate]`.
  - `effortDays` is integer-day estimate the Lead can sanity-check.
  - The agent does not invent users — owners + reviewers must be drawn
    from the supplied roster.

#### Success criteria

- Lead approves the first draft with edits to ≤30% of deliverables on
  median (tracked via diff between agent output and approved row).
- 100% of charter objectives map to at least one deliverable.
- Zero deliverables without an owner, due date, or acceptance criteria.
- `capacityFlags` are populated when the roster is overloaded — an
  unflagged overallocation in production is a regression.

#### Eval ideas

- **Shape eval (golden fixture).** Synthetic charter with 3 objectives,
  4 workstreams, depth-2 tree, 5-person team. Assert: `phases.length ≥
  1`, every objective covered, no future-phase dependencies, all dates
  within range. Mirror as `tests/agents/ag_workplan_architect/golden.json`.
- **Capacity eval.** Roster where one consultant is at 50% capacity;
  feed deliverables that would push them to 120%. Assert
  `capacityFlags` contains that user.
- **Coverage eval.** Drop one charter objective from the prompt input;
  assert the agent emits an entry in `meceFlags` rather than silently
  shipping a partial plan.

#### UI

- **Generic registry-driven** for v1. The standard `AgentRun.tsx`
  renders the workplan JSON; the Lead approves / rejects there.
- Bespoke editor (Gantt / drag-to-reschedule) is a follow-up; if
  added, set `uiComponent: "/atelier/engagements/:id/workplan/:runId"`
  with rationale "structured table + dependency graph is unreadable in
  the generic JSON view."

#### Relationship to other agents

- **Charter Architect (upstream, hard dependency).** Workplan Architect
  refuses to run unless `charterRunId` resolves to a completed
  `ag_charter_architect` run on the same engagement. The workplan's
  `phases[*].workstreamRef` and `deliverables[*].hypothesisLeafRefs`
  are foreign keys into the charter — that is the contract.
- **RAID Watchdog (downstream).** Once the workplan exists, RAID
  Watchdog uses `deliverables[*].due` and `dependsOn` as inputs to its
  scheduled scan (a slipping deliverable becomes a candidate red).
- **Value Case Tracker (downstream).** Milestones (`go_live`,
  `client_review`) are the cadence anchors against which value-case
  realization is measured.
