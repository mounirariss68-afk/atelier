# Agent Design Spec — Time Steward

> Layer 2 design spec. Builds on the scaffold merged in task #257 (Ledger / timesheets + Time Steward). A future Layer 3 task implements the registry/runner/UI work below on top of the canonical structure in `AGENT_STANDARD.md`.

---

## What's already built (#257)

The scaffold delivered with task #257 is the foundation this spec completes — do **not** rebuild it.

**Data model (already in `@workspace/db`):**
- `atelier_timesheet_weeks` — one row per (`personId`, `weekIso`); `status ∈ {draft, submitted, lead_approved, partner_approved, approved, rejected}`; aggregates `totalHours`, `billableHours`, `suspiciousFlags[]`, approval timestamps, `rejectionReason`.
- `atelier_timesheet_entries` — one row per (week × workDate × engagement); carries `hours`, `billable`, `narrative`, `activityCode`, `source ∈ {self, agent_drafted, …}`, `draftedByAgentId`, `signalIds[]`, per-entry `status`.
- `atelier_timesheet_signals` — **immutable, append-only** evidence; (`signalType`, `sourceRefType`, `sourceRefId`) is the natural dedup key per week. `signalType ∈ {calendar, meeting, deliverable_edit, salon_decision, agent_run}`.
- `atelier_partner_firm_hours` — separate intake for partner-firm CSV uploads; surfaces in engagement economics, **not** the timesheet (architectural exclusion).

**Routes (already in `artifacts/api-server/src/routes/atelier/ledgerRoutes.ts`):**
- `GET /ledger/timesheets/current` and `GET /ledger/timesheets/:personId/:weekIso` — own week or, for approvers, anyone's. Auto-runs the steward on first open of an empty draft (`maybeAutoDraft`).
- `POST /ledger/timesheets/:weekId/draft` — manually re-trigger the steward.
- (Plus: entries CRUD, submit, lead-approve, partner-approve, reject, partner-firm CSV intake.)

**Runner (already in `lib/atelier-agents/runner.ts:3983 runTimeSteward`):**
- Reads five signal classes for the week window: calendar events (`atelier_calendar_events`), meetings with the person in `attendees` JSONB, deliverable versions authored by the linked `userId`, salon decisions on engagements the person owns/leads, and `atelier_agent_runs` triggered by the person (excluding self-runs of `ag_time_steward`).
- Materializes signals as **immutable** rows (idempotent on the natural key) and aggregates them into one draft entry per (`workDate` × `engagementHint`), rounded to 0.5h, capped at 10h/day, marking entries with no engagement as `internal` (non-billable).
- Wipes only prior `agent_drafted` entries on rerun (preserves human edits) and recomputes week totals across both sources. Writes its own `atelier_agent_runs` row via `startRun` / `completeRun` and emits audit events.

**Suspicious-pattern guards** (already enforced at submit, in `ledgerRoutes.ts`):
- (a) any single day > 14h, (b) double-booked (same engagement + same date), (c) fully billable week with zero meeting/calendar signals.

**UI (already in `artifacts/atelier/src/pages/ledger/Timesheet.tsx`):**
- Week view, "Run Time Steward" button, edit/submit/approve flows, suspicious-flag banner.

**Nightly tick (already in `lib/atelier-agents/ledgerNudges.ts`):**
- `runLedgerStewardTick` pre-populates draft weeks for active employees so the morning view is already populated.

**What's missing — the gap this spec closes:**
- No registry entry in `lib/agents/src/registry.ts` (kind: `Rule-based`).
- No prompt file (intentional — see "kind") and no documented decision.
- No golden fixture under `artifacts/api-server/tests/agents/ag_time_steward/`; the run shape is not validated by `pnpm test:agents`.
- Only partial UI surfacing: "Run Time Steward" button exists, but the agent is not in `Agents.tsx` / `AgentProfile.tsx` / `AgentRun.tsx`. There is no per-run history, no signal-to-entry traceability viewer, no Zod-driven I/O preview.
- No daily/weekly **cadence policy** documented — currently fires on (a) week open, (b) manual button, (c) nightly tick. Friday-recap and Monday-prefill cadences are missing.
- No structured worker-confirmation flow distinct from the existing "submit" — the spec below promotes confirmation to a first-class checkpoint with explicit signal acceptance.
- No event-driven signal capture for `commits` (referenced in the task brief) — the runner currently has zero awareness of code commits. Spec below adds the integration point.

---

### Agent: Time Steward

- **id:** `ag_time_steward`
- **kind:** Rule-based — deterministic. No LLM call. The runner already follows `startRun` / `completeRun` (the lifecycle helper composition); a Layer 3 task migrates it onto the shared `runAgent(...)` helper to inherit Zod validation + standard audit emission. A later v2 may add an LLM **narrative-writer** for the per-entry `narrative` field (so "Authored deliverable v3 · Salon directional: pricing v2" becomes "Drafted v3 of pricing recommendation; landed directional approval at the salon."). Out of scope here — the rule-based concatenation stays.
- **trigger:**
  - Manual: `POST /ledger/timesheets/:weekId/draft` (week owner or approver) — already wired.
  - On-open: `maybeAutoDraft` runs the steward when an employee first opens an empty `draft` or `rejected` week — already wired.
  - **Cadence (the gap):**
    - **Daily prefill** at 06:00 employee-local: extend the existing tick to draft *the current week* (not just past weeks) so each morning's calendar/meeting deltas land before standup.
    - **Friday recap** at 16:00 employee-local: rerun the steward and emit a single `atelier_notifications` row per worker — "Your week is ready to review. 32.5h drafted from 14 signals." Single nudge per week, not per day.
    - **Event:** debounce a per-person rerun on `meeting.attendance.update`, `calendar_event.create`, `deliverable_version.create`, `agent_run.complete`, `commit.recorded`. 10-minute coalescing window.
- **persona:**
  - Drafts for: any employee or contractor with a resolvable timesheet identity (partner-firm resources excluded by architecture).
  - Reviewed by: the **subject worker** (confirmation). Approvers (Engagement Lead → Partner) see the same draft only after the worker submits.

- **inputs (Zod sketch):**
  ```ts
  z.object({
    weekId:           z.string(),                 // tsw_{personId}_{weekIso}
    personId:         z.string(),
    weekStartDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),  // ISO Mon
    triggeredByUserId: z.string().nullable(),
    triggerReason:    z.enum(["manual","on_open","daily_prefill","friday_recap","event_debounce"]),
  })
  ```

- **outputs (Zod sketch):**
  ```ts
  z.object({
    weekId: z.string(),
    personId: z.string(),
    signalsConsidered: z.number().int().nonnegative(),
    signalsCreated:    z.number().int().nonnegative(),     // post-dedup against immutable history
    draftEntriesCreated: z.number().int().nonnegative(),
    totalHoursDrafted:  z.number().nonnegative(),
    billableHoursDrafted: z.number().nonnegative(),
    suspiciousFlags: z.array(z.string()),                  // pre-submit preview
    perDay: z.array(z.object({
      workDate: z.string(),
      hours:    z.number().nonnegative(),
      entries:  z.array(z.object({
        engagementId: z.string().nullable(),
        hours:        z.number(),
        billable:     z.boolean(),
        narrative:    z.string(),
        signalIds:    z.array(z.string()).min(1),          // traceability
      })),
    })),
  })
  ```

- **data sources (read):**
  - `atelier_calendar_events` (window: `weekStart .. weekStart + 7d`, scoped to `personId`).
  - `atelier_meetings` (`attendees` JSONB containing this person's email or name).
  - `atelier_deliverable_versions` (authored by the employee's `userId`).
  - `atelier_salon_decisions` on engagements where the user is `engagementLeadId` or `partnerOwnerId` (ownership filter prevents over-attribution).
  - `atelier_agent_runs` triggered by this user (excluding self-runs of `ag_time_steward`).
  - **New (event spec):** `atelier_commits` (table to be added by the Layer 3 implementation if and only if commit ingestion lands; until then the runner returns `signalsConsidered` for the other four classes only).
  - `atelier_employees` (email + userId resolution).
  - **Hard exclusion:** `atelier_partner_firm_resources` — the runner refuses to draft for them; their hours flow through `/ledger/partner-firm-hours/upload`.

- **side effects (write):**
  - `atelier_timesheet_signals` — append-only inserts (immutable; deduped by natural key).
  - `atelier_timesheet_entries` — `source="agent_drafted"`, `draftedByAgentId="ag_time_steward"`, `status="draft"`. Wipes prior agent-drafted rows for the week before reinserting; **never touches** human-source entries.
  - `atelier_timesheet_weeks` — recomputes `totalHours` / `billableHours` (across both sources). Does **not** advance `status` — only the worker's submit can.
  - `atelier_agent_runs` — one row per invocation, `confidence = green` if signals > 0 else `amber`, `cost = 0`.
  - `atelier_audit_events` — `agent.start` / `agent.complete` (or `agent.error`) via `runAgent`.
  - `atelier_notifications` — Friday-recap only (one row per worker per week, deduped on `(personId, weekIso, "friday_recap")`).
  - **No** writes to engagement, billing, or invoice tables. The steward never bills anyone — submit + approve do.

- **human checkpoints:**
  1. **Worker confirms the draft** — *blocking for submit.* The Timesheet UI shows each draft entry with its underlying `signalIds` (a small "5 signals" chip that expands to the immutable evidence list). The worker may Accept all, Edit hours/narrative/billable, Split an entry across engagements, or Add a manual entry the steward missed. Decider: subject worker. Until they click Submit, no approval ladder runs.
  2. **Engagement Lead approval** — *blocking for partner approval.* Standard approval ladder (already implemented).
  3. **Partner approval** — *terminal.* Standard (already implemented).

  The steward never auto-submits; that contract is preserved.

- **prompt outline:** N/A (rule-based). The registry-side `decisionLog` documents:
  1. Window selection (Mon 00:00 UTC → +7d).
  2. Five signal classes + their `weightHours` formulas.
  3. Aggregation (one entry per `workDate × engagementHint`; round 0.5; cap 10).
  4. Engagement attribution (ownership filter on salon, attendee match on meetings).
  5. Idempotency rules (signal natural key + agent-drafted wipe).

- **success criteria (production):**
  - ≥ 70% of weekly entries land via `source="agent_drafted"` (vs. typed by hand).
  - Median submit latency drops from "Friday afternoon scramble" to ≤ 15 min after Friday recap notification.
  - Suspicious-flag false-positive rate ≤ 10% of submissions (measured by submitter override).
  - Signal-to-entry traceability: 100% of agent-drafted entries carry ≥ 1 `signalId`.

- **eval ideas:**
  1. **Shape eval (golden fixture):** seeded calendar + meeting + deliverable rows for a fixture week → assert `signalsCreated`, `draftEntriesCreated`, and that every `entries[*].signalIds` non-empty.
  2. **Idempotency eval:** run twice; assert second run yields `signalsCreated == 0` (immutability) and `draftEntriesCreated == first.draftEntriesCreated` (re-aggregation stable).
  3. **Human-edit preservation eval:** seed a week with one `source="self"` entry; rerun steward; assert the human entry survives and totals include both sources.
  4. **Exclusion eval:** seed a `partner_firm_resource` person → steward refuses (no signals, no entries, no run row leaking into their inbox).
  5. **Suspicious-flag eval:** seed a 16h day → assert `suspiciousFlags` contains `day_overload:…`.

- **UI:** **Hybrid.** Generic registry-driven Agent Profile + Run history (signal-class table from `decisionLog`, model: `n/a (rule-based)`). The day-to-day editing surface stays bespoke — `uiComponent: "/atelier/ledger/timesheet"` with rationale: "Confirming a week is a workflow, not an agent-run review; it lives in Ledger where submit/approve also live."

  Within the Timesheet view, a Layer 3 task adds a per-entry **signal drawer**: clicking the "5 signals" chip opens the immutable evidence list (`Calendar: Pricing sync · Meeting: Aramco kickoff · Deliverable v3 …`) so the worker can see exactly *why* the steward proposed those hours.

---

## Cadence summary

| When                           | Trigger              | Scope                  | Notification?            |
| ------------------------------ | -------------------- | ---------------------- | ------------------------ |
| 06:00 local, Mon–Fri           | `daily_prefill` tick | Current week, all active workers | None                |
| Worker opens an empty week     | `on_open`            | That week              | None                     |
| Burst of relevant events       | `event_debounce`     | Current week of affected worker | None            |
| 16:00 local, Friday            | `friday_recap` tick  | Current week, all active workers | One per worker per week |
| Verifier presses button        | `manual`             | The selected week      | None                     |

This cadence is the contract a Layer 3 task wires into `lib/atelier-agents/ledgerNudges.ts`.
