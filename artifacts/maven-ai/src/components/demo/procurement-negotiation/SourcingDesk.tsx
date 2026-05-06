import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListChecks, GanttChart, BadgeCheck, Truck, MailPlus, ClipboardList,
  Bot, Bell, LogOut, ArrowLeft, ArrowLeftRight, X, AlertTriangle,
} from "lucide-react";
import { ProcurementDemoLangProvider, useProcurementDemoLang, type DemoLang } from "./DemoLangContext";
import { ProcurementDataProvider, useProcurementData } from "@/hooks/useProcurementNegotiationData";
import { shell as t } from "./procurement-i18n";
import { BRAND, NAVY, BRAND_MUTED } from "./tokens";
import EventsView from "./views/EventsView";
import EventWorkspaceView from "./views/EventWorkspaceView";
import ApprovalsView from "./views/ApprovalsView";
import SuppliersView from "./views/SuppliersView";
import CounterBidComposerView from "./views/CounterBidComposerView";
import AuditLogView from "./views/AuditLogView";
import AiChat from "./AiChat";
import { Toaster } from "@/components/ui/toaster";

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
  const { persona, notifications } = useProcurementData();
  const [view, setView] = useState<ViewId>("events");
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // RTL toggle on the document so dialogs/portals inherit direction.
  useEffect(() => {
    const prevDir = document.documentElement.dir;
    const prevLang = document.documentElement.lang;
    document.documentElement.dir = isAr ? "rtl" : "ltr";
    document.documentElement.lang = isAr ? "ar" : "en";
    return () => {
      document.documentElement.dir = prevDir;
      document.documentElement.lang = prevLang;
    };
  }, [isAr]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Listen for cross-component navigation requests from the AI chat
  // (e.g. "Switch to TCO view" routes the user to the workspace view in
  // addition to dispatching the matrix-mode event).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ view: ViewId }>).detail;
      if (detail?.view) setView(detail.view);
    };
    window.addEventListener("procurement:navigate", handler);
    return () => window.removeEventListener("procurement:navigate", handler);
  }, []);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="h-screen flex flex-col bg-[#F4F6F8] text-[#0E2841]">
      {/* Header */}
      <header className="flex-shrink-0 h-14 text-white flex items-center px-4 gap-3 z-20" style={{ background: NAVY }}>
        <Link href="/marketplace/procurement-negotiation-agent" className="flex items-center gap-1 text-xs text-gray-400 hover:text-white">
          <ArrowLeft size={14} className={isAr ? "rotate-180" : ""} />
          <span className="hidden md:inline">{t.back[lang]}</span>
        </Link>
        <div className="h-5 w-px bg-white/20" />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: BRAND }}>{t.brandTag[lang]}</p>
          <p className="text-xs font-semibold truncate">{t.platformTitle[lang]}</p>
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button onClick={() => setNotifOpen((o) => !o)} className="relative p-2 hover:bg-white/10 rounded-lg" aria-label={t.notifications[lang]}>
            <Bell size={16} />
            {notifications.length > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 px-1 rounded-full text-[9px] font-bold flex items-center justify-center" style={{ background: BRAND }}>
                {notifications.length}
              </span>
            )}
          </button>
          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className={`absolute top-12 ${isAr ? "left-0" : "right-0"} w-80 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden text-[#0E2841]`}
              >
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center gap-1.5"><AlertTriangle size={14} style={{ color: BRAND }} /> {t.agentAlerts[lang]}</h3>
                  <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-gray-400">{t.noNotifs[lang]}</div>
                  ) : notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => { setView(n.view as ViewId); setNotifOpen(false); }}
                      className="w-full px-4 py-3 text-start hover:bg-gray-50"
                    >
                      <div className="flex items-start gap-2">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.severity === "critical" ? "bg-red-500" : n.severity === "high" ? "bg-orange-500" : "bg-amber-500"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{isAr ? n.titleAr : n.titleEn}</p>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{isAr ? n.subAr : n.subEn}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{n.ts}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Persona pill */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: BRAND }}>{persona.initials}</div>
          <div className="hidden md:block text-xs">
            <div className="font-semibold leading-tight">{isAr ? persona.nameAr : persona.nameEn}</div>
            <div className="text-gray-400 text-[10px] leading-tight">{isAr ? persona.roleAr : persona.roleEn}</div>
          </div>
        </div>

        {/* Lang toggle */}
        <div className="flex items-center bg-white/10 rounded-full p-0.5">
          {(["en", "ar"] as DemoLang[]).map((L) => (
            <button key={L} onClick={() => setLang(L)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${lang === L ? "bg-white text-[#0E2841]" : "text-white/60 hover:text-white"}`}>
              {L === "en" ? "EN" : "ع"}
            </button>
          ))}
        </div>

        <Link
          href="/demo/procurement-negotiation-agent"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10"
          title={t.switchToCockpit[lang]}
        >
          <ArrowLeftRight size={14} />
          <span className="hidden md:inline">{t.switchToCockpit[lang]}</span>
        </Link>
        <Link href="/marketplace/procurement-negotiation-agent" className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/10">
          <LogOut size={14} />
          <span className="hidden md:inline">{t.logout[lang]}</span>
        </Link>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        <nav className="flex-shrink-0 w-56 bg-white border-gray-200 flex flex-col" style={{ borderInlineEndWidth: 1 }}>
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
              className="w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-medium text-gray-500 hover:bg-gray-50 hover:text-[#0E2841] transition-colors"
              style={{ borderInlineStartWidth: 3, borderInlineStartColor: "transparent", borderInlineStartStyle: "solid" }}
            >
              <Bot size={17} className="flex-shrink-0" />
              <span>{t.aiAssistant[lang]}</span>
              <span className="ms-auto text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full" style={{ background: BRAND }}>{t.aiBadge[lang]}</span>
            </button>
          </div>
        </nav>

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
      </div>

      <AnimatePresence>
        {chatOpen && <AiChat onClose={() => setChatOpen(false)} />}
      </AnimatePresence>
      <Toaster />
    </div>
  );
}
