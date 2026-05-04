import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  AlertTriangle, Clock, ListTodo, Activity, Shield, Zap,
  DollarSign, TrendingUp, Filter, BarChart3,
  Play, Pause, CheckCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  generateRecommendations, generateTasks, generateAlerts,
  generateActivityLog, PLAYBOOKS,
  type AgentRecommendation, type AgentTask, type AgentAlert,
  type AgentPlaybook, type AgentActivityEntry,
  type DirectorRole, type Severity,
} from "@/data/arcelik-agent";

type SubTab = "recommendations" | "tasks" | "alerts" | "playbooks" | "activity";

const ROLE_LABELS: Record<DirectorRole, string> = {
  pricing: "Fiyatlandırma",
  finance: "Finans",
  marketing: "Pazarlama",
};
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
const SEV_LABELS: Record<Severity, string> = {
  critical: "Kritik",
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} dk önce`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} saat önce`;
  return `${Math.floor(hrs / 24)} gün önce`;
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
  return (
    <div className="mt-3 space-y-2">
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
        <Brain size={11} /> Akıl Yürütme Zinciri
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

function RecommendationCard({ rec, onApprove, onReject }: {
  rec: AgentRecommendation;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
        rec.status === "approved" ? "border-green-200" : rec.status === "rejected" ? "border-red-200" : "border-gray-100"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${SEV_DOT[rec.severity]}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEV_COLORS[rec.severity]}`}>{SEV_LABELS[rec.severity]}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[rec.targetRole]}`}>{ROLE_LABELS[rec.targetRole]} Direktörü</span>
              <ConfidenceBadge value={rec.confidence} />
              <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-0.5"><Clock size={10} />{timeAgo(rec.createdAt)}</span>
            </div>
            <h4 className="text-sm font-bold text-[#0E2841] mb-1">{rec.title}</h4>
            <p className="text-xs text-gray-600">{rec.summary}</p>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <DollarSign size={12} className="mx-auto text-gray-400 mb-0.5" />
                <p className="text-xs font-bold text-[#0E2841]">{rec.impact.revenue}</p>
                <p className="text-[9px] text-gray-400">Gelir</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <BarChart3 size={12} className="mx-auto text-gray-400 mb-0.5" />
                <p className="text-xs font-bold text-[#0E2841]">{rec.impact.margin}</p>
                <p className="text-[9px] text-gray-400">Marj</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 text-center">
                <TrendingUp size={12} className="mx-auto text-gray-400 mb-0.5" />
                <p className="text-xs font-bold text-[#0E2841]">{rec.impact.share}</p>
                <p className="text-[9px] text-gray-400">Pazar Payı</p>
              </div>
            </div>

            <div className="mt-3 p-3 bg-[#0E2841]/5 rounded-lg">
              <p className="text-[10px] font-bold text-[#0E2841] mb-0.5 flex items-center gap-1"><Zap size={10} /> Önerilen Aksiyon</p>
              <p className="text-xs text-[#0E2841]">{rec.recommendedAction}</p>
            </div>

            {expanded && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}>
                <ReasoningTrace reasoning={rec.reasoning} />
                {rec.alternatives.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Alternatifler</p>
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
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-between bg-gray-50/50">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-500 hover:text-[#0E2841] font-medium flex items-center gap-1"
        >
          <Brain size={12} />
          {expanded ? "Analizi Gizle" : "Akıl Yürütmeyi Göster"}
          <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {rec.status === "pending" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onReject(rec.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors flex items-center gap-1"
            >
              <XCircle size={13} /> Reddet
            </button>
            <button
              onClick={() => onApprove(rec.id)}
              className="px-3 py-1.5 rounded-lg bg-[#E30613] text-white text-xs font-bold hover:bg-[#c00510] transition-colors flex items-center gap-1"
            >
              <CheckCircle2 size={13} /> Onayla
            </button>
          </div>
        )}
        {rec.status === "approved" && (
          <span className="text-xs font-bold text-green-600 flex items-center gap-1"><CheckCircle2 size={13} /> Onaylandı</span>
        )}
        {rec.status === "rejected" && (
          <span className="text-xs font-bold text-red-500 flex items-center gap-1"><XCircle size={13} /> Reddedildi</span>
        )}
      </div>
    </motion.div>
  );
}

function TaskQueue({ tasks }: { tasks: AgentTask[] }) {
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
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEV_COLORS[task.priority]}`}>{SEV_LABELS[task.priority]}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[task.assigneeRole]}`}>{task.assignee}</span>
              </div>
              <h4 className="text-sm font-semibold text-[#0E2841]">{task.title}</h4>
              <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                <span className="flex items-center gap-1"><Clock size={10} /> Son tarih: {task.deadline}</span>
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
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SEV_COLORS[alert.severity]}`}>{SEV_LABELS[alert.severity]}</span>
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
  const statusColors: Record<string, string> = {
    triggered: "bg-blue-100 text-blue-700",
    running: "bg-amber-100 text-amber-700",
    "awaiting-approval": "bg-purple-100 text-purple-700",
    completed: "bg-green-100 text-green-700",
  };
  const statusLabels: Record<string, string> = {
    triggered: "Tetiklendi",
    running: "Çalışıyor",
    "awaiting-approval": "Onay Bekliyor",
    completed: "Tamamlandı",
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

function ActivityLog({ entries }: { entries: AgentActivityEntry[] }) {
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
  const [subTab, setSubTab] = useState<SubTab>("recommendations");
  const [roleFilter, setRoleFilter] = useState<DirectorRole | "all">("all");
  const [recommendations, setRecommendations] = useState(() => generateRecommendations());
  const tasks = useMemo(() => generateTasks(), []);
  const alerts = useMemo(() => generateAlerts(), []);
  const activityLog = useMemo(() => generateActivityLog(), []);

  const filteredRecs = roleFilter === "all" ? recommendations : recommendations.filter((r) => r.targetRole === roleFilter);
  const pendingCount = recommendations.filter((r) => r.status === "pending").length;
  const criticalCount = recommendations.filter((r) => r.severity === "critical" && r.status === "pending").length;

  const handleApprove = (id: string) => {
    setRecommendations((prev) => prev.map((r) => r.id === id ? { ...r, status: "approved" as const, decidedBy: "Elif Demir" } : r));
    const rec = recommendations.find((r) => r.id === id);
    toast({ title: "Öneri Onaylandı", description: `"${rec?.title}" onaylandı ve uygulamaya alınacak.` });
  };

  const handleReject = (id: string) => {
    setRecommendations((prev) => prev.map((r) => r.id === id ? { ...r, status: "rejected" as const, decidedBy: "Elif Demir" } : r));
    const rec = recommendations.find((r) => r.id === id);
    toast({ title: "Öneri Reddedildi", description: `"${rec?.title}" reddedildi.` });
  };

  const SUB_TABS: { id: SubTab; label: string; icon: typeof Brain; count?: number }[] = [
    { id: "recommendations", label: "Öneriler", icon: Brain, count: pendingCount },
    { id: "tasks", label: "Görevler", icon: ListTodo, count: tasks.filter((t) => t.status === "open").length },
    { id: "alerts", label: "Uyarılar", icon: AlertTriangle, count: alerts.length },
    { id: "playbooks", label: "Oyun Planları", icon: Zap, count: PLAYBOOKS.filter((p) => p.status !== "completed").length },
    { id: "activity", label: "Ajan Aktivitesi", icon: Activity },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#0E2841] flex items-center gap-2">
          <Brain size={20} className="text-[#E30613]" /> Ajan Kararları & Otonom İstihbarat
        </h2>
        {criticalCount > 0 && (
          <span className="text-xs font-bold bg-red-100 text-red-700 px-3 py-1 rounded-full flex items-center gap-1 animate-pulse">
            <AlertTriangle size={12} /> {criticalCount} kritik karar bekliyor
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                subTab === t.id ? "bg-white text-[#0E2841] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <t.icon size={13} /> {t.label}
              {t.count != null && t.count > 0 && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  subTab === t.id ? "bg-[#E30613] text-white" : "bg-gray-200 text-gray-600"
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {subTab === "recommendations" && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Filter size={13} className="text-gray-400" />
            {(["all", "pricing", "finance", "marketing"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  roleFilter === r ? "bg-[#0E2841] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {r === "all" ? "Tümü" : ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Brain size={14} className="text-[#E30613]" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">Bekleyen Karar</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{pendingCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <ListTodo size={14} className="text-blue-500" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">Açık Görev</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{tasks.filter((t) => t.status === "open").length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-[#F5A623]" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">Aktif Playbook</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{PLAYBOOKS.filter((p) => p.status !== "completed").length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3.5">
          <div className="flex items-center gap-2 mb-1">
            <Activity size={14} className="text-purple-500" />
            <span className="text-[10px] font-semibold text-gray-500 uppercase">Son 24s Aksiyon</span>
          </div>
          <p className="text-2xl font-extrabold text-[#0E2841]">{activityLog.length}</p>
        </div>
      </div>

      {subTab === "recommendations" && (
        <div className="space-y-4">
          {filteredRecs.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} onApprove={handleApprove} onReject={handleReject} />
          ))}
        </div>
      )}

      {subTab === "tasks" && <TaskQueue tasks={tasks} />}
      {subTab === "alerts" && <AlertTimeline alerts={alerts} />}
      {subTab === "playbooks" && <PlaybookView playbooks={PLAYBOOKS} />}
      {subTab === "activity" && <ActivityLog entries={activityLog} />}
    </div>
  );
}
