import React from "react";
import { Image, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Glass, WEB_TOP_INSET, softShadow } from "@/components/ui";
import { useRTL } from "@/contexts/I18nContext";
import { useThemeScheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";

// Task #1003 — unified glass page header: Cognirise logo on the left,
// page title on the right, over the app's standard glass treatment
// (Liquid Glass / BlurView / web backdrop blur / solid fallback — all
// handled by the shared <Glass> primitive). Replaces the per-screen
// ad-hoc headers (opaque navy islands, plain rows).
const logoLight = require("@/assets/images/cognirise-logo-light.png");
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
  const scheme = useThemeScheme();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;

  return (
    <Glass
      radius={24}
      style={[
        {
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderTopWidth: 0,
          borderLeftWidth: 0,
          borderRightWidth: 0,
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
          source={scheme === "dark" ? logoDark : logoLight}
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
              color: c.foreground,
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
                color: c.mutedForeground,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 12,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </Glass>
  );
}
