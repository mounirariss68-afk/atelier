/**
 * Task #739 — verbatim replay of recent turns.
 *
 * The turn pipeline used to be stateless per turn: the model saw only a
 * one-line-per-turn rolling summary, a tiny entity draft, and the last
 * tool result. Facts stated two messages earlier (dates, names, amounts)
 * were genuinely absent, so the assistant re-asked answered questions.
 *
 * This module composes a token-budgeted, oldest-first-truncated verbatim
 * replay window from persisted turn rows. It is deliberately PURE over
 * already-fetched rows so the offline probe can exercise it without a DB;
 * the orchestrator does the (org/user-scoped) fetch.
 *
 * Budget model: chars as a cheap proxy for tokens (~4 chars/token).
 * The budget is PARTITIONED per section (prompt / assistant prose / tool
 * digests) with a hard total cap, so one pathological turn can never
 * evict the rest of the window.
 */

export interface ReplayTurnRow {
  prompt: string;
  status: string;
  /** Persisted SSE frame trace for the turn (jsonb). */
  frames: unknown[];
  createdAt?: Date | string | null;
}

export interface ReplayBudget {
  /** Hard cap on total replayed chars across all turns. */
  totalChars: number;
  /** Per-turn cap on the replayed user prompt. */
  promptChars: number;
  /** Per-turn cap on the composed assistant reply (prose + questions). */
  assistantChars: number;
  /** Per-turn cap on EACH tool-result digest. */
  toolDigestChars: number;
  /** Per-turn cap on how many tool results get digested. */
  maxToolDigests: number;
  /** Max number of prior turns replayed verbatim. */
  maxTurns: number;
}

export const DEFAULT_REPLAY_BUDGET: ReplayBudget = {
  totalChars: Number(process.env.ATELIER_CLI_REPLAY_TOTAL_CHARS ?? 14_000),
  promptChars: 700,
  assistantChars: 1_000,
  toolDigestChars: 700,
  maxToolDigests: 4,
  maxTurns: Number(process.env.ATELIER_CLI_REPLAY_MAX_TURNS ?? 10),
};

export interface ReplayTelemetry {
  turnsAvailable: number;
  turnsIncluded: number;
  chars: number;
  /** True when any turn or section was cut by the budget. */
  truncated: boolean;
}

export interface ReplayMessage {
  role: "user" | "assistant";
  content: string;
}

const clip = (s: string, cap: number): { text: string; cut: boolean } =>
  s.length <= cap ? { text: s, cut: false } : { text: `${s.slice(0, Math.max(0, cap - 1))}…`, cut: true };

/**
 * Compact, size-capped digest of a tool result payload. Preserves the
 * scalar fields users refer back to (dates, names, totals, ids) and
 * summarizes arrays as "N items" plus the first items' labels; never
 * emits raw multi-KB payloads.
 */
export function digestToolResultData(data: unknown, cap: number): string {
  const parts: string[] = [];
  const scalar = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 119)}…` : v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  };
  const labelOf = (item: unknown): string | null => {
    if (typeof item !== "object" || item === null) return scalar(item);
    const o = item as Record<string, unknown>;
    for (const k of ["label", "title", "name", "summary", "id"]) {
      const s = scalar(o[k]);
      if (s) return s;
    }
    return null;
  };
  const walk = (v: unknown, prefix: string, depth: number): void => {
    if (parts.join("; ").length > cap * 1.5) return; // early exit, clipped later
    if (Array.isArray(v)) {
      const labels = v.slice(0, 3).map(labelOf).filter((x): x is string => !!x);
      parts.push(`${prefix}: ${v.length} item${v.length === 1 ? "" : "s"}${labels.length ? ` (${labels.join(", ")})` : ""}`);
      return;
    }
    if (typeof v === "object" && v !== null) {
      if (depth >= 2) return;
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const s = scalar(val);
        if (s !== null) parts.push(prefix ? `${prefix}.${k}=${s}` : `${k}=${s}`);
        else walk(val, prefix ? `${prefix}.${k}` : k, depth + 1);
      }
      return;
    }
    const s = scalar(v);
    if (s !== null) parts.push(prefix ? `${prefix}=${s}` : s);
  };
  walk(data, "", 0);
  return clip(parts.join("; "), cap).text;
}

interface FrameLike {
  type?: unknown;
  data?: unknown;
}

/**
 * Compose the assistant side of one replayed turn from its frame trace:
 * narration/text prose, clarification/confirmation questions, refusals,
 * and capped tool-result digests.
 */
export function composeAssistantReplay(
  frames: unknown[],
  budget: ReplayBudget,
): { text: string; truncated: boolean } {
  const prose: string[] = [];
  const toolBits: string[] = [];
  let truncated = false;
  let digests = 0;
  for (const raw of frames ?? []) {
    const f = raw as FrameLike;
    const d = (f?.data ?? {}) as Record<string, unknown>;
    switch (f?.type) {
      case "narration":
      case "text": {
        const t = typeof d.text === "string" ? d.text.trim() : "";
        if (t) prose.push(t);
        break;
      }
      case "needs_clarification": {
        const q =
          (typeof d.question === "string" && d.question) ||
          (typeof (d as { clarification?: { question?: string } }).clarification?.question === "string" &&
            (d as { clarification?: { question?: string } }).clarification?.question) ||
          "";
        prose.push(q ? `(asked) ${q}` : "(asked a clarifying question)");
        break;
      }
      case "needs_confirmation":
        prose.push("(asked the user to confirm a proposed write)");
        break;
      case "needs_disambiguation":
        prose.push("(asked the user to pick between candidates)");
        break;
      case "refusal": {
        const t = typeof d.message === "string" ? d.message : typeof d.text === "string" ? d.text : "";
        prose.push(t ? `(declined) ${clip(t, 200).text}` : "(declined the request)");
        break;
      }
      case "tool_result": {
        // Skip pre-LLM prelude echoes; keep real tool outcomes.
        if (d.prelude === true) break;
        if (digests >= budget.maxToolDigests) {
          truncated = true;
          break;
        }
        digests += 1;
        const tool = typeof d.tool === "string" ? d.tool : "tool";
        const ok = d.ok === true;
        const digest = ok
          ? digestToolResultData(d.data, budget.toolDigestChars)
          : clip(String(d.errorMessage ?? d.errorCode ?? "failed"), 200).text;
        toolBits.push(`[${tool} → ${ok ? "ok" : `error`}] ${digest}`.trim());
        break;
      }
      default:
        break;
    }
  }
  const joined = [...toolBits, ...prose].join("\n");
  const clipped = clip(joined || "(no visible reply)", budget.assistantChars);
  return { text: clipped.text, truncated: truncated || clipped.cut };
}

/**
 * Compose the verbatim replay window from prior turn rows.
 *
 * `rows` must be NEWEST-FIRST (as fetched with ORDER BY created_at DESC);
 * the composer accumulates newest-first under the budget — so when the
 * budget runs out it is the OLDEST turns that fall off — then reverses
 * into chronological order for the model.
 */
export function composeReplayFromTurns(
  rows: ReplayTurnRow[],
  budget: ReplayBudget = DEFAULT_REPLAY_BUDGET,
): { history: ReplayMessage[]; telemetry: ReplayTelemetry } {
  const pairs: Array<[ReplayMessage, ReplayMessage]> = [];
  let chars = 0;
  let truncated = false;
  for (const row of rows.slice(0, budget.maxTurns)) {
    if (!row || typeof row.prompt !== "string") continue;
    if (row.status === "streaming") continue; // concurrent/unfinished turn
    const p = clip(row.prompt.trim() || "(empty message)", budget.promptChars);
    const a = composeAssistantReplay(Array.isArray(row.frames) ? row.frames : [], budget);
    const cost = p.text.length + a.text.length;
    if (chars + cost > budget.totalChars) {
      truncated = true;
      break;
    }
    chars += cost;
    truncated = truncated || p.cut || a.truncated;
    pairs.push([
      { role: "user", content: p.text },
      { role: "assistant", content: a.text },
    ]);
  }
  if (rows.length > budget.maxTurns) truncated = true;
  pairs.reverse(); // chronological
  return {
    history: pairs.flat(),
    telemetry: {
      turnsAvailable: rows.length,
      turnsIncluded: pairs.length,
      chars,
      truncated,
    },
  };
}
