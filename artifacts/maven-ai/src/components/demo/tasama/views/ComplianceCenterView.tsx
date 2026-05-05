import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, CheckCircle2, AlertTriangle, Clock, X, ChevronDown, CalendarRange, Layers } from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang, useTasamaDemoT } from "../DemoLangContext";
import { useManagerFilters } from "../TasamaDashboardContext";
import { compliance } from "../tasama-i18n";
import { getCalendarEventName, getMonthName } from "@/data/tasama-seed";
import type { RegulatoryCalendarEntry, CalendarEventType } from "@/data/tasama-seed";

const EVENT_LABEL: Record<CalendarEventType, { en: string; ar: string }> = {
  "gosi-filing": { en: "GOSI Filing", ar: "تقديم التأمينات" },
  "mudad-submission": { en: "Mudad Submission", ar: "تقديم مُدد" },
  "iqama-renewal": { en: "Iqama Renewal", ar: "تجديد إقامة" },
  "saudization-review": { en: "Saudization Review", ar: "مراجعة السعودة" },
  "wps-deadline": { en: "WPS Deadline", ar: "موعد حماية الأجور" },
  "tax-event": { en: "Tax Event", ar: "حدث ضريبي" },
  "contract-renewal": { en: "Contract Renewal", ar: "تجديد عقد" },
  "leave-event": { en: "Leave Event", ar: "حدث إجازة" },
};

export default function ComplianceCenterView() {
  const { lang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const isAr = lang === "ar";
  const data = useTasamaData();
  const { filters } = useManagerFilters();
  const [eventTypeFilter, setEventTypeFilter] = useState<"all" | CalendarEventType>("all");
  const [selected, setSelected] = useState<RegulatoryCalendarEntry | null>(null);

  const entries = useMemo(() => {
    return data.regulatoryCalendar.filter((c) => {
      if (filters.clientId !== "all" && c.clientId && c.clientId !== filters.clientId) return false;
      if (eventTypeFilter !== "all" && c.eventType !== eventTypeFilter) return false;
      return true;
    });
  }, [data.regulatoryCalendar, filters.clientId, eventTypeFilter]);

  const clients = data.clients;
  const filed = entries.filter((c) => c.type === "filed");
  const upcoming = entries.filter((c) => c.type === "upcoming");

  // Build monthly bucket per client (12 months)
  const grid = useMemo(() => {
    const out = clients.map((cl) => {
      const buckets: { filed: RegulatoryCalendarEntry[]; upcoming: RegulatoryCalendarEntry[] }[] = Array.from({ length: 12 }, () => ({ filed: [], upcoming: [] }));
      entries.forEach((e) => {
        if (e.clientId && e.clientId !== cl.id) return;
        if (!e.clientId) return; // skip system-wide
        const m = new Date(e.dueDate).getMonth();
        if (m >= 0 && m < 12) buckets[m][e.type].push(e);
      });
      return { client: cl, buckets };
    });
    return out;
  }, [clients, entries]);

  // Cluster detection: months with ≥3 upcoming across the fleet
  const monthClusters = useMemo(() => {
    const counts = Array(12).fill(0);
    upcoming.forEach((e) => { const m = new Date(e.dueDate).getMonth(); if (m >= 0 && m < 12) counts[m]++; });
    return counts.map((n, i) => (n >= 3 ? i : -1)).filter((x) => x >= 0);
  }, [upcoming]);

  const months = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={20} className="text-[#0F0698]" />
          {t("title", compliance)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", compliance)}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card icon={<CheckCircle2 size={16} />} label={t("totalFiled", compliance)} value={`${filed.length}`} accent="emerald" />
        <Card icon={<Clock size={16} />} label={t("totalUpcoming", compliance)} value={`${upcoming.length}`} accent="teal" />
        <Card icon={<Layers size={16} />} label={t("clusterRisk", compliance)} value={`${monthClusters.length}`} accent="amber"
          sub={monthClusters.length > 0 ? monthClusters.map((m) => getMonthName(m + 1, lang)).join(", ") : (isAr ? "لا تجمّعات" : "no clusters")} />
        <Card icon={<ShieldCheck size={16} />} label={t("onTimeStreak", compliance)} value={`18`} sub={t("monthsClean", compliance)} accent="purple" />
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">{t("filterEvent", compliance)}:</span>
          <select
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value as typeof eventTypeFilter)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium"
          >
            <option value="all">{t("allEvents", compliance)}</option>
            {(Object.keys(EVENT_LABEL) as CalendarEventType[]).map((et) => (
              <option key={et} value={et}>{EVENT_LABEL[et][lang]}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5 text-gray-600"><span className="w-3 h-3 rounded bg-emerald-400" /> {t("legendFiled", compliance)}</span>
          <span className="flex items-center gap-1.5 text-gray-600"><span className="w-3 h-3 rounded bg-[#0F0698]" /> {t("legendUpcoming", compliance)}</span>
          <span className="flex items-center gap-1.5 text-gray-600"><span className="w-3 h-3 rounded bg-amber-400" /> {t("legendCluster", compliance)}</span>
        </div>
      </div>

      {/* 12-month grid */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            <div className="grid grid-cols-[200px_repeat(12,1fr)] border-b border-gray-200 bg-gray-50">
              <div className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("clientLabel", compliance)}</div>
              {months.map((m) => (
                <div
                  key={m}
                  className={`px-2 py-3 text-[11px] font-bold uppercase tracking-wider text-center ${
                    monthClusters.includes(m) ? "bg-amber-50 text-amber-700" : "text-gray-500"
                  }`}
                >
                  {getMonthName(m + 1, lang).slice(0, 3)}
                </div>
              ))}
            </div>

            {grid.map((row) => (
              <div key={row.client.id} className="grid grid-cols-[200px_repeat(12,1fr)] border-b border-gray-100 hover:bg-gray-50/30">
                <div className="px-4 py-3">
                  <p className="text-xs font-bold text-gray-900 truncate">{isAr ? row.client.legalNameAr : row.client.legalNameEn}</p>
                  <p className="text-[10px] text-gray-500">{row.client.industry}</p>
                </div>
                {row.buckets.map((bucket, m) => {
                  const filedCount = bucket.filed.length;
                  const upcomingCount = bucket.upcoming.length;
                  const isCluster = monthClusters.includes(m);
                  const total = filedCount + upcomingCount;
                  if (total === 0) {
                    return (
                      <div key={m} className={`p-2 border-l border-gray-100 ${isCluster ? "bg-amber-50/40" : ""}`} />
                    );
                  }
                  return (
                    <div key={m} className={`p-2 border-l border-gray-100 ${isCluster ? "bg-amber-50/40" : ""} flex flex-col gap-1`}>
                      {bucket.filed.slice(0, 2).map((e) => (
                        <button
                          key={e.id} onClick={() => setSelected(e)}
                          className="text-start bg-emerald-100 hover:bg-emerald-200 rounded px-1.5 py-1 text-[9px] text-emerald-800 font-semibold truncate"
                          title={getCalendarEventName(e, lang)}
                        >
                          ✓ {getCalendarEventName(e, lang).slice(0, 14)}
                        </button>
                      ))}
                      {bucket.upcoming.slice(0, 2).map((e) => (
                        <button
                          key={e.id} onClick={() => setSelected(e)}
                          className="text-start bg-[#0F0698] hover:bg-[#3B30E0] rounded px-1.5 py-1 text-[9px] text-white font-semibold truncate"
                          title={getCalendarEventName(e, lang)}
                        >
                          ⏰ {getCalendarEventName(e, lang).slice(0, 14)}
                        </button>
                      ))}
                      {(filedCount + upcomingCount) > 4 && (
                        <span className="text-[9px] text-gray-500 text-center">+{filedCount + upcomingCount - 4}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cluster alert */}
      {monthClusters.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-900">{t("clusterAlert", compliance)}</p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              {monthClusters.map((m) => getMonthName(m + 1, lang)).join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Event detail modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
              dir={isAr ? "rtl" : "ltr"}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CalendarRange size={18} className="text-[#0F0698]" />
                  <h3 className="text-base font-bold text-gray-900">{t("detailsTitle", compliance)}</h3>
                </div>
                <button onClick={() => setSelected(null)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{t("eventLabel", compliance)}</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">{getCalendarEventName(selected, lang)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-700">{isAr ? selected.descriptionAr : selected.descriptionEn}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
                      {selected.type === "filed" ? t("completedOn", compliance) : t("due", compliance)}
                    </p>
                    <p className="text-xs font-bold text-gray-900 mt-0.5">{selected.dueDate}</p>
                  </div>
                  {selected.referenceNumber && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{t("reference", compliance)}</p>
                      <p className="text-xs font-bold text-gray-900 mt-0.5 font-mono">{selected.referenceNumber}</p>
                    </div>
                  )}
                </div>
                <div className="pt-3">
                  <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${
                    selected.type === "filed" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-[#0F0698]"
                  }`}>
                    {selected.type === "filed" ? t("filed", compliance) : t("upcoming", compliance)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-full mt-5 px-4 py-2 bg-[#0F0698] text-white rounded-lg text-sm font-bold hover:bg-[#3B30E0]"
              >
                {t("closeBtn", compliance)}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Card({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent: "emerald" | "teal" | "amber" | "purple" }) {
  const c = accent === "emerald" ? "bg-emerald-50 text-emerald-700" :
    accent === "teal" ? "bg-blue-50 text-[#0F0698]" :
    accent === "amber" ? "bg-amber-50 text-amber-700" :
    "bg-purple-50 text-purple-700";
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${c}`}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</span>
      </div>
      <div className="text-xl font-extrabold text-gray-900 mt-2">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
