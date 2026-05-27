import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListChecks, GanttChart, BadgeCheck, Truck, MailPlus, ClipboardList,
  Bot,
} from "lucide-react";
import { ProcurementDemoLangProvider, useProcurementDemoLang } from "./DemoLangContext";
import { ProcurementDataProvider, useProcurementData } from "@/hooks/useProcurementNegotiationData";
import { shell as t } from "./procurement-i18n";
import { BRAND } from "./tokens";
import DemoTopBar from "../DemoTopBar";
import { getDemoAccent } from "@workspace/maven-content";
import EventsView from "./views/EventsView";
import EventWorkspaceView from "./views/EventWorkspaceView";
import ApprovalsView from "./views/ApprovalsView";
import SuppliersView from "./views/SuppliersView";
import CounterBidComposerView from "./views/CounterBidComposerView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";
import { Toaster } from "@/components/ui/toaster";
import { UserDemoShell } from "@/components/demo/_shell";

export type ViewId = "events" | "workspace" | "approvals" | "suppliers" | "counter" | "audit";

const NAV_ITEMS: { id: ViewId; icon: typeof ListChecks; labelKey: keyof typeof t }[] = [
  { id: "events",     icon: ListChecks,    labelKey: "navEvents" },
  { id: "workspace",  icon: GanttChart,    labelKey: "navWorkspace" },
  { id: "approvals",  icon: BadgeCheck,    labelKey: "navApprovals" },
  { id: "suppliers",  icon: Truck,         labelKey: "navSuppliers" },
  { id: "counter",    icon: MailPlus,      labelKey: "navCounter" },
  { id: "audit",      icon: ClipboardList, labelKey: "navAudit" },
];

export default function SourcingDesk() {
  return (
    <ProcurementDemoLangProvider>
      <ProcurementDataProvider>
        <SourcingDeskInner />
      </ProcurementDataProvider>
    </ProcurementDemoLangProvider>
  );
}

function SourcingDeskInner() {
  const { lang, setLang } = useProcurementDemoLang();
  const isAr = lang === "ar";
  const [, setLocation] = useLocation();
  const { persona, notifications } = useProcurementData();
  const [view, setView] = useState<ViewId>("events");
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ view: ViewId }>).detail;
      if (detail?.view) setView(detail.view);
    };
    window.addEventListener("procurement:navigate", handler);
    return () => window.removeEventListener("procurement:navigate", handler);
  }, []);

  const header = (
    <DemoTopBar
      marketplaceSlug="procurement-negotiation-agent"
      accent={getDemoAccent("procurement-negotiation-agent")}
      brandTag={t.brandTag[lang]}
      platformTitle={t.platformTitle[lang]}
      backLabel={t.back[lang]}
      lang={lang}
      setLang={setLang}

      persona={{
        initials: persona.initials,
        name: isAr ? persona.nameAr : persona.nameEn,
        title: isAr ? persona.roleAr : persona.roleEn,
      }}
      notifications={{
        panelTitle: t.agentAlerts[lang],
        emptyLabel: t.noNotifs[lang],
        unreadCount: notifications.length,
        items: notifications.map((n) => ({
          id: n.id,
          severity: n.severity as "critical" | "high" | "medium" | "low" | "info",
          title: isAr ? n.titleAr : n.titleEn,
          detail: isAr ? n.subAr : n.subEn,
          timestamp: n.ts,
          onClick: () => setView(n.view as ViewId),
        })),
      }}
      onSwitchView={() => setLocation("/demo/procurement-negotiation-agent")}
      switchViewLabel={t.switchToCockpit[lang]}
    />
  );

  const sidebar = (
    <nav className="w-56 h-full bg-white border-gray-200 flex flex-col" style={{ borderInlineEndWidth: 1 }}>
      <div className="flex-1 py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-medium transition-colors`}
              style={{
                background: active ? `${BRAND}0D` : "transparent",
                color: active ? BRAND : "#6b7280",
                borderInlineStartWidth: 3,
                borderInlineStartColor: active ? BRAND : "transparent",
                borderInlineStartStyle: "solid",
              }}
            >
              <Icon size={17} className="flex-shrink-0" />
              <span className="truncate">{t[item.labelKey][lang]}</span>
            </button>
          );
        })}
        <div className="h-px bg-gray-100 mx-3 my-2" />
        <button
          onClick={() => setChatOpen(true)}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-medium text-gray-500 hover:bg-gray-50 hover:text-[#0A1230] transition-colors"
          style={{ borderInlineStartWidth: 3, borderInlineStartColor: "transparent", borderInlineStartStyle: "solid" }}
        >
          <Bot size={17} className="flex-shrink-0" />
          <span>{t.aiAssistant[lang]}</span>
          <span className="ms-auto text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full" style={{ background: BRAND }}>{t.aiBadge[lang]}</span>
        </button>
      </div>
    </nav>
  );

  const drawers = (
    <>
      <AnimatePresence>
        {chatOpen && <AiChat onClose={() => setChatOpen(false)} />}
      </AnimatePresence>
      <Toaster />
    </>
  );

  return (
    <UserDemoShell
      lang={lang}
      header={header}
      sidebar={sidebar}
      drawers={drawers}
      background="#F4F6F8"
      textColor="#0A1230"
      height="min"
      applyInterFont={false}
    >
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {view === "events" && <EventsView onOpenEvent={() => setView("workspace")} onApprove={() => setView("approvals")} />}
              {view === "workspace" && <EventWorkspaceView />}
              {view === "approvals" && <ApprovalsView />}
              {view === "suppliers" && <SuppliersView />}
              {view === "counter" && <CounterBidComposerView />}
              {view === "audit" && <AuditLogView />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </UserDemoShell>
  );
}
