import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DemoLang = "tr" | "en";

const STORAGE_KEY = "arcelik-demo-lang";

function readStoredLang(): DemoLang {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "en") return "en";
  } catch {}
  return "tr";
}

interface DemoLangContextValue {
  lang: DemoLang;
  setLang: (l: DemoLang) => void;
}

const Ctx = createContext<DemoLangContextValue>({ lang: "tr", setLang: () => {} });

export function DemoLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<DemoLang>(readStoredLang);
  const setLang = useCallback((l: DemoLang) => {
    setLangState(l);
    try { sessionStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useDemoLang() {
  return useContext(Ctx);
}

export function useDemoT() {
  const { lang } = useContext(Ctx);
  return (key: string, dict: Record<string, Record<DemoLang, string>>): string => {
    const entry = dict[key];
    if (!entry) return key;
    return entry[lang] ?? entry.tr ?? key;
  };
}
