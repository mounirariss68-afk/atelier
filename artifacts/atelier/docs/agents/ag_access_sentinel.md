# Agent Design Spec — Access Sentinel

> Layer 2 design spec for an already-shipped rule-based agent. Filed
> against the design-spec template in `artifacts/atelier/AGENT_STANDARD.md`.
> Includes the gating LLM-augmentation decision Partners need before any
> further access-policy logic is layered on.

### Agent: Access Sentinel

- **id:** `ag_access_sentinel`
- **kind:** Rule-based (synchronous gate; runs inline on every grant /
  revoke attempt — not on a schedule)
- **trigger:** Synchronous — invoked from the engagement-access write
  paths in `rosterRoutes.ts` and `rosterLifecycleRoutes.ts` (grant,
  revoke, conflict-override). Never user-runnable directly; the gate
  is the only path to a grant.
- **persona:** Partner / Operations / Engagement Lead are the only
  callers permitted to invoke a write through the gate; the Sentinel
  itself is system-owned.
- **inputs:**
  ```ts
  z.object({
    actor: z.object({ id: z.string(), role: z.string() }),
    targetPerson: z.object({
      id: z.string(),
      workerType: z.enum(["employee","contractor","partner_firm_resource"]),
      fullName: z.string(),
    }),
    engagementId: z.string(),
    roleOnEngagement: z.enum(["lead","member","reviewer","partner_resource","contractor"]),
    allocationPct: z.number().int().min(0).max(150),
    scope: z.array(z.string()),       // e.g. can_view_pricing, can_view_margin, …
    endDate: z.string().nullable(),
    action: z.enum(["grant","revoke"]),
    skipConflictGate: z.boolean().optional(),  // Partner override path only
  })
  ```
- **outputs:**
  ```ts
  z.object({
    ok: z.boolean(),
    blocked: z.object({
      reason: z.string(),
      offendingScope: z.array(z.string()).optional(),
      conflictIds: z.array(z.string()).optional(),
      accountId: z.string().optional(),
      accountName: z.string().optional(),
    }).optional(),
    grantId: z.string().optional(),
  })
  ```
- **data sources:** `atelier_engagements` (must exist + not soft-
  deleted + not closed for grants), `atelier_accounts` (for
  conflict-vs-account matching), `atelier_conflict_disclosures`
  (active), `atelier_engagement_access` (for revoke target lookup).
- **side effects:**
  - On allow: writes `atelier_engagement_access` row.
  - On block: writes `access.grant.blocked` or
    `access.grant.blocked.conflict` audit event with the offending
    scope or matched conflict id list.
  - On Partner override: writes `access.grant.override` event AND
    re-runs the gate with `skipConflictGate=true`, leaving both the
    original block and the override in the audit trail.

#### What's already built

Implementation in `runAccessSentinel(...)` in
`artifacts/api-server/src/routes/atelier/rosterRoutes.ts` (lines
~384–600). Five hard policies, in this order:

1. **Writer-role gate** — only `partner | operations | engagement_lead`
   can call a grant.
2. **Scope/persona gate** — `FORBIDDEN_SCOPE_FOR_NONEMPLOYEE` (pricing,
   margin, partner economics, compensation, audit-PDF export) blocked
   for contractors and partner-firm resources; emits
   `access.grant.blocked`.
3. **Engagement-existence gate** — engagement must exist and not be
   soft-deleted.
4. **Closed-engagement gate** — grants to `plmStage='closed'`
   engagements are auto-denied.
5. **Conflict-of-interest gate** — active disclosures whose
   `declared_party` matches the engagement's account (id, name, or
   substring) block the grant; emits `access.grant.blocked.conflict`.
   The `POST /roster/access/conflict-override` Partner-only path
   re-invokes the Sentinel with `skipConflictGate=true` and writes
   `access.grant.override`.

The gate is the **only** writer path used by both the v3 grant route
and the lifecycle override route, so its policies cannot be bypassed
by a sibling endpoint.

#### LLM-augmentation decision

**Recommendation: STAY RULE-BASED. Add an out-of-band LLM advisor
later (separate agent), not in this gate.**

This is a synchronous security gate on the only path to writing
`atelier_engagement_access`. Two non-negotiables:

1. The decision is binary, deterministic, auditable in code review.
2. The latency budget is single-digit milliseconds — every grant /
   revoke / lifecycle step depends on it.

An LLM in this hot path would:

- Introduce non-determinism that audit reviewers can't reproduce.
- Add a budget / outage failure mode that would either block writes
  during model degradation or, worse, fail-open. Neither is
  acceptable for a conflict-of-interest gate.
- Not improve the precision of the conflict match in any way that
  rules can't (the match is a string comparison against a curated
  declared-party field).

If smarter conflict matching is needed (e.g. account aliases,
parent/subsidiary detection), the right answer is to enrich
`atelier_accounts` with structured aliases and let the deterministic
gate read them — not to outsource the decision to a model.

**A separate `ag_conflict_advisor` Drafter is in scope for a future
layer.** It would run **after** the Sentinel emits a block, with
Partner-as-decider, and propose either "override is reasonable
because…" or "uphold the block". It cannot mutate
`atelier_engagement_access`; the Partner clicks the existing
`/roster/access/conflict-override` route.

**Failure modes the recommendation addresses:**

1. *Silent grant of a conflicted engagement.* The deterministic gate
   fires + audits before the row is written. An LLM in-line would
   risk a malformed JSON response that defaults to allow.
2. *Bypass via sibling endpoint.* The single chokepoint pattern is
   only worth its complexity if it stays cheap and fast — a model
   call in the path makes new "bypass for performance" routes a
   recurring temptation.
3. *Audit reproducibility.* Every block / override is replayable by
   re-running the same inputs against the same code; an LLM call
   breaks that.
4. *Latency on lifecycle steps.* Onboarding / Offboarding routes
   call the Sentinel synchronously; sub-10ms is required.

#### Failure modes NOT addressed (deferred)

- *Subtle account-alias mismatches* (e.g. "STC Group" vs "Saudi
  Telecom Company"). Recommendation: structured aliases column
  rather than fuzzy LLM match.
- *Override coaching* — explaining to the Partner whether an
  override is wise. Out-of-band `ag_conflict_advisor` covers this.

#### Proposed kind classification

`Rule-based`. The Sentinel is **synchronous, in-line, gating** —
distinct from the cron-driven `Roster Steward`. The registry entry
should make `kind: "rule_based"` and `trigger: "synchronous"`
explicit when Layer 3 lands; today the agent emits audit rows under
`actorId="ag_access_sentinel"` but is not formally registered.

#### Success criteria

- Every write to `atelier_engagement_access` flows through
  `runAccessSentinel` (codified as a unit test that searches the
  routes folder for raw `db.insert(atelierEngagementAccess)` calls
  and fails on any not inside `runAccessSentinel`).
- Every block writes a precisely-typed audit event before returning.
- Every Partner override writes both a block-reason event and an
  override event.

#### Eval ideas

- `ev_scope_block_nonemployee`: contractor + `can_view_pricing` →
  blocked, `offendingScope=["can_view_pricing"]`.
- `ev_conflict_block`: person with active disclosure on the
  engagement's account → blocked, `conflictIds.length>=1`.
- `ev_override_audits_both`: override path produces both
  `access.grant.blocked.conflict` and `access.grant.override`.
- `ev_closed_engagement_block`: `plmStage='closed'` engagement →
  blocked with `engagement-closed-grants-frozen`.

#### UI

Generic registry-driven (Agents list + profile). Block reasons
already surface in the engagement-access UI via the audit event
stream; no bespoke `uiComponent` needed for the Sentinel itself.
The hypothetical `ag_conflict_advisor` would have its own entry.
