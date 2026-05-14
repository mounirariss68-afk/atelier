### Agent: Diagnostic Memo Author

- **id:** `ag_diagnostic_memo`
- **kind:** Drafter
- **trigger:** Manual button on a discovery `atelier_meeting` row once Meeting Scribe has been approved (`POST /atelier/meetings/:id/diagnostic-memo`). Also invokable in bulk from an opportunity ("draft a diagnostic memo from these N discovery sessions").
- **persona:** Engagement Lead during the Shape stage, post-discovery, pre-POV. Output is reviewed by the Partner and consumed downstream by POV Author.

#### Relationship to existing agents (read first)

This agent sits **between** Meeting Scribe and POV Author and overlaps with neither:

| | Meeting Scribe | Diagnostic Memo Author (this spec) | POV Author |
|---|---|---|---|
| Stage | Per-meeting record | Cross-meeting synthesis of *what we heard* | Outward-facing argument of *what we believe* |
| Voice | Neutral, factual transcript | Neutral, factual diagnosis | Persuasive, takes a position |
| Audience | Internal — Lead + Partner | Internal — Lead + Partner | Client executives |
| Citation unit | Speaker turn in one transcript | Quote / decision / action across N transcripts | Promoted facts from research + diagnostic |
| Output shape | Per-meeting record (decisions, actions, 5C delta) | Memo: situation, evidence, hypotheses, gaps, recommended next moves | HTML POV with thesis, sections, citations |

The diagnostic memo is the artefact that turns "we ran four discovery interviews" into "here is what's actually going on, and here are the three hypotheses we want to test in the POV." It is **not** the POV. It is **not** a meeting recap. It is the synthesis layer that has been missing.

#### Inputs

Plain English: one or more approved discovery transcripts (with their Meeting Scribe outputs), the opportunity record, and optionally a prior brief or 5C snapshot.

```ts
inputSchema = z.object({
  opportunityId: z.string(),
  meetingIds: z.array(z.string()).min(1),     // approved discovery meetings
  scopeNote: z.string().optional(),           // Lead's framing of what to focus the memo on
  priorBriefId: z.string().optional(),        // for "what changed" framing
});
```

Sources: `atelier_meetings` (transcript + scribe output), `atelier_opportunities`, `atelier_briefs` (prior), `atelier_research_facts` (promoted-only, for grounding the gap analysis), `knowledge.search` for analogues (used sparingly, cited).

#### Outputs

Plain English: a structured memo with five sections (situation, evidence, hypotheses, gaps, next moves), each section grounded in citations to specific quotes or decisions in the source transcripts. Plus a confidence rating per hypothesis.

```ts
outputSchema = z.object({
  title: z.string(),
  opportunityId: z.string(),
  sourcedFromMeetingIds: z.array(z.string()).min(1),
  situation: z.object({
    summary: z.string(),                      // 150–250 words, neutral
    fiveC: z.object({
      client: z.string(), competition: z.string(), capability: z.string(),
      capacity: z.string(), contract: z.string(),
    }),
  }),
  evidence: z.array(z.object({
    id: z.string(),                           // "e1", "e2", …
    claim: z.string(),                        // one sentence
    citations: z.array(z.object({
      meetingId: z.string(),
      quote: z.string(),                      // verbatim from transcript
      speaker: z.string(),                    // or "Speaker A" if unattributed
    })).min(1),
  })).min(3),
  hypotheses: z.array(z.object({
    id: z.string(),                           // "h1", …
    statement: z.string(),
    supportingEvidenceIds: z.array(z.string()).min(1),
    confidence: z.enum(["green","amber","red"]),
    disconfirmingSignals: z.array(z.string()).optional(),
  })).min(2).max(5),
  gaps: z.array(z.object({
    question: z.string(),
    whyItMatters: z.string(),
    proposedNextStep: z.enum(["follow_up_interview","data_request","workshop","desk_research"]),
  })),
  recommendedNextMoves: z.array(z.string()).min(1).max(5),
  confidence: z.enum(["green","amber","red"]),
});
```

Consumers:

- **Primary:** POV Author — its `inputs.approved_facts` will be seeded from the diagnostic memo's `evidence[]` (with citations preserved as fact ids) and the POV thesis is expected to take a position on one or more `hypotheses`.
- **Secondary:** the Atelier brief view; the memo replaces the ad-hoc "discovery summary" prose Leads currently paste into the brief.
- The Partner reads it as the input to the "go / no-go on POV" decision.

#### Data sources / tools / side effects

- **DB reads:** `atelier_meetings` (transcript text + approved Meeting Scribe output), `atelier_opportunities`, `atelier_briefs` (prior brief if any), `atelier_research_facts` (promoted-only — used to fill `gaps`, never injected as evidence).
- **Tools (LLM-facing):** `knowledge.search` for analogous diagnoses (must be cited as such, not as evidence from this engagement); `file.read` for Lead-attached materials referenced in the scope note. No web search, no transcribe.
- **Writes:** one row in `atelier_diagnostic_memos` (new domain table — to be added during implementation), keyed by opportunity. On commit, `atelier_briefs` may be updated to point at the memo (replacing free-text discovery summary).
- **Audit:** `agent.start`, `agent.complete`, plus `diagnostic_memo.create` on persistence and `diagnostic_memo.commit` on Partner approval.
- **Notifications:** notify the Partner on `atelier_notifications` when a memo is awaiting approval; notify the Lead when a hypothesis flips to `red`.

#### Human checkpoints

| Order | Decider role | Blocking? | What is being decided |
|---|---|---|---|
| 1 | Engagement Lead | Yes | Edit / approve the draft. Lead can re-cast hypotheses, prune evidence, and re-rank next moves. |
| 2 | Partner | Yes | Sign off on the memo before it can seed POV Author. Partner can downgrade a hypothesis confidence but cannot fabricate evidence. |

#### Prompt outline

Sections of `prompts/diagnostic_memo/v1.md`:

1. **Role + voice** — "You are Diagnostic Memo Author. Neutral, factual, internal voice. You are not selling — you are diagnosing. The Partner trusts the memo because every claim points back to a specific quote in a specific transcript."
2. **Hard rules**
   - Every entry in `evidence[]` MUST include at least one verbatim quote from one of the input transcripts. No paraphrase-only claims.
   - Every entry in `hypotheses[]` MUST cite at least one `evidence[].id` in `supportingEvidenceIds`. Hypotheses without supporting evidence are not allowed.
   - `disconfirmingSignals` is encouraged; a hypothesis with none should be flagged in the prompt as "consider whether this is conviction or wishful thinking."
   - `gaps[]` MUST be grounded in *what was not said* in the transcripts, not in generic discovery checklists.
3. **Synthesis method** — clusters quotes into themes, themes into evidence, evidence into hypotheses; explicitly looks for contradictions across transcripts and surfaces them.
4. **5C delta** — if `priorBriefId` is supplied, fill `situation.fiveC` as a delta vs. the prior brief; otherwise fill it as a current-state snapshot.
5. **Output contract** — JSON matching `outputSchema` exactly. No markdown wrapping.

#### Success criteria

- Every opportunity that reaches POV stage has a Partner-approved diagnostic memo attached. Free-text "discovery summary" prose disappears from briefs over the next quarter.
- Median Lead edit distance on the draft is < 30% (memo is good enough that Leads tweak rather than rewrite).
- Partner approvals on memos average ≤ 1 business day from draft.
- POV Author's `approved_facts` come from a diagnostic memo in ≥ 80% of POV runs.

#### Eval ideas

- **Citation integrity (numeric):** for the golden fixture, assert that 100% of `evidence[*].citations[*].quote` strings appear as substrings in the corresponding meeting's transcript. If an LLM fabricates a quote, the eval fails.
- **Hypothesis grounding (shape):** assert every `hypotheses[*].supportingEvidenceIds` element resolves to an `evidence[*].id`.
- **Coverage:** for a fixture with 4 input meetings, assert `sourcedFromMeetingIds` equals all 4 (the agent shouldn't quietly drop one).
- **Voice:** lint the `situation.summary` for banned words from `house_voice` (no "leverage", no "synergies", no "going forward").

#### UI

Generic registry-driven by default. Once the memo type stabilises, a bespoke editor (`uiComponent: "/atelier/opportunities/:id/diagnostic-memo/:runId"`) is justified for inline citation editing — but that is a follow-up after the first round of usage feedback, not part of the initial implementation. Note this in the registry entry's `uiRationale` as "generic shell for v1; bespoke editor planned once Lead edit patterns stabilise."
