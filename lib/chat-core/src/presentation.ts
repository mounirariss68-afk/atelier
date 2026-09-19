import type { ChatProtocolMode, ChatToolResult } from "./types";
import { toolResultKey } from "./reducer";

export type ChatToolResultSeverity = "success" | "soft_error" | "hard_error";

export type ChatToolResultHiddenReason =
  | "duplicate"
  | "missing_authoritative_outcome"
  | "missing_presentation"
  | "clean_entity_resolution"
  | "prelude_failure"
  | "clarification_pending";

export interface ChatToolResultSemantic {
  key: string;
  result: ChatToolResult;
  cardType: string | null;
  visible: boolean;
  hiddenReason?: ChatToolResultHiddenReason;
  severity: ChatToolResultSeverity;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hiddenReasonFor(
  result: ChatToolResult,
  cardType: string | null,
  data: Record<string, unknown>,
): ChatToolResultHiddenReason | undefined {
  if (result.prelude === true && !result.ok) return "prelude_failure";
  if (result.ok && data.clarificationPending === true) return "clarification_pending";
  if (result.ok && cardType === "entity_resolution") {
    const options = Array.isArray(data.options) ? data.options : [];
    const entity = asObject(data.entity);
    if (options.length === 0 && nonEmptyString(entity.id)) return "clean_entity_resolution";
  }
  return undefined;
}

function severityFor(result: ChatToolResult): ChatToolResultSeverity {
  if (result.ok) return "success";
  return result.errorCode === "not_found" ? "soft_error" : "hard_error";
}

function currentSeverityFor(result: ChatToolResult): ChatToolResultSeverity {
  if (result.outcome?.kind === "read" || result.outcome?.kind === "committed") return "success";
  return result.errorCode === "not_found" ? "soft_error" : "hard_error";
}

/**
 * Sole semantic dispatch boundary for web/mobile result cards.
 *
 * Clients own native visuals only. They must not independently infer card
 * eligibility, severity, or shape precedence from raw tool results.
 */
export function deriveToolResultSemantics(
  toolResults: readonly ChatToolResult[],
  capabilityCardTypes: Readonly<Record<string, string | null | undefined>> = {},
  mode: ChatProtocolMode = "legacy",
): ChatToolResultSemantic[] {
  const seen = new Set<string>();
  return toolResults.map((result) => {
    const key = toolResultKey(result);
    const data = asObject(result.data);
    const cardType =
      nonEmptyString(result.presentation?.cardType) ??
      (mode === "legacy"
        ? nonEmptyString(data.shape) ?? nonEmptyString(capabilityCardTypes[result.tool])
        : null);
    const severity = mode === "current" ? currentSeverityFor(result) : severityFor(result);
    if (seen.has(key)) {
      return {
        key,
        result,
        cardType,
        visible: false,
        hiddenReason: "duplicate",
        severity,
      };
    }
    seen.add(key);
    const hiddenReason =
      mode === "current"
        ? !result.outcome ||
          (result.outcome.kind !== "read" &&
            result.outcome.kind !== "committed" &&
            result.outcome.kind !== "failed")
          ? "missing_authoritative_outcome"
          : !result.presentation && result.outcome.kind !== "failed"
            ? "missing_presentation"
            : undefined
        : hiddenReasonFor(result, cardType, data);
    return {
      key,
      result,
      cardType,
      visible: hiddenReason === undefined,
      ...(hiddenReason ? { hiddenReason } : {}),
      severity,
    };
  });
}