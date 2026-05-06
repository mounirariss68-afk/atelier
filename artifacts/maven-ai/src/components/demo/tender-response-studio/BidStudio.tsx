import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, FileText, Inbox, ShieldCheck, BookOpen, History,
  Sparkles, Bell, ChevronLeft, ChevronRight, ArrowLeft, ArrowLeftRight,
  AlertTriangle, X, Filter, LogOut,
} from "lucide-react";
import { useTenderResponseData, TenderResponseDataProvider } from "@/hooks/useTenderResponseData";
import { useTenderDemoLang, useTenderDemoT, TenderDemoLangProvider } from "./DemoLangContext";
import { shell } from "./tender-i18n";
import { BRAND, BRAND_DARK, BRAND_MUTED, NAVY, CANVAS, SEM } from "./tokens";
import { generateAlerts } from "@/data/tender-response-agent";
import PipelineView from "./views/PipelineView";
import TenderWorkspaceView from "./views/TenderWorkspaceView";
import ApprovalsView from "./views/ApprovalsView";
import ComplianceView from "./views/ComplianceView";
import LibraryView from "./views/LibraryView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";

type ViewKey = "pipeline" | "tender" | "approvals" | "compliance" | "library" | "audit";

const NAV: { key: ViewKey; labelKey: string; icon: React.ReactNode; badge?: "AI" | "NEW" }[] = [
  { key: "pipeline", labelKey: "navPipeline", icon: <LayoutDashboard size={17} /> },
  { key: "tender", labelKey: "navTender", icon: <FileText size={17} /> },
  { key: "approvals", labelKey: "navApprovals", icon: <Inbox size={17} />, badge: "AI" },
  { key: "compliance", labelKey: "navCompliance", icon: <ShieldCheck size={17} /> },
  { key: "library", labelKey: "navLibrary", icon: <BookOpen size={17} /> },
  { key: "audit", labelKey: "navAudit", icon: <History size={17} /> },
];

export default function BidStudio() {
  return (
    <TenderDemoLangProvider>
      <TenderResponseDataProvider>
        <ShellInner />
      </TenderResponseDataProvider>
    </TenderDemoLangProvider>
  );
}

function ShellInner() {
  const { lang, setLang } = useTenderDemoLang();
  const t = useTenderDemoT();
  const isAr = lang === "ar";
  const { tenders } = useTenderResponseData();

  const [view, setView] = useState<ViewKey>("pipeline");
  const [collapsed, setCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [fabHover, setFabHover] = useState(false);
  const [stage, setStage] = useState<string>("all");
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
    function onClick(e: MouseEvent) {
      if (notifOpen && notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [notifOpen]);

  const alerts = useMemo(() => generateAlerts(), []);
  const critCount = alerts.filter((a) => a.severity === "critical").length;

  const handleNavFromAlert = (v: string) => {
    setNotifOpen(false);
    setView(v as ViewKey);
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen flex" style={{ background: CANVAS }}>
      {/* Sidebar */}
      <motion.aside
        animate={{ width: collapsed ? 60 : 220 }}
        transition={{ duration: 0.2 }}
        className="bg-white flex-shrink-0 flex flex-col z-30 sticky top-0 h-screen"
        style={{ borderInlineEndWidth: 1, borderColor: "#E5E7EB" }}
      >
        {/* Brand block */}
        <div className="h-14 px-3 flex items-center gap-2 border-b border-gray-100" style={{ background: NAVY }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white flex-shrink-0" style={{ background: BRAND }}>
            <FileText size={16} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[8px] font-bold uppercase tracking-widest" style={{ color: BRAND }}>{t("brandTag", shell)}</p>
              <p className="text-[12px] font-extrabold text-white leading-tight truncate">{t("platformTitle", shell)}</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = view === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[12px] font-bold transition-colors relative ${
                  active ? "" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
                style={active ? { background: BRAND_MUTED, color: BRAND_DARK } : undefined}
                title={collapsed ? t(item.labelKey, shell) : undefined}
              >
                {active && <span className={`absolute top-1 bottom-1 ${isAr ? "right-0" : "left-0"} w-[3px] rounded-full`} style={{ background: BRAND }} />}
                <span className="flex-shrink-0">{item.icon}</span>
                {!collapsed && <span className="flex-1 text-start truncate">{t(item.labelKey, shell)}</span>}
                {!collapsed && item.badge && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full font-extrabold" style={{ background: BRAND, color: "white" }}>
                    {item.badge === "AI" ? t("aiBadge", shell) : t("newBadge", shell)}
                  </span>
                )}
                {collapsed && item.badge && (
                  <span className={`absolute top-1 ${isAr ? "left-1" : "right-1"} w-1.5 h-1.5 rounded-full`} style={{ background: BRAND }} />
                )}
              </button>
            );
          })}

          <div className="pt-2 mt-2 border-t border-gray-100">
            <button
              onClick={() => setChatOpen(true)}
              className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[12px] font-bold text-white"
              style={{ background: chatOpen ? BRAND_DARK : BRAND }}
              title={collapsed ? t("aiAssistant", shell) : undefined}
            >
              <Sparkles size={17} className="flex-shrink-0" />
              {!collapsed && <span className="flex-1 text-start truncate">{t("aiAssistant", shell)}</span>}
            </button>
          </div>
        </nav>

        <div className="px-2 py-2 border-t border-gray-100">
          <button onClick={() => setCollapsed(!collapsed)} className="w-full flex items-center justify-center px-3 py-1.5 rounded-lg text-gray-400 hover:bg-gray-50">
            {collapsed
              ? (isAr ? <ChevronLeft size={14} /> : <ChevronRight size={14} />)
              : (isAr ? <ChevronRight size={14} /> : <ChevronLeft size={14} />)}
          </button>
        </div>
      </motion.aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {/* Header */}
        <header className="h-14 flex items-center px-5 gap-3 sticky top-0 z-20 text-white" style={{ background: NAVY }}>
          <Link href="/marketplace/tender-response-studio" className="text-gray-300 hover:text-white flex items-center gap-1.5 text-[11px] font-medium">
            <ArrowLeft size={13} className={isAr ? "rotate-180" : ""} />
            {t("back", shell)}
          </Link>
          <div className="h-5 w-px bg-white/20" />
          <div className="min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-widest" style={{ color: BRAND }}>{t("brandTag", shell)}</p>
            <p className="text-[11px] font-extrabold leading-tight truncate">{t("platformTitle", shell)}</p>
          </div>
          <div className="flex-1" />

          {/* Notifications */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center"
              aria-label="notifications"
            >
              <Bell size={15} />
              {critCount > 0 && (
                <span className="absolute top-1 end-1 min-w-[14px] h-3.5 px-1 rounded-full text-[8px] font-extrabold flex items-center justify-center text-white" style={{ background: SEM.bad }}>
                  {critCount}
                </span>
              )}
            </button>
            <AnimatePresence>
              {notifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className={`absolute top-12 ${isAr ? "left-0" : "right-0"} w-[380px] bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50 text-gray-900`}
                >
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold">{t("agentAlerts", shell)}</p>
                      <p className="text-[11px] text-gray-500">{critCount} {t("urgent", shell)}</p>
                    </div>
                    <button onClick={() => setNotifOpen(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                  </div>
                  <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-50">
                    {alerts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => handleNavFromAlert(a.view)}
                        className="block w-full text-start px-4 py-3 hover:bg-gray-50"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" style={{ color: a.severity === "critical" ? SEM.bad : a.severity === "high" ? SEM.warn : SEM.info }} />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold">{a.title[lang]}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5">{a.detail[lang]}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { setNotifOpen(false); setView("approvals"); }} className="w-full px-4 py-2.5 text-[11px] font-bold border-t border-gray-100 hover:bg-gray-50" style={{ color: BRAND }}>
                    {t("seeAllAlerts", shell)}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Lang */}
          <button
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            className="text-[10px] font-bold px-2.5 py-1 rounded-md hover:bg-white/10"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            {lang === "en" ? "العربية" : "English"}
          </button>

          {/* Switch view */}
          <Link
            href="/demo/tender-response-studio/teknik"
            className="text-[10px] font-bold px-2.5 py-1 rounded-md hover:bg-white/10 inline-flex items-center gap-1"
            style={{ background: "rgba(255,255,255,0.08)" }}
            title={t("switchToCockpit", shell)}
          >
            <ArrowLeftRight size={11} />
            <span className="hidden md:inline">{t("switchView", shell)}</span>
          </Link>

          {/* Persona */}
          <div className={`flex items-center gap-2 ps-3 ${isAr ? "border-r" : "border-l"} border-white/15`}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-extrabold" style={{ background: BRAND }}>
              {t("managerInitials", shell)}
            </div>
            <div className="hidden md:block min-w-0">
              <p className="text-[10px] font-bold leading-tight truncate">{t("managerName", shell)}</p>
              <p className="text-[8px] text-gray-300 truncate">{t("managerTitle", shell)}</p>
            </div>
          </div>

          <Link href="/marketplace/tender-response-studio" className="hidden md:flex items-center gap-1 text-[10px] text-gray-300 hover:text-white">
            <LogOut size={12} /> {t("logout", shell)}
          </Link>
        </header>

        {/* Sticky filter bar */}
        <div className="sticky top-14 z-10 bg-white/90 backdrop-blur border-b border-gray-100 px-5 py-2 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-gray-400">
            <Filter size={11} />{t("filters", shell)}
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-gray-500">{t("stageLabel", shell)}:</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className="bg-white border border-gray-200 rounded-md px-2 py-1 text-[11px] font-medium">
              <option value="all">{t("allStages", shell)}</option>
              <option value="ingest">Ingest</option>
              <option value="qualify">Qualify</option>
              <option value="draft">Draft</option>
              <option value="pricing">Pricing</option>
              <option value="partner">Partner</option>
              <option value="legal">Legal</option>
              <option value="compile">Compile</option>
              <option value="submitted">Submitted</option>
            </select>
            {stage !== "all" && (
              <button onClick={() => setStage("all")} className="text-gray-400 hover:text-gray-600"><X size={11} /></button>
            )}
          </div>
          <span className="ms-auto text-[11px] text-gray-500">
            <b style={{ color: BRAND }}>{tenders.filter((t) => t.stage !== "submitted").length}</b> {lang === "ar" ? "مناقصة نشطة" : "active tenders"}
          </span>
        </div>

        {/* View body */}
        <main className="flex-1 px-5 py-5 max-w-[1500px] mx-auto w-full">
          {view === "pipeline" && (
            <PipelineView
              onOpenTender={() => setView("tender")}
              onOpenView={(v) => setView(v as ViewKey)}
            />
          )}
          {view === "tender" && <TenderWorkspaceView />}
          {view === "approvals" && <ApprovalsView />}
          {view === "compliance" && <ComplianceView />}
          {view === "library" && <LibraryView />}
          {view === "audit" && <AuditLogView />}
        </main>

        {/* FAB */}
        <button
          onClick={() => setChatOpen(true)}
          onMouseEnter={() => setFabHover(true)}
          onMouseLeave={() => setFabHover(false)}
          className={`fixed bottom-6 ${isAr ? "left-6" : "right-6"} z-40 inline-flex items-center gap-2 rounded-full shadow-lg text-white font-bold transition-all duration-200 ${
            fabHover ? "px-5 py-3.5 text-xs" : "px-3.5 py-3.5 text-sm"
          }`}
          style={{ background: `linear-gradient(135deg, ${BRAND_DARK}, ${BRAND})`, boxShadow: "0 10px 25px rgba(15, 68, 22, 0.35)" }}
          aria-label={t("fabAskAi", shell)}
        >
          <Sparkles size={17} className="flex-shrink-0" />
          <AnimatePresence initial={false}>
            {fabHover && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap"
              >
                {t("fabAskAi", shell)}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>

      <AnimatePresence>
        {chatOpen && <AiChat onClose={() => setChatOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
