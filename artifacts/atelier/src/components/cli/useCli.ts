/**
 * Task #333 — CLI state machine + SSE consumer.
 *
 * Task #643 — the platform-independent pieces (SSE frame parser,
 * frame → turn reducer, confirm/abort/navigation gates, transient-retry
 * stream runner) now live in `@workspace/chat-core`, shared with the
 * mobile chat. This hook owns the React state plumbing only: one
 * in-flight turn at a time; calling `submit` while another turn is
 * streaming aborts the previous one (consistent with what the server
 * idempotency key allows).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  abortOutcome,
  applyFrame,
  chatProtocolRequestHeaders,
  confirmGate,
  deviceTimeZone,
  isSafeHttpUrl,
  negotiateChatProtocol,
  recoverTerminalTurn,
  restoreClarificationTurn,
  streamSse,
  tryFireNavigation,
  type PendingClarificationPayload,
  type ChatProtocolCompatibility,
  type SseResponseLike,
} from "@workspace/chat-core";
import { webReplayFrames } from "./semanticAdapter";
import type { CliTurn, CliTurnStatus, CliLocale, CliCapability } from "./types";
import { localeInstruction } from "./locale";
import type { DerivedPageContext } from "./pageContext";

// Re-exported so existing consumers (CommandBar, useCli.test.ts) keep
// importing from this module; the implementations are shared now.
export { applyFrame, confirmGate, abortOutcome, tryFireNavigation, isSafeHttpUrl };

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
  /**
   * Task #799 — deterministic disambiguation pick: the chosen option id
   * from a needs_disambiguation card. The server merges it into the
   * pending disambiguation's declared field and re-runs the originating
   * tool — no model extraction involved.
   */
  disambigOptionId?: string | null;
}

interface UseCliOptions {
  locale: CliLocale;
  /**
   * Task #495 — invoked when a frame for the active turn carries a
   * `navigateTo` hint that hasn't yet been applied. The hook calls
   * this once per unique destination per turn so the chat can drive
   * the app to the relevant screen automatically.
   */
  onNavigate?: (path: string, when: "on_propose" | "on_commit") => void;
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

export function useCli(opts: UseCliOptions): UseCliReturn {
  const { locale, onNavigate } = opts;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<CliTurn[]>([]);
  const [current, setCurrent] = useState<CliTurn | null>(null);
  const [capabilities, setCapabilities] = useState<CliCapability[]>([]);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [catalogSchemaVersion, setCatalogSchemaVersion] = useState<number | null>(null);
  const [protocolMode, setProtocolMode] =
    useState<ChatProtocolCompatibility["mode"] | "pending">("pending");
  const [confirming, setConfirming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /** Task #24 — mirrors the `confirming` state synchronously so a
   * rapid double-click is gated before React re-renders. */
  const confirmingRef = useRef(false);
  /** Task #24 — set only by an explicit user cancel/abort action.
   * The stream-outcome mapping publishes "cancelled" ONLY when this is
   * set; supersede/duplicate aborts are dropped silently. */
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
   * Without this, an aborted stream could briefly overwrite the
   * freshly-seeded next turn before its first frame arrives.
   */
  const activeTurnKeyRef = useRef<string | null>(null);

  // Capability catalog: pulled once per mount + every time the server
  // signals a final frame with a `schemaVersion` mismatch (Task #335
  // adds the live re-fetch path; v1 just refetches on mount + locale).
  useEffect(() => {
    let alive = true;
    fetch("/api/atelier/cli/capabilities", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        (j: {
          protocolVersion?: number;
          minimumClientProtocolVersion?: number;
          presentationDataVersions?: number[];
          capabilities?: CliCapability[];
          schemaVersion?: number;
        }) => {
        if (alive) {
          const compatibility = negotiateChatProtocol(j);
          if (!compatibility.compatible) {
             setProtocolMode("unsupported");
            setCapabilities([]);
            setCatalogSchemaVersion(j.schemaVersion ?? null);
            setCapabilitiesError(`unsupported-assistant-protocol:${compatibility.reason}`);
            return;
          }
           setProtocolMode(compatibility.mode);
          setCapabilities(j.capabilities ?? []);
          setCatalogSchemaVersion(j.schemaVersion ?? null);
          setCapabilitiesError(null);
        }
        },
      )
      .catch((e: Error) => {
        if (alive) {
          setProtocolMode("unsupported");
          setCapabilitiesError(e.message);
        }
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
      .then((j: { pending?: PendingClarificationPayload | null } | null) => {
        if (!alive || !j?.pending) return;
        // Never clobber live activity started before the fetch landed.
        // `activeTurnKeyRef` is set synchronously at the top of
        // submit(), so it also covers the narrow window before the
        // currentRef sync effect runs.
        if (currentRef.current || activeTurnKeyRef.current) return;
        const restoredCore = restoreClarificationTurn(j.pending);
        setSessionId((s) => s ?? restoredCore.sessionId);
        const restored: CliTurn = {
          ...restoredCore.core,
          clientTurnKey: uuid(),
          prompt: restoredCore.prompt,
          startedAt: restoredCore.startedAt,
        };
        setCurrent(restored);
        setTurns((t) => [restored, ...t]);
      })
      .catch(() => {
        // Best-effort — absence of rehydration must never break the bar.
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Shared stream runner. POSTs `body` to `url` and folds every SSE
   * frame into the turn keyed by `clientTurnKey`. Transient failures
   * (proxy 502/503/504 or a network error before the first frame) are
   * auto-retried by the shared runner — but ONLY when `allowRetry` is
   * set, i.e. for the dedupe-safe /cli/turn route. Confirm never
   * retries: the server may already be committing the write.
   */
  const runTurnStream = useCallback(
    async (args: {
      url: string;
      body: unknown;
      clientTurnKey: string;
      seed: CliTurn;
      signal: AbortSignal;
      allowRetry: boolean;
    }): Promise<void> => {
      const { url, body, clientTurnKey, seed, signal, allowRetry } = args;
      let live = seed;
      // Helper: only commit state when this stream is still the active
      // turn. Frames from an aborted prior submit() must not clobber a
      // freshly-seeded next turn.
      const isActive = () => activeTurnKeyRef.current === clientTurnKey;
      const commit = (t: CliTurn) => {
        setCurrent(t);
        setTurns((list) => [t, ...list.filter((x) => x.clientTurnKey !== clientTurnKey)]);
      };
      const outcome = await streamSse({
        fetchImpl: (u, init) =>
          fetch(u, { ...init, credentials: "include" }) as Promise<SseResponseLike>,
        url,
        body,
         headers: chatProtocolRequestHeaders(protocolMode === "pending" ? "legacy" : protocolMode),
        signal,
        allowRetry,
        onRetryWait: () => {
          if (!isActive()) return;
          live = { ...live, reconnecting: true };
          commit(live);
        },
        onFrame: (frame) => {
          // Pull sessionId from any frame that carries it. Task #484:
          // also track a *changed* id — when the server rolls a stale
          // adopted session over (30-min inactivity), later turns must
          // continue the rolled-over session, not re-send the old id.
          const sid = (frame.data as { sessionId?: string }).sessionId;
          if (sid) setSessionId((prev) => (sid !== prev ? sid : prev));
          const prevNavPath = live.navigatedTo ?? null;
          live = { ...applyFrame(live, frame), reconnecting: false };
          // Task #495 — fire the consumer's auto-navigation callback
          // exactly once per unique destination per turn. Skipped when
          // the stream is no longer active so a stale turn can't yank
          // the user around after a newer submit.
          const navResult = tryFireNavigation({
            prevNavPath,
            navigateTo: live.navigateTo,
            isActive,
            onNavigate,
          });
          if (navResult.fired) {
            live = { ...live, navigatedTo: navResult.navigatedTo };
          }
          if (!isActive()) return;
          commit(live);
          // Task #1119 — the live `async_dispatched` frame callback is
          // gone: Task #1116 removed the background runner, so the
          // server never emits that frame anymore. Historical
          // async_dispatched turns still render via the reducer's
          // final-status mapping and rowToHistoricalTurn.
        },
      });
      switch (outcome.kind) {
        case "done":
          return;
        case "aborted": {
          // Task #24 — only an explicit user cancel maps to a
          // "cancelled" turn. Supersede aborts (newer submit) and
          // duplicate-confirm aborts are dropped silently; publishing
          // "cancelled" for those was a client-side hallucination while
          // the server write might still be committing.
          const mapped = abortOutcome({
            isActiveTurn: isActive(),
            userCancelRequested: userCancelRef.current,
          });
          userCancelRef.current = false;
          if (mapped === "drop") return;
          live = { ...live, status: "cancelled", reconnecting: false };
          commit(live);
          return;
        }
        case "http_error": {
          if (!isActive()) return;
          live = {
            ...live,
            status: "error",
            reconnecting: false,
            error: { code: `http_${outcome.status}`, message: outcome.statusText },
            ...(outcome.transient ? { errorKind: "network" as const } : {}),
          };
          commit(live);
          return;
        }
        case "network_error": {
          if (!isActive()) return;
          if (outcome.receivedFrame && live.serverTurnId) {
            const recovery = await recoverTerminalTurn({
              turnId: live.serverTurnId,
              signal,
              fetchSnapshot: async (turnId) => {
                const response = await fetch(`/api/atelier/cli/turn/${turnId}`, {
                  credentials: "include",
                  signal,
                });
                if (response.status === 404) return null;
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const body = (await response.json()) as {
                  turn?: {
                    id?: string;
                    status?: string;
                    terminal?: boolean;
                    frames?: unknown[];
                  };
                };
                if (!body.turn?.id) return null;
                return {
                  id: body.turn.id,
                  status: body.turn.status ?? "streaming",
                  terminal: body.turn.terminal === true,
                  frames: body.turn.frames ?? [],
                };
              },
            });
            if (recovery.kind === "recovered" && isActive()) {
              live = {
                ...webReplayFrames(live, recovery.snapshot.frames),
                reconnecting: false,
                errorKind: undefined,
              };
              commit(live);
              return;
            }
          }
          live = {
            ...live,
            status: "error",
            reconnecting: false,
            error: {
              code: outcome.receivedFrame ? "stream_failed" : "network",
              message: outcome.message,
            },
            ...(outcome.receivedFrame ? {} : { errorKind: "network" as const }),
          };
          commit(live);
          return;
        }
      }
    },
    [onNavigate, protocolMode],
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
      if (protocolMode === "unsupported" || protocolMode === "pending") {
        const unsupported: CliTurn = {
          clientTurnKey,
          prompt: args.prompt,
          status: "error",
          startedAt: Date.now(),
          text: "",
          trace: [],
          toolResults: [],
          error: {
            code: "unsupported_assistant_protocol",
            message:
              protocolMode === "pending"
                ? "Assistant compatibility is still being checked."
                : (capabilitiesError ?? "This assistant version is not supported."),
          },
        };
        setCurrent(unsupported);
        setTurns((t) => [unsupported, ...t]);
        return;
      }
      const seed: CliTurn = {
        clientTurnKey,
        prompt: args.prompt,
        status: "streaming",
        startedAt: Date.now(),
        text: "",
        trace: [],
        toolResults: [],
        protocolMode: protocolMode === "current" ? "current" : "legacy",
      };
      setCurrent(seed);
      setTurns((t) => [seed, ...t]);

      // Forward the locale instruction so the orchestrator answers in
      // the chrome's active language even though server-side persona
      // locale is the canonical default.
      const wrappedPrompt = `${localeInstruction(locale)}\n\n${args.prompt}`;

      await runTurnStream({
        url: "/api/atelier/cli/turn",
        body: {
          sessionId,
          prompt: wrappedPrompt,
          attachmentIds: args.attachmentIds ?? [],
          pageContext: args.pageContext ?? null,
          dryRun: args.dryRun ?? false,
          clientTurnKey,
          intent: args.intent ?? null,
          continuesTurnId: args.continuesTurnId ?? null,
          clarificationValues: args.clarificationValues ?? null,
          disambigOptionId: args.disambigOptionId ?? null,
          timezone: deviceTimeZone(),
        },
        clientTurnKey,
        seed,
        signal: ctrl.signal,
        // /cli/turn dedupes on sessionId + clientTurnKey server-side,
        // so a transient 502 while the API server restarts is safe to
        // auto-resend (Task #643 — retry policy shared with mobile).
        allowRetry: true,
      });
    },
    [sessionId, locale, runTurnStream, protocolMode, capabilitiesError],
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
        // dropped silently by the stream-outcome mapping.
        userCancelRef.current = false;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // Re-key the in-flight turn so frames from a stale stream can't
        // clobber the renewed confirm stream.
        activeTurnKeyRef.current = turn.clientTurnKey;
        const seed: CliTurn = { ...turn, status: "streaming", trace: [...turn.trace] };
        setCurrent(seed);
        await runTurnStream({
          url: `/api/atelier/cli/turn/${encodeURIComponent(turn.serverTurnId!)}/confirm`,
          body: {
            typedName: typedName ?? null,
            // Forwarded for #334/#335 enforcement. Current server
            // confirm route ignores unknown fields (see cliRoutes.ts:
            // body destructures only `typedName`).
            excludedStepIndexes: excludedStepIndexes ?? [],
            planEdits: planEdits ?? {},
          },
          clientTurnKey: seed.clientTurnKey,
          seed,
          signal: ctrl.signal,
          // NEVER auto-retry a confirm — it performs the write. A
          // failed confirm surfaces an error instead of being resent.
          allowRetry: false,
        });
      } finally {
        confirmingRef.current = false;
        setConfirming(false);
      }
    },
    [runTurnStream],
  );

  const cancel = useCallback(async (): Promise<void> => {
    // Task #24 — explicit user cancel: mark the intent BEFORE aborting
    // so the stream-outcome mapping publishes "cancelled".
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
      // Task #799 — deterministic pick: send the chosen option id (and
      // the source turn) so the server merges it into the pending
      // disambiguation's declared field and re-runs the originating tool
      // directly. The human-readable prompt is kept for transcript
      // display and as the legacy fallback for envelopes without a
      // declared field.
      await submit({
        prompt: `${current.prompt}\n\n(Use the one called "${optionLabel}" — id ${optionId})`,
        continuesTurnId: current.serverTurnId ?? null,
        disambigOptionId: optionId,
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
