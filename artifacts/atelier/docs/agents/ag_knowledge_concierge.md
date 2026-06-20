# Agent Design Spec — Knowledge Concierge

> Layer 2 spec. Follows the template in `artifacts/atelier/AGENT_STANDARD.md` §10.
> Implementation is a separate Layer 3 task.

### Agent: Knowledge Concierge
- **id:** `ag_knowledge_concierge`
- **kind:** Analyst
- **trigger:**
  - manual button on Personal Pane A ("Ask the Atelier") and on the in-engagement
    sidebar ("Ask in this engagement")
  - event-driven follow-up: when a Drafter agent (POV Author, Proposal Composer,
    Charter Architect) emits a `knowledge.gap` audit event, a Knowledge Concierge
    run is queued automatically with that gap as the question
- **persona:** any Cognirise employee. Primary surfaces are the Engagement Lead's
  Personal Pane A queue and the in-engagement context panel.

### Inputs
Plain English: a natural-language question, optional engagement / opportunity
scope, optional preferred answer style (short citation list vs. long answer).

```ts
z.object({
  question: z.string().min(3),
  scope: z.object({
    engagementId: z.string().optional(),
    opportunityId: z.string().optional(),
    sectorTags: z.array(z.string()).optional(),
    offeringTags: z.array(z.string()).optional(),
  }).optional(),
  answerStyle: z.enum(["citations_only", "short_answer", "long_answer"]).default("short_answer"),
  topK: z.number().int().min(1).max(20).default(8),
})
```

### Outputs
Plain English: a synthesized answer plus a ranked list of citations from Atelier
sources. Each citation links back to its source row so the UI can deep-link.

```ts
z.object({
  answer: z.string(),                       // markdown, citation markers like [1]
  citations: z.array(z.object({
    n: z.number().int().min(1),             // matches [n] in answer
    sourceType: z.enum([
      "case_study", "pov", "proposal", "charter", "win_loss_debrief",
      "win_theme", "engagement_memo", "agent_run",
    ]),
    sourceId: z.string(),
    title: z.string(),
    snippet: z.string(),
    score: z.number(),
  })),
  unanswered: z.boolean(),                  // true if confidence is too low to answer
  confidence: z.enum(["green", "amber", "red"]),
})
```

### Data sources
Atelier knowledge tables only — no public web. Concretely:
`atelier_case_studies`, `atelier_povs` + `atelier_pov_versions`,
`atelier_proposals`, `atelier_charters`, `atelier_win_loss_debriefs`,
`atelier_win_themes`, `atelier_engagement_memos`, and the run output of
`ag_theme_curator` / `ag_atelier_curator` (i.e. `atelier_agent_runs.output`
filtered to those agent ids).

Retrieval is hybrid: BM25 over the `*_search` text columns plus pgvector cosine
over the existing `embedding` columns. Scope filters (engagement / opportunity /
sector / offering) are applied as SQL pre-filters before scoring.

### Side effects
- Writes one row to `atelier_agent_runs`.
- Emits `agent.start`, `agent.complete` (or `agent.error`) on `atelier_audit_events`.
- Emits `knowledge.answered { question, sourceIds[] }` audit event so we can
  measure which corpora actually answer questions.
- Optional: when `unanswered = true`, drops a Pane A item titled
  "Knowledge gap: <question>" tagged for the Atelier Curator to triage.
- No domain-table mutations.

### Human checkpoints
None (Analyst). The user is in the loop by reading the answer; "thumbs
up / thumbs down" telemetry is captured as an `atelier_audit_event`
(`knowledge.feedback`) but does not block the run.

### Prompt outline
1. **Role & scope.** "You are the Atelier Concierge. Answer only from the
   provided context blocks. Do not use outside knowledge."
2. **Citation contract.** Every factual claim must end with `[n]` referencing
   an entry in the `citations` list. Output JSON shape declared.
3. **Refusal rule.** If no context block supports the question, set
   `unanswered: true`, leave `answer` empty, and explain in one sentence
   what additional source would be needed.
4. **Style switch.** Honour `answerStyle`: short ≤ 4 sentences, long ≤ 12,
   citations_only returns the ranked list with no prose.
5. **Confidence rubric.** green = ≥ 3 citations agree; amber = 1–2 citations
   or weak agreement; red = no usable citations (paired with `unanswered`).

### Success criteria
- For a curated set of 20 known questions, ≥ 80 % return `unanswered = false`
  with the expected canonical source in the top 3 citations.
- Median p50 latency under 4 s with `topK = 8`.
- Zero answers contain a citation marker `[n]` without a matching entry in
  the `citations` array (enforced by validator post-LLM, not just prompt).

### Eval ideas
- Shape eval: every `[n]` in `answer` resolves to a `citations[].n`.
- Numeric eval: on the curated 20-question set, ≥ 16 (80 %) score
  "expected source in top 3".
- Refusal eval: 5 nonsense questions all return `unanswered = true`.

### UI
Bespoke. `uiComponent: "/atelier/concierge"`.
Rationale: a chat-style search box with citation chips and source previews
does not map cleanly onto the generic `AgentRun.tsx` JSON-output shell. The
Personal Pane A queue still uses the registry-driven card; clicking it
opens the bespoke surface.

### Overlap with existing agents
- **Pursuit Scout** also performs search, but only over the **public web** for
  a freshly created opportunity. Knowledge Concierge is the inverse: **internal
  corpus only**, available across personas and stages. The two are explicitly
  not interchangeable; if a Pursuit Scout run cites an internal source, that is
  a bug — it should hand off to Knowledge Concierge instead.
- **Atelier Curator** consumes the same corpus but writes promotion proposals.
  Knowledge Concierge is read-only; if a user discovers a promotable artefact
  through search, the answer surface offers a "promote to Atelier" action that
  enqueues an Atelier Curator run rather than doing the work itself.
