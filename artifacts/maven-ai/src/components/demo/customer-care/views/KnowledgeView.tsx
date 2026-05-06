import { motion } from "framer-motion";
import { Sparkles, Plus, BookOpen } from "lucide-react";
import { useCustomerCareData } from "@/hooks/useCustomerCareData";
import { useCareLang } from "../DemoLangContext";
import { knowledge, tDict } from "../care-i18n";
import { useCareToast } from "../ToastContext";
import { BRAND, ACCENT_AI } from "../tokens";
import { getCareAgentBadge } from "@/data/customer-care-seed";

export default function KnowledgeView() {
  const { lang } = useCareLang();
  const t = tDict(knowledge, lang);
  const data = useCustomerCareData();
  const { toast } = useCareToast();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.sub}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr><Th>{t.colArticle}</Th><Th>{t.colCategory}</Th><Th>{t.colUses}</Th><Th>{t.colCsat}</Th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.kb.map((k, i) => (
                <motion.tr key={k.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                  <Td>
                    <div className="flex items-start gap-2.5">
                      <BookOpen size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-gray-800">{lang === "en" ? k.titleEn : k.titleAr}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1 max-w-md">{lang === "en" ? k.excerptEn : k.excerptAr}</p>
                      </div>
                    </div>
                  </Td>
                  <Td><span className="text-[11px] text-gray-600">{lang === "en" ? k.categoryEn : k.categoryAr}</span></Td>
                  <Td><span className="text-xs font-semibold">{k.uses7d}</span></Td>
                  <Td><span className={`text-xs font-bold ${k.csat >= 4.4 ? "text-emerald-700" : k.csat >= 4.0 ? "text-amber-700" : "text-red-700"}`}>{k.csat.toFixed(1)} ★</span></Td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2" style={{ background: ACCENT_AI + "08" }}>
          <Sparkles size={14} style={{ color: ACCENT_AI }} />
          <h2 className="text-sm font-bold">{t.suggestedTitle}</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {data.kbSuggestions.map((s, i) => {
            const badge = getCareAgentBadge(s.agentId, lang);
            return (
              <motion.div key={s.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="px-4 py-3 flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[280px]">
                  <p className="text-sm font-bold text-gray-800">{lang === "en" ? s.titleEn : s.titleAr}</p>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    <span className="font-semibold text-gray-600 me-1">{t.suggestedReason}:</span>
                    {lang === "en" ? s.reasonEn : s.reasonAr}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: badge.color + "18", color: badge.color }}>{badge.name}</span>
                    <span className="text-[10px] text-gray-400">· {s.fromCount} {t.suggestedFromCount}</span>
                  </div>
                </div>
                <button onClick={() => toast(t.draftToast, "success")} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: BRAND }}>
                  <Plus size={11} /> {t.addBtn}
                </button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) { return <th className="px-3 py-2 text-start font-bold">{children}</th>; }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-3 py-2.5 align-top">{children}</td>; }
