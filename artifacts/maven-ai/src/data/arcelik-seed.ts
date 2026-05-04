export interface DataSource {
  id: string;
  category: "product-prices" | "competitor-prices" | "market-share" | "financial" | "dealer-network" | "map";
  name: string;
  nameEn: string;
  sourceType: "annual-report" | "website-catalog" | "public-filing" | "industry-report" | "geographic";
  sourceUrl: string;
  sourceDate: string;
  description: string;
  descriptionEn: string;
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: "src-arcelik-ar",
    category: "market-share",
    name: "Arçelik A.Ş. 2024 Faaliyet Raporu",
    nameEn: "Arçelik A.Ş. 2024 Annual Report",
    sourceType: "annual-report",
    sourceUrl: "https://www.arcelikglobal.com/en/investor-relations/presentations-and-reports/annual-reports/",
    sourceDate: "2025-03-28",
    description: "Türkiye beyaz eşya pazar payı %45–48, brüt marj %30.2, gelir dağılımı verileri",
    descriptionEn: "Turkey white goods market share 45–48%, gross margin 30.2%, revenue breakdown data",
  },
  {
    id: "src-arcelik-prices",
    category: "product-prices",
    name: "arcelik.com.tr Ürün Kataloğu",
    nameEn: "arcelik.com.tr Product Catalog",
    sourceType: "website-catalog",
    sourceUrl: "https://www.arcelik.com.tr/beyaz-esya",
    sourceDate: "2026-05-01",
    description: "Arçelik TSF listefiyatları — buzdolabı, çamaşır, bulaşık, fırın, klima kategorileri",
    descriptionEn: "Arçelik TSF list prices — refrigerator, washing machine, dishwasher, oven, AC categories",
  },
  {
    id: "src-beko-prices",
    category: "product-prices",
    name: "beko.com.tr Ürün Kataloğu",
    nameEn: "beko.com.tr Product Catalog",
    sourceType: "website-catalog",
    sourceUrl: "https://www.beko.com.tr/beyaz-esya",
    sourceDate: "2026-05-01",
    description: "Beko TSF listefiyatları — tüm beyaz eşya ve küçük ev aletleri",
    descriptionEn: "Beko TSF list prices — all white goods and small appliances",
  },
  {
    id: "src-vestel-prices",
    category: "competitor-prices",
    name: "vestel.com.tr Ürün Kataloğu",
    nameEn: "vestel.com.tr Product Catalog",
    sourceType: "website-catalog",
    sourceUrl: "https://www.vestel.com.tr/beyaz-esya",
    sourceDate: "2026-05-01",
    description: "Vestel rakip fiyatları — beyaz eşya ve TV kategorileri",
    descriptionEn: "Vestel competitor prices — white goods and TV categories",
  },
  {
    id: "src-bosch-prices",
    category: "competitor-prices",
    name: "bosch-home.com.tr Ürün Kataloğu",
    nameEn: "bosch-home.com.tr Product Catalog",
    sourceType: "website-catalog",
    sourceUrl: "https://www.bosch-home.com.tr/urun-listeleme",
    sourceDate: "2026-05-01",
    description: "Bosch rakip fiyatları — premium beyaz eşya segmenti",
    descriptionEn: "Bosch competitor prices — premium white goods segment",
  },
  {
    id: "src-samsung-prices",
    category: "competitor-prices",
    name: "samsung.com/tr Ürün Kataloğu",
    nameEn: "samsung.com/tr Product Catalog",
    sourceType: "website-catalog",
    sourceUrl: "https://www.samsung.com/tr/home-appliances/",
    sourceDate: "2026-05-01",
    description: "Samsung rakip fiyatları — beyaz eşya ve TV kategorileri",
    descriptionEn: "Samsung competitor prices — home appliances and TV categories",
  },
  {
    id: "src-vestel-ar",
    category: "market-share",
    name: "Vestel Elektronik 2024 Faaliyet Raporu",
    nameEn: "Vestel Electronics 2024 Annual Report",
    sourceType: "annual-report",
    sourceUrl: "https://www.vestelinvestorrelations.com/en/financial-reports.aspx",
    sourceDate: "2025-04-15",
    description: "Vestel Türkiye pazar payı verileri, gelir ve marj bilgileri",
    descriptionEn: "Vestel Turkey market share data, revenue and margin figures",
  },
  {
    id: "src-bsh-turkey",
    category: "market-share",
    name: "BSH Türkiye Pazar Verileri (Kamuya açık)",
    nameEn: "BSH Turkey Market Data (Public filings)",
    sourceType: "public-filing",
    sourceUrl: "https://www.bsh-group.com/tr/hakkimizda",
    sourceDate: "2025-02-01",
    description: "BSH (Bosch, Siemens, Profilo) Türkiye pazar payı ve bayi ağı verileri",
    descriptionEn: "BSH (Bosch, Siemens, Profilo) Turkey market share and dealer network data",
  },
  {
    id: "src-turkbesd",
    category: "market-share",
    name: "TÜRKBESD Beyaz Eşya Sektör Raporu 2024",
    nameEn: "TURKBESD White Goods Industry Report 2024",
    sourceType: "industry-report",
    sourceUrl: "https://www.turkbesd.org/istatistikler",
    sourceDate: "2025-01-20",
    description: "Türkiye beyaz eşya üretim, iç satış ve ihracat istatistikleri",
    descriptionEn: "Turkey white goods production, domestic sales and export statistics",
  },
  {
    id: "src-arcelik-dealer",
    category: "dealer-network",
    name: "Arçelik Bayi ve Servis Ağı",
    nameEn: "Arçelik Dealer & Service Network",
    sourceType: "website-catalog",
    sourceUrl: "https://www.arcelik.com.tr/magazalarimiz",
    sourceDate: "2026-04-15",
    description: "Arçelik yetkili bayi sayıları (il bazında) ve servis noktaları",
    descriptionEn: "Arçelik authorized dealer counts (by province) and service points",
  },
  {
    id: "src-turkey-map",
    category: "map",
    name: "Türkiye İl Sınırları Haritası (Coğrafi veri)",
    nameEn: "Turkey Provincial Boundaries Map (Geographic data)",
    sourceType: "geographic",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Turkey_location_map.svg",
    sourceDate: "2024-01-01",
    description: "Türkiye 81 il sınırları ve 7 coğrafi bölge haritası, Wikimedia Commons kaynaklı",
    descriptionEn: "Turkey 81 province boundaries and 7 geographic regions map, sourced from Wikimedia Commons",
  },
];

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

const SUBCATEGORY_LABELS: Record<string, string> = {
  "no-frost": "No-Frost",
  "kombi": "Kombi",
  "side-by-side": "Side-by-Side",
  "mini": "Mini",
  "premium": "Premium",
  "inverter": "İnverter",
  "standart": "Standart",
  "ekonomik": "Ekonomik",
  "kurutmali": "Kurutmalı",
  "slim": "Slim",
  "ankastre": "Ankastre",
  "ocak": "Ocak",
  "induksiyonlu": "İndüksiyonlu",
  "set-ustu": "Set Üstü",
  "mikrodalga": "Mikrodalga",
  "kompakt": "Kompakt",
  "9000-btu": "9000 BTU",
  "12000-btu": "12000 BTU",
  "18000-btu": "18000 BTU",
  "24000-btu": "24000 BTU",
  "cay-makinesi": "Çay Makinesi",
  "espresso": "Espresso",
  "turk-kahvesi": "Türk Kahvesi",
  "filtre-kahve": "Filtre Kahve",
  "supurge": "Süpürge",
  "kablosuz-supurge": "Kablosuz Süpürge",
  "robot-supurge": "Robot Süpürge",
  "blender": "Blender",
  "utu": "Ütü",
  "tost-makinesi": "Tost Makinesi",
  "led-tv": "LED TV",
  "4k-tv": "4K TV",
  "oled-tv": "OLED TV",
  "qled-tv": "QLED TV",
};

const SUBCATEGORY_LABELS_EN: Record<string, string> = {
  "no-frost": "No-Frost",
  "kombi": "Combination",
  "side-by-side": "Side-by-Side",
  "mini": "Mini",
  "premium": "Premium",
  "inverter": "Inverter",
  "standart": "Standard",
  "ekonomik": "Economy",
  "kurutmali": "Washer-Dryer",
  "slim": "Slim",
  "ankastre": "Built-in",
  "ocak": "Cooktop",
  "induksiyonlu": "Induction",
  "set-ustu": "Freestanding",
  "mikrodalga": "Microwave",
  "kompakt": "Compact",
  "9000-btu": "9000 BTU",
  "12000-btu": "12000 BTU",
  "18000-btu": "18000 BTU",
  "24000-btu": "24000 BTU",
  "cay-makinesi": "Tea Maker",
  "espresso": "Espresso",
  "turk-kahvesi": "Turkish Coffee",
  "filtre-kahve": "Filter Coffee",
  "supurge": "Vacuum",
  "kablosuz-supurge": "Cordless Vacuum",
  "robot-supurge": "Robot Vacuum",
  "blender": "Blender",
  "utu": "Iron",
  "tost-makinesi": "Sandwich Maker",
  "led-tv": "LED TV",
  "4k-tv": "4K TV",
  "oled-tv": "OLED TV",
  "qled-tv": "QLED TV",
};

export function getSubcategoryLabel(sub: string, lang: "tr" | "en" = "tr"): string {
  return lang === "en" ? (SUBCATEGORY_LABELS_EN[sub] ?? sub) : (SUBCATEGORY_LABELS[sub] ?? sub);
}

export type PriceTier = "entry" | "mid" | "premium";

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  entry: "Giriş",
  mid: "Orta",
  premium: "Premium",
};

const PRICE_TIER_LABELS_EN: Record<PriceTier, string> = {
  entry: "Entry",
  mid: "Mid",
  premium: "Premium",
};

export function getPriceTierLabel(tier: PriceTier, lang: "tr" | "en" = "tr"): string {
  return lang === "en" ? PRICE_TIER_LABELS_EN[tier] : PRICE_TIER_LABELS[tier];
}

export interface ArcelikProduct {
  id: string;
  modelCode: string;
  name: string;
  category: ProductCategory;
  subcategory: string;
  priceTier: PriceTier;
  tsfPrice: number;
  dealerCost: number;
  marginPercent: number;
  energyClass: string;
  features: string[];
  sourceId: string;
  priceDate: string;
}

export interface ProductSpecs {
  capacity: string;
  warrantyYears: number;
  smartFeatures: string[];
}

const SMART_KEYWORDS = ["Wi-Fi", "HomeWhiz", "Dijital dokunmatik ekran", "TFT ekran", "Full-touch ekran", "Kamera", "Bluetooth", "Akıllı", "Smart", "App"];

export function getProductSpecs(p: ArcelikProduct): ProductSpecs {
  let capacity = "-";
  for (const f of p.features) {
    const litreMatch = f.match(/(\d+)\s*L/);
    if (litreMatch) { capacity = `${litreMatch[1]} L`; break; }
    const kgMatch = f.match(/(\d+)\s*kg/);
    if (kgMatch) { capacity = `${kgMatch[1]} kg`; break; }
    const kisiMatch = f.match(/(\d+)\s*kişilik/);
    if (kisiMatch) { capacity = `${kisiMatch[1]} kişilik`; break; }
    const wattMatch = f.match(/(\d+)\s*W/);
    if (wattMatch) { capacity = `${wattMatch[1]}W`; break; }
  }
  if (capacity === "-" && p.subcategory.includes("btu")) {
    const btuMatch = p.subcategory.match(/(\d+)-btu/);
    if (btuMatch) capacity = `${btuMatch[1]} BTU`;
  }
  if (capacity === "-" && p.category === "tv-elektronik") {
    const inchMatch = p.name.match(/(\d{2,3})["'']/);
    if (inchMatch) capacity = `${inchMatch[1]}"`;
  }

  const warrantyYears = p.priceTier === "premium" ? 3 : 2;

  const smartFeatures = p.features.filter((f) =>
    SMART_KEYWORDS.some((kw) => f.toLowerCase().includes(kw.toLowerCase()))
  );

  return { capacity, warrantyYears, smartFeatures };
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
  sourceId: string;
  priceDate: string;
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
  { id: "buz-01", modelCode: "5088 NFK", name: "Arçelik 5088 NFK No-Frost Buzdolabı", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 27499, dealerCost: 19249, marginPercent: 30, energyClass: "A++", features: ["No-Frost","Ion Fresh teknolojisi","560 L hacim","Dijital dokunmatik ekran"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-02", modelCode: "5076 NFK", name: "Arçelik 5076 NFK No-Frost", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 23999, dealerCost: 16799, marginPercent: 30, energyClass: "A++", features: ["No-Frost","480 L hacim","Antibakteriyel filtre"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-03", modelCode: "5060 NFK", name: "Arçelik 5060 NFK A+++", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 21499, dealerCost: 15264, marginPercent: 29, energyClass: "A+++", features: ["No-Frost","430 L hacim","Enerji tasarruflu"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-04", modelCode: "5044 NFK", name: "Arçelik 5044 NFK Ekonomik", category: "buzdolabi", subcategory: "no-frost", priceTier: "entry", tsfPrice: 18499, dealerCost: 13319, marginPercent: 28, energyClass: "A+", features: ["No-Frost","380 L hacim"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-05", modelCode: "970560 EI", name: "Beko 970560 EI Kombi No-Frost", category: "buzdolabi", subcategory: "kombi", priceTier: "mid", tsfPrice: 31999, dealerCost: 22079, marginPercent: 31, energyClass: "A++", features: ["Kombi tip","No-Frost","580 L hacim","Harvest Fresh"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "buz-06", modelCode: "9505 NFK", name: "Beko 9505 NFK", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 25499, dealerCost: 17849, marginPercent: 30, energyClass: "A++", features: ["No-Frost","500 L","NeoFrost Dual Cooling"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "buz-07", modelCode: "274560 EI", name: "Arçelik 274560 EI Side-by-Side", category: "buzdolabi", subcategory: "side-by-side", priceTier: "premium", tsfPrice: 46999, dealerCost: 31959, marginPercent: 32, energyClass: "A++", features: ["Side-by-Side","620 L hacim","Su ve buz dispenseri","Dokunmatik panel"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-08", modelCode: "1060 TY", name: "Arçelik Mini 1060 TY", category: "buzdolabi", subcategory: "mini", priceTier: "entry", tsfPrice: 14999, dealerCost: 10949, marginPercent: 27, energyClass: "A+", features: ["Mini buzdolabı","90 L hacim","Ofis/yatak odası için"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-09", modelCode: "825 NFK", name: "Beko 825 NFK No-Frost", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 22499, dealerCost: 15974, marginPercent: 29, energyClass: "A++", features: ["No-Frost","450 L","Mavi Işık teknolojisi"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "buz-10", modelCode: "GRND 5100", name: "Grundig GRND 5100 Premium", category: "buzdolabi", subcategory: "premium", priceTier: "premium", tsfPrice: 37999, dealerCost: 26219, marginPercent: 31, energyClass: "A+++", features: ["Full No-Frost","550 L","Vitamin Zone","Premium cam kapı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-11", modelCode: "5030 NFK", name: "Arçelik 5030 NFK Giriş Seviye", category: "buzdolabi", subcategory: "no-frost", priceTier: "entry", tsfPrice: 15999, dealerCost: 11679, marginPercent: 27, energyClass: "A+", features: ["No-Frost","320 L hacim","Mekanik kontrol"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-12", modelCode: "970680 EI", name: "Beko 970680 EI Kombi Premium", category: "buzdolabi", subcategory: "kombi", priceTier: "premium", tsfPrice: 39999, dealerCost: 27199, marginPercent: 32, energyClass: "A+++", features: ["Kombi tip","Full No-Frost","640 L hacim","Harvest Fresh","Wi-Fi"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "buz-13", modelCode: "284570 EI", name: "Arçelik 284570 EI Side-by-Side Premium", category: "buzdolabi", subcategory: "side-by-side", priceTier: "premium", tsfPrice: 54999, dealerCost: 36849, marginPercent: 33, energyClass: "A+++", features: ["Side-by-Side","680 L hacim","Su/buz dispenseri","HomeWhiz","Kamera"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-14", modelCode: "GRND 4800", name: "Grundig GRND 4800 No-Frost", category: "buzdolabi", subcategory: "no-frost", priceTier: "mid", tsfPrice: 28999, dealerCost: 20009, marginPercent: 31, energyClass: "A++", features: ["Full No-Frost","500 L","Vitamin Zone","LED aydınlatma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "buz-15", modelCode: "1080 TY", name: "Beko 1080 TY Mini Buzdolabı", category: "buzdolabi", subcategory: "mini", priceTier: "entry", tsfPrice: 12499, dealerCost: 9249, marginPercent: 26, energyClass: "A+", features: ["Mini buzdolabı","70 L hacim","Kompakt tasarım"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "cam-01", modelCode: "9124 D", name: "Arçelik 9124 D İnverter Çamaşır Makinesi", category: "camasir", subcategory: "inverter", priceTier: "mid", tsfPrice: 19999, dealerCost: 13999, marginPercent: 30, energyClass: "A", features: ["9 kg","1200 devir","İnverter motor","Buhar teknolojisi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-02", modelCode: "8124 D", name: "Arçelik 8124 D Çamaşır Makinesi", category: "camasir", subcategory: "standart", priceTier: "mid", tsfPrice: 17499, dealerCost: 12599, marginPercent: 28, energyClass: "A", features: ["8 kg","1200 devir","15 program"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-03", modelCode: "10143 D", name: "Arçelik 10143 D Premium", category: "camasir", subcategory: "premium", priceTier: "premium", tsfPrice: 26999, dealerCost: 18629, marginPercent: 31, energyClass: "A", features: ["10 kg","1400 devir","İnverter","Wi-Fi","HomeWhiz"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-04", modelCode: "BK 9141 E", name: "Beko BK 9141 E İnverter", category: "camasir", subcategory: "inverter", priceTier: "mid", tsfPrice: 18499, dealerCost: 12949, marginPercent: 30, energyClass: "A", features: ["9 kg","1400 devir","ProSmart İnverter"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "cam-05", modelCode: "BK 10142 DA", name: "Beko BK 10142 DA", category: "camasir", subcategory: "standart", priceTier: "mid", tsfPrice: 23499, dealerCost: 16449, marginPercent: 30, energyClass: "A", features: ["10 kg","1400 devir","AquaTech"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "cam-06", modelCode: "7103 D", name: "Arçelik 7103 D Ekonomik", category: "camasir", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 14499, dealerCost: 10584, marginPercent: 27, energyClass: "A", features: ["7 kg","1000 devir","Ekonomik seri"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-07", modelCode: "9143 YD", name: "Arçelik 9143 YD Kurutmalı", category: "camasir", subcategory: "kurutmali", priceTier: "premium", tsfPrice: 32999, dealerCost: 22769, marginPercent: 31, energyClass: "A", features: ["9 kg yıkama / 6 kg kurutma","1400 devir","Isı pompalı kurutma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-08", modelCode: "BK 851 YKI", name: "Beko BK 851 YKI Slim", category: "camasir", subcategory: "slim", priceTier: "entry", tsfPrice: 15999, dealerCost: 11519, marginPercent: 28, energyClass: "A", features: ["8 kg","Dar gövde (45cm)","1000 devir"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "cam-09", modelCode: "GWN 39430", name: "Grundig GWN 39430 Premium", category: "camasir", subcategory: "premium", priceTier: "premium", tsfPrice: 28999, dealerCost: 20009, marginPercent: 31, energyClass: "A", features: ["9 kg","1400 devir","Alerjik program","Buhar"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-10", modelCode: "8103 D", name: "Arçelik 8103 D A+++", category: "camasir", subcategory: "standart", priceTier: "entry", tsfPrice: 16999, dealerCost: 12239, marginPercent: 28, energyClass: "A+++", features: ["8 kg","1000 devir","A+++ enerji sınıfı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-11", modelCode: "6103 D", name: "Arçelik 6103 D Kompakt", category: "camasir", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 12999, dealerCost: 9619, marginPercent: 26, energyClass: "A", features: ["6 kg","1000 devir","Kompakt tasarım"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-12", modelCode: "10163 YD", name: "Arçelik 10163 YD Kurutmalı Premium", category: "camasir", subcategory: "kurutmali", priceTier: "premium", tsfPrice: 38999, dealerCost: 26519, marginPercent: 32, energyClass: "A", features: ["10 kg yıkama / 7 kg kurutma","1600 devir","HomeWhiz","Buhar tazeleme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-13", modelCode: "BK 7101 E", name: "Beko BK 7101 E Ekonomik", category: "camasir", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 13499, dealerCost: 9989, marginPercent: 26, energyClass: "A", features: ["7 kg","1000 devir","Hızlı yıkama"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "cam-14", modelCode: "GWN 49630", name: "Grundig GWN 49630 İnverter", category: "camasir", subcategory: "inverter", priceTier: "mid", tsfPrice: 21499, dealerCost: 15049, marginPercent: 30, energyClass: "A", features: ["9 kg","1400 devir","İnverter","FibreProtect"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "cam-15", modelCode: "BK 961 YKI", name: "Beko BK 961 YKI Slim İnverter", category: "camasir", subcategory: "slim", priceTier: "mid", tsfPrice: 19499, dealerCost: 13649, marginPercent: 30, energyClass: "A", features: ["9 kg","Dar gövde (45cm)","1200 devir","İnverter"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "bul-01", modelCode: "6344", name: "Arçelik 6344 İnverter Bulaşık Makinesi", category: "bulasik", subcategory: "inverter", priceTier: "mid", tsfPrice: 17999, dealerCost: 12599, marginPercent: 30, energyClass: "A++", features: ["14 kişilik","İnverter motor","Hijyen program"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-02", modelCode: "6266", name: "Arçelik 6266 A++ Bulaşık Makinesi", category: "bulasik", subcategory: "standart", priceTier: "mid", tsfPrice: 15499, dealerCost: 11159, marginPercent: 28, energyClass: "A++", features: ["13 kişilik","6 program","Yarım yük"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-03", modelCode: "BM 6016", name: "Beko BM 6016 Bulaşık Makinesi", category: "bulasik", subcategory: "standart", priceTier: "mid", tsfPrice: 16499, dealerCost: 11549, marginPercent: 30, energyClass: "A++", features: ["14 kişilik","AutoDose","Hijyen Intense"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "bul-04", modelCode: "6566", name: "Arçelik 6566 Premium Bulaşık Makinesi", category: "bulasik", subcategory: "premium", priceTier: "premium", tsfPrice: 23999, dealerCost: 16559, marginPercent: 31, energyClass: "A+++", features: ["14 kişilik","CornerIntense","AquaFlex","Wi-Fi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-05", modelCode: "BM 9006 I", name: "Beko BM 9006 I İnverter", category: "bulasik", subcategory: "inverter", priceTier: "mid", tsfPrice: 20499, dealerCost: 14349, marginPercent: 30, energyClass: "A++", features: ["14 kişilik","İnverter","Tray Wash","Sessiz çalışma"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "bul-06", modelCode: "6144", name: "Arçelik 6144 Ekonomik Bulaşık", category: "bulasik", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 12499, dealerCost: 9249, marginPercent: 26, energyClass: "A+", features: ["12 kişilik","4 program","Ekonomik seri"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-07", modelCode: "GNF 51030", name: "Grundig GNF 51030 Premium", category: "bulasik", subcategory: "premium", priceTier: "premium", tsfPrice: 25999, dealerCost: 17939, marginPercent: 31, energyClass: "A+++", features: ["14 kişilik","AutoDose","GlassCare","Zeolith kurutma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-08", modelCode: "BM 5005", name: "Beko BM 5005 Ekonomik", category: "bulasik", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 13999, dealerCost: 10219, marginPercent: 27, energyClass: "A+", features: ["13 kişilik","5 program"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "bul-09", modelCode: "6044", name: "Arçelik 6044 Giriş Seviye Bulaşık", category: "bulasik", subcategory: "ekonomik", priceTier: "entry", tsfPrice: 10999, dealerCost: 8249, marginPercent: 25, energyClass: "A+", features: ["12 kişilik","4 program","Hızlı yıkama"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-10", modelCode: "6466", name: "Arçelik 6466 İnverter A+++", category: "bulasik", subcategory: "inverter", priceTier: "mid", tsfPrice: 19499, dealerCost: 13649, marginPercent: 30, energyClass: "A+++", features: ["14 kişilik","İnverter","Hijyen Plus","Yarım yük"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-11", modelCode: "BM 7020 I", name: "Beko BM 7020 I Premium", category: "bulasik", subcategory: "premium", priceTier: "premium", tsfPrice: 27999, dealerCost: 19039, marginPercent: 32, energyClass: "A+++", features: ["14 kişilik","İnverter","AutoDose","SteamGloss","Wi-Fi"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "bul-12", modelCode: "6366", name: "Arçelik 6366 Standart A++", category: "bulasik", subcategory: "standart", priceTier: "mid", tsfPrice: 16999, dealerCost: 12069, marginPercent: 29, energyClass: "A++", features: ["14 kişilik","8 program","Hijyen program","Yarım yük"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-13", modelCode: "GNF 41830", name: "Grundig GNF 41830 İnverter", category: "bulasik", subcategory: "inverter", priceTier: "mid", tsfPrice: 21999, dealerCost: 15179, marginPercent: 31, energyClass: "A++", features: ["14 kişilik","İnverter","GlassCare","Extra Kurutma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "bul-14", modelCode: "BM 4505", name: "Beko BM 4505 Kompakt", category: "bulasik", subcategory: "kompakt", priceTier: "entry", tsfPrice: 8999, dealerCost: 6749, marginPercent: 25, energyClass: "A+", features: ["8 kişilik","Tezgah altı","4 program","Kompakt"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "bul-15", modelCode: "6666", name: "Arçelik 6666 Premium Plus Bulaşık", category: "bulasik", subcategory: "premium", priceTier: "premium", tsfPrice: 29999, dealerCost: 20399, marginPercent: 32, energyClass: "A+++", features: ["14 kişilik","CornerIntense Pro","AquaFlex","HomeWhiz","Zeolith"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-01", modelCode: "AFD 6001", name: "Arçelik AFD 6001 Ankastre Fırın", category: "firin", subcategory: "ankastre", priceTier: "mid", tsfPrice: 13999, dealerCost: 9659, marginPercent: 31, energyClass: "A", features: ["Ankastre","Turbo fırın","80 L iç hacim","Teleskopik ray"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-02", modelCode: "AO 6614", name: "Arçelik AO 6614 Ankastre Ocak", category: "firin", subcategory: "ocak", priceTier: "entry", tsfPrice: 8999, dealerCost: 6299, marginPercent: 30, energyClass: "-", features: ["Ankastre ocak","4 gözlü","Cam yüzey","Otomatik ateşleme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-03", modelCode: "BIM 25400 XMS", name: "Beko BIM 25400 XMS Ankastre Fırın", category: "firin", subcategory: "ankastre", priceTier: "mid", tsfPrice: 15999, dealerCost: 11199, marginPercent: 30, energyClass: "A", features: ["Ankastre","Multifunksiyon","Split&Cook","70 L"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "fir-04", modelCode: "AFD 7002 S", name: "Arçelik AFD 7002 S Premium Fırın", category: "firin", subcategory: "premium", priceTier: "premium", tsfPrice: 20999, dealerCost: 14069, marginPercent: 33, energyClass: "A+", features: ["Ankastre","Buhar destekli pişirme","Pyrolytic temizleme","TFT ekran"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-05", modelCode: "AO 8800", name: "Arçelik AO 8800 İndüksiyonlu Ocak", category: "firin", subcategory: "induksiyonlu", priceTier: "mid", tsfPrice: 17499, dealerCost: 12074, marginPercent: 31, energyClass: "-", features: ["İndüksiyon","4 bölge","FlexZone","Timer"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-06", modelCode: "BIM 22301 X", name: "Beko BIM 22301 X Ankastre", category: "firin", subcategory: "ankastre", priceTier: "entry", tsfPrice: 11999, dealerCost: 8639, marginPercent: 28, energyClass: "A", features: ["Ankastre","8 fonksiyon","65 L"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "fir-07", modelCode: "GEBM 34000 X", name: "Grundig GEBM 34000 X Premium", category: "firin", subcategory: "premium", priceTier: "premium", tsfPrice: 24999, dealerCost: 16499, marginPercent: 34, energyClass: "A+", features: ["Ankastre","Chef Assist","Full-touch ekran","Pyrolytic"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-08", modelCode: "ASM 6650", name: "Arçelik ASM 6650 Set Üstü Ocak", category: "firin", subcategory: "set-ustu", priceTier: "entry", tsfPrice: 9999, dealerCost: 6999, marginPercent: 30, energyClass: "-", features: ["Set üstü","4 gözlü","Emaye ızgara","Otomatik ateşleme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-09", modelCode: "AO 4414", name: "Arçelik AO 4414 Ekonomik Ocak", category: "firin", subcategory: "ocak", priceTier: "entry", tsfPrice: 6999, dealerCost: 5039, marginPercent: 28, energyClass: "-", features: ["Ankastre ocak","4 gözlü","Emaye yüzey"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-10", modelCode: "AFD 8003 S", name: "Arçelik AFD 8003 S Premium Plus Fırın", category: "firin", subcategory: "premium", priceTier: "premium", tsfPrice: 29999, dealerCost: 19799, marginPercent: 34, energyClass: "A+", features: ["Ankastre","Buhar + Mikrodalgalı","Pyrolytic","HomeWhiz","TFT dokunmatik"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-11", modelCode: "BIM 15300 X", name: "Beko BIM 15300 X Ekonomik Fırın", category: "firin", subcategory: "ankastre", priceTier: "entry", tsfPrice: 9499, dealerCost: 6939, marginPercent: 27, energyClass: "A", features: ["Ankastre","5 fonksiyon","60 L","Ekonomik"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "fir-12", modelCode: "AO 9900 I", name: "Arçelik AO 9900 I İndüksiyon Premium", category: "firin", subcategory: "induksiyonlu", priceTier: "premium", tsfPrice: 22999, dealerCost: 15639, marginPercent: 32, energyClass: "-", features: ["İndüksiyon","5 bölge","FlexZone Pro","Timer","Boost"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-13", modelCode: "ASM 4450", name: "Arçelik ASM 4450 Ekonomik Set Üstü", category: "firin", subcategory: "set-ustu", priceTier: "entry", tsfPrice: 7499, dealerCost: 5399, marginPercent: 28, energyClass: "-", features: ["Set üstü","4 gözlü","Kompakt","Otomatik ateşleme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-14", modelCode: "GEMM 44000 X", name: "Grundig GEMM 44000 X Mikrodalga Fırın", category: "firin", subcategory: "mikrodalga", priceTier: "mid", tsfPrice: 12999, dealerCost: 9099, marginPercent: 30, energyClass: "-", features: ["Ankastre mikrodalga","25 L","Grill","10 program"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "fir-15", modelCode: "AMD 5120", name: "Arçelik AMD 5120 Ankastre Mikrodalga", category: "firin", subcategory: "mikrodalga", priceTier: "entry", tsfPrice: 8499, dealerCost: 6119, marginPercent: 28, energyClass: "-", features: ["Ankastre mikrodalga","20 L","5 güç seviyesi","Çözme"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-01", modelCode: "09410", name: "Arçelik 09410 İnverter Klima 9000 BTU", category: "klima", subcategory: "9000-btu", priceTier: "entry", tsfPrice: 17999, dealerCost: 12599, marginPercent: 30, energyClass: "A++", features: ["9000 BTU","İnverter","R32 gaz","Wi-Fi kontrol"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-02", modelCode: "12420", name: "Arçelik 12420 İnverter Klima 12000 BTU", category: "klima", subcategory: "12000-btu", priceTier: "mid", tsfPrice: 23499, dealerCost: 16449, marginPercent: 30, energyClass: "A++", features: ["12000 BTU","İnverter","Plazma filtre","Sessiz mod"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-03", modelCode: "18430", name: "Arçelik 18430 İnverter Klima 18000 BTU", category: "klima", subcategory: "18000-btu", priceTier: "mid", tsfPrice: 31499, dealerCost: 22364, marginPercent: 29, energyClass: "A+", features: ["18000 BTU","İnverter","Geniş alan","3D hava akışı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-04", modelCode: "24440", name: "Arçelik 24440 İnverter Klima 24000 BTU", category: "klima", subcategory: "24000-btu", priceTier: "premium", tsfPrice: 38999, dealerCost: 27689, marginPercent: 29, energyClass: "A+", features: ["24000 BTU","İnverter","Büyük alan","Otomatik yön"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-05", modelCode: "BXEU 090", name: "Beko BXEU 090 Klima 9000 BTU", category: "klima", subcategory: "9000-btu", priceTier: "entry", tsfPrice: 16999, dealerCost: 12069, marginPercent: 29, energyClass: "A++", features: ["9000 BTU","İnverter","R32 gaz"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "kli-06", modelCode: "BXEU 120", name: "Beko BXEU 120 Klima 12000 BTU", category: "klima", subcategory: "12000-btu", priceTier: "mid", tsfPrice: 21999, dealerCost: 15619, marginPercent: 29, energyClass: "A+", features: ["12000 BTU","İnverter","Uyku modu"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "kli-07", modelCode: "G 12420", name: "Grundig G 12420 Premium Klima", category: "klima", subcategory: "12000-btu", priceTier: "premium", tsfPrice: 27499, dealerCost: 18974, marginPercent: 31, energyClass: "A+++", features: ["12000 BTU","İnverter","UV-C filtre","Premium tasarım"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-08", modelCode: "09310", name: "Arçelik 09310 Ekonomik Klima 9000 BTU", category: "klima", subcategory: "9000-btu", priceTier: "entry", tsfPrice: 14999, dealerCost: 10799, marginPercent: 28, energyClass: "A+", features: ["9000 BTU","İnverter","R32 gaz","Temel model"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-09", modelCode: "12520", name: "Arçelik 12520 Premium Klima 12000 BTU", category: "klima", subcategory: "12000-btu", priceTier: "premium", tsfPrice: 29999, dealerCost: 20699, marginPercent: 31, energyClass: "A+++", features: ["12000 BTU","İnverter","Wi-Fi","Plazma filtre","3D hava akışı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-10", modelCode: "BXEU 180", name: "Beko BXEU 180 Klima 18000 BTU", category: "klima", subcategory: "18000-btu", priceTier: "mid", tsfPrice: 28999, dealerCost: 20589, marginPercent: 29, energyClass: "A+", features: ["18000 BTU","İnverter","R32 gaz","Uyku modu"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "kli-11", modelCode: "BXEU 240", name: "Beko BXEU 240 Klima 24000 BTU", category: "klima", subcategory: "24000-btu", priceTier: "mid", tsfPrice: 34999, dealerCost: 24849, marginPercent: 29, energyClass: "A+", features: ["24000 BTU","İnverter","R32 gaz","Geniş alan"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "kli-12", modelCode: "G 09310", name: "Grundig G 09310 Klima 9000 BTU", category: "klima", subcategory: "9000-btu", priceTier: "mid", tsfPrice: 19999, dealerCost: 13999, marginPercent: 30, energyClass: "A++", features: ["9000 BTU","İnverter","UV-C filtre","Sessiz mod"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-13", modelCode: "24540", name: "Arçelik 24540 Premium Klima 24000 BTU", category: "klima", subcategory: "24000-btu", priceTier: "premium", tsfPrice: 44999, dealerCost: 30599, marginPercent: 32, energyClass: "A++", features: ["24000 BTU","İnverter","Wi-Fi","3D hava akışı","Plazma ion"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kli-14", modelCode: "G 18430", name: "Grundig G 18430 Premium Klima 18000 BTU", category: "klima", subcategory: "18000-btu", priceTier: "premium", tsfPrice: 36999, dealerCost: 25529, marginPercent: 31, energyClass: "A++", features: ["18000 BTU","İnverter","UV-C filtre","Premium tasarım","Wi-Fi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-01", modelCode: "K 3300", name: "Arçelik K 3300 Çay Makinesi", category: "kucuk-ev", subcategory: "cay-makinesi", priceTier: "entry", tsfPrice: 3699, dealerCost: 2293, marginPercent: 38, energyClass: "-", features: ["Çelik demlik","Otomatik kapanma","Su göstergesi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-02", modelCode: "K 8115", name: "Arçelik K 8115 Espresso Makinesi", category: "kucuk-ev", subcategory: "espresso", priceTier: "mid", tsfPrice: 9499, dealerCost: 5699, marginPercent: 40, energyClass: "-", features: ["15 bar basınç","Süt köpürtme","Çift çıkış"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-03", modelCode: "S 6540", name: "Arçelik S 6540 Dikey Süpürge", category: "kucuk-ev", subcategory: "supurge", priceTier: "entry", tsfPrice: 5799, dealerCost: 3595, marginPercent: 38, energyClass: "A", features: ["750W","HEPA filtre","Kablosuz değil"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-04", modelCode: "BKK 2210", name: "Beko BKK 2210 Türk Kahvesi Makinesi", category: "kucuk-ev", subcategory: "turk-kahvesi", priceTier: "entry", tsfPrice: 2699, dealerCost: 1673, marginPercent: 38, energyClass: "-", features: ["Tek pişirme","Otomatik pişirme","Anti-taşma"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "kev-05", modelCode: "T 8800", name: "Arçelik T 8800 Buharlı Ütü", category: "kucuk-ev", subcategory: "utu", priceTier: "entry", tsfPrice: 3199, dealerCost: 1983, marginPercent: 38, energyClass: "-", features: ["2800W","Seramik taban","Sürekli buhar"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-06", modelCode: "K 2360", name: "Arçelik K 2360 Filtre Kahve Makinesi", category: "kucuk-ev", subcategory: "filtre-kahve", priceTier: "entry", tsfPrice: 4299, dealerCost: 2665, marginPercent: 38, energyClass: "-", features: ["1.5L karaf","Aroma ayarı","Timer"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-07", modelCode: "BKK 2520", name: "Beko BKK 2520 Robot Süpürge", category: "kucuk-ev", subcategory: "robot-supurge", priceTier: "premium", tsfPrice: 10999, dealerCost: 6599, marginPercent: 40, energyClass: "-", features: ["Lazer navigasyon","Mop özelliği","Wi-Fi","120 dk pil"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "kev-08", modelCode: "K 7600", name: "Arçelik K 7600 Blender Set", category: "kucuk-ev", subcategory: "blender", priceTier: "entry", tsfPrice: 4799, dealerCost: 2975, marginPercent: 38, energyClass: "-", features: ["1000W","Cam hazne","Doğrayıcı aksesuar"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-09", modelCode: "TM 8860", name: "Grundig TM 8860 Tost Makinesi", category: "kucuk-ev", subcategory: "tost-makinesi", priceTier: "entry", tsfPrice: 3499, dealerCost: 2169, marginPercent: 38, energyClass: "-", features: ["Seramik plaka","4 dilim","Sıcaklık ayarı"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-10", modelCode: "S 8960", name: "Arçelik S 8960 Kablosuz Süpürge", category: "kucuk-ev", subcategory: "kablosuz-supurge", priceTier: "premium", tsfPrice: 12999, dealerCost: 7799, marginPercent: 40, energyClass: "-", features: ["Kablosuz","Dijital motor","60 dk pil","LED ışık"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-11", modelCode: "K 3500", name: "Arçelik K 3500 Premium Çay Makinesi", category: "kucuk-ev", subcategory: "cay-makinesi", priceTier: "mid", tsfPrice: 5499, dealerCost: 3299, marginPercent: 40, energyClass: "-", features: ["Çelik demlik","Dijital ekran","Sıcak tutma","1.7L su hazne"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-12", modelCode: "K 8215", name: "Arçelik K 8215 Otomatik Espresso", category: "kucuk-ev", subcategory: "espresso", priceTier: "premium", tsfPrice: 16999, dealerCost: 10199, marginPercent: 40, energyClass: "-", features: ["15 bar basınç","Otomatik öğütücü","Dokunmatik ekran","Süt sistemi"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-13", modelCode: "BKK 2310", name: "Beko BKK 2310 Çiftli Türk Kahvesi", category: "kucuk-ev", subcategory: "turk-kahvesi", priceTier: "mid", tsfPrice: 3999, dealerCost: 2399, marginPercent: 40, energyClass: "-", features: ["Çift pişirme","Otomatik pişirme","Anti-taşma","Işıklı gösterge"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "kev-14", modelCode: "S 9960", name: "Arçelik S 9960 Premium Kablosuz Süpürge", category: "kucuk-ev", subcategory: "kablosuz-supurge", priceTier: "premium", tsfPrice: 17999, dealerCost: 10799, marginPercent: 40, energyClass: "-", features: ["Kablosuz","Dijital motor","90 dk pil","LED ışık","HEPA 13","Mop başlık"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "kev-15", modelCode: "BKK 2620", name: "Beko BKK 2620 Robot Süpürge Premium", category: "kucuk-ev", subcategory: "robot-supurge", priceTier: "premium", tsfPrice: 15999, dealerCost: 9599, marginPercent: 40, energyClass: "-", features: ["LiDAR navigasyon","Mop + vakum","Wi-Fi","180 dk pil","Otomatik boşaltma"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "kev-16", modelCode: "K 7800", name: "Arçelik K 7800 Premium Blender", category: "kucuk-ev", subcategory: "blender", priceTier: "mid", tsfPrice: 7499, dealerCost: 4499, marginPercent: 40, energyClass: "-", features: ["1400W","Cam hazne","Doğrayıcı","Smoothie programı","Buz kırma"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-01", modelCode: "A43 L 8740 4S", name: "Arçelik A43 L 8740 4S LED TV 43\"", category: "tv-elektronik", subcategory: "led-tv", priceTier: "entry", tsfPrice: 16499, dealerCost: 12869, marginPercent: 22, energyClass: "G", features: ["43 inç","Full HD","Smart TV","3 HDMI"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-02", modelCode: "A50 L 8840 5S", name: "Arçelik A50 L 8840 5S 4K TV 50\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 24499, dealerCost: 19109, marginPercent: 22, energyClass: "F", features: ["50 inç","4K Ultra HD","Smart TV","HDR10"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-03", modelCode: "A55 L 9895 5S", name: "Arçelik A55 L 9895 5S OLED TV 55\"", category: "tv-elektronik", subcategory: "oled-tv", priceTier: "premium", tsfPrice: 42999, dealerCost: 32679, marginPercent: 24, energyClass: "G", features: ["55 inç","OLED","4K","Dolby Vision","120Hz"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-04", modelCode: "B55 L 8840 5S", name: "Beko B55 L 8840 5S 4K TV 55\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 22999, dealerCost: 18169, marginPercent: 21, energyClass: "F", features: ["55 inç","4K Ultra HD","Smart TV"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "tv-05", modelCode: "55 GHQ 9500", name: "Grundig 55 GHQ 9500 QLED TV 55\"", category: "tv-elektronik", subcategory: "qled-tv", priceTier: "premium", tsfPrice: 48999, dealerCost: 37239, marginPercent: 24, energyClass: "F", features: ["55 inç","QLED","4K","Google TV","120Hz"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-06", modelCode: "A65 L 8850 5S", name: "Arçelik A65 L 8850 5S 4K TV 65\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 32499, dealerCost: 25349, marginPercent: 22, energyClass: "G", features: ["65 inç","4K Ultra HD","Smart TV","Dolby Atmos"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-07", modelCode: "B43 L 8730", name: "Beko B43 L 8730 LED TV 43\"", category: "tv-elektronik", subcategory: "led-tv", priceTier: "entry", tsfPrice: 15499, dealerCost: 12399, marginPercent: 20, energyClass: "G", features: ["43 inç","Full HD","Smart TV"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "tv-08", modelCode: "75 GHQ 9800", name: "Grundig 75 GHQ 9800 OLED TV 75\"", category: "tv-elektronik", subcategory: "oled-tv", priceTier: "premium", tsfPrice: 79999, dealerCost: 60799, marginPercent: 24, energyClass: "G", features: ["75 inç","OLED","4K","120Hz","Dolby Vision IQ"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-09", modelCode: "A32 L 8630 4S", name: "Arçelik A32 L 8630 4S LED TV 32\"", category: "tv-elektronik", subcategory: "led-tv", priceTier: "entry", tsfPrice: 10999, dealerCost: 8799, marginPercent: 20, energyClass: "G", features: ["32 inç","HD Ready","Smart TV","2 HDMI"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-10", modelCode: "A55 L 8840 5S", name: "Arçelik A55 L 8840 5S 4K TV 55\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 27999, dealerCost: 21839, marginPercent: 22, energyClass: "F", features: ["55 inç","4K Ultra HD","Smart TV","HDR10","Dolby Atmos"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-11", modelCode: "B32 L 8620", name: "Beko B32 L 8620 LED TV 32\"", category: "tv-elektronik", subcategory: "led-tv", priceTier: "entry", tsfPrice: 9499, dealerCost: 7599, marginPercent: 20, energyClass: "G", features: ["32 inç","HD Ready","Smart TV"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "tv-12", modelCode: "65 GHQ 9600", name: "Grundig 65 GHQ 9600 QLED TV 65\"", category: "tv-elektronik", subcategory: "qled-tv", priceTier: "premium", tsfPrice: 62999, dealerCost: 47879, marginPercent: 24, energyClass: "F", features: ["65 inç","QLED","4K","Google TV","120Hz","Dolby Vision"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-13", modelCode: "A75 L 8860 5S", name: "Arçelik A75 L 8860 5S 4K TV 75\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "premium", tsfPrice: 49999, dealerCost: 38999, marginPercent: 22, energyClass: "G", features: ["75 inç","4K Ultra HD","Smart TV","Dolby Atmos","120Hz"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
  { id: "tv-14", modelCode: "B50 L 8830 5S", name: "Beko B50 L 8830 5S 4K TV 50\"", category: "tv-elektronik", subcategory: "4k-tv", priceTier: "mid", tsfPrice: 20999, dealerCost: 16799, marginPercent: 20, energyClass: "F", features: ["50 inç","4K Ultra HD","Smart TV","HDR10"], sourceId: "src-beko-prices", priceDate: "2026-05-01" },
  { id: "tv-15", modelCode: "A65 L 9895 5S", name: "Arçelik A65 L 9895 5S OLED TV 65\"", category: "tv-elektronik", subcategory: "oled-tv", priceTier: "premium", tsfPrice: 64999, dealerCost: 49399, marginPercent: 24, energyClass: "G", features: ["65 inç","OLED","4K","Dolby Vision IQ","120Hz","HDMI 2.1"], sourceId: "src-arcelik-prices", priceDate: "2026-05-01" },
];


export const competitorPrices: CompetitorPrice[] = [
  { id: "cp-v-01", brand: "Vestel", competitorModel: "NF600 EX A++", category: "buzdolabi", competitorPrice: 22999, arcelikEquivalentId: "buz-04", priceDeltaPercent: 24, positioning: "value", note: "Fiyat odaklı segment lideri", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-02", brand: "Vestel", competitorModel: "NF520 A++", category: "buzdolabi", competitorPrice: 18499, arcelikEquivalentId: "buz-03", priceDeltaPercent: -14, positioning: "value", note: "Agresif fiyatlandırma", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-03", brand: "Vestel", competitorModel: "CM 9812 İnverter", category: "camasir", competitorPrice: 16999, arcelikEquivalentId: "cam-01", priceDeltaPercent: -15, positioning: "value", note: "Fiyat avantajı ile pazar payı hedefi", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-04", brand: "Vestel", competitorModel: "BM 7101 A++", category: "bulasik", competitorPrice: 13999, arcelikEquivalentId: "bul-02", priceDeltaPercent: -10, positioning: "value", note: "Uygun fiyat segmenti", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-05", brand: "Vestel", competitorModel: "AO 6004 Ankastre Fırın", category: "firin", competitorPrice: 11499, arcelikEquivalentId: "fir-01", priceDeltaPercent: -18, positioning: "value", note: "Bütçe dostu ankastre", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-06", brand: "Vestel", competitorModel: "INV 09 Klima 9000 BTU", category: "klima", competitorPrice: 14999, arcelikEquivalentId: "kli-01", priceDeltaPercent: -17, positioning: "value", note: "En düşük fiyatlı inverter", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-07", brand: "Vestel", competitorModel: "50UA9630 4K TV", category: "tv-elektronik", competitorPrice: 19999, arcelikEquivalentId: "tv-02", priceDeltaPercent: -18, positioning: "value", note: "Agresif TV fiyatlandırması", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-08", brand: "Vestel", competitorModel: "CM 7810 Ekonomik", category: "camasir", competitorPrice: 12499, arcelikEquivalentId: "cam-06", priceDeltaPercent: -14, positioning: "value", note: "Giriş seviye rekabet", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-09", brand: "Vestel", competitorModel: "NF480 Kombi", category: "buzdolabi", competitorPrice: 26999, arcelikEquivalentId: "buz-05", priceDeltaPercent: -16, positioning: "value", note: "Kombi segmentinde fiyat avantajı", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-10", brand: "Vestel", competitorModel: "BM 9401 İnverter", category: "bulasik", competitorPrice: 17499, arcelikEquivalentId: "bul-05", priceDeltaPercent: -15, positioning: "value", note: "İnverter segmentinde alt fiyat", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-01", brand: "Regal", competitorModel: "NF 5200 A+", category: "buzdolabi", competitorPrice: 15499, arcelikEquivalentId: "buz-04", priceDeltaPercent: -16, positioning: "value", note: "En düşük fiyatlı no-frost", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-02", brand: "Regal", competitorModel: "CM 7100", category: "camasir", competitorPrice: 11499, arcelikEquivalentId: "cam-06", priceDeltaPercent: -21, positioning: "value", note: "Bütçe segmenti lideri", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-03", brand: "Regal", competitorModel: "BM 4010", category: "bulasik", competitorPrice: 10499, arcelikEquivalentId: "bul-06", priceDeltaPercent: -16, positioning: "value", note: "En ucuz bulaşık makinesi", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-04", brand: "Regal", competitorModel: "AFN 5001 Fırın", category: "firin", competitorPrice: 9499, arcelikEquivalentId: "fir-01", priceDeltaPercent: -32, positioning: "value", note: "Bütçe ankastre", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-05", brand: "Regal", competitorModel: "43R654FA TV", category: "tv-elektronik", competitorPrice: 12499, arcelikEquivalentId: "tv-01", priceDeltaPercent: -24, positioning: "value", note: "Giriş seviye TV", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-06", brand: "Regal", competitorModel: "INV 09R Klima", category: "klima", competitorPrice: 13499, arcelikEquivalentId: "kli-01", priceDeltaPercent: -25, positioning: "value", note: "En ucuz inverter klima", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-b-01", brand: "Bosch", competitorModel: "KGN56VIF0N No-Frost", category: "buzdolabi", competitorPrice: 34999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 27, positioning: "premium", note: "VitaFresh teknolojisi, premium segment", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-b-02", brand: "Bosch", competitorModel: "KAN92VI35O Side-by-Side", category: "buzdolabi", competitorPrice: 59999, arcelikEquivalentId: "buz-07", priceDeltaPercent: 28, positioning: "premium", note: "Premium side-by-side", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-b-03", brand: "Bosch", competitorModel: "WAX32M40TR İnverter", category: "camasir", competitorPrice: 29999, arcelikEquivalentId: "cam-03", priceDeltaPercent: 11, positioning: "premium", note: "i-DOS otomatik dozajlama", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-b-04", brand: "Bosch", competitorModel: "SMS6ZCI42E Bulaşık", category: "bulasik", competitorPrice: 28999, arcelikEquivalentId: "bul-04", priceDeltaPercent: 21, positioning: "premium", note: "PerfectDry Zeolith", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-b-05", brand: "Bosch", competitorModel: "HBG675BS1 Ankastre Fırın", category: "firin", competitorPrice: 27999, arcelikEquivalentId: "fir-04", priceDeltaPercent: 33, positioning: "premium", note: "Serie 8 premium fırın", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-b-06", brand: "Bosch", competitorModel: "CLL 9000W Klima 9000", category: "klima", competitorPrice: 26999, arcelikEquivalentId: "kli-01", priceDeltaPercent: 50, positioning: "premium", note: "Climate 9000i premium", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-b-07", brand: "Bosch", competitorModel: "WAV28L40TR Premium", category: "camasir", competitorPrice: 35999, arcelikEquivalentId: "cam-03", priceDeltaPercent: 33, positioning: "premium", note: "Serie 8 ActiveOxygen", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-b-08", brand: "Bosch", competitorModel: "KGN39VWEQ Ekonomik", category: "buzdolabi", competitorPrice: 26999, arcelikEquivalentId: "buz-02", priceDeltaPercent: 13, positioning: "premium", note: "Orta segment Bosch", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-s-01", brand: "Siemens", competitorModel: "KG56NVI30N iQ300", category: "buzdolabi", competitorPrice: 31999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 16, positioning: "premium", note: "hyperFresh teknolojisi", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-s-02", brand: "Siemens", competitorModel: "WM14N2X0TR iQ500", category: "camasir", competitorPrice: 27999, arcelikEquivalentId: "cam-03", priceDeltaPercent: 4, positioning: "premium", note: "speedPack, iQdrive", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-s-03", brand: "Siemens", competitorModel: "SN65ZX00AT iQ500", category: "bulasik", competitorPrice: 26999, arcelikEquivalentId: "bul-04", priceDeltaPercent: 13, positioning: "premium", note: "Zeolith, glassZone", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-s-04", brand: "Siemens", competitorModel: "HB676GBS1 iQ700 Fırın", category: "firin", competitorPrice: 30999, arcelikEquivalentId: "fir-04", priceDeltaPercent: 48, positioning: "premium", note: "cookControl Plus", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-s-05", brand: "Siemens", competitorModel: "KA93GAIEP SbS", category: "buzdolabi", competitorPrice: 64999, arcelikEquivalentId: "buz-07", priceDeltaPercent: 38, positioning: "premium", note: "iQ500 Side-by-Side", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-01", brand: "Profilo", competitorModel: "BD3056LFVN No-Frost", category: "buzdolabi", competitorPrice: 21999, arcelikEquivalentId: "buz-02", priceDeltaPercent: -8, positioning: "mid", note: "Orta segment, Türk tüketicisine tanıdık", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-02", brand: "Profilo", competitorModel: "BD3076LFVN A++", category: "buzdolabi", competitorPrice: 25499, arcelikEquivalentId: "buz-01", priceDeltaPercent: -7, positioning: "mid", note: "Bosch kalitesi uygun fiyat", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-03", brand: "Profilo", competitorModel: "CMK1010ETR Çamaşır", category: "camasir", competitorPrice: 17999, arcelikEquivalentId: "cam-01", priceDeltaPercent: -10, positioning: "mid", note: "Orta segment yıkama", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-04", brand: "Profilo", competitorModel: "BM6280 Bulaşık", category: "bulasik", competitorPrice: 15999, arcelikEquivalentId: "bul-01", priceDeltaPercent: -11, positioning: "mid", note: "Uygun fiyatlı Alman teknolojisi", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-05", brand: "Profilo", competitorModel: "ANKF 6001 Fırın", category: "firin", competitorPrice: 12499, arcelikEquivalentId: "fir-01", priceDeltaPercent: -11, positioning: "mid", note: "Alman ankastre uygun fiyat", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-06", brand: "Profilo", competitorModel: "INV 09P Klima", category: "klima", competitorPrice: 19499, arcelikEquivalentId: "kli-01", priceDeltaPercent: 8, positioning: "mid", note: "Bosch teknolojisi orta fiyat", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-07", brand: "Profilo", competitorModel: "CMK8100 Kurutmalı", category: "camasir", competitorPrice: 28999, arcelikEquivalentId: "cam-07", priceDeltaPercent: -12, positioning: "mid", note: "Kurutmalı segmentte rekabet", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-08", brand: "Profilo", competitorModel: "BD3044LFVN Ekonomik", category: "buzdolabi", competitorPrice: 17999, arcelikEquivalentId: "buz-04", priceDeltaPercent: -3, positioning: "mid", note: "Ekonomik buzdolabı", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-09", brand: "Profilo", competitorModel: "BM4280 Ekonomik Bulaşık", category: "bulasik", competitorPrice: 11999, arcelikEquivalentId: "bul-06", priceDeltaPercent: -4, positioning: "mid", note: "Uygun fiyat ekonomik", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-p-10", brand: "Profilo", competitorModel: "CMK7100 Slim", category: "camasir", competitorPrice: 14499, arcelikEquivalentId: "cam-08", priceDeltaPercent: -9, positioning: "mid", note: "Dar gövde orta segment", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-01", brand: "Samsung", competitorModel: "RT53K6240S8 No-Frost", category: "buzdolabi", competitorPrice: 30999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 13, positioning: "premium", note: "Twin Cooling Plus", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-02", brand: "Samsung", competitorModel: "RS68A8842SL SbS", category: "buzdolabi", competitorPrice: 54999, arcelikEquivalentId: "buz-07", priceDeltaPercent: 17, positioning: "premium", note: "SpaceMax, Family Hub", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-03", brand: "Samsung", competitorModel: "WW90T534DAE Ecobubble", category: "camasir", competitorPrice: 23499, arcelikEquivalentId: "cam-01", priceDeltaPercent: 18, positioning: "premium", note: "Ecobubble, AI Kontrol", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-04", brand: "Samsung", competitorModel: "WD90T534DBE Kurutmalı", category: "camasir", competitorPrice: 35999, arcelikEquivalentId: "cam-07", priceDeltaPercent: 9, positioning: "premium", note: "AddWash, AI Kurutma", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-05", brand: "Samsung", competitorModel: "DW60M5070FW Bulaşık", category: "bulasik", competitorPrice: 19499, arcelikEquivalentId: "bul-01", priceDeltaPercent: 8, positioning: "premium", note: "WaterWall teknolojisi", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-06", brand: "Samsung", competitorModel: "NV75N5573RS Fırın", category: "firin", competitorPrice: 21999, arcelikEquivalentId: "fir-04", priceDeltaPercent: 5, positioning: "premium", note: "Dual Cook Flex", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-07", brand: "Samsung", competitorModel: "AR12TXHQASINEU Klima", category: "klima", competitorPrice: 24999, arcelikEquivalentId: "kli-02", priceDeltaPercent: 6, positioning: "premium", note: "Wind-Free teknolojisi", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-08", brand: "Samsung", competitorModel: "UE50AU7100 4K TV", category: "tv-elektronik", competitorPrice: 26999, arcelikEquivalentId: "tv-02", priceDeltaPercent: 10, positioning: "premium", note: "Crystal UHD, Tizen", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-09", brand: "Samsung", competitorModel: "QE55Q60B QLED TV", category: "tv-elektronik", competitorPrice: 46999, arcelikEquivalentId: "tv-05", priceDeltaPercent: -4, positioning: "premium", note: "QLED, Quantum HDR", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-10", brand: "Samsung", competitorModel: "UE65AU7100 4K TV 65\"", category: "tv-elektronik", competitorPrice: 35999, arcelikEquivalentId: "tv-06", priceDeltaPercent: 11, positioning: "premium", note: "Crystal 4K, büyük ekran", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-01", brand: "LG", competitorModel: "GN-C422SLCL No-Frost", category: "buzdolabi", competitorPrice: 29999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 9, positioning: "premium", note: "Linear Cooling, DoorCooling+", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-02", brand: "LG", competitorModel: "GC-X257CSHS SbS", category: "buzdolabi", competitorPrice: 57999, arcelikEquivalentId: "buz-07", priceDeltaPercent: 23, positioning: "premium", note: "InstaView, Craft Ice", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-03", brand: "LG", competitorModel: "F4V5RYP0W İnverter", category: "camasir", competitorPrice: 22499, arcelikEquivalentId: "cam-01", priceDeltaPercent: 13, positioning: "premium", note: "AI DD, TurboWash 360", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-04", brand: "LG", competitorModel: "F4V5RGP0W Kurutmalı", category: "camasir", competitorPrice: 34999, arcelikEquivalentId: "cam-07", priceDeltaPercent: 6, positioning: "premium", note: "AI DD Kurutmalı", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-05", brand: "LG", competitorModel: "DF455HMS Bulaşık", category: "bulasik", competitorPrice: 20499, arcelikEquivalentId: "bul-01", priceDeltaPercent: 14, positioning: "premium", note: "QuadWash, TrueSteam", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-06", brand: "LG", competitorModel: "50UP75006LF 4K TV", category: "tv-elektronik", competitorPrice: 23499, arcelikEquivalentId: "tv-02", priceDeltaPercent: -4, positioning: "premium", note: "WebOS, Active HDR", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-07", brand: "LG", competitorModel: "OLED55C1 OLED TV", category: "tv-elektronik", competitorPrice: 47999, arcelikEquivalentId: "tv-03", priceDeltaPercent: 12, positioning: "premium", note: "OLED evo, α9 işlemci", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-08", brand: "LG", competitorModel: "65UP75006 4K TV 65\"", category: "tv-elektronik", competitorPrice: 30999, arcelikEquivalentId: "tv-06", priceDeltaPercent: -5, positioning: "premium", note: "4K IPS, WebOS", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-e-01", brand: "Electrolux/AEG", competitorModel: "LRS3DE39U No-Frost", category: "buzdolabi", competitorPrice: 28999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 5, positioning: "premium", note: "TwinTech No-Frost", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-e-02", brand: "Electrolux/AEG", competitorModel: "EW6F4R28B İnverter", category: "camasir", competitorPrice: 21499, arcelikEquivalentId: "cam-01", priceDeltaPercent: 8, positioning: "premium", note: "SensiCare, ProSteam", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-e-03", brand: "Electrolux/AEG", competitorModel: "ESF9500LOX Bulaşık", category: "bulasik", competitorPrice: 18999, arcelikEquivalentId: "bul-01", priceDeltaPercent: 6, positioning: "premium", note: "AirDry, FlexiSpray", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-e-04", brand: "Electrolux/AEG", competitorModel: "EOF5C50BX Ankastre Fırın", category: "firin", competitorPrice: 18499, arcelikEquivalentId: "fir-04", priceDeltaPercent: -12, positioning: "premium", note: "SurroundCook", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-e-05", brand: "Electrolux/AEG", competitorModel: "EW7F3R48S Premium Çamaşır", category: "camasir", competitorPrice: 26999, arcelikEquivalentId: "cam-03", priceDeltaPercent: 0, positioning: "premium", note: "SoftPlus, UniversalDose", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-e-06", brand: "Electrolux/AEG", competitorModel: "LRS4DE39S Kombi No-Frost", category: "buzdolabi", competitorPrice: 33499, arcelikEquivalentId: "buz-05", priceDeltaPercent: 5, positioning: "premium", note: "CustomFlex, TwinTech", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-v-11", brand: "Vestel", competitorModel: "BM 7501 A+++ Bulaşık", category: "bulasik", competitorPrice: 19999, arcelikEquivalentId: "bul-04", priceDeltaPercent: -17, positioning: "value", note: "Premium segmentte fiyat kırıcı", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-v-12", brand: "Vestel", competitorModel: "KLM 12001 İnverter Klima 12K", category: "klima", competitorPrice: 19999, arcelikEquivalentId: "kli-02", priceDeltaPercent: -15, positioning: "value", note: "12000 BTU segmentinde agresif fiyat", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-07", brand: "Regal", competitorModel: "CM 6100 Ekonomik Çamaşır", category: "camasir", competitorPrice: 9999, arcelikEquivalentId: "cam-06", priceDeltaPercent: -31, positioning: "value", note: "En düşük fiyatlı çamaşır makinesi", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-08", brand: "Regal", competitorModel: "NF 4800 Mini", category: "buzdolabi", competitorPrice: 11999, arcelikEquivalentId: "buz-08", priceDeltaPercent: -20, positioning: "value", note: "Mini buzdolabı giriş seviye", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-r-09", brand: "Regal", competitorModel: "BM 5001 Standart Bulaşık", category: "bulasik", competitorPrice: 11999, arcelikEquivalentId: "bul-02", priceDeltaPercent: -23, positioning: "value", note: "Standart segment en düşük fiyat", sourceId: "src-vestel-prices", priceDate: "2026-05-01" },
  { id: "cp-b-09", brand: "Bosch", competitorModel: "SMS46GI55E Serie 4 Bulaşık", category: "bulasik", competitorPrice: 23499, arcelikEquivalentId: "bul-01", priceDeltaPercent: 31, positioning: "premium", note: "Serie 4 orta-premium bulaşık", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-b-10", brand: "Bosch", competitorModel: "CLL 2000W Klima 12K", category: "klima", competitorPrice: 30999, arcelikEquivalentId: "kli-02", priceDeltaPercent: 32, positioning: "premium", note: "Climate 2000i 12000 BTU", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-s-06", brand: "Siemens", competitorModel: "WG54B2030TR iQ700 Çamaşır", category: "camasir", competitorPrice: 32499, arcelikEquivalentId: "cam-03", priceDeltaPercent: 20, positioning: "premium", note: "iSensoric, antiStain", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-s-07", brand: "Siemens", competitorModel: "SN65EX56CE iQ500 Bulaşık", category: "bulasik", competitorPrice: 29999, arcelikEquivalentId: "bul-04", priceDeltaPercent: 25, positioning: "premium", note: "emotionLight, Zeolith kurutma", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-s-08", brand: "Siemens", competitorModel: "KD56NXIF0N iQ300 No-Frost", category: "buzdolabi", competitorPrice: 29999, arcelikEquivalentId: "buz-02", priceDeltaPercent: 25, positioning: "premium", note: "noFrost, superFreezing", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-11", brand: "Samsung", competitorModel: "WW80T3040BW Ekonomik Çamaşır", category: "camasir", competitorPrice: 16999, arcelikEquivalentId: "cam-02", priceDeltaPercent: -3, positioning: "premium", note: "Digital Inverter, Hygiene Steam", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-12", brand: "Samsung", competitorModel: "DW60M6050FW Bulaşık Premium", category: "bulasik", competitorPrice: 24999, arcelikEquivalentId: "bul-04", priceDeltaPercent: 4, positioning: "premium", note: "WaterWall, Zone Booster", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-09", brand: "LG", competitorModel: "GN-B422SQCL Ekonomik No-Frost", category: "buzdolabi", competitorPrice: 24499, arcelikEquivalentId: "buz-02", priceDeltaPercent: 2, positioning: "premium", note: "Smart Inverter, Multi Air Flow", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-10", brand: "LG", competitorModel: "F2V5HS0W Slim Çamaşır", category: "camasir", competitorPrice: 17999, arcelikEquivalentId: "cam-08", priceDeltaPercent: 13, positioning: "premium", note: "Slim body, AI DD, Steam", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-e-07", brand: "Electrolux/AEG", competitorModel: "ESF5545LOX Premium Bulaşık", category: "bulasik", competitorPrice: 23499, arcelikEquivalentId: "bul-04", priceDeltaPercent: -2, positioning: "premium", note: "RealLife, SatelliteClean", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-e-08", brand: "Electrolux/AEG", competitorModel: "EW8F2966MA Kurutmalı Çamaşır", category: "camasir", competitorPrice: 30999, arcelikEquivalentId: "cam-07", priceDeltaPercent: -6, positioning: "premium", note: "DualCare, UltraWash", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-p-11", brand: "Profilo", competitorModel: "BD4056LFVN Premium No-Frost", category: "buzdolabi", competitorPrice: 29999, arcelikEquivalentId: "buz-01", priceDeltaPercent: 9, positioning: "mid", note: "VitaFresh, NoFrost", sourceId: "src-bosch-prices", priceDate: "2026-05-01" },
  { id: "cp-sa-13", brand: "Samsung", competitorModel: "AR18TXHQASINEU Klima 18K", category: "klima", competitorPrice: 37999, arcelikEquivalentId: "kli-03", priceDeltaPercent: 21, positioning: "premium", note: "Wind-Free 18000 BTU", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
  { id: "cp-lg-11", brand: "LG", competitorModel: "S3WQ12JA0A Klima 12K", category: "klima", competitorPrice: 25999, arcelikEquivalentId: "kli-02", priceDeltaPercent: 11, positioning: "premium", note: "Dual Inverter, ThinQ", sourceId: "src-samsung-prices", priceDate: "2026-05-01" },
];

export const cities: CityData[] = [
  { id: "istanbul", name: "İstanbul", populationTier: "tier-1", marketSharePercent: 42.3, avgPriceIndex: 1.06, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Bosch", strength: 8 }, { brand: "Profilo", strength: 7 }, { brand: "Samsung", strength: 7 }], seasonalPattern: "Yıl boyunca yüksek talep, düğün sezonu Haz–Eyl pik", dealerCount: 340 },
  { id: "ankara", name: "Ankara", populationTier: "tier-1", marketSharePercent: 46.1, avgPriceIndex: 0.99, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Bosch", strength: 7 }, { brand: "Profilo", strength: 8 }, { brand: "Samsung", strength: 5 }], seasonalPattern: "Kamu sektörü alımları Q1/Q3, kış klima düşük", dealerCount: 195 },
  { id: "izmir", name: "İzmir", populationTier: "tier-1", marketSharePercent: 39.4, avgPriceIndex: 1.03, competitorStrength: [{ brand: "Vestel", strength: 8 }, { brand: "Bosch", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 6 }], seasonalPattern: "Yaz turizm etkisi, klima Mayıs–Eylül pik", dealerCount: 170 },
  { id: "bursa", name: "Bursa", populationTier: "tier-1", marketSharePercent: 47.8, avgPriceIndex: 0.98, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Profilo", strength: 7 }, { brand: "Samsung", strength: 4 }, { brand: "LG", strength: 3 }], seasonalPattern: "Sanayi kenti, düğün sezonu güçlü", dealerCount: 115 },
  { id: "antalya", name: "Antalya", populationTier: "tier-1", marketSharePercent: 37.6, avgPriceIndex: 1.09, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Samsung", strength: 7 }, { brand: "Bosch", strength: 6 }, { brand: "LG", strength: 5 }], seasonalPattern: "Turizm sezonu klima pik, otel yenileme Q1", dealerCount: 98 },
  { id: "adana", name: "Adana", populationTier: "tier-2", marketSharePercent: 44.2, avgPriceIndex: 0.94, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Regal", strength: 5 }, { brand: "Samsung", strength: 3 }], seasonalPattern: "Klima yıl boyunca güçlü, bayram kampanyaları etkili", dealerCount: 78 },
  { id: "konya", name: "Konya", populationTier: "tier-2", marketSharePercent: 50.2, avgPriceIndex: 0.91, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 6 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Tarım sezonu sonrası alım, Ramazan güçlü", dealerCount: 88 },
  { id: "gaziantep", name: "Gaziantep", populationTier: "tier-2", marketSharePercent: 43.1, avgPriceIndex: 0.95, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 5 }, { brand: "Samsung", strength: 3 }], seasonalPattern: "Düğün sezonu çok güçlü, Ramazan pik", dealerCount: 72 },
  { id: "mersin", name: "Mersin", populationTier: "tier-2", marketSharePercent: 40.5, avgPriceIndex: 0.96, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 5 }, { brand: "LG", strength: 4 }], seasonalPattern: "Liman şehri, klima Mayıs–Ekim güçlü", dealerCount: 56 },
  { id: "kayseri", name: "Kayseri", populationTier: "tier-2", marketSharePercent: 48.5, avgPriceIndex: 0.90, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 3 }], seasonalPattern: "Ticaret şehri, yıl boyunca stabil talep", dealerCount: 62 },
  { id: "diyarbakir", name: "Diyarbakır", populationTier: "tier-2", marketSharePercent: 45.8, avgPriceIndex: 0.87, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Regal", strength: 7 }, { brand: "Profilo", strength: 4 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Düğün sezonu çok güçlü Haz–Eyl, kış ısıtma talebi", dealerCount: 52 },
  { id: "samsun", name: "Samsun", populationTier: "tier-2", marketSharePercent: 44.6, avgPriceIndex: 0.93, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 3 }], seasonalPattern: "Fındık hasadı sonrası alım Eyl–Kas", dealerCount: 46 },
  { id: "trabzon", name: "Trabzon", populationTier: "tier-3", marketSharePercent: 46.3, avgPriceIndex: 0.89, competitorStrength: [{ brand: "Vestel", strength: 5 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 4 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Çay hasadı sonrası alım, bayram pik", dealerCount: 36 },
  { id: "eskisehir", name: "Eskişehir", populationTier: "tier-3", marketSharePercent: 43.2, avgPriceIndex: 0.97, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Bosch", strength: 6 }, { brand: "Profilo", strength: 6 }, { brand: "Samsung", strength: 4 }], seasonalPattern: "Üniversite kenti, eylül yeni dönem talebi", dealerCount: 42 },
  { id: "denizli", name: "Denizli", populationTier: "tier-3", marketSharePercent: 47.2, avgPriceIndex: 0.94, competitorStrength: [{ brand: "Vestel", strength: 6 }, { brand: "Profilo", strength: 5 }, { brand: "Regal", strength: 5 }, { brand: "Bosch", strength: 3 }], seasonalPattern: "Tekstil şehri, yıl boyunca stabil", dealerCount: 39 },
  { id: "malatya", name: "Malatya", populationTier: "tier-3", marketSharePercent: 49.5, avgPriceIndex: 0.86, competitorStrength: [{ brand: "Vestel", strength: 4 }, { brand: "Regal", strength: 6 }, { brand: "Profilo", strength: 3 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Kayısı hasadı sonrası Ağu–Eki alım artışı", dealerCount: 31 },
  { id: "erzurum", name: "Erzurum", populationTier: "tier-3", marketSharePercent: 48.7, avgPriceIndex: 0.84, competitorStrength: [{ brand: "Vestel", strength: 4 }, { brand: "Regal", strength: 7 }, { brand: "Profilo", strength: 3 }, { brand: "Samsung", strength: 2 }], seasonalPattern: "Kış uzun, klima talebi düşük, beyaz eşya bayram pik", dealerCount: 26 },
  { id: "van", name: "Van", populationTier: "tier-3", marketSharePercent: 47.4, avgPriceIndex: 0.82, competitorStrength: [{ brand: "Vestel", strength: 4 }, { brand: "Regal", strength: 8 }, { brand: "Profilo", strength: 3 }, { brand: "Samsung", strength: 1 }], seasonalPattern: "Düğün sezonu Haz–Eyl güçlü, fiyat hassasiyeti yüksek", dealerCount: 23 },
  { id: "manisa", name: "Manisa", populationTier: "tier-3", marketSharePercent: 28.4, avgPriceIndex: 0.95, competitorStrength: [{ brand: "Vestel", strength: 9 }, { brand: "Profilo", strength: 4 }, { brand: "Regal", strength: 4 }, { brand: "Bosch", strength: 3 }], seasonalPattern: "Vestel fabrikası şehri — Vestel burada çok güçlü", dealerCount: 34 },
  { id: "tekirdag", name: "Tekirdağ", populationTier: "tier-3", marketSharePercent: 43.8, avgPriceIndex: 0.97, competitorStrength: [{ brand: "Vestel", strength: 7 }, { brand: "Profilo", strength: 6 }, { brand: "Bosch", strength: 5 }, { brand: "Samsung", strength: 4 }], seasonalPattern: "Sanayi bölgesi, yıl boyunca stabil talep", dealerCount: 29 },
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
  { id: "national-market-share", label: "Ulusal Pazar Payı (Toplam)", value: "%45.2", target: "%48.0" },
  { id: "buzdolabi-share", label: "Buzdolabı Pazar Payı", value: "%47.8", target: "%50.0" },
  { id: "camasir-share", label: "Çamaşır Makinesi Pazar Payı", value: "%44.1", target: "%47.0" },
  { id: "avg-margin", label: "Ortalama Brüt Marj", value: "%30.2", target: "%31.0" },
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
  [/Premium Blender/g, "Premium Blender"],
  [/Kombi No-Frost/g, "Combination No-Frost"],
  [/Kombi Premium/g, "Combination Premium"],
  [/Kombi/g, "Combination"],
  [/Mini Buzdolabı/g, "Mini Refrigerator"],
  [/Mini buzdolabı/g, "Mini Refrigerator"],
  [/Mini/g, "Mini"],
  [/Slim İnverter/g, "Slim Inverter"],
  [/Slim/g, "Slim"],
  [/Giriş Seviye/g, "Entry Level"],
  [/Kompakt/g, "Compact"],
  [/Premium Plus/g, "Premium Plus"],
  [/Ankastre Mikrodalga/g, "Built-in Microwave"],
  [/Mikrodalga Fırın/g, "Microwave Oven"],
  [/Otomatik Espresso/g, "Automatic Espresso"],
  [/Çiftli Türk Kahvesi/g, "Double Turkish Coffee"],
  [/Premium Kablosuz Süpürge/g, "Premium Cordless Vacuum"],
  [/Premium Çay Makinesi/g, "Premium Tea Maker"],
  [/Ekonomik Klima/g, "Economy Air Conditioner"],
  [/Ekonomik Ocak/g, "Economy Cooktop"],
  [/Ekonomik Set Üstü/g, "Economy Freestanding"],
  [/Ekonomik Fırın/g, "Economy Oven"],
  [/Ekonomik Bulaşık/g, "Economy Dishwasher"],
  [/Kurutmalı Premium/g, "Washer-Dryer Premium"],
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

const PROMO_TYPE_EN: Record<string, string> = {
  indirim: "Discount",
  taksit: "Installment",
  "trade-in": "Trade-in",
  paket: "Bundle",
  hediye: "Gift",
  bolgesel: "Regional",
};

export function getPromotionTypeLabel(code: string, lang: Lang): string {
  if (lang === "tr") return code;
  return PROMO_TYPE_EN[code] ?? code;
}

const CITY_NAME_EN: Record<string, string> = {
  istanbul: "Istanbul",
  ankara: "Ankara",
  izmir: "Izmir",
  bursa: "Bursa",
  antalya: "Antalya",
  adana: "Adana",
  konya: "Konya",
  gaziantep: "Gaziantep",
  mersin: "Mersin",
  kayseri: "Kayseri",
  diyarbakir: "Diyarbakir",
  samsun: "Samsun",
  trabzon: "Trabzon",
  eskisehir: "Eskisehir",
  denizli: "Denizli",
  malatya: "Malatya",
  erzurum: "Erzurum",
  van: "Van",
  manisa: "Manisa",
  tekirdag: "Tekirdag",
};

export function getCityName(city: CityData, lang: Lang): string {
  if (lang === "tr") return city.name;
  return CITY_NAME_EN[city.id] ?? city.name;
}

export function getCalendarEntryName(entry: CalendarEntry, lang: Lang): string {
  if (lang === "tr") return entry.campaignName;
  return CALENDAR_NAME_EN[entry.id] ?? entry.campaignName;
}
