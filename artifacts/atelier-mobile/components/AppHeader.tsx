import React from "react";
import { Image, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WEB_TOP_INSET, softShadow } from "@/components/ui";
import { useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";

// Task #1008 — solid dark-navy page header matching the web top bar
// (~#141C42) in BOTH themes: white Cognirise logo on the left, white
// page title on the right. Replaces the Task #1003 glass treatment,
// which washed out over the light background.
const NAVY = "#141C42";
const logoDark = require("@/assets/images/cognirise-logo-dark-bg.png");

export function AppHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  /** Optional secondary line under the title (e.g. Meetings' subtitle). */
  subtitle?: string;
  /** Optional header-level actions, rendered between logo and title. */
  actions?: React.ReactNode;
}) {
  const c = useColors();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;

  return (
    <View
      style={[
        {
          backgroundColor: NAVY,
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24,
          borderBottomWidth: 1,
          borderColor: "rgba(255,255,255,0.10)",
          paddingTop: topPad,
          paddingBottom: 12,
          paddingHorizontal: 16,
        },
        softShadow(c.shadow),
      ]}
    >
      <View
        style={{
          flexDirection: rtl.row,
          alignItems: "center",
          gap: 10,
        }}
      >
        <Image
          source={logoDark}
          style={{ width: 104, height: 28 }}
          resizeMode="contain"
          accessibilityLabel="Cognirise"
        />
        <View style={{ flex: 1 }} />
        {actions}
        <View style={{ alignItems: rtl.isRTL ? "flex-start" : "flex-end" }}>
          <Text
            numberOfLines={1}
            style={{
              color: "#FFFFFF",
              fontFamily: "PlusJakartaSans_800ExtraBold",
              fontSize: 19,
              letterSpacing: -0.3,
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={{
                color: "rgba(238,241,250,0.72)",
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 12,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
