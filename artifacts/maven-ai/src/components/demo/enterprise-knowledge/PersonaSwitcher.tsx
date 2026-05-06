import { useState } from "react";
import { ChevronDown, Check, ShieldCheck } from "lucide-react";
import { useEkcLang, useEkcT } from "./DemoLangContext";
import { useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { personaSwitcher } from "./knowledge-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import { visibleSourcesFor, type PersonaId } from "@/data/enterprise-knowledge-seed";

export default function PersonaSwitcher() {
  const { lang } = useEkcLang();
  const t = useEkcT();
  const { personas, personaId, setPersonaId } = useEkcData();
  const [open, setOpen] = useState(false);
  const current = personas.find((p) => p.id === personaId)!;
  const currentVisible = visibleSourcesFor(personaId).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-3 rounded-2xl border border-gray-200 hover:border-gray-300 bg-white text-start"
      >
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0"
          style={{ background: BRAND }}
        >
          {current.initials[lang]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase text-gray-500">{t("title", personaSwitcher)}</p>
          <p className="text-[13px] font-bold truncate" style={{ color: BRAND_INK }}>{current.name[lang]}</p>
          <p className="text-[11px] text-gray-500 truncate">{current.role[lang]}</p>
        </div>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <div className="mt-2 flex items-center gap-2 px-2">
        <ShieldCheck size={12} style={{ color: BRAND }} />
        <span className="text-[11px] font-semibold" style={{ color: BRAND_INK }}>
          {currentVisible} / 24 {t("visibleSources", personaSwitcher)}
        </span>
      </div>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden">
          {personas.map((p) => {
            const visible = visibleSourcesFor(p.id).length;
            const active = p.id === personaId;
            return (
              <button
                key={p.id}
                onClick={() => { setPersonaId(p.id as PersonaId); setOpen(false); }}
                className={`w-full flex items-center gap-3 p-3 text-start hover:bg-gray-50 ${active ? "bg-gray-50" : ""}`}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                  style={{ background: active ? BRAND : "#94A3B8" }}
                >
                  {p.initials[lang]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold truncate" style={{ color: BRAND_INK }}>{p.name[lang]}</p>
                  <p className="text-[11px] text-gray-500 truncate">{p.role[lang]}</p>
                  <p className="text-[10px] font-semibold mt-0.5" style={{ color: BRAND }}>
                    {visible} / 24 {t("visibleSources", personaSwitcher)}
                  </p>
                </div>
                {active && <Check size={14} style={{ color: BRAND }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
