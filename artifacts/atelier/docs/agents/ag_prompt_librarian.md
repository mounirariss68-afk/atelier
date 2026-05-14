# Agent Design Spec — Prompt Librarian

> Layer 2 spec. Follows the template in `artifacts/atelier/AGENT_STANDARD.md` §10.
> Implementation is a separate Layer 3 task.

### Agent: Prompt Librarian
- **id:** `ag_prompt_librarian`
- **kind:** Rule-based (deterministic) — no LLM call. Lives in the same
  lifecycle so it shows up alongside other agents in the audit log and
  Agents page.
- **trigger:**
  - scheduled: nightly cron (02:00 GST) scans `prompts/` on disk and
    `atelier_agent_runs` to refresh prompt usage / health
  - manual: Atelier Lead can click "Re-index prompts" on the prompt
    library admin page
  - event-driven: a successful merge to `prompts/<agent_id>/v<n>.md`
    triggers a single-prompt re-index (via a post-merge hook reading
    the same registry)
- **persona:** Atelier Lead is the decider. Other agent owners (each
  agent registry entry has an `owner`) are the secondary audience for
  health / drift notifications about their own prompts.

### Inputs
Plain English: a scope (one prompt, one agent, or all prompts) plus a
mode (full re-index vs. incremental). No free-text input.

```ts
z.object({
  scope: z.object({
    agentId: z.string().optional(),         // restrict to one agent's prompts
    promptPath: z.string().optional(),      // restrict to a single file
  }).default({}),
  mode: z.enum(["full", "incremental"]).default("incremental"),
})
```

### Outputs
Plain English: an inventory of every prompt (id, version, status,
last-used, run count, drift flags, dependent agent), plus a list of
proposed actions (deprecate, promote, fork).

```ts
z.object({
  prompts: z.array(z.object({
    promptPath: z.string(),                 // e.g. "prompts/pursuit_scout/v2.md"
    agentId: z.string(),
    version: z.number().int().min(1),
    status: z.enum(["active", "deprecated", "draft", "orphan"]),
    sha256: z.string(),                     // content hash
    lastUsedAt: z.string().datetime().nullable(),
    runCount30d: z.number().int().min(0),
    successRate30d: z.number().min(0).max(1).nullable(),
    averageCostUsd: z.number().min(0).nullable(),
    dependentAgents: z.array(z.string()),   // registry ids referencing this file
    drift: z.array(z.enum([
      "schema_mismatch",                    // prompt JSON shape ≠ outputSchema
      "registry_orphan",                    // file exists, no registry entry references it
      "registry_dangling",                  // registry references missing file
      "stale_unused",                       // active but 0 runs in 30d
      "duplicate_content",                  // sha256 matches another active prompt
    ])),
  })),
  proposedActions: z.array(z.object({
    action: z.enum(["deprecate", "promote_draft", "delete_orphan", "merge_duplicate"]),
    promptPath: z.string(),
    rationale: z.string(),
  })),
  confidence: z.enum(["green", "amber", "red"]),
})
```

### Data sources
- Filesystem: `artifacts/api-server/prompts/**/*.md` (read via the existing
  `loader.ts` so resolution rules stay shared).
- `lib/agents/src/registry.ts` (in-process import) — to know which prompts
  any registry entry references via `systemPromptRef`.
- `atelier_agent_runs` for `lastUsedAt`, `runCount30d`, `successRate30d`,
  `averageCostUsd` (joined on `agentId` + the registry entry's prompt).

No knowledge corpora, no web — this agent is a deterministic indexer.

### Side effects
- Writes one row to `atelier_agent_runs` (kind = rule-based).
- Upserts one row per prompt to `atelier_prompt_index` (new domain table
  owned by this agent; columns mirror the `prompts[*]` output).
- Emits `prompt.indexed { promptPath, drift[] }` audit events when drift
  changes from the prior run.
- Emits one Pane A item per `proposedActions[*]` whose action is not
  `delete_orphan`, addressed to the agent owner. `delete_orphan` actions
  go to the Atelier Lead.
- Does **not** delete or rewrite any prompt file. All proposed actions
  require a human checkpoint.

### Human checkpoints
1. **Atelier Lead** (blocking) for any `delete_orphan` or
   `merge_duplicate` action. Approval results in a separate PR drafted
   by the implementation surface — the agent itself never mutates files.
2. **Agent owner** (blocking) for any `deprecate` or `promote_draft`
   action against a prompt their agent depends on.

### Prompt outline
N/A — rule-based. The "prompt outline" is replaced by the deterministic
algorithm:
1. Walk `prompts/` and compute `sha256` per file.
2. Build the registry → prompt graph; flag `registry_orphan`,
   `registry_dangling`, `duplicate_content`.
3. Pull 30-day run stats per `(agentId, promptVersion)` from
   `atelier_agent_runs`; compute usage / success / cost.
4. Apply schema-drift check: parse the YAML frontmatter `output_schema`
   block (where present) and compare its top-level keys against the
   agent's `outputSchema` Zod shape; mismatch → `schema_mismatch`.
5. Derive `proposedActions` from drift codes by a fixed rule table
   documented in the runner.
6. Set `confidence`: red if any `registry_dangling`; amber if any
   `schema_mismatch`; green otherwise.

### Success criteria
- 100 % of prompts on disk and 100 % of registry entries are accounted
  for in the index after each run (no silent skips).
- Drift codes are stable: re-running with `mode = full` against an
  unchanged tree produces an identical `prompts[]` output (sorted).
- Median run latency under 5 s for the full library.

### Eval ideas
- Determinism eval: run twice on the same fixture filesystem; outputs
  hash to the same value.
- Drift eval: a fixture with a known `registry_dangling` file produces
  exactly one entry with that drift code and the run's `confidence` is
  red.
- Coverage eval: `prompts.length` ≥ count of `*.md` files under
  `prompts/`; `proposedActions.length` ≥ number of seeded duplicates.

### UI
Bespoke. `uiComponent: "/atelier/prompts"`.
Rationale: a sortable table of prompts with drift filters, side-by-side
diff for `merge_duplicate`, and one-click "open dependent agents" needs
its own surface. The Pane A items use the registry-driven card.

### Overlap with existing agents
- **Atelier Curator** promotes _domain artefacts_ (case studies, POVs,
  playbooks, themes) into reusable IP. Prompt Librarian is the
  prompt-shaped sibling: it covers the one IP class Curator does
  not — the prompts themselves. The two never write to each other's
  domain tables; both surface their proposals through Pane A.
- **Knowledge Concierge** does not consume `atelier_prompt_index` at
  query time, but the index is exposed via a `prompts.search` tool so
  other agents (e.g. a future Agent Architect refresh) can look up
  reusable prompt patterns deterministically rather than via the LLM.
