import { useMemo, useState } from "react";
import { History, Bot, User as UserIcon } from "lucide-react";
import { useSamaComplianceData } from "@/hooks/useSamaComplianceData";
import { relativeTime, type AuditEvent } from "@/data/sama-compliance-seed";
import { useSamaDemoLang } from "../DemoLangContext";
import { audit, useTrFactory } from "../sama-i18n";
import { BRAND, BRAND_INK } from "../tokens";

const CATEGORIES: AuditEvent["category"][] = ["ingest", "map", "draft", "evidence", "approve", "override", "file", "system"];

const CATEGORY_BG: Record<AuditEvent["category"], string> = {
  ingest: "bg-indigo-100 text-indigo-700",
  map: "bg-blue-100 text-blue-700",
  draft: "bg-purple-100 text-purple-700",
  evidence: "bg-cyan-100 text-cyan-700",
  approve: "bg-emerald-100 text-emerald-700",
  override: "bg-amber-100 text-amber-700",
  file: "bg-teal-100 text-teal-700",
  system: "bg-gray-100 text-gray-700",
};

export default function AuditLogView() {
  const { auditEvents } = useSamaComplianceData();
  const { lang } = useSamaDemoLang();
  const t = useTrFactory(lang);
  const isAr = lang === "ar";
  const [filter, setFilter] = useState<"all" | AuditEvent["category"]>("all");

  const events = useMemo(() => {
    return auditEvents.filter((e) => filter === "all" || e.category === filter)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [auditEvents, filter]);

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: BRAND_INK }}>
          <History size={18} style={{ color: BRAND }} />
          {t("title", audit)}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", audit)}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-500">{t("filterCategory", audit)}:</span>
        <button onClick={() => setFilter("all")} className={`px-2 py-1 rounded-full text-[11px] font-bold ${filter === "all" ? "text-white" : "bg-gray-100 text-gray-700"}`} style={filter === "all" ? { background: BRAND } : undefined}>{t("all", audit)}</button>
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setFilter(c)} className={`px-2 py-1 rounded-full text-[11px] font-bold ${filter === c ? "text-white" : "bg-gray-100 text-gray-700"}`} style={filter === c ? { background: BRAND } : undefined}>{t(c, audit)}</button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="divide-y divide-gray-100">
          {events.map((e) => {
            const isAgent = !!e.agentId;
            return (
              <div key={e.id} className="px-4 py-3 hover:bg-gray-50 flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white ${isAgent ? "" : "bg-gray-700"}`} style={isAgent ? { background: BRAND } : undefined}>
                  {isAgent ? <Bot size={14} /> : <UserIcon size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${CATEGORY_BG[e.category]}`}>{t(e.category, audit)}</span>
                    <span className="text-[10px] font-bold text-gray-500">{isAgent ? `${t("byAgent", audit)} · ${e.agentId}` : `${t("byHuman", audit)} · ${e.actorName ?? ""} ${e.actorRole ? `(${e.actorRole})` : ""}`}</span>
                    <span className="text-[10px] text-gray-400 ms-auto">{relativeTime(e.timestamp, lang)}</span>
                  </div>
                  <p className="text-xs text-gray-800">{lang === "ar" ? e.detailAr : e.detailEn}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{e.action}{e.obligationId ? ` · ${e.obligationId}` : ""}{e.controlId ? ` · ${e.controlId}` : ""}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
