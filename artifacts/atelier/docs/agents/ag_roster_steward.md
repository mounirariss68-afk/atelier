# Agent Design Spec — Roster Steward

> Layer 2 design spec for an already-shipped rule-based agent. Filed
> against the design-spec template in `artifacts/atelier/AGENT_STANDARD.md`.
> Includes the gating LLM-augmentation decision Partners need before any
> further compliance logic is layered on.

### Agent: Roster Steward

- **id:** `ag_roster_steward`
- **kind:** Rule-based (Sentinel-shaped — schedule-triggered, emits Pane
  A items, no domain mutation beyond `atelier_pane_a_items` +
  `atelier_audit_events`)
- **trigger:**
  - Cron: `ROSTER_STEWARD_CRON` env var (default `0 6 * * *` UTC),
    wired in `artifacts/api-server/src/lib/scheduler.ts`.
  - Manual: `POST /roster/steward/run` (Partner / Operations only).
- **persona:** Partner + Operations. Items materialise on every
  Partner / Operations user's Pane A.
- **inputs:**
  ```ts
  z.object({
    targetUserIds: z.array(z.string()).min(1),
    horizonDays: z.number().int().min(1).max(365).default(90),
  })
  ```
- **outputs:**
  ```ts
  z.object({
    scanned: z.number().int().nonnegative(),
    emitted: z.number().int().nonnegative(),
    runId: z.string(),
  })
  ```
- **data sources:** `atelier_compliance_records` (visa / Iqama / NDA /
  firm license) joined to `atelier_employees`,
  `atelier_contractors`, `atelier_partner_firm_resources`, and
  `atelier_partner_firms` for the human-readable label.
- **side effects:**
  - Inserts into `atelier_pane_a_items` with deterministic id
    `pane_steward_<recordId>_<bucket>_<userId>` (idempotent via
    `onConflictDoNothing`).
  - Emits `steward.scan` audit event per run with `{scanned, emitted,
    horizonDays}`.
- **human checkpoints:** none. Each Pane A item links to the compliance
  view; the human action (renew / archive) is taken there and audited
  by the compliance route, not by the Steward.

#### What's already built

- Implementation: `runRosterSteward(...)` in
  `artifacts/api-server/src/routes/atelier/rosterLifecycleRoutes.ts`
  (lines ~1725–1797).
- Bucket math: `expired` (past today), `30`, `60`, `90` days
  remaining. Records with >90 days remaining are skipped; records
  expired more than 365 days ago are skipped to avoid re-emitting
  ancient noise.
- Title format: `"<KIND> expired for <name>"` /
  `"<KIND> expires in <N>d (<name>)"`.
- Priority: `expired` and `30` → `high`; `60`/`90` → `medium`.
- Idempotency: deterministic Pane A id per `(record, bucket, user)`;
  `onConflictDoNothing` guarantees re-runs do not double-count
  `emitted`.
- Scheduler: `ROSTER_STEWARD_CRON` cron entry resolves
  Partner/Operations users and calls `runRosterSteward` daily.
- Manual route: `POST /roster/steward/run`.
- Audit: single `steward.scan` event with payload + summary.
- PII: relies on the redacted `referenceNumberRedacted` column;
  raw reference numbers never enter the summary.

#### LLM-augmentation decision

**Recommendation: STAY RULE-BASED.**

The Roster Steward's job is a deterministic date-window join with
stable bucket boundaries. The expensive failure mode is a **missed**
expiration, not a missing nuance — and a missed expiration would be
caused by a bug in the SQL filter or the bucket math, neither of which
an LLM helps with. Adding an LLM here would (a) introduce a budget on
a cron that today runs in milliseconds, (b) create a non-deterministic
re-emission risk that breaks the `onConflictDoNothing` guarantee, and
(c) duplicate context already shown on the linked compliance view.

**Failure modes the recommendation addresses:**

1. *Re-emission storms.* Deterministic ids + bucket boundaries keep
   re-runs free. An LLM rewriting titles or summaries would change
   the deterministic id source and could cause Pane A items to
   double up.
2. *Missed expirations.* The unit test surface is small and
   numeric; staying rule-based keeps it that way.
3. *PII leakage.* The current implementation reads only the
   redacted reference number. An LLM with the full record in
   context would risk an unredacted summary.
4. *Audit clarity.* `steward.scan` audit event has a fixed,
   diffable payload shape that downstream dashboards rely on.

#### Failure modes NOT addressed (deferred)

- *Cross-record correlation* (e.g. five resources from the same
  partner firm all expiring the same week → one rolled-up item).
  This is a candidate for a separate **Roster Triage Advisor**
  Drafter agent in a later layer; it would consume the Steward's
  emitted items as input rather than replacing the Steward.
- *Localisation of titles to Arabic.* Today the title is
  English-only. A small i18n table covers this without an LLM.

#### Proposed kind classification

`Rule-based`. (Sentinel shape — schedule-triggered, emits Pane A items,
no LLM call. Already classified this way implicitly; the registry
entry should make `kind: "rule_based"` explicit when Layer 3 lands.)

#### Success criteria

- Daily cron emits new items for every newly-bucketed compliance
  record.
- Re-running the manual route the same day emits zero new items
  (`emitted` returns 0; deterministic ids).
- Resolving a compliance record (renewing / archiving) removes it
  from the next scan's bucket.

#### Eval ideas

- `ev_dedupe`: same fixture run twice → second run emits 0.
- `ev_bucket_boundaries`: a record at exactly 30/60/90 days lands
  in the expected bucket.
- `ev_expired_priority`: expired records get `priority=high` and
  `sortKey=0`.
- `ev_no_pii`: emitted summary never contains the raw
  `referenceNumber`, only the `referenceNumberRedacted` mask.

#### UI

Generic registry-driven. The actual surface is **Pane A** on Partner
and Operations Home. No bespoke `uiComponent` needed.

#### Layer 3 backlog (carried over from this spec)

- Make `kind: "rule_based"` explicit in the registry entry; today the
  agent emits run-shaped audit events but isn't formally registered.
- Add a golden fixture under
  `artifacts/api-server/tests/agents/ag_roster_steward/golden.json`
  with a stub compliance set covering all four buckets.
