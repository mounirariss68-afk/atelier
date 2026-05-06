import { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, Edit3, ShieldCheck, Sparkles } from "lucide-react";
import { useCareLang } from "../DemoLangContext";
import { approvals, tDict } from "../care-i18n";
import { useCareToast } from "../ToastContext";
import { BRAND } from "../tokens";
import { getCheckpoints, getRecommendations } from "@/data/customer-care-agent";
import { getCareAgentBadge, tBi } from "@/data/customer-care-seed";

const SEVERITY_TONE: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  medium: "bg-blue-50 text-blue-700 border-blue-200",
  info: "bg-gray-50 text-gray-700 border-gray-200",
};

export default function ApprovalsView() {
  const { lang } = useCareLang();
  const t = tDict(approvals, lang);
  const { toast } = useCareToast();
  const checkpoints = getCheckpoints();
  const recs = getRecommendations();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [approved, setApproved] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.sub}</p>
      </div>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
          <ShieldCheck size={13} className="text-emerald-700" /> {t.sectionCheckpoints}
        </h2>
        <div className="space-y-3">
          {checkpoints.map((cp, i) => {
            const badge = getCareAgentBadge(cp.agentId, lang);
            const isApproved = approved.has(cp.id);
            const isDismissed = dismissed.has(cp.id);
            return (
              <motion.div key={cp.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${isApproved ? "border-emerald-200" : isDismissed ? "border-gray-200 opacity-60" : "border-gray-100"}`}>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${SEVERITY_TONE[cp.severity]}`}>{cp.severity}</span>
                  <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: badge.color + "18", color: badge.color }}>{badge.name}</span>
                  <span className="text-[10px] text-gray-400">{cp.confidence}% {t.confidenceLabel}</span>
                  {cp.fromCockpit && <span className="text-[10px] text-emerald-700 font-semibold">· cockpit checkpoint</span>}
                  {cp.conversationId && <span className="ms-auto text-[10px] font-mono text-gray-400">{cp.conversationId}</span>}
                </div>
                <div className="px-4 py-3.5 space-y-2.5">
                  <p className="text-sm font-bold text-gray-800">{tBi(cp.question, lang)}</p>
                  <p className="text-[12px] text-gray-600 leading-relaxed">{tBi(cp.rationale, lang)}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {cp.options.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setApproved((s) => new Set(s).add(cp.id));
                          toast(t.approvedToast, "success");
                        }}
                        disabled={isApproved || isDismissed}
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${opt.recommended ? "text-white" : "border border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                        style={opt.recommended ? { background: BRAND } : {}}
                      >
                        {opt.recommended && <Sparkles size={11} />}
                        {tBi(opt.label, lang)}
                        {opt.recommended && <span className="text-[9px] opacity-80">· {t.recommendedTag}</span>}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setDismissed((s) => new Set(s).add(cp.id));
                        toast(t.dismissedToast, "info");
                      }}
                      disabled={isApproved || isDismissed}
                      className="inline-flex items-center gap-1.5 text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                    >
                      <X size={11} /> {t.dismiss}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">{t.sectionRecommendations}</h2>
        <div className="space-y-2.5">
          {recs.map((r, i) => {
            const badge = getCareAgentBadge(r.agentId, lang);
            const isApproved = approved.has(r.id);
            const isDismissed = dismissed.has(r.id);
            return (
              <motion.div key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }} className={`bg-white rounded-xl border shadow-sm px-4 py-3 ${isApproved ? "border-emerald-200" : isDismissed ? "border-gray-200 opacity-60" : "border-gray-100"}`}>
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[260px]">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${SEVERITY_TONE[r.severity]}`}>{r.severity}</span>
                      <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: badge.color + "18", color: badge.color }}>{badge.name}</span>
                      <span className="text-[10px] text-gray-400">{r.confidence}% {t.confidenceLabel}</span>
                      <span className="text-[10px] font-mono text-gray-400">· {r.recordId}</span>
                    </div>
                    <p className="text-[13px] font-bold text-gray-800">{tBi(r.title, lang)}</p>
                    <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{tBi(r.rationale, lang)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => { setApproved((s) => new Set(s).add(r.id)); toast(t.approvedToast, "success"); }}
                      disabled={isApproved || isDismissed}
                      className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                      style={{ background: BRAND }}
                    >
                      <Check size={11} /> {tBi(r.recommendedAction, lang)}
                    </button>
                    <button onClick={() => { setApproved((s) => new Set(s).add(r.id)); toast(t.approvedToast, "info"); }} disabled={isApproved || isDismissed} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
                      <Edit3 size={11} /> {t.edit}
                    </button>
                    <button onClick={() => { setDismissed((s) => new Set(s).add(r.id)); toast(t.dismissedToast, "info"); }} disabled={isApproved || isDismissed} className="text-xs text-gray-400 hover:text-gray-600">
                      {t.dismiss}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
