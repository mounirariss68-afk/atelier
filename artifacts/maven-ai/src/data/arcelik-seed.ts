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
