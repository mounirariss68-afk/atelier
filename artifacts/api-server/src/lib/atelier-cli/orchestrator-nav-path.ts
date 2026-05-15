/**
 * Task #495 / #500 — Pure navigation-path resolver for the chat
 * orchestrator's `propose_write` capability.
 *
 * Extracted from `orchestrator-capabilities.ts` so it can be unit-tested
 * without dragging in the full capability catalog (and its db / agent
 * dependencies). The behaviour is identical to the previous in-file
 * implementation; the only change is the module boundary.
 *
 * Returns the SPA path the chat client should auto-navigate to for a
 * given (verb, kind, targetId, payload[, resultData]) tuple, or `null`
 * when no meaningful destination is known. Pure Q&A, disambiguation,
 * and refusals leave this null and the chat does not auto-navigate.
 */

export type NavWriteVerb = "create" | "update" | "link" | "transition";

export type NavWriteKind =
  | "account"
  | "opportunity"
  | "engagement"
  | "contact"
  | "deliverable"
  | "expense"
  | "partner_link"
  | "meeting"
  | "raid_item"
  | "proposal"
  | "pov"
  | "change_order"
  | "timesheet_entry"
  | "invoice"
  | "contract"
  | "rate_card"
  | "renewal"
  | "partner_firm"
  | "win_theme"
  | "win_loss_debrief"
  | "brief"
  | "agent_design";

export interface ResolveNavPathArgs {
  verb: NavWriteVerb;
  kind: NavWriteKind;
  targetId: string | null;
  payload: Record<string, unknown>;
  resultData?: unknown;
}

export function resolveNavPath(args: ResolveNavPathArgs): string | null {
  const { verb, kind, targetId, payload, resultData } = args;
  const dataObj =
    resultData && typeof resultData === "object"
      ? (resultData as Record<string, unknown>)
      : {};
  const pickStr = (key: string): string | null => {
    const fromResult = dataObj[key];
    if (typeof fromResult === "string" && fromResult) return fromResult;
    const fromPayload = payload[key];
    if (typeof fromPayload === "string" && fromPayload) return fromPayload;
    return null;
  };
  const resultId = typeof dataObj.id === "string" ? dataObj.id : null;
  const id = resultId ?? targetId ?? null;
  const engagementId = pickStr("engagementId");
  const opportunityId = pickStr("opportunityId");
  const accountId = pickStr("accountId");
  switch (kind) {
    case "account":
      if (id) return `/accounts/${id}`;
      return null;
    case "opportunity":
      if (id) return `/opportunities/${id}`;
      return null;
    case "contact":
      if (accountId) return `/accounts/${accountId}`;
      return null;
    case "engagement":
      if (id) return `/clients/deliver/engagements/${id}`;
      return null;
    case "deliverable": {
      const deliverableId = id;
      if (engagementId && deliverableId)
        return `/clients/deliver/engagements/${engagementId}/deliverables/${deliverableId}`;
      if (engagementId) return `/clients/deliver/engagements/${engagementId}`;
      return null;
    }
    case "expense":
      if (id) return `/wallet/expenses/${id}`;
      if (verb === "create") return "/wallet/expenses/new";
      return null;
    case "invoice":
      if (id) return `/wallet/invoices/${id}`;
      if (verb === "create") return "/wallet/invoices";
      return null;
    case "contract":
      if (id) return `/codex/contracts/${id}`;
      return "/codex";
    case "agent_design":
      if (id) return `/agents/design/${id}`;
      return null;
    case "timesheet_entry": {
      const personId = pickStr("personId");
      const weekKey = pickStr("weekIso") ?? pickStr("weekId");
      if (personId && weekKey) return `/people/time/${personId}/${weekKey}`;
      return "/people/time";
    }
    case "raid_item":
    case "proposal":
    case "pov":
    case "change_order":
      if (engagementId) return `/clients/deliver/engagements/${engagementId}`;
      if (opportunityId) return `/opportunities/${opportunityId}`;
      return null;
    case "win_loss_debrief":
      if (opportunityId) return `/opportunities/${opportunityId}/win-loss`;
      return null;
    default:
      return null;
  }
}
