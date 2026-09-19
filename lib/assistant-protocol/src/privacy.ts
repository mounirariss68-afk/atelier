export const AssistantDataClass = {
  PUBLIC: "public",
  INTERNAL: "internal",
  CONFIDENTIAL: "confidential",
  RESTRICTED: "restricted",
  SECRET: "secret",
} as const;

export type AssistantDataClass =
  (typeof AssistantDataClass)[keyof typeof AssistantDataClass];

export const ASSISTANT_PRIVACY_POLICY_VERSION = "assistant-privacy/v1" as const;

export const AssistantPrivacySink = {
  PUBLIC_RESPONSE: "public_response",
  DURABLE_EVENT: "durable_event",
  LOG: "log",
  TELEMETRY: "telemetry",
  PROVIDER: "provider",
  ENCRYPTED_PERSISTENCE: "encrypted_persistence",
} as const;

export type AssistantPrivacySink =
  (typeof AssistantPrivacySink)[keyof typeof AssistantPrivacySink];

const CLASS_RANK: Record<AssistantDataClass, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  secret: 4,
};

export const ASSISTANT_SINK_MAX_CLASS: Record<
  Exclude<AssistantPrivacySink, "provider">,
  AssistantDataClass
> = {
  public_response: AssistantDataClass.INTERNAL,
  durable_event: AssistantDataClass.INTERNAL,
  log: AssistantDataClass.INTERNAL,
  telemetry: AssistantDataClass.INTERNAL,
  encrypted_persistence: AssistantDataClass.SECRET,
};

export const ASSISTANT_PROVIDER_ALLOWLIST = {
  anthropic: AssistantDataClass.RESTRICTED,
  cognidocs: AssistantDataClass.RESTRICTED,
  ignav: AssistantDataClass.CONFIDENTIAL,
  stayingapi: AssistantDataClass.CONFIDENTIAL,
  microsoft_graph: AssistantDataClass.RESTRICTED,
} as const satisfies Record<string, AssistantDataClass>;

export type AssistantProviderId = keyof typeof ASSISTANT_PROVIDER_ALLOWLIST;

const SENSITIVE_KEY =
  /(password|passcode|secret|token|authorization|cookie|iban|swift|account.?number|national.?id|passport|visa|email|phone)/i;

const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_SECRET_VALUE = /\b[A-Za-z0-9+/=_-]{32,}\b/g;
const PLANTED_CANARY_VALUE = /\bRISER_CANARY_SECRET_[A-Za-z0-9_-]+\b/g;

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
    .replace(PLANTED_CANARY_VALUE, "[REDACTED]")
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

export function assistantValueContainsCanary(value: unknown): boolean {
  PLANTED_CANARY_VALUE.lastIndex = 0;
  return PLANTED_CANARY_VALUE.test(
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

export function sanitizeAssistantForSink(args: {
  sink: Exclude<AssistantPrivacySink, "provider" | "encrypted_persistence">;
  value: unknown;
}): unknown {
  const sanitized = redactAssistantValue(args.value);
  if (assistantValueContainsCanary(sanitized)) {
    throw new Error(`assistant-privacy-canary-leak:${args.sink}`);
  }
  return sanitized;
}

export function assertAssistantProviderAllowed(args: {
  provider: string;
  dataClasses: AssistantDataClass[];
}): { policyVersion: typeof ASSISTANT_PRIVACY_POLICY_VERSION } {
  const maxClass =
    ASSISTANT_PROVIDER_ALLOWLIST[args.provider as AssistantProviderId];
  if (!maxClass) throw new Error(`assistant-provider-not-allowlisted:${args.provider}`);
  if (args.dataClasses.some((dataClass) => CLASS_RANK[dataClass] > CLASS_RANK[maxClass])) {
    throw new Error(`assistant-provider-data-class-denied:${args.provider}`);
  }
  return { policyVersion: ASSISTANT_PRIVACY_POLICY_VERSION };
}