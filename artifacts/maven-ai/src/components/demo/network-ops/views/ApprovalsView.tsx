import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Inbox, Check, X, Edit3, ChevronDown, ChevronUp, Brain, Sparkles, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNocDemoLang, useNocDemoT } from "../DemoLangContext";
import { approvals, shell } from "../noc-i18n";
import { INCIDENTS } from "@/data/network-ops-seed";
import { useNetworkOpsData } from "@/hooks/useNetworkOpsData";
import { BRAND, SEV_BG } from "../tokens";

type Decision = "approved" | "rejected" | "modified";

export default function ApprovalsView() {
  const { lang } = useNocDemoLang();
  const t = useNocDemoT();
  const isAr = lang === "ar";
  const { toast } = useToast();
  const { approvals: APPROVALS } = useNetworkOpsData();
  const [decisions, setDecisions] = useState<Record<string, { kind: Decision; note?: string }>>({});
  const [expandedId, setExpandedId] = useState<string | null>(APPROVALS[0]?.id ?? null);
  const [modifyOpen, setModifyOpen] = useState<string | null>(null);
  const [modifyNote, setModifyNote] = useState("");

  const decide = (id: string, kind: Decision, note?: string) => {
    setDecisions((p) => ({ ...p, [id]: { kind, note } }));
    setModifyOpen(null);
    setModifyNote("");
    const key = kind === "approved" ? "toastApproved" : kind === "rejected" ? "toastRejected" : "toastModified";
    toast({ title: t(key, approvals) });
  };

  const minutesAgo = (iso: string) => {
    const m = Math.max(1, Math.round((Date.parse("2026-05-01T14:15:00Z") - Date.parse(iso)) / 60000));
    return `${m}${isAr ? " د" : "m"}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Inbox size={20} style={{ color: BRAND }} />
          {t("title", approvals)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", approvals)}</p>
      </div>

      <div className="space-y-3">
        {APPROVALS.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-500">
            {t("noPending", approvals)}
          </div>
        )}
        {APPROVALS.map((a) => {
          const local = decisions[a.id]?.kind;
          const expanded = expandedId === a.id;
          const inc = INCIDENTS.find((i) => i.id === a.incidentId);
          return (
            <motion.div key={a.id} layout className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${SEV_BG[a.severity]}`}>
                        {t(`sev${a.severity.toUpperCase()}`, shell)}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {t("incident", approvals)} · {a.incidentId}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                        <Clock size={10} />
                        {minutesAgo(a.raisedAt)}
                      </span>
                      {local && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          local === "approved" ? "bg-emerald-100 text-emerald-700" :
                          local === "rejected" ? "bg-red-100 text-red-700" :
                          "bg-amber-100 text-amber-700"
                        }`}>
                          {t(local === "approved" ? "toastApproved" : local === "rejected" ? "toastRejected" : "toastModified", approvals)}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-gray-900">{isAr ? a.title.ar : a.title.en}</h3>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">{isAr ? a.detail.ar : a.detail.en}</p>
                    <p className="text-[10px] text-gray-500 mt-2">
                      <span className="font-bold">{t("raisedBy", approvals)}:</span> {isAr ? a.raisedBy.ar : a.raisedBy.en}
                    </p>
                  </div>
                  <div className="text-end flex-shrink-0">
                    <div className="text-2xl font-extrabold" style={{ color: BRAND }}>{a.confidence}%</div>
                    <div className="text-[9px] text-gray-500 uppercase">{t("confidence", approvals)}</div>
                  </div>
                </div>

                <button
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                  className="mt-3 text-xs font-bold hover:underline flex items-center gap-1"
                  style={{ color: BRAND }}
                >
                  <Brain size={12} />
                  {expanded ? t("hideDetail", approvals) : t("showDetail", approvals)}
                  {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              </div>

              <AnimatePresence>
                {expanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="border-t border-gray-100 bg-gray-50/40 overflow-hidden">
                    <div className="p-5 space-y-4">
                      <div className="rounded-lg p-3" style={{ background: `${BRAND}10`, border: `1px solid ${BRAND}30` }}>
                        <p className="text-[10px] uppercase tracking-widest font-bold flex items-center gap-1.5" style={{ color: BRAND }}>
                          <Sparkles size={11} />{t("recommendation", approvals)}
                        </p>
                        <p className="text-xs text-gray-800 mt-1.5">{isAr ? a.recommendation.ar : a.recommendation.en}</p>
                      </div>

                      {inc && (
                        <div className="bg-white border border-gray-100 rounded-lg p-3">
                          <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{t("incident", approvals)}</p>
                          <p className="text-xs font-bold text-gray-900 mt-1">{isAr ? inc.title.ar : inc.title.en}</p>
                          <p className="text-[11px] text-gray-600 mt-0.5">{inc.affectedCustomers.toLocaleString(isAr ? "ar-SA" : "en-US")} {isAr ? "عميل متأثّر" : "customers impacted"}</p>
                        </div>
                      )}

                      {!local && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                          <button onClick={() => decide(a.id, "rejected")} className="px-3 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 flex items-center gap-1.5">
                            <X size={12} />{t("reject", approvals)}
                          </button>
                          <button onClick={() => { setModifyOpen(a.id); setModifyNote(""); }} className="px-3 py-1.5 text-xs font-bold text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 flex items-center gap-1.5">
                            <Edit3 size={12} />{t("modify", approvals)}
                          </button>
                          <button onClick={() => decide(a.id, "approved")} className="px-3 py-1.5 text-xs font-bold text-white rounded-lg flex items-center gap-1.5" style={{ background: BRAND }}>
                            <Check size={12} />{t("approve", approvals)}
                          </button>
                        </div>
                      )}

                      {modifyOpen === a.id && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                          <p className="text-[10px] uppercase font-bold tracking-widest text-amber-700">{t("modify", approvals)}</p>
                          <textarea
                            value={modifyNote}
                            onChange={(e) => setModifyNote(e.target.value)}
                            rows={3}
                            className="w-full mt-2 px-3 py-2 text-xs border border-amber-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300/50 resize-none"
                            placeholder={isAr ? "أضف ملاحظة التعديل…" : "Add a modification note…"}
                          />
                          <div className="flex items-center justify-end gap-2 mt-2">
                            <button onClick={() => { setModifyOpen(null); setModifyNote(""); }} className="text-xs text-gray-600 px-3 py-1.5 hover:underline">{isAr ? "إلغاء" : "Cancel"}</button>
                            <button onClick={() => modifyNote.trim() && decide(a.id, "modified", modifyNote.trim())} disabled={!modifyNote.trim()} className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-40">
                              {t("approve", approvals)}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
