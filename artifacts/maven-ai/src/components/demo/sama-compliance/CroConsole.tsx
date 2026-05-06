import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, Bell, AlertTriangle, LogOut, ArrowLeftRight, Sparkles,
  Filter, FileText, Inbox, ShieldCheck, CalendarClock, History, MessageSquare,
} from "lucide-react";
import Logo from "@/components/Logo";
import { SamaComplianceDataProvider, useSamaComplianceData } from "@/hooks/useSamaComplianceData";
import { SamaDemoLangProvider, useSamaDemoLang } from "./DemoLangContext";
import { shell, kpis, useTrFactory } from "./sama-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import { generateAlerts, generateRecommendations, type Severity } from "@/data/sama-compliance-agent";
import { formatAed, relativeTime } from "@/data/sama-compliance-seed";
import ObligationsRegisterView from "./views/ObligationsRegisterView";
import CircularDetailView from "./views/CircularDetailView";
import ApprovalsView from "./views/ApprovalsView";
import ControlsLibraryView from "./views/ControlsLibraryView";
import ReturnsCalendarView from "./views/ReturnsCalendarView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";

type View = "register" | "circular" | "approvals" | "controls" | "returns" | "audit";

const NAV: { id: View; icon: typeof Filter; key: keyof typeof NAV_LABELS }[] = [
  { id: "register", icon: Filter, key: "navRegister" },
  { id: "circular", icon: FileText, key: "navCircular" },
  { id: "approvals", icon: Inbox, key: "navApprovals" },
  { id: "controls", icon: ShieldCheck, key: "navControls" },
  { id: "returns", icon: CalendarClock, key: "navReturns" },
  { id: "audit", icon: History, key: "navAudit" },
];

const NAV_LABELS = {
  navRegister: true, navCircular: true, navApprovals: true, navControls: true, navReturns: true, navAudit: true,
};

export default function CroConsole() {
  return (
    <SamaDemoLangProvider>
      <SamaComplianceDataProvider>
        <ConsoleInner />
      </SamaComplianceDataProvider>
    </SamaDemoLangProvider>
  );
}

const SEV_DOT: Record<Severity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  info: "bg-gray-400",
};

function ConsoleInner() {
  const { lang, setLang } = useSamaDemoLang();
  const t = useTrFactory(lang);
  const isAr = lang === "ar";
  const data = useSamaComplianceData();

  const [view, setView] = useState<View>("register");
  const [circularId, setCircularId] = useState<string | undefined>(undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifRead, setNotifRead] = useState<Record<string, boolean>>({});

  const alerts = useMemo(() => generateAlerts(), []);
  const recs = useMemo(() => generateRecommendations(), []);
  const unread = alerts.filter((a) => !notifRead[a.id]).length;

  // Apply RTL at the document level for the duration of this experience
  useEffect(() => {
    const prev = document.documentElement.dir;
    document.documentElement.dir = isAr ? "rtl" : "ltr";
    return () => { document.documentElement.dir = prev; };
  }, [isAr]);

  const navigateTo = (v: string, id?: string) => {
    if (NAV.some((n) => n.id === v)) {
      setView(v as View);
      if (v === "circular" && id) setCircularId(id);
      setChatOpen(false);
      setNotifOpen(false);
    }
  };

  // KPI tiles
  const obligations = data.obligations;
  const failingControls = data.controls.filter((c) => c.lastTestResult === "fail" || c.lastTestResult === "overdue").length;
  const newCirculars = data.circulars.filter((c) => new Date(c.publishedAt) >= new Date("2026-04-01")).length;
  const returnsDue30 = data.returns.filter((r) => r.daysToDue >= 0 && r.daysToDue <= 30).length;
  const decisionsForMe = recs.length;
  const cumulativeImpact = data.returns.reduce((s, r) => s + (r.amountAed ?? 0), 0);

  const kpiTiles = [
    { key: "activeObligations", value: obligations.length.toString(), sub: `7 ${isAr ? "مجالات" : "domains"} · 6 ${isAr ? "خطوط أعمال" : "business lines"}` },
    { key: "newCirculars", value: newCirculars.toString(), sub: isAr ? "1 بانتظار توقيعك" : "1 awaiting your sign-off" },
    { key: "controlsFailing", value: failingControls.toString(), sub: `${data.controls.length} ${isAr ? "ضابطاً إجمالياً" : "controls total"}` },
    { key: "returnsDue", value: returnsDue30.toString(), sub: isAr ? "9 منها فوق 80%" : "9 above 80% ready" },
    { key: "decisionsForMe", value: decisionsForMe.toString(), sub: isAr ? "أعلى أولوية: CRU-2026-04" : "Top priority: CRU-2026-04" },
    { key: "aedImpact", value: formatAed(cumulativeImpact, lang), sub: isAr ? "عبر 12 إيداعاً" : "across 12 returns" },
  ];

  return (
    <div className="h-screen flex flex-col bg-[#F4F6F8] text-[#0E2841]" dir={isAr ? "rtl" : "ltr"}>
      <header className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3 z-20" style={{ background: BRAND_INK }}>
        <Link href="/marketplace/sama-compliance-sentinel" className="flex items-center gap-1 text-xs text-gray-300 hover:text-white">
          <ChevronLeft size={14} className={isAr ? "rotate-180" : ""} />
          <span className="hidden md:inline">{t("back", shell)}</span>
        </Link>
        <Logo className="h-5 w-auto text-white" />
        <div className="h-5 w-px bg-white/20" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: BRAND }}>{t("brandTag", shell)}</p>
          <p className="text-xs font-semibold truncate">{t("platformTitle", shell)}</p>
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setNotifOpen((o) => !o)}
            className="relative p-2 hover:bg-white/10 rounded-lg"
            aria-label={t("notifications", shell)}
            data-testid="button-notifications"
          >
            <Bell size={16} />
            {unread > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-1 rounded-full text-[9px] font-bold flex items-center justify-center animate-pulse" style={{ background: BRAND, color: BRAND_INK }}>
                {unread}
              </span>
            )}
          </button>
          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className={`absolute ${isAr ? "left-0" : "right-0"} top-12 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden`}
              >
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center gap-1.5" style={{ color: BRAND_INK }}>
                    <AlertTriangle size={14} style={{ color: BRAND }} /> {t("notifications", shell)}
                  </h3>
                  {unread > 0 && (
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{unread} {isAr ? "جديد" : "new"}</span>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {alerts.length === 0 && (
                    <div className="px-4 py-8 text-center text-xs text-gray-400">{t("noAlerts", shell)}</div>
                  )}
                  {alerts.map((a) => {
                    const read = !!notifRead[a.id];
                    return (
                      <button
                        key={a.id}
                        onClick={() => {
                          setNotifRead((p) => ({ ...p, [a.id]: true }));
                          if (a.href) navigateTo(a.href.view, a.href.id);
                        }}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors ${read ? "bg-white" : "bg-amber-50/40"}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={`mt-1 w-2 h-2 rounded-full ${SEV_DOT[a.severity]}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs ${read ? "font-medium text-gray-700" : "font-bold"}`} style={!read ? { color: BRAND_INK } : undefined}>
                              {a.title[lang] ?? a.title.en}
                            </p>
                            <p className="text-[10px] text-gray-500 mt-0.5">{a.detail[lang] ?? a.detail.en}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{relativeTime(a.timestamp, lang)}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => { navigateTo("audit"); }}
                  className="w-full px-4 py-2.5 text-center text-xs font-bold border-t border-gray-100 hover:bg-amber-50"
                  style={{ color: BRAND }}
                >
                  {t("seeAll", shell)}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Persona */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: BRAND, color: BRAND_INK }}>{t("croInitials", shell)}</div>
          <div className="hidden md:block text-xs">
            <div className="font-semibold leading-tight">{t("croName", shell)}</div>
            <div className="text-gray-400 text-[10px] leading-tight">{t("croTitle", shell)}</div>
          </div>
        </div>

        {/* Lang */}
        <div className="flex items-center bg-white/10 rounded-full p-0.5">
          <button onClick={() => setLang("en")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${lang === "en" ? "bg-white" : "text-white/60 hover:text-white"}`} style={lang === "en" ? { color: BRAND_INK } : undefined}>EN</button>
          <button onClick={() => setLang("ar")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${lang === "ar" ? "bg-white" : "text-white/60 hover:text-white"}`} style={lang === "ar" ? { color: BRAND_INK } : undefined}>AR</button>
        </div>

        {/* Switch to cockpit (technical demo) */}
        <Link
          href="/demo/sama-compliance-sentinel"
          className="flex items-center gap-1 text-xs text-gray-300 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10"
          title={t("switchView", shell)}
        >
          <ArrowLeftRight size={14} />
          <span className="hidden md:inline">{t("switchView", shell)}</span>
        </Link>

        <Link href="/marketplace/sama-compliance-sentinel" className="flex items-center gap-1 text-xs text-gray-300 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10">
          <LogOut size={14} />
          <span className="hidden md:inline">{t("logout", shell)}</span>
        </Link>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Sidebar */}
        <nav className="flex-shrink-0 w-52 bg-white border-r border-gray-200 flex flex-col">
          <div className="flex-1 py-2">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = view === n.id;
              const badge = n.id === "approvals" ? recs.length : null;
              return (
                <button
                  key={n.id}
                  onClick={() => setView(n.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold border-l-2 transition-colors ${active ? "bg-amber-50 border-amber-500" : "text-gray-600 border-transparent hover:bg-gray-50"}`}
                  style={active ? { color: BRAND_INK } : undefined}
                >
                  <Icon size={16} style={active ? { color: BRAND } : undefined} />
                  <span className="flex-1 text-left rtl:text-right">{t(n.key, shell)}</span>
                  {badge ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: BRAND, color: BRAND_INK }}>{badge}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="p-3 border-t border-gray-100">
            <button
              onClick={() => setChatOpen(true)}
              className="w-full px-3 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-2 justify-center"
              style={{ background: BRAND_INK }}
            >
              <Sparkles size={12} style={{ color: BRAND }} />{t("aiAssistant", shell)}
            </button>
          </div>
        </nav>

        {/* Content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[1400px] mx-auto p-6 space-y-6">
            {/* Persona + KPI strip */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: BRAND }}>{t("brandTag", shell)}</p>
                  <h1 className="text-lg font-bold" style={{ color: BRAND_INK }}>
                    {isAr ? `صباح الخير، ${t("croName", shell)}` : `Good morning, ${t("croName", shell)}`}
                  </h1>
                  <p className="text-xs text-gray-500">{isAr ? "5 مايو 2026 · أربع قرارات حرجة بانتظار توقيعك" : "May 5, 2026 · 4 critical decisions waiting on you"}</p>
                </div>
                <button onClick={() => { setView("approvals"); }} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: BRAND }}>
                  {recs.length} {t("decisionsWaiting", shell)} →
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {kpiTiles.map((k) => (
                  <div key={k.key} className="border border-gray-100 rounded-xl p-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{t(k.key, kpis)}</p>
                    <p className="text-base font-bold mt-0.5" style={{ color: BRAND_INK }}>{k.value}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5 truncate">{k.sub}</p>
                  </div>
                ))}
              </div>
            </div>

            {view === "register" && <ObligationsRegisterView onNavigate={navigateTo} />}
            {view === "circular" && <CircularDetailView circularId={circularId} onNavigate={navigateTo} />}
            {view === "approvals" && <ApprovalsView />}
            {view === "controls" && <ControlsLibraryView />}
            {view === "returns" && <ReturnsCalendarView onNavigate={navigateTo} />}
            {view === "audit" && <AuditLogView />}
          </div>
        </main>
      </div>

      {/* AI FAB */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className={`fixed bottom-6 ${isAr ? "left-6" : "right-6"} h-12 px-4 rounded-full text-white shadow-2xl flex items-center gap-2 z-40 hover:scale-105 transition-transform`}
          style={{ background: BRAND, color: BRAND_INK }}
        >
          <MessageSquare size={16} />
          <span className="text-xs font-bold">{t("fabAskAi", shell)}</span>
        </button>
      )}

      <AnimatePresence>
        {chatOpen && <AiChat onClose={() => setChatOpen(false)} onNavigate={navigateTo} />}
      </AnimatePresence>
    </div>
  );
}
