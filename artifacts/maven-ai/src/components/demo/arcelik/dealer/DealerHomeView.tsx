import { motion } from "framer-motion";
import {
  Award, TrendingUp, Tag, AlertTriangle, Package, BarChart3,
  Clock, ChevronRight, Megaphone, Info,
} from "lucide-react";
import { dealers, campaigns, CATEGORY_LABELS, cities as allCities } from "@/data/arcelik-seed";
import type { DealerViewId } from "../DealerPortal";

const DEALER = dealers[0];
const TIER_COLORS: Record<string, string> = { gold: "#F5A623", silver: "#94A3B8", bronze: "#CD7F32" };
const TIER_LABELS: Record<string, string> = { gold: "Altın Bayi", silver: "Gümüş Bayi", bronze: "Bronz Bayi" };
const OPTIMAL_STOCK: Record<string, number> = { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8 };

const activeCampaigns = campaigns.filter((c) => c.targetCities.includes(DEALER.city)).slice(0, 3);
const lowStockCount = Object.entries(DEALER.stockLevels).filter(([cat, lv]) => (lv ?? 0) < (OPTIMAL_STOCK[cat] ?? 10)).length;

const ANNOUNCEMENTS = [
  { id: 1, category: "Yeni Ürün", title: "Grundig Premium Klima G 12420 — Yeni Model Eklendi", date: "2 Mayıs 2026", read: false },
  { id: 2, category: "Fiyat Güncellemesi", title: "Buzdolabı ve çamaşır makinesi serisinde fiyat güncellemesi yapıldı", date: "1 Mayıs 2026", read: false },
  { id: 3, category: "Eğitim", title: "Online bayi eğitimi: Yeni enerji verimliliği mevzuatı — 8 Mayıs 14:00", date: "30 Nisan 2026", read: true },
];

function ComplianceRing({ score }: { score: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 85 ? "#16a34a" : score >= 70 ? "#F5A623" : "#ef4444";
  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 48 48)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold" style={{ color }}>{score}</span>
        <span className="text-[9px] text-gray-400">/ 100</span>
      </div>
    </div>
  );
}

export default function DealerHomeView({ onNavigate }: { onNavigate: (v: DealerViewId) => void }) {
  const cityName = allCities.find((c) => c.id === DEALER.city)?.name || "İstanbul";
  const progressPct = Math.round((DEALER.currentProgress / DEALER.monthlySalesTarget) * 100);

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold">{DEALER.storeName}</h1>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: TIER_COLORS[DEALER.tier] + "20", color: TIER_COLORS[DEALER.tier] }}>
                <Award size={10} className="inline mr-0.5" />{TIER_LABELS[DEALER.tier]}
              </span>
            </div>
            <p className="text-sm text-gray-500">{DEALER.district}, {cityName}</p>
            <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1"><Clock size={11} /> Son güncelleme: 4 Mayıs 2026, 09:45</p>
          </div>

          <div className="text-center">
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Uyum Puanı</p>
            <ComplianceRing score={DEALER.complianceScore} />
          </div>

          <div className="min-w-[200px]">
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">Bu Ayki Satış Hedefi</p>
            <div className="flex items-end gap-2 mb-1">
              <span className="text-2xl font-bold">{DEALER.currentProgress}</span>
              <span className="text-sm text-gray-400">/ {DEALER.monthlySalesTarget} ürün</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden relative">
              <div className="h-full rounded-full bg-[#E30613] transition-all" style={{ width: `${Math.min(progressPct, 100)}%` }} />
              <div className="absolute top-0 h-full w-px bg-amber-400" style={{ left: `${(50 / DEALER.monthlySalesTarget) * 100}%` }} title="50 ürün — %1 prim" />
              <div className="absolute top-0 h-full w-px bg-green-500" style={{ left: `${(75 / DEALER.monthlySalesTarget) * 100}%` }} title="75 ürün — %2 prim" />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{progressPct}% tamamlandı — {DEALER.monthlySalesTarget - DEALER.currentProgress} ürün kaldı</p>
          </div>

          <div className="text-center min-w-[120px]">
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Kazanılan Prim</p>
            <p className="text-2xl font-bold text-green-600">₺{DEALER.earnedCommission.toLocaleString("tr-TR")}</p>
            <p className="text-[11px] text-green-600 flex items-center justify-center gap-0.5 mt-1">
              <TrendingUp size={12} /> +₺2.400 vs geçen ay
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Aktif Kampanya", value: activeCampaigns.length, icon: Megaphone, color: "#E30613", onClick: () => onNavigate("campaigns") },
          { label: "Düşük Stok Uyarısı", value: lowStockCount, icon: AlertTriangle, color: lowStockCount > 0 ? "#ef4444" : "#16a34a", onClick: () => onNavigate("stock") },
          { label: "Bekleyen Sipariş", value: DEALER.pendingOrders, icon: Package, color: "#0891b2", onClick: () => onNavigate("stock") },
          { label: "Fiyat Değişikliği", value: 3, icon: BarChart3, color: "#7c3aed", onClick: () => onNavigate("prices") },
        ].map((card, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={card.onClick}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-2">
              <card.icon size={20} style={{ color: card.color }} />
              <ChevronRight size={14} className="text-gray-300" />
            </div>
            <p className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{card.label}</p>
          </motion.button>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold flex items-center gap-2"><Tag size={16} className="text-[#E30613]" /> Öne Çıkan Kampanyalar</h2>
          <button onClick={() => onNavigate("campaigns")} className="text-xs text-[#E30613] font-semibold hover:underline">Tümünü Gör →</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {activeCampaigns.map((c, i) => {
            const daysLeft = 8 + i * 12;
            return (
              <div key={c.id} className="border border-gray-100 rounded-lg p-4 hover:border-[#E30613]/20 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase text-[#E30613] bg-red-50 px-2 py-0.5 rounded-full">AKTİF</span>
                  <span className="text-[10px] font-semibold text-amber-600 flex items-center gap-1"><Clock size={10} />{daysLeft} gün kaldı</span>
                </div>
                <h3 className="text-sm font-bold mb-1">{c.name}</h3>
                <p className="text-[11px] text-gray-500 mb-2">{c.discountDetail}</p>
                <div className="flex flex-wrap gap-1">
                  {c.eligibleCategories.slice(0, 3).map((cat) => (
                    <span key={cat} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{CATEGORY_LABELS[cat]}</span>
                  ))}
                  {c.eligibleCategories.length > 3 && <span className="text-[9px] text-gray-400">+{c.eligibleCategories.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold flex items-center gap-2"><Info size={16} className="text-blue-500" /> Son Duyurular</h2>
          <button onClick={() => onNavigate("announcements")} className="text-xs text-[#E30613] font-semibold hover:underline">Tümünü Gör →</button>
        </div>
        <div className="space-y-3">
          {ANNOUNCEMENTS.map((a) => (
            <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.read ? "bg-gray-300" : "bg-[#E30613]"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{a.category}</span>
                  <span className="text-[10px] text-gray-400">{a.date}</span>
                  {!a.read && <span className="text-[9px] font-bold text-[#E30613]">YENİ</span>}
                </div>
                <p className="text-xs text-gray-700">{a.title}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
