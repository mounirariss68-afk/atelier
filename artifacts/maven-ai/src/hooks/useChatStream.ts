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
}

const MAX_HISTORY = 24;

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
  const [messages, setMessages] = useState<ChatStreamMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "streaming" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);

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
      setStatus("idle");
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setStatus("idle");
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === "streaming") return;

      // Build the outgoing message list (history + new user turn), capped
      // at MAX_HISTORY most recent turns to match the server-side zod limit.
      const history: ChatMessage[] = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));
      const outgoingFull: ChatMessage[] = [...history, { role: "user", content: trimmed }];
      const outgoing = outgoingFull.slice(-MAX_HISTORY);

      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "" },
      ]);
      setStatus("streaming");

      const controller = new AbortController();
      abortRef.current = controller;

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
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, suggestions: event.suggestions ?? [] };
              }
              return next;
            });
          } else if (event.type === "error") {
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

        setStatus("idle");
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
    [language, messages, status],
  );

  return { messages, status, send, reset, abort };
}
