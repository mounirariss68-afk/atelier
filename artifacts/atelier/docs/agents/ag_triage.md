# Agent Design Spec — Triage Agent

> Layer 2 design spec. Implementation lives in a follow-on Layer 3 task.
> See `artifacts/atelier/AGENT_STANDARD.md` for the contract this spec
> implements.

### Agent: Triage Agent

- **id:** `ag_triage`
- **kind:** Analyst (read-mostly, no domain mutations beyond writing into
  `atelier_pane_a_items` for the calling persona — Sentinel-style writes
  but no schedule; runs on persona load)
- **trigger:**
  - Event: persona context activated (Home page mount, or POST
    `/atelier/triage/run` from the Pane A refresh control).
  - Optional cron fallback every 15 min for active personas, gated by
    `TRIAGE_CRON` env var. The MVP is event-only.
- **persona:** Every Atelier persona (Mounir/Partner, Operations,
  Engagement Lead, Contractor, Partner-firm Resource). One run per
  persona; output is per-persona.
- **inputs:** persona id, role, current ISO timestamp, optional
  `forceRebuild` flag, optional `panelLimit` (default 8).
  ```ts
  z.object({
    userId: z.string(),
    role: z.string(),
    now: z.string().datetime(),
    forceRebuild: z.boolean().optional(),
    panelLimit: z.number().int().min(1).max(20).default(8),
  })
  ```
- **outputs:** ranked Pane A queue, plus an "explain" trace per item so
  the UI can render the "why this is here" tooltip.
  ```ts
  z.object({
    items: z.array(z.object({
      id: z.string(),                       // panea_… deterministic id
      title: z.string(),
      summary: z.string(),
      priority: z.enum(["low","medium","high"]),
      sourceAgentId: z.string().nullable(), // ag_burn_sentinel, ag_roster_steward, …
      sourceEntity: z.object({
        type: z.string(),                   // engagement, compliance_record, brief, …
        id: z.string(),
      }).nullable(),
      hrefKind: z.string(),
      hrefTargetId: z.string(),
      score: z.number(),                    // computed ranking score
      ageDays: z.number(),
      explain: z.array(z.string()),         // ranking factors
      dueLabel: z.string().nullable(),
    })),
    snoozed: z.array(z.string()),           // item ids hidden by user state
    dismissedToday: z.array(z.string()),
    runMetrics: z.object({
      candidatesScanned: z.number().int(),
      itemsKept: z.number().int(),
      itemsAged: z.number().int(),
    }),
    confidence: z.enum(["green","amber","red"]),
  })
  ```
- **data sources:**
  - `atelier_pane_a_items` (existing rows already produced by other
    agents — Burn Sentinel, Roster Steward, Offboarding Sentinel,
    Onboarding Concierge, Publish Sentinel, etc.).
  - `atelier_agent_runs` filtered by `triggeredByUserId = me` and
    status `awaiting_human` for human-checkpoint items.
  - `atelier_audit_events` for "human_checkpoint" events still open.
  - `atelier_briefs`, `atelier_pov_versions`, `atelier_proposals`,
    `atelier_charters` filtered by ownership for "drafts you started"
    bumps.
  - `atelier_engagement_access` to scope items to engagements the
    persona actually has visibility into.
  - User state table `atelier_pane_a_state` (new — see Storage) for
    snooze / dismiss / pin.
- **side effects:**
  - Writes/updates rows in `atelier_pane_a_items` only for items it
    composes itself (e.g. "Drafts awaiting your review" rollups). Items
    already produced by other agents are read, ranked, and re-emitted
    in the response — never mutated by Triage.
  - Writes `atelier_pane_a_state` (snooze/dismiss/pin) when the UI calls
    the dedicated state endpoints; Triage reads this on every run.
  - Emits `agent.start` and `agent.complete` audit events per run.

#### LLM-augmentation decision

**Recommendation: Rule-based core + LLM advisor (split).**

The ranking/aging/dedup engine is fully deterministic and must stay so
— Pane A is the persona's source of truth for "what needs me today" and
ranking flapping is a worse failure than missing nuance. The LLM advisor
sits **on top** of the deterministic queue and is responsible for:

- One-line "why this matters now" rewrites of `summary` (capped to
  140 chars, refusal allowed if context is missing).
- A short "morning briefing" header (3 sentences max) summarising the
  top 3 items and any cross-item pattern (e.g. "two engagements crossed
  burn 80% in the last 24h").
- Detecting near-duplicates that the rule layer's deterministic id
  cannot (e.g. two compliance items on the same person for related
  jurisdictions) and proposing a merge — the merge itself requires
  human acknowledgement.

The advisor's output is decorative: the queue still renders if the LLM
call fails or is disabled. This is enforced by storing rule-based items
first and only attaching `briefing` / rewritten `summary` if the LLM
returned valid JSON within budget.

#### Ranking + aging rules (deterministic core)

`score = priorityWeight + ageBoost + sourceBoost − snoozePenalty`

- `priorityWeight`: high=100, medium=40, low=10.
- `ageBoost`: linear in days since `created_at`, capped at +30 over
  14 days. Items older than 30 days drop into a "stale" tail and stop
  accruing boost.
- `sourceBoost`: +25 for items whose source agent's last run failed
  (tracked via `atelier_agent_runs.status='failed'`); +15 for human
  checkpoints currently blocking a Drafter run.
- `snoozePenalty`: items snoozed-until in the future score `−Infinity`
  (excluded). Dismissed items in `atelier_pane_a_state` are excluded
  outright.
- Tie-break on `due_label` ascending, then `created_at` ascending.
- Top `panelLimit` rows are returned.

#### Snooze / dismiss / pin model

- **Snooze**: hides item until `snoozed_until`; the source agent re-firing
  a higher bucket (e.g. burn 80→100%) lifts the snooze automatically by
  emitting a new deterministic id.
- **Dismiss**: per-day. Reappears on the next calendar day in the
  persona's timezone; re-emitted by the source agent when the underlying
  state changes.
- **Pin**: forces the item to the top regardless of score, max 3 pins.

#### Prompt outline (advisor only)

1. **System role** — "You are the Triage advisor. The deterministic
   queue is authoritative. You may rewrite summaries and produce a
   morning briefing only."
2. **Inputs block** — JSON of the top N items + persona role + locale.
3. **Constraints** — 140-char rewrite cap, no new items, refuse if any
   item lacks source context.
4. **Output schema** — `{ briefing, rewrites: [{itemId, summary}] }`.
5. **Failure mode** — return `{ briefing: null, rewrites: [] }` rather
   than fabricate.

#### Success criteria

- Persona load → Pane A renders within 400 ms (rule core only).
- Re-running with no underlying changes returns identical ids and
  identical scores (golden snapshot).
- Snoozed items disappear; their re-fire by the source agent (with a
  higher bucket) re-introduces them.
- Top-of-queue items always have a non-null `sourceAgentId` so the
  "why this is here" tooltip works.

#### Eval ideas

- `ev_determinism`: run twice with the same inputs → identical
  `items[*].id` and identical `score`.
- `ev_snooze_respected`: snoozed item is excluded; its higher-bucket
  reissue from source agent appears.
- `ev_advisor_refusal`: if context is missing, advisor returns
  `briefing: null` and the queue is unchanged.
- `ev_no_invented_items`: every returned item id exists in
  `atelier_pane_a_items` (or was composed by Triage's own rollup
  branch and persisted in the same run).

#### UI

- Generic registry-driven list under Agents (`/atelier/agents/ag_triage`).
- The actual user-facing surface is **Home → Pane A** (already exists).
  Triage drives Pane A; no bespoke `uiComponent` needed.

#### Open questions for Layer 3

- Should the morning briefing be cached for the day and only refreshed
  on demand, or recomputed on every Pane A load? Recommendation: cache
  for 1 hour per persona.
- Where does `atelier_pane_a_state` live — new table, or columns on
  `atelier_pane_a_items` keyed by user? Recommendation: new table so
  the same item can be snoozed by one persona but visible to another.
