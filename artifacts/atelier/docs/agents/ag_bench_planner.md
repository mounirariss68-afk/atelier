# Agent Design Spec — Bench Planner

> Layer 2 design spec. Implementation lives in a follow-on Layer 3 task.
> See `artifacts/atelier/AGENT_STANDARD.md` for the contract this spec
> implements.

### Agent: Bench Planner

- **id:** `ag_bench_planner`
- **kind:** Drafter (proposes assignments; Partner / Operations approves
  before any allocation row is committed)
- **trigger:**
  - Manual: button on Operations dashboard ("Plan the bench"), and on
    each open engagement's staffing tab ("Find me people").
  - Event: `engagement.create` with `staffingNeeded=true`, and
    `engagement_access.revoked` when an active grant disappears
    mid-engagement (re-staff trigger).
  - Optional weekly cron Mondays 04:00 UTC for a firm-wide rebalance
    proposal — disabled by default in MVP.
- **persona:** Partner (Mounir) and Operations are the deciders;
  Engagement Lead can request a run scoped to a single engagement.
- **inputs:**
  ```ts
  z.object({
    scope: z.enum(["firm", "engagement"]),
    engagementId: z.string().optional(),    // required when scope=engagement
    horizonWeeks: z.number().int().min(1).max(12).default(6),
    constraints: z.object({
      maxAllocationPctPerPerson: z.number().int().min(50).max(150).default(100),
      respectConflicts: z.boolean().default(true),
      respectVisaJurisdictions: z.boolean().default(true),
      preferEmployeesOver: z.enum(["contractor","partner_firm_resource","none"]).default("contractor"),
    }),
    triggeredByUserId: z.string(),
  })
  ```
- **outputs:**
  ```ts
  z.object({
    horizonWeeks: z.number().int(),
    proposals: z.array(z.object({
      engagementId: z.string(),
      engagementLabel: z.string(),
      role: z.string(),                      // lead | member | reviewer | …
      candidates: z.array(z.object({
        personId: z.string(),
        workerType: z.enum(["employee","contractor","partner_firm_resource"]),
        fullName: z.string(),
        proposedAllocationPct: z.number().int(),
        proposedStartDate: z.string(),       // ISO date
        proposedEndDate: z.string().nullable(),
        skillFitScore: z.number(),           // 0..1, from Skill Mapper
        utilizationAfter: z.number(),        // projected % over horizon
        rationale: z.string(),               // 1–2 sentence prose
        risks: z.array(z.string()),          // e.g. "visa expires in 28d"
        rank: z.number().int(),              // 1 = primary
      })),
    })),
    benchSummary: z.array(z.object({
      personId: z.string(),
      fullName: z.string(),
      currentUtilizationPct: z.number(),
      projectedUtilizationPct: z.number(),
      flag: z.enum(["over","optimal","under","bench"]),
    })),
    refusal: z.string().nullable(),          // set when inputs are insufficient
    confidence: z.enum(["green","amber","red"]),
  })
  ```
- **data sources:**
  - Skill Mapper graph — `atelier_skills`, `atelier_person_skills`,
    `atelier_engagement_skill_demand` (scored fit per person/role).
  - Engagement demand — `atelier_engagements` (open and pending start),
    `atelier_engagement_roles`, `atelier_engagement_access` for who is
    already on what.
  - Capacity — `atelier_utilization_snapshots` for historical baseline,
    `atelier_employees.start_date / end_date / leave_balance`,
    `atelier_calendar_events` for booked PTO/holidays in horizon.
  - Compliance gate — `atelier_compliance_records` (visa/Iqama/NDA
    expirations) joined per candidate; expired or expiring-within-horizon
    records downgrade `skillFitScore` and add to `risks`.
  - Conflicts — `atelier_conflict_disclosures` (active) cross-checked
    against engagement → account.
  - Cost — Partner-only fields from `atelier_employees.base_compensation`
    /`atelier_contractors.day_rate_*` for tie-breaking. Stripped from
    output unless the requester is Partner / Operations (mirrors the
    PRD §2.1 lock enforced in `rosterRoutes.personToWire`).
- **side effects:**
  - **None on first run.** Output is a proposal stored in
    `atelier_bench_plans` (new domain table; one row per run with the
    full proposal JSON) and surfaced through Pane A.
  - On approve: creates `atelier_engagement_access` rows via the
    Access Sentinel (so every grant still passes the conflict / scope
    gates) and emits per-allocation `engagement_access.granted` audit
    events.
  - On reject: writes `bench_plan.rejected` audit event with the
    Partner's reason; no allocations are created.
- **human checkpoints:**
  1. `cp_partner` — Partner approves the proposal (blocking). Per-row
     edit/override of allocation% and start date allowed before commit.
  2. Optional `cp_lead` — Engagement Lead acknowledges per-engagement
     staffing before commit (non-blocking; informs the Partner).
- **prompt outline:**
  1. **System role** — "You are the Bench Planner. Propose staffing
     within the supplied capacity, skill, and compliance constraints.
     You may not exceed allocation caps, ignore conflicts, or assign
     people whose compliance is invalid for the engagement."
  2. **Inputs block** — engagement demand list, candidate pool with
     skill fit + projected utilization + compliance flags.
  3. **Constraints block** — explicit list (caps, jurisdictions,
     preferEmployeesOver).
  4. **Output schema** — strict JSON, must validate against
     `outputSchema`.
  5. **Refusal clauses** — refuse if no candidates pass compliance, or
     if Skill Mapper graph is empty for the engagement's required
     skills.
  6. **Citation rule** — every candidate's `rationale` must reference
     at least one concrete signal (skill match, prior engagement, low
     utilization). Unsupported claims are dropped.
- **success criteria:**
  - Every proposal has at least one candidate per engagement role OR a
    refusal explaining why.
  - No proposed allocation breaches the per-person cap or the
    `respectConflicts` / `respectVisaJurisdictions` flags.
  - Proposed `utilizationAfter` per person matches the deterministic
    helper's recompute when the proposal is committed (no drift).
  - Approve → `atelier_engagement_access` rows land via the Access
    Sentinel without further blocks (compliance pre-checked).
- **eval ideas:**
  - `ev_no_overallocation`: random fixture with cap=100 → no
    `proposedAllocationPct` sums above cap per person across proposals.
  - `ev_compliance_block`: a candidate with expired visa never appears
    as `rank=1`.
  - `ev_refusal_when_empty`: empty Skill Mapper graph → `refusal` set,
    `proposals=[]`.
  - `ev_determinism`: the deterministic prefilter (compliance, conflicts,
    capacity) returns identical candidate set on rerun; only the LLM
    rationale text may vary.
- **UI:**
  - Bespoke `uiComponent: "/atelier/bench/plan/:runId"`. Rationale: the
    proposal needs a side-by-side table of engagements × candidates
    with inline edit of allocation% and start date before approve, plus
    a bench-utilization heatmap. Generic JSON view is insufficient.
  - Runs list still appears in the registry-driven Agents view.

#### Decomposition note

Bench Planner is a Drafter that **wraps** a deterministic prefilter:

1. Deterministic step (no LLM): build candidate pool by joining demand,
   skill graph, capacity, compliance, conflicts — produces a ranked
   shortlist.
2. LLM step: for each engagement role, pick top 3 from shortlist and
   author rationale + risks prose. The LLM cannot add candidates the
   prefilter excluded.
3. Validation: output schema check + cross-check that every
   `personId` returned exists in the prefilter pool.

This split keeps the hard constraints in code (where they're testable)
and lets the LLM own only the explanation surface.
