import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar" | "tr";

export interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: "ltr" | "rtl";
}

const LangContext = createContext<LangContextValue>({
  lang: "en",
  setLang: () => undefined,
  dir: "ltr",
});

const KEY = "cognirise-lang";

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

export type T = { en: string; ar?: string; tr?: string };

const warnedKeys = new Set<string>();
function devWarnMissing(s: T, lang: Lang) {
  if (typeof import.meta === "undefined") return;
  // Vite injects DEV at build time
  if (!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return;
  const need = lang === "ar" || lang === "tr" ? lang : null;
  if (!need) return;
  if (s[need]) return;
  const k = `${lang}:${(s.en ?? "").slice(0, 60)}`;
  if (warnedKeys.has(k)) return;
  warnedKeys.add(k);
  console.warn(`[i18n] missing ${lang} translation for: "${(s.en ?? "").slice(0, 100)}"`);
}

/**
 * Translate a multilingual string. Missing AR/TR silently falls back to EN
 * but emits a dev-time console warning (once per unique missing key) so
 * untranslated strings are easy to spot during development.
 */
export function tStr(s: T, lang: Lang): string {
  if (lang === "tr") {
    if (!s.tr) devWarnMissing(s, lang);
    return s.tr ?? s.en;
  }
  if (lang === "ar") {
    if (!s.ar) devWarnMissing(s, lang);
    return s.ar ?? s.en;
  }
  return s.en;
}

/** Hook for component-local translation. */
export function useT() {
  const { lang } = useLang();
  return (s: T) => tStr(s, lang);
}

const LOCALE_TAG: Record<Lang, string> = {
  en: "en-US",
  ar: "ar-SA",
  tr: "tr-TR",
};

/** Locale-aware date formatter. */
export function formatDate(
  input: string | number | Date,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  try {
    return new Intl.DateTimeFormat(LOCALE_TAG[lang], opts).format(new Date(input));
  } catch {
    return new Date(input).toLocaleDateString();
  }
}

/** Locale-aware number formatter. */
export function formatNumber(
  n: number,
  lang: Lang,
  opts: Intl.NumberFormatOptions = {},
): string {
  try {
    return new Intl.NumberFormat(LOCALE_TAG[lang], opts).format(n);
  } catch {
    return String(n);
  }
}
