import { useProcurementData } from "@/hooks/useProcurementNegotiationData";
import { useProcurementDemoLang } from "../DemoLangContext";
import { events as t, shell as st } from "../procurement-i18n";
import { generateKpis, RECOMMENDATIONS, getAgent } from "@/data/procurement-negotiation-agent";
import { SARm } from "@/data/procurement-negotiation-seed";
import { TrendingUp, TrendingDown, Minus, ChevronRight, Sparkles } from "lucide-react";
import { BRAND, BRAND_MUTED, NAVY, SEMANTIC } from "../tokens";
import type { ViewId } from "../SourcingDesk";

const STAGE_TONE: Record<string, string> = {
  drafting:   "bg-slate-100 text-slate-600 border-slate-200",
  live:       "bg-blue-100 text-blue-700 border-blue-200",
  evaluating: "bg-amber-100 text-amber-700 border-amber-200",
  awarded:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed:     "bg-gray-100 text-gray-500 border-gray-200",
};

export default function EventsView({ onOpenEvent, onApprove }: { onOpenEvent: (id: string) => void; onApprove: () => void }) {
  const { events, persona } = useProcurementData();
  const { lang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const kpis = generateKpis(lang);

  const stageLabel = (s: string) => isAr
    ? ({ drafting: "إعداد", live: "مباشر", evaluating: "قيد التقييم", awarded: "مُرسى", closed: "مغلق" } as Record<string, string>)[s]
    : ({ drafting: "Drafting", live: "Live", evaluating: "Evaluating", awarded: "Awarded", closed: "Closed" } as Record<string, string>)[s];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>{isAr ? persona.roleAr : persona.roleEn}</p>
        <h1 className="text-2xl font-bold text-[#0A1230] mt-1">{isAr ? `أهلاً، ${persona.nameAr}` : `Welcome, ${persona.nameEn}`}</h1>
        <p className="text-sm text-gray-500 mt-1">{st.personaTagline[lang]}</p>
      </header>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const TIcon = k.trend === "up" ? TrendingUp : k.trend === "down" ? TrendingDown : Minus;
          const tColor = k.trend === "up" ? "text-emerald-600" : k.trend === "down" ? "text-red-600" : "text-gray-400";
          return (
            <div key={k.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{isAr ? k.labelAr : k.labelEn}</div>
              <div className="text-2xl font-extrabold text-[#0A1230] mt-1.5">{k.value}</div>
              <div className="flex items-center gap-1 mt-1">
                <TIcon size={11} className={tColor} />
                <span className="text-[11px] text-gray-500">{isAr ? k.subAr : k.subEn}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Agent recommendations strip */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#0A1230] flex items-center gap-2">
            <Sparkles size={14} style={{ color: BRAND }} />
            {t.recsTitle[lang]}
          </h2>
          <button onClick={onApprove} className="text-xs font-semibold hover:underline" style={{ color: BRAND }}>
            {isAr ? "كل التوصيات ←" : "All recommendations →"}
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {RECOMMENDATIONS.slice(0, 2).map((r) => {
            const agent = getAgent(r.agentId);
            return (
              <div key={r.id} className="bg-white border-l-[3px] rounded-xl p-4 shadow-sm" style={{ borderLeftColor: agent.color }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide" style={{ background: `${agent.color}1A`, color: agent.color }}>{isAr ? agent.nameAr : agent.nameEn}</span>
                  <span className="text-[10px] text-gray-400">·</span>
                  <span className="text-[10px] text-gray-500">{r.recordId}</span>
                  <span className="ml-auto text-[10px] font-bold" style={{ color: BRAND }}>{r.confidence}%</span>
                </div>
                <p className="text-sm font-bold text-[#0A1230]">{isAr ? r.titleAr : r.titleEn}</p>
                <p className="text-[12px] text-gray-600 mt-1.5 line-clamp-3">{isAr ? r.rationaleAr : r.rationaleEn}</p>
                <button onClick={onApprove} className="mt-2 text-[11px] font-semibold hover:underline" style={{ color: BRAND }}>
                  {t.open2[lang]} →
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Events table */}
      <section>
        <div className="mb-3">
          <h2 className="text-sm font-bold text-[#0A1230]">{t.title[lang]}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{t.subtitle[lang]}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.refId[lang]}</th>
                <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.category[lang]}</th>
                <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.stage[lang]}</th>
                <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.baseline[lang]}</th>
                <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.achieved[lang]}</th>
                <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.suppliers[lang]}</th>
                <th className={`px-3 py-2.5 ${isAr ? "text-right" : "text-left"} font-semibold`}>{t.close[lang]}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const meetingTarget = e.currentSavingsPct >= e.savingsTargetPct;
                return (
                  <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => onOpenEvent(e.id)}>
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-[#0A1230]">{e.refId}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{isAr ? e.titleAr : e.titleEn}</div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">{isAr ? e.categoryAr : e.categoryEn}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STAGE_TONE[e.stage]}`}>{stageLabel(e.stage)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 font-mono text-[11px]">{SARm(e.baselineSpend)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-[12px]" style={{ color: meetingTarget ? SEMANTIC.good : SEMANTIC.warn }}>{e.currentSavingsPct.toFixed(1)}%</span>
                        <span className="text-[10px] text-gray-400">/ {e.savingsTargetPct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">
                      <span className="font-semibold">{e.suppliersBidding}</span>
                      <span className="text-gray-400">/{e.suppliersInvited}</span>
                      {e.rounds > 0 && <span className="text-[10px] text-gray-400 ms-2">R{e.currentRound}/{e.rounds}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 font-mono text-[11px]">{e.closeDate}</td>
                    <td className="px-3 py-2.5">
                      <ChevronRight size={14} className={`text-gray-400 ${isAr ? "rotate-180" : ""}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
