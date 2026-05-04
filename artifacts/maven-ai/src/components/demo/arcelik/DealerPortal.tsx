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
import { dealers, cities as allCities } from "@/data/arcelik-seed";

export type DealerViewId = "home" | "prices" | "campaigns" | "targets" | "stock" | "announcements";

export const DEALER = dealers[0];
export const OPTIMAL_STOCK: Record<string, number> = {
  buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8,
};
export const TIER_COLORS: Record<string, string> = { gold: "#F5A623", silver: "#94A3B8", bronze: "#CD7F32" };
export const TIER_LABELS: Record<string, string> = { gold: "Altın Bayi", silver: "Gümüş Bayi", bronze: "Bronz Bayi" };

const NAV: { id: DealerViewId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Ana Sayfa", icon: Home },
  { id: "prices", label: "Fiyat Listesi", icon: ListOrdered },
  { id: "campaigns", label: "Kampanyalar", icon: Tag },
  { id: "targets", label: "Hedefler & Primler", icon: Target },
  { id: "stock", label: "Stok & Siparişler", icon: Package },
  { id: "announcements", label: "Duyurular", icon: Bell },
];

const NOTIFICATIONS = [
  { id: 1, type: "campaign" as const, text: "Yeni kampanya: Enerji Verimliliği Kampanyası başladı", time: "2 saat önce" },
  { id: 2, type: "stock" as const, text: "Klima kategorisinde stok seviyesi düşük (8 adet)", time: "5 saat önce" },
  { id: 3, type: "campaign" as const, text: "Banka Taksit kampanyası güncellendi — 24 aya kadar faizsiz", time: "1 gün önce" },
  { id: 4, type: "announcement" as const, text: "Yeni ürün: Grundig Premium Klima G 12420 eklendi", time: "2 gün önce" },
];

export default function DealerPortal() {
  const [view, setView] = useState<DealerViewId>("home");
  const [chatOpen, setChatOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const cityName = allCities.find((c) => c.id === DEALER.city)?.name || "İstanbul";
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
            <p className="text-[10px] font-semibold text-white/70">Bayi Portalı</p>
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
            {TIER_LABELS[DEALER.tier]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setNotifOpen(!notifOpen)} className="relative p-2 hover:bg-white/10 rounded-lg transition-colors">
            <Bell size={18} />
            {notifCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[#E30613] text-[9px] font-bold flex items-center justify-center">{notifCount}</span>
            )}
          </button>
          <button onClick={() => setChatOpen(true)} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Bayi Asistanı">
            <MessageCircle size={18} />
          </button>
          <Link href="/marketplace/arcelik-fiyat-istihbarati" className="text-xs text-white/50 hover:text-white flex items-center gap-1 ml-1">
            <LogOut size={14} />
            <span className="hidden md:inline">Çıkış</span>
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
                  <p className="text-sm font-bold">Bildirimler</p>
                  <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                  {NOTIFICATIONS.map((n) => (
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
          {NAV.map((item) => {
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
                {item.label}
                {item.id === "stock" && lowStockCount > 0 && (
                  <span className="ml-auto w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center">{lowStockCount}</span>
                )}
              </button>
            );
          })}
          <div className="mt-auto p-4 border-t border-gray-100">
            <button
              onClick={() => setChatOpen(true)}
              className="w-full px-3 py-2.5 flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[#E30613] rounded-lg hover:bg-[#C00511] transition-colors"
            >
              <MessageCircle size={16} />
              Bayi Asistanı
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
