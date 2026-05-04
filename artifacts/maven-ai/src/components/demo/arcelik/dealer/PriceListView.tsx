import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Search, Clock, Tag, ArrowUpDown } from "lucide-react";
import { products, campaigns, CATEGORY_LABELS, type ProductCategory } from "@/data/arcelik-seed";

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ProductCategory[];

const ACTIVE_DISCOUNTS: Record<string, { rate: number; campaignName: string }> = {};
const energyCampaign = campaigns.find((c) => c.id === "enerji-verimlilik");
if (energyCampaign) {
  products.filter((p) => energyCampaign.eligibleCategories.includes(p.category) && p.energyClass === "A+++").forEach((p) => {
    ACTIVE_DISCOUNTS[p.id] = { rate: 12, campaignName: energyCampaign.name };
  });
}

const RECENT_CHANGES: Record<string, { oldPrice: number; date: string }> = {
  "buz-01": { oldPrice: 24990, date: "1 Mayıs" },
  "cam-03": { oldPrice: 23990, date: "29 Nisan" },
  "kli-02": { oldPrice: 20490, date: "30 Nisan" },
};

const fmt = (n: number) => n.toLocaleString("tr-TR");

export default function PriceListView() {
  const [activeTab, setActiveTab] = useState<ProductCategory>("buzdolabi");
  const [search, setSearch] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [sortCol, setSortCol] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    let items = products.filter((p) => p.category === activeTab);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((p) => p.name.toLowerCase().includes(q) || p.modelCode.toLowerCase().includes(q));
    }
    return items.sort((a, b) => {
      let va: number | string, vb: number | string;
      if (sortCol === "name") { va = a.name; vb = b.name; }
      else if (sortCol === "tsfPrice") { va = a.tsfPrice; vb = b.tsfPrice; }
      else if (sortCol === "dealerCost") { va = a.dealerCost; vb = b.dealerCost; }
      else if (sortCol === "margin") { va = a.marginPercent; vb = b.marginPercent; }
      else { va = a.name; vb = b.name; }
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [activeTab, search, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold">Fiyat Listesi</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ürün ara..."
              className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-[#E30613]/20 focus:border-[#E30613]"
            />
          </div>
          <button
            onClick={() => setShowChanges(!showChanges)}
            className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
              showChanges ? "bg-amber-50 border-amber-200 text-amber-700" : "border-gray-200 text-gray-500 hover:border-gray-300"
            }`}
          >
            <Clock size={13} />
            Son Değişiklikler
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              activeTab === cat ? "bg-[#E30613] text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100">
                {[
                  { id: "name", label: "Ürün Adı" },
                  { id: "model", label: "Model Kodu" },
                  { id: "tsfPrice", label: "TSF (₺)" },
                  { id: "dealerCost", label: "Bayi Alış (₺)" },
                  { id: "margin", label: "Marj (%)" },
                  { id: "discount", label: "Kampanya" },
                  { id: "final", label: "Son Fiyat (₺)" },
                ].map((col) => (
                  <th
                    key={col.id}
                    onClick={() => ["name", "tsfPrice", "dealerCost", "margin"].includes(col.id) ? toggleSort(col.id) : undefined}
                    className={`px-4 py-3 text-[11px] font-semibold text-gray-500 text-left whitespace-nowrap ${
                      ["name", "tsfPrice", "dealerCost", "margin"].includes(col.id) ? "cursor-pointer hover:text-[#0E2841]" : ""
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      {col.label}
                      {sortCol === col.id && <ArrowUpDown size={11} className="text-[#E30613]" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const discount = ACTIVE_DISCOUNTS[p.id];
                const finalPrice = discount ? Math.round(p.tsfPrice * (1 - discount.rate / 100)) : p.tsfPrice;
                const change = RECENT_CHANGES[p.id];
                const hasChange = showChanges && change;
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${
                      discount ? "bg-red-50/30" : hasChange ? "bg-amber-50/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium">{p.name}</p>
                      <p className="text-[10px] text-gray-400">{p.energyClass !== "-" ? `Enerji: ${p.energyClass}` : ""}</p>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-600">{p.modelCode}</td>
                    <td className="px-4 py-3 text-xs font-mono">
                      {hasChange && <span className="line-through text-gray-400 mr-1">₺{fmt(change.oldPrice)}</span>}
                      ₺{fmt(p.tsfPrice)}
                      {hasChange && <span className="text-[9px] text-amber-600 ml-1">({change.date})</span>}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-600">₺{fmt(p.dealerCost)}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-green-600">%{p.marginPercent}</td>
                    <td className="px-4 py-3">
                      {discount ? (
                        <span className="text-[10px] font-bold text-white bg-[#E30613] px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                          <Tag size={9} /> %{discount.rate} KAMPANYA
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-bold">
                      {discount ? (
                        <span className="text-[#E30613]">₺{fmt(finalPrice)}</span>
                      ) : (
                        <span>₺{fmt(p.tsfPrice)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100 text-xs text-gray-500">
          {filtered.length} ürün gösteriliyor — {CATEGORY_LABELS[activeTab]}
        </div>
      </motion.div>
    </div>
  );
}
