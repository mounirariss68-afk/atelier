import {
  hasMinimumPresentationData,
  isAllowedPresentationV1Pair,
  PresentationV1Schema,
  type PresentationV1,
} from "@workspace/assistant-protocol";
import type {
  CapabilityEntry,
  CapabilityModule,
  ResultCard,
} from "./capability-catalog.js";
import type { IntentKind, IntentVerb } from "./intent-router.js";

export const PRESENTATION_RENDERER_VERSION = "riser-presentation/v1" as const;

const MANAGED_CARD_TYPES = new Set<ResultCard>([
  "ranked_list",
  "account_card",
  "contact_card",
  "opportunity_card",
]);

const ENTITY_CARD_TYPES = new Set<ResultCard>([
  "account_card",
  "contact_card",
  "opportunity_card",
]);

const INTENT_KINDS_BY_MODULE: Partial<Record<CapabilityModule, readonly IntentKind[]>> = {
  account: ["account"],
  opportunity: ["opportunity"],
  engagement: ["engagement"],
  roster: ["contact"],
  proposal: ["proposal"],
  codex: ["contract"],
  renewal: ["renewal"],
  raid: ["raid_item"],
  deliverable: ["deliverable"],
  deliverable_acceptance: ["deliverable"],
  change_order: ["change_order"],
  wallet: ["invoice", "expense"],
  bank: ["invoice"],
  cash: ["invoice"],
};

const EXPLICIT_LIST_REQUEST =
  /\b(list|all|top|open|pending|due|upcoming|expiring|queue|pipeline|roster|directory|people|employees|contacts|accounts|opportunities|deals|contracts|invoices|expenses|risks|items)\b|(?:قائمة|كل)|\b(?:liste|tous|toutes)\b/iu;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function moduleMatchesIntent(module: CapabilityModule, kind: IntentKind): boolean {
  if (kind === "unknown") return false;
  return INTENT_KINDS_BY_MODULE[module]?.includes(kind) === true;
}

export function isManagedPresentationCard(
  cardType: ResultCard | string | null | undefined,
): boolean {
  return typeof cardType === "string" && MANAGED_CARD_TYPES.has(cardType as ResultCard);
}

export function isClientVisibleCliFrameType(frameType: string): boolean {
  return frameType !== "tool_evidence";
}

export function isManagedPresentationCapability(
  capability: CapabilityEntry | null | undefined,
): boolean {
  return Boolean(
    capability &&
      !capability.isWrite &&
      isManagedPresentationCard(capability.resultCard) &&
      capability.resultCard &&
      isAllowedPresentationV1Pair({
        capabilityId: capability.id,
        resultSourceId: capability.toolName,
        cardType: capability.resultCard,
      }),
  );
}

export function synthesizePresentation(args: {
  turnId: string;
  step: number;
  prompt: string;
  intent: { verb: IntentVerb; kind: IntentKind };
  capability: CapabilityEntry;
  data: unknown;
}): PresentationV1 | null {
  const cardType = args.capability.resultCard;
  if (!cardType || !isManagedPresentationCapability(args.capability)) return null;
  if (args.intent.verb !== "read") return null;

  let relevanceReason: string;
  if (cardType === "ranked_list") {
    if (!EXPLICIT_LIST_REQUEST.test(args.prompt)) return null;
    if (!moduleMatchesIntent(args.capability.module, args.intent.kind)) return null;
    if (!hasMinimumPresentationData(cardType, args.data)) return null;
    const rankedData = args.data as Record<string, unknown>;
    const rankedItems = rankedData.items as unknown[];
    relevanceReason =
      rankedItems.length === 0
        ? "The user explicitly requested this list; an empty state is meaningful."
        : "The user explicitly requested a list from this capability family.";
  } else {
    if (!ENTITY_CARD_TYPES.has(cardType)) return null;
    if (!moduleMatchesIntent(args.capability.module, args.intent.kind)) return null;
    if (!hasMinimumPresentationData(cardType, args.data)) return null;
    relevanceReason = "The entity card matches the interpreted entity kind.";
  }

  return PresentationV1Schema.parse({
    id: `presentation:${args.turnId}:${args.step}`,
    answersIntentIds: [`intent:${args.turnId}:0`],
    capabilityId: args.capability.id,
    resultSourceId: args.capability.toolName,
    relationship: "primary",
    cardType,
    data: args.data,
    minimumDataVersion: 1,
    relevanceReason,
  });
}