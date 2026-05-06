import { CalendarClock, FileSignature, ChevronRight } from "lucide-react";
import { useSamaComplianceData } from "@/hooks/useSamaComplianceData";
import { formatAed } from "@/data/sama-compliance-seed";
import { useSamaDemoLang } from "../DemoLangContext";
import { returnsView, useTrFactory } from "../sama-i18n";
import { BRAND, BRAND_INK } from "../tokens";

const STATUS_BG: Record<string, string> = {
  filed: "bg-emerald-100 text-emerald-700",
  ready: "bg-blue-100 text-blue-700",
  review: "bg-purple-100 text-purple-700",
  drafting: "bg-amber-100 text-amber-700",
  "not-started": "bg-gray-100 text-gray-700",
};

export default function ReturnsCalendarView({ onNavigate }: { onNavigate?: (page: string, id?: string) => void }) {
  const { returns } = useSamaComplianceData();
  const { lang } = useSamaDemoLang();
  const t = useTrFactory(lang);
  const isAr = lang === "ar";

  const sorted = [...returns].sort((a, b) => a.daysToDue - b.daysToDue);

  return (
    <div className="space-y-6" dir={isAr ? "rtl" : "ltr"}>
      <div>
        <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: BRAND_INK }}>
          <CalendarClock size={18} style={{ color: BRAND }} />
          {t("title", returnsView)}
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("subtitle", returnsView)}</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((r) => {
          const statusKey = r.draftingStatus === "not-started" ? "notStarted" : r.draftingStatus;
          return (
            <div key={r.id} className="bg-white border border-gray-200 rounded-2xl p-4 hover:border-amber-300 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>{r.regulator} · {r.code}</p>
                  <h3 className="text-sm font-bold mt-0.5" style={{ color: BRAND_INK }}>{lang === "ar" ? r.titleAr : r.titleEn}</h3>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${STATUS_BG[r.draftingStatus]}`}>{t(statusKey, returnsView)}</span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between text-gray-600">
                  <span className="font-semibold">{t("due", returnsView)}</span>
                  <span>
                    {r.dueDate}
                    <span className={`ml-2 font-bold ${r.daysToDue < 0 ? "text-red-600" : r.daysToDue <= 7 ? "text-amber-600" : "text-gray-500"}`}>
                      {r.daysToDue < 0 ? `${-r.daysToDue} ${t("daysLate", returnsView)}` : `${r.daysToDue} ${t("daysOut", returnsView)}`}
                    </span>
                  </span>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1 text-gray-600">
                    <span className="font-semibold">{t("agentReadiness", returnsView)}</span>
                    <span className="font-bold" style={{ color: BRAND_INK }}>{r.agentReadiness}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${r.agentReadiness}%`, background: r.agentReadiness >= 90 ? "#10B981" : r.agentReadiness >= 60 ? BRAND : "#E30613" }} />
                  </div>
                </div>
                {r.amountAed != null && (
                  <div className="flex items-center justify-between text-gray-600">
                    <span className="font-semibold">{t("amountSar", returnsView)}</span>
                    <span className="font-bold" style={{ color: BRAND_INK }}>{formatAed(r.amountAed, lang)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-gray-600 pt-1">
                  <span>{r.ownerName}</span>
                  {r.signRequired && (
                    <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                      <FileSignature size={11} />{t("signRequired", returnsView)}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => onNavigate?.("approvals")}
                className="w-full mt-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 border border-gray-200 hover:border-amber-400 hover:bg-amber-50"
              >
                {t("preview", returnsView)} <ChevronRight size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
