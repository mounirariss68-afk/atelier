import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Preview-browser theme controller implementing the documented
 * light / dark / system contract (docs/consuming-web.md → App shell & chat):
 * - the selected MODE (including "system") is what persists, never its
 *   resolved value;
 * - "system" follows the OS prefers-color-scheme live;
 * - first-time default is "system";
 * - the theme applies via the `.dark` class on <html> plus colorScheme.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'cognirise-atelier-theme';

function readInitialMode(): ThemeMode {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(
    'theme',
  );
  if (fromHash === 'dark' || fromHash === 'light' || fromHash === 'system') {
    return fromHash;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    return stored;
  }
  return 'system';
}

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: 'dark' | 'light';
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function PreviewThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readInitialMode);
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(media.matches);
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    // Track the OS preference continuously; it only takes effect in
    // system mode via the resolved value below.
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved: 'dark' | 'light' =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  useEffect(() => {
    // Persist the MODE itself so "system" survives reloads.
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, resolved, setMode }),
    [mode, resolved],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function usePreviewTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('usePreviewTheme must be used within PreviewThemeProvider');
  }
  return ctx;
}
