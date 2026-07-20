import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";

import { useI18n } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";

function NativeTabLayout() {
  const { t } = useI18n();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
        <Label>{t("tab.chat")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="meetings">
        <Icon sf={{ default: "calendar", selected: "calendar" }} />
        <Label>{t("tab.meetings")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="expenses">
        <Icon sf={{ default: "creditcard", selected: "creditcard.fill" }} />
        <Label>{t("tab.expenses")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="me">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>{t("tab.me")}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>{t("tab.settings")}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const { t } = useI18n();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  const sf: Record<string, string> = {
    index: "bubble.left",
    meetings: "calendar",
    expenses: "creditcard",
    me: "person",
    settings: "gearshape",
  };
  const feather: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
    index: "message-circle",
    meetings: "calendar",
    expenses: "credit-card",
    me: "user",
    settings: "settings",
  };

  const icon =
    (name: string) =>
    ({ color }: { color: string }) =>
      isIOS ? (
        <SymbolView name={sf[name] as never} tintColor={color} size={24} />
      ) : (
        <Feather name={feather[name]} size={22} color={color} />
      );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tab.chat"), tabBarIcon: icon("index") }} />
      <Tabs.Screen name="meetings" options={{ title: t("tab.meetings"), tabBarIcon: icon("meetings") }} />
      <Tabs.Screen name="expenses" options={{ title: t("tab.expenses"), tabBarIcon: icon("expenses") }} />
      <Tabs.Screen name="me" options={{ title: t("tab.me"), tabBarIcon: icon("me") }} />
      <Tabs.Screen name="settings" options={{ title: t("tab.settings"), tabBarIcon: icon("settings") }} />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) return <NativeTabLayout />;
  return <ClassicTabLayout />;
}
