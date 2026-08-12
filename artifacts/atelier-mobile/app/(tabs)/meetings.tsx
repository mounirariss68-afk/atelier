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
import { useQuery } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ExpoLinking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiJson } from "@/lib/api";

import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Skeleton,
  WEB_TAB_BAR,
  hapticLight,
} from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { AppBackground } from "@/components/AppBackground";
import { AppHeader } from "@/components/AppHeader";
import { useColors } from "@/hooks/useColors";

// Device-persisted list/day view choice for the Meetings tab (matches the
// web calendar's localStorage key so behavior stays consistent).
const MEETINGS_VIEW_KEY = "atelier-meetings-view";

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
  onOpen,
}: {
  m: AtelierCalendarMeeting;
  initialBriefAccountId?: string | null;
  /** Tapping the card opens the full meeting detail view. */
  onOpen?: () => void;
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

  const body = (
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
          {meetingKind(m) === "ooo" ? (
            <View style={{ flexDirection: rtl.row }}>
              <Chip label={t("mtg.ooo")} color="#D97706" />
            </View>
          ) : null}
          {meetingKind(m) === "holiday" ? (
            <View style={{ flexDirection: rtl.row }}>
              <Chip label={t("mtg.holiday")} color={c.mutedForeground} />
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

  if (!onOpen) return body;
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onOpen();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}

function windowIso(days: number) {
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ------------------------------------------------------------------
// Task #602 — "Away today" chips + public-holiday banners. The bespoke
// /roster/on-leave-today and /me/holidays routes are not in the OpenAPI
// spec, so these use apiJson raw fetch. The server also tags calendar
// rows with kind: "ooo" | "holiday".
// ------------------------------------------------------------------

type MeetingKind = "ooo" | "holiday" | undefined;
function meetingKind(m: AtelierCalendarMeeting): MeetingKind {
  const k = (m as { kind?: string }).kind;
  return k === "ooo" || k === "holiday" ? k : undefined;
}

// Task #963 — day-view color coding, mirroring the web Meetings day view
// (Task #960, `meetingAudience` in atelier MsMeetings.tsx): internal meetings
// render light pink, meetings involving external parties light blue. A meeting
// is internal when it was booked in Atelier (`internal`), or when nothing
// points outside the org: no CRM matches and no attendee/organizer email off
// the org's domain. Sparse attendee data defaults to internal.
function meetingAudience(
  m: AtelierCalendarMeeting,
  orgDomain: string | null,
): "internal" | "external" {
  if (m.internal) return "internal";
  if (m.matches.length > 0) return "external";
  if (orgDomain) {
    const emails = [
      ...(m.attendees ?? []).map((a) => a.email),
      m.organizerEmail ?? "",
    ].filter(Boolean);
    if (emails.some((e) => !e.toLowerCase().endsWith(`@${orgDomain}`))) return "external";
  }
  return "internal";
}

// Same hues as the web day view: pink-400/15 and sky-400/15.
function audienceCardBg(audience: "internal" | "external"): string {
  return audience === "internal" ? "#F472B626" : "#38BDF826";
}

interface AwayPerson {
  personId: string;
  personName: string;
  initials: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  returnDate: string;
}

interface HolidayItem {
  date: string;
  endDate: string;
  name: string;
  country: string;
  tentative: boolean;
}

function isoDateOnly(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateShort(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Slim horizontally-scrollable strip of partners on approved leave for
 * the given date (default today). Avatar-initials chips; tapping one
 * shows the leave span and return date. Pinned above the tab bar by the
 * screen. The endpoint 403s for non-partner viewers — any error hides
 * the strip. */
function AwayTodayStrip({ date }: { date?: string }) {
  const c = useColors();
  const rtl = useRTL();
  const { t } = useI18n();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["roster-on-leave-today", date ?? "today"],
    queryFn: async (): Promise<{ away: AwayPerson[] } | null> => {
      try {
        return await apiJson<{ away: AwayPerson[] }>(
          `/api/atelier/roster/on-leave-today${date ? `?date=${date}` : ""}`,
        );
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
  const away = data?.away ?? [];
  if (away.length === 0) return null;
  const openPerson =
    away.find((a) => `${a.personId}-${a.startDate}` === openKey) ?? null;
  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: c.secondary,
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 6,
      }}
    >
      <Text
        style={{
          color: c.mutedForeground,
          fontFamily: "PlusJakartaSans_600SemiBold",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          textAlign: rtl.textAlign,
        }}
      >
        {t("mtg.awayToday")}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: rtl.row, gap: 8 }}
      >
        {away.map((a) => {
          const key = `${a.personId}-${a.startDate}`;
          const open = openKey === key;
          return (
            <Pressable
              key={key}
              onPress={() => {
                hapticLight();
                setOpenKey(open ? null : key);
              }}
              style={({ pressed }) => ({
                flexDirection: rtl.row,
                alignItems: "center",
                gap: 8,
                borderRadius: 999,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: open ? c.primary : c.border,
                backgroundColor: open ? c.primary + "18" : c.card,
                paddingHorizontal: 8,
                paddingVertical: 5,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: c.primary + "26",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: c.primary,
                    fontFamily: "PlusJakartaSans_700Bold",
                    fontSize: 10,
                  }}
                >
                  {a.initials || a.personName.slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                style={{
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_600SemiBold",
                  fontSize: 12,
                }}
              >
                {a.personName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {openPerson ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 12,
            textAlign: rtl.textAlign,
          }}
        >
          {openPerson.personName} · {fmtDateShort(openPerson.startDate)} →{" "}
          {fmtDateShort(openPerson.endDate)} · {t("mtg.awayUntil")}{" "}
          {fmtDateShort(openPerson.returnDate)}
        </Text>
      ) : null}
    </View>
  );
}

/** Public-holiday banner for a date window (curated TR/MENA dataset);
 * the viewer's own market renders in the primary color. */
function HolidayBanner({ startDate, endDate }: { startDate: string; endDate: string }) {
  const c = useColors();
  const rtl = useRTL();
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["me-holidays", startDate, endDate],
    queryFn: async (): Promise<
      { viewerCountry: string | null; holidays: HolidayItem[] } | null
    > => {
      try {
        return await apiJson<{ viewerCountry: string | null; holidays: HolidayItem[] }>(
          `/api/atelier/me/holidays?start=${startDate}&end=${endDate}`,
        );
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 60 * 60_000,
  });
  const [expanded, setExpanded] = useState(false);
  const holidays = data?.holidays ?? [];
  if (holidays.length === 0) return null;
  const viewer = data?.viewerCountry ?? null;
  // Viewer's own market up-front; other markets collapse into one
  // expandable row to avoid clutter.
  const mine = viewer ? holidays.filter((h) => h.country === viewer) : holidays;
  const others = viewer ? holidays.filter((h) => h.country !== viewer) : [];
  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.border,
        backgroundColor: c.secondary,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      <Text
        style={{
          color: c.mutedForeground,
          fontFamily: "PlusJakartaSans_600SemiBold",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          textAlign: rtl.textAlign,
        }}
      >
        {t("mtg.holidays")}
      </Text>
      <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 6 }}>
        {mine.map((h) => (
          <Chip
            key={`${h.country}-${h.date}-${h.name}`}
            label={`${h.country} · ${h.name} (${fmtDateShort(h.date)})${h.tentative ? " *" : ""}`}
            color={viewer ? c.primary : c.mutedForeground}
          />
        ))}
        {others.length > 0 ? (
          <Pressable
            onPress={() => {
              hapticLight();
              setExpanded((v) => !v);
            }}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              backgroundColor: c.card,
              paddingHorizontal: 10,
              paddingVertical: 4,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "PlusJakartaSans_600SemiBold",
                fontSize: 11,
              }}
            >
              {expanded ? "−" : `+${others.length}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {expanded && others.length > 0 ? (
        <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 6 }}>
          {others.map((h) => (
            <Chip
              key={`${h.country}-${h.date}-${h.name}`}
              label={`${h.country} · ${h.name} (${fmtDateShort(h.date)})${h.tentative ? " *" : ""}`}
              color={c.mutedForeground}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------
// Day calendar view — full-day timeline with positioned meeting blocks.
// ------------------------------------------------------------------

const HOUR_H = 56;
const GUTTER = 64;
/** Default scroll position when opening the day view: the 9:00 AM slot. */
const DAY_DEFAULT_HOUR = 9;

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

/** Full-day hour-grid timeline: time labels down the side, meeting blocks
 * positioned/sized by start time and duration, and a red "now" indicator on
 * today. Tapping a block opens the full meeting detail sheet. */
function DayTimeline({
  meetings,
  date,
  onOpen,
  orgDomain,
}: {
  meetings: AtelierCalendarMeeting[];
  date: Date;
  onOpen: (m: AtelierCalendarMeeting) => void;
  orgDomain: string | null;
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
            numberOfLines={1}
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
          return (
            <Pressable
              key={m.id}
              onPress={() => {
                hapticLight();
                onOpen(m);
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
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.border,
                  backgroundColor: audienceCardBg(meetingAudience(m, orgDomain)),
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

// ------------------------------------------------------------------
// Meeting detail sheet — full info + internal-meeting manage actions.
// ------------------------------------------------------------------

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function isoDateLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function hhmmLocal(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function parseLocal(dateStr: string, timeStr: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!dm || !tm) return null;
  const d = new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]),
    0,
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Reschedule form for an internal meeting the viewer can manage. Native
 * uses the platform date/time pickers; web falls back to text inputs. */
function RescheduleForm({
  meeting,
  onDone,
}: {
  meeting: AtelierCalendarMeeting;
  onDone: () => Promise<void>;
}) {
  const c = useColors();
  const rtl = useRTL();
  const { t } = useI18n();
  const [start, setStart] = useState(() => new Date(meeting.start));
  const [end, setEnd] = useState(() => new Date(meeting.end));
  // Web text-input mirrors of the same values.
  const [dateText, setDateText] = useState(() => isoDateLocal(new Date(meeting.start)));
  const [startText, setStartText] = useState(() => hhmmLocal(new Date(meeting.start)));
  const [endText, setEndText] = useState(() => hhmmLocal(new Date(meeting.end)));
  const [picker, setPicker] = useState<null | "date" | "start" | "end">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Original meeting duration, used to keep the end anchored to the start.
  const durationMs = Math.max(
    60_000,
    new Date(meeting.end).getTime() - new Date(meeting.start).getTime(),
  );

  /** Current start↔end gap; falls back to the meeting's original duration. */
  const currentDurationMs = (): number => {
    if (Platform.OS === "web") {
      const s = parseLocal(dateText, startText);
      const e = parseLocal(dateText, endText);
      if (s && e && e.getTime() > s.getTime()) return e.getTime() - s.getTime();
      return durationMs;
    }
    return end.getTime() > start.getTime() ? end.getTime() - start.getTime() : durationMs;
  };

  /** Move the start (and shift end to preserve duration). */
  const setStartPreservingDuration = (nextStart: Date) => {
    const dur = currentDurationMs();
    const nextEnd = new Date(nextStart.getTime() + dur);
    setStart(nextStart);
    setEnd(nextEnd);
    setDateText(isoDateLocal(nextStart));
    setStartText(hhmmLocal(nextStart));
    setEndText(hhmmLocal(nextEnd));
    setErr(null);
  };

  /** Resolve the current start across platforms (web falls back to state). */
  const currentStart = (): Date => {
    if (Platform.OS === "web") {
      const s = parseLocal(dateText, startText);
      if (s) return s;
    }
    return start;
  };

  const presets: { key: string; labelKey: string; apply: () => Date }[] = [
    {
      key: "plus30m",
      labelKey: "mtg.preset.plus30m",
      apply: () => new Date(currentStart().getTime() + 30 * 60_000),
    },
    {
      key: "plus1h",
      labelKey: "mtg.preset.plus1h",
      apply: () => new Date(currentStart().getTime() + 60 * 60_000),
    },
    {
      key: "tomorrow",
      labelKey: "mtg.preset.tomorrow",
      apply: () => {
        const d = new Date(currentStart());
        d.setDate(d.getDate() + 1);
        return d;
      },
    },
    {
      key: "nextWeek",
      labelKey: "mtg.preset.nextWeek",
      apply: () => {
        const d = new Date(currentStart());
        d.setDate(d.getDate() + 7);
        return d;
      },
    },
  ];

  const resolve = (): { s: Date; e: Date } | null => {
    if (Platform.OS === "web") {
      const s = parseLocal(dateText, startText);
      const e = parseLocal(dateText, endText);
      if (!s || !e) return null;
      return { s, e };
    }
    return { s: start, e: end };
  };

  const doSave = async (r: { s: Date; e: Date }) => {
    setBusy(true);
    try {
      await apiJson(`/api/atelier/me/calendar/internal/${meeting.id}`, {
        method: "PATCH",
        body: { start: r.s.toISOString(), end: r.e.toISOString() },
      });
      await onDone();
    } catch {
      setErr(t("mtg.rescheduleError"));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    setErr(null);
    const r = resolve();
    if (!r || r.e.getTime() <= r.s.getTime()) {
      setErr(t("mtg.endBeforeStart"));
      return;
    }
    if (r.s.getTime() < Date.now()) {
      if (Platform.OS === "web") {
        if (window.confirm(t("mtg.pastConfirm"))) void doSave(r);
        return;
      }
      Alert.alert(t("mtg.pastTitle"), t("mtg.pastConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.confirm"), onPress: () => void doSave(r) },
      ]);
      return;
    }
    void doSave(r);
  };

  const label = {
    color: c.mutedForeground,
    fontFamily: "PlusJakartaSans_500Medium" as const,
    fontSize: 13,
    textAlign: rtl.textAlign,
  };
  const fieldBox = {
    backgroundColor: c.secondary,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: c.borderSoft ?? c.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
  };
  const fieldText = {
    color: c.foreground,
    fontFamily: "PlusJakartaSans_500Medium" as const,
    fontSize: 15,
  };

  const nativeField = (
    key: "date" | "start" | "end",
    labelKey: string,
    value: string,
  ) => (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={label}>{t(labelKey)}</Text>
      <Pressable
        onPress={() => {
          hapticLight();
          setPicker(picker === key ? null : key);
        }}
        style={fieldBox}
      >
        <Text style={fieldText}>{value}</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <SectionHeading label={t("mtg.reschedule")} />
      <View style={{ gap: 6 }}>
        <Text style={label}>{t("mtg.quickMoves")}</Text>
        <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 8 }}>
          {presets.map((p) => (
            <Pressable
              key={p.key}
              onPress={() => {
                hapticLight();
                setPicker(null);
                setStartPreservingDuration(p.apply());
              }}
              style={{
                backgroundColor: c.secondary,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: c.borderSoft ?? c.border,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_500Medium",
                  fontSize: 13,
                }}
              >
                {t(p.labelKey)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {Platform.OS === "web" ? (
        <>
          <View style={{ gap: 6 }}>
            <Text style={label}>{t("mtg.date")}</Text>
            <TextInput
              value={dateText}
              onChangeText={setDateText}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={c.mutedForeground}
              style={[fieldBox, fieldText]}
            />
          </View>
          <View style={{ flexDirection: rtl.row, gap: 10 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={label}>{t("mtg.startTime")}</Text>
              <TextInput
                value={startText}
                onChangeText={(text) => {
                  const dur = currentDurationMs();
                  setStartText(text);
                  const s = parseLocal(dateText, text);
                  if (s) setEndText(hhmmLocal(new Date(s.getTime() + dur)));
                }}
                placeholder="HH:MM"
                placeholderTextColor={c.mutedForeground}
                style={[fieldBox, fieldText]}
              />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={label}>{t("mtg.endTime")}</Text>
              <TextInput
                value={endText}
                onChangeText={setEndText}
                placeholder="HH:MM"
                placeholderTextColor={c.mutedForeground}
                style={[fieldBox, fieldText]}
              />
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: rtl.row, gap: 10 }}>
            {nativeField("date", "mtg.date", isoDateLocal(start))}
          </View>
          <View style={{ flexDirection: rtl.row, gap: 10 }}>
            {nativeField("start", "mtg.startTime", hhmmLocal(start))}
            {nativeField("end", "mtg.endTime", hhmmLocal(end))}
          </View>
          {picker === "date" ? (
            <DateTimePicker
              value={start}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={(event, selected) => {
                if (Platform.OS === "android") setPicker(null);
                if (event.type === "dismissed") {
                  setPicker(null);
                  return;
                }
                if (selected) {
                  const apply = (d: Date) => {
                    const n = new Date(d);
                    n.setFullYear(
                      selected.getFullYear(),
                      selected.getMonth(),
                      selected.getDate(),
                    );
                    return n;
                  };
                  setStart((d) => apply(d));
                  setEnd((d) => apply(d));
                  if (Platform.OS === "ios") setPicker(null);
                }
              }}
            />
          ) : null}
          {picker === "start" || picker === "end" ? (
            <DateTimePicker
              value={picker === "start" ? start : end}
              mode="time"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(event, selected) => {
                if (Platform.OS === "android") setPicker(null);
                if (event.type === "dismissed") {
                  setPicker(null);
                  return;
                }
                if (selected) {
                  if (picker === "start") setStartPreservingDuration(selected);
                  else setEnd(selected);
                  if (Platform.OS === "ios") setPicker(null);
                }
              }}
            />
          ) : null}
        </>
      )}
      {err ? (
        <Text
          style={{
            color: c.destructive,
            fontFamily: "PlusJakartaSans_400Regular",
            fontSize: 13,
            textAlign: rtl.textAlign,
          }}
        >
          {err}
        </Text>
      ) : null}
      <Button label={t("common.save")} onPress={() => void save()} loading={busy} />
    </View>
  );
}

/** Full-screen sheet with everything about one meeting. Internal meetings
 * the viewer manages get reschedule/cancel; Outlook rows are view-only. */
function MeetingDetailSheet({
  meeting,
  onClose,
  onChanged,
}: {
  meeting: AtelierCalendarMeeting | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const c = useColors();
  const rtl = useRTL();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [briefAccountId, setBriefAccountId] = useState<string | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  // Reset per-meeting state when a different meeting opens.
  const meetingId = meeting?.id ?? null;
  useEffect(() => {
    setBriefAccountId(null);
    setShowReschedule(false);
    setCancelBusy(false);
    setCancelErr(null);
  }, [meetingId]);

  const doCancel = useCallback(async () => {
    if (!meeting) return;
    setCancelErr(null);
    setCancelBusy(true);
    try {
      await apiJson(`/api/atelier/me/calendar/internal/${meeting.id}`, {
        method: "DELETE",
      });
      await onChanged();
      onClose();
    } catch {
      setCancelErr(t("mtg.cancelError"));
    } finally {
      setCancelBusy(false);
    }
  }, [meeting, onChanged, onClose, t]);

  const confirmCancel = () => {
    hapticLight();
    if (Platform.OS === "web") {
      if (window.confirm(t("mtg.cancelConfirm"))) void doCancel();
      return;
    }
    Alert.alert(t("mtg.cancelMeeting"), t("mtg.cancelConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.confirm"), style: "destructive", onPress: () => void doCancel() },
    ]);
  };

  if (!meeting) return null;

  const uniqueAccounts = (() => {
    const seen = new Map<string, string>();
    for (const match of meeting.matches) {
      if (!seen.has(match.accountId)) seen.set(match.accountId, match.accountName);
    }
    return [...seen.entries()].map(([accountId, accountName]) => ({
      accountId,
      accountName,
    }));
  })();
  const manageable = Boolean(meeting.internal && meeting.canManage);
  const line = {
    color: c.mutedForeground,
    fontFamily: "PlusJakartaSans_400Regular" as const,
    fontSize: 13,
    textAlign: rtl.textAlign,
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle={Platform.OS === "web" ? undefined : "pageSheet"}
      transparent={Platform.OS === "web"}
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: Platform.OS === "web" ? c.scrim ?? "rgba(0,0,0,0.5)" : c.background,
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            flex: Platform.OS === "web" ? undefined : 1,
            maxHeight: "92%",
            backgroundColor: c.background,
            borderTopLeftRadius: Platform.OS === "web" ? 24 : 0,
            borderTopRightRadius: Platform.OS === "web" ? 24 : 0,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: rtl.row,
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingTop: 14,
              paddingBottom: 10,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: c.border,
            }}
          >
            <Text
              style={{
                color: c.foreground,
                fontFamily: "PlusJakartaSans_700Bold",
                fontSize: 17,
              }}
            >
              {t("mtg.details")}
            </Text>
            <Pressable
              onPress={() => {
                hapticLight();
                onClose();
              }}
              hitSlop={10}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.secondary,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="x" size={18} color={c.foreground} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{
              padding: 16,
              gap: 14,
              paddingBottom: insets.bottom + 32,
            }}
          >
            <Text
              style={{
                color: c.foreground,
                fontFamily: "PlusJakartaSans_700Bold",
                fontSize: 20,
                textAlign: rtl.textAlign,
              }}
            >
              {meeting.subject || t("mtg.noSubject")}
            </Text>
            <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
              <Feather name="clock" size={14} color={c.mutedForeground} />
              <Text style={line}>
                {fmtDay(meeting.start, t)}
                {" · "}
                {meeting.isAllDay
                  ? t("mtg.allDay")
                  : `${fmtTime(meeting.start)} – ${fmtTime(meeting.end)}`}
              </Text>
            </View>
            {meeting.location ? (
              <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
                <Feather name="map-pin" size={14} color={c.mutedForeground} />
                <Text style={line} numberOfLines={2}>
                  {meeting.location}
                </Text>
              </View>
            ) : null}
            <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 6 }}>
              {meeting.internal ? (
                <Chip label={t("mtg.internal")} color={c.primary} />
              ) : null}
              {meeting.matches.map((match) => (
                <Chip
                  key={`detail-${meeting.id}-${match.contactId}`}
                  label={`${match.contactName} · ${match.accountName}`}
                  color={c.primary}
                />
              ))}
            </View>
            {!meeting.internal ? (
              <View
                style={{
                  flexDirection: rtl.row,
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: c.secondary,
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <Feather name="info" size={14} color={c.mutedForeground} />
                <Text style={[line, { flex: 1 }]}>{t("mtg.managedInOutlook")}</Text>
              </View>
            ) : null}
            {meeting.joinUrl ? (
              <Button
                label={t("mtg.join")}
                icon="video"
                onPress={() => {
                  void openJoinUrl(meeting.joinUrl!, t("mtg.joinError"));
                }}
              />
            ) : null}

            {meeting.attendees.length > 0 ? (
              <View style={{ gap: 6 }}>
                <SectionHeading label={t("mtg.attendees")} />
                {meeting.attendees.map((a, i) => (
                  <Text key={`${a.email}-${i}`} style={line} numberOfLines={1}>
                    {a.name ? `${a.name} · ${a.email}` : a.email}
                  </Text>
                ))}
              </View>
            ) : null}

            {uniqueAccounts.length > 0 ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 12 }}>
                  {uniqueAccounts.map((acc) => {
                    const open = briefAccountId === acc.accountId;
                    return (
                      <Pressable
                        key={`detail-brief-${acc.accountId}`}
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
                {briefAccountId ? <MeetingBriefPanel accountId={briefAccountId} /> : null}
              </View>
            ) : null}

            {manageable ? (
              <View style={{ gap: 12, marginTop: 4 }}>
                {showReschedule ? (
                  <RescheduleForm
                    meeting={meeting}
                    onDone={async () => {
                      await onChanged();
                      onClose();
                    }}
                  />
                ) : (
                  <Button
                    label={t("mtg.reschedule")}
                    icon="edit"
                    variant="secondary"
                    onPress={() => {
                      hapticLight();
                      setShowReschedule(true);
                    }}
                  />
                )}
                <Button
                  label={t("mtg.cancelMeeting")}
                  icon="trash-2"
                  variant="destructive"
                  loading={cancelBusy}
                  onPress={confirmCancel}
                />
                {cancelErr ? (
                  <Text
                    style={{
                      color: c.destructive,
                      fontFamily: "PlusJakartaSans_400Regular",
                      fontSize: 13,
                      textAlign: rtl.textAlign,
                    }}
                  >
                    {cancelErr}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  // The last-chosen view persists on the device (mirrors the web calendar's
  // localStorage behavior); missing/invalid stored values fall back to list.
  const [view, setViewState] = useState<"list" | "day">("list");
  useEffect(() => {
    AsyncStorage.getItem(MEETINGS_VIEW_KEY)
      .then((v) => {
        if (v === "list" || v === "day") setViewState(v);
      })
      .catch(() => {});
  }, []);
  const setView = useCallback((v: "list" | "day") => {
    setViewState(v);
    AsyncStorage.setItem(MEETINGS_VIEW_KEY, v).catch(() => {});
  }, []);
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  // Full detail sheet, opened by tapping any meeting card in either view.
  const [detailMeeting, setDetailMeeting] = useState<AtelierCalendarMeeting | null>(
    null,
  );
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


  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom + 90) + 24;
  const meetings = calendar.data?.meetings ?? [];

  const dayMeetings = dayCalendar.data?.meetings ?? [];
  const allDayMeetings = dayMeetings.filter((m) => m.isAllDay);
  const connected = Boolean(conn.data?.configured && conn.data.connected);
  // Task #963 — org email domain for internal/external color coding (same
  // derivation as the web day view).
  const orgDomain = conn.data?.msEmail?.includes("@")
    ? conn.data.msEmail.split("@")[1]!.toLowerCase()
    : null;

  // When the day view opens or the day's data arrives, land on the 9:00 AM
  // slot by default — unless a deep link focuses a meeting on this day, in
  // which case scroll to that meeting instead. Re-runs when the day query
  // succeeds so the scroll isn't clamped by the short loading-skeleton
  // content on first open.
  useEffect(() => {
    if (view !== "day") return;
    let y = DAY_DEFAULT_HOUR * HOUR_H;
    if (focusMeetingId) {
      const target = dayMeetings.find(
        (m) => m.id === focusMeetingId && !m.isAllDay,
      );
      if (target) {
        const dayStartMs = startOfDay(selectedDate).getTime();
        const startMin = Math.max(
          0,
          (new Date(target.start).getTime() - dayStartMs) / 60000,
        );
        y = Math.max(0, (startMin / 60) * HOUR_H - HOUR_H / 2);
      }
    }
    scrollRef.current?.scrollTo({ y, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dayWin.start, dayCalendar.isSuccess, focusMeetingId]);

  // Subtle fade when the day changes (arrows or swipe).
  const dayFade = useRef(new Animated.Value(1)).current;
  const changeDay = useCallback(
    (d: Date) => {
      setSelectedDate(d);
      scrollRef.current?.scrollTo({ y: DAY_DEFAULT_HOUR * HOUR_H, animated: false });
      dayFade.setValue(0.25);
      Animated.timing(dayFade, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    },
    [dayFade],
  );

  const shiftDay = useCallback(
    (days: number) => {
      hapticLight();
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + days);
      changeDay(startOfDay(d));
    },
    [selectedDate, changeDay],
  );

  // Swipe left/right anywhere on the day content to change days. Horizontal
  // activation offsets keep vertical scrolling and taps unaffected. In RTL
  // the reading direction flips, so the swipe direction flips with it.
  const rtlFlip = rtl.row === "row-reverse" ? -1 : 1;
  const swipeDay = useMemo(
    () =>
      Gesture.Pan()
        .enabled(view === "day" && connected)
        .activeOffsetX([-24, 24])
        .failOffsetY([-16, 16])
        .runOnJS(true)
        .onEnd((e) => {
          if (e.translationX <= -60) shiftDay(rtlFlip);
          else if (e.translationX >= 60) shiftDay(-rtlFlip);
        }),
    [view, connected, shiftDay, rtlFlip],
  );

  // After an internal-meeting reschedule/cancel, refresh whichever calendar
  // windows are on screen.
  const refreshCalendars = useCallback(async () => {
    await Promise.all([
      calendar.refetch(),
      view === "day" ? dayCalendar.refetch() : Promise.resolve(),
    ]);
  }, [calendar, dayCalendar, view]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppBackground />
      {/* Task #1003 — unified glass header with brand logo. */}
      <AppHeader title={t("mtg.title")} subtitle={t("mtg.subtitle")} />

      {/* Pinned controls: view toggle plus, in day view, the date navigator.
          They live outside the ScrollView so they stay locked while the
          day's content scrolls. */}
      {enabled && !conn.isLoading ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
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
          {connected && view === "day" ? (
            <DayNavigator date={selectedDate} onChange={changeDay} />
          ) : null}
        </View>
      ) : null}

      <GestureDetector gesture={swipeDay}>
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
                  <MeetingRow
                    key={m.id}
                    m={m}
                    initialBriefAccountId={null}
                    onOpen={() => setDetailMeeting(m)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : view === "day" ? (
          <Animated.View style={{ opacity: dayFade, gap: 12 }}>
            <HolidayBanner
              startDate={isoDateOnly(selectedDate)}
              endDate={isoDateOnly(selectedDate)}
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
                    {allDayMeetings.map((m) => (
                      <Pressable
                        key={m.id}
                        onPress={() => {
                          hapticLight();
                          setDetailMeeting(m);
                        }}
                        style={({ pressed }) => ({
                          borderRadius: 8,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: c.border,
                          backgroundColor:
                            meetingKind(m) === "ooo"
                              ? "#D9770622"
                              : meetingKind(m) === "holiday"
                                ? c.secondary
                                : audienceCardBg(meetingAudience(m, orgDomain)),
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
                    ))}
                  </View>
                ) : null}
                {dayMeetings.length === 0 ? (
                  <EmptyState
                    icon="calendar"
                    title={t("mtg.empty")}
                    body={t("mtg.emptyDay")}
                  />
                ) : null}
                <DayTimeline
                  meetings={dayMeetings}
                  date={selectedDate}
                  onOpen={(m) => setDetailMeeting(m)}
                  orgDomain={orgDomain}
                />
              </>
            )}
          </Animated.View>
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
          <>
            <HolidayBanner
              startDate={isoDateOnly(new Date())}
              endDate={isoDateOnly(new Date(Date.now() + 7 * 24 * 3600 * 1000))}
            />
            <EmptyState icon="calendar" title={t("mtg.empty")} body={t("mtg.emptyBody")} />
          </>
        ) : (
          <>
            <HolidayBanner
              startDate={isoDateOnly(new Date())}
              endDate={isoDateOnly(new Date(Date.now() + 7 * 24 * 3600 * 1000))}
            />
          {meetings.map((m) => (
            <MeetingRow
              key={
                m.id === focusMeetingId ? `${m.id}-focus-${focusAccountId ?? ""}` : m.id
              }
              m={m}
              initialBriefAccountId={m.id === focusMeetingId ? focusAccountId : null}
              onOpen={() => setDetailMeeting(m)}
            />
          ))}
          </>
        )}
      </ScrollView>
      </GestureDetector>

      {/* Task #602 — the "Away" strip is pinned above the tab bar (outside
          the scroll content) and follows the selected day in day view. */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <AwayTodayStrip
          date={view === "day" ? isoDateOnly(selectedDate) : undefined}
        />
      </View>

      {detailMeeting ? (
        <MeetingDetailSheet
          meeting={detailMeeting}
          onClose={() => setDetailMeeting(null)}
          onChanged={refreshCalendars}
        />
      ) : null}
    </View>
  );
}
