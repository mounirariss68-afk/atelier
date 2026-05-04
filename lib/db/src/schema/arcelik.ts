import {
  pgTable,
  text,
  serial,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  index,
} from "drizzle-orm/pg-core";

export const arcelikProductsTable = pgTable(
  "arcelik_products",
  {
    id: text("id").primaryKey(),
    modelCode: text("model_code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    priceTier: text("price_tier").notNull(),
    tsfPrice: integer("tsf_price").notNull(),
    dealerCost: integer("dealer_cost").notNull(),
    marginPercent: doublePrecision("margin_percent").notNull(),
    energyClass: text("energy_class").notNull(),
    features: jsonb("features").notNull().$type<string[]>(),
    sourceId: text("source_id").notNull(),
    priceDate: text("price_date").notNull(),
    dataProvenance: text("data_provenance").notNull().default("manual-verified"),
    scrapedAt: text("scraped_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_arcelik_products_category").on(t.category),
    index("idx_arcelik_products_price_tier").on(t.priceTier),
  ],
);

export const arcelikCompetitorPricesTable = pgTable(
  "arcelik_competitor_prices",
  {
    id: text("id").primaryKey(),
    brand: text("brand").notNull(),
    competitorModel: text("competitor_model").notNull(),
    category: text("category").notNull(),
    competitorPrice: integer("competitor_price").notNull(),
    arcelikEquivalentId: text("arcelik_equivalent_id").notNull(),
    priceDeltaPercent: doublePrecision("price_delta_percent").notNull(),
    positioning: text("positioning").notNull(),
    note: text("note").notNull(),
    sourceId: text("source_id").notNull(),
    priceDate: text("price_date").notNull(),
    dataProvenance: text("data_provenance").notNull().default("manual-verified"),
    scrapedAt: text("scraped_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_arcelik_cp_brand").on(t.brand),
    index("idx_arcelik_cp_category").on(t.category),
  ],
);

export const arcelikDataSourcesTable = pgTable("arcelik_data_sources", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  nameEn: text("name_en").notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceDate: text("source_date").notNull(),
  description: text("description").notNull(),
  descriptionEn: text("description_en").notNull(),
});

export const arcelikCitiesTable = pgTable("arcelik_cities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  populationTier: text("population_tier").notNull(),
  marketSharePercent: doublePrecision("market_share_percent").notNull(),
  avgPriceIndex: doublePrecision("avg_price_index").notNull(),
  competitorStrength: jsonb("competitor_strength").notNull().$type<{ brand: string; strength: number }[]>(),
  seasonalPattern: text("seasonal_pattern").notNull(),
  dealerCount: integer("dealer_count").notNull(),
});

export const arcelikDealersTable = pgTable(
  "arcelik_dealers",
  {
    id: text("id").primaryKey(),
    storeName: text("store_name").notNull(),
    city: text("city").notNull(),
    district: text("district").notNull(),
    tier: text("tier").notNull(),
    complianceScore: integer("compliance_score").notNull(),
    monthlySalesTarget: integer("monthly_sales_target").notNull(),
    currentProgress: integer("current_progress").notNull(),
    earnedCommission: integer("earned_commission").notNull(),
    productMix: jsonb("product_mix").notNull().$type<Record<string, number>>(),
    stockLevels: jsonb("stock_levels").notNull().$type<Record<string, number>>(),
    pendingOrders: integer("pending_orders").notNull(),
    lastOrderDate: text("last_order_date").notNull(),
  },
  (t) => [index("idx_arcelik_dealers_city").on(t.city)],
);

export const arcelikCampaignsTable = pgTable("arcelik_campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  targetSegment: text("target_segment").notNull(),
  eligibleCategories: jsonb("eligible_categories").notNull().$type<string[]>(),
  promotionType: text("promotion_type").notNull(),
  discountDetail: text("discount_detail").notNull(),
  headline: text("headline").notNull(),
  bodyCopy: text("body_copy").notNull(),
  messagingTone: text("messaging_tone").notNull(),
  targetCities: jsonb("target_cities").notNull().$type<string[]>(),
  durationPattern: text("duration_pattern").notNull(),
  projectedImpact: jsonb("projected_impact").notNull().$type<{ marketShareLift: string; revenueDelta: string; marginEffect: string }>(),
  bannerDescription: text("banner_description").notNull(),
  dealerPosMessaging: text("dealer_pos_messaging").notNull(),
  dealerSmsNotification: text("dealer_sms_notification").notNull(),
});

export const arcelikCalendarTable = pgTable("arcelik_calendar", {
  id: text("id").primaryKey(),
  brand: text("brand").notNull(),
  campaignName: text("campaign_name").notNull(),
  startMonth: integer("start_month").notNull(),
  endMonth: integer("end_month").notNull(),
  categories: jsonb("categories").notNull().$type<string[]>(),
  type: text("type").notNull(),
});

export const arcelikKpiBenchmarksTable = pgTable("arcelik_kpi_benchmarks", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  target: text("target").notNull(),
});
