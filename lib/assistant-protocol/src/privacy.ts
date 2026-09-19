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

const DATA_CLASS_VALUES = new Set<AssistantDataClass>(
  Object.values(AssistantDataClass),
);

export const ASSISTANT_SINK_MAX_CLASS: Record<
  Exclude<AssistantPrivacySink, "provider">,
  AssistantDataClass
> = {
  public_response: AssistantDataClass.RESTRICTED,
  durable_event: AssistantDataClass.INTERNAL,
  log: AssistantDataClass.INTERNAL,
  telemetry: AssistantDataClass.INTERNAL,
  encrypted_persistence: AssistantDataClass.SECRET,
};

export const ASSISTANT_PROVIDER_ALLOWLIST = {
  anthropic: AssistantDataClass.RESTRICTED,
  cognidocs: AssistantDataClass.SECRET,
  perplexity: AssistantDataClass.RESTRICTED,
  ignav: AssistantDataClass.CONFIDENTIAL,
  stayingapi: AssistantDataClass.CONFIDENTIAL,
  microsoft_graph: AssistantDataClass.RESTRICTED,
} as const satisfies Record<string, AssistantDataClass>;

export type AssistantProviderId = keyof typeof ASSISTANT_PROVIDER_ALLOWLIST;

const SENSITIVE_KEY =
  /(password|passcode|secret|token|authorization|cookie|iban|swift|account.?number|national.?id|passport|visa|email|phone|address|name)/i;

const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LONG_SECRET_VALUE = /\b[A-Za-z0-9+/=_-]{32,}\b/g;
const PLANTED_CANARY_VALUE = /\bRISER_CANARY_SECRET_[A-Za-z0-9_-]+\b/g;
const IBAN_VALUE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i;
const LONG_NUMBER_VALUE = /\b\d{12,}\b/;

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

function redactAssistantValueToClass(
  value: unknown,
  maxClass: AssistantDataClass,
  key?: string,
): unknown {
  if (
    key &&
    value !== "[REDACTED]" &&
    CLASS_RANK[classifyAssistantField(key)] > CLASS_RANK[maxClass]
  ) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    let redacted = value
      .replace(BEARER_VALUE, "[REDACTED]")
      .replace(PLANTED_CANARY_VALUE, "[REDACTED]")
      .replace(LONG_SECRET_VALUE, "[REDACTED]");
    if (CLASS_RANK[maxClass] < CLASS_RANK[AssistantDataClass.RESTRICTED]) {
      redacted = redacted.replace(IBAN_VALUE, "[REDACTED]");
    }
    if (CLASS_RANK[maxClass] < CLASS_RANK[AssistantDataClass.CONFIDENTIAL]) {
      redacted = redacted.replace(EMAIL_VALUE, "[REDACTED]");
    }
    return redacted;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAssistantValueToClass(item, maxClass, key));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) &&
      CLASS_RANK[classifyAssistantField(key)] > CLASS_RANK[maxClass]
        ? "[REDACTED]"
        : redactAssistantValueToClass(item, maxClass, key),
    ]),
  );
}

export function redactAssistantValue(value: unknown): unknown {
  return redactAssistantValueToClass(value, AssistantDataClass.INTERNAL);
}

export function assistantValueContainsCanary(value: unknown): boolean {
  PLANTED_CANARY_VALUE.lastIndex = 0;
  return PLANTED_CANARY_VALUE.test(
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

export function classifyAssistantValue(value: unknown): AssistantDataClass[] {
  const classes = new Set<AssistantDataClass>([AssistantDataClass.INTERNAL]);
  const visit = (item: unknown, key?: string): void => {
    if (typeof item === "string") {
      if (item === "[REDACTED]") return;
      const fieldClass = key ? classifyAssistantField(key) : AssistantDataClass.INTERNAL;
      classes.add(fieldClass);
      PLANTED_CANARY_VALUE.lastIndex = 0;
      BEARER_VALUE.lastIndex = 0;
      EMAIL_VALUE.lastIndex = 0;
      LONG_SECRET_VALUE.lastIndex = 0;
      if (PLANTED_CANARY_VALUE.test(item) || BEARER_VALUE.test(item)) {
        classes.add(AssistantDataClass.SECRET);
      } else if (IBAN_VALUE.test(item) || LONG_NUMBER_VALUE.test(item)) {
        classes.add(AssistantDataClass.RESTRICTED);
      } else if (EMAIL_VALUE.test(item)) {
        classes.add(AssistantDataClass.CONFIDENTIAL);
      }
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, key));
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [childKey, child] of Object.entries(item as Record<string, unknown>)) {
      // JSON-schema descriptors may contain sensitive property names but no
      // sensitive value. Classify the key only when it carries a scalar.
      visit(child, child && typeof child === "object" ? undefined : childKey);
    }
  };
  visit(value);
  return [...classes].sort((a, b) => CLASS_RANK[a] - CLASS_RANK[b]);
}

export function normalizeAssistantProviderPayload<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      return item.normalize("NFC").replace(/\u0000/g, "");
    }
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(value) as T;
}

function projectAssistantProviderPayload<T>(provider: string, value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const fields: Record<string, ReadonlySet<string>> = {
    anthropic: new Set([
      "model",
      "max_tokens",
      "messages",
      "system",
      "tools",
      "tool_choice",
      "temperature",
      "top_p",
      "top_k",
      "stop_sequences",
      "stream",
      "metadata",
    ]),
    perplexity: new Set([
      "model",
      "messages",
      "temperature",
      "max_tokens",
      "search_recency_filter",
      "search_domain_filter",
    ]),
    cognidocs: new Set([
      "fileBase64",
      "fileName",
      "mimeType",
      "declaredType",
      "password",
    ]),
    ignav: new Set(["path", "body"]),
    stayingapi: new Set(["path"]),
    microsoft_graph: new Set(["path", "body"]),
  };
  const allowed = fields[provider];
  if (!allowed) throw new Error(`assistant-provider-projection-missing:${provider}`);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([key]) => allowed.has(key)),
  ) as T;
}

export function sanitizeAssistantForSink(args: {
  sink: Exclude<AssistantPrivacySink, "provider" | "encrypted_persistence">;
  value: unknown;
}): unknown {
  const maxClass = ASSISTANT_SINK_MAX_CLASS[args.sink];
  const sanitized = redactAssistantValueToClass(args.value, maxClass);
  if (assistantValueContainsCanary(sanitized)) {
    throw new Error(`assistant-privacy-canary-leak:${args.sink}`);
  }
  if (
    classifyAssistantValue(sanitized).some(
      (dataClass) => CLASS_RANK[dataClass] > CLASS_RANK[maxClass],
    )
  ) {
    throw new Error(`assistant-privacy-sink-class-denied:${args.sink}`);
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

export function authorizeAssistantProviderPayload<T>(args: {
  provider: string;
  declaredDataClasses: AssistantDataClass[];
  payload: T;
}): {
  payload: T;
  inferredDataClasses: AssistantDataClass[];
  policyVersion: typeof ASSISTANT_PRIVACY_POLICY_VERSION;
} {
  if (
    args.declaredDataClasses.length === 0 ||
    args.declaredDataClasses.some((item) => !DATA_CLASS_VALUES.has(item))
  ) {
    throw new Error("assistant-provider-data-class-declaration-invalid");
  }
  if (assistantValueContainsCanary(args.payload)) {
    throw new Error(`assistant-provider-canary-denied:${args.provider}`);
  }
  const payload = normalizeAssistantProviderPayload(
    projectAssistantProviderPayload(args.provider, args.payload),
  );
  const inferredDataClasses = classifyAssistantValue(payload);
  const declaredMax = Math.max(
    ...args.declaredDataClasses.map((item) => CLASS_RANK[item]),
  );
  if (inferredDataClasses.some((item) => CLASS_RANK[item] > declaredMax)) {
    throw new Error(`assistant-provider-data-class-undeclared:${args.provider}`);
  }
  const authorization = assertAssistantProviderAllowed({
    provider: args.provider,
    dataClasses: inferredDataClasses,
  });
  return { payload, inferredDataClasses, ...authorization };
}