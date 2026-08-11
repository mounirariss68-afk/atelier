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

/**
 * Task #944 — Appearance motion preference. "on" (default) keeps the
 * breathing backdrop animation; "off" statics it via `data-motion="off"`
 * on <html> (see index.css). Persisted per-device in localStorage under
 * `atelier-motion`, pre-paint-applied by the inline script in index.html.
 * The OS prefers-reduced-motion setting still wins regardless.
 */
export type Motion = "on" | "off";

const MOTION_STORAGE_KEY = "atelier-motion";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  motion: Motion;
  setMotion: (m: Motion) => void;
  toggleMotion: () => void;
}

const Ctx = React.createContext<ThemeCtx>({
  theme: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
  motion: "on",
  setMotion: () => {},
  toggleMotion: () => {},
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

function readInitialMotion(): Motion {
  if (typeof document !== "undefined") {
    if (document.documentElement.getAttribute("data-motion") === "off") {
      return "off";
    }
  }
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage.getItem(MOTION_STORAGE_KEY) === "off") {
        return "off";
      }
    } catch {
      /* ignore */
    }
  }
  return "on";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => readInitialTheme());
  const [motion, setMotionState] = React.useState<Motion>(() => readInitialMotion());

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

  const applyMotion = React.useCallback((m: Motion) => {
    if (typeof document !== "undefined") {
      if (m === "off") {
        document.documentElement.setAttribute("data-motion", "off");
      } else {
        document.documentElement.removeAttribute("data-motion");
      }
    }
  }, []);

  // Keep the DOM in sync on mount even if the pre-paint script didn't run.
  React.useEffect(() => {
    applyMotion(motion);
  }, [motion, applyMotion]);

  const setMotion = React.useCallback(
    (m: Motion) => {
      setMotionState(m);
      try {
        // Only "off" is stored; default ("on") clears the key.
        if (m === "off") {
          window.localStorage.setItem(MOTION_STORAGE_KEY, "off");
        } else {
          window.localStorage.removeItem(MOTION_STORAGE_KEY);
        }
      } catch {
        /* ignore */
      }
      applyMotion(m);
    },
    [applyMotion],
  );

  const toggleMotion = React.useCallback(() => {
    setMotion(motion === "on" ? "off" : "on");
  }, [motion, setMotion]);

  const value = React.useMemo(
    () => ({ theme, setTheme, toggleTheme, motion, setMotion, toggleMotion }),
    [theme, setTheme, toggleTheme, motion, setMotion, toggleMotion],
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
  axis: "#9BA8C9",
  grid: "rgba(255, 255, 255, 0.08)",
  tooltipBg: "#141C42",
  tooltipBorder: "rgba(255, 255, 255, 0.13)",
  tooltipText: "#EEF1FA",
  success: "#34d399",
  warn: "#fbbf24",
  warnSoft: "rgba(251, 191, 36, 0.40)",
  danger: "#f87171",
  mute: "#94a3b8",
};

const LIGHT_PALETTE: ChartPalette = {
  axis: "#4A5675",
  grid: "rgba(10, 18, 48, 0.10)",
  tooltipBg: "#FFFFFF",
  tooltipBorder: "rgba(10, 18, 48, 0.15)",
  tooltipText: "#0A1230",
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
