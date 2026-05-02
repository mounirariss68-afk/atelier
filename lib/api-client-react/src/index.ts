export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

/**
 * NOTE: the auto-generated `useChat` mutation in `./generated/api` models
 * `POST /chat` as a one-shot JSON request returning a string. The real
 * endpoint is a streaming SSE response. Do NOT call `useChat` for chat
 * UI — use `useChatStream` from `artifacts/maven-ai/src/hooks/useChatStream`
 * (or write an equivalent SSE-aware hook) so token-by-token rendering
 * works. The generated mutation only exists because orval emits one per
 * operation; it is retained for type sharing but should not drive UI.
 */
