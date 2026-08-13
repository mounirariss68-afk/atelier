// Mock of expo-local-authentication for offline probes (tests/app-lock-probe.ts).
// Scriptable per-scenario via __setScenario.

export const AuthenticationType = {
  FINGERPRINT: 1,
  FACIAL_RECOGNITION: 2,
  IRIS: 3,
} as const;

interface Scenario {
  hasHardware: boolean;
  types: number[];
  enrolled: boolean;
  authResult: boolean | "throw";
  moduleThrows?: boolean;
}

let scenario: Scenario = {
  hasHardware: true,
  types: [AuthenticationType.FACIAL_RECOGNITION],
  enrolled: true,
  authResult: true,
};

export const authCalls: { promptMessage?: string; disableDeviceFallback?: boolean }[] = [];

export function __setScenario(next: Partial<Scenario>) {
  scenario = { ...scenario, ...next };
}

export async function hasHardwareAsync(): Promise<boolean> {
  if (scenario.moduleThrows) throw new Error("native module missing");
  return scenario.hasHardware;
}

export async function supportedAuthenticationTypesAsync(): Promise<number[]> {
  if (scenario.moduleThrows) throw new Error("native module missing");
  return scenario.types;
}

export async function isEnrolledAsync(): Promise<boolean> {
  if (scenario.moduleThrows) throw new Error("native module missing");
  return scenario.enrolled;
}

export async function authenticateAsync(options?: {
  promptMessage?: string;
  disableDeviceFallback?: boolean;
  cancelLabel?: string;
}): Promise<{ success: boolean; error?: string }> {
  authCalls.push({
    promptMessage: options?.promptMessage,
    disableDeviceFallback: options?.disableDeviceFallback,
  });
  if (scenario.moduleThrows || scenario.authResult === "throw") {
    throw new Error("auth module failure");
  }
  return scenario.authResult ? { success: true } : { success: false, error: "user_cancel" };
}
