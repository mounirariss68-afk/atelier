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

// NOTE: the auto-generated `useChat` mutation is intentionally NOT
// re-exported. `POST /chat` is a Server-Sent Events stream, but orval
// emits a one-shot JSON-POST mutation that swallows the token stream.
// Use `useChatStream` (in `artifacts/maven-ai/src/hooks/useChatStream.ts`)
// or write your own SSE-aware fetch. Importing `useChat` directly from
// `@workspace/api-client-react/src/generated/api` is possible but
// strongly discouraged — it almost always returns empty/garbled output.

export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
