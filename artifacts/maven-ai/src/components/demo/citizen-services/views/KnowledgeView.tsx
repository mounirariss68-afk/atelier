import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { useCscLang } from "../DemoLangContext";
import { knowledgeI, tDict } from "../citizen-i18n";
import { tt, getService } from "@/data/citizen-services-seed";
import { BookOpen, FileCheck2, Scale, ListChecks } from "lucide-react";
import { BRAND, NAVY } from "../tokens";

const ICONS = { charter: Scale, sop: FileCheck2, policy: BookOpen, checklist: ListChecks };

export default function KnowledgeView() {
  const { lang } = useCscLang();
  const t = tDict(knowledgeI, lang);
  const { knowledge } = useCitizenServicesData();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.subtitle}</p>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {knowledge.map((k) => {
          const Icon = ICONS[k.type];
          return (
            <div key={k.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BRAND, color: "white" }}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-gray-900 truncate">{tt(k.title, lang)}</p>
                  <p className="text-[10px] text-gray-400">{t.source}: {tt(k.source, lang)}</p>
                </div>
                <span className="text-[10px] font-semibold" style={{ color: NAVY }}>{k.citations} {t.citations}</span>
              </div>
              <p className="text-[12px] text-gray-600 leading-relaxed mb-2">{tt(k.excerpt, lang)}</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[9.5px] uppercase font-bold tracking-wide text-gray-400 me-1">{t.relevantTo}:</span>
                {k.relevantTo.slice(0, 4).map((sid) => {
                  const s = getService(sid);
                  return s ? <span key={sid} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-[#1F4F3F] font-semibold">{tt(s.name, lang)}</span> : null;
                })}
                {k.relevantTo.length > 4 && <span className="text-[10px] text-gray-400">+{k.relevantTo.length - 4}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
