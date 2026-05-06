import { useCallback, type ReactNode } from "react";
import { useLang } from "@/lib/lang";

export type DemoLang = "en" | "ar";

interface DemoLangContextValue {
  lang: DemoLang;
  setLang: (l: DemoLang) => void;
}

/**
 * The CFO Benefits Cockpit speaks EN + AR only, but the marketplace
 * scenarios it sits next to (e.g. /demo/value-realization/teknik) all
 * read from the workspace-wide `useLang()` (`maven-ai-lang` in
 * localStorage). To round-trip language across the switch-view button,
 * this provider intentionally delegates to that global store. The
 * provider stays so consumers keep a single import surface and so a
 * future EN/AR-only consumer doesn't have to refactor.
 */
export function DemoLangProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useDemoLang(): DemoLangContextValue {
  const { lang: globalLang, setLang: setGlobalLang } = useLang();
  // Cockpit dictionaries are EN/AR only; "tr" (Turkish, used by the
  // Arçelik demo) collapses to EN here so the rest of the cockpit still
  // renders sensibly if the user lands here from a Turkish session.
  const lang: DemoLang = globalLang === "ar" ? "ar" : "en";
  const setLang = useCallback((l: DemoLang) => setGlobalLang(l), [setGlobalLang]);
  return { lang, setLang };
}

import type { BiText } from "@/lib/sim/types";

export function tBi(b: BiText | undefined, lang: DemoLang): string {
  if (!b) return "";
  return (b[lang] ?? b.en) || "";
}
