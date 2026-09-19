export const AssistantDataClass = {
  PUBLIC: "public",
  INTERNAL: "internal",
  CONFIDENTIAL: "confidential",
  RESTRICTED: "restricted",
  SECRET: "secret",
} as const;

export type AssistantDataClass =
  (typeof AssistantDataClass)[keyof typeof AssistantDataClass];

const SENSITIVE_KEY =
  /(password|passcode|secret|token|authorization|cookie|iban|swift|account.?number|national.?id|passport|visa|email|phone)/i;

const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_SECRET_VALUE = /\b[A-Za-z0-9+/=_-]{32,}\b/g;

export function classifyAssistantField(key: string): AssistantDataClass {
  if (/password|passcode|secret|token|authorization|cookie/i.test(key)) {
    return AssistantDataClass.SECRET;
  }
  if (/iban|swift|account.?number|national.?id|passport|visa/i.test(key)) {
    return AssistantDataClass.RESTRICTED;
  }
  if (/email|phone|address|name/i.test(key)) {
    return AssistantDataClass.CONFIDENTIAL;
  }
  return AssistantDataClass.INTERNAL;
}

export function redactAssistantText(value: string): string {
  return value
    .replace(BEARER_VALUE, "[REDACTED]")
    .replace(EMAIL_VALUE, "[REDACTED]")
    .replace(LONG_SECRET_VALUE, "[REDACTED]");
}

export function redactAssistantValue(value: unknown): unknown {
  if (typeof value === "string") return redactAssistantText(value);
  if (Array.isArray(value)) return value.map(redactAssistantValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactAssistantValue(item),
    ]),
  );
}