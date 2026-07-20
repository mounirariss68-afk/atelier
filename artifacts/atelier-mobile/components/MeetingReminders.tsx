// Headless companion mounted inside the authenticated tab layout.
// 1. Keeps local meeting reminders in sync with the viewer's CRM-matched
//    calendar (same GET /me/calendar query the Meetings tab uses).
// 2. Routes notification taps (foreground, background, and cold start) into
//    the Meetings tab with the meeting/account so the brief auto-opens.
import {
  getAtelierGetMyCalendarQueryKey,
  getAtelierGetMyMsConnectionQueryKey,
  useAtelierGetMyCalendar,
  useAtelierGetMyMsConnection,
} from "@workspace/api-client-react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/contexts/I18nContext";
import {
  loadRemindersEnabled,
  remindersSupported,
  subscribeRemindersEnabled,
  syncMeetingReminders,
} from "@/lib/meetingReminders";

if (remindersSupported()) {
  // Show reminders even while the app is foregrounded.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function briefParams(data: unknown): { meetingId: string; accountId: string } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== "meeting-brief") return null;
  if (typeof d.meetingId !== "string" || typeof d.accountId !== "string") return null;
  return { meetingId: d.meetingId, accountId: d.accountId };
}

function windowIso(days: number) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function MeetingReminders() {
  const router = useRouter();
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    loadRemindersEnabled().then((v) => {
      if (alive) setEnabled(v);
    });
    const unsub = subscribeRemindersEnabled(setEnabled);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const conn = useAtelierGetMyMsConnection({
    query: {
      queryKey: getAtelierGetMyMsConnectionQueryKey(),
      enabled: remindersSupported() && enabled,
    },
  });
  const connected = Boolean(conn.data?.configured && conn.data?.connected);
  const win = useMemo(() => windowIso(7), []);
  const calendar = useAtelierGetMyCalendar(win, {
    query: {
      queryKey: getAtelierGetMyCalendarQueryKey(win),
      enabled: remindersSupported() && enabled && connected,
      retry: false,
      staleTime: 5 * 60_000,
      refetchInterval: 15 * 60_000,
    },
  });

  const meetings = calendar.data?.meetings;
  useEffect(() => {
    if (!remindersSupported() || !enabled || !meetings) return;
    syncMeetingReminders(meetings, t).catch(() => {});
  }, [enabled, meetings, t]);

  // Tap handling — background/foreground taps plus cold-start launch.
  useEffect(() => {
    if (!remindersSupported()) return;
    const open = (resp: Notifications.NotificationResponse | null) => {
      const params = briefParams(resp?.notification.request.content.data);
      if (!params) return;
      router.push({
        pathname: "/(tabs)/meetings",
        params: { focusMeetingId: params.meetingId, focusAccountId: params.accountId },
      });
    };
    Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);

  return null;
}
