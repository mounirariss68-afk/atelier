/**
 * Pure SSE-frame parsing + per-turn reducer for the mobile chat.
 * Extracted from useChat.ts (Task #410) so the reducer can be unit
 * tested under Node without pulling in expo/react-native modules.
 */

export interface ClarificationChoice {
  id: string;
  label: string;
}

export interface ClarificationField {
  field: string;
  label: string;
  hint?: string;
  options?: string[];
  /** Server-provided suggestion chips ({id,label}) — submit the id. */
  choices?: ClarificationChoice[];
  inputType?: string;
  defaultValue?: string;
}

export interface PendingConfirmation {
  turnId?: string;
  title?: string;
  summary?: string;
  capability?: string;
  requiresTypedName?: boolean;
  entityName?: string;
  steps?: { label?: string }[];
  [k: string]: unknown;
}

export interface ResultCard {
  title: string;
  summary?: string;
}

export interface ToolResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  prelude?: boolean;
}

export type TurnStatus =
  | "streaming"
  | "complete"
  | "error"
  | "cancelled"
  | "needs_clarification"
  | "needs_confirmation"
  | "needs_disambiguation";

export interface DisambigOption {
  id: string;
  label: string;
  secondary?: string;
}

export interface Trace {
  kind: string;
  text: string;
}

export interface ChatTurn {
  key: string;
  prompt: string;
  attachments?: { id: string; name: string }[];
  status: TurnStatus;
  text: string;
  trace: Trace[];
  clarification?: { question: string; fields: ClarificationField[] };
  /** Task #567 — "which one did you mean?" options (roster/meeting matches). */
  disambig?: { kind: string; options: DisambigOption[] };
  pending?: PendingConfirmation;
  result?: ResultCard;
  toolResults: ToolResult[];
  serverTurnId?: string;
  error?: string;
  /** Set when the error is a transient connectivity failure (proxy 502/503/network) so the UI can show a friendly message. */
  errorKind?: "network";
  /** True while the client is auto-retrying a transient failure. */
  reconnecting?: boolean;
}

export function parseFrame(
  block: string,
): { type: string; data: Record<string, unknown> } | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const raw of block.split(/\r?\n/)) {
    if (raw.startsWith("event:")) event = raw.slice(6).trim();
    else if (raw.startsWith("data:")) dataLines.push(raw.slice(5).trim());
  }
  if (!event) return null;
  let data: Record<string, unknown> = {};
  if (dataLines.length > 0) {
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      data = { _raw: dataLines.join("\n") };
    }
  }
  return { type: event, data };
}

export function applyFrame(
  turn: ChatTurn,
  type: string,
  data: Record<string, unknown>,
): ChatTurn {
  // Task #410 — capture the server turn id from ANY frame that carries
  // one (needs_clarification, final, replay-final, in-flight error…),
  // not only the happy-path `final` frame. Without this, a turn whose
  // orchestration partially failed after asking a clarification leaves
  // `serverTurnId` unset, `continuesTurnId` is sent as null, and the
  // answer is re-routed as a fresh prompt — re-asking the question.
  const frameTurnId =
    typeof (data as { turnId?: unknown }).turnId === "string" &&
    ((data as { turnId?: string }).turnId as string).length > 0
      ? ((data as { turnId?: string }).turnId as string)
      : undefined;
  if (frameTurnId) turn = { ...turn, serverTurnId: frameTurnId };

  switch (type) {
    case "narration": {
      const text = String((data as { text?: string }).text ?? "");
      return { ...turn, status: "streaming", text: turn.text + text };
    }
    case "plan_step": {
      const d = data as { index?: number; label?: string; step?: number };
      if (!d.label?.trim()) return { ...turn, status: "streaming" };
      const idx = d.index ?? d.step;
      const prefix = typeof idx === "number" ? `${idx}. ` : "";
      return { ...turn, status: "streaming", trace: [...turn.trace, { kind: "step", text: `${prefix}${d.label}` }] };
    }
    case "progress": {
      const d = data as { message?: string };
      const message = String(d.message ?? "").trim();
      if (!message) return { ...turn, status: "streaming" };
      const last = turn.trace[turn.trace.length - 1];
      if (last && last.kind === "progress") {
        return { ...turn, status: "streaming", trace: [...turn.trace.slice(0, -1), { kind: "progress", text: message }] };
      }
      return { ...turn, status: "streaming", trace: [...turn.trace, { kind: "progress", text: message }] };
    }
    case "tool_result": {
      const d = data as {
        tool?: string;
        ok?: boolean;
        data?: unknown;
        errorCode?: string;
        errorMessage?: string;
        prelude?: boolean;
      };
      const ok = d.ok !== false;
      const tr: ToolResult = {
        tool: d.tool ?? "tool",
        ok,
        data: d.data,
        errorCode: d.errorCode,
        errorMessage: d.errorMessage,
        prelude: d.prelude === true,
      };
      return {
        ...turn,
        toolResults: [...turn.toolResults, tr],
        trace: [...turn.trace, { kind: "tool", text: `${ok ? "✓" : "✗"} ${tr.tool}` }],
      };
    }
    case "needs_clarification": {
      const d = data as {
        question?: string;
        field?: string;
        fields?: ClarificationField[];
        suggestions?: Array<{ id?: unknown; label?: unknown }>;
      };
      let fields: ClarificationField[];
      if (Array.isArray(d.fields) && d.fields.length > 0) {
        fields = d.fields;
      } else {
        // Task #410 — single-field clarification. The question is already
        // rendered as the card headline, so the fabricated field carries NO
        // label (previously it duplicated the full question). Map the
        // server's suggestion chips ({id,label}) so the user gets tappable
        // choices (submitting the id, e.g. "hq") instead of a free-text box.
        const choices = Array.isArray(d.suggestions)
          ? d.suggestions
              .filter(
                (s): s is { id: string; label: string } =>
                  !!s && typeof s.id === "string" && s.id.length > 0 &&
                  typeof s.label === "string" && s.label.length > 0,
              )
              .map((s) => ({ id: s.id, label: s.label }))
          : [];
        fields = [
          {
            field: d.field ?? "value",
            label: "",
            ...(choices.length > 0 ? { choices } : {}),
          },
        ];
      }
      return {
        ...turn,
        status: "needs_clarification",
        clarification: { question: d.question ?? "", fields },
      };
    }
    case "needs_confirmation": {
      return { ...turn, status: "needs_confirmation", pending: data as PendingConfirmation };
    }
    case "needs_disambiguation": {
      // Task #567 — previously unhandled on mobile (dead-end). Mirror
      // the web client: surface tappable options.
      const d = data as { kind?: string; options?: Array<Record<string, unknown>> };
      const options: DisambigOption[] = Array.isArray(d.options)
        ? d.options
            .filter(
              (o): o is { id: string; label: string; secondary?: string } =>
                !!o && typeof o.id === "string" && typeof o.label === "string",
            )
            .map((o) => ({
              id: o.id,
              label: o.label,
              ...(typeof o.secondary === "string" && o.secondary
                ? { secondary: o.secondary }
                : {}),
            }))
        : [];
      return {
        ...turn,
        status: "needs_disambiguation",
        disambig: { kind: d.kind ?? "entity", options },
      };
    }
    case "final": {
      const d = data as { status?: string; turnId?: string; result?: ResultCard };
      const ss = d.status;
      let next: TurnStatus;
      if (ss === "awaiting_confirmation") next = "needs_confirmation";
      else if (ss === "awaiting_clarification") next = "needs_clarification";
      else if (ss === "cancelled") next = "cancelled";
      else if (ss === "error") next = "error";
      else if (turn.status === "needs_disambiguation") {
        // Task #567 — the server reports "partial" for disambiguation
        // pauses; preserve the interactive state (mirrors web).
        next = "needs_disambiguation";
      } else next = "complete";
      let text = turn.text;
      if (d.result && !text.trim()) {
        text = [d.result.title, d.result.summary].filter(Boolean).join("\n\n");
      }
      return { ...turn, status: next, text, result: d.result ?? turn.result, serverTurnId: d.turnId ?? turn.serverTurnId };
    }
    case "budget_exceeded":
    case "error": {
      const d = data as { message?: string };
      return { ...turn, status: "error", error: d.message ?? "Unknown error" };
    }
    default:
      return turn;
  }
}
