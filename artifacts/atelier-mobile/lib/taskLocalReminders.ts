// Task #1035 — device-local due-task reminders: the fallback delivery path
// where remote Expo push can't work (Expo Go preview / no EAS project id).
//
// When the "Phone alerts" toggle is on in "local" mode, the Me tab re-syncs
// one scheduled local notification per open task with a future due time
// against the latest /me/tasks payload. Remote mode never schedules here —
// the server pushes to the registered token instead (lib/pushNotifications).
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import {
  TASK_REMINDER_ID_PREFIX,
  getPushEnabledSync,
  loadPushEnabled,
  loadPushMode,
  pushSupported,
} from "@/lib/pushNotifications";

interface DueTaskLike {
  id: string;
  title: string;
  status: string;
  dueAt?: string | null;
}

/** iOS/Android cap safety — plenty for a personal task list. */
const MAX_SCHEDULED = 32;

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

/**
 * Re-sync local reminders against the latest tasks payload. Cancels our
 * stale ones (completed/deleted/re-dated tasks) and schedules one alert at
 * each open task's due time. No-op unless the alerts pref is on in local
 * mode with notification permission granted.
 */
export async function syncTaskLocalReminders(tasks: readonly DueTaskLike[]): Promise<void> {
  if (!pushSupported()) return;
  const enabled = getPushEnabledSync() || (await loadPushEnabled());
  if (!enabled) return;
  if ((await loadPushMode()) !== "local") return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  await ensureAndroidChannel();

  const now = Date.now();
  const due = tasks
    .filter((t) => t.status === "open" && t.dueAt && new Date(t.dueAt).getTime() > now)
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())
    .slice(0, MAX_SCHEDULED);
  const wanted = new Map(due.map((t) => [`${TASK_REMINDER_ID_PREFIX}${t.id}_${new Date(t.dueAt!).getTime()}`, t]));

  try {
    const existing = (await Notifications.getAllScheduledNotificationsAsync())
      .map((n) => n.identifier)
      .filter((id): id is string => typeof id === "string" && id.startsWith(TASK_REMINDER_ID_PREFIX));
    // Cancel stale (task gone, done, or due time changed — the id encodes it).
    await Promise.all(
      existing.filter((id) => !wanted.has(id)).map((id) => Notifications.cancelScheduledNotificationAsync(id)),
    );
    const existingSet = new Set(existing);
    for (const [identifier, task] of wanted) {
      if (existingSet.has(identifier)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: "Task due",
          body: task.title,
          data: { href: "/me" },
          ...(Platform.OS === "android" ? { channelId: "task-reminders" } : null),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(task.dueAt!),
        },
      });
    }
  } catch {
    // best effort — reminders are a convenience, never crash the tab
  }
}
