import {
  deriveToolResultSemantics,
  replayFrames,
  type ChatFrame,
  type ChatTurnCore,
} from "@workspace/chat-core";

export const mobileReplayFrames = replayFrames;
export const mobileDeriveToolResultSemantics = deriveToolResultSemantics;

export function mobileSemanticSnapshot(
  seed: ChatTurnCore,
  frames: readonly ChatFrame[],
  capabilityCardTypes: Readonly<Record<string, string | null | undefined>> = {},
) {
  const turn = mobileReplayFrames(seed, frames);
  return {
    status: turn.status,
    protocolMode: turn.protocolMode,
    commitState: turn.commitState,
    terminal: turn.terminal === true,
    terminalOutcome: turn.terminalOutcome,
    navigateTo: turn.navigateTo ?? null,
    cards: mobileDeriveToolResultSemantics(
      turn.toolResults,
      capabilityCardTypes,
      turn.protocolMode,
    ).map(({ key, cardType, visible, hiddenReason, severity }) => ({
      key,
      cardType,
      visible,
      hiddenReason: hiddenReason ?? null,
      severity,
    })),
  };
}