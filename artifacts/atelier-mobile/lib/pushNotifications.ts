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

async function getExpoToken(): Promise<string> {
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return res.data;
}

// ---------------------------------------------------------------------------
// Enable / disable — registers/unregisters the token with the API.
// Throws with a user-presentable Error message on failure; the toggle
// only flips after the server write succeeds (no silent fake success).
// ---------------------------------------------------------------------------
export async function enableTaskPush(): Promise<"granted" | "blocked" | "denied"> {
  if (!pushSupported()) return "denied";
  const perm = await ensurePushPermission();
  if (perm !== "granted") return perm;
  await ensureAndroidChannel();
  const token = await getExpoToken();
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
  await persistPref(true);
  return "granted";
}

export async function disableTaskPush(): Promise<void> {
  let token: string | null = null;
  try {
    token = await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  if (!token && pushSupported()) {
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
  await persistPref(false);
}
