/**
 * Task #411 — Single typed intent router.
 *
 * Replaces the three uncoordinated layers Task #406 left in place:
 *   - the regex `heuristicClassify`
 *   - the advisory Haiku label
 *   - the SYSTEM_PROMPT orchestrator policy block (kept for the model
 *     loop, but it is no longer the source of truth for intent)
 *
 * The router emits ONE typed `Intent` per turn. The Intent drives:
 *   - capability retrieval (verb + kind + entity hints → embedding query)
 *   - tier selection (read → Haiku, write/transition → Sonnet)
 *   - orchestration policy (only `transition` triggers evaluate_gate)
 *
 * Implementation: one Haiku 4.5 call with a tightly-shaped JSON
 * response, fenced through a deterministic regex+keyword extractor as
 * fallback. Result is advisory in spirit but binding for tier + tool
 * filter — the loop never lets a "read" intent surface a write tool.
 */

import { z } from "zod";
import { getPrivacyAuthorizedAnthropic } from "../assistant/provider-runtime.js";

const HAIKU_MODEL = process.env.ATELIER_CLI_HAIKU_MODEL ?? "claude-haiku-4-5";
export const INTENT_ROUTER_VERSION = "typed-intent/v1" as const;
export const INTENT_ROUTER_PROMPT_VERSION = "intent-router-prompt/v1" as const;
export const INTENT_ROUTER_MODEL_VERSION = HAIKU_MODEL;

export type IntentVerb =
  | "read"
  | "create"
  | "update"
  | "link"
  | "transition"
  | "delete"
  | "reset"
  | "trivial"
  | "other";

export type IntentTier = "haiku" | "sonnet";

/** Authoritative runtime vocabulary shared by routing, retrieval and dispatch. */
export const INTENT_KINDS = [
  "account",
  "opportunity",
  "contact",
  "engagement",
  "partner_link",
  "deliverable",
  "expense",
  "meeting",
  "raid_item",
  "proposal",
  "pov",
  "change_order",
  "timesheet_entry",
  "leave",
  "document",
  "invoice",
  "contract",
  "rate_card",
  "renewal",
  "partner_firm",
  "win_theme",
  "win_loss_debrief",
  "brief",
  "agent_design",
  "unknown",
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export interface Intent {
  /** Top-level verb. Drives the orchestrator branch. */
  verb: IntentVerb;
  /** Primary entity kind under discussion ("unknown" when ambiguous). */
  kind: IntentKind;
  /** Free-text fragments that reference real entities (passed to resolve_entity). */
  entityHints: string[];
  /** Surface the request originated from (page-context.surface or "global"). */
  surface: string;
  /** Routing tier. Always tracks verb except for explicit overrides. */
  tier: IntentTier;
  /** 0..1 — the upstream classifier's self-reported confidence. */
  confidence: number;
  /** Human-readable label kept for audit + the existing classification field. */
  label: string;
  /** Cost telemetry. */
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

const KIND_KEYWORDS: Array<[IntentKind, RegExp]> = [
  ["account", /\b(account|client|customer|firm|company|organization)\b/i],
  ["opportunity", /\b(opp|opportunity|deal|pipeline|pursuit)\b/i],
  // Task #404 — internal-people phrasings route to the contact kind
  // (the resolver's "contact" pass already spans employees + partner
  // resources alongside CRM contacts).
  ["contact", /\b(contact|stakeholder|champion|buyer|person|employee|roster|staff|directory|colleague|contractor)\b/i],
  ["engagement", /\b(engagement|project|delivery|workstream)\b/i],
  ["meeting", /\b(meeting|workshop|discovery|kickoff|steering)\b/i],
  ["raid_item", /\b(raid|risk|assumption|issue|dependency)\b/i],
  ["proposal", /\b(proposal|sow)\b/i],
  ["pov", /\b(pov|proof of value|proof-of-value)\b/i],
  ["change_order", /\b(change order|co|cr)\b/i],
  ["timesheet_entry", /\b(timesheet|hours|time entry)\b/i],
  ["leave", /\b(leave|time off|holiday request|vacation)\b/i],
  ["document", /\b(document|file|passport|visa|identity card|trade licen[cs]e)\b/i],
  ["invoice", /\b(invoice|bill|receivable)\b/i],
  ["contract", /\b(contract|agreement|msa|nda)\b/i],
  ["rate_card", /\b(rate card|pricing card)\b/i],
  ["renewal", /\b(renewal|nrr)\b/i],
  ["partner_firm", /\b(partner(?!\s+(?:link|connection))|alliance|reseller|subcontractor firm)\b/i],
  ["win_theme", /\b(win theme)\b/i],
  ["win_loss_debrief", /\b(win\/loss|debrief|post-mortem)\b/i],
  ["brief", /\b(executive brief|brief)\b/i],
  ["agent_design", /\b(agent design|new agent)\b/i],
  ["deliverable", /\b(deliverable|memo|readout|report)\b/i],
  ["expense", /\b(expense|receipt)\b/i],
  ["partner_link", /\b(partner link|partner connection)\b/i],
];

const VERB_KEYWORDS: Array<[IntentVerb, RegExp]> = [
  ["reset", /^\/new\b|\b(reset|start over|new session)\b/i],
  ["transition", /\b(move|advance|promote|transition|push (it )?(to|into)|mark (as )?(lost|no[- ]?decision|withdrawn|won)|close (as|won|lost))\b/i],
  ["delete", /\b(delete|remove|drop|archive)\b/i],
  ["create", /\b(add|create|new|draft|prepare|file|log|issue|open|register)\b/i],
  ["update", /\b(update|edit|change|set|rename|amend)\b/i],
  ["link", /\b(link|attach|associate|connect)\b/i],
  ["read", /\b(list|show|find|search|who is|what is|view|fetch|get|recap|summarise|summarize)\b/i],
];

/** Extract candidate entity hints — quoted strings and capitalised noun phrases. */
function extractEntityHints(prompt: string): string[] {
  const hints: string[] = [];
  const quoted = prompt.match(/"([^"]{2,80})"|'([^']{2,80})'/g);
  if (quoted) {
    for (const q of quoted) hints.push(q.replace(/^["']|["']$/g, ""));
  }
  // Capitalised multi-word phrases (Ministry of Energy, Acme Advisory).
  const caps = prompt.match(/\b([A-Z][a-z]+(?:\s+(?:of|the|de|al|and)?\s*[A-Z][a-z]+){0,4})\b/g);
  if (caps) for (const c of caps) hints.push(c);
  // Explicit ids (acct_, opp_, eng_, ...).
  const ids = prompt.match(/\b[a-z]{2,8}_[a-z0-9_]{4,}\b/gi);
  if (ids) for (const id of ids) hints.push(id);
  return Array.from(new Set(hints.map((h) => h.trim()))).slice(0, 5);
}

export function deterministicClassify(prompt: string): {
  verb: IntentVerb;
  kind: IntentKind;
  hints: string[];
} {
  const p = (prompt ?? "").trim();
  if (!p) return { verb: "trivial", kind: "unknown", hints: [] };
  let verb: IntentVerb = "other";
  for (const [v, re] of VERB_KEYWORDS) {
    if (re.test(p)) {
      verb = v;
      break;
    }
  }
  let kind: IntentKind = "unknown";
  for (const [k, re] of KIND_KEYWORDS) {
    if (re.test(p)) {
      kind = k;
      break;
    }
  }
  return { verb, kind, hints: extractEntityHints(p) };
}

function tierForVerb(verb: IntentVerb): IntentTier {
  // Oct 2026 audit: every turn runs on Sonnet. Reads on Haiku were the
  // source of the thin, wrong and "let me try another approach" answers the
  // live tests showed; the read-side cost is recovered by prompt caching.
  // ATELIER_CLI_READ_TIER=haiku restores the old split for experiments.
  if (process.env.ATELIER_CLI_READ_TIER === "haiku") {
    if (verb === "read" || verb === "trivial" || verb === "reset" || verb === "other") return "haiku";
  }
  return "sonnet";
}

function labelForVerb(verb: IntentVerb): string {
  if (verb === "create" || verb === "update" || verb === "link" || verb === "delete") return "write";
  if (verb === "transition") return "transition";
  if (verb === "read") return "read";
  if (verb === "reset") return "reset";
  if (verb === "trivial") return "trivial";
  return "other";
}

const ROUTER_SYSTEM = [
  "You are an intent router for a CRM/PSA chat orchestrator.",
  'Reply with ONE JSON object on a single line, with no prose, exactly matching:',
  '{"verb":"read|create|update|link|transition|delete|reset|trivial|other",',
  ` "kind":"${INTENT_KINDS.join("|")}",`,
  ' "entityHints":["..."],',
  ' "confidence":0.0}',
  "Use `transition` ONLY for moving an opportunity across pipeline stages.",
  "Use `unknown` for `kind` when no entity is named or clearly implied.",
  "Keep entityHints to fuzzy fragments the user typed (e.g. names, ids).",
].join("\n");

const RouterOutputSchema = z
  .object({
    verb: z.enum([
      "read",
      "create",
      "update",
      "link",
      "transition",
      "delete",
      "reset",
      "trivial",
      "other",
    ]),
    kind: z.enum(INTENT_KINDS),
    entityHints: z.array(z.string().min(1).max(200)).max(5),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export async function classifyIntentTyped(
  prompt: string,
  surface: string = "global",
  opts?: {
    orgId?: string;
    /**
     * Task #681 — explicit clarification-answer turns don't need the
     * live model (the turn resumes a paused tool; the classification is
     * pure bookkeeping). Skip the network call entirely and use the
     * deterministic keyword classifier.
     */
    deterministicOnly?: boolean;
  },
): Promise<Intent> {
  const det = deterministicClassify(prompt);
  const fallback = (model: string, costUsd = 0, tokensIn = 0, tokensOut = 0): Intent => ({
    verb: det.verb,
    kind: det.kind,
    entityHints: det.hints,
    surface,
    tier: tierForVerb(det.verb),
    confidence: 0.4,
    label: labelForVerb(det.verb),
    model,
    tokensIn,
    tokensOut,
    costUsd,
  });
  // Oct 2026 audit: ATELIER_CLI_CLASSIFIER=off skips the Haiku pre-call and
  // uses the keyword classifier only. With the full tool menu and Sonnet on
  // every turn the classifier's remaining job is the verb (read/write) and
  // entity hints, which the deterministic path covers for most prompts.
  if (opts?.deterministicOnly || !opts?.orgId || process.env.ATELIER_CLI_CLASSIFIER === "off") {
    return fallback(`${HAIKU_MODEL} (deterministic-only)`);
  }
  // Task #681 — the classifier is advisory bookkeeping; it must never
  // kill a turn. Two attempts (15s cutoff each) against the live model,
  // then degrade to the deterministic keyword classifier with lowered
  // confidence. The previous 5s single-shot hard-fail aborted turns
  // constantly under normal proxy latency.
  // Oct 2026 audit — the classifier runs BEFORE the turn clock starts, so
  // its stalls were invisible in `latencyMs` yet the user waited: on the
  // repaired build one request in four spent ~40 s here (15 s × 2 attempts
  // + jitter) before the deterministic fallback kicked in. The classifier
  // now has one 5 s attempt; a stall costs at most 5 s and the keyword
  // classifier takes over. With every turn on Sonnet the classifier only
  // supplies the verb and entity hints, which the fallback also provides.
  const rawTimeout = Number(process.env.ATELIER_CLI_CLASSIFIER_TIMEOUT_MS ?? 5_000);
  // Clamp: NaN/0/negative env values must not produce an instant abort.
  const CLASSIFIER_TIMEOUT_MS =
    Number.isFinite(rawTimeout) && rawTimeout >= 100 ? rawTimeout : 5_000;
  const ATTEMPTS = Math.max(1, Number(process.env.ATELIER_CLI_CLASSIFIER_ATTEMPTS ?? 1));
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    const { anthropic } = await getPrivacyAuthorizedAnthropic({
      // Same declaration as modelStep (see index.ts): the user's prompt may
      // hold a 12+ digit reference; Anthropic is allow-listed for RESTRICTED.
      dataClasses: ["confidential", "restricted"],
      orgId: opts.orgId,
      capabilityId: "meta.intent_classifier",
      model: HAIKU_MODEL,
    });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CLASSIFIER_TIMEOUT_MS);
    try {
      const resp = await anthropic.messages.create(
        {
          model: HAIKU_MODEL,
          max_tokens: 200,
          system: ROUTER_SYSTEM,
          messages: [{ role: "user", content: prompt }],
        },
        { signal: ac.signal },
      );
      const raw = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) {
        throw new Error(
          `intent-router: classifier model ${resp.model ?? HAIKU_MODEL} returned no parseable JSON object.`,
        );
      }
      const parsed = RouterOutputSchema.parse(JSON.parse(m[0]));
      const verb = parsed.verb;
      const kind = parsed.kind;
      const hints = parsed.entityHints.length > 0 ? parsed.entityHints : det.hints;
      const tokensIn = resp.usage.input_tokens;
      const tokensOut = resp.usage.output_tokens;
      const costUsd = (tokensIn * 1 + tokensOut * 5) / 1_000_000;
      return {
        verb,
        kind,
        entityHints: hints,
        surface,
        tier: tierForVerb(verb),
        confidence: parsed.confidence,
        label: labelForVerb(verb),
        model: resp.model ?? HAIKU_MODEL,
        tokensIn,
        tokensOut,
        costUsd,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    lastErr = err;
    // Transient failure (timeout/abort/network/5xx) — retry once, then
    // degrade. Log loudly on every failed attempt so ops can see the
    // classifier flaking even though turns keep working.
    console.error(
      `[intent-router] live classifier (${HAIKU_MODEL}) attempt ${attempt}/${ATTEMPTS} failed — ${(err as { message?: string })?.message ?? String(err)}`,
    );
  }
  }
  // Both attempts failed — degrade to the deterministic keyword
  // classifier (confidence 0.4) instead of erroring the whole turn.
  console.error(
    `[intent-router] live classifier unavailable after ${ATTEMPTS} attempts; using deterministic fallback — ${(lastErr as { message?: string })?.message ?? String(lastErr)}`,
  );
  return fallback(`${HAIKU_MODEL} (deterministic-fallback)`);
}

/** Compact textual representation of an Intent for embedding queries. */
export function intentToQueryString(intent: Intent, prompt: string): string {
  const parts = [
    intent.verb !== "other" ? intent.verb : "",
    intent.kind !== "unknown" ? intent.kind : "",
    intent.entityHints.join(" "),
    prompt,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 500);
}
