import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Users, Wallet, ShieldCheck, ClipboardList, CalendarRange, Activity, AlertTriangle,
  TrendingUp, FileText, Clock, ArrowRight, CheckCircle2, CalendarClock, Loader2,
} from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang, useTasamaDemoT } from "../DemoLangContext";
import { useManagerFilters } from "../TasamaDashboardContext";
import { operations } from "../tasama-i18n";
import {
  generateQuickStats, generateOperationsDigest, generateActivityLog, generatePayrollAlerts,
  generatePayrollRecommendations, generateDecisionAnalytics,
} from "@/data/tasama-agent";
import {
  formatSAR, getAgentName, getCalendarEventName, formatDate,
} from "@/data/tasama-seed";

const TYPE_COLORS: Record<string, string> = {
  extraction: "#1E3A8A",
  calculation: "#2563EB",
  filing: "#059669",
  transfer: "#0891B2",
  monitoring: "#F59E0B",
  communication: "#7C3AED",
  audit: "#6366F1",
  orchestration: "#DC2626",
};

export default function OperationsDashboardView({ onOpenView }: { onOpenView?: (view: string) => void }) {
  const { lang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const isAr = lang === "ar";
  const data = useTasamaData();
  const { filters } = useManagerFilters();

  const stats = generateQuickStats(lang);
  const digest = generateOperationsDigest();
  const analytics = generateDecisionAnalytics();
  const activity = useMemo(() => generateActivityLog(), []);
  const alerts = useMemo(() => generatePayrollAlerts().filter((a) => a.severity === "critical" || a.severity === "high"), []);
  const recs = useMemo(() => generatePayrollRecommendations().filter((r) => r.status === "pending"), []);

  const upcoming = useMemo(() => {
    return [...data.regulatoryCalendar]
      .filter((c) => c.type === "upcoming" && (filters.clientId === "all" || !c.clientId || c.clientId === filters.clientId))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 6);
  }, [data.regulatoryCalendar, filters.clientId]);

  const saudiSplit = useMemo(() => {
    const saudi = data.employees.filter((e) => e.isSaudi).length;
    const expat = data.employees.length - saudi;
    return { saudi, expat, ratio: data.employees.length ? (saudi / data.employees.length) * 100 : 0 };
  }, [data.employees]);

  // Per-client May 2026 in-preparation cycle status (anchored to demo "today" 2026-05-05)
  const cycleStatus = useMemo(() => {
    const NOW = new Date("2026-05-05T00:00:00Z");
    return data.clients.map((c) => {
      const inPrep = data.payrollRuns.find((r) => r.clientId === c.id && r.status === "in-preparation");
      const cutoff = inPrep
        ? new Date(Date.UTC(inPrep.periodYear, inPrep.periodMonth - 1, c.payrollCutoffDay))
        : null;
      const days = cutoff ? Math.max(0, Math.ceil((cutoff.getTime() - NOW.getTime()) / 86_400_000)) : null;
      const settle = inPrep ? new Date(Date.UTC(inPrep.periodYear, inPrep.periodMonth - 1, 27)) : null;
      return {
        client: c,
        inPrep,
        cutoff,
        settle,
        days,
        urgent: days !== null && days <= 7,
      };
    }).filter((row) => filters.clientId === "all" || row.client.id === filters.clientId);
  }, [data.clients, data.payrollRuns, filters.clientId]);

  const dueLabel = (iso: string) => {
    const due = new Date(iso).getTime();
    const now = Date.now();
    const days = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    if (days < 0) return { text: t("overdue", operations), tone: "text-red-600" };
    if (days === 0) return { text: t("today", operations), tone: "text-red-600" };
    if (days === 1) return { text: t("tomorrow", operations), tone: "text-orange-600" };
    return { text: `${days} ${t("daysAway", operations)}`, tone: "text-gray-500" };
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t("title", operations)}</h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", operations)}</p>
      </div>

      {/* Operations digest hero */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-[#1E3A8A] via-[#2563EB] to-[#3B82F6] text-white rounded-2xl p-6 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-blue-100 font-bold">{t("digest", operations)}</div>
          <div className="text-[10px] text-blue-100">
            {t("generatedAt", operations)} {formatDate(digest.generatedAt, lang)}
          </div>
        </div>
        <h3 className="text-lg font-bold mt-2 leading-snug">{digest.headline}</h3>
        <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-blue-50">
          {digest.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-blue-200" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </motion.div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi icon={<Users size={16} />} label={t("kpiClients", operations)} value={`${stats.clientCount}`} sub={`${stats.employeeCount} ${isAr ? "موظفًا" : "employees"}`} />
        <Kpi icon={<Wallet size={16} />} label={t("kpiMonthlyGross", operations)} value={formatSAR(stats.monthlyGross)} sub={`${formatSAR(stats.monthlyGosi)} ${t("kpiMonthlyGosi", operations)}`} />
        <Kpi icon={<ClipboardList size={16} />} label={t("kpiOpenRequests", operations)} value={`${stats.openRequests}`} sub={`${stats.upcomingEvents} ${t("kpiUpcomingDeadlines", operations)}`} />
        <Kpi icon={<ShieldCheck size={16} />} label={t("kpiAvgConfidence", operations)} value={`${(stats.avgConfidence * 100).toFixed(1)}%`} sub={`${analytics.automationRate}% ${t("kpiAutomationRate", operations)}`} />
      </div>

      {/* Per-client May 2026 in-preparation cycle status with cutoff countdowns */}
      {cycleStatus.length > 0 && cycleStatus.some((r) => r.inPrep) && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock size={16} className="text-[#1E3A8A]" />
            <h3 className="text-sm font-bold text-gray-900">{isAr ? "دورات الرواتب — قيد التحضير" : "Payroll cycles — in preparation"}</h3>
            <span className="text-[10px] text-gray-400 ms-auto">{isAr ? "محدّث 5 مايو 2026" : "as of May 5, 2026"}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {cycleStatus.filter((r) => r.inPrep).map(({ client, inPrep, cutoff, settle, days, urgent }) => {
              const dateFmt = (d: Date | null) => d ? d.toLocaleString(isAr ? "ar-SA" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";
              return (
                <div key={client.id} className={`rounded-xl border p-3 ${urgent ? "border-orange-300 bg-orange-50" : "border-blue-100 bg-blue-50/50"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">{isAr ? client.legalNameAr : client.legalNameEn}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{inPrep!.employeeCount} {isAr ? "موظفًا" : "employees"} · {formatSAR(inPrep!.totalGross)}</p>
                    </div>
                    <Loader2 size={14} className={`flex-shrink-0 animate-spin ${urgent ? "text-orange-600" : "text-[#2563EB]"}`} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-[10px] text-gray-600">
                      <p>{isAr ? "إقفال" : "Cutoff"} <span className="font-bold text-gray-900">{dateFmt(cutoff)}</span></p>
                      <p className="mt-0.5">{isAr ? "تسوية" : "Settle"} <span className="font-bold text-gray-900">{dateFmt(settle)}</span></p>
                    </div>
                    <div className={`text-end ${urgent ? "text-orange-700" : "text-[#1E3A8A]"}`}>
                      <p className="text-[9px] font-bold uppercase tracking-wider">{isAr ? "متبقٍ" : "left"}</p>
                      <p className="text-xl font-extrabold leading-none">T-{days}d</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SaudiSplit saudi={saudiSplit.saudi} expat={saudiSplit.expat} ratio={saudiSplit.ratio} t={t} />
        <Kpi icon={<TrendingUp size={16} />} label={isAr ? "معدل الموافقة" : "Approval rate"} value={`${analytics.overallApprovalRate}%`} sub={`${analytics.overallModificationRate}% ${isAr ? "معدّل" : "modified"}`} />
        <Kpi icon={<FileText size={16} />} label={isAr ? "نقاط بشرية / دورة" : "Human touchpoints"} value={`${analytics.humanTouchPointsPerCycle}`} sub={isAr ? "متوسط لكل دورة" : "avg per cycle"} />
        <Kpi icon={<Clock size={16} />} label={isAr ? "متوسط زمن القرار" : "Avg decision time"} value={`${analytics.byRole[0].avgDecisionTimeMinutes}m`} sub={isAr ? "للمدير" : "manager role"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity feed (flagship) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Activity size={16} className="text-[#1E3A8A]" />
                {t("agentActivity", operations)}
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">{t("agentActivityHint", operations)}</p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </div>
          </div>
          <div className="divide-y divide-gray-50 max-h-[460px] overflow-y-auto">
            {activity.map((a) => {
              const c = TYPE_COLORS[a.type] ?? "#6B7280";
              const minsAgo = Math.round((Date.now() - new Date(a.timestamp).getTime()) / 60000);
              return (
                <div key={a.id} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50/50">
                  <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: c }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-900 truncate">{getAgentName(a.agent, lang)}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">
                        {minsAgo < 60 ? `${minsAgo}m` : `${Math.round(minsAgo / 60)}h`}
                      </span>
                    </div>
                    <div className="text-xs text-gray-700 mt-0.5">{a.action}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{a.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          {/* Alerts */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <AlertTriangle size={14} className="text-orange-500" />
                {t("alertsTitle", operations)}
              </h3>
            </div>
            <div className="divide-y divide-gray-50">
              {alerts.length === 0 && (
                <div className="px-4 py-6 text-xs text-center text-gray-400">{t("emptyAlerts", operations)}</div>
              )}
              {alerts.slice(0, 4).map((a) => (
                <div key={a.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                      a.severity === "critical" ? "bg-red-500" : "bg-orange-500"
                    }`} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900">{a.title}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{a.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pending decisions */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{t("pendingDecisionsTitle", operations)}</h3>
                <p className="text-[10px] text-gray-500 mt-0.5">{t("pendingDecisionsHint", operations)}</p>
              </div>
              <button onClick={() => onOpenView?.("approvals")} className="text-[10px] text-[#1E3A8A] font-bold hover:underline flex items-center gap-1">
                {t("reviewAll", operations)}
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {recs.slice(0, 4).map((r) => (
                <button
                  key={r.id} onClick={() => onOpenView?.("approvals")}
                  className="px-4 py-3 w-full text-start hover:bg-gray-50 block"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-900 line-clamp-2 flex-1">{r.title}</p>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-bold ${
                      r.severity === "critical" ? "bg-red-100 text-red-700" :
                      r.severity === "high" ? "bg-orange-100 text-orange-700" :
                      r.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"
                    }`}>{r.confidence}%</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Calendar */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <CalendarRange size={14} className="text-[#1E3A8A]" />
                {t("upcomingTitle", operations)}
              </h3>
              <p className="text-[10px] text-gray-500 mt-0.5">{t("upcomingHint", operations)}</p>
            </div>
            <div className="divide-y divide-gray-50">
              {upcoming.map((c) => {
                const due = dueLabel(c.dueDate);
                return (
                  <div key={c.id} className="px-4 py-3">
                    <p className="text-xs font-semibold text-gray-900">{getCalendarEventName(c, lang)}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[10px] text-gray-500">{c.dueDate}</p>
                      <p className={`text-[10px] font-bold ${due.tone}`}>{due.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-gray-500">
        <span className="w-7 h-7 rounded-lg bg-blue-50 text-[#1E3A8A] flex items-center justify-center">{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="text-xl font-extrabold text-gray-900 mt-2">{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>
    </motion.div>
  );
}

function SaudiSplit({ saudi, expat, ratio, t }: { saudi: number; expat: number; ratio: number; t: ReturnType<typeof useTasamaDemoT> }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-gray-500">
        <span>{t("saudiSplit", operations)} / {t("expatSplit", operations)}</span>
        <span className="text-[#1E3A8A] font-extrabold">{ratio.toFixed(1)}%</span>
      </div>
      <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden flex">
        <div className="bg-[#1E3A8A] h-full" style={{ width: `${ratio}%` }} />
        <div className="bg-amber-400 h-full" style={{ width: `${100 - ratio}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-gray-700"><span className="font-bold">{saudi}</span> {t("saudiSplit", operations)}</span>
        <span className="text-gray-700"><span className="font-bold">{expat}</span> {t("expatSplit", operations)}</span>
      </div>
    </div>
  );
}
