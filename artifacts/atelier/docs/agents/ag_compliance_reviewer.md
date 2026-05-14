# Agent Design Spec — Compliance Reviewer

> Layer 2 design spec. Implementation is a separate Layer 3 task.
> Conforms to `artifacts/atelier/AGENT_STANDARD.md` §10.

### Agent: Compliance Reviewer

- **id:** `ag_compliance_reviewer`
- **kind:** Analyst (read-mostly; emits a verdict + matrix; never edits the deliverable)
- **trigger:**
  - Manual button on a Proposal or external Deliverable ("Run Compliance Review").
  - Auto-invoked by the **Send-to-client** flow as a blocking pre-flight check on any artifact in scope (Proposal, SOW, Charter, external memo). A `red` verdict blocks send until overridden by a Partner.
- **persona:** Engagement Lead requests it; Partner is the authority that can override `red` and unlock send.
- **status target:** `registered` initially (catalog stub today → wire runner + prompt + route + fixture in the implementation task), `mvp` once a passing eval lands.

---

### Relationship to Synthesis Critic

Compliance Reviewer and Synthesis Critic are **complementary quality gates**, not duplicates. Both run before client send; both can block. They look at different things:

| Dimension | Synthesis Critic | Compliance Reviewer |
| --- | --- | --- |
| Question answered | "Is this argument sound and on-hypothesis?" | "Does this satisfy the regulatory / contractual / firm-policy rules that apply?" |
| Lens | Pyramid principle, MECE, evidence coverage vs. hypothesis tree | RFP requirements, regulatory frameworks (KSA / GCC / global), firm policy clauses |
| Output unit | Issues + readiness (`green` / `amber` / `red`) | Per-rule rows (`green` / `red`) + overall verdict |
| Verdict scale | Three-state | Binary per row, binary overall (no amber — partial evidence is `red`) |
| Severity model | `low` / `med` / `high` per issue | Severity belongs to the rule itself (`must` / `should` / `informational`); a single unmet `must` flips overall to `red` |
| Edits the doc? | No — flags only | No — flags only |
| Failure surface | Pyramid / MECE / weak so-what / off-hypothesis | Missing evidence for a stated requirement, prohibited language, missing required artifact (e.g. NDA reference, data-residency clause) |

Both must pass for an artifact to leave the firm. Send-to-client wires them in parallel and blocks until **both** are at least `green` (Synthesis Critic also accepts `amber` with a documented Lead override; Compliance Reviewer's `red` requires a Partner override and a recorded justification).

---

### Inputs

**Plain English.** The artifact under review, the rule set to score it against, and the engagement context that tells us *which* rules apply.

```ts
inputSchema: z.object({
  artifact: z.object({
    kind: z.enum(["proposal", "sow", "charter", "deliverable", "memo"]),
    id: z.string(),
    body: z.string().min(1),                 // markdown or HTML
    sections: z.array(z.object({
      id: z.string(),
      heading: z.string(),
      content: z.string(),
    })).optional(),                          // pre-parsed; falls back to whole body
  }),
  rfpRequirements: z.array(z.object({         // optional; required when kind === "proposal"
    id: z.string(),
    requirement: z.string(),
    severity: z.enum(["must", "should", "informational"]),
    sourceCitation: z.string().optional(),    // page / clause in the RFP
  })).optional(),
  jurisdictions: z.array(z.enum(["KSA", "UAE", "GCC", "EU", "US", "GLOBAL"])).min(1),
  engagementId: z.string(),
  industryTags: z.array(z.string()).optional(), // e.g. ["financial_services","healthcare"]
});
```

### Outputs

**Plain English.** A row-per-rule matrix with green/red + cited evidence, an overall verdict, the list of unmet `must` rules, and the source citations for the rule set itself so a reviewer can audit *why* a rule applied.

```ts
outputSchema: z.object({
  matrix: z.array(z.object({
    ruleId: z.string(),
    requirement: z.string(),
    source: z.enum(["rfp", "firm_policy", "regulation", "kb"]),
    sourceCitation: z.string(),               // "RFP §4.2" / "AICo Policy DR-04" / "PDPL Art. 12"
    severity: z.enum(["must", "should", "informational"]),
    status: z.enum(["green", "red"]),
    evidence: z.array(z.object({
      sectionId: z.string().optional(),
      sectionHeading: z.string().optional(),
      quote: z.string(),                      // verbatim excerpt
    })),
    rationale: z.string(),                    // one sentence per row
  })),
  overall: z.enum(["green", "red"]),
  unmet: z.array(z.string()),                 // ruleIds with status === "red" AND severity === "must"
  amberShouldUnmet: z.array(z.string()),      // ruleIds where severity === "should" and status === "red"
  jurisdictions: z.array(z.string()),
  ruleSetVersion: z.string(),                 // hash of the rule set used, for replay
});
```

Note: `overall` is **binary**, matching the existing prompt's contract. A
single unmet `must` rule flips overall to `red`. Unmet `should` rules
surface as `amberShouldUnmet` for reviewer attention but do not flip
overall.

---

### Data sources

- **Firm policy** — knowledge corpus tagged `policy:firm`, e.g. data-residency, confidentiality, AI-use disclosure, sub-contractor approval. Authoritative; versioned.
- **Regulatory frameworks** — knowledge corpus tagged `policy:regulation`, scoped by `jurisdictions`:
  - KSA: PDPL, ZATCA invoicing, SDAIA AI ethics, NCA cybersecurity controls.
  - UAE: PDPL, Central Bank guidelines (where industry == financial_services), DHA / DoH for healthcare.
  - GCC umbrella rules where they exist.
  - EU: GDPR, AI Act tier classification (when EU clients in scope).
  - US: industry-conditional (HIPAA for healthcare, SOX for public-co audit support).
- **RFP requirements** — passed in via `rfpRequirements` when present; treated as `source: "rfp"` rows in the matrix. Already the input contract of the existing v1 prompt.
- **Web search** — fallback only, when a regulation citation is requested but not in the KB. Any web-sourced rule must carry its URL in `sourceCitation` and is downgraded to `informational` until a human promotes it.
- **Prior runs** — the most recent Compliance Reviewer run on the same artifact id is fetched so the matrix can show *what changed since last review* (not in v1 output schema; reserved for v2).

Rules are **sourced, not invented**. The runner assembles the candidate rule set deterministically (firm policy ∪ jurisdictional regulations ∪ industry overlays ∪ RFP requirements), hands it to the LLM, and the LLM only decides green/red + evidence per pre-supplied rule. The LLM does not author rules.

### Side effects

- Writes the run row to `atelier_agent_runs` (standard).
- Emits `agent.start`, `agent.complete`, plus `compliance.review.create` audit events to `atelier_audit_events`.
- Writes the verdict + matrix into a new `atelier_compliance_reviews` table keyed by `(artifactKind, artifactId, runId)` so the Send-to-client flow can read the latest verdict without re-running the agent.
- On `overall === "red"`, posts a Pane A item ("Compliance review red — N unmet must-rules on <artifact>") routed to the Engagement Lead, with deep-link to the run.
- Notifies the Partner via `atelier_notifications` only when a Lead requests an override.
- Does **not** mutate the artifact body. Ever.

### Human checkpoints

| Order | Decider | Blocking? | Action |
| --- | --- | --- | --- |
| 1 | Engagement Lead | Yes | Reviews the matrix. May ask the originating writer agent to rewrite, or open a Partner override request. |
| 2 | Partner | Yes, only when overall is `red` | Sole authority to override `red`. Override is recorded as a `compliance.override` audit event with required justification text and is shown alongside the artifact in the client send manifest. |

`recordDecision` writes both checkpoints into `atelier_agent_runs.humanDecisions` per the standard.

### Prompt outline (`prompts/compliance_reviewer/v2.md`)

The existing `v1.md` covers the RFP-only case. The implementation task should bump to `v2.md` to accommodate the broader rule-set input. Sections:

1. **Role + binary contract.** Restates the no-yellow rule and the "any unmet `must` ⇒ overall red" guardrail.
2. **Rule-set framing.** Tells the model the rules are pre-supplied; it must not author new rules. Each input rule carries `source` and `sourceCitation` which must be echoed verbatim into the matrix row.
3. **Per-row procedure.** For each rule, scan the artifact (sections preferred, full body fallback), pick the most specific verbatim quote that satisfies the rule, and decide green/red. Partial evidence is `red`.
4. **Evidence rules.** Quote, don't paraphrase. If the same evidence covers multiple rules, repeat it. Empty `evidence[]` is only allowed on a `red` row.
5. **Output schema.** Inline the Zod-mirrored JSON contract with an example.
6. **Hard rules.** No yellow. No invented citations. No edits. Refuse to score rules whose `sourceCitation` is missing.

### Success criteria

- On a representative proposal with 30+ requirements, the matrix reproduces the human reviewer's verdict on each row at ≥ 90% agreement.
- Zero hallucinated regulation citations across the eval set (every `sourceCitation` traces back to an input rule or KB doc).
- Send-to-client never lets a `red` artifact through without a recorded Partner override.
- Median end-to-end latency under 45s for a 20-page proposal with 30 rules.

### Eval ideas

- `ev_no_yellow` — output schema validation: `overall` ∈ {green, red}; no row carries any value other than green/red. (Threshold 1.0.)
- `ev_unmet_consistency` — `unmet` exactly equals `{ruleId | status==="red" ∧ severity==="must"}`. (Threshold 1.0.)
- `ev_citation_traceback` — every `matrix[*].sourceCitation` is present in the input rule set or in KB chunks fetched during the run. (Threshold 1.0.)
- `ev_evidence_quote_in_body` — every non-empty `evidence[].quote` appears as a substring of the artifact body. (Threshold ≥ 0.95 to allow whitespace/normalization slack.)
- `ev_overall_agreement` — on a labeled fixture set, agreement with the human verdict per row ≥ 0.9.

### UI

Generic registry-driven for the run list and profile.
**Bespoke addition:** `uiComponent: "/atelier/agents/compliance-reviewer/run/:runId"` rendering the matrix as a table (rule | source | severity | status | evidence | rationale) with red rows pinned to the top and an "Open in artifact" deep-link per row. Rationale: the matrix is the entire point of the review and the generic JSON tree view buries it.

### Golden fixture

`artifacts/api-server/tests/agents/ag_compliance_reviewer/golden.json` — one realistic proposal with mixed RFP + KSA PDPL + firm policy rules, including at least one unmet `must` row to exercise the red path.
