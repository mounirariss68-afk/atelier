import { useState } from "react";
import { Link } from "wouter";
import {
  Play,
  Pause,
  StepForward,
  RotateCcw,
  X,
  Activity,
  Inbox,
  Zap,
  Layers,
  Target,
  ScrollText,
  Gauge,
  AlertTriangle,
} from "lucide-react";
import { useScenarioEngine } from "@/lib/sim/engine";
import { useLang, tStr } from "@/lib/lang";
import type { Scenario } from "@/lib/sim/types";
import DemoTopBar from "./DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import AgentCockpit from "./AgentCockpit";
import CheckpointModal from "./CheckpointModal";
import OverviewTab from "./tabs/OverviewTab";
import LiveInboxTab from "./tabs/LiveInboxTab";
import WorkflowsTab from "./tabs/WorkflowsTab";
import WorkspaceTab from "./tabs/WorkspaceTab";
import KpisTab from "./tabs/KpisTab";
import AuditLogTab from "./tabs/AuditLogTab";

type TabId = "overview" | "inbox" | "workflows" | "workspace" | "kpis" | "audit";

const TABS: Array<{ id: TabId; label: { en: string; ar: string }; icon: typeof Activity }> = [
  { id: "overview", label: { en: "Overview", ar: "نظرة عامة" }, icon: Activity },
  { id: "inbox", label: { en: "Live inbox", ar: "صندوق وارد مباشر" }, icon: Inbox },
  { id: "workflows", label: { en: "Workflows", ar: "سير العمل" }, icon: Zap },
  { id: "workspace", label: { en: "Workspace", ar: "مساحة العمل" }, icon: Layers },
  { id: "kpis", label: { en: "KPIs", ar: "المؤشرات" }, icon: Target },
  { id: "audit", label: { en: "Audit log", ar: "سجل التدقيق" }, icon: ScrollText },
];

export default function DemoExperience({ scenario }: { scenario: Scenario }) {
  const { lang, dir, setLang } = useLang();
  const engine = useScenarioEngine(scenario);
  const [tab, setTab] = useState<TabId>("overview");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const { state } = engine;

  const progress = scenario.events.length
    ? Math.round((state.cursor / scenario.events.length) * 100)
    : 0;

  const statusLabel: Record<string, { en: string; ar: string }> = {
    idle: { en: "Idle", ar: "خامل" },
    playing: { en: "Running", ar: "يعمل" },
    paused: { en: "Paused", ar: "متوقف" },
    "awaiting-human": { en: "Awaiting human", ar: "بانتظار الإنسان" },
    complete: { en: "Complete", ar: "اكتمل" },
  };
  // Status pill mapping per spec: IDLE grey, RUNNING amber (pulsing),
  // PAUSED amber (no pulse), AWAITING-HUMAN red (treated as Error in
  // the legend), COMPLETE green.
  const statusColor: Record<string, string> = {
    idle: "#7C8A99",
    playing: "#F5A623",
    paused: "#F5A623",
    "awaiting-human": "#D9534F",
    complete: "#196B24",
  };
  const statusPulses = state.status === "playing";

  return (
    <div
      className="h-screen flex flex-col bg-[#F4F6F8] text-[#0E2841]"
      dir={dir}
    >
      {/* Top bar */}
      <DemoTopBar
        marketplaceSlug={scenario.slug}
        accent={getDemoAccent(scenario.slug, scenario.accent ?? "#F5A623")}
        brandTag={tStr({ en: "Interactive demo", ar: "عرض تفاعلي" }, lang)}
        platformTitle={tStr(scenario.toolTitle, lang)}
        backLabel={tStr({ en: "Back to detail", ar: "العودة للتفاصيل" }, lang)}
        lang={lang === "ar" ? "ar" : "en"}
        setLang={(l) => setLang(l)}
        hideLogo={scenario.slug === "tasama-payroll-hub"}
        persona={{
          initials: lang === "en" ? "AI" : "ذ",
          name: tStr({ en: "Scenario engine", ar: "محرّك السيناريو" }, lang),
          title: tStr({ en: "Demo guide", ar: "دليل العرض" }, lang),
        }}
        actionButton={
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1.5"
              style={{
                backgroundColor: statusColor[state.status] + "22",
                color: statusColor[state.status],
              }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${statusPulses ? "animate-pulse" : ""}`}
                style={{ background: statusColor[state.status] }}
              />
              {tStr(statusLabel[state.status], lang)}
            </span>
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-xs text-gray-300 hover:text-white inline-flex items-center gap-1"
              title={tStr({ en: "Reset demo", ar: "إعادة العرض" }, lang)}
            >
              <RotateCcw size={14} />
              {tStr({ en: "Reset", ar: "إعادة" }, lang)}
            </button>
            <Link
              href={`/marketplace/${scenario.slug}`}
              className="text-xs text-gray-300 hover:text-white inline-flex items-center gap-1"
              title={tStr({ en: "Exit demo", ar: "إغلاق العرض" }, lang)}
            >
              <X size={14} />
              {tStr({ en: "Exit", ar: "خروج" }, lang)}
            </Link>
          </div>
        }
      />
      {/* Progress bar — blue while running, green at 100% */}
      <div className="h-0.5 bg-black/30 flex-shrink-0">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progress}%`,
            background: progress >= 100 ? "#196B24" : "#156082",
          }}
        />
      </div>

      {/* Main row: left rail + content */}
      <div className="flex-1 min-h-0 flex">
        {/* Left rail */}
        <nav className="flex-shrink-0 w-44 bg-white border-e border-gray-200 flex flex-col">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-4 py-3 flex items-center gap-3 text-sm font-semibold border-l-2 transition-colors text-start ${
                  active
                    ? "border-[#F5A623] text-[#0E2841] bg-[#F5A623]/5"
                    : "border-transparent text-gray-500 hover:text-[#0E2841] hover:bg-gray-50"
                }`}
              >
                <Icon size={16} />
                {tStr(t.label, lang)}
              </button>
            );
          })}
        </nav>

        {/* Content area — extra bottom padding so the sticky bar never overlaps */}
        <div className="flex-1 min-w-0 overflow-y-auto" style={{ paddingBottom: 72 }}>
          <div className="max-w-7xl mx-auto p-5 space-y-5">
            {/* Cockpit always at the top */}
            <AgentCockpit scenario={scenario} state={state} />
            <div>
              {tab === "overview" && <OverviewTab scenario={scenario} />}
              {tab === "inbox" && <LiveInboxTab state={state} scenario={scenario} />}
              {tab === "workflows" && <WorkflowsTab scenario={scenario} />}
              {tab === "workspace" && <WorkspaceTab state={state} />}
              {tab === "kpis" && <KpisTab state={state} />}
              {tab === "audit" && <AuditLogTab scenario={scenario} state={state} engine={engine} />}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky bottom tick bar */}
      <footer
        className="bg-white border-t border-gray-200 px-4 flex items-center gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]"
        style={{
          position: "fixed",
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          height: 56,
          zIndex: 40,
        }}
      >
        <button
          type="button"
          onClick={engine.play}
          disabled={
            state.status === "playing" ||
            state.status === "complete" ||
            !!state.pendingCheckpoint
          }
          className="px-4 py-2 rounded-lg bg-[#196B24] text-white font-bold text-sm inline-flex items-center gap-2 disabled:opacity-40"
        >
          <Play size={14} fill="currentColor" />
          {tStr({ en: "Play", ar: "تشغيل" }, lang)}
        </button>
        <button
          type="button"
          onClick={engine.pause}
          disabled={state.status !== "playing"}
          className="px-3 py-2 rounded-lg border border-gray-300 text-[#0E2841] text-sm inline-flex items-center gap-2 disabled:opacity-40"
        >
          <Pause size={14} />
          {tStr({ en: "Pause", ar: "إيقاف" }, lang)}
        </button>
        <button
          type="button"
          onClick={engine.step}
          disabled={state.status === "complete" || !!state.pendingCheckpoint}
          className="px-3 py-2 rounded-lg border border-gray-300 text-[#0E2841] text-sm inline-flex items-center gap-2 disabled:opacity-40"
        >
          <StepForward size={14} />
          {tStr({ en: "Step", ar: "خطوة" }, lang)}
        </button>
        <button
          type="button"
          onClick={engine.rewindOne}
          disabled={state.cursor === 0}
          className="px-3 py-2 rounded-lg border border-gray-300 text-[#0E2841] text-sm inline-flex items-center gap-2 disabled:opacity-40"
        >
          <RotateCcw size={14} />
          {tStr({ en: "Rewind", ar: "تراجع" }, lang)}
        </button>
        {/* Speed slider — between Rewind and Simulate Exception */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200">
          <Gauge size={12} className="text-gray-500" />
          <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
            {tStr({ en: "Speed", ar: "السرعة" }, lang)}: {state.speedMs}ms
          </span>
          <input
            type="range"
            min={300}
            max={3000}
            step={100}
            value={state.speedMs}
            onChange={(e) => engine.setSpeed(Number(e.target.value))}
            className="w-28"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const orchestrator =
              scenario.agents.find((a) => a.kind === "orchestrator") ?? scenario.agents[0];
            engine.injectEvent({
              id: `inject-${state.trace.length + 1}`,
              kind: "think",
              agentId: orchestrator?.id,
              label: {
                en: "Exception simulated — re-evaluating priorities",
                ar: "تمت محاكاة استثناء — إعادة تقييم الأولويات",
              },
              detail: {
                en: "User simulated an exception. The orchestrator absorbs it into its working context without restarting the run.",
                ar: "حاكى المستخدم استثناءً. يستوعبه المنسّق ضمن السياق العامل دون إعادة التشغيل.",
              },
            });
          }}
          disabled={!!state.pendingCheckpoint || state.status === "complete"}
          className="px-3 py-2 rounded-lg border border-[#F5A623]/50 text-[#5A3000] bg-[#F5A623]/10 hover:bg-[#F5A623]/20 text-sm inline-flex items-center gap-2 disabled:opacity-40"
          title={tStr(
            {
              en: "Inject a synthetic exception (e.g. an unexpected document or compliance flag) to see how the orchestrator reacts in real time.",
              ar: "أدخِل استثناءً اصطناعياً (مثل وثيقة غير متوقعة أو تنبيه امتثال) لمشاهدة كيفية تفاعل المنسّق في الوقت الفعلي.",
            },
            lang,
          )}
        >
          <AlertTriangle size={14} />
          {tStr({ en: "Simulate Exception", ar: "محاكاة استثناء" }, lang)}
        </button>
        <div className="flex-1" />
        <p className="text-xs text-gray-500">
          {tStr({ en: "Step", ar: "خطوة" }, lang)} {state.cursor} /{" "}
          {scenario.events.length}
        </p>
      </footer>

      <CheckpointModal
        checkpoint={state.pendingCheckpoint}
        onResolve={engine.resolveCheckpoint}
        onDismiss={engine.pause}
      />

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <p className="text-lg font-bold text-[#0E2841] mb-2">
              {tStr({ en: "Reset Demo?", ar: "إعادة العرض؟" }, lang)}
            </p>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              {tStr(
                {
                  en: "This will rewind the cockpit to step 0 and discard the current run trace. Pre-seeded history (previous runs, KPIs at start) is kept.",
                  ar: "سيؤدي ذلك إلى إعادة القمرة إلى الخطوة 0 وحذف سجل الدورة الحالية. سيتم الاحتفاظ بالتاريخ المعبأ مسبقاً (الدورات السابقة والمؤشرات الأولية).",
                },
                lang,
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                {tStr({ en: "Cancel", ar: "إلغاء" }, lang)}
              </button>
              <button
                type="button"
                onClick={() => {
                  engine.reset();
                  setShowResetConfirm(false);
                }}
                className="px-4 py-2 rounded-lg bg-[#D9534F] text-white text-sm font-bold hover:bg-[#B83A36]"
              >
                {tStr({ en: "Reset", ar: "إعادة" }, lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
