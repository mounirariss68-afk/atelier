import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { AnimatePresence } from "framer-motion";
import {
  Database, FileSearch, ClipboardCheck, GitBranch, ScrollText, BookOpen,
  ArrowLeft, MessageCircle, Sparkles,
} from "lucide-react";
import { SdsDemoLangProvider, useSdsLang, useSdsT } from "./DemoLangContext";
import { SdsDataProvider, useSdsData } from "@/hooks/useSovereignDataData";
import { shell } from "./sovereign-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import CatalogueView from "./views/CatalogueView";
import ProductDetailView from "./views/ProductDetailView";
import ApprovalsView from "./views/ApprovalsView";
import LineageMapView from "./views/LineageMapView";
import ObligationsRegisterView from "./views/ObligationsRegisterView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";
import { generateAlerts } from "@/data/sovereign-data-agent";
import {
  UserDemoShell, DemoBrandBlock, DemoSidebarNav, DemoLangToggle, DemoCollapseToggle,
  type DemoNavItem,
} from "@/components/demo/_shell";

type View = "catalogue" | "product" | "approvals" | "lineage" | "obligations" | "audit";

function ConsoleInner() {
  const { lang, setLang } = useSdsLang();
  const t = useSdsT();
  const isAr = lang === "ar";
  const [, setLocation] = useLocation();
  const { setSelectedProductId, recommendations } = useSdsData();
  const [view, setView] = useState<View>("catalogue");
  const [collapsed, setCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [lineageFocus, setLineageFocus] = useState<string | undefined>();

  const alerts = generateAlerts();
  const pendingCount = recommendations.filter((r) => r.status === "pending").length;

  const navItems: DemoNavItem<View>[] = [
    { id: "catalogue", icon: <Database size={16} />, label: t("navCatalogue", shell) },
    { id: "product", icon: <FileSearch size={16} />, label: t("navProduct", shell) },
    { id: "approvals", icon: <ClipboardCheck size={16} />, label: t("navApprovals", shell) },
    { id: "lineage", icon: <GitBranch size={16} />, label: t("navLineage", shell) },
    { id: "obligations", icon: <BookOpen size={16} />, label: t("navObligations", shell) },
    { id: "audit", icon: <ScrollText size={16} />, label: t("navAudit", shell) },
  ];

  const openProduct = (id: string) => { setSelectedProductId(id); setView("product"); };

  const handleAiNavigate = (target: string, opts?: { productId?: string }) => {
    if (target === "lineage") {
      setLineageFocus(opts?.productId);
      setView("lineage");
    } else if (target === "approvals") setView("approvals");
    else if (target === "product" && opts?.productId) openProduct(opts.productId);
    else if (target === "obligations") setView("obligations");
  };

  const sidebar = (
    <div className={`${collapsed ? "w-16" : "w-64"} h-full border-gray-200 ${isAr ? "border-l" : "border-r"} bg-white flex flex-col transition-all`}>
      <DemoBrandBlock initials="SD" title={t("platformTitle", shell)} subtitle="v1 · console" accent={BRAND} ink={BRAND_INK} collapsed={collapsed} />
      <DemoSidebarNav items={navItems} activeId={view} onSelect={setView} accent={BRAND} collapsed={collapsed} />
      <div className="px-2 py-2 border-t border-gray-100 space-y-1">
        <DemoLangToggle lang={lang} setLang={setLang} variant="sidebar-icon" collapsed={collapsed} />
        <DemoCollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} isAr={isAr} label={t("collapseMenu", shell)} />
        <Link href="/marketplace/sovereign-data-steward" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-500 hover:bg-gray-50">
          <ArrowLeft size={16} className="rtl:rotate-180" />
          {!collapsed && <span>{t("back", shell)}</span>}
        </Link>
      </div>
    </div>
  );

  const topbar = (
    <DemoTopBar
      marketplaceSlug="sovereign-data-steward"
      accent={getDemoAccent("sovereign-data-steward")}
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
          onClick: () => openProduct(a.productId),
        })),
      }}
      onSwitchView={() => setLocation("/demo/sovereign-data-steward")}
      switchViewLabel={t("switchView", shell)}
    />
  );

  const drawers = (
    <AnimatePresence>
      {chatOpen && <AiChat onClose={() => setChatOpen(false)} onNavigate={handleAiNavigate} />}
    </AnimatePresence>
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
    <UserDemoShell lang={lang} sidebar={sidebar} topbar={topbar} drawers={drawers} fab={fab} background="#F9FAFB" height="min">
      <div className="flex-1 overflow-y-auto">
        {view === "catalogue" && <CatalogueView onOpenProduct={openProduct} onOpenView={(v) => setView(v as View)} />}
        {view === "product" && <ProductDetailView />}
        {view === "approvals" && <ApprovalsView />}
        {view === "lineage" && <LineageMapView focusProductId={lineageFocus} />}
        {view === "obligations" && <ObligationsRegisterView />}
        {view === "audit" && <AuditLogView />}
      </div>
    </UserDemoShell>
  );
}

export default function CdoConsole() {
  return (
    <SdsDemoLangProvider>
      <SdsDataProvider>
        <ConsoleInner />
      </SdsDataProvider>
    </SdsDemoLangProvider>
  );
}
