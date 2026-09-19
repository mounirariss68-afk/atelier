import {
  ASSISTANT_PROTOCOL_VERSION,
  PRESENTATION_MINIMUM_DATA_VERSION,
} from "@workspace/assistant-protocol";

export const CHAT_MINIMUM_SERVER_PROTOCOL_VERSION = 1 as const;
export const CHAT_SUPPORTED_PRESENTATION_DATA_VERSIONS = [
  PRESENTATION_MINIMUM_DATA_VERSION,
] as const;

export interface ChatProtocolAdvertisement {
  protocolVersion?: unknown;
  minimumClientProtocolVersion?: unknown;
  presentationDataVersions?: unknown;
}

export type ChatProtocolCompatibility =
  | { compatible: true; mode: "current" | "legacy" }
  | { compatible: false; mode: "unsupported"; reason: string };

export function chatProtocolRequestHeaders(
  mode: ChatProtocolCompatibility["mode"],
): Record<string, string> {
  if (mode !== "current") return {};
  return {
    "X-Assistant-Protocol-Version": String(ASSISTANT_PROTOCOL_VERSION),
    "X-Assistant-Presentation-Versions": CHAT_SUPPORTED_PRESENTATION_DATA_VERSIONS.join(","),
    "X-Assistant-Protocol-Mode": "semantic",
  };
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Negotiates the catalog/event protocol without breaking legacy servers.
 *
 * Missing metadata selects the durable legacy adapter. Advertised protocols
 * fail closed when either side's minimum version cannot be met or there is no
 * shared presentation-data version.
 */
export function negotiateChatProtocol(
  advertisement: ChatProtocolAdvertisement | null | undefined,
): ChatProtocolCompatibility {
  if (!advertisement || advertisement.protocolVersion === undefined) {
    return { compatible: true, mode: "legacy" };
  }
  const serverVersion = integer(advertisement.protocolVersion);
  const minimumClientVersion = integer(advertisement.minimumClientProtocolVersion);
  if (!serverVersion || !minimumClientVersion) {
    return {
      compatible: false,
      mode: "unsupported",
      reason: "invalid-protocol-advertisement",
    };
  }
  if (serverVersion < CHAT_MINIMUM_SERVER_PROTOCOL_VERSION) {
    return {
      compatible: false,
      mode: "unsupported",
      reason: "server-protocol-too-old",
    };
  }
  if (minimumClientVersion > ASSISTANT_PROTOCOL_VERSION) {
    return {
      compatible: false,
      mode: "unsupported",
      reason: "client-protocol-too-old",
    };
  }
  if (!Array.isArray(advertisement.presentationDataVersions)) {
    return {
      compatible: false,
      mode: "unsupported",
      reason: "missing-presentation-versions",
    };
  }
  const hasSharedPresentationVersion = advertisement.presentationDataVersions.some(
    (version) =>
      integer(version) !== null &&
      CHAT_SUPPORTED_PRESENTATION_DATA_VERSIONS.includes(
        version as (typeof CHAT_SUPPORTED_PRESENTATION_DATA_VERSIONS)[number],
      ),
  );
  if (!hasSharedPresentationVersion) {
    return {
      compatible: false,
      mode: "unsupported",
      reason: "no-shared-presentation-version",
    };
  }
  return { compatible: true, mode: "current" };
}