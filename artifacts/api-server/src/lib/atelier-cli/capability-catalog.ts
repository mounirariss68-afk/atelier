/**
 * Task #332 — Atelier CLI capability catalog.
 *
 * Single declarative registry of every "thing the CLI knows how to do".
 * Each entry binds a Claude tool surface (name, prompts, JSON Schema)
 * to a server backing-route handler, role gates, confirmation policy,
 * and result-card hints. The orchestrator merges these entries into
 * `TOOL_REGISTRY` at process boot so the model only ever sees the
 * filtered subset the persona is allowed to call.
 *
 * Coverage note (declared drift): the platform exposes ~250 routes
 * across 18 modules. Literally enumerating each one would inflate the
 * model's tool window past Anthropic's practical cap and would also
 * duplicate validation logic that already lives in route Zod schemas.
 * Instead we ship one *representative* entry per module that exercises
 * each catalog concern (read, write+confirm, irreversible+typed-name,
 * resolver-driven disambiguation, attachment-derived input). Adding a
 * new capability is then a single `defineCapability(...)` call —
 * downstream tasks #333-#335 layer additional entries without
 * touching orchestrator code.
 */

import type { CliPersona, ToolContext, ToolResult } from "./index.js";
import type { AtelierUserRole } from "../../routes/atelier/personaRoles.js";

/**
 * Module families used for routing, role-filtering, and the surface
 * grouping shown in the slash-command palette.
 */
export type CapabilityModule =
  | "raid"
  | "engagement"
  | "deliverable"
  | "account"
  | "opportunity"
  | "wallet"
  | "ledger"
  | "roster"
  | "skill_graph"
  | "knowledge"
  | "report"
  | "firm_profile"
  | "win_loss"
  | "pricing"
  | "proposal"
  | "agent"
  | "admin"
  | "meta";

export type SurfaceContext =
  | "engagement_dashboard"
  | "account_workspace"
  | "opportunity_workspace"
  | "wallet"
  | "ledger"
  | "roster"
  | "global";

export interface SlashAlias {
  /** Free-form aliases the slash-command palette matches against. */
  en?: string[];
  fr?: string[];
  ar?: string[];
}

export interface CapabilityEntry {
  /** Stable identifier (`<module>.<verb>`) — used in audit + slash. */
  id: string;
  /** Catalog/manifest version this entry was authored against. */
  schemaVersion: number;
  /** Module family (used for role-filter + surface grouping). */
  module: CapabilityModule;
  /** Tool name as exposed to Claude. Convention: snake_case verb. */
  toolName: string;
  /** Short Claude-facing description (one sentence). */
  description: string;
  /** Slash-command aliases by locale. */
  slashAliases: SlashAlias;
  /** JSON Schema (Anthropic input_schema shape). */
  inputSchema: Record<string, unknown>;
  /** True if this capability mutates server state. */
  isWrite: boolean;
  /**
   * True if the mutation is *not* trivially undoable (delete, revoke,
   * publish-to-Salon, send-to-client, lost-mark). Server requires
   * `{ confirm:true, typedName:"<entity name>" }` on the second
   * `/confirm` POST before the run callback executes.
   */
  irreversible: boolean;
  /** Personas allowed to invoke. Empty/omitted ⇒ everyone except `board_observer`. */
  requiredRoles?: AtelierUserRole[];
  /** Surfaces where the slash-command palette should advertise this. */
  surfaceOn: SurfaceContext[];
  /**
   * Task #335 — natural-language example phrasings shown by `/help` and
   * the page-aware suggestion strip. Optional + per-locale; the client
   * falls back to `en` when its locale is missing.
   */
  examplePhrases?: { en?: string[]; ar?: string[]; fr?: string[] } | null;
  /**
   * If true, the orchestrator treats `confirm:true` as the commit
   * phase (existing two-phase contract). Defaults to true for writes.
   */
  twoPhaseConfirm: boolean;
  /**
   * Outbound channel the capability fans out to (for per-user-per-day
   * rate limiting and typed-recipient confirmation). Null for purely
   * internal mutations.
   */
  outboundChannel: "email" | "slack" | "salon_publish" | null;
  /**
   * Render hint for the result card the client should show after a
   * successful run. Free-form; client interprets.
   */
  resultCard: string;
  /**
   * Implementation. Receives the validated `input` and a `ToolContext`,
   * returns the standard `ToolResult` shape (with optional
   * `confirmation` + `disambiguation` envelopes).
   */
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Catalog/manifest version. Bump when the entry shape changes. */
export const CATALOG_SCHEMA_VERSION = 1;

const REGISTRY: CapabilityEntry[] = [];

/**
 * Register a capability. Throws on duplicate `id` so a typo can't
 * silently clobber an entry.
 */
export function defineCapability(entry: CapabilityEntry): void {
  if (REGISTRY.some((e) => e.id === entry.id || e.toolName === entry.toolName)) {
    throw new Error(
      `[capability-catalog] duplicate id/toolName: ${entry.id}/${entry.toolName}`,
    );
  }
  REGISTRY.push(entry);
}

export function listCapabilities(): readonly CapabilityEntry[] {
  return REGISTRY;
}

/**
 * Role-perimeter filter: returns only the capabilities the given
 * persona is allowed to invoke. Board observers see only `meta` +
 * read-only `raid` (mirrors the read-only UI shell they get).
 */
export function capabilitiesForPersona(persona: CliPersona): CapabilityEntry[] {
  const role = persona.role as AtelierUserRole;
  return REGISTRY.filter((e) => {
    if (role === "board_observer") {
      return e.module === "meta" || (!e.isWrite && e.module === "raid");
    }
    if (e.requiredRoles && e.requiredRoles.length > 0) {
      return e.requiredRoles.includes(role);
    }
    return true;
  });
}

/** Used by orchestrator to look up a capability by toolName. */
export function findByToolName(toolName: string): CapabilityEntry | undefined {
  return REGISTRY.find((e) => e.toolName === toolName);
}

/** Task #335 — id-keyed lookup (used by undo + admin metrics). */
export function findById(id: string): CapabilityEntry | undefined {
  return REGISTRY.find((e) => e.id === id);
}
