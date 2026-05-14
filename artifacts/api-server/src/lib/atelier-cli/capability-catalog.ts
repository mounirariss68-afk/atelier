/**
 * Atelier CLI capability catalog (Tasks #332 → #339).
 *
 * Single declarative registry of every "thing the CLI knows how to do".
 * Each entry binds a Claude tool surface (name, prompts, JSON Schema)
 * to a server backing-route handler, role gates, confirmation policy,
 * and result-card hints. The orchestrator merges these entries into
 * `TOOL_REGISTRY` at process boot so the model only ever sees the
 * filtered subset the persona is allowed to call.
 *
 * Task #339 — this file is now purely **loader + types**. Catalog
 * entries are no longer hand-curated in a sibling `capability-seed.ts`;
 * instead they are *derived from code* by:
 *
 *   1. `defineRouteCapability(...)` colocates a capability declaration
 *      with the route handler that implements it.
 *   2. `registerAgentCapabilities()` walks the @workspace/agents
 *      registry and auto-registers one capability per agent.
 *
 * The orchestrator imports `bootstrap-capabilities.ts` once at boot,
 * which side-effect-loads every route + agent registration. From that
 * point on, the catalog is read-only and the orchestrator sees the
 * filtered per-persona slice.
 *
 * Schema-drift detection: every entry's input schema is hashed
 * (sha-256 of canonical JSON) at registration time and stored as
 * `schemaHash`. Saved/pinned prompts that reference an older hash
 * surface a "review before running" warning instead of silently
 * re-executing against the new shape — see `pinnedPromptDrift()`.
 */

import { createHash } from "node:crypto";
import type { CliPersona, ToolContext, ToolResult } from "./index.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";

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
  | "global"
  // Task #342 — explicit Home surface so the catalog can drive the
  // role-aware suggestion chips on the Home page (and the assistant's
  // empty-state chips when the user opened it from Home).
  | "home";

export interface SlashAlias {
  /** Free-form aliases the slash-command palette matches against. */
  en?: string[];
  fr?: string[];
  ar?: string[];
}

/**
 * Representative prompts in EN/AR/FR. Surfaced in the palette and used
 * as few-shot examples when the model is asked "what can you do here?".
 * Every entry should have at least one EN prompt; AR/FR are encouraged.
 */
export interface RepresentativePrompts {
  en: string[];
  ar?: string[];
  fr?: string[];
}

/**
 * Hint about which capabilities the orchestrator should suggest as a
 * follow-up after this one runs successfully (e.g. after raid.add, the
 * model can offer to /raid-list the engagement). Used by the
 * `proposed_plan` frame to chain reads after writes.
 */
export type FollowUpTrigger = string;

export interface CapabilityEntry {
  /** Stable identifier (`<module>.<verb>`) — used in audit + slash. */
  id: string;
  /**
   * Catalog/manifest version this entry was authored against. Bumped
   * deliberately for breaking changes to the entry SHAPE. Distinct from
   * `schemaHash` which tracks drift in the *input schema* of this
   * single entry.
   */
  schemaVersion: number;
  /**
   * Hash of the canonicalised input schema (sha-256, first 12 hex
   * chars). Auto-computed by `defineCapability` if not provided.
   * Pinned saved prompts compare against this — mismatch surfaces a
   * "review before running" warning.
   */
  schemaHash: string;
  /** Module family (used for role-filter + surface grouping). */
  module: CapabilityModule;
  /** Tool name as exposed to Claude. Convention: snake_case verb. */
  toolName: string;
  /** Short Claude-facing description (one sentence). */
  description: string;
  /** Slash-command aliases by locale. */
  slashAliases: SlashAlias;
  /**
   * Representative prompts used for palette previews + as inline
   * examples to the model. Keep one per locale so AR/FR users see the
   * capability surfaced in their language.
   */
  representativePrompts?: RepresentativePrompts;
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
  requiredRoles?: AtelierRole[];
  /** Surfaces where the slash-command palette should advertise this. */
  surfaceOn: SurfaceContext[];
  /**
   * Task #335/342 — optional per-locale natural-language phrasings that
   * the assistant client can show as suggestion chips (Home page,
   * assistant empty state, /help drawer). The first entry per locale
   * is treated as the canonical chip label.
   */
  examplePhrases?: { en?: string[]; ar?: string[]; fr?: string[] } | null;
  /**
   * Origin of the registration — used by lint/coverage tests to verify
   * every route file uses the framework rather than ad-hoc
   * `defineCapability` calls.
   */
  source: "route" | "agent" | "cli-only";
  /**
   * Implementation. Receives the validated `input` and a `ToolContext`,
   * returns the standard `ToolResult` shape (with optional
   * `confirmation` + `disambiguation` envelopes).
   */
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Catalog/manifest version. Bump when the entry SHAPE changes. */
export const CATALOG_SCHEMA_VERSION = 2;

/**
 * Input shape for `defineCapability`. `schemaHash` and `source` are
 * computed/defaulted automatically when omitted.
 */
export type CapabilityInput =
  & Omit<CapabilityEntry, "schemaHash" | "source">
  & { schemaHash?: string; source?: CapabilityEntry["source"] };

const REGISTRY: CapabilityEntry[] = [];

/**
 * Canonicalise a JSON-Schema-shaped object so two structurally
 * equivalent schemas hash identically (sorted keys, deterministic
 * stringify). We don't need full JSON-Schema canonicalisation — just
 * stable iteration order is enough to detect a real shape change.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Derive the schema hash an entry should carry. Exposed so callers
 * (saved-prompt persistence, migration scripts) can compute the same
 * fingerprint without going through `defineCapability`.
 */
export function hashSchema(schema: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(schema)).digest("hex").slice(0, 12);
}

/**
 * Register a capability. Throws on duplicate `id`/`toolName` so a typo
 * can't silently clobber an entry. Auto-computes `schemaHash` if the
 * caller didn't pin one.
 */
export function defineCapability(entry: CapabilityInput): CapabilityEntry {
  const finalised: CapabilityEntry = {
    ...entry,
    source: entry.source ?? "cli-only",
    schemaHash: entry.schemaHash ?? hashSchema(entry.inputSchema),
  };
  if (REGISTRY.some((e) => e.id === finalised.id || e.toolName === finalised.toolName)) {
    throw new Error(
      `[capability-catalog] duplicate id/toolName: ${finalised.id}/${finalised.toolName}`,
    );
  }
  REGISTRY.push(finalised);
  return finalised;
}

export function listCapabilities(): readonly CapabilityEntry[] {
  return REGISTRY;
}

/**
 * Test-only reset hook. Catalog registration is normally one-shot at
 * process boot; tests that want to assert against a fresh registry use
 * this. Not exported from the public index.
 */
export function __resetCatalogForTests(): void {
  REGISTRY.length = 0;
}

/**
 * Role-perimeter filter: returns only the capabilities the given
 * persona is allowed to invoke. Board observers see only `meta` +
 * read-only `raid` (mirrors the read-only UI shell they get).
 */
export function capabilitiesForPersona(persona: CliPersona): CapabilityEntry[] {
  const role = persona.role as AtelierRole;
  return REGISTRY.filter((e) => {
    if (role === "board_observer") {
      // Strict read-only perimeter — writes are denied regardless of
      // module so a future module classification mistake (e.g. an
      // agent mapped to `meta`) cannot leak a mutation onto the
      // observer surface.
      if (e.isWrite) return false;
      return e.module === "meta" || e.module === "raid";
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

/**
 * Saved-prompt drift check (Task #339).
 *
 * A "saved prompt" is a previously-built `{ tool, input }` pair the
 * user pinned for one-click re-run. If the underlying capability's
 * input schema has changed since the prompt was saved, replaying the
 * old input against the new shape may silently misbehave (e.g. a
 * required field was added, or an enum value was removed). Returning
 * a non-null warning lets the UI surface a "review before running"
 * banner instead of executing blindly.
 *
 * Returns `null` when the saved hash matches the current hash, when
 * the tool is unknown (caller decides how to handle), or when the
 * pinned hash is missing (prompts saved before #339 — caller should
 * treat as "untrusted, needs review").
 */
export function pinnedPromptDrift(pinned: {
  toolName: string;
  schemaHash?: string | null;
}): { warning: string; currentHash: string; pinnedHash: string | null } | null {
  const cap = findByToolName(pinned.toolName);
  if (!cap) return null;
  const pinnedHash = pinned.schemaHash ?? null;
  if (pinnedHash && pinnedHash === cap.schemaHash) return null;
  return {
    warning:
      pinnedHash === null
        ? `Saved prompt for ${cap.toolName} predates schema hashing — review the inputs before running.`
        : `Saved prompt for ${cap.toolName} was pinned to schema ${pinnedHash}; current schema is ${cap.schemaHash}. Review before running.`,
    currentHash: cap.schemaHash,
    pinnedHash,
  };
}
