### Agent: Pricing Analyst

- **id:** `ag_pricing_analyst`
- **kind:** Analyst
- **trigger:** Manual button on a Proposal draft (`POST /atelier/proposals/:id/pricing-analyst`). Also invokable from the Pricing Strategist run view as a "model this scenario" affordance. Not scheduled.
- **persona:** Engagement Lead authoring a proposal, before the Partner is asked to bless the price. Output is consumed by the Partner via Pricing Strategist.

#### Relationship to existing agents (read first)

This agent is **not** the Pricing Strategist. The split is intentional and locked:

| | Pricing Analyst (this spec) | Pricing Strategist (already shipped) |
|---|---|---|
| Kind | Analyst | Drafter |
| Owner persona | Engagement Lead | Partner |
| Job | Compute the *numbers* for a given team mix / duration / rate scenario, and stress-test margin sensitivity across alternates. | Take the chosen pricing as ground truth and write the *narrative* — story, talking points, risks. |
| Math | **Owns the math.** Calls the deterministic helpers in `lib/atelier-pricing` and emits a wedge chart + verdict. | **Never invents numbers.** Treats `primary_pricing` and `alternatives` as inputs. |
| Output | Structured pricing scenarios + sensitivity table + verdict per scenario. | Prose: model narrative, talking points, risks, confidence. |
| Side effects | Writes a `atelier_deal_pricing_scenarios` snapshot row; does **not** mutate the proposal. | On commit, writes the chosen scenario into the proposal. |

The handoff is one-directional: Pricing Analyst produces N scored scenarios → the Engagement Lead picks one → Pricing Strategist wraps it in narrative for the Partner.

#### Inputs

Plain English: a proposed team mix (roles + allocations + days), the firm's current rate card, the engagement duration, the target margin (default 55%), and optionally one or more *alternate* scenarios the Lead wants compared (e.g. "swap a Lead for two AI Engineers", "compress duration by 20%").

```ts
inputSchema = z.object({
  proposalId: z.string(),
  primary: z.object({
    teamMix: z.array(z.object({
      role: z.enum(["partner","lead","sme","ai_engineer","business_developer"]),
      allocationPct: z.number().min(0).max(100),
      days: z.number().positive(),
    })).min(1),
    durationWeeks: z.number().positive(),
  }),
  alternatives: z.array(z.object({
    label: z.string(),
    teamMix: z.array(/* same shape as primary.teamMix */).min(1),
    durationWeeks: z.number().positive(),
  })).max(4).optional(),
  targetMarginPct: z.number().min(0).max(100).default(55),
  rateCardVersion: z.string().optional(), // pinned for reproducibility
});
```

Sources: rate card from `lib/atelier-pricing` (versioned); current proposal row from `atelier_proposals`; prior pricing scenarios for similar deals via `knowledge.search` for context only (not used in math).

#### Outputs

Plain English: for the primary scenario and each alternative, return revenue, cost, margin %, a verdict against target, and a wedge breakdown by role. Plus a one-shot sensitivity sweep showing margin vs. ±10% / ±20% on duration and on day rate.

```ts
outputSchema = z.object({
  scenarios: z.array(z.object({
    id: z.string(),                       // "primary" | "alt-1" | …
    label: z.string(),
    totalRevenueUsd: z.number(),
    totalCostUsd: z.number(),
    marginPct: z.number(),
    verdict: z.enum(["green","amber","red","partner_override_required"]),
    wedge: z.array(z.object({
      role: z.string(),
      days: z.number(),
      costUsd: z.number(),
      revenueUsd: z.number(),
    })),
  })).min(1),
  sensitivity: z.array(z.object({
    axis: z.enum(["duration","day_rate"]),
    grid: z.array(z.object({
      delta: z.number(),                  // -0.2, -0.1, 0, 0.1, 0.2
      marginPctByScenarioId: z.record(z.number()),
    })),
  })).length(2),
  recommendation: z.object({
    pickScenarioId: z.string(),
    rationale: z.string(),                // one paragraph, factual
  }),
  rateCardVersion: z.string(),
  confidence: z.enum(["green","amber","red"]),
});
```

Consumers: Pricing Strategist reads `scenarios[*]` and `recommendation.pickScenarioId` to seed its narrative inputs. The Atelier proposal UI renders the wedge + sensitivity grid. The Partner sees the verdict per scenario in the run view before approving.

#### Data sources / tools / side effects

- **DB reads:** `atelier_proposals`, `atelier_deal_pricings` (last committed price for this opportunity, if any), `atelier_engagements` (for resourcing constraints).
- **Helpers (deterministic, not LLM tools):** `lib/atelier-pricing` — `computeScenario(...)`, `sweepSensitivity(...)`. **All math goes through these.** The LLM never multiplies numbers.
- **Tools (LLM-facing):** `knowledge.search` only, and only for the `recommendation.rationale` paragraph (cite comparable deals). No web search, no transcribe, no file write.
- **Writes:** one row in `atelier_deal_pricing_scenarios` (new domain table — to be added during implementation) with the full output payload, keyed by `proposalId` + `runId`. **Does not mutate `atelier_proposals` or `atelier_deal_pricings`.** Commit happens later via Pricing Strategist.
- **Audit:** `agent.start`, `agent.complete`, plus `proposal.pricing_scenarios.snapshot` on persistence.
- **Notifications:** none from this runner. Pricing Strategist owns the "ready for Partner" notification.

#### Human checkpoints

| Order | Decider role | Blocking? | What is being decided |
|---|---|---|---|
| 1 | Engagement Lead | Yes | Pick which scenario to forward to Pricing Strategist. Required before the proposal can advance. |

The Partner does **not** approve here — this is decision-support, not a sign-off gate. Partner approval lives on Pricing Strategist.

#### Prompt outline

The prompt is small because the math is deterministic. Sections of `prompts/pricing_analyst/v2.md` (the existing v1 covers a single scenario; v2 generalises to N scenarios + sensitivity for this design):

1. **Role + hard rule** — "Math first, narrative second. The server has already computed `scenarios` and `sensitivity` deterministically. Do not re-derive numbers."
2. **What you receive** — pre-computed `scenarios[]` and `sensitivity[]` payload.
3. **What you must produce** — only the `recommendation` block (`pickScenarioId` + one-paragraph rationale) and the per-scenario `verdict` mapping (which is itself derived from margin vs. target, so this is mostly assertion).
4. **Verdict rule** — `green` if margin ≥ target; `amber` if within 5pp below; `red` if 5–10pp below; `partner_override_required` if >10pp below or any individual role is loss-making.
5. **Citation rule** — if `rationale` cites a prior engagement, it MUST come from `knowledge.search` results; otherwise speak in general terms.
6. **Output contract** — JSON matching `outputSchema` exactly.

#### Success criteria

- Engagement Leads stop hand-rolling spreadsheets for "what if we swap a Lead for two AI Engineers" — every proposal in flight has at least one Pricing Analyst run attached.
- Median time from "team mix idea" to "scenario verdict in the proposal UI" is under 30 seconds.
- Pricing Strategist is never invoked on a proposal whose chosen scenario has verdict `partner_override_required` without an explicit Partner override note.
- Zero discrepancies between the agent's `totalRevenueUsd` / `totalCostUsd` / `marginPct` and a recompute via `lib/atelier-pricing` on the same inputs (because they share the helper).

#### Eval ideas

- **Shape:** golden fixture with a 4-week, 3-role primary and two alternates → assert `scenarios.length === 3`, `sensitivity.length === 2`, every scenario has a `verdict`.
- **Numeric:** for the golden input, assert `marginPct` matches `lib/atelier-pricing.computeScenario(input).marginPct` to 4 decimal places. This is the "math integrity" check — it is the most important eval for this agent.
- **Verdict mapping:** synthetic input crafted to produce margin = target − 7pp → assert `verdict === "red"`.
- **Override gate:** synthetic input with margin = target − 15pp → assert `verdict === "partner_override_required"` and `recommendation.rationale` mentions the override.

#### UI

Bespoke. `uiComponent: "/atelier/proposals/:proposalId/pricing-analyst/:runId"` with rationale: the wedge chart + sensitivity grid + scenario picker is materially richer than the generic JSON-schema run view, and the picker action (forward to Pricing Strategist) is a side-effecting button that doesn't fit the generic shell.
