/**
 * Task #887 — alliance-partner /cli surface ratchet (single source of truth).
 *
 * The central gate in routes/atelier/index.ts clamps alliance_partner
 * logins to an explicit /cli sub-path allowlist. That predicate lives
 * HERE (`isPartnerCliPathAllowed`) so the gate and the partner-portal
 * probe suite share one definition.
 *
 * Every route mounted under /cli/* (cliRoutes, cliAttachmentRoutes,
 * cliAdminRoutes) MUST have an annotation row below. The partner-portal
 * suite enumerates the live express routers and fails if:
 *   - a /cli route exists with no annotation (new sub-routes cannot
 *     widen the partner surface silently — annotate deliberately);
 *   - an annotation's `access` disagrees with the gate predicate;
 *   - a route annotated `servesContent: true` (document/attachment
 *     bytes or transcripts) is not denied.
 *
 * Adding a new /cli route? Add a row here and decide explicitly whether
 * external alliance-partner logins may reach it. Anything that can
 * return internal document/attachment content must be `denied` +
 * `servesContent: true`.
 */

export interface PartnerCliRouteAnnotation {
  /** Upper-case HTTP method, e.g. "GET". */
  method: string;
  /** Express route pattern exactly as registered, e.g. "/cli/attachments/:id". */
  path: string;
  access: "allowed" | "denied";
  /**
   * True when the route can serve document/attachment content (file
   * bytes, extracted text, turn recordings/transcripts). Such routes
   * MUST be denied to alliance partners — the probe enforces this.
   */
  servesContent?: boolean;
  reason: string;
}

export const PARTNER_CLI_ROUTE_ANNOTATIONS: readonly PartnerCliRouteAnnotation[] = [
  // ---- cliRoutes.ts — chat-turn surface (allowed; tool set is clamped
  // server-side to partnerportal.* in getToolsForPersona).
  { method: "POST", path: "/cli/turn", access: "allowed", reason: "chat turn (clamped tool surface)" },
  { method: "POST", path: "/cli/turn/:id/confirm", access: "allowed", reason: "two-phase confirm of own turn" },
  { method: "POST", path: "/cli/turn/:id/cancel", access: "allowed", reason: "cancel own in-flight turn" },
  { method: "GET", path: "/cli/sessions", access: "allowed", reason: "own session list" },
  { method: "GET", path: "/cli/sessions/:id", access: "allowed", reason: "own session detail" },
  { method: "PATCH", path: "/cli/sessions/:id", access: "allowed", reason: "rename own session" },
  { method: "DELETE", path: "/cli/sessions/:id", access: "allowed", reason: "delete own session" },
  { method: "GET", path: "/cli/turns/recent", access: "allowed", reason: "own recent turns" },
  { method: "GET", path: "/cli/turns/pending-clarification", access: "allowed", reason: "resume own clarification" },
  { method: "GET", path: "/cli/capabilities", access: "allowed", reason: "persona-clamped capability listing" },
  { method: "POST", path: "/cli/events", access: "allowed", reason: "client telemetry beacon" },

  // ---- cliAttachmentRoutes.ts — internal-document side channel: DENIED.
  { method: "POST", path: "/cli/attachments", access: "denied", servesContent: true, reason: "upload feeds internal extraction pipeline" },
  { method: "GET", path: "/cli/attachments/:id", access: "denied", servesContent: true, reason: "returns attachment bytes/extracted text" },

  // ---- cliAdminRoutes.ts — help/admin/recording surfaces: DENIED
  // (except per-turn feedback, which is scoped to the caller's own turn).
  { method: "GET", path: "/cli/help", access: "denied", reason: "internal command/help index" },
  { method: "GET", path: "/cli/help/suggestions", access: "denied", reason: "internal suggestion index" },
  { method: "POST", path: "/cli/turns/:id/feedback", access: "allowed", reason: "feedback on own turn" },
  { method: "GET", path: "/cli/turns/:id/recording", access: "denied", servesContent: true, reason: "turn recordings replay internal tool output" },
  { method: "GET", path: "/cli/admin/turns", access: "denied", reason: "org-wide admin turn listing" },
  { method: "GET", path: "/cli/admin/metrics", access: "denied", reason: "org-wide admin metrics" },
  { method: "GET", path: "/cli/admin/digest/weekly", access: "denied", reason: "org-wide admin digest" },
];

/**
 * The alliance-partner /cli sub-path allowlist used by the central gate
 * in routes/atelier/index.ts. Path-based (method-agnostic), matching
 * the concrete request path (params filled in).
 */
export function isPartnerCliPathAllowed(p: string): boolean {
  return (
    p === "/cli/turn" ||
    /^\/cli\/turn\/[^/]+\/(cancel|confirm)$/.test(p) ||
    p === "/cli/sessions" ||
    /^\/cli\/sessions\/[^/]+$/.test(p) ||
    p === "/cli/events" ||
    p === "/cli/capabilities" ||
    p === "/cli/turns/pending-clarification" ||
    p === "/cli/turns/recent" ||
    /^\/cli\/turns\/[^/]+\/feedback$/.test(p)
  );
}

/** Fill express :params with an opaque sample segment for predicate checks. */
export function samplePathFor(pattern: string): string {
  return pattern.replace(/:[A-Za-z0-9_]+/g, "sample123");
}
