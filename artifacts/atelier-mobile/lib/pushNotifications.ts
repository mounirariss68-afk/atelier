// Task #1010 — device push registration for reminder alerts.
//
// Opt-in per user: the "Phone alerts" toggle on the Me tab registers this
// device's Expo push token with the API (POST /me/push-tokens); turning it
// off (or logging out) removes it (DELETE /me/push-tokens). The server
// mirrors due-reminder self-notification cards to registered devices, so
// alerts arrive even when the app is closed.
//
// The preference lives in AsyncStorage per-device; the source of truth for
// "does this device get pushes" is the server-side token registry.
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { API_BASE, authHeader } from "@/lib/api";

const PREF_KEY = "atelier.taskPush.enabled";
// Task #1035 — how alerts are delivered on this device: "remote" (Expo push
// via the server token registry) or "local" (device-scheduled notifications,
// the fallback where remote push can't work — Expo Go / no EAS project id).
const MODE_KEY = "atelier.taskPush.mode";

// Task #1015 — tap deep-linking helpers live in the pure module lib/pushRoute.ts
// (no expo imports) so they can be probed under tsx; re-exported for callers.
export { routeForNotificationResponse, routeForPushHref } from "@/lib/pushRoute";
const TOKEN_KEY = "atelier.taskPush.token";

export function pushSupported(): boolean {
  return Platform.OS !== "web";
}

// ---------------------------------------------------------------------------
// Preference (module store + listeners, mirrors meetingReminders.ts)
// ---------------------------------------------------------------------------
let enabledCache: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();

export async function loadPushEnabled(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  try {
    enabledCache = (await AsyncStorage.getItem(PREF_KEY)) === "1";
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

export function getPushEnabledSync(): boolean {
  return enabledCache === true;
}

export function subscribePushEnabled(fn: (enabled: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function persistPref(enabled: boolean): Promise<void> {
  enabledCache = enabled;
  try {
    await AsyncStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {
    // best effort — in-memory value still drives this session
  }
  listeners.forEach((fn) => fn(enabled));
}

// ---------------------------------------------------------------------------
// Permission + token plumbing
// ---------------------------------------------------------------------------
export async function ensurePushPermission(): Promise<"granted" | "denied" | "blocked"> {
  if (!pushSupported()) return "denied";
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return "granted";
  if (!current.canAskAgain) return "blocked";
  const asked = await Notifications.requestPermissionsAsync();
  if (asked.granted) return "granted";
  return asked.canAskAgain ? "denied" : "blocked";
}

let channelReady = false;
async function ensureAndroidChannel() {
  if (channelReady || Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("task-reminders", {
    name: "Task reminders",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  channelReady = true;
}

// Task #1035 — the EAS project id the push-token call requires. Standard
// lookup chain: expo config extra → easConfig (dev-client/store builds) →
// EXPO_PUBLIC_EAS_PROJECT_ID env (inlined at bundle time), first hit wins.
export function getEasProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  const fromEas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
    ?.projectId;
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const id = fromExtra ?? fromEas ?? (typeof fromEnv === "string" ? fromEnv : undefined);
  return id && id.trim() ? id.trim() : null;
}

/**
 * Task #1035 — why REMOTE push can't work on this device, or null when it
 * can. Checked BEFORE requesting a token so the raw
 * `No "projectId" found…` error never reaches the UI.
 * - "expo-go": running inside the Expo Go preview client — remote push
 *   tokens are unavailable there since SDK 53.
 * - "no-project-id": a real build but no EAS project id in the config.
 */
export function remotePushUnavailableReason(): "expo-go" | "no-project-id" | null {
  if (!pushSupported()) return "expo-go";
  const c = Constants as unknown as { appOwnership?: string | null; executionEnvironment?: string };
  if (c.appOwnership === "expo" || c.executionEnvironment === "storeClient") return "expo-go";
  if (!getEasProjectId()) return "no-project-id";
  return null;
}

async function getExpoToken(): Promise<string> {
  const projectId = getEasProjectId();
  const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return res.data;
}

// ---------------------------------------------------------------------------
// Delivery mode ("remote" | "local") — read by the local-reminder scheduler.
// ---------------------------------------------------------------------------
export type TaskPushMode = "remote" | "local";
let modeCache: TaskPushMode | null = null;

export async function loadPushMode(): Promise<TaskPushMode> {
  if (modeCache !== null) return modeCache;
  try {
    modeCache = (await AsyncStorage.getItem(MODE_KEY)) === "local" ? "local" : "remote";
  } catch {
    modeCache = "remote";
  }
  return modeCache;
}

async function persistMode(mode: TaskPushMode): Promise<void> {
  modeCache = mode;
  try {
    await AsyncStorage.setItem(MODE_KEY, mode);
  } catch {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Enable / disable — registers/unregisters the token with the API.
// Throws with a user-presentable Error message on failure; the toggle
// only flips after the server write succeeds (no silent fake success).
// ---------------------------------------------------------------------------
export type EnableTaskPushResult = "granted" | "blocked" | "denied" | "local-only";

export async function enableTaskPush(): Promise<EnableTaskPushResult> {
  if (!pushSupported()) return "denied";
  const perm = await ensurePushPermission();
  if (perm !== "granted") return perm;
  await ensureAndroidChannel();
  // Task #1035 — where remote push can't work (Expo Go preview, missing EAS
  // project id) fall back to device-local scheduled reminders instead of
  // letting getExpoPushTokenAsync throw its raw projectId error.
  if (remotePushUnavailableReason() !== null) {
    await persistMode("local");
    await persistPref(true);
    return "local-only";
  }
  let token: string;
  try {
    token = await getExpoToken();
  } catch (e) {
    // Defensive: an unexpected projectId/token failure still degrades to
    // local reminders rather than surfacing the raw error.
    if (/projectid/i.test((e as Error)?.message ?? "")) {
      await persistMode("local");
      await persistPref(true);
      return "local-only";
    }
    throw e;
  }
  const res = await fetch(`${API_BASE}/api/atelier/me/push-tokens`, {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token, platform: Platform.OS }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
    throw new Error(j?.detail ?? j?.error ?? `Registration failed (${res.status})`);
  }
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    // best effort
  }
  // A device that previously fell back to local mode may still carry
  // scheduled local reminders — cancel them or alerts arrive twice.
  await cancelLocalTaskReminders();
  await persistMode("remote");
  await persistPref(true);
  return "granted";
}

// Task #1035 — identifier prefix for device-local due-task reminders (see
// lib/taskLocalReminders.ts). Cancelled here on disable so turning the
// toggle off silences local-mode alerts too.
export const TASK_REMINDER_ID_PREFIX = "taskloc_";

async function cancelLocalTaskReminders(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .map((n) => n.identifier)
        .filter((id) => typeof id === "string" && id.startsWith(TASK_REMINDER_ID_PREFIX))
        .map((id) => Notifications.cancelScheduledNotificationAsync(id)),
    );
  } catch {
    // best effort
  }
}

export async function disableTaskPush(): Promise<void> {
  await cancelLocalTaskReminders();
  let token: string | null = null;
  try {
    token = await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  // Only probe for a live token where remote push actually works — in Expo
  // Go the call would throw (and there is nothing registered server-side).
  if (!token && pushSupported() && remotePushUnavailableReason() === null) {
    try {
      token = await getExpoToken();
    } catch {
      token = null;
    }
  }
  if (token) {
    const res = await fetch(`${API_BASE}/api/atelier/me/push-tokens`, {
      method: "DELETE",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    if (!res.ok && res.status !== 404) {
      const j = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
      throw new Error(j?.detail ?? j?.error ?? `Unregister failed (${res.status})`);
    }
    try {
      await AsyncStorage.removeItem(TOKEN_KEY);
    } catch {
      // best effort
    }
  }
  await persistMode("remote");
  await persistPref(false);
}
