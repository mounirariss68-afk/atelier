import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Lang = "en" | "ar";

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

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    const v = window.localStorage.getItem(KEY);
    return v === "ar" ? "ar" : "en";
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

export function tStr(s: { en: string; ar: string }, lang: Lang): string {
  return s[lang] ?? s.en;
}
