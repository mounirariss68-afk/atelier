import * as React from "react";

/**
 * Task #497 — Atelier light/dark mode theming.
 *
 * Resolution order on mount: localStorage → OS prefers-color-scheme → "dark".
 * The `<html data-theme>` attribute is set by an inline script in
 * `index.html` before first paint to avoid a flash of wrong theme; this
 * provider reads/writes that same attribute and persists changes to
 * localStorage under `atelier-theme`.
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "atelier-theme";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const Ctx = React.createContext<ThemeCtx>({
  theme: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
});

function readInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* ignore */
    }
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => readInitialTheme());

  const applyTheme = React.useCallback((t: Theme) => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.style.colorScheme = t;
    }
  }, []);

  // Make sure the DOM reflects the resolved theme on mount, even if the
  // inline pre-paint script didn't run (e.g. SSR / tests).
  React.useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  const setTheme = React.useCallback(
    (t: Theme) => {
      setThemeState(t);
      try {
        window.localStorage.setItem(STORAGE_KEY, t);
      } catch {
        /* ignore */
      }
      applyTheme(t);
    },
    [applyTheme],
  );

  const toggleTheme = React.useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = React.useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return React.useContext(Ctx);
}

/**
 * Theme-aware palette for Recharts. Recharts renders colors as SVG
 * attributes (not inline styles), so `var(--token)` strings don't
 * resolve. We pick concrete hex/rgba values keyed off the active
 * theme, mirroring the palette tokens declared in `index.css`.
 */
export interface ChartPalette {
  axis: string;
  grid: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  success: string;
  warn: string;
  warnSoft: string;
  danger: string;
  mute: string;
}

const DARK_PALETTE: ChartPalette = {
  axis: "#8FA3C0",
  grid: "rgba(255, 255, 255, 0.08)",
  tooltipBg: "#15294A",
  tooltipBorder: "rgba(255, 255, 255, 0.13)",
  tooltipText: "#F1EEE6",
  success: "#34d399",
  warn: "#fbbf24",
  warnSoft: "rgba(251, 191, 36, 0.40)",
  danger: "#f87171",
  mute: "#94a3b8",
};

const LIGHT_PALETTE: ChartPalette = {
  axis: "#4A5B78",
  grid: "rgba(14, 31, 61, 0.10)",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "rgba(14, 31, 61, 0.15)",
  tooltipText: "#0E1F3D",
  success: "#15803D",
  warn: "#B45309",
  warnSoft: "rgba(180, 83, 9, 0.32)",
  danger: "#B91C1C",
  mute: "#6B7A95",
};

export function useChartPalette(): ChartPalette {
  const { theme } = useTheme();
  return theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}
