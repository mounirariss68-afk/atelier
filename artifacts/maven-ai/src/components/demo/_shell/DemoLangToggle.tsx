import { Languages, Globe } from "lucide-react";

type Lang = "en" | "ar";

export interface DemoLangToggleProps {
  lang: Lang;
  setLang: (l: Lang) => void;
  variant?: "sidebar-icon" | "topbar-pill" | "segmented" | "button";
  accent?: string;
  ink?: string;
  /** When true, hide label (collapsed sidebar). Only meaningful for sidebar-icon variant. */
  collapsed?: boolean;
  /** Surface the toggle sits on — switches between dark (navy) and light styling. */
  surface?: "white" | "navy";
}

/** Bilingual EN/AR toggle. Multiple visual variants cover the demos' styles. */
export default function DemoLangToggle({
  lang, setLang, variant = "sidebar-icon", accent = "#5B7CFF", ink = "#0A1230", collapsed = false, surface = "white",
}: DemoLangToggleProps) {
  const flip = () => setLang(lang === "en" ? "ar" : "en");

  if (variant === "sidebar-icon") {
    return (
      <button
        type="button"
        onClick={flip}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
      >
        <Languages size={16} />
        {!collapsed && <span>{lang === "en" ? "العربية" : "English"}</span>}
      </button>
    );
  }
  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={flip}
        className={
          surface === "navy"
            ? "text-[11px] font-bold px-2.5 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 text-white"
            : "text-[11px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1.5"
        }
      >
        {surface !== "navy" && <Globe size={12} />}
        {lang === "en" ? "العربية" : "EN"}
      </button>
    );
  }
  if (variant === "topbar-pill") {
    const onNavy = surface === "navy";
    return (
      <div className={`flex items-center rounded-full p-0.5 ${onNavy ? "bg-white/10" : "bg-gray-100"}`}>
        {(["en", "ar"] as const).map((L) => (
          <button
            key={L}
            type="button"
            onClick={() => setLang(L)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
              lang === L
                ? "bg-white"
                : onNavy ? "text-white/60 hover:text-white" : "text-gray-600 hover:text-gray-800"
            }`}
            style={lang === L ? { color: ink } : undefined}
          >
            {L === "en" ? "EN" : "ع"}
          </button>
        ))}
      </div>
    );
  }
  // segmented
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5 text-[11px] font-bold">
      {(["en", "ar"] as const).map((L) => (
        <button
          key={L}
          type="button"
          onClick={() => setLang(L)}
          className={`px-3 py-1 rounded ${lang === L ? "bg-white shadow-sm" : "text-gray-600"}`}
          style={lang === L ? { color: accent } : undefined}
        >
          {L === "en" ? "EN" : "AR"}
        </button>
      ))}
    </div>
  );
}
