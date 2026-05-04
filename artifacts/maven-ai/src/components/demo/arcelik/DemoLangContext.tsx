import { createContext, useContext, useState, type ReactNode } from "react";

export type DemoLang = "tr" | "en";

interface DemoLangContextValue {
  lang: DemoLang;
  setLang: (l: DemoLang) => void;
}

const Ctx = createContext<DemoLangContextValue>({ lang: "tr", setLang: () => {} });

export function DemoLangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<DemoLang>("tr");
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
