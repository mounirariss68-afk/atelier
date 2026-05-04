export type ProductCategory = "buzdolabi" | "camasir" | "bulasik" | "firin" | "klima" | "kucuk-ev" | "tv-elektronik";

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  buzdolabi: "Buzdolabı",
  camasir: "Çamaşır Makinesi",
  bulasik: "Bulaşık Makinesi",
  firin: "Fırın & Ocak",
  klima: "Klima",
  "kucuk-ev": "Küçük Ev Aletleri",
  "tv-elektronik": "TV & Elektronik",
};

export const CATEGORY_LABELS_EN: Record<ProductCategory, string> = {
  buzdolabi: "Refrigerator",
  camasir: "Washing Machine",
  bulasik: "Dishwasher",
  firin: "Oven & Cooktop",
  klima: "Air Conditioner",
  "kucuk-ev": "Small Appliances",
  "tv-elektronik": "TV & Electronics",
};

export function getCategoryLabel(cat: ProductCategory, lang: "tr" | "en" = "tr"): string {
  return lang === "en" ? CATEGORY_LABELS_EN[cat] : CATEGORY_LABELS[cat];
}

export interface ArcelikProduct {
  id: string;
  modelCode: string;
  name: string;
  category: ProductCategory;
  subcategory: string;
  tsfPrice: number;
  dealerCost: number;
  marginPercent: number;
  energyClass: string;
  features: string[];
}

export interface CompetitorPrice {
  id: string;
  brand: string;
  competitorModel: string;
  category: ProductCategory;
  competitorPrice: number;
  arcelikEquivalentId: string;
  priceDeltaPercent: number;
  positioning: "value" | "mid" | "premium";
  note: string;
}

export interface CityData {
  id: string;
  name: string;
  populationTier: "tier-1" | "tier-2" | "tier-3";
  marketSharePercent: number;
  avgPriceIndex: number;
  competitorStrength: { brand: string; strength: number }[];
  seasonalPattern: string;
  dealerCount: number;
}

export interface CampaignTemplate {
  id: string;
  name: string;
  targetSegment: string;
  eligibleCategories: ProductCategory[];
  promotionType: string;
  discountDetail: string;
  headline: string;
  bodyCopy: string;
  messagingTone: string;
  targetCities: string[];
  durationPattern: string;
  projectedImpact: { marketShareLift: string; revenueDelta: string; marginEffect: string };
  bannerDescription: string;
  dealerPosMessaging: string;
  dealerSmsNotification: string;
}

export interface DealerProfile {
  id: string;
  storeName: string;
  city: string;
  district: string;
  tier: "gold" | "silver" | "bronze";
  complianceScore: number;
  monthlySalesTarget: number;
  currentProgress: number;
  earnedCommission: number;
  productMix: Partial<Record<ProductCategory, number>>;
  stockLevels: Partial<Record<ProductCategory, number>>;
  pendingOrders: number;
  lastOrderDate: string;
}

export interface KpiBenchmark {
  id: string;
  label: string;
  value: string;
  target: string;
}

export interface CalendarEntry {
  id: string;
  brand: string;
  campaignName: string;
  startMonth: number;
  endMonth: number;
  categories: ProductCategory[];
  type: "confirmed" | "predicted";
}

export const COMPETITOR_BRANDS = [
  { id: "vestel", name: "Vestel", positioning: "value" as const },
  { id: "regal", name: "Regal", positioning: "value" as const },
  { id: "bosch", name: "Bosch", positioning: "premium" as const },
  { id: "siemens", name: "Siemens", positioning: "premium" as const },
  { id: "profilo", name: "Profilo", positioning: "mid" as const },
  { id: "samsung", name: "Samsung", positioning: "premium" as const },
  { id: "lg", name: "LG", positioning: "premium" as const },
  { id: "electrolux", name: "Electrolux/AEG", positioning: "premium" as const },
];

export const products: ArcelikProduct[] = [
  { id: "buz-01", modelCode: "5088 NFK", name: "Arçelik 5088 NFK No-Frost Buzdolabı", category: "buzdolabi", subcategory: "no-frost", tsfPrice: 25990, dealerCost: 20272, marginPercent: 22, energyClass: "A++", features: ["No-Frost", "Ion Fresh teknolojisi", "560 L hacim", "Dijital dokunmatik ekran"] },
  { id: "buz-02", modelCode: "5076 NFK", name: "Arçelik 5076 NFK No-Frost", category: "buzdolabi", subcategory: "no-frost", tsfPrice: 22490, dealerCost: 17542, marginPercent: 22, energyClass: "A++", features: ["No-Frost", "480 L hacim", "Antibakteriyel filtre"] },
  { id: "buz-03", modelCode: "5060 NFK", name: "Arçelik 5060 NFK A+++", category: "buzdolabi", subcategory: "no-frost", tsfPrice: 19990, dealerCost: 15792, marginPercent: 21, energyClass: "A+++", features: ["No-Frost", "430 L hacim", "Enerji tasarruflu"] },
  { id: "buz-04", modelCode: "5044 NFK", name: "Arçelik 5044 NFK Ekonomik", category: "buzdolabi", subcategory: "no-frost", tsfPrice: 17490, dealerCost: 13992, marginPercent: 20, energyClass: "A+", features: ["No-Frost", "380 L hacim"] },
  { id: "buz-05", modelCode: "970560 EI", name: "Beko 970560 EI Kombi No-Frost", category: "buzdolabi", subcategory: "kombi", tsfPrice: 28990, dealerCost: 22612, marginPercent: 22, energyClass: "A++", features: ["Kombi tip", "No-Frost", "580 L hacim", "Harvest Fresh"] },
  { id: "buz-06", modelCode: "9505 NFK", name: "Beko 9505 NFK", category: "buzdolabi", subcategory: "no-frost", tsfPrice: 23990, dealerCost: 18712, marginPercent: 22, energyClass: "A++", features: ["No-Frost", "500 L", "NeoFrost Dual Cooling"] },
  { id: "buz-07", modelCode: "274560 EI", name: "Arçelik 274560 EI Side-by-Side", category: "buzdolabi", subcategory: "side-by-side", tsfPrice: 42990, dealerCost: 33533, marginPercent: 22, energyClass: "A++", features: ["Side-by-Side", "620 L hacim", "Su ve buz dispenseri", "Dokunmatik panel"] },
  { id: "buz-08", modelCode: "1060 TY", name: "Arçelik Mini 1060 TY", category: "buzdolabi", subcategory: "mini", tsfPrice: 15490, dealerCost: 12547, marginPercent: 19, energyClass: "A+", features: ["Mini buzdolabı", "90 L hacim", "Ofis/yatak odası için"] },
  { id: "buz-09", modelCode: "825 NFK", name: "Beko 825 NFK No-Frost", category: "buzdolabi", subcategory: "no-frost", tsfPrice: 20990, dealerCost: 16582, marginPercent: 21, energyClass: "A++", features: ["No-Frost", "450 L", "Mavi Işık teknolojisi"] },
  { id: "buz-10", modelCode: "GRND 5100", name: "Grundig GRND 5100 Premium", category: "buzdolabi", subcategory: "premium", tsfPrice: 34990, dealerCost: 27292, marginPercent: 22, energyClass: "A+++", features: ["Full No-Frost", "550 L", "Vitamin Zone", "Premium cam kapı"] },
  { id: "cam-01", modelCode: "9124 D", name: "Arçelik 9124 D İnverter Çamaşır Makinesi", category: "camasir", subcategory: "inverter", tsfPrice: 18990, dealerCost: 14822, marginPercent: 22, energyClass: "A", features: ["9 kg", "1200 devir", "İnverter motor", "Buhar teknolojisi"] },
  { id: "cam-02", modelCode: "8124 D", name: "Arçelik 8124 D Çamaşır Makinesi", category: "camasir", subcategory: "standart", tsfPrice: 16490, dealerCost: 13192, marginPercent: 20, energyClass: "A", features: ["8 kg", "1200 devir", "15 program"] },
  { id: "cam-03", modelCode: "10143 D", name: "Arçelik 10143 D Premium", category: "camasir", subcategory: "premium", tsfPrice: 24990, dealerCost: 19242, marginPercent: 23, energyClass: "A", features: ["10 kg", "1400 devir", "İnverter", "Wi-Fi", "HomeWhiz"] },
  { id: "cam-04", modelCode: "BK 9141 E", name: "Beko BK 9141 E İnverter", category: "camasir", subcategory: "inverter", tsfPrice: 17490, dealerCost: 13642, marginPercent: 22, energyClass: "A", features: ["9 kg", "1400 devir", "ProSmart İnverter"] },
  { id: "cam-05", modelCode: "BK 10142 DA", name: "Beko BK 10142 DA", category: "camasir", subcategory: "standart", tsfPrice: 21990, dealerCost: 17152, marginPercent: 22, energyClass: "A", features: ["10 kg", "1400 devir", "AquaTech"] },
  { id: "cam-06", modelCode: "7103 D", name: "Arçelik 7103 D Ekonomik", category: "camasir", subcategory: "ekonomik", tsfPrice: 13990, dealerCost: 11472, marginPercent: 18, energyClass: "A", features: ["7 kg", "1000 devir", "Ekonomik seri"] },
  { id: "cam-07", modelCode: "9143 YD", name: "Arçelik 9143 YD Kurutmalı", category: "camasir", subcategory: "kurutmali", tsfPrice: 29990, dealerCost: 23092, marginPercent: 23, energyClass: "A", features: ["9 kg yıkama / 6 kg kurutma", "1400 devir", "Isı pompalı kurutma"] },
  { id: "cam-08", modelCode: "BK 851 YKI", name: "Beko BK 851 YKI Slim", category: "camasir", subcategory: "slim", tsfPrice: 14990, dealerCost: 11992, marginPercent: 20, energyClass: "A", features: ["8 kg", "Dar gövde (45cm)", "1000 devir"] },
  { id: "cam-09", modelCode: "GWN 39430", name: "Grundig GWN 39430 Premium", category: "camasir", subcategory: "premium", tsfPrice: 26990, dealerCost: 20792, marginPercent: 23, energyClass: "A", features: ["9 kg", "1400 devir", "Alerjik program", "Buhar"] },
  { id: "cam-10", modelCode: "8103 D", name: "Arçelik 8103 D A+++", category: "camasir", subcategory: "standart", tsfPrice: 15990, dealerCost: 12792, marginPercent: 20, energyClass: "A+++", features: ["8 kg", "1000 devir", "A+++ enerji sınıfı"] },
  { id: "bul-01", modelCode: "6344", name: "Arçelik 6344 İnverter Bulaşık Makinesi", category: "bulasik", subcategory: "inverter", tsfPrice: 16990, dealerCost: 13252, marginPercent: 22, energyClass: "A++", features: ["14 kişilik", "İnverter motor", "Hijyen program"] },
  { id: "bul-02", modelCode: "6266", name: "Arçelik 6266 A++ Bulaşık Makinesi", category: "bulasik", subcategory: "standart", tsfPrice: 14490, dealerCost: 11447, marginPercent: 21, energyClass: "A++", features: ["13 kişilik", "6 program", "Yarım yük"] },
  { id: "bul-03", modelCode: "BM 6016", name: "Beko BM 6016 Bulaşık Makinesi", category: "bulasik", subcategory: "standart", tsfPrice: 15490, dealerCost: 12082, marginPercent: 22, energyClass: "A++", features: ["14 kişilik", "AutoDose", "Hijyen Intense"] },
  { id: "bul-04", modelCode: "6566", name: "Arçelik 6566 Premium Bulaşık Makinesi", category: "bulasik", subcategory: "premium", tsfPrice: 21990, dealerCost: 16933, marginPercent: 23, energyClass: "A+++", features: ["14 kişilik", "CornerIntense", "AquaFlex", "Wi-Fi"] },
  { id: "bul-05", modelCode: "BM 9006 I", name: "Beko BM 9006 I İnverter", category: "bulasik", subcategory: "inverter", tsfPrice: 18990, dealerCost: 14812, marginPercent: 22, energyClass: "A++", features: ["14 kişilik", "İnverter", "Tray Wash", "Sessiz çalışma"] },
  { id: "bul-06", modelCode: "6144", name: "Arçelik 6144 Ekonomik Bulaşık", category: "bulasik", subcategory: "ekonomik", tsfPrice: 11990, dealerCost: 9832, marginPercent: 18, energyClass: "A+", features: ["12 kişilik", "4 program", "Ekonomik seri"] },
  { id: "bul-07", modelCode: "GNF 51030", name: "Grundig GNF 51030 Premium", category: "bulasik", subcategory: "premium", tsfPrice: 23990, dealerCost: 18472, marginPercent: 23, energyClass: "A+++", features: ["14 kişilik", "AutoDose", "GlassCare", "Zeolith kurutma"] },
  { id: "bul-08", modelCode: "BM 5005", name: "Beko BM 5005 Ekonomik", category: "bulasik", subcategory: "ekonomik", tsfPrice: 12990, dealerCost: 10392, marginPercent: 20, energyClass: "A+", features: ["13 kişilik", "5 program"] },
  { id: "fir-01", modelCode: "AFD 6001", name: "Arçelik AFD 6001 Ankastre Fırın", category: "firin", subcategory: "ankastre", tsfPrice: 12990, dealerCost: 10132, marginPercent: 22, energyClass: "A", features: ["Ankastre", "Turbo fırın", "80 L iç hacim", "Teleskopik ray"] },
  { id: "fir-02", modelCode: "AO 6614", name: "Arçelik AO 6614 Ankastre Ocak", category: "firin", subcategory: "ocak", tsfPrice: 8490, dealerCost: 6622, marginPercent: 22, energyClass: "-", features: ["Ankastre ocak", "4 gözlü", "Cam yüzey", "Otomatik ateşleme"] },
  { id: "fir-03", modelCode: "BIM 25400 XMS", name: "Beko BIM 25400 XMS Ankastre Fırın", category: "firin", subcategory: "ankastre", tsfPrice: 14990, dealerCost: 11692, marginPercent: 22, energyClass: "A", features: ["Ankastre", "Multifunksiyon", "Split&Cook", "70 L"] },
  { id: "fir-04", modelCode: "AFD 7002 S", name: "Arçelik AFD 7002 S Premium Fırın", category: "firin", subcategory: "premium", tsfPrice: 18990, dealerCost: 14432, marginPercent: 24, energyClass: "A+", features: ["Ankastre", "Buhar destekli pişirme", "Pyrolytic temizleme", "TFT ekran"] },
  { id: "fir-05", modelCode: "AO 8800", name: "Arçelik AO 8800 İndüksiyonlu Ocak", category: "firin", subcategory: "induksiyonlu", tsfPrice: 15990, dealerCost: 12472, marginPercent: 22, energyClass: "-", features: ["İndüksiyon", "4 bölge", "FlexZone", "Timer"] },
  { id: "fir-06", modelCode: "BIM 22301 X", name: "Beko BIM 22301 X Ankastre", category: "firin", subcategory: "ankastre", tsfPrice: 10990, dealerCost: 8792, marginPercent: 20, energyClass: "A", features: ["Ankastre", "8 fonksiyon", "65 L"] },
  { id: "fir-07", modelCode: "GEBM 34000 X", name: "Grundig GEBM 34000 X Premium", category: "firin", subcategory: "premium", tsfPrice: 22990, dealerCost: 17482, marginPercent: 24, energyClass: "A+", features: ["Ankastre", "Chef Assist", "Full-touch ekran", "Pyrolytic"] },
  { id: "fir-08", modelCode: "ASM 6650", name: "Arçelik ASM 6650 Set Üstü Ocak", category: "firin", subcategory: "set-ustu", tsfPrice: 9490, dealerCost: 7402, marginPercent: 22, energyClass: "-", features: ["Set üstü", "4 gözlü", "Emaye ızgara", "Otomatik ateşleme"] },
  { id: "kli-01", modelCode: "09410", name: "Arçelik 09410 İnverter Klima 9000 BTU", category: "klima", subcategory: "9000-btu", tsfPrice: 16990, dealerCost: 13252, marginPercent: 22, energyClass: "A++", features: ["9000 BTU", "İnverter", "R32 gaz", "Wi-Fi kontrol"] },
  { id: "kli-02", modelCode: "12420", name: "Arçelik 12420 İnverter Klima 12000 BTU", category: "klima", subcategory: "12000-btu", tsfPrice: 21990, dealerCost: 17152, marginPercent: 22, energyClass: "A++", features: ["12000 BTU", "İnverter", "Plazma filtre", "Sessiz mod"] },
  { id: "kli-03", modelCode: "18430", name: "Arçelik 18430 İnverter Klima 18000 BTU", category: "klima", subcategory: "18000-btu", tsfPrice: 28990, dealerCost: 22612, marginPercent: 22, energyClass: "A+", features: ["18000 BTU", "İnverter", "Geniş alan", "3D hava akışı"] },
  { id: "kli-04", modelCode: "24440", name: "Arçelik 24440 İnverter Klima 24000 BTU", category: "klima", subcategory: "24000-btu", tsfPrice: 35990, dealerCost: 28072, marginPercent: 22, energyClass: "A+", features: ["24000 BTU", "İnverter", "Büyük alan", "Otomatik yön"] },
  { id: "kli-05", modelCode: "BXEU 090", name: "Beko BXEU 090 Klima 9000 BTU", category: "klima", subcategory: "9000-btu", tsfPrice: 15990, dealerCost: 12472, marginPercent: 22, energyClass: "A++", features: ["9000 BTU", "İnverter", "R32 gaz"] },
  { id: "kli-06", modelCode: "BXEU 120", name: "Beko BXEU 120 Klima 12000 BTU", category: "klima", subcategory: "12000-btu", tsfPrice: 20490, dealerCost: 15982, marginPercent: 22, energyClass: "A+", features: ["12000 BTU", "İnverter", "Uyku modu"] },
  { id: "kli-07", modelCode: "G 12420", name: "Grundig G 12420 Premium Klima", category: "klima", subcategory: "12000-btu", tsfPrice: 24990, dealerCost: 19242, marginPercent: 23, energyClass: "A+++", features: ["12000 BTU", "İnverter", "UV-C filtre", "Premium tasarım"] },
  { id: "kev-01", modelCode: "K 3300", name: "Arçelik K 3300 Çay Makinesi", category: "kucuk-ev", subcategory: "cay-makinesi", tsfPrice: 3490, dealerCost: 2443, marginPercent: 30, energyClass: "-", features: ["Çelik demlik", "Otomatik kapanma", "Su göstergesi"] },
  { id: "kev-02", modelCode: "K 8115", name: "Arçelik K 8115 Espresso Makinesi", category: "kucuk-ev", subcategory: "espresso", tsfPrice: 8990, dealerCost: 6293, marginPercent: 30, energyClass: "-", features: ["15 bar basınç", "Süt köpürtme", "Çift çıkış"] },
  { id: "kev-03", modelCode: "S 6540", name: "Arçelik S 6540 Dikey Süpürge", category: "kucuk-ev", subcategory: "supurge", tsfPrice: 5490, dealerCost: 3843, marginPercent: 30, energyClass: "A", features: ["750W", "HEPA filtre", "Kablosuz değil"] },
  { id: "kev-04", modelCode: "BKK 2210", name: "Beko BKK 2210 Türk Kahvesi Makinesi", category: "kucuk-ev", subcategory: "turk-kahvesi", tsfPrice: 2490, dealerCost: 1743, marginPercent: 30, energyClass: "-", features: ["Tek pişirme", "Otomatik pişirme", "Anti-taşma"] },
  { id: "kev-05", modelCode: "T 8800", name: "Arçelik T 8800 Buharlı Ütü", category: "kucuk-ev", subcategory: "utu", tsfPrice: 2990, dealerCost: 2093, marginPercent: 30, energyClass: "-", features: ["2800W", "Seramik taban", "Sürekli buhar"] },
  { id: "kev-06", modelCode: "K 2360", name: "Arçelik K 2360 Filtre Kahve Makinesi", category: "kucuk-ev", subcategory: "filtre-kahve", tsfPrice: 3990, dealerCost: 2793, marginPercent: 30, energyClass: "-", features: ["1.5L karaf", "Aroma ayarı", "Timer"] },
  { id: "kev-07", modelCode: "BKK 2520", name: "Beko BKK 2520 Robot Süpürge", category: "kucuk-ev", subcategory: "robot-supurge", tsfPrice: 9990, dealerCost: 6993, marginPercent: 30, energyClass: "-", features: ["Lazer navigasyon", "Mop özelliği", "Wi-Fi", "120 dk pil"] },
  { id: "kev-08", modelCode: "K 7600", name: "Arçelik K 7600 Blender Set", category: "kucuk-ev", subcategory: "blender", tsfPrice: 4490, dealerCost: 3143, marginPercent: 30, energyClass: "-", features: ["1000W", "Cam hazne", "Doğrayıcı aksesuar"] },
  { id: "kev-09", modelCode: "TM 8860", name: "Grundig TM 8860 Tost Makinesi", category: "kucuk-ev", subcategory: "tost-makinesi", tsfPrice: 3290, dealerCost: 2303, marginPercent: 30, energyClass: "-", features: ["Seramik plaka", "4 dilim", "Sıcaklık ayarı"] },
  { id: "kev-10", modelCode: "S 8960", name: "Arçelik S 8960 Kablosuz Süpürge", category: "kucuk-ev", subcategory: "kablosuz-supurge", tsfPrice: 11990, dealerCost: 8393, marginPercent: 30, energyClass: "-", features: ["Kablosuz", "Dijital motor", "60 dk pil", "LED ışık"] },
  { id: "tv-01", modelCode: "A43 L 8740 4S", name: "Arçelik A43 L 8740 4S LED TV 43\"", category: "tv-elektronik", subcategory: "led-tv", tsfPrice: 15990, dealerCost: 13112, marginPercent: 18, energyClass: "G", features: ["43 inç", "Full HD", "Smart TV", "3 HDMI"] },
  { id: "tv-02", modelCode: "A50 L 8840 5S", name: "Arçelik A50 L 8840 5S 4K TV 50\"", category: "tv-elektronik", subcategory: "4k-tv", tsfPrice: 22990, dealerCost: 18852, marginPercent: 18, energyClass: "F", features: ["50 inç", "4K Ultra HD", "Smart TV", "HDR10"] },
  { id: "tv-03", modelCode: "A55 L 9895 5S", name: "Arçelik A55 L 9895 5S OLED TV 55\"", category: "tv-elektronik", subcategory: "oled-tv", tsfPrice: 39990, dealerCost: 32792, marginPercent: 18, energyClass: "G", features: ["55 inç", "OLED", "4K", "Dolby Vision", "120Hz"] },
  { id: "tv-04", modelCode: "B55 L 8840 5S", name: "Beko B55 L 8840 5S 4K TV 55\"", category: "tv-elektronik", subcategory: "4k-tv", tsfPrice: 21490, dealerCost: 17622, marginPercent: 18, energyClass: "F", features: ["55 inç", "4K Ultra HD", "Smart TV"] },
  { id: "tv-05", modelCode: "55 GHQ 9500", name: "Grundig 55 GHQ 9500 QLED TV 55\"", category: "tv-elektronik", subcategory: "qled-tv", tsfPrice: 44990, dealerCost: 36892, marginPercent: 18, energyClass: "F", features: ["55 inç", "QLED", "4K", "Google TV", "120Hz"] },
  { id: "tv-06", modelCode: "A65 L 8850 5S", name: "Arçelik A65 L 8850 5S 4K TV 65\"", category: "tv-elektronik", subcategory: "4k-tv", tsfPrice: 29990, dealerCost: 24592, marginPercent: 18, energyClass: "G", features: ["65 inç", "4K Ultra HD", "Smart TV", "Dolby Atmos"] },
  { id: "tv-07", modelCode: "B43 L 8730", name: "Beko B43 L 8730 LED TV 43\"", category: "tv-elektronik", subcategory: "led-tv", tsfPrice: 14990, dealerCost: 12292, marginPercent: 18, energyClass: "G", features: ["43 inç", "Full HD", "Smart TV"] },
  { id: "tv-08", modelCode: "75 GHQ 9800", name: "Grundig 75 GHQ 9800 OLED TV 75\"", category: "tv-elektronik", subcategory: "oled-tv", tsfPrice: 74990, dealerCost: 61492, marginPercent: 18, energyClass: "G", features: ["75 inç", "OLED", "4K", "120Hz", "Dolby Vision IQ"] },
];

export const competitorPrices: CompetitorPrice[] = [
  { id: "cp-v-01", brand: "Vestel", competitorModel: "NF600 EX A++", category: "buzdolabi", competitorPrice: 21990, arcelikEquivalentId: "buz-04", priceDeltaPercent: -8, positioning: "value", note: "Fiyat odaklı segment lideri" },
  { id: "cp-v-02", brand: "Vestel", competitorModel: "NF520 A++", category: "buzdolabi", competitorPrice: 17490, arcelikEquivalentId: "buz-03", priceDeltaPercent: -13, positioning: "value", note: "Agresif fiyatlandırma" },
  { id: "cp-v-03", brand: "Vestel", competitorModel: "CM 9812 İnverter", category: "camasir", competitorPrice: 15990, arcelikEquivalentId: "cam-01", priceDeltaPercent: -16, positioning: "value", note: "Fiyat avantajı ile pazar payı hedefi" },
  { id: "cp-v-04", brand: "Vestel", competitorModel: "BM 7101 A++", category: "bulasik", competitorPrice: 13490, arcelikEquivalentId: "bul-02", priceDeltaPercent: -7, positioning: "value", note: "Uygun fiyat segmenti" },
  { id: "cp-v-05", brand: "Vestel", competitorModel: "AO 6004 Ankastre Fırın", category: "firin", competitorPrice: 10990, arcelikEquivalentId: "fir-01", priceDeltaPercent: -15, positioning: "value", note: "Bütçe dostu ankastre" },
  { id: "cp-v-06", brand: "Vestel", competitorModel: "INV 09 Klima 9000 BTU", category: "klima", competitorPrice: 14490, arcelikEquivalentId: "kli-01", priceDeltaPercent: -15, positioning: "value", note: "En düşük fiyatlı inverter" },
  { id: "cp-v-07", brand: "Vestel", competitorModel: "50UA9630 4K TV", category: "tv-elektronik", competitorPrice: 18990, arcelikEquivalentId: "tv-02", priceDeltaPercent: -17, positioning: "value", note: "Agresif TV fiyatlandırması" },
  { id: "cp-v-08", brand: "Vestel", competitorModel: "CM 7810 Ekonomik", category: "camasir", competitorPrice: 11990, arcelikEquivalentId: "cam-06", priceDeltaPercent: -14, positioning: "value", note: "Giriş seviye rekabet" },
  { id: "cp-v-09", brand: "Vestel", competitorModel: "NF480 Kombi", category: "buzdolabi", competitorPrice: 24990, arcelikEquivalentId: "buz-05", priceDeltaPercent: -14, positioning: "value", note: "Kombi segmentinde fiyat avantajı" },
  { id: "cp-v-10", brand: "Vestel", competitorModel: "BM 9401 İnverter", category: "bulasik", competitorPrice: 16490, arcelikEquivalentId: "bul-05", priceDeltaPercent: -13, positioning: "value", note: "İnverter segmentinde alt fiyat" },
  { id: "cp-r-01", brand: "Regal", competitorModel: "NF 5200 A+", category: "buzdolabi", competitorPrice: 14990, arcelikEquivalentId: "buz-04", priceDeltaPercent: -14, positioning: "value", note: "En düşük fiyatlı no-frost" },
  { id: "cp-r-02", brand: "Regal", competitorModel: "CM 7100", category: "camasir", competitorPrice: 10990, arcelikEquivalentId: "cam-06", priceDeltaPercent: -21, positioning: "value", note: "Bütçe segmenti lideri" },
  { id: "cp-r-03", brand: "Regal", competitorModel: "BM 4010", category: "bulasik", competitorPrice: 9990, arcelikEquivalentId: "bul-06", priceDeltaPercent: -17, positioning: "value", note: "En ucuz bulaşık makinesi" },
  { id: "cp-r-04", brand: "Regal", competitorModel: "AFN 5001 Fırın", category: "firin", competitorPrice: 8990, arcelikEquivalentId: "fir-01", priceDeltaPercent: -31, positioning: "value", note: "Bütçe ankastre" },
  { id: "cp-r-05", brand: "Regal", competitorModel: "43R654FA TV", category: "tv-elektronik", competitorPrice: 11990, arcelikEquivalentId: "tv-01", priceDeltaPercent: -25, positioning: "value", note: "Giriş seviye TV" },
  { id: "cp-r-06", brand: "Regal", competitorModel: "INV 09R Klima", category: "klima", competitorPrice: 12990, arcelikEquivalentId: "kli-01", priceDeltaPercent: -24, positioning: "value", note: "En ucuz inverter klima" },
  { id: "cp-b-01", brand: "Bosch", competitorModel: "KGN56VIF0N No-Frost", category: "buzdolabi", competitorPrice: 32990, arcelikEquivalentId: "buz-01", priceDeltaPercent: 27, positioning: "premium", note: "VitaFresh teknolojisi, premium segment" },
  { id: "cp-b-02", brand: "Bosch", competitorModel: "KAN92VI35O Side-by-Side", category: "buzdolabi", competitorPrice: 54990, arcelikEquivalentId: "buz-07", priceDeltaPercent: 28, positioning: "premium", note: "Premium side-by-side" },
  { id: "cp-b-03", brand: "Bosch", competitorModel: "WAX32M40TR İnverter", category: "camasir", competitorPrice: 27990, arcelikEquivalentId: "cam-03", priceDeltaPercent: 12, positioning: "premium", note: "i-DOS otomatik dozajlama" },
  { id: "cp-b-04", brand: "Bosch", competitorModel: "SMS6ZCI42E Bulaşık", category: "bulasik", competitorPrice: 26990, arcelikEquivalentId: "bul-04", priceDeltaPercent: 23, positioning: "premium", note: "PerfectDry Zeolith" },
  { id: "cp-b-05", brand: "Bosch", competitorModel: "HBG675BS1 Ankastre Fırın", category: "firin", competitorPrice: 24990, arcelikEquivalentId: "fir-04", priceDeltaPercent: 32, positioning: "premium", note: "Serie 8 premium fırın" },
  { id: "cp-b-06", brand: "Bosch", competitorModel: "CLL 9000W Klima 9000", category: "klima", competitorPrice: 24990, arcelikEquivalentId: "kli-01", priceDeltaPercent: 47, positioning: "premium", note: "Climate 9000i premium" },
  { id: "cp-b-07", brand: "Bosch", competitorModel: "WAV28L40TR Premium", category: "camasir", competitorPrice: 32990, arcelikEquivalentId: "cam-03", priceDeltaPercent: 32, positioning: "premium", note: "Serie 8 ActiveOxygen" },
  { id: "cp-b-08", brand: "Bosch", competitorModel: "KGN39VWEQ Ekonomik", category: "buzdolabi", competitorPrice: 24990, arcelikEquivalentId: "buz-02", priceDeltaPercent: 11, positioning: "premium", note: "Orta segment Bosch" },
  { id: "cp-s-01", brand: "Siemens", competitorModel: "KG56NVI30N iQ300", category: "buzdolabi", competitorPrice: 29990, arcelikEquivalentId: "buz-01", priceDeltaPercent: 15, positioning: "premium", note: "hyperFresh teknolojisi" },
  { id: "cp-s-02", brand: "Siemens", competitorModel: "WM14N2X0TR iQ500", category: "camasir", competitorPrice: 25990, arcelikEquivalentId: "cam-03", priceDeltaPercent: 4, positioning: "premium", note: "speedPack, iQdrive" },
  { id: "cp-s-03", brand: "Siemens", competitorModel: "SN65ZX00AT iQ500", category: "bulasik", competitorPrice: 24990, arcelikEquivalentId: "bul-04", priceDeltaPercent: 14, positioning: "premium", note: "Zeolith, glassZone" },
  { id: "cp-s-04", brand: "Siemens", competitorModel: "HB676GBS1 iQ700 Fırın", category: "firin", competitorPrice: 27990, arcelikEquivalentId: "fir-04", priceDeltaPercent: 47, positioning: "premium", note: "cookControl Plus" },
  { id: "cp-s-05", brand: "Siemens", competitorModel: "KA93GAIEP SbS", category: "buzdolabi", competitorPrice: 59990, arcelikEquivalentId: "buz-07", priceDeltaPercent: 40, positioning: "premium", note: "iQ500 Side-by-Side" },
  { id: "cp-p-01", brand: "Profilo", competitorModel: "BD3056LFVN No-Frost", category: "buzdolabi", competitorPrice: 20990, arcelikEquivalentId: "buz-02", priceDeltaPercent: -7, positioning: "mid", note: "Orta segment, Türk tüketicisine tanıdık" },
  { id: "cp-p-02", brand: "Profilo", competitorModel: "BD3076LFVN A++", category: "buzdolabi", competitorPrice: 23990, arcelikEquivalentId: "buz-01", priceDeltaPercent: -8, positioning: "mid", note: "Bosch kalitesi uygun fiyat" },
  { id: "cp-p-03", brand: "Profilo", competitorModel: "CMK1010ETR Çamaşır", category: "camasir", competitorPrice: 16990, arcelikEquivalentId: "cam-01", priceDeltaPercent: -11, positioning: "mid", note: "Orta segment yıkama" },
  { id: "cp-p-04", brand: "Profilo", competitorModel: "BM6280 Bulaşık", category: "bulasik", competitorPrice: 14990, arcelikEquivalentId: "bul-01", priceDeltaPercent: -12, positioning: "mid", note: "Uygun fiyatlı Alman teknolojisi" },
  { id: "cp-p-05", brand: "Profilo", competitorModel: "ANKF 6001 Fırın", category: "firin", competitorPrice: 11490, arcelikEquivalentId: "fir-01", priceDeltaPercent: -12, positioning: "mid", note: "Alman ankastre uygun fiyat" },
  { id: "cp-p-06", brand: "Profilo", competitorModel: "INV 09P Klima", category: "klima", competitorPrice: 17990, arcelikEquivalentId: "kli-01", priceDeltaPercent: 6, positioning: "mid", note: "Bosch teknolojisi orta fiyat" },
  { id: "cp-p-07", brand: "Profilo", competitorModel: "CMK8100 Kurutmalı", category: "camasir", competitorPrice: 26990, arcelikEquivalentId: "cam-07", priceDeltaPercent: -10, positioning: "mid", note: "Kurutmalı segmentte rekabet" },
  { id: "cp-p-08", brand: "Profilo", competitorModel: "BD3044LFVN Ekonomik", category: "buzdolabi", competitorPrice: 16990, arcelikEquivalentId: "buz-04", priceDeltaPercent: -3, positioning: "mid", note: "Ekonomik buzdolabı" },
  { id: "cp-p-09", brand: "Profilo", competitorModel: "BM4280 Ekonomik Bulaşık", category: "bulasik", competitorPrice: 11490, arcelikEquivalentId: "bul-06", priceDeltaPercent: -4, positioning: "mid", note: "Uygun fiyat ekonomik" },
  { id: "cp-p-10", brand: "Profilo", competitorModel: "CMK7100 Slim", category: "camasir", competitorPrice: 13490, arcelikEquivalentId: "cam-08", priceDeltaPercent: -10, positioning: "mid", note: "Dar gövde orta segment" },
  { id: "cp-sa-01", brand: "Samsung", competitorModel: "RT53K6240S8 No-Frost", category: "buzdolabi", competitorPrice: 28990, arcelikEquivalentId: "buz-01", priceDeltaPercent: 12, positioning: "premium", note: "Twin Cooling Plus" },
  { id: "cp-sa-02", brand: "Samsung", competitorModel: "RS68A8842SL SbS", category: "buzdolabi", competitorPrice: 49990, arcelikEquivalentId: "buz-07", priceDeltaPercent: 16, positioning: "premium", note: "SpaceMax, Family Hub" },
  { id: "cp-sa-03", brand: "Samsung", competitorModel: "WW90T534DAE Ecobubble", category: "camasir", competitorPrice: 21990, arcelikEquivalentId: "cam-01", priceDeltaPercent: 16, positioning: "premium", note: "Ecobubble, AI Kontrol" },
  { id: "cp-sa-04", brand: "Samsung", competitorModel: "WD90T534DBE Kurutmalı", category: "camasir", competitorPrice: 32990, arcelikEquivalentId: "cam-07", priceDeltaPercent: 10, positioning: "premium", note: "AddWash, AI Kurutma" },
  { id: "cp-sa-05", brand: "Samsung", competitorModel: "DW60M5070FW Bulaşık", category: "bulasik", competitorPrice: 17990, arcelikEquivalentId: "bul-01", priceDeltaPercent: 6, positioning: "premium", note: "WaterWall teknolojisi" },
  { id: "cp-sa-06", brand: "Samsung", competitorModel: "NV75N5573RS Fırın", category: "firin", competitorPrice: 19990, arcelikEquivalentId: "fir-04", priceDeltaPercent: 5, positioning: "premium", note: "Dual Cook Flex" },
  { id: "cp-sa-07", brand: "Samsung", competitorModel: "AR12TXHQASINEU Klima", category: "klima", competitorPrice: 22990, arcelikEquivalentId: "kli-02", priceDeltaPercent: 5, positioning: "premium", note: "Wind-Free teknolojisi" },
  { id: "cp-sa-08", brand: "Samsung", competitorModel: "UE50AU7100 4K TV", category: "tv-elektronik", competitorPrice: 24990, arcelikEquivalentId: "tv-02", priceDeltaPercent: 9, positioning: "premium", note: "Crystal UHD, Tizen" },
  { id: "cp-sa-09", brand: "Samsung", competitorModel: "QE55Q60B QLED TV", category: "tv-elektronik", competitorPrice: 42990, arcelikEquivalentId: "tv-05", priceDeltaPercent: -4, positioning: "premium", note: "QLED, Quantum HDR" },
  { id: "cp-sa-10", brand: "Samsung", competitorModel: "UE65AU7100 4K TV 65\"", category: "tv-elektronik", competitorPrice: 32990, arcelikEquivalentId: "tv-06", priceDeltaPercent: 10, positioning: "premium", note: "Crystal 4K, büyük ekran" },
  { id: "cp-lg-01", brand: "LG", competitorModel: "GN-C422SLCL No-Frost", category: "buzdolabi", competitorPrice: 27990, arcelikEquivalentId: "buz-01", priceDeltaPercent: 8, positioning: "premium", note: "Linear Cooling, DoorCooling+" },
  { id: "cp-lg-02", brand: "LG", competitorModel: "GC-X257CSHS SbS", category: "buzdolabi", competitorPrice: 52990, arcelikEquivalentId: "buz-07", priceDeltaPercent: 23, positioning: "premium", note: "InstaView, Craft Ice" },
  { id: "cp-lg-03", brand: "LG", competitorModel: "F4V5RYP0W İnverter", category: "camasir", competitorPrice: 20990, arcelikEquivalentId: "cam-01", priceDeltaPercent: 11, positioning: "premium", note: "AI DD, TurboWash 360" },
  { id: "cp-lg-04", brand: "LG", competitorModel: "F4V5RGP0W Kurutmalı", category: "camasir", competitorPrice: 31990, arcelikEquivalentId: "cam-07", priceDeltaPercent: 7, positioning: "premium", note: "AI DD Kurutmalı" },
  { id: "cp-lg-05", brand: "LG", competitorModel: "DF455HMS Bulaşık", category: "bulasik", competitorPrice: 18990, arcelikEquivalentId: "bul-01", priceDeltaPercent: 12, positioning: "premium", note: "QuadWash, TrueSteam" },
  { id: "cp-lg-06", brand: "LG", competitorModel: "50UP75006LF 4K TV", category: "tv-elektronik", competitorPrice: 21990, arcelikEquivalentId: "tv-02", priceDeltaPercent: -4, positioning: "premium", note: "WebOS, Active HDR" },
  { id: "cp-lg-07", brand: "LG", competitorModel: "OLED55C1 OLED TV", category: "tv-elektronik", competitorPrice: 44990, arcelikEquivalentId: "tv-03", priceDeltaPercent: 13, positioning: "premium", note: "OLED evo, α9 işlemci" },
  { id: "cp-lg-08", brand: "LG", competitorModel: "65UP75006 4K TV 65\"", category: "tv-elektronik", competitorPrice: 28990, arcelikEquivalentId: "tv-06", priceDeltaPercent: -3, positioning: "premium", note: "4K IPS, WebOS" },
  { id: "cp-e-01", brand: "Electrolux/AEG", competitorModel: "LRS3DE39U No-Frost", category: "buzdolabi", competitorPrice: 26990, arcelikEquivalentId: "buz-01", priceDeltaPercent: 4, positioning: "premium", note: "TwinTech No-Frost" },
  { id: "cp-e-02", brand: "Electrolux/AEG", competitorModel: "EW6F4R28B İnverter", category: "camasir", competitorPrice: 19990, arcelikEquivalentId: "cam-01", priceDeltaPercent: 5, positioning: "premium", note: "SensiCare, ProSteam" },
  { id: "cp-e-03", brand: "Electrolux/AEG", competitorModel: "ESF9500LOX Bulaşık", category: "bulasik", competitorPrice: 17490, arcelikEquivalentId: "bul-01", priceDeltaPercent: 3, positioning: "premium", note: "AirDry, FlexiSpray" },
  { id: "cp-e-04", brand: "Electrolux/AEG", competitorModel: "EOF5C50BX Ankastre Fırın", category: "firin", competitorPrice: 16990, arcelikEquivalentId: "fir-04", priceDeltaPercent: -11, positioning: "premium", note: "SurroundCook" },
  { id: "cp-e-05", brand: "Electrolux/AEG", competitorModel: "EW7F3R48S Premium Çamaşır", category: "camasir", competitorPrice: 24990, arcelikEquivalentId: "cam-03", priceDeltaPercent: 0, positioning: "premium", note: "SoftPlus, UniversalDose" },
  { id: "cp-e-06", brand: "Electrolux/AEG", competitorModel: "LRS4DE39S Kombi No-Frost", category: "buzdolabi", competitorPrice: 30990, arcelikEquivalentId: "buz-05", priceDeltaPercent: 7, positioning: "premium", note: "CustomFlex, TwinTech" },
  { id: "cp-v-11", brand: "Vestel", competitorModel: "BM 7501 A+++ Bulaşık", category: "bulasik", competitorPrice: 18490, arcelikEquivalentId: "bul-04", priceDeltaPercent: -16, positioning: "value", note: "Premium segmentte fiyat kırıcı" },
  { id: "cp-v-12", brand: "Vestel", competitorModel: "KLM 12001 İnverter Klima 12K", category: "klima", competitorPrice: 18990, arcelikEquivalentId: "kli-02", priceDeltaPercent: -14, positioning: "value", note: "12000 BTU segmentinde agresif fiyat" },
  { id: "cp-r-07", brand: "Regal", competitorModel: "CM 6100 Ekonomik Çamaşır", category: "camasir", competitorPrice: 9490, arcelikEquivalentId: "cam-06", priceDeltaPercent: -32, positioning: "value", note: "En düşük fiyatlı çamaşır makinesi" },
  { id: "cp-r-08", brand: "Regal", competitorModel: "NF 4800 Mini", category: "buzdolabi", competitorPrice: 11990, arcelikEquivalentId: "buz-08", priceDeltaPercent: -23, positioning: "value", note: "Mini buzdolabı giriş seviye" },
  { id: "cp-r-09", brand: "Regal", competitorModel: "BM 5001 Standart Bulaşık", category: "bulasik", competitorPrice: 11490, arcelikEquivalentId: "bul-02", priceDeltaPercent: -21, positioning: "value", note: "Standart segment en düşük fiyat" },
  { id: "cp-b-09", brand: "Bosch", competitorModel: "SMS46GI55E Serie 4 Bulaşık", category: "bulasik", competitorPrice: 21990, arcelikEquivalentId: "bul-01", priceDeltaPercent: 29, positioning: "premium", note: "Serie 4 orta-premium bulaşık" },
  { id: "cp-b-10", brand: "Bosch", competitorModel: "CLL 2000W Klima 12K", category: "klima", competitorPrice: 28990, arcelikEquivalentId: "kli-02", priceDeltaPercent: 32, positioning: "premium", note: "Climate 2000i 12000 BTU" },
  { id: "cp-s-06", brand: "Siemens", competitorModel: "WG54B2030TR iQ700 Çamaşır", category: "camasir", competitorPrice: 29990, arcelikEquivalentId: "cam-03", priceDeltaPercent: 20, positioning: "premium", note: "iSensoric, antiStain" },
  { id: "cp-s-07", brand: "Siemens", competitorModel: "SN65EX56CE iQ500 Bulaşık", category: "bulasik", competitorPrice: 27990, arcelikEquivalentId: "bul-04", priceDeltaPercent: 27, positioning: "premium", note: "emotionLight, Zeolith kurutma" },
  { id: "cp-s-08", brand: "Siemens", competitorModel: "KD56NXIF0N iQ300 No-Frost", category: "buzdolabi", competitorPrice: 27990, arcelikEquivalentId: "buz-02", priceDeltaPercent: 24, positioning: "premium", note: "noFrost, superFreezing" },
  { id: "cp-sa-11", brand: "Samsung", competitorModel: "WW80T3040BW Ekonomik Çamaşır", category: "camasir", competitorPrice: 15990, arcelikEquivalentId: "cam-02", priceDeltaPercent: -3, positioning: "premium", note: "Digital Inverter, Hygiene Steam" },
  { id: "cp-sa-12", brand: "Samsung", competitorModel: "DW60M6050FW Bulaşık Premium", category: "bulasik", competitorPrice: 22990, arcelikEquivalentId: "bul-04", priceDeltaPercent: 5, positioning: "premium", note: "WaterWall, Zone Booster" },
  { id: "cp-lg-09", brand: "LG", competitorModel: "GN-B422SQCL Ekonomik No-Frost", category: "buzdolabi", competitorPrice: 22990, arcelikEquivalentId: "buz-02", priceDeltaPercent: 2, positioning: "premium", note: "Smart Inverter, Multi Air Flow" },
  { id: "cp-lg-10", brand: "LG", competitorModel: "F2V5HS0W Slim Çamaşır", category: "camasir", competitorPrice: 16990, arcelikEquivalentId: "cam-08", priceDeltaPercent: 13, positioning: "premium", note: "Slim body, AI DD, Steam" },
  { id: "cp-e-07", brand: "Electrolux/AEG", competitorModel: "ESF5545LOX Premium Bulaşık", category: "bulasik", competitorPrice: 21990, arcelikEquivalentId: "bul-04", priceDeltaPercent: 0, positioning: "premium", note: "RealLife, SatelliteClean" },
  { id: "cp-e-08", brand: "Electrolux/AEG", competitorModel: "EW8F2966MA Kurutmalı Çamaşır", category: "camasir", competitorPrice: 28990, arcelikEquivalentId: "cam-07", priceDeltaPercent: -3, positioning: "premium", note: "DualCare, UltraWash" },
  { id: "cp-p-11", brand: "Profilo", competitorModel: "BD4056LFVN Premium No-Frost", category: "buzdolabi", competitorPrice: 27990, arcelikEquivalentId: "buz-01", priceDeltaPercent: 8, positioning: "mid", note: "VitaFresh, NoFrost" },
  { id: "cp-sa-13", brand: "Samsung", competitorModel: "AR18TXHQASINEU Klima 18K", category: "klima", competitorPrice: 34990, arcelikEquivalentId: "kli-03", priceDeltaPercent: 21, positioning: "premium", note: "Wind-Free 18000 BTU" },
  { id: "cp-lg-11", brand: "LG", competitorModel: "S3WQ12JA0A Klima 12K", category: "klima", competitorPrice: 23990, arcelikEquivalentId: "kli-02", priceDeltaPercent: 9, positioning: "premium", note: "Dual Inverter, ThinQ" },
];

export const cities: CityData[] = [
  { id: "istanbul", name: "İstanbul", populationTier: "tier-1", marketSharePercent: 38.5, avgPriceIndex: 1.05, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Bosch", strength: 8 }, { brand: "Profilo", strength: 7 }, { brand: "Samsung", strength: 7 }], seasonalPattern: "Yıl boyunca yüksek talep, düğün sezonu Haz–Eyl pik", dealerCount: 320 },
  { id: "ankara", name: "Ankara", populationTier: "tier-1", marketSharePercent: 41.2, avgPriceIndex: 0.98, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Bosch", strength: 7 }, { brand: "Profilo", strength: 8 }, { brand: "Samsung", strength: 5 }], seasonalPattern: "Kamu sektörü alımları Q1/Q3, kış klima düşük", dealerCount: 185 },
  { id: "izmir", name: "İzmir", populationTier: "tier-1", marketSharePercent: 36.8, avgPriceIndex: 1.02, competitorStrength: [{ brand: "Vestel", strength: 8 }, { brand: "Bosch", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 6 }], seasonalPattern: "Yaz turizm etkisi, klima Mayıs–Eylül pik", dealerCount: 165 },
  { id: "bursa", name: "Bursa", populationTier: "tier-1", marketSharePercent: 42.5, avgPriceIndex: 0.97, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Profilo", strength: 7 }, { brand: "Samsung", strength: 4 }, { brand: "LG", strength: 4 }], seasonalPattern: "Sanayi kenti, düğün sezonu güçlü", dealerCount: 110 },
  { id: "antalya", name: "Antalya", populationTier: "tier-1", marketSharePercent: 35.2, avgPriceIndex: 1.08, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Samsung", strength: 7 }, { brand: "Bosch", strength: 6 }, { brand: "LG", strength: 5 }], seasonalPattern: "Turizm sezonu klima pik, otel yenileme Q1", dealerCount: 95 },
  { id: "adana", name: "Adana", populationTier: "tier-2", marketSharePercent: 40.1, avgPriceIndex: 0.94, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Regal", strength: 5 }, { brand: "Samsung", strength: 4 }], seasonalPattern: "Klima yıl boyunca güçlü, bayram kampanyaları etkili", dealerCount: 75 },
  { id: "konya", name: "Konya", populationTier: "tier-2", marketSharePercent: 44.8, avgPriceIndex: 0.92, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 6 }, { brand: "Samsung", strength: 3 }], seasonalPattern: "Tarım sezonu sonrası alım, Ramazan güçlü", dealerCount: 85 },
  { id: "gaziantep", name: "Gaziantep", populationTier: "tier-2", marketSharePercent: 39.5, avgPriceIndex: 0.95, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 5 }, { brand: "Samsung", strength: 4 }], seasonalPattern: "Düğün sezonu çok güçlü, Ramazan pik", dealerCount: 70 },
  { id: "mersin", name: "Mersin", populationTier: "tier-2", marketSharePercent: 37.8, avgPriceIndex: 0.96, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 5 }, { brand: "LG", strength: 4 }], seasonalPattern: "Liman şehri, klima Mayıs–Ekim güçlü", dealerCount: 55 },
  { id: "kayseri", name: "Kayseri", populationTier: "tier-2", marketSharePercent: 43.2, avgPriceIndex: 0.91, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 4 }], seasonalPattern: "Ticaret şehri, yıl boyunca stabil talep", dealerCount: 60 },
  { id: "diyarbakir", name: "Diyarbakır", populationTier: "tier-2", marketSharePercent: 41.5, avgPriceIndex: 0.88, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Regal", strength: 7 }, { brand: "Profilo", strength: 4 }, { brand: "Samsung", strength: 3 }], seasonalPattern: "Düğün sezonu çok güçlü Haz–Eyl, kış ısıtma talebi", dealerCount: 50 },
  { id: "samsun", name: "Samsun", populationTier: "tier-2", marketSharePercent: 40.8, avgPriceIndex: 0.93, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 4 }], seasonalPattern: "Fındık hasadı sonrası alım Eyl–Kas", dealerCount: 45 },
  { id: "trabzon", name: "Trabzon", populationTier: "tier-3", marketSharePercent: 42.0, avgPriceIndex: 0.90, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 4 }, { brand: "Samsung", strength: 3 }], seasonalPattern: "Çay hasadı sonrası alım, bayram pik", dealerCount: 35 },
  { id: "eskisehir", name: "Eskişehir", populationTier: "tier-3", marketSharePercent: 39.5, avgPriceIndex: 0.96, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Bosch", strength: 6 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 5 }], seasonalPattern: "Üniversite kenti, eylül yeni dönem talebi", dealerCount: 40 },
  { id: "denizli", name: "Denizli", populationTier: "tier-3", marketSharePercent: 43.5, avgPriceIndex: 0.94, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 4 }], seasonalPattern: "Tekstil şehri, yıl boyunca stabil", dealerCount: 38 },
  { id: "malatya", name: "Malatya", populationTier: "tier-3", marketSharePercent: 45.0, avgPriceIndex: 0.87, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 4 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Kayısı hasadı sonrası Ağu–Eki alım artışı", dealerCount: 30 },
  { id: "erzurum", name: "Erzurum", populationTier: "tier-3", marketSharePercent: 44.2, avgPriceIndex: 0.85, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Regal", strength: 7 }, { brand: "Profilo", strength: 3 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Kış uzun, klima talebi düşük, beyaz eşya bayram pik", dealerCount: 25 },
  { id: "van", name: "Van", populationTier: "tier-3", marketSharePercent: 43.8, avgPriceIndex: 0.83, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Regal", strength: 8 }, { brand: "Profilo", strength: 3 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Düğün sezonu Haz–Eyl güçlü, fiyat hassasiyeti yüksek", dealerCount: 22 },
  { id: "manisa", name: "Manisa", populationTier: "tier-3", marketSharePercent: 37.2, avgPriceIndex: 0.95, competitorStrength: [{ brand: "Vestel", strength: 9 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 4 }, { brand: "Bosch", strength: 4 }], seasonalPattern: "Vestel fabrikası şehri — Vestel burada çok güçlü", dealerCount: 32 },
  { id: "tekirdag", name: "Tekirdağ", populationTier: "tier-3", marketSharePercent: 40.5, avgPriceIndex: 0.97, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Bosch", strength: 5 }, { brand: "Samsung", strength: 4 }], seasonalPattern: "Sanayi bölgesi, yıl boyunca stabil talep", dealerCount: 28 },
];

export const campaigns: CampaignTemplate[] = [
  {
    id: "ramazan", name: "Ramazan Bayramı Kampanyası", targetSegment: "Bayram öncesi ev yenileyen aileler",
    eligibleCategories: ["buzdolabi", "camasir", "bulasik"], promotionType: "indirim + taksit",
    discountDetail: "%20 indirim + 12 ay taksit",
    headline: "Bayramda Evini Yenile, Arçelik İle Güle Güle Kullan",
    bodyCopy: "Bu Ramazan Bayramı'nda evinizi yenileyin. Arçelik'in seçili beyaz eşyalarında %20'ye varan indirim ve 12 aya kadar taksit fırsatı sizi bekliyor. Bayram sofralarınız yeni buzdolabınızla, temiz çamaşırlarınız yeni makinenizle buluşsun.",
    messagingTone: "Sıcak, aile odaklı, bayram kutlama havası",
    targetCities: ["istanbul", "ankara", "izmir", "bursa", "antalya", "konya", "gaziantep", "adana"],
    durationPattern: "Bayram öncesi 3 hafta",
    projectedImpact: { marketShareLift: "+1.2%", revenueDelta: "+₺45M", marginEffect: "-0.8%" },
    bannerDescription: "Beyaz arka planda Arçelik buzdolabı ve çamaşır makinesi, bayram teması, %20 indirim rozeti",
    dealerPosMessaging: "Bayram Kampanyası — Seçili beyaz eşyalarda %20 indirim + 12 ay taksit. Müşterilerinize bu fırsatı sunun.",
    dealerSmsNotification: "Sayın Bayimiz, Ramazan Bayramı kampanyamız başladı. %20 indirim + 12 ay taksit. Detaylar bayi portalında.",
  },
  {
    id: "dugun-sezonu", name: "Yaz Düğün Sezonu — Çeyiz Paketi", targetSegment: "Evlenmek üzere olan çiftler ve aileleri",
    eligibleCategories: ["buzdolabi", "camasir", "bulasik", "firin", "kucuk-ev"], promotionType: "paket indirim",
    discountDetail: "5 parça çeyiz paketi %25 indirim + 18 ay taksit",
    headline: "Yeni Yuvanıza Arçelik İle Başlayın — Çeyiz Paketi Kampanyası",
    bodyCopy: "Hayatınızın en önemli adımında yanınızdayız. Buzdolabı, çamaşır makinesi, bulaşık makinesi, fırın ve küçük ev aletlerinden oluşan çeyiz paketlerimizde %25'e varan indirim. 18 aya kadar taksit ile yeni evinizin tüm ihtiyaçlarını karşılayın.",
    messagingTone: "Romantik, umut dolu, yeni başlangıç",
    targetCities: ["istanbul", "ankara", "izmir", "gaziantep", "diyarbakir", "konya", "bursa", "adana"],
    durationPattern: "Haziran–Eylül (4 ay)",
    projectedImpact: { marketShareLift: "+1.8%", revenueDelta: "+₺78M", marginEffect: "-1.2%" },
    bannerDescription: "Genç çift mutfakta, Arçelik beyaz eşya paketi, kalp ikonu, %25 rozet",
    dealerPosMessaging: "Çeyiz Paketi Kampanyası — 5 ürün al %25 indirim. Düğün sezonunda satışlarınızı artırın.",
    dealerSmsNotification: "Yaz düğün sezonu kampanyası başladı! Çeyiz paketlerinde %25 indirim + 18 ay taksit. Hemen müşterilerinize ulaşın.",
  },
  {
    id: "okula-donus", name: "Okula Dönüş Kampanyası", targetSegment: "Üniversiteye başlayan öğrenciler ve aileleri",
    eligibleCategories: ["kucuk-ev", "klima", "tv-elektronik"], promotionType: "indirim",
    discountDetail: "%15 indirim + hediye ütü",
    headline: "Okula Dönüşte Arçelik Yanınızda — Öğrenci Paketi",
    bodyCopy: "Yeni eğitim dönemi için evinizi hazırlayın. Küçük ev aletleri, klima ve TV'lerde %15'e varan indirim. Üstelik seçili ürünlerde hediye ütü kampanyası.",
    messagingTone: "Enerjik, genç, pratik",
    targetCities: ["istanbul", "ankara", "izmir", "eskisehir", "antalya", "bursa"],
    durationPattern: "Ağustos sonları – Eylül ortası (3 hafta)",
    projectedImpact: { marketShareLift: "+0.6%", revenueDelta: "+₺18M", marginEffect: "-0.5%" },
    bannerDescription: "Öğrenci evi, mini buzdolabı ve çay makinesi, kitaplar, %15 rozet",
    dealerPosMessaging: "Okula Dönüş — Küçük ev aletleri ve klimada %15 indirim. Öğrenci bölgelerindeki bayiler için özel fırsat.",
    dealerSmsNotification: "Okula dönüş kampanyası başladı. Küçük ev aletlerinde %15 indirim + hediye ütü. Üniversite bölgelerinde öne çıkarın.",
  },
  {
    id: "yilbasi", name: "Yılbaşı İndirimi", targetSegment: "Premium segment tüketiciler, hediye alışverişi",
    eligibleCategories: ["tv-elektronik", "kucuk-ev", "buzdolabi"], promotionType: "indirim + hediye",
    discountDetail: "%10 indirim + ücretsiz kurulum + hediye paketleme",
    headline: "Yeni Yıla Yeni Teknoloji İle Girin — Arçelik Yılbaşı Fırsatları",
    bodyCopy: "Sevdiklerinize en güzel hediyeyi verin. Premium TV'ler, espresso makineleri ve seçili beyaz eşyalarda %10 indirim. Ücretsiz kurulum ve özel hediye paketleme hizmeti.",
    messagingTone: "Şık, premium, hediye odaklı",
    targetCities: ["istanbul", "ankara", "izmir", "antalya", "bursa"],
    durationPattern: "Aralık 15 – Ocak 5 (3 hafta)",
    projectedImpact: { marketShareLift: "+0.4%", revenueDelta: "+₺22M", marginEffect: "-0.3%" },
    bannerDescription: "Yılbaşı ağacı, premium TV ve espresso makinesi, hediye paketi, %10 rozet",
    dealerPosMessaging: "Yılbaşı Kampanyası — Premium ürünlerde %10 indirim + ücretsiz kurulum. Hediye sezonu satışlarınızı artırın.",
    dealerSmsNotification: "Yılbaşı kampanyası aktif! TV ve küçük ev aletlerinde %10 indirim + ücretsiz kurulum. Hediye paketleme sunun.",
  },
  {
    id: "eski-yeni", name: "Eski-Yeni Değişim Kampanyası", targetSegment: "Eski cihazını yenilemek isteyen ev sahipleri",
    eligibleCategories: ["buzdolabi", "camasir", "bulasik", "firin", "klima"], promotionType: "trade-in",
    discountDetail: "Eski cihazınızı getirin, yeni ürünlerde ₺2.000–₺5.000 indirim",
    headline: "Eskiyi Getir, Yeniyi Götür — Arçelik Değişim Programı",
    bodyCopy: "Eski beyaz eşyanızın markası ve durumu fark etmez. Arçelik bayinize getirin, yeni Arçelik ürünlerinde ₺2.000 ile ₺5.000 arasında ek indirim kazanın. Eski cihazınız çevre dostu yöntemlerle geri dönüştürülür.",
    messagingTone: "Pratik, güvenilir, çevreci",
    targetCities: ["istanbul", "ankara", "izmir", "bursa", "adana", "konya", "gaziantep", "kayseri", "antalya", "mersin"],
    durationPattern: "Yıl boyunca devam eden kampanya",
    projectedImpact: { marketShareLift: "+0.8%", revenueDelta: "+₺35M", marginEffect: "+0.2%" },
    bannerDescription: "Eski buzdolabı → yeni Arçelik buzdolabı geçişi, geri dönüşüm ikonu, ₺5.000'e kadar rozet",
    dealerPosMessaging: "Değişim Programı — Eski cihaz getiren müşteriye ₺2K–₺5K ek indirim. Her marka kabul edilir.",
    dealerSmsNotification: "Eski-yeni değişim kampanyası sürekli aktif. Eski cihaz getiren her müşteriye ₺2K–₺5K ek indirim sunabilirsiniz.",
  },
  {
    id: "taksit", name: "Taksit Kampanyası — Banka İş Birliği", targetSegment: "Taksit arayan orta gelir grubu",
    eligibleCategories: ["buzdolabi", "camasir", "bulasik", "firin", "klima", "tv-elektronik"], promotionType: "taksit",
    discountDetail: "Tüm ürünlerde 24 aya kadar faizsiz taksit (Ziraat, Halkbank, Vakıfbank)",
    headline: "Arçelik'te 24 Aya Kadar Faizsiz Taksit — Devlet Bankaları İle",
    bodyCopy: "Ziraat Bankası, Halkbank ve Vakıfbank kredi kartlarınıza 24 aya kadar faizsiz taksit fırsatı. Tüm Arçelik ve Beko ürünlerinde geçerli. Hayalinizdeki ev aletine şimdi sahip olun, ödemeyi aylara yayın.",
    messagingTone: "Güvenilir, devlet güvencesi, ekonomik",
    targetCities: ["istanbul", "ankara", "izmir", "bursa", "adana", "konya", "kayseri", "samsun", "trabzon", "erzurum", "van", "diyarbakir", "gaziantep", "malatya", "denizli"],
    durationPattern: "Banka anlaşma dönemi (genellikle Q2–Q3)",
    projectedImpact: { marketShareLift: "+1.5%", revenueDelta: "+₺62M", marginEffect: "-0.4%" },
    bannerDescription: "Arçelik ürünleri, banka logoları, 24 ay taksit rozeti, güven ikonu",
    dealerPosMessaging: "24 Ay Faizsiz Taksit — Ziraat, Halkbank, Vakıfbank. Tüm ürünlerde geçerli. POS ayarlarınızı kontrol edin.",
    dealerSmsNotification: "Banka taksit kampanyası başladı! 24 aya kadar faizsiz taksit Ziraat/Halk/Vakıf kartlarına. POS'unuzu güncelleyin.",
  },
  {
    id: "enerji-verimlilik", name: "Enerji Verimliliği Kampanyası", targetSegment: "Enerji tasarrufu odaklı bilinçli tüketiciler",
    eligibleCategories: ["buzdolabi", "camasir", "bulasik", "klima"], promotionType: "indirim + ÖTV",
    discountDetail: "A+++ ürünlerde %12 ek indirim + ÖTV avantajı",
    headline: "Enerji Tasarrufu İle Hem Cebiniz Hem Dünya Kazansın",
    bodyCopy: "A+++ enerji sınıfı Arçelik ürünlerinde %12 ek indirim. Üstelik ÖTV avantajından da yararlanın. Yıllık enerji faturanızda ₺3.000'e kadar tasarruf, dünya için daha az karbon ayak izi.",
    messagingTone: "Bilinçli, modern, çevreci",
    targetCities: ["istanbul", "ankara", "izmir", "bursa", "antalya", "eskisehir"],
    durationPattern: "Enerji verimliliği haftası + devam (4 hafta)",
    projectedImpact: { marketShareLift: "+0.5%", revenueDelta: "+₺15M", marginEffect: "+0.3%" },
    bannerDescription: "Yeşil yaprak, A+++ etiketi, Arçelik buzdolabı, enerji tasarruf ikonu, %12 rozet",
    dealerPosMessaging: "A+++ Ürünlerde %12 Ek İndirim — ÖTV avantajıyla birleştiğinde müşteriye büyük fırsat. Premium ürün satışı artırın.",
    dealerSmsNotification: "Enerji verimliliği kampanyası! A+++ ürünlerde %12 ek indirim + ÖTV avantajı. Çevreci müşterilerinize ulaşın.",
  },
  {
    id: "bayi-ozel", name: "Bayi Özel Bölgesel Kampanya", targetSegment: "Bölgesel rekabet yoğun şehirlerdeki müşteriler",
    eligibleCategories: ["buzdolabi", "camasir", "bulasik"], promotionType: "bölgesel indirim + hediye",
    discountDetail: "%18 bölgesel indirim + hediye set üstü ocak",
    headline: "Bölgenize Özel Arçelik Fırsatı — Sadece Seçili Bayilerde",
    bodyCopy: "Vestel'in güçlü olduğu şehirlerde özel Arçelik fırsatları. Seçili beyaz eşyalarda %18 bölgesel indirim ve ücretsiz set üstü ocak hediyesi. Sadece katılımcı bayilerde, stokla sınırlı.",
    messagingTone: "Acil, fırsat, yerel",
    targetCities: ["manisa", "samsun", "trabzon", "diyarbakir", "van", "erzurum", "malatya"],
    durationPattern: "2 hafta (rakip kampanya tepkisi)",
    projectedImpact: { marketShareLift: "+2.1%", revenueDelta: "+₺12M", marginEffect: "-1.5%" },
    bannerDescription: "Bölgesel harita vurgusu, Arçelik beyaz eşya, %18 rozet, 'Sadece Bu Bölgede' etiket",
    dealerPosMessaging: "Bölgesel Özel Kampanya — %18 indirim + hediye ocak. Vestel'e karşı pazar payı artırma hedefli. Ürünleri öne çıkarın.",
    dealerSmsNotification: "ACİL: Bölgesel kampanya başladı! %18 indirim + hediye ocak. 2 hafta sürecek. Vitrin ve stoklarınızı hazırlayın.",
  },
];

export const dealers: DealerProfile[] = [
  { id: "d-01", storeName: "Yılmaz Elektronik", city: "istanbul", district: "Kadıköy", tier: "gold", complianceScore: 92, monthlySalesTarget: 85, currentProgress: 68, earnedCommission: 24500, productMix: { buzdolabi: 25, camasir: 22, bulasik: 18, firin: 12, klima: 8, "kucuk-ev": 10, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 24, camasir: 18, bulasik: 15, firin: 12, klima: 8, "kucuk-ev": 45, "tv-elektronik": 10 }, pendingOrders: 3, lastOrderDate: "2026-04-28" },
  { id: "d-02", storeName: "Anadolu Beyaz Eşya", city: "ankara", district: "Çankaya", tier: "gold", complianceScore: 95, monthlySalesTarget: 70, currentProgress: 62, earnedCommission: 21800, productMix: { buzdolabi: 28, camasir: 24, bulasik: 20, firin: 10, klima: 5, "kucuk-ev": 8, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 20, camasir: 16, bulasik: 14, firin: 10, klima: 5, "kucuk-ev": 38, "tv-elektronik": 8 }, pendingOrders: 2, lastOrderDate: "2026-04-30" },
  { id: "d-03", storeName: "Ege Teknik", city: "izmir", district: "Bornova", tier: "gold", complianceScore: 88, monthlySalesTarget: 65, currentProgress: 51, earnedCommission: 18200, productMix: { buzdolabi: 22, camasir: 20, bulasik: 18, firin: 14, klima: 12, "kucuk-ev": 9, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 18, camasir: 15, bulasik: 12, firin: 10, klima: 14, "kucuk-ev": 35, "tv-elektronik": 7 }, pendingOrders: 4, lastOrderDate: "2026-04-25" },
  { id: "d-04", storeName: "Güney Elektronik", city: "adana", district: "Seyhan", tier: "silver", complianceScore: 78, monthlySalesTarget: 50, currentProgress: 38, earnedCommission: 12400, productMix: { buzdolabi: 26, camasir: 22, bulasik: 16, firin: 12, klima: 14, "kucuk-ev": 7, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 12, camasir: 10, bulasik: 8, firin: 6, klima: 15, "kucuk-ev": 28, "tv-elektronik": 5 }, pendingOrders: 5, lastOrderDate: "2026-04-22" },
  { id: "d-05", storeName: "Merkez Beyaz Eşya", city: "konya", district: "Selçuklu", tier: "silver", complianceScore: 82, monthlySalesTarget: 55, currentProgress: 42, earnedCommission: 14800, productMix: { buzdolabi: 30, camasir: 25, bulasik: 18, firin: 10, klima: 5, "kucuk-ev": 8, "tv-elektronik": 4 }, stockLevels: { buzdolabi: 16, camasir: 12, bulasik: 10, firin: 8, klima: 4, "kucuk-ev": 30, "tv-elektronik": 6 }, pendingOrders: 3, lastOrderDate: "2026-04-27" },
  { id: "d-06", storeName: "Doğu Teknik Ticaret", city: "gaziantep", district: "Şahinbey", tier: "silver", complianceScore: 75, monthlySalesTarget: 45, currentProgress: 31, earnedCommission: 10200, productMix: { buzdolabi: 28, camasir: 23, bulasik: 17, firin: 12, klima: 10, "kucuk-ev": 7, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 10, camasir: 8, bulasik: 7, firin: 5, klima: 8, "kucuk-ev": 22, "tv-elektronik": 4 }, pendingOrders: 6, lastOrderDate: "2026-04-20" },
  { id: "d-07", storeName: "Akdeniz Ev Aletleri", city: "antalya", district: "Muratpaşa", tier: "gold", complianceScore: 90, monthlySalesTarget: 60, currentProgress: 52, earnedCommission: 19600, productMix: { buzdolabi: 20, camasir: 18, bulasik: 15, firin: 10, klima: 22, "kucuk-ev": 10, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 15, camasir: 12, bulasik: 10, firin: 8, klima: 20, "kucuk-ev": 32, "tv-elektronik": 6 }, pendingOrders: 2, lastOrderDate: "2026-04-29" },
  { id: "d-08", storeName: "Bursa Beyaz Eşya Merkezi", city: "bursa", district: "Nilüfer", tier: "silver", complianceScore: 80, monthlySalesTarget: 55, currentProgress: 40, earnedCommission: 13800, productMix: { buzdolabi: 27, camasir: 24, bulasik: 19, firin: 11, klima: 7, "kucuk-ev": 8, "tv-elektronik": 4 }, stockLevels: { buzdolabi: 14, camasir: 11, bulasik: 9, firin: 7, klima: 6, "kucuk-ev": 26, "tv-elektronik": 5 }, pendingOrders: 4, lastOrderDate: "2026-04-24" },
  { id: "d-09", storeName: "İstanbul Avrupa Elektronik", city: "istanbul", district: "Bağcılar", tier: "silver", complianceScore: 76, monthlySalesTarget: 75, currentProgress: 48, earnedCommission: 15600, productMix: { buzdolabi: 24, camasir: 21, bulasik: 17, firin: 13, klima: 9, "kucuk-ev": 11, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 18, camasir: 14, bulasik: 12, firin: 9, klima: 7, "kucuk-ev": 40, "tv-elektronik": 8 }, pendingOrders: 5, lastOrderDate: "2026-04-26" },
  { id: "d-10", storeName: "Karadeniz Beyaz Eşya", city: "samsun", district: "Atakum", tier: "bronze", complianceScore: 68, monthlySalesTarget: 35, currentProgress: 22, earnedCommission: 6800, productMix: { buzdolabi: 30, camasir: 25, bulasik: 18, firin: 12, klima: 4, "kucuk-ev": 8, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 8, camasir: 6, bulasik: 5, firin: 4, klima: 2, "kucuk-ev": 18, "tv-elektronik": 3 }, pendingOrders: 2, lastOrderDate: "2026-04-18" },
  { id: "d-11", storeName: "Diyarbakır Ev Aletleri", city: "diyarbakir", district: "Kayapınar", tier: "bronze", complianceScore: 65, monthlySalesTarget: 40, currentProgress: 24, earnedCommission: 7200, productMix: { buzdolabi: 32, camasir: 26, bulasik: 16, firin: 10, klima: 8, "kucuk-ev": 5, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 7, camasir: 5, bulasik: 4, firin: 3, klima: 5, "kucuk-ev": 15, "tv-elektronik": 2 }, pendingOrders: 7, lastOrderDate: "2026-04-15" },
  { id: "d-12", storeName: "Kayseri Teknik", city: "kayseri", district: "Melikgazi", tier: "silver", complianceScore: 83, monthlySalesTarget: 45, currentProgress: 37, earnedCommission: 12800, productMix: { buzdolabi: 28, camasir: 24, bulasik: 19, firin: 11, klima: 6, "kucuk-ev": 8, "tv-elektronik": 4 }, stockLevels: { buzdolabi: 12, camasir: 10, bulasik: 8, firin: 6, klima: 4, "kucuk-ev": 25, "tv-elektronik": 4 }, pendingOrders: 3, lastOrderDate: "2026-04-27" },
  { id: "d-13", storeName: "Van Elektronik Pazarı", city: "van", district: "İpekyolu", tier: "bronze", complianceScore: 62, monthlySalesTarget: 30, currentProgress: 18, earnedCommission: 5400, productMix: { buzdolabi: 35, camasir: 28, bulasik: 15, firin: 10, klima: 3, "kucuk-ev": 6, "tv-elektronik": 3 }, stockLevels: { buzdolabi: 5, camasir: 4, bulasik: 3, firin: 2, klima: 1, "kucuk-ev": 12, "tv-elektronik": 2 }, pendingOrders: 8, lastOrderDate: "2026-04-12" },
  { id: "d-14", storeName: "Eskişehir Arçelik Mağazası", city: "eskisehir", district: "Odunpazarı", tier: "silver", complianceScore: 85, monthlySalesTarget: 40, currentProgress: 33, earnedCommission: 11200, productMix: { buzdolabi: 22, camasir: 20, bulasik: 17, firin: 12, klima: 10, "kucuk-ev": 14, "tv-elektronik": 5 }, stockLevels: { buzdolabi: 10, camasir: 8, bulasik: 7, firin: 5, klima: 6, "kucuk-ev": 30, "tv-elektronik": 5 }, pendingOrders: 2, lastOrderDate: "2026-04-29" },
  { id: "d-15", storeName: "Trabzon Beyaz Eşya", city: "trabzon", district: "Ortahisar", tier: "bronze", complianceScore: 70, monthlySalesTarget: 30, currentProgress: 20, earnedCommission: 6200, productMix: { buzdolabi: 30, camasir: 25, bulasik: 18, firin: 12, klima: 3, "kucuk-ev": 8, "tv-elektronik": 4 }, stockLevels: { buzdolabi: 6, camasir: 5, bulasik: 4, firin: 3, klima: 1, "kucuk-ev": 16, "tv-elektronik": 3 }, pendingOrders: 4, lastOrderDate: "2026-04-19" },
];

export const kpiBenchmarks: KpiBenchmark[] = [
  { id: "national-market-share", label: "Ulusal Pazar Payı (Toplam)", value: "%39.8", target: "%42.0" },
  { id: "buzdolabi-share", label: "Buzdolabı Pazar Payı", value: "%41.2", target: "%43.0" },
  { id: "camasir-share", label: "Çamaşır Makinesi Pazar Payı", value: "%38.5", target: "%41.0" },
  { id: "avg-margin", label: "Ortalama Brüt Marj", value: "%21.8", target: "%22.5" },
  { id: "dealer-compliance", label: "Bayi Uyum Oranı", value: "%79.4", target: "%85.0" },
  { id: "campaign-roi", label: "Kampanya ROI (Ortalama)", value: "3.2x", target: "4.0x" },
  { id: "competitor-price-index", label: "Rakip Fiyat Endeksi", value: "1.00", target: "0.95–1.05" },
  { id: "dealer-satisfaction", label: "Bayi Memnuniyet Skoru", value: "7.4/10", target: "8.0/10" },
];

export const promotionalCalendar: CalendarEntry[] = [
  { id: "arc-ramazan", brand: "Arçelik", campaignName: "Ramazan Bayramı Kampanyası", startMonth: 3, endMonth: 4, categories: ["buzdolabi", "camasir", "bulasik"], type: "confirmed" },
  { id: "arc-dugun", brand: "Arçelik", campaignName: "Çeyiz Paketi Kampanyası", startMonth: 6, endMonth: 9, categories: ["buzdolabi", "camasir", "bulasik", "firin"], type: "confirmed" },
  { id: "arc-okul", brand: "Arçelik", campaignName: "Okula Dönüş", startMonth: 8, endMonth: 9, categories: ["kucuk-ev", "klima", "tv-elektronik"], type: "confirmed" },
  { id: "arc-yilbasi", brand: "Arçelik", campaignName: "Yılbaşı İndirimi", startMonth: 12, endMonth: 1, categories: ["tv-elektronik", "kucuk-ev"], type: "confirmed" },
  { id: "arc-taksit", brand: "Arçelik", campaignName: "Banka Taksit Kampanyası", startMonth: 4, endMonth: 7, categories: ["buzdolabi", "camasir", "bulasik", "firin", "klima", "tv-elektronik"], type: "confirmed" },
  { id: "ves-bahar", brand: "Vestel", campaignName: "Bahar Kampanyası (Tahmini)", startMonth: 3, endMonth: 5, categories: ["buzdolabi", "camasir"], type: "predicted" },
  { id: "ves-yaz", brand: "Vestel", campaignName: "Yaz Fırsat Günleri (Tahmini)", startMonth: 6, endMonth: 7, categories: ["klima", "buzdolabi"], type: "predicted" },
  { id: "ves-kasim", brand: "Vestel", campaignName: "Kasım İndirimleri (Tahmini)", startMonth: 11, endMonth: 11, categories: ["tv-elektronik", "kucuk-ev", "buzdolabi"], type: "predicted" },
  { id: "bsh-bahar", brand: "Bosch/Profilo", campaignName: "İlkbahar Yenileme (Tahmini)", startMonth: 4, endMonth: 5, categories: ["buzdolabi", "bulasik", "firin"], type: "predicted" },
  { id: "bsh-sonbahar", brand: "Bosch/Profilo", campaignName: "Sonbahar Premium (Tahmini)", startMonth: 9, endMonth: 10, categories: ["buzdolabi", "camasir", "bulasik"], type: "predicted" },
  { id: "sam-tech", brand: "Samsung", campaignName: "Galaxy + Ev Aletleri (Tahmini)", startMonth: 2, endMonth: 3, categories: ["tv-elektronik", "buzdolabi", "camasir"], type: "predicted" },
  { id: "sam-bf", brand: "Samsung", campaignName: "Black Friday (Tahmini)", startMonth: 11, endMonth: 11, categories: ["tv-elektronik", "buzdolabi"], type: "predicted" },
  { id: "lg-yaz", brand: "LG", campaignName: "LG Yaz Kampanyası (Tahmini)", startMonth: 5, endMonth: 7, categories: ["klima", "tv-elektronik", "buzdolabi"], type: "predicted" },
  { id: "lg-bf", brand: "LG", campaignName: "LG Black Friday (Tahmini)", startMonth: 11, endMonth: 11, categories: ["tv-elektronik", "camasir"], type: "predicted" },
  { id: "gap-1", brand: "GAP", campaignName: "Fırsat Penceresi: Ocak sonu", startMonth: 1, endMonth: 2, categories: ["buzdolabi", "camasir", "bulasik"], type: "predicted" },
  { id: "gap-2", brand: "GAP", campaignName: "Fırsat Penceresi: Temmuz ortası", startMonth: 7, endMonth: 8, categories: ["klima", "buzdolabi"], type: "predicted" },
];

type Lang = "tr" | "en";

const PRODUCT_NAME_SUBS: [RegExp, string][] = [
  [/Çamaşır Makinesi/g, "Washing Machine"],
  [/Bulaşık Makinesi/g, "Dishwasher"],
  [/Türk Kahvesi Makinesi/g, "Turkish Coffee Maker"],
  [/Filtre Kahve Makinesi/g, "Filter Coffee Machine"],
  [/Espresso Makinesi/g, "Espresso Machine"],
  [/Çay Makinesi/g, "Tea Maker"],
  [/Tost Makinesi/g, "Sandwich Maker"],
  [/Robot Süpürge/g, "Robot Vacuum"],
  [/Dikey Süpürge/g, "Upright Vacuum"],
  [/Kablosuz Süpürge/g, "Cordless Vacuum"],
  [/Buharlı Ütü/g, "Steam Iron"],
  [/Buzdolabı/g, "Refrigerator"],
  [/Ankastre Fırın/g, "Built-in Oven"],
  [/Set Üstü Ocak/g, "Freestanding Cooktop"],
  [/İndüksiyonlu Ocak/g, "Induction Cooktop"],
  [/Ankastre Ocak/g, "Built-in Cooktop"],
  [/Fırın/g, "Oven"],
  [/Ocak/g, "Cooktop"],
  [/İnverter Klima/g, "Inverter Air Conditioner"],
  [/Premium Klima/g, "Premium Air Conditioner"],
  [/Klima/g, "Air Conditioner"],
  [/İnverter/g, "Inverter"],
  [/Ekonomik/g, "Economy"],
  [/Kurutmalı/g, "Washer-Dryer"],
  [/Blender Set/g, "Blender Set"],
  [/Kombi No-Frost/g, "Combination No-Frost"],
  [/Kombi/g, "Combination"],
  [/Mini buzdolabı/g, "Mini Refrigerator"],
  [/Mini/g, "Mini"],
  [/Slim/g, "Slim"],
];

export function getProductName(p: ArcelikProduct, lang: Lang): string {
  if (lang === "tr") return p.name;
  let en = p.name;
  for (const [rx, rep] of PRODUCT_NAME_SUBS) en = en.replace(rx, rep);
  return en;
}

const SEASONAL_PATTERN_EN: Record<string, string> = {
  istanbul: "High demand year-round, wedding season Jun–Sep peak",
  ankara: "Public sector purchases Q1/Q3, winter AC demand low",
  izmir: "Summer tourism effect, AC May–Sep peak",
  bursa: "Industrial city, strong wedding season",
  antalya: "Tourism season AC peak, hotel renovation Q1",
  adana: "AC strong year-round, holiday campaigns effective",
  konya: "Post-harvest season purchases, Ramadan strong",
  gaziantep: "Very strong wedding season, Ramadan peak",
  mersin: "Port city, AC May–Oct strong",
  kayseri: "Trade city, stable demand year-round",
  diyarbakir: "Very strong wedding season Jun–Sep, winter heating demand",
  samsun: "Post-hazelnut harvest purchases Sep–Nov",
  trabzon: "Post-tea harvest purchases, holiday peak",
  eskisehir: "University city, September new-term demand",
  denizli: "Textile city, stable year-round",
  malatya: "Post-apricot harvest Aug–Oct purchase surge",
  erzurum: "Long winters, AC demand low, white goods holiday peak",
  van: "Strong wedding season Jun–Sep, high price sensitivity",
  manisa: "Vestel factory city — Vestel very strong here",
  tekirdag: "Industrial zone, stable demand year-round",
};

export function getCitySeasonalPattern(city: CityData, lang: Lang): string {
  if (lang === "tr") return city.seasonalPattern;
  return SEASONAL_PATTERN_EN[city.id] ?? city.seasonalPattern;
}

interface CampaignTranslation {
  name: string;
  targetSegment: string;
  promotionType: string;
  discountDetail: string;
  headline: string;
  bodyCopy: string;
  messagingTone: string;
  durationPattern: string;
  bannerDescription: string;
  dealerPosMessaging: string;
  dealerSmsNotification: string;
}

const CAMPAIGN_EN: Record<string, CampaignTranslation> = {
  ramazan: {
    name: "Ramadan Holiday Campaign",
    targetSegment: "Families renovating homes before the holiday",
    promotionType: "discount + installment",
    discountDetail: "20% off + 12-month installment",
    headline: "Renew Your Home for the Holiday with Arçelik",
    bodyCopy: "Renew your home this Ramadan. Up to 20% off on selected Arçelik white goods and up to 12-month installments. Let your holiday tables meet your new fridge, your clean laundry meet your new machine.",
    messagingTone: "Warm, family-oriented, festive atmosphere",
    durationPattern: "3 weeks before the holiday",
    bannerDescription: "Arçelik fridge and washing machine on white background, holiday theme, 20% discount badge",
    dealerPosMessaging: "Holiday Campaign — 20% off + 12-mo installment on selected white goods. Offer this opportunity to your customers.",
    dealerSmsNotification: "Dear Dealer, our Ramadan campaign has started. 20% off + 12-mo installment. Details on the dealer portal.",
  },
  "dugun-sezonu": {
    name: "Summer Wedding Season — Trousseau Package",
    targetSegment: "Couples about to get married and their families",
    promotionType: "bundle discount",
    discountDetail: "5-piece trousseau package 25% off + 18-mo installment",
    headline: "Start Your New Home with Arçelik — Trousseau Package Campaign",
    bodyCopy: "We are by your side at the most important step of your life. Up to 25% off on trousseau packages including fridge, washing machine, dishwasher, oven and small appliances. Meet all the needs of your new home with up to 18-month installments.",
    messagingTone: "Romantic, hopeful, new beginnings",
    durationPattern: "June–September (4 months)",
    bannerDescription: "Young couple in kitchen, Arçelik white goods package, heart icon, 25% badge",
    dealerPosMessaging: "Trousseau Package Campaign — Buy 5 items get 25% off. Boost your sales during wedding season.",
    dealerSmsNotification: "Summer wedding season campaign started! 25% off trousseau packages + 18-mo installment. Reach your customers now.",
  },
  "okula-donus": {
    name: "Back to School Campaign",
    targetSegment: "Students starting university and their families",
    promotionType: "discount",
    discountDetail: "15% off + free iron gift",
    headline: "Arçelik Is By Your Side for Back to School — Student Package",
    bodyCopy: "Prepare your home for the new school term. Up to 15% off on small appliances, AC and TVs. Plus a free iron gift campaign on selected products.",
    messagingTone: "Energetic, youthful, practical",
    durationPattern: "Late August – mid-September (3 weeks)",
    bannerDescription: "Student apartment, mini fridge and tea maker, books, 15% badge",
    dealerPosMessaging: "Back to School — 15% off small appliances and AC. Special opportunity for dealers in student areas.",
    dealerSmsNotification: "Back to school campaign started. 15% off small appliances + free iron. Highlight in university areas.",
  },
  yilbasi: {
    name: "New Year's Sale",
    targetSegment: "Premium segment consumers, gift shopping",
    promotionType: "discount + gift",
    discountDetail: "10% off + free installation + gift wrapping",
    headline: "Enter the New Year with New Technology — Arçelik New Year's Deals",
    bodyCopy: "Give the best gift to your loved ones. 10% off on premium TVs, espresso machines and selected white goods. Free installation and special gift wrapping service.",
    messagingTone: "Elegant, premium, gift-oriented",
    durationPattern: "December 15 – January 5 (3 weeks)",
    bannerDescription: "Christmas tree, premium TV and espresso machine, gift package, 10% badge",
    dealerPosMessaging: "New Year's Campaign — 10% off premium products + free installation. Boost your gift season sales.",
    dealerSmsNotification: "New Year's campaign active! 10% off TV and small appliances + free installation. Offer gift wrapping.",
  },
  "eski-yeni": {
    name: "Trade-In Exchange Campaign",
    targetSegment: "Homeowners wanting to replace old appliances",
    promotionType: "trade-in",
    discountDetail: "Bring your old appliance, get ₺2,000–₺5,000 off new products",
    headline: "Bring the Old, Take the New — Arçelik Exchange Program",
    bodyCopy: "Brand and condition of your old appliance don't matter. Bring it to your Arçelik dealer and earn ₺2,000 to ₺5,000 extra discount on new Arçelik products. Your old appliance will be recycled in eco-friendly ways.",
    messagingTone: "Practical, trustworthy, eco-friendly",
    durationPattern: "Year-round ongoing campaign",
    bannerDescription: "Old fridge → new Arçelik fridge transition, recycling icon, up to ₺5,000 badge",
    dealerPosMessaging: "Exchange Program — ₺2K–₺5K extra discount for customers bringing old appliances. All brands accepted.",
    dealerSmsNotification: "Trade-in exchange campaign always active. ₺2K–₺5K extra discount for every customer bringing an old appliance.",
  },
  taksit: {
    name: "Installment Campaign — Bank Partnership",
    targetSegment: "Middle-income group seeking installments",
    promotionType: "installment",
    discountDetail: "Up to 24-month interest-free installment on all products (Ziraat, Halkbank, Vakıfbank)",
    headline: "Up to 24-Month Interest-Free Installment at Arçelik — With State Banks",
    bodyCopy: "Up to 24-month interest-free installment opportunity with Ziraat Bank, Halkbank and Vakıfbank credit cards. Valid on all Arçelik and Beko products. Own your dream appliance now, spread payments over months.",
    messagingTone: "Trustworthy, state-backed, economical",
    durationPattern: "Bank agreement period (typically Q2–Q3)",
    bannerDescription: "Arçelik products, bank logos, 24-month installment badge, trust icon",
    dealerPosMessaging: "24-Month Interest-Free Installment — Ziraat, Halkbank, Vakıfbank. Valid on all products. Check your POS settings.",
    dealerSmsNotification: "Bank installment campaign started! Up to 24-mo interest-free with Ziraat/Halk/Vakıf cards. Update your POS.",
  },
  "enerji-verimlilik": {
    name: "Energy Efficiency Campaign",
    targetSegment: "Energy-conscious, aware consumers",
    promotionType: "discount + SCT",
    discountDetail: "12% extra discount on A+++ products + SCT advantage",
    headline: "Save Energy, Save Money and the Planet",
    bodyCopy: "12% extra discount on A+++ energy class Arçelik products. Plus take advantage of SCT benefits. Save up to ₺3,000 on your annual energy bill, less carbon footprint for the world.",
    messagingTone: "Conscious, modern, eco-friendly",
    durationPattern: "Energy efficiency week + continuation (4 weeks)",
    bannerDescription: "Green leaf, A+++ label, Arçelik fridge, energy saving icon, 12% badge",
    dealerPosMessaging: "12% Extra Discount on A+++ Products — Great deal when combined with SCT advantage. Increase premium product sales.",
    dealerSmsNotification: "Energy efficiency campaign! 12% extra discount on A+++ products + SCT advantage. Reach your eco-conscious customers.",
  },
  "bayi-ozel": {
    name: "Dealer-Exclusive Regional Campaign",
    targetSegment: "Customers in regionally competitive cities",
    promotionType: "regional discount + gift",
    discountDetail: "18% regional discount + free freestanding cooktop gift",
    headline: "Arçelik Deals Exclusive to Your Region — Only at Selected Dealers",
    bodyCopy: "Special Arçelik deals in cities where Vestel is strong. 18% regional discount on selected white goods and a free freestanding cooktop gift. Only at participating dealers, limited stock.",
    messagingTone: "Urgent, opportunity, local",
    durationPattern: "2 weeks (competitor campaign response)",
    bannerDescription: "Regional map highlight, Arçelik white goods, 18% badge, 'Only in This Region' label",
    dealerPosMessaging: "Regional Exclusive Campaign — 18% off + free cooktop. Targeting market share gain vs Vestel. Feature the products.",
    dealerSmsNotification: "URGENT: Regional campaign started! 18% off + free cooktop. 2-week duration. Prepare your displays and stock.",
  },
};

export function getCampaignField<K extends keyof CampaignTranslation>(c: CampaignTemplate, field: K, lang: Lang): string {
  if (lang === "tr") return c[field] as string;
  return CAMPAIGN_EN[c.id]?.[field] ?? (c[field] as string);
}

const KPI_LABEL_EN: Record<string, string> = {
  "national-market-share": "National Market Share (Total)",
  "buzdolabi-share": "Refrigerator Market Share",
  "camasir-share": "Washing Machine Market Share",
  "avg-margin": "Average Gross Margin",
  "dealer-compliance": "Dealer Compliance Rate",
  "campaign-roi": "Campaign ROI (Average)",
  "competitor-price-index": "Competitor Price Index",
  "dealer-satisfaction": "Dealer Satisfaction Score",
};

export function getKpiLabel(kpi: KpiBenchmark, lang: Lang): string {
  if (lang === "tr") return kpi.label;
  return KPI_LABEL_EN[kpi.id] ?? kpi.label;
}

const CALENDAR_NAME_EN: Record<string, string> = {
  "arc-ramazan": "Ramadan Holiday Campaign",
  "arc-dugun": "Trousseau Package Campaign",
  "arc-okul": "Back to School",
  "arc-yilbasi": "New Year's Sale",
  "arc-taksit": "Bank Installment Campaign",
  "ves-bahar": "Spring Campaign (Predicted)",
  "ves-yaz": "Summer Deal Days (Predicted)",
  "ves-kasim": "November Discounts (Predicted)",
  "bsh-bahar": "Spring Renewal (Predicted)",
  "bsh-sonbahar": "Autumn Premium (Predicted)",
  "sam-tech": "Galaxy + Home Appliances (Predicted)",
  "sam-bf": "Black Friday (Predicted)",
  "lg-yaz": "LG Summer Campaign (Predicted)",
  "lg-bf": "LG Black Friday (Predicted)",
  "gap-1": "Opportunity Window: Late January",
  "gap-2": "Opportunity Window: Mid-July",
};

export function getCalendarEntryName(entry: CalendarEntry, lang: Lang): string {
  if (lang === "tr") return entry.campaignName;
  return CALENDAR_NAME_EN[entry.id] ?? entry.campaignName;
}
