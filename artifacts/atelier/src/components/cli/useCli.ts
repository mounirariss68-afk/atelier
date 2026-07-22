/**
 * Task #333 — CLI state machine + SSE consumer.
 *
 * Wraps `fetch` against `/api/atelier/cli/*` and parses the
 * `event:`/`data:` SSE wire format into a typed `CliFrame`. The hook
 * owns one in-flight turn at a time; calling `submit` while another
 * turn is streaming aborts the previous one (consistent with what the
 * server idempotency key allows).
 *
 * The SSE parser deliberately stays tiny — no EventSource, no
 * dependency: EventSource doesn't allow custom POST bodies, and the
 * orchestrator emits one frame per `event:`/`data:` pair separated by
 * a blank line. We keep a buffer across `read()` chunks so multi-byte
 * UTF-8 (Arabic) and multi-chunk frames work.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CliFrame,
  CliFrameType,
  CliPendingConfirmation,
  CliPlanStep,
  CliResultCard,
  CliTurn,
  CliTurnStatus,
  CliLocale,
  CliCapability,
} from "./types";
import { localeInstruction } from "./locale";
import type { DerivedPageContext } from "./pageContext";

function uuid(): string {
  // Crypto-backed when available; falls back for old browsers in tests.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Task #581 — device IANA timezone sent with each turn so the server
 * interprets typed times ("move my 7am") the way the user sees them. */
function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * Only http(s) URLs are safe to render as clickable anchors. Source URLs
 * arrive from untrusted web-search results, so any other scheme (notably
 * `javascript:`) must be rejected before it can become an `href`.
 */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}

interface SubmitArgs {
  prompt: string;
  attachmentIds?: string[];
  pageContext?: DerivedPageContext | null;
  dryRun?: boolean;
  intent?: "read" | "write" | "reset" | null;
  /**
   * Task #184 — when answering a clarification card, the paused turn's
   * server id. Lets the server continue the original request even if
   * the session rolled over (e.g. the answer came hours later).
   */
  continuesTurnId?: string | null;
  /**
   * Multi-field clarification answers: map of clarification field name
   * → user-entered value, submitted alongside a human-readable prompt
   * so all missing fields resume in one round-trip.
   */
  clarificationValues?: Record<string, string> | null;
}

interface UseCliOptions {
  locale: CliLocale;
  onAsync?: (jobId: string, turnId: string) => void;
  /**
   * Task #495 — invoked when a frame for the active turn carries a
   * `navigateTo` hint that hasn't yet been applied. The hook calls
   * this once per unique destination per turn so the chat can drive
   * the app to the relevant screen automatically.
   */
  onNavigate?: (path: string, when: "on_propose" | "on_commit") => void;
}

/**
 * Task #24 — pure confirm-gate decision, exported for unit testing.
 * Decides what `confirm()` should do at click time:
 *   - "noop_in_flight": a confirm is already streaming — the click is a
 *     duplicate and must be ignored (never abort the in-flight confirm).
 *   - "wait_for_turn_id": the server turn id hasn't landed yet — defer
 *     the confirm until it does (with explicit feedback on timeout)
 *     instead of silently returning.
 *   - "start": proceed with the confirm request.
 */
export function confirmGate(args: {
  confirming: boolean;
  serverTurnId: string | null | undefined;
}): "noop_in_flight" | "wait_for_turn_id" | "start" {
  if (args.confirming) return "noop_in_flight";
  if (!args.serverTurnId) return "wait_for_turn_id";
  return "start";
}

/**
 * Task #24 — pure abort→status mapping, exported for unit testing.
 * An AbortError on the SSE stream only means "Cancelled" when the user
 * explicitly asked to cancel. Supersede aborts (a newer submit taking
 * the slot) and duplicate-confirm aborts must be dropped silently —
 * publishing "cancelled" for those was a client-side hallucination
 * while the server write might still be committing.
 */
export function abortOutcome(args: {
  isActiveTurn: boolean;
  userCancelRequested: boolean;
}): "publish_cancelled" | "drop" {
  if (!args.isActiveTurn) return "drop";
  return args.userCancelRequested ? "publish_cancelled" : "drop";
}

export interface UseCliReturn {
  sessionId: string | null;
  turns: CliTurn[];
  current: CliTurn | null;
  status: CliTurnStatus;
  /** Task #24 — true while a confirm request is in flight. Consumers
   * must disable the Confirm/Cancel actions and show an in-progress
   * indicator; `confirm()` itself is a no-op while this is true. */
  confirming: boolean;
  submit: (args: SubmitArgs) => Promise<void>;
  /**
   * Confirm a pending two-phase write. `typedName` is required when the
   * capability is `irreversible` (server enforces). `excludedStepIndexes`
   * is forwarded for downstream Task #334/#335 enforcement; the current
   * server confirm route ignores unknown fields, so this is forward-safe.
   */
  confirm: (
    typedName?: string,
    excludedStepIndexes?: number[],
    planEdits?: Record<number, string>,
  ) => Promise<void>;
  cancel: () => Promise<void>;
  pickDisambig: (optionId: string, optionLabel: string) => Promise<void>;
  toggleStepExclusion: (stepIndex: number) => void;
  /** Inline-edit a plan row's label on the in-flight turn. Persisted
   * via the `planEdits` map on the turn and forwarded to the server
   * with the confirm POST. */
  setPlanRowEdit: (stepIndex: number, label: string) => void;
  abort: () => void;
  reset: () => void;
  capabilities: CliCapability[];
  capabilitiesError: string | null;
  /** Server-reported catalog schemaVersion (Task #332); used for stale
   * detection on saved prompts so a save authored against v1 surfaces
   * a warning when the catalog rolls forward. */
  catalogSchemaVersion: number | null;
  /** Inject a historical turn (from /cli/sessions/:id) into the
   * transcript so deep-links like /cli?session=…&turn=… can land
   * directly on a result card. Idempotent on serverTurnId. */
  injectHistoricalTurn: (turn: CliTurn) => void;
  /** Task #484 — adopt an existing server session so the next
   * submit() continues it (same sessionId on POST /cli/turn) instead
   * of starting a fresh conversation. Clears the transcript like
   * reset() so the caller can re-inject the picked session's turns.
   * The server still applies its 30-minute inactivity rollover. */
  adoptSession: (sessionId: string) => void;
}

/** Parse one fully-buffered SSE message block into a `CliFrame`. */
function parseFrame(block: string): CliFrame | null {
  let event: CliFrameType | null = null;
  let dataLines: string[] = [];
  for (const raw of block.split(/\r?\n/)) {
    if (raw.startsWith("event:")) event = raw.slice(6).trim() as CliFrameType;
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
  return { type: event, data, receivedAt: Date.now() };
}

/**
 * Task #500 — Stream-consumer navigation gate, exported for unit
 * testing. Fires `onNavigate` exactly once per unique destination per
 * turn, and skips entirely when the stream is no longer active so a
 * stale turn cannot yank the user around after a newer submit().
 */
export function tryFireNavigation(args: {
  prevNavPath: string | null;
  navigateTo: { path: string; when: "on_propose" | "on_commit" } | null | undefined;
  isActive: () => boolean;
  onNavigate?: (path: string, when: "on_propose" | "on_commit") => void;
}): { navigatedTo: string | null; fired: boolean } {
  const { prevNavPath, navigateTo, isActive, onNavigate } = args;
  if (!isActive() || !navigateTo) {
    return { navigatedTo: prevNavPath, fired: false };
  }
  if (navigateTo.path === prevNavPath) {
    return { navigatedTo: prevNavPath, fired: false };
  }
  try {
    onNavigate?.(navigateTo.path, navigateTo.when);
  } catch {
    /* swallow — navigation must never break the stream */
  }
  return { navigatedTo: navigateTo.path, fired: true };
}

export function applyFrame(turn: CliTurn, frame: CliFrame): CliTurn {
  switch (frame.type) {
    case "narration": {
      const text = String((frame.data as { text?: string }).text ?? "");
      return {
        ...turn,
        status: "streaming",
        trace: [...turn.trace, { kind: "narration", text, at: frame.receivedAt }],
      };
    }
    case "plan_step": {
      // The orchestrator currently emits `{step, hasTool}` for every
      // model step; the bar rendered "?. " for those because the old
      // shape expected `{index, label}`. Skip frames with no
      // human-readable label entirely — they're noise.
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
        trace: [...turn.trace, { kind: "tool", text: `→ ${d.tool ?? "tool"}`, at: frame.receivedAt }],
      };
    }
    case "progress": {
      // Live sub-step from an agent the orchestrator dispatched (web search,
      // pricing phases, etc.). Render as a breadcrumb step.
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
            // Source URLs come from untrusted web-search results — only keep
            // safe http(s) links so a malicious scheme (e.g. javascript:)
            // can never become a clickable anchor downstream.
            .filter((s) => isSafeHttpUrl(s.url))
        : undefined;
      const newStep = {
        kind: "step" as const,
        text: message,
        at: frame.receivedAt,
        ...(phase ? { phase } : {}),
        ...(sources && sources.length ? { sources } : {}),
      };
      // Heartbeat phases (e.g. the long "Synthesising the brief… (Ns)" tail)
      // emit a fresh line every couple seconds. Collapse consecutive
      // same-phase heartbeats into one updating row instead of flooding the
      // breadcrumb trace — the row text + timer still tick live.
      const last = turn.trace[turn.trace.length - 1];
      if (phase && last && last.kind === "step" && last.phase === phase) {
        return {
          ...turn,
          status: "streaming",
          trace: [...turn.trace.slice(0, -1), newStep],
        };
      }
      return {
        ...turn,
        status: "streaming",
        trace: [...turn.trace, newStep],
      };
    }
    case "tool_result": {
      const d = frame.data as {
        tool?: string;
        ok?: boolean;
        data?: unknown;
        errorCode?: string;
        errorMessage?: string;
      };
      const tool = d.tool ?? "tool";
      const ok = d.ok !== false;
      // Task #499 — generalized from #495: any tool result may carry
      // a `navigateTo` hint in its data payload (read-side single-
      // entity resolves, ingest commits, approval commits, etc.).
      // Lift the first valid hint we see onto the turn so the hook's
      // stream consumer can fire onNavigate. Hint is optional/null
      // for capabilities that don't want to navigate.
      let nextNavigateTo = turn.navigateTo ?? null;
      if (ok && d.data && typeof d.data === "object") {
        const dd = d.data as { navigateTo?: { path?: string; when?: string } | null };
        if (
          dd.navigateTo &&
          typeof dd.navigateTo.path === "string" &&
          (dd.navigateTo.when === "on_propose" || dd.navigateTo.when === "on_commit")
        ) {
          nextNavigateTo = {
            path: dd.navigateTo.path,
            when: dd.navigateTo.when,
          };
        }
      }
      return {
        ...turn,
        navigateTo: nextNavigateTo,
        trace: [
          ...turn.trace,
          {
            kind: "tool",
            text: `${ok ? "✓" : "✗"} ${tool}`,
            at: frame.receivedAt,
          },
        ],
        // Task #348 — keep the raw payload so the renderer can lay out
        // a real chart instead of the JSON blob. We append in arrival
        // order so multi-step plans show their per-tool cards stacked.
        toolResults: [
          ...(turn.toolResults ?? []),
          {
            tool,
            ok,
            data: d.data,
            errorCode: d.errorCode,
            errorMessage: d.errorMessage,
          },
        ],
      };
    }
    case "proposed_plan": {
      const steps = ((frame.data as { steps?: CliPlanStep[] }).steps ?? []) as CliPlanStep[];
      return { ...turn, status: "streaming", proposedPlan: steps };
    }
    case "needs_disambiguation": {
      const d = frame.data as {
        kind?: string;
        options?: Array<{ id: string; label: string; hint?: string }>;
      };
      return {
        ...turn,
        status: "needs_disambiguation",
        disambig: { kind: d.kind ?? "entity", options: d.options ?? [] },
      };
    }
    case "needs_confirmation": {
      const d = frame.data as unknown as CliPendingConfirmation & {
        diff?: { navigateTo?: { path?: string; when?: string } | null } | null;
      };
      // Task #495 — propose_write embeds a proposal-time navigateTo
      // inside `diff.navigateTo`. Lift it onto the turn so the chat
      // can land on the context page while the user reviews the
      // confirm card.
      let nextNavigateTo = turn.navigateTo ?? null;
      const diffNav = d.diff?.navigateTo;
      if (
        diffNav &&
        typeof diffNav.path === "string" &&
        (diffNav.when === "on_propose" || diffNav.when === "on_commit")
      ) {
        nextNavigateTo = { path: diffNav.path, when: diffNav.when };
      }
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
        fields?: Array<{ field: string; label: string; hint?: string; options?: string[]; inputType?: "date"; defaultValue?: string }>;
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
        result?: CliResultCard;
      };
      // The server emits a `final` frame after every terminal *and*
      // after every interactive pause (needs_confirmation,
      // needs_disambiguation, async_dispatched). The orchestrator's
      // status enum (`success` | `awaiting_confirmation` | `partial` |
      // `cancelled` | `error` | `async_dispatched` | `read_only_no_op`)
      // does not 1:1 match the client's status enum, so we map
      // explicitly. Coercing to "complete" by default — as a previous
      // revision did — clobbers the interactive states the rest of
      // the UI keys off of.
      const ss = d.status;
      let next: CliTurnStatus;
      if (ss === "awaiting_confirmation") next = "needs_confirmation";
      else if (ss === "awaiting_clarification") next = "needs_clarification";
      else if (ss === "async_dispatched") next = "async_handoff";
      else if (ss === "partial") next = "partial";
      else if (ss === "cancelled") next = "cancelled";
      else if (ss === "error") next = "error";
      else if (turn.status === "needs_disambiguation") {
        // Server has no dedicated status string for this; preserve.
        next = "needs_disambiguation";
      } else {
        // success / read_only_no_op / undefined → terminal complete.
        next = "complete";
      }
      return {
        ...turn,
        status: next,
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

export function useCli(opts: UseCliOptions): UseCliReturn {
  const { locale, onAsync, onNavigate } = opts;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<CliTurn[]>([]);
  const [current, setCurrent] = useState<CliTurn | null>(null);
  const [capabilities, setCapabilities] = useState<CliCapability[]>([]);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [catalogSchemaVersion, setCatalogSchemaVersion] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /** Task #24 — mirrors the `confirming` state synchronously so a
   * rapid double-click is gated before React re-renders. */
  const confirmingRef = useRef(false);
  /** Task #24 — set only by an explicit user cancel/abort action.
   * consumeStream maps AbortError → "cancelled" ONLY when this is set;
   * supersede/duplicate aborts are dropped silently. */
  const userCancelRef = useRef(false);
  /** Task #24 — live mirror of `current` so confirm() can wait for a
   * late-arriving serverTurnId without stale-closure issues. */
  const currentRef = useRef<CliTurn | null>(null);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  /**
   * Token of the in-flight turn. Stream callbacks read this on every
   * frame; when a new submit() bumps the token, late frames from the
   * aborted previous stream are dropped instead of clobbering state.
   * Without this, an aborted consumeStream() could briefly overwrite
   * the freshly-seeded next turn before its first frame arrives.
   */
  const activeTurnKeyRef = useRef<string | null>(null);

  // Capability catalog: pulled once per mount + every time the server
  // signals a final frame with a `schemaVersion` mismatch (Task #335
  // adds the live re-fetch path; v1 just refetches on mount + locale).
  useEffect(() => {
    let alive = true;
    fetch("/api/atelier/cli/capabilities", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { capabilities?: CliCapability[]; schemaVersion?: number }) => {
        if (alive) {
          setCapabilities(j.capabilities ?? []);
          setCatalogSchemaVersion(j.schemaVersion ?? null);
          setCapabilitiesError(null);
        }
      })
      .catch((e: Error) => {
        if (alive) setCapabilitiesError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Clarification durability — a pending question used to live only in
  // this hook's in-memory state, so a page reload (or server restart)
  // made it vanish while the server kept waiting for an answer. On
  // mount, ask the server whether the persona's most recent turn is
  // still paused on a clarification and, if so, restore the turn (and
  // its session) so the question card renders again.
  useEffect(() => {
    let alive = true;
    fetch("/api/atelier/cli/turns/pending-clarification", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: {
          pending?: {
            turnId: string;
            sessionId: string;
            prompt: string;
            createdAt: string;
            clarification: {
              field: string;
              question: string;
              tool: string;
              partial: Record<string, unknown>;
              suggestions: Array<{ id: string; label: string; hint?: string }>;
              fields?: Array<{ field: string; label: string; hint?: string; options?: string[]; inputType?: "date"; defaultValue?: string }>;
            };
          } | null;
        } | null) => {
          if (!alive || !j?.pending) return;
          // Never clobber live activity started before the fetch landed.
          // `activeTurnKeyRef` is set synchronously at the top of
          // submit(), so it also covers the narrow window before the
          // currentRef sync effect runs.
          if (currentRef.current || activeTurnKeyRef.current) return;
          const p = j.pending;
          setSessionId((s) => s ?? p.sessionId);
          const restored: CliTurn = {
            clientTurnKey: uuid(),
            serverTurnId: p.turnId,
            prompt: p.prompt,
            status: "needs_clarification",
            startedAt: Date.parse(p.createdAt) || Date.now(),
            trace: [],
            clarification: {
              field: p.clarification.field,
              question: p.clarification.question,
              tool: p.clarification.tool,
              partial: p.clarification.partial ?? {},
              suggestions: p.clarification.suggestions ?? [],
              fields: Array.isArray(p.clarification.fields)
                ? p.clarification.fields
                : [],
            },
          };
          setCurrent(restored);
          setTurns((t) => [restored, ...t]);
        },
      )
      .catch(() => {
        // Best-effort — absence of rehydration must never break the bar.
      });
    return () => {
      alive = false;
    };
  }, []);

  const consumeStream = useCallback(
    async (
      response: Response,
      clientTurnKey: string,
      seedTurn: CliTurn,
    ): Promise<void> => {
      if (!response.body) {
        const err: CliTurn = {
          ...seedTurn,
          status: "error",
          error: { code: "no_body", message: "Server returned no stream body" },
        };
        setCurrent(err);
        setTurns((t) => [err, ...t.filter((x) => x.clientTurnKey !== clientTurnKey)]);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let live = seedTurn;
      // Helper: only commit state when this stream is still the active
      // turn. Frames from an aborted prior submit() must not clobber a
      // freshly-seeded next turn.
      const isActive = () => activeTurnKeyRef.current === clientTurnKey;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE messages are separated by a blank line.
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const frame = parseFrame(block);
            if (!frame) continue;
            // Pull sessionId from any frame that carries it. Task #484:
            // also track a *changed* id — when the server rolls a stale
            // adopted session over (30-min inactivity), later turns must
            // continue the rolled-over session, not re-send the old id.
            const sid = (frame.data as { sessionId?: string }).sessionId;
            if (sid && sid !== sessionId) setSessionId(sid);
            const prevNavPath = live.navigatedTo ?? null;
            live = applyFrame(live, frame);
            // Task #495 — fire the consumer's auto-navigation
            // callback exactly once per unique destination per turn.
            // Skipped when the stream is no longer active so a stale
            // turn can't yank the user around after a newer submit.
            const navResult = tryFireNavigation({
              prevNavPath,
              navigateTo: live.navigateTo,
              isActive,
              onNavigate,
            });
            if (navResult.fired) {
              live = { ...live, navigatedTo: navResult.navigatedTo };
            }
            if (!isActive()) continue;
            setCurrent(live);
            setTurns((t) => {
              const others = t.filter((x) => x.clientTurnKey !== clientTurnKey);
              return [live, ...others];
            });
            if (frame.type === "async_dispatched" && onAsync) {
              const d = frame.data as { jobId?: string; turnId?: string };
              onAsync(d.jobId ?? "", d.turnId ?? "");
            }
          }
        }
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") {
          // Task #24 — only an explicit user cancel maps to a
          // "cancelled" turn. Supersede aborts (newer submit) and
          // duplicate-confirm aborts are dropped silently; publishing
          // "cancelled" for those was a client-side hallucination while
          // the server write might still be committing.
          const outcome = abortOutcome({
            isActiveTurn: isActive(),
            userCancelRequested: userCancelRef.current,
          });
          userCancelRef.current = false;
          if (outcome === "drop") return;
          live = { ...live, status: "cancelled" };
        } else {
          if (!isActive()) return;
          live = {
            ...live,
            status: "error",
            error: { code: "stream_failed", message: (e as Error).message },
          };
        }
        setCurrent(live);
        setTurns((t) => [live, ...t.filter((x) => x.clientTurnKey !== clientTurnKey)]);
      }
    },
    [sessionId, onAsync, onNavigate],
  );

  const submit = useCallback(
    async (args: SubmitArgs): Promise<void> => {
      // Cancel any prior in-flight turn — the server idempotency key
      // makes a re-submit safe but the UI should only show one stream.
      // Task #24 — this is a supersede abort, not a user cancel.
      userCancelRef.current = false;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const clientTurnKey = uuid();
      activeTurnKeyRef.current = clientTurnKey;
      const seed: CliTurn = {
        clientTurnKey,
        prompt: args.prompt,
        status: "streaming",
        startedAt: Date.now(),
        trace: [],
      };
      setCurrent(seed);
      setTurns((t) => [seed, ...t]);

      // Forward the locale instruction so the orchestrator answers in
      // the chrome's active language even though server-side persona
      // locale is the canonical default.
      const wrappedPrompt = `${localeInstruction(locale)}\n\n${args.prompt}`;

      try {
        const r = await fetch("/api/atelier/cli/turn", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({
            sessionId,
            prompt: wrappedPrompt,
            attachmentIds: args.attachmentIds ?? [],
            pageContext: args.pageContext ?? null,
            dryRun: args.dryRun ?? false,
            clientTurnKey,
            intent: args.intent ?? null,
            continuesTurnId: args.continuesTurnId ?? null,
            clarificationValues: args.clarificationValues ?? null,
            timezone: deviceTimeZone(),
          }),
          signal: ctrl.signal,
        });
        if (!r.ok) {
          const err: CliTurn = {
            ...seed,
            status: "error",
            error: { code: `http_${r.status}`, message: r.statusText },
          };
          setCurrent(err);
          setTurns((t) => [err, ...t.filter((x) => x.clientTurnKey !== clientTurnKey)]);
          return;
        }
        await consumeStream(r, clientTurnKey, seed);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        const err: CliTurn = {
          ...seed,
          status: "error",
          error: { code: "network", message: (e as Error).message },
        };
        setCurrent(err);
        setTurns((t) => [err, ...t.filter((x) => x.clientTurnKey !== clientTurnKey)]);
      }
    },
    [sessionId, locale, consumeStream],
  );

  const confirm = useCallback(
    async (
      typedName?: string,
      excludedStepIndexes?: number[],
      planEdits?: Record<number, string>,
    ): Promise<void> => {
      // Task #24 — confirm is idempotent while in flight: a duplicate
      // click is a no-op and NEVER aborts the in-flight confirm stream
      // (that abort was what produced phantom "Cancelled" turns).
      const gate = confirmGate({
        confirming: confirmingRef.current,
        serverTurnId: currentRef.current?.serverTurnId ?? null,
      });
      if (gate === "noop_in_flight") return;
      confirmingRef.current = true;
      setConfirming(true);
      try {
        // Task #24 — clicked before the server turn id landed (the
        // final frame of the propose stream hasn't arrived yet). Show
        // the in-progress state immediately and wait for the id to
        // land instead of silently doing nothing.
        if (gate === "wait_for_turn_id") {
          const deadline = Date.now() + 8_000;
          while (!currentRef.current?.serverTurnId && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
          }
          if (!currentRef.current?.serverTurnId) {
            const base = currentRef.current;
            if (base) {
              const err: CliTurn = {
                ...base,
                status: "error",
                error: {
                  code: "confirm_not_ready",
                  message:
                    "The turn isn't ready to confirm yet — please try again in a moment.",
                },
              };
              setCurrent(err);
              setTurns((t) => [
                err,
                ...t.filter((x) => x.clientTurnKey !== err.clientTurnKey),
              ]);
            }
            return;
          }
        }
        const turn = currentRef.current!;
        // Supersede any stale prior stream (the propose stream is
        // normally finished by now). Not a user cancel — the abort is
        // dropped silently by consumeStream's mapping.
        userCancelRef.current = false;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // Re-key the in-flight turn so frames from a stale stream can't
        // clobber the renewed confirm stream.
        activeTurnKeyRef.current = turn.clientTurnKey;
        const seed: CliTurn = { ...turn, status: "streaming", trace: [...turn.trace] };
        setCurrent(seed);
        try {
          const r = await fetch(
            `/api/atelier/cli/turn/${encodeURIComponent(turn.serverTurnId!)}/confirm`,
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
              body: JSON.stringify({
                typedName: typedName ?? null,
                // Forwarded for #334/#335 enforcement. Current server
                // confirm route ignores unknown fields (see cliRoutes.ts:
                // body destructures only `typedName`).
                excludedStepIndexes: excludedStepIndexes ?? [],
                planEdits: planEdits ?? {},
              }),
              signal: ctrl.signal,
            },
          );
          if (!r.ok) {
            const err: CliTurn = {
              ...seed,
              status: "error",
              error: { code: `http_${r.status}`, message: r.statusText },
            };
            setCurrent(err);
            setTurns((t) => [err, ...t.filter((x) => x.clientTurnKey !== seed.clientTurnKey)]);
            return;
          }
          await consumeStream(r, seed.clientTurnKey, seed);
        } catch (e) {
          if ((e as { name?: string }).name === "AbortError") return;
          const err: CliTurn = {
            ...seed,
            status: "error",
            error: { code: "network", message: (e as Error).message },
          };
          setCurrent(err);
        }
      } finally {
        confirmingRef.current = false;
        setConfirming(false);
      }
    },
    [consumeStream],
  );

  const cancel = useCallback(async (): Promise<void> => {
    // Task #24 — explicit user cancel: mark the intent BEFORE aborting
    // so consumeStream's AbortError mapping publishes "cancelled".
    if (!current?.serverTurnId) {
      userCancelRef.current = true;
      abortRef.current?.abort();
      return;
    }
    try {
      await fetch(
        `/api/atelier/cli/turn/${encodeURIComponent(current.serverTurnId)}/cancel`,
        { method: "POST", credentials: "include" },
      );
    } catch {
      // best-effort
    }
    const cancelled: CliTurn = { ...current, status: "cancelled" };
    setCurrent(cancelled);
    setTurns((t) => [cancelled, ...t.filter((x) => x.clientTurnKey !== cancelled.clientTurnKey)]);
  }, [current]);

  const pickDisambig = useCallback(
    async (optionId: string, optionLabel: string): Promise<void> => {
      if (!current) return;
      // Re-enter the loop with the chosen ID appended to the prompt.
      // The orchestrator's resolver layer treats `the one with id <id>`
      // as a deterministic match (Task #332).
      await submit({
        prompt: `${current.prompt}\n\n(Use the one called "${optionLabel}" — id ${optionId})`,
      });
    },
    [current, submit],
  );

  const toggleStepExclusion = useCallback((stepIndex: number) => {
    setCurrent((c) => {
      if (!c) return c;
      const cur = c.excludedStepIndexes ?? [];
      const next = cur.includes(stepIndex)
        ? cur.filter((i) => i !== stepIndex)
        : [...cur, stepIndex];
      const updated: CliTurn = { ...c, excludedStepIndexes: next };
      setTurns((t) => [updated, ...t.filter((x) => x.clientTurnKey !== updated.clientTurnKey)]);
      return updated;
    });
  }, []);

  const setPlanRowEdit = useCallback((stepIndex: number, label: string) => {
    setCurrent((c) => {
      if (!c) return c;
      const next: Record<number, string> = { ...(c.planEdits ?? {}) };
      if (label.trim() === "") {
        delete next[stepIndex];
      } else {
        next[stepIndex] = label;
      }
      const updated: CliTurn = { ...c, planEdits: next };
      setTurns((t) => [updated, ...t.filter((x) => x.clientTurnKey !== updated.clientTurnKey)]);
      return updated;
    });
  }, []);

  const abort = useCallback(() => {
    // Task #24 — the public abort() is an explicit user action, so an
    // in-flight stream aborted here does surface as "cancelled".
    userCancelRef.current = true;
    abortRef.current?.abort();
  }, []);

  const injectHistoricalTurn = useCallback((turn: CliTurn) => {
    setTurns((t) => {
      // Idempotent on serverTurnId so re-clicking the same rail row
      // doesn't duplicate the entry. Falls back to clientTurnKey when
      // the historical row hasn't been streamed during this session.
      const existing = turn.serverTurnId
        ? t.find((x) => x.serverTurnId === turn.serverTurnId)
        : t.find((x) => x.clientTurnKey === turn.clientTurnKey);
      if (existing) {
        return [turn, ...t.filter((x) => x !== existing)];
      }
      return [turn, ...t];
    });
    if (turn.status === "complete" || turn.status === "partial") {
      setCurrent(turn);
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setSessionId(null);
    setTurns([]);
    setCurrent(null);
  }, []);

  // Task #484 — like reset(), but pin the picked session's id so the
  // next submit() continues that conversation (mirrors mobile).
  const adoptSession = useCallback((id: string) => {
    abortRef.current?.abort();
    setSessionId(id);
    setTurns([]);
    setCurrent(null);
  }, []);

  return {
    sessionId,
    turns,
    current,
    status: current?.status ?? "idle",
    confirming,
    submit,
    confirm,
    cancel,
    pickDisambig,
    toggleStepExclusion,
    setPlanRowEdit,
    abort,
    reset,
    capabilities,
    capabilitiesError,
    catalogSchemaVersion,
    injectHistoricalTurn,
    adoptSession,
  };
}
