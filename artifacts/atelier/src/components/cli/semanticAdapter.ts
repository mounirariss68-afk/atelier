import {
  deriveToolResultSemantics,
  replayFrames,
  type ChatFrame,
  type ChatTurnCore,
} from "@workspace/chat-core";

export const webReplayFrames = replayFrames;
export const webDeriveToolResultSemantics = deriveToolResultSemantics;

export function webSemanticSnapshot(
  seed: ChatTurnCore,
  frames: readonly ChatFrame[],
  capabilityCardTypes: Readonly<Record<string, string | null | undefined>> = {},
) {
  const turn = webReplayFrames(seed, frames);
  return {
    status: turn.status,
    protocolMode: turn.protocolMode,
    commitState: turn.commitState,
    terminal: turn.terminal === true,
    terminalOutcome: turn.terminalOutcome,
    navigateTo: turn.navigateTo ?? null,
    cards: webDeriveToolResultSemantics(
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