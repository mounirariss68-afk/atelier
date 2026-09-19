import { sanitizeAssistantForSink } from "@workspace/assistant-protocol";

export function sanitizeCliPersistence<T>(value: T): T {
  return sanitizeAssistantForSink({
    sink: "durable_event",
    value,
  }) as T;
}

export function sanitizeCliPublicResponse<T>(value: T): T {
  return sanitizeAssistantForSink({
    sink: "public_response",
    value,
  }) as T;
}

export function emitCliTelemetry(payload: Record<string, unknown>): void {
  const sanitized = sanitizeAssistantForSink({
    sink: "telemetry",
    value: payload,
  });
  console.log(`[cli-telemetry] ${JSON.stringify(sanitized)}`);
}

export function safeCliErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeAssistantForSink({
    sink: "log",
    value: message,
  }) as string;
}