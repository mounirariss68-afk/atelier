import { type ReactNode } from "react";
import { useLang, type Lang } from "@/lib/lang";

export type DemoLang = "en" | "ar";

export function EkcDemoLangProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useEkcLang(): { lang: DemoLang; setLang: (l: DemoLang) => void } {
  const { lang, setLang } = useLang();
  const demoLang: DemoLang = lang === "ar" ? "ar" : "en";
  return {
    lang: demoLang,
    setLang: (l: DemoLang) => setLang(l as Lang),
  };
}

export function useEkcT() {
  const { lang } = useEkcLang();
  return (key: string, dict: Record<string, Record<DemoLang, string>>): string => {
    const entry = dict[key];
    if (!entry) return key;
    return entry[lang] ?? entry.en ?? key;
  };
}
