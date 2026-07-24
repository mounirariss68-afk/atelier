/**
 * Task #643 — shared SSE stream runner with transient-failure
 * auto-retry, used by both the web CLI and the mobile chat.
 *
 * Retry policy (originally mobile-only, now protecting web too):
 *   - Only routes that are dedupe-safe server-side may retry:
 *     POST /cli/turn dedupes on sessionId + clientTurnKey. The confirm
 *     route performs writes, so callers MUST pass allowRetry: false —
 *     a failed confirm surfaces an error instead of being auto-resent.
 *   - Retry only transient upstream statuses (proxy 502/503/504 while
 *     the API server restarts) or a network error BEFORE any SSE frame
 *     arrived. Never retry once frames have been processed: the server
 *     may already be acting on the turn.
 */
import { parseFrame } from "./parse";
import type { ChatFrame } from "./types";

/** Transient upstream statuses worth auto-retrying. */
export function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

export const RETRY_DELAYS_MS = [1_500, 3_000, 5_000];

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

export interface SseReaderLike {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
}

/** Minimal Response surface — satisfied by both DOM fetch and expo/fetch. */
export interface SseResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  body: { getReader(): SseReaderLike } | null;
}

export type SseFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<SseResponseLike>;

export type SseOutcome =
  | { kind: "done" }
  | { kind: "aborted" }
  | { kind: "http_error"; status: number; statusText: string; transient: boolean }
  | { kind: "network_error"; message: string; receivedFrame: boolean };

export interface StreamSseArgs {
  /** Platform fetch: web wraps `fetch` (credentials: include), mobile
   * wraps `expo/fetch` with its auth header. */
  fetchImpl: SseFetch;
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  signal: AbortSignal;
  /** true ONLY for dedupe-safe reads (POST /cli/turn). NEVER for confirm. */
  allowRetry: boolean;
  retryDelaysMs?: number[];
  onFrame: (frame: ChatFrame) => void;
  /** Invoked before each retry wait so the UI can show "reconnecting…". */
  onRetryWait?: (attempt: number) => void;
  /** Intercept a non-ok HTTP status (e.g. mobile routes 401 to the
   * login screen). Return "handled" to stop without an error outcome. */
  onHttpStatus?: (status: number) => "handled" | undefined;
}

export async function streamSse(args: StreamSseArgs): Promise<SseOutcome> {
  const delays = args.retryDelaysMs ?? RETRY_DELAYS_MS;
  let attempt = 0;
  for (;;) {
    let receivedFrame = false;
    try {
      const res = await args.fetchImpl(args.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(args.headers ?? {}),
        },
        body: JSON.stringify(args.body),
        signal: args.signal,
      });
      if (!res.ok) {
        if (args.onHttpStatus?.(res.status) === "handled") {
          return { kind: "aborted" };
        }
        if (args.allowRetry && isTransientStatus(res.status) && attempt < delays.length) {
          args.onRetryWait?.(attempt);
          await sleep(delays[attempt], args.signal);
          attempt += 1;
          continue;
        }
        return {
          kind: "http_error",
          status: res.status,
          statusText: res.statusText ?? "",
          transient: isTransientStatus(res.status),
        };
      }
      if (!res.body) {
        return {
          kind: "network_error",
          message: "Server returned no stream body",
          receivedFrame: false,
        };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      // Keep a buffer across read() chunks so multi-byte UTF-8 (Arabic)
      // and multi-chunk frames work. SSE messages are separated by a
      // blank line.
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
          args.onFrame(frame);
        }
      }
      return { kind: "done" };
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") {
        return { kind: "aborted" };
      }
      if (args.allowRetry && !receivedFrame && attempt < delays.length) {
        args.onRetryWait?.(attempt);
        try {
          await sleep(delays[attempt], args.signal);
        } catch {
          return { kind: "aborted" };
        }
        attempt += 1;
        continue;
      }
      return {
        kind: "network_error",
        message: (e as Error).message,
        receivedFrame,
      };
    }
  }
}
