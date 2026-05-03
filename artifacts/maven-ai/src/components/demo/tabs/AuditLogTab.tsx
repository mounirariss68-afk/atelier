import { Brain, Wrench, GitBranch, ArrowRight, UserCheck, CheckCircle2, Sparkles } from "lucide-react";
import type { Scenario, SimEvent, SimState } from "@/lib/sim/types";
import { useLang, tStr } from "@/lib/lang";

const ICON_FOR = {
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

export default function AuditLogTab({
  scenario,
  state,
}: {
  scenario: Scenario;
  state: SimState;
}) {
  const { lang } = useLang();
  if (state.trace.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
        <p className="text-sm">
          {tStr(
            {
              en: "Audit log is empty. Press Play — every agent action gets a timestamped, citation-ready entry here.",
              ar: "سجل التدقيق فارغ. اضغط تشغيل — كل إجراء للوكيل سيحصل على إدخال موقّت قابل للاستشهاد هنا.",
            },
            lang,
          )}
        </p>
      </div>
    );
  }
  const agentName = (id?: string) =>
    id ? scenario.agents.find((a) => a.id === id)?.name ?? { en: id, ar: id } : null;
  const agentColor = (id?: string) =>
    (id && scenario.agents.find((a) => a.id === id)?.color) || "#156082";

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="max-h-[640px] overflow-y-auto divide-y divide-gray-100">
        {state.trace.map((ev, i) => (
          <Row
            key={ev.id}
            ev={ev}
            index={i + 1}
            agent={agentName(ev.agentId)}
            color={agentColor(ev.agentId)}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  ev,
  index,
  agent,
  color,
}: {
  ev: SimEvent;
  index: number;
  agent: { en: string; ar: string } | null;
  color: string;
}) {
  const { lang } = useLang();
  const Icon = ICON_FOR[ev.kind] ?? Sparkles;
  return (
    <div className="px-4 py-3 flex gap-3">
      <span className="w-8 text-[10px] text-gray-400 font-mono pt-1">#{index}</span>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: color + "22" }}
      >
        <Icon size={12} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          {agent && (
            <span
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color }}
            >
              {tStr(agent, lang)}
            </span>
          )}
          <span className="text-[10px] text-gray-400 font-mono">{ev.kind}</span>
          {ev.toolName && (
            <span className="text-[10px] text-[#156082] font-mono">{ev.toolName}()</span>
          )}
        </div>
        <p className="text-sm text-[#0E2841] font-semibold">{tStr(ev.label, lang)}</p>
        {ev.detail && (
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            {tStr(ev.detail, lang)}
          </p>
        )}
        {ev.toolResult && (
          <p className="text-xs text-gray-700 mt-1 italic font-mono bg-gray-50 px-2 py-1 rounded">
            ↳ {tStr(ev.toolResult, lang)}
          </p>
        )}
      </div>
    </div>
  );
}
