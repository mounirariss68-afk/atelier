// Foundation placeholder shell for the Manager (Operations) Dashboard.
// Renders the cross-client KPIs, agent scorecards, regulatory calendar, and
// pending recommendations driven by the /api/tasama endpoints. The full
// dashboard experience will be built in a downstream task.

import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "./DemoLangContext";
import {
  generateClientSummaries,
  generateRecommendations,
  generateAlerts,
  generateAgentScorecards,
  generateQuickStats,
  generateOperationsDigest,
} from "@/data/tasama-agent";
import { formatSAR, formatPercent, getSaudizationBandLabel, getCalendarEventName, getAgentName } from "@/data/tasama-seed";
import { LayoutDashboard, AlertTriangle, ArrowLeft, ShieldCheck, Wallet, Users, ClipboardList } from "lucide-react";
import { Link } from "wouter";

export default function ManagerDashboardShell() {
  const { lang, setLang } = useTasamaDemoLang();
  const data = useTasamaData();
  const isAr = lang === "ar";

  const stats = generateQuickStats(lang);
  const summaries = generateClientSummaries();
  const recs = generateRecommendations();
  const alerts = generateAlerts();
  const scorecards = generateAgentScorecards();
  const digest = generateOperationsDigest();
  const upcoming = data.regulatoryCalendar.filter((c) => c.type === "upcoming").slice(0, 6);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-[#F4F6F8]">
      <header className="h-14 bg-[#0F766E] flex items-center px-5 gap-4 text-white">
        <Link href="/marketplace/tasama-payroll-hub" className="text-teal-100 hover:text-white flex items-center gap-1.5 text-xs">
          <ArrowLeft size={14} className="rtl:rotate-180" />
          {isAr ? "العودة" : "Back"}
        </Link>
        <div className="h-5 w-px bg-teal-400" />
        <LayoutDashboard size={18} />
        <h1 className="text-sm font-bold">{isAr ? "لوحة العمليات" : "Operations Dashboard"}</h1>
        <div className="text-xs text-teal-100">{isAr ? "مديرو الرواتب" : "Payroll Managers"}</div>
        <div className="flex-1" />
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="text-xs px-3 py-1 rounded-full bg-teal-700 hover:bg-teal-600 transition-colors"
        >
          {lang === "en" ? "العربية" : "English"}
        </button>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Headline digest */}
        <div className="bg-gradient-to-r from-[#0F766E] to-[#0D9488] text-white rounded-xl p-5 shadow-sm">
          <div className="text-xs uppercase tracking-wider text-teal-100">{isAr ? "ملخص العمليات" : "Operations digest"}</div>
          <h2 className="text-lg font-bold mt-1">{digest.headline}</h2>
          <ul className="mt-3 space-y-1 text-xs text-teal-50">
            {digest.bullets.map((b, i) => (
              <li key={i}>• {b}</li>
            ))}
          </ul>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={<Users size={18} />} label={isAr ? "العملاء" : "Clients"} value={`${stats.clientCount}`} sub={`${stats.employeeCount} ${isAr ? "موظفًا" : "employees"}`} />
          <Stat icon={<Wallet size={18} />} label={isAr ? "إجمالي الراتب الشهري" : "Monthly gross"} value={formatSAR(stats.monthlyGross)} sub={`${formatSAR(stats.monthlyGosi)} ${isAr ? "تأمينات" : "GOSI"}`} />
          <Stat icon={<ClipboardList size={18} />} label={isAr ? "طلبات مفتوحة" : "Open requests"} value={`${stats.openRequests}`} sub={`${stats.upcomingEvents} ${isAr ? "مواعيد قادمة" : "deadlines"}`} />
          <Stat icon={<ShieldCheck size={18} />} label={isAr ? "متوسط ثقة الوثائق" : "Avg doc confidence"} value={`${(stats.avgConfidence * 100).toFixed(1)}%`} sub={isAr ? "ثنائية اللغة" : "Bilingual EN/AR"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Client summaries */}
          <section className="lg:col-span-2 space-y-3">
            <h3 className="text-sm font-bold text-gray-700">{isAr ? "العملاء" : "Client portfolio"}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {summaries.map((s) => (
                <div key={s.client.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="text-sm font-bold text-gray-900">{isAr ? s.client.legalNameAr : s.client.legalNameEn}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{getSaudizationBandLabel(s.client.saudizationBand as never, lang)} • {formatPercent(s.saudizationPercent)}</div>
                  <div className="mt-3 grid grid-cols-2 gap-y-1 text-[11px]">
                    <div className="text-gray-500">{isAr ? "موظفون" : "Employees"}</div>
                    <div className="text-end font-semibold">{s.employeeCount}</div>
                    <div className="text-gray-500">{isAr ? "إجمالي شهري" : "Monthly gross"}</div>
                    <div className="text-end font-semibold">{formatSAR(s.monthlyGross)}</div>
                    <div className="text-gray-500">{isAr ? "تأمينات" : "GOSI"}</div>
                    <div className="text-end font-semibold">{formatSAR(s.monthlyGosi)}</div>
                    <div className="text-gray-500">{isAr ? "طلبات مفتوحة" : "Open reqs"}</div>
                    <div className="text-end font-semibold">{s.pendingRequests}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Pending recommendations */}
            <h3 className="text-sm font-bold text-gray-700 pt-3">{isAr ? "توصيات في انتظار القرار" : "Pending recommendations"}</h3>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {recs.map((r) => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-[#0F766E] font-semibold uppercase tracking-wider">{r.targetRole.replace(/-/g, " ")}</div>
                      <div className="text-sm font-bold text-gray-900 mt-0.5">{r.title}</div>
                      <div className="text-xs text-gray-600 mt-1">{r.summary}</div>
                      <div className="text-[11px] text-gray-500 mt-2">{r.recommendedAction}</div>
                    </div>
                    <div className="text-end">
                      <div className={`text-[11px] px-2 py-0.5 rounded-full inline-block ${
                        r.severity === "critical"
                          ? "bg-red-100 text-red-700"
                          : r.severity === "high"
                          ? "bg-orange-100 text-orange-700"
                          : r.severity === "medium"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-700"
                      }`}>{r.severity}</div>
                      <div className="text-[11px] text-gray-500 mt-1">{r.confidence.toFixed(0)}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Right rail: Alerts + Calendar + Top agents */}
          <aside className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-2">{isAr ? "تنبيهات" : "Alerts"}</h3>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {alerts.slice(0, 5).map((a) => (
                  <div key={a.id} className="p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className={`mt-0.5 ${
                        a.severity === "high" ? "text-orange-500" : a.severity === "critical" ? "text-red-500" : "text-amber-500"
                      }`} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-gray-900">{a.title}</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">{a.detail}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-2">{isAr ? "التقويم التنظيمي" : "Regulatory calendar"}</h3>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {upcoming.map((c) => (
                  <div key={c.id} className="p-3">
                    <div className="text-xs font-semibold text-gray-900">{getCalendarEventName(c, lang)}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{isAr ? c.descriptionAr : c.descriptionEn}</div>
                    <div className="text-[11px] text-[#0F766E] font-semibold mt-1">{c.dueDate}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-2">{isAr ? "أفضل الوكلاء" : "Top agents"}</h3>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {[...scorecards].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 5).map((sc) => {
                  const overrides = Math.round((sc.humanOverrideRate / 100) * sc.tasksThisCycle);
                  const last = sc.trend.at(-1) ?? sc.compositeScore;
                  const prev = sc.trend.at(-2) ?? last;
                  const trendLabel = last > prev + 0.5 ? "up" : last < prev - 0.5 ? "down" : "stable";
                  return (
                    <div key={sc.agentId} className="p-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{getAgentName(sc.agentId, lang)}</div>
                        <div className="text-[10px] text-gray-500">{sc.tasksThisCycle} tasks • {overrides} overrides</div>
                      </div>
                      <div className="text-end">
                        <div className="text-sm font-bold text-[#0F766E]">{sc.compositeScore.toFixed(0)}</div>
                        <div className="text-[10px] text-gray-400 capitalize">{trendLabel}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>

        <p className="text-[11px] text-gray-400 text-center pt-4 border-t border-gray-200">
          {isAr
            ? "هذا هو الأساس التقني للوحة المدير. الواجهة الكاملة قيد البناء في المهام التالية."
            : "Foundation shell for the Operations Dashboard. The full experience is being built in downstream tasks."}
        </p>
      </main>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 text-gray-500">
        <span className="text-[#0F766E]">{icon}</span>
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-gray-900 mt-2">{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}
