# Agent Design Spec: Value Case Tracker

> Layer 2 design spec. Follows the template in
> `artifacts/atelier/AGENT_STANDARD.md` §10. No code or registry changes.

### Agent: Value Case Tracker

- **id:** `ag_value_case_tracker`
- **kind:** Analyst
- **trigger:** Two paths.
  1. **Scheduled** — weekly per active engagement (Monday 07:00
     local), to refresh the realized-vs-baseline snapshot ahead of
     steering meetings.
  2. **Event-driven** — fires when a workplan milestone of kind
     `go_live` or `client_review` is marked complete, when an
     adoption-play marker is `hit`, or when Charter Architect emits a
     new charter (which establishes / resets the baseline).
- **persona:** Engagement Lead consumes weekly; Partner consumes at
  steering cadence; Account Lead consumes for account-level rollups.

#### Inputs

```ts
inputSchema: z.object({
  engagementId: z.string(),
  triggerKind: z.enum(["scheduled", "milestone_complete",
                       "marker_hit", "charter_updated"]),
  triggerRef: z.string().optional(),
  asOf: z.string(),                              // ISO date the snapshot is for
  priorSnapshotId: z.string().optional(),        // diff anchor
})
```

Runner-expanded context:

- the engagement's value hypothesis from Charter Architect,
- the workplan's milestones and their completion state,
- adoption-play markers,
- ledger / utilization signals (cost-side of value),
- client-supplied baseline data (uploaded artifacts tagged
  `value_baseline` on the engagement),
- evidence rows previously stored on the value case (so a snapshot is
  an *update*, not a rebuild).

#### Outputs

A **value-case snapshot**: structured benefit and cost lines, each
with baseline, target, realized, evidence, and a confidence label.
Plus a one-paragraph narrative the Lead can paste into a steering
deck.

```ts
outputSchema: z.object({
  snapshotId: z.string(),
  asOf: z.string(),
  status: z.enum(["on_track", "at_risk", "off_track"]),
  benefitLines: z.array(z.object({
    id: z.string(),
    label: z.string(),
    metric: z.enum(["currency", "pct", "count", "time_saved_hours",
                    "nps", "binary"]),
    baseline: z.number().nullable(),             // null = no baseline yet
    target: z.number(),
    realized: z.number().nullable(),             // null = not yet measurable
    asOfPctToTarget: z.number().nullable(),      // 0..100; null if not measurable
    confidence: z.enum(["low", "medium", "high"]),
    evidence: z.array(z.object({
      kind: z.enum(["client_artifact", "meeting", "play_marker",
                    "ledger", "milestone", "external_source"]),
      ref: z.string(),
      excerpt: z.string().optional(),
      capturedAt: z.string(),
    })).min(1),
  })).min(1),
  costLines: z.array(z.object({
    id: z.string(),
    label: z.string(),
    plannedCurrency: z.number(),
    incurredCurrency: z.number(),
    burnPct: z.number(),                         // incurred / planned
    confidence: z.enum(["low", "medium", "high"]),
  })),
  netCase: z.object({
    plannedNetBenefit: z.number(),               // sum target benefit - planned cost
    realizedNetBenefit: z.number().nullable(),
    forecastedNetBenefit: z.number(),            // model-based projection
    deltaVsPriorPct: z.number().nullable(),      // vs priorSnapshot
  }),
  risksToCase: z.array(z.object({
    raidProposalRef: z.string().nullable(),
    statement: z.string(),
    impactCurrencyEstimate: z.number().nullable(),
  })),
  narrative: z.string(),                         // ≤ 800 chars, deck-pasteable
})
```

#### Data model — value case

A new domain table `atelier_value_cases` (one per engagement) with
columns: `engagementId` (PK), `currentSnapshotId`, `establishedAt`,
`lastUpdatedAt`, `status`, plus a `baselineJson` (set on first run /
charter update). Each Tracker run inserts a row in
`atelier_value_case_snapshots` keyed by `(engagementId, asOf)`. The
`current` pointer is updated atomically on commit. Old snapshots are
retained for trend lines.

#### Data sources

- `atelier_charters` (`value_hypothesis`, objectives → seed benefit
  lines),
- `atelier_workplans` (milestones drive realization timing),
- `atelier_adoption_plays` (markers as qualitative evidence),
- `atelier_raid_proposals` (open `red` / `amber` items become
  `risksToCase`),
- ledger + utilization snapshots (cost lines + burn),
- engagement attachments tagged `value_baseline` /
  `value_evidence`,
- prior `ag_value_case_tracker` runs (for `deltaVsPriorPct`).

#### Side effects

- Inserts an `atelier_value_case_snapshots` row.
- Updates `atelier_value_cases.currentSnapshotId` and
  `lastUpdatedAt`.
- Audit events: `agent.start`, `agent.complete`,
  `valueCase.snapshot.create`, `valueCase.status.change` (only when
  `status` differs from prior snapshot).
- Pane A: when `status = at_risk` or `off_track` and the prior
  snapshot was `on_track`, file an `atelier_pane_a_items` row of kind
  `value_case_drop` for the Lead. This is the only Pane A surface;
  the Tracker is otherwise silent (Analyst kind, not Sentinel).
- No notifications by default; the Lead pulls the report. A Partner
  notification fires only on a status downgrade to `off_track`.

#### Cadence of updates

- **Weekly** snapshot is the canonical heartbeat.
- **Event-driven** snapshots augment but never replace the weekly
  cadence (so trend lines remain on a regular interval).
- **Charter update** triggers a *baseline reset*: the new run rewrites
  `atelier_value_cases.baselineJson` and starts a fresh trend; older
  snapshots are kept but tagged `superseded_by_charter`.

#### Human checkpoints

Analyst — no blocking checkpoints in the lifecycle; snapshots persist
on completion. The Lead can mark a snapshot `acknowledged` (a
lightweight gesture that fires a `valueCase.snapshot.acknowledge`
audit event). When `status = off_track` and no acknowledgement lands
within 48h, RAID Watchdog picks it up as a candidate `red` item on
its next scan — closing the loop without forcing a hard checkpoint
inside Tracker itself.

#### Prompt outline (`prompts/value_case_tracker/v1.md`)

- **Role.** "You are Value Case Tracker. You quantify how the
  engagement is delivering on its committed value, with cited
  evidence and a confidence label per line."
- **Inputs section.** Charter value hypothesis + objectives, prior
  snapshot, milestone state, adoption markers, ledger burn, baseline
  artifacts, open RAID items.
- **How you work.** Five sub-steps:
  1. *Reconcile baseline* — for each benefit line, ensure baseline +
     target are set; if missing, mark `baseline: null` and emit a
     `risksToCase` item asking the Lead to supply it.
  2. *Measure realized* — pull the latest evidence; if no measurable
     evidence exists yet, set `realized: null`, `asOfPctToTarget:
     null` and explain in evidence excerpt.
  3. *Roll up cost* — sum planned and incurred from the ledger;
     compute `burnPct`.
  4. *Compute net case* — planned, realized, forecast (forecast is
     `realized + (target - realized) * timeRemainingFactor`, where
     the factor is deterministic and computed by the runner, *not*
     the LLM).
  5. *Status* — `on_track` if forecast ≥ 90% of planned net benefit
     and burn ≤ plan + 5%; `off_track` if forecast < 70% or burn >
     plan + 20%; otherwise `at_risk`. Threshold logic is
     deterministic in the runner per Standard §5 (numeric math is
     never delegated to a tool / LLM).
- **Hard rules.**
  - Every benefit line carries ≥1 evidence entry. `low` confidence is
    allowed when the only evidence is qualitative (e.g. a meeting
    quote); `high` requires a hard data point.
  - The narrative must reflect the structured fields — if `status =
    off_track`, the narrative cannot read like a victory lap. A
    self-check enforces this textually before emit.
  - The agent never invents a baseline. Missing baseline → `null` +
    a `risksToCase` row.

#### Reporting surfaces

- **Engagement page.** A "Value case" tab that renders the current
  snapshot and a sparkline of `netCase.realizedNetBenefit` and
  `netCase.forecastedNetBenefit` over time.
- **Atelier home (Lead).** A card showing the current `status` for
  every active engagement the Lead owns; downgrade to `off_track`
  bubbles a Pane A item.
- **Account view.** Aggregated `forecastedNetBenefit` across all
  engagements for an account, used by Account Lead in QBR prep.
- **Steering deck export.** A one-click PDF of the latest snapshot
  (uses the `narrative` plus a table of benefit / cost lines).

#### Success criteria

- 100% of active engagements have a snapshot ≤ 8 days old at any
  time.
- Status transitions correlate with downstream actions: a downgrade
  to `off_track` produces an acknowledged Pane A item or a RAID red
  within one week, ≥80% of the time.
- ≥1 evidence entry per benefit line, always.
- Baseline-missing risks decline week over week as Leads close them.

#### Eval ideas

- **Shape eval (golden fixture).** Charter with two benefit lines
  (one currency, one time-saved-hours), workplan with one go-live
  hit, ledger at 60% burn at 50% of timeline. Assert:
  `benefitLines.length = 2`, both carry evidence, `costLines[*].
  burnPct ≈ 0.6`, `status ∈ {on_track, at_risk}` per the deterministic
  thresholds.
- **Threshold eval.** Feed inputs that force each of `on_track`,
  `at_risk`, `off_track` and assert the runner-computed status
  matches. Confirms the LLM does not override the deterministic rule.
- **No-baseline eval.** Charter with one objective lacking a baseline
  number; assert the snapshot's benefit line has `baseline: null` and
  a corresponding entry in `risksToCase` referencing the missing
  baseline.
- **Narrative-honesty eval.** Force `status = off_track` and assert
  the narrative contains language consistent with that status (a
  simple lexical / sentiment check is enough).

#### UI

- **Bespoke.** `uiComponent: "/atelier/engagements/:id/value-case"`
  with rationale "trend sparklines, benefit/cost tables, and
  per-snapshot drill-down need a dedicated view; the generic JSON
  view obscures the trend, which is the entire point."
- The standard registry-driven run view still works as a fallback
  (raw JSON snapshot for debugging).

#### Relationship to other agents

- **Charter Architect.** Sets the value hypothesis and objectives →
  seeds `benefitLines`. A new charter resets the baseline.
- **Workplan Architect.** Milestones drive when benefit lines become
  measurable; `go_live` completion is the typical event trigger.
- **Meeting Scribe.** Decisions / 5C deltas become qualitative
  evidence on benefit lines (and feed `confidence` downward when the
  client signals doubt).
- **RAID Watchdog.** Open `red` / `amber` items populate
  `risksToCase`; in the other direction, an `off_track` value case
  with no acknowledgement becomes a candidate `red` on Watchdog's
  next scan.
- **Adoption Coach.** Marker hit-rate is direct evidence on adoption
  benefit lines; missed markers downgrade confidence and may flip
  status to `at_risk`.
