import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DemoLang = "en" | "ar";

const STORAGE_KEY = "customer-care-demo-lang";

function readStoredLang(): DemoLang {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "ar") return "ar";
  } catch {}
  return "en";
}

interface CtxValue {
  lang: DemoLang;
  setLang: (l: DemoLang) => void;
}

const Ctx = createContext<CtxValue>({ lang: "en", setLang: () => {} });

export function CareLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<DemoLang>(readStoredLang);
  const setLang = useCallback((l: DemoLang) => {
    setLangState(l);
    try { sessionStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useCareLang() { return useContext(Ctx); }
