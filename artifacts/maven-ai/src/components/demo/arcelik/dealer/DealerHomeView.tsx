import { motion } from "framer-motion";
import {
  Award, TrendingUp, Tag, AlertTriangle, Package, BarChart3,
  Clock, ChevronRight, Megaphone, Info, Brain, CheckCircle2,
} from "lucide-react";
import { getCategoryLabel, getCampaignField, getCityName } from "@/data/arcelik-seed";
import { generateDealerAgentTasks } from "@/data/arcelik-agent";
import type { DealerViewId } from "../DealerPortal";
import { useDemoLang } from "../DemoLangContext";
import { dealerHome } from "../demo-i18n";
import { useArcelikData } from "@/hooks/useArcelikData";

const TIER_COLORS: Record<string, string> = { gold: "#F5A623", silver: "#94A3B8", bronze: "#CD7F32" };
const OPTIMAL_STOCK: Record<string, number> = { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 10, "kucuk-ev": 30, "tv-elektronik": 8 };

const ANNOUNCEMENT_KEYS = [
  { id: 1, catKey: "annCatNewProduct", titleKey: "ann1Title", dateKey: "ann1Date", read: false },
  { id: 2, catKey: "annCatPriceUpdate", titleKey: "ann2Title", dateKey: "ann2Date", read: false },
  { id: 3, catKey: "annCatTraining", titleKey: "ann3Title", dateKey: "ann3Date", read: true },
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
  const { lang } = useDemoLang();
  const t = dealerHome[lang];
  const { dealers, campaigns, cities: allCities } = useArcelikData();
  const DEALER = dealers[0];

  if (!DEALER) {
    return <div className="p-8 text-center text-gray-400 text-sm">Loading dealer data…</div>;
  }

  const activeCampaigns = campaigns.filter((c) => c.targetCities.includes(DEALER.city)).slice(0, 3);
  const lowStockCount = Object.entries(DEALER.stockLevels).filter(([cat, lv]) => (lv ?? 0) < (OPTIMAL_STOCK[cat] ?? 10)).length;
  const tierLabels: Record<string, string> = { gold: t.tierGold, silver: t.tierSilver, bronze: t.tierBronze };
  const cityObj = allCities.find((c) => c.id === DEALER.city);
  const cityName = cityObj ? getCityName(cityObj, lang) : "Istanbul";
  const progressPct = Math.round((DEALER.currentProgress / DEALER.monthlySalesTarget) * 100);

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold">{DEALER.storeName}</h1>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: TIER_COLORS[DEALER.tier] + "20", color: TIER_COLORS[DEALER.tier] }}>
                <Award size={10} className="inline mr-0.5" />{tierLabels[DEALER.tier]}
              </span>
            </div>
            <p className="text-sm text-gray-500">{DEALER.district}, {cityName}</p>
            <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1"><Clock size={11} /> {t.lastUpdate} {t.lastUpdateDate}</p>
          </div>

          <div className="text-center">
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">{t.complianceScore}</p>
            <ComplianceRing score={DEALER.complianceScore} />
          </div>

          <div className="min-w-[200px]">
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-2">{t.salesTarget}</p>
            <div className="flex items-end gap-2 mb-1">
              <span className="text-2xl font-bold">{DEALER.currentProgress}</span>
              <span className="text-sm text-gray-400">/ {DEALER.monthlySalesTarget} {t.products}</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden relative">
              <div className="h-full rounded-full bg-[#E30613] transition-all" style={{ width: `${Math.min(progressPct, 100)}%` }} />
              <div className="absolute top-0 h-full w-px bg-amber-400" style={{ left: `${(50 / DEALER.monthlySalesTarget) * 100}%` }} title={t.progressTip50} />
              <div className="absolute top-0 h-full w-px bg-green-500" style={{ left: `${(75 / DEALER.monthlySalesTarget) * 100}%` }} title={t.progressTip75} />
            </div>
            <p className="text-[10px] text-gray-400 mt-1">{progressPct}% {t.completed} — {DEALER.monthlySalesTarget - DEALER.currentProgress} {t.productsRemaining}</p>
          </div>

          <div className="text-center min-w-[120px]">
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">{t.earnedBonus}</p>
            <p className="text-2xl font-bold text-green-600">₺{DEALER.earnedCommission.toLocaleString("tr-TR")}</p>
            <p className="text-[11px] text-green-600 flex items-center justify-center gap-0.5 mt-1">
              <TrendingUp size={12} /> +₺2.400 {t.vsLastMonth}
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t.statActiveCampaign, value: activeCampaigns.length, icon: Megaphone, color: "#E30613", onClick: () => onNavigate("campaigns") },
          { label: t.statLowStock, value: lowStockCount, icon: AlertTriangle, color: lowStockCount > 0 ? "#ef4444" : "#16a34a", onClick: () => onNavigate("stock") },
          { label: t.statPendingOrder, value: DEALER.pendingOrders, icon: Package, color: "#0891b2", onClick: () => onNavigate("stock") },
          { label: t.statPriceChange, value: 3, icon: BarChart3, color: "#7c3aed", onClick: () => onNavigate("prices") },
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
          <h2 className="text-sm font-bold flex items-center gap-2"><Tag size={16} className="text-[#E30613]" /> {t.featuredCampaigns}</h2>
          <button onClick={() => onNavigate("campaigns")} className="text-xs text-[#E30613] font-semibold hover:underline">{t.seeAll}</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {activeCampaigns.map((c, i) => {
            const daysLeft = 8 + i * 12;
            return (
              <div key={c.id} className="border border-gray-100 rounded-lg p-4 hover:border-[#E30613]/20 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase text-[#E30613] bg-red-50 px-2 py-0.5 rounded-full">{t.active}</span>
                  <span className="text-[10px] font-semibold text-amber-600 flex items-center gap-1"><Clock size={10} />{daysLeft} {t.daysRemaining}</span>
                </div>
                <h3 className="text-sm font-bold mb-1">{getCampaignField(c, "name", lang)}</h3>
                <p className="text-[11px] text-gray-500 mb-2">{getCampaignField(c, "discountDetail", lang)}</p>
                <div className="flex flex-wrap gap-1">
                  {c.eligibleCategories.slice(0, 3).map((cat) => (
                    <span key={cat} className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{getCategoryLabel(cat, lang)}</span>
                  ))}
                  {c.eligibleCategories.length > 3 && <span className="text-[9px] text-gray-400">+{c.eligibleCategories.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <Brain size={15} className="text-[#E30613]" />
          <h2 className="text-sm font-bold">{t.agentTasks}</h2>
          <span className="text-[9px] font-bold bg-[#E30613] text-white px-1.5 py-0.5 rounded-full ml-1">AI</span>
          <span className="text-[10px] text-gray-400 ml-auto">{t.agentTasksSubtitle}</span>
        </div>
        <div className="divide-y divide-gray-50">
          {generateDealerAgentTasks(DEALER.city).map((task) => {
            const sevColor = task.priority === "high" ? "bg-red-500" : task.priority === "medium" ? "bg-amber-500" : "bg-gray-400";
            return (
              <div key={task.id} className="px-5 py-3.5 hover:bg-gray-50/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${sevColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h4 className="text-xs font-semibold text-[#0E2841]">{task.title}</h4>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${task.priority === "high" ? "bg-red-50 text-red-600" : task.priority === "medium" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-500"}`}>
                        {task.priority === "high" ? t.priorityHigh : task.priority === "medium" ? t.priorityMedium : t.priorityLow}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">{task.description}</p>
                    <p className="text-[10px] text-gray-400 mt-1 flex items-center gap-1"><Clock size={9} /> {t.deadline} {task.deadline}</p>
                  </div>
                  <button className="text-[10px] font-semibold text-green-600 hover:text-green-700 flex items-center gap-0.5 flex-shrink-0 mt-1">
                    <CheckCircle2 size={11} /> {t.done}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold flex items-center gap-2"><Info size={16} className="text-blue-500" /> {t.latestAnnouncements}</h2>
          <button onClick={() => onNavigate("announcements")} className="text-xs text-[#E30613] font-semibold hover:underline">{t.seeAll}</button>
        </div>
        <div className="space-y-3">
          {ANNOUNCEMENT_KEYS.map((a) => (
            <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors">
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${a.read ? "bg-gray-300" : "bg-[#E30613]"}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{t[a.catKey]}</span>
                  <span className="text-[10px] text-gray-400">{t[a.dateKey]}</span>
                  {!a.read && <span className="text-[9px] font-bold text-[#E30613]">{t.newBadge}</span>}
                </div>
                <p className="text-xs text-gray-700">{t[a.titleKey]}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
