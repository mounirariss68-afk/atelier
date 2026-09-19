import { applyFrame } from "./reducer";
import { inferPersistedProtocolMode, normalizeChatFrame } from "./frames";
import type { ChatTurnCore } from "./types";

/**
 * Replays persisted frames through the same reducer used for live SSE.
 * Persisted order is authoritative; semantic sequence numbers only dedupe
 * repeats and reject regressions inside applyFrame.
 */
export function replayFrames<T extends ChatTurnCore>(
  seed: T,
  frames: readonly unknown[] | null | undefined,
): T {
  let turn: T = seed.protocolMode
    ? seed
    : ({ ...seed, protocolMode: inferPersistedProtocolMode(frames) } as T);
  for (let index = 0; index < (frames?.length ?? 0); index += 1) {
    const frame = normalizeChatFrame(frames![index], {
      receivedAt: index,
      expectedMode: turn.protocolMode,
    });
    if (!frame) continue;
    turn = applyFrame(turn, frame);
  }
  return turn;
}