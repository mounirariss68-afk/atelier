import {
  Brain,
  Wrench,
  GitBranch,
  ArrowRight,
  UserCheck,
  CheckCircle2,
  Sparkles,
  Download,
} from "lucide-react";
import type { Scenario, SimEvent, SimState } from "@/lib/sim/types";
import type { EngineApi } from "@/lib/sim/engine";
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
  engine,
}: {
  scenario: Scenario;
  state: SimState;
  engine?: EngineApi;
}) {
  const { lang } = useLang();
  const previousRun = scenario.previousRun;
  const liveCount = state.trace.length;

  function downloadAudit() {
    if (!engine) return;
    const json = engine.exportAudit();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.slug}-audit-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const downloadButton = engine ? (
    <button
      type="button"
      onClick={downloadAudit}
      disabled={liveCount === 0}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0A1230] text-white text-xs font-bold hover:bg-[#5B7CFF] disabled:opacity-40 disabled:cursor-not-allowed"
      title={
        liveCount === 0
          ? tStr(
              {
                en: "Run the simulation first to generate an audit trail for download.",
                ar: "شغّل المحاكاة أولاً لإنشاء سجل تدقيق قابل للتحميل.",
              },
              lang,
            )
          : undefined
      }
    >
      <Download size={12} />
      {tStr(
        { en: "Download audit trail (JSON)", ar: "تحميل سجل التدقيق (JSON)" },
        lang,
      )}
    </button>
  ) : null;

  // Empty state — no live entries AND no previous run.
  if (liveCount === 0 && (!previousRun || previousRun.entries.length === 0)) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-500">
        <p className="text-sm mb-4">
          {tStr(
            {
              en: "Audit log is empty. Press Play — every agent action gets a timestamped, citation-ready entry here.",
              ar: "سجل التدقيق فارغ. اضغط تشغيل — كل إجراء للوكيل سيحصل على إدخال موقّت قابل للاستشهاد هنا.",
            },
            lang,
          )}
        </p>
        {downloadButton}
      </div>
    );
  }

  const agentName = (id?: string) =>
    id ? scenario.agents.find((a) => a.id === id)?.name ?? { en: id, ar: id } : null;
  const agentColor = (id?: string) =>
    (id && scenario.agents.find((a) => a.id === id)?.color) || "#5B7CFF";

  const totalForCount = liveCount + (previousRun?.entries.length ?? 0);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
          {tStr(
            {
              en: `${totalForCount} entries`,
              ar: `${totalForCount} إدخالاً`,
            },
            lang,
          )}
        </p>
        {downloadButton}
      </div>
      <div className="max-h-[640px] overflow-y-auto divide-y divide-gray-100">
        {previousRun && previousRun.entries.length > 0 && (
          <>
            <SectionSeparator
              label={previousRun.label}
              tone="muted"
            />
            {previousRun.entries.map((ev, i) => (
              <Row
                key={`prev-${ev.id}`}
                ev={ev}
                index={i + 1}
                agent={agentName(ev.agentId)}
                color={agentColor(ev.agentId)}
                muted
              />
            ))}
            <SectionSeparator
              label={
                previousRun.currentLabel ?? {
                  en: "Current Run (In Progress)",
                  ar: "الدورة الحالية (قيد التنفيذ)",
                }
              }
              tone="active"
            />
            {liveCount === 0 && (
              <p className="px-4 py-4 text-xs text-gray-500 italic">
                {tStr(
                  {
                    en: "No current-run entries yet. Press Play to begin.",
                    ar: "لا توجد إدخالات للدورة الحالية بعد. اضغط تشغيل للبدء.",
                  },
                  lang,
                )}
              </p>
            )}
          </>
        )}
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

function SectionSeparator({
  label,
  tone,
}: {
  label: { en: string; ar: string };
  tone: "muted" | "active";
}) {
  const { lang } = useLang();
  return (
    <div
      className="px-4 py-2"
      style={{
        background: tone === "muted" ? "#F8F9FA" : "#FEF7E5",
      }}
    >
      <p
        className="text-[10px] uppercase tracking-widest font-bold italic"
        style={{
          color: tone === "muted" ? "#7C8A99" : "#5A3000",
        }}
      >
        {tStr(label, lang)}
      </p>
    </div>
  );
}

function Row({
  ev,
  index,
  agent,
  color,
  muted = false,
}: {
  ev: SimEvent;
  index: number;
  agent: { en: string; ar: string } | null;
  color: string;
  muted?: boolean;
}) {
  const { lang } = useLang();
  const Icon = ICON_FOR[ev.kind] ?? Sparkles;
  return (
    <div
      className="px-4 py-3 flex gap-3"
      style={muted ? { opacity: 0.72, background: "#FAFBFC" } : undefined}
    >
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
            <span className="text-[10px] text-[#5B7CFF] font-mono">{ev.toolName}()</span>
          )}
        </div>
        <p className="text-sm text-[#0A1230] font-semibold">{tStr(ev.label, lang)}</p>
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
