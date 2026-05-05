// Foundation placeholder shell for the "Digital Team" (Agent Operations) demo.
// Renders the live 10-agent topology + recent activity feed driven by the
// /api/tasama endpoints. Downstream tasks will replace this shell with the
// full operations console.

import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "./DemoLangContext";
import {
  generateActivityFeed,
  generateAgentScorecards,
  generateQuickStats,
  generatePlaybooks,
} from "@/data/tasama-agent";
import { TASAMA_AGENT_IDS, getAgentName, formatSAR } from "@/data/tasama-seed";
import { Activity, CheckCircle2, Clock, Bot, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
  running: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  pending: "bg-slate-700 text-slate-400 border-slate-600",
};

export default function AgentOpsShell() {
  const { lang, setLang } = useTasamaDemoLang();
  const data = useTasamaData();
  const stats = generateQuickStats(lang);
  const scorecards = generateAgentScorecards();
  const activity = generateActivityFeed().slice(0, 12);
  const playbooks = generatePlaybooks();

  const monthlyDocs = data.documents.length;
  const isAr = lang === "ar";

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-[#0F172A] text-white">
      <header className="h-16 bg-[#1E293B] border-b border-slate-700 flex items-center px-5 gap-4">
        <Link href="/marketplace/tasama-payroll-hub" className="text-slate-400 hover:text-white flex items-center gap-1.5 text-xs">
          <ArrowLeft size={14} className="rtl:rotate-180" />
          {isAr ? "العودة" : "Back"}
        </Link>
        <div className="h-5 w-px bg-slate-600" />
        <div className="leading-tight">
          <h1 className="text-xs font-bold">{isAr ? "عمليات الوكلاء" : "Agent Operations"}</h1>
          <p className="text-[10px] text-slate-400">{isAr ? "الفريق الرقمي" : "Digital Team"}</p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="text-xs px-3 py-1 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors"
        >
          {lang === "en" ? "العربية" : "English"}
        </button>
      </header>

      <main className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={<Bot size={18} />} label={isAr ? "وكلاء نشطون" : "Active Agents"} value={`${stats.activeAgents}`} sub={isAr ? "10 تخصصات" : "10 specialisms"} />
          <Stat icon={<Activity size={18} />} label={isAr ? "وثائق معالجة" : "Documents processed"} value={`${monthlyDocs}`} sub={`${(stats.avgConfidence * 100).toFixed(1)}% ${isAr ? "ثقة" : "confidence"}`} />
          <Stat icon={<CheckCircle2 size={18} />} label={isAr ? "إجمالي رواتب الشهر" : "September gross"} value={formatSAR(stats.monthlyGross)} sub={`${stats.employeeCount} ${isAr ? "موظفًا" : "employees"}`} />
          <Stat icon={<Clock size={18} />} label={isAr ? "طلبات مفتوحة" : "Open requests"} value={`${stats.openRequests}`} sub={`${stats.upcomingEvents} ${isAr ? "مواعيد قادمة" : "upcoming events"}`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agent topology / scorecards */}
          <section className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-bold text-slate-300">{isAr ? "الوكلاء العشرة" : "The 10 specialist agents"}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {scorecards.map((sc) => (
                <div key={sc.agentId} className="bg-[#1E293B] border border-slate-700 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-sm font-semibold">{getAgentName(sc.agentId, lang)}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{sc.tasksThisCycle} {isAr ? "مهمة هذا الشهر" : "tasks this month"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-[#3B30E0]">{sc.compositeScore.toFixed(0)}</div>
                      <div className="text-[10px] text-slate-500">{isAr ? "مركب" : "composite"}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-3 text-[10px]">
                    <Bar label={isAr ? "دقة" : "Acc"} v={sc.accuracyScore / 100} />
                    <Bar label={isAr ? "سرعة" : "Spd"} v={sc.speedScore / 100} />
                    <Bar label={isAr ? "استقلال" : "Auto"} v={sc.autonomyScore / 100} />
                    <Bar label={isAr ? "جودة" : "Qual"} v={sc.qualityScore / 100} />
                  </div>
                  {sc.notableEvents.length > 0 && (
                    <div className="mt-3 text-[11px] text-amber-400 bg-amber-500/10 rounded p-2 border border-amber-500/20">
                      {sc.notableEvents[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Live activity feed */}
          <aside className="space-y-3">
            <h2 className="text-sm font-bold text-slate-300">{isAr ? "النشاط المباشر" : "Live activity feed"}</h2>
            <div className="bg-[#1E293B] border border-slate-700 rounded-xl divide-y divide-slate-700">
              {activity.map((a) => (
                <div key={a.id} className="p-3">
                  <div className="text-[11px] text-[#3B30E0] font-semibold">{a.agentName}</div>
                  <div className="text-xs text-slate-200 mt-0.5">{a.action}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{a.detail}</div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        {/* Active playbooks */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-slate-300">{isAr ? "كتب اللعب النشطة" : "Active playbooks"}</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {playbooks.map((p) => (
              <div key={p.id} className="bg-[#1E293B] border border-slate-700 rounded-xl p-4">
                <div className="text-sm font-semibold text-white">{p.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{p.trigger}</div>
                <div className="mt-3 space-y-1.5">
                  {p.steps.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 truncate flex-1 me-2">{s.action}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <p className="text-[11px] text-slate-500 text-center pt-4 border-t border-slate-800">
          {isAr
            ? "هذا هو الأساس التقني لمنصة تسامة لذكاء الرواتب. الواجهة الكاملة قيد البناء في المهام التالية."
            : "Foundation shell for the Tasama Payroll Intelligence Hub. The full operations console is being built in downstream tasks."}
        </p>
      </main>
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-[#1E293B] border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400">
        <span className="text-[#3B30E0]">{icon}</span>
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white mt-2">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  const pct = Math.round(v * 100);
  return (
    <div>
      <div className="text-slate-500 mb-1">{label}</div>
      <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full bg-[#3B30E0] rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-slate-400 mt-1">{pct}</div>
    </div>
  );
}
