import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import {
  SlidersHorizontal, TrendingUp, TrendingDown, AlertTriangle,
  ChevronDown, DollarSign, Percent, Users, ShoppingCart, Send, CheckCircle2, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  products, competitorPrices, CATEGORY_LABELS, COMPETITOR_BRANDS,
  type ArcelikProduct, type ProductCategory,
} from "@/data/arcelik-seed";

type SimMode = "product" | "category";

export default function SimulatorView() {
  const { toast } = useToast();
  const [simMode, setSimMode] = useState<SimMode>("product");
  const [selectedProduct, setSelectedProduct] = useState<ArcelikProduct>(products[0]);
  const [selectedCat, setSelectedCat] = useState<ProductCategory>("buzdolabi");
  const [priceAdjust, setPriceAdjust] = useState(0);
  const [showResults, setShowResults] = useState(false);

  const catProducts = useMemo(() => products.filter((p) => p.category === selectedCat), [selectedCat]);
  const catAvgPrice = catProducts.length ? Math.round(catProducts.reduce((s, p) => s + p.tsfPrice, 0) / catProducts.length) : 0;
  const catAvgCost = catProducts.length ? Math.round(catProducts.reduce((s, p) => s + p.dealerCost, 0) / catProducts.length) : 0;
  const catAvgMargin = catProducts.length ? +(catProducts.reduce((s, p) => s + p.marginPercent, 0) / catProducts.length).toFixed(1) : 0;

  const basePrice = simMode === "product" ? selectedProduct.tsfPrice : catAvgPrice;
  const baseCost = simMode === "product" ? selectedProduct.dealerCost : catAvgCost;
  const baseMargin = simMode === "product" ? selectedProduct.marginPercent : catAvgMargin;
  const displayName = simMode === "product" ? selectedProduct.name : CATEGORY_LABELS[selectedCat];

  const newPrice = Math.round(basePrice * (1 + priceAdjust / 100));
  const newMargin = +((1 - baseCost / newPrice) * 100).toFixed(1);
  const marginDelta = +(newMargin - baseMargin).toFixed(1);

  const competitors = useMemo(() => {
    if (simMode === "product") {
      return competitorPrices.filter((cp) => cp.arcelikEquivalentId === selectedProduct.id);
    }
    return competitorPrices.filter((cp) => cp.category === selectedCat);
  }, [simMode, selectedProduct.id, selectedCat]);

  const impactData = useMemo(() => {
    const volumeChange = priceAdjust > 0 ? -priceAdjust * 1.2 : -priceAdjust * 0.8;
    const revenueChange = ((1 + priceAdjust / 100) * (1 + volumeChange / 100) - 1) * 100;
    const shareImpact = priceAdjust > 0 ? -priceAdjust * 0.15 : -priceAdjust * 0.2;
    const dealerSatisfaction = priceAdjust > 5 ? -2 : priceAdjust < -5 ? 1 : 0;
    return {
      volumeChange: +volumeChange.toFixed(1),
      revenueChange: +revenueChange.toFixed(1),
      shareImpact: +shareImpact.toFixed(2),
      dealerSatisfaction,
      risk: Math.abs(priceAdjust) > 15 ? "high" : Math.abs(priceAdjust) > 8 ? "medium" : "low",
    };
  }, [priceAdjust]);

  const comparisonChart = useMemo(() => {
    const rows: { name: string; price: number; fill: string }[] = [
      { name: `Arçelik (yeni)`, price: newPrice, fill: "#E30613" },
    ];
    const seen = new Set<string>();
    competitors.forEach((cp) => {
      if (!seen.has(cp.brand)) {
        seen.add(cp.brand);
        rows.push({
          name: cp.brand,
          price: cp.competitorPrice,
          fill: cp.positioning === "premium" ? "#7c3aed" : cp.positioning === "value" ? "#2563eb" : "#6B7280",
        });
      }
    });
    return rows.sort((a, b) => b.price - a.price);
  }, [newPrice, competitors]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-bold text-[#0E2841] flex items-center gap-2">
          <SlidersHorizontal size={20} /> Fiyat Simülatörü (What-If)
        </h2>
        <div className="flex bg-gray-100 rounded-lg p-0.5 ml-auto">
          <button
            onClick={() => { setSimMode("product"); setPriceAdjust(0); setShowResults(false); }}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${simMode === "product" ? "bg-white text-[#0E2841] shadow-sm" : "text-gray-500"}`}
          >
            Ürün Bazlı
          </button>
          <button
            onClick={() => { setSimMode("category"); setPriceAdjust(0); setShowResults(false); }}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${simMode === "category" ? "bg-white text-[#0E2841] shadow-sm" : "text-gray-500"}`}
          >
            <Layers size={12} /> Kategori Bazlı
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-5">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <label className="text-xs font-semibold text-gray-600 mb-2 block">
              {simMode === "product" ? "Ürün Seçin" : "Kategori Seçin"}
            </label>
            <div className="relative">
              {simMode === "product" ? (
                <select
                  value={selectedProduct.id}
                  onChange={(e) => {
                    const p = products.find((p) => p.id === e.target.value);
                    if (p) { setSelectedProduct(p); setPriceAdjust(0); setShowResults(false); }
                  }}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-[#E30613]/20"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — ₺{p.tsfPrice.toLocaleString("tr-TR")}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={selectedCat}
                  onChange={(e) => { setSelectedCat(e.target.value as ProductCategory); setPriceAdjust(0); setShowResults(false); }}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-[#E30613]/20"
                >
                  {(Object.entries(CATEGORY_LABELS) as [ProductCategory, string][]).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              )}
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg space-y-1.5 text-xs">
              {simMode === "product" ? (
                <>
                  <div className="flex justify-between"><span className="text-gray-500">Kategori</span><span className="font-semibold">{CATEGORY_LABELS[selectedProduct.category]}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Mevcut TSF</span><span className="font-semibold">₺{selectedProduct.tsfPrice.toLocaleString("tr-TR")}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Bayi Maliyeti</span><span className="font-semibold">₺{selectedProduct.dealerCost.toLocaleString("tr-TR")}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Mevcut Marj</span><span className="font-semibold">%{selectedProduct.marginPercent}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Enerji Sınıfı</span><span className="font-semibold">{selectedProduct.energyClass}</span></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-gray-500">Ürün Sayısı</span><span className="font-semibold">{catProducts.length} ürün</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Ort. TSF Fiyat</span><span className="font-semibold">₺{catAvgPrice.toLocaleString("tr-TR")}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Ort. Bayi Maliyeti</span><span className="font-semibold">₺{catAvgCost.toLocaleString("tr-TR")}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Ort. Marj</span><span className="font-semibold">%{catAvgMargin}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Rakip Ürün</span><span className="font-semibold">{competitors.length}</span></div>
                </>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <label className="text-xs font-semibold text-gray-600 mb-3 block">
              Fiyat Değişimi: <span className={`text-base font-extrabold ${priceAdjust > 0 ? "text-green-600" : priceAdjust < 0 ? "text-red-500" : "text-gray-700"}`}>
                {priceAdjust > 0 ? "+" : ""}{priceAdjust}%
              </span>
            </label>
            <input
              type="range"
              min={-20}
              max={20}
              step={1}
              value={priceAdjust}
              onChange={(e) => { setPriceAdjust(Number(e.target.value)); setShowResults(true); }}
              className="w-full accent-[#E30613]"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>-20%</span>
              <span>0</span>
              <span>+20%</span>
            </div>

            <div className="mt-4 p-4 bg-gradient-to-r from-[#0E2841] to-[#1a3a5c] rounded-xl text-white text-center">
              <p className="text-[10px] uppercase tracking-widest text-gray-400">Yeni {simMode === "category" ? "Ort. " : ""}Fiyat</p>
              <p className="text-3xl font-extrabold">₺{newPrice.toLocaleString("tr-TR")}</p>
              <p className={`text-xs mt-1 ${marginDelta >= 0 ? "text-green-400" : "text-amber-400"}`}>
                Yeni marj: %{newMargin} ({marginDelta >= 0 ? "+" : ""}{marginDelta}pp)
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-5">
          {showResults && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                {[
                  { label: "Hacim Değişimi", value: `${impactData.volumeChange > 0 ? "+" : ""}${impactData.volumeChange}%`, icon: ShoppingCart, positive: impactData.volumeChange > 0 },
                  { label: "Gelir Etkisi", value: `${impactData.revenueChange > 0 ? "+" : ""}${impactData.revenueChange}%`, icon: DollarSign, positive: impactData.revenueChange > 0 },
                  { label: "Pazar Payı", value: `${impactData.shareImpact > 0 ? "+" : ""}${impactData.shareImpact}pp`, icon: Percent, positive: impactData.shareImpact > 0 },
                  { label: "Bayi Etkisi", value: impactData.dealerSatisfaction > 0 ? "Pozitif" : impactData.dealerSatisfaction < 0 ? "Negatif" : "Nötr", icon: Users, positive: impactData.dealerSatisfaction >= 0 },
                ].map((item, i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <item.icon size={14} className="text-gray-400" />
                      <span className="text-[11px] font-semibold text-gray-500">{item.label}</span>
                    </div>
                    <p className={`text-lg font-extrabold ${item.positive ? "text-green-600" : "text-red-500"}`}>{item.value}</p>
                  </div>
                ))}
              </div>

              {impactData.risk !== "low" && (
                <div className={`rounded-xl p-4 flex items-start gap-3 mb-5 ${impactData.risk === "high" ? "bg-red-50 border border-red-100" : "bg-amber-50 border border-amber-100"}`}>
                  <AlertTriangle size={18} className={impactData.risk === "high" ? "text-red-500" : "text-amber-500"} />
                  <div>
                    <p className={`text-sm font-bold ${impactData.risk === "high" ? "text-red-700" : "text-amber-700"}`}>
                      {impactData.risk === "high" ? "Yüksek Risk" : "Orta Risk"}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {priceAdjust > 0
                        ? "Fiyat artışı müşteri kaybına ve pazar payı düşüşüne neden olabilir. Rakip reaksiyonunu değerlendirin."
                        : "Agresif indirim marjları ciddi şekilde etkileyebilir. Sürdürülebilirliği değerlendirin."}
                    </p>
                  </div>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
                <p className="text-sm font-bold text-blue-800 mb-2">Tahmini Rakip Reaksiyonu</p>
                <div className="space-y-1.5 text-xs text-blue-700">
                  {priceAdjust > 10 && <p>• <strong>Vestel:</strong> Büyük olasılıkla fiyat takip etmeyecek, düşük fiyat avantajını koruyacak.</p>}
                  {priceAdjust > 10 && <p>• <strong>Bosch:</strong> Premium konumu koruyarak fiyat farkını artıracak.</p>}
                  {priceAdjust > 5 && priceAdjust <= 10 && <p>• <strong>Rakipler:</strong> Orta seviye artış — rakiplerin belirgin tepki vermesi beklenmez ancak izlenmeli.</p>}
                  {priceAdjust > 0 && priceAdjust <= 5 && <p>• Küçük fiyat artışı — rakiplerin belirgin bir tepki vermesi beklenmez.</p>}
                  {priceAdjust === 0 && <p>• Fiyat değişikliği yok — mevcut rekabet dengesi korunur.</p>}
                  {priceAdjust < 0 && priceAdjust >= -5 && <p>• Küçük indirim — rakiplerin karşılık vermesi düşük olasılık.</p>}
                  {priceAdjust < -5 && <p>• <strong>Vestel:</strong> Agresif karşılık verebilir, fiyat savaşı riski var.</p>}
                  {priceAdjust < -5 && <p>• <strong>Bosch/Profilo:</strong> Premium konumunu koruyarak tepki vermeyebilir.</p>}
                  {priceAdjust < -10 && <p>• <strong>Samsung:</strong> Benzer indirim kampanyası başlatabilir, dikkatli olun.</p>}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-sm font-bold mb-3">Rakip Fiyat Karşılaştırması</h3>
                {comparisonChart.length > 1 ? (
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparisonChart} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₺${(v / 1000).toFixed(0)}K`} />
                        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [`₺${v.toLocaleString("tr-TR")}`, "Fiyat"]} />
                        <Bar dataKey="price" radius={[0, 6, 6, 0]} barSize={22}>
                          {comparisonChart.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 py-8 text-center">Bu {simMode === "product" ? "ürün" : "kategori"} için rakip fiyat verisi bulunamadı.</p>
                )}
              </div>

              <div className="flex items-center gap-3 mt-5">
                <button
                  onClick={() => toast({ title: "Fiyat Onaylandı", description: `${displayName} için %${priceAdjust > 0 ? "+" : ""}${priceAdjust} fiyat değişikliği onaylandı.` })}
                  className="flex-1 py-3 rounded-xl bg-[#E30613] text-white font-bold text-sm hover:bg-[#c00510] transition-colors flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={16} /> Bu Fiyatı Onayla
                </button>
                <button
                  onClick={() => toast({ title: "Bayilere Gönderildi", description: `${displayName} fiyat güncellemesi tüm bayilere iletildi.` })}
                  className="flex-1 py-3 rounded-xl border-2 border-[#0E2841] text-[#0E2841] font-bold text-sm hover:bg-[#0E2841]/5 transition-colors flex items-center justify-center gap-2"
                >
                  <Send size={16} /> Tüm Bayilere Gönder
                </button>
              </div>
            </motion.div>
          )}

          {!showResults && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <SlidersHorizontal size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-sm font-bold text-gray-600 mb-1">Fiyat simülasyonu başlatın</p>
              <p className="text-xs text-gray-400">Soldaki kaydırıcıyı hareket ettirerek fiyat değişikliğinin etkilerini görün</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
