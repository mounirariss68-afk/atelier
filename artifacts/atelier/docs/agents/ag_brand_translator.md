# Agent Design Spec — Brand Translator

> Layer 2 design spec. Implementation is a separate Layer 3 task.
> Conforms to `artifacts/atelier/AGENT_STANDARD.md` §10.

### Agent: Brand Translator

- **id:** `ag_brand_translator`
- **kind:** Drafter (produces a *proposed* rewrite that a human approves before it replaces the original draft)
- **trigger:**
  - Manual button on any draft in the Atelier ("Rewrite in Cognirise voice", with target-language picker).
  - Auto-invoked by the **Send-to-client** flow when (a) the artifact's source language differs from the client's expected language, or (b) the brand-voice score on the artifact (computed cheaply on save) is below threshold. The proposed rewrite is offered to the Lead — never auto-applied.
- **persona:** Consultant or Engagement Lead invokes; Partner approves only when the artifact is partner-signed.
- **status target:** `registered` after the implementation task lands runner + prompt + fixture; `mvp` once eval thresholds pass on the golden set.

---

### Relationship to Synthesis Critic and Compliance Reviewer

Brand Translator is the **voice / language** quality gate. It is complementary to the other two Quality agents and never overlaps:

| Agent | Owns |
| --- | --- |
| Synthesis Critic | Argument structure, evidence coverage, pyramid / MECE. Read-only. |
| Compliance Reviewer | Regulatory / contractual / firm-policy conformance. Read-only. Binary verdict. |
| **Brand Translator** | **Voice, tone, terminology, language. Produces a proposed rewrite. Never opines on argument quality or compliance.** |

Ordering in the Send-to-client flow:

1. Synthesis Critic + Compliance Reviewer run in parallel on the **original** draft. If either is `red`, send is blocked and Brand Translator is *not* invoked (no point translating an unsound or non-compliant draft).
2. Once both gates clear, Brand Translator runs if needed (language mismatch or low brand-voice score).
3. The Brand Translator **proposal** must be human-accepted; on acceptance, Synthesis Critic re-runs on the rewritten draft to confirm no claims were lost in translation. Compliance Reviewer does **not** re-run, because the rule-evidence mapping is by section id and the evidence-preservation guardrail (below) protects citation text verbatim.

Brand Translator never edits an artifact directly; it stages a `pending_rewrite` that the Lead accepts or rejects.

---

### Inputs

**Plain English.** A draft, an optional explicit target language, optional explicit voice profile override, and the engagement context needed to choose the right voice (audience seniority, sector, formality).

```ts
inputSchema: z.object({
  draft: z.object({
    artifactKind: z.enum(["proposal", "sow", "memo", "deliverable", "email", "slide_notes"]),
    artifactId: z.string(),
    body: z.string().min(1),                  // markdown
    sections: z.array(z.object({
      id: z.string(),
      heading: z.string(),
      content: z.string(),
    })).optional(),
  }),
  sourceLanguage: z.enum(["en", "ar", "tr", "auto"]).default("auto"),
  targetLanguage: z.enum(["en", "ar", "tr"]),
  voiceProfile: z.enum(["cognirise_partner", "cognirise_consultant", "cognirise_executive_brief"])
    .default("cognirise_consultant"),
  audience: z.object({
    seniority: z.enum(["c_suite", "vp", "director", "ic", "mixed"]).default("mixed"),
    sector: z.string().optional(),
    formality: z.enum(["formal", "neutral", "warm"]).default("formal"),
  }).optional(),
  engagementId: z.string(),
  preserveEvidence: z.boolean().default(true), // see guardrail
});
```

### Outputs

**Plain English.** A staged rewrite (per-section, with the original alongside), a detected source language, a brand-voice score before/after, and an explicit list of every quote / number / citation that was preserved verbatim so a reviewer can spot-check.

```ts
outputSchema: z.object({
  detectedSourceLanguage: z.enum(["en", "ar", "tr", "mixed", "unknown"]),
  targetLanguage: z.enum(["en", "ar", "tr"]),
  voiceProfile: z.string(),
  rewrite: z.object({
    sections: z.array(z.object({
      id: z.string(),
      heading: z.object({
        original: z.string(),
        rewritten: z.string(),
      }),
      original: z.string(),
      rewritten: z.string(),
      changeSummary: z.string(),              // one-line description of the change
      voiceScoreDelta: z.number(),            // before -> after, this section
    })),
    fullBody: z.string(),                     // assembled rewrite, ready to stage
  }),
  voiceScoreBefore: z.number().min(0).max(1),
  voiceScoreAfter: z.number().min(0).max(1),
  preservedEvidence: z.array(z.object({
    kind: z.enum(["quote", "number", "citation", "named_entity", "metric"]),
    text: z.string(),                         // verbatim
    sectionId: z.string().optional(),
  })),
  warnings: z.array(z.object({
    code: z.enum([
      "evidence_dropped",
      "claim_softened",
      "claim_strengthened",
      "untranslatable_idiom",
      "term_not_in_glossary",
      "rtl_layout_risk",
    ]),
    location: z.string(),
    description: z.string(),
  })),
  recommendation: z.enum(["accept", "review", "reject"]),
});
```

`recommendation` is the agent's self-assessment; the human still decides.

---

### Data sources

- **Brand voice corpus** — KB tag `brand:voice`. Contains the Cognirise voice guide, do/don't word lists, register examples per profile (`cognirise_partner`, `cognirise_consultant`, `cognirise_executive_brief`).
- **Glossary** — KB tag `brand:glossary`, multilingual (en/ar/tr). Names of products, frameworks, internal capitalization rules, transliteration of client and partner names. Authoritative — the prompt is told to use the glossary entry verbatim when the source term is present.
- **Locale rules** — small static table loaded by the runner: AR is RTL, TR uses Turkish casing rules (dotted/dotless I), AR numerals stay Western (Arabic-Indic only on explicit voice profile request).
- **Source-language detection** — fastText or equivalent heuristic in the runner *before* the LLM call when `sourceLanguage === "auto"`. Prevents wasting an LLM round-trip on a misroute and lets us refuse mixed-language input early with a clear error.
- **Prior accepted rewrites** for this engagement — fetched as few-shot context so the agent stays consistent with terminology choices already accepted on the same engagement.
- **No web search.** Voice and glossary are firm-controlled.

### Side effects

- Writes the run row to `atelier_agent_runs` with `output` containing the full rewrite payload.
- Emits `agent.start`, `agent.complete`, plus `brand.translation.propose` audit events.
- Writes a `pending_rewrite` row keyed by `(artifactKind, artifactId, runId)` to a `atelier_brand_rewrites` table — **does not mutate the artifact body**.
- On Lead acceptance, the route handler (not the agent) replaces the artifact body, emits `brand.translation.accept`, and triggers a Synthesis Critic re-run on the new body.
- On rejection, emits `brand.translation.reject` with the reviewer's reason.
- Notifies the original draft author via `atelier_notifications` whether their draft was rewritten and why.

### Human checkpoints

| Order | Decider | Blocking? | Action |
| --- | --- | --- | --- |
| 1 | Engagement Lead | Yes | Reviews per-section diff, voice score delta, and warnings. Can accept all, accept-some (per section), or reject. |
| 2 | Partner | Yes, only when the artifact is partner-signed or going to a C-suite recipient | Final approval before send. Records justification when overriding `recommendation === "reject"`. |

Both decisions are persisted via `recordDecision` to `atelier_agent_runs.humanDecisions`.

### Prompt outline (`prompts/brand_translator/v1.md`)

1. **Role.** "You rewrite drafts into Cognirise voice in the requested language. You do not change meaning, evidence, numbers, or citations."
2. **Voice profile.** Inject the chosen profile's do/don't list and three short exemplars from the corpus.
3. **Glossary contract.** Inline the relevant glossary slice for the source/target pair. Rule: if a glossary entry exists for a term, use the target entry verbatim. If no entry exists for a proper noun, transliterate per the locale rule and add a `term_not_in_glossary` warning.
4. **Per-section procedure.**
   - If `sections[]` is provided, rewrite section by section preserving section ids and headings.
   - Otherwise, segment the body on Markdown headings.
   - Produce `original` + `rewritten` + a one-line `changeSummary` per section.
5. **Evidence preservation guardrail (the key rule).** Quotes (anything in quotation marks in the source), numeric values, units, percentages, dates, named entities, and any inline citation token (e.g. `[KB-1234]`, footnote markers, URLs) are **copied verbatim** into the rewrite. Every preserved item is listed in `preservedEvidence`. If the agent must drop or alter one (e.g. an idiom that is genuinely untranslatable), it must emit a `warnings[]` entry with code `evidence_dropped` or `untranslatable_idiom` instead of silently changing the meaning.
6. **Claim integrity.** The rewrite may not strengthen or soften any claim. If the source says "may improve" the rewrite says the equivalent of "may improve", not "improves". Suspected drift → `warnings[]` with `claim_softened` / `claim_strengthened`.
7. **Locale rules.** AR output is RTL — wrap the `fullBody` AR output with a `<div dir="rtl">` only if the artifact kind renders HTML. TR casing rules apply.
8. **Voice score.** After rewriting each section, self-score voice fit on a 0–1 scale using the rubric supplied in the prompt (formality / first-person plural / active voice / glossary adherence / register consistency). Aggregate by length-weighted mean for the document score.
9. **Recommendation rule.**
   - `accept` if `voiceScoreAfter ≥ 0.8` AND no warnings of severity-class `evidence_dropped` / `claim_*`.
   - `reject` if any `evidence_dropped` or `claim_*` warning fires.
   - `review` otherwise.
10. **Output schema.** Inline JSON contract with one worked example.

### Success criteria

- On a labeled set of EN→AR, EN→TR, AR→EN drafts, human reviewers prefer the Brand Translator output over the original draft ≥ 80% of the time on a forced-choice voice-fit test.
- Evidence preservation is exact: every preserved quote / number / citation in the source appears verbatim in the rewrite or appears in `warnings[]` with an explicit drop reason. Zero silent drops in the eval set.
- Send-to-client never auto-applies a rewrite without human acceptance.
- Median latency under 30s for a 5-page memo.

### Eval ideas

- `ev_evidence_preservation` — for each fixture, every quoted string / number / inline citation in `draft.body` either appears in `rewrite.fullBody` verbatim or appears as the `text` of a `warnings[]` entry with an `evidence_dropped` / `untranslatable_idiom` code. (Threshold 1.0 on the eval set.)
- `ev_glossary_adherence` — for each glossary term present in the source, the canonical target entry appears in the rewrite. (Threshold ≥ 0.95.)
- `ev_voice_score_improvement` — `voiceScoreAfter ≥ voiceScoreBefore` on every fixture, and the mean uplift is ≥ 0.15. (Threshold 1.0 on the monotonicity check.)
- `ev_language_match` — `detectedSourceLanguage` matches the labeled source language on every fixture; rewrite output language matches `targetLanguage`. (Threshold 1.0.)
- `ev_no_silent_claim_change` — automated paraphrase-strength comparator: no `rewritten` section is rated as a strengthened/softened claim relative to its `original` without a corresponding `warnings[]` entry. (Threshold ≥ 0.95.)

### UI

Generic registry-driven for the agent profile and run list.
**Bespoke addition:** `uiComponent: "/atelier/agents/brand-translator/run/:runId"` rendering a per-section side-by-side diff (original vs. rewritten), a sticky voice-score header (before → after), the warnings panel, and per-section accept / reject buttons that call the Lead-checkpoint route. Rationale: the diff and the per-section accept/reject is the entire user interaction; the generic JSON view would be unusable for a Lead reviewing a 30-section draft.

### Golden fixture

`artifacts/api-server/tests/agents/ag_brand_translator/golden.json` — one EN-source memo, target AR, with embedded numbers, two direct quotes, and one inline KB citation, plus one term that exists in the glossary and one that does not. Exercises evidence preservation, glossary, RTL output, and the `term_not_in_glossary` warning path.
