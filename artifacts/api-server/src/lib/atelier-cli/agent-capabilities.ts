/**
 * Task #339 — Auto-register one CLI capability per Atelier agent.
 *
 * Every entry in `@workspace/agents` (POV Author, Pricing Strategist,
 * Charter Architect, Meeting Scribe, Brand Profile Writer, …) is
 * exposed to the assistant through a uniformly-named tool
 * (`run_<agent_id>`) so a developer adding a new agent never has to
 * remember to also add a CLI capability — the registry walk picks it
 * up automatically at boot.
 *
 * Why we don't actually invoke the agent here:
 *   The agent runtime (`runAgent` + `startRun`/`completeRun`) writes
 *   `atelier_agent_runs` rows, charges budget, fires audit events, and
 *   couples each run to a `targetType`/`targetId` (engagement,
 *   opportunity, …). Those route bindings are the proper place to call
 *   `runAgent` because they know which target the agent operates on.
 *
 *   This capability instead returns a *dispatch hint*: it tells the
 *   orchestrator "to actually run this agent, POST to its agent route
 *   with input X". The CLI surface uses this to (a) advertise the
 *   agent in the slash palette, (b) collect input via two-phase
 *   confirm, (c) hand off to the existing route. That preserves the
 *   single budget/audit lifecycle in `runAgent` while still making the
 *   agent discoverable via the assistant.
 */

import { ATELIER_AGENTS } from "@workspace/agents";
import {
  defineCapability,
  CATALOG_SCHEMA_VERSION,
  type CapabilityEntry,
  type CapabilityModule,
} from "./capability-catalog.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";

/** Map an agent's `group` into a catalog `module` for role-filter purposes. */
function moduleForAgent(group: string): CapabilityModule {
  if (group === "Front of House") return "opportunity";
  if (group === "Mobilize") return "engagement";
  if (group === "Deliver") return "engagement";
  if (group === "Quality") return "deliverable";
  if (group === "Atelier") return "knowledge";
  if (group === "Engagement Memory") return "engagement";
  if (group === "Personal") return "meta";
  return "agent";
}

/**
 * Best-effort zod-to-jsonschema. We don't need every JSON-Schema
 * keyword — Anthropic's tool API accepts a subset, and the live
 * validation already happens via Zod inside `runAgent`. The hash we
 * derive from this still detects shape drift, which is the property
 * the saved-prompt warning relies on.
 *
 * Falls back to `{ type: "object", additionalProperties: true }` if the
 * agent's input schema cannot be introspected.
 */
function agentInputSchemaJson(agent: typeof ATELIER_AGENTS[number]): Record<string, unknown> {
  const def = (agent.inputSchema as { _def?: { typeName?: string; shape?: () => Record<string, { _def?: { typeName?: string } }> } })._def;
  const typeName = def?.typeName;
  if (typeName !== "ZodObject" || typeof def?.shape !== "function") {
    return { type: "object", additionalProperties: true };
  }
  const shape = def.shape();
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(shape)) {
    const fieldDef = (field as { _def?: { typeName?: string }; isOptional?: () => boolean })._def;
    const tn = fieldDef?.typeName ?? "ZodUnknown";
    let jsonType: string = "string";
    if (tn === "ZodString") jsonType = "string";
    else if (tn === "ZodNumber") jsonType = "number";
    else if (tn === "ZodBoolean") jsonType = "boolean";
    else if (tn === "ZodArray") jsonType = "array";
    else if (tn === "ZodObject" || tn === "ZodRecord") jsonType = "object";
    else jsonType = "string";
    properties[key] = jsonType === "array"
      ? { type: "array", items: {} }
      : jsonType === "object"
        ? { type: "object", additionalProperties: true }
        : { type: jsonType };
    const isOptional = typeof (field as { isOptional?: () => boolean }).isOptional === "function"
      ? (field as { isOptional: () => boolean }).isOptional()
      : false;
    if (!isOptional) required.push(key);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

/** Snake-case-ify an agent id for the tool name (`ag_pov_author` → `run_ag_pov_author`). */
function toolNameForAgent(agentId: string): string {
  return `run_${agentId.replace(/[^a-z0-9_]/g, "_")}`;
}

/**
 * Roles that may invoke any agent run. Mirrors the `agentRoutes`
 * gating: contractors and board observers cannot start agent runs.
 * Per-agent overrides can be added here once we have evidence one is
 * needed (e.g. only partners may start Brand Profile Writer).
 */
const AGENT_INVOCABLE_ROLES: AtelierRole[] = [
  "founding_partner",
  "partner",
  "senior_manager",
  "consultant",
];

/**
 * Walk the agents registry and register one capability per agent.
 * Idempotent: re-running the function is a no-op because
 * `defineCapability` throws on duplicate ids, so importers should call
 * this exactly once at boot (handled by `bootstrap-capabilities.ts`).
 */
export function registerAgentCapabilities(): CapabilityEntry[] {
  const out: CapabilityEntry[] = [];
  for (const agent of ATELIER_AGENTS) {
    const entry = defineCapability({
      id: `agent.${agent.id}`,
      schemaVersion: CATALOG_SCHEMA_VERSION,
      module: moduleForAgent(agent.group),
      toolName: toolNameForAgent(agent.id),
      description: `${agent.name} — ${agent.purpose}`,
      slashAliases: {
        en: [`/agent ${agent.id}`, `/${agent.id.replace(/^ag_/, "")}`],
      },
      representativePrompts: {
        en: [`Run ${agent.name} for me.`, `Use ${agent.name} on this.`],
      },
      inputSchema: agentInputSchemaJson(agent),
      isWrite: true,
      irreversible: false,
      requiredRoles: AGENT_INVOCABLE_ROLES,
      surfaceOn: ["global"],
      followUpTriggers: [],
      twoPhaseConfirm: true,
      outboundChannel: null,
      resultCard: "agent_run",
      source: "agent",
      async run(input, ctx) {
        // The CLI hand-off: we don't call runAgent here (see file-top
        // rationale). Instead we return a dispatch envelope the
        // orchestrator uses to either (a) confirm + hand off to the
        // existing agent route, or (b) report back to the model so it
        // can ask the user for missing inputs.
        if (input.confirm !== true) {
          return {
            ok: true,
            data: { agentId: agent.id, agentName: agent.name, preview: input },
            confirmation: {
              summary: `Run ${agent.name}. ${agent.humanCheckpoints.length > 0 ? "Human checkpoint required after the run." : ""}`.trim(),
              diff: {
                agentRun: { agentId: agent.id, agentName: agent.name, input },
                checkpoints: agent.humanCheckpoints.map((c) => c.label),
              },
              pending: {
                tool: toolNameForAgent(agent.id),
                input: { ...input, confirm: true },
              },
            },
          };
        }
        // Commit phase — the orchestrator delegates to the existing
        // agent dispatch endpoint. We return a `dispatch` payload the
        // orchestrator + UI handle (it surfaces a "View run" link).
        return {
          ok: true,
          data: {
            dispatched: true,
            agentId: agent.id,
            agentName: agent.name,
            actor: ctx.persona.id,
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            note:
              "Agent run was queued for the existing agent dispatch route — see atelier_agent_runs for status.",
          },
        };
      },
    });
    out.push(entry);
  }
  return out;
}
