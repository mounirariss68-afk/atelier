import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, Users, FileText, Inbox, Wallet, Workflow, Bell, MessageCircle,
  LogOut, X, ArrowLeftRight, Building2,
} from "lucide-react";
import DashboardView from "./client/DashboardView";
import EmployeesView from "./client/EmployeesView";
import DocumentsView from "./client/DocumentsView";
import ServiceRequestsView from "./client/ServiceRequestsView";
import PayrollView from "./client/PayrollView";
import ProcessesView from "./client/ProcessesView";
import ClientChat from "./client/ClientChat";
import { useTasamaData } from "@/hooks/useTasamaData";
import { useTasamaDemoLang } from "./DemoLangContext";
import { clientShell, tDict } from "./tasama-i18n";
import { getSaudizationBandLabel, formatPercent, formatDate, SAUDIZATION_BAND_COLOR } from "@/data/tasama-seed";

export type ClientViewId = "dashboard" | "employees" | "documents" | "requests" | "payroll" | "processes";

const NAV_ITEMS: { id: ClientViewId; labelKey: "navDashboard" | "navEmployees" | "navDocuments" | "navRequests" | "navPayroll" | "navProcesses"; icon: typeof Home }[] = [
  { id: "dashboard", labelKey: "navDashboard", icon: Home },
  { id: "employees", labelKey: "navEmployees", icon: Users },
  { id: "documents", labelKey: "navDocuments", icon: FileText },
  { id: "requests", labelKey: "navRequests", icon: Inbox },
  { id: "payroll", labelKey: "navPayroll", icon: Wallet },
  { id: "processes", labelKey: "navProcesses", icon: Workflow },
];

const CLIENT_ID = "client-alnakhla";

export default function ClientPortalShell() {
  const { lang, setLang } = useTasamaDemoLang();
  const t = tDict(clientShell, lang);
  const isRtl = lang === "ar";
  const data = useTasamaData();
  const client = data.clients.find((c) => c.id === CLIENT_ID);

  const [view, setView] = useState<ClientViewId>("dashboard");
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    return () => {
      document.documentElement.dir = "ltr";
    };
  }, [isRtl]);

  const notifications = [
    { id: 1, type: "payroll", text: t.notif1, time: t.notif1Time, dot: "bg-[#0D9488]" },
    { id: 2, type: "document", text: t.notif2, time: t.notif2Time, dot: "bg-blue-500" },
    { id: 3, type: "compliance", text: t.notif3, time: t.notif3Time, dot: "bg-amber-500" },
    { id: 4, type: "process", text: t.notif4, time: t.notif4Time, dot: "bg-purple-500" },
    { id: 5, type: "alert", text: t.notif5, time: t.notif5Time, dot: "bg-red-500" },
  ];

  const bandColor = client ? SAUDIZATION_BAND_COLOR[client.saudizationBand] : "#10B981";

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-gray-800" dir={isRtl ? "rtl" : "ltr"}>
      <header className="flex-shrink-0 h-14 bg-[#0F766E] text-white flex items-center px-4 gap-4 z-30 relative">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center text-white font-bold text-sm">
            <Building2 size={16} />
          </div>
          <div className="hidden sm:block leading-tight">
            <p className="text-[11px] font-bold tracking-wide">TASAMA</p>
            <p className="text-[10px] font-semibold text-teal-100">{t.portalName}</p>
          </div>
        </div>
        <div className="h-6 w-px bg-white/20" />
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{client ? (lang === "en" ? client.legalNameEn : client.legalNameAr) : t.companyName}</p>
            <p className="text-[11px] text-teal-100">{t.industry}{client ? ` · ${client.employeeCount} ${lang === "en" ? "employees" : "موظف"}` : ""}</p>
          </div>
          {client && (
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0" style={{ backgroundColor: bandColor + "30", color: "#FFF" }}>
              {t.bandLabel}: {getSaudizationBandLabel(client.saudizationBand, lang)} · {formatPercent(client.saudizationPercent, 0)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <button onClick={() => setNotifOpen(!notifOpen)} className="relative p-2 hover:bg-white/10 rounded-lg transition-colors" aria-label={t.notifications}>
              <Bell size={18} />
              {notifications.length > 0 && (
                <span className="absolute top-0.5 end-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold flex items-center justify-center">{notifications.length}</span>
              )}
            </button>
          </div>
          <button onClick={() => setChatOpen(true)} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title={t.aiAssistant} aria-label={t.aiAssistant}>
            <MessageCircle size={18} />
          </button>
          <div className="flex items-center bg-white/10 rounded-full p-0.5 ms-1">
            <button onClick={() => setLang("en")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${lang === "en" ? "bg-white text-[#0F766E]" : "text-white/60 hover:text-white"}`}>EN</button>
            <button onClick={() => setLang("ar")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${lang === "ar" ? "bg-white text-[#0F766E]" : "text-white/60 hover:text-white"}`}>AR</button>
          </div>
          <Link href="/demo/tasama-payroll-hub/manager" className="text-xs text-teal-100 hover:text-white flex items-center gap-1 ms-1" title={t.switchToManager}>
            <ArrowLeftRight size={14} />
            <span className="hidden md:inline">{t.switchToManager}</span>
          </Link>
          <Link href="/marketplace/tasama-payroll-hub" className="text-xs text-teal-100 hover:text-white flex items-center gap-1">
            <LogOut size={14} />
            <span className="hidden md:inline">{t.logout}</span>
          </Link>
        </div>

        <AnimatePresence>
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="absolute top-12 end-20 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 text-gray-700 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <p className="text-sm font-bold">{t.notifications}</p>
                  <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                  {notifications.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-gray-400">{t.notifEmpty}</div>
                  ) : notifications.map((n) => (
                    <div key={n.id} className="px-4 py-3 hover:bg-gray-50/50 cursor-pointer">
                      <div className="flex items-start gap-2">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.dot}`} />
                        <div className="min-w-0">
                          <p className="text-xs text-gray-700">{n.text}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">{n.time}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </header>

      <div className="flex-1 flex min-h-0">
        <nav className="flex-shrink-0 w-52 bg-white border-e border-gray-200 flex flex-col">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`px-4 py-3 flex items-center gap-3 text-[13px] font-medium border-s-[3px] transition-colors ${
                  active ? "border-[#0F766E] text-[#0F766E] bg-teal-50/60" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}
              >
                <Icon size={18} />
                {t[item.labelKey]}
              </button>
            );
          })}
          <div className="mt-auto border-t border-gray-100">
            <button
              onClick={() => setChatOpen(true)}
              className="w-full px-4 py-3 flex items-center gap-3 text-[13px] font-semibold border-s-[3px] border-transparent text-[#0F766E] hover:bg-teal-50/40 transition-colors"
            >
              <MessageCircle size={18} />
              {t.aiAssistant}
            </button>
            {client && (
              <div className="px-4 py-3 border-t border-gray-100 text-[10px] text-gray-400">
                <p>{t.contractSince}</p>
                <p className="text-gray-600 font-semibold mt-0.5">{formatDate(client.onboardedAt, lang)}</p>
              </div>
            )}
          </div>
        </nav>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-6">
            <AnimatePresence mode="wait">
              <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                {view === "dashboard" && <DashboardView onNavigate={setView} />}
                {view === "employees" && <EmployeesView />}
                {view === "documents" && <DocumentsView />}
                {view === "requests" && <ServiceRequestsView />}
                {view === "payroll" && <PayrollView />}
                {view === "processes" && <ProcessesView />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {chatOpen && <ClientChat onClose={() => setChatOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
