import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Headphones, Inbox, ShieldCheck, Activity, BookOpen, ListTree, ArrowLeft, Bell, LogOut,
  Sparkles, Globe2, ChevronDown, MessageSquare, ChevronRight,
} from "lucide-react";
import { useCareLang, CareLangProvider } from "./DemoLangContext";
import { CareToastProvider } from "./ToastContext";
import { shell, tDict } from "./care-i18n";
import { BRAND, BRAND_DARK } from "./tokens";
import { AiChat } from "./AiChat";
import DeskView from "./views/DeskView";
import MyQueueView from "./views/MyQueueView";
import ApprovalsView from "./views/ApprovalsView";
import SupervisorStripView from "./views/SupervisorStripView";
import KnowledgeView from "./views/KnowledgeView";
import AuditLogView from "./views/AuditLogView";
import { useCustomerCareData } from "@/hooks/useCustomerCareData";
import { getDeskKpis } from "@/data/customer-care-agent";

export type CareViewId = "desk" | "queue" | "approvals" | "supervisor" | "knowledge" | "audit";

const NAV: { id: CareViewId; icon: typeof Headphones; key: "navDesk" | "navQueue" | "navApprovals" | "navSupervisor" | "navKnowledge" | "navAudit" }[] = [
  { id: "desk", icon: Headphones, key: "navDesk" },
  { id: "queue", icon: Inbox, key: "navQueue" },
  { id: "approvals", icon: ShieldCheck, key: "navApprovals" },
  { id: "supervisor", icon: Activity, key: "navSupervisor" },
  { id: "knowledge", icon: BookOpen, key: "navKnowledge" },
  { id: "audit", icon: ListTree, key: "navAudit" },
];

function Inner() {
  const { lang, setLang } = useCareLang();
  const t = tDict(shell, lang);
  const [view, setView] = useState<CareViewId>("desk");
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const data = useCustomerCareData();
  const kpis = useMemo(() => getDeskKpis(lang), [lang]);

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    return () => { document.documentElement.dir = "ltr"; };
  }, [lang]);

  const renderView = () => {
    switch (view) {
      case "desk": return <DeskView />;
      case "queue": return <MyQueueView onOpenDesk={() => setView("desk")} />;
      case "approvals": return <ApprovalsView />;
      case "supervisor": return <SupervisorStripView />;
      case "knowledge": return <KnowledgeView />;
      case "audit": return <AuditLogView />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex" dir={lang === "ar" ? "rtl" : "ltr"}>
      {/* Sidebar */}
      <aside className="w-60 bg-white border-e border-gray-200 flex flex-col flex-shrink-0">
        <div className="px-4 py-4 border-b border-gray-100">
          <Link href="/marketplace/customer-care-hive" className="flex items-center gap-2 text-[11px] text-gray-400 hover:text-gray-600 mb-2.5">
            <ArrowLeft size={11} className="rtl:rotate-180" /> {t.brandTitle}
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BRAND }}>
              <Headphones size={15} className="text-white" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">{t.brandTitle}</p>
              <p className="text-sm font-bold leading-tight">{t.brandTag}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2.5 py-4 space-y-0.5">
          {NAV.map((n) => {
            const I = n.icon;
            const active = view === n.id;
            return (
              <button key={n.id} onClick={() => setView(n.id)} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${active ? "text-white font-semibold" : "text-gray-600 hover:bg-gray-50"}`} style={active ? { background: BRAND } : {}}>
                <I size={14} />
                <span>{t[n.key]}</span>
                {active && <ChevronRight size={11} className="ms-auto rtl:rotate-180" />}
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-gray-100">
          <Link href="/demo/customer-care-hive" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-50 mb-1">
            <Activity size={12} /> {t.switchView}
          </Link>
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-50">
            <LogOut size={12} /> {t.logout}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-5 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold" style={{ background: BRAND_DARK }}>
              {lang === "en" ? "AB" : "ع"}
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">{t.personaName}</p>
              <p className="text-[11px] text-gray-500">{t.personaRole}</p>
            </div>
          </div>

          <div className="ms-auto flex items-center gap-2">
            <button onClick={() => setLang(lang === "en" ? "ar" : "en")} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
              <Globe2 size={12} /> {lang === "en" ? "AR" : "EN"} <ChevronDown size={10} />
            </button>
            <div className="relative">
              <button onClick={() => setNotifOpen((o) => !o)} className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-600">
                <Bell size={15} />
                {data.notifications.length > 0 && (
                  <span className="absolute top-1 end-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </button>
              <AnimatePresence>
                {notifOpen && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute end-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="text-xs font-bold">{t.notifications}</h3>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {data.notifications.length === 0 ? (
                        <p className="text-xs text-gray-400 px-4 py-6 text-center">{t.notifEmpty}</p>
                      ) : (
                        data.notifications.map((n) => (
                          <div key={n.id} className="px-4 py-2.5 border-b border-gray-50 hover:bg-gray-50">
                            <div className="flex items-start gap-2">
                              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.severity === "critical" ? "bg-red-500" : n.severity === "high" ? "bg-amber-500" : n.severity === "medium" ? "bg-blue-500" : "bg-gray-300"}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-700">{lang === "en" ? n.textEn : n.textAr}</p>
                                <p className="text-[10px] text-gray-400 mt-0.5">{n.time}</p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button onClick={() => setChatOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-1.5 rounded-lg" style={{ background: BRAND }}>
              <Sparkles size={12} /> {t.aiAssistant}
            </button>
          </div>
        </header>

        {/* KPI strip */}
        <div className="bg-white border-b border-gray-200 px-5 py-3 overflow-x-auto">
          <div className="flex gap-3 min-w-max">
            {kpis.map((k, i) => (
              <motion.div key={k.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="bg-gray-50 rounded-lg px-3.5 py-2 min-w-[150px]">
                <p className="text-base font-bold leading-tight">{k.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{k.label}</p>
                {k.sub && <p className="text-[10px] mt-0.5" style={{ color: BRAND_DARK }}>{k.sub}</p>}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-5 py-5">{renderView()}</main>
      </div>

      <AiChat open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}

void MessageSquare;

export default function CareDesk() {
  return (
    <CareLangProvider>
      <CareToastProvider>
        <Inner />
      </CareToastProvider>
    </CareLangProvider>
  );
}
