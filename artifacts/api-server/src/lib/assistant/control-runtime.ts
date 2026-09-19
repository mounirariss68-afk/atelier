import { createHash } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db, atelierAssistantControls } from "@workspace/db";
import { PolicyDecisionV1Schema, type PolicyDecisionV1 } from "@workspace/assistant-protocol";

export async function evaluateAssistantPolicy(args: {
  orgId: string;
  capabilityId: string;
  baseAllowed: boolean;
  obligations: string[];
  policyVersion: string;
}): Promise<PolicyDecisionV1> {
  const controls = await db
    .select()
    .from(atelierAssistantControls)
    .where(
      and(
        eq(atelierAssistantControls.enabled, true),
        or(isNull(atelierAssistantControls.orgId), eq(atelierAssistantControls.orgId, args.orgId)),
        or(isNull(atelierAssistantControls.expiresAt), gt(atelierAssistantControls.expiresAt, new Date())),
      ),
    );
  const blocking = controls
    .filter(
      (control) =>
        (control.scope === "org" && (control.scopeKey === "*" || control.scopeKey === args.orgId)) ||
        (control.scope === "capability" &&
          (control.scopeKey === "*" || control.scopeKey === args.capabilityId)),
    )
    .filter((control) => control.mode === "deny" || control.mode === "quarantine")
    .sort((a, b) => b.version - a.version)[0];
  const material = JSON.stringify({
    orgId: args.orgId,
    capabilityId: args.capabilityId,
    baseAllowed: args.baseAllowed,
    obligations: [...args.obligations].sort(),
    policyVersion: args.policyVersion,
    control: blocking ? { id: blocking.id, version: blocking.version, mode: blocking.mode } : null,
  });
  const decisionDigest = createHash("sha256").update(material).digest("hex");
  if (!args.baseAllowed || blocking) {
    return PolicyDecisionV1Schema.parse({
      effect: "deny",
      policyVersion: args.policyVersion,
      code: blocking ? "operator_control" : "policy_denied",
      safeReason: blocking
        ? "This capability is temporarily unavailable."
        : "This request is not authorized.",
      decisionDigest,
    });
  }
  return PolicyDecisionV1Schema.parse({
    effect: "allow",
    policyVersion: args.policyVersion,
    obligations: args.obligations,
    decisionDigest,
  });
}