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

interface SubmitArgs {
  prompt: string;
  attachmentIds?: string[];
  pageContext?: DerivedPageContext | null;
  dryRun?: boolean;
  intent?: "read" | "write" | "reset" | null;
}

interface UseCliOptions {
  locale: CliLocale;
  onAsync?: (jobId: string, turnId: string) => void;
}

export interface UseCliReturn {
  sessionId: string | null;
  turns: CliTurn[];
  current: CliTurn | null;
  status: CliTurnStatus;
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
  ) => Promise<void>;
  cancel: () => Promise<void>;
  pickDisambig: (optionId: string, optionLabel: string) => Promise<void>;
  toggleStepExclusion: (stepIndex: number) => void;
  abort: () => void;
  reset: () => void;
  capabilities: CliCapability[];
  capabilitiesError: string | null;
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

function applyFrame(turn: CliTurn, frame: CliFrame): CliTurn {
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
      const d = frame.data as { index?: number; label?: string };
      return {
        ...turn,
        status: "streaming",
        trace: [
          ...turn.trace,
          { kind: "step", text: `${d.index ?? "?"}. ${d.label ?? ""}`, at: frame.receivedAt },
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
    case "tool_result": {
      const d = frame.data as { tool?: string; ok?: boolean };
      return {
        ...turn,
        trace: [
          ...turn.trace,
          {
            kind: "tool",
            text: `${d.ok === false ? "✗" : "✓"} ${d.tool ?? "tool"}`,
            at: frame.receivedAt,
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
      const d = frame.data as CliPendingConfirmation;
      return {
        ...turn,
        status: "needs_confirmation",
        pending: d,
        proposedPlan: d.steps ?? turn.proposedPlan,
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
      };
      return {
        ...turn,
        status: "partial",
        partial: {
          completedSteps: d.completedSteps ?? 0,
          failedStepIndex: d.failedStepIndex ?? -1,
          error: d.error ?? "Step failed",
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
      const next: CliTurnStatus =
        turn.status === "partial" ? "partial" :
        turn.status === "async_handoff" ? "async_handoff" :
        d.status === "cancelled" ? "cancelled" : "complete";
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
  const { locale, onAsync } = opts;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<CliTurn[]>([]);
  const [current, setCurrent] = useState<CliTurn | null>(null);
  const [capabilities, setCapabilities] = useState<CliCapability[]>([]);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
      .then((j: { capabilities?: CliCapability[] }) => {
        if (alive) {
          setCapabilities(j.capabilities ?? []);
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
            // Pull sessionId from any frame that carries it.
            const sid = (frame.data as { sessionId?: string }).sessionId;
            if (sid && !sessionId) setSessionId(sid);
            live = applyFrame(live, frame);
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
          // If we were superseded by a newer submit(), do NOT publish a
          // cancelled state — that would overwrite the new turn that
          // just took the active slot.
          if (!isActive()) return;
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
    [sessionId, onAsync],
  );

  const submit = useCallback(
    async (args: SubmitArgs): Promise<void> => {
      // Cancel any prior in-flight turn — the server idempotency key
      // makes a re-submit safe but the UI should only show one stream.
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
    async (typedName?: string, excludedStepIndexes?: number[]): Promise<void> => {
      if (!current?.serverTurnId) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // Re-key the in-flight turn so frames from a stale stream can't
      // clobber the renewed confirm stream.
      activeTurnKeyRef.current = current.clientTurnKey;
      const seed: CliTurn = { ...current, status: "streaming", trace: [...current.trace] };
      setCurrent(seed);
      try {
        const r = await fetch(
          `/api/atelier/cli/turn/${encodeURIComponent(current.serverTurnId)}/confirm`,
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
    },
    [current, consumeStream],
  );

  const cancel = useCallback(async (): Promise<void> => {
    if (!current?.serverTurnId) {
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

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setSessionId(null);
    setTurns([]);
    setCurrent(null);
  }, []);

  return {
    sessionId,
    turns,
    current,
    status: current?.status ?? "idle",
    submit,
    confirm,
    cancel,
    pickDisambig,
    toggleStepExclusion,
    abort,
    reset,
    capabilities,
    capabilitiesError,
  };
}
