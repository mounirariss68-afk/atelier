# Agent Design Spec — Case Study Picker

> Layer 2 spec. Follows the template in `artifacts/atelier/AGENT_STANDARD.md` §10.
> This agent is **partial** — see "What's already built" before scoping
> the implementation task.

### Agent: Case Study Picker
- **id:** `ag_case_study_picker`
- **kind:** Drafter
- **trigger:**
  - manual button on an opportunity ("Pick case studies")
  - event-driven from the Proposal Composer pipeline: when the
    `case_studies` section of a proposal is requested (see existing
    sectionLib in `runner.ts`), Composer enqueues a Case Study Picker
    run and uses the result instead of the current inline mock
- **persona:** Engagement Lead (decider). Pursuit team uses the output;
  Partner sees the rationale on the proposal review.

### Inputs
Plain English: an opportunity with sector / region / problem-class /
scale hints, plus the candidate pool of credentials drawn from the
Atelier corpus.

```ts
// Already declared in registry.ts (CaseStudyPicker.inputSchema).
z.object({
  opportunityId: z.string(),
  opportunityContext: z.string(),       // freeform: sector × region × problem × scale
  candidatePool: z.array(z.object({
    id: z.string(),
    client: z.string().optional(),
    sector: z.string().optional(),
    outcome: z.string().optional(),
    metric: z.string().optional(),
  })),
  n: z.number().int().min(1).max(10).optional(),  // default 3
})
```

### Outputs
Plain English: the top-N selected ids, an overall rationale, and a
detailed top-3 record (client, sector, outcome, metric) ready for
inclusion in a proposal.

```ts
// Already declared in registry.ts (CaseStudyPicker.outputSchema).
z.object({
  selectedIds: z.array(z.string()),
  rationale: z.string(),
  top3: z.array(z.object({
    id: z.string(),
    client: z.string(),
    sector: z.string(),
    outcome: z.string(),
    metric: z.string(),
  })),
})
```

Layer 3 should also add `matchScores: { id, score, dimensionsHit[] }`
to the output so we can show why each pick won. This is an additive
schema bump (registry + prompt v2 + golden fixtures).

### Data sources
- `atelier_case_studies` (the canonical credentials table) — primary.
- `atelier_engagements` (joined for outcome / metric verification —
  guardrail against fabricated metrics).
- `atelier_agent_runs` of `ag_atelier_curator` for case studies that
  are recently promoted but not yet anchored in `atelier_case_studies`.
- `atelier_win_themes` to enrich the rationale with positioning lines.

The candidate pool itself is supplied by the caller (typically the
Proposal Composer route handler), pre-filtered to a manageable size.

### Side effects
- Writes one row to `atelier_agent_runs`.
- Emits `agent.start` / `agent.complete` audit events.
- Emits `case_study.picked { opportunityId, selectedIds }` for Atelier
  reuse analytics.
- On commit (Engagement Lead approves the picks via the Composer UI),
  appends the picks to `atelier_proposals.sectionPayload.case_studies`.
- No direct write to `atelier_case_studies`.

### Human checkpoints
1. **Engagement Lead** (blocking). Approves picks before they land in
   the proposal. Already declared in the registry as `leadCheck("Engagement
   Lead approves chosen case studies")`.

### Prompt outline
The existing v1 prompt (see `prompts/case_study_picker/v1.md`) is the
starting point. Layer 3 should bump to v2 to add:
1. **Scoring rubric.** Score each candidate on four explicit
   dimensions — sector, region, problem_class, scale — each 0..1; the
   final match score is the weighted sum (sector 0.35, problem_class
   0.30, region 0.20, scale 0.15).
2. **Pool integrity.** Repeat the existing v1 rule: emit only ids
   present in `candidatePool`. Never invent.
3. **Rationale contract.** The top-level `rationale` must name at least
   one explicit dimension per pick (e.g. "ACME Retail wins on
   problem_class match (refund triage)").
4. **Output JSON shape** matching the (extended) outputSchema.

### Success criteria
- 100 % of `selectedIds` exist in the input `candidatePool` (already
  the v1 eval).
- For a fixture set of 10 opportunities with hand-labelled "best
  picks", top-1 agreement ≥ 70 %, top-3 includes the labelled best
  pick ≥ 90 %.
- Engagement Lead approval rate ≥ 80 % over a rolling 4-week window
  in production.

### Eval ideas
- Pool eval: every `selectedIds[i]` appears in the input
  `candidatePool` (already declared as `ev_in_pool`).
- Rubric eval: for each `top3[i]`, the `rationale` mentions the matched
  sector or problem_class string. Implement as a substring-presence
  check over the input fields.
- Determinism eval: same input + temperature 0 produces the same
  `selectedIds` ordering across two runs.

### UI
Generic registry-driven `AgentRun.tsx` view is sufficient for standalone
runs. Inside the Proposal Composer flow, the picks are rendered inline
in the Composer's bespoke surface — that integration is owned by the
Composer task, not by this agent.

### Overlap with existing agents
- **Knowledge Concierge** answers _arbitrary_ knowledge questions over
  the same `atelier_case_studies` table; Case Study Picker is narrowed
  to ranked-selection-against-a-pool with a structured output. The
  Concierge surface should suggest "use Case Study Picker" when the
  question is shaped like "which credentials should I use for X?".
- **Atelier Curator** writes new credentials into
  `atelier_case_studies`; Case Study Picker only reads. The two never
  share a write surface.

### What's already built
- **Registry entry**: present in `lib/agents/src/registry.ts` as
  `CaseStudyPicker`, `status: "registered"`, model `claude-haiku-4-5`,
  `systemPromptRef: "prompts/case_study_picker/v1.md"`. Input + output
  schemas already declared inline. Guardrails and the Engagement Lead
  human checkpoint already declared. **Reuse as-is** other than the
  additive `matchScores` bump described above.
- **Prompt v1**: present at
  `artifacts/api-server/prompts/case_study_picker/v1.md` with frontmatter
  declaring purpose / inputs / guardrails. **Reuse**; bump to v2 to add
  the explicit scoring rubric and the extended output shape.
- **Inline mock runner**: `runner.ts` (around line 2062) embeds an inline
  case-study picker inside the proposal `sectionLib` rather than calling
  a `runCaseStudyPicker` hook. **Replace** that inline block with a real
  `runCaseStudyPicker(...)` exported from `runner.ts` that composes
  `runAgent(...)`, plus update the Composer pipeline to enqueue a run
  and use its `runId` instead of the inline string.
- **Route handler**: not yet present in
  `artifacts/api-server/src/routes/atelier/agentRoutes.ts`. Add the
  manual trigger.
- **Golden fixture**: present at
  `artifacts/api-server/tests/agents/ag_case_study_picker/golden.json` —
  one v1-shape input + `expectedOutput` (Saudia / Etihad / Aramco
  candidate pool, `n: 2`). **Replace / extend** in Layer 3 to cover the
  v2 `matchScores` field and add at least one edge fixture (empty
  `candidatePool`, `n` larger than pool size).

### Known contract drift to reconcile in Layer 3
- The v1 prompt frontmatter advertises an output of
  `picks: [{ id, match_score, rationale, one_pager_md }]`, but the
  registry `outputSchema` declares `{ selectedIds, rationale, top3 }`.
  The registry shape is the one the runner / fixture / Composer use
  today. Layer 3 should either bump the prompt (v2) to the registry
  shape **or** evolve the registry to a single unified shape — but not
  ship a mixture. The `matchScores` extension above is the proposed
  unified shape.

So the Layer 3 implementation is essentially: prompt v2 + new runner
hook + route + fixture + Composer rewire — the registry skeleton is
already correct.
