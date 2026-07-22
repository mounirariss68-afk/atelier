// Meeting reminders — local notifications ~15 minutes before meetings from
// the viewer's Outlook calendar (GET /me/calendar). CRM-matched meetings
// deep-link into the account brief; purely internal meetings (Task #568)
// remind too and deep-link to the meeting itself.
//
// The preference lives in AsyncStorage; scheduling is re-synced whenever the
// calendar query refreshes (see components/MeetingReminders.tsx). Tapping a
// notification deep-links into the Meetings tab (app/(tabs)/meetings.tsx
// reads the params).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AtelierCalendarMeeting } from "@workspace/api-client-react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { REMINDER_ID_PREFIX as ID_PREFIX, REMINDER_LEAD_MINUTES, planReminders } from "./reminderPlan";

export { REMINDER_LEAD_MINUTES } from "./reminderPlan";

const PREF_KEY = "atelier.meetingReminders.enabled";

// ---------------------------------------------------------------------------
// Preference (module store + listeners so any screen can subscribe cheaply)
// ---------------------------------------------------------------------------
let enabledCache: boolean | null = null;
const listeners = new Set<(enabled: boolean) => void>();

export async function loadRemindersEnabled(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  try {
    enabledCache = (await AsyncStorage.getItem(PREF_KEY)) === "1";
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

export function getRemindersEnabledSync(): boolean {
  return enabledCache === true;
}

export async function setRemindersEnabled(enabled: boolean): Promise<void> {
  enabledCache = enabled;
  try {
    await AsyncStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {
    // best effort — in-memory value still drives this session
  }
  if (!enabled) await cancelAllMeetingReminders();
  listeners.forEach((fn) => fn(enabled));
}

export function subscribeRemindersEnabled(fn: (enabled: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Permissions & platform setup
// ---------------------------------------------------------------------------
export function remindersSupported(): boolean {
  return Platform.OS !== "web";
}

export async function ensureNotificationPermission(): Promise<
  "granted" | "denied" | "blocked"
> {
  if (!remindersSupported()) return "denied";
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
  await Notifications.setNotificationChannelAsync("meeting-reminders", {
    name: "Meeting reminders",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
  channelReady = true;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------
async function listOurScheduled(): Promise<string[]> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all
    .map((n) => n.identifier)
    .filter((id) => typeof id === "string" && id.startsWith(ID_PREFIX));
}

export async function cancelAllMeetingReminders(): Promise<void> {
  if (!remindersSupported()) return;
  try {
    const ours = await listOurScheduled();
    await Promise.all(ours.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  } catch {
    // best effort
  }
}

/**
 * Re-sync scheduled reminders against the latest calendar payload.
 * Cancels our stale reminders (moved/removed meetings) and schedules one
 * reminder per upcoming meeting, 15 minutes before start — CRM-matched
 * AND purely internal meetings (Task #568).
 */
export async function syncMeetingReminders(
  meetings: AtelierCalendarMeeting[],
  t: (key: string, vars?: Record<string, string | number>) => string,
): Promise<void> {
  if (!remindersSupported()) return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  await ensureAndroidChannel();

  const wanted = planReminders(meetings, Date.now());

  let existing: string[] = [];
  try {
    existing = await listOurScheduled();
  } catch {
    existing = [];
  }

  // Cancel reminders for meetings that no longer qualify, and re-schedule
  // everything wanted (identifier reuse replaces, so times stay correct).
  await Promise.all(
    existing
      .filter((id) => !wanted.has(id))
      .map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})),
  );

  for (const [identifier, w] of wanted) {
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    } catch {
      // not previously scheduled — fine
    }
    try {
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: w.subject || t("mtg.noSubject"),
          body: w.accountName
            ? t("mtg.reminderBody", {
                mins: REMINDER_LEAD_MINUTES,
                name: w.accountName,
              })
            : t("mtg.reminderBodyInternal", { mins: REMINDER_LEAD_MINUTES }),
          data: {
            kind: "meeting-brief",
            meetingId: w.meetingId,
            accountId: w.accountId,
            joinUrl: w.joinUrl,
          },
          ...(Platform.OS === "android" ? { channelId: "meeting-reminders" } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(w.fireAtMs),
        },
      });
    } catch {
      // one failed schedule shouldn't break the rest
    }
  }
}
