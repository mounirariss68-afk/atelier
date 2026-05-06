import { useLang, type Lang } from "@/lib/lang";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "ar", label: "العربية" },
  { value: "tr", label: "TR" },
];

interface Props {
  variant?: "navbar" | "mobile";
  className?: string;
}

export default function LanguageSwitcher({ variant = "navbar", className = "" }: Props) {
  const { lang, setLang } = useLang();
  const isMobile = variant === "mobile";
  return (
    <div
      role="group"
      aria-label="Language"
      className={`inline-flex items-center rounded-full border ${
        isMobile ? "border-white/20 bg-white/5 p-0.5" : "border-white/15 bg-white/5 p-0.5"
      } ${className}`}
      data-testid="language-switcher"
    >
      {OPTIONS.map((o) => {
        const active = lang === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setLang(o.value)}
            aria-pressed={active}
            lang={o.value}
            className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-full transition-colors ${
              active
                ? "bg-[#F5A623] text-[#0E2841]"
                : "text-gray-300 hover:text-white"
            }`}
            data-testid={`button-lang-${o.value}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
