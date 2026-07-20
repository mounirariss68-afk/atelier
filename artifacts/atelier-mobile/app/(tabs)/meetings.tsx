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
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
          {m.joinUrl ? (
            <Pressable
              onPress={() => {
                hapticLight();
                Linking.openURL(m.joinUrl!);
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
  const enabled = Boolean(conn.data?.configured && conn.data?.connected);
  const calendar = useAtelierGetMyCalendar(win, {
    query: {
      queryKey: getAtelierGetMyCalendarQueryKey(win),
      enabled,
      retry: false,
    },
  });

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;
  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom + 90) + 24;
  const meetings = calendar.data?.meetings ?? [];

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
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
        refreshControl={
          enabled ? (
            <RefreshControl
              refreshing={calendar.isRefetching}
              onRefresh={() => calendar.refetch()}
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
          </View>
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
