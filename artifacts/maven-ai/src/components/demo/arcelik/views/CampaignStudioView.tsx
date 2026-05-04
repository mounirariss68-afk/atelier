import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Target, MapPin, TrendingUp, Calendar, ChevronRight,
  Megaphone, Send, CheckCircle2, Clock, DollarSign, Users, Edit3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  campaigns, cities, products, CATEGORY_LABELS,
  type CampaignTemplate, type ProductCategory,
} from "@/data/arcelik-seed";

type Tab = "suggested" | "builder" | "history";

const MOCK_HISTORY = [
  { id: "h1", name: "Mart Ramazan Kampanyası", status: "completed" as const, dates: "1 Mar – 21 Mar 2026", lift: "+1.1%", revenue: "+₺38M" },
  { id: "h2", name: "Şubat Taksit Fırsatı", status: "completed" as const, dates: "1 Şub – 28 Şub 2026", lift: "+0.9%", revenue: "+₺28M" },
  { id: "h3", name: "Ocak Enerji Kampanyası", status: "completed" as const, dates: "15 Oca – 5 Şub 2026", lift: "+0.4%", revenue: "+₺12M" },
  { id: "h4", name: "Aralık Yılbaşı İndirimi", status: "completed" as const, dates: "15 Ara – 5 Oca 2026", lift: "+0.5%", revenue: "+₺22M" },
];

function CampaignCard({ campaign, onLaunch }: { campaign: CampaignTemplate; onLaunch: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const targetCityNames = campaign.targetCities.map((id) => cities.find((c) => c.id === id)?.name).filter(Boolean);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-[#E30613]/10 flex items-center justify-center">
              <Sparkles size={18} className="text-[#E30613]" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#0E2841]">{campaign.name}</h4>
              <p className="text-[11px] text-gray-500">{campaign.targetSegment}</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Sparkles size={10} /> AI Önerisi
          </span>
        </div>

        <p className="text-xs text-gray-600 mb-3 line-clamp-2">{campaign.headline}</p>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 flex items-center gap-1"><TrendingUp size={10} /> Pazar Payı</p>
            <p className="text-sm font-bold text-green-600">{campaign.projectedImpact.marketShareLift}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 flex items-center gap-1"><DollarSign size={10} /> Gelir</p>
            <p className="text-sm font-bold text-[#0E2841]">{campaign.projectedImpact.revenueDelta}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2">
            <p className="text-[10px] text-gray-500 flex items-center gap-1"><Target size={10} /> Marj Etkisi</p>
            <p className={`text-sm font-bold ${campaign.projectedImpact.marginEffect.startsWith("-") ? "text-amber-600" : "text-green-600"}`}>
              {campaign.projectedImpact.marginEffect}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-3">
          <MapPin size={12} />
          <span className="truncate">{targetCityNames.join(", ")}</span>
        </div>

        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="overflow-hidden">
            <div className="border-t border-gray-100 pt-3 space-y-2 text-xs text-gray-600">
              <p><strong>İndirim:</strong> {campaign.discountDetail}</p>
              <p><strong>Ton:</strong> {campaign.messagingTone}</p>
              <p><strong>Süre:</strong> {campaign.durationPattern}</p>
              <p><strong>Kategoriler:</strong> {campaign.eligibleCategories.map((c) => CATEGORY_LABELS[c]).join(", ")}</p>
              <p className="text-gray-400 italic">{campaign.bodyCopy}</p>
              <div className="bg-blue-50 rounded-lg p-3 mt-2">
                <p className="text-[11px] font-semibold text-blue-700 mb-1">Bayi POS Mesajı:</p>
                <p className="text-[11px] text-blue-600">{campaign.dealerPosMessaging}</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-gray-50/50">
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-gray-500 hover:text-[#0E2841] font-medium flex items-center gap-1">
          {expanded ? "Daralt" : "Detaylar"}
          <ChevronRight size={12} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        <button
          onClick={onLaunch}
          className="px-4 py-1.5 rounded-lg bg-[#E30613] text-white text-xs font-bold hover:bg-[#c00510] transition-colors flex items-center gap-1.5"
        >
          <Send size={12} /> Kampanyayı Başlat
        </button>
      </div>
    </motion.div>
  );
}

function CampaignBuilder() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [selectedCats, setSelectedCats] = useState<ProductCategory[]>([]);
  const [discount, setDiscount] = useState(10);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);

  const projectedImpact = {
    share: `+${(discount * 0.08).toFixed(1)}%`,
    revenue: `+₺${Math.round(discount * 3.5)}M`,
    margin: `${discount > 15 ? "-" : "+"}${(Math.abs(discount * 0.06 - 0.5)).toFixed(1)}%`,
  };

  const handleCreate = () => {
    toast({
      title: "Kampanya Oluşturuldu",
      description: `"${name || "Yeni Kampanya"}" başarıyla oluşturuldu ve onaya gönderildi.`,
    });
    setName("");
    setSelectedCats([]);
    setDiscount(10);
    setSelectedCities([]);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-5">
      <h3 className="text-sm font-bold flex items-center gap-2">
        <Edit3 size={16} className="text-[#F5A623]" />
        Kampanya Oluşturucu
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Kampanya Adı</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Yaz Fırsatları 2026"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E30613]/20 focus:border-[#E30613]"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Kategoriler</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(CATEGORY_LABELS) as [ProductCategory, string][]).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setSelectedCats((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id])}
                  className={`px-2.5 py-1 text-[11px] rounded-full border font-medium ${
                    selectedCats.includes(id) ? "bg-[#E30613] text-white border-[#E30613]" : "border-gray-200 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">İndirim Oranı: %{discount}</label>
            <input
              type="range"
              min={5}
              max={30}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              className="w-full accent-[#E30613]"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>%5</span>
              <span>%30</span>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Hedef Şehirler</label>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {cities.slice(0, 10).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCities((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])}
                  className={`px-2 py-0.5 text-[11px] rounded-full border ${
                    selectedCities.includes(c.id) ? "bg-blue-500 text-white border-blue-500" : "border-gray-200 text-gray-600"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-gradient-to-br from-[#0E2841] to-[#1a3a5c] rounded-xl p-5 text-white">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-3">Tahmini Etki (AI)</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-300">Pazar Payı Etkisi</span>
                <span className="text-lg font-extrabold text-green-400">{projectedImpact.share}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-300">Gelir Değişimi</span>
                <span className="text-lg font-extrabold text-white">{projectedImpact.revenue}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-300">Marj Etkisi</span>
                <span className={`text-lg font-extrabold ${projectedImpact.margin.startsWith("-") ? "text-amber-400" : "text-green-400"}`}>
                  {projectedImpact.margin}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-white/10">
              <p className="text-[10px] text-gray-400">
                {selectedCats.length} kategori × {selectedCities.length || "tüm"} şehir × %{discount} indirim
              </p>
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={!name && selectedCats.length === 0}
            className="w-full py-3 rounded-xl bg-[#E30613] text-white font-bold text-sm hover:bg-[#c00510] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Send size={16} /> Kampanyayı Oluştur & Onaya Gönder
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CampaignStudioView() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("suggested");

  const handleLaunch = (campaignName: string) => {
    toast({
      title: "Kampanya Başlatıldı",
      description: `"${campaignName}" kampanyası başarıyla aktif edildi. Bayilere bildirim gönderildi.`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-bold text-[#0E2841]">Kampanya Stüdyosu</h2>
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {([
            { id: "suggested" as Tab, label: "AI Önerileri", icon: Sparkles },
            { id: "builder" as Tab, label: "Oluşturucu", icon: Edit3 },
            { id: "history" as Tab, label: "Geçmiş", icon: Clock },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                tab === t.id ? "bg-white text-[#0E2841] shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "suggested" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} onLaunch={() => handleLaunch(c.name)} />
          ))}
        </div>
      )}

      {tab === "builder" && <CampaignBuilder />}

      {tab === "history" && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-bold">Kampanya Geçmişi</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {MOCK_HISTORY.map((h, i) => (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50/50"
              >
                <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center">
                  <CheckCircle2 size={16} className="text-green-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0E2841]">{h.name}</p>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1"><Calendar size={10} /> {h.dates}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-green-600">{h.lift} pay artışı</p>
                  <p className="text-[11px] text-gray-500">{h.revenue} gelir</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
