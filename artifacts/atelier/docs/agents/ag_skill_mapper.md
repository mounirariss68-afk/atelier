# Agent Design Spec — Skill Mapper

> Layer 2 design spec. Builds on the scaffold merged in task #256 (Skill graph + Skill Mapper). A future Layer 3 task implements the registry/runner/UI work below on top of the canonical structure in `AGENT_STANDARD.md`.

---

## What's already built (#256)

The scaffold delivered with task #256 is the foundation this spec completes — do **not** rebuild it.

**Data model (already in `@workspace/db`):**
- `atelier_skills` — taxonomy rows (`slug`, `name`, `kind ∈ {tech, industry, function, language, tool}`, `parentId`, `description`).
- `atelier_person_skills` — one row per (`personType`, `personId`, `skillId`, `source`) with `proficiency` (1–5), `source ∈ {self, partner_attested, evidence_atelier, certification, agent_inferred}`, `evidenceArtifactIds[]`, `evidenceSummary`, `confidence`, `status ∈ {active, dismissed}`, `verifiedByUserId/At`, `proposedByAgentId/At`.
- Hard architectural rule (already enforced in routes): `partner_firm_resource` workers are excluded from the skill graph.

**Routes (already in `artifacts/api-server/src/routes/atelier/skillGraphRoutes.ts`):**
- `GET/POST /roster/skill-graph/skills` — taxonomy CRUD (Partner / Operations).
- `GET /roster/skill-graph/search?q=A + B | A or B` — AND/OR grammar over the graph.
- `GET /roster/people/:id/skills` — grouped by source, with viewer capability flags.
- `POST /roster/people/:id/skills` — manual attest (self / partner_attested / evidence_atelier / certification).
- `POST /roster/people/:id/skills/row/:rowId/{verify,dismiss}` — per-row review of `agent_inferred` proposals only.
- `POST /roster/skill-graph/run` — triggers the rule-based mapper (Engagement Lead / Operations / Partner).

**Runner (already in `skillGraphRoutes.ts:867 runSkillMapper`):**
- Reads five signal classes: deliverable-version authorship, atelier-asset authorship + promotion, engagement leadership/lead/owner + `engagement_access` participation, certifications uploaded as `atelier_person_documents` (`kind="cert"`), and `atelier_agent_runs` provenance against tool-bearing agents.
- Substring-matches signal text against `atelier_skills.name` / `slug`. Sums per-(person, skill) signal weights, maps weight→proficiency (capped 4) and confidence (capped 0.85).
- Skips any (person, skill) that already has a stronger source row OR a dismissed agent_inferred row, and skips any (person, skill, agent_inferred) already on file.
- Inserts proposals as `source="agent_inferred"`, `status="active"` (unverified), with `proposedByAgentId="ag_skill_mapper"`, then writes one `atelier_audit_events` row (`action="skill_mapper.run"`, `actorType="agent"`).

**UI (already in `artifacts/atelier/src/pages/roster/RosterSkillGraph.tsx`):**
- "Run Skill Mapper" button + run summary toast.
- Per-person skill list grouped by source with verify / dismiss controls on `agent_inferred` rows.

**What's missing — the gap this spec closes:**
- No registry entry in `lib/agents/src/registry.ts`.
- No `atelier_agent_runs` lifecycle row (the rule-based runner writes a single audit event but never `agent.start` / `agent.complete`).
- No prompt file (intentional — see "kind" below) but also no documented decision.
- No golden fixture under `artifacts/api-server/tests/agents/ag_skill_mapper/`.
- Not surfaced in `Agents.tsx` / `AgentProfile.tsx` / `AgentRun.tsx` — there is no canonical agent profile, no per-run history view, no input/output schema preview.
- No worker confirmation flow on Roster (the "your skills" self-review checkpoint).
- No downstream wiring into Bench Planner — proposals exist but nothing reads them in a planning context.

---

### Agent: Skill Mapper

- **id:** `ag_skill_mapper`
- **kind:** Rule-based — deterministic. No LLM call. Lives inside the same lifecycle / registry / audit machinery as LLM agents (per AGENT_STANDARD §1). A later v2 may add an LLM critic pass for narrative skills (e.g. "facilitation", "executive presence") that don't surface as substring matches; out of scope here.
- **trigger:**
  - Manual: `POST /roster/skill-graph/run` (Engagement Lead / Operations / Partner) — already wired.
  - Scheduled: nightly tick alongside the existing ledger / utilization ticks in `lib/atelier-agents/ledgerNudges.ts`. Idempotent by construction (existing-row guard).
  - Event: enqueue a debounced run on `deliverable.version.create`, `asset.create`, `asset.promote`, `engagement_access.grant`, `person_document.create` (kind=cert). Coalesce within a 5-minute window per (person) so a burst of edits triggers one run, not five.
- **persona:**
  - Triggered by Engagement Lead / Operations / Partner.
  - Proposals are reviewed by the **subject worker themselves** (self-confirmation) and, secondarily, by Engagement Lead / Operations / Partner who can verify or dismiss on the worker's behalf.

- **inputs (Zod sketch):**
  ```ts
  z.object({
    scope: z.union([
      z.literal("global"),                                       // nightly tick
      z.object({ personType: z.enum(["employee","contractor"]),
                 personId: z.string() }),                        // single-person rerun
      z.object({ engagementId: z.string() }),                    // post-engagement rerun
    ]),
    triggerReason: z.enum(["manual","scheduled","event_debounce"]),
    triggeredByUserId: z.string().nullable(),
  })
  ```
  Plain English: "rebuild proposals across the firm, for one worker, or for everyone touching one engagement."

- **outputs (Zod sketch):**
  ```ts
  z.object({
    proposalsConsidered: z.number().int().nonnegative(),
    proposalsInserted:   z.number().int().nonnegative(),
    proposalsSkipped:    z.number().int().nonnegative(),
    proposals: z.array(z.object({
      personType: z.enum(["employee","contractor"]),
      personId:   z.string(),
      skillId:    z.string(),
      proficiency: z.number().int().min(2).max(4),               // never 5 from inference
      confidence:  z.number().min(0).max(0.85),                  // capped
      evidenceArtifactIds: z.array(z.string()).min(1),
      evidenceSummary: z.string(),
      reasonCodes: z.array(z.enum([
        "deliverable_authorship","asset_authorship","asset_promotion",
        "engagement_owner_lead","engagement_participation",
        "certification","agent_run_provenance",
      ])).min(1),
    })),
  })
  ```
  Plain English: "the new agent_inferred rows landed this run, with the evidence and reason codes that produced each."

- **data sources (read):**
  - `atelier_employees`, `atelier_contractors` (resolution + `userId` link).
  - `atelier_skills` (taxonomy).
  - `atelier_person_skills` (existing-row + dismissal guard).
  - `atelier_deliverable_versions` (authorship).
  - `atelier_assets` (createdBy / promotedBy + tags / abstract).
  - `atelier_engagements` + `atelier_engagement_access` + `atelier_accounts` (industry + function from sector / country / name).
  - `atelier_person_documents` (`kind="cert"`).
  - `atelier_agent_runs` + `atelier_agents` (provenance against tool-bearing agents).
  - **Hard exclusion:** `atelier_partner_firm_resources` — never written to, never proposed for.

- **side effects (write):**
  - `atelier_person_skills` — inserts `source="agent_inferred"`, `status="active"`, `proposedByAgentId="ag_skill_mapper"`. Never writes any other source. Never auto-verifies (`verifiedByUserId` stays null until a human acts).
  - `atelier_agent_runs` — one row per invocation through the shared `runAgent(...)` lifecycle helper (`status: running → succeeded/failed`, `output` = the Zod payload above, `confidence` = `green` if proposalsInserted > 0 else `amber`, `cost = 0`).
  - `atelier_audit_events` — `agent.start`, `agent.complete` (or `agent.error`) emitted by `runAgent`; the existing domain event `skill_mapper.run` is preserved for back-compat.
  - **No** `atelier_notifications`. Worker confirmation is pull-based via the Roster surface (see "human checkpoints") to avoid a daily notification spam loop on a nightly tick.
  - **No** writes to any other domain table.

- **human checkpoints:**
  1. **Worker confirms own skills** — *blocking for graph promotion.* The subject worker sees their `agent_inferred` rows in `RosterSkillGraph.tsx` ("Pending review" group) and chooses Verify (promote to `evidence_atelier` with `verifiedByUserId = self`, capping proficiency at the inferred value) / Edit proficiency (1–5) / Dismiss (sets `status="dismissed"`, locks the (person, skill) tuple from re-proposal). Decider: subject worker. Until the worker acts, the row is visible but flagged "unverified inference" anywhere it's read by downstream agents.
  2. **Verifier override** — *non-blocking.* Engagement Lead / Operations / Partner may verify or dismiss on the worker's behalf via the existing `/row/:rowId/{verify,dismiss}` endpoints when a worker is offboarded or unresponsive.

- **prompt outline:** N/A (rule-based). The runner ships a registry-side `decisionLog` field describing the five signal classes + weight rules, so the Agent Profile UI can render the rule set in lieu of a prompt.

- **success criteria (production):**
  - Mean proposals-per-employee ≥ 3 for any employee with ≥ 1 month of activity.
  - Worker self-review rate ≥ 60% within 14 days of proposal (verified or dismissed).
  - False-positive rate (dismiss / total reviewed) ≤ 25% — measured weekly off `atelier_person_skills` deltas; a higher rate triggers a weight retune.
  - Bench Planner queries (see below) return non-empty results for any `kind="industry"` skill with ≥ 5 active employees firm-wide.

- **eval ideas:**
  1. **Shape eval (golden fixture):** input = `{ scope: "global", triggerReason: "manual", triggeredByUserId: null }`. Validate output against `outputSchema`; assert every proposal carries ≥ 1 `evidenceArtifactId` and one of the seven `reasonCodes`.
  2. **Determinism eval:** same input twice in a row → second run yields `proposalsInserted == 0`, `proposalsSkipped >= first.proposalsInserted`. Proves idempotency.
  3. **Exclusion eval:** seeded fixture with one `partner_firm_resource` linked as a deliverable author — assert zero proposals reference that worker.
  4. **Dismiss-stickiness eval:** dismiss a proposed (person, skill); rerun the mapper; assert it is not re-proposed.

- **UI:** **Hybrid.** Generic registry-driven Agent Profile + Run history (so it shows up in the Agents list with model: `n/a (rule-based)`, kind: `Rule-based`, signal-class table rendered from `decisionLog`). The per-worker review surface stays bespoke — `uiComponent: "/atelier/roster/skill-graph"` with rationale: "Reviewing proposals belongs in the worker's own Roster page, not in a generic agent run shell."

---

## How this powers Bench Planner

Bench Planner (downstream Layer 2 task) needs a query like *"who can lead a 6-week telco regulatory engagement in Lagos starting May 26, with an English+French requirement?"* The Skill Mapper output is the **only** structured input that makes that query answerable beyond what workers self-report.

Concretely, Bench Planner reads `atelier_person_skills` filtered to `status="active"` with the following promotion rules:

| Source                                | Trust weight | Use in match score |
| ------------------------------------- | ------------ | ------------------ |
| `self` (unverified)                   | 0.5          | tiebreaker only    |
| `partner_attested` / `evidence_atelier` / `certification` | 1.0 | full weight        |
| `agent_inferred` (unreviewed)         | 0.4 × `confidence` | tiebreaker only |
| `agent_inferred` (verified by worker → promoted to `evidence_atelier`) | 1.0 | full weight |
| `agent_inferred` (dismissed)          | 0            | excluded           |

This means:
- Bench Planner can **rank** candidates the moment the Skill Mapper runs (cold-start coverage from day one).
- A worker's own confirmation **promotes** a tiebreaker into a full match — preserving the human-in-the-loop guarantee from AGENT_STANDARD §4.
- Dismissal is honoured permanently; the mapper never re-proposes it.

The handoff is contractual: Bench Planner queries `atelier_person_skills` directly. Skill Mapper does not push, notify, or call Bench Planner — it just keeps the table populated and audited.
