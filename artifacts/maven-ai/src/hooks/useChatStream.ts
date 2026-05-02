import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatSuggestion } from "@workspace/api-client-react";

export interface ChatStreamMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: ChatSuggestion[];
  error?: boolean;
}

export interface UseChatStreamResult {
  messages: ChatStreamMessage[];
  status: "idle" | "streaming" | "error";
  send: (text: string) => Promise<void>;
  reset: () => void;
  /** Abort any in-flight request without clearing message history. */
  abort: () => void;
  /** Re-send the last user message after an interrupted/failed stream. */
  retry: () => Promise<void>;
  /** True when the last assistant turn is in an error state and can be retried. */
  canRetry: boolean;
}

const MAX_HISTORY = 24;
const TRANSCRIPT_KEY = "maven-ai-chat-transcript";
const TRANSCRIPT_VERSION = 1;

interface PersistedTranscript {
  v: number;
  lang: "en" | "ar";
  messages: ChatStreamMessage[];
}

function loadTranscript(language: "en" | "ar"): ChatStreamMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(TRANSCRIPT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedTranscript;
    if (parsed.v !== TRANSCRIPT_VERSION) return [];
    if (parsed.lang !== language) return []; // Discard if user switched language.
    if (!Array.isArray(parsed.messages)) return [];
    return parsed.messages;
  } catch {
    return [];
  }
}

function saveTranscript(language: "en" | "ar", messages: ChatStreamMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    if (messages.length === 0) {
      window.sessionStorage.removeItem(TRANSCRIPT_KEY);
      return;
    }
    const payload: PersistedTranscript = { v: TRANSCRIPT_VERSION, lang: language, messages };
    window.sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / serialization errors
  }
}

type ServerEvent =
  | { type: "token"; token: string }
  | { type: "done"; suggestions: ChatSuggestion[] }
  | { type: "error"; message?: string };

/**
 * Spec-compliant SSE parser. Handles:
 *   - LF and CRLF line endings
 *   - Multiple `data:` lines per event (joined by \n per the SSE spec)
 *   - Comment lines beginning with `:`
 *   - Partial lines straddling chunk boundaries (kept in `buffer`)
 *   - Multiple events per chunk
 */
function makeSSEParser(onEvent: (e: ServerEvent) => void): (chunk: string) => void {
  let buffer = "";
  let dataLines: string[] = [];

  function dispatch() {
    if (dataLines.length === 0) return;
    const json = dataLines.join("\n");
    dataLines = [];
    if (!json) return;
    try {
      onEvent(JSON.parse(json) as ServerEvent);
    } catch {
      // ignore malformed event
    }
  }

  return function feed(chunk: string) {
    buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        dispatch();
        continue;
      }
      if (line.startsWith(":")) continue; // comment / heartbeat
      if (line.startsWith("data:")) {
        const value = line.slice(5);
        // SSE spec: trim a single leading space if present.
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }
      // other fields (event:, id:, retry:) are unused here
    }
  };
}

export function useChatStream(language: "en" | "ar"): UseChatStreamResult {
  const [messages, setMessages] = useState<ChatStreamMessage[]>(() => loadTranscript(language));
  const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);
  const lastLanguageRef = useRef<"en" | "ar">(language);

  // Persist transcript to sessionStorage on every change so a refresh keeps
  // the conversation visible (per-tab, cleared when the tab closes).
  // When the user switches language mid-session, we reset the in-memory
  // transcript so an EN conversation isn't re-saved (or shown) under "ar"
  // (and vice versa). The sessionStorage layer already discards transcripts
  // saved under a different language on load — this enforces the same
  // isolation while the widget is mounted.
  useEffect(() => {
    if (lastLanguageRef.current !== language) {
      lastLanguageRef.current = language;
      abortRef.current?.abort();
      abortRef.current = null;
      lastUserMessageRef.current = null;
      setMessages([]);
      setStatus("idle");
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(TRANSCRIPT_KEY);
      }
      return;
    }
    saveTranscript(language, messages);
  }, [language, messages]);

  // Abort any in-flight request when the component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      // If the assistant placeholder is still empty (or only had partial
      // tokens), mark it as a retryable error so the user doesn't reopen
      // the widget to a perpetual blank "thinking" bubble.
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role !== "assistant" || last.error) return prev;
        const next = [...prev];
        const partial = last.content.trim();
        next[next.length - 1] = {
          role: "assistant",
          content: partial.length > 0
            ? `${last.content}\n\n(Stopped before the answer was complete. Try again?)`
            : "Stopped before the assistant could reply. Try again?",
          error: true,
        };
        return next;
      });
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastUserMessageRef.current = null;
    setMessages([]);
    setStatus("idle");
  }, []);

  // Shared streaming helper. Receives the EXACT outgoing message array sent
  // to the server and assumes the local `messages` state already ends with
  // a placeholder assistant turn that will be filled in by streaming tokens.
  const stream = useCallback(
    async (outgoing: ChatMessage[]) => {
      setStatus("streaming");
      const controller = new AbortController();
      abortRef.current = controller;
      // Track terminal events so a silent close (network drop, timeout)
      // is reported as an error instead of a "complete" answer.
      let receivedDone = false;
      let receivedError = false;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ messages: outgoing, language }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errMessage = `HTTP ${response.status}`;
          try {
            const errPayload = await response.json();
            if (errPayload?.error) errMessage = errPayload.error;
          } catch {
            // ignore
          }
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: errMessage, error: true };
            return next;
          });
          setStatus("error");
          return;
        }

        if (!response.body) {
          throw new Error("Streaming not supported in this browser.");
        }

        const handleEvent = (event: ServerEvent) => {
          if (event.type === "token") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + event.token };
              }
              return next;
            });
          } else if (event.type === "done") {
            receivedDone = true;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, suggestions: event.suggestions ?? [] };
              }
              return next;
            });
          } else if (event.type === "error") {
            receivedError = true;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                role: "assistant",
                content: event.message || "The assistant ran into an error.",
                error: true,
              };
              return next;
            });
          }
        };

        const feed = makeSSEParser(handleEvent);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          feed(decoder.decode(value, { stream: true }));
        }
        // Flush any final bytes from the decoder.
        feed(decoder.decode());

        // Stream closed without `done`/`error`: mark the turn as failed.
        if (!receivedDone && !receivedError) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            const partial = last && last.role === "assistant" ? last.content : "";
            const note =
              partial.length > 0
                ? `${partial}\n\n(The connection dropped before the answer was complete. Try again?)`
                : "The connection dropped before the assistant could reply. Try again?";
            next[next.length - 1] = { role: "assistant", content: note, error: true };
            return next;
          });
          setStatus("error");
        } else {
          setStatus("idle");
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          setStatus("idle");
          return;
        }
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              role: "assistant",
              content: "The assistant is unavailable right now. Please try again in a moment.",
              error: true,
            };
          }
          return next;
        });
        setStatus("error");
      } finally {
        abortRef.current = null;
      }
    },
    [language],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === "streaming") return;

      // Build the outgoing message list (history + new user turn), capped at
      // MAX_HISTORY most recent turns to match the server-side zod limit.
      // Errored assistant turns are excluded from the history we send up.
      const history: ChatMessage[] = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));
      const outgoing = [...history, { role: "user" as const, content: trimmed }].slice(-MAX_HISTORY);

      lastUserMessageRef.current = trimmed;
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "" },
      ]);
      await stream(outgoing);
    },
    [language, messages, status, stream],
  );

  // Retry the last user turn after an interrupted/errored stream. We replace
  // the failed assistant with a fresh placeholder and re-stream — the user
  // turn itself is never duplicated.
  const retry = useCallback(async () => {
    const last = lastUserMessageRef.current;
    if (!last || status === "streaming") return;

    // Compute the outgoing payload from current messages, then clear the
    // trailing failed assistant locally before re-streaming.
    const cleanHistory: ChatMessage[] = [];
    let trimmedTrailingError = false;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const isLast = i === messages.length - 1;
      if (isLast && m.role === "assistant" && m.error) {
        trimmedTrailingError = true;
        continue;
      }
      if (!m.error) cleanHistory.push({ role: m.role, content: m.content });
    }
    if (!trimmedTrailingError) return; // nothing to retry
    const outgoing = cleanHistory.slice(-MAX_HISTORY);

    setMessages((prev) => {
      const next = [...prev];
      // Replace the trailing error assistant with a fresh placeholder.
      if (next.length > 0 && next[next.length - 1].role === "assistant") {
        next[next.length - 1] = { role: "assistant", content: "" };
      } else {
        next.push({ role: "assistant", content: "" });
      }
      return next;
    });
    await stream(outgoing);
  }, [messages, status, stream]);

  const lastMsg = messages[messages.length - 1];
  const canRetry =
    status !== "streaming" &&
    lastUserMessageRef.current !== null &&
    !!lastMsg &&
    lastMsg.role === "assistant" &&
    !!lastMsg.error;

  return { messages, status, send, reset, abort, retry, canRetry };
}
