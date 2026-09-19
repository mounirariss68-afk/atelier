import { sleep } from "./sse";

export interface TerminalTurnSnapshot {
  id: string;
  status: string;
  terminal: boolean;
  frames: unknown[];
}

export type TerminalTurnRecovery =
  | { kind: "recovered"; snapshot: TerminalTurnSnapshot }
  | { kind: "not_terminal" }
  | { kind: "unavailable" };

/**
 * Polls persisted turn state after an SSE disconnect. This is read-only:
 * callers must never resend a confirm or other write to recover a stream.
 */
export async function recoverTerminalTurn(args: {
  turnId: string;
  fetchSnapshot: (turnId: string) => Promise<TerminalTurnSnapshot | null>;
  signal?: AbortSignal;
  delaysMs?: readonly number[];
}): Promise<TerminalTurnRecovery> {
  const delays = args.delaysMs ?? [0, 250, 750, 1_500];
  let reachedServer = false;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay, args.signal);
    try {
      const snapshot = await args.fetchSnapshot(args.turnId);
      if (!snapshot) continue;
      reachedServer = true;
      if (snapshot.terminal) return { kind: "recovered", snapshot };
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "AbortError") throw error;
    }
  }
  return reachedServer ? { kind: "not_terminal" } : { kind: "unavailable" };
}