# Agent Design Spec — Theme Curator

> Layer 2 spec. Follows the template in `artifacts/atelier/AGENT_STANDARD.md` §10.
> This agent is **partial** — see "What's already built" before scoping
> the implementation task.

### Agent: Theme Curator
- **id:** `ag_theme_curator`
- **kind:** Analyst (with one human checkpoint at the end — Partner curation
  of the firm-wide theme catalogue)
- **trigger:**
  - scheduled: weekly cron (Mondays 07:00 GST), after Atelier Curator,
    so the latest debriefs and any newly-promoted lessons are in scope
  - event-driven: when a Win/Loss debrief is closed
    (`win_loss.closed` audit event), enqueue a single-debrief
    incremental run scoped to that debrief's themes
  - manual: Partner / Atelier Lead button on the Win Themes admin page
- **persona:** Partner is the decider for the catalogue. Engagement
  Leads consume the `openProposalSuggestions` payload as Pane A items
  on their open Pursue-stage opportunities.

### Inputs
Plain English: the active win-themes library, every closed debrief
with its themes payload, and the list of open Pursue-stage
opportunities (with offering + sector tags).

```ts
// Already declared in registry.ts (ThemeCurator.inputSchema).
z.object({
  debriefThemes: z.array(z.unknown()),     // [{ tag, name, polarity, debriefId, quote }]
  openOpportunityIds: z.array(z.string()),
})
```

Layer 3 should tighten `debriefThemes` from `z.unknown()` to the
explicit shape implemented in the existing runner
(`{ tag, name, polarity, debriefId, quote }`) and add an optional
`activeThemes: AtelierWinTheme[]` and
`openOpportunityContext: Array<{ id, offeringTags[], sectorTags[] }>` so
the prompt does not have to refetch.

### Outputs
Plain English: an upserts list for the canonical themes library, a
list of emergent themes that don't fit yet, a list of suggestions for
open proposals, and an overall confidence.

```ts
// Already declared in registry.ts (ThemeCurator.outputSchema).
z.object({
  upsertThemes: z.array(z.object({
    tag: z.string(),
    name: z.string(),
    description: z.string(),
    polarity: z.enum(["win", "loss"]),
    contributingDebriefIds: z.array(z.string()),
    positioningLine: z.string(),
    offeringTags: z.array(z.string()).optional(),
    sectorTags: z.array(z.string()).optional(),
  }).passthrough()),
  emergentThemes: z.array(z.object({
    tag: z.string(),
    name: z.string(),
    supportingQuotes: z.array(z.string()),  // ≥ 2 enforced by guardrail
  })),
  openProposalSuggestions: z.array(z.object({
    opportunityId: z.string(),
    themeTag: z.string(),
    rationale: z.string(),
  })),
  confidence: z.enum(["green", "amber", "red"]),
})
```

### Data sources
- `atelier_win_themes` (active rows) — the catalogue we're upserting into.
- `atelier_win_loss_debriefs` (closed only) and their `themes[]` payload.
- `atelier_opportunities` filtered to stage `Pursue` for
  `openOpportunityIds`, joined to their offering / sector tags.
- Optional read of `atelier_agent_runs` for `ag_win_loss_interviewer`
  to attribute the originating debrief author.

### Side effects
- Writes one row to `atelier_agent_runs`.
- After Partner approval (human checkpoint below), upserts to
  `atelier_win_themes` (existing table) — supportCount recomputed from
  `len(unique contributingDebriefIds)`.
- For each `openProposalSuggestions[*]`, creates a Pane A item
  addressed to the Engagement Lead on that opportunity, titled
  "Theme Curator suggests: <themeName>".
- Emits `theme.upsert.proposed`, `theme.emergent.surfaced`,
  `theme.suggestion.dispatched` audit events.
- Does **not** mutate any open proposal directly — suggestions are
  human-pulled via Pane A.

### Human checkpoints
1. **Partner curates Atelier theme catalogue** (blocking) — already
   declared in the registry. Approves / edits / rejects each item in
   `upsertThemes` and each item in `emergentThemes`.

### Prompt outline
The existing v1 prompt (see `prompts/theme_curator/v1.md`) is the
starting point. Sections it already enforces:
1. **Role.** Cluster all closed-debrief themes into the canonical
   `atelier_win_themes` library.
2. **Hard rules.** Never invent debrief evidence; `supportCount = len(unique
   debrief ids)`; positioningLine is a single ready-to-paste sentence in
   Cognirise voice; cluster aggressively at the tag level (senior_delivery,
   speed_to_value, pricing_wedge, partner_leverage, agentic_native,
   gcc_context); only surface emergent buckets when ≥ 2 distinct
   debriefs support them.
3. **Output JSON shape.**

Layer 3 should also add:
4. **Confidence rubric.** green = every upsert has ≥ 3 contributing
   debriefs and no emergent buckets; amber = at least one upsert has
   1–2 debriefs OR there are emergent buckets; red = there are
   `openProposalSuggestions` whose `themeTag` does not exist in either
   `upsertThemes` or `activeThemes`.
5. **Suggestion contract.** Every `openProposalSuggestions[*]` rationale
   must reference at least one offering or sector tag from the target
   opportunity.

### Success criteria
- Every `upsertThemes[*].contributingDebriefIds` references real
  debrief ids in the input (validator-enforced post-LLM).
- Every `openProposalSuggestions[*].opportunityId` is in the input
  `openOpportunityIds` list.
- ≥ 50 % of dispatched Pane A suggestions are accepted by Engagement
  Leads (rolling 8-week measurement).
- Partner approval rate on `upsertThemes` ≥ 70 %.

### Eval ideas
- Emergent eval: every `emergentThemes[*].supportingQuotes` has length
  ≥ 2 (already declared as `ev_emergent_support`).
- Reference eval: every `contributingDebriefIds[i]` appears in the
  input `debriefThemes[*].debriefId` set.
- Suggestion eval: every `openProposalSuggestions[*].opportunityId`
  appears in the input `openOpportunityIds` set.

### UI
Generic registry-driven `AgentRun.tsx` view is sufficient for the
run-output preview. The Win Themes admin page (existing) should grow
a "Curator proposed" tray that pulls the latest run output and lets
the Partner approve in bulk. The Engagement Lead consumes
`openProposalSuggestions` through the standard Pane A surface, no
bespoke UI needed.

### Overlap with existing agents
- **Synthesis Critic** scores in-flight POVs / proposals against an
  evidence rubric; Theme Curator works one step removed, looking
  across closed debriefs to produce reusable positioning lines.
  Critic may consume Curator's `positioningLine` text but does not
  produce themes itself.
- **Atelier Curator** promotes broader IP (case studies, POVs,
  playbooks, prompts). Themes are explicitly out of its remit so the
  two do not collide; both surface proposals via Pane A on
  cross-cutting cadences.
- **Win/Loss Interviewer** produces the debrief themes that this
  agent consumes. The boundary is one-way: Theme Curator never edits
  a debrief's themes payload.

### What's already built
- **Registry entry**: present in `lib/agents/src/registry.ts` as
  `ThemeCurator`, `status: "registered"`, model `claude-sonnet-4-6`,
  `systemPromptRef: "prompts/theme_curator/v1.md"`. Output schema is
  already detailed; input schema uses `z.array(z.unknown())` for
  `debriefThemes` and should be tightened in Layer 3.
- **Prompt v1**: present at
  `artifacts/api-server/prompts/theme_curator/v1.md` with the hard
  rules, clustering tags, and output contract listed above. **Reuse**;
  Layer 3 may bump to v2 only to add the confidence rubric and
  suggestion contract.
- **Runner hook**: `runThemeCurator` already exists in
  `artifacts/api-server/src/lib/atelier-agents/runner.ts` (around
  line 3442) and already composes `runAgent(...)` with the shared
  lifecycle helper. It calls `loadPrompt("theme_curator")`,
  `callClaudeJson` with `claude-sonnet-4-6`, and falls back to
  `mockThemeCurator(...)` when the live call is unavailable.
  **Reuse**; Layer 3 work is to add the post-LLM validation
  (`contributingDebriefIds ⊆ input`, `openOpportunityIds ⊆ input`)
  and to wire the Partner-approval upsert path into
  `atelier_win_themes` (today the runner returns the proposed
  upserts but does not commit them).
- **Route handler**: confirm presence in
  `artifacts/api-server/src/routes/atelier/agentRoutes.ts` — add the
  scheduled-trigger and the Partner-approval commit endpoint if
  missing.
- **Golden fixture**: present at
  `artifacts/api-server/tests/agents/ag_theme_curator/golden.json` —
  one input (two `trust_incumbent` debrief themes, two open
  opportunity ids) + matching `expectedOutput` covering `upsertThemes`,
  `emergentThemes`, `openProposalSuggestions`, `confidence: "amber"`.
  **Reuse**; in Layer 3 add at least one extra fixture for the
  Partner-approval commit path and one negative case (suggestion
  pointing at an `opportunityId` outside the input set should be
  rejected by the post-LLM validator).

### Known contract drift to reconcile in Layer 3
- The existing fixture's `emergentThemes[0]` reuses the same `tag`
  (`trust_incumbent`) as an `upsertThemes[0]` entry; per the spec's
  "anti-duplication" intent, an emergent bucket should only surface
  when no canonical bucket fits. Decide whether to (a) tighten the
  prompt + validator to forbid this and update the fixture, or (b)
  document the overlap as intentional. Either way, make the call
  explicit so the Partner UI doesn't show duplicate items.
- The v1 prompt frontmatter is currently a bare YAML block (no
  surrounding `---` fences) where every other prompt uses fenced
  frontmatter. Normalise during the v2 bump.

So Layer 3 is mostly: input-schema tightening, prompt v2 (additive),
post-LLM validation, Partner-approval commit path, fixture — the
registry skeleton, runner, and prompt are already in place.
