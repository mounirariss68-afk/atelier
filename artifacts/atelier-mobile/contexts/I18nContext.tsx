import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { FlexStyle, TextStyle } from "react-native";

import { type Lang, translations } from "@/constants/i18n";

const STORAGE_KEY = "atelier_lang";

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  isRTL: boolean;
}

const Ctx = createContext<I18nCtx>({
  lang: "en",
  setLang: () => {},
  t: (k) => k,
  isRTL: false,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === "en" || v === "tr" || v === "ar") setLangState(v);
    });
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = translations[lang] ?? translations.en;
      let s = dict[key] ?? translations.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return s;
    },
    [lang],
  );

  const value = useMemo(
    () => ({ lang, setLang, t, isRTL: lang === "ar" }),
    [lang, setLang, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  return useContext(Ctx);
}

/** Convenience hook returning just the translate function. */
export function useT() {
  return useContext(Ctx).t;
}

/**
 * RTL-aware layout helpers. We deliberately avoid I18nManager.forceRTL
 * (it requires a native reload); instead we flip layout properties at
 * the style level so Arabic renders right-to-left immediately.
 */
export function useRTL() {
  const isRTL = useContext(Ctx).isRTL;
  return {
    isRTL,
    row: (isRTL ? "row-reverse" : "row") as FlexStyle["flexDirection"],
    textAlign: (isRTL ? "right" : "left") as TextStyle["textAlign"],
    writingDirection: (isRTL ? "rtl" : "ltr") as TextStyle["writingDirection"],
    start: (isRTL ? "flex-end" : "flex-start") as FlexStyle["alignItems"],
  };
}
