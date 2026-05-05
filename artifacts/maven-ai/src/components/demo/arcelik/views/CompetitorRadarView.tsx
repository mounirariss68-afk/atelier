import { useState, useMemo, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from "recharts";
import { Shield, Eye, AlertTriangle, TrendingUp } from "lucide-react";
import { useDashboardFilters } from "../DashboardContext";
import { useDemoLang } from "../DemoLangContext";
import { radar } from "../demo-i18n";
import {
  COMPETITOR_BRANDS, CATEGORY_LABELS, getCategoryLabel,
  type ProductCategory,
} from "@/data/arcelik-seed";
import { useArcelikData, getArcelikDataSnapshot } from "@/hooks/useArcelikData";
import { usePriceHistory } from "@/hooks/usePriceHistory";
import type { NotificationNavTarget } from "@/data/arcelik-notifications";

const BRAND_COLORS: Record<string, string> = {
  Vestel: "#2563eb",
  Regal: "#7c3aed",
  Bosch: "#059669",
  Siemens: "#0891b2",
  Profilo: "#d97706",
  Samsung: "#1d4ed8",
  LG: "#dc2626",
  "Electrolux/AEG": "#4f46e5",
};

function computeBrandScores(brandName: string) {
  const { competitorPrices } = getArcelikDataSnapshot();
  const prices = competitorPrices.filter((cp) => cp.brand === brandName);
  const avgDelta = prices.length ? prices.reduce((s, p) => s + Math.abs(p.priceDeltaPercent), 0) / prices.length : 0;
  const categories = new Set(prices.map((p) => p.category));
  const b = COMPETITOR_BRANDS.find((cb) => cb.name === brandName);
  const isValue = b?.positioning === "value";
  const isPremium = b?.positioning === "premium";
  return {
    price: Math.min(100, 50 + avgDelta * 2),
    variety: Math.min(100, categories.size * 15),
    dealer: isValue ? 70 : isPremium ? 50 : 40,
    campaign: Math.min(100, prices.length * 10 + (isValue ? 25 : 10)),
    brand: isPremium ? 85 : isValue ? 60 : 45,
    satisfaction: isPremium ? 78 : isValue ? 55 : 50,
  };
}

const ARCELIK_SCORES = { price: 80, variety: 95, dealer: 90, campaign: 75, brand: 88, satisfaction: 82 };

interface CompetitorRadarViewProps {
  pendingNav?: NotificationNavTarget | null;
  onPendingNavConsumed?: () => void;
}

export default function CompetitorRadarView({ pendingNav, onPendingNavConsumed }: CompetitorRadarViewProps = {}) {
  const { filters } = useDashboardFilters();
  const { lang } = useDemoLang();
  const t = radar[lang];
  const { competitorPrices } = useArcelikData();
  const { data: priceHistory } = usePriceHistory();
  const [selectedBrands, setSelectedBrands] = useState<string[]>(["Vestel", "Bosch"]);
  const [detailBrand, setDetailBrand] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const lastConsumedNonce = useRef<number | null>(null);

  const RANGE_OPTIONS: { key: "7d" | "30d" | "90d" | "all"; label: string }[] = [
    { key: "7d", label: t.range7d },
    { key: "30d", label: t.range30d },
    { key: "90d", label: t.range90d },
    { key: "all", label: t.rangeAll },
  ];

  useEffect(() => {
    if (!pendingNav || pendingNav.recordType !== "competitor") return;
    if (lastConsumedNonce.current === pendingNav.nonce) return;
    const known = COMPETITOR_BRANDS.find((b) => b.name === pendingNav.brand);
    if (!known) return;
    lastConsumedNonce.current = pendingNav.nonce;
    setSelectedBrands((prev) =>
      prev.includes(pendingNav.brand) ? prev : [...prev, pendingNav.brand].slice(-4),
    );
    setDetailBrand(pendingNav.brand);
    onPendingNavConsumed?.();
  }, [pendingNav, onPendingNavConsumed]);

  const RADAR_DIMS = [
    { key: "price", label: t.dimPrice },
    { key: "variety", label: t.dimVariety },
    { key: "dealer", label: t.dimDealer },
    { key: "campaign", label: t.dimCampaign },
    { key: "brand", label: t.dimBrand },
    { key: "satisfaction", label: t.dimSatisfaction },
  ];

  const toggleBrand = (name: string) => {
    setSelectedBrands((prev) =>
      prev.includes(name) ? prev.filter((b) => b !== name) : [...prev, name].slice(-4)
    );
  };

  const radarData = RADAR_DIMS.map((dim) => {
    const row: Record<string, unknown> = { dimension: dim.label, arcelik: ARCELIK_SCORES[dim.key as keyof typeof ARCELIK_SCORES] };
    selectedBrands.forEach((b) => {
      const scores = computeBrandScores(b);
      row[b] = scores[dim.key as keyof typeof scores];
    });
    return row;
  });

  const visibleBrands = filters.competitors.length > 0
    ? COMPETITOR_BRANDS.filter((b) => filters.competitors.includes(b.id))
    : COMPETITOR_BRANDS;

  const filteredPrices = filters.categories.length > 0
    ? competitorPrices.filter((cp) => filters.categories.includes(cp.category))
    : competitorPrices;

  const brandCards = visibleBrands.map((b) => {
    const prices = filteredPrices.filter((cp) => cp.brand === b.name);
    const avgDelta = prices.length ? (prices.reduce((s, p) => s + p.priceDeltaPercent, 0) / prices.length).toFixed(1) : "0";
    const categories = new Set(prices.map((p) => p.category));
    const threat = b.positioning === "value" && parseFloat(avgDelta) < -10 ? "high" : parseFloat(avgDelta) < -5 ? "medium" : "low";
    return { ...b, priceCount: prices.length, avgDelta, categoryCount: categories.size, threat };
  });

  const priceDeltaChart = useMemo(() => {
    const cats = filters.categories.length > 0
      ? filters.categories
      : (Object.keys(CATEGORY_LABELS) as ProductCategory[]);
    return cats.map((cat) => {
      const row: Record<string, unknown> = { name: getCategoryLabel(cat, lang) };
      selectedBrands.forEach((brand) => {
        const cp = competitorPrices.find((p) => p.brand === brand && p.category === cat);
        row[brand] = cp ? cp.priceDeltaPercent : 0;
      });
      return row;
    });
  }, [selectedBrands, filters.categories, lang]);

  const timelineEvents = useMemo(() => {
    const fallback = [
      { date: t.timeDate1, brand: "Vestel", action: t.timeEvent1, severity: "high" as const },
      { date: t.timeDate2, brand: "Samsung", action: t.timeEvent3, severity: "medium" as const },
      { date: t.timeDate3, brand: "Bosch", action: t.timeEvent2, severity: "low" as const },
      { date: t.timeDate4, brand: "Profilo", action: t.timeEvent5, severity: "low" as const },
      { date: t.timeDate5, brand: "Vestel", action: t.timeEvent4, severity: "high" as const },
    ];
    if (!priceHistory || priceHistory.length === 0) return fallback;
    const significantChanges = priceHistory
      .filter(r => r.priceChangePercent !== null && Math.abs(r.priceChangePercent!) > 2)
      .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
      .slice(0, 8);
    if (significantChanges.length === 0) return fallback;
    return significantChanges.map(r => {
      const change = r.priceChangePercent!;
      const absChange = Math.abs(change);
      const severity: "high" | "medium" | "low" = absChange > 10 ? "high" : absChange > 5 ? "medium" : "low";
      const dateStr = new Date(r.recordedAt).toLocaleDateString(
        lang === "tr" ? "tr-TR" : "en-US",
        { year: "numeric", month: "short", day: "numeric" }
      );
      const pctStr = lang === "tr" ? `%${absChange.toFixed(1)}` : `${absChange.toFixed(1)}%`;
      const action = change < 0
        ? `${r.modelCode} ${t.reducedBy} ${pctStr}`
        : `${r.modelCode} ${t.raisedBy} ${pctStr}`;
      return { date: dateStr, brand: r.brand, action, severity };
    });
  }, [priceHistory, lang, t]);

  const trendChartData = useMemo(() => {
    if (!priceHistory || priceHistory.length === 0) return [];
    const brandFilter = new Set(selectedBrands);
    const rangeDays = trendRange === "7d" ? 7 : trendRange === "30d" ? 30 : trendRange === "90d" ? 90 : null;
    const cutoff = rangeDays !== null ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : null;
    const dateMap: Record<string, Record<string, { total: number; count: number }>> = {};
    priceHistory.forEach(record => {
      const displayBrand = record.recordType === "product" ? "Arçelik" : record.brand;
      if (displayBrand !== "Arçelik" && !brandFilter.has(displayBrand)) return;
      const recordTime = new Date(record.recordedAt).getTime();
      if (cutoff !== null && recordTime < cutoff) return;
      const dayKey = new Date(record.recordedAt).toISOString().split("T")[0];
      if (!dateMap[dayKey]) dateMap[dayKey] = {};
      if (!dateMap[dayKey][displayBrand]) dateMap[dayKey][displayBrand] = { total: 0, count: 0 };
      dateMap[dayKey][displayBrand].total += record.price;
      dateMap[dayKey][displayBrand].count += 1;
    });
    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, brands]) => {
        const date = new Date(dayKey).toLocaleDateString(
          lang === "tr" ? "tr-TR" : "en-US",
          { month: "short", day: "numeric" }
        );
        const row: Record<string, unknown> = { date };
        Object.entries(brands).forEach(([brand, { total, count }]) => {
          row[brand] = Math.round(total / count);
        });
        return row;
      });
  }, [priceHistory, selectedBrands, lang, trendRange]);

  const hasAnyHistory = !!priceHistory && priceHistory.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-[#0E2841]">{t.title}</h2>
        <span className="text-xs text-gray-500">{t.selectBrands}</span>
        <div className="flex gap-2 ml-auto">
          {COMPETITOR_BRANDS.map((b) => (
            <button
              key={b.id}
              onClick={() => toggleBrand(b.name)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                selectedBrands.includes(b.name)
                  ? "text-white border-transparent"
                  : "border-gray-200 text-gray-600 hover:border-gray-400"
              }`}
              style={selectedBrands.includes(b.name) ? { backgroundColor: BRAND_COLORS[b.name] || "#6B7280" } : {}}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
        >
          <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
            <Shield size={16} className="text-[#0E2841]" />
            {t.competitionMap}
          </h3>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: "#374151" }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                <Radar name="Arçelik" dataKey="arcelik" stroke="#E30613" fill="#E30613" fillOpacity={0.15} strokeWidth={2} />
                {selectedBrands.map((b) => (
                  <Radar
                    key={b}
                    name={b}
                    dataKey={b}
                    stroke={BRAND_COLORS[b] || "#6B7280"}
                    fill={BRAND_COLORS[b] || "#6B7280"}
                    fillOpacity={0.05}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
        >
          <h3 className="text-sm font-bold mb-4">{t.categoryPriceGap}</h3>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priceDeltaChart} layout="vertical" margin={{ left: 5, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" width={105} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [`${v}%`, ""]} />
                {selectedBrands.map((b) => (
                  <Bar key={b} dataKey={b} fill={BRAND_COLORS[b] || "#6B7280"} barSize={10} radius={[0, 4, 4, 0]} />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {hasAnyHistory && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
        >
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <TrendingUp size={16} className="text-[#E30613]" />
              {t.priceTrendTitle}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-gray-500 font-medium">{t.rangeLabel}</span>
              <div className="inline-flex items-center bg-gray-50 border border-gray-200 rounded-full p-0.5" role="group" aria-label={t.rangeLabel}>
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTrendRange(opt.key)}
                    aria-pressed={trendRange === opt.key}
                    className={`px-3 py-1 text-[11px] font-semibold rounded-full transition-colors ${
                      trendRange === opt.key
                        ? "bg-[#0E2841] text-white shadow-sm"
                        : "text-gray-600 hover:text-[#0E2841]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="h-[300px]">
            {trendChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-gray-400">
                {t.noTrendData}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChartData} margin={{ left: 5, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₺${(v / 1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [`₺${v.toLocaleString("tr-TR")}`, ""]} />
                  <Line type="monotone" dataKey="Arçelik" stroke="#E30613" strokeWidth={2} dot={false} />
                  {selectedBrands.map((b) => (
                    <Line key={b} type="monotone" dataKey={b} stroke={BRAND_COLORS[b] || "#6B7280"} strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
      >
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          {t.timelineTitle}
        </h3>
        <div className="space-y-3">
          {timelineEvents.map((event, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${event.severity === "high" ? "bg-red-500" : event.severity === "medium" ? "bg-amber-500" : "bg-green-500"}`} />
                {i < timelineEvents.length - 1 && <div className="w-px h-8 bg-gray-200" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">{event.date}</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: `${BRAND_COLORS[event.brand] || "#6B7280"}15`, color: BRAND_COLORS[event.brand] || "#6B7280" }}>{event.brand}</span>
                  {event.severity === "high" && <AlertTriangle size={10} className="text-red-500" />}
                </div>
                <p className="text-xs text-gray-700 mt-0.5">{event.action}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {brandCards.map((b, i) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => setDetailBrand(detailBrand === b.name ? null : b.name)}
            className={`bg-white rounded-xl border shadow-sm p-4 cursor-pointer transition-all hover:shadow-md ${
              detailBrand === b.name ? "ring-2 ring-[#E30613]/30 border-[#E30613]/20" : "border-gray-100"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: BRAND_COLORS[b.name] || "#6B7280" }}>
                  {b.name.charAt(0)}
                </div>
                <span className="text-sm font-bold text-[#0E2841]">{b.name}</span>
              </div>
              {b.threat === "high" && <AlertTriangle size={14} className="text-red-500" />}
              {b.threat === "medium" && <Eye size={14} className="text-amber-500" />}
            </div>
            <div className="flex items-center gap-1 mb-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                b.positioning === "premium" ? "bg-purple-50 text-purple-700" : b.positioning === "value" ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600"
              }`}>
                {b.positioning === "premium" ? "Premium" : b.positioning === "value" ? t.posValue : t.posMid}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>{t.posMarketShare}</span>
                <span className="font-semibold text-[#0E2841]">{b.positioning === "premium" ? "~8%" : b.positioning === "value" ? "~15%" : "~6%"}</span>
              </div>
              <div className="flex justify-between">
                <span>{t.tracked}</span>
                <span className="font-semibold text-[#0E2841]">{b.priceCount} {t.trackedProducts}</span>
              </div>
              <div className="flex justify-between">
                <span>{t.avgPriceGap}</span>
                <span className={`font-semibold ${parseFloat(b.avgDelta) < 0 ? "text-amber-600" : "text-green-600"}`}>
                  {parseFloat(b.avgDelta) > 0 ? "+" : ""}{b.avgDelta}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>{t.categories}</span>
                <span className="font-semibold text-[#0E2841]">{b.categoryCount}</span>
              </div>
              <div className="flex justify-between">
                <span>{t.lastMove}</span>
                <span className="text-[10px] font-semibold text-amber-600">{b.threat === "high" ? t.priceCut : b.threat === "medium" ? t.campaignLabel : t.update}</span>
              </div>
              <div className="flex justify-between">
                <span>{t.activePromo}</span>
                <span className="text-[10px] font-semibold text-purple-600">{b.positioning === "value" ? t.twoCampaigns : t.oneCampaign}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {detailBrand && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
        >
          <h3 className="text-sm font-bold mb-3">{detailBrand} — {t.detailedTracking}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500">{t.colModel}</th>
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500">{t.colCategory}</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500">{t.colPrice}</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500">{t.colGap}</th>
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500">{t.colNote}</th>
                </tr>
              </thead>
              <tbody>
                {competitorPrices.filter((cp) => cp.brand === detailBrand).map((cp) => (
                  <tr key={cp.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2 text-xs font-medium">{cp.competitorModel}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{getCategoryLabel(cp.category, lang)}</td>
                    <td className="px-4 py-2 text-xs text-right font-mono">₺{cp.competitorPrice.toLocaleString("tr-TR")}</td>
                    <td className={`px-4 py-2 text-xs text-right font-bold ${cp.priceDeltaPercent < 0 ? "text-amber-600" : "text-green-600"}`}>
                      {cp.priceDeltaPercent > 0 ? "+" : ""}{cp.priceDeltaPercent}%
                    </td>
                    <td className="px-4 py-2 text-[11px] text-gray-400 max-w-xs truncate">{cp.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
