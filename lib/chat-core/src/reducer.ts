/**
 * Task #643 — shared frame → turn-state reducer. Pure and hook-free so
 * it runs identically in the browser (web CLI), Hermes (mobile), and
 * Node (tests).
 *
 * Semantics are the union of the two previous per-client reducers:
 *   - web: rich trace entries (sources/phase collapse), navigateTo
 *     lifting, proposed plans, refusal/recap/partial/async states.
 *   - mobile: narration accumulates into `text`, serverTurnId is
 *     captured from ANY frame carrying one (so a clarification answer
 *     carries continuesTurnId even after an in-turn error), and a
 *     `final` result backfills empty text.
 */
import { isSafeHttpUrl } from "./parse";
import type {
  ChatClarificationField,
  ChatClarification,
  ChatFrame,
  ChatNavigateTo,
  ChatPendingConfirmation,
  ChatPlanStep,
  ChatResultCard,
  ChatTurnCore,
  ChatTurnStatus,
} from "./types";

function liftNavigateTo(v: unknown): ChatNavigateTo | null {
  if (!v || typeof v !== "object") return null;
  const nav = v as { path?: unknown; when?: unknown };
  if (
    typeof nav.path === "string" &&
    (nav.when === "on_propose" || nav.when === "on_commit")
  ) {
    return { path: nav.path, when: nav.when };
  }
  return null;
}

export function applyFrame<T extends ChatTurnCore>(turn: T, frame: ChatFrame): T {
  // Capture the server turn id from ANY frame that carries one
  // (needs_clarification, final, replay-final, in-flight error…), not
  // only the happy-path `final` frame. Without this, a turn whose
  // orchestration partially failed after asking a clarification leaves
  // `serverTurnId` unset and the answer is re-routed as a fresh prompt.
  const rawTurnId = (frame.data as { turnId?: unknown }).turnId;
  if (typeof rawTurnId === "string" && rawTurnId.length > 0) {
    turn = { ...turn, serverTurnId: rawTurnId };
  }

  switch (frame.type) {
    case "narration": {
      const text = String((frame.data as { text?: string }).text ?? "");
      return {
        ...turn,
        status: "streaming",
        text: turn.text + text,
        trace: [...turn.trace, { kind: "narration", text, at: frame.receivedAt }],
      };
    }
    case "plan_step": {
      // The orchestrator emits `{step, hasTool}` for every model step;
      // skip frames with no human-readable label entirely — noise.
      const d = frame.data as { index?: number; label?: string; step?: number };
      if (!d.label || !String(d.label).trim()) {
        return { ...turn, status: "streaming" };
      }
      const idx = d.index ?? d.step;
      const prefix = typeof idx === "number" ? `${idx}. ` : "";
      return {
        ...turn,
        status: "streaming",
        trace: [
          ...turn.trace,
          { kind: "step", text: `${prefix}${d.label}`, at: frame.receivedAt },
        ],
      };
    }
    case "tool_call": {
      const d = frame.data as { tool?: string };
      return {
        ...turn,
        status: "streaming",
        trace: [
          ...turn.trace,
          { kind: "tool", text: `→ ${d.tool ?? "tool"}`, at: frame.receivedAt },
        ],
      };
    }
    case "progress": {
      // Live sub-step from an agent the orchestrator dispatched (web
      // search, pricing phases, etc.). Render as a breadcrumb step.
      const d = frame.data as {
        pct?: number;
        message?: string;
        phase?: string;
        sources?: Array<{ url?: string; title?: string }>;
      };
      const message = String(d.message ?? "").trim();
      if (!message) return { ...turn, status: "streaming" };
      const phase = typeof d.phase === "string" ? d.phase : undefined;
      const sources = Array.isArray(d.sources)
        ? d.sources
            .filter((s): s is { url: string; title?: string } => typeof s?.url === "string")
            .map((s) => ({ url: s.url, title: typeof s.title === "string" ? s.title : undefined }))
            // Source URLs come from untrusted web-search results — only
            // keep safe http(s) links so a malicious scheme can never
            // become a clickable anchor downstream.
            .filter((s) => isSafeHttpUrl(s.url))
        : undefined;
      const newStep = {
        kind: "step" as const,
        text: message,
        at: frame.receivedAt,
        ...(phase ? { phase } : {}),
        ...(sources && sources.length ? { sources } : {}),
      };
      // Heartbeat phases emit a fresh line every couple seconds.
      // Collapse consecutive same-phase heartbeats into one updating row.
      const last = turn.trace[turn.trace.length - 1];
      if (phase && last && last.kind === "step" && last.phase === phase) {
        return { ...turn, status: "streaming", trace: [...turn.trace.slice(0, -1), newStep] };
      }
      return { ...turn, status: "streaming", trace: [...turn.trace, newStep] };
    }
    case "tool_result": {
      const d = frame.data as {
        tool?: string;
        ok?: boolean;
        data?: unknown;
        errorCode?: string;
        errorMessage?: string;
        prelude?: boolean;
      };
      const tool = d.tool ?? "tool";
      const ok = d.ok !== false;
      // Any tool result may carry a `navigateTo` hint in its data
      // payload. Lift the first valid hint we see onto the turn so the
      // client's stream consumer can fire onNavigate.
      let nextNavigateTo = turn.navigateTo ?? null;
      if (ok && d.data && typeof d.data === "object") {
        const lifted = liftNavigateTo((d.data as { navigateTo?: unknown }).navigateTo);
        if (lifted) nextNavigateTo = lifted;
      }
      // Task #645 — never stack two identical cards for one action: drop
      // a tool_result whose tool + outcome + payload already exist on this
      // turn (confirm replays / server re-emits). The trace tick is still
      // appended so the activity breadcrumb stays honest.
      const isDuplicate = (turn.toolResults ?? []).some((prev) => {
        if (prev.tool !== tool || prev.ok !== ok) return false;
        if ((prev.errorCode ?? null) !== (d.errorCode ?? null)) return false;
        try {
          return JSON.stringify(prev.data ?? null) === JSON.stringify(d.data ?? null);
        } catch {
          return false;
        }
      });
      if (isDuplicate) {
        return {
          ...turn,
          navigateTo: nextNavigateTo,
          trace: [
            ...turn.trace,
            { kind: "tool", text: `${ok ? "✓" : "✗"} ${tool}`, at: frame.receivedAt },
          ],
        };
      }
      return {
        ...turn,
        navigateTo: nextNavigateTo,
        trace: [
          ...turn.trace,
          { kind: "tool", text: `${ok ? "✓" : "✗"} ${tool}`, at: frame.receivedAt },
        ],
        toolResults: [
          ...(turn.toolResults ?? []),
          {
            tool,
            ok,
            data: d.data,
            errorCode: d.errorCode,
            errorMessage: d.errorMessage,
            ...(d.prelude === true ? { prelude: true } : {}),
          },
        ],
      };
    }
    case "proposed_plan": {
      const steps = ((frame.data as { steps?: ChatPlanStep[] }).steps ?? []) as ChatPlanStep[];
      return { ...turn, status: "streaming", proposedPlan: steps };
    }
    case "needs_disambiguation": {
      const d = frame.data as {
        kind?: string;
        options?: Array<Record<string, unknown>>;
      };
      const options = Array.isArray(d.options)
        ? d.options
            .filter(
              (o): o is { id: string; label: string; hint?: string; secondary?: string } =>
                !!o && typeof o.id === "string" && typeof o.label === "string",
            )
            .map((o) => ({
              id: o.id,
              label: o.label,
              ...(typeof o.hint === "string" && o.hint ? { hint: o.hint } : {}),
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
    case "needs_confirmation": {
      const d = frame.data as unknown as ChatPendingConfirmation & {
        diff?: { navigateTo?: unknown } | null;
      };
      // propose_write embeds a proposal-time navigateTo inside
      // `diff.navigateTo`. Lift it onto the turn so the chat can land
      // on the context page while the user reviews the confirm card.
      let nextNavigateTo = turn.navigateTo ?? null;
      const lifted = liftNavigateTo(d.diff?.navigateTo);
      if (lifted) nextNavigateTo = lifted;
      return {
        ...turn,
        status: "needs_confirmation",
        pending: d,
        proposedPlan: d.steps ?? turn.proposedPlan,
        navigateTo: nextNavigateTo,
      };
    }
    case "needs_clarification": {
      const d = frame.data as {
        field?: string;
        question?: string;
        tool?: string;
        partial?: Record<string, unknown>;
        suggestions?: Array<{ id: string; label: string; hint?: string }>;
        fields?: ChatClarificationField[];
      };
      return {
        ...turn,
        status: "needs_clarification",
        clarification: {
          field: d.field ?? "value",
          question: d.question ?? "",
          tool: d.tool ?? "",
          partial: d.partial ?? {},
          suggestions: d.suggestions ?? [],
          fields: Array.isArray(d.fields) ? d.fields : [],
        },
      };
    }
    case "refusal": {
      const d = frame.data as {
        reason?: string;
        closestCapabilityId?: string | null;
        pageHref?: string | null;
        suggestion?: string | null;
        requestCapability?: { tool: string; prompt: string };
      };
      return {
        ...turn,
        refusal: {
          reason: d.reason ?? "Not available on the CLI surface.",
          closestCapabilityId: d.closestCapabilityId ?? null,
          pageHref: d.pageHref ?? null,
          suggestion: d.suggestion ?? null,
          requestCapability: d.requestCapability,
        },
      };
    }
    case "proactive_recap": {
      const d = frame.data as {
        summary?: string;
        turnCount?: number;
        dormantMs?: number;
        entities?: Array<{ kind: string; id: string; label: string }>;
      };
      return {
        ...turn,
        proactiveRecap: {
          summary: d.summary ?? "",
          turnCount: d.turnCount ?? 0,
          dormantMs: d.dormantMs,
          entities: d.entities ?? [],
        },
      };
    }
    case "async_dispatched": {
      const d = frame.data as { jobId?: string; turnId?: string };
      return {
        ...turn,
        status: "async_handoff",
        asyncJob: { jobId: d.jobId ?? "", turnId: d.turnId ?? "" },
      };
    }
    case "partial_success": {
      const d = frame.data as {
        completedSteps?: number;
        failedStepIndex?: number;
        error?: string;
        stepResults?: Array<{
          index: number;
          status: "success" | "error" | "skipped" | "pending";
          error?: string | null;
        }>;
      };
      return {
        ...turn,
        status: "partial",
        partial: {
          completedSteps: d.completedSteps ?? 0,
          failedStepIndex: d.failedStepIndex ?? -1,
          error: d.error ?? "Step failed",
          stepResults: d.stepResults,
        },
      };
    }
    case "final": {
      const d = frame.data as {
        status?: string;
        turnId?: string;
        sessionId?: string;
        result?: ChatResultCard;
      };
      // The server emits a `final` frame after every terminal *and*
      // after every interactive pause. The orchestrator's status enum
      // (`success` | `awaiting_confirmation` | `partial` | `cancelled` |
      // `error` | `async_dispatched` | `read_only_no_op`) does not 1:1
      // match the client's status enum, so we map explicitly.
      const ss = d.status;
      let next: ChatTurnStatus;
      if (ss === "awaiting_confirmation") next = "needs_confirmation";
      else if (ss === "awaiting_clarification") next = "needs_clarification";
      else if (ss === "async_dispatched") next = "async_handoff";
      else if (ss === "partial" && turn.status === "needs_disambiguation") {
        // The server reports "partial" for disambiguation pauses;
        // preserve the interactive state.
        next = "needs_disambiguation";
      } else if (ss === "partial") next = "partial";
      else if (ss === "cancelled") next = "cancelled";
      else if (ss === "error") next = "error";
      else if (turn.status === "needs_disambiguation") next = "needs_disambiguation";
      else next = "complete";
      // Backfill an empty reply body from the result card so history
      // and text-first renderers always have something to show.
      let text = turn.text;
      if (d.result && !text.trim()) {
        text = [d.result.title, d.result.summary].filter(Boolean).join("\n\n");
      }
      return {
        ...turn,
        status: next,
        text,
        serverTurnId: d.turnId ?? turn.serverTurnId,
        result: d.result ?? turn.result,
      };
    }
    case "budget_exceeded":
    case "error": {
      const d = frame.data as { code?: string; message?: string };
      return {
        ...turn,
        status: "error",
        error: { code: d.code ?? frame.type, message: d.message ?? "Unknown error" },
      };
    }
    default:
      return turn;
  }
}

/**
 * Resolve the input fields a clarification card should render.
 *
 * When the server sent an explicit multi-field (or rich single-field)
 * `fields` array it passes through untouched. Otherwise a single field
 * is fabricated from the top-level `field`/`suggestions`: the question
 * is already the card headline, so the fabricated field carries NO
 * label, and suggestion chips ({id,label}) become tappable `choices`
 * (submitting the id) instead of a free-text box.
 */
export function resolveClarificationFields(
  clarification: ChatClarification,
): ChatClarificationField[] {
  const explicit = clarification.fields;
  if (Array.isArray(explicit) && explicit.length > 0) return explicit;
  const choices = Array.isArray(clarification.suggestions)
    ? clarification.suggestions
        .filter(
          (s): s is { id: string; label: string } =>
            !!s &&
            typeof s.id === "string" &&
            s.id.length > 0 &&
            typeof s.label === "string" &&
            s.label.length > 0,
        )
        .map((s) => ({ id: s.id, label: s.label }))
    : [];
  return [
    {
      field: clarification.field || "value",
      label: "",
      ...(choices.length > 0 ? { choices } : {}),
    },
  ];
}

/**
 * Reset the streamed output of a turn before re-streaming into the
 * same key (clarification answer resubmit, two-phase confirm). Keeping
 * old text/trace/toolResults made every re-streamed turn APPEND
 * duplicate narration and stack duplicate result cards.
 */
export function resetForRestream<T extends ChatTurnCore>(turn: T): T {
  return {
    ...turn,
    status: "streaming",
    pending: undefined,
    clarification: undefined,
    text: "",
    trace: [],
    toolResults: [],
    result: undefined,
    error: undefined,
    errorKind: undefined,
    reconnecting: false,
  };
}
