/**
 * Task #339 — `defineRouteCapability`: colocate a CLI capability with
 * the Express route that implements it.
 *
 * Why: in #332/#338 the CLI catalog drifted out of parity with the UI
 * because every new route required a developer to remember to add a
 * second hand-written entry in `capability-seed.ts`. This helper
 * removes the second entry — a single declaration both registers the
 * route handler with Express AND surfaces the capability to the CLI
 * orchestrator with the same JSON-schema input contract.
 *
 * Pattern:
 *
 *   defineRouteCapability(router, {
 *     method: "post",
 *     path: "/engagements/:engId/raid",
 *     capability: { id: "raid.add", module: "raid", ... },
 *     run: async (input, ctx) => { ... return { ok, data, ... } },
 *     toHttp: (result, res) => res.status(...).json(result.data),
 *   });
 *
 * The `run` function is the single source of truth — invoked both by
 * the Express handler (with `req.body`/`req.params` merged into
 * `input`) and by the CLI orchestrator (with the model's tool-call
 * arguments). That guarantees the catalog can never drift from what
 * the route actually does, because they're literally the same code.
 *
 * Routes that legitimately have no CLI surface (health probes, SSE
 * streams, file uploads) opt out with the `// @cli-skip: <reason>`
 * marker comment recognised by the lint script — see
 * `scripts/atelier-lint-routes.ts`.
 */

import type { Request, Response, Router } from "express";
import {
  defineCapability,
  type CapabilityEntry,
  type CapabilityInput,
} from "./capability-catalog.js";
import type { ToolContext, ToolResult, CliPersona } from "./index.js";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * Adapter that pulls a `CliPersona` off the Express request. Routes
 * use the existing `req.atelierPersona` augmentation; we re-declare
 * here so the helper has no hard dep on the route module.
 */
function personaFromReq(req: Request): CliPersona | null {
  const p = (req as unknown as { atelierPersona?: CliPersona }).atelierPersona;
  if (!p) return null;
  return p;
}

/**
 * Build the `input` object the `run` function will receive when called
 * over HTTP. Default merges `params + query + body` with body winning.
 * Override per-route for non-trivial cases (file uploads, multi-part
 * forms, SSE handshakes).
 */
export type HttpInputBuilder = (req: Request) => Record<string, unknown>;

const defaultHttpInputBuilder: HttpInputBuilder = (req) => ({
  ...(req.params as Record<string, unknown>),
  ...(typeof req.query === "object" && req.query ? (req.query as Record<string, unknown>) : {}),
  ...(typeof req.body === "object" && req.body ? (req.body as Record<string, unknown>) : {}),
});

/**
 * Translate a `ToolResult` into an HTTP response. Default matches the
 * convention used across the existing Atelier routes:
 *   - ok=true  → 200 + `data`
 *   - confirmation present → 202 + envelope (preview phase)
 *   - disambiguation present → 200 + envelope
 *   - ok=false → 400 + `{error}` (or 404 for not_found)
 */
export type HttpResponder = (result: ToolResult, res: Response) => void;

const defaultHttpResponder: HttpResponder = (result, res) => {
  if (result.disambiguation) {
    res.status(200).json({ disambiguation: result.disambiguation, data: result.data ?? null });
    return;
  }
  if (result.confirmation) {
    res.status(202).json({ confirmation: result.confirmation, data: result.data ?? null });
    return;
  }
  if (!result.ok) {
    const status = result.errorCode === "not_found" ? 404
      : result.errorCode === "forbidden" ? 403
      : result.errorCode === "rate_limited" ? 429
      : 400;
    res.status(status).json({
      error: result.errorCode ?? "error",
      message: result.errorMessage ?? null,
      data: result.data ?? null,
    });
    return;
  }
  res.status(200).json(result.data ?? { ok: true });
};

export interface DefineRouteCapabilityArgs {
  /** HTTP verb. */
  method: HttpMethod;
  /** Express path pattern (mounted under `/api/atelier`). */
  path: string;
  /**
   * Capability metadata. Note `run` is *not* on the capability — it's
   * the top-level `run` so the route + CLI share the same function.
   * `toolName`, `id`, `module`, `description`, schema, etc. all live
   * here.
   */
  capability: Omit<CapabilityInput, "run" | "source">;
  /** Single source of truth for the operation. */
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
  /** Override for HTTP request → input mapping. */
  buildInput?: HttpInputBuilder;
  /** Override for ToolResult → HTTP response. */
  toHttp?: HttpResponder;
  /**
   * Express middlewares to chain *before* the handler runs (auth,
   * persona resolution). Defaults to none — most callers pass the
   * shared `ensurePersona`-style middleware via `router.use(...)`.
   */
  before?: Array<(req: Request, res: Response, next: () => void) => unknown>;
}

/**
 * Register a route + capability in one declaration. Returns the
 * registered `CapabilityEntry` so callers can reference the canonical
 * id/hash in tests + audit payloads.
 */
export function defineRouteCapability(
  router: Router,
  args: DefineRouteCapabilityArgs,
): CapabilityEntry {
  const buildInput = args.buildInput ?? defaultHttpInputBuilder;
  const respond = args.toHttp ?? defaultHttpResponder;

  // 1. Register the capability against the catalog. The `source: "route"`
  //    tag lets the lint/coverage test verify every route file goes
  //    through this helper rather than ad-hoc defineCapability().
  const entry = defineCapability({
    ...args.capability,
    source: "route",
    run: args.run,
  });

  // 2. Mount the Express handler. The handler builds the `input`,
  //    constructs a synthetic `ToolContext` (no real CLI turn — we
  //    fabricate ids for audit continuity) and forwards to the same
  //    `run` function the orchestrator invokes.
  const middlewares = args.before ?? [];
  const handler = async (req: Request, res: Response): Promise<void> => {
    const persona = personaFromReq(req);
    if (!persona) {
      res.status(401).json({ error: "no-persona" });
      return;
    }
    const input = buildInput(req);
    const ctx: ToolContext = {
      persona,
      // The HTTP path is not a CLI turn; tag synthetic ids so audit
      // rows make it clear how the call entered the system.
      turnId: `http_${Date.now().toString(36)}`,
      sessionId: `http_${persona.id}`,
      stepIdx: 0,
    };
    try {
      const result = await args.run(input, ctx);
      respond(result, res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[route-capability:${entry.id}]`, err);
      res.status(500).json({
        error: "internal",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // The `// @cli-capability: <id>` marker line is what the lint script
  // greps for; we emit it in a comment-equivalent property below
  // alongside the actual mount call so editing tools can find it.
  const mounter = router[args.method].bind(router);
  if (middlewares.length > 0) {
    mounter(args.path, ...middlewares, handler);
  } else {
    mounter(args.path, handler);
  }
  return entry;
}
