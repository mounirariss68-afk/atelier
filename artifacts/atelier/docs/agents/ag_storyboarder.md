### Agent: Storyboarder

- **id:** `ag_storyboarder`
- **kind:** Drafter
- **trigger:** Manual button on a narrative source (a POV draft, a diagnostic memo, a proposal section, or a freeform `narrative` text input). Route: `POST /atelier/storyboards`. Not scheduled, not event-driven.
- **persona:** Engagement Lead or SME preparing a client-facing presentation. Output is consumed by a slides artifact (PPTX export) and reviewed by the Partner before the deck is rendered.

#### Relationship to existing agents (read first)

This agent does **not** overlap with POV Author. The split is structural:

| | POV Author | Storyboarder (this spec) |
|---|---|---|
| Output medium | A reading document — HTML with paragraphs, citations, executive prose. | A presentation outline — ordered slide list, each slide is a *visual + headline + supporting points*, designed to be spoken to. |
| Output shape | `{ html, wordCount }` | `{ slides: [{ layout, headline, body, visual, speakerNotes, sourceCitationIds }] }` |
| When used | When the artefact is *read* (sent ahead of a meeting, attached to a proposal, posted to the client portal). | When the artefact is *presented* (a 30-minute room with a deck on a screen). |
| Voice | Executive prose, persuasive, dense. | Spoken cadence, one idea per slide, ruthlessly compressed. |
| Citation surface | Inline `<sup>` footnotes. | Endnotes slide + `sourceCitationIds` per slide for traceability. |

A POV and a storyboard for the same engagement should tell the *same story* but with different load-bearing artefacts. The Storyboarder is allowed to take an approved POV as its primary input and re-cast it for the room — but it is not allowed to introduce new claims that aren't in the source.

#### Inputs

Plain English: a narrative source (one of: an approved POV, a diagnostic memo, freeform text), an audience description, the time budget for the presentation, and the slide count target.

```ts
inputSchema = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("pov"),             povVersionId: z.string() }),
    z.object({ kind: z.literal("diagnostic_memo"), memoId: z.string() }),
    z.object({ kind: z.literal("freeform"),        narrative: z.string().min(200) }),
  ]),
  audience: z.object({
    description: z.string(),                       // "client CFO + CTO + 2 directors"
    sophistication: z.enum(["executive","mixed","technical"]),
    knownContext: z.string().optional(),           // what they already know
  }),
  presentationMinutes: z.number().int().min(5).max(90),
  targetSlideCount: z.number().int().min(5).max(40).optional(),  // defaults: ~1 slide / 2 minutes
  objective: z.enum(["inform","persuade","decide"]),
  brandTheme: z.string().optional(),               // slide artifact theme id
});
```

Sources: `atelier_pov_versions`, `atelier_diagnostic_memos`, `atelier_research_facts` (promoted-only, for traceability of any claim that came from research), and `knowledge.search` for analogous decks (style reference only, not content).

#### Outputs

Plain English: an ordered list of slides. Each slide has a layout type (title, statement, two-column, chart, quote, section divider, endnotes), a headline, body bullets, a visual brief (described in words — what the chart / image / diagram should show), speaker notes, and citation ids back to the source. Plus deck-level metadata.

```ts
outputSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  arc: z.string(),                                 // one sentence — the story
  estimatedMinutes: z.number(),
  slides: z.array(z.object({
    id: z.string(),                                // "s1", …
    order: z.number().int(),
    layout: z.enum([
      "title","section_divider","statement","two_column",
      "chart","quote","image_full_bleed","endnotes"
    ]),
    headline: z.string(),                          // ≤ 12 words
    body: z.array(z.string()).max(5),              // each ≤ 18 words
    visual: z.object({
      kind: z.enum(["chart","image","diagram","quote_card","none"]),
      brief: z.string(),                           // what to render, in words
      dataRef: z.string().optional(),              // e.g. fact id for chart data
    }),
    speakerNotes: z.string(),                      // 60–120 words spoken cadence
    sourceCitationIds: z.array(z.string()),        // fact / evidence ids
    talkTimeSeconds: z.number().int(),
  })).min(5),
  endnotes: z.array(z.object({
    id: z.string(),                                // matches sourceCitationIds
    text: z.string(),
    sourceLabel: z.string(),                       // "Diagnostic memo §3", "POV §B"
  })),
  confidence: z.enum(["green","amber","red"]),
});
```

Consumers:

- **Primary:** the slides artifact in the workspace — it consumes this JSON and renders a draft PPTX / web deck. The `layout` enum is a 1:1 contract with the slide artifact's available templates.
- **Secondary:** the Atelier UI renders the storyboard as an ordered card list for review before the deck is built.

#### Data sources / tools / side effects

- **DB reads:** `atelier_pov_versions` or `atelier_diagnostic_memos` (depending on source), `atelier_research_facts` (promoted-only, for `sourceCitationIds`), `atelier_opportunities` (for engagement context).
- **Tools (LLM-facing):** `knowledge.search` for stylistic analogues only; `file.read` for any Lead-supplied materials. No web search.
- **Writes:** one row in `atelier_storyboards` (new domain table — to be added during implementation), keyed by source id + runId. On commit (Partner approval), the storyboard is forwarded to the slides artifact via an internal job; the slides artifact handles its own persistence.
- **Audit:** `agent.start`, `agent.complete`, plus `storyboard.create` and `storyboard.commit_to_slides` on the handoff.
- **Notifications:** notify the Lead when the Partner approves; notify the Partner when a draft is ready.

#### Human checkpoints

| Order | Decider role | Blocking? | What is being decided |
|---|---|---|---|
| 1 | Engagement Lead | Yes | Approve / re-order / drop slides; rewrite headlines and body. |
| 2 | Partner | Yes | Sign off before slides are built. Partner is the keeper of the *arc* — they can reject if the story doesn't land. |

#### Prompt outline

Sections of `prompts/storyboarder/v1.md`:

1. **Role + voice** — "You are Storyboarder. You turn dense narratives into a deck a senior partner can present cold. One idea per slide. Spoken cadence in speaker notes. The headline is the thing you'd say if you only had one sentence on the screen."
2. **Hard rules**
   - **No new claims.** Every factual statement in `body` or `speakerNotes` MUST be traceable to a `sourceCitationId`. If the source narrative doesn't say it, the storyboard doesn't say it.
   - `headline` ≤ 12 words; `body` items ≤ 18 words. The model is told these are non-negotiable.
   - `slides[*].talkTimeSeconds` MUST sum to within ±15% of `presentationMinutes × 60`.
   - First slide `layout` is always `title`. Last content slide is always `endnotes`. At least one `section_divider` per ~6 content slides.
   - Speaker notes use spoken cadence — short sentences, contractions allowed; no bullet syntax.
3. **Arc construction** — explicitly model the story as setup → tension → resolution → ask. The `arc` field is the one-sentence summary of that shape.
4. **Visual briefs** — describe the visual in words a designer could execute. For `chart` layouts, name the chart type and the data; for `quote` layouts, supply the verbatim quote from the source; for `image` layouts, describe the subject in concrete nouns.
5. **Audience tuning** — for `executive` audiences, lean into outcomes and trade-offs; for `technical`, allow specifics in body bullets; for `mixed`, headline is executive, speaker notes carry the technical depth.
6. **Output contract** — JSON matching `outputSchema` exactly.

#### Success criteria

- A Lead can go from "approved POV" to "first-draft deck open in the slides artifact" in under 5 minutes of agent + UI time.
- ≥ 70% of generated storyboards are approved by the Partner with no slide deletions on the first pass (re-ordering and headline edits are allowed and expected).
- Zero Partner rejections cite "the story doesn't hang together" — meaning the `arc` is consistently strong. (Tracked qualitatively for the first 20 runs, then promoted to a graded eval.)
- Talk-time estimates are within ±15% of actual delivery time for at least 5 measured presentations.

#### Eval ideas

- **Citation integrity (numeric):** golden fixture sourced from a known POV with N promoted facts → assert every `slides[*].sourceCitationIds` element resolves to a real promoted fact id, and that ≥ 80% of slides cite at least one.
- **Length discipline (shape):** assert `headline.length` words ≤ 12 and every `body[*]` ≤ 18 words. Exceeds → fail.
- **Time budget (numeric):** assert `|sum(talkTimeSeconds) − presentationMinutes × 60| / (presentationMinutes × 60) ≤ 0.15`.
- **Structure:** assert first slide `layout === "title"`, last slide `layout === "endnotes"`, at least one `section_divider` if `slides.length ≥ 6`.
- **No-fabrication:** lint speaker notes for numeric claims (regex on digits / percent signs) and assert each is traceable to a cited source.

#### UI

Bespoke. `uiComponent: "/atelier/storyboards/:runId"` with rationale: review needs an ordered card list with drag-to-reorder, inline headline / body edits, and a "preview as deck" affordance that links to the slides artifact. The generic JSON-schema run view does not support reorder UX, and storyboards are inherently spatial. Note in the registry entry that the editor is read/write on the persisted storyboard row, not on the agent run output (the run output is immutable).
