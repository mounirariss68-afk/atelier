import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import React from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, WEB_TAB_BAR, WEB_TOP_INSET, hapticLight } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { type ThemePref, useThemePref } from "@/contexts/ThemeContext";
import { LANGS, type Lang } from "@/constants/i18n";
import { useColors } from "@/hooks/useColors";

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
        letterSpacing: 0.5,
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
        {icon ? <Feather name={icon} size={18} color={destructive ? c.destructive : c.foreground} /> : null}
        <Text
          style={{
            color: destructive ? c.destructive : c.foreground,
            fontFamily: "Inter_500Medium",
            fontSize: 16,
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
        {active ? <Feather name="check" size={18} color={c.primary} /> : null}
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

  const doLogout = () => {
    Alert.alert(t("set.title"), t("set.logoutConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("set.logout"), style: "destructive", onPress: () => logout() },
    ]);
  };

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;
  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom) + 24;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: topPad,
          paddingBottom: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
        }}
      >
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 22, textAlign: rtl.textAlign }}>
          {t("set.title")}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPad }}>
        <SectionTitle>{t("set.appearance")}</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          {themes.map((th, i) => (
            <View key={th.key}>
              <OptionRow label={th.label} active={pref === th.key} onPress={() => setPref(th.key)} />
              {i < themes.length - 1 ? (
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
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
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
              ) : null}
            </View>
          ))}
        </Card>

        <SectionTitle>{t("set.account")}</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          <OptionRow
            label={t("set.changePassword")}
            icon="lock"
            chevron
            onPress={() => router.push("/change-password")}
          />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
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
