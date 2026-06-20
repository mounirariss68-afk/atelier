# Agent Design Spec: Adoption Coach

> Layer 2 design spec. Follows the template in
> `artifacts/atelier/AGENT_STANDARD.md` §10. No code or registry changes.

### Agent: Adoption Coach

- **id:** `ag_adoption_coach`
- **kind:** Drafter
- **trigger:** Manual button on an engagement, plus an event trigger
  when a deliverable of `kind: go_live` (from Workplan Architect)
  enters its T-2-week window. The button can be pressed any time the
  Lead wants a fresh play; the event trigger guarantees at least one
  pre-launch coaching cycle.
- **persona:** Engagement Lead invokes; the audience for the play is
  the **client change-lead** (named on the engagement record). The
  Lead reviews, edits, and shares.

#### Inputs

```ts
inputSchema: z.object({
  engagementId: z.string(),
  focus: z.enum(["pre_launch", "launch_week", "post_launch_30d",
                 "stalled_adoption", "exec_alignment"]).default("pre_launch"),
  audience: z.object({
    role: z.enum(["client_change_lead", "client_executive_sponsor",
                  "end_user_manager", "frontline_user_cohort"]),
    cohortSize: z.number().int().positive().optional(),
    contextNotes: z.string().optional(),
  }),
  knownObstacles: z.array(z.string()).optional(),  // Lead-supplied
})
```

The runner expands `engagementId` into:

- charter objectives + value hypothesis,
- workplan milestones (especially next `go_live` / `client_review`),
- recent meeting-scribe `fiveCDelta.client` and `openQuestions`,
- prior `ag_adoption_coach` runs on this engagement (so a re-run is a
  *next* play, not a repeat),
- open RAID items where `ownerRole = "client"` (client-side blockers
  the play should address).

#### Outputs

A **play**: one focused coaching artifact the Lead can hand to the
client change-lead. A play has goals, an audience, a sequence of
moves, talking points, materials to send, and tracked progress
markers.

```ts
outputSchema: z.object({
  playId: z.string(),
  title: z.string(),
  focus: z.enum(["pre_launch", "launch_week", "post_launch_30d",
                 "stalled_adoption", "exec_alignment"]),
  audience: z.object({
    role: z.string(),
    framing: z.string(),                     // one-sentence "why this play, why them"
  }),
  goals: z.array(z.object({
    id: z.string(),
    statement: z.string(),                   // outcome-shaped
    successSignal: z.string(),               // observable, not "feels good"
  })).min(1).max(3),
  moves: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["meeting", "comms", "training", "office_hours",
                  "champion_activation", "exec_brief"]),
    when: z.enum(["this_week", "next_week", "in_2_weeks"]),
    durationMin: z.number().int().positive().nullable(),
    owner: z.enum(["client_change_lead", "cognirise_lead", "cognirise_consultant"]),
    talkingPoints: z.array(z.string()).min(1),
    materialsToSend: z.array(z.object({
      title: z.string(),
      kind: z.enum(["one_pager", "deck", "video", "checklist", "faq"]),
      sourceRef: z.string().nullable(),      // existing asset id, else null = to-create
    })),
    addressesObstacles: z.array(z.string()), // free-text hooks back to knownObstacles
  })).min(2).max(6),
  progressMarkers: z.array(z.object({
    id: z.string(),
    label: z.string(),                       // e.g. "20 frontline users completed module 1"
    metric: z.enum(["count", "pct", "binary", "nps"]),
    target: z.number().nullable(),
    dueDate: z.string(),                     // ISO
  })).min(1),
  reflectionPrompt: z.string(),              // for the Lead post-play debrief
})
```

#### Data sources

- `atelier_charters`, `atelier_workplans` (milestones + objectives),
- `atelier_meetings` (5C delta on the *client* axis especially),
- `atelier_raid_proposals` / RAID register (client-owned items),
- prior `ag_adoption_coach` runs (`atelier_agent_runs`),
- knowledge corpus tagged `change_management` (a curated playbook
  library — kept under `lib/agents/knowledge/change_mgmt/` once that
  exists; the prompt uses `knowledge.search` to retrieve).

#### Side effects

- Persists the play into a new domain table `atelier_adoption_plays`
  (status: `draft | shared | in_flight | closed`). Each play row has
  a `progress` JSONB tracking marker-level state and a foreign key to
  the agent run.
- After Lead approval, a one-time `agent.notify` step emails / DMs
  the named client change-lead with the play (templated; the agent
  produces the body, the runner sends).
- Audit events: `agent.start`, `agent.complete`, `play.draft`,
  `play.share`, `play.markerUpdate`, `play.close`.
- No mutation of charter, workplan, or RAID — adoption work is a
  parallel surface, not an edit on engagement source-of-truth.

#### Progress tracking

Once the play is `shared`, progress markers are the unit of follow-up:

- The Lead (or an upcoming `ag_adoption_pulse` sentinel — out of
  scope here) updates each marker as `not_started | in_progress |
  hit | missed`.
- Missed markers automatically trigger a re-run of Adoption Coach
  with `focus: stalled_adoption`, pre-loading the missed markers as
  `knownObstacles`.
- A play closes when all `progressMarkers` are `hit` or the Lead
  explicitly closes it. Closure writes a `play.close` audit event
  with a Lead-supplied outcome note that becomes a knowledge entry
  for future plays.

#### Human checkpoints

1. **Engagement Lead** — review the play before share. Blocking. The
   Lead may edit any field; their edits are diffed and stored on the
   play row so future runs can learn from them.
2. *(Optional, non-blocking)* **Partner** — copied when the play's
   `audience.role = "client_executive_sponsor"`.

#### Prompt outline (`prompts/adoption_coach/v1.md`)

- **Role.** "You are Adoption Coach. You write a single, focused
  change-management play for one audience and one moment in the
  engagement."
- **Inputs section.** Engagement objectives, value hypothesis, next
  milestone, recent client-side signals, prior plays, retrieved
  change-management patterns.
- **How you work.** Four sub-steps:
  1. *Frame* — name the moment (e.g. "T-10 days to go-live, frontline
     awareness still low") in one sentence.
  2. *Set goals* — 1–3 outcome-shaped goals, each with an observable
     success signal.
  3. *Sequence moves* — 2–6 moves in a coherent order, alternating
     comms / activation / training as appropriate. Each move addresses
     at least one named obstacle (from `knownObstacles` or inferred).
  4. *Define markers* — make progress observable in concrete units
     (counts, %, binary, NPS).
- **Hard rules.**
  - Every goal has an observable success signal — no "increase
    awareness" without a metric.
  - Every move has ≥1 talking point and either an existing asset
    (`sourceRef`) or a clearly named to-create asset.
  - The play targets exactly one audience role. To address multiple
    audiences, run multiple plays.
  - The play references the upcoming workplan milestone by id when
    `focus ∈ {pre_launch, launch_week}` so the play stays anchored to
    the live engagement plan.

#### Success criteria

- Lead share rate ≥ 70% (plays drafted that get pushed to a client).
- Median marker hit-rate ≥ 60% per play.
- Re-runs with `focus: stalled_adoption` decline over the engagement
  lifetime — i.e. fewer recoveries needed because earlier plays
  worked.
- Zero plays shared with empty `progressMarkers`.

#### Eval ideas

- **Shape eval.** Golden fixture: pre-launch focus, frontline cohort
  of 200, two known obstacles (`"unclear value to floor staff"`,
  `"manager fatigue from prior tooling change"`). Assert: 2–6 moves,
  every move addresses at least one of those two obstacles, ≥1
  marker with a numeric target.
- **Audience-singularity eval.** Feed an audience role; assert no
  other audience role appears in `audience` or in
  `moves[*].owner`-derived recipients.
- **Anchor eval.** Provide a workplan with a `go_live` deliverable in
  10 days; with `focus: pre_launch`, assert the run output's
  `progressMarkers[*].dueDate` all fall on or before that go-live
  date.

#### UI

- **Bespoke.** `uiComponent: "/atelier/engagements/:id/plays/:runId"`
  with rationale "moves + markers need a kanban + progress UI; share
  / mark-progress flows do not fit the generic JSON view."
- The Atelier home dashboard shows an "Active plays" widget for the
  Lead — a thin list view fed from `atelier_adoption_plays` where
  `status = shared | in_flight`.

#### Relationship to other agents

- **Charter Architect / Workplan Architect.** Provide the goals
  surface and the milestone calendar plays anchor to. The
  `addressesObstacles` field hooks into RAID items where the owner is
  the client.
- **Meeting Scribe.** Supplies the qualitative "is the client
  actually moving" signal via `fiveCDelta.client`. A sustained negative
  delta is a strong trigger for a `stalled_adoption` re-run.
- **RAID Watchdog.** Client-owned `red` items appear in the
  `knownObstacles` input automatically. A successful play that closes
  a marker can in turn cause Watchdog to propose a `close` on the
  related RAID item.
- **Value Case Tracker.** Marker hit-rate feeds the qualitative
  "adoption signal" line of the value case.
