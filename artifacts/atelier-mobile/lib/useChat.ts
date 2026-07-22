import { fetch as expoFetch } from "expo/fetch";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  API_BASE,
  apiJson,
  authHeader,
  type CliSessionMeta,
  deleteCliSession,
  listCliSessions,
  renameCliSession,
  uploadCliAttachment,
} from "@/lib/api";
import { triggerUnauthorized } from "@/lib/authEvents";
import {
  applyFrame,
  parseFrame,
  type ChatTurn,
  type ResultCard,
} from "@/lib/chatFrames";

export type { CliSessionMeta } from "@/lib/api";
export type {
  ChatTurn,
  ClarificationChoice,
  ClarificationField,
  DisambigOption,
  PendingConfirmation,
  ResultCard,
  ToolResult,
  Trace,
  TurnStatus,
} from "@/lib/chatFrames";

/** Transient upstream statuses worth auto-retrying (proxy 502 while the API server restarts, etc.). */
function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

const RETRY_DELAYS_MS = [1_500, 3_000, 5_000];

/** Task #581 — device IANA timezone sent with each turn so the server
 * interprets typed times ("move my 7am") the way the user sees them. */
function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        const err = new Error("Aborted");
        (err as { name: string }).name = "AbortError";
        reject(err);
      },
      { once: true },
    );
  });
}

function uuid() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** tool name → resultCard shape, from the role-filtered capability catalog. */
export type CapabilityShapes = Record<string, string>;

let capabilityShapesCache: CapabilityShapes | null = null;

/**
 * Fetches (once per app run) the capability catalog and exposes the
 * tool → resultCard shape map used to pick a renderer for each
 * tool_result frame. Failure degrades to an empty map — cards fall
 * back to the generic key/value grid.
 */
export function useCapabilityShapes(): CapabilityShapes {
  const [shapes, setShapes] = useState<CapabilityShapes>(
    capabilityShapesCache ?? {},
  );
  useEffect(() => {
    if (capabilityShapesCache) return;
    let alive = true;
    apiJson<{ capabilities?: { toolName?: string; resultCard?: string | null }[] }>(
      "/api/atelier/cli/capabilities",
    )
      .then((j) => {
        const map: CapabilityShapes = {};
        for (const c of j.capabilities ?? []) {
          if (c.toolName && c.resultCard) map[c.toolName] = c.resultCard;
        }
        capabilityShapesCache = map;
        if (alive) setShapes(map);
      })
      .catch(() => {
        // Non-fatal — renderers degrade to the fallback grid.
      });
    return () => {
      alive = false;
    };
  }, []);
  return shapes;
}

export function useChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<CliSessionMeta[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listCliSessions());
    } catch {
      // best-effort session list
    }
  }, []);

  // Task #485 — manual rename: optimistic list update, then PATCH; the
  // auto-title job can never overwrite it (guarded on title IS NULL).
  const renameSession = useCallback(async (id: string, title: string) => {
    const clean = title.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!clean) return;
    setSessions((list) =>
      list.map((s) => (s.id === id ? { ...s, title: clean } : s)),
    );
    try {
      await renameCliSession(id, clean);
    } catch {
      // best-effort; the list refreshes on next open
    }
  }, []);

  // Task #490 — delete a chat: optimistic list removal, then DELETE
  // (server soft-deletes). If the deleted chat is the active one, the
  // transcript resets so the next message starts a fresh session.
  const deleteSession = useCallback(async (id: string) => {
    setSessions((list) => list.filter((s) => s.id !== id));
    if (sessionRef.current === id) {
      abortRef.current?.abort();
      sessionRef.current = null;
      setSessionId(null);
      setTurns([]);
      setBusy(false);
    }
    try {
      await deleteCliSession(id);
    } catch {
      // best-effort; the list refreshes on next open
    }
  }, []);

  const uploadAttachment = useCallback(
    (file: { uri: string; name: string; mime: string }) =>
      uploadCliAttachment(file, sessionRef.current),
    [],
  );

  const upsert = useCallback((key: string, updater: (t: ChatTurn) => ChatTurn) => {
    setTurns((list) => list.map((t) => (t.key === key ? updater(t) : t)));
  }, []);

  const runStream = useCallback(
    async (url: string, body: unknown, key: string, opts?: { allowRetry?: boolean }) => {
      // Only retry routes that are dedupe-safe server-side: /cli/turn dedupes
      // on sessionId + clientTurnKey. The confirm route performs writes, so a
      // failed confirm surfaces an error instead of being auto-resent.
      const allowRetry = opts?.allowRetry ?? true;
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // Auto-retry transient failures (proxy 502/503/504 or a network error
      // before any SSE frame arrived — e.g. the dev API server mid-restart).
      // Never retry once frames have been processed: the server may already
      // be acting on the turn.
      let attempt = 0;
      try {
        for (;;) {
          let receivedFrame = false;
          try {
            const res = await expoFetch(`${API_BASE}${url}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "text/event-stream",
                ...authHeader(),
              },
              body: JSON.stringify(body),
              signal: ctrl.signal,
            });
            if (res.status === 401) {
              triggerUnauthorized();
              return;
            }
            if (!res.ok || !res.body) {
              if (allowRetry && isTransientStatus(res.status) && attempt < RETRY_DELAYS_MS.length) {
                upsert(key, (t) => ({ ...t, reconnecting: true }));
                await sleep(RETRY_DELAYS_MS[attempt], ctrl.signal);
                attempt += 1;
                continue;
              }
              upsert(key, (t) => ({
                ...t,
                status: "error",
                reconnecting: false,
                error: `HTTP ${res.status}`,
                errorKind: isTransientStatus(res.status) ? "network" : undefined,
              }));
              return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let sep: number;
              while ((sep = buffer.indexOf("\n\n")) !== -1) {
                const block = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                const frame = parseFrame(block);
                if (!frame) continue;
                receivedFrame = true;
                const sid = (frame.data as { sessionId?: string }).sessionId;
                if (sid && !sessionRef.current) {
                  sessionRef.current = sid;
                  setSessionId(sid);
                }
                upsert(key, (t) => ({ ...applyFrame(t, frame.type, frame.data), reconnecting: false }));
              }
            }
            return;
          } catch (e) {
            if ((e as { name?: string }).name === "AbortError") {
              upsert(key, (t) =>
                t.status === "streaming" ? { ...t, status: "cancelled", reconnecting: false } : t,
              );
              return;
            }
            if (allowRetry && !receivedFrame && attempt < RETRY_DELAYS_MS.length) {
              upsert(key, (t) => ({ ...t, reconnecting: true }));
              try {
                await sleep(RETRY_DELAYS_MS[attempt], ctrl.signal);
              } catch {
                upsert(key, (t) =>
                  t.status === "streaming" ? { ...t, status: "cancelled", reconnecting: false } : t,
                );
                return;
              }
              attempt += 1;
              continue;
            }
            upsert(key, (t) => ({
              ...t,
              status: "error",
              reconnecting: false,
              error: (e as Error).message,
              errorKind: receivedFrame ? undefined : "network",
            }));
            return;
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [upsert],
  );

  const submit = useCallback(
    async (prompt: string, attachments?: { id: string; name: string }[]) => {
      const key = uuid();
      const seed: ChatTurn = {
        key,
        prompt,
        attachments,
        status: "streaming",
        text: "",
        trace: [],
        toolResults: [],
      };
      setTurns((t) => [...t, seed]);
      await runStream(
        "/api/atelier/cli/turn",
        {
          sessionId: sessionRef.current,
          prompt,
          attachmentIds: attachments?.map((a) => a.id) ?? [],
          pageContext: null,
          dryRun: false,
          clientTurnKey: key,
          timezone: deviceTimeZone(),
        },
        key,
      );
    },
    [runStream],
  );

  const answerClarification = useCallback(
    async (key: string, values: Record<string, string>) => {
      const turn = turns.find((t) => t.key === key);
      const question = turn?.clarification?.question ?? "";
      const prompt = Object.values(values).join(", ") || question;
      // Task #567 — reset streamed output on resubmit. The continuation
      // reuses this turn key, so keeping old text/trace/toolResults made
      // every re-asked clarification APPEND duplicate narration and
      // stack duplicate result cards.
      upsert(key, (t) => ({
        ...t,
        status: "streaming",
        clarification: undefined,
        text: "",
        trace: [],
        toolResults: [],
        result: undefined,
      }));
      await runStream(
        "/api/atelier/cli/turn",
        {
          sessionId: sessionRef.current,
          prompt: prompt || "(answer)",
          continuesTurnId: turn?.serverTurnId ?? null,
          clarificationValues: values,
          clientTurnKey: key,
          timezone: deviceTimeZone(),
        },
        key,
      );
    },
    [runStream, turns, upsert],
  );

  // Task #567 — disambiguation pick: mirror the web client, which
  // re-enters the loop with the chosen id appended to the original
  // prompt (the resolver layer treats `id <id>` as a deterministic
  // match). Submits as a NEW turn; the picked turn's options are
  // cleared so the chips can't be tapped twice.
  const pickDisambig = useCallback(
    async (key: string, optionId: string, optionLabel: string) => {
      const turn = turns.find((t) => t.key === key);
      if (!turn) return;
      upsert(key, (t) => ({ ...t, status: "complete", disambig: undefined }));
      await submit(
        `${turn.prompt}\n\n(Use the one called "${optionLabel}" — id ${optionId})`,
      );
    },
    [submit, turns, upsert],
  );

  const confirm = useCallback(
    async (key: string, typedName?: string) => {
      const turn = turns.find((t) => t.key === key);
      const turnId = turn?.pending?.turnId ?? turn?.serverTurnId;
      if (!turnId) return;
      // Task #597 — reset streamed output before re-streaming, mirroring
      // the clarification resubmit reset above. The confirm response
      // streams into this same turn key; keeping the pre-confirm preview
      // tool_result + narration made every confirmed write render its
      // result card (and narration) twice.
      upsert(key, (t) => ({
        ...t,
        status: "streaming",
        pending: undefined,
        text: "",
        trace: [],
        toolResults: [],
        result: undefined,
      }));
      await runStream(`/api/atelier/cli/turn/${turnId}/confirm`, { typedName }, key, {
        allowRetry: false,
      });
    },
    [runStream, turns, upsert],
  );

  const cancelConfirmation = useCallback(
    async (key: string) => {
      const turn = turns.find((t) => t.key === key);
      const turnId = turn?.pending?.turnId ?? turn?.serverTurnId;
      upsert(key, (t) => ({ ...t, status: "cancelled", pending: undefined }));
      if (turnId) {
        try {
          await fetch(`${API_BASE}/api/atelier/cli/turn/${turnId}/cancel`, {
            method: "POST",
            headers: authHeader(),
          });
        } catch {
          // best-effort
        }
      }
    },
    [turns, upsert],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = null;
    setSessionId(null);
    setTurns([]);
  }, []);

  const loadSession = useCallback(async (id: string) => {
    abortRef.current?.abort();
    sessionRef.current = id;
    setSessionId(id);
    setTurns([]);
    try {
      const res = await fetch(`${API_BASE}/api/atelier/cli/sessions/${id}`, {
        headers: authHeader(),
      });
      if (!res.ok) return;
      const j = (await res.json()) as {
        turns?: { id?: string; prompt?: string; result?: ResultCard; summary?: string }[];
      };
      const loaded: ChatTurn[] = (j.turns ?? []).map((t, i) => ({
        key: t.id ?? `h_${i}`,
        prompt: t.prompt ?? "",
        status: "complete",
        text: [t.result?.title, t.result?.summary ?? t.summary].filter(Boolean).join("\n\n"),
        trace: [],
        toolResults: [],
        result: t.result,
        serverTurnId: t.id,
      }));
      setTurns(loaded);
    } catch {
      // best-effort history load
    }
  }, []);

  return {
    turns,
    sessionId,
    busy,
    sessions,
    refreshSessions,
    renameSession,
    deleteSession,
    uploadAttachment,
    submit,
    answerClarification,
    pickDisambig,
    confirm,
    cancelConfirmation,
    stop,
    newChat,
    loadSession,
  };
}
