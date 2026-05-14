# Agent Design Spec: RAID Watchdog

> Layer 2 design spec. Follows the template in
> `artifacts/atelier/AGENT_STANDARD.md` §10. No code or registry changes.

### Agent: RAID Watchdog

- **id:** `ag_raid_watchdog`
- **kind:** Sentinel
- **trigger:** Two paths, both into the same runner.
  1. **Scheduled scan** — cron, once per weekday at 06:00 local per
     active engagement. Configured via the standard sentinel scheduler.
  2. **Event-driven** — fires when any of these happen on an active
     engagement: a `ag_meeting_scribe` run completes, a
     `workplan.update` audit event lands, an action item passes its
     due date without close, or a Pane A item ages past 5 working days.
- **persona:** Engagement Lead receives proposals and alerts. Partner
  is copied on items the agent classifies as `red`.

#### Inputs

The agent reads, per engagement:

- the latest charter (baseline RAID items from Charter Architect),
- the latest workplan (deliverables, due dates, dependency graph),
- recent `ag_meeting_scribe` runs (`decisions`, `actionItems`,
  `openQuestions`, `fiveCDelta`),
- open action items + their owners and ages,
- ledger / utilization signals attached to the engagement (burn vs
  budget — the same data Burn Sentinel uses),
- the current open RAID register (so it proposes deltas, not duplicates).

```ts
inputSchema: z.object({
  engagementId: z.string(),
  triggerKind: z.enum(["scheduled", "meeting_completed", "workplan_updated",
                       "action_overdue", "pane_a_aging"]),
  triggerRef: z.string().optional(),       // related run id / item id
  windowDays: z.number().int().positive().default(7),
})
```

The runner expands `engagementId` into the full context above before
calling the LLM; the prompt sees pre-shaped facts, not raw rows.

#### Outputs

A list of **proposals** to add / update / close RAID items, each tagged
with severity and a recommended decider. The agent does not directly
mutate the RAID register; it proposes, a human commits (Drafter-style
checkpoint) — but because it's a Sentinel, anything classified `red`
also fires a Pane A alert immediately.

```ts
outputSchema: z.object({
  scanId: z.string(),
  proposals: z.array(z.object({
    op: z.enum(["add", "update", "close"]),
    targetRaidId: z.string().nullable(),      // null when op=add
    kind: z.enum(["risk", "assumption", "issue", "dependency"]),
    title: z.string(),
    description: z.string(),
    severity: z.enum(["green", "amber", "red"]),
    ownerRole: z.enum(["lead", "manager", "consultant", "client", "partner"]),
    targetDateClass: z.enum(["this_week", "next_week", "this_month", "later"]),
    evidence: z.array(z.object({
      kind: z.enum(["meeting", "action_item", "deliverable", "ledger",
                    "pane_a", "five_c_delta"]),
      ref: z.string(),                         // id pointing into source row
      excerpt: z.string().optional(),
    })).min(1),                                // every proposal must cite
    rationale: z.string(),
  })),
  alerts: z.array(z.object({
    proposalIndex: z.number().int(),           // index into proposals[]
    paneAItemKind: z.literal("raid_red"),
    summary: z.string(),
  })),
})
```

#### Data sources

- `atelier_charters` (baseline RAID),
- `atelier_workplans` (deliverables + dependencies — see Workplan
  Architect spec for the table proposal),
- `atelier_meetings` + `atelier_agent_runs` filtered by
  `agentId = ag_meeting_scribe`,
- `atelier_pane_a_items` (existing aging items),
- `atelier_audit_events` (recent `workplan.*`, `actionItem.*`),
- ledger / utilization snapshots (read-only).

#### Side effects

- Persists each proposal into a new domain table `atelier_raid_proposals`
  with `status: pending | applied | dismissed` and a foreign key back
  to the agent run.
- For every entry in `alerts[]` (i.e. severity = `red`), inserts an
  `atelier_pane_a_items` row of kind `raid_red` so the Lead's home
  surface lights up immediately. The Pane A item links back to the
  proposal — clicking it lands on the same review screen the
  checkpoint uses.
- Audit events: `agent.start`, `agent.complete`, plus domain events
  `raid.proposal.create` and (post-checkpoint) `raid.proposal.apply` /
  `raid.proposal.dismiss` and `raid.item.update`.
- Notifies the Lead per scan if proposals are non-empty; notifies the
  Partner only when at least one `red` is in the batch.

#### Proposal-vs-alert flow

This is the distinguishing behavior — write it explicitly so the
implementation task does not collapse the two.

| Severity | Behavior on emit                                                      | Human checkpoint              |
| -------- | --------------------------------------------------------------------- | ----------------------------- |
| green    | Stored as proposal. No notification.                                  | Lead reviews in batch (24h)   |
| amber    | Stored as proposal. Lead notification.                                | Lead reviews in batch         |
| red      | Stored as proposal **and** Pane A item. Lead + Partner notification.  | Lead reviews immediately      |

A `red` Pane A item that is dismissed without applying the proposal
(or is left untouched for >24h) is itself a Watchdog signal on the
next scan — it becomes a meta-RAID item ("repeat-dismissed risk").

#### Human checkpoints (ordered)

1. **Engagement Lead** — bulk approve / edit / dismiss the batch of
   proposals. Blocking before any RAID register row is mutated.
2. **Partner** — visibility only on `red` items; not blocking. Partner
   may escalate to a steering item which is a separate workflow.

#### Prompt outline (`prompts/raid_watchdog/v1.md`)

- **Role.** "You are RAID Watchdog. You read engagement signals and
  propose minimal, evidence-cited changes to the RAID register."
- **Inputs section.** Pre-shaped facts: open RAID, recent meeting
  scribe outputs, overdue action items, deliverable slips, ledger
  burn delta, Pane A aging items.
- **How you work.** Four sub-steps:
  1. *Diff* — compare current world to the open RAID register; list
     what is *new*, what *worsened*, what *resolved*.
  2. *Classify* — bucket each candidate into risk / assumption / issue /
     dependency using the standard definitions (issue = already
     happening; risk = might happen; assumption = belief load-bearing
     on the plan; dependency = external party / artifact required).
  3. *Severity triage* — `red` if it threatens an SOW commitment, the
     go-live date, or client trust this week; `amber` if it threatens
     a milestone in the next two weeks; otherwise `green`.
  4. *Cite* — every proposal carries ≥1 entry in `evidence[]`. No
     evidence ⇒ refuse to emit.
- **Hard rules.**
  - Never propose `add` for an item that is already in the open RAID
    register with the same title (case-insensitive). Use `update`.
  - Never propose `close` without an evidence entry showing the
    triggering event (decision, deliverable accepted, etc.).
  - Severity = `red` requires explicit reference to a deliverable id,
    SOW commitment, or steering decision. No vibes-reds.

#### Success criteria

- ≥80% of `red` proposals are accepted by the Lead within 24h
  (measured over a rolling 14-day window).
- Zero proposals without `evidence[]` reach Pane A.
- Median time from a meeting-scribe-detected slippage to a RAID
  proposal: same scan window (≤6h).
- Repeat-dismissed proposals decline week over week — i.e. the agent
  learns from dismissals (via the closed-loop metric, not online
  training).

#### Eval ideas

- **Shape eval.** Golden fixture with one charter, one workplan, two
  meetings (one introduces a dependency slip, one closes an action).
  Assert: ≥1 proposal of kind `dependency` with severity `amber`+,
  ≥1 `close` proposal, every proposal carries `evidence[]`.
- **No-evidence eval.** Feed the prompt a context where the only
  signal is missing. Assert `proposals.length === 0` rather than
  hallucinated risks.
- **Dedup eval.** Pre-load a `red` risk identical to one the agent
  would otherwise add. Assert it produces an `update` rather than a
  duplicate `add`.
- **Red-trigger eval.** Plant a workplan deliverable that has slipped
  past a steering milestone. Assert exactly one `red` proposal with a
  Pane A alert.

#### UI

- **Bespoke.** `uiComponent: "/atelier/engagements/:id/raid/scan/:runId"`
  with rationale "the Lead needs a checkbox grid (per-proposal
  approve / edit / dismiss) plus an inline RAID register diff; the
  generic JSON view cannot do bulk apply."
- The Pane A alert for `red` items deep-links into the same view,
  scrolled to the offending proposal.

#### Relationship to other agents

- **Charter Architect.** Provides the baseline RAID register; the
  Watchdog's first scan diffs against this baseline.
- **Meeting Scribe.** Primary signal source. `decisions`,
  `actionItems`, `openQuestions`, `fiveCDelta` all feed the *Diff*
  sub-step. A Meeting Scribe completion is one of the event triggers.
- **Workplan Architect.** Slips in `deliverables[*].due` and
  `dependsOn` graph violations are the canonical evidence for
  dependency / issue items.
- **Value Case Tracker.** Reads back from `atelier_raid_proposals`
  to flag value-at-risk when a `red` is open against a milestone the
  value case is anchored on.
