import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import {
  Inbox, FolderOpen, CheckSquare, BarChart3, BookOpen, ClipboardList,
  Bell, Bot, ChevronLeft, Globe, ArrowLeft, Sparkles, AlertTriangle, X,
} from "lucide-react";
import { useCscLang } from "./DemoLangContext";
import { shell, tDict } from "./citizen-i18n";
import { useCitizenServicesData } from "@/hooks/useCitizenServicesData";
import { tt } from "@/data/citizen-services-seed";
import { BRAND, BRAND_INK, BRAND_MUTED, NAVY, CANVAS, SEVERITY } from "./tokens";
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

  const [view, setView] = useState<ViewKey>("queue");
  const [activeCase, setActiveCase] = useState<string | null>("CSC-2026-1421");
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    const prevDir = html.getAttribute("dir");
    const prevLang = html.getAttribute("lang");
    html.setAttribute("dir", isRtl ? "rtl" : "ltr");
    html.setAttribute("lang", lang);
    return () => {
      if (prevDir) html.setAttribute("dir", prevDir); else html.removeAttribute("dir");
      if (prevLang) html.setAttribute("lang", prevLang); else html.removeAttribute("lang");
    };
  }, [isRtl, lang]);

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
        {/* Topbar */}
        <header className="flex-shrink-0 h-14 bg-white border-b border-gray-100 flex items-center px-5 gap-3">
          <p className="text-[13px] font-bold text-gray-800">{t[NAV.find((n) => n.key === view)!.labelKey]}</p>
          <div className="ms-auto flex items-center gap-1.5">
            <button onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
              <Globe size={12} /> {lang === "en" ? "العربية" : "EN"}
            </button>
            <button onClick={() => setNotifOpen(true)} className="relative w-9 h-9 rounded-md border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50">
              <Bell size={15} />
              {data.alerts.length > 0 && <span className="absolute top-1 end-1 w-2 h-2 rounded-full" style={{ background: SEVERITY.critical }} />}
            </button>
            <button onClick={() => setChatOpen(true)} className="hidden md:flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md text-white"
              style={{ background: BRAND }}>
              <Sparkles size={12} /> {t.aiAssistant}
            </button>
            <div className="ms-2 flex items-center gap-2 ps-3 border-s border-gray-100">
              <div className="w-8 h-8 rounded-full text-white flex items-center justify-center text-[11px] font-bold" style={{ background: BRAND_INK }}>{tt(data.officer.initials, lang)}</div>
              <div className="hidden sm:block text-[11px] leading-tight">
                <p className="font-semibold text-gray-800">{tt(data.officer.name, lang)}</p>
                <p className="text-gray-400">{tt(data.officer.role, lang)}</p>
              </div>
            </div>
          </div>
        </header>

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

      {/* Notifications drawer */}
      <AnimatePresence>
        {notifOpen && (
          <motion.div initial={{ x: isRtl ? "-100%" : "100%" }} animate={{ x: 0 }} exit={{ x: isRtl ? "-100%" : "100%" }}
            transition={{ type: "spring", damping: 26, stiffness: 260 }}
            className={`fixed top-0 ${isRtl ? "left-0 border-r" : "right-0 border-l"} h-full w-[360px] max-w-full bg-white shadow-2xl z-50 flex flex-col border-gray-200`}
            dir={isRtl ? "rtl" : "ltr"}>
            <div className="h-14 px-4 flex items-center gap-3 text-white" style={{ background: NAVY }}>
              <Bell size={16} />
              <p className="text-sm font-bold flex-1">{t.notifications}</p>
              <button onClick={() => setNotifOpen(false)} className="p-1.5 hover:bg-white/15 rounded-lg"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
              {data.alerts.map((a) => {
                const sColor = a.severity === "critical" ? SEVERITY.critical : a.severity === "high" ? SEVERITY.high : SEVERITY.medium;
                return (
                  <button key={a.id} onClick={() => { if (a.caseId) { openCase(a.caseId); setNotifOpen(false); } }}
                    className="w-full text-start bg-white rounded-lg border border-gray-100 p-3 hover:border-gray-200 transition-colors">
                    <div className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: sColor }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-semibold text-gray-800 leading-snug">{tt(a.title, lang)}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">{tt(a.sub, lang)}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{a.at}</p>
                      </div>
                      {a.severity === "critical" && <AlertTriangle size={12} className="text-red-500 flex-shrink-0 mt-1" />}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="p-3 border-t border-gray-100 text-center">
              <span className="text-[10px] text-gray-400">{lang === "en" ? "Brand accent" : "لون الهوية"} • <span style={{ color: BRAND_MUTED, background: BRAND, padding: "0 6px", borderRadius: 4 }}>{BRAND}</span></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
