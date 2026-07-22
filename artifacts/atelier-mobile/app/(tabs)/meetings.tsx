// Meetings tab — the viewer's next 7 days from their Outlook calendar,
// CRM-matched by the server (same GET /me/calendar as the web Home card).
// CRM-matched rows offer an inline pre-meeting brief backed by
// GET /atelier/accounts/:accountId/meeting-brief — the same three sections
// as the web MeetingBriefPanel: recent activity, open opportunities,
// outstanding tasks/actions.
import { Feather } from "@expo/vector-icons";
import {
  getAtelierGetAccountMeetingBriefQueryKey,
  getAtelierGetMyCalendarQueryKey,
  useAtelierGetAccountMeetingBrief,
  useAtelierGetMyCalendar,
  useAtelierGetMyMsConnection,
  type AtelierCalendarMeeting,
} from "@workspace/api-client-react";
import * as ExpoLinking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiJson } from "@/lib/api";

import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Skeleton,
  WEB_TAB_BAR,
  WEB_TOP_INSET,
  hapticLight,
} from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";

// Open a meeting join link reliably: web opens a new tab (popup-blocker
// aware), native tries the deep link (Teams/Meet/Zoom apps) and falls back
// to the in-app browser. Any failure surfaces a visible error instead of
// silent nothing.
async function openJoinUrl(url: string, errorMsg: string) {
  hapticLight();
  try {
    if (Platform.OS === "web") {
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) throw new Error("popup-blocked");
      return;
    }
    const can = await Linking.canOpenURL(url).catch(() => false);
    if (can) {
      await Linking.openURL(url);
      return;
    }
    await WebBrowser.openBrowserAsync(url);
  } catch {
    if (Platform.OS === "web") {
      window.alert(errorMsg);
    } else {
      Alert.alert(errorMsg);
    }
  }
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(iso: string, t: (k: string) => string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(d, today)) return t("common.today");
  if (same(d, tomorrow)) return t("mtg.tomorrow");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtDue(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const STAGE_LABELS: Record<string, string> = {
  suspect: "Suspect",
  prospect: "Prospect",
  convert: "Convert",
  runner: "Runner",
  contract: "Contract",
  lost: "Lost",
  no_decision: "No decision",
  withdrawn: "Withdrawn",
};

function SectionHeading({ label }: { label: string }) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <Text
      style={{
        color: c.mutedForeground,
        fontFamily: "PlusJakartaSans_600SemiBold",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.8,
        textAlign: rtl.textAlign,
      }}
    >
      {label}
    </Text>
  );
}

/** Lazily fetched pre-meeting brief for one matched account. */
function MeetingBriefPanel({ accountId }: { accountId: string }) {
  const c = useColors();
  const rtl = useRTL();
  const { t } = useI18n();
  const { data, isPending, error } = useAtelierGetAccountMeetingBrief(accountId, {
    query: {
      queryKey: getAtelierGetAccountMeetingBriefQueryKey(accountId),
      retry: false,
      staleTime: 60_000,
    },
  });

  if (isPending) {
    return (
      <View style={{ marginTop: 10, gap: 8 }}>
        <Skeleton height={14} width="60%" />
        <Skeleton height={14} width="80%" />
        <Skeleton height={14} width="70%" />
      </View>
    );
  }
  if (error || !data) {
    return (
      <Text
        style={{
          marginTop: 10,
          color: c.mutedForeground,
          fontFamily: "PlusJakartaSans_400Regular",
          fontSize: 13,
          textAlign: rtl.textAlign,
        }}
      >
        {t("mtg.briefError")}
      </Text>
    );
  }

  const tasks = [
    ...data.openTasks.map((task) => ({
      key: `task-${task.id}`,
      title: task.title,
      due: task.dueDate,
      overdue: Boolean(task.overdue),
      who: task.ownerName ?? null,
    })),
    ...data.openActions.map((a) => ({
      key: `action-${a.id}`,
      title: a.title,
      due: a.dueDate,
      overdue: a.overdue,
      who: a.ownerName ?? null,
    })),
  ].slice(0, 6);

  const line = {
    color: c.mutedForeground,
    fontFamily: "PlusJakartaSans_400Regular" as const,
    fontSize: 13,
    textAlign: rtl.textAlign,
  };

  return (
    <View
      style={{
        marginTop: 10,
        borderRadius: c.radius + 2,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: c.secondary,
        padding: 12,
        gap: 12,
      }}
    >
      <SectionHeading label={`${t("mtg.briefTitle")} · ${data.accountName}`} />

      <View style={{ gap: 6 }}>
        <SectionHeading label={t("mtg.recentActivity")} />
        {data.recentActivity.length === 0 ? (
          <Text style={line}>{t("mtg.noActivity")}</Text>
        ) : (
          data.recentActivity.slice(0, 4).map((e) => (
            <Text key={e.id} style={line} numberOfLines={2}>
              {new Date(e.date).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
              {" · "}
              {e.title}
              {e.actorName ? ` — ${e.actorName}` : ""}
            </Text>
          ))
        )}
      </View>

      <View style={{ gap: 6 }}>
        <SectionHeading label={t("mtg.openOpps")} />
        {data.openOpportunities.length === 0 ? (
          <Text style={line}>{t("mtg.noOpps")}</Text>
        ) : (
          data.openOpportunities.slice(0, 4).map((o) => (
            <View
              key={o.id}
              style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}
            >
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_500Medium",
                  fontSize: 13,
                  textAlign: rtl.textAlign,
                }}
              >
                {o.name}
              </Text>
              <Chip label={STAGE_LABELS[o.salesStage] ?? o.salesStage} bg={c.card} />
              <Text
                style={{
                  color: c.mutedForeground,
                  fontFamily: "PlusJakartaSans_400Regular",
                  fontSize: 12,
                }}
              >
                {fmtMoney(o.dealSizeHypothesis)} · {Math.round(o.probabilityPct)}%
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={{ gap: 6 }}>
        <SectionHeading label={t("mtg.tasks")} />
        {tasks.length === 0 ? (
          <Text style={line}>{t("mtg.noTasks")}</Text>
        ) : (
          tasks.map((task) => (
            <View
              key={task.key}
              style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}
            >
              <Text numberOfLines={1} style={[line, { flexShrink: 1 }]}>
                {task.title}
                {task.who ? ` — ${task.who}` : ""}
              </Text>
              {task.due ? (
                <Text
                  style={{
                    color: task.overdue ? c.destructive : c.mutedForeground,
                    fontFamily: "PlusJakartaSans_500Medium",
                    fontSize: 12,
                  }}
                >
                  {task.overdue
                    ? t("mtg.overdue")
                    : t("mtg.due", { d: fmtDue(task.due) ?? "" })}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function MeetingRow({
  m,
  initialBriefAccountId,
}: {
  m: AtelierCalendarMeeting;
  initialBriefAccountId?: string | null;
}) {
  const c = useColors();
  const rtl = useRTL();
  const { t } = useI18n();

  // One brief per matched account; meetings usually match a single account.
  const uniqueAccounts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const match of m.matches) {
      if (!seen.has(match.accountId)) seen.set(match.accountId, match.accountName);
    }
    return [...seen.entries()].map(([accountId, accountName]) => ({
      accountId,
      accountName,
    }));
  }, [m.matches]);
  const [briefAccountId, setBriefAccountId] = useState<string | null>(
    initialBriefAccountId &&
      m.matches.some((match) => match.accountId === initialBriefAccountId)
      ? initialBriefAccountId
      : null,
  );

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: rtl.row, alignItems: "flex-start", gap: 12 }}>
        <View style={{ width: 84 }}>
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 12,
            }}
          >
            {fmtDay(m.start, t)}
          </Text>
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "PlusJakartaSans_400Regular",
              fontSize: 12,
            }}
          >
            {m.isAllDay ? t("mtg.allDay") : fmtTime(m.start)}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text
            numberOfLines={2}
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 15,
              textAlign: rtl.textAlign,
            }}
          >
            {m.subject || t("mtg.noSubject")}
          </Text>
          {m.internal ? (
            <View style={{ flexDirection: rtl.row }}>
              <Chip label={t("mtg.internal")} color={c.primary} />
            </View>
          ) : null}
          {m.joinUrl ? (
            <Pressable
              onPress={() => {
                void openJoinUrl(m.joinUrl!, t("mtg.joinError"));
              }}
              style={({ pressed }) => ({
                flexDirection: rtl.row,
                alignItems: "center",
                gap: 6,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="video" size={14} color={c.primary} />
              <Text
                style={{
                  color: c.primary,
                  fontFamily: "PlusJakartaSans_600SemiBold",
                  fontSize: 13,
                }}
              >
                {t("mtg.join")}
              </Text>
            </Pressable>
          ) : m.location ? (
            <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6 }}>
              <Feather name="map-pin" size={12} color={c.mutedForeground} />
              <Text
                numberOfLines={1}
                style={{
                  color: c.mutedForeground,
                  fontFamily: "PlusJakartaSans_400Regular",
                  fontSize: 13,
                }}
              >
                {m.location}
              </Text>
            </View>
          ) : null}
          {m.matches.length > 0 ? (
            <View
              style={{
                flexDirection: rtl.row,
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {m.matches.map((match) => (
                <Chip
                  key={`${m.id}-${match.contactId}`}
                  label={`${match.contactName} · ${match.accountName}`}
                  color={c.primary}
                />
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {uniqueAccounts.length > 0 ? (
        <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 12 }}>
          {uniqueAccounts.map((acc) => {
            const open = briefAccountId === acc.accountId;
            return (
              <Pressable
                key={`${m.id}-brief-${acc.accountId}`}
                onPress={() => {
                  hapticLight();
                  setBriefAccountId(open ? null : acc.accountId);
                }}
                style={({ pressed }) => ({
                  flexDirection: rtl.row,
                  alignItems: "center",
                  gap: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Feather name="file-text" size={14} color={c.primary} />
                <Text
                  style={{
                    color: c.primary,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 13,
                  }}
                >
                  {uniqueAccounts.length > 1
                    ? t("mtg.briefFor", { name: acc.accountName })
                    : t("mtg.brief")}
                </Text>
                <Feather
                  name={open ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={c.primary}
                />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {briefAccountId ? <MeetingBriefPanel accountId={briefAccountId} /> : null}
    </Card>
  );
}

function windowIso(days: number) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ------------------------------------------------------------------
// Day calendar view — full-day timeline with positioned meeting blocks.
// ------------------------------------------------------------------

const HOUR_H = 56;
const GUTTER = 52;

function startOfDay(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface TimedBlock {
  m: AtelierCalendarMeeting;
  top: number;
  height: number;
  col: number;
  cols: number;
}

/** Position timed meetings for one day: clamp to day bounds, then greedy
 * column assignment inside each overlapping cluster. */
function layoutDayBlocks(
  meetings: AtelierCalendarMeeting[],
  dayStart: Date,
): TimedBlock[] {
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 24 * 3600 * 1000;
  const items = meetings
    .map((m) => {
      const s = Math.max(new Date(m.start).getTime(), dayStartMs);
      const e = Math.min(new Date(m.end).getTime(), dayEndMs);
      const startMin = (s - dayStartMs) / 60000;
      const endMin = Math.max((e - dayStartMs) / 60000, startMin + 30);
      return { m, startMin, endMin, col: 0, cols: 1 };
    })
    .filter((x) => x.endMin > 0 && x.startMin < 24 * 60)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  // Cluster overlapping runs, then assign columns greedily.
  let i = 0;
  while (i < items.length) {
    let clusterEnd = items[i].endMin;
    let j = i + 1;
    while (j < items.length && items[j].startMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, items[j].endMin);
      j += 1;
    }
    const cluster = items.slice(i, j);
    const colEnds: number[] = [];
    for (const ev of cluster) {
      let col = colEnds.findIndex((end) => end <= ev.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(ev.endMin);
      } else {
        colEnds[col] = ev.endMin;
      }
      ev.col = col;
    }
    for (const ev of cluster) ev.cols = colEnds.length;
    i = j;
  }

  return items.map((ev) => ({
    m: ev.m,
    top: (ev.startMin / 60) * HOUR_H,
    height: Math.max(((ev.endMin - ev.startMin) / 60) * HOUR_H, 26),
    col: ev.col,
    cols: ev.cols,
  }));
}

function DayNavigator({
  date,
  onChange,
}: {
  date: Date;
  onChange: (d: Date) => void;
}) {
  const c = useColors();
  const rtl = useRTL();
  const { t } = useI18n();
  const isToday = sameDay(date, new Date());
  const shift = (days: number) => {
    hapticLight();
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    onChange(startOfDay(d));
  };
  const arrow = (dir: -1 | 1, icon: "chevron-left" | "chevron-right") => (
    <Pressable
      onPress={() => shift(dir)}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.secondary,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name={icon} size={18} color={c.foreground} />
    </Pressable>
  );
  return (
    <View
      style={{
        flexDirection: rtl.row,
        alignItems: "center",
        gap: 10,
      }}
    >
      {arrow(-1, rtl.row === "row-reverse" ? "chevron-right" : "chevron-left")}
      <View style={{ flex: 1, alignItems: "center" }}>
        <Text
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_600SemiBold",
            fontSize: 15,
          }}
        >
          {isToday
            ? t("common.today")
            : date.toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
        </Text>
        {!isToday ? (
          <Pressable
            onPress={() => {
              hapticLight();
              onChange(startOfDay(new Date()));
            }}
            hitSlop={6}
          >
            <Text
              style={{
                color: c.primary,
                fontFamily: "PlusJakartaSans_600SemiBold",
                fontSize: 12,
              }}
            >
              {t("common.today")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {arrow(1, rtl.row === "row-reverse" ? "chevron-left" : "chevron-right")}
    </View>
  );
}

function DayTimeline({
  meetings,
  date,
  selectedId,
  onSelect,
}: {
  meetings: AtelierCalendarMeeting[];
  date: Date;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const c = useColors();
  const { t } = useI18n();
  const isToday = sameDay(date, new Date());
  const blocks = useMemo(
    () => layoutDayBlocks(meetings.filter((m) => !m.isAllDay), startOfDay(date)),
    [meetings, date],
  );
  const now = new Date();
  const nowTop =
    isToday ? ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H : null;

  const hourLabel = (h: number) => {
    const d = new Date(date);
    d.setHours(h, 0, 0, 0);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <View style={{ height: 24 * HOUR_H, position: "relative" }}>
      {Array.from({ length: 24 }, (_, h) => (
        <View
          key={h}
          style={{
            position: "absolute",
            top: h * HOUR_H,
            left: 0,
            right: 0,
            flexDirection: "row",
            alignItems: "flex-start",
          }}
        >
          <Text
            style={{
              width: GUTTER - 8,
              color: c.mutedForeground,
              fontFamily: "PlusJakartaSans_400Regular",
              fontSize: 10,
              textAlign: "right",
              transform: [{ translateY: -6 }],
            }}
          >
            {hourLabel(h)}
          </Text>
          <View
            style={{
              flex: 1,
              marginLeft: 8,
              height: StyleSheet.hairlineWidth,
              backgroundColor: c.border,
            }}
          />
        </View>
      ))}

      {/* Lane area: blocks use % geometry relative to this container. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: GUTTER,
          right: 4,
        }}
      >
        {blocks.map(({ m, top, height, col, cols }) => {
          const selected = selectedId === m.id;
          const matched = m.matches.length > 0;
          return (
            <Pressable
              key={m.id}
              onPress={() => {
                hapticLight();
                onSelect(selected ? null : m.id);
              }}
              style={({ pressed }) => ({
                position: "absolute",
                top,
                height,
                left: `${(col / cols) * 100}%`,
                width: `${100 / cols}%`,
                paddingRight: col === cols - 1 ? 0 : 3,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 8,
                  borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: selected ? c.primary : c.border,
                  backgroundColor: matched ? c.primary + "22" : c.secondary,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  overflow: "hidden",
                }}
              >
                <Text
                  numberOfLines={height > 40 ? 2 : 1}
                  style={{
                    color: c.foreground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 12,
                  }}
                >
                  {m.subject || t("mtg.noSubject")}
                </Text>
                {height > 44 ? (
                  <Text
                    numberOfLines={1}
                    style={{
                      color: c.mutedForeground,
                      fontFamily: "PlusJakartaSans_400Regular",
                      fontSize: 11,
                    }}
                  >
                    {fmtTime(m.start)} – {fmtTime(m.end)}
                    {m.joinUrl ? "  ·  " + t("mtg.join") : ""}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Current-time indicator (today only). */}
      {nowTop !== null ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: nowTop,
            left: GUTTER - 4,
            right: 0,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: c.destructive,
            }}
          />
          <View style={{ flex: 1, height: 2, backgroundColor: c.destructive }} />
        </View>
      ) : null}
    </View>
  );
}

export default function MeetingsScreen() {
  const c = useColors();
  const rtl = useRTL();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  // Set when arriving from a meeting-reminder notification tap: auto-open the
  // brief for the matched account on that meeting.
  const { focusMeetingId, focusAccountId } = useLocalSearchParams<{
    focusMeetingId?: string;
    focusAccountId?: string;
  }>();

  const conn = useAtelierGetMyMsConnection();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Task #360 — on-device OAuth: fetch the Microsoft sign-in URL (bearer-
  // authed), open it in the in-app browser, and refetch once we're back.
  const connRefetch = conn.refetch;
  const connectMs = useCallback(async () => {
    hapticLight();
    setConnectError(null);
    setConnecting(true);
    try {
      const returnTo =
        Platform.OS === "web"
          ? window.location.href
          : ExpoLinking.createURL("msauth-done");
      const { url } = await apiJson<{ url: string }>(
        "/api/atelier/me/msauth/mobile/start",
        { method: "POST", body: { returnTo } },
      );
      if (Platform.OS === "web") {
        // Full-page redirect; the callback sends the browser back here and
        // the fresh page load refetches the connection status.
        window.location.assign(url);
        return;
      }
      await WebBrowser.openAuthSessionAsync(url, returnTo);
      await connRefetch();
    } catch {
      setConnectError(t("mtg.connectError"));
    } finally {
      setConnecting(false);
    }
  }, [connRefetch, t]);
  const win = useMemo(() => windowIso(7), []);
  // Task #553 — fetch even when not connected: the server still returns
  // Atelier-booked internal meetings the viewer created or attends.
  const enabled = Boolean(conn.data);
  const calendar = useAtelierGetMyCalendar(win, {
    query: {
      queryKey: getAtelierGetMyCalendarQueryKey(win),
      enabled,
      retry: false,
    },
  });

  // Day calendar view — the selected day is fetched as its own window so the
  // navigator can move beyond the list's 7-day range (past or future).
  const [view, setView] = useState<"list" | "day">("list");
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const dayWin = useMemo(() => {
    const s = startOfDay(selectedDate);
    const e = new Date(s);
    e.setDate(s.getDate() + 1);
    return { start: s.toISOString(), end: e.toISOString() };
  }, [selectedDate]);
  const dayCalendar = useAtelierGetMyCalendar(dayWin, {
    query: {
      queryKey: getAtelierGetMyCalendarQueryKey(dayWin),
      enabled: enabled && view === "day",
      retry: false,
    },
  });
  const scrollRef = useRef<ScrollView | null>(null);

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;
  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom + 90) + 24;
  const meetings = calendar.data?.meetings ?? [];

  const dayMeetings = dayCalendar.data?.meetings ?? [];
  const allDayMeetings = dayMeetings.filter((m) => m.isAllDay);
  const timedMeetings = dayMeetings.filter((m) => !m.isAllDay);
  const selectedMeeting =
    dayMeetings.find((m) => m.id === selectedMeetingId) ?? null;

  // When entering day view or changing day, scroll near the first meeting
  // (or 8am when the day is empty) so the user isn't staring at midnight.
  useEffect(() => {
    if (view !== "day") return;
    let hour = 8;
    if (timedMeetings.length > 0) {
      const first = Math.min(
        ...timedMeetings.map((m) =>
          Math.max(
            0,
            (new Date(m.start).getTime() - startOfDay(selectedDate).getTime()) /
              3600000,
          ),
        ),
      );
      hour = Math.max(0, Math.floor(first) - 1);
    }
    scrollRef.current?.scrollTo({ y: hour * HOUR_H, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dayWin.start, dayCalendar.isSuccess]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* Dark-island header: stays navy in both themes. */}
      <View
        style={{
          backgroundColor: "#0A1230",
          paddingHorizontal: 20,
          paddingTop: topPad,
          paddingBottom: 18,
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
          overflow: "hidden",
          gap: 2,
        }}
      >
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            backgroundColor: c.primary,
            opacity: 0.9,
          }}
        />
        <Text
          style={{
            color: "#EEF1FA",
            fontFamily: "PlusJakartaSans_800ExtraBold",
            fontSize: 26,
            letterSpacing: -0.4,
            textAlign: rtl.textAlign,
          }}
        >
          {t("mtg.title")}
        </Text>
        <Text
          style={{
            color: "#9AA5C4",
            fontFamily: "PlusJakartaSans_500Medium",
            fontSize: 13,
            textAlign: rtl.textAlign,
          }}
        >
          {t("mtg.subtitle")}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
        refreshControl={
          enabled ? (
            <RefreshControl
              refreshing={
                view === "day" ? dayCalendar.isRefetching : calendar.isRefetching
              }
              onRefresh={() =>
                view === "day" ? dayCalendar.refetch() : calendar.refetch()
              }
              tintColor={c.mutedForeground}
            />
          ) : undefined
        }
      >
        {enabled && !conn.isLoading ? (
          <View
            style={{
              flexDirection: rtl.row,
              alignSelf: "flex-start",
              borderRadius: c.radius,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              backgroundColor: c.secondary,
              padding: 3,
              gap: 2,
            }}
          >
            {(["list", "day"] as const).map((v) => {
              const active = view === v;
              return (
                <Pressable
                  key={v}
                  onPress={() => {
                    hapticLight();
                    setView(v);
                  }}
                  style={{
                    flexDirection: rtl.row,
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: c.radius - 3,
                    backgroundColor: active ? c.card : "transparent",
                  }}
                >
                  <Feather
                    name={v === "list" ? "list" : "clock"}
                    size={13}
                    color={active ? c.foreground : c.mutedForeground}
                  />
                  <Text
                    style={{
                      color: active ? c.foreground : c.mutedForeground,
                      fontFamily: "PlusJakartaSans_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    {v === "list" ? t("mtg.viewList") : t("mtg.viewDay")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {conn.isLoading ? (
          <View style={{ gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <Card key={i} style={{ gap: 8 }}>
                <Skeleton height={14} width="30%" />
                <Skeleton height={16} width="80%" />
              </Card>
            ))}
          </View>
        ) : conn.isError ? (
          <ErrorState onRetry={() => conn.refetch()} message={t("common.error")} />
        ) : !conn.data?.configured ? (
          <EmptyState
            icon="calendar"
            title={t("mtg.notConfigured")}
            body={t("mtg.notConfiguredBody")}
          />
        ) : !conn.data.connected ? (
          <View style={{ alignItems: "center", gap: 4 }}>
            <EmptyState
              icon="calendar"
              title={t("mtg.notConnected")}
              body={t("mtg.notConnectedBody")}
            />
            <Pressable
              disabled={connecting}
              onPress={connectMs}
              style={({ pressed }) => ({
                flexDirection: rtl.row,
                alignItems: "center",
                gap: 8,
                backgroundColor: c.primary,
                borderRadius: c.radius,
                paddingHorizontal: 18,
                paddingVertical: 12,
                opacity: pressed || connecting ? 0.7 : 1,
              })}
            >
              {connecting ? (
                <ActivityIndicator size="small" color={c.primaryForeground} />
              ) : (
                <Feather name="link" size={16} color={c.primaryForeground} />
              )}
              <Text
                style={{
                  color: c.primaryForeground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                }}
              >
                {connecting ? t("mtg.connecting") : t("mtg.connectCta")}
              </Text>
            </Pressable>
            {connectError ? (
              <Text
                style={{
                  marginTop: 8,
                  color: c.destructive,
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                {connectError}
              </Text>
            ) : null}
            {/* Task #553 — internal (Atelier-booked) meetings still show
                even before Microsoft 365 is connected. */}
            {meetings.length > 0 ? (
              <View style={{ alignSelf: "stretch", gap: 12, marginTop: 16 }}>
                {meetings.map((m) => (
                  <MeetingRow key={m.id} m={m} initialBriefAccountId={null} />
                ))}
              </View>
            ) : null}
          </View>
        ) : view === "day" ? (
          <>
            <DayNavigator
              date={selectedDate}
              onChange={(d) => {
                setSelectedDate(d);
                setSelectedMeetingId(null);
              }}
            />
            {dayCalendar.isLoading ? (
              <View style={{ gap: 12 }}>
                {[0, 1, 2].map((i) => (
                  <Card key={i} style={{ gap: 8 }}>
                    <Skeleton height={14} width="30%" />
                    <Skeleton height={16} width="80%" />
                  </Card>
                ))}
              </View>
            ) : dayCalendar.isError ? (
              <ErrorState
                onRetry={() => dayCalendar.refetch()}
                message={t("mtg.error")}
              />
            ) : (
              <>
                {allDayMeetings.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    <SectionHeading label={t("mtg.allDay")} />
                    {allDayMeetings.map((m) => {
                      const selected = selectedMeetingId === m.id;
                      return (
                        <Pressable
                          key={m.id}
                          onPress={() => {
                            hapticLight();
                            setSelectedMeetingId(selected ? null : m.id);
                          }}
                          style={({ pressed }) => ({
                            borderRadius: 8,
                            borderWidth: selected
                              ? 1.5
                              : StyleSheet.hairlineWidth,
                            borderColor: selected ? c.primary : c.border,
                            backgroundColor:
                              m.matches.length > 0
                                ? c.primary + "22"
                                : c.secondary,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                            opacity: pressed ? 0.8 : 1,
                          })}
                        >
                          <Text
                            numberOfLines={1}
                            style={{
                              color: c.foreground,
                              fontFamily: "PlusJakartaSans_600SemiBold",
                              fontSize: 13,
                              textAlign: rtl.textAlign,
                            }}
                          >
                            {m.subject || t("mtg.noSubject")}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {selectedMeeting ? <MeetingRow m={selectedMeeting} /> : null}
                {dayMeetings.length === 0 ? (
                  <EmptyState
                    icon="calendar"
                    title={t("mtg.empty")}
                    body={t("mtg.emptyDay")}
                  />
                ) : null}
                <DayTimeline
                  meetings={timedMeetings}
                  date={selectedDate}
                  selectedId={selectedMeetingId}
                  onSelect={(id) => {
                    setSelectedMeetingId(id);
                    // The detail card renders above the timeline — bring it
                    // into view when a block is picked.
                    if (id) scrollRef.current?.scrollTo({ y: 0, animated: true });
                  }}
                />
              </>
            )}
          </>
        ) : calendar.isLoading ? (
          <View style={{ gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <Card key={i} style={{ gap: 8 }}>
                <Skeleton height={14} width="30%" />
                <Skeleton height={16} width="80%" />
              </Card>
            ))}
          </View>
        ) : calendar.isError ? (
          <ErrorState onRetry={() => calendar.refetch()} message={t("mtg.error")} />
        ) : meetings.length === 0 ? (
          <EmptyState icon="calendar" title={t("mtg.empty")} body={t("mtg.emptyBody")} />
        ) : (
          meetings.map((m) => (
            <MeetingRow
              key={
                m.id === focusMeetingId ? `${m.id}-focus-${focusAccountId ?? ""}` : m.id
              }
              m={m}
              initialBriefAccountId={m.id === focusMeetingId ? focusAccountId : null}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
