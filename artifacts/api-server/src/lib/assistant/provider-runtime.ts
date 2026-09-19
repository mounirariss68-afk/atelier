import {
  ASSISTANT_PRIVACY_POLICY_VERSION,
  authorizeAssistantProviderPayload,
  assertAssistantProviderAllowed,
  type AssistantDataClass,
} from "@workspace/assistant-protocol";
import { currentCapabilityManifestVersion } from "../atelier-cli/capability-manifest.js";
import { assertAssistantProviderControl } from "./control-runtime.js";

export async function getPrivacyAuthorizedAnthropic(args: {
  dataClasses: AssistantDataClass[];
  orgId: string;
  capabilityId: string;
  model: string;
  catalogVersion?: string;
  policyVersion?: string;
}) {
  const catalogVersion =
    args.catalogVersion ?? currentCapabilityManifestVersion();
  const policyVersion =
    args.policyVersion ?? ASSISTANT_PRIVACY_POLICY_VERSION;
  assertAssistantProviderAllowed({
    provider: "anthropic",
    dataClasses: args.dataClasses,
  });
  await assertAssistantProviderControl({
    orgId: args.orgId,
    capabilityId: args.capabilityId,
    provider: "anthropic",
    model: args.model,
    catalogVersion,
    policyVersion,
  });
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  const messages = new Proxy(anthropic.messages, {
    get(target, property, receiver) {
      if (property !== "create" && property !== "stream") {
        return Reflect.get(target, property, receiver);
      }
      const invoke = target[property].bind(target);
      return (payload: unknown, options?: unknown) => {
        const authorized = authorizeAssistantProviderPayload({
          provider: "anthropic",
          declaredDataClasses: args.dataClasses,
          payload,
        });
        const payloadModel =
          authorized.payload &&
          typeof authorized.payload === "object" &&
          typeof (authorized.payload as { model?: unknown }).model === "string"
            ? (authorized.payload as { model: string }).model
            : null;
        if (!payloadModel || payloadModel !== args.model) {
          throw new Error("assistant-provider-model-context-mismatch");
        }
        if (property === "stream") {
          return invoke(authorized.payload as never, options as never);
        }
        const invokeCreate = invoke as (
          payload: unknown,
          options?: unknown,
        ) => Promise<unknown>;
        return assertAssistantProviderControl({
          orgId: args.orgId,
          capabilityId: args.capabilityId,
          provider: "anthropic",
          model: payloadModel,
          catalogVersion,
          policyVersion,
        }).then(() => invokeCreate(authorized.payload, options));
      };
    },
  });
  const wrapped = new Proxy(anthropic, {
    get(target, property, receiver) {
      if (property === "messages") return messages;
      return Reflect.get(target, property, receiver);
    },
  });
  return { anthropic: wrapped };
}