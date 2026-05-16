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
  | "meta"
  // L2C Wave 1 (Task #360) — Codex/CLM, change orders, deliverable
  // acceptance. Restricted personas (contractor, partner_firm_resource,
  // recruiter) and board_observer are denied at the catalog gate
  // regardless of `requiredRoles`. See `capabilitiesForPersona` below.
  | "codex"
  | "change_order"
  | "deliverable_acceptance"
  // L2C Wave 2 (Task #361) — Revenue recognition, WIP, engagement
  // margin, leakage. board_observer is allow-listed onto the firm-wide
  // rollup capabilities (`wip_report`, `leakage_report`,
  // `revrec_compute_schedule` read-only) via the explicit
  // `BOARD_OBSERVER_ROLLUP_ALLOWLIST` set below — never module-wide.
  | "revrec"
  | "wip"
  | "margin"
  | "leakage"
  // L2C Wave 4 (Task #363) — cash application, bank reconciliation,
  // 13-week cash forecast, renewals & NRR. board_observer is allow-listed
  // onto `cash_forecast_13w` only via BOARD_OBSERVER_ROLLUP_ALLOWLIST.
  | "cash"
  | "bank"
  | "treasury"
  | "renewal";

/**
 * Outbound side-effect channel a capability fires when it commits.
 * `null` means the capability is contained to internal DB state and
 * the undo path can fully reverse it. Non-null channels (currently
 * just "email") block undo and are surfaced in the confirmation diff
 * so the user knows the write will leave the system.
 */
export type OutboundChannel = "email";

/**
 * Result-card hint the orchestrator emits alongside a successful
 * tool result so the client can pick a typed renderer instead of
 * falling back to raw JSON. New cards must be added here so a typo
 * in a catalog entry breaks the build (Task #349).
 */
export type ResultCard =
  | "account_card"
  | "account_deleted"
  | "agent_run"
  | "asset_card"
  | "audit_timeline"
  | "brand_profile_draft"
  | "capability_list"
  | "cartographer_run"
  | "charter_card"
  | "contact_card"
  | "deliverable_card"
  | "document_chunk"
  | "email_sent"
  | "entity_card"
  | "expense_batch"
  | "expense_card"
  | "kpi_strip"
  | "meeting_card"
  | "opportunity_card"
  | "pov_card"
  | "profile_update_decision"
  | "proposal_card"
  | "qualification_rubric"
  | "qualifier_card"
  | "raid_batch"
  | "raid_item"
  | "ranked_list"
  | "section_card"
  | "time_series"
  | "timesheet_card"
  | "undo_card"
  // L2C Wave 1 (Task #360) — typed renderers for the new Codex/CLM,
  // change-order and deliverable-acceptance result shapes. The cards
  // are declared up-front (W1-S9 will land the front-end renderers);
  // any cap referencing one of these names that ships before the
  // renderer must use the `assertNever` placeholder fallback.
  | "counterparty_card"
  | "clause_card"
  | "contract_card"
  | "redline_card"
  | "dpa_card"
  | "change_order_card"
  | "deliverable_acceptance_card"
  | "invoice_card"
  | "ar_aging_grid"
  | "dunning_card"
  // L2C Wave 4 (Task #363) — cash, bank reconciliation, forecast, renewals
  | "cash_receipt_card"
  | "bank_recon_card"
  | "cash_forecast_strip"
  | "renewal_card"
  // Task #406 — Chat Orchestrator coordinator cards.
  | "gate_report"
  | "entity_resolution";

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
   * True if a successful run requires a separate `/confirm` POST
   * before the run callback fires (two-phase write). Read-only
   * capabilities should set this to `false`.
   */
  twoPhaseConfirm: boolean;
  /**
   * Outbound side-effect channel that fires when this capability
   * commits, or `null` for purely-internal mutations. Surfaced in the
   * confirmation diff and used by `undo` to refuse reversal.
   */
  outboundChannel: OutboundChannel | null;
  /**
   * Result-card hint used by the client to pick a typed renderer for
   * the tool result, or `null` when no card is appropriate.
   */
  resultCard: ResultCard | null;
  /**
   * True if the mutation is *not* trivially undoable (delete, revoke,
   * publish-to-Salon, send-to-client, lost-mark). Server requires
   * `{ confirm:true, typedName:"<entity name>" }` on the second
   * `/confirm` POST before the run callback executes.
   */
  irreversible: boolean;
  /** Personas allowed to invoke. Empty/omitted ⇒ everyone except `board_observer`. */
  requiredRoles?: AtelierRole[];
  /**
   * L2C Wave 2 (Task #361) — Personas allowed on the SECOND phase
   * (`/confirm`) of a two-phase write. Empty/omitted preserves the
   * pre-Wave-2 behaviour: the same `requiredRoles` are required for
   * both phases. Set this when the approver perimeter must be tighter
   * than the initiator perimeter (e.g. `revrec_post_period` is
   * initiated by `finance` but irrev-posted only by `founding_partner`).
   */
  approverRoles?: AtelierRole[];
  /** Surfaces where the slash-command palette should advertise this. */
  surfaceOn: SurfaceContext[];
  /**
   * Capability ids the orchestrator should propose as follow-ups after
   * this entry runs successfully. Declared here so a typo in the field
   * name (e.g. `followupTriggers`) fails the build instead of being
   * silently dropped at registration. See `FollowUpTrigger` above.
   */
  followUpTriggers?: FollowUpTrigger[];
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
 * Task #511 — Runtime contract enforcement for the navigateTo hint.
 *
 * Every `isWrite: true` capability MUST return a `navigateTo` value on
 * commit-success: either `null` (no navigation) or
 * `{ path: string, when: "on_commit" }` (auto-navigate after the
 * mutation lands). This wrapper observes every commit-success result
 * and throws with the offending capability id when the contract is
 * violated, so a regression surfaces immediately at call-time instead
 * of silently breaking the chat client's auto-navigation.
 *
 * "Commit-success" = `ok: true` with a `data` payload AND no envelope
 * indicating the orchestrator is still mid-flight (no `confirmation`,
 * `disambiguation`, `clarification`, `refusal`, `asyncJob`, or
 * `needsAttachments`). Read-only caps (isWrite=false) are not
 * checked. The wrapper exposes a `__navContractWrapped` marker so
 * tests can assert every isWrite cap is wrapped.
 */
type ToolResultLike = ToolResult & {
  asyncJob?: unknown;
  needsAttachments?: unknown;
};
function isCommitSuccess(r: ToolResultLike): boolean {
  if (!r || r.ok !== true) return false;
  if (r.confirmation || r.disambiguation || r.clarification || r.refusal) return false;
  if (r.asyncJob || r.needsAttachments) return false;
  return r.data !== undefined && r.data !== null && typeof r.data === "object";
}
export function validateNavigateToShape(value: unknown): string | null {
  if (value === null) return null;
  if (value === undefined) return "missing `navigateTo` key on commit-success data";
  if (typeof value !== "object") {
    return `navigateTo must be an object or null (got ${typeof value})`;
  }
  const o = value as Record<string, unknown>;
  if (o.when !== "on_commit") {
    return `navigateTo.when must equal "on_commit" (got ${JSON.stringify(o.when)})`;
  }
  if (typeof o.path !== "string" || o.path.length === 0) {
    return `navigateTo.path must be a non-empty string (got ${JSON.stringify(o.path)})`;
  }
  return null;
}
export function assertNavigateToContract(id: string, result: ToolResult): void {
  if (!isCommitSuccess(result as ToolResultLike)) return;
  const data = result.data as Record<string, unknown>;
  if (!("navigateTo" in data)) {
    throw new Error(
      `[capability "${id}"] commit-success result is missing the \`navigateTo\` key. ` +
        `Add \`navigateTo: { path, when: "on_commit" }\` or explicit \`navigateTo: null\` to the returned data.`,
    );
  }
  const err = validateNavigateToShape(data.navigateTo);
  if (err) {
    throw new Error(
      `[capability "${id}"] navigateTo contract violation: ${err}. ` +
        `Expected null or { path: string, when: "on_commit" }.`,
    );
  }
}

/**
 * Register a capability. Throws on duplicate `id`/`toolName` so a typo
 * can't silently clobber an entry. Auto-computes `schemaHash` if the
 * caller didn't pin one. For `isWrite: true` capabilities, wraps
 * `run` with the Task #511 navigateTo contract validator so commit
 * regressions throw at call-time.
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
  if (finalised.isWrite) {
    const inner = finalised.run;
    const wrapped = async (
      input: Record<string, unknown>,
      ctx: ToolContext,
    ): Promise<ToolResult> => {
      const result = await inner(input, ctx);
      assertNavigateToContract(finalised.id, result);
      return result;
    };
    (wrapped as unknown as { __navContractWrapped: true }).__navContractWrapped = true;
    finalised.run = wrapped;
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
// L2C Wave 1 (Task #360, W1-S8) — modules a restricted persona
// (contractor / partner_firm_resource / recruiter) is never permitted
// to see in the CLI catalog. Mirrors the route-layer
// `canRead(role) = !isRestrictedPersona(role) && !isBoardObserver(role)`
// gate enforced by `codexRoutes`, `changeOrderRoutes` and
// `deliverableAcceptanceRoutes`. Defence-in-depth: even if a future
// `requiredRoles` declaration accidentally allows a restricted role,
// the catalog gate strips the entry from the per-persona slice the
// orchestrator ever sees.
const RESTRICTED_DENIED_MODULES: ReadonlySet<CapabilityModule> = new Set([
  "codex",
  "change_order",
  "deliverable_acceptance",
  // L2C Wave 2 — restricted personas (contractor / partner_firm_resource /
  // recruiter) never see revenue, WIP, margin, or leakage surfaces.
  "revrec",
  "wip",
  "margin",
  "leakage",
  // L2C Wave 4 — restricted personas never see cash, bank, treasury, renewal.
  "cash",
  "bank",
  "treasury",
  "renewal",
]);

/**
 * L2C Wave 2 (Task #361) — Allow-list of capability ids the
 * `board_observer` persona is permitted to call despite the strict
 * read-only/board-realm gate below. Hard-coded ids (NOT module-wide)
 * so individual invoice / receipt / dunning capabilities (Waves 3+4)
 * remain denied until the boardroom realm declares them.
 *
 * Wave-3 + Wave-4 ids are declared up-front per spec so the catalog
 * gate is the only thing that needs to change when those waves ship.
 */
export const BOARD_OBSERVER_ROLLUP_ALLOWLIST: ReadonlySet<string> = new Set([
  "wip_report",
  "leakage_report",
  "revrec_compute_schedule", // read-only invocation: returns cached schedule
  "ar_aging_report", // Wave 3 — declared up-front
  "cash_forecast_13w", // Wave 4 — declared up-front
]);

export function capabilitiesForPersona(persona: CliPersona): CapabilityEntry[] {
  const role = persona.role as AtelierRole;
  const restrictedSet: ReadonlySet<AtelierRole> = new Set([
    "contractor",
    "partner_firm_resource",
    "recruiter",
  ]);
  const isRestricted = restrictedSet.has(role);
  return REGISTRY.filter((e) => {
    if (role === "board_observer") {
      // Strict read-only perimeter — writes are denied regardless of
      // module so a future module classification mistake (e.g. an
      // agent mapped to `meta`) cannot leak a mutation onto the
      // observer surface.
      if (e.isWrite) return false;
      // L2C Wave 2 — explicit allow-list of firm-wide rollup ids the
      // board_observer is permitted to see. Checked BEFORE the
      // module-deny gate so the rollup capabilities can live in the
      // (otherwise denied) revrec / wip / leakage modules.
      if (BOARD_OBSERVER_ROLLUP_ALLOWLIST.has(e.id)) return true;
      // Task #362 — board_observer is allowed on the AR aging rollup
      // capability (rollup-only access; per-invoice rows are stripped
      // server-side). Detail capabilities in the wallet module remain
      // denied via `denyBoardObserver` in the capability handler.
      if (e.id === "wallet.ar.aging") return true;
      // Board observer also denied L2C surfaces (no contract / change-
      // order / acceptance visibility) until the boardroom realm ships.
      if (RESTRICTED_DENIED_MODULES.has(e.module)) return false;
      return e.module === "meta" || e.module === "raid";
    }
    // L2C Wave 1 restricted-set deny gate — applies to contractor /
    // partner_firm_resource / recruiter. They never see Codex, change-
    // order, or deliverable-acceptance verbs even if a downstream
    // entry forgets to declare `requiredRoles`.
    if (isRestricted && RESTRICTED_DENIED_MODULES.has(e.module)) {
      return false;
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

// Task #340 — conversation depth: per-session ephemeral draft store.
// In-memory map keyed by sessionId. Holds the last referenced entities
// (for pronoun resolution + clarification merge) plus a snapshot of
// the most recent tool result so meta.refine_last / meta.explain_last
// / meta.undo_last can operate without re-querying the model.
// =====================================================================

export interface CliEntityRef {
  kind: string;
  id: string;
  label: string;
  href?: string | null;
  at: number;
}

export interface SessionDraft {
  entities: Record<string, CliEntityRef>;
  lastTurnId?: string;
  lastWriteTurnId?: string;
  lastWriteTool?: string;
  /** Most recent read tool + args, captured for refine_last re-runs. */
  lastReadTool?: string;
  lastReadArgs?: Record<string, unknown>;
  /** Captured raid item id for undo. */
  lastWriteRaidId?: string;
  lastResultKind?: string;
  lastResultRows?: Array<Record<string, unknown>>;
  lastResultSummary?: string;
  lastResultAt?: number;
  lastFeatureRequestAt?: number;
  pendingClarification?: {
    field: string;
    question: string;
    originalPrompt: string;
    partial: Record<string, unknown>;
    tool: string;
  } | null;
}

const SESSION_DRAFTS = new Map<string, SessionDraft>();
const DRAFT_TTL_MS = 60 * 60 * 1000;
const DRAFT_MAX_SIZE = 1000;

export function getSessionDraft(sessionId: string): SessionDraft {
  let cur = SESSION_DRAFTS.get(sessionId);
  if (!cur) {
    cur = { entities: {} };
    SESSION_DRAFTS.set(sessionId, cur);
  }
  return cur;
}

export function recordSessionEntity(sessionId: string, ref: Omit<CliEntityRef, "at">): void {
  if (!ref.id || !ref.kind) return;
  const d = getSessionDraft(sessionId);
  d.entities[ref.kind] = { ...ref, at: Date.now() };
}

export function recordSessionResult(
  sessionId: string,
  patch: Partial<SessionDraft>,
): void {
  const d = getSessionDraft(sessionId);
  Object.assign(d, patch);
  d.lastResultAt = Date.now();
}

export function clearSessionDraft(sessionId: string): void {
  SESSION_DRAFTS.delete(sessionId);
}

export function pruneSessionDrafts(now: number = Date.now()): void {
  for (const [k, v] of SESSION_DRAFTS.entries()) {
    const at = v.lastResultAt ?? Math.max(0, ...Object.values(v.entities).map((e) => e.at));
    if (now - at > DRAFT_TTL_MS) SESSION_DRAFTS.delete(k);
  }
  if (SESSION_DRAFTS.size > DRAFT_MAX_SIZE) {
    const entries = [...SESSION_DRAFTS.entries()];
    entries.sort((a, b) => (a[1].lastResultAt ?? 0) - (b[1].lastResultAt ?? 0));
    for (const [k] of entries.slice(0, entries.length - DRAFT_MAX_SIZE)) {
      SESSION_DRAFTS.delete(k);
    }
  }
}

export function summarizeSessionDraft(sessionId: string): string {
  const d = SESSION_DRAFTS.get(sessionId);
  if (!d) return "";
  const ents = Object.entries(d.entities)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 6);
  const lines: string[] = [];
  if (ents.length > 0) {
    lines.push("Recent entities (resolve 'it'/'that one' to these):");
    for (const [k, v] of ents) lines.push(`- ${k}: "${v.label}" (id ${v.id})`);
  }
  if (d.lastResultKind && Array.isArray(d.lastResultRows)) {
    lines.push(`Last result: ${d.lastResultRows.length} ${d.lastResultKind}.`);
  }
  if (d.pendingClarification) {
    lines.push(
      `Awaiting clarification on field "${d.pendingClarification.field}" for ${d.pendingClarification.tool}.`,
    );
  }
  return lines.join("\n");
}

export function ingestEntitiesFromToolResult(
  sessionId: string,
  toolName: string,
  data: unknown,
): void {
  if (!data || typeof data !== "object") return;
  const o = data as Record<string, unknown>;
  const tryRef = (kind: string, id: unknown, label: unknown): void => {
    if (typeof id === "string" && id.length > 0) {
      recordSessionEntity(sessionId, {
        kind,
        id,
        label: typeof label === "string" && label.length > 0 ? label : id,
      });
    }
  };
  tryRef("account", o.accountId ?? (o.account as { id?: unknown })?.id, o.accountName ?? (o.account as { name?: unknown })?.name ?? o.name);
  tryRef("engagement", o.engagementId ?? (o.engagement as { id?: unknown })?.id, o.engagementName ?? (o.engagement as { name?: unknown })?.name);
  tryRef("raid_item", o.raidItemId ?? (toolName.startsWith("raid_") ? o.id : undefined), o.description ?? o.label);
  tryRef("deliverable", o.deliverableId, o.deliverableName ?? o.label);
  tryRef("opportunity", o.opportunityId, o.opportunityName ?? o.label);
  if (Array.isArray(o.options)) {
    for (const opt of o.options as Array<Record<string, unknown>>) {
      if (opt && typeof opt.id === "string") {
        recordSessionEntity(sessionId, {
          kind: "candidate",
          id: opt.id,
          label: typeof opt.label === "string" ? opt.label : opt.id,
        });
      }
    }
  }
  const rows: Array<Record<string, unknown>> | null = Array.isArray(o.items)
    ? (o.items as Array<Record<string, unknown>>)
    : Array.isArray(o.rows)
      ? (o.rows as Array<Record<string, unknown>>)
      : Array.isArray(o.results)
        ? (o.results as Array<Record<string, unknown>>)
        : null;
  if (rows && rows.length > 0) {
    recordSessionResult(sessionId, {
      lastResultRows: rows.slice(0, 200),
      lastResultKind: toolName,
    });
  }
}
