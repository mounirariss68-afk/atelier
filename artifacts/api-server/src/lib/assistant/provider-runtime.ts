import {
  authorizeAssistantProviderPayload,
  assertAssistantProviderAllowed,
  type AssistantDataClass,
} from "@workspace/assistant-protocol";

export async function getPrivacyAuthorizedAnthropic(args: {
  dataClasses: AssistantDataClass[];
}) {
  assertAssistantProviderAllowed({
    provider: "anthropic",
    dataClasses: args.dataClasses,
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
        return invoke(
          authorized.payload as never,
          options as never,
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