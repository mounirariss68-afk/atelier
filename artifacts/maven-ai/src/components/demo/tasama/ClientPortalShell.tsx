import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, Users, FileText, Inbox, Wallet, Workflow, Bell, MessageCircle,
  LogOut, X, Globe,
} from "lucide-react";
import DashboardView from "./client/DashboardView";
import EmployeesView from "./client/EmployeesView";
import DocumentsView from "./client/DocumentsView";
import ServiceRequestsView from "./client/ServiceRequestsView";
import PayrollView from "./client/PayrollView";
import ProcessesView from "./client/ProcessesView";
import ClientChat from "./client/ClientChat";
import { ClientToastProvider } from "./client/ToastContext";
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

  // Close popovers / drawers on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (chatOpen) setChatOpen(false);
      else if (notifOpen) setNotifOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, notifOpen]);

  const notifications = [
    { id: 1, type: "payroll", text: t.notif1, time: t.notif1Time, dot: "bg-[#3B30E0]" },
    { id: 2, type: "document", text: t.notif2, time: t.notif2Time, dot: "bg-blue-500" },
    { id: 3, type: "compliance", text: t.notif3, time: t.notif3Time, dot: "bg-amber-500" },
    { id: 4, type: "process", text: t.notif4, time: t.notif4Time, dot: "bg-purple-500" },
    { id: 5, type: "alert", text: t.notif5, time: t.notif5Time, dot: "bg-red-500" },
  ];

  const bandColor = client ? SAUDIZATION_BAND_COLOR[client.saudizationBand] : "#10B981";

  const handleLogout = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === "undefined") return;
    if (!window.confirm(t.logoutConfirm)) {
      e.preventDefault();
    }
  };

  const adminInitials = isRtl ? "م.ن" : "AA";

  return (
    <ClientToastProvider>
      <div className="h-screen flex flex-col bg-gray-50 text-gray-800" dir={isRtl ? "rtl" : "ltr"}>
        <header className="flex-shrink-0 h-16 bg-[#0F0698] text-white flex items-center px-4 gap-4 z-30 relative">
          <div className="flex items-center flex-shrink-0">
            <img
              src={`${import.meta.env.BASE_URL}tasama-logo-light.png`}
              alt="Tasama · Business Services · تسامي لخدمات الأعمال"
              className="h-10 w-auto object-contain"
            />
          </div>
          <div className="h-6 w-px bg-white/20" />
          <div className="flex-1 flex items-start gap-3 min-w-0 py-1">
            <div className="min-w-0">
              <p className="text-sm font-bold truncate leading-tight">{client ? (lang === "en" ? client.legalNameEn : client.legalNameAr) : t.companyName}</p>
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                <p className="text-[11px] text-blue-100">{t.industry}{client ? ` · ${client.employeeCount} ${lang === "en" ? "employees" : "موظف"}` : ""}</p>
                {client && (
                  <span
                    className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0"
                    style={{ backgroundColor: bandColor + "30", color: "#FFF" }}
                    title={`${t.bandLabel}: ${getSaudizationBandLabel(client.saudizationBand, lang)}`}
                  >
                    {t.bandLabel}: {getSaudizationBandLabel(client.saudizationBand, lang)} · {formatPercent(client.saudizationPercent, 0)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="hidden md:flex items-center gap-2 me-2 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors cursor-default">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-white/30 to-white/10 flex items-center justify-center text-[10px] font-bold border border-white/20">
                {adminInitials}
              </div>
              <div className="leading-tight">
                <p className="text-[11px] font-semibold">{t.adminName}</p>
                <p className="text-[9px] text-blue-100">{t.adminTitle}</p>
              </div>
            </div>
            <div className="relative">
              <button onClick={() => setNotifOpen(!notifOpen)} className="relative p-2 hover:bg-white/10 rounded-lg transition-colors" aria-label={t.notifications}>
                <Bell size={18} />
                {notifications.length > 0 && (
                  <span className="absolute top-0.5 end-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold flex items-center justify-center">{notifications.length}</span>
                )}
              </button>
            </div>
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-[11px] font-semibold"
              title={t.languageToggle}
              aria-label={t.languageToggle}
            >
              <Globe size={14} />
              {lang === "en" ? "EN" : "AR"}
            </button>
            <Link
              href="/marketplace/tasama-payroll-hub"
              onClick={handleLogout}
              className="text-xs text-blue-100 hover:text-white flex items-center gap-1 ms-1 px-2 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
            >
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
                  <div className="max-h-72 overflow-y-auto tasama-scroll divide-y divide-gray-50">
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
          <nav className="flex-shrink-0 w-52 bg-white border-e border-gray-200 flex flex-col tasama-scroll overflow-y-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`px-4 py-3 flex items-center gap-3 text-[13px] font-medium border-s-[3px] transition-colors ${
                    active ? "border-[#0F0698] text-[#0F0698] bg-blue-50/60" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <Icon size={18} />
                  {t[item.labelKey]}
                </button>
              );
            })}
            {client && (
              <div className="mt-auto px-4 py-3 border-t border-gray-100 text-[10px] text-gray-400">
                <p>{t.contractSince}</p>
                <p className="text-gray-600 font-semibold mt-0.5">{formatDate(client.onboardedAt, lang)}</p>
              </div>
            )}
          </nav>

          <main className="flex-1 overflow-y-auto tasama-scroll">
            <div className="max-w-6xl mx-auto p-6">
              <AnimatePresence mode="wait">
                <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  {view === "dashboard" && <DashboardView onNavigate={setView} />}
                  {view === "employees" && <EmployeesView onNavigate={setView} />}
                  {view === "documents" && <DocumentsView />}
                  {view === "requests" && <ServiceRequestsView />}
                  {view === "payroll" && <PayrollView />}
                  {view === "processes" && <ProcessesView />}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>

        {/* AI Assistant FAB */}
        {!chatOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 240, damping: 18 }}
            onClick={() => setChatOpen(true)}
            className="group fixed bottom-6 end-6 z-40 flex items-center gap-2 h-14 ps-4 pe-5 rounded-full bg-gradient-to-br from-[#0F0698] to-[#3B30E0] text-white shadow-xl hover:shadow-2xl transition-shadow"
            aria-label={t.aiAssistant}
            title={t.aiAssistant}
          >
            <span className="absolute inset-0 rounded-full bg-[#3B30E0] opacity-40 animate-ping pointer-events-none" />
            <span className="relative flex items-center justify-center">
              <MessageCircle size={20} />
            </span>
            <span className="relative max-w-0 overflow-hidden whitespace-nowrap text-xs font-semibold transition-[max-width] duration-300 group-hover:max-w-[160px]">
              {t.aiAssistant}
            </span>
          </motion.button>
        )}

        <AnimatePresence>
          {chatOpen && <ClientChat onClose={() => setChatOpen(false)} />}
        </AnimatePresence>
      </div>
    </ClientToastProvider>
  );
}
