// Task #1044 — optional biometric app lock (Face ID / Touch ID with device
// passcode fallback), toggled from Settings.
//
// Preference lives on-device in AsyncStorage (same module-store + listener
// pattern as lib/pushNotifications.ts). The expo-local-authentication module
// is feature-detected lazily and every call fails CLOSED-but-safe: if the
// native module is missing (Expo Go preview, older installed build receiving
// this JS via update), the lock reports "unsupported", the Settings toggle
// hides, and the gate never blocks the app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import type { BiometricKind } from "@/lib/appLockCore";

const PREF_KEY = "atelier.appLock.enabled";

// ---------------------------------------------------------------------------
// Lazy native module (mirrors the Liquid Glass gating pattern in ui.tsx —
// requiring or calling the module can throw when the binary doesn't ship it).
// ---------------------------------------------------------------------------
type LocalAuthModule = typeof import("expo-local-authentication");

let moduleCache: LocalAuthModule | null | undefined;

function getLocalAuth(): LocalAuthModule | null {
  if (moduleCache !== undefined) return moduleCache;
  if (Platform.OS === "web") {
    moduleCache = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    moduleCache = require("expo-local-authentication") as LocalAuthModule;
  } catch {
    moduleCache = null;
  }
  return moduleCache;
}

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------
export interface AppLockCapability {
  supported: boolean;
  /** Which biometric the device offers (for the toggle label). */
  kind: BiometricKind;
  /** Biometrics exist but none are enrolled — show the explanation row. */
  enrolled: boolean;
}

export async function getAppLockCapability(): Promise<AppLockCapability> {
  const la = getLocalAuth();
  if (!la) return { supported: false, kind: "none", enrolled: false };
  try {
    const hasHardware = await la.hasHardwareAsync();
    if (!hasHardware) return { supported: false, kind: "none", enrolled: false };
    const types = await la.supportedAuthenticationTypesAsync();
    const kind: BiometricKind = types.includes(la.AuthenticationType.FACIAL_RECOGNITION)
      ? "face"
      : types.includes(la.AuthenticationType.FINGERPRINT)
        ? "fingerprint"
        : "none";
    if (kind === "none") return { supported: false, kind, enrolled: false };
    const enrolled = await la.isEnrolledAsync();
    return { supported: true, kind, enrolled };
  } catch {
    return { supported: false, kind: "none", enrolled: false };
  }
}

/**
 * Prompt Face ID / Touch ID with device-passcode fallback.
 * Returns true only on a confirmed successful authentication; any module
 * failure, cancellation, or missing hardware returns false (fail closed —
 * the lock screen stays up and the user can retry).
 */
export async function authenticateForAppLock(promptMessage: string): Promise<boolean> {
  const la = getLocalAuth();
  if (!la) return false;
  try {
    const result = await la.authenticateAsync({
      promptMessage,
      // Allow the device passcode as fallback after failed biometrics.
      disableDeviceFallback: false,
      cancelLabel: undefined,
    });
    return result.success === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Preference (module store + listeners)
// ---------------------------------------------------------------------------
let enabledCache: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();

export async function loadAppLockEnabled(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  try {
    enabledCache = (await AsyncStorage.getItem(PREF_KEY)) === "1";
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

export function getAppLockEnabledSync(): boolean {
  return enabledCache === true;
}

export function subscribeAppLockEnabled(fn: (enabled: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  enabledCache = enabled;
  try {
    await AsyncStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {
    // best effort — in-memory value still drives this session
  }
  listeners.forEach((fn) => fn(enabled));
}
