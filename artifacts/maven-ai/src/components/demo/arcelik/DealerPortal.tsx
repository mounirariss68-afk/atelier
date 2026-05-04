import { useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, ListOrdered, Tag, Target, Package, Bell, MessageCircle,
  LogOut, Award, X,
} from "lucide-react";
import DealerHomeView from "./dealer/DealerHomeView";
import PriceListView from "./dealer/PriceListView";
import CampaignsView from "./dealer/CampaignsView";
import TargetsView from "./dealer/TargetsView";
import StockOrdersView from "./dealer/StockOrdersView";
import AnnouncementsView from "./dealer/AnnouncementsView";
import DealerChat from "./dealer/DealerChat";
import { getCityName } from "@/data/arcelik-seed";
import { useArcelikData } from "@/hooks/useArcelikData";
import { DemoLangProvider, useDemoLang } from "./DemoLangContext";
import { dealerShell } from "./demo-i18n";

export type DealerViewId = "home" | "prices" | "campaigns" | "targets" | "stock" | "announcements";

export const OPTIMAL_STOCK: Record<string, number> = {
  buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8,
};
export const TIER_COLORS: Record<string, string> = { gold: "#F5A623", silver: "#94A3B8", bronze: "#CD7F32" };

const NAV_ITEMS: { id: DealerViewId; labelKey: "navHome" | "navPrices" | "navCampaigns" | "navTargets" | "navStock" | "navAnnouncements"; icon: typeof Home }[] = [
  { id: "home", labelKey: "navHome", icon: Home },
  { id: "prices", labelKey: "navPrices", icon: ListOrdered },
  { id: "campaigns", labelKey: "navCampaigns", icon: Tag },
  { id: "targets", labelKey: "navTargets", icon: Target },
  { id: "stock", labelKey: "navStock", icon: Package },
  { id: "announcements", labelKey: "navAnnouncements", icon: Bell },
];

export default function DealerPortal() {
  return (
    <DemoLangProvider>
      <DealerPortalInner />
    </DemoLangProvider>
  );
}

function DealerPortalInner() {
  const { lang, setLang } = useDemoLang();
  const t = dealerShell[lang];
  const { dealers, cities: allCities } = useArcelikData();
  const DEALER = dealers[0];
  const [view, setView] = useState<DealerViewId>("home");
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  if (!DEALER) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><p className="text-gray-500 text-sm">Loading dealer data…</p></div>;
  }

  const tierLabels: Record<string, string> = {
    gold: t.tierGold,
    silver: t.tierSilver,
    bronze: t.tierBronze,
  };

  const notifications = [
    { id: 1, type: "campaign" as const, text: t.notif1, time: t.notif1Time },
    { id: 2, type: "stock" as const, text: t.notif2, time: t.notif2Time },
    { id: 3, type: "campaign" as const, text: t.notif3, time: t.notif3Time },
    { id: 4, type: "announcement" as const, text: t.notif4, time: t.notif4Time },
  ];

  const cityObj = allCities.find((c) => c.id === DEALER.city);
  const cityName = cityObj ? getCityName(cityObj, lang) : "Istanbul";
  const lowStockCount = Object.entries(DEALER.stockLevels).filter(
    ([cat, level]) => (level ?? 0) < (OPTIMAL_STOCK[cat] ?? 10)
  ).length;
  const notifCount = lowStockCount + 2;

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-[#0E2841]">
      <header className="flex-shrink-0 h-14 bg-[#0E2841] text-white flex items-center px-4 gap-4 z-30 relative">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#E30613] flex items-center justify-center text-white font-bold text-sm">A</div>
          <div className="hidden sm:block leading-tight">
            <p className="text-[11px] font-bold text-[#E30613] tracking-wide">ARÇELİK</p>
            <p className="text-[10px] font-semibold text-white/70">{t.dealerPortal}</p>
          </div>
        </div>
        <div className="h-6 w-px bg-white/20" />
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{DEALER.storeName}</p>
            <p className="text-[11px] text-white/50">{DEALER.district}, {cityName}</p>
          </div>
          <span
            className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0"
            style={{ backgroundColor: TIER_COLORS[DEALER.tier] + "30", color: TIER_COLORS[DEALER.tier] }}
          >
            <Award size={10} />
            {tierLabels[DEALER.tier]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setNotifOpen(!notifOpen)} className="relative p-2 hover:bg-white/10 rounded-lg transition-colors">
            <Bell size={18} />
            {notifCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[#E30613] text-[9px] font-bold flex items-center justify-center">{notifCount}</span>
            )}
          </button>
          <button onClick={() => setChatOpen(true)} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title={t.dealerAssistant}>
            <MessageCircle size={18} />
          </button>
          <div className="flex items-center bg-white/10 rounded-full p-0.5">
            <button onClick={() => setLang("tr")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${lang === "tr" ? "bg-white text-[#0E2841]" : "text-white/60 hover:text-white"}`}>TR</button>
            <button onClick={() => setLang("en")} className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${lang === "en" ? "bg-white text-[#0E2841]" : "text-white/60 hover:text-white"}`}>EN</button>
          </div>
          <Link href="/marketplace/arcelik-fiyat-istihbarati" className="text-xs text-white/50 hover:text-white flex items-center gap-1 ml-1">
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
                className="absolute top-12 right-16 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-50 text-[#0E2841] overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <p className="text-sm font-bold">{t.notifications}</p>
                  <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                  {notifications.map((n) => (
                    <div key={n.id} className="px-4 py-3 hover:bg-gray-50/50 cursor-pointer">
                      <div className="flex items-start gap-2">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.type === "stock" ? "bg-amber-500" : n.type === "campaign" ? "bg-[#E30613]" : "bg-blue-500"}`} />
                        <div>
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
        <nav className="flex-shrink-0 w-52 bg-white border-r border-gray-200 flex flex-col">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`px-4 py-3.5 flex items-center gap-3 text-[13px] font-medium border-l-[3px] transition-colors ${
                  active ? "border-[#E30613] text-[#E30613] bg-red-50/60" : "border-transparent text-gray-500 hover:text-[#0E2841] hover:bg-gray-50"
                }`}
              >
                <Icon size={18} />
                {t[item.labelKey]}
                {item.id === "stock" && lowStockCount > 0 && (
                  <span className="ml-auto w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center">{lowStockCount}</span>
                )}
              </button>
            );
          })}
          <div className="mt-auto border-t border-gray-100">
            <button
              onClick={() => setChatOpen(true)}
              className={`w-full px-4 py-3.5 flex items-center gap-3 text-[13px] font-semibold border-l-[3px] transition-colors ${
                chatOpen ? "border-[#E30613] text-[#E30613] bg-red-50/60" : "border-transparent text-[#E30613] hover:bg-red-50/40"
              }`}
            >
              <MessageCircle size={18} />
              {t.dealerAssistant}
            </button>
          </div>
        </nav>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto p-6">
            <AnimatePresence mode="wait">
              <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                {view === "home" && <DealerHomeView onNavigate={setView} />}
                {view === "prices" && <PriceListView />}
                {view === "campaigns" && <CampaignsView />}
                {view === "targets" && <TargetsView />}
                {view === "stock" && <StockOrdersView />}
                {view === "announcements" && <AnnouncementsView />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {chatOpen && <DealerChat onClose={() => setChatOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
