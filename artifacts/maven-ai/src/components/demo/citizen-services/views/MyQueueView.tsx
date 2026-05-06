import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { useCscLang } from "../DemoLangContext";
import { queue, tDict } from "../citizen-i18n";
import { tt, getCitizen, getService, getMinistry } from "@/data/citizen-services-seed";
import { BRAND, BRAND_MUTED, SEVERITY } from "../tokens";
import { Sparkles, AlertTriangle, ArrowRight, CheckCircle2, Edit3, X } from "lucide-react";
import { useCscToast } from "../ToastContext";

export default function MyQueueView({ onOpenCase }: { onOpenCase: (id: string) => void }) {
  const { lang } = useCscLang();
  const t = tDict(queue, lang);
  const { cases, recommendations, resolveRecommendation, resolvedRecommendations } = useCitizenServicesData();
  const { toast } = useCscToast();

  const sorted = [...cases].sort((a, b) => Date.parse(a.slaDueAt) - Date.parse(b.slaDueAt));
  const breaching = sorted.slice(0, 3);

  const PRIORITY: Record<string, string> = { critical: SEVERITY.critical, high: SEVERITY.high, medium: SEVERITY.medium, low: "#9CA3AF" };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.subtitle}</p>
      </div>

      {/* Breach rail */}
      <div className="bg-white rounded-xl border border-amber-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={14} className="text-amber-500" />
          <p className="text-xs font-bold text-gray-700">{t.rail_title}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {breaching.map((c) => {
            const cit = getCitizen(c.citizenId);
            const svc = getService(c.serviceId);
            const hLeft = Math.max(0, Math.round((Date.parse(c.slaDueAt) - Date.now()) / 3_600_000));
            return (
              <button key={c.id} onClick={() => onOpenCase(c.id)} className="text-start p-3 rounded-lg border border-gray-100 hover:border-[#5BA98A]/40 hover:bg-emerald-50/40 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-gray-400">{c.id}</span>
                  <span className="text-[10px] font-semibold text-amber-700">{hLeft} {t.hoursLeft}</span>
                </div>
                <p className="text-[12px] font-semibold text-gray-800 truncate">{svc ? tt(svc.name, lang) : c.serviceId}</p>
                <p className="text-[11px] text-gray-500 truncate">{cit ? tt(cit.name, lang) : ""}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recommendations rail */}
      <div className="bg-white rounded-xl border border-emerald-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} style={{ color: BRAND }} />
          <p className="text-xs font-bold text-gray-700">{t.recs_title}</p>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {recommendations.filter((r) => !resolvedRecommendations[r.id]).slice(0, 4).map((r) => (
            <div key={r.id} className="p-3 rounded-lg border border-gray-100" style={{ background: BRAND_MUTED }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-gray-500">{r.recordId}</span>
                <span className="text-[10px] font-semibold" style={{ color: BRAND }}>{r.confidence}% {lang === "en" ? "confidence" : "ثقة"}</span>
              </div>
              <p className="text-[12.5px] font-semibold text-gray-800 mb-1.5">{tt(r.title, lang)}</p>
              <p className="text-[11px] text-gray-600 mb-3 leading-relaxed">{tt(r.rationale, lang)}</p>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => { resolveRecommendation(r.id, "approved"); toast(lang === "en" ? "Approved." : "تم الاعتماد.", "success"); }}
                  className="text-[11px] px-3 py-1.5 rounded-md text-white font-semibold flex items-center gap-1" style={{ background: BRAND }}>
                  <CheckCircle2 size={11} /> {tt(r.recommendedAction, lang)}
                </button>
                <button onClick={() => { resolveRecommendation(r.id, "edited"); toast(lang === "en" ? "Sent to edit queue." : "أُرسلت للتعديل.", "info"); }}
                  className="text-[11px] px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-white flex items-center gap-1">
                  <Edit3 size={11} /> {lang === "en" ? "Edit" : "تعديل"}
                </button>
                <button onClick={() => { resolveRecommendation(r.id, "dismissed"); toast(lang === "en" ? "Dismissed." : "تم التجاهل.", "warning"); }}
                  className="text-[11px] px-3 py-1.5 rounded-md text-gray-500 hover:bg-white flex items-center gap-1">
                  <X size={11} /> {lang === "en" ? "Dismiss" : "تجاهل"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Queue table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50 text-[10.5px] uppercase tracking-wide text-gray-500 font-semibold">
              <tr>
                <th className="text-start px-4 py-2.5">{t.citizen}</th>
                <th className="text-start px-4 py-2.5">{t.service}</th>
                <th className="text-start px-4 py-2.5">{t.next}</th>
                <th className="text-start px-4 py-2.5">{lang === "en" ? "Ministries" : "الجهات"}</th>
                <th className="text-start px-4 py-2.5">{t.sla}</th>
                <th className="text-end px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const cit = getCitizen(c.citizenId);
                const svc = getService(c.serviceId);
                const hLeft = Math.round((Date.parse(c.slaDueAt) - Date.now()) / 3_600_000);
                const slaColor = hLeft < 12 ? SEVERITY.critical : hLeft < 24 ? SEVERITY.high : hLeft < 48 ? SEVERITY.medium : "#10B981";
                return (
                  <tr key={c.id} className="border-t border-gray-50 hover:bg-emerald-50/30 cursor-pointer" onClick={() => onOpenCase(c.id)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: PRIORITY[c.priority] }} />
                        <div>
                          <p className="font-semibold text-gray-800">{cit ? tt(cit.name, lang) : c.citizenId}</p>
                          <p className="text-[10px] text-gray-400">{c.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{svc ? tt(svc.name, lang) : c.serviceId}</td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-md">
                      <div className="flex items-center gap-1.5">
                        {c.preWorkedByAgent && <Sparkles size={11} style={{ color: BRAND }} className="flex-shrink-0" />}
                        <span className="truncate">{tt(c.agentNextStep, lang)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        {c.ministryTouchpoints.map((tp, i) => {
                          const m = getMinistry(tp.ministryId);
                          return <span key={i} className="text-[9.5px] px-1.5 py-0.5 rounded text-white font-semibold" style={{ background: m?.color ?? "#999" }}>{m ? tt(m.short, lang) : tp.ministryId}</span>;
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold" style={{ color: slaColor }}>
                        {hLeft >= 0 ? `${hLeft} ${t.hoursLeft}` : `${-hLeft} ${t.hoursOver}`}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-end">
                      <button className="text-[11px] font-semibold flex items-center gap-1 ml-auto" style={{ color: BRAND }}>
                        {t.open} <ArrowRight size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
