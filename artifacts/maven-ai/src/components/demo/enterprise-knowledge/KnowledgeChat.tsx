import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  MessageSquare, Library, ClipboardCheck, FileText, Settings2,
  ArrowLeft,
} from "lucide-react";
import { EkcDemoLangProvider, useEkcLang, useEkcT } from "./DemoLangContext";
import { EkcDataProvider, useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { shell } from "./knowledge-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import ChatView from "./views/ChatView";
import SourceLibraryView from "./views/SourceLibraryView";
import ApprovalsView from "./views/ApprovalsView";
import AuditDrawerView from "./views/AuditDrawerView";
import KnowledgeOpsView from "./views/KnowledgeOpsView";
import { generateAlerts } from "@/data/enterprise-knowledge-agent";
import {
  UserDemoShell, DemoBrandBlock, DemoSidebarNav, DemoLangToggle, DemoCollapseToggle,
  type DemoNavItem,
} from "@/components/demo/_shell";

type View = "chat" | "sources" | "approvals" | "audit" | "ops";

function ConsoleInner() {
  const { lang, setLang } = useEkcLang();
  const t = useEkcT();
  const isAr = lang === "ar";
  const [, setLocation] = useLocation();
  const { recommendations, personas, personaId } = useEkcData();
  const currentPersona = personas.find((p) => p.id === personaId)!;

  const [view, setView] = useState<View>("chat");
  const [collapsed, setCollapsed] = useState(false);

  const alerts = generateAlerts();
  const pendingCount = recommendations.filter((r) => r.status === "pending").length;

  const navItems: DemoNavItem<View>[] = [
    { id: "chat", icon: <MessageSquare size={16} />, label: t("navChat", shell) },
    { id: "sources", icon: <Library size={16} />, label: t("navSources", shell) },
    { id: "approvals", icon: <ClipboardCheck size={16} />, label: t("navApprovals", shell), badge: t("aiBadge", shell), badgeTone: "ai" },
    { id: "audit", icon: <FileText size={16} />, label: t("navAudit", shell) },
    { id: "ops", icon: <Settings2 size={16} />, label: t("navOps", shell) },
  ];

  const sidebar = (
    <div className={`${collapsed ? "w-16" : "w-64"} h-full border-gray-200 ${isAr ? "border-l" : "border-r"} bg-white flex flex-col transition-all`}>
      <DemoBrandBlock initials="KC" title={t("platformTitle", shell)} subtitle={t("platformSub", shell)} accent={BRAND} ink={BRAND_INK} collapsed={collapsed} />
      <DemoSidebarNav items={navItems} activeId={view} onSelect={setView} accent={BRAND} collapsed={collapsed} />
      <div className="px-2 py-2 border-t border-gray-100 space-y-1">
        <DemoLangToggle lang={lang} setLang={setLang} variant="sidebar-icon" collapsed={collapsed} />
        <DemoCollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} isAr={isAr} label={t("collapseMenu", shell)} />
        <Link href="/marketplace/enterprise-knowledge-concierge" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-500 hover:bg-gray-50">
          <ArrowLeft size={16} className="rtl:rotate-180" />
          {!collapsed && <span>{t("back", shell)}</span>}
        </Link>
      </div>
    </div>
  );

  return (
    <UserDemoShell
      lang={lang}
      sidebar={sidebar}
      header={
        <DemoTopBar
          marketplaceSlug="enterprise-knowledge-concierge"
          accent={getDemoAccent("enterprise-knowledge-concierge")}
          brandTag={t("brandTag", shell)}
          platformTitle={t("platformTitle", shell)}
          backLabel={t("back", shell)}
          lang={lang}
          setLang={setLang}
          persona={{
            initials: currentPersona.initials[lang],
            name: currentPersona.name[lang],
            title: currentPersona.role[lang],
          }}
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
              onClick: () => setView("approvals"),
            })),
          }}
          onSwitchView={() => setLocation("/demo/enterprise-knowledge-concierge")}
          switchViewLabel={t("switchView", shell)}
        />
      }
      background="#F9FAFB"
      height="min"
    >
      {view === "chat" && <ChatView onNavigate={(v) => setView(v as View)} />}
      {view === "sources" && <div className="flex-1 overflow-y-auto"><SourceLibraryView /></div>}
      {view === "approvals" && <div className="flex-1 overflow-y-auto"><ApprovalsView /></div>}
      {view === "audit" && <div className="flex-1 overflow-y-auto"><AuditDrawerView /></div>}
      {view === "ops" && <div className="flex-1 overflow-y-auto"><KnowledgeOpsView /></div>}
    </UserDemoShell>
  );
}

export default function KnowledgeChat() {
  return (
    <EkcDemoLangProvider>
      <EkcDataProvider>
        <ConsoleInner />
      </EkcDataProvider>
    </EkcDemoLangProvider>
  );
}
