import {
  authorizeAssistantProviderPayload,
  assertAssistantProviderAllowed,
  type AssistantDataClass,
} from "@workspace/assistant-protocol";
import { assertAssistantProviderControl } from "./control-runtime.js";

export async function getPrivacyAuthorizedAnthropic(args: {
  dataClasses: AssistantDataClass[];
  orgId?: string;
  capabilityId?: string;
  model?: string;
  catalogVersion?: string;
  policyVersion?: string;
}) {
  assertAssistantProviderAllowed({
    provider: "anthropic",
    dataClasses: args.dataClasses,
  });
  await assertAssistantProviderControl({
    orgId: args.orgId ?? "*",
    capabilityId: args.capabilityId ?? null,
    provider: "anthropic",
    model: args.model ?? null,
    catalogVersion: args.catalogVersion ?? null,
    policyVersion: args.policyVersion ?? null,
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
        if (property === "stream") {
          if (!args.model || (payloadModel && payloadModel !== args.model)) {
            throw new Error("assistant-provider-stream-model-context-required");
          }
          return invoke(authorized.payload as never, options as never);
        }
        return assertAssistantProviderControl({
          orgId: args.orgId ?? "*",
          capabilityId: args.capabilityId ?? null,
          provider: "anthropic",
          model: payloadModel ?? args.model ?? null,
          catalogVersion: args.catalogVersion ?? null,
          policyVersion: args.policyVersion ?? null,
        }).then(() =>
          invoke(authorized.payload as never, options as never),
        );
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