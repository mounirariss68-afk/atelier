import {
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
  return import("@workspace/integrations-anthropic-ai");
}