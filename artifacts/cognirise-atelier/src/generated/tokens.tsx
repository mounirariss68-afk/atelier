/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#F6F7FB",
      "foreground": "#0A1230",
      "border": "#D8DEEC",
      "card": "#FFFFFF",
      "cardForeground": "#0A1230",
      "popover": "#F1F3FA",
      "popoverForeground": "#0A1230",
      "primary": "#A6348F",
      "primaryForeground": "#FFFFFF",
      "secondary": "#7A2E6E",
      "secondaryForeground": "#FFFFFF",
      "muted": "#F1F3FA",
      "mutedForeground": "#4A5675",
      "accent": "#FF7B5A",
      "accentForeground": "#070B22",
      "destructive": "#B91C1C",
      "destructiveForeground": "#FFFFFF",
      "input": "#D8DEEC",
      "ring": "#A6348F",
      "chart1": "#5B7CFF",
      "chart2": "#8A5BD6",
      "chart3": "#A6348F",
      "chart4": "#FF7B5A",
      "chart5": "#15803D",
      "sidebar": "#FFFFFF",
      "sidebarForeground": "#0A1230",
      "sidebarBorder": "#D8DEEC",
      "sidebarPrimary": "#A6348F",
      "sidebarPrimaryForeground": "#FFFFFF",
      "sidebarAccent": "#F1F3FA",
      "sidebarAccentForeground": "#0A1230",
      "sidebarRing": "#A6348F"
    },
    "dark": {
      "background": "#0A1230",
      "foreground": "#EEF1FA",
      "border": "#2A3566",
      "card": "#141C42",
      "cardForeground": "#EEF1FA",
      "popover": "#1B2755",
      "popoverForeground": "#EEF1FA",
      "primary": "#C45BB8",
      "primaryForeground": "#070B22",
      "secondary": "#8A5BD6",
      "secondaryForeground": "#FFFFFF",
      "muted": "#1B2755",
      "mutedForeground": "#9BA8C9",
      "accent": "#FF7B5A",
      "accentForeground": "#070B22",
      "destructive": "#F87171",
      "destructiveForeground": "#070B22",
      "input": "#2A3566",
      "ring": "#C45BB8",
      "chart1": "#5B7CFF",
      "chart2": "#8A5BD6",
      "chart3": "#C45BB8",
      "chart4": "#FF7B5A",
      "chart5": "#4ADE80",
      "sidebar": "#141C42",
      "sidebarForeground": "#EEF1FA",
      "sidebarBorder": "#2A3566",
      "sidebarPrimary": "#C45BB8",
      "sidebarPrimaryForeground": "#070B22",
      "sidebarAccent": "#1B2755",
      "sidebarAccentForeground": "#EEF1FA",
      "sidebarRing": "#C45BB8"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "system-ui",
      "-apple-system",
      "sans-serif"
    ],
    "serif": [
      "Comfortaa",
      "Inter",
      "Georgia",
      "serif"
    ],
    "mono": [
      "ui-monospace",
      "SFMono-Regular",
      "Menlo",
      "monospace"
    ]
  },
  "radius": "0.625rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
