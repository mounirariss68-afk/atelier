import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useFeedback } from "@/components/feedback";
import { Card, FadeInView, WEB_TAB_BAR, hapticLight } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useDisplayCurrency } from "@/lib/displayCurrency";
import { usePushPrefs } from "@/lib/pushPrefs";
import { PUSH_CATEGORIES } from "@/lib/pushPrefsCore";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { type ThemePref, useThemePref } from "@/contexts/ThemeContext";
import { LANGS, type Lang } from "@/constants/i18n";
import { AppBackground } from "@/components/AppBackground";
import { AppHeader } from "@/components/AppHeader";
import { useColors } from "@/hooks/useColors";
import {
  type AppLockCapability,
  authenticateForAppLock,
  getAppLockCapability,
  loadAppLockEnabled,
  setAppLockEnabled,
  subscribeAppLockEnabled,
} from "@/lib/appLock";
import { lockToggleLabelKey } from "@/lib/appLockCore";
import {
  ensureNotificationPermission,
  loadRemindersEnabled,
  remindersSupported,
  setRemindersEnabled,
  subscribeRemindersEnabled,
} from "@/lib/meetingReminders";

function SectionTitle({ children }: { children: string }) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <Text
      style={{
        color: c.mutedForeground,
        fontFamily: "Inter_600SemiBold",
        fontSize: 13,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 8,
        marginTop: 8,
        textAlign: rtl.textAlign,
      }}
    >
      {children}
    </Text>
  );
}

function OptionRow({
  label,
  active,
  onPress,
  destructive,
  icon,
  chevron,
  detail,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  destructive?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"];
  chevron?: boolean;
  detail?: string;
}) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: rtl.row,
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 14,
        paddingHorizontal: 4,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 12 }}>
        {icon ? (
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              backgroundColor: destructive ? c.destructiveTint : c.tint08,
              borderWidth: 1,
              borderColor: destructive ? "transparent" : c.tint25,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name={icon} size={16} color={destructive ? c.destructive : c.primary} />
          </View>
        ) : null}
        <Text
          style={{
            color: destructive ? c.destructive : c.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 15.5,
          }}
        >
          {label}
        </Text>
      </View>
      <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
        {detail ? (
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
            {detail}
          </Text>
        ) : null}
        {active ? (
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.primary, alignItems: "center", justifyContent: "center" }}>
            <Feather name="check" size={13} color="#FFFFFF" />
          </View>
        ) : null}
        {chevron ? <Feather name={rtl.isRTL ? "chevron-left" : "chevron-right"} size={18} color={c.mutedForeground} /> : null}
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang, setLang } = useI18n();
  const { pref, setPref } = useThemePref();
  const { logout } = useAuth();
  const feedback = useFeedback();

  const themes: { key: ThemePref; label: string }[] = [
    { key: "system", label: t("set.theme.system") },
    { key: "light", label: t("set.theme.light") },
    { key: "dark", label: t("set.theme.dark") },
  ];

  const version =
    Constants.expoConfig?.version ??
    (Constants.manifest2 as { extra?: { expoClient?: { version?: string } } } | null)?.extra
      ?.expoClient?.version ??
    "—";

  const dc = useDisplayCurrency();
  const pushPrefs = usePushPrefs();
  const [reminders, setReminders] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRemindersEnabled().then((v) => {
      if (alive) setReminders(v);
    });
    const unsub = subscribeRemindersEnabled(setReminders);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const toggleReminders = async (next: boolean) => {
    hapticLight();
    if (!next) {
      await setRemindersEnabled(false);
      return;
    }
    const perm = await ensureNotificationPermission();
    if (perm === "granted") {
      await setRemindersEnabled(true);
      return;
    }
    if (perm === "blocked") {
      const ok = await feedback.confirm({
        title: t("set.meetingReminders"),
        message: t("set.notifBlocked"),
        confirmLabel: t("set.openSettings"),
        cancelLabel: t("common.cancel"),
      });
      if (ok && Platform.OS !== "web") {
        try {
          Linking.openSettings();
        } catch {
          // best effort
        }
      }
    }
  };

  // Task #1044 — Face ID app lock.
  const [lockCap, setLockCap] = useState<AppLockCapability | null>(null);
  const [appLock, setAppLock] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    getAppLockCapability().then((cap) => {
      if (alive) setLockCap(cap);
    });
    loadAppLockEnabled().then((v) => {
      if (alive) setAppLock(v);
    });
    const unsub = subscribeAppLockEnabled(setAppLock);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const toggleAppLock = async (next: boolean) => {
    hapticLight();
    if (lockBusy) return;
    setLockBusy(true);
    try {
      // Both directions require a successful authentication: a passerby
      // can't enable a lock the owner can't pass, nor silently disable it.
      const ok = await authenticateForAppLock(t("set.appLockPrompt"));
      if (!ok) return;
      await setAppLockEnabled(next);
    } finally {
      setLockBusy(false);
    }
  };

  const doLogout = async () => {
    const ok = await feedback.confirm({
      title: t("set.logout"),
      message: t("set.logoutConfirm"),
      confirmLabel: t("set.logout"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (ok) logout();
  };


  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom + 90) + 24;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <AppBackground />
      {/* Task #1003 — unified glass header with brand logo. */}
      <AppHeader title={t("set.title")} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPad }}>
        <SectionTitle>{t("set.appearance")}</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          {themes.map((th, i) => (
            <View key={th.key}>
              <OptionRow label={th.label} active={pref === th.key} onPress={() => setPref(th.key)} />
              {i < themes.length - 1 ? (
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.borderSoft }} />
              ) : null}
            </View>
          ))}
        </Card>

        <SectionTitle>{t("set.language")}</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          {LANGS.map((l, i) => (
            <View key={l.code}>
              <OptionRow
                label={l.native}
                active={lang === l.code}
                onPress={() => setLang(l.code as Lang)}
              />
              {i < LANGS.length - 1 ? (
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.borderSoft }} />
              ) : null}
            </View>
          ))}
        </Card>

        {remindersSupported() ? (
          <>
            <SectionTitle>{t("set.notifications")}</SectionTitle>
            <Card style={{ paddingVertical: 4 }}>
              <View
                style={{
                  flexDirection: rtl.row,
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 10,
                  paddingHorizontal: 4,
                  gap: 12,
                }}
              >
                <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 12, flex: 1 }}>
                  <Feather name="bell" size={18} color={c.foreground} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: c.foreground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 16,
                        textAlign: rtl.textAlign,
                      }}
                    >
                      {t("set.meetingReminders")}
                    </Text>
                    <Text
                      style={{
                        color: c.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 13,
                        textAlign: rtl.textAlign,
                      }}
                    >
                      {t("set.meetingRemindersBody")}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={reminders}
                  onValueChange={toggleReminders}
                  trackColor={{ true: c.primary }}
                  testID="meeting-reminders-toggle"
                />
              </View>
            </Card>

            <SectionTitle>{t("set.pushAlerts")}</SectionTitle>
            <Card style={{ paddingVertical: 4 }}>
              {PUSH_CATEGORIES.map((cat, i) => (
                <View key={cat}>
                  <View
                    style={{
                      flexDirection: rtl.row,
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: 10,
                      paddingHorizontal: 4,
                      gap: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: c.foreground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 16,
                        textAlign: rtl.textAlign,
                        flex: 1,
                      }}
                    >
                      {t(`set.push.${cat}`)}
                    </Text>
                    <Switch
                      value={pushPrefs.categories[cat]}
                      onValueChange={(v) => pushPrefs.toggle(cat, v)}
                      trackColor={{ true: c.primary }}
                      testID={`push-category-${cat}`}
                    />
                  </View>
                  {i < PUSH_CATEGORIES.length - 1 ? (
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.borderSoft }} />
                  ) : null}
                </View>
              ))}
              <Text
                style={{
                  color: c.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 12.5,
                  paddingHorizontal: 4,
                  paddingBottom: 8,
                  textAlign: rtl.textAlign,
                }}
              >
                {t("set.pushAlertsBody")}
              </Text>
            </Card>
          </>
        ) : null}

        <SectionTitle>{t("set.displayCurrency")}</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          {dc.supported.map((cur, i) => (
            <View key={cur}>
              <OptionRow
                label={cur}
                active={dc.currency === cur}
                onPress={() => dc.update(cur)}
              />
              {i < dc.supported.length - 1 ? (
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.borderSoft }} />
              ) : null}
            </View>
          ))}
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12.5,
              paddingHorizontal: 4,
              paddingBottom: 8,
              textAlign: rtl.textAlign,
            }}
          >
            {t("set.displayCurrencyBody")}
          </Text>
        </Card>

        {/* Task #1044 — Face ID / Touch ID app lock. Hidden entirely when
            biometrics aren't available (web, no hardware, missing native
            module); shown disabled with a hint when nothing is enrolled. */}
        {lockCap?.supported ? (
          <>
            <SectionTitle>{t("set.security")}</SectionTitle>
            <Card style={{ paddingVertical: 4 }}>
              <View
                style={{
                  flexDirection: rtl.row,
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 10,
                  paddingHorizontal: 4,
                  gap: 12,
                }}
              >
                <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 12, flex: 1 }}>
                  <Feather name="shield" size={18} color={c.foreground} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: c.foreground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 16,
                        textAlign: rtl.textAlign,
                      }}
                    >
                      {t(lockToggleLabelKey(lockCap.kind))}
                    </Text>
                    <Text
                      style={{
                        color: c.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 13,
                        textAlign: rtl.textAlign,
                      }}
                    >
                      {lockCap.enrolled ? t("set.appLockBody") : t("set.appLockNotEnrolled")}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={appLock}
                  disabled={!lockCap.enrolled || lockBusy}
                  onValueChange={toggleAppLock}
                  trackColor={{ true: c.primary }}
                  testID="app-lock-toggle"
                />
              </View>
            </Card>
          </>
        ) : null}

        <SectionTitle>{t("set.account")}</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          <OptionRow
            label={t("set.changePassword")}
            icon="lock"
            chevron
            onPress={() => router.push("/change-password")}
          />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.borderSoft }} />
          <OptionRow label={t("set.logout")} icon="log-out" destructive onPress={doLogout} />
        </Card>

        <SectionTitle>{t("set.about")}</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          <OptionRow label={t("set.version")} detail={version} onPress={() => {}} />
        </Card>
      </ScrollView>
    </View>
  );
}
