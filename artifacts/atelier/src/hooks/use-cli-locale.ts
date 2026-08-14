// Task #1061 — the CLI locale toggle IS the user's language preference in
// the web app (Atelier has no global i18n yet). This hook lets regular
// pages (e.g. the Account brief callout) follow that preference and react
// live when it changes — the CommandBar dispatches "atelier-cli-locale"
// on toggle, and cross-tab changes arrive via the storage event.

import { useEffect, useState } from "react";
import type { CliLocale } from "@/components/cli/types";

export const CLI_LOCALE_STORAGE_KEY = "atelier-cli-locale";
export const CLI_LOCALE_EVENT = "atelier-cli-locale";

export function readCliLocalePreference(): CliLocale {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(CLI_LOCALE_STORAGE_KEY) === "ar" ? "ar" : "en";
}

export function useCliLocalePreference(): CliLocale {
  const [locale, setLocale] = useState<CliLocale>(readCliLocalePreference);
  useEffect(() => {
    const update = () => setLocale(readCliLocalePreference());
    window.addEventListener("storage", update);
    window.addEventListener(CLI_LOCALE_EVENT, update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener(CLI_LOCALE_EVENT, update);
    };
  }, []);
  return locale;
}
