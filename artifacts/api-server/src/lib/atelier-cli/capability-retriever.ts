/**
 * Task #411 — Per-turn capability retriever.
 *
 * Embeds the prompt (or the router's Intent string) and ranks the
 * persona-allowed capability surface by cosine similarity against
 * pre-computed embeddings stored in `atelier_capability_embeddings`.
 * Returns the top-K plus the four orchestrator meta-tools (always
 * present so the policy loop can run).
 *
 * Cold-start safety: the first time the catalog is asked for tools we
 * call `ensureCapabilityEmbeddings()` which embeds any rows missing
 * from the table. Idempotent — only writes new rows.
 *
 * Hard floor: when `kind` matches a `propose_write` covered entity we
 * always include `resolve_entity`, `prefill_from_specialist`,
 * `evaluate_gate`, and `propose_write` so the orchestrator policy
 * always has the four verbs it needs even if cosine ranking missed
 * them.
 */

import { eq } from "drizzle-orm";
import { db, atelierCapabilityEmbeddings } from "@workspace/db";
import {
  type CapabilityEntry,
  capabilitiesForPersona,
} from "./capability-catalog.js";
import type { CliPersona, ToolDef } from "./index.js";
import { cosine, currentProvider, embedText } from "./embeddings.js";
import { CHAT_OWNED_KINDS } from "./write-dispatch.js";

/**
 * The four orchestrator meta-tools — always included for every turn so
 * the policy loop (resolve → prefill → gate → propose) can run no
 * matter what the cosine ranking returns. These count against the
 * hard ≤12 total tool budget the brief mandates.
 */
const ALWAYS_INCLUDE = new Set([
  "resolve_entity",
  "prefill_from_specialist",
  "evaluate_gate",
  "propose_write",
]);

/** Hard maximum tools surfaced to the model per step (always-on + ranked). */
const HARD_CAP = 12;

/** Cap for the widened retry pool (see `widen` below). */
const WIDE_CAP = 40;

/**
 * Task #644 — deterministic per-intent-kind tool floor. When the typed
 * intent names one of these kinds, the listed core tools are ALWAYS
 * surfaced (persona/eligibility permitting) regardless of cosine
 * scores, so common actions never vanish behind an embedding miss.
 * Names not on the persona's eligible surface are silently skipped —
 * the floor can never widen a persona's clamp.
 */
export const CORE_TOOLS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  meeting: [
    "schedule_internal_meeting",
    "reschedule_internal_meeting",
    "cancel_internal_meeting",
    "update_internal_meeting",
    "schedule_client_meeting",
    "meeting_list",
    "check_availability",
  ],
  expense: ["create_my_expense", "my_expenses", "submit_my_expense", "expense_list"],
  timesheet: ["log_my_time", "my_timesheets", "submit_my_timesheet", "timesheet_current"],
  leave: ["request_leave", "my_leave"],
  document: [
    "save_my_document",
    "my_documents",
    "search_documents",
    "document_list",
    // Task #679 — emailing documents is a document-kind intent; without
    // these in the floor, a missing/stale embedding row made the email
    // tools invisible and the model claimed the capability didn't exist.
    "email_company_documents",
    "email_my_documents",
  ],
  account: ["account_lookup", "account_list", "account_dossier"],
  opportunity: ["opportunity_detail", "opportunity_list_by_stage", "pipeline_by_stage"],
  contact: ["contact_detail", "contact_list"],
  engagement: ["engagement_detail", "engagement_list_active"],
};

/**
 * Pure floor helper (probed offline): core tool names for `kind`
 * restricted to the eligible surface.
 */
export function floorToolsForKind(
  kind: string | undefined,
  eligibleNames: ReadonlySet<string>,
): string[] {
  const core = kind ? CORE_TOOLS_BY_KIND[kind] : undefined;
  if (!core) return [];
  return core.filter((n) => eligibleNames.has(n));
}

/**
 * Modules whose write tools are covered by the orchestrator's
 * `propose_write` dispatcher. Any tool whose `module` is in this set
 * AND which is `isWrite:true` is hidden from the model surface during
 * a chat turn (the underlying tool stays registered so the dispatcher
 * can call it). The orchestrator meta-tools (module="meta") are
 * exempt by construction. Keep in sync with `write-dispatch.ts`.
 */
const COVERED_WRITE_MODULES: ReadonlySet<string> = new Set([
  "account",
  "opportunity",
  "contact",
  "engagement",
  "deliverable",
  "raid",
  "ledger",
  "pricing",
  "firm_profile",
  "win_loss",
  "knowledge",
  "agent",
  "cash",
  "codex",
  "wallet",
  "change_order",
  "proposal",
]);

let bootstrapDone = false;

function summaryTextFor(entry: CapabilityEntry): string {
  const phrases: string[] = [];
  if (entry.representativePrompts?.en) phrases.push(...entry.representativePrompts.en);
  return [
    entry.toolName.replace(/_/g, " "),
    entry.module,
    entry.description,
    ...phrases,
    Array.isArray(entry.slashAliases.en) ? entry.slashAliases.en.join(" ") : "",
  ]
    .filter(Boolean)
    .join(". ")
    .slice(0, 1500);
}

/**
 * Idempotent — re-embed an entry only when (a) it's missing or
 * (b) its `schemaHash` changed or (c) the provider id changed.
 */
export async function ensureCapabilityEmbeddings(): Promise<void> {
  const provider = currentProvider();
  const existing = await db.select().from(atelierCapabilityEmbeddings);
  const byId = new Map(existing.map((r) => [r.capabilityId, r]));
  const all = capabilitiesForPersona({
    id: "__bootstrap__",
    name: "bootstrap",
    role: "founding_partner",
    orgId: "aico",
  } as CliPersona);
  for (const entry of all) {
    const prev = byId.get(entry.id);
    if (
      prev &&
      prev.schemaHash === entry.schemaHash &&
      prev.provider === provider
    ) {
      continue;
    }
    const text = summaryTextFor(entry);
    const emb = await embedText(text);
    if (prev) {
      await db
        .update(atelierCapabilityEmbeddings)
        .set({
          toolName: entry.toolName,
          summaryText: text,
          provider: emb.provider,
          dim: emb.dim,
          vec: emb.vec,
          schemaHash: entry.schemaHash,
          updatedAt: new Date(),
        })
        .where(eq(atelierCapabilityEmbeddings.capabilityId, entry.id));
    } else {
      await db.insert(atelierCapabilityEmbeddings).values({
        capabilityId: entry.id,
        toolName: entry.toolName,
        summaryText: text,
        provider: emb.provider,
        dim: emb.dim,
        vec: emb.vec,
        schemaHash: entry.schemaHash,
      });
    }
  }
  // Task #679 — loud invariant: every registered capability must have an
  // embedding row after the sync. A silent gap makes tools invisible to
  // ranked retrieval (only widen/floor can surface them), which the user
  // experiences as "the assistant says the feature doesn't exist".
  const after = await db
    .select({ capabilityId: atelierCapabilityEmbeddings.capabilityId })
    .from(atelierCapabilityEmbeddings);
  const have = new Set(after.map((r) => r.capabilityId));
  const missing = all.filter((e) => !have.has(e.id)).map((e) => e.id);
  if (missing.length > 0) {
    throw new Error(
      `[capability-retriever] embedding sync incomplete — missing rows for: ${missing.join(", ")}`,
    );
  }
}

async function bootstrapOnce(): Promise<void> {
  if (bootstrapDone) return;
  // Embedding bootstrap is required for live capability ranking. Any
  // failure here (missing API key, upstream outage) must surface to
  // the caller so the turn fails loudly — no silent degradation.
  await ensureCapabilityEmbeddings();
  bootstrapDone = true;
}

export interface RetrievedTools {
  tools: ToolDef[];
  /** Tool names actually surfaced (for audit). */
  selected: string[];
  /** Cosine score per selected tool, descending. */
  scores: Array<{ tool: string; score: number }>;
  /** True when retrieval ran; false when we degraded to "all persona tools". */
  ranked: boolean;
}

/**
 * Rank the persona's allowed capability surface against `query` and
 * return the top-K + the always-include floor.
 */
export async function retrieveCapabilities(args: {
  persona: CliPersona;
  query: string;
  intentKind?: string;
  /**
   * Typed intent verb. When "read" or "trivial", any capability with
   * `isWrite:true` (other than the orchestrator meta-tools) is hidden
   * from the model surface — read intents must not be able to call
   * write tools. Write/transition intents see the full pool.
   */
  intentVerb?: string;
  topK?: number;
  /**
   * When true (the default), legacy chat-write tools for the entities
   * `propose_write` already covers are stripped from the candidate
   * pool. The orchestrator owns those verbs in chat; the legacy tools
   * stay reachable via slash commands and direct typed routes.
   */
  decommissionLegacy?: boolean;
  /**
   * Task #644 — widen-on-miss retry. When true the ENTIRE eligible
   * pool (same persona clamp, read-intent write hiding and legacy
   * decommission as always) is surfaced up to WIDE_CAP, bypassing
   * cosine ranking. Used exactly once per turn when the model claims
   * no suitable tool exists.
   */
  widen?: boolean;
}): Promise<RetrievedTools> {
  const persona = args.persona;
  const cap = args.widen ? WIDE_CAP : HARD_CAP;
  // Reserve always-on slots; ranked slots fill the rest of HARD_CAP.
  const rankedBudget = args.widen
    ? cap
    : Math.max(1, (args.topK ?? HARD_CAP - ALWAYS_INCLUDE.size));
  const decommissionLegacy = args.decommissionLegacy ?? true;
  const intentVerb = args.intentVerb ?? "";
  const isReadIntent = intentVerb === "read" || intentVerb === "trivial";
  const allTools = (await import("./index.js")).getToolsForPersona(persona);
  const personaCaps = capabilitiesForPersona(persona);
  const personaCapByTool = new Map(personaCaps.map((c) => [c.toolName, c]));
  await bootstrapOnce();

  // Pool of tools eligible for ranking: persona surface minus
  // decommissioned legacy chat-writes, minus all write tools when the
  // typed intent is read/trivial. Always-on meta-tools bypass these
  // filters (they're added unconditionally below). The "read intents
  // never see writes" rule is the verb-aware floor the reviewer
  // requires for tier isolation.
  const dispatchTargets = await DISPATCH_TARGETS_LAZY();
  await ensureCoveredVerbsHydrated();
  const eligible = allTools.filter((t) => {
    if (ALWAYS_INCLUDE.has(t.name)) return true;
    const cap = personaCapByTool.get(t.name);
    if (isReadIntent && cap?.isWrite && cap.module !== "meta") return false;
    if (!decommissionLegacy) return true;
    return !isLegacyChatWrite(cap, dispatchTargets);
  });

  const queryEmb = await embedText(args.query || "");
  // Capability-embedding fetch failures must propagate — silent
  // fallbacks were deleted along with mock mode.
  const all = await db.select().from(atelierCapabilityEmbeddings);
  const rows: Array<{ toolName: string; vec: number[] }> = all
    .filter((r) => r.dim === queryEmb.dim)
    .map((r) => ({ toolName: r.toolName, vec: r.vec as number[] }));

  const eligibleNames = new Set(eligible.map((t) => t.name));
  const selected = new Set<string>();

  // 1. Always-include the four orchestrator verbs (within budget).
  for (const t of allTools) {
    if (selected.size >= cap) break;
    if (ALWAYS_INCLUDE.has(t.name)) selected.add(t.name);
  }

  // 1b. Task #644 — deterministic per-kind floor: the core tools for
  // the typed intent kind are surfaced regardless of cosine rank
  // (still restricted to the eligible pool, so persona clamps and the
  // read-intent write hiding always win).
  for (const n of floorToolsForKind(args.intentKind, eligibleNames)) {
    if (selected.size >= cap) break;
    selected.add(n);
  }

  // 1c. Widened retry — surface the whole eligible pool up to WIDE_CAP.
  if (args.widen) {
    for (const t of eligible) {
      if (selected.size >= cap) break;
      selected.add(t.name);
    }
  }

  // 2. Top-K by cosine over the eligible pool, capped.
  const scored = rows
    .filter((r) => eligibleNames.has(r.toolName) && !selected.has(r.toolName))
    .map((r) => ({ tool: r.toolName, score: cosine(queryEmb.vec, r.vec) }))
    .sort((a, b) => b.score - a.score);
  let added = 0;
  for (const s of scored) {
    if (selected.size >= cap || added >= rankedBudget) break;
    selected.add(s.tool);
    added++;
  }

  // 3. Cold-start fallback — when we have no embeddings for the
  // eligible pool, fill the remaining budget alphabetically by tool
  // name so the model has *something* to work with. Still capped.
  if (selected.size < cap && scored.length === 0) {
    const fillers = eligible
      .filter((t) => !selected.has(t.name))
      .map((t) => t.name)
      .sort();
    for (const n of fillers) {
      if (selected.size >= cap) break;
      selected.add(n);
    }
  }

  const byName = new Map(allTools.map((t) => [t.name, t]));
  const tools = Array.from(selected)
    .map((n) => byName.get(n))
    .filter((t): t is ToolDef => Boolean(t));
  return {
    tools,
    selected: tools.map((t) => t.name),
    scores: scored.slice(0, rankedBudget).map((s) => ({ tool: s.tool, score: s.score })),
    ranked: scored.length > 0,
  };
}

/**
 * Round-7 — decommission anchored to (kind, verb) ownership rather
 * than toolName. A legacy chat-write tool is stripped from Sonnet's
 * surface iff some (kind, verb) it performs is now owned by the
 * `propose_write` dispatcher. This catches both:
 *
 *   (a) The dispatch targets themselves (e.g. `account_update`,
 *       `opportunity_update`) — they ARE the new chat-write surface
 *       and must not be exposed as Sonnet tools alongside
 *       `propose_write`, otherwise Sonnet would pick the direct
 *       tool and bypass the typed prefill / gate / commit pipeline.
 *
 *   (b) Any LEGACY ALIAS that performs the same (kind, verb) —
 *       e.g. an older `account_update_v2` or `wallet_update_expense`
 *       wrapper. These are listed in `LEGACY_TOOL_OWNERSHIP` so the
 *       map stays the single source of truth even after a tool is
 *       renamed or replaced. Today the round-5 audit removed the
 *       known v2/wallet legacy aliases, but the map is the hook
 *       point for any future legacy chat-write that lands.
 *
 * Tools whose (kind, verb) is NOT covered by `DISPATCH_TABLE` are
 * always kept reachable so users are never left without a way to
 * apply the change in chat.
 */
const LEGACY_TOOL_OWNERSHIP: Readonly<Record<string, { kind: string; verb: string }>> = {
  // (Empty today — round-5 deleted the *_v2 / wallet_update_expense
  //  legacy aliases.) Add rows here as `{toolName: {kind, verb}}`
  //  whenever a legacy chat-write surfaces that overlaps with a
  //  covered DISPATCH_TABLE entry.
};

const COVERED_KIND_VERBS_LAZY = (() => {
  let cached: ReadonlySet<string> | null = null;
  return async (): Promise<ReadonlySet<string>> => {
    if (cached) return cached;
    const { DISPATCH_TABLE } = await import("./write-dispatch.js");
    const out = new Set<string>();
    for (const [kind, verbs] of Object.entries(DISPATCH_TABLE)) {
      for (const verb of Object.keys(verbs as Record<string, string>)) {
        out.add(`${kind}.${verb}`);
      }
    }
    cached = out;
    return cached;
  };
})();

const DISPATCH_TARGETS_LAZY = (() => {
  let cached: ReadonlySet<string> | null = null;
  return async (): Promise<ReadonlySet<string>> => {
    if (cached) return cached;
    const { DISPATCH_TABLE } = await import("./write-dispatch.js");
    const out = new Set<string>();
    for (const verbs of Object.values(DISPATCH_TABLE)) {
      for (const t of Object.values(verbs as Record<string, string>)) {
        if (typeof t === "string" && t) out.add(t);
      }
    }
    cached = out;
    return cached;
  };
})();

function isLegacyChatWrite(entry: CapabilityEntry | undefined, dispatchTargets: ReadonlySet<string>): boolean {
  if (!entry) return false;
  if (!entry.isWrite) return false;
  if (entry.module === "meta") return false;
  if (ALWAYS_INCLUDE.has(entry.toolName)) return false;
  // (a) Direct dispatch targets — already vetted to perform a
  //     covered (kind, verb).
  if (dispatchTargets.has(entry.toolName)) return true;
  // (b) Known legacy aliases — strip iff their declared (kind, verb)
  //     is itself covered by the dispatcher right now.
  const owned = LEGACY_TOOL_OWNERSHIP[entry.toolName];
  if (owned && DISPATCH_COVERED_VERBS_SYNC.has(`${owned.kind}.${owned.verb}`)) return true;
  return false;
}

// Sync mirror of COVERED_KIND_VERBS_LAZY — populated on first
// retrieval call. The legacy-alias check above is hot-path so we
// avoid an `await` inside `isLegacyChatWrite` itself.
const DISPATCH_COVERED_VERBS_SYNC = new Set<string>();
async function ensureCoveredVerbsHydrated(): Promise<void> {
  if (DISPATCH_COVERED_VERBS_SYNC.size > 0) return;
  const set = await COVERED_KIND_VERBS_LAZY();
  for (const v of set) DISPATCH_COVERED_VERBS_SYNC.add(v);
}

/** Re-exported for the orchestrator dispatcher decommission audit. */
export { CHAT_OWNED_KINDS };
