import { useState } from "react";
import { Link } from "wouter";
import {
  Play,
  Pause,
  StepForward,
  RotateCcw,
  ChevronLeft,
  Globe,
  X,
  Activity,
  Inbox,
  Zap,
  Layers,
  Target,
  ScrollText,
  Gauge,
} from "lucide-react";
import { useScenarioEngine } from "@/lib/sim/engine";
import { useLang, tStr } from "@/lib/lang";
import type { Scenario } from "@/lib/sim/types";
import Logo from "@/components/Logo";
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
  const statusColor: Record<string, string> = {
    idle: "#666",
    playing: "#196B24",
    paused: "#F5A623",
    "awaiting-human": "#D9534F",
    complete: "#156082",
  };

  return (
    <div
      className="h-screen flex flex-col bg-[#F4F6F8] text-[#0E2841]"
      dir={dir}
    >
      {/* Top bar */}
      <header className="flex-shrink-0 bg-[#0E2841] text-white border-b border-black/20">
        <div className="h-14 px-4 flex items-center gap-4">
          <Link
            href={`/marketplace/${scenario.slug}`}
            className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white"
          >
            <ChevronLeft size={14} className="rtl:rotate-180" />
            {tStr({ en: "Back to detail", ar: "العودة للتفاصيل" }, lang)}
          </Link>
          <div className="h-5 w-px bg-white/20" />
          <Logo className="h-6 w-auto text-white" />
          <div className="h-5 w-px bg-white/20" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#F5A623]">
              {tStr({ en: "Interactive demo", ar: "عرض تفاعلي" }, lang)}
            </p>
            <p className="text-sm font-bold truncate">{tStr(scenario.toolTitle, lang)}</p>
          </div>
          <span
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1.5"
            style={{
              backgroundColor: statusColor[state.status] + "22",
              color: statusColor[state.status],
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: statusColor[state.status] }}
            />
            {tStr(statusLabel[state.status], lang)}
          </span>
          <button
            type="button"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="text-xs text-gray-300 hover:text-white inline-flex items-center gap-1"
            title="Toggle language"
          >
            <Globe size={14} />
            {lang === "en" ? "AR" : "EN"}
          </button>
          <button
            type="button"
            onClick={engine.reset}
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
        {/* Progress bar */}
        <div className="h-0.5 bg-black/30">
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${progress}%`,
              background: scenario.accent,
            }}
          />
        </div>
      </header>

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
          <div className="mt-auto p-4 border-t border-gray-100">
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <Gauge size={12} />
              <span>
                {tStr({ en: "Speed", ar: "السرعة" }, lang)}: {state.speedMs}ms
              </span>
            </div>
            <input
              type="range"
              min={300}
              max={3000}
              step={100}
              value={state.speedMs}
              onChange={(e) => engine.setSpeed(Number(e.target.value))}
              className="w-full mt-2"
            />
          </div>
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-5 space-y-5">
            {/* Cockpit always at the top */}
            <AgentCockpit scenario={scenario} state={state} />
            <div>
              {tab === "overview" && <OverviewTab scenario={scenario} />}
              {tab === "inbox" && <LiveInboxTab state={state} />}
              {tab === "workflows" && <WorkflowsTab scenario={scenario} />}
              {tab === "workspace" && <WorkspaceTab state={state} />}
              {tab === "kpis" && <KpisTab state={state} />}
              {tab === "audit" && <AuditLogTab scenario={scenario} state={state} />}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom tick controls */}
      <footer className="flex-shrink-0 h-14 bg-white border-t border-gray-200 px-4 flex items-center gap-2">
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
    </div>
  );
}
