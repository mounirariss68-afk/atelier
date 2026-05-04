import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, MapPin, ArrowUpDown, X, ChevronDown,
  Target, Percent, BarChart3, Users, Megaphone, DollarSign, Package,
} from "lucide-react";
import { useDashboardFilters } from "../DashboardContext";
import {
  products, competitorPrices, cities, campaigns, dealers,
  CATEGORY_LABELS, COMPETITOR_BRANDS,
  type ProductCategory, type CityData,
} from "@/data/arcelik-seed";

const TURKEY_OUTLINE = "M44,57 L109,46 L196,57 L326,40 L457,57 L544,69 L631,86 L674,74 L740,90 L805,114 L826,171 L805,229 L761,286 L718,314 L660,340 L600,355 L520,368 L457,371 L390,365 L326,371 L270,360 L196,371 L152,343 L100,320 L65,314 L44,257 L28,200 L22,171 L30,140 L44,114 L55,100 L65,97 Z";

const CITY_POS: Record<string, { x: number; y: number }> = {
  istanbul: { x: 134, y: 72 }, ankara: { x: 309, y: 145 }, izmir: { x: 55, y: 242 },
  bursa: { x: 140, y: 125 }, antalya: { x: 215, y: 340 }, adana: { x: 402, y: 333 },
  konya: { x: 295, y: 278 }, gaziantep: { x: 510, y: 327 }, mersin: { x: 384, y: 350 },
  kayseri: { x: 425, y: 225 }, diyarbakir: { x: 635, y: 278 }, samsun: { x: 461, y: 52 },
  trabzon: { x: 613, y: 72 }, eskisehir: { x: 205, y: 152 }, denizli: { x: 140, y: 285 },
  malatya: { x: 550, y: 245 }, erzurum: { x: 684, y: 145 }, van: { x: 778, y: 238 },
  manisa: { x: 68, y: 232 }, tekirdag: { x: 72, y: 72 },
};

type HeatMetric = "share" | "price" | "dealers" | "competition" | "campaigns" | "demand";
const HEAT_LABELS: Record<HeatMetric, string> = {
  share: "Pazar Payı", price: "Fiyat Endeksi", dealers: "Bayi Sayısı",
  competition: "Rekabet Yoğunluğu", campaigns: "Kampanya Aktivitesi", demand: "Talep Sinyali",
};

function getHeatValue(city: CityData, metric: HeatMetric): number {
  if (metric === "share") return city.marketSharePercent;
  if (metric === "price") return city.avgPriceIndex * 100;
  if (metric === "dealers") return city.dealerCount;
  if (metric === "campaigns") return campaigns.filter((c) => c.targetCities.includes(city.id)).length;
  if (metric === "demand") return city.marketSharePercent * city.avgPriceIndex * (city.populationTier === "tier-1" ? 2 : city.populationTier === "tier-2" ? 1.3 : 1);
  return city.competitorStrength.reduce((s, c) => s + c.strength, 0);
}

function heatColor(t: number): string {
  if (t > 0.7) return "#16a34a";
  if (t > 0.4) return "#f59e0b";
  return "#ef4444";
}

function AnimatedCounter({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const duration = 1200;
    const start = Date.now();
    let raf: number;
    function tick() {
      const p = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Number((value * eased).toFixed(decimals)));
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, [value, decimals]);
  return <>{display}</>;
}

function Sparkline({ data, color = "#6B7280" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 56},${18 - ((v - min) / range) * 16}`).join(" ");
  return (
    <svg width="56" height="20" className="inline-block">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

const CAT_COLORS = ["#E30613", "#0E2841", "#F5A623", "#16a34a", "#7c3aed", "#0891b2", "#db2777"];
const COMPARISON_BRANDS = ["Vestel", "Bosch", "Samsung", "Profilo"];

export default function DashboardView() {
  const { filters } = useDashboardFilters();
  const [heatMetric, setHeatMetric] = useState<HeatMetric>("share");
  const [selectedCity, setSelectedCity] = useState<CityData | null>(null);
  const [hoverCity, setHoverCity] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | null>(null);

  const filteredCities = useMemo(() => {
    if (filters.cities.length === 0) return cities;
    return cities.filter((c) => filters.cities.includes(c.id));
  }, [filters.cities]);

  const heatValues = filteredCities.map((c) => getHeatValue(c, heatMetric));
  const heatMin = Math.min(...heatValues);
  const heatMax = Math.max(...heatValues);

  const kpiCards = useMemo(() => {
    const fc = filters.cities.length > 0 ? cities.filter((c) => filters.cities.includes(c.id)) : cities;
    const fCats = filters.categories.length > 0 ? filters.categories : (Object.keys(CATEGORY_LABELS) as ProductCategory[]);
    const fProducts = products.filter((p) => fCats.includes(p.category));
    const avgShare = fc.reduce((s, c) => s + c.marketSharePercent, 0) / fc.length;
    const avgMargin = fProducts.length ? fProducts.reduce((s, p) => s + p.marginPercent, 0) / fProducts.length : 21.8;
    const activeCampaigns = campaigns.filter((c) => {
      const catMatch = filters.categories.length === 0 || c.eligibleCategories.some((ec) => filters.categories.includes(ec));
      const cityMatch = filters.cities.length === 0 || c.targetCities.some((tc) => filters.cities.includes(tc));
      return catMatch && cityMatch;
    }).length;
    const fDealers = filters.cities.length > 0 ? dealers.filter((d) => filters.cities.includes(d.city)) : dealers;
    const avgCompliance = fDealers.length ? fDealers.reduce((s, d) => s + d.complianceScore, 0) / fDealers.length : 79.4;
    const fComps = filters.competitors.length > 0
      ? competitorPrices.filter((cp) => { const b = COMPETITOR_BRANDS.find((br) => br.name === cp.brand); return b ? filters.competitors.includes(b.id) : false; })
      : competitorPrices;
    const catComps = filters.categories.length > 0 ? fComps.filter((cp) => filters.categories.includes(cp.category)) : fComps;
    const avgIndex = catComps.length ? +(catComps.reduce((s, cp) => s + (1 + cp.priceDeltaPercent / 100), 0) / catComps.length).toFixed(2) : 1.0;
    return [
      { id: "share", label: "Ulusal Pazar Payı", value: +avgShare.toFixed(1), suffix: "%", target: "42.0%", delta: `${avgShare >= 39 ? "+" : ""}${(avgShare - 39).toFixed(1)}pp`, positive: avgShare >= 39, icon: Target },
      { id: "margin", label: "Ortalama Brüt Marj", value: +avgMargin.toFixed(1), suffix: "%", target: "22.5%", delta: `${(avgMargin - 22.1).toFixed(1)}pp`, positive: avgMargin >= 22, icon: Percent },
      { id: "revenue", label: "Aylık Gelir Değişimi", value: +(4.5 * (fc.length / cities.length)).toFixed(1), suffix: "%", target: ">3%", delta: "+₺12M", positive: true, icon: DollarSign },
      { id: "campaigns", label: "Aktif Kampanya", value: activeCampaigns, suffix: "", target: "5", delta: `${activeCampaigns >= 3 ? "+" : ""}${activeCampaigns - 2}`, positive: activeCampaigns >= 3, icon: Megaphone },
      { id: "compliance", label: "Bayi Uyum Oranı", value: +avgCompliance.toFixed(1), suffix: "%", target: "85%", delta: `${(avgCompliance - 76).toFixed(1)}pp`, positive: avgCompliance >= 75, icon: Users },
      { id: "index", label: "Rakip Fiyat Endeksi", value: avgIndex, suffix: "", target: "0.95–1.05", delta: `${(avgIndex - 1.03) >= 0 ? "+" : ""}${(avgIndex - 1.03).toFixed(2)}`, positive: avgIndex >= 0.95 && avgIndex <= 1.05, icon: BarChart3 },
    ];
  }, [filters]);

  const categoryData = useMemo(() => {
    const cats = filters.categories.length > 0 ? filters.categories : (Object.keys(CATEGORY_LABELS) as ProductCategory[]);
    return cats.map((cat) => {
      const catProducts = products.filter((p) => p.category === cat);
      const avgMargin = catProducts.length ? catProducts.reduce((s, p) => s + p.marginPercent, 0) / catProducts.length : 0;
      const avgPrice = catProducts.length ? catProducts.reduce((s, p) => s + p.tsfPrice, 0) / catProducts.length : 0;
      const compCount = competitorPrices.filter((cp) => cp.category === cat).length;
      return { name: CATEGORY_LABELS[cat], margin: +avgMargin.toFixed(1), avgPrice: Math.round(avgPrice), competitors: compCount, cat };
    });
  }, [filters.categories]);

  const comparisonData = useMemo(() => {
    const cats = filters.categories.length > 0 ? filters.categories : (Object.keys(CATEGORY_LABELS) as ProductCategory[]);
    const brands = filters.competitors.length > 0
      ? COMPETITOR_BRANDS.filter((b) => filters.competitors.includes(b.id)).map((b) => b.name)
      : COMPARISON_BRANDS;
    return cats.map((cat) => {
      const arcProducts = products.filter((p) => p.category === cat);
      const arcAvg = arcProducts.length ? Math.round(arcProducts.reduce((s, p) => s + p.tsfPrice, 0) / arcProducts.length) : 0;
      const brandPrices: Record<string, { avg: number; delta: number; count: number }> = {};
      brands.forEach((brand) => {
        const cp = competitorPrices.filter((p) => p.brand === brand && p.category === cat);
        if (cp.length > 0) {
          const avg = Math.round(cp.reduce((s, p) => s + p.competitorPrice, 0) / cp.length);
          const delta = +(((avg - arcAvg) / arcAvg) * 100).toFixed(1);
          brandPrices[brand] = { avg, delta, count: cp.length };
        }
      });
      return { cat, name: CATEGORY_LABELS[cat], arcAvg, brands: brandPrices };
    });
  }, [filters.categories, filters.competitors]);

  const comparisonBrands = filters.competitors.length > 0
    ? COMPETITOR_BRANDS.filter((b) => filters.competitors.includes(b.id)).map((b) => b.name)
    : COMPARISON_BRANDS;

  const categoryProducts = useMemo(() => {
    if (!selectedCategory) return [];
    return products.filter((p) => p.category === selectedCategory).map((p) => {
      const comps = competitorPrices.filter((cp) => cp.arcelikEquivalentId === p.id);
      return { ...p, competitors: comps };
    });
  }, [selectedCategory]);

  const hoveredCityData = hoverCity ? cities.find((c) => c.id === hoverCity) : null;

  const cityCampaigns = useMemo(() => {
    if (!selectedCity) return [];
    return campaigns.filter((c) => c.targetCities.includes(selectedCity.id));
  }, [selectedCity]);

  const cityDealers = useMemo(() => {
    if (!selectedCity) return [];
    return dealers.filter((d) => d.city === selectedCity.id);
  }, [selectedCity]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpiCards.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{kpi.label}</span>
                <div className="w-8 h-8 rounded-lg bg-[#0E2841]/5 flex items-center justify-center">
                  <Icon size={16} className="text-[#0E2841]" />
                </div>
              </div>
              <div className="text-2xl font-extrabold text-[#0E2841]">
                <AnimatedCounter value={kpi.value} decimals={kpi.suffix === "%" ? 1 : kpi.id === "index" ? 2 : 0} />
                {kpi.suffix}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-bold flex items-center gap-0.5 ${kpi.positive ? "text-green-600" : "text-red-500"}`}>
                  {kpi.positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {kpi.delta}
                </span>
                <span className="text-[10px] text-gray-400">Hedef: {kpi.target}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-[#E30613]" />
              <h3 className="text-sm font-bold">Türkiye Haritası — Şehir Performansı</h3>
            </div>
            <div className="relative">
              <select
                value={heatMetric}
                onChange={(e) => setHeatMetric(e.target.value as HeatMetric)}
                className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 pr-8 appearance-none font-medium"
              >
                {(Object.entries(HEAT_LABELS) as [HeatMetric, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div className="relative p-4">
            <svg viewBox="0 0 850 400" className="w-full h-auto">
              <path d={TURKEY_OUTLINE} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1.5" />
              {filteredCities.map((city) => {
                const pos = CITY_POS[city.id];
                if (!pos) return null;
                const val = getHeatValue(city, heatMetric);
                const t = heatMax > heatMin ? (val - heatMin) / (heatMax - heatMin) : 0.5;
                const color = heatColor(t);
                const isHovered = hoverCity === city.id;
                const r = city.populationTier === "tier-1" ? 14 : city.populationTier === "tier-2" ? 10 : 7;
                return (
                  <g
                    key={city.id}
                    onMouseEnter={() => setHoverCity(city.id)}
                    onMouseLeave={() => setHoverCity(null)}
                    onClick={() => setSelectedCity(city)}
                    className="cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedCity(city); }}
                    aria-label={`${city.name} detaylarını göster`}
                  >
                    <circle cx={pos.x} cy={pos.y} r={r + 4} fill={color} opacity={0.15} />
                    <circle cx={pos.x} cy={pos.y} r={isHovered ? r + 2 : r} fill={color} stroke="white" strokeWidth="2" className="transition-all duration-150" />
                    <text x={pos.x} y={pos.y - r - 6} textAnchor="middle" fill="#374151" className="text-[9px] font-semibold pointer-events-none">{city.name}</text>
                  </g>
                );
              })}
            </svg>
            {hoveredCityData && (
              <div className="absolute top-4 right-4 bg-white/95 backdrop-blur border border-gray-200 rounded-xl p-3 shadow-lg w-52 pointer-events-none z-10">
                <p className="text-xs font-bold text-[#0E2841] mb-1">{hoveredCityData.name}</p>
                <div className="space-y-1 text-[11px] text-gray-600">
                  <div className="flex justify-between"><span>Pazar Payı</span><span className="font-bold text-[#0E2841]">%{hoveredCityData.marketSharePercent}</span></div>
                  <div className="flex justify-between"><span>Fiyat Endeksi</span><span className="font-bold">{hoveredCityData.avgPriceIndex}</span></div>
                  <div className="flex justify-between"><span>Bayi Sayısı</span><span className="font-bold">{hoveredCityData.dealerCount}</span></div>
                  <div className="flex justify-between"><span>Kampanyalar</span><span className="font-bold">{campaigns.filter((c) => c.targetCities.includes(hoveredCityData.id)).length}</span></div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-4 mt-2 px-2">
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#16a34a]" /><span className="text-[10px] text-gray-500">Yüksek</span></div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#f59e0b]" /><span className="text-[10px] text-gray-500">Orta</span></div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#ef4444]" /><span className="text-[10px] text-gray-500">Düşük</span></div>
              <div className="flex items-center gap-2 ml-auto text-[10px] text-gray-400">
                <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" /> Tier-1</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full border-2 border-gray-300" /> Tier-2</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full border-2 border-gray-300" /> Tier-3</span>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm"
        >
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <BarChart3 size={16} className="text-[#F5A623]" />
              Kategori Performansı — Ortalama Marj
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Tıklayarak ürün detayına bakın</p>
          </div>
          <div className="p-4 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" domain={[0, 35]} tick={{ fontSize: 11 }} tickFormatter={(v) => `%${v}`} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(val: number) => [`%${val}`, "Ortalama Marj"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="margin" radius={[0, 6, 6, 0]} barSize={18} className="cursor-pointer" onClick={(_: unknown, idx: number) => setSelectedCategory(categoryData[idx]?.cat as ProductCategory)}>
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-white rounded-xl border border-gray-100 shadow-sm"
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold">Rakip Fiyat Karşılaştırması</h3>
          <span className="text-[10px] text-gray-400">{comparisonData.length} kategori × {comparisonBrands.length} rakip</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Kategori</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-[#E30613] uppercase tracking-wide">Arçelik Ort.</th>
                {comparisonBrands.map((brand) => (
                  <th key={brand} className="text-right px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{brand}</th>
                ))}
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Trend</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.map((row) => {
                const sparkData = Array.from({ length: 6 }, (_, i) => row.arcAvg * (0.96 + Math.sin(i + row.cat.charCodeAt(0)) * 0.03));
                return (
                  <tr key={row.cat} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <span className="text-xs font-semibold text-[#0E2841]">{row.name}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-bold text-[#E30613]">₺{row.arcAvg.toLocaleString("tr-TR")}</td>
                    {comparisonBrands.map((brand) => {
                      const bp = row.brands[brand];
                      if (!bp) return <td key={brand} className="px-4 py-3 text-center text-[10px] text-gray-300">—</td>;
                      const deltaColor = bp.delta > 5 ? "text-green-600" : bp.delta < -5 ? "text-amber-600" : "text-gray-600";
                      return (
                        <td key={brand} className="px-4 py-3 text-right">
                          <div className="font-mono text-xs">₺{bp.avg.toLocaleString("tr-TR")}</div>
                          <div className={`text-[10px] font-bold ${deltaColor}`}>{bp.delta > 0 ? "+" : ""}{bp.delta}%</div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      <Sparkline data={sparkData} color="#0E2841" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>

      <AnimatePresence>
        {selectedCategory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            onClick={() => setSelectedCategory(null)}
          >
            <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] overflow-hidden"
            >
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package size={18} className="text-[#F5A623]" />
                  <h3 className="text-lg font-bold">{CATEGORY_LABELS[selectedCategory]} — Ürün Detayları</h3>
                </div>
                <button onClick={() => setSelectedCategory(null)} className="p-1.5 hover:bg-gray-100 rounded-lg" aria-label="Kapat"><X size={18} /></button>
              </div>
              <div className="overflow-y-auto max-h-[65vh] p-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50/50">
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500">Model</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-gray-500">TSF Fiyat</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-gray-500">Marj</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500">Enerji</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500">Rakip Fiyatları</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryProducts.map((p) => (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-2.5">
                          <div className="text-xs font-semibold text-[#0E2841]">{p.name}</div>
                          <div className="text-[10px] text-gray-400">{p.modelCode}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs font-bold">₺{p.tsfPrice.toLocaleString("tr-TR")}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-semibold text-green-600">%{p.marginPercent}</td>
                        <td className="px-4 py-2.5"><span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded">{p.energyClass}</span></td>
                        <td className="px-4 py-2.5">
                          {p.competitors.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {p.competitors.map((cp) => (
                                <span key={cp.id} className={`text-[10px] px-1.5 py-0.5 rounded ${cp.priceDeltaPercent > 0 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                                  {cp.brand}: ₺{cp.competitorPrice.toLocaleString("tr-TR")} ({cp.priceDeltaPercent > 0 ? "+" : ""}{cp.priceDeltaPercent}%)
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[10px] text-gray-400">Veri yok</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {selectedCity && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedCity(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.div
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-[420px] bg-white shadow-2xl h-full overflow-y-auto"
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-bold">{selectedCity.name}</h3>
              <button onClick={() => setSelectedCity(null)} className="p-1 hover:bg-gray-100 rounded-lg" aria-label="Şehir detayını kapat"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Pazar Payı</p>
                  <p className="text-xl font-extrabold text-[#0E2841]">%{selectedCity.marketSharePercent}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Fiyat Endeksi</p>
                  <p className="text-xl font-extrabold text-[#0E2841]">{selectedCity.avgPriceIndex}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Bayi Sayısı</p>
                  <p className="text-xl font-extrabold text-[#0E2841]">{selectedCity.dealerCount}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Segment</p>
                  <p className="text-xl font-extrabold text-[#0E2841] capitalize">{selectedCity.populationTier.replace("-", " ")}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-gray-700 mb-2">Kategori Bazlı Performans</p>
                <div className="space-y-1.5">
                  {(Object.entries(CATEGORY_LABELS) as [ProductCategory, string][]).map(([cat, label]) => {
                    const catProducts = products.filter((p) => p.category === cat);
                    const avgMargin = catProducts.length ? (catProducts.reduce((s, p) => s + p.marginPercent, 0) / catProducts.length).toFixed(1) : "0";
                    const compCount = competitorPrices.filter((cp) => cp.category === cat).length;
                    const cityWeight = selectedCity.marketSharePercent / 40;
                    return (
                      <div key={cat} className="flex items-center gap-2 text-xs">
                        <span className="w-28 text-gray-600 truncate">{label}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div className="h-full rounded-full bg-[#E30613]" style={{ width: `${Math.min(100, Number(avgMargin) * cityWeight * 1.5)}%` }} />
                        </div>
                        <span className="text-[10px] font-semibold w-12 text-right text-[#0E2841]">%{avgMargin}</span>
                        <span className="text-[10px] text-gray-400 w-16 text-right">{compCount} rakip</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-gray-700 mb-2">Rakip Gücü</p>
                {selectedCity.competitorStrength.map((cs) => (
                  <div key={cs.brand} className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs text-gray-600 w-20">{cs.brand}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div className="h-full rounded-full bg-[#E30613]" style={{ width: `${cs.strength * 10}%` }} />
                    </div>
                    <span className="text-xs font-bold text-gray-700 w-6 text-right">{cs.strength}</span>
                  </div>
                ))}
              </div>

              {cityCampaigns.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-700 mb-2">Aktif Kampanyalar ({cityCampaigns.length})</p>
                  <div className="space-y-2">
                    {cityCampaigns.map((c) => (
                      <div key={c.id} className="bg-purple-50 rounded-lg p-2.5">
                        <p className="text-xs font-semibold text-purple-800">{c.name}</p>
                        <p className="text-[10px] text-purple-600 mt-0.5">{c.promotionType} — {c.discountDetail}</p>
                        <p className="text-[10px] text-purple-500 mt-0.5">Etki: Pay {c.projectedImpact.marketShareLift}, Gelir {c.projectedImpact.revenueDelta}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cityDealers.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-700 mb-2">Bayiler ({cityDealers.length})</p>
                  <div className="space-y-1.5">
                    {cityDealers.map((d) => (
                      <div key={d.id} className="flex items-center gap-2 text-xs">
                        <span className={`w-2 h-2 rounded-full ${d.tier === "gold" ? "bg-yellow-400" : d.tier === "silver" ? "bg-gray-400" : "bg-orange-400"}`} />
                        <span className="flex-1 text-gray-700">{d.storeName}</span>
                        <span className="text-[10px] font-semibold text-[#0E2841]">{d.complianceScore}/100</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-bold text-gray-700 mb-1">Sezonsal Patern</p>
                <p className="text-xs text-gray-500 leading-relaxed">{selectedCity.seasonalPattern}</p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
