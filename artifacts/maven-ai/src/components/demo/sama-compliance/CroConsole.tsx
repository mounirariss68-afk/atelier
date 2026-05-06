import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Filter, FileText, Inbox, ShieldCheck, CalendarClock, History, MessageSquare,
} from "lucide-react";
import { SamaComplianceDataProvider, useSamaComplianceData } from "@/hooks/useSamaComplianceData";
import { SamaDemoLangProvider, useSamaDemoLang } from "./DemoLangContext";
import { shell, kpis, useTrFactory } from "./sama-i18n";
import { BRAND, BRAND_INK } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import { generateAlerts, generateRecommendations, type Severity } from "@/data/sama-compliance-agent";
import { formatAed, relativeTime } from "@/data/sama-compliance-seed";
import ObligationsRegisterView from "./views/ObligationsRegisterView";
import CircularDetailView from "./views/CircularDetailView";
import ApprovalsView from "./views/ApprovalsView";
import ControlsLibraryView from "./views/ControlsLibraryView";
import ReturnsCalendarView from "./views/ReturnsCalendarView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";
import { UserDemoShell } from "@/components/demo/_shell";

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
  const [, setLocation] = useLocation();

  const [view, setView] = useState<View>("register");
  const [circularId, setCircularId] = useState<string | undefined>(undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [notifRead, setNotifRead] = useState<Record<string, boolean>>({});

  const alerts = useMemo(() => generateAlerts(), []);
  const recs = useMemo(() => generateRecommendations(), []);
  const unread = alerts.filter((a) => !notifRead[a.id]).length;

  const navigateTo = (v: string, id?: string) => {
    if (NAV.some((n) => n.id === v)) {
      setView(v as View);
      if (v === "circular" && id) setCircularId(id);
      setChatOpen(false);
    }
  };

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

  const sidebar = (
    <nav className="w-52 h-full bg-white border-r border-gray-200 flex flex-col">
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
  );

  const fab = !chatOpen ? (
    <button
      onClick={() => setChatOpen(true)}
      className={`fixed bottom-6 ${isAr ? "left-6" : "right-6"} h-12 px-4 rounded-full text-white shadow-2xl flex items-center gap-2 z-40 hover:scale-105 transition-transform`}
      style={{ background: BRAND, color: BRAND_INK }}
    >
      <MessageSquare size={16} />
      <span className="text-xs font-bold">{t("fabAskAi", shell)}</span>
    </button>
  ) : null;

  const drawers = (
    <AnimatePresence>
      {chatOpen && <AiChat onClose={() => setChatOpen(false)} onNavigate={navigateTo} />}
    </AnimatePresence>
  );

  return (
    <UserDemoShell
      lang={lang}
      header={
        <DemoTopBar
          marketplaceSlug="sama-compliance-sentinel"
          accent={getDemoAccent("sama-compliance-sentinel")}
          brandTag={t("brandTag", shell)}
          platformTitle={t("platformTitle", shell)}
          backLabel={t("back", shell)}
          lang={lang}
          setLang={setLang}
          persona={{
            initials: t("croInitials", shell),
            name: t("croName", shell),
            title: t("croTitle", shell),
          }}
          notifications={{
            panelTitle: t("notifications", shell),
            urgentLabel: isAr ? "جديد" : "new",
            emptyLabel: t("noAlerts", shell),
            seeAllLabel: t("seeAll", shell),
            onSeeAll: () => navigateTo("audit"),
            unreadCount: unread,
            items: alerts.map((a) => ({
              id: a.id,
              severity: a.severity as "critical" | "high" | "medium" | "low" | "info",
              title: a.title[lang] ?? a.title.en,
              detail: a.detail[lang] ?? a.detail.en,
              timestamp: relativeTime(a.timestamp, lang),
              onClick: () => {
                setNotifRead((p) => ({ ...p, [a.id]: true }));
                if (a.href) navigateTo(a.href.view, a.href.id);
              },
            })),
          }}
          onSwitchView={() => setLocation("/demo/sama-compliance-sentinel")}
          switchViewLabel={t("switchView", shell)}
        />
      }
      sidebar={sidebar}
      fab={fab}
      drawers={drawers}
      background="#F4F6F8"
      textColor="#0E2841"
      applyInterFont={false}
      height="min"
    >
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto p-6 space-y-6">
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
    </UserDemoShell>
  );
}
