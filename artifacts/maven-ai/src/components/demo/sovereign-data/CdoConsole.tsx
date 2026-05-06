import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  Database, FileSearch, ClipboardCheck, GitBranch, ScrollText, BookOpen,
  ChevronLeft, ChevronRight, Languages, ArrowLeft, MessageCircle, Sparkles,
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

  const navItems: { id: View; icon: React.ReactNode; label: string }[] = [
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

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen flex bg-gray-50" style={{ fontFamily: "Inter, system-ui, -apple-system" }}>
      {/* Sidebar */}
      <aside
        className={`${collapsed ? "w-16" : "w-64"} flex-shrink-0 border-gray-200 ${isAr ? "border-l" : "border-r"} bg-white flex flex-col transition-all`}
      >
        <div className="px-4 py-4 flex items-center gap-2 border-b border-gray-100" style={{ minHeight: 56 }}>
          <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-extrabold text-xs" style={{ background: BRAND }}>
            SD
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[12px] font-extrabold leading-tight" style={{ color: BRAND_INK }}>{t("platformTitle", shell)}</p>
              <p className="text-[10px] text-gray-500">v1 · console</p>
            </div>
          )}
        </div>

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
          <Link href="/marketplace/sovereign-data-steward" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-500 hover:bg-gray-50">
            <ArrowLeft size={16} className="rtl:rotate-180" />
            {!collapsed && <span>{t("back", shell)}</span>}
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
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

        {/* View body */}
        <div className="flex-1 overflow-y-auto">
          {view === "catalogue" && <CatalogueView onOpenProduct={openProduct} onOpenView={(v) => setView(v as View)} />}
          {view === "product" && <ProductDetailView />}
          {view === "approvals" && <ApprovalsView />}
          {view === "lineage" && <LineageMapView focusProductId={lineageFocus} />}
          {view === "obligations" && <ObligationsRegisterView />}
          {view === "audit" && <AuditLogView />}
        </div>
      </main>

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

export default function CdoConsole() {
  return (
    <SdsDemoLangProvider>
      <SdsDataProvider>
        <ConsoleInner />
      </SdsDataProvider>
    </SdsDemoLangProvider>
  );
}
