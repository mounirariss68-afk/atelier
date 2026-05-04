import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, MapPin, ArrowUpDown, X, ChevronDown,
  Target, Percent, BarChart3, Users, Megaphone, DollarSign,
} from "lucide-react";
import { useDashboardFilters } from "../DashboardContext";
import {
  products, competitorPrices, cities, kpiBenchmarks,
  CATEGORY_LABELS, COMPETITOR_BRANDS,
  type ProductCategory, type CityData, type CompetitorPrice,
} from "@/data/arcelik-seed";

const KPI_CARDS = [
  { id: "share", label: "Ulusal Pazar Payı", value: 39.8, suffix: "%", target: "42.0%", delta: "+0.8pp", positive: true, icon: Target },
  { id: "margin", label: "Ortalama Brüt Marj", value: 21.8, suffix: "%", target: "22.5%", delta: "-0.3pp", positive: false, icon: Percent },
  { id: "revenue", label: "Aylık Gelir Değişimi", value: 4.5, suffix: "%", target: ">3%", delta: "+₺12M", positive: true, icon: DollarSign },
  { id: "campaigns", label: "Aktif Kampanya", value: 3, suffix: "", target: "5", delta: "+1", positive: true, icon: Megaphone },
  { id: "compliance", label: "Bayi Uyum Oranı", value: 79.4, suffix: "%", target: "85%", delta: "+3.2pp", positive: true, icon: Users },
  { id: "index", label: "Rakip Fiyat Endeksi", value: 1.0, suffix: "", target: "0.95–1.05", delta: "−0.03", positive: true, icon: BarChart3 },
];

const TURKEY_OUTLINE = "M44,57 L109,46 L196,57 L326,40 L457,57 L544,69 L631,86 L674,74 L740,90 L805,114 L826,171 L805,229 L761,286 L718,314 L660,340 L600,355 L520,368 L457,371 L390,365 L326,371 L270,360 L196,371 L152,343 L100,320 L65,314 L44,257 L28,200 L22,171 L30,140 L44,114 L55,100 L65,97 Z";

const CITY_POS: Record<string, { x: number; y: number }> = {
  istanbul: { x: 134, y: 72 },
  ankara: { x: 309, y: 145 },
  izmir: { x: 55, y: 242 },
  bursa: { x: 140, y: 125 },
  antalya: { x: 215, y: 340 },
  adana: { x: 402, y: 333 },
  konya: { x: 295, y: 278 },
  gaziantep: { x: 510, y: 327 },
  mersin: { x: 384, y: 350 },
  kayseri: { x: 425, y: 225 },
  diyarbakir: { x: 635, y: 278 },
  samsun: { x: 461, y: 52 },
  trabzon: { x: 613, y: 72 },
  eskisehir: { x: 205, y: 152 },
  denizli: { x: 140, y: 285 },
  malatya: { x: 550, y: 245 },
  erzurum: { x: 684, y: 145 },
  van: { x: 778, y: 238 },
  manisa: { x: 68, y: 232 },
  tekirdag: { x: 72, y: 72 },
};

type HeatMetric = "share" | "price" | "dealers" | "competition";
const HEAT_LABELS: Record<HeatMetric, string> = {
  share: "Pazar Payı",
  price: "Fiyat Endeksi",
  dealers: "Bayi Sayısı",
  competition: "Rekabet Yoğunluğu",
};

function getHeatValue(city: CityData, metric: HeatMetric): number {
  if (metric === "share") return city.marketSharePercent;
  if (metric === "price") return city.avgPriceIndex * 100;
  if (metric === "dealers") return city.dealerCount;
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

export default function DashboardView() {
  const { filters } = useDashboardFilters();
  const [heatMetric, setHeatMetric] = useState<HeatMetric>("share");
  const [selectedCity, setSelectedCity] = useState<CityData | null>(null);
  const [hoverCity, setHoverCity] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<"delta" | "price" | "brand">("delta");
  const [sortAsc, setSortAsc] = useState(false);

  const filteredCities = useMemo(() => {
    if (filters.cities.length === 0) return cities;
    return cities.filter((c) => filters.cities.includes(c.id));
  }, [filters.cities]);

  const heatValues = filteredCities.map((c) => getHeatValue(c, heatMetric));
  const heatMin = Math.min(...heatValues);
  const heatMax = Math.max(...heatValues);

  const categoryData = useMemo(() => {
    const cats = filters.categories.length > 0
      ? filters.categories
      : (Object.keys(CATEGORY_LABELS) as ProductCategory[]);
    return cats.map((cat) => {
      const catProducts = products.filter((p) => p.category === cat);
      const avgMargin = catProducts.length ? catProducts.reduce((s, p) => s + p.marginPercent, 0) / catProducts.length : 0;
      const avgPrice = catProducts.length ? catProducts.reduce((s, p) => s + p.tsfPrice, 0) / catProducts.length : 0;
      const compCount = competitorPrices.filter((cp) => cp.category === cat).length;
      return { name: CATEGORY_LABELS[cat], margin: +avgMargin.toFixed(1), avgPrice: Math.round(avgPrice), competitors: compCount, cat };
    });
  }, [filters.categories]);

  const competitorRows = useMemo(() => {
    let rows = competitorPrices.map((cp) => {
      const arc = products.find((p) => p.id === cp.arcelikEquivalentId);
      return { ...cp, arcelikModel: arc?.modelCode ?? "", arcelikPrice: arc?.tsfPrice ?? 0 };
    });
    if (filters.competitors.length > 0) {
      rows = rows.filter((r) => {
        const match = COMPETITOR_BRANDS.find((b) => b.name === r.brand);
        return match ? filters.competitors.includes(match.id) : false;
      });
    }
    if (filters.categories.length > 0) {
      rows = rows.filter((r) => filters.categories.includes(r.category));
    }
    rows.sort((a, b) => {
      if (sortCol === "delta") return sortAsc ? a.priceDeltaPercent - b.priceDeltaPercent : b.priceDeltaPercent - a.priceDeltaPercent;
      if (sortCol === "price") return sortAsc ? a.competitorPrice - b.competitorPrice : b.competitorPrice - a.competitorPrice;
      return sortAsc ? a.brand.localeCompare(b.brand) : b.brand.localeCompare(a.brand);
    });
    return rows.slice(0, 20);
  }, [filters.competitors, filters.categories, sortCol, sortAsc]);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(false); }
  };

  const hoveredCityData = hoverCity ? cities.find((c) => c.id === hoverCity) : null;

  const CAT_COLORS = ["#E30613", "#0E2841", "#F5A623", "#16a34a", "#7c3aed", "#0891b2", "#db2777"];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {KPI_CARDS.map((kpi, i) => {
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
                <AnimatedCounter value={kpi.value} decimals={kpi.suffix === "%" ? 1 : 0} />
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
                  >
                    <circle cx={pos.x} cy={pos.y} r={r + 4} fill={color} opacity={0.15} />
                    <circle
                      cx={pos.x} cy={pos.y} r={isHovered ? r + 2 : r}
                      fill={color} stroke="white" strokeWidth="2"
                      className="transition-all duration-150"
                    />
                    <text
                      x={pos.x} y={pos.y - r - 6}
                      textAnchor="middle" fill="#374151"
                      className="text-[9px] font-semibold pointer-events-none"
                    >
                      {city.name}
                    </text>
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
                  <div className="flex justify-between"><span>Segment</span><span className="font-bold capitalize">{hoveredCityData.populationTier.replace("-", " ")}</span></div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-4 mt-2 px-2">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#16a34a]" />
                <span className="text-[10px] text-gray-500">Yüksek</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#f59e0b]" />
                <span className="text-[10px] text-gray-500">Orta</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#ef4444]" />
                <span className="text-[10px] text-gray-500">Düşük</span>
              </div>
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
          </div>
          <div className="p-4 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" domain={[0, 35]} tick={{ fontSize: 11 }} tickFormatter={(v) => `%${v}`} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(val: number) => [`%${val}`, "Ortalama Marj"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="margin" radius={[0, 6, 6, 0]} barSize={18}>
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
          <span className="text-[10px] text-gray-400">{competitorRows.length} sonuç gösteriliyor</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-[#0E2841]" onClick={() => toggleSort("brand")}>
                  <span className="flex items-center gap-1">Marka <ArrowUpDown size={10} /></span>
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Rakip Model</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Kategori</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-[#0E2841]" onClick={() => toggleSort("price")}>
                  <span className="flex items-center gap-1 justify-end">Rakip Fiyat <ArrowUpDown size={10} /></span>
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Arçelik Eşdeğer</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Arçelik Fiyat</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-[#0E2841]" onClick={() => toggleSort("delta")}>
                  <span className="flex items-center gap-1 justify-end">Fark <ArrowUpDown size={10} /></span>
                </th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Trend</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Konum</th>
              </tr>
            </thead>
            <tbody>
              {competitorRows.map((row) => {
                const sparkData = Array.from({ length: 6 }, (_, i) => row.competitorPrice * (0.95 + Math.sin(i + row.id.charCodeAt(3)) * 0.04));
                const deltaColor = row.priceDeltaPercent > 0 ? "text-red-500" : row.priceDeltaPercent < -10 ? "text-amber-500" : "text-green-600";
                const posColor = row.positioning === "premium" ? "bg-purple-50 text-purple-700" : row.positioning === "value" ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600";
                return (
                  <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-2.5 font-semibold text-[#0E2841]">{row.brand}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{row.competitorModel}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{CATEGORY_LABELS[row.category]}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">₺{row.competitorPrice.toLocaleString("tr-TR")}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{row.arcelikModel}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">₺{row.arcelikPrice.toLocaleString("tr-TR")}</td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs font-bold ${deltaColor}`}>
                      {row.priceDeltaPercent > 0 ? "+" : ""}{row.priceDeltaPercent}%
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Sparkline data={sparkData} color={row.priceDeltaPercent > 0 ? "#ef4444" : "#16a34a"} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${posColor}`}>
                        {row.positioning === "premium" ? "Premium" : row.positioning === "value" ? "Değer" : "Orta"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>

      {selectedCity && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedCity(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.div
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-96 bg-white shadow-2xl h-full overflow-y-auto"
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold">{selectedCity.name}</h3>
              <button onClick={() => setSelectedCity(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
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
