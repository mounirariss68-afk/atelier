import { AsyncLocalStorage } from "node:async_hooks";

export interface AssistantProviderContext {
  orgId: string;
  capabilityId: string;
}

const providerContext = new AsyncLocalStorage<AssistantProviderContext>();

export function runWithAssistantProviderContext<T>(
  context: AssistantProviderContext,
  fn: () => Promise<T>,
): Promise<T> {
  if (!context.orgId || !context.capabilityId) {
    throw new Error("assistant-provider-context-required");
  }
  return providerContext.run(context, fn);
}

export function requireAssistantProviderContext(): AssistantProviderContext {
  const context = providerContext.getStore();
  if (!context?.orgId || !context.capabilityId) {
    throw new Error("assistant-provider-context-required");
  }
  return context;
}