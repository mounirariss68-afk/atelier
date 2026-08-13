import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useThemeScheme } from "@/contexts/ThemeContext";

/**
 * Branded backdrop artwork behind every screen, mirroring the web app.
 *
 * Dark mode (Task #907): the navy/purple network image in a portrait crop,
 * under a navy scrim gradient so text and glass surfaces stay readable.
 *
 * Light mode (Task #999): the wave artwork the web's light theme uses
 * (portrait crop of light-bg-wave), under a pale scrim mirroring the web's
 * 160° wash — heavier at the top where headers/text sit.
 *
 * Render it as the FIRST child of a screen's root View (which should keep
 * its solid `c.background` color — that stays as the fallback while the
 * image decodes). It is absolutely positioned and non-scrolling, so scroll
 * performance is unaffected.
 */
const darkBg = require("@/assets/images/dark-bg-portrait.webp");
const lightBg = require("@/assets/images/light-bg-portrait.webp");

export function AppBackground() {
  const scheme = useThemeScheme();
  const dark = scheme === "dark";

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={dark ? darkBg : lightBg}
        style={StyleSheet.absoluteFillObject}
        resizeMode="cover"
        fadeDuration={0}
        accessible={false}
      />
      {/* Scrim mirroring the web's 160° gradient wash over the image:
          heavier at the top (where headers/text sit), lighter toward the
          bottom so the artwork shows through. */}
      <LinearGradient
        colors={
          dark
            ? // Task #1043 — TestFlight showed the artwork still washed out
              // on-device; the portrait crops were re-cut from the landscape
              // originals (wave-dense regions) and the scrim eased again so
              // the waves clearly read through while text stays legible.
              [
                "rgba(7, 11, 34, 0.30)",
                "rgba(10, 18, 48, 0.16)",
                "rgba(7, 11, 34, 0.10)",
              ]
            : [
                "rgba(246, 247, 251, 0.50)",
                "rgba(246, 247, 251, 0.24)",
                "rgba(236, 239, 247, 0.14)",
              ]
        }
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
