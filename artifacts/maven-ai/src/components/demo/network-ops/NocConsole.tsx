import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Map as MapIcon, Activity, Inbox, ShieldCheck, Truck, History,
  Sparkles, Bell, ChevronLeft, ChevronRight, ArrowLeft, X,
} from "lucide-react";
import { NocDemoLangProvider, useNocDemoLang, useNocDemoT } from "./DemoLangContext";
import { shell } from "./noc-i18n";
import { BRAND, BRAND_DARK } from "./tokens";
import LiveMapView from "./views/LiveMapView";
import IncidentWorkspaceView from "./views/IncidentWorkspaceView";
import ApprovalsView from "./views/ApprovalsView";
import ServiceHealthView from "./views/ServiceHealthView";
import FieldOpsView from "./views/FieldOpsView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";

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

  const [view, setView] = useState<ViewKey>("live-map");
  const [openIncidentId, setOpenIncidentId] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prevDir = document.documentElement.dir;
    const prevLang = document.documentElement.lang;
    document.documentElement.dir = isAr ? "rtl" : "ltr";
    document.documentElement.lang = isAr ? "ar" : "en";
    return () => {
      document.documentElement.dir = prevDir || "ltr";
      document.documentElement.lang = prevLang || "en";
    };
  }, [isAr]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const goToIncident = (id: string) => {
    setOpenIncidentId(id);
    setView("incident");
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen bg-[#F4F6F8] text-gray-900 flex">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? "w-[68px]" : "w-[240px]"} flex-shrink-0 bg-white ${isAr ? "border-l" : "border-r"} border-gray-200 transition-all duration-200 flex flex-col`}
      >
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
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 gap-4 sticky top-0 z-30">
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-gray-900 truncate">{t(NAV.find((n) => n.key === view)!.labelKey, shell)}</h1>
            <p className="text-[11px] text-gray-500 truncate">{t("personaTitle", shell)} · {t("persona", shell)}</p>
          </div>

          <div className="ms-auto flex items-center gap-2">
            <div className="flex bg-gray-100 rounded-lg p-0.5 text-[11px] font-bold">
              {(["en", "ar"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`px-3 py-1 rounded ${lang === l ? "bg-white shadow-sm" : "text-gray-600"}`}
                  style={lang === l ? { color: BRAND } : undefined}
                >
                  {l === "en" ? "EN" : "AR"}
                </button>
              ))}
            </div>

            <div ref={notifRef} className="relative">
              <button
                onClick={() => setNotifOpen((o) => !o)}
                className="relative w-9 h-9 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-100"
                aria-label={t("notifications", shell)}
              >
                <Bell size={18} />
                <span className="absolute top-1 end-1 w-2 h-2 rounded-full bg-red-500" />
              </button>
              <AnimatePresence>
                {notifOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className={`absolute mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden ${isAr ? "left-0" : "right-0"}`}
                  >
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-[11px] font-bold uppercase text-gray-500">
                      {t("notifications", shell)}
                    </div>
                    {[
                      { tk: "notifSettlement", time: "notifSettlementTime" },
                      { tk: "notifSla", time: "notifSlaTime" },
                      { tk: "notifHajj", time: "notifHajjTime" },
                    ].map((n) => (
                      <div key={n.tk} className="px-3 py-2.5 border-b border-gray-100 last:border-0">
                        <p className="text-xs text-gray-800">{t(n.tk, shell)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{t(n.time, shell)}</p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-2 ps-2 border-s border-gray-100">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: BRAND }}>
                {isAr ? "ر" : "RA"}
              </div>
              <div className="hidden sm:block text-end">
                <p className="text-xs font-bold text-gray-900">{t("persona", shell)}</p>
                <p className="text-[10px] text-gray-500">{isAr ? "مدير NOC" : "NOC Director"}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {view === "live-map" && <LiveMapView onOpenIncident={goToIncident} />}
          {view === "incident" && <IncidentWorkspaceView initialIncidentId={openIncidentId} onOpenApprovals={() => setView("approvals")} />}
          {view === "approvals" && <ApprovalsView />}
          {view === "service-health" && <ServiceHealthView />}
          {view === "field-ops" && <FieldOpsView />}
          {view === "audit" && <AuditLogView />}
        </main>
      </div>

      {/* Chat FAB */}
      <button
        onClick={() => setChatOpen(true)}
        className={`fixed bottom-6 ${isAr ? "left-6" : "right-6"} h-14 w-14 rounded-full text-white shadow-xl flex items-center justify-center hover:scale-105 transition-transform z-40`}
        style={{ background: BRAND }}
        aria-label={t("aiAssistant", shell)}
      >
        <Sparkles size={22} />
      </button>

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
    </div>
  );
}
