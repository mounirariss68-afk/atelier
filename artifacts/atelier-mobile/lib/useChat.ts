import { fetch as expoFetch } from "expo/fetch";
import { useCallback, useRef, useState } from "react";

import {
  API_BASE,
  authHeader,
  type CliSessionMeta,
  listCliSessions,
  uploadCliAttachment,
} from "@/lib/api";
import { triggerUnauthorized } from "@/lib/authEvents";

export type { CliSessionMeta } from "@/lib/api";

export interface ClarificationField {
  field: string;
  label: string;
  hint?: string;
  options?: string[];
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

export type TurnStatus =
  | "streaming"
  | "complete"
  | "error"
  | "cancelled"
  | "needs_clarification"
  | "needs_confirmation";

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
  pending?: PendingConfirmation;
  result?: ResultCard;
  serverTurnId?: string;
  error?: string;
}

function uuid() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseFrame(block: string): { type: string; data: Record<string, unknown> } | null {
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

function applyFrame(turn: ChatTurn, type: string, data: Record<string, unknown>): ChatTurn {
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
      const d = data as { tool?: string; ok?: boolean };
      const ok = d.ok !== false;
      return { ...turn, trace: [...turn.trace, { kind: "tool", text: `${ok ? "✓" : "✗"} ${d.tool ?? "tool"}` }] };
    }
    case "needs_clarification": {
      const d = data as {
        question?: string;
        field?: string;
        fields?: ClarificationField[];
      };
      const fields = Array.isArray(d.fields) && d.fields.length > 0
        ? d.fields
        : [{ field: d.field ?? "value", label: d.question ?? "Answer" }];
      return {
        ...turn,
        status: "needs_clarification",
        clarification: { question: d.question ?? "", fields },
      };
    }
    case "needs_confirmation": {
      return { ...turn, status: "needs_confirmation", pending: data as PendingConfirmation };
    }
    case "final": {
      const d = data as { status?: string; turnId?: string; result?: ResultCard };
      const ss = d.status;
      let next: TurnStatus;
      if (ss === "awaiting_confirmation") next = "needs_confirmation";
      else if (ss === "awaiting_clarification") next = "needs_clarification";
      else if (ss === "cancelled") next = "cancelled";
      else if (ss === "error") next = "error";
      else next = "complete";
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

  const uploadAttachment = useCallback(
    (file: { uri: string; name: string; mime: string }) =>
      uploadCliAttachment(file, sessionRef.current),
    [],
  );

  const upsert = useCallback((key: string, updater: (t: ChatTurn) => ChatTurn) => {
    setTurns((list) => list.map((t) => (t.key === key ? updater(t) : t)));
  }, []);

  const runStream = useCallback(
    async (url: string, body: unknown, key: string) => {
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
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
          upsert(key, (t) => ({ ...t, status: "error", error: `HTTP ${res.status}` }));
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
            const sid = (frame.data as { sessionId?: string }).sessionId;
            if (sid && !sessionRef.current) {
              sessionRef.current = sid;
              setSessionId(sid);
            }
            upsert(key, (t) => applyFrame(t, frame.type, frame.data));
          }
        }
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") {
          upsert(key, (t) => (t.status === "streaming" ? { ...t, status: "cancelled" } : t));
        } else {
          upsert(key, (t) => ({ ...t, status: "error", error: (e as Error).message }));
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
      upsert(key, (t) => ({ ...t, status: "streaming", clarification: undefined }));
      await runStream(
        "/api/atelier/cli/turn",
        {
          sessionId: sessionRef.current,
          prompt: prompt || "(answer)",
          continuesTurnId: turn?.serverTurnId ?? null,
          clarificationValues: values,
          clientTurnKey: key,
        },
        key,
      );
    },
    [runStream, turns, upsert],
  );

  const confirm = useCallback(
    async (key: string, typedName?: string) => {
      const turn = turns.find((t) => t.key === key);
      const turnId = turn?.pending?.turnId ?? turn?.serverTurnId;
      if (!turnId) return;
      upsert(key, (t) => ({ ...t, status: "streaming", pending: undefined }));
      await runStream(`/api/atelier/cli/turn/${turnId}/confirm`, { typedName }, key);
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
    uploadAttachment,
    submit,
    answerClarification,
    confirm,
    cancelConfirmation,
    stop,
    newChat,
    loadSession,
  };
}
