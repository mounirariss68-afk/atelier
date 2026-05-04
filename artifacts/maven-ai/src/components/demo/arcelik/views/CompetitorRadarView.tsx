import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell,
} from "recharts";
import { Shield, TrendingUp, TrendingDown, Eye, AlertTriangle } from "lucide-react";
import { useDashboardFilters } from "../DashboardContext";
import {
  competitorPrices, products, COMPETITOR_BRANDS, CATEGORY_LABELS,
  type ProductCategory,
} from "@/data/arcelik-seed";

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

const RADAR_DIMS = [
  { key: "price", label: "Fiyat Rekabetçiliği" },
  { key: "range", label: "Ürün Çeşitliliği" },
  { key: "coverage", label: "Pazar Kapsamı" },
  { key: "premium", label: "Premium Güç" },
  { key: "value", label: "Değer Segmenti" },
  { key: "innovation", label: "İnovasyon" },
];

function computeBrandScores(brandName: string) {
  const prices = competitorPrices.filter((cp) => cp.brand === brandName);
  const avgDelta = prices.length ? prices.reduce((s, p) => s + Math.abs(p.priceDeltaPercent), 0) / prices.length : 0;
  const categories = new Set(prices.map((p) => p.category));
  const premiumCount = prices.filter((p) => p.positioning === "premium").length;
  const valueCount = prices.filter((p) => p.positioning === "value").length;
  return {
    price: Math.min(100, 50 + avgDelta * 2),
    range: categories.size * 15,
    coverage: Math.min(100, prices.length * 12),
    premium: premiumCount * 20,
    value: valueCount * 15,
    innovation: 40 + Math.random() * 30,
  };
}

const ARCELIK_SCORES = { price: 80, range: 95, coverage: 90, premium: 75, value: 70, innovation: 85 };

export default function CompetitorRadarView() {
  const { filters } = useDashboardFilters();
  const [selectedBrands, setSelectedBrands] = useState<string[]>(["Vestel", "Bosch"]);
  const [detailBrand, setDetailBrand] = useState<string | null>(null);

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
      const row: Record<string, unknown> = { name: CATEGORY_LABELS[cat] };
      selectedBrands.forEach((brand) => {
        const cp = competitorPrices.find((p) => p.brand === brand && p.category === cat);
        row[brand] = cp ? cp.priceDeltaPercent : 0;
      });
      return row;
    });
  }, [selectedBrands, filters.categories]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-[#0E2841]">Rakip Radarı</h2>
        <span className="text-xs text-gray-500">Karşılaştırmak için marka seçin (maks. 4)</span>
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
            Rekabet Haritası
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
          <h3 className="text-sm font-bold mb-4">Kategori Bazlı Fiyat Farkı (%)</h3>
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

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
      >
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          Fiyat Hareketleri Zaman Çizelgesi
        </h3>
        <div className="space-y-3">
          {[
            { date: "2 Mayıs 2026", brand: "Vestel", action: "Buzdolabı segmentinde %5 fiyat indirimi uygulandı", severity: "high" as const },
            { date: "28 Nisan 2026", brand: "Samsung", action: "OLED TV serisinde kampanya fiyatı uygulandı", severity: "medium" as const },
            { date: "25 Nisan 2026", brand: "Bosch", action: "Premium bulaşık makinesi yeni model lansmanı", severity: "low" as const },
            { date: "20 Nisan 2026", brand: "Profilo", action: "Çamaşır makinesi serisinde %3 fiyat artışı", severity: "low" as const },
            { date: "15 Nisan 2026", brand: "Vestel", action: "Klima segmentinde agresif yaz kampanyası başlangıcı", severity: "high" as const },
          ].map((event, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${event.severity === "high" ? "bg-red-500" : event.severity === "medium" ? "bg-amber-500" : "bg-green-500"}`} />
                {i < 4 && <div className="w-px h-8 bg-gray-200" />}
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
              <span className="text-sm font-bold text-[#0E2841]">{b.name}</span>
              {b.threat === "high" && <AlertTriangle size={14} className="text-red-500" />}
              {b.threat === "medium" && <Eye size={14} className="text-amber-500" />}
            </div>
            <div className="flex items-center gap-1 mb-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                b.positioning === "premium" ? "bg-purple-50 text-purple-700" : b.positioning === "value" ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600"
              }`}>
                {b.positioning === "premium" ? "Premium" : b.positioning === "value" ? "Değer" : "Orta"}
              </span>
            </div>
            <div className="mt-2 space-y-1 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>Takip edilen</span>
                <span className="font-semibold text-[#0E2841]">{b.priceCount} ürün</span>
              </div>
              <div className="flex justify-between">
                <span>Ort. fiyat farkı</span>
                <span className={`font-semibold ${parseFloat(b.avgDelta) < 0 ? "text-amber-600" : "text-green-600"}`}>
                  {parseFloat(b.avgDelta) > 0 ? "+" : ""}{b.avgDelta}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>Kategoriler</span>
                <span className="font-semibold text-[#0E2841]">{b.categoryCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Son Hareket</span>
                <span className="text-[10px] font-semibold text-amber-600">{b.threat === "high" ? "Fiyat indirimi" : b.threat === "medium" ? "Kampanya" : "Güncelleme"}</span>
              </div>
              <div className="flex justify-between">
                <span>Aktif Promo</span>
                <span className="text-[10px] font-semibold text-purple-600">{b.positioning === "value" ? "2 kampanya" : "1 kampanya"}</span>
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
          <h3 className="text-sm font-bold mb-3">{detailBrand} — Detaylı Fiyat Takibi</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500">Model</th>
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500">Kategori</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500">Fiyat</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold text-gray-500">Fark</th>
                  <th className="text-left px-4 py-2 text-[11px] font-semibold text-gray-500">Not</th>
                </tr>
              </thead>
              <tbody>
                {competitorPrices.filter((cp) => cp.brand === detailBrand).map((cp) => (
                  <tr key={cp.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-2 text-xs font-medium">{cp.competitorModel}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{CATEGORY_LABELS[cp.category]}</td>
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
