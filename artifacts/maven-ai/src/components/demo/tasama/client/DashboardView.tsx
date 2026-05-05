import { motion } from "framer-motion";
import {
  Users, CheckCircle2, Wallet, Shield, Inbox, CalendarClock, ChevronRight,
  Brain, ArrowRight, Database, FileEdit, Calculator, ShieldCheck, UserCheck, Send, Banknote, Award, AlertTriangle,
} from "lucide-react";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "../DemoLangContext";
import { clientDashboard, tDict } from "../tasama-i18n";
import { generateClientAgentInsights } from "@/data/tasama-agent";
import { formatSAR, formatPercent, getMonthName, getAgentName } from "@/data/tasama-seed";
import type { ClientViewId } from "../ClientPortalShell";

const CLIENT_ID = "client-alnakhla";

const INSIGHT_TYPE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  "info": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  "action-required": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  "opportunity": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  "risk": { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
};

const PIPELINE_ICONS = [Database, FileEdit, Calculator, ShieldCheck, UserCheck, Send, Banknote, Award];

export default function DashboardView({ onNavigate }: { onNavigate: (v: ClientViewId) => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientDashboard, lang);
  const data = useTasamaData();

  const client = data.clients.find((c) => c.id === CLIENT_ID);
  const employees = data.employees.filter((e) => e.clientId === CLIENT_ID);
  const activeEmployees = employees.filter((e) => e.status !== "separated");
  const saudi = activeEmployees.filter((e) => e.isSaudi).length;
  const expat = activeEmployees.length - saudi;

  const runs = data.payrollRuns
    .filter((r) => r.clientId === CLIENT_ID)
    .sort((a, b) => (b.periodYear * 12 + b.periodMonth) - (a.periodYear * 12 + a.periodMonth));
  const lastRun = runs[0];
  const prevRun = runs[1];
  const monthGrowth = lastRun && prevRun ? ((lastRun.totalGross - prevRun.totalGross) / prevRun.totalGross) * 100 : 0;

  const openRequests = data.serviceRequests.filter(
    (r) => r.clientId === CLIENT_ID && (r.status === "submitted" || r.status === "in-review" || r.status === "in-progress"),
  );

  const insights = client ? generateClientAgentInsights(CLIENT_ID).slice(0, 4) : [];

  // Empty-state guard: if seed didn't load, surface a clear warning instead of
  // showing zeroed-out KPIs that look broken to the demo viewer.
  const hasNoEmployees = !client || activeEmployees.length === 0;

  // Today is anchored at 2026-05-05. The current cycle is May 2026 (in-preparation).
  // April 2026 is the most recent settled cycle, so we render its pipeline as Complete.
  const cutoffDay = client?.payrollCutoffDay ?? 25;
  const NOW = new Date("2026-05-05T00:00:00Z");
  const cutoffDate = new Date(Date.UTC(2026, 4, cutoffDay)); // May 2026
  const settleDate = new Date(Date.UTC(2026, 4, 27));
  const daysToCutoff = Math.max(0, Math.ceil((cutoffDate.getTime() - NOW.getTime()) / 86_400_000));
  const monthShort = (d: Date) => d.toLocaleString(lang === "en" ? "en-US" : "ar-SA", { month: "short", day: "numeric", timeZone: "UTC" });

  // Pipeline reflects the *settled* April 2026 cycle (audit trail of what just shipped).
  const pipelineSteps = [
    { key: "DataCutoff", labelKey: "stepDataCutoff", agent: "payroll-orchestrator", date: "Apr 25" },
    { key: "EmployeeUpdates", labelKey: "stepEmployeeUpdates", agent: "document-intelligence", date: "Apr 26" },
    { key: "Calculations", labelKey: "stepCalculations", agent: "salary-calculation", date: "Apr 27" },
    { key: "Review", labelKey: "stepReview", agent: "performance-audit", date: "Apr 28" },
    { key: "Approval", labelKey: "stepApproval", agent: "human-checkpoint", date: "Apr 29" },
    { key: "BankTransfer", labelKey: "stepBankTransfer", agent: "mudad-bank-transfer", date: "Apr 30" },
    { key: "MudadFiled", labelKey: "stepMudadFiled", agent: "gosi-compliance", date: "Apr 30" },
    { key: "Complete", labelKey: "stepComplete", agent: "payroll-orchestrator", date: "May 1" },
  ] as const;

  // For the KPIs we report on the most recent *settled* run (April 2026), not May (which is mid-prep).
  const settledRun = runs.find((r) => r.status !== "in-preparation") ?? lastRun;
  const settledPrev = runs.filter((r) => r.status !== "in-preparation")[1];
  const settledGrowth = settledRun && settledPrev ? ((settledRun.totalGross - settledPrev.totalGross) / settledPrev.totalGross) * 100 : monthGrowth;
  const period = settledRun ? `${getMonthName(settledRun.periodMonth, lang)} ${settledRun.periodYear}` : t.kpiPayrollPeriod;
  const nextPayrollLabel = monthShort(cutoffDate); // e.g. "May 25"
  const nextPayrollSub = lang === "en"
    ? `Cutoff in ${daysToCutoff}d · settles ${monthShort(settleDate)}`
    : `الإقفال خلال ${daysToCutoff} أيام · التسوية ${monthShort(settleDate)}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.subtitle}</p>
      </div>

      {hasNoEmployees && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {lang === "en" ? "Demo dataset not loaded" : "لم يتم تحميل البيانات التجريبية"}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {lang === "en"
                ? "KPIs below will read as zero until the Tasama seed runs. Run pnpm --filter @workspace/scripts run seed:tasama to load 18 + 14 + 10 employees and the April 2026 settled cycle."
                : "ستظهر مؤشرات الأداء أدناه كأصفار حتى يتم تشغيل سكربت تعبئة بيانات تَسَامى. شغّل pnpm --filter @workspace/scripts run seed:tasama لتحميل 18 + 14 + 10 موظفًا ودورة أبريل 2026 المسوّاة."}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={Users} color="#0F0698" value={String(activeEmployees.length)} label={t.kpiActiveEmployees} sub={`${saudi} • ${expat}`} subTitle={t.kpiActiveEmployeesSub} onClick={() => onNavigate("employees")} delay={0} />
        <KpiCard icon={CheckCircle2} color="#10B981" value={t.kpiPayrollApproved} label={t.kpiPayrollStatus} sub={period} subTitle="" onClick={() => onNavigate("payroll")} delay={0.05} />
        <KpiCard icon={Wallet} color="#3B30E0" value={settledRun ? formatSAR(settledRun.totalGross) : "—"} label={t.kpiTotalGross} sub={`${settledGrowth >= 0 ? "+" : ""}${settledGrowth.toFixed(1)}%`} subTitle={t.kpiTotalGrossSub} onClick={() => onNavigate("payroll")} delay={0.1} />
        <KpiCard icon={Shield} color="#7C3AED" value={settledRun ? formatSAR(settledRun.totalGosiEmployer + settledRun.totalGosiEmployee) : "—"} label={t.kpiGosi} sub="" subTitle={t.kpiGosiSub} onClick={() => onNavigate("processes")} delay={0.15} />
        <KpiCard icon={Inbox} color="#F59E0B" value={String(openRequests.length)} label={t.kpiPendingRequests} sub="" subTitle={t.kpiPendingRequestsSub} onClick={() => onNavigate("requests")} delay={0.2} />
        <KpiCard icon={CalendarClock} color="#3B82F6" value={nextPayrollLabel} label={t.kpiNextPayroll} sub={`T-${daysToCutoff}d`} subTitle={nextPayrollSub} onClick={() => onNavigate("payroll")} delay={0.25} />
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold flex items-center gap-2">
              <CheckCircle2 size={15} className="text-[#0F0698]" /> {t.pipelineTitle}
            </h2>
            <p className="text-[11px] text-gray-400 mt-0.5">{t.pipelineSubtitle}</p>
          </div>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
            {t.pipelineComplete}
          </span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-4 lg:grid-cols-8 gap-3">
            {pipelineSteps.map((step, i) => {
              const Icon = PIPELINE_ICONS[i];
              return (
                <div key={step.key} className="flex flex-col items-center text-center">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#0F0698] to-[#3B30E0] text-white flex items-center justify-center shadow-sm">
                    <Icon size={16} />
                  </div>
                  <p className="text-[11px] font-semibold mt-2 leading-tight">{t[step.labelKey]}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5">{step.date}</p>
                  <p className="text-[9px] text-[#3B30E0] font-medium mt-0.5 line-clamp-2">
                    {step.agent === "human-checkpoint"
                      ? (lang === "en" ? "Manager" : "المدير")
                      : getAgentName(step.agent, lang)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Brain size={15} className="text-[#0F0698]" />
          <h2 className="text-sm font-bold">{t.insightsTitle}</h2>
          <span className="text-[9px] font-bold bg-[#0F0698] text-white px-1.5 py-0.5 rounded-full">{t.aiPill}</span>
          <span className="text-[10px] text-gray-400 ms-auto">{t.insightsSubtitle}</span>
        </div>
        {insights.length === 0 ? (
          <div className="p-6 text-center text-xs text-gray-400">{t.insightsEmpty}</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {insights.map((ins) => {
              const colors = INSIGHT_TYPE_COLORS[ins.type] ?? INSIGHT_TYPE_COLORS.info;
              return (
                <div key={ins.id} className="px-5 py-3.5 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${colors.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="text-xs font-semibold text-gray-800">{lang === "en" ? ins.title : ins.titleAr}</h4>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text} uppercase`}>
                          {ins.type === "action-required" ? (lang === "en" ? "Action" : "إجراء") : ins.type === "opportunity" ? (lang === "en" ? "Opportunity" : "فرصة") : ins.type === "risk" ? (lang === "en" ? "Risk" : "خطر") : (lang === "en" ? "Info" : "معلومة")}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 leading-relaxed">{lang === "en" ? ins.detail : ins.detailAr}</p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-[10px] text-gray-400">{t.insightAgentLabel}: <span className="text-[#3B30E0] font-medium">{getAgentName(ins.agentSource, lang)}</span></span>
                        <span className="text-[10px] text-gray-400">{ins.confidence}% {t.confidenceLabel}</span>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 mt-1 flex-shrink-0 rtl:rotate-180" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold">{t.activityTitle}</h2>
          <button onClick={() => onNavigate("processes")} className="text-xs text-[#0F0698] font-semibold hover:underline flex items-center gap-1">
            {t.activityViewAll} <ArrowRight size={12} className="rtl:rotate-180" />
          </button>
        </div>
        <div className="divide-y divide-gray-50">
          {[
            { color: "bg-emerald-500", agent: "payroll-orchestrator", text: lang === "en" ? "Approved April payroll for 18 employees — total gross SAR 487,200" : "اعتماد رواتب أبريل لـ 18 موظفًا — الإجمالي 487,200 ريال", time: lang === "en" ? "2h ago" : "قبل ساعتين" },
            { color: "bg-blue-500", agent: "document-intelligence", text: lang === "en" ? "Digitized promotion letter for Ahmed Al-Rashidi (97% confidence)" : "تمت رقمنة خطاب ترقية أحمد الرشيدي (بثقة 97%)", time: lang === "en" ? "5h ago" : "قبل 5 ساعات" },
            { color: "bg-amber-500", agent: "eosb-provision", text: lang === "en" ? "Calculated EOSB for Mohammad Al-Ghamdi separation — SAR 36,750" : "احتساب مكافأة نهاية خدمة محمد الغامدي — 36,750 ريال", time: lang === "en" ? "1d ago" : "قبل يوم" },
            { color: "bg-purple-500", agent: "leave-management", text: lang === "en" ? "Processed maternity leave for Aisha Al-Qahtani (10 weeks paid)" : "معالجة إجازة أمومة عائشة القحطاني (10 أسابيع مدفوعة)", time: lang === "en" ? "2d ago" : "قبل يومين" },
          ].map((a, i) => (
            <div key={i} className="px-5 py-3 flex items-start gap-3">
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700">{a.text}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] text-[#3B30E0] font-medium">{getAgentName(a.agent, lang)}</span>
                  <span className="text-[10px] text-gray-400">·</span>
                  <span className="text-[10px] text-gray-400">{a.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function KpiCard({ icon: Icon, color, value, label, sub, subTitle, onClick, delay }: {
  icon: typeof Users; color: string; value: string; label: string; sub: string; subTitle: string; onClick: () => void; delay: number;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5 text-left hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + "15" }}>
          <Icon size={14} style={{ color }} />
        </div>
        <ChevronRight size={12} className="text-gray-300 rtl:rotate-180" />
      </div>
      <p className="text-base font-bold leading-tight">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
      {(sub || subTitle) && (
        <p className="text-[10px] text-gray-400 mt-1.5 truncate" title={subTitle}>
          {sub && <span className="text-[#3B30E0] font-semibold me-1">{sub}</span>}
          {subTitle}
        </p>
      )}
    </motion.button>
  );
}
