import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AnimatePresence } from "framer-motion";
import {
  Inbox, FolderOpen, CheckSquare, BarChart3, BookOpen, ClipboardList,
  Bot, ChevronLeft, ArrowLeft, Sparkles,
} from "lucide-react";
import { useCscLang } from "./DemoLangContext";
import { shell, tDict } from "./citizen-i18n";
import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { tt } from "@/data/citizen-services-seed";
import { BRAND, BRAND_INK, NAVY, CANVAS, SEVERITY } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import AiChat from "./AiChat";
import MyQueueView from "./views/MyQueueView";
import CaseWorkspaceView from "./views/CaseWorkspaceView";
import ApprovalsView from "./views/ApprovalsView";
import DirectorView from "./views/DirectorView";
import KnowledgeView from "./views/KnowledgeView";
import AuditLogView from "./views/AuditLogView";

type ViewKey = "queue" | "workspace" | "approvals" | "director" | "knowledge" | "audit";

const NAV: { key: ViewKey; icon: typeof Inbox; labelKey: string }[] = [
  { key: "queue",     icon: Inbox,         labelKey: "nav_queue" },
  { key: "workspace", icon: FolderOpen,    labelKey: "nav_workspace" },
  { key: "approvals", icon: CheckSquare,   labelKey: "nav_approvals" },
  { key: "director",  icon: BarChart3,     labelKey: "nav_director" },
  { key: "knowledge", icon: BookOpen,      labelKey: "nav_knowledge" },
  { key: "audit",     icon: ClipboardList, labelKey: "nav_audit" },
];

export default function OfficerConsole() {
  const { lang, setLang } = useCscLang();
  const t = tDict(shell, lang);
  const isRtl = lang === "ar";
  const data = useCitizenServicesData();

  const [, setLocation] = useLocation();
  const [view, setView] = useState<ViewKey>("queue");
  const [activeCase, setActiveCase] = useState<string | null>("CSC-2026-1421");
  const [chatOpen, setChatOpen] = useState(false);

  const openCase = (id: string) => { setActiveCase(id); setView("workspace"); };

  const kpiCards = useMemo(() => data.kpis.slice(0, 5), [data.kpis]);

  return (
    <div className="min-h-screen flex" style={{ background: CANVAS }} dir={isRtl ? "rtl" : "ltr"}>
      {/* Sidebar */}
      <aside className={`w-64 flex-shrink-0 flex flex-col text-white`} style={{ background: NAVY }}>
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center font-extrabold" style={{ background: BRAND }}>CS</div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/60 font-bold">{t.brandTag}</p>
              <p className="text-[13px] font-bold leading-tight">{t.toolTitle}</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = view === n.key;
            return (
              <button key={n.key} onClick={() => setView(n.key)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors ${active ? "text-white" : "text-white/70 hover:text-white hover:bg-white/5"}`}
                style={active ? { background: BRAND } : undefined}>
                <Icon size={15} />
                <span>{t[n.labelKey]}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10 space-y-2">
          <Link href={`/demo/citizen-services-concierge`} className="flex items-center gap-2 text-[11px] text-white/60 hover:text-white">
            <ArrowLeft size={12} className={isRtl ? "rotate-180" : ""} />
            {t.switchView}
          </Link>
          <Link href="/marketplace/citizen-services-concierge" className="flex items-center gap-2 text-[11px] text-white/60 hover:text-white">
            <ChevronLeft size={12} className={isRtl ? "rotate-180" : ""} />
            {lang === "en" ? "Back to marketplace" : "العودة للسوق"}
          </Link>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <DemoTopBar
          marketplaceSlug="citizen-services-concierge"
          accent={getDemoAccent("citizen-services-concierge")}
          brandTag={t.brandTag}
          platformTitle={t.toolTitle}
          backLabel={lang === "en" ? "Back" : "رجوع"}
          lang={lang}
          setLang={setLang}

          persona={{
            initials: tt(data.officer.initials, lang),
            name: tt(data.officer.name, lang),
            title: tt(data.officer.role, lang),
          }}
          actionButton={
            <button onClick={() => setChatOpen(true)} className="hidden md:flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md text-white"
              style={{ background: BRAND }}>
              <Sparkles size={12} /> {t.aiAssistant}
            </button>
          }
          notifications={{
            panelTitle: t.notifications,
            unreadCount: data.alerts.length,
            items: data.alerts.map((a) => ({
              id: a.id,
              severity: a.severity as "critical" | "high" | "medium" | "low" | "info",
              title: tt(a.title, lang),
              detail: tt(a.sub, lang),
              timestamp: a.at,
              onClick: () => { if (a.caseId) openCase(a.caseId); },
            })),
          }}
          onSwitchView={() => setLocation("/demo/citizen-services-concierge")}
          switchViewLabel={t.switchView}
        />

        {/* KPI strip */}
        <div className="flex-shrink-0 px-5 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {kpiCards.map((k, i) => (
              <div key={k.id} className="bg-white rounded-xl border border-gray-100 p-3">
                <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-1">{tt(k.label, lang)}</p>
                <p className="text-xl font-extrabold" style={{ color: i === 1 ? SEVERITY.high : NAVY }}>{k.value}</p>
                <p className="text-[10.5px] text-gray-500 mt-0.5">{tt(k.sub, lang)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-5">
          {view === "queue"     && <MyQueueView onOpenCase={openCase} />}
          {view === "workspace" && <CaseWorkspaceView caseId={activeCase} onChangeCase={setActiveCase} />}
          {view === "approvals" && <ApprovalsView onOpenCase={openCase} />}
          {view === "director"  && <DirectorView />}
          {view === "knowledge" && <KnowledgeView />}
          {view === "audit"     && <AuditLogView />}
        </main>
      </div>

      {/* Floating AI button (mobile) */}
      <button onClick={() => setChatOpen(true)} className="md:hidden fixed bottom-6 end-6 w-14 h-14 rounded-full text-white shadow-xl z-40 flex items-center justify-center" style={{ background: BRAND }}>
        <Bot size={20} />
      </button>

      {/* AI panel */}
      <AnimatePresence>{chatOpen && <AiChat onClose={() => setChatOpen(false)} />}</AnimatePresence>
    </div>
  );
}
