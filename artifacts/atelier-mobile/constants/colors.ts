/**
 * Semantic design tokens for Atelier mobile app.
 *
 * Fully synced from Atelier web artifact's index.css (Cognirise brand):
 * deep navy surfaces, magenta accent, cool near-white text, accent tints and
 * the brand easing. Dark is the brand-default theme; light mirrors the web
 * light theme.
 *
 * Note: the retired 4-color gradient (blue→purple→magenta→coral) is no longer
 * exported. The only two intentional gradient spots (login hero glow, splash
 * loader) inline it locally in app/login.tsx and app/_layout.tsx.
 */

/** Brand-standard easing curve (matches the web's --ease). */
export const EASE = [0.22, 1, 0.36, 1] as const;

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: "#0A1230",
    tint: "#A6348F",

    // Core surfaces
    background: "#F6F7FB",
    backgroundDeep: "#ECEFF7",
    foreground: "#0A1230",

    // Cards / elevated surfaces
    card: "#FFFFFF",
    cardForeground: "#0A1230",
    elevate2: "#F1F3FA",

    // Primary action color (buttons, links, active states)
    primary: "#A6348F",
    primaryForeground: "#FFFFFF",

    // Secondary / less-emphasis interactive surfaces
    secondary: "#F1F3FA",
    secondaryForeground: "#0A1230",

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: "#ECEFF7",
    mutedForeground: "#4A5675",
    faint: "#8A93AD",

    // Accent highlights (badges, selected items, focus rings)
    accent: "#8A5BD6",
    accentForeground: "#FFFFFF",
    coral: "#C45BB8",

    // Accent tints (magenta at web-synced alphas)
    tint08: "rgba(166, 52, 143, 0.10)",
    tint25: "rgba(166, 52, 143, 0.26)",
    tint45: "rgba(166, 52, 143, 0.48)",
    successTint: "rgba(21, 128, 61, 0.14)",
    warningTint: "rgba(180, 83, 9, 0.14)",
    destructiveTint: "rgba(185, 28, 28, 0.12)",

    // Status
    success: "#15803D",
    warning: "#B45309",
    destructive: "#B91C1C",
    destructiveForeground: "#FFFFFF",

    // Borders and input outlines
    border: "#D8DEEC",
    borderSoft: "rgba(10, 18, 48, 0.08)",
    input: "#D8DEEC",

    // Glass surfaces (translucent fallback / overlay wash)
    // Task #1043 — dropped from 0.72: at that opacity nothing blurred
    // through and the tab bar read as a solid bar, not glass.
    glass: "rgba(255, 255, 255, 0.45)",
    glassBorder: "rgba(10, 18, 48, 0.10)",
    scrim: "rgba(7, 11, 34, 0.45)",
    // Task #999: translucent card wash so content cards read as glass
    // over the backdrop artwork (web parity). Android keeps opaque `card`.
    cardGlass: "rgba(255, 255, 255, 0.68)",

    // Soft depth shadow color
    shadow: "rgba(10, 18, 48, 0.18)",
  },

  dark: {
    // Legacy aliases (kept for backward compatibility)
    text: "#EEF1FA",
    tint: "#C45BB8",

    // Core surfaces
    background: "#0A1230",
    backgroundDeep: "#070B22",
    foreground: "#EEF1FA",

    // Cards / elevated surfaces
    card: "#141C42",
    cardForeground: "#EEF1FA",
    elevate2: "#1B2755",

    // Primary action color (buttons, links, active states)
    primary: "#C45BB8",
    primaryForeground: "#FFFFFF",

    // Secondary / less-emphasis interactive surfaces
    secondary: "#1B2755",
    secondaryForeground: "#EEF1FA",

    // Muted / subdued elements
    muted: "#1B2755",
    mutedForeground: "#9BA8C9",
    faint: "#5E6A8C",

    // Accent highlights
    accent: "#8A5BD6",
    accentForeground: "#FFFFFF",
    coral: "#FF7B5A",

    // Accent tints (magenta at web-synced alphas)
    tint08: "rgba(196, 91, 184, 0.10)",
    tint25: "rgba(196, 91, 184, 0.25)",
    tint45: "rgba(196, 91, 184, 0.45)",
    successTint: "rgba(74, 222, 128, 0.14)",
    warningTint: "rgba(251, 191, 36, 0.14)",
    destructiveTint: "rgba(248, 113, 113, 0.14)",

    // Status
    success: "#4ADE80",
    warning: "#FBBF24",
    destructive: "#F87171",
    destructiveForeground: "#0A1230",

    // Borders and input outlines
    border: "#2A3566",
    borderSoft: "rgba(255, 255, 255, 0.07)",
    input: "#2A3566",

    // Glass surfaces (translucent fallback / overlay wash)
    // Task #1043 — dropped from 0.72 so content genuinely blurs through.
    glass: "rgba(13, 20, 52, 0.42)",
    glassBorder: "rgba(255, 255, 255, 0.10)",
    scrim: "rgba(3, 6, 20, 0.60)",
    // Task #999: translucent card wash (see light note).
    cardGlass: "rgba(20, 28, 66, 0.62)",

    // Soft depth shadow color
    shadow: "rgba(0, 0, 0, 0.55)",
  },

  // Border radius (px). Mobile adaptation of the brand: larger, softer radii.
  radius: 16,
};

export default colors;
