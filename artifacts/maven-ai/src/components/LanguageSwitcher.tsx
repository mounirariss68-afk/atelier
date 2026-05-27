import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useLang, type Lang } from "@/lib/lang";

const OPTIONS: { value: Lang; abbr: string; label: string }[] = [
  { value: "en", abbr: "EN", label: "English" },
  { value: "tr", abbr: "TR", label: "Türkçe" },
  { value: "ar", abbr: "ع", label: "العربية" },
];

interface Props {
  variant?: "navbar" | "mobile";
  className?: string;
}

export default function LanguageSwitcher({ variant = "navbar", className = "" }: Props) {
  const { lang, setLang, dir } = useLang();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isMobile = variant === "mobile";
  const active = OPTIONS.find((o) => o.value === lang) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menuAlign = dir === "rtl" ? "left-0" : "right-0";

  return (
    <div ref={wrapRef} className={`relative inline-block ${className}`} data-testid="language-switcher">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Language: ${active.label}`}
        className={`inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-white/10 transition-colors ${
          isMobile ? "border-white/20" : ""
        }`}
        data-testid="language-switcher-trigger"
      >
        <span lang={active.value}>{active.abbr}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.12 }}
            role="listbox"
            aria-label="Language"
            className={`absolute top-full mt-2 ${menuAlign} min-w-[80px] z-50 bg-white rounded-lg shadow-2xl border border-gray-100 overflow-hidden py-1`}
          >
            {OPTIONS.map((o) => {
              const isActive = o.value === lang;
              return (
                <li key={o.value} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    lang={o.value}
                    onClick={() => {
                      setLang(o.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                      isActive
                        ? "bg-[#C45BB8]/10 text-[#0A1230]"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                    data-testid={`button-lang-${o.value}`}
                  >
                    <span>{o.abbr}</span>
                    {isActive && <Check size={12} className="text-[#C45BB8]" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
