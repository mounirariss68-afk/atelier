import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Inbox, Check, X, Edit3, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateRecommendations, type Severity } from "@/data/sama-compliance-agent";
import { useSamaDemoLang } from "../DemoLangContext";
import { approvals, useTrFactory } from "../sama-i18n";
import { BRAND, BRAND_INK } from "../tokens";

const SEV_BG: Record<Severity, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  info: "bg-gray-100 text-gray-700",
};

type Decision = "approved" | "rejected" | "edited";

export default function ApprovalsView() {
  const { lang } = useSamaDemoLang();
  const t = useTrFactory(lang);
  const isAr = lang === "ar";
  const { toast } = useToast();

  const recs = useMemo(() => generateRecommendations(), []);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [expanded, setExpanded] = useState<string | null>(recs[0]?.id ?? null);
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const [sev, setSev] = useState<"all" | Severity>("all");
  const [editOpen, setEditOpen] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");

  const visible = recs.filter((r) => {
    const decided = !!decisions[r.id];
    if (tab === "pending" && decided) return false;
    if (tab === "resolved" && !decided) return false;
    if (sev !== "all" && r.severity !== sev) return false;
    return true;
  });

  const decide = (id: string, kind: Decision) => {
    setDecisions((prev) => ({ ...prev, [id]: kind }));
    setExpanded(null);
    setEditOpen(null);
    setEditNote("");
    const labelKey = kind === "approved" ? "toastApproved" : kind === "rejected" ? "toastRejected" : "toastEdited";
    const r = recs.find((x) => x.id === id);
    toast({ title: t(labelKey, approvals), description: r ? (r.title[lang] ?? r.title.en) : "" });
  };

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: BRAND_INK }}>
          <Inbox size={18} style={{ color: BRAND }} />
          {t("title", approvals)}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", approvals)}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-3 flex flex-wrap items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(["pending", "resolved"] as const).map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold ${tab === tb ? "bg-white shadow-sm" : "text-gray-500"}`}
              style={tab === tb ? { color: BRAND_INK } : undefined}
            >
              {tb === "pending" ? `${t("pending", approvals)} (${recs.filter((r) => !decisions[r.id]).length})` : `${t("resolved", approvals)} (${Object.keys(decisions).length})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-gray-500">{t("bySev", approvals)}:</span>
          <select value={sev} onChange={(e) => setSev(e.target.value as typeof sev)} className="border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700">
            <option value="all">{t("all", approvals)}</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {visible.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
            <p className="text-sm text-gray-500">{t("noPending", approvals)}</p>
          </div>
        )}
        {visible.map((r) => {
          const open = expanded === r.id;
          const d = decisions[r.id];
          return (
            <motion.div key={r.id} layout className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <button onClick={() => setExpanded(open ? null : r.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${SEV_BG[r.severity]}`}>{r.severity.toUpperCase()}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: BRAND_INK }}>{r.title[lang] ?? r.title.en}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1"><Sparkles size={10} style={{ color: r.agentColor }} />{r.agentName[lang] ?? r.agentName.en}</span>
                    <span>·</span>
                    <span>{r.confidence}% {isAr ? "ثقة" : "confidence"}</span>
                    <span>·</span>
                    <span className="font-mono">{r.recordId}</span>
                  </p>
                </div>
                {d ? (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${d === "approved" ? "bg-emerald-100 text-emerald-700" : d === "rejected" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>{d.toUpperCase()}</span>
                ) : (
                  open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />
                )}
              </button>
              <AnimatePresence>
                {open && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
                      <Section label={t("rationale", approvals)} body={r.rationale[lang] ?? r.rationale.en} />
                      <Section label={t("recommendedAction", approvals)} body={r.recommendedAction[lang] ?? r.recommendedAction.en} highlight />
                      {r.alternateActions.length > 0 && (
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">{t("alternatives", approvals)}</p>
                          <ul className="space-y-1">
                            {r.alternateActions.map((a, i) => <li key={i} className="text-xs text-gray-700">• {a[lang] ?? a.en}</li>)}
                          </ul>
                        </div>
                      )}
                      {!d && (
                        <>
                          {editOpen === r.id ? (
                            <div className="space-y-2">
                              <textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder={isAr ? "ملاحظتك…" : "Your edit…"} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 min-h-[64px]" />
                              <div className="flex gap-2">
                                <button onClick={() => decide(r.id, "edited")} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: BRAND }}>{t("edit", approvals)} & {t("approve", approvals)}</button>
                                <button onClick={() => { setEditOpen(null); setEditNote(""); }} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => decide(r.id, "approved")} className="flex-1 py-2 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1" style={{ background: BRAND }}>
                                <Check size={12} />{t("approve", approvals)}
                              </button>
                              <button onClick={() => setEditOpen(r.id)} className="flex-1 py-2 rounded-lg text-xs font-bold border border-gray-200 hover:border-amber-300 flex items-center justify-center gap-1">
                                <Edit3 size={12} />{t("edit", approvals)}
                              </button>
                              <button onClick={() => decide(r.id, "rejected")} className="flex-1 py-2 rounded-lg text-xs font-bold border border-gray-200 hover:border-red-300 text-red-600 flex items-center justify-center gap-1">
                                <X size={12} />{t("reject", approvals)}
                              </button>
                            </div>
                          )}
                        </>
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

function Section({ label, body, highlight }: { label: string; body: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">{label}</p>
      <p className={`text-xs leading-relaxed ${highlight ? "font-semibold" : ""}`} style={highlight ? { color: BRAND_INK } : undefined}>{body}</p>
    </div>
  );
}
