import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Inbox, Brain, ChevronDown, ChevronUp, Check, X, Edit3, Filter, History, Sparkles, Clock, ShieldCheck, Wallet, FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTasamaDemoLang, useTasamaDemoT } from "../DemoLangContext";
import { useManagerFilters } from "../TasamaDashboardContext";
import { approvals, shell } from "../tasama-i18n";
import { generatePayrollRecommendations, generateDecisionHistory } from "@/data/tasama-agent";
import type { PayrollRecommendation, Severity, PayrollRole } from "@/data/tasama-seed";

type Tab = "pending" | "decided" | "history";
type LocalDecision = "pending" | "approved" | "rejected" | "modified";

const SEV_BG: Record<Severity, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-gray-100 text-gray-700 border-gray-200",
};

const ROLE_LABEL: Record<PayrollRole, { en: string; ar: string; icon: React.ReactNode }> = {
  "payroll-manager": { en: "Payroll Manager", ar: "مدير الرواتب", icon: <Wallet size={11} /> },
  "finance-controller": { en: "Finance Controller", ar: "المراقب المالي", icon: <FileText size={11} /> },
  "compliance-officer": { en: "Compliance Officer", ar: "مسؤول الامتثال", icon: <ShieldCheck size={11} /> },
};

export default function ApprovalQueueView() {
  const { lang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const { toast } = useToast();
  const isAr = lang === "ar";
  const { filters } = useManagerFilters();

  const [tab, setTab] = useState<Tab>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sevFilter, setSevFilter] = useState<"all" | Severity>("all");
  const [decisions, setDecisions] = useState<Record<string, { kind: LocalDecision; note?: string }>>({});
  const [modifyOpen, setModifyOpen] = useState<string | null>(null);
  const [modifyNote, setModifyNote] = useState("");

  const allRecs = useMemo(() => generatePayrollRecommendations(), []);
  const history = useMemo(() => generateDecisionHistory(), []);

  const recs = useMemo(() => {
    return allRecs.filter((r) => {
      const local = decisions[r.id]?.kind ?? r.status;
      if (tab === "pending" && local !== "pending") return false;
      if (tab === "decided" && local === "pending") return false;
      if (sevFilter !== "all" && r.severity !== sevFilter) return false;
      if (filters.role !== "all" && r.targetRole !== filters.role) return false;
      return true;
    });
  }, [allRecs, decisions, tab, sevFilter, filters.role]);

  const handleDecision = (rec: PayrollRecommendation, kind: "approved" | "rejected" | "modified", note?: string) => {
    setDecisions((prev) => ({ ...prev, [rec.id]: { kind, note } }));
    setExpandedId(null);
    setModifyOpen(null);
    setModifyNote("");
    const messageKey = kind === "approved" ? "toastApproved" : kind === "rejected" ? "toastRejected" : "toastModified";
    toast({ title: t(messageKey, approvals), description: rec.title });
  };

  const timeLabel = (iso: string) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}${t("minAgo", approvals)}`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}${t("hrAgo", approvals)}`;
    return `${Math.round(hrs / 24)}${t("dayAgo", approvals)}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Inbox size={20} className="text-[#0F766E]" />
          {t("title", approvals)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", approvals)}</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex bg-gray-100 rounded-xl p-1">
          {([
            ["pending", "pendingTab", <Inbox size={12} key="i" />],
            ["decided", "decidedTab", <Check size={12} key="c" />],
            ["history", "historyTab", <History size={12} key="h" />],
          ] as const).map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                tab === key ? "bg-white text-[#0F766E] shadow-sm" : "text-gray-600"
              }`}
            >
              {icon} {t(label, approvals)}
              {key === "pending" && (
                <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                  {allRecs.filter((r) => (decisions[r.id]?.kind ?? r.status) === "pending").length}
                </span>
              )}
            </button>
          ))}
        </div>
        {tab !== "history" && (
          <div className="flex items-center gap-2">
            <Filter size={12} className="text-gray-400" />
            <select
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value as typeof sevFilter)}
              className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-medium"
            >
              <option value="all">{t("filterAll", approvals)} {t("filterPriority", approvals)}</option>
              <option value="critical">{t("sevCritical", shell)}</option>
              <option value="high">{t("sevHigh", shell)}</option>
              <option value="medium">{t("sevMedium", shell)}</option>
              <option value="low">{t("sevLow", shell)}</option>
            </select>
          </div>
        )}
      </div>

      {/* Recommendation cards / history */}
      {tab !== "history" ? (
        <div className="space-y-3">
          {recs.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-500">
              {t("noPending", approvals)}
            </div>
          )}
          {recs.map((rec) => {
            const expanded = expandedId === rec.id;
            const local = decisions[rec.id]?.kind ?? rec.status;
            const role = ROLE_LABEL[rec.targetRole];
            return (
              <motion.div
                key={rec.id}
                layout
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-2 mb-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEV_BG[rec.severity]}`}>
                          {t(rec.severity === "critical" ? "sevCritical" : rec.severity === "high" ? "sevHigh" : rec.severity === "medium" ? "sevMedium" : "sevLow", shell)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-teal-50 text-[#0F766E] border border-teal-200 font-bold">
                          {role.icon}{role[lang]}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                          <Clock size={10} /> {timeLabel(rec.createdAt)}
                        </span>
                        {local !== "pending" && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            local === "approved" ? "bg-emerald-100 text-emerald-700" :
                            local === "rejected" ? "bg-red-100 text-red-700" :
                            "bg-amber-100 text-amber-700"
                          }`}>
                            {t(local === "approved" ? "statusApproved" : local === "rejected" ? "statusRejected" : "statusModified", approvals)}
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-gray-900">{rec.title}</h3>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">{rec.summary}</p>
                    </div>
                    <div className="text-end flex-shrink-0">
                      <div className="text-2xl font-extrabold text-[#0F766E]">{rec.confidence}%</div>
                      <div className="text-[9px] text-gray-500 uppercase">{t("confidenceLabel", approvals)}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => setExpandedId(expanded ? null : rec.id)}
                    className="mt-3 text-xs text-[#0F766E] font-bold hover:underline flex items-center gap-1"
                  >
                    <Brain size={12} />
                    {expanded ? t("hideAnalysis", approvals) : t("showReasoning", approvals)}
                    {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>

                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-gray-100 bg-gray-50/40 overflow-hidden"
                    >
                      <div className="p-5 space-y-4">
                        {/* Reasoning chain */}
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2 flex items-center gap-1.5">
                            <Brain size={11} />{t("reasoningChain", approvals)}
                          </p>
                          <div className="space-y-2">
                            {rec.reasoning.map((step, i) => (
                              <div key={i} className="bg-white rounded-lg border border-gray-100 p-3">
                                <div className="flex items-start gap-2">
                                  <span className="w-5 h-5 rounded-full bg-[#0F766E] text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">{i + 1}</span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{step.source}</p>
                                    <p className="text-xs text-gray-800 mt-1">{step.observation}</p>
                                    <p className="text-xs text-[#0F766E] mt-1 font-semibold">→ {step.conclusion}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Recommended action */}
                        <div className="bg-gradient-to-r from-[#0F766E]/10 to-[#0D9488]/10 border border-teal-100 rounded-lg p-3">
                          <p className="text-[10px] uppercase tracking-widest font-bold text-[#0F766E] flex items-center gap-1.5">
                            <Sparkles size={11} />{t("recommendedAction", approvals)}
                          </p>
                          <p className="text-xs text-gray-800 mt-1.5">{rec.recommendedAction}</p>
                        </div>

                        {/* Impact */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <Impact label={t("impactCost", approvals)} value={rec.impact.cost} />
                          <Impact label={t("impactCompliance", approvals)} value={rec.impact.compliance} />
                          <Impact label={t("impactSla", approvals)} value={rec.impact.sla} />
                        </div>

                        {/* Alternatives */}
                        {rec.alternatives.length > 0 && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-2">{t("alternatives", approvals)}</p>
                            <ul className="text-xs text-gray-700 space-y-1.5">
                              {rec.alternatives.map((alt, i) => (
                                <li key={i} className="flex items-start gap-1.5"><span className="text-gray-400">•</span>{alt}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Decision note for already-decided recs */}
                        {(rec.decidedBy || decisions[rec.id]?.note) && (
                          <div className="bg-white border border-gray-100 rounded-lg p-3">
                            {rec.decidedBy && (
                              <p className="text-[10px] text-gray-500">
                                <span className="font-bold">{t("decidedBy", approvals)}:</span> {rec.decidedBy}
                              </p>
                            )}
                            {(rec.decisionNote || decisions[rec.id]?.note) && (
                              <p className="text-xs text-gray-700 mt-1">{decisions[rec.id]?.note ?? rec.decisionNote}</p>
                            )}
                          </div>
                        )}

                        {/* Action bar */}
                        {local === "pending" && (
                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                            <button
                              onClick={() => handleDecision(rec, "rejected")}
                              className="px-3 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 flex items-center gap-1.5"
                            >
                              <X size={12} />{t("reject", approvals)}
                            </button>
                            <button
                              onClick={() => { setModifyOpen(rec.id); setModifyNote(""); }}
                              className="px-3 py-1.5 text-xs font-bold text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 flex items-center gap-1.5"
                            >
                              <Edit3 size={12} />{t("modify", approvals)}
                            </button>
                            <button
                              onClick={() => handleDecision(rec, "approved")}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-[#0F766E] rounded-lg hover:bg-[#0D9488] flex items-center gap-1.5"
                            >
                              <Check size={12} />{t("approve", approvals)}
                            </button>
                          </div>
                        )}

                        {/* Modify modal */}
                        {modifyOpen === rec.id && (
                          <motion.div
                            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                            className="bg-amber-50 border border-amber-200 rounded-lg p-3"
                          >
                            <p className="text-[10px] uppercase font-bold tracking-widest text-amber-700">{t("modifyNote", approvals)}</p>
                            <textarea
                              value={modifyNote}
                              onChange={(e) => setModifyNote(e.target.value)}
                              rows={3}
                              className="w-full mt-2 px-3 py-2 text-xs border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300/50 resize-none"
                              placeholder={isAr ? "أضف ملاحظة التعديل…" : "Add a modification note…"}
                            />
                            <div className="flex items-center justify-end gap-2 mt-2">
                              <button onClick={() => { setModifyOpen(null); setModifyNote(""); }} className="text-xs text-gray-600 px-3 py-1.5 hover:underline">{t("cancel", approvals)}</button>
                              <button
                                onClick={() => modifyNote.trim() && handleDecision(rec, "modified", modifyNote.trim())}
                                disabled={!modifyNote.trim()}
                                className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-40"
                              >
                                {t("approveWithMod", approvals)}
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
          {history.map((d) => (
            <div key={d.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      d.decisionType === "approved" ? "bg-emerald-100 text-emerald-700" :
                      d.decisionType === "rejected" ? "bg-red-100 text-red-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>{t(d.decisionType === "approved" ? "statusApproved" : d.decisionType === "rejected" ? "statusRejected" : "statusModified", approvals)}</span>
                    <span className="text-[10px] text-gray-500">{ROLE_LABEL[d.role][lang]}</span>
                    <span className="text-[10px] text-gray-400">{new Date(d.timestamp).toLocaleDateString(isAr ? "ar-SA" : "en-US")}</span>
                  </div>
                  <h4 className="text-sm font-bold text-gray-900 mt-1.5">{d.recommendationTitle}</h4>
                  <p className="text-xs text-gray-600 mt-1">
                    <span className="font-bold">{t("rationaleLabel", approvals)}:</span> {d.rationale}
                  </p>
                  {d.modificationNote && (
                    <p className="text-xs text-amber-700 mt-1">
                      <span className="font-bold">{t("modify", approvals)}:</span> {d.modificationNote}
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Outcome label={t("outcomeCost", approvals)} value={d.simulatedOutcome.cost} />
                    <Outcome label={t("outcomeCompliance", approvals)} value={d.simulatedOutcome.compliance} />
                    <Outcome label={t("outcomeSla", approvals)} value={d.simulatedOutcome.sla} />
                    <Outcome label={t("outcomeTimeframe", approvals)} value={d.simulatedOutcome.timeframe} />
                  </div>
                </div>
                <div className="text-end flex-shrink-0">
                  <p className="text-[10px] text-gray-500">{t("decidedBy", approvals)}</p>
                  <p className="text-xs font-bold text-gray-900">{d.decidedBy}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Impact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{label}</p>
      <p className="text-xs text-gray-800 mt-1">{value}</p>
    </div>
  );
}

function Outcome({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-md px-3 py-2">
      <p className="text-[9px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-[11px] font-semibold text-gray-800 mt-0.5 leading-tight">{value}</p>
    </div>
  );
}
