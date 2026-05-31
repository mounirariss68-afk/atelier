import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence } from "framer-motion";
import {
  Inbox, FolderOpen, CheckSquare, BarChart3, BookOpen, ClipboardList,
  Bot, Sparkles,
} from "lucide-react";
import { useCscLang } from "./DemoLangContext";
import { shell, tDict } from "./citizen-i18n";
import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { tt } from "@/data/citizen-services-seed";
import { BRAND, NAVY, CANVAS, SEVERITY } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/cognirise-content";
import AiChat from "./AiChat";
import MyQueueView from "./views/MyQueueView";
import CaseWorkspaceView from "./views/CaseWorkspaceView";
import ApprovalsView from "./views/ApprovalsView";
import DirectorView from "./views/DirectorView";
import KnowledgeView from "./views/KnowledgeView";
import AuditLogView from "./views/AuditLogView";
import { UserDemoShell, DemoBrandBlock, DemoSidebarNav } from "@/components/demo/_shell";

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
  const data = useCitizenServicesData();

  const [, setLocation] = useLocation();
  const [view, setView] = useState<ViewKey>("queue");
  const [activeCase, setActiveCase] = useState<string | null>("CSC-2026-1421");
  const [chatOpen, setChatOpen] = useState(false);

  const openCase = (id: string) => { setActiveCase(id); setView("workspace"); };
  const kpiCards = useMemo(() => data.kpis.slice(0, 5), [data.kpis]);

  const sidebar = (
    <div className="flex flex-col h-full overflow-hidden">
      <DemoBrandBlock
        initials="CS"
        title={t.toolTitle}
        subtitle={t.brandTag}
        accent={BRAND}
        surface="navy"
      />
      <div className="flex-1 flex flex-col min-h-0" style={{ background: NAVY }}>
        <DemoSidebarNav
          items={NAV.map(n => ({
            id: n.key,
            label: t[n.labelKey],
            icon: <n.icon size={15} />,
          }))}
          activeId={view}
          onSelect={(id) => setView(id as ViewKey)}
          accent={BRAND}
          surface="navy"
          fontSize={13}
        />
        <div className="mt-auto p-3 border-t border-white/10">
          <DemoSidebarNav
            items={[
              {
                id: "switch",
                label: t.switchView,
                icon: <Bot size={15} />,
              },
              {
                id: "back",
                label: lang === "en" ? "Back to marketplace" : "العودة للسوق",
                icon: <Bot size={15} />,
              }
            ]}
            activeId=""
            onSelect={(id) => {
              if (id === "switch") setLocation("/demo/citizen-services-concierge");
              if (id === "back") setLocation("/marketplace/citizen-services-concierge");
            }}
            accent={BRAND}
            surface="navy"
            fontSize={12}
          />
        </div>
      </div>
    </div>
  );

  const topbar = (
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
  );

  const belowTopbar = (
    <div className="px-5 pt-4">
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
  );

  const fab = (
    <button onClick={() => setChatOpen(true)} className="md:hidden fixed bottom-6 end-6 w-14 h-14 rounded-full text-white shadow-xl z-40 flex items-center justify-center" style={{ background: BRAND }}>
      <Bot size={20} />
    </button>
  );

  const drawers = (
    <AnimatePresence>{chatOpen && <AiChat onClose={() => setChatOpen(false)} />}</AnimatePresence>
  );

  return (
    <UserDemoShell
      lang={lang}
      sidebar={sidebar}
      header={topbar}
      belowTopbar={belowTopbar}
      fab={fab}
      drawers={drawers}
      background={CANVAS}
      height="min"
      applyInterFont={false}
    >
      <main className="flex-1 overflow-y-auto p-5">
        {view === "queue"     && <MyQueueView onOpenCase={openCase} />}
        {view === "workspace" && <CaseWorkspaceView caseId={activeCase} onChangeCase={setActiveCase} />}
        {view === "approvals" && <ApprovalsView onOpenCase={openCase} />}
        {view === "director"  && <DirectorView />}
        {view === "knowledge" && <KnowledgeView />}
        {view === "audit"     && <AuditLogView />}
      </main>
    </UserDemoShell>
  );
}
