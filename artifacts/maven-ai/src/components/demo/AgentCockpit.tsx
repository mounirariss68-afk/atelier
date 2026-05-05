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
import type {
  Scenario,
  SimCheckpoint,
  SimEvent,
  SimState,
} from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

type AgentDef = Scenario["agents"][number];

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

type LegendRow =
  | { kind: "agent"; agent: AgentDef }
  | { kind: "checkpoint"; checkpoint: SimCheckpoint };

export default function AgentCockpit({ scenario, state }: AgentCockpitProps) {
  const { lang, dir } = useLang();

  const visibleEvents = state.trace.filter(
    (e) =>
      e.agentId &&
      ["think", "tool-call", "decision", "handoff", "checkpoint", "complete"].includes(
        e.kind,
      ),
  );

  // Build the interleaved list of agent rows + checkpoint divider rows.
  // A checkpoint with `afterAgentId: X` is placed immediately under
  // agent X. Checkpoints without `afterAgentId` are appended at the end.
  const checkpointsByAfter = new Map<string, SimCheckpoint[]>();
  const trailingCheckpoints: SimCheckpoint[] = [];
  for (const cp of scenario.checkpoints) {
    if (cp.afterAgentId) {
      const arr = checkpointsByAfter.get(cp.afterAgentId) ?? [];
      arr.push(cp);
      checkpointsByAfter.set(cp.afterAgentId, arr);
    } else {
      trailingCheckpoints.push(cp);
    }
  }
  const rows: LegendRow[] = [];
  for (const a of scenario.agents) {
    rows.push({ kind: "agent", agent: a });
    const cps = checkpointsByAfter.get(a.id);
    if (cps) for (const cp of cps) rows.push({ kind: "checkpoint", checkpoint: cp });
  }
  for (const cp of trailingCheckpoints) rows.push({ kind: "checkpoint", checkpoint: cp });

  const total = scenario.events.length;
  const cursor = state.cursor;
  const progressPct = total > 0 ? Math.round((cursor / total) * 100) : 0;

  const showReadyCard = state.status === "idle" && cursor === 0 && !!scenario.readyToRun;

  return (
    <div className="bg-[#0A1F33] rounded-xl overflow-hidden border border-white/5">
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#F5A623] animate-pulse" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-white">
            {tStr({ en: "Agent cockpit", ar: "قمرة الوكلاء" }, lang)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusLegend />
          <p className="text-[10px] text-gray-400">
            {cursor} / {total} {tStr({ en: "events", ar: "أحداث" }, lang)}
          </p>
        </div>
      </div>

      {/* 4px progress bar — blue while running, green at 100% */}
      <div className="relative h-1 bg-black/40">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progressPct}%`,
            background: progressPct >= 100 ? "#196B24" : "#156082",
          }}
        />
        <span className="absolute right-2 -top-[1px] text-[9px] text-gray-300 font-mono leading-none">
          {progressPct}%
        </span>
      </div>

      <div
        className="grid"
        style={{
          gridTemplateColumns: showReadyCard ? `220px 1fr 280px` : `220px 1fr`,
          direction: dir,
        }}
      >
        {/* Legend column — agents and checkpoint dividers */}
        <div className="border-e border-white/5 bg-[#091828]">
          {rows.map((row, idx) =>
            row.kind === "agent" ? (
              <AgentLegendCell key={`a-${row.agent.id}-${idx}`} agent={row.agent} />
            ) : (
              <CheckpointLegendCell
                key={`c-${row.checkpoint.id}-${idx}`}
                checkpoint={row.checkpoint}
              />
            ),
          )}
        </div>

        {/* Swimlane track */}
        <div className="overflow-x-auto">
          <div className="flex flex-col">
            {rows.map((row, idx) =>
              row.kind === "agent" ? (
                <AgentSwimlane
                  key={`as-${row.agent.id}-${idx}`}
                  agent={row.agent}
                  events={visibleEvents.filter((e) => e.agentId === row.agent.id)}
                />
              ) : (
                <CheckpointSwimlane
                  key={`cs-${row.checkpoint.id}-${idx}`}
                  checkpoint={row.checkpoint}
                  state={state}
                />
              ),
            )}
          </div>
        </div>

        {/* Ready to Run card (idle only) — fades out once the run starts */}
        <AnimatePresence initial={false}>
          {showReadyCard && scenario.readyToRun && (
            <motion.div
              key="ready-to-run"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              <ReadyToRunCard data={scenario.readyToRun} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AgentLegendCell({ agent }: { agent: AgentDef }) {
  const { lang } = useLang();
  const isOrchestrator = agent.kind === "orchestrator";
  const indent = isOrchestrator ? 0 : 12;
  return (
    <div
      className="px-4 py-3 border-b border-white/5 flex items-start gap-2"
      style={{
        minHeight: isOrchestrator ? 80 : 64,
        paddingInlineStart: 16 + indent,
        background: isOrchestrator ? "rgba(245, 166, 35, 0.06)" : undefined,
        borderInlineStart: isOrchestrator ? "2px solid #F5A623" : undefined,
      }}
    >
      <span
        className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
        style={{ background: agent.color }}
      />
      <div className="min-w-0 flex-1">
        {isOrchestrator && (
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#F5A623] mb-0.5">
            {tStr({ en: "Orchestrator", ar: "المنسّق" }, lang)}
          </p>
        )}
        <p
          className="text-xs font-bold text-white leading-tight break-words"
          style={{ fontSize: 12 }}
        >
          {tStr(agent.name, lang)}
        </p>
        <p
          className="text-gray-400 leading-snug line-clamp-2 mt-0.5"
          style={{ fontSize: 13 }}
        >
          {tStr(agent.role, lang)}
        </p>
      </div>
    </div>
  );
}

function CheckpointLegendCell({ checkpoint }: { checkpoint: SimCheckpoint }) {
  const { lang } = useLang();
  return (
    <div
      className="px-4 py-2 border-b border-white/5 flex items-start gap-2"
      style={{
        minHeight: 48,
        background: "rgba(245, 166, 35, 0.10)",
        borderTop: "1px dashed rgba(245, 166, 35, 0.45)",
        borderBottom: "1px dashed rgba(245, 166, 35, 0.45)",
      }}
    >
      <UserCheck size={14} className="text-[#F5A623] mt-1.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#F5A623]">
          {tStr({ en: "Human checkpoint", ar: "نقطة بشرية" }, lang)}
        </p>
        <p className="text-[11px] font-semibold text-white leading-tight break-words">
          {tStr(checkpoint.human, lang)}
        </p>
      </div>
    </div>
  );
}

function AgentSwimlane({
  agent,
  events,
}: {
  agent: AgentDef;
  events: SimEvent[];
}) {
  const { lang } = useLang();
  const isOrchestrator = agent.kind === "orchestrator";
  return (
    <div
      className="border-b border-white/5 px-3 py-2 flex items-center gap-2 overflow-x-auto"
      style={{
        minHeight: isOrchestrator ? 80 : 64,
        background: isOrchestrator ? "rgba(245, 166, 35, 0.04)" : undefined,
      }}
    >
      <AnimatePresence initial={false}>
        {events.map((e) => (
          <EventChip key={e.id} event={e} accent={agent.color} />
        ))}
      </AnimatePresence>
      {events.length === 0 && (
        <div className="text-[10px] text-gray-600 italic">
          {tStr({ en: "—", ar: "—" }, lang)}
        </div>
      )}
    </div>
  );
}

function CheckpointSwimlane({
  checkpoint,
  state,
}: {
  checkpoint: SimCheckpoint;
  state: SimState;
}) {
  const { lang } = useLang();
  const decisionEvents = state.trace.filter(
    (e) => e.kind === "decision" && e.checkpointId === checkpoint.id,
  );
  const pending = state.pendingCheckpoint?.id === checkpoint.id;
  return (
    <div
      className="border-b border-white/5 px-3 py-2 flex items-center gap-2 overflow-x-auto"
      style={{
        minHeight: 48,
        background: "rgba(245, 166, 35, 0.06)",
        borderTop: "1px dashed rgba(245, 166, 35, 0.30)",
        borderBottom: "1px dashed rgba(245, 166, 35, 0.30)",
      }}
    >
      {decisionEvents.length === 0 && !pending && (
        <span className="text-[10px] text-[#F5A623]/60 italic">
          {tStr({ en: "Awaiting trigger", ar: "بانتظار التفعيل" }, lang)}
        </span>
      )}
      {pending && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="px-3 py-1.5 rounded-lg border border-[#F5A623] bg-[#F5A623]/15"
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
            {tStr({ en: "Awaiting decision", ar: "بانتظار القرار" }, lang)}
          </span>
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {decisionEvents.map((e) => (
          <EventChip key={e.id} event={e} accent="#F5A623" />
        ))}
      </AnimatePresence>
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

function StatusLegend() {
  const { lang } = useLang();
  const items: Array<{ color: string; label: { en: string; ar: string } }> = [
    { color: "#7C8A99", label: { en: "Idle", ar: "خامل" } },
    { color: "#F5A623", label: { en: "Active", ar: "نشط" } },
    { color: "#196B24", label: { en: "Complete", ar: "مكتمل" } },
    { color: "#D9534F", label: { en: "Error", ar: "خطأ" } },
  ];
  return (
    <div className="hidden md:flex items-center gap-3">
      {items.map((it) => (
        <div key={it.color} className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: it.color }}
          />
          <span className="text-[9px] uppercase tracking-widest text-gray-400">
            {tStr(it.label, lang)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReadyToRunCard({
  data,
}: {
  data: NonNullable<Scenario["readyToRun"]>;
}) {
  const { lang } = useLang();
  return (
    <aside
      className="border-s border-white/5 bg-[#091828] p-4 overflow-y-auto"
      style={{ maxHeight: 480 }}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623] mb-2">
        {tStr({ en: "Ready to Run", ar: "جاهز للتشغيل" }, lang)}
      </p>
      <p className="text-sm font-bold text-white mb-3 leading-snug">
        {tStr(data.title, lang)}
      </p>
      <table className="w-full text-[11px] mb-3">
        <tbody>
          {data.rows.map((row, i) => (
            <tr
              key={i}
              className={i === 0 ? "border-b border-white/10" : "border-b border-white/5"}
            >
              {row.map((c, j) => (
                <td
                  key={j}
                  className={`py-1.5 pe-2 ${
                    i === 0
                      ? "text-[9px] uppercase tracking-widest text-gray-400 font-bold"
                      : "text-gray-200"
                  }`}
                >
                  {tStr(c, lang)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.triggerNote && (
        <p className="text-[10px] text-gray-400 leading-relaxed border-t border-white/10 pt-2 italic">
          {tStr(data.triggerNote, lang)}
        </p>
      )}
    </aside>
  );
}
