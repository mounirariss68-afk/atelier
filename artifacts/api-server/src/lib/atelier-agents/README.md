# Atelier agents — implementation guide

> 🟡 **Read [`artifacts/atelier/AGENT_STANDARD.md`](../../../../atelier/AGENT_STANDARD.md)
> first.** It is the source of truth for what an Atelier agent is. This
> README is a pointer to the implementation surfaces.

## Lifecycle (cheat sheet)

```
                         ┌────────────────────────────────────────┐
trigger (route handler)  │  runAgent({ agentId, input, target })  │
        │                │                                        │
        ▼                │  1. validate input  (registry.zod)     │
   runAgent(...)  ─────► │  2. startRun       (atelier_agent_runs)│
                         │  3. execute(ctx)   ← your code         │
                         │     ├─ call Claude (callClaudeJson)    │
                         │     ├─ persist to domain tables        │
                         │     └─ optionally notify               │
                         │  4. validate output (registry.zod)     │
                         │  5. completeRun    (atelier_audit_events)
                         └────────────────────────────────────────┘
```

## Files in this directory

| File                          | Purpose                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `runAgent.ts`                 | The shared lifecycle helper. Use this for new agents.                       |
| `runner.ts`                   | Per-agent `run<X>` hooks. Each loads its prompt, calls Claude, persists.    |
| `loader.ts`                   | Resolves prompt files at `prompts/<agent_id>/v<n>.md`.                      |
| `pipeline.ts`                 | Sales-pipeline constants (stages, defaults, derive helpers).                |
| `pricing-strategist-tools.ts` | Tool-contract stubs for Pricing Strategist (knowledge / rules / rate card). |
| `ledgerNudges.ts`             | Scheduler ticks for Time Steward, Burn Sentinel, Utilization snapshots.    |

## Adding a new agent — copy the Pursuit Scout

1. Add a `defineAgent({...})` entry to `lib/agents/src/registry.ts` with
   real Zod input + output schemas.
2. Drop the system prompt at `artifacts/api-server/prompts/<agent_id>/v1.md`.
3. Export a `run<AgentName>` from `runner.ts` that calls `runAgent(...)`.
4. Wire a route in `src/routes/atelier/agentRoutes.ts` (or a domain route).
5. Confirm the agent appears in `Agents.tsx` (it should — UI is registry-driven).
6. Add a fixture at `artifacts/api-server/tests/agents/<agent_id>/golden.json`.
7. Run `pnpm --filter @workspace/api-server test:agents` to validate fixtures.

## Lifecycle primitives (low-level)

These are exported from `runner.ts` and composed by `runAgent.ts`. Use
them directly only when you need custom multi-step orchestration:

- `startRun({ ... }) → runId`
- `progressRun(runId, pct, message, step?)`
- `completeRun({ runId, output, ... })`
- `failRun(runId, err, ctx)`
- `recordDecision({ runId, decision, ... })` — writes a human approval
- `applyCitationGuardrail(facts)` — strips/downgrades unsourced facts
