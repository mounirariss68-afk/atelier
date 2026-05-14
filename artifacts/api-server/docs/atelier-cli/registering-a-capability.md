# Registering a CLI capability

> Audience: anyone adding a new Atelier API route, agent, or
> assistant-callable verb. This is the canonical pattern — if you
> deviate, the lint script (`pnpm test:cli-catalog`) will fail the
> build and tell you exactly what to add.

## Why this exists

Before Task #339 the CLI catalog was a hand-curated list maintained
separately from the routes and agents it was supposed to mirror. Every
new feature required a developer to remember to add a second entry,
and nothing failed if they forgot — which is how Tasks #332 and #338
shipped with partial parity. The framework below makes the catalog
**derived from the code**: register a route or agent, and the
assistant picks it up at boot.

## Routes — `defineRouteCapability`

Use this for every Atelier API endpoint that should be assistant-
callable (writes, lookups, list endpoints exposed to the slash
palette). The same `run` function powers both the Express handler and
the CLI invocation, so the catalog can never drift from what the
endpoint actually does.

```ts
import { Router } from "express";
import { defineRouteCapability } from "../../lib/atelier-cli/route-registration.js";

const router = Router();

defineRouteCapability(router, {
  method: "post",
  path: "/engagements/:engId/raid",
  capability: {
    id: "raid.add",
    schemaVersion: CATALOG_SCHEMA_VERSION,
    module: "raid",
    toolName: "raid_add",
    description: "Add a RAID item to an engagement.",
    slashAliases: { en: ["/raid", "/raid-add"], fr: ["/raid"] },
    representativePrompts: {
      en: ["Add an amber risk to my engagement.", "Log a dependency on the kickoff workshop."],
      ar: ["أضف خطرًا متوسطًا إلى ارتباطي."],
    },
    inputSchema: {
      type: "object",
      properties: {
        engId: { type: "string" },
        kind: { enum: ["risk", "assumption", "issue", "dependency"] },
        severity: { enum: ["red", "amber", "green"] },
        description: { type: "string", maxLength: 500 },
      },
      required: ["engId", "kind", "severity", "description"],
    },
    isWrite: true,
    irreversible: false,
    requiredRoles: ["founding_partner", "partner", "senior_manager", "manager", "associate"],
    surfaceOn: ["engagement_dashboard"],
    followUpTriggers: ["raid.list"],
    twoPhaseConfirm: true,
    outboundChannel: null,
    resultCard: "raid_item",
  },
  async run(input, ctx) {
    // ...do the work; return { ok: true, data: {...} } or a confirmation envelope.
  },
});

export default router;
```

What you get for free:

- The route is mounted at the path you declared.
- A capability with the right module, perimeter, and result-card hint
  appears in the slash palette for users in the listed roles.
- The input schema is hashed at registration time. If the shape
  changes later, saved/pinned prompts referencing the old hash surface
  a "review before running" warning instead of silently re-executing.
- The lint script considers this route "covered" and the coverage test
  in `tests/cli-catalog/run.ts` passes.

### Opting out

A small set of routes have no assistant surface (health probes, file
uploads, SSE streams that aren't tool-shaped). Mark them on the line
immediately above the `router.METHOD(...)` call:

```ts
// @cli-skip: SSE stream — handshake is opaque to the assistant.
router.get("/cli/turn/stream", ...);
```

## Agents — automatic

Every entry in `lib/agents/src/registry.ts` is auto-registered as a
capability. Adding a new agent therefore requires no extra work — when
your `defineAgent({...})` call lands, a `run_<agent_id>` tool appears
in the assistant.

The capability runs through the orchestrator's two-phase confirm so
the user reviews input + human checkpoints before the agent fires;
the actual `runAgent(...)` call still happens inside the existing
agent route so budget enforcement, audit events, and `atelier_agent_runs`
bookkeeping stay in one place.

If your agent should be invocable by a narrower set of personas than
the default (`founding_partner` … `associate`), edit
`AGENT_INVOCABLE_ROLES` in `agent-capabilities.ts` and add a per-agent
override.

## Schema-drift versioning

`defineCapability` (and therefore `defineRouteCapability`) hashes the
input schema at registration time and stores it on the entry. Saved
prompts that reference an older hash get a `pinnedPromptDrift(...)`
warning surfaced to the UI — they are *not* auto-replayed against the
new shape.

When you intentionally change a capability's input shape, no manual
bump is required: the new hash is computed automatically. If the
shape change is breaking (e.g. you removed a required field that
saved prompts relied on), add a one-line migration note next to the
schema so reviewers can see why pinned prompts will start warning.

## Pure-CLI verbs

For a verb that has no Express route counterpart (free-text resolvers,
palette listing, mock destructive operations) use the lower-level
`defineCapability` directly in `cli-only-capabilities.ts` with
`source: "cli-only"`. The lint script does not require a route for
these.
