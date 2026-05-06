import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type DemoLang = "en" | "ar";
const KEY = "csc-demo-lang";

function read(): DemoLang {
  try { return (sessionStorage.getItem(KEY) === "ar" ? "ar" : "en"); } catch { return "en"; }
}

const Ctx = createContext<{ lang: DemoLang; setLang: (l: DemoLang) => void }>({ lang: "en", setLang: () => {} });

export function CscDemoLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<DemoLang>(read);
  const setLang = useCallback((l: DemoLang) => {
    setLangState(l);
    try { sessionStorage.setItem(KEY, l); } catch {}
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useCscLang() { return useContext(Ctx); }
