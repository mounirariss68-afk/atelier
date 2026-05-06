import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DemoLang = "en" | "ar";

const STORAGE_KEY = "tender-studio-demo-lang";

function readStoredLang(): DemoLang {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "ar") return "ar";
  } catch {}
  return "en";
}

interface Value { lang: DemoLang; setLang: (l: DemoLang) => void }

const Ctx = createContext<Value>({ lang: "en", setLang: () => {} });

export function TenderDemoLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<DemoLang>(readStoredLang);
  const setLang = useCallback((l: DemoLang) => {
    setLangState(l);
    try { sessionStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useTenderDemoLang() {
  return useContext(Ctx);
}

export function useTenderDemoT() {
  const { lang } = useContext(Ctx);
  return (key: string, dict: Record<string, Record<DemoLang, string>>): string => {
    const entry = dict[key];
    if (!entry) return key;
    return entry[lang] ?? entry.en ?? key;
  };
}
