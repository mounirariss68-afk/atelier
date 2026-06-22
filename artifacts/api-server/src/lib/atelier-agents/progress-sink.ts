/**
 * Atelier — ambient agent progress sink.
 *
 * A process-wide AsyncLocalStorage channel that lets any agent's progress
 * updates (whether emitted via `runAgent`'s `ctx.progress` or a direct
 * `progressRun(...)` call) surface to whatever dispatched them — without
 * threading an `onProgress` callback through every runner signature.
 *
 * The chat orchestrator wraps each tool dispatch in `runWithProgressSink(...)`,
 * supplying a sink that forwards to the CLI's SSE stream. Deep inside, agents
 * call `reportProgress(pct, message)` (directly or transitively) and the update
 * propagates back out through the async call chain.
 *
 * When no sink is active (e.g. background runs triggered outside chat), the
 * helpers are inert no-ops, so existing behavior is unchanged.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type ProgressSink = (
  pct: number,
  message: string,
  /**
   * Optional structured payload riding alongside the human-readable message
   * (e.g. the list of source titles/URLs behind a "Read N sources" step) so
   * the UI can render an expandable detail view. Advisory only.
   */
  data?: Record<string, unknown>,
) => void;

const store = new AsyncLocalStorage<ProgressSink>();

/**
 * Run `fn` with `sink` installed as the ambient progress sink for the duration
 * of the (possibly async) call. Nested calls override the sink for their own
 * subtree, restoring the outer one on completion.
 */
export function runWithProgressSink<T>(sink: ProgressSink, fn: () => Promise<T>): Promise<T> {
  return store.run(sink, fn);
}

/**
 * Best-effort report of progress to the ambient sink, if one is active.
 * Never throws — a broken sink must never break an agent run.
 */
export function reportProgress(
  pct: number,
  message: string,
  data?: Record<string, unknown>,
): void {
  const sink = store.getStore();
  if (!sink) return;
  try {
    sink(pct, message, data);
  } catch {
    // Swallow — progress reporting is advisory only.
  }
}
