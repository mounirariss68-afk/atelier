import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DemoLang = "en" | "ar";
const STORAGE_KEY = "sama-compliance-demo-lang";

function readStored(): DemoLang {
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

export function SamaDemoLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<DemoLang>(readStored);
  const setLang = useCallback((l: DemoLang) => {
    setLangState(l);
    try { sessionStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useSamaDemoLang() {
  return useContext(Ctx);
}
