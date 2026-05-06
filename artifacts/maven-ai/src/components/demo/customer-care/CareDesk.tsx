import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Headphones, Inbox, ShieldCheck, Activity, BookOpen, ListTree, ArrowLeft, LogOut,
  Sparkles, MessageSquare, ChevronRight,
} from "lucide-react";
import { useCareLang, CareLangProvider } from "./DemoLangContext";
import { CareToastProvider } from "./ToastContext";
import { shell, tDict } from "./care-i18n";
import { BRAND, BRAND_DARK } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import { AiChat } from "./AiChat";
import DeskView from "./views/DeskView";
import MyQueueView from "./views/MyQueueView";
import ApprovalsView from "./views/ApprovalsView";
import SupervisorStripView from "./views/SupervisorStripView";
import KnowledgeView from "./views/KnowledgeView";
import AuditLogView from "./views/AuditLogView";
import { useCustomerCareData } from "@/hooks/useCustomerCareData";
import { getDeskKpis } from "@/data/customer-care-agent";
import { UserDemoShell } from "@/components/demo/_shell";

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
  const [, setLocation] = useLocation();
  const [view, setView] = useState<CareViewId>("desk");
  const [chatOpen, setChatOpen] = useState(false);
  const data = useCustomerCareData();
  const kpis = useMemo(() => getDeskKpis(lang), [lang]);

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

  const sidebar = (
    <aside className="w-60 h-full bg-white border-e border-gray-200 flex flex-col">
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
  );

  const topbar = (
    <DemoTopBar
      marketplaceSlug="customer-care-hive"
      accent={getDemoAccent("customer-care-hive")}
      brandTag={t.brandTag}
      platformTitle={t.brandTitle}
      backLabel={lang === "en" ? "Back" : "رجوع"}
      lang={lang}
      setLang={setLang}

      persona={{
        initials: lang === "en" ? "AB" : "ع",
        name: t.personaName,
        title: t.personaRole,
      }}
      actionButton={
        <button onClick={() => setChatOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white px-3 py-1.5 rounded-lg" style={{ background: BRAND }}>
          <Sparkles size={12} /> {t.aiAssistant}
        </button>
      }
      notifications={{
        panelTitle: t.notifications,
        emptyLabel: t.notifEmpty,
        unreadCount: data.notifications.length,
        items: data.notifications.map((n) => ({
          id: n.id,
          severity: n.severity as "critical" | "high" | "medium" | "low" | "info",
          title: lang === "en" ? n.textEn : n.textAr,
          timestamp: n.time,
        })),
      }}
      onSwitchView={() => setLocation("/demo/customer-care-hive")}
      switchViewLabel={t.switchView}
    />
  );

  const belowTopbar = (
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
  );

  return (
    <UserDemoShell
      lang={lang}
      sidebar={sidebar}
      header={topbar}
      belowTopbar={belowTopbar}
      drawers={<AiChat open={chatOpen} onClose={() => setChatOpen(false)} />}
      background="#F9FAFB"
      height="min"
      applyInterFont={false}
    >
      <main className="flex-1 overflow-y-auto px-5 py-5">{renderView()}</main>
    </UserDemoShell>
  );
}

export default function CareDesk() {
  return (
    <CareLangProvider>
      <CareToastProvider>
        <Inner />
      </CareToastProvider>
    </CareLangProvider>
  );
}
