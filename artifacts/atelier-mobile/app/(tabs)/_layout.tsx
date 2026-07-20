import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MeetingReminders } from "@/components/MeetingReminders";
import {
  BRAND_EASING,
  Glass,
  hapticLight,
  softShadow,
} from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";

const ICONS: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  index: "message-circle",
  expenses: "credit-card",
  meetings: "calendar",
  me: "user",
  settings: "settings",
};

interface TabBarRoute {
  key: string;
  name: string;
}
interface TabBarProps {
  state: { index: number; routes: TabBarRoute[] };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    emit: (e: { type: string; target?: string; canPreventDefault?: boolean }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
}

const BAR_MARGIN = 16;
const BAR_HEIGHT = 64;

/**
 * Floating glassmorphic pill tab bar with a gradient highlight pill that
 * spring-animates between tabs. Safe-area and RTL aware; the bar itself is
 * a "dark island" — it stays navy-tinted glass in both themes.
 */
function FloatingPillTabBar({ state, descriptors, navigation }: TabBarProps) {
  const c = useColors();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);

  const routes = state.routes.filter((r: TabBarRoute) => ICONS[r.name]);
  const count = routes.length || 1;
  const segment = barWidth / count;
  const activeIndex = routes.findIndex((r: TabBarRoute) => r.key === state.routes[state.index]?.key);
  // Visual order flips in RTL.
  const visualIndex = rtl.isRTL ? count - 1 - activeIndex : activeIndex;

  const pillX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (barWidth === 0 || visualIndex < 0) return;
    Animated.spring(pillX, {
      toValue: visualIndex * segment,
      useNativeDriver: Platform.OS !== "web",
      stiffness: 220,
      damping: 24,
      mass: 0.9,
    }).start();
  }, [visualIndex, segment, barWidth, pillX]);

  const bottom = Math.max(insets.bottom, 10) + (Platform.OS === "web" ? 12 : 0);
  const orderedRoutes = rtl.isRTL ? [...routes].reverse() : routes;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: BAR_MARGIN,
        right: BAR_MARGIN,
        bottom,
      }}
    >
      <Glass radius={BAR_HEIGHT / 2} style={[{ height: BAR_HEIGHT }, softShadow(c.shadow)]}>
        <View
          style={{ flex: 1, flexDirection: "row", paddingHorizontal: 6, alignItems: "center" }}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width - 12)}
        >
          {barWidth > 0 && visualIndex >= 0 ? (
            <Animated.View
              style={{
                position: "absolute",
                left: 6,
                top: 8,
                bottom: 8,
                width: segment,
                transform: [{ translateX: pillX }],
              }}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: (BAR_HEIGHT - 16) / 2,
                  backgroundColor: c.primary,
                  opacity: 0.95,
                }}
              />
            </Animated.View>
          ) : null}
          {orderedRoutes.map((route: TabBarRoute) => {
            const { options } = descriptors[route.key];
            const label = options.title ?? route.name;
            const focused = route.key === state.routes[state.index]?.key;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={focused ? { selected: true } : {}}
                accessibilityLabel={label}
                onPress={() => {
                  hapticLight();
                  const event = navigation.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}
                style={{
                  flex: 1,
                  height: BAR_HEIGHT - 16,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <Feather
                  name={ICONS[route.name]}
                  size={20}
                  color={focused ? "#FFFFFF" : c.mutedForeground}
                />
                <AnimatedLabel focused={focused} label={label} muted={c.mutedForeground} />
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

function AnimatedLabel({
  focused,
  label,
  muted,
}: {
  focused: boolean;
  label: string;
  muted: string;
}) {
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: focused ? 1 : 0,
      duration: 260,
      easing: BRAND_EASING,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [focused, anim]);
  return (
    <Animated.View style={{ opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }}>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: focused ? "PlusJakartaSans_700Bold" : "PlusJakartaSans_500Medium",
          fontSize: 10.5,
          letterSpacing: 0.2,
          color: focused ? "#FFFFFF" : muted,
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

export default function TabLayout() {
  const { t } = useI18n();
  return (
    <>
      <MeetingReminders />
      <Tabs
        tabBar={(props) => <FloatingPillTabBar {...(props as unknown as TabBarProps)} />}
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}
      >
        <Tabs.Screen name="index" options={{ title: t("tab.chat") }} />
        <Tabs.Screen name="expenses" options={{ title: t("tab.expenses") }} />
        <Tabs.Screen name="meetings" options={{ title: t("tab.meetings") }} />
        <Tabs.Screen name="me" options={{ title: t("tab.me") }} />
        <Tabs.Screen name="settings" options={{ title: t("tab.settings") }} />
      </Tabs>
    </>
  );
}
