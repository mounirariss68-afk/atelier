# Agent Design Spec — Atelier Curator

> Layer 2 spec. Follows the template in `artifacts/atelier/AGENT_STANDARD.md` §10.
> Implementation is a separate Layer 3 task.

### Agent: Atelier Curator
- **id:** `ag_atelier_curator`
- **kind:** Drafter
- **trigger:**
  - scheduled: weekly cron (Mondays 06:00 GST) sweeps recently-completed
    domain artefacts (proposals shipped, POVs published, debriefs closed,
    high-confidence agent runs) and emits a batch of promotion proposals
  - manual: a Partner can click "Curate now" on the Atelier admin page
  - event-driven: a `knowledge.gap` event from Knowledge Concierge can
    enqueue a targeted run scoped to one offering / sector
- **persona:** Partner (decider). Atelier Lead is the secondary recipient
  who can pre-triage before the Partner sees it.

### Inputs
Plain English: a window of completed work to scan, plus optional scope filters.

```ts
z.object({
  since: z.string().datetime(),             // sweep window start
  until: z.string().datetime(),             // sweep window end
  scope: z.object({
    offeringTags: z.array(z.string()).optional(),
    sectorTags: z.array(z.string()).optional(),
    minConfidence: z.enum(["green", "amber"]).default("amber"),
  }).optional(),
  maxCandidates: z.number().int().min(1).max(50).default(15),
})
```

### Outputs
Plain English: a ranked list of promotion candidates, each tagged with what
kind of Atelier asset it should become and why.

```ts
z.object({
  candidates: z.array(z.object({
    sourceType: z.enum([
      "proposal_section", "pov_version", "charter_section",
      "debrief_lesson", "agent_run_output", "engagement_memo",
    ]),
    sourceId: z.string(),
    proposedAssetType: z.enum([
      "case_study", "pov", "playbook", "prompt", "win_theme",
    ]),
    title: z.string(),
    summary: z.string(),                    // 2–3 sentences, Cognirise voice
    rationale: z.string(),                  // why this is reusable IP
    score: z.number().min(0).max(1),        // see scoring rubric below
    scoreBreakdown: z.object({
      reuseSignal: z.number(),              // 0..1 — how often this pattern recurs
      outcomeSignal: z.number(),            // 0..1 — was the engagement successful
      uniquenessSignal: z.number(),         // 0..1 — does the Atelier already cover it
      consentSignal: z.number(),            // 0..1 — client consent / anonymisation status
    }),
    suggestedTags: z.object({
      offering: z.array(z.string()),
      sector: z.array(z.string()),
    }),
  })).max(50),
  confidence: z.enum(["green", "amber", "red"]),
})
```

### Data sources
- `atelier_proposals`, `atelier_pov_versions`, `atelier_charters`,
  `atelier_win_loss_debriefs`, `atelier_engagement_memos`
- `atelier_agent_runs` filtered to high-confidence completed runs in the window
- `atelier_case_studies`, `atelier_povs`, `atelier_win_themes` (existing
  catalogue — used to compute `uniquenessSignal`)
- `atelier_engagements` (for outcome / win-loss + client consent flags)

### Side effects
- Writes one row to `atelier_agent_runs`.
- For each accepted candidate, writes to `atelier_promotion_proposals`
  (new domain table, owned by this agent) with status = `pending_partner`.
- Emits `atelier.promotion.proposed` per candidate on
  `atelier_audit_events`.
- Emits one Pane A item per Partner targeted, titled
  "Atelier Curator: <N> new promotion candidates".
- On Partner approval (UI), the implementation Layer 3 task may insert
  rows into the destination domain tables (`atelier_case_studies`,
  `atelier_povs`, etc.) and emit `atelier.promotion.committed`. The
  agent itself does **not** mutate the destination tables — only the
  proposal table.

### Human checkpoints
1. **Partner approval** (blocking). Reviews each candidate; can approve,
   edit, reject, or defer. Decision recorded on
   `atelier_agent_runs.humanDecisions`.

### Prompt outline
1. **Role.** "You are the Atelier Curator. Identify reusable IP. Your bar
   is high — only propose what the firm should re-use across at least two
   future engagements."
2. **Scoring rubric.** Definition of each `scoreBreakdown` component on a
   0..1 scale. Final `score` = weighted average (reuse 0.35, outcome 0.30,
   uniqueness 0.25, consent 0.10).
3. **Asset-type routing.** Hard rules for which `sourceType` can become
   which `proposedAssetType` (e.g. a debrief lesson cannot become a
   case_study without a paired engagement outcome).
4. **Consent gate.** If `consentSignal < 0.5`, the candidate must explicitly
   say "anonymisation required" in `rationale`.
5. **Anti-duplication.** Before proposing, the prompt is given the existing
   Atelier catalogue (titles + tags) and must not propose anything whose
   `uniquenessSignal` would be < 0.3.
6. **Output JSON contract.**

### Success criteria
- ≥ 60 % of proposals reach `approved` (not rejected) by the Partner over
  a rolling 4-week window.
- 0 promotions land in destination tables without an explicit Partner
  decision row.
- Median weekly run yields between 3 and 15 candidates (tuned by the
  scoring weights, not by clamping).

### Eval ideas
- Shape eval: every `score` equals the documented weighted sum of its
  `scoreBreakdown` components within ±0.01.
- Numeric eval: on a synthetic input where the Atelier already contains
  an exact-match case_study, `uniquenessSignal` for that candidate is < 0.3.
- Consent eval: on an input flagged `consentSignal: 0.2`, the rationale
  contains the substring "anonymisation".

### UI
Bespoke. `uiComponent: "/atelier/curator"`.
Rationale: the candidate review surface needs side-by-side preview of the
source artefact and the proposed Atelier asset, plus inline edit before
Partner approval. The generic JSON-output view is not enough.

### Overlap with existing agents
- **Synthesis Critic** also reads completed work, but its goal is
  *quality scoring* of an in-flight POV / proposal. Atelier Curator runs
  *after* completion and asks the orthogonal question "is this reusable?".
  A high Synthesis Critic score is one input to `outcomeSignal`, but the
  two agents do not overlap in their write surface — Critic writes to the
  POV/proposal version, Curator writes to the promotion-proposal table.
- **Knowledge Concierge** is the read-only counterpart: it surfaces
  existing Atelier assets in response to a question. Curator creates
  the assets that Concierge then surfaces. They share the same domain
  tables but their write/read responsibilities are disjoint.
- **Prompt Librarian** is a sibling Curator scoped specifically to
  prompts — see that spec for the boundary.
