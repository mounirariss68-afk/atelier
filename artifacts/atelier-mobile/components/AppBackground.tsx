import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useThemeScheme } from "@/contexts/ThemeContext";

/**
 * Branded dark-mode backdrop (Task #907): the same navy/purple network image
 * the web app uses behind its dark theme, in a portrait crop sized for
 * phones, with a navy scrim gradient layered over it so text and glass
 * surfaces stay readable.
 *
 * Render it as the FIRST child of a screen's root View (which should keep
 * its solid `c.background` color — that stays as the fallback while the
 * image decodes, and is the entire backdrop in light mode, where this
 * component renders nothing). It is absolutely positioned and non-scrolling,
 * so scroll performance is unaffected.
 */
const darkBg = require("@/assets/images/dark-bg-portrait.webp");

export function AppBackground() {
  const scheme = useThemeScheme();
  if (scheme !== "dark") return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={darkBg}
        style={StyleSheet.absoluteFillObject}
        resizeMode="cover"
        fadeDuration={0}
        accessible={false}
      />
      {/* Navy scrim, mirroring the web's 160° gradient wash over the image:
          heavier at the top (where headers/text sit), lighter toward the
          bottom so the network flourish shows through. */}
      <LinearGradient
        colors={[
          "rgba(7, 11, 34, 0.78)",
          "rgba(10, 18, 48, 0.58)",
          "rgba(7, 11, 34, 0.48)",
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
