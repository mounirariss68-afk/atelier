export {
  getHealthCheckUrl,
  healthCheck,
  getHealthCheckQueryKey,
  getHealthCheckQueryOptions,
  useHealthCheck,
  getChatUrl,
  chat,
  getChatMutationOptions,
} from "./generated/api";
export type {
  HealthCheckQueryResult,
  HealthCheckQueryError,
  ChatMutationResult,
  ChatMutationBody,
  ChatMutationError,
} from "./generated/api";

import { useChat as _useChat } from "./generated/api";

/**
 * @deprecated `POST /chat` is a Server-Sent Events stream, but orval
 * generates this mutation as a one-shot JSON POST returning a string.
 * Calling this hook will swallow the token stream and almost always
 * return an empty/garbled value. Use `useChatStream` (in
 * `artifacts/maven-ai/src/hooks/useChatStream.ts`) or write your own
 * SSE-aware fetch instead. Re-exported only so types stay co-located
 * with the rest of the generated client.
 */
export const useChat = _useChat;

export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
