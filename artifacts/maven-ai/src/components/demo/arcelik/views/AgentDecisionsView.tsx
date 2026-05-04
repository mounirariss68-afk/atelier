import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  AlertTriangle, Clock, ListTodo, Activity, Shield, Zap,
  DollarSign, TrendingUp, Filter, BarChart3,
  Play, Pause, CheckCheck, Edit3, History, Bot, Cpu,
  Eye, Target, Package, Users, Scale, Cog,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  generateRecommendations, generateTasks, generateAlerts,
  generateActivityLog, generateDecisionHistory, generateSpecializedAgents, PLAYBOOKS,
  type AgentRecommendation, type AgentTask, type AgentAlert,
  type AgentPlaybook, type AgentActivityEntry, type AgentDecisionLog,
  type DirectorRole, type Severity, type DecisionType, type SpecializedAgent, type AgentStatus,
} from "@/data/arcelik-agent";
import { useDemoLang } from "../DemoLangContext";
import { decisions } from "../demo-i18n";

type SubTab = "recommendations" | "tasks" | "alerts" | "playbooks" | "activity" | "history" | "agents";
const ROLE_COLORS: Record<DirectorRole, string> = {
  pricing: "bg-blue-50 text-blue-700",
  finance: "bg-emerald-50 text-emerald-700",
  marketing: "bg-purple-50 text-purple-700",
};
const SEV_COLORS: Record<Severity, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-gray-50 text-gray-600 border-gray-200",
};
const SEV_DOT: Record<Severity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-gray-400",
};
function useDecisionsI18n() {
  const { lang } = useDemoLang();
  const t = decisions[lang];
  const sevLabels: Record<Severity, string> = { critical: t.sevCritical, high: t.sevHigh, medium: t.sevMedium, low: t.sevLow };
  const roleLabels: Record<DirectorRole, string> = { pricing: t.rolePricing, finance: t.roleFinance, marketing: t.roleMarketing };
  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} ${t.timeMinAgo}`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ${t.timeHoursAgo}`;
    return `${Math.floor(hrs / 24)} ${t.timeDaysAgo}`;
  }
  return { lang, t, sevLabels, roleLabels, timeAgo };
}

function ConfidenceBadge({ value }: { value: number }) {
  const color = value >= 90 ? "text-green-600" : value >= 80 ? "text-blue-600" : value >= 70 ? "text-amber-600" : "text-red-600";
  return (
    <span className={`text-[11px] font-bold ${color} flex items-center gap-0.5`}>
      <Shield size={11} /> %{value}
    </span>
  );
}

function ReasoningTrace({ reasoning }: { reasoning: AgentRecommendation["reasoning"] }) {
  const { t } = useDecisionsI18n();
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
        <Brain size={11} /> {t.reasoningChain}
      </p>
      <div className="relative pl-4 border-l-2 border-[#0E2841]/20 space-y-3">
        {reasoning.map((step, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="relative"
          >
            <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-[#0E2841] border-2 border-white" />
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] font-bold text-[#E30613] mb-0.5">{step.source}</p>
              <p className="text-[11px] text-gray-600 mb-1">{step.observation}</p>
              <p className="text-[11px] font-semibold text-[#0E2841]">→ {step.conclusion}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function RecommendationCard({ rec, onApprove, onReject, onModify }: {
  rec: AgentRecommendation;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onModify: (id: string, note: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyNote, setModifyNote] = useState("");
  const { t, sevLabels, roleLabels, timeAgo } = useDecisionsI18n();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
        rec.status === "approved" ? "border-green-200" : rec.status === "rejected" ? "border-red-200" : rec.status === "modified" ? "border-blue-200" : "border-gray-100"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${SEV_DOT[rec.severity]}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEV_COLORS[rec.severity]}`}>{sevLabels[rec.severity]}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[rec.targetRole]}`}>{roleLabels[rec.targetRole]}</span>
              <ConfidenceBadge value={rec.confidence} />
              <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-0.5"><Clock size={10} />{timeAgo(rec.createdAt)}</span>
            </div>
            <h4 className="text-sm font-bold text-[#0E2841] mb-1">{rec.title}</h4>
            <p className="text-xs text-gray-600">{rec.summary}</p>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <DollarSign size={12} className="mx-auto text-gray-400 mb-0.5" />
                <p className="text-xs font-bold text-[#0E2841]">{rec.impact.revenue}</p>
                <p className="text-[9px] text-gray-400">{t.revenue}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <BarChart3 size={12} className="mx-auto text-gray-400 mb-0.5" />
                <p className="text-xs font-bold text-[#0E2841]">{rec.impact.margin}</p>
                <p className="text-[9px] text-gray-400">{t.margin}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <TrendingUp size={12} className="mx-auto text-gray-400 mb-0.5" />
                <p className="text-xs font-bold text-[#0E2841]">{rec.impact.share}</p>
                <p className="text-[9px] text-gray-400">{t.marketShareLabel}</p>
              </div>
            </div>

            <div className="mt-3 p-3 bg-[#0E2841]/5 rounded-lg">
              <p className="text-[10px] font-bold text-[#0E2841] mb-0.5 flex items-center gap-1"><Zap size={10} /> {t.suggestedAction}</p>
              <p className="text-xs text-[#0E2841]">{rec.recommendedAction}</p>
            </div>

            {expanded && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}>
                <ReasoningTrace reasoning={rec.reasoning} />
                {rec.alternatives.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">{t.alternatives}</p>
                    <div className="space-y-1">
                      {rec.alternatives.map((alt, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
                          <span className="text-gray-300 mt-0.5">•</span>
                          {alt}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {modifyOpen && rec.status === "pending" && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="mt-3">
                <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/50">
                  <p className="text-[10px] font-bold text-blue-700 mb-2 flex items-center gap-1"><Edit3 size={10} /> {t.modifyNote}</p>
                  <textarea
                    value={modifyNote}
                    onChange={(e) => setModifyNote(e.target.value)}
                    className="w-full text-xs border border-blue-200 rounded-lg p-2.5 resize-none h-20 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => { setModifyOpen(false); setModifyNote(""); }} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">{t.cancel}</button>
                    <button
                      onClick={() => { if (modifyNote.trim()) { onModify(rec.id, modifyNote); setModifyOpen(false); setModifyNote(""); } }}
                      disabled={!modifyNote.trim()}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-40"
                    >
                      {t.approveWithMod}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {rec.status === "modified" && rec.decisionNote && (
              <div className="mt-3 border border-blue-200 rounded-lg p-3 bg-blue-50/30">
                <p className="text-[10px] font-bold text-blue-700 mb-0.5 flex items-center gap-1"><Edit3 size={10} /> {t.modifyNote}</p>
                <p className="text-xs text-blue-800">{rec.decisionNote}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50/50">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-[#0E2841] font-medium flex items-center gap-1"
        >
          <Brain size={12} />
          {expanded ? t.hideAnalysis : t.showReasoning}
          <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {rec.status === "pending" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onReject(rec.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors flex items-center gap-1"
            >
              <XCircle size={13} /> {t.reject}
            </button>
            <button
              onClick={() => setModifyOpen(!modifyOpen)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 ${modifyOpen ? "bg-blue-100 text-blue-700" : "text-blue-600 hover:bg-blue-50"}`}
            >
              <Edit3 size={13} /> {t.modify}
            </button>
            <button
              onClick={() => onApprove(rec.id)}
              className="px-3 py-1.5 rounded-lg bg-[#E30613] text-white text-xs font-bold hover:bg-[#c00510] transition-colors flex items-center gap-1"
            >
              <CheckCircle2 size={13} /> {t.approve}
            </button>
          </div>
        )}
        {rec.status === "approved" && (
          <span className="text-xs font-bold text-green-600 flex items-center gap-1"><CheckCircle2 size={13} /> {t.statusApproved}</span>
        )}
        {rec.status === "rejected" && (
          <span className="text-xs font-bold text-red-500 flex items-center gap-1"><XCircle size={13} /> {t.statusRejected}</span>
        )}
        {rec.status === "modified" && (
          <span className="text-xs font-bold text-blue-600 flex items-center gap-1"><Edit3 size={13} /> {t.statusModified}</span>
        )}
      </div>
    </motion.div>
  );
}

function DecisionHistoryPanel({ entries }: { entries: AgentDecisionLog[] }) {
  const { t, roleLabels, timeAgo } = useDecisionsI18n();
  const DECISION_COLORS: Record<DecisionType, { bg: string; text: string; label: string }> = {
    approved: { bg: "bg-green-100", text: "text-green-700", label: t.statusApproved },
    rejected: { bg: "bg-red-100", text: "text-red-700", label: t.statusRejected },
    modified: { bg: "bg-blue-100", text: "text-blue-700", label: t.statusModified },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex gap-4 text-center">
          <div>
            <p className="text-lg font-extrabold text-green-600">{entries.filter((e) => e.decisionType === "approved").length}</p>
            <p className="text-[10px] text-gray-500 font-medium">{t.histApproved}</p>
          </div>
          <div className="w-px bg-gray-200" />
          <div>
            <p className="text-lg font-extrabold text-blue-600">{entries.filter((e) => e.decisionType === "modified").length}</p>
            <p className="text-[10px] text-gray-500 font-medium">{t.histModified}</p>
          </div>
          <div className="w-px bg-gray-200" />
          <div>
            <p className="text-lg font-extrabold text-red-600">{entries.filter((e) => e.decisionType === "rejected").length}</p>
            <p className="text-[10px] text-gray-500 font-medium">{t.histRejected}</p>
          </div>
        </div>
      </div>

      {entries.map((entry, i) => {
        const dc = DECISION_COLORS[entry.decisionType];
        return (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
          >
            <div className="p-4">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${dc.bg} ${dc.text}`}>{dc.label}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[entry.role]}`}>{roleLabels[entry.role]}</span>
                <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-0.5"><Clock size={10} /> {timeAgo(entry.timestamp)}</span>
              </div>
              <h4 className="text-sm font-bold text-[#0E2841] mb-1">{entry.recommendationTitle}</h4>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-6 h-6 rounded-full bg-[#0E2841] flex items-center justify-center text-[8px] font-bold text-white">{entry.decidedBy.split(" ").map((n) => n[0]).join("")}</div>
                <span className="text-xs text-gray-600 font-medium">{entry.decidedBy}</span>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 mb-3">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">{t.histRationale}</p>
                <p className="text-xs text-[#0E2841]">{entry.rationale}</p>
              </div>
              {entry.modificationNote && (
                <div className="bg-blue-50 rounded-lg p-3 mb-3 border border-blue-100">
                  <p className="text-[10px] font-bold text-blue-700 mb-0.5 flex items-center gap-1"><Edit3 size={10} /> {t.histModification}</p>
                  <p className="text-xs text-blue-800">{entry.modificationNote}</p>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-xs font-bold text-[#0E2841]">{entry.simulatedOutcome.revenue}</p>
                  <p className="text-[9px] text-gray-400">{t.histRevenueImpact}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-xs font-bold text-[#0E2841]">{entry.simulatedOutcome.margin}</p>
                  <p className="text-[9px] text-gray-400">{t.histMarginImpact}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-xs font-bold text-[#0E2841]">{entry.simulatedOutcome.share}</p>
                  <p className="text-[9px] text-gray-400">{t.histShareImpact}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-xs font-bold text-[#0E2841]">{entry.simulatedOutcome.timeframe}</p>
                  <p className="text-[9px] text-gray-400">{t.histDuration}</p>
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function TaskQueue({ tasks }: { tasks: AgentTask[] }) {
  const { t, sevLabels, timeAgo } = useDecisionsI18n();
  return (
    <div className="space-y-3">
      {tasks.map((task, i) => (
        <motion.div
          key={task.id}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow"
        >
          <div className="flex items-start gap-3">
            <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${SEV_DOT[task.priority]}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEV_COLORS[task.priority]}`}>{sevLabels[task.priority]}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[task.assigneeRole]}`}>{task.assignee}</span>
              </div>
              <h4 className="text-sm font-semibold text-[#0E2841]">{task.title}</h4>
              <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                <span className="flex items-center gap-1"><Clock size={10} /> {t.taskDeadline} {task.deadline}</span>
                <span className="flex items-center gap-1"><Activity size={10} /> {timeAgo(task.createdAt)}</span>
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function AlertTimeline({ alerts }: { alerts: AgentAlert[] }) {
  const { sevLabels, timeAgo } = useDecisionsI18n();
  return (
    <div className="relative pl-6 space-y-4">
      <div className="absolute left-2 top-2 bottom-2 w-px bg-gray-200" />
      {alerts.map((alert, i) => (
        <motion.div
          key={alert.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          className="relative"
        >
          <div className={`absolute -left-[17px] top-3 w-3 h-3 rounded-full border-2 border-white ${SEV_DOT[alert.severity]}`} />
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEV_COLORS[alert.severity]}`}>{sevLabels[alert.severity]}</span>
              <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{alert.category}</span>
              <span className="text-[10px] text-gray-400 ml-auto">{timeAgo(alert.timestamp)}</span>
            </div>
            <h4 className="text-sm font-semibold text-[#0E2841]">{alert.title}</h4>
            <p className="text-xs text-gray-500 mt-0.5">{alert.detail}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function PlaybookView({ playbooks }: { playbooks: AgentPlaybook[] }) {
  const [expanded, setExpanded] = useState<string | null>(playbooks[0]?.id ?? null);
  const { t } = useDecisionsI18n();
  const statusColors: Record<string, string> = {
    triggered: "bg-blue-100 text-blue-700",
    running: "bg-amber-100 text-amber-700",
    "awaiting-approval": "bg-purple-100 text-purple-700",
    completed: "bg-green-100 text-green-700",
  };
  const statusLabels: Record<string, string> = {
    triggered: t.playbookActive,
    running: t.playbookActive,
    "awaiting-approval": t.playbookPaused,
    completed: t.playbookCompleted,
  };
  const stepIcons: Record<string, typeof CheckCheck> = {
    completed: CheckCheck,
    running: Play,
    pending: Pause,
  };

  return (
    <div className="space-y-4">
      {playbooks.map((pb) => (
        <motion.div
          key={pb.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
        >
          <button
            onClick={() => setExpanded(expanded === pb.id ? null : pb.id)}
            className="w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-gray-50/50 transition-colors"
          >
            <Zap size={16} className="text-[#F5A623] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-[#0E2841]">{pb.name}</h4>
              <p className="text-[11px] text-gray-500">{pb.trigger}</p>
            </div>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${statusColors[pb.status]}`}>{statusLabels[pb.status]}</span>
            <ChevronRight size={14} className={`text-gray-400 transition-transform ${expanded === pb.id ? "rotate-90" : ""}`} />
          </button>
          <AnimatePresence>
            {expanded === pb.id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-5 pb-5 pt-0">
                  <div className="relative pl-6 space-y-3">
                    <div className="absolute left-2 top-0 bottom-0 w-px bg-gray-200" />
                    {pb.steps.map((step, i) => {
                      const StepIcon = stepIcons[step.status] ?? Pause;
                      const dotColor = step.status === "completed" ? "bg-green-500" : step.status === "running" ? "bg-amber-500 animate-pulse" : "bg-gray-300";
                      return (
                        <div key={i} className="relative">
                          <div className={`absolute -left-[17px] top-2 w-3 h-3 rounded-full border-2 border-white ${dotColor}`} />
                          <div className={`rounded-lg p-3 ${step.status === "running" ? "bg-amber-50 border border-amber-100" : step.status === "completed" ? "bg-green-50/50" : "bg-gray-50"}`}>
                            <div className="flex items-center gap-2 mb-0.5">
                              <StepIcon size={11} className={step.status === "completed" ? "text-green-600" : step.status === "running" ? "text-amber-600" : "text-gray-400"} />
                              <span className="text-[10px] font-bold text-gray-500">{step.agent}</span>
                            </div>
                            <p className="text-xs text-[#0E2841] font-medium">{step.action}</p>
                            {step.output && (
                              <p className="text-[11px] text-gray-500 mt-1 italic">{step.output}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  );
}

const AGENT_TYPE_ICONS: Record<string, typeof Brain> = {
  "price-watch": Eye, "market-analysis": BarChart3, "campaign-opt": Target,
  "stock-mgmt": Package, "comp-response": Shield, "demand-forecast": TrendingUp,
  "dealer-perf": Users, "reg-scan": Scale, "decision-engine": Cpu,
};
const AGENT_TYPE_COLORS: Record<string, string> = {
  "price-watch": "text-blue-600 bg-blue-50", "market-analysis": "text-purple-600 bg-purple-50",
  "campaign-opt": "text-pink-600 bg-pink-50", "stock-mgmt": "text-amber-600 bg-amber-50",
  "comp-response": "text-red-600 bg-red-50", "demand-forecast": "text-green-600 bg-green-50",
  "dealer-perf": "text-cyan-600 bg-cyan-50", "reg-scan": "text-gray-600 bg-gray-100",
  "decision-engine": "text-[#E30613] bg-red-50",
};
const STATUS_COLORS: Record<AgentStatus, { dot: string; bg: string; text: string }> = {
  online: { dot: "bg-green-500", bg: "bg-green-50", text: "text-green-700" },
  processing: { dot: "bg-amber-500 animate-pulse", bg: "bg-amber-50", text: "text-amber-700" },
  idle: { dot: "bg-gray-400", bg: "bg-gray-50", text: "text-gray-600" },
};

function SpecializedAgentsPanel({ agents }: { agents: SpecializedAgent[] }) {
  const { lang, t, timeAgo } = useDecisionsI18n();
  const statusLabels: Record<AgentStatus, string> = {
    online: t.agentOnline, processing: t.agentProcessing, idle: t.agentIdle,
  };
  const activeCount = agents.filter(a => a.status !== "idle").length;
  const avgAccuracy = Math.round(agents.reduce((s, a) => s + a.accuracy, 0) / agents.length);
  const totalActions = agents.reduce((s, a) => s + a.actionsToday, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Bot size={14} className="text-green-500" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">{t.statActiveAgents}</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{activeCount}<span className="text-sm font-medium text-gray-400">/{agents.length}</span></p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} className="text-blue-500" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">{t.agentConfidenceAvg}</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">%{avgAccuracy}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Activity size={14} className="text-purple-500" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">{t.agentTotalActions}</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{totalActions}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent, i) => {
          const Icon = AGENT_TYPE_ICONS[agent.type] ?? Brain;
          const color = AGENT_TYPE_COLORS[agent.type] ?? "text-gray-600 bg-gray-50";
          const sc = STATUS_COLORS[agent.status];
          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-bold text-[#0E2841] truncate">{lang === "tr" ? agent.name : agent.nameEn}</h4>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
                      <span className={`text-[10px] font-bold ${sc.text}`}>{statusLabels[agent.status]}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-extrabold text-[#0E2841]">%{agent.accuracy}</p>
                    <p className="text-[9px] text-gray-400">{t.agentAccuracy}</p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-2.5 mb-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">{t.agentLastAction}</p>
                  <p className="text-[11px] text-[#0E2841] leading-snug">{lang === "tr" ? agent.lastAction : agent.lastActionEn}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{timeAgo(agent.lastActionTime)}</p>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {(lang === "tr" ? agent.specializations : agent.specializationsEn).map((s, j) => (
                    <span key={j} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] rounded-full font-medium">{s}</span>
                  ))}
                </div>

                <div className="flex items-center gap-4 text-[11px]">
                  <span className="flex items-center gap-1 text-gray-500">
                    <Brain size={10} className="text-[#E30613]" /> {agent.recsGenerated} {lang === "tr" ? "öneri" : "recs"}
                  </span>
                  <span className="flex items-center gap-1 text-gray-500">
                    <AlertTriangle size={10} className="text-amber-500" /> {agent.alertsRaised} {lang === "tr" ? "uyarı" : "alerts"}
                  </span>
                  <span className="flex items-center gap-1 text-gray-500 ml-auto">
                    <Zap size={10} className="text-[#F5A623]" /> {agent.actionsToday} {t.agentActionsToday.toLowerCase()}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityLog({ entries }: { entries: AgentActivityEntry[] }) {
  const { timeAgo } = useDecisionsI18n();
  const typeIcons: Record<string, typeof Activity> = {
    scan: Shield,
    analysis: BarChart3,
    recommendation: Brain,
    approval: CheckCircle2,
    alert: AlertTriangle,
  };
  const typeColors: Record<string, string> = {
    scan: "text-blue-500 bg-blue-50",
    analysis: "text-purple-500 bg-purple-50",
    recommendation: "text-[#E30613] bg-red-50",
    approval: "text-green-500 bg-green-50",
    alert: "text-amber-500 bg-amber-50",
  };

  return (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const Icon = typeIcons[entry.type] ?? Activity;
        const color = typeColors[entry.type] ?? "text-gray-500 bg-gray-50";
        return (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            className="bg-white rounded-lg border border-gray-100 p-3 flex items-start gap-3 hover:bg-gray-50/50 transition-colors"
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
              <Icon size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400">{entry.agent}</span>
                <span className="text-[10px] text-gray-300">•</span>
                <span className="text-[10px] text-gray-400">{timeAgo(entry.timestamp)}</span>
              </div>
              <p className="text-xs font-semibold text-[#0E2841]">{entry.action}</p>
              <p className="text-[11px] text-gray-500">{entry.detail}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

export default function AgentDecisionsView() {
  const { toast } = useToast();
  const { t, sevLabels, roleLabels } = useDecisionsI18n();
  const [subTab, setSubTab] = useState<SubTab>("recommendations");
  const [roleFilter, setRoleFilter] = useState<DirectorRole | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Severity | "all">("all");
  const [sortBy, setSortBy] = useState<"severity" | "confidence" | "newest">("severity");
  const [recommendations, setRecommendations] = useState(() => generateRecommendations());
  const tasks = useMemo(() => generateTasks(), []);
  const alerts = useMemo(() => generateAlerts(), []);
  const activityLog = useMemo(() => generateActivityLog(), []);
  const [liveDecisions, setLiveDecisions] = useState<AgentDecisionLog[]>([]);
  const specializedAgents = useMemo(() => generateSpecializedAgents(), []);

  const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const filteredRecs = useMemo(() => {
    let recs = recommendations.slice();
    if (roleFilter !== "all") recs = recs.filter((r) => r.targetRole === roleFilter);
    if (priorityFilter !== "all") recs = recs.filter((r) => r.severity === priorityFilter);
    if (sortBy === "severity") recs.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    else if (sortBy === "confidence") recs.sort((a, b) => b.confidence - a.confidence);
    else if (sortBy === "newest") recs.reverse();
    return recs;
  }, [recommendations, roleFilter, priorityFilter, sortBy]);
  const pendingCount = recommendations.filter((r) => r.status === "pending").length;
  const criticalCount = recommendations.filter((r) => r.severity === "critical" && r.status === "pending").length;

  const seedHistory = useMemo(() => generateDecisionHistory(), []);
  const allDecisions = [...liveDecisions, ...seedHistory];

  function createDecisionEntry(rec: AgentRecommendation, type: DecisionType, note?: string): AgentDecisionLog {
    const impactMultiplier = type === "rejected" ? 0 : type === "modified" ? 0.7 : 1;
    const parseNum = (s: string) => {
      const m = s.match(/[+-]?[\d.]+/);
      return m ? parseFloat(m[0]) : 0;
    };
    const formatOutcome = (val: number, prefix: string, suffix: string) => {
      const sign = val >= 0 ? "+" : "";
      return `${sign}${prefix}${Math.abs(val).toFixed(1)}${suffix}`;
    };
    const rev = parseNum(rec.impact.revenue) * impactMultiplier;
    const mar = parseNum(rec.impact.margin) * impactMultiplier;
    const sha = parseNum(rec.impact.share) * impactMultiplier;

    return {
      id: `dl-live-${Date.now()}-${rec.id}`,
      recommendationId: rec.id,
      recommendationTitle: rec.title,
      decisionType: type,
      decidedBy: "Elif Demir",
      role: "pricing",
      timestamp: new Date().toISOString(),
      rationale: type === "approved"
        ? `${rec.reasoning[rec.reasoning.length - 1]?.conclusion ?? ""}`
        : type === "rejected"
        ? ""
        : note ?? "",
      modificationNote: type === "modified" ? note : undefined,
      simulatedOutcome: {
        revenue: formatOutcome(rev, "₺", "M"),
        margin: formatOutcome(mar, "", "%"),
        share: formatOutcome(sha, "", "pp"),
        timeframe: rec.severity === "critical" ? "15d" : rec.severity === "high" ? "30d" : "60d",
      },
    };
  }

  const handleApprove = (id: string) => {
    const rec = recommendations.find((r) => r.id === id);
    setRecommendations((prev) => prev.map((r) => r.id === id ? { ...r, status: "approved" as const, decidedBy: "Elif Demir" } : r));
    if (rec) {
      const entry = createDecisionEntry(rec, "approved");
      setLiveDecisions((prev) => [entry, ...prev]);
      toast({
        title: t.toastApproved,
        description: `"${rec.title}" — ${t.toastApprovedDesc} ${entry.simulatedOutcome.revenue} ${t.revenueShort}, ${entry.simulatedOutcome.margin} ${t.marginShort}, ${entry.simulatedOutcome.share} ${t.shareShort} (${entry.simulatedOutcome.timeframe})`,
      });
    }
  };

  const handleReject = (id: string) => {
    const rec = recommendations.find((r) => r.id === id);
    setRecommendations((prev) => prev.map((r) => r.id === id ? { ...r, status: "rejected" as const, decidedBy: "Elif Demir" } : r));
    if (rec) {
      const entry = createDecisionEntry(rec, "rejected");
      setLiveDecisions((prev) => [entry, ...prev]);
      toast({
        title: t.toastRejected,
        description: `"${rec.title}" ${t.toastRejectedDesc}`,
      });
    }
  };

  const handleModify = (id: string, note: string) => {
    const rec = recommendations.find((r) => r.id === id);
    setRecommendations((prev) => prev.map((r) => r.id === id ? { ...r, status: "modified" as const, decidedBy: "Elif Demir", decisionNote: note } : r));
    if (rec) {
      const entry = createDecisionEntry(rec, "modified", note);
      setLiveDecisions((prev) => [entry, ...prev]);
      toast({
        title: t.toastModified,
        description: `"${rec.title}" — ${t.toastModifiedDesc} ${entry.simulatedOutcome.revenue} ${t.revenueShort}, ${entry.simulatedOutcome.margin} ${t.marginShort} (${entry.simulatedOutcome.timeframe})`,
      });
    }
  };

  const SUB_TABS: { id: SubTab; label: string; icon: typeof Brain; count?: number }[] = [
    { id: "recommendations", label: t.subRecommendations, icon: Brain, count: pendingCount },
    { id: "tasks", label: t.subTasks, icon: ListTodo, count: tasks.filter((tk) => tk.status === "open").length },
    { id: "alerts", label: t.subAlerts, icon: AlertTriangle, count: alerts.length },
    { id: "playbooks", label: t.subPlaybooks, icon: Zap, count: PLAYBOOKS.filter((p) => p.status !== "completed").length },
    { id: "history", label: t.subHistory, icon: History, count: allDecisions.length },
    { id: "agents", label: t.subAgents, icon: Bot, count: specializedAgents.filter(a => a.status !== "idle").length },
    { id: "activity", label: t.subActivity, icon: Activity },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0E2841] flex items-center gap-2">
          <Brain size={20} className="text-[#E30613]" /> {t.headerTitle}
        </h2>
        {criticalCount > 0 && (
          <span className="text-xs font-bold bg-red-100 text-red-700 px-3 py-1 rounded-full flex items-center gap-1 animate-pulse">
            <AlertTriangle size={12} /> {criticalCount} {t.criticalPending}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                subTab === tab.id ? "bg-white text-[#0E2841] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <tab.icon size={13} /> {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  subTab === tab.id ? "bg-[#E30613] text-white" : "bg-gray-200 text-gray-600"
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {subTab === "recommendations" && (
          <div className="flex items-center gap-3 ml-auto flex-wrap">
            <div className="flex items-center gap-1.5">
              <Filter size={13} className="text-gray-400" />
              {(["all", "pricing", "finance", "marketing"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    roleFilter === r ? "bg-[#0E2841] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {r === "all" ? t.filterAll : roleLabels[r]}
                </button>
              ))}
            </div>
            <div className="h-4 w-px bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={13} className="text-gray-400" />
              {(["all", "critical", "high", "medium", "low"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPriorityFilter(s)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    priorityFilter === s ? "bg-[#E30613] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {s === "all" ? t.filterAllPriority : sevLabels[s]}
                </button>
              ))}
            </div>
            <div className="h-4 w-px bg-gray-200" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "severity" | "confidence" | "newest")}
              className="text-[11px] font-medium bg-gray-100 border-0 rounded-full px-2.5 py-1 text-gray-600 cursor-pointer"
            >
              <option value="severity">{t.sortPriority}</option>
              <option value="confidence">{t.sortConfidence}</option>
              <option value="newest">{t.sortNewest}</option>
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Brain size={14} className="text-[#E30613]" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">{t.statPending}</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{pendingCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <ListTodo size={14} className="text-blue-500" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">{t.statOpenTask}</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{tasks.filter((tk) => tk.status === "open").length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-[#F5A623]" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">{t.statActivePlaybook}</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{PLAYBOOKS.filter((p) => p.status !== "completed").length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Activity size={14} className="text-purple-500" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">{t.statLast24h}</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{activityLog.length}</p>
        </div>
      </div>

      {subTab === "recommendations" && (
        <div className="space-y-4">
          {filteredRecs.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} onApprove={handleApprove} onReject={handleReject} onModify={handleModify} />
          ))}
        </div>
      )}

      {subTab === "tasks" && <TaskQueue tasks={tasks} />}
      {subTab === "alerts" && <AlertTimeline alerts={alerts} />}
      {subTab === "playbooks" && <PlaybookView playbooks={PLAYBOOKS} />}
      {subTab === "agents" && <SpecializedAgentsPanel agents={specializedAgents} />}
      {subTab === "history" && <DecisionHistoryPanel entries={allDecisions} />}
      {subTab === "activity" && <ActivityLog entries={activityLog} />}
    </div>
  );
}
