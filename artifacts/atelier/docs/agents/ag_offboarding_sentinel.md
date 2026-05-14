# Agent Design Spec — Offboarding Sentinel

> Layer 2 design spec for an already-shipped rule-based agent. Filed
> against the design-spec template in `artifacts/atelier/AGENT_STANDARD.md`.
> Includes the gating LLM-augmentation decision Partners need before any
> further offboarding logic is layered on.

### Agent: Offboarding Sentinel

- **id:** `ag_offboarding_sentinel`
- **kind:** Rule-based (sequence generator + state machine + Pane A
  producer; emits an `atelier_agent_runs` row per sequence)
- **trigger:**
  - Event: `POST /roster/offboarding` (intent recorded by Operations
    or Partner) calls `startOffboardingSequence(...)`.
  - State machine: `/roster/offboarding/:id/steps/:stepId/advance`
    and `/roster/offboarding/:id/finalize` push the sequence forward.
  - No cron; revocation is event-driven so it cannot drift behind a
    departure.
- **persona:** Operations owns most steps; Partner owns
  `client.notify` and `audit.pack.signed`; Engagement Lead owns
  `reassignments.identified` and `knowledge.transfer`. The initiating
  user receives the gate-pending Pane A item.
- **inputs:**
  ```ts
  z.object({
    personId: z.string(),
    workerType: z.enum(["employee","contractor","partner_firm_resource"]),
    initiatedByUserId: z.string(),
    lastWorkingDate: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
  })
  ```
- **outputs:**
  ```ts
  z.object({
    offboardingId: z.string(),
    stepCount: z.number().int().nonnegative(),
    gateSteps: z.array(z.string()),
  })
  ```
- **data sources:** the per-`workerType` `OFFBOARDING_TEMPLATES`
  table in `rosterLifecycleRoutes.ts`. `findPerson` for the human-
  readable label on the Pane A item. `resolveLinkedUserIdForPerson`
  on finalize to look up `atelier_engagement_access` grants by
  `user_id` (works for employees AND contractors / partner-firm
  resources, the latter resolved by email).
- **side effects:**
  - Inserts `atelier_offboardings` (one row).
  - Inserts `atelier_offboarding_steps` (11 / 11 / 6 rows depending
    on `workerType`) with deadlines = `start + daysFromStart`,
    forward-scheduled toward `lastWorkingDate`.
  - Emits `offboarding.created` audit event.
  - **Pane A:** writes a deterministic high-priority "Reassignment
    pending" item on the initiator's Home (id
    `panea_offboarding_<offId>_<userId>`, idempotent via
    `onConflictDoNothing`) so the gate step never sits silent.
  - Writes a single `atelier_agent_runs` row recording prescribed
    tool intents (`sso.revoke`, `email.disable`, `slack.disable`,
    `salon.rename_team_member`, `audit.export`).
  - On finalize: enforces the audit-pack export and revocation of
    every linked `atelier_engagement_access` grant before sign-off
    is allowed.

#### What's already built

- `startOffboardingSequence(...)` in
  `artifacts/api-server/src/routes/atelier/rosterLifecycleRoutes.ts`
  (~lines 344–449).
- Three step templates with explicit `ownerRole` and
  `isReassignmentGate` flags. Audit-pack signing is always the
  final step, dated to `lastWorkingDate`.
- Pane A item producer (Task #261) with deterministic id and
  idempotent insert.
- Agent-run emission with tool-call surface for downstream
  integrations.
- Finalize path uses `resolveLinkedUserIdForPerson` to defeat the
  null-email false-negative (employees with changed emails would
  otherwise falsely report "no pending grants" — covered by the
  function's own comment in the source).

#### LLM-augmentation decision

**Recommendation: SPLIT — keep the rule-based core, add an LLM
advisor for client-notify drafting and the audit-pack narrative
section.**

The same logic as the Onboarding Concierge applies, mirrored: the
state machine, deadlines, ownership, gate enforcement, and access
revocation are the legal/audit backbone. They must stay rule-based
and event-driven so a departing worker's access is revoked on a
deterministic timer, not at the mercy of model availability.

Two narrow surfaces are LLM-shaped and worth carving out:

1. **Client-notify message drafts** (`client.notify` step). Today
   the step is a checkbox; the actual email goes out manually. A
   Drafter (`ag_client_offboarding_notice`) that proposes a per-
   account notification — tone-matched to the engagement, naming
   the replacement lead from the reassignment gate — would land in
   Partner's review queue.
2. **Audit-pack prose section** (`audit.pack.signed` step). The
   pack today carries the structured timeline + signed
   acknowledgements. A short narrative section (what was rolled
   off, what was reassigned, what knowledge transfer happened) is
   LLM-shaped. Failure mode is acceptable: if the LLM is down, the
   pack ships without the prose section, never delaying sign-off.

Both belong as **separate Drafter agents that consume the
Sentinel's output**, not as edits to the Sentinel itself. The
Sentinel's deterministic guarantees are the audit story.

**Failure modes the recommendation addresses:**

1. *Late access revocation.* Sentinel + finalize gate + Access
   Sentinel revoke path all stay deterministic. An LLM in this
   loop is a way to miss a cutoff date.
2. *Missed reassignment gate.* The Pane A producer is rule-based;
   an LLM rewrite of the title would risk changing the
   deterministic id and breaking idempotency.
3. *Audit pack content drift.* Keeping the structured timeline as
   the source of truth means Partners can sign off on a known
   shape. Optional prose is decorative and refusable.
4. *Cross-system orphans.* The tool-call list (sso.revoke,
   email.disable, slack.disable, salon.rename) is enumerated in
   code so a static check can verify each step has a handler. An
   LLM owning the list would lose that.

#### Failure modes NOT addressed (deferred)

- *Real provisioning revocation.* `sso.revoke` / `email.disable` /
  `slack.disable` are still queued tool intents. Hooking real
  systems is integrations work.
- *EOSB calculation.* `final.payment` step today does not call the
  payroll system. Numeric work belongs in a deterministic helper
  like `lib/atelier-pricing`, not an LLM.
- *Knowledge transfer capture.* Today the step is acknowledged
  manually; structured capture (recordings, doc links) would need
  schema, then could be summarised by `ag_knowledge_concierge` if
  desired.

#### Proposed kind classification

`Rule-based` for the Sentinel itself. The two proposed children
(`ag_client_offboarding_notice`, `ag_offboarding_pack_narrator`)
would be `Drafter`s with Partner-as-decider checkpoints.

#### Success criteria

- Sequence creation always inserts the right number of steps for
  the worker type, with deadlines anchored to `lastWorkingDate`.
- The reassignment gate Pane A item appears on the initiator's
  Home immediately and never duplicates on re-creation.
- Finalize is impossible while any `atelier_engagement_access`
  grant for the linked user remains active — proven by
  `resolveLinkedUserIdForPerson` covering all three worker types.
- Re-creating offboarding for the same `personId` is rejected at
  the route level (no orphaned in-flight sequences).

#### Eval ideas

- `ev_template_shape`: each `workerType` returns its expected
  `stepCount` (11 / 11 / 6) and the same `code` set in the same
  `sortKey` order.
- `ev_panea_idempotent`: re-emitting the same offboarding does
  not produce a second Pane A item (deterministic id holds).
- `ev_finalize_blocks_on_active_grant`: with at least one active
  grant for the linked user, finalize returns blocked.
- `ev_finalize_resolves_email_user`: a contractor whose
  atelier_users row is keyed by email is correctly resolved by
  `resolveLinkedUserIdForPerson` (regression guard for the
  documented null-email risk).

#### UI

Generic registry-driven for the run feed. The user-facing surface
is the Roster Offboarding tab (state machine UI) and the initiator's
Pane A. No bespoke `uiComponent` is needed for the Sentinel itself.

#### Layer 3 backlog (carried over from this spec)

- Add an explicit registry entry with `kind: "rule_based"` so the
  agent is discoverable on the Agents page.
- Add a golden fixture with all three `workerType` cases plus a
  "finalize blocked by active grant" fixture.
- Open follow-on tasks for `ag_client_offboarding_notice` and
  `ag_offboarding_pack_narrator` Drafter children.
