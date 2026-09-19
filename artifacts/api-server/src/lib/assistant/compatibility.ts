import {
  ASSISTANT_PROTOCOL_VERSION,
  PRESENTATION_MINIMUM_DATA_VERSION,
  type AssistantRequestV1,
} from "@workspace/assistant-protocol";

export const CANONICAL_ASSISTANT_HEADERS = {
  "x-assistant-protocol-version": String(ASSISTANT_PROTOCOL_VERSION),
  "x-assistant-protocol-mode": "semantic",
  "x-assistant-presentation-versions": String(PRESENTATION_MINIMUM_DATA_VERSION),
} as const;

export function canonicalToLegacyTurnRequest(body: AssistantRequestV1) {
  return {
    sessionId: body.conversationId,
    prompt: body.prompt,
    attachmentIds: body.attachmentIds,
    pageContext: body.pageContext ?? null,
    dryRun: body.dryRun,
    cancelInflight: body.cancelInflight,
    clientTurnKey: body.clientTurnKey,
    async: body.async,
    reset: body.reset,
    continuesTurnId: body.continuesTurnId,
    clarificationValues: body.clarificationValues,
    disambigOptionId: body.disambigOptionId,
    locale: body.locale,
    timezone: body.timezone,
  };
}

export function compileAssistantSlashIntent(prompt: string): {
  prompt: string;
  reset: boolean;
  command: "new" | null;
} {
  if (!/^\/new\b/i.test(prompt)) {
    return { prompt, reset: false, command: null };
  }
  return {
    prompt: prompt.replace(/^\/new\b\s*/i, "").trim() || "(new session)",
    reset: true,
    command: "new",
  };
}

export function assistantProtocolMetadata() {
  return {
    protocolVersion: ASSISTANT_PROTOCOL_VERSION,
    minimumClientProtocolVersion: ASSISTANT_PROTOCOL_VERSION,
    presentationDataVersions: [PRESENTATION_MINIMUM_DATA_VERSION],
    canonicalTurnPath: "/api/assistant/turns",
    compatibilityTurnPath: "/api/atelier/cli/turn",
    workflowWritesEnabled: false,
    legacyReadRetention: true,
  };
}