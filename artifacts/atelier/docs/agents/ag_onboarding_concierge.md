# Agent Design Spec — Onboarding Concierge

> Layer 2 design spec for an already-shipped rule-based agent. Filed
> against the design-spec template in `artifacts/atelier/AGENT_STANDARD.md`.
> Includes the gating LLM-augmentation decision Partners need before any
> further onboarding logic is layered on.

### Agent: Onboarding Concierge

- **id:** `ag_onboarding_concierge`
- **kind:** Rule-based (sequence generator + state machine; emits an
  `atelier_agent_runs` row per sequence)
- **trigger:**
  - Event: invitation acceptance, or direct call to
    `startOnboardingSequence` from the roster lifecycle routes (e.g.
    operations creates a worker without an invitation).
  - No cron. The state machine advances on user action via
    `/roster/onboarding/:id/steps/:stepId/advance` (Partner /
    Operations / Engagement Lead).
- **persona:** Operations primarily owns the queue; Partner approves
  contract / firm-MSA gates; Engagement Lead owns "scope.briefed" and
  "manager.intro" steps.
- **inputs:**
  ```ts
  z.object({
    personId: z.string(),
    workerType: z.enum(["employee","contractor","partner_firm_resource"]),
    invitationId: z.string().nullable().optional(),
    targetStartDate: z.string().nullable().optional(),
    ownerUserId: z.string(),
  })
  ```
- **outputs:**
  ```ts
  z.object({
    onboardingId: z.string(),
    stepCount: z.number().int().nonnegative(),
  })
  ```
- **data sources:** the per-`workerType` `ONBOARDING_TEMPLATES` table
  in `rosterLifecycleRoutes.ts`. No DB read at sequence-creation time
  beyond inserts.
- **side effects:**
  - Inserts `atelier_onboardings` (one row).
  - Inserts `atelier_onboarding_steps` (11 / 7 / 5 rows depending on
    `workerType`) with deadlines = `start + daysFromStart`.
  - Writes `atelier_audit_events.onboarding.created`.
  - Writes a single `atelier_agent_runs` row with `agentId =
    ag_onboarding_concierge`, `status='complete'`, `progressPct=100`,
    and `toolCalls` recording the prescribed integration intents
    (`email.send`, `sso.provision`, `calendar.schedule`, `file.write`,
    `knowledge.search`).

#### What's already built

- `startOnboardingSequence(...)` in
  `artifacts/api-server/src/routes/atelier/rosterLifecycleRoutes.ts`
  (~lines 265–342).
- Three step templates (employee 11 / contractor 7 / partner-firm
  resource 5) with explicit `ownerRole` and `isComplianceGate` flags.
- Compliance-gate steps block downstream advancement when the
  step state machine is invoked.
- Agent-run emission so the lifecycle is visible in the standard
  agent_runs feed (Pane B), including `toolCalls` enumerating the
  queued integration intents.
- Step state machine owned by the lifecycle routes (advance /
  complete / skip with operator notes), all auditable.

#### LLM-augmentation decision

**Recommendation: SPLIT — keep the rule-based core, add a thin LLM
advisor for the "welcome pack" + jurisdiction nuance.**

The state machine, deadlines, ownership, and compliance gates are
deterministic and must stay so. They are the legal/audit backbone of
onboarding and would be unsafe to delegate to a model. But three
narrow surfaces are LLM-shaped:

1. **Welcome pack composition** (`file.write` →
   `roster/<personId>/welcome_pack.pdf`). Today this is a queued
   stub. The pack is bounded prose that should reflect the new
   hire's role, jurisdiction, manager, and start week — exactly the
   sort of "fill in a template with citations" Drafter work an LLM
   does well.
2. **Jurisdiction-specific step augmentation.** A KSA hire needs
   GOSI / WPS payroll registration; a UAE hire needs MOL /
   Tasheel; a remote contractor in Egypt needs none of the above.
   Today the template is one-size-fits-all and Operations manually
   adds the right step. An advisor that **proposes** extra steps
   (which Operations approves before they're appended) is the win.
3. **Slack / Salon / SSO copy.** The queued tool intents currently
   carry no message text. Localised, role-aware copy is LLM-shaped
   but should land via a Drafter step the human approves.

These three are best implemented as **separate Drafter agents that
chain off the Concierge's run** — `ag_welcome_pack_author`,
`ag_onboarding_jurisdiction_advisor`, `ag_onboarding_copywriter` —
rather than turning the Concierge itself into an LLM agent.
The Concierge's output becomes their input.

This keeps the failure mode isolated: an LLM outage degrades the
welcome pack to a template fallback, but never delays the legal
sequence.

**Failure modes the recommendation addresses:**

1. *Missed compliance gate.* Keeping the gates rule-based means
   "NDA signed" cannot be skipped or paraphrased away by a model.
2. *Wrong jurisdiction obligations.* Today a KSA-only template
   silently misses UAE-specific steps. The advisor surfaces this
   as a Pane A item with Partner approval, instead of relying on
   Operations to remember.
3. *Empty welcome pack.* The current `file.write` is a stub; the
   advisor either drafts a real pack or refuses with a reason
   (no degraded content lands).
4. *Locale drift.* The standard step titles are English-only;
   advisor-produced copy can localise to AR/EN per persona without
   changing the deterministic step codes.

#### Failure modes NOT addressed (deferred)

- *Provisioning automation*. The `sso.provision`, `email.send`,
  `slack.invite`, `calendar.schedule` tool intents are still queued
  stubs. Hooking them to real systems is integrations work, not an
  LLM problem.
- *Manager assignment*. Today there is no field for the new hire's
  manager; "manager.intro" lacks an owner beyond the role name.
  Schema gap, not a model gap.

#### Proposed kind classification

`Rule-based` for the Concierge itself. The three proposed children
(`ag_welcome_pack_author`, `ag_onboarding_jurisdiction_advisor`,
`ag_onboarding_copywriter`) would be `Drafter`s with explicit
human checkpoints.

#### Success criteria

- Sequence creation always inserts the right number of steps for
  the worker type, with deadlines anchored to `targetStartDate`.
- Compliance-gate steps cannot be marked complete out of order.
- Re-creating onboarding for the same `personId` is idempotent at
  the route level (the route checks for an in-flight onboarding
  before calling `startOnboardingSequence`).
- The `atelier_agent_runs` row is queryable from the Atelier UI
  Agents page filtered by `ag_onboarding_concierge`.

#### Eval ideas

- `ev_template_shape`: each `workerType` returns its expected
  `stepCount` (11 / 7 / 5) and the same `code` set in the same
  `sortKey` order.
- `ev_compliance_gate_marked`: `isComplianceGate=true` on
  `nda.signed`, `contract.signed`, `payroll.registered` for
  employees.
- `ev_deadline_anchored`: `deadline` of step N equals
  `start + daysFromStart` to the day.
- `ev_audit_emitted`: `onboarding.created` audit event present
  with `actorId=ag_onboarding_concierge`.

#### UI

Generic registry-driven for the run feed. The actual surface is the
Roster Onboarding tab, which already exists and renders the step
state machine. No bespoke `uiComponent` is needed for the Concierge
itself.

#### Layer 3 backlog (carried over from this spec)

- Add an explicit registry entry with `kind: "rule_based"` so the
  agent is discoverable via the Agents page (today it only shows up
  via its agent-run rows).
- Add a golden fixture with all three `workerType` cases.
- Open follow-on tasks for the three proposed Drafter children, with
  Layer 2 specs that take this Concierge's output as input.
