import { useState, useEffect } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard, FileSearch, ClipboardCheck, GitBranch, ScrollText, FileText,
  ChevronLeft, ChevronRight, Languages, ArrowLeft, MessageCircle,
} from "lucide-react";
import { useLocation } from "wouter";
import { PwrDemoLangProvider, usePwrLang, usePwrT } from "./DemoLangContext";
import { PwrDataProvider, usePwrData } from "@/hooks/useProgrammeWarRoomData";
import { shell } from "./programme-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import PortfolioView from "./views/PortfolioView";
import ProgrammeDetailView from "./views/ProgrammeDetailView";
import ApprovalsView from "./views/ApprovalsView";
import DependencyMapView from "./views/DependencyMapView";
import DecisionLogView from "./views/DecisionLogView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";
import { generateAlerts } from "@/data/programme-war-room-agent";

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

  const navItems: { id: View; icon: React.ReactNode; label: string }[] = [
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

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen flex flex-col bg-gray-50" style={{ fontFamily: "Inter, system-ui, -apple-system" }}>
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

      <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? "w-16" : "w-64"} flex-shrink-0 border-gray-200 ${isAr ? "border-l" : "border-r"} bg-white flex flex-col transition-all`}
      >
        <nav className="flex-1 px-2 py-3 space-y-1">
          {navItems.map((n) => {
            const active = view === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors ${active ? "text-white" : "text-gray-600 hover:bg-gray-50"}`}
                style={active ? { background: BRAND } : undefined}
                title={n.label}
              >
                <span className="flex-shrink-0">{n.icon}</span>
                {!collapsed && <span className="truncate">{n.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="px-2 py-2 border-t border-gray-100 space-y-1">
          <button onClick={() => setLang(lang === "en" ? "ar" : "en")} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-600 hover:bg-gray-50">
            <Languages size={16} />
            {!collapsed && <span>{lang === "en" ? "العربية" : "English"}</span>}
          </button>
          <button onClick={() => setCollapsed((c) => !c)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-500 hover:bg-gray-50">
            {collapsed ? (isAr ? <ChevronLeft size={16} /> : <ChevronRight size={16} />) : (isAr ? <ChevronRight size={16} /> : <ChevronLeft size={16} />)}
            {!collapsed && <span>{t("collapseMenu", shell)}</span>}
          </button>
          <Link href="/marketplace/programme-war-room" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-500 hover:bg-gray-50">
            <ArrowLeft size={16} className="rtl:rotate-180" />
            {!collapsed && <span>{t("back", shell)}</span>}
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {view === "portfolio" && <PortfolioView onOpenProgramme={openProgramme} onOpenView={(v) => setView(v as View)} />}
        {view === "programme" && <ProgrammeDetailView />}
        {view === "approvals" && <ApprovalsView />}
        {view === "dependency" && <DependencyMapView focusProgrammeId={dependencyFocus} />}
        {view === "decisions" && <DecisionLogView />}
        {view === "audit" && <AuditLogView />}
      </main>
      </div>

      {/* Floating AI button */}
      {!chatOpen && (
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
      )}

      {/* AI chat panel */}
      <AnimatePresence>
        {chatOpen && <AiChat onClose={() => setChatOpen(false)} onNavigate={handleAiNavigate} />}
      </AnimatePresence>
    </div>
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
