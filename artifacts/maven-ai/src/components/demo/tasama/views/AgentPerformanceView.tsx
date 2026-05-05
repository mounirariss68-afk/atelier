import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from "recharts";
import {
  Cpu, Activity, Award, AlertTriangle, ChevronDown, ChevronUp, Zap, Brain, Shield, Clock, TrendingUp,
} from "lucide-react";
import { useTasamaDemoLang, useTasamaDemoT } from "../DemoLangContext";
import { agentPerf } from "../tasama-i18n";
import { generateAgentPerformanceScores, generateDecisionAnalytics } from "@/data/tasama-agent";
import { getAgentName } from "@/data/tasama-seed";
import type { AgentPerformanceScore } from "@/data/tasama-seed";

const HEALTH_BG: Record<AgentPerformanceScore["health"], string> = {
  healthy: "bg-emerald-50 text-emerald-700 border-emerald-200",
  degraded: "bg-amber-50 text-amber-700 border-amber-200",
  warning: "bg-red-50 text-red-700 border-red-200",
};

const HEALTH_DOT: Record<AgentPerformanceScore["health"], string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  warning: "bg-red-500",
};

export default function AgentPerformanceView() {
  const { lang } = useTasamaDemoLang();
  const t = useTasamaDemoT();
  const isAr = lang === "ar";
  const scores = useMemo(() => generateAgentPerformanceScores(), []);
  const analytics = useMemo(() => generateDecisionAnalytics(), []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fleetCounts = useMemo(() => ({
    healthy: scores.filter((s) => s.health === "healthy").length,
    degraded: scores.filter((s) => s.health === "degraded").length,
    warning: scores.filter((s) => s.health === "warning").length,
  }), [scores]);

  const predictedLabel = isAr ? "متوقع" : "Predicted";
  const actualLabel = isAr ? "فعلي" : "Actual";
  const approvedLabel = isAr ? "معتمد" : "Approved";
  const modifiedLabel = isAr ? "معدّل" : "Modified";
  const rejectedLabel = isAr ? "مرفوض" : "Rejected";

  const calibrationData = analytics.confidenceCalibrationCurve.map((c) => ({
    name: c.bucket,
    [predictedLabel]: c.predicted,
    [actualLabel]: c.actual,
  }));

  const byAgentChart = analytics.byAgent.map((a) => ({
    name: a.agentName.split(" ").slice(0, 2).join(" "),
    [approvedLabel]: a.approved,
    [modifiedLabel]: a.modified,
    [rejectedLabel]: a.rejected,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Cpu size={20} className="text-[#0F766E]" />
          {t("title", agentPerf)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">{t("subtitle", agentPerf)}</p>
      </div>

      {/* Fleet health */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm md:col-span-1">
          <p className="text-[10px] uppercase tracking-widest font-bold text-gray-500">{t("fleetHealth", agentPerf)}</p>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-gray-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> {t("healthy", agentPerf)}
              </span>
              <span className="text-sm font-extrabold text-emerald-700">{fleetCounts.healthy}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-gray-700">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> {t("degraded", agentPerf)}
              </span>
              <span className="text-sm font-extrabold text-amber-700">{fleetCounts.degraded}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs text-gray-700">
                <span className="w-2 h-2 rounded-full bg-red-500" /> {t("warning", agentPerf)}
              </span>
              <span className="text-sm font-extrabold text-red-700">{fleetCounts.warning}</span>
            </div>
          </div>
        </div>

        <Stat icon={<Award size={16} />} label={t("approvalRate", agentPerf)} value={`${analytics.overallApprovalRate}%`} accent="emerald" />
        <Stat icon={<Activity size={16} />} label={t("automationRate", agentPerf)} value={`${analytics.automationRate}%`} accent="teal" />
        <Stat icon={<TrendingUp size={16} />} label={t("humanTouch", agentPerf)} value={`${analytics.humanTouchPointsPerCycle}`} accent="amber" />
      </div>

      {/* Decision analytics: 3 charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calibration curve */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={14} className="text-[#0F766E]" />
            <h3 className="text-sm font-bold text-gray-900">{t("calibration", agentPerf)}</h3>
          </div>
          <p className="text-[11px] text-gray-500">{t("predictedVsActual", agentPerf)}</p>
          <div className="h-[220px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={calibrationData} margin={{ left: -10, right: 5, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} domain={[40, 100]} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey={t("predicted", agentPerf)} stroke="#0F766E" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey={t("actual", agentPerf)} stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SLA by role */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-[#0F766E]" />
            <h3 className="text-sm font-bold text-gray-900">{t("byRole", agentPerf)}</h3>
          </div>
          <p className="text-[11px] text-gray-500">{t("avgDecisionTime", agentPerf)}</p>
          <div className="mt-4 space-y-3">
            {analytics.byRole.map((r) => {
              const roleLabels: Record<string, { en: string; ar: string }> = {
                "payroll-manager": { en: "Payroll Manager", ar: "مدير الرواتب" },
                "finance-controller": { en: "Finance Controller", ar: "المراقب المالي" },
                "compliance-officer": { en: "Compliance Officer", ar: "مسؤول الامتثال" },
              };
              const label = roleLabels[r.role][lang];
              const pct = (r.avgDecisionTimeMinutes / 60) * 100;
              return (
                <div key={r.role}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-700 font-medium">{label}</span>
                    <span className="font-bold text-gray-900">{r.avgDecisionTimeMinutes} {t("minutes", agentPerf)}</span>
                  </div>
                  <div className="mt-1.5 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#0F766E] to-[#0D9488]" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{(r.approvalRate * 100).toFixed(0)}% {t("approvalRate", agentPerf)}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top rejection reasons */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-600" />
            <h3 className="text-sm font-bold text-gray-900">{t("topRejectionReasons", agentPerf)}</h3>
          </div>
          <div className="mt-3 space-y-2">
            {analytics.topRejectionReasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-extrabold flex-shrink-0">{r.count}</span>
                <p className="text-gray-700 leading-snug">{r.reason}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Decisions by agent (bar chart) */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Activity size={14} className="text-[#0F766E]" />
          <h3 className="text-sm font-bold text-gray-900">{t("decisionAnalytics", agentPerf)}</h3>
        </div>
        <div className="h-[260px] mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byAgentChart} margin={{ left: -10, right: 5, top: 8, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey={approvedLabel} stackId="a" fill="#0F766E" />
              <Bar dataKey={modifiedLabel} stackId="a" fill="#F59E0B" />
              <Bar dataKey={rejectedLabel} stackId="a" fill="#DC2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent scorecards */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={16} className="text-[#0F766E]" />
          <h3 className="text-base font-bold text-gray-900">{t("agentScorecards", agentPerf)}</h3>
          <span className="text-xs text-gray-500">({scores.length})</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scores.map((s) => {
            const expanded = expandedId === s.agentId;
            const radarData = [
              { metric: t("accuracy", agentPerf), value: s.accuracyScore, fullMark: 100 },
              { metric: t("speed", agentPerf), value: s.speedScore, fullMark: 100 },
              { metric: t("autonomy", agentPerf), value: s.autonomyScore, fullMark: 100 },
              { metric: t("quality", agentPerf), value: s.qualityScore, fullMark: 100 },
            ];
            return (
              <motion.div
                key={s.agentId} layout
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{getAgentName(s.agentId, lang)}</p>
                      <span className={`mt-1 inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border font-bold ${HEALTH_BG[s.health]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_DOT[s.health]}`} />
                        {t(s.health, agentPerf)}
                      </span>
                    </div>
                    <div className="text-end flex-shrink-0">
                      <div className="text-2xl font-extrabold text-[#0F766E]">{s.compositeScore.toFixed(1)}</div>
                      <div className="text-[9px] text-gray-500 uppercase tracking-wide">{t("composite", agentPerf)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 mt-4 text-center">
                    <Mini label={t("accuracy", agentPerf)} val={s.accuracyScore} />
                    <Mini label={t("speed", agentPerf)} val={s.speedScore} />
                    <Mini label={t("autonomy", agentPerf)} val={s.autonomyScore} />
                    <Mini label={t("quality", agentPerf)} val={s.qualityScore} />
                  </div>

                  <button
                    onClick={() => setExpandedId(expanded ? null : s.agentId)}
                    className="mt-4 w-full text-xs text-[#0F766E] font-bold hover:underline flex items-center justify-center gap-1"
                  >
                    {expanded ? t("collapse", agentPerf) : t("expand", agentPerf)}
                    {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>

                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-gray-100 bg-gray-50/50 overflow-hidden"
                    >
                      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-2">{t("trend6m", agentPerf)}</p>
                          <div className="h-[120px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={s.trend.map((v, i) => ({ name: `M${i + 1}`, value: v }))}>
                                <Line type="monotone" dataKey="value" stroke="#0F766E" strokeWidth={2} dot={{ r: 2.5 }} />
                                <YAxis hide domain={[Math.min(...s.trend) - 2, 100]} />
                                <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-2">{t("composite", agentPerf)}</p>
                          <div className="h-[120px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <RadarChart data={radarData} outerRadius="70%">
                                <PolarGrid stroke="#e5e7eb" />
                                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9 }} />
                                <PolarRadiusAxis tick={{ fontSize: 8 }} angle={30} domain={[0, 100]} />
                                <Radar dataKey="value" stroke="#0F766E" fill="#0F766E" fillOpacity={0.4} />
                              </RadarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                          <Stat2 label={t("tasksCycle", agentPerf)} value={`${s.tasksThisCycle}`} />
                          <Stat2 label={t("avgLatency", agentPerf)} value={`${s.avgLatencySeconds}${t("seconds", agentPerf)}`} />
                          <Stat2 label={t("overrideRate", agentPerf)} value={`${s.humanOverrideRate}%`} />
                          <Stat2 label={t("calibration", agentPerf)} value={`${s.confidenceCalibration}%`} />
                          <Stat2 label={t("escalationRate", agentPerf)} value={`${s.escalationRate}%`} />
                          <Stat2 label={t("errors", agentPerf)} value={`${s.errorCount}`} />
                        </div>
                        {s.notableEvents.length > 0 && (
                          <div className="md:col-span-2">
                            <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-2">{t("notable", agentPerf)}</p>
                            <ul className="text-[11px] text-gray-700 space-y-1">
                              {s.notableEvents.map((e, i) => (
                                <li key={i} className="flex items-start gap-1.5"><span className="text-[#0F766E] mt-0.5">•</span>{e}</li>
                              ))}
                            </ul>
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
    </div>
  );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: "emerald" | "teal" | "amber" }) {
  const c = accent === "emerald" ? "bg-emerald-50 text-emerald-700" : accent === "teal" ? "bg-teal-50 text-[#0F766E]" : "bg-amber-50 text-amber-700";
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${c}`}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-extrabold text-gray-900 mt-2">{value}</div>
    </div>
  );
}

function Mini({ label, val }: { label: string; val: number }) {
  return (
    <div>
      <div className="text-sm font-bold text-gray-900">{val.toFixed(1)}</div>
      <div className="text-[9px] text-gray-500 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

function Stat2({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
      <div className="text-[9px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-xs font-bold text-gray-900 mt-0.5">{value}</div>
    </div>
  );
}
