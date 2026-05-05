import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar" | "tr";

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: "ltr" | "rtl";
}

const LangContext = createContext<LangContextValue>({
  lang: "en",
  setLang: () => undefined,
  dir: "ltr",
});

const KEY = "maven-ai-lang";

function isLang(v: unknown): v is Lang {
  return v === "en" || v === "ar" || v === "tr";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    const v = window.localStorage.getItem(KEY);
    return isLang(v) ? v : "en";
  });

  useEffect(() => {
    window.localStorage.setItem(KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = (l: Lang) => setLangState(l);
  return (
    <LangContext.Provider value={{ lang, setLang, dir: lang === "ar" ? "rtl" : "ltr" }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}

/**
 * Translate a multilingual string. The shared content library currently
 * carries `{ en, ar }` everywhere; the new Personal Agent surface adds an
 * optional `tr` field. Missing TR (or any missing key) silently falls
 * back to English so existing EN/AR-only data keeps working.
 */
export function tStr(s: { en: string; ar: string; tr?: string }, lang: Lang): string {
  if (lang === "tr") return s.tr ?? s.en;
  if (lang === "ar") return s.ar ?? s.en;
  return s.en;
}
