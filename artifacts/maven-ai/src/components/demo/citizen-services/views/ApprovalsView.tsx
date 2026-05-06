import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { useCscLang } from "../DemoLangContext";
import { approvals, tDict } from "../citizen-i18n";
import { tt, getCscAgent } from "@/data/citizen-services-seed";
import { CheckCircle2, Edit3, X, Sparkles } from "lucide-react";
import { BRAND, BRAND_MUTED } from "../tokens";
import { useCscToast } from "../ToastContext";

export default function ApprovalsView({ onOpenCase }: { onOpenCase: (id: string) => void }) {
  const { lang } = useCscLang();
  const t = tDict(approvals, lang);
  const { recommendations, resolveRecommendation, resolvedRecommendations } = useCitizenServicesData();
  const { toast } = useCscToast();

  const open = recommendations.filter((r) => !resolvedRecommendations[r.id]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.subtitle}</p>
      </div>

      {open.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <CheckCircle2 size={28} className="mx-auto mb-3" style={{ color: BRAND }} />
          <p className="text-base font-bold text-gray-700">{t.emptyTitle}</p>
          <p className="text-sm text-gray-400 mt-1">{t.emptyBody}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((r) => {
            const agent = getCscAgent(r.agentId);
            return (
              <div key={r.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-50" style={{ background: BRAND_MUTED }}>
                  <Sparkles size={12} style={{ color: BRAND }} />
                  <span className="text-[10px] font-bold uppercase" style={{ color: agent?.color ?? BRAND }}>
                    {agent ? tt(agent.name, lang) : r.agentId}
                  </span>
                  <span className="text-[10px] text-gray-400">·</span>
                  <button onClick={() => onOpenCase(r.recordId)} className="text-[10px] font-bold underline hover:text-[#1F4F3F]" style={{ color: BRAND }}>{r.recordId}</button>
                  <span className="ms-auto text-[10px] font-semibold" style={{ color: BRAND }}>{r.confidence}% {t.confidence}</span>
                </div>
                <div className="p-4">
                  <p className="text-[14px] font-bold text-gray-900 mb-2">{tt(r.title, lang)}</p>
                  <p className="text-[12.5px] text-gray-600 leading-relaxed mb-3">{tt(r.rationale, lang)}</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => { resolveRecommendation(r.id, "approved"); toast(t.approvedToast, "success"); }}
                      className="text-[12px] px-3 py-2 rounded-md text-white font-semibold flex items-center gap-1.5" style={{ background: BRAND }}>
                      <CheckCircle2 size={12} /> {tt(r.recommendedAction, lang)}
                    </button>
                    {r.alternateActions.map((a, i) => (
                      <button key={i} onClick={() => { resolveRecommendation(r.id, "edited"); toast(t.editedToast, "info"); }}
                        className="text-[12px] px-3 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                        <Edit3 size={12} /> {tt(a, lang)}
                      </button>
                    ))}
                    <button onClick={() => { resolveRecommendation(r.id, "dismissed"); toast(t.dismissedToast, "warning"); }}
                      className="ms-auto text-[12px] px-3 py-2 rounded-md text-gray-500 hover:bg-gray-50 flex items-center gap-1.5">
                      <X size={12} /> {t.dismiss}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
