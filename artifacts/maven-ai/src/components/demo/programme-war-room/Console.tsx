import { useState } from "react";
import { Link } from "wouter";
import { AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, FileSearch, ClipboardCheck, GitBranch, ScrollText, FileText,
  ArrowLeft, MessageCircle,
} from "lucide-react";
import { useLocation } from "wouter";
import { PwrDemoLangProvider, usePwrLang, usePwrT } from "./DemoLangContext";
import { PwrDataProvider, usePwrData } from "@/hooks/useProgrammeWarRoomData";
import { shell } from "./programme-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/cognirise-content";
import PortfolioView from "./views/PortfolioView";
import ProgrammeDetailView from "./views/ProgrammeDetailView";
import ApprovalsView from "./views/ApprovalsView";
import DependencyMapView from "./views/DependencyMapView";
import DecisionLogView from "./views/DecisionLogView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";
import { generateAlerts } from "@/data/programme-war-room-agent";
import {
  UserDemoShell, DemoBrandBlock, DemoSidebarNav, DemoLangToggle, DemoCollapseToggle,
  type DemoNavItem,
} from "@/components/demo/_shell";

type View = "portfolio" | "programme" | "approvals" | "dependency" | "decisions" | "audit";

function ConsoleInner() {
  const { lang, setLang } = usePwrLang();
  const t = usePwrT();
  const isAr = lang === "ar";
  const [, setLocation] = useLocation();
  const { setSelectedProgrammeId, recommendations } = usePwrData();
  const [view, setView] = useState<View>("portfolio");
  const [collapsed, setCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [dependencyFocus, setDependencyFocus] = useState<string | undefined>();

  const alerts = generateAlerts();
  const pendingCount = recommendations.filter((r) => r.status === "pending").length;

  const navItems: DemoNavItem<View>[] = [
    { id: "portfolio", icon: <LayoutDashboard size={16} />, label: t("navPortfolio", shell) },
    { id: "programme", icon: <FileSearch size={16} />, label: t("navProgramme", shell) },
    { id: "approvals", icon: <ClipboardCheck size={16} />, label: t("navApprovals", shell) },
    { id: "dependency", icon: <GitBranch size={16} />, label: t("navDependency", shell) },
    { id: "decisions", icon: <ScrollText size={16} />, label: t("navDecisions", shell) },
    { id: "audit", icon: <FileText size={16} />, label: t("navAudit", shell) },
  ];

  const openProgramme = (id: string) => { setSelectedProgrammeId(id); setView("programme"); };

  const handleAiNavigate = (target: string, opts?: { programmeId?: string }) => {
    if (target === "dependency") {
      setDependencyFocus(opts?.programmeId);
      setView("dependency");
    } else if (target === "approvals") setView("approvals");
    else if (target === "programme" && opts?.programmeId) openProgramme(opts.programmeId);
  };

  const sidebar = (
    <div className={`${collapsed ? "w-16" : "w-64"} h-full border-gray-200 ${isAr ? "border-l" : "border-r"} bg-white flex flex-col transition-all`}>
      <DemoBrandBlock initials="EP" title={t("platformTitle", shell)} subtitle="v1 · console" accent={BRAND} ink={BRAND_INK} collapsed={collapsed} />
      <DemoSidebarNav items={navItems} activeId={view} onSelect={setView} accent={BRAND} collapsed={collapsed} />
      <div className="px-2 py-2 border-t border-gray-100 space-y-1">
        <DemoLangToggle lang={lang} setLang={setLang} variant="sidebar-icon" collapsed={collapsed} />
        <DemoCollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} isAr={isAr} label={t("collapseMenu", shell)} />
        <Link href="/marketplace/programme-war-room" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-500 hover:bg-gray-50">
          <ArrowLeft size={16} className="rtl:rotate-180" />
          {!collapsed && <span>{t("back", shell)}</span>}
        </Link>
      </div>
    </div>
  );

  const drawers = (
    <>
      <AnimatePresence>
        {chatOpen && <AiChat onClose={() => setChatOpen(false)} onNavigate={handleAiNavigate} />}
      </AnimatePresence>
    </>
  );

  const fab = !chatOpen ? (
    <button
      onClick={() => setChatOpen(true)}
      className={`fixed bottom-6 ${isAr ? "left-6" : "right-6"} w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white z-30 hover:scale-110 transition-transform`}
      style={{ background: BRAND }}
      aria-label={t("fabAskAi", shell)}
    >
      <MessageCircle size={20} />
      <span className="absolute -top-1 -end-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full text-white" style={{ background: BRAND_INK }}>
        {t("aiBadge", shell)}
      </span>
    </button>
  ) : null;

  return (
    <UserDemoShell lang={lang} sidebar={sidebar} header={
      <DemoTopBar
        marketplaceSlug="programme-war-room"
        accent={getDemoAccent("programme-war-room")}
        brandTag={t("brandTag", shell)}
        platformTitle={t("platformTitle", shell)}
        backLabel={t("back", shell)}
        lang={lang}
        setLang={setLang}

        persona={{
          initials: t("personaInitials", shell),
          name: t("personaName", shell),
          title: t("personaTitle", shell),
        }}
        actionButton={
          <button
            onClick={() => setView("approvals")}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-white"
            style={{ background: BRAND }}
            data-testid="button-pending-approvals"
          >
            {pendingCount} {t("pendingApprovals", shell)}
          </button>
        }
        notifications={{
          panelTitle: t("agentAlerts", shell),
          seeAllLabel: t("seeAllAlerts", shell),
          onSeeAll: () => setView("approvals"),
          unreadCount: pendingCount,
          items: alerts.map((a) => ({
            id: a.id,
            severity: a.severity as "critical" | "high" | "medium" | "low" | "info",
            title: a.title[lang],
            detail: a.detail[lang],
            onClick: () => openProgramme(a.programmeId),
          })),
        }}
        onSwitchView={() => setLocation("/demo/programme-war-room")}
        switchViewLabel={t("switchView", shell)}
      />
    } drawers={drawers} fab={fab} background="#F9FAFB" height="min">
      <div className="flex-1 overflow-y-auto">
        {view === "portfolio" && <PortfolioView onOpenProgramme={openProgramme} onOpenView={(v) => setView(v as View)} />}
        {view === "programme" && <ProgrammeDetailView />}
        {view === "approvals" && <ApprovalsView />}
        {view === "dependency" && <DependencyMapView focusProgrammeId={dependencyFocus} />}
        {view === "decisions" && <DecisionLogView />}
        {view === "audit" && <AuditLogView />}
      </div>
    </UserDemoShell>
  );
}

export default function Console() {
  return (
    <PwrDemoLangProvider>
      <PwrDataProvider>
        <ConsoleInner />
      </PwrDataProvider>
    </PwrDemoLangProvider>
  );
}
