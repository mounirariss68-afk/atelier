/**
 * Task #339 — single boot-time entry point for the capability catalog.
 *
 * Imported once by the orchestrator (`./index.ts`). Side-effect loads
 * every capability source in a deterministic order:
 *
 *   1. CLI-only entries (help, lookup, mock high-blast-radius writes).
 *   2. Attachment + rubric capabilities (Task #334 read+ingest verbs).
 *   3. Agent capabilities — auto-derived from `@workspace/agents`.
 *
 * Once `defineRouteCapability` migrations land in downstream tasks,
 * the route files themselves will be imported here too. They cannot
 * be discovered automatically because the route module graph is
 * traversed by the Express router, not by this file.
 */

import "./cli-only-capabilities.js";
import "./cli-only-capabilities-reads.js";
import "./attachment-capabilities.js";
import "./undo.js";
import "./parity-capabilities.js";
import { registerAgentCapabilities } from "./agent-capabilities.js";

let bootstrapped = false;

/**
 * Idempotent bootstrap. The orchestrator invokes this implicitly via
 * the side-effect imports above; tests that reset the catalog call it
 * explicitly to repopulate.
 */
export function bootstrapCapabilities(): void {
  if (bootstrapped) return;
  registerAgentCapabilities();
  bootstrapped = true;
}

bootstrapCapabilities();
