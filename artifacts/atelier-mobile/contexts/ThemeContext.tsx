import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme as useRNColorScheme } from "react-native";

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "atelier_theme_pref";

interface ThemeCtx {
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  scheme: "light" | "dark";
  hydrated: boolean;
}

const Ctx = createContext<ThemeCtx>({
  pref: "system",
  setPref: () => {},
  scheme: "dark",
  hydrated: false,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useRNColorScheme();
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === "system" || v === "light" || v === "dark") setPrefState(v);
      })
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  const setPref = (p: ThemePref) => {
    setPrefState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  };

  const scheme: "light" | "dark" =
    pref === "system" ? (system === "light" ? "light" : "dark") : pref;

  const value = useMemo(
    () => ({ pref, setPref, scheme, hydrated }),
    [pref, scheme, hydrated],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemePref(): ThemeCtx {
  return useContext(Ctx);
}

export function useThemeScheme(): "light" | "dark" {
  return useContext(Ctx).scheme;
}
