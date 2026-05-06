import { useEffect } from "react";

/**
 * Apply `dir` and `lang` to <html> while a demo shell is mounted, then restore
 * the previous values on unmount. Every user-facing demo needs this so dialogs
 * and portals inherit the demo's reading direction.
 */
export function useDemoRtl(lang: "en" | "ar"): void {
  const isAr = lang === "ar";
  useEffect(() => {
    const html = document.documentElement;
    const prevDir = html.getAttribute("dir");
    const prevLang = html.getAttribute("lang");
    html.setAttribute("dir", isAr ? "rtl" : "ltr");
    html.setAttribute("lang", isAr ? "ar" : "en");
    return () => {
      if (prevDir) html.setAttribute("dir", prevDir);
      else html.removeAttribute("dir");
      if (prevLang) html.setAttribute("lang", prevLang);
      else html.removeAttribute("lang");
    };
  }, [isAr]);
}
