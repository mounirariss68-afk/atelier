import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Wrench,
  GitBranch,
  UserCheck,
  CheckCircle2,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import type { Scenario, SimEvent, SimState } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

interface AgentCockpitProps {
  scenario: Scenario;
  state: SimState;
}

const EVENT_ICON = {
  think: Brain,
  "tool-call": Wrench,
  decision: GitBranch,
  handoff: ArrowRight,
  checkpoint: UserCheck,
  complete: CheckCircle2,
  "emit-inbox": Sparkles,
  "update-inbox": Sparkles,
  "patch-workspace": Sparkles,
  "update-kpi": Sparkles,
} as const;

export default function AgentCockpit({ scenario, state }: AgentCockpitProps) {
  const { lang, dir } = useLang();

  // Show only events that have a visible agentId (skip pure state patches in
  // the swimlane visualisation — those still appear in the audit log).
  const visibleEvents = state.trace.filter(
    (e) =>
      e.agentId &&
      ["think", "tool-call", "decision", "handoff", "checkpoint", "complete"].includes(
        e.kind,
      ),
  );

  return (
    <div className="bg-[#0A1F33] rounded-xl overflow-hidden border border-white/5">
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#F5A623] animate-pulse" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-white">
            {tStr({ en: "Agent cockpit", ar: "قمرة الوكلاء" }, lang)}
          </p>
        </div>
        <p className="text-[10px] text-gray-400">
          {state.trace.length} / {scenario.events.length}{" "}
          {tStr({ en: "events", ar: "أحداث" }, lang)}
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: `200px 1fr`, direction: dir }}>
        {/* Agent legend column */}
        <div className="border-e border-white/5 bg-[#091828]">
          {scenario.agents.map((a) => (
            <div
              key={a.id}
              className="px-4 py-3 border-b border-white/5 flex items-start gap-2"
              style={{ minHeight: 64 }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
                style={{ background: a.color }}
              />
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  {tStr(a.name, lang)}
                </p>
                <p className="text-[10px] text-gray-400 leading-snug line-clamp-2">
                  {tStr(a.role, lang)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Swimlane track — each agent's row contains its events as cards */}
        <div className="overflow-x-auto">
          <div className="flex flex-col">
            {scenario.agents.map((a) => {
              const events = visibleEvents.filter((e) => e.agentId === a.id);
              return (
                <div
                  key={a.id}
                  className="border-b border-white/5 px-3 py-2 flex items-center gap-2 overflow-x-auto"
                  style={{ minHeight: 64 }}
                >
                  <AnimatePresence initial={false}>
                    {events.map((e) => (
                      <EventChip key={e.id} event={e} accent={a.color} />
                    ))}
                  </AnimatePresence>
                  {events.length === 0 && (
                    <div className="text-[10px] text-gray-600 italic">
                      {tStr({ en: "—", ar: "—" }, lang)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventChip({ event, accent }: { event: SimEvent; accent: string }) {
  const { lang } = useLang();
  const Icon = EVENT_ICON[event.kind] ?? Sparkles;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="flex-shrink-0 max-w-[260px] px-3 py-2 rounded-lg border bg-white/5"
      style={{ borderColor: `${accent}55` }}
      title={event.detail ? tStr(event.detail, lang) : undefined}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} style={{ color: accent }} />
        <span
          className="text-[9px] font-bold uppercase tracking-widest"
          style={{ color: accent }}
        >
          {event.kind}
        </span>
      </div>
      <p className="text-xs text-white leading-snug line-clamp-2">
        {tStr(event.label, lang)}
      </p>
      {event.toolName && (
        <p className="text-[10px] text-gray-400 mt-1 font-mono">
          {event.toolName}()
        </p>
      )}
    </motion.div>
  );
}
