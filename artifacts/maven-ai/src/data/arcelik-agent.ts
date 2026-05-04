import {
  type CityData,
} from "./arcelik-seed";
import { getArcelikDataSnapshot, isArcelikDataReady } from "@/hooks/useArcelikData";

export type DirectorRole = "pricing" | "finance" | "marketing";
export type Severity = "critical" | "high" | "medium" | "low";
export type RecommendationStatus = "pending" | "approved" | "rejected" | "modified";
export type TaskStatus = "open" | "in-progress" | "done";
export type PlaybookStatus = "triggered" | "running" | "awaiting-approval" | "completed";

export interface ReasoningStep {
  source: string;
  observation: string;
  conclusion: string;
}

export interface AgentRecommendation {
  id: string;
  type: string;
  title: string;
  summary: string;
  targetRole: DirectorRole;
  severity: Severity;
  confidence: number;
  reasoning: ReasoningStep[];
  impact: { revenue: string; margin: string; share: string };
  recommendedAction: string;
  alternatives: string[];
  status: RecommendationStatus;
  createdAt: string;
  decidedBy?: string;
  decisionNote?: string;
  outcome?: string;
}

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  assignee: string;
  assigneeRole: DirectorRole;
  priority: Severity;
  deadline: string;
  status: TaskStatus;
  linkedRecommendation?: string;
  createdAt: string;
}

export interface AgentAlert {
  id: string;
  type: string;
  title: string;
  detail: string;
  severity: Severity;
  category: string;
  timestamp: string;
  actionUrl?: string;
}

export interface PlaybookStep {
  agent: string;
  action: string;
  status: "completed" | "running" | "pending";
  output?: string;
}

export interface AgentPlaybook {
  id: string;
  name: string;
  trigger: string;
  status: PlaybookStatus;
  steps: PlaybookStep[];
  startedAt: string;
  linkedRecommendation?: string;
}

export interface AgentActivityEntry {
  id: string;
  agent: string;
  action: string;
  detail: string;
  timestamp: string;
  type: "scan" | "analysis" | "recommendation" | "approval" | "alert";
}

export type DecisionType = "approved" | "rejected" | "modified";

export interface AgentDecisionLog {
  id: string;
  recommendationId: string;
  recommendationTitle: string;
  decisionType: DecisionType;
  decidedBy: string;
  role: DirectorRole;
  timestamp: string;
  rationale: string;
  modificationNote?: string;
  simulatedOutcome: {
    revenue: string;
    margin: string;
    share: string;
    timeframe: string;
  };
}

const fmt = (n: number) => n.toLocaleString("tr-TR");
const now = new Date();
const dayAgo = (d: number) => {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
};
const hoursAgo = (h: number) => {
  const dt = new Date(now);
  dt.setHours(dt.getHours() - h);
  return dt.toISOString();
};
const daysFromNow = (d: number) => {
  const dt = new Date(now);
  dt.setDate(dt.getDate() + d);
  return dt.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
};

function getData() {
  return getArcelikDataSnapshot();
}

function findWeakCities(): CityData[] {
  return [...getData().cities].sort((a, b) => a.marketSharePercent - b.marketSharePercent).slice(0, 5);
}

function findLowMarginProducts() {
  return [...getData().products].sort((a, b) => a.marginPercent - b.marginPercent).slice(0, 5);
}

function findCompetitorUndercuts() {
  return getData().competitorPrices.filter((cp) => cp.priceDeltaPercent < -10).slice(0, 8);
}

function findPremiumGaps() {
  return getData().competitorPrices.filter((cp) => cp.priceDeltaPercent > 20).slice(0, 5);
}

export function generateRecommendations(): AgentRecommendation[] {
  if (!isArcelikDataReady()) return [];
  const { products, dealers } = getData();
  const undercuts = findCompetitorUndercuts();
  const weakCities = findWeakCities();
  const premiumGaps = findPremiumGaps();
  const klimaProducts = products.filter((p) => p.category === "klima");
  const avgDealerCompliance = dealers.length > 0 ? dealers.reduce((s, d) => s + d.complianceScore, 0) / dealers.length : 0;
  const lowComplianceDealers = dealers.filter((d) => d.complianceScore < 75);

  const recs: AgentRecommendation[] = [
    {
      id: "rec-01",
      type: "competitive-response",
      title: "Vestel Buzdolabı Fiyat Saldırısına Karşı Aksiyon",
      summary: `Vestel, buzdolabı segmentinde ortalama %${Math.abs(Math.round(undercuts.filter(u => u.brand === "Vestel" && u.category === "buzdolabi").reduce((s, u) => s + u.priceDeltaPercent, 0) / (undercuts.filter(u => u.brand === "Vestel" && u.category === "buzdolabi").length || 1)))} daha düşük fiyatlarla agresif konumlanma yapıyor. Pazar payı kaybı riski mevcut.`,
      targetRole: "pricing",
      severity: "high",
      confidence: 87,
      reasoning: [
        { source: "Rakip Fiyat Taraması", observation: `Vestel'in ${undercuts.filter(u => u.brand === "Vestel").length} ürününde Arçelik'e göre %10+ fiyat avantajı tespit edildi`, conclusion: "Agresif fiyat stratejisi teyit edildi" },
        { source: "Pazar Payı Analizi", observation: `Vestel'in güçlü olduğu şehirlerde (${weakCities.slice(0, 2).map(c => c.name).join(", ")}) Arçelik payı %${weakCities[0].marketSharePercent} seviyesinde`, conclusion: "Bölgesel pazar payı kaybı riski yüksek" },
        { source: "Marj Simülasyonu", observation: "Buzdolabı segmentinde %5 fiyat indirimi yapılsa marj %22'den %17.6'ya düşer", conclusion: "Genel indirim yerine hedefli kampanya daha uygun" },
        { source: "Karar Motoru", observation: "Alternatif: taksit avantajı + enerji verimliliği mesajı ile değer konumlandırması", conclusion: "Fiyat savaşı yerine değer önerisi stratejisi önerilir" },
      ],
      impact: { revenue: "+₺12M", margin: "-0.3%", share: "+0.4pp" },
      recommendedAction: "Ekonomik buzdolabı serisinde 12 ay faizsiz taksit + ₺2.000 eski ürün indirimi kampanyası başlat",
      alternatives: ["Doğrudan %5 fiyat indirimi", "Sadece İstanbul/Ankara için bölgesel kampanya", "Aksiyon almayıp izlemeye devam"],
      status: "pending",
      createdAt: hoursAgo(2),
    },
    {
      id: "rec-02",
      type: "margin-optimization",
      title: "Küçük Ev Aletleri Premium Fiyatlama Fırsatı",
      summary: `Küçük ev aletlerinde Bosch ortalama %47 daha pahalı. Arçelik'in fiyat artışı yapma alanı mevcut.`,
      targetRole: "pricing",
      severity: "medium",
      confidence: 92,
      reasoning: [
        { source: "Rakip Fiyat Analizi", observation: `Bosch küçük ev aletlerinde Arçelik'e göre ortalama %${Math.round(premiumGaps.filter(p => p.brand === "Bosch").reduce((s, p) => s + p.priceDeltaPercent, 0) / (premiumGaps.filter(p => p.brand === "Bosch").length || 1))} daha pahalı`, conclusion: "Geniş fiyat marjı mevcut" },
        { source: "Talep Elastikiyeti", observation: "Küçük ev aletlerinde fiyat elastikiyeti düşük (0.3-0.5), tüketici kaliteye odaklı", conclusion: "%5-8 fiyat artışı hacmi minimal etkiler" },
        { source: "Marj Analizi", observation: `Mevcut marj %30, sektör ortalaması %25-35 aralığında`, conclusion: "Marj artışı için alan var" },
      ],
      impact: { revenue: "+₺8M", margin: "+1.2%", share: "-0.1pp" },
      recommendedAction: "Espresso makinesi ve robot süpürge serisinde %5 fiyat artışı uygula",
      alternatives: ["Sadece premium modellerde artış", "%3 artış ile muhafazakar yaklaşım"],
      status: "pending",
      createdAt: hoursAgo(4),
    },
    {
      id: "rec-03",
      type: "campaign-intervention",
      title: "Ramazan Kampanyası ROI Düşüşü — Müdahale Gerekli",
      summary: "Ramazan kampanyasının gerçekleşen ROI'si tahminlerin %15 altında. Hedef kitle ve mesaj ayarlaması önerilir.",
      targetRole: "marketing",
      severity: "high",
      confidence: 84,
      reasoning: [
        { source: "Kampanya Performans Takibi", observation: "Tahmini pazar payı etkisi +1.2% iken gerçekleşen +0.85%", conclusion: "Kampanya hedefinin %71'i yakalandı" },
        { source: "Bölgesel Kırılım", observation: "İstanbul ve Ankara'da hedef aşıldı (+1.4%), Anadolu şehirlerinde düşük performans (+0.3%)", conclusion: "Bölgesel mesaj uyarlaması gerekli" },
        { source: "Rakip Analizi", observation: "Vestel aynı dönemde agresif taksit kampanyası başlattı", conclusion: "Rakip müdahalesi kampanya performansını etkiledi" },
        { source: "Müşteri Segmentasyonu", observation: "25-35 yaş segmentinde kampanya görünürlüğü düşük", conclusion: "Dijital kanal ağırlığı artırılmalı" },
      ],
      impact: { revenue: "+₺15M", margin: "-0.2%", share: "+0.3pp" },
      recommendedAction: "Anadolu şehirlerinde dijital reklam bütçesini %30 artır ve taksit mesajını öne çıkar",
      alternatives: ["Kampanya süresini 2 hafta uzat", "İndirim oranını %5 artır", "Mevcut planla devam et"],
      status: "pending",
      createdAt: hoursAgo(6),
    },
    {
      id: "rec-04",
      type: "seasonal-demand",
      title: "Klima Sezon Hazırlığı — Stok ve Fiyat Stratejisi",
      summary: `Klima talebinin Mayıs-Eylül döneminde %180 artması bekleniyor. ${klimaProducts.length} modelin stok ve fiyat stratejisi belirlenmelidir.`,
      targetRole: "pricing",
      severity: "high",
      confidence: 95,
      reasoning: [
        { source: "Sezonsal Talep Modeli", observation: "Son 3 yılın verilerine göre klima satışları Mayıs'ta %80, Haziran'da %150, Temmuz'da %180 artış gösteriyor", conclusion: "Sezon piki yaklaşıyor" },
        { source: "Stok Seviyesi Analizi", observation: `Mevcut bayi stokları ortalama ${Math.round(getData().dealers.reduce((s, d) => s + (d.stockLevels.klima ?? 0), 0) / getData().dealers.length)} adet — hedefin altında`, conclusion: "Stok takviyesi acil" },
        { source: "Rekabet Durumu", observation: `Regal klima %24 daha ucuz, Vestel %15 daha ucuz konumda`, conclusion: "Sezon başında fiyat avantajı kaybedilmemeli" },
        { source: "Marj Fırsatı", observation: "Yaz piğinde talep elastikiyeti düşer, %3-5 fiyat artışı uygulanabilir", conclusion: "Sezon başında fiyat sabitle, Temmuz'da %3 artış planla" },
      ],
      impact: { revenue: "+₺25M", margin: "+0.5%", share: "+0.6pp" },
      recommendedAction: "Haziran'a kadar bayi klima stoklarını 2x artır, Temmuz'da %3 fiyat artışı uygula",
      alternatives: ["Fiyatları sabit tut, hacim odaklı kampanya yap", "Sadece premium modellerde artış"],
      status: "pending",
      createdAt: hoursAgo(8),
    },
    {
      id: "rec-05",
      type: "dealer-compliance",
      title: "Bayi Uyum Düşüşü — Coaching Programı Başlat",
      summary: `${lowComplianceDealers.length} bayi uyum puanı 75'in altında. Ortalama uyum: ${avgDealerCompliance.toFixed(1)}/100.`,
      targetRole: "marketing",
      severity: "medium",
      confidence: 91,
      reasoning: [
        { source: "Bayi Uyum Takibi", observation: `${lowComplianceDealers.length} bayi hedef puanın (85) altında`, conclusion: "Sistemik uyum sorunu tespit edildi" },
        { source: "Korelasyon Analizi", observation: "Düşük uyumlu bayilerde satış hedefi gerçekleştirme %23 daha düşük", conclusion: "Uyum ile performans doğru orantılı" },
        { source: "Kök Neden Analizi", observation: "En sık sorunlar: TSF fiyatına uyumsuzluk (%45), kampanya materyali eksikliği (%30), eğitim katılımı (%25)", conclusion: "Öncelikli müdahale alanları belirlendi" },
      ],
      impact: { revenue: "+₺5M", margin: "+0.2%", share: "+0.2pp" },
      recommendedAction: "Düşük uyumlu bayilere 2 haftalık coaching programı başlat, TSF fiyat denetimi yap",
      alternatives: ["Sadece uyarı gönder", "Bayi seviye düşürme uygula"],
      status: "pending",
      createdAt: hoursAgo(12),
    },
    {
      id: "rec-06",
      type: "market-share-erosion",
      title: `${weakCities[0].name} Pazar Payı Erozyonu — Bölgesel Müdahale`,
      summary: `${weakCities[0].name}'da pazar payı %${weakCities[0].marketSharePercent} ile ulusal ortalamanın altında. Rakip baskısı artıyor.`,
      targetRole: "marketing",
      severity: "high",
      confidence: 88,
      reasoning: [
        { source: "Bölgesel Pazar Analizi", observation: `${weakCities[0].name} pazar payı %${weakCities[0].marketSharePercent}, ulusal ortalama %39.8`, conclusion: `${(39.8 - weakCities[0].marketSharePercent).toFixed(1)}pp fark var` },
        { source: "Rakip Güçlülük Endeksi", observation: `Bölgede ${weakCities[0].competitorStrength.sort((a, b) => b.strength - a.strength)[0]?.brand} en güçlü rakip (${weakCities[0].competitorStrength.sort((a, b) => b.strength - a.strength)[0]?.strength}/10)`, conclusion: "Rakip baskısı yüksek" },
        { source: "Bayi Yoğunluğu", observation: `${weakCities[0].dealerCount} bayi — yeterli dağıtım ağı`, conclusion: "Sorun dağıtım değil, fiyat/kampanya etkinliği" },
      ],
      impact: { revenue: "+₺8M", margin: "-0.1%", share: "+0.8pp" },
      recommendedAction: `${weakCities[0].name} özel bölgesel kampanya: tüm kategorilerde %10 ek indirim + yerel reklam desteği`,
      alternatives: ["Bayi teşvik programı artır", "Yeni bayi açılışı planla"],
      status: "pending",
      createdAt: hoursAgo(18),
    },
    {
      id: "rec-07",
      type: "cross-sell",
      title: "Çapraz Satış Fırsatı: Buzdolabı + Çamaşır Makine Paketi",
      summary: `Buzdolabı alan müşterilerin %35'i 3 ay içinde çamaşır makinesi alıyor. Paket teklifi oluşturulabilir.`,
      targetRole: "marketing",
      severity: "medium",
      confidence: 79,
      reasoning: [
        { source: "Satış Sepet Analizi", observation: "Son 6 ayda buzdolabı + çamaşır çapraz satış oranı %35", conclusion: "Yüksek çapraz satış potansiyeli" },
        { source: "Marj Optimizasyonu", observation: `Paket fiyatı ile bireysel marjdan %2 düşüş olsa da hacim %40 artar`, conclusion: "Net gelir etkisi pozitif" },
        { source: "Rakip Karşılaştırma", observation: "Bosch ve Samsung benzer paket teklifleri sunmuyor", conclusion: "Rekabet avantajı fırsatı" },
      ],
      impact: { revenue: "+₺18M", margin: "-0.4%", share: "+0.3pp" },
      recommendedAction: "Buzdolabı + çamaşır makinesi alanlara %8 ek indirim paketi oluştur",
      alternatives: ["3'lü beyaz eşya paketi (buzdolabı + çamaşır + bulaşık)", "Sadece premium serilerde paket"],
      status: "pending",
      createdAt: dayAgo(1),
    },
    {
      id: "rec-08",
      type: "new-product-pricing",
      title: "Grundig Premium Klima G 12420 — Lansman Fiyat Stratejisi",
      summary: "Yeni Grundig premium klima lansmanı için optimal fiyat noktası belirlenmelidir.",
      targetRole: "pricing",
      severity: "medium",
      confidence: 86,
      reasoning: [
        { source: "Ürün Özellik Analizi", observation: "UV-C filtre, A+++ enerji sınıfı — segmentteki en gelişmiş özellikler", conclusion: "Premium konumlandırma uygun" },
        { source: "Rakip Fiyat Haritası", observation: `Bosch eşdeğer model ₺${fmt(24990)}, Samsung ₺${fmt(22990)}`, conclusion: "₺22.990-₺26.990 aralığı optimal" },
        { source: "Mevcut Fiyatlama", observation: `Mevcut TSF ₺${fmt(24990)}, Bosch ile eşit`, conclusion: "Premium konumlandırma doğru, fiyat uygun" },
      ],
      impact: { revenue: "+₺3M", margin: "+0.1%", share: "+0.1pp" },
      recommendedAction: "Lansman fiyatı ₺24.990'da kalsın, ilk 2 ay %5 tanıtım indirimi uygula",
      alternatives: ["₺22.990 agresif fiyat ile hızlı penetrasyon", "₺26.990 premium konumlandırma"],
      status: "pending",
      createdAt: dayAgo(1),
    },
    {
      id: "rec-09",
      type: "taksit-optimization",
      title: "Taksit Yapısı Optimizasyonu — Banka Anlaşma Yenileme",
      summary: "Mevcut banka taksit anlaşmaları Temmuz'da sona eriyor. Yenileme şartları değerlendirmeli.",
      targetRole: "finance",
      severity: "high",
      confidence: 90,
      reasoning: [
        { source: "Taksit Performans Analizi", observation: "Taksitli satışlar toplam satışların %68'ini oluşturuyor", conclusion: "Taksit kritik satış aracı" },
        { source: "Banka Maliyet Karşılaştırması", observation: "Ziraat/Halkbank faizsiz 24 ay, İş Bankası %1.29 12 ay", conclusion: "Kamu bankaları ile anlaşma en avantajlı" },
        { source: "Rakip Taksit Analizi", observation: "Vestel 18 ay faizsiz sunuyor, Bosch 12 ay", conclusion: "24 ay avantajı korunmalı" },
        { source: "Maliyet Projeksiyonu", observation: "24 ay faizsiz maliyeti ürün başına ortalama %2.8", conclusion: "Maliyet kabul edilebilir, satış etkisi çok yüksek" },
      ],
      impact: { revenue: "+₺35M", margin: "-0.5%", share: "+0.8pp" },
      recommendedAction: "Ziraat ve Halkbank ile 24 ay faizsiz anlaşmayı yenile, Yapı Kredi ile 12 ay faizsiz genişlet",
      alternatives: ["Tüm bankalarda 12 aya düşür", "Sadece >₺15.000 ürünlerde 24 ay uygula"],
      status: "pending",
      createdAt: dayAgo(2),
    },
    {
      id: "rec-10",
      type: "stock-optimization",
      title: "TV Kategorisi Stok Fazlası — Fiyat İndirimi veya Kampanya",
      summary: "TV ve elektronik stok devir hızı düşük. 65 inç ve üzeri modellerde stok fazlası oluşuyor.",
      targetRole: "finance",
      severity: "medium",
      confidence: 82,
      reasoning: [
        { source: "Stok Devir Analizi", observation: "TV stok devir süresi 45 gün — hedef 30 gün", conclusion: "Stok maliyeti artıyor" },
        { source: "Model Bazlı Kırılım", observation: "65 inç ve 75 inç modellerde devir süresi 60+ gün", conclusion: "Büyük ekran modelleri yavaş satılıyor" },
        { source: "Fiyat Elastikiyeti", observation: "TV kategorisinde fiyat elastikiyeti 1.2 — fiyat duyarlı segment", conclusion: "%8-10 indirim satışı %15-20 artırabilir" },
      ],
      impact: { revenue: "+₺5M", margin: "-0.8%", share: "+0.2pp" },
      recommendedAction: "65 inç ve üzeri TV'lerde %10 indirim + 24 ay taksit kampanyası başlat",
      alternatives: ["Bayi teşvikini artır", "Yıl sonuna kadar bekle (yılbaşı talebi)"],
      status: "pending",
      createdAt: dayAgo(2),
    },
    {
      id: "rec-11",
      type: "energy-regulation",
      title: "Enerji Verimliliği Mevzuat Değişikliği — Fiyat Etkisi",
      summary: "AB enerji etiketleme sistemi güncellemesi Türkiye'de de uygulanacak. A+++ ürünlerde prim fırsatı.",
      targetRole: "pricing",
      severity: "medium",
      confidence: 76,
      reasoning: [
        { source: "Mevzuat Tarama Ajanı", observation: "Yeni enerji etiketleme sistemi 2026 Q3'te yürürlüğe giriyor", conclusion: "A+++ ürünler öne çıkacak" },
        { source: "Portföy Analizi", observation: `${getData().products.filter(p => p.energyClass === "A+++").length} A+++ ürün portföyde mevcut`, conclusion: "Hazırlıklı konumdayız" },
        { source: "Tüketici Araştırması", observation: "Enerji maliyeti farkındalığı %78'e yükseldi (geçen yıl %62)", conclusion: "Tüketici A+++ için prim ödemeye hazır" },
      ],
      impact: { revenue: "+₺10M", margin: "+0.3%", share: "+0.2pp" },
      recommendedAction: "A+++ ürünlerde 'yıllık ₺3.000 tasarruf' mesajı ile %3 fiyat artışı uygula",
      alternatives: ["Fiyat sabit tut, sadece pazarlama mesajı değiştir", "A++ ürünleri indir, A+++ öne çıkar"],
      status: "pending",
      createdAt: dayAgo(3),
    },
    {
      id: "rec-12",
      type: "dealer-tier",
      title: "3 Bayinin Seviye Yükseltme Değerlendirmesi",
      summary: "Silver seviyedeki 3 bayi son 3 ayda Gold kriterlerini karşılıyor. Seviye yükseltme önerilir.",
      targetRole: "marketing",
      severity: "low",
      confidence: 94,
      reasoning: [
        { source: "Bayi Performans Takibi", observation: "3 Silver bayi art arda 3 ay hedefin %100'ünü aştı", conclusion: "Sürekli yüksek performans" },
        { source: "Uyum Puanı", observation: "Ortalama uyum puanı 88/100 — Gold kriteri (85) üzerinde", conclusion: "Uyum koşulu sağlanıyor" },
        { source: "Teşvik Etkisi", observation: "Gold seviye bayiler ortalama %15 daha fazla sipariş veriyor", conclusion: "Seviye yükseltme ROI pozitif" },
      ],
      impact: { revenue: "+₺2M", margin: "0%", share: "+0.1pp" },
      recommendedAction: "3 bayiyi Gold seviyeye yükselt, tören ve tanıtım planla",
      alternatives: ["1 ay daha izle", "Sadece en iyisini yükselt"],
      status: "pending",
      createdAt: dayAgo(3),
    },
    {
      id: "rec-13",
      type: "quarterly-target",
      title: "Q2 Hedefler Risk Altında — Aksiyon Planı",
      summary: "Q2 gelir hedefinin %65'i tamamlandı, kalan sürede %35'lik açığı kapatmak için agresif aksiyon gerekli.",
      targetRole: "finance",
      severity: "critical",
      confidence: 93,
      reasoning: [
        { source: "Hedef Takip Sistemi", observation: "Q2 gelir hedefi: ₺450M, gerçekleşen: ₺292M (%65)", conclusion: "₺158M açık var" },
        { source: "Trend Projeksiyon", observation: "Mevcut hızla Q2 sonunda ₺380M'ye ulaşılabilir", conclusion: "Hedefin %84'ü yakalanır, %16 açık kalır" },
        { source: "Fırsat Analizi", observation: "Klima sezonu + Düğün sezonu = toplam ₺80M ek potansiyel", conclusion: "Doğru kampanya ile hedef yakalanabilir" },
        { source: "Senaryo Modeli", observation: "Klima fiyat artışı + çapraz satış paketi + bölgesel kampanyalar = ₺95M ek gelir tahmini", conclusion: "Hedef ulaşılabilir ancak tüm aksiyonlar eş zamanlı gerekli" },
      ],
      impact: { revenue: "+₺95M", margin: "+0.1%", share: "+1.2pp" },
      recommendedAction: "Klima sezon fiyatlaması + düğün çeyiz paketi + zayıf şehir kampanyalarını eş zamanlı başlat",
      alternatives: ["Sadece klima sezonuna odaklan", "Hedefi revize et"],
      status: "pending",
      createdAt: hoursAgo(1),
    },
    {
      id: "rec-14",
      type: "campaign-calendar",
      title: "Promosyon Takvimi Boşluğu — Haziran İlk Hafta",
      summary: "Haziran 1-15 döneminde aktif kampanya yok. Düğün sezonu başlangıcı fırsatı kaçırılıyor.",
      targetRole: "marketing",
      severity: "medium",
      confidence: 85,
      reasoning: [
        { source: "Promosyon Takvimi", observation: "Haziran 1-15 arası planlı kampanya yok", conclusion: "2 haftalık boşluk tespit edildi" },
        { source: "Sezonsal Analiz", observation: "Haziran düğün sezonu başlangıcı — çeyiz talebi artıyor", conclusion: "Yüksek talep dönemi fırsatı" },
        { source: "Geçmiş Performans", observation: "Geçen yıl Haziran ilk haftada kampanya yapılmış, +₺15M ek gelir", conclusion: "Kanıtlanmış fırsat" },
      ],
      impact: { revenue: "+₺12M", margin: "-0.3%", share: "+0.2pp" },
      recommendedAction: "Haziran 1-15 için 'Çeyiz Başlangıç Paketi' kampanyası oluştur",
      alternatives: ["Sadece taksit kampanyası yap", "Boşluğu kabul et, Haziran 15'ten itibaren başla"],
      status: "pending",
      createdAt: dayAgo(1),
    },
    {
      id: "rec-15",
      type: "demand-anomaly",
      title: "Antalya'da Bulaşık Makinesi Talebinde Anormal Artış",
      summary: "Son 2 haftada Antalya bölgesinde bulaşık makinesi talebi %45 arttı. Turizm sezonu otel yenilemeleri kaynaklı olabilir.",
      targetRole: "pricing",
      severity: "low",
      confidence: 72,
      reasoning: [
        { source: "Talep Anomali Tespiti", observation: "Antalya bulaşık satışları son 2 haftada normal seviyenin %45 üzerinde", conclusion: "Anormal talep artışı tespit edildi" },
        { source: "Bölgesel Analiz", observation: "Antalya turizm sezonu Mayıs'ta başlıyor, oteller yenileme yapıyor", conclusion: "Kurumsal talep artışı muhtemel" },
        { source: "Stok Kontrolü", observation: "Bölge stoku 15 gün yeter, talep devam ederse stok yetersiz kalır", conclusion: "Proaktif stok takviyesi gerekli" },
      ],
      impact: { revenue: "+₺3M", margin: "+0.1%", share: "+0.3pp" },
      recommendedAction: "Antalya bölgesine bulaşık makinesi stok takviyesi gönder, otel kanalına özel teklif hazırla",
      alternatives: ["Standart stok döngüsüyle devam et", "Fiyat artışı uygula (talep yüksekken)"],
      status: "pending",
      createdAt: hoursAgo(3),
    },
  ];

  return recs;
}

export function generateTasks(): AgentTask[] {
  return [
    { id: "task-01", title: "Vestel buzdolabı fiyat saldırısını değerlendir", description: "Vestel'in ekonomik buzdolabı serisinde %10+ fiyat avantajı analiz edilmeli. Karşı strateji önerisini incele ve onayla.", assignee: "Elif Demir", assigneeRole: "pricing", priority: "high", deadline: daysFromNow(3), status: "open", linkedRecommendation: "rec-01", createdAt: hoursAgo(2) },
    { id: "task-02", title: "Ramazan kampanyası ROI raporunu incele", description: "Kampanya performansı tahminlerin %15 altında. Bölgesel kırılım ve müdahale önerisini değerlendir.", assignee: "Ayşe Kara", assigneeRole: "marketing", priority: "high", deadline: daysFromNow(2), status: "open", linkedRecommendation: "rec-03", createdAt: hoursAgo(6) },
    { id: "task-03", title: "Q2 hedef açığı aksiyon planını onayla", description: "₺158M hedef açığı için önerilen eş zamanlı kampanya paketini değerlendir ve bütçe onayı ver.", assignee: "Mehmet Yılmaz", assigneeRole: "finance", priority: "critical", deadline: daysFromNow(1), status: "open", linkedRecommendation: "rec-13", createdAt: hoursAgo(1) },
    { id: "task-04", title: "Klima stok takviyesi siparişini onaya sun", description: "Yaz sezonu öncesi bayi klima stoklarının 2x artırılması için merkez depo siparişini hazırla.", assignee: "Elif Demir", assigneeRole: "pricing", priority: "high", deadline: daysFromNow(5), status: "open", linkedRecommendation: "rec-04", createdAt: hoursAgo(8) },
    { id: "task-05", title: "Banka taksit anlaşma yenileme tekliflerini karşılaştır", description: "Ziraat, Halkbank ve Yapı Kredi'nin yeni dönem taksit anlaşma şartlarını değerlendir.", assignee: "Mehmet Yılmaz", assigneeRole: "finance", priority: "high", deadline: daysFromNow(7), status: "open", linkedRecommendation: "rec-09", createdAt: dayAgo(2) },
    { id: "task-06", title: "Düşük uyumlu bayilere coaching planı hazırla", description: "Uyum puanı 75 altındaki bayiler için 2 haftalık iyileştirme programı taslağını oluştur.", assignee: "Ayşe Kara", assigneeRole: "marketing", priority: "medium", deadline: daysFromNow(5), status: "open", linkedRecommendation: "rec-05", createdAt: hoursAgo(12) },
    { id: "task-07", title: "Haziran promosyon takvimi boşluğunu doldur", description: "1-15 Haziran için çeyiz paketi kampanya brief'i hazırla ve onaya sun.", assignee: "Ayşe Kara", assigneeRole: "marketing", priority: "medium", deadline: daysFromNow(4), status: "open", linkedRecommendation: "rec-14", createdAt: dayAgo(1) },
    { id: "task-08", title: "TV stok fazlası için kampanya tasarla", description: "65 inç üzeri TV modellerinde stok eritme kampanyası planla. İndirim oranı ve süre belirle.", assignee: "Elif Demir", assigneeRole: "pricing", priority: "medium", deadline: daysFromNow(6), status: "open", linkedRecommendation: "rec-10", createdAt: dayAgo(2) },
  ];
}

export function generateAlerts(): AgentAlert[] {
  return [
    { id: "alert-01", type: "competitor-price", title: "Vestel buzdolabı fiyat indirimi", detail: "Vestel NF600 EX modeli ₺21.990'dan ₺19.990'a düşürüldü. Arçelik eşdeğer 5044 NFK ile fark %14'e açıldı.", severity: "critical", category: "Rakip Fiyat", timestamp: hoursAgo(1) },
    { id: "alert-02", type: "margin-breach", title: "Fırın kategorisi marj eşiği aşımı", detail: "Fırın & Ocak kategorisinde ortalama marj %22.3'ten %20.1'e düştü. Alt sınır: %20.", severity: "high", category: "Marj", timestamp: hoursAgo(3) },
    { id: "alert-03", type: "campaign-underperform", title: "Enerji Verimliliği kampanyası beklentinin altında", detail: "Kampanya 3. haftasında hedefin %62'sinde. Beklenen: %75. Müdahale önerilir.", severity: "high", category: "Kampanya", timestamp: hoursAgo(5) },
    { id: "alert-04", type: "stock-risk", title: "Klima stok kritik seviye — 3 bölge", detail: "İstanbul, Antalya, Adana bölgelerinde klima stoku 7 günlük satışın altına düştü.", severity: "high", category: "Stok", timestamp: hoursAgo(7) },
    { id: "alert-05", type: "dealer-compliance", title: "5 bayide TSF uyumsuzluğu tespit edildi", detail: "Haftalık fiyat denetiminde 5 bayi TSF'nin altında fiyat uyguladığı tespit edildi.", severity: "medium", category: "Bayi", timestamp: hoursAgo(10) },
    { id: "alert-06", type: "demand-shift", title: "Antalya bulaşık talebi +%45 anomali", detail: "Antalya bölgesinde bulaşık makinesi talebi son 2 haftada %45 arttı. Turizm sezonu etkisi.", severity: "low", category: "Talep", timestamp: hoursAgo(3) },
    { id: "alert-07", type: "competitor-campaign", title: "Samsung TV kampanyası başlattı", detail: "Samsung, 50 inç ve üzeri TV'lerde %15 indirim + 18 ay taksit kampanyası başlattı.", severity: "medium", category: "Rakip Kampanya", timestamp: hoursAgo(12) },
    { id: "alert-08", type: "target-risk", title: "Q2 gelir hedefi risk altında", detail: "Mevcut hızla Q2 hedefinin %84'ü yakalanabilir. ₺70M açık kalma riski var.", severity: "critical", category: "Hedef", timestamp: hoursAgo(1) },
    { id: "alert-09", type: "regulation", title: "Enerji etiketleme mevzuatı güncellendi", detail: "AB enerji sınıfı güncellemesi Q3 2026'da Türkiye'de uygulanacak. Ürün etiketleri güncellenmeli.", severity: "low", category: "Mevzuat", timestamp: dayAgo(1) },
    { id: "alert-10", type: "competitor-price", title: "Regal klima fiyatını düşürdü", detail: "Regal INV 09R klima ₺12.990'dan ₺11.490'a indi. Arçelik eşdeğerden %32 daha ucuz.", severity: "high", category: "Rakip Fiyat", timestamp: hoursAgo(4) },
  ];
}

export const PLAYBOOKS: AgentPlaybook[] = [
  {
    id: "pb-01",
    name: "Rakip Fiyat Müdahale Protokolü",
    trigger: "Rakip %10+ fiyat düşüşü tespit edildiğinde",
    status: "running",
    startedAt: hoursAgo(2),
    linkedRecommendation: "rec-01",
    steps: [
      { agent: "Fiyat İzleme Ajanı", action: "Rakip fiyat değişikliğini tespit et ve doğrula", status: "completed", output: "Vestel NF600 EX: ₺21.990 → ₺19.990 (-%9) teyit edildi" },
      { agent: "Pazar Analiz Ajanı", action: "Etkilenen segmenti ve pazar payı etkisini hesapla", status: "completed", output: "Ekonomik buzdolabı segmentinde %0.4pp pazar payı kaybı riski" },
      { agent: "Strateji Ajanı", action: "Karşı strateji alternatiflerini oluştur ve değerlendir", status: "completed", output: "3 alternatif: fiyat indirimi / değer kampanyası / bekleme" },
      { agent: "Karar Motoru", action: "En uygun stratejiyi öner ve etki simülasyonu yap", status: "running", output: "Değer kampanyası (taksit + trade-in) önerisi hazırlanıyor..." },
      { agent: "Onay Yöneticisi", action: "Fiyatlandırma Direktörü onayına sun", status: "pending" },
      { agent: "Uygulama Ajanı", action: "Onaylanan stratejiyi bayilere dağıt", status: "pending" },
    ],
  },
  {
    id: "pb-02",
    name: "Kampanya Performans Müdahale",
    trigger: "Kampanya ROI hedefin %20+ altına düştüğünde",
    status: "awaiting-approval",
    startedAt: hoursAgo(6),
    linkedRecommendation: "rec-03",
    steps: [
      { agent: "Performans İzleme Ajanı", action: "Kampanya KPI'larını kontrol et ve sapma tespit et", status: "completed", output: "Ramazan kampanyası ROI: hedefin %71'i" },
      { agent: "Teşhis Ajanı", action: "Düşük performansın kök nedenini belirle", status: "completed", output: "Anadolu bölgesinde düşük görünürlük + rakip taksit kampanyası etkisi" },
      { agent: "Optimizasyon Ajanı", action: "Kampanya parametrelerini optimize et", status: "completed", output: "Dijital bütçe +%30, taksit mesajı öne çıkarma, 2 hafta uzatma" },
      { agent: "Onay Yöneticisi", action: "Pazarlama Direktörü onayına sun", status: "running", output: "Onay bekleniyor..." },
      { agent: "Uygulama Ajanı", action: "Güncellenmiş kampanyayı dağıt", status: "pending" },
    ],
  },
  {
    id: "pb-03",
    name: "Stok Optimizasyon Protokolü",
    trigger: "Kategori stoku 10 günlük satışın altına düştüğünde",
    status: "running",
    startedAt: hoursAgo(7),
    linkedRecommendation: "rec-04",
    steps: [
      { agent: "Stok İzleme Ajanı", action: "Düşük stok tespit et ve bölgesel dağılımı kontrol et", status: "completed", output: "Klima stoku 3 bölgede kritik seviyede" },
      { agent: "Talep Tahmin Ajanı", action: "Önümüzdeki 30 gün talep tahmini oluştur", status: "completed", output: "Mayıs-Haziran klima talebi: mevcut stokun 2.3x'i bekleniyor" },
      { agent: "Sipariş Ajanı", action: "Optimal sipariş miktarını hesapla ve öneri oluştur", status: "running", output: "İstanbul: +200 adet, Antalya: +80 adet, Adana: +60 adet hesaplanıyor" },
      { agent: "Onay Yöneticisi", action: "Sipariş onayına sun", status: "pending" },
      { agent: "Lojistik Ajanı", action: "Onaylanan siparişi depoya ilet ve dağıtım planla", status: "pending" },
    ],
  },
  {
    id: "pb-04",
    name: "Bayi Coaching Programı",
    trigger: "Bayi uyum puanı art arda 2 ay 75 altında kaldığında",
    status: "completed",
    startedAt: dayAgo(14),
    linkedRecommendation: "rec-05",
    steps: [
      { agent: "Bayi Performans Ajanı", action: "Düşük uyumlu bayileri tespit et ve kök neden analizi yap", status: "completed", output: "8 bayi tespit edildi. Ortak sorunlar: TSF uyumsuzluk, materyal eksikliği" },
      { agent: "Eğitim Ajanı", action: "Kişiselleştirilmiş coaching programı oluştur", status: "completed", output: "2 haftalık program: TSF eğitimi + materyal dağıtımı + haftalık takip" },
      { agent: "İletişim Ajanı", action: "Bayilere program bildirimini gönder", status: "completed", output: "8 bayiye SMS ve portal bildirimi gönderildi" },
      { agent: "Takip Ajanı", action: "Program sonuçlarını ölç ve raporla", status: "completed", output: "6/8 bayide uyum puanı ortalama 12 puan artış" },
    ],
  },
  {
    id: "pb-05",
    name: "Pazar Fırsatı Değerlendirme",
    trigger: "Yeni pazar fırsatı veya talep anomalisi tespit edildiğinde",
    status: "running",
    startedAt: hoursAgo(3),
    linkedRecommendation: "rec-15",
    steps: [
      { agent: "Anomali Tespit Ajanı", action: "Talep anomalisini doğrula ve kök nedeni araştır", status: "completed", output: "Antalya bulaşık talebi +%45 doğrulandı. Otel yenileme sezonu" },
      { agent: "Fırsat Analiz Ajanı", action: "Fırsatın büyüklüğünü ve süresini tahmin et", status: "completed", output: "Tahmini ek talep: 200 adet/ay, süre: 2 ay" },
      { agent: "Strateji Ajanı", action: "Fırsat yakalama stratejisi oluştur", status: "running", output: "Otel kanalına özel B2B teklif + stok takviyesi hazırlanıyor" },
      { agent: "Onay Yöneticisi", action: "Bölge müdürü onayına sun", status: "pending" },
      { agent: "Satış Ajanı", action: "Otel müşteri adaylarına ulaş", status: "pending" },
    ],
  },
];

export function generateActivityLog(): AgentActivityEntry[] {
  return [
    { id: "act-01", agent: "Fiyat İzleme Ajanı", action: "Haftalık rakip fiyat taraması tamamlandı", detail: "8 marka, 64 ürün tarandı. 3 fiyat değişikliği tespit edildi.", timestamp: hoursAgo(1), type: "scan" },
    { id: "act-02", agent: "Pazar Analiz Ajanı", action: "Şehir bazlı pazar payı analizi güncellendi", detail: "20 şehirde pazar payı ve rekabet yoğunluğu yeniden hesaplandı.", timestamp: hoursAgo(2), type: "analysis" },
    { id: "act-03", agent: "Karar Motoru", action: "Vestel karşı strateji önerisi oluşturuldu", detail: "3 alternatif strateji değerlendirildi, değer kampanyası önerildi.", timestamp: hoursAgo(2), type: "recommendation" },
    { id: "act-04", agent: "Stok İzleme Ajanı", action: "Günlük stok seviye kontrolü tamamlandı", detail: "7 kategori, 24 bayi kontrol edildi. 3 bölgede klima stoku kritik.", timestamp: hoursAgo(3), type: "scan" },
    { id: "act-05", agent: "Performans İzleme Ajanı", action: "Ramazan kampanyası ROI raporu oluşturuldu", detail: "Kampanya hedefinin %71'i yakalandı. Bölgesel müdahale önerisi hazırlandı.", timestamp: hoursAgo(5), type: "analysis" },
    { id: "act-06", agent: "Anomali Tespit Ajanı", action: "Antalya talep anomalisi tespit edildi", detail: "Bulaşık makinesi talebinde %45 artış. Turizm sezonu korelasyonu.", timestamp: hoursAgo(3), type: "alert" },
    { id: "act-07", agent: "Talep Tahmin Ajanı", action: "Klima sezon tahmini güncellendi", detail: "Mayıs-Eylül dönemi için kategori bazlı talep projeksiyonu yenilendi.", timestamp: hoursAgo(8), type: "analysis" },
    { id: "act-08", agent: "Bayi Performans Ajanı", action: "Haftalık bayi uyum skoru güncellendi", detail: "24 bayi değerlendirildi. 5 bayide TSF uyumsuzluğu tespit edildi.", timestamp: hoursAgo(10), type: "scan" },
    { id: "act-09", agent: "Mevzuat Tarama Ajanı", action: "Enerji etiketleme mevzuatı güncellendi", detail: "AB enerji sınıfı değişikliği Q3 2026'da Türkiye'de yürürlüğe girecek.", timestamp: dayAgo(1), type: "alert" },
    { id: "act-10", agent: "Karar Motoru", action: "Q2 hedef risk analizi tamamlandı", detail: "₺158M hedef açığı için 3 senaryo modellendi. Eş zamanlı aksiyon paketi önerildi.", timestamp: hoursAgo(1), type: "recommendation" },
    { id: "act-11", agent: "Optimizasyon Ajanı", action: "Ramazan kampanyası optimizasyon önerisi hazırlandı", detail: "Dijital bütçe +%30 ve taksit mesajı önceliklendirmesi önerildi.", timestamp: hoursAgo(6), type: "recommendation" },
    { id: "act-12", agent: "Fiyat İzleme Ajanı", action: "Regal klima fiyat düşüşü tespit edildi", detail: "INV 09R: ₺12.990 → ₺11.490. Arçelik eşdeğerden %32 ucuz.", timestamp: hoursAgo(4), type: "alert" },
  ];
}

export function generateDecisionHistory(): AgentDecisionLog[] {
  return [
    {
      id: "dl-01",
      recommendationId: "rec-hist-01",
      recommendationTitle: "Samsung Bulaşık Makinesi Fiyat Eşleştirme",
      decisionType: "approved",
      decidedBy: "Elif Demir",
      role: "pricing",
      timestamp: dayAgo(3),
      rationale: "Rakip fiyat avantajı ciddi. Pazar payı kaybını önlemek için acil müdahale gerekli.",
      simulatedOutcome: { revenue: "+₺4.2M", margin: "-0.5%", share: "+0.2pp", timeframe: "30 gün" },
    },
    {
      id: "dl-02",
      recommendationId: "rec-hist-02",
      recommendationTitle: "Küçük Ev Aletleri Premium Fiyatlandırma",
      decisionType: "modified",
      decidedBy: "Elif Demir",
      role: "pricing",
      timestamp: dayAgo(5),
      rationale: "Fiyat artışı mantıklı ancak %8 yerine %5 ile başlayıp tepkiyi ölçmek daha güvenli.",
      modificationNote: "Önerilen %8 artış %5'e düşürüldü. 2 hafta sonra değerlendirme yapılacak.",
      simulatedOutcome: { revenue: "+₺6.1M", margin: "+1.2%", share: "-0.1pp", timeframe: "60 gün" },
    },
    {
      id: "dl-03",
      recommendationId: "rec-hist-03",
      recommendationTitle: "Beko Alt Segmenti Agresif Kampanya",
      decisionType: "rejected",
      decidedBy: "Mehmet Acar",
      role: "finance",
      timestamp: dayAgo(7),
      rationale: "Marj etkisi kabul edilemez. %15 indirim ile EBITDA hedefi tehlikeye girer.",
      simulatedOutcome: { revenue: "+₺18M", margin: "-3.1%", share: "+0.8pp", timeframe: "90 gün" },
    },
    {
      id: "dl-04",
      recommendationId: "rec-hist-04",
      recommendationTitle: "Klima Erken Sezon Stok Artışı",
      decisionType: "approved",
      decidedBy: "Ayşe Yılmaz",
      role: "marketing",
      timestamp: dayAgo(10),
      rationale: "Geçen yıl stok yetersizliği nedeniyle ₺22M kayıp yaşandı. Erken tedarik stratejik öncelik.",
      simulatedOutcome: { revenue: "+₺22M", margin: "+0.8%", share: "+0.6pp", timeframe: "120 gün" },
    },
    {
      id: "dl-05",
      recommendationId: "rec-hist-05",
      recommendationTitle: "TV Segmentinde Taksit Süresi Uzatma",
      decisionType: "modified",
      decidedBy: "Elif Demir",
      role: "pricing",
      timestamp: dayAgo(12),
      rationale: "36 ay taksit finans riski yüksek. 24 ay ile sınırlandırıldı, ancak faiz oranı düşürüldü.",
      modificationNote: "36 ay → 24 ay taksit, faiz oranı %1.29 → %0.99 olarak revize edildi.",
      simulatedOutcome: { revenue: "+₺9.5M", margin: "-0.2%", share: "+0.3pp", timeframe: "60 gün" },
    },
    {
      id: "dl-06",
      recommendationId: "rec-hist-06",
      recommendationTitle: "Doğu Anadolu Bayi Destek Paketi",
      decisionType: "approved",
      decidedBy: "Ayşe Yılmaz",
      role: "marketing",
      timestamp: dayAgo(15),
      rationale: "Bölgesel pazar payı %18'e düşmüş. Bayi teşvik paketi ile toparlanma mümkün.",
      simulatedOutcome: { revenue: "+₺7.3M", margin: "+0.1%", share: "+1.2pp", timeframe: "90 gün" },
    },
    {
      id: "dl-07",
      recommendationId: "rec-hist-07",
      recommendationTitle: "Çamaşır Makinesi Enerji Verimliliği Kampanyası",
      decisionType: "approved",
      decidedBy: "Mehmet Acar",
      role: "finance",
      timestamp: dayAgo(18),
      rationale: "Devlet teşviki ile kombine edilebilir. ROI pozitif. Bütçe içinde.",
      simulatedOutcome: { revenue: "+₺11M", margin: "+0.4%", share: "+0.5pp", timeframe: "45 gün" },
    },
  ];
}

export function generateDealerAgentTasks(dealerCity: string): AgentTask[] {
  if (!isArcelikDataReady()) return [];
  const cityName = getData().cities.find((c) => c.id === dealerCity)?.name ?? dealerCity;
  return [
    { id: "dt-01", title: "Klima stok seviyesini artır", description: `Yaz sezonu yaklaşıyor. Mevcut klima stoku optimum seviyenin altında. ${daysFromNow(7)} tarihine kadar sipariş verin.`, assignee: "Bayi", assigneeRole: "marketing", priority: "high", deadline: daysFromNow(7), status: "open", createdAt: hoursAgo(4) },
    { id: "dt-02", title: "Ramazan kampanyası POS materyallerini güncelle", description: "Yeni kampanya afişleri ve fiyat etiketleri hazır. Vitrininizde görünür şekilde konumlandırın.", assignee: "Bayi", assigneeRole: "marketing", priority: "medium", deadline: daysFromNow(2), status: "open", createdAt: hoursAgo(8) },
    { id: "dt-03", title: "3 bekleyen buzdolabı teklifi takip et", description: "Son 7 günde 3 müşteriye buzdolabı teklifi verilmiş ancak satış kapanmamış. Takip araması yapın.", assignee: "Bayi", assigneeRole: "marketing", priority: "medium", deadline: daysFromNow(3), status: "open", createdAt: hoursAgo(12) },
    { id: "dt-04", title: "Enerji Verimliliği kampanyasını öne çıkar", description: "A+++ ürünlerde %12 indirim kampanyası aktif. Müşterilere yıllık ₺3.000 tasarruf mesajını iletin.", assignee: "Bayi", assigneeRole: "marketing", priority: "low", deadline: daysFromNow(5), status: "open", createdAt: dayAgo(1) },
    { id: "dt-05", title: "TSF fiyat uyumluluğunu kontrol et", description: "Haftalık TSF denetimi yaklaşıyor. Tüm vitrin fiyatlarının güncel TSF ile eşleştiğinden emin olun.", assignee: "Bayi", assigneeRole: "pricing", priority: "high", deadline: daysFromNow(1), status: "open", createdAt: hoursAgo(6) },
  ];
}

export type AgentStatus = "online" | "processing" | "idle";

export interface SpecializedAgent {
  id: string;
  name: string;
  nameEn: string;
  type: "price-watch" | "market-analysis" | "campaign-opt" | "stock-mgmt" | "comp-response" | "demand-forecast" | "dealer-perf" | "reg-scan" | "decision-engine";
  status: AgentStatus;
  accuracy: number;
  actionsToday: number;
  lastAction: string;
  lastActionEn: string;
  lastActionTime: string;
  specializations: string[];
  specializationsEn: string[];
  recsGenerated: number;
  alertsRaised: number;
}

export function generateSpecializedAgents(): SpecializedAgent[] {
  return [
    {
      id: "sa-01", name: "Fiyat İzleme Ajanı", nameEn: "Price Watch Agent",
      type: "price-watch", status: "online", accuracy: 96, actionsToday: 8,
      lastAction: "Haftalık rakip fiyat taraması tamamlandı — 3 fiyat değişikliği tespit edildi",
      lastActionEn: "Weekly competitor price scan completed — 3 price changes detected",
      lastActionTime: hoursAgo(1),
      specializations: ["Rakip fiyat takibi", "Fiyat anomali tespiti", "TSF uyum kontrolü"],
      specializationsEn: ["Competitor price tracking", "Price anomaly detection", "TSF compliance check"],
      recsGenerated: 4, alertsRaised: 3,
    },
    {
      id: "sa-02", name: "Pazar Analiz Ajanı", nameEn: "Market Analysis Agent",
      type: "market-analysis", status: "processing", accuracy: 92, actionsToday: 5,
      lastAction: "Şehir bazlı pazar payı analizi güncelleniyor",
      lastActionEn: "Updating city-level market share analysis",
      lastActionTime: hoursAgo(2),
      specializations: ["Pazar payı analizi", "Bölgesel performans", "Rekabet yoğunluğu"],
      specializationsEn: ["Market share analysis", "Regional performance", "Competition intensity"],
      recsGenerated: 3, alertsRaised: 1,
    },
    {
      id: "sa-03", name: "Kampanya Optimizasyon Ajanı", nameEn: "Campaign Optimization Agent",
      type: "campaign-opt", status: "online", accuracy: 87, actionsToday: 4,
      lastAction: "Ramazan kampanyası optimizasyon önerisi hazırlandı",
      lastActionEn: "Ramadan campaign optimization suggestion prepared",
      lastActionTime: hoursAgo(5),
      specializations: ["ROI optimizasyonu", "Hedef kitle analizi", "Bütçe dağılımı"],
      specializationsEn: ["ROI optimization", "Target audience analysis", "Budget allocation"],
      recsGenerated: 2, alertsRaised: 1,
    },
    {
      id: "sa-04", name: "Stok Yönetim Ajanı", nameEn: "Stock Management Agent",
      type: "stock-mgmt", status: "online", accuracy: 94, actionsToday: 6,
      lastAction: "Günlük stok seviye kontrolü — 3 bölgede klima stoku kritik",
      lastActionEn: "Daily stock level check — AC stock critical in 3 regions",
      lastActionTime: hoursAgo(3),
      specializations: ["Stok seviye takibi", "Sipariş optimizasyonu", "Lojistik planlama"],
      specializationsEn: ["Stock level monitoring", "Order optimization", "Logistics planning"],
      recsGenerated: 2, alertsRaised: 2,
    },
    {
      id: "sa-05", name: "Rekabet Müdahale Ajanı", nameEn: "Competitive Response Agent",
      type: "comp-response", status: "processing", accuracy: 89, actionsToday: 7,
      lastAction: "Vestel buzdolabı fiyat saldırısına karşı strateji analizi yapılıyor",
      lastActionEn: "Analyzing counter-strategy for Vestel refrigerator price attack",
      lastActionTime: hoursAgo(2),
      specializations: ["Karşı strateji geliştirme", "Fiyat savaşı simülasyonu", "Değer konumlandırma"],
      specializationsEn: ["Counter-strategy development", "Price war simulation", "Value positioning"],
      recsGenerated: 5, alertsRaised: 2,
    },
    {
      id: "sa-06", name: "Talep Tahmin Ajanı", nameEn: "Demand Forecast Agent",
      type: "demand-forecast", status: "online", accuracy: 91, actionsToday: 3,
      lastAction: "Klima sezon tahmini güncellendi — Mayıs-Eylül projeksiyonu yenilendi",
      lastActionEn: "AC season forecast updated — May-September projection renewed",
      lastActionTime: hoursAgo(8),
      specializations: ["Sezonsal talep modeli", "Anomali tespiti", "Trend analizi"],
      specializationsEn: ["Seasonal demand model", "Anomaly detection", "Trend analysis"],
      recsGenerated: 2, alertsRaised: 1,
    },
    {
      id: "sa-07", name: "Bayi Performans Ajanı", nameEn: "Dealer Performance Agent",
      type: "dealer-perf", status: "online", accuracy: 93, actionsToday: 4,
      lastAction: "Haftalık bayi uyum skoru güncellendi — 5 bayide uyumsuzluk",
      lastActionEn: "Weekly dealer compliance score updated — 5 dealers non-compliant",
      lastActionTime: hoursAgo(10),
      specializations: ["Bayi uyum takibi", "Performans değerlendirme", "Coaching önerileri"],
      specializationsEn: ["Dealer compliance tracking", "Performance evaluation", "Coaching recommendations"],
      recsGenerated: 2, alertsRaised: 1,
    },
    {
      id: "sa-08", name: "Mevzuat Tarama Ajanı", nameEn: "Regulation Scan Agent",
      type: "reg-scan", status: "idle", accuracy: 88, actionsToday: 1,
      lastAction: "AB enerji etiketleme mevzuatı güncellendi",
      lastActionEn: "EU energy labeling regulation updated",
      lastActionTime: dayAgo(1),
      specializations: ["Mevzuat değişiklikleri", "Uyumluluk analizi", "Etki değerlendirme"],
      specializationsEn: ["Regulatory changes", "Compliance analysis", "Impact assessment"],
      recsGenerated: 1, alertsRaised: 1,
    },
    {
      id: "sa-09", name: "Karar Motoru", nameEn: "Decision Engine",
      type: "decision-engine", status: "processing", accuracy: 95, actionsToday: 10,
      lastAction: "Q2 hedef risk analizi — eş zamanlı aksiyon paketi modelleniyor",
      lastActionEn: "Q2 target risk analysis — simultaneous action package being modeled",
      lastActionTime: hoursAgo(1),
      specializations: ["Çoklu senaryo modelleme", "Etki simülasyonu", "Önceliklendirme"],
      specializationsEn: ["Multi-scenario modeling", "Impact simulation", "Prioritization"],
      recsGenerated: 6, alertsRaised: 0,
    },
  ];
}

export function generateSimulatorRecommendations() {
  return [
    {
      id: "sim-rec-01",
      productId: "buz-01",
      productName: "Arçelik 5088 NFK No-Frost Buzdolabı",
      suggestedAdjustment: -5,
      reasoning: "Vestel NF600 EX fiyat düşüşü sonrası rekabet gücünü korumak için kısa dönem fiyat indirimi önerilir. 10 gün içinde Vestel kampanyası sona eriyor.",
      confidence: 83,
      expiresIn: "10 gün",
    },
    {
      id: "sim-rec-02",
      productId: "kev-02",
      productName: "Arçelik K 8115 Espresso Makinesi",
      suggestedAdjustment: 5,
      reasoning: "Bosch eşdeğer model %47 daha pahalı. Fiyat artışı yapma alanı mevcut. Talep elastikiyeti düşük (0.3).",
      confidence: 91,
      expiresIn: "Süresiz",
    },
    {
      id: "sim-rec-03",
      productId: "kli-02",
      productName: "Arçelik 12420 İnverter Klima 12000 BTU",
      suggestedAdjustment: 3,
      reasoning: "Yaz sezonu başlangıcında talep artışı bekleniyor. Sezon piki öncesinde %3 fiyat artışı optimal.",
      confidence: 88,
      expiresIn: "15 gün",
    },
  ];
}

export function generateCampaignSuggestions() {
  return [
    { id: "cs-01", campaignId: "ramazan", suggestion: "Dijital reklam bütçesini %30 artırarak Anadolu bölgesinde görünürlüğü güçlendirin", reasoning: "Bölgesel analiz, Anadolu'daki düşük kampanya performansının düşük dijital görünürlükten kaynaklandığını gösteriyor", impact: "+₺8M gelir, +0.3pp pay", confidence: 84 },
    { id: "cs-02", campaignId: "dugun-sezonu", suggestion: "Kampanya başlangıcını 1 Haziran'a çekin (şu an 15 Haziran planlanmış)", reasoning: "Düğün hazırlıkları Mayıs sonunda başlıyor. Erken başlangıç rakiplerden önce pozisyon alınmasını sağlar", impact: "+₺12M gelir, +0.5pp pay", confidence: 87 },
    { id: "cs-03", campaignId: "enerji-verimlilik", suggestion: "Adana ve Gaziantep'i hedef şehirlere ekleyin", reasoning: "Bu şehirlerde klima talebi yüksek ve A+++ klima segmentinde Arçelik pazar payı düşük. Talep sinyali güçlü.", impact: "+₺5M gelir, +0.2pp pay", confidence: 79 },
  ];
}
