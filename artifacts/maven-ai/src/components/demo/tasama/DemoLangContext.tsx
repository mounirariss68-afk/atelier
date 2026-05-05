import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DemoLang = "en" | "ar";

const STORAGE_KEY = "tasama-demo-lang";

function readStoredLang(): DemoLang {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "ar") return "ar";
  } catch {}
  return "en";
}

interface DemoLangContextValue {
  lang: DemoLang;
  setLang: (l: DemoLang) => void;
}

const Ctx = createContext<DemoLangContextValue>({ lang: "en", setLang: () => {} });

export function TasamaDemoLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<DemoLang>(readStoredLang);
  const setLang = useCallback((l: DemoLang) => {
    setLangState(l);
    try { sessionStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useTasamaDemoLang() {
  return useContext(Ctx);
}

export function useTasamaDemoT() {
  const { lang } = useContext(Ctx);
  return (key: string, dict: Record<string, Record<DemoLang, string>>): string => {
    const entry = dict[key];
    if (!entry) return key;
    return entry[lang] ?? entry.en ?? key;
  };
}
