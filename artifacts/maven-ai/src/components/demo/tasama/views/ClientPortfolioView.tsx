import { useMemo } from "react";
import { motion } from "framer-motion";
import { Briefcase, Users, Wallet, ShieldCheck, ClipboardList, CalendarRange, Building2, ArrowRight, Mail } from "lucide-react";
import { Link } from "wouter";
import { useTasamaDemoLang, useTasamaDemoT } from "../DemoLangContext";
import { useManagerFilters } from "../TasamaDashboardContext";
import { portfolio } from "../tasama-i18n";
import { generateClientSummaries } from "@/data/tasama-agent";
import { formatSAR, getSaudizationBandLabel, SAUDIZATION_BAND_COLOR } from "@/data/tasama-seed";
import type { SaudizationBand } from "@/data/tasama-seed";

const STATUS_LABEL: Record<string, { en: string; ar: string; tone: string }> = {
  draft: { en: "Draft", ar: "مسودة", tone: "bg-gray-100 text-gray-700" },
  approved: { en: "Approved", ar: "معتمد", tone: "bg-blue-100 text-blue-700" },
  settled: { en: "Settled", ar: "مسوّى", tone: "bg-emerald-100 text-emerald-700" },
  filed: { en: "Filed", ar: "مُقدَّم", tone: "bg-blue-100 text-[#1E3A8A]" },
  "—": { en: "—", ar: "—", tone: "bg-gray-100 text-gray-500" },
};

export default function ClientPortfolioView() {
  const { lang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const isAr = lang === "ar";
  const { filters } = useManagerFilters();

  const summaries = useMemo(() => generateClientSummaries(), []);

  const visible = useMemo(
    () => summaries.filter((s) => filters.clientId === "all" || s.client.id === filters.clientId),
    [summaries, filters.clientId]
  );

  const totals = useMemo(() => ({
    clients: summaries.length,
    employees: summaries.reduce((s, x) => s + x.employeeCount, 0),
    payroll: summaries.reduce((s, x) => s + x.monthlyGross, 0),
    saudi: summaries.reduce((s, x) => s + x.saudiCount, 0),
    expat: summaries.reduce((s, x) => s + x.expatCount, 0),
  }), [summaries]);

  const bandCounts = useMemo(() => {
    const counts: Partial<Record<SaudizationBand, number>> = {};
    summaries.forEach((s) => { counts[s.client.saudizationBand] = (counts[s.client.saudizationBand] ?? 0) + 1; });
    return counts;
  }, [summaries]);

  const bandOrder: SaudizationBand[] = ["platinum", "green-high", "green-mid", "green-low", "yellow", "red"];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Briefcase size={20} className="text-[#1E3A8A]" />
          {t("title", portfolio)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", portfolio)}</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={<Building2 size={16} />} label={t("totalClients", portfolio)} value={`${totals.clients}`} />
        <KpiCard icon={<Users size={16} />} label={t("totalEmployees", portfolio)} value={`${totals.employees}`} sub={`${totals.saudi}/${totals.expat}`} />
        <KpiCard icon={<Wallet size={16} />} label={t("totalPayroll", portfolio)} value={formatSAR(totals.payroll)} />
        <KpiCard icon={<ShieldCheck size={16} />} label={isAr ? "متوسط السعودة" : "Avg Saudization"}
          value={`${(summaries.reduce((s, x) => s + x.saudizationPercent, 0) / Math.max(1, summaries.length)).toFixed(1)}%`} />
      </div>

      {/* Saudization band distribution */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-3">{t("bandDistribution", portfolio)}</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {bandOrder.map((band) => {
            const n = bandCounts[band] ?? 0;
            return (
              <div key={band} className="rounded-xl border border-gray-100 p-3 text-center" style={{ borderTopWidth: 3, borderTopColor: SAUDIZATION_BAND_COLOR[band] }}>
                <div className="text-2xl font-extrabold" style={{ color: SAUDIZATION_BAND_COLOR[band] }}>{n}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-1">{getSaudizationBandLabel(band, lang)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Client cards */}
      {visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-500">
          {t("noClients", portfolio)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((s) => {
            const status = STATUS_LABEL[s.latestRunStatus] ?? STATUS_LABEL["—"];
            return (
              <motion.div
                key={s.client.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col"
              >
                <div className="p-5 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-gray-900 truncate">{isAr ? s.client.legalNameAr : s.client.legalNameEn}</h3>
                      <p className="text-[11px] text-gray-500 mt-0.5">{s.client.industry}</p>
                    </div>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full text-white font-bold flex-shrink-0"
                      style={{ background: SAUDIZATION_BAND_COLOR[s.client.saudizationBand] }}
                    >
                      {getSaudizationBandLabel(s.client.saudizationBand, lang)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${s.saudizationPercent}%`, background: SAUDIZATION_BAND_COLOR[s.client.saudizationBand] }} />
                    </div>
                    <span className="text-xs font-bold text-gray-900">{s.saudizationPercent.toFixed(1)}%</span>
                  </div>
                </div>

                <div className="p-5 grid grid-cols-2 gap-x-4 gap-y-3 flex-1">
                  <Stat icon={<Users size={12} />} label={t("employees", portfolio)} value={`${s.employeeCount}`} sub={`${s.saudiCount} / ${s.expatCount}`} />
                  <Stat icon={<Wallet size={12} />} label={t("monthlyGross", portfolio)} value={formatSAR(s.monthlyGross)} sub={`${formatSAR(s.monthlyGosi)} ${t("monthlyGosi", portfolio)}`} />
                  <Stat icon={<ClipboardList size={12} />} label={t("openRequests", portfolio)} value={`${s.pendingRequests}`} />
                  <Stat icon={<CalendarRange size={12} />} label={t("upcomingDeadlines", portfolio)} value={`${s.upcomingEvents}`} />
                </div>

                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-500">{t("lastRun", portfolio)}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold mt-1 inline-block ${status.tone}`}>{status[lang]}</span>
                  </div>
                  <div className="text-end">
                    <p className="text-[10px] text-gray-500">{t("contactLabel", portfolio)}</p>
                    <p className="text-[11px] font-semibold text-gray-900 truncate max-w-[140px]">{s.client.contactName}</p>
                  </div>
                </div>

                <Link
                  href="/demo/tasama-payroll-hub/client"
                  className="px-5 py-3 border-t border-gray-100 text-xs text-[#1E3A8A] font-bold hover:bg-blue-50 flex items-center justify-end gap-1.5"
                >
                  {t("viewClient", portfolio)}
                  <ArrowRight size={12} className="rtl:rotate-180" />
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-gray-500">
        <span className="w-7 h-7 rounded-lg bg-blue-50 text-[#1E3A8A] flex items-center justify-center">{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="text-xl font-extrabold text-gray-900 mt-2">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        <span className="text-[#1E3A8A]">{icon}</span>
        {label}
      </div>
      <div className="text-sm font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </div>
  );
}
