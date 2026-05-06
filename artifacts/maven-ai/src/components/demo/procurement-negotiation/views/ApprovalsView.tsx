import { useState } from "react";
import { CheckCircle2, XCircle, Edit2 } from "lucide-react";
import { useProcurementDemoLang } from "../DemoLangContext";
import { approvals as t } from "../procurement-i18n";
import { RECOMMENDATIONS, getAgent } from "@/data/procurement-negotiation-agent";
import { BRAND, SEMANTIC } from "../tokens";
import { useToast } from "@/hooks/use-toast";

type Decision = "approved" | "dismissed" | null;

export default function ApprovalsView() {
  const { lang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const { toast } = useToast();
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const setDecision = (id: string, d: Decision) => {
    setDecisions((p) => ({ ...p, [id]: d }));
    toast({
      title: d === "approved" ? t.toastApprovedTitle[lang] : t.toastDismissedTitle[lang],
    });
  };

  const visible = RECOMMENDATIONS.filter((r) => decisions[r.id] !== "dismissed");

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-[#0E2841]">{t.title[lang]}</h1>
        <p className="text-sm text-gray-500 mt-1">{t.subtitle[lang]}</p>
      </header>

      {visible.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-sm text-gray-400">{t.empty[lang]}</div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const agent = getAgent(r.agentId);
            const decision = decisions[r.id];
            const sevTone =
              r.severity === "critical" ? "bg-red-100 text-red-700 border-red-200"
              : r.severity === "high"   ? "bg-orange-100 text-orange-700 border-orange-200"
              : "bg-amber-100 text-amber-700 border-amber-200";
            return (
              <div key={r.id} className="bg-white border-l-[4px] rounded-xl p-5 shadow-sm" style={{ borderLeftColor: agent.color, opacity: decision === "approved" ? 0.6 : 1 }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide" style={{ background: `${agent.color}1A`, color: agent.color }}>{isAr ? agent.nameAr : agent.nameEn}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sevTone}`}>{r.severity}</span>
                  <span className="text-[10px] text-gray-400">·</span>
                  <span className="text-[10px] text-gray-500 font-mono">{r.recordId}</span>
                  <span className="ml-auto text-[10px] font-bold" style={{ color: BRAND }}>{r.confidence}% confidence</span>
                </div>

                <h3 className="text-base font-bold text-[#0E2841]">{isAr ? r.titleAr : r.titleEn}</h3>
                <p className="text-[13px] text-gray-700 mt-2">{isAr ? r.rationaleAr : r.rationaleEn}</p>

                <div className="mt-3 bg-gray-50 rounded-lg p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{isAr ? "الإجراء الموصى" : "Recommended action"}</p>
                  <p className="text-sm font-semibold text-[#0E2841]">{isAr ? r.recommendedActionAr : r.recommendedActionEn}</p>
                </div>

                <details className="mt-2">
                  <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-[#0E2841]">{t.alternate[lang]}</summary>
                  <ul className="mt-1.5 text-[12px] text-gray-600 list-disc list-inside space-y-1">
                    {(isAr ? r.alternateActionsAr : r.alternateActionsEn).map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </details>

                <div className="flex items-center gap-2 mt-4">
                  {decision === "approved" ? (
                    <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: SEMANTIC.good }}>
                      <CheckCircle2 size={14} /> {t.approved[lang]}
                    </span>
                  ) : (
                    <>
                      <button onClick={() => setDecision(r.id, "approved")} className="px-3 py-1.5 rounded-lg text-white text-xs font-bold flex items-center gap-1.5" style={{ background: BRAND }}>
                        <CheckCircle2 size={12} /> {t.approve[lang]}
                      </button>
                      <button className="px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
                        <Edit2 size={12} /> {t.edit[lang]}
                      </button>
                      <button onClick={() => setDecision(r.id, "dismissed")} className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-400 hover:bg-gray-50 flex items-center gap-1.5">
                        <XCircle size={12} /> {t.reject[lang]}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
