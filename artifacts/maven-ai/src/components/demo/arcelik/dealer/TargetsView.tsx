import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Target, Award, TrendingUp, Trophy, Users } from "lucide-react";
import { dealers, CATEGORY_LABELS, getCategoryLabel, type ProductCategory } from "@/data/arcelik-seed";
import { useDemoLang } from "../DemoLangContext";
import { targets } from "../demo-i18n";

const DEALER = dealers[0];
const fmt = (n: number) => n.toLocaleString("tr-TR");

const QUARTERLY_TARGET = 220;
const QUARTERLY_PROGRESS = DEALER.currentProgress + 42 + 55;
const quarterlyPct = Math.round((QUARTERLY_PROGRESS / QUARTERLY_TARGET) * 100);

const dealerRank = 23;
const totalDealers = 127;
const percentile = Math.round((1 - dealerRank / totalDealers) * 100);

export default function TargetsView() {
  const { lang } = useDemoLang();
  const t = targets[lang];

  const THRESHOLDS = [
    { units: 50, bonus: t.threshold1, color: "#F5A623" },
    { units: 75, bonus: t.threshold2, color: "#16a34a" },
    { units: 100, bonus: t.threshold3, color: "#7c3aed" },
  ];

  const categoryData = (Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((cat) => ({
    name: getCategoryLabel(cat, lang).split(" ")[0],
    sold: DEALER.productMix[cat] ?? 0,
    target: Math.round((DEALER.monthlySalesTarget * (DEALER.productMix[cat] ?? 5)) / Object.values(DEALER.productMix).reduce((s, v) => s + (v ?? 0), 0)),
  }));

  const COMMISSION_TABLE = [
    { category: t.catRefrigerator, units: DEALER.productMix.buzdolabi ?? 0, avgPrice: 24000, rate: 2.5, total: 0 },
    { category: t.catWasher, units: DEALER.productMix.camasir ?? 0, avgPrice: 18000, rate: 2.5, total: 0 },
    { category: t.catDishwasher, units: DEALER.productMix.bulasik ?? 0, avgPrice: 16000, rate: 2.5, total: 0 },
    { category: t.catOven, units: DEALER.productMix.firin ?? 0, avgPrice: 12000, rate: 3.0, total: 0 },
    { category: t.catAC, units: DEALER.productMix.klima ?? 0, avgPrice: 22000, rate: 2.0, total: 0 },
    { category: t.catSmall, units: DEALER.productMix["kucuk-ev"] ?? 0, avgPrice: 5000, rate: 4.0, total: 0 },
    { category: t.catTV, units: DEALER.productMix["tv-elektronik"] ?? 0, avgPrice: 25000, rate: 1.5, total: 0 },
  ].map((r) => ({ ...r, total: Math.round(r.units * r.avgPrice * r.rate / 100) }));

  const progressPct = Math.round((DEALER.currentProgress / DEALER.monthlySalesTarget) * 100);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">{t.title}</h1>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target size={18} className="text-[#E30613]" />
          <h2 className="text-sm font-bold">{t.monthlySales}</h2>
        </div>
        <div className="flex items-end gap-3 mb-3">
          <span className="text-4xl font-bold">{DEALER.currentProgress}</span>
          <span className="text-lg text-gray-400 mb-1">/ {DEALER.monthlySalesTarget} {t.products}</span>
          <span className="text-sm font-semibold text-[#E30613] mb-1">{progressPct}%</span>
        </div>
        <div className="relative h-5 bg-gray-100 rounded-full overflow-visible mb-6">
          <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#E30613] to-[#ff4d4d] transition-all" style={{ width: `${Math.min(progressPct, 100)}%` }} />
          {THRESHOLDS.map((th) => {
            const pos = (th.units / DEALER.monthlySalesTarget) * 100;
            if (pos > 105) return null;
            return (
              <div key={th.units} className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${Math.min(pos, 100)}%` }}>
                <div className="w-0.5 h-full" style={{ backgroundColor: th.color }} />
                <div className="absolute -bottom-6 text-center whitespace-nowrap">
                  <p className="text-[9px] font-bold" style={{ color: th.color }}>{th.units}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-8">
          {THRESHOLDS.map((th) => (
            <div key={th.units} className={`p-3 rounded-lg border ${DEALER.currentProgress >= th.units ? "border-green-200 bg-green-50" : "border-gray-100 bg-gray-50"}`}>
              <div className="flex items-center gap-1.5 mb-1">
                {DEALER.currentProgress >= th.units ? <Award size={14} className="text-green-600" /> : <Target size={14} className="text-gray-400" />}
                <span className="text-xs font-bold">{th.units} {t.products}</span>
              </div>
              <p className="text-[11px] text-gray-600">{th.bonus}</p>
              {DEALER.currentProgress >= th.units && <p className="text-[10px] text-green-600 font-semibold mt-1">✓ {t.earned}</p>}
              {DEALER.currentProgress < th.units && <p className="text-[10px] text-gray-400 mt-1">{th.units - DEALER.currentProgress} {t.productsRemaining}</p>}
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold mb-4">{t.categoryDistribution}</h2>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryData} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="sold" name={t.sold} fill="#E30613" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar dataKey="target" name={t.targetLabel} fill="#e5e7eb" radius={[4, 4, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy size={16} className="text-amber-500" />
            <h2 className="text-sm font-bold">{t.quarterlyBonus}</h2>
          </div>
          <div className="flex items-end gap-2 mb-2">
            <span className="text-2xl font-bold">{QUARTERLY_PROGRESS}</span>
            <span className="text-sm text-gray-400">/ {QUARTERLY_TARGET} {t.products}</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.min(quarterlyPct, 100)}%` }} />
          </div>
          <p className="text-[11px] text-gray-500">{quarterlyPct}% {t.completed} — {QUARTERLY_TARGET - QUARTERLY_PROGRESS} {t.qProductsRemaining}</p>
          <p className="text-[11px] text-amber-600 font-semibold mt-2">{t.ifTargetReached} {t.quarterlyBonusDetail}</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-blue-500" />
            <h2 className="text-sm font-bold">{t.ranking}</h2>
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-[#0E2841]">{dealerRank}.</p>
            <p className="text-sm text-gray-500 mt-1">{t.rankingAmong.replace("{0}", String(totalDealers))}</p>
            <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full bg-green-50 text-green-700">
              <TrendingUp size={14} />
              <span className="text-xs font-bold">{t.rankingPosition.replace("{0}", String(percentile))}</span>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold mb-4">{t.commissionTable}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500">{t.colCategory}</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500">{t.colSales}</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500">{t.colAvgPrice}</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500">{t.colCommission}</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500">{t.colEarned}</th>
              </tr>
            </thead>
            <tbody>
              {COMMISSION_TABLE.map((r) => (
                <tr key={r.category} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-2 text-xs font-medium">{r.category}</td>
                  <td className="px-4 py-2 text-xs text-right font-mono">{r.units}</td>
                  <td className="px-4 py-2 text-xs text-right font-mono text-gray-500">₺{fmt(r.avgPrice)}</td>
                  <td className="px-4 py-2 text-xs text-right font-mono text-gray-500">%{r.rate}</td>
                  <td className="px-4 py-2 text-xs text-right font-bold text-green-600">₺{fmt(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold">
                <td className="px-4 py-2 text-xs">{t.total}</td>
                <td className="px-4 py-2 text-xs text-right">{COMMISSION_TABLE.reduce((s, r) => s + r.units, 0)}</td>
                <td colSpan={2} />
                <td className="px-4 py-2 text-xs text-right text-green-600">₺{fmt(COMMISSION_TABLE.reduce((s, r) => s + r.total, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
