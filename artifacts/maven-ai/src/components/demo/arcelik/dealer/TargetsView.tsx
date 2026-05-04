import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Target, Award, TrendingUp, Trophy, Users } from "lucide-react";
import { dealers, CATEGORY_LABELS, type ProductCategory } from "@/data/arcelik-seed";

const DEALER = dealers[0];
const fmt = (n: number) => n.toLocaleString("tr-TR");

const THRESHOLDS = [
  { units: 50, bonus: "%1 ek prim", color: "#F5A623" },
  { units: 75, bonus: "%2 ek prim", color: "#16a34a" },
  { units: 100, bonus: "%3 ek prim + Altın rozet", color: "#7c3aed" },
];

const categoryData = (Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((cat) => ({
  name: CATEGORY_LABELS[cat].split(" ")[0],
  sold: DEALER.productMix[cat] ?? 0,
  target: Math.round((DEALER.monthlySalesTarget * (DEALER.productMix[cat] ?? 5)) / Object.values(DEALER.productMix).reduce((s, v) => s + (v ?? 0), 0)),
}));

const COMMISSION_TABLE = [
  { category: "Buzdolabı", units: DEALER.productMix.buzdolabi ?? 0, avgPrice: 24000, rate: 2.5, total: 0 },
  { category: "Çamaşır Makinesi", units: DEALER.productMix.camasir ?? 0, avgPrice: 18000, rate: 2.5, total: 0 },
  { category: "Bulaşık Makinesi", units: DEALER.productMix.bulasik ?? 0, avgPrice: 16000, rate: 2.5, total: 0 },
  { category: "Fırın & Ocak", units: DEALER.productMix.firin ?? 0, avgPrice: 12000, rate: 3.0, total: 0 },
  { category: "Klima", units: DEALER.productMix.klima ?? 0, avgPrice: 22000, rate: 2.0, total: 0 },
  { category: "Küçük Ev Aletleri", units: DEALER.productMix["kucuk-ev"] ?? 0, avgPrice: 5000, rate: 4.0, total: 0 },
  { category: "TV & Elektronik", units: DEALER.productMix["tv-elektronik"] ?? 0, avgPrice: 25000, rate: 1.5, total: 0 },
].map((r) => ({ ...r, total: Math.round(r.units * r.avgPrice * r.rate / 100) }));

const QUARTERLY_TARGET = 220;
const QUARTERLY_PROGRESS = DEALER.currentProgress + 42 + 55;
const quarterlyPct = Math.round((QUARTERLY_PROGRESS / QUARTERLY_TARGET) * 100);

const dealerRank = 23;
const totalDealers = 127;
const percentile = Math.round((1 - dealerRank / totalDealers) * 100);

export default function TargetsView() {
  const progressPct = Math.round((DEALER.currentProgress / DEALER.monthlySalesTarget) * 100);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold">Hedefler & Primler</h1>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target size={18} className="text-[#E30613]" />
          <h2 className="text-sm font-bold">Aylık Satış Hedefi</h2>
        </div>
        <div className="flex items-end gap-3 mb-3">
          <span className="text-4xl font-bold">{DEALER.currentProgress}</span>
          <span className="text-lg text-gray-400 mb-1">/ {DEALER.monthlySalesTarget} ürün</span>
          <span className="text-sm font-semibold text-[#E30613] mb-1">{progressPct}%</span>
        </div>
        <div className="relative h-5 bg-gray-100 rounded-full overflow-visible mb-6">
          <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#E30613] to-[#ff4d4d] transition-all" style={{ width: `${Math.min(progressPct, 100)}%` }} />
          {THRESHOLDS.map((t) => {
            const pos = (t.units / DEALER.monthlySalesTarget) * 100;
            if (pos > 105) return null;
            return (
              <div key={t.units} className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${Math.min(pos, 100)}%` }}>
                <div className="w-0.5 h-full" style={{ backgroundColor: t.color }} />
                <div className="absolute -bottom-6 text-center whitespace-nowrap">
                  <p className="text-[9px] font-bold" style={{ color: t.color }}>{t.units}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-8">
          {THRESHOLDS.map((t) => (
            <div key={t.units} className={`p-3 rounded-lg border ${DEALER.currentProgress >= t.units ? "border-green-200 bg-green-50" : "border-gray-100 bg-gray-50"}`}>
              <div className="flex items-center gap-1.5 mb-1">
                {DEALER.currentProgress >= t.units ? <Award size={14} className="text-green-600" /> : <Target size={14} className="text-gray-400" />}
                <span className="text-xs font-bold">{t.units} ürün</span>
              </div>
              <p className="text-[11px] text-gray-600">{t.bonus}</p>
              {DEALER.currentProgress >= t.units && <p className="text-[10px] text-green-600 font-semibold mt-1">✓ Kazanıldı</p>}
              {DEALER.currentProgress < t.units && <p className="text-[10px] text-gray-400 mt-1">{t.units - DEALER.currentProgress} ürün kaldı</p>}
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold mb-4">Kategori Bazlı Satış Dağılımı</h2>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categoryData} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="sold" name="Satılan" fill="#E30613" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar dataKey="target" name="Hedef" fill="#e5e7eb" radius={[4, 4, 0, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy size={16} className="text-amber-500" />
            <h2 className="text-sm font-bold">Çeyreklik Bonus Takibi</h2>
          </div>
          <div className="flex items-end gap-2 mb-2">
            <span className="text-2xl font-bold">{QUARTERLY_PROGRESS}</span>
            <span className="text-sm text-gray-400">/ {QUARTERLY_TARGET} ürün</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.min(quarterlyPct, 100)}%` }} />
          </div>
          <p className="text-[11px] text-gray-500">{quarterlyPct}% tamamlandı — {QUARTERLY_TARGET - QUARTERLY_PROGRESS} ürün kaldı</p>
          <p className="text-[11px] text-amber-600 font-semibold mt-2">Hedefe ulaşılırsa: %1.5 ek çeyreklik bonus</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-blue-500" />
            <h2 className="text-sm font-bold">Bayi Sıralaması</h2>
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-[#0E2841]">{dealerRank}.</p>
            <p className="text-sm text-gray-500 mt-1">Bölgenizde {totalDealers} bayi arasında</p>
            <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-full bg-green-50 text-green-700">
              <TrendingUp size={14} />
              <span className="text-xs font-bold">Üst %{percentile} — 4 sıra yükseldiniz</span>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-bold mb-4">Komisyon Tablosu — Bu Ay</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500">Kategori</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500">Satış (adet)</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500">Ort. Fiyat</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500">Komisyon %</th>
                <th className="px-4 py-2 text-right text-[11px] font-semibold text-gray-500">Kazanılan</th>
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
                <td className="px-4 py-2 text-xs">Toplam</td>
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
