/**
 * STUB — minimal extract of the Atelier chat orchestrator's `index.ts`.
 *
 * The real file (~2700 lines) contains the full chat orchestrator. The
 * travel modules only need the types + two pure sanitizer helpers below,
 * all copied VERBATIM from the original so behaviour is identical.
 *
 * When integrating into your own chat/agent stack, replace this file
 * with your own tool-registry types (or keep it as-is).
 */

export type CliFrame = Record<string, unknown>;

export interface CliPersona {
  id: string;
  name: string;
  role: string;
  orgId: string;
}

export interface ToolContext {
  persona: CliPersona;
  turnId: string;
  sessionId: string;
  /** Task #581 — validated device timezone for this turn (IANA). Absent
   * on confirm replays, where the pending input carries `tz` instead. */
  timezone?: string;
  /** Step index used for idempotency keys + partial-success bookkeeping. */
  stepIdx: number;
  /**
   * Emit a live progress update for the current turn. Set by `runTurn` so any
   * tool — and any agent it dispatches (via the ambient progress sink) — can
   * stream a growing step list to the UI instead of a frozen "Thinking…".
   */
  progress?: (
    pct: number,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Anthropic tool-use input schema (JSON Schema). */
  input_schema: Record<string, unknown>;
  /** True = mutation. Mutations route through the confirm protocol. */
  isWrite: boolean;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolResult {
  ok: boolean;
  /** Free-form result returned to the model + UI. */
  data?: unknown;
  /** When ok=false: short machine code (e.g. "ambiguous", "not_found"). */
  errorCode?: string;
  errorMessage?: string;
  /** When set, the orchestrator emits `needs_disambiguation` and stops. */
  disambiguation?: { kind: string; options: Array<Record<string, unknown>> };
  /** When set, the orchestrator emits `needs_confirmation` and stops. */
  confirmation?: {
    summary: string;
    diff: Record<string, unknown>;
    /** The exact pending mutation to replay on confirm. */
    pending: { tool: string; input: Record<string, unknown> };
  };
  /**
   * Task #340 — when set, the orchestrator emits a `needs_clarification`
   * SSE frame and pauses the turn `awaiting_clarification`. The next
   * user message is treated as the missing field's value and re-merged
   * into `partial` before re-invoking the originating tool.
   */
  clarification?: {
    field: string;
    question: string;
    tool: string;
    partial?: Record<string, unknown>;
    suggestions?: Array<{ id: string; label: string; hint?: string }>;
    /**
     * Multi-field clarification: the full list of missing fields, each
     * with a machine name (merged into the resumed args), a
     * human-readable label, and an optional hint. When more than one
     * entry is present the client renders one labeled input per field
     * so the user can answer everything in a single round-trip. The
     * single-field `field`/`question` pair above remains authoritative
     * for backward compatibility (and MUST name the first entry).
     */
    fields?: Array<{
      field: string;
      label: string;
      hint?: string;
      /**
       * Task #291 / #706 — richer clarification inputs, mirrored in
       * `@workspace/chat-core` ClarificationField: `options` renders a
       * dropdown, `inputType: "date"` a date picker, `defaultValue`
       * pre-fills the input. Long-standing emitters (contract_prepare,
       * travel tools) rely on these being part of the contract.
       */
      inputType?: "date" | string;
      options?: string[];
      defaultValue?: string;
    }>;
  };
  /**
   * Task #340 — graceful refusal envelope. The orchestrator emits a
   * `refusal` frame that the client renders with a "Request this
   * capability" CTA bound to meta.request_feature.
   */
  refusal?: {
    reason: string;
    closestCapabilityId?: string | null;
    pageHref?: string | null;
    suggestion?: string | null;
  };
  /**
   * Task #24 — deferred post-commit work (e.g. Pursuit Scout after an
   * opportunity create). The orchestrator emits the tool_result/final
   * frames FIRST, then awaits this closure and emits the frame it
   * returns, so slow follow-up work never delays the success feedback.
   * The write is already committed when this runs; a failure here is
   * surfaced as a frame, never a rollback. Not persisted by the
   * idempotency job (only `data` is), so replays skip it by design.
   */
  after?: () => Promise<CliFrame | null>;
}

/** Validate an untrusted `fields` array from a persisted frame/body. */
export function sanitizeClarificationFields(
  raw: unknown,
): Array<{
  field: string;
  label: string;
  hint?: string;
  inputType?: string;
  options?: string[];
  defaultValue?: string;
  planner?: Record<string, unknown>;
}> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{
    field: string;
    label: string;
    hint?: string;
    inputType?: string;
    options?: string[];
    defaultValue?: string;
    planner?: Record<string, unknown>;
  }> = [];
  for (const f of raw.slice(0, 40)) {
    if (!f || typeof f !== "object") continue;
    const o = f as {
      field?: unknown;
      label?: unknown;
      hint?: unknown;
      inputType?: unknown;
      options?: unknown;
      defaultValue?: unknown;
      planner?: unknown;
    };
    if (typeof o.field !== "string" || o.field.length === 0) continue;
    // Task #721 — preserve rich-input props (date pickers, dropdowns,
    // prefills) through clarification rehydration; stripping them broke
    // restored travel date-picker cards.
    const options = Array.isArray(o.options)
      ? o.options.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 40)
      : null;
    // Task #745 — preserve the flight-planner prefill through
    // clarification rehydration (validated structurally); stripping it
    // would break restored planner cards the same way #721's date
    // pickers broke.
    const planner = sanitizePlannerMeta(o.planner);
    out.push({
      field: o.field,
      label: typeof o.label === "string" && o.label.length > 0 ? o.label : o.field,
      ...(typeof o.hint === "string" && o.hint.length > 0 ? { hint: o.hint } : {}),
      ...(typeof o.inputType === "string" && o.inputType.length > 0
        ? { inputType: o.inputType }
        : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(typeof o.defaultValue === "string" && o.defaultValue.length > 0
        ? { defaultValue: o.defaultValue }
        : {}),
      ...(planner ? { planner } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Task #745 — structural validation for the untrusted flight-planner
 * prefill riding on a clarification field. Keeps only the documented
 * shape (tripType / segments[{origin,destination,date}] / adults /
 * cabinClass) with string-typed leaves; anything malformed is dropped
 * wholesale so a poisoned frame can't smuggle arbitrary payloads.
 */
export function sanitizePlannerMeta(
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const tripType = typeof o.tripType === "string" ? o.tripType : "";
  if (!["return", "one_way", "multi_city"].includes(tripType)) return null;
  if (!Array.isArray(o.segments)) return null;
  const airport = (v: unknown): Record<string, unknown> | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const a = v as Record<string, unknown>;
    return {
      text: typeof a.text === "string" ? a.text.slice(0, 120) : "",
      iata:
        typeof a.iata === "string" && /^[A-Za-z]{3}$/.test(a.iata)
          ? a.iata.toUpperCase()
          : null,
      label: typeof a.label === "string" ? a.label.slice(0, 160) : null,
    };
  };
  const segments: Array<Record<string, unknown>> = [];
  for (const s of o.segments.slice(0, 8)) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    const seg = s as Record<string, unknown>;
    const origin = airport(seg.origin);
    const destination = airport(seg.destination);
    if (!origin || !destination) return null;
    segments.push({
      origin,
      destination,
      date:
        typeof seg.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(seg.date)
          ? seg.date
          : "",
    });
  }
  if (segments.length === 0) return null;
  const adultsNum = Number(o.adults);
  const adults =
    Number.isInteger(adultsNum) && adultsNum >= 1 && adultsNum <= 9
      ? adultsNum
      : 1;
  const cabinClass =
    typeof o.cabinClass === "string" &&
    ["economy", "premium_economy", "business", "first"].includes(o.cabinClass)
      ? o.cabinClass
      : "economy";
  return { tripType, segments, adults, cabinClass };
}

/**
 * Task #410 — does a persisted frames array contain a `needs_clarification`
 * frame? Used to treat a turn that ASKED a question but then hit a later
 * in-turn failure (e.g. classifier abort → status `error`) as resumable:
 * the user saw the question, so their answer must still continue it.
 */
export function framesContainClarification(frames: unknown): boolean {
  if (!Array.isArray(frames)) return false;
  return frames.some(
    (f) => (f as { type?: string } | null)?.type === "needs_clarification",
  );
}
