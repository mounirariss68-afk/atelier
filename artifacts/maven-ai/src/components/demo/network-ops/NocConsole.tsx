import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Map as MapIcon, Activity, Inbox, ShieldCheck, Truck, History,
  Sparkles, ChevronLeft, ChevronRight, ArrowLeft,
} from "lucide-react";
import { NocDemoLangProvider, useNocDemoLang, useNocDemoT } from "./DemoLangContext";
import { shell } from "./noc-i18n";
import { BRAND, BRAND_DARK } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import LiveMapView from "./views/LiveMapView";
import IncidentWorkspaceView from "./views/IncidentWorkspaceView";
import ApprovalsView from "./views/ApprovalsView";
import ServiceHealthView from "./views/ServiceHealthView";
import FieldOpsView from "./views/FieldOpsView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";
import { UserDemoShell } from "@/components/demo/_shell";

type ViewKey = "live-map" | "incident" | "approvals" | "service-health" | "field-ops" | "audit";

interface NavItem {
  key: ViewKey;
  labelKey: string;
  icon: React.ReactNode;
  badge?: "AI" | "NEW";
}

const NAV: NavItem[] = [
  { key: "live-map", labelKey: "navLiveMap", icon: <MapIcon size={18} /> },
  { key: "incident", labelKey: "navIncident", icon: <Activity size={18} />, badge: "AI" },
  { key: "approvals", labelKey: "navApprovals", icon: <Inbox size={18} />, badge: "AI" },
  { key: "service-health", labelKey: "navServiceHealth", icon: <ShieldCheck size={18} /> },
  { key: "field-ops", labelKey: "navFieldOps", icon: <Truck size={18} /> },
  { key: "audit", labelKey: "navAudit", icon: <History size={18} /> },
];

export default function NocConsole() {
  return (
    <NocDemoLangProvider>
      <ConsoleInner />
    </NocDemoLangProvider>
  );
}

function ConsoleInner() {
  const { lang, setLang } = useNocDemoLang();
  const t = useNocDemoT();
  const isAr = lang === "ar";

  const [, setLocation] = useLocation();
  const [view, setView] = useState<ViewKey>("live-map");
  const [openIncidentId, setOpenIncidentId] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const goToIncident = (id: string) => {
    setOpenIncidentId(id);
    setView("incident");
  };

  const sidebar = (
    <div className={`${collapsed ? "w-[68px]" : "w-[240px]"} h-full bg-white ${isAr ? "border-l" : "border-r"} border-gray-200 transition-all duration-200 flex flex-col`}>
      <div className="h-16 px-4 flex items-center gap-3 border-b border-gray-100">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}>
          <Activity size={18} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-extrabold leading-tight" style={{ color: BRAND_DARK }}>{t("appName", shell)}</p>
            <p className="text-[10px] text-gray-500 truncate">Sahara Telecom</p>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${active ? "text-white" : "text-gray-700 hover:bg-gray-100"}`}
              style={active ? { background: BRAND } : undefined}
              title={collapsed ? t(item.labelKey, shell) : undefined}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && (
                <>
                  <span className="flex-1 text-start truncate">{t(item.labelKey, shell)}</span>
                  {item.badge && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${active ? "bg-white/20" : item.badge === "AI" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {t(item.badge === "AI" ? "badgeAi" : "badgeNew", shell)}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-2 border-t border-gray-100 space-y-1">
        <Link
          href="/demo/network-ops-war-room"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100"
          title={collapsed ? t("switchToCockpit", shell) : undefined}
        >
          <Sparkles size={14} className="flex-shrink-0" />
          {!collapsed && <span className="truncate">{t("switchToCockpit", shell)}</span>}
        </Link>
        <Link
          href="/marketplace/network-ops-war-room"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100"
          title={collapsed ? t("backToMarketplace", shell) : undefined}
        >
          <ArrowLeft size={14} className="flex-shrink-0 rtl:rotate-180" />
          {!collapsed && <span className="truncate">{t("backToMarketplace", shell)}</span>}
        </Link>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 hover:bg-gray-100"
        >
          {collapsed ? <ChevronRight size={14} className="rtl:rotate-180" /> : <ChevronLeft size={14} className="rtl:rotate-180" />}
          {!collapsed && <span>{isAr ? "طيّ" : "Collapse"}</span>}
        </button>
      </div>
    </div>
  );

  const topbar = (
    <DemoTopBar
      marketplaceSlug="network-ops-war-room"
      accent={getDemoAccent("network-ops-war-room")}
      brandTag={t("brandTag", shell)}
      platformTitle={t("platformTitle", shell)}
      backLabel={t("back", shell)}
      lang={lang}
      setLang={setLang}
      persona={{
        initials: t("personaInitials", shell),
        name: t("persona", shell),
        title: t("personaTitle", shell),
      }}
      notifications={{
        panelTitle: t("notifications", shell),
        items: [
          { tk: "notifSettlement", time: "notifSettlementTime" },
          { tk: "notifSla", time: "notifSlaTime" },
          { tk: "notifHajj", time: "notifHajjTime" },
        ].map((n) => ({
          id: n.tk,
          severity: "high" as const,
          title: t(n.tk, shell),
          timestamp: t(n.time, shell),
        })),
        seeAllLabel: t("seeAllAlerts", shell),
        onSeeAll: () => setView("approvals"),
      }}
      onSwitchView={() => setLocation("/demo/network-ops-war-room")}
      switchViewLabel={t("switchView", shell)}
    />
  );

  const fab = (
    <button
      onClick={() => setChatOpen(true)}
      className={`fixed bottom-6 ${isAr ? "left-6" : "right-6"} h-14 w-14 rounded-full text-white shadow-xl flex items-center justify-center hover:scale-105 transition-transform z-40`}
      style={{ background: BRAND }}
      aria-label={t("aiAssistant", shell)}
    >
      <Sparkles size={22} />
    </button>
  );

  const drawers = (
    <AnimatePresence>
      {chatOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setChatOpen(false)}
            className="fixed inset-0 bg-black/20 z-40"
          />
          <AiChat onClose={() => setChatOpen(false)} />
        </>
      )}
    </AnimatePresence>
  );

  return (
    <UserDemoShell lang={lang} sidebar={sidebar} header={topbar} fab={fab} drawers={drawers} background="#F4F6F8" textColor="#111827" height="min" applyInterFont={false}>
      <main className="flex-1 overflow-y-auto p-6">
        {view === "live-map" && <LiveMapView onOpenIncident={goToIncident} />}
        {view === "incident" && <IncidentWorkspaceView initialIncidentId={openIncidentId} onOpenApprovals={() => setView("approvals")} />}
        {view === "approvals" && <ApprovalsView />}
        {view === "service-health" && <ServiceHealthView />}
        {view === "field-ops" && <FieldOpsView />}
        {view === "audit" && <AuditLogView />}
      </main>
    </UserDemoShell>
  );
}
