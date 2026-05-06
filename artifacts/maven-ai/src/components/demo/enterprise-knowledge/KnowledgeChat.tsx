import { useState, useEffect } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  MessageSquare, Library, ClipboardCheck, FileText, Settings2,
  ChevronLeft, ChevronRight, Languages, ArrowLeft, Bell, Sparkles, X,
} from "lucide-react";
import { EkcDemoLangProvider, useEkcLang, useEkcT } from "./DemoLangContext";
import { EkcDataProvider, useEkcData } from "@/hooks/useEnterpriseKnowledgeData";
import { shell } from "./knowledge-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import ChatView from "./views/ChatView";
import SourceLibraryView from "./views/SourceLibraryView";
import ApprovalsView from "./views/ApprovalsView";
import AuditDrawerView from "./views/AuditDrawerView";
import KnowledgeOpsView from "./views/KnowledgeOpsView";
import { generateAlerts } from "@/data/enterprise-knowledge-agent";

type View = "chat" | "sources" | "approvals" | "audit" | "ops";

function ConsoleInner() {
  const { lang, setLang } = useEkcLang();
  const t = useEkcT();
  const isAr = lang === "ar";
  const { recommendations, personas, personaId } = useEkcData();
  const currentPersona = personas.find((p) => p.id === personaId)!;

  const [view, setView] = useState<View>("chat");
  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dir = isAr ? "rtl" : "ltr";
    return () => { document.documentElement.dir = "ltr"; };
  }, [isAr]);

  const alerts = generateAlerts();
  const pendingCount = recommendations.filter((r) => r.status === "pending").length;

  const navItems: { id: View; icon: React.ReactNode; label: string; badge?: string }[] = [
    { id: "chat", icon: <MessageSquare size={16} />, label: t("navChat", shell) },
    { id: "sources", icon: <Library size={16} />, label: t("navSources", shell) },
    { id: "approvals", icon: <ClipboardCheck size={16} />, label: t("navApprovals", shell), badge: t("aiBadge", shell) },
    { id: "audit", icon: <FileText size={16} />, label: t("navAudit", shell) },
    { id: "ops", icon: <Settings2 size={16} />, label: t("navOps", shell) },
  ];

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="h-screen flex bg-gray-50 overflow-hidden" style={{ fontFamily: "Inter, system-ui, -apple-system" }}>
      {/* Sidebar */}
      <aside className={`${collapsed ? "w-16" : "w-64"} flex-shrink-0 border-gray-200 ${isAr ? "border-l" : "border-r"} bg-white flex flex-col transition-all`}>
        <div className="px-4 py-4 flex items-center gap-2 border-b border-gray-100" style={{ minHeight: 56 }}>
          <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white font-extrabold text-xs" style={{ background: BRAND }}>
            KC
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[12px] font-extrabold leading-tight" style={{ color: BRAND_INK }}>{t("platformTitle", shell)}</p>
              <p className="text-[10px] text-gray-500">{t("platformSub", shell)}</p>
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
                {!collapsed && <span className="truncate flex-1 text-start">{n.label}</span>}
                {!collapsed && n.badge && (
                  <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={active ? { background: "rgba(255,255,255,0.25)" } : { background: "#F5A623", color: "white" }}>
                    {n.badge}
                  </span>
                )}
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
          <Link href="/marketplace/enterprise-knowledge-concierge" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold text-gray-500 hover:bg-gray-50">
            <ArrowLeft size={16} className="rtl:rotate-180" />
            {!collapsed && <span>{t("back", shell)}</span>}
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Topbar */}
        <header className="h-14 border-b border-gray-200 bg-white flex items-center px-4 gap-3 flex-shrink-0">
          <Link href={`/demo/enterprise-knowledge-concierge`} className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <Sparkles size={12} /> {t("switchView", shell)}
          </Link>
          <div className="ms-auto flex items-center gap-2">
            <button onClick={() => setNotifOpen((v) => !v)} className="relative w-9 h-9 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-600">
              <Bell size={16} />
              {pendingCount > 0 && (
                <span className="absolute -top-0.5 -end-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 ps-2 border-s border-gray-200">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold" style={{ background: BRAND }}>
                {currentPersona.initials[lang]}
              </div>
              <div className="hidden md:block">
                <p className="text-[12px] font-bold leading-tight" style={{ color: BRAND_INK }}>{currentPersona.name[lang]}</p>
                <p className="text-[10px] text-gray-500">{currentPersona.role[lang]}</p>
              </div>
            </div>
          </div>
        </header>

        {/* View body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {view === "chat" && <ChatView onNavigate={(v) => setView(v as View)} />}
          {view === "sources" && <div className="flex-1 overflow-y-auto"><SourceLibraryView /></div>}
          {view === "approvals" && <div className="flex-1 overflow-y-auto"><ApprovalsView /></div>}
          {view === "audit" && <div className="flex-1 overflow-y-auto"><AuditDrawerView /></div>}
          {view === "ops" && <div className="flex-1 overflow-y-auto"><KnowledgeOpsView /></div>}
        </div>
      </main>

      {/* Notification panel */}
      <AnimatePresence>
        {notifOpen && (
          <motion.div
            initial={{ x: isAr ? -320 : 320 }}
            animate={{ x: 0 }}
            exit={{ x: isAr ? -320 : 320 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            dir={isAr ? "rtl" : "ltr"}
            className={`fixed top-0 bottom-0 w-80 bg-white shadow-2xl border-gray-200 z-40 flex flex-col ${isAr ? "left-0 border-r" : "right-0 border-l"}`}
          >
            <div className="h-14 px-4 border-b border-gray-100 flex items-center gap-2 flex-shrink-0">
              <Bell size={14} style={{ color: BRAND }} />
              <p className="text-sm font-bold flex-1" style={{ color: BRAND_INK }}>{t("agentAlerts", shell)}</p>
              <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {alerts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { setView("approvals"); setNotifOpen(false); }}
                  className="w-full text-start bg-gray-50 hover:bg-white border border-gray-200 hover:border-[#5C8CA8] rounded-xl p-3 transition cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${a.severity === "critical" ? "bg-red-500" : a.severity === "high" ? "bg-amber-500" : "bg-blue-500"}`} />
                    <span className="text-[10px] font-semibold uppercase text-gray-500">{a.severity}</span>
                  </div>
                  <p className="text-[12px] font-bold" style={{ color: BRAND_INK }}>{a.title[lang]}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">{a.detail[lang]}</p>
                </button>
              ))}
              <button onClick={() => { setView("approvals"); setNotifOpen(false); }} className="w-full text-[12px] font-semibold py-2 mt-2" style={{ color: BRAND }}>
                {t("seeAllAlerts", shell)}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
