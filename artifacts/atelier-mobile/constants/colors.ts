/**
 * Semantic design tokens for the Atelier mobile app.
 *
 * Synced from the Atelier web artifact's index.css (Cognirise brand):
 * deep navy surfaces, magenta accent (--gold token), cool near-white text.
 * Dark is the brand-default theme; light mirrors the web light theme.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: "#0A1230",
    tint: "#A3399A",

    // Core surfaces
    background: "#F6F7FB",
    foreground: "#0A1230",

    // Cards / elevated surfaces
    card: "#FFFFFF",
    cardForeground: "#0A1230",

    // Primary action color (buttons, links, active states)
    primary: "#A3399A",
    primaryForeground: "#FFFFFF",

    // Secondary / less-emphasis interactive surfaces
    secondary: "#F1F3FA",
    secondaryForeground: "#0A1230",

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: "#ECEFF7",
    mutedForeground: "#4A5675",

    // Accent highlights (badges, selected items, focus rings)
    accent: "#8A5BD6",
    accentForeground: "#FFFFFF",

    // Status
    success: "#15803D",
    warning: "#B45309",
    destructive: "#DC2626",
    destructiveForeground: "#FFFFFF",

    // Borders and input outlines
    border: "#D8DEEC",
    input: "#D8DEEC",
  },

  dark: {
    // Legacy aliases (kept for backward compatibility)
    text: "#EEF1FA",
    tint: "#C45BB8",

    // Core surfaces
    background: "#0A1230",
    foreground: "#EEF1FA",

    // Cards / elevated surfaces
    card: "#141C42",
    cardForeground: "#EEF1FA",

    // Primary action color (buttons, links, active states)
    primary: "#C45BB8",
    primaryForeground: "#FFFFFF",

    // Secondary / less-emphasis interactive surfaces
    secondary: "#1B2755",
    secondaryForeground: "#EEF1FA",

    // Muted / subdued elements
    muted: "#1B2755",
    mutedForeground: "#9BA8C9",

    // Accent highlights
    accent: "#8A5BD6",
    accentForeground: "#FFFFFF",

    // Status
    success: "#4ADE80",
    warning: "#FBBF24",
    destructive: "#F87171",
    destructiveForeground: "#0A1230",

    // Borders and input outlines
    border: "#2A3566",
    input: "#2A3566",
  },

  // Border radius (in px). Synced from the web artifact's --radius-lg.
  radius: 8,
};

export default colors;
