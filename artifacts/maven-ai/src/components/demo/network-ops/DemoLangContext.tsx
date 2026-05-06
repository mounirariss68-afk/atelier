import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DemoLang = "en" | "ar";

const STORAGE_KEY = "noc-demo-lang";

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

export function NocDemoLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<DemoLang>(readStoredLang);
  const setLang = useCallback((l: DemoLang) => {
    setLangState(l);
    try { sessionStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useNocDemoLang() {
  return useContext(Ctx);
}

export function useNocDemoT() {
  const { lang } = useContext(Ctx);
  return (key: string, dict: { en: Record<string, string>; ar: Record<string, string> }): string => {
    const table = dict[lang] ?? dict.en;
    return table[key] ?? dict.en[key] ?? key;
  };
}
