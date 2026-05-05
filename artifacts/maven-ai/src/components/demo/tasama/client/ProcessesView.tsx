import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, ChevronDown, User as UserIcon, Activity, Workflow } from "lucide-react";
import { useTasamaDemoLang } from "../DemoLangContext";
import { clientProcesses, tDict } from "../tasama-i18n";
import { generateEmployeeProcesses } from "@/data/tasama-agent";
import { formatDate, getProcessTypeName, getAgentName, type EmployeeProcess } from "@/data/tasama-seed";

const CLIENT_ID = "client-alnakhla";

const STEP_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed: { bg: "bg-emerald-100", text: "text-emerald-700" },
  active: { bg: "bg-amber-100", text: "text-amber-700" },
  pending: { bg: "bg-gray-100", text: "text-gray-400" },
};

export default function ProcessesView() {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientProcesses, lang);
  const processes = useMemo(() => generateEmployeeProcesses(CLIENT_ID), []);

  const active = processes.filter((p) => p.steps.some((s) => s.status !== "completed"));
  const completed = processes.filter((p) => p.steps.every((s) => s.status === "completed"));

  const [expandedId, setExpandedId] = useState<string | null>(active[0]?.id ?? null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{t.title}</h1>
        <p className="text-xs text-gray-500 mt-0.5">{lang === "en" ? "Multi-step workflows orchestrated by your agents" : "سير عمل متعدد الخطوات يديره الوكلاء"}</p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Workflow size={15} className="text-[#0F766E]" />
          <h2 className="text-sm font-bold">{t.sectionActive}</h2>
          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{active.length}</span>
        </div>
        {active.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-xs text-gray-400">{t.noActive}</div>
        ) : (
          <div className="space-y-3">
            {active.map((p) => (
              <ProcessCard key={p.id} process={p} expanded={expandedId === p.id} onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)} />
            ))}
          </div>
        )}
      </div>

      {completed.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Check size={15} className="text-emerald-600" />
            <h2 className="text-sm font-bold">{t.sectionCompleted}</h2>
            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{completed.length}</span>
          </div>
          <div className="space-y-3">
            {completed.map((p) => (
              <ProcessCard key={p.id} process={p} expanded={expandedId === p.id} onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessCard({ process, expanded, onToggle }: { process: EmployeeProcess; expanded: boolean; onToggle: () => void }) {
  const { lang } = useTasamaDemoLang();
  const t = tDict(clientProcesses, lang);

  const completedSteps = process.steps.filter((s) => s.status === "completed").length;
  const totalSteps = process.steps.length;
  const pct = totalSteps ? (completedSteps / totalSteps) * 100 : 0;
  const allDone = completedSteps === totalSteps;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button onClick={onToggle} className="w-full px-5 py-4 text-start hover:bg-gray-50/60 transition-colors">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${allDone ? "bg-emerald-100" : "bg-amber-100"}`}>
            {allDone ? <Check size={18} className="text-emerald-700" /> : <Activity size={18} className="text-amber-700" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className="text-sm font-bold">{getProcessTypeName(process.type, lang)}</p>
              <span className="text-[10px] text-gray-400">{lang === "en" ? process.employeeName.en : process.employeeName.ar}</span>
            </div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-[10px] text-gray-400">{t.started} {formatDate(process.startedAt, lang)}</span>
              <span className="text-[10px] text-gray-400">·</span>
              <span className="text-[10px] text-gray-400">{t.estCompletion} {formatDate(process.estimatedCompletion, lang)}</span>
              <span className="text-[10px] font-semibold text-gray-500 ms-auto">{completedSteps}/{totalSteps}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full ${allDone ? "bg-emerald-500" : "bg-gradient-to-r from-[#0F766E] to-[#0D9488]"} transition-all`} style={{ width: `${pct}%` }} />
            </div>
          </div>
          <ChevronDown size={16} className={`text-gray-400 mt-2 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-gray-100"
          >
            <div className="p-5 space-y-5">
              <div>
                <p className="text-[11px] font-bold uppercase text-gray-400 mb-3 tracking-wide">{lang === "en" ? "Pipeline" : "السير"}</p>
                <div className="space-y-2.5">
                  {process.steps.map((step, i) => {
                    const sCol = STEP_STATUS_COLORS[step.status];
                    const isHuman = step.agentId === "human-checkpoint";
                    return (
                      <div key={step.id} className="flex items-start gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${sCol.bg} ${sCol.text}`}>
                          {step.status === "completed" ? <Check size={13} /> : step.status === "active" ? <Clock size={12} /> : i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="text-xs font-semibold">{lang === "en" ? step.name : step.nameAr}</p>
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${sCol.bg} ${sCol.text}`}>
                              {step.status === "completed" ? t.statusCompleted : step.status === "active" ? t.statusActive : t.statusPending}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {isHuman ? (
                              <span className="text-[10px] text-gray-500 flex items-center gap-1">
                                <UserIcon size={10} /> {step.agentName}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#0D9488] font-medium">{getAgentName(step.agentId, lang)}</span>
                            )}
                            {step.completedAt && (
                              <span className="text-[10px] text-gray-400">· {t.stepCompletedAt} {formatDate(step.completedAt, lang)}</span>
                            )}
                          </div>
                          {step.output && (
                            <p className="text-[10px] text-gray-500 mt-1 ps-2 border-s-2 border-gray-200 italic">{step.output}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {process.activityLog.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase text-gray-400 mb-3 tracking-wide">{t.activityLog}</p>
                  <div className="bg-gray-50 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                    {process.activityLog.map((log, i) => (
                      <div key={i} className="text-[11px] flex items-start gap-2">
                        <span className="text-gray-400 font-mono text-[10px] flex-shrink-0 mt-0.5">{new Date(log.timestamp).toLocaleDateString(lang === "en" ? "en-US" : "ar-SA", { month: "short", day: "numeric" })}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-700">
                            <span className="text-[#0D9488] font-semibold">{log.agentName}</span>: {log.description}
                          </p>
                          <p className="text-[10px] text-gray-500 mt-0.5">→ {log.outcome}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
