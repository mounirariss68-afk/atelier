import {
  pgTable,
  text,
  serial,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
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

export const arcelikPriceHistoryTable = pgTable(
  "arcelik_price_history",
  {
    id: serial("id").primaryKey(),
    recordType: text("record_type").notNull(),
    referenceId: text("reference_id").notNull(),
    brand: text("brand").notNull(),
    modelCode: text("model_code").notNull(),
    price: integer("price").notNull(),
    previousPrice: integer("previous_price"),
    priceChangePercent: doublePrecision("price_change_percent"),
    source: text("source").notNull(),
    scrapeRunId: text("scrape_run_id").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_price_history_ref").on(t.referenceId),
    index("idx_price_history_brand").on(t.brand),
    index("idx_price_history_recorded").on(t.recordedAt),
    index("idx_price_history_type").on(t.recordType),
  ],
);

export const arcelikMarketplacePricesTable = pgTable(
  "arcelik_marketplace_prices",
  {
    id: serial("id").primaryKey(),
    marketplace: text("marketplace").notNull(),
    marketplaceProductId: text("marketplace_product_id").notNull(),
    productUrl: text("product_url").notNull(),
    brand: text("brand").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    price: integer("price").notNull(),
    capacityLiters: integer("capacity_liters"),
    capacityKg: doublePrecision("capacity_kg"),
    energyClass: text("energy_class"),
    arcelikProductId: text("arcelik_product_id"),
    competitorPriceId: text("competitor_price_id"),
    matchConfidence: doublePrecision("match_confidence"),
    scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
    scrapeRunId: text("scrape_run_id").notNull(),
  },
  (t) => [
    uniqueIndex("uniq_mp_prices_marketplace_pid").on(
      t.marketplace,
      t.marketplaceProductId,
    ),
    index("idx_mp_prices_marketplace").on(t.marketplace),
    index("idx_mp_prices_brand").on(t.brand),
    index("idx_mp_prices_category").on(t.category),
    index("idx_mp_prices_arcelik_product").on(t.arcelikProductId),
    index("idx_mp_prices_competitor").on(t.competitorPriceId),
    index("idx_mp_prices_scraped").on(t.scrapedAt),
    index("idx_mp_prices_run").on(t.scrapeRunId),
  ],
);

export const arcelikProductEquivalencesTable = pgTable(
  "arcelik_product_equivalences",
  {
    id: serial("id").primaryKey(),
    arcelikProductId: text("arcelik_product_id").notNull(),
    competitorBrand: text("competitor_brand").notNull(),
    competitorModel: text("competitor_model").notNull(),
    competitorMarketplaceId: integer("competitor_marketplace_id"),
    competitorPriceRecordId: text("competitor_price_record_id"),
    matchConfidence: doublePrecision("match_confidence").notNull(),
    matchBasis: jsonb("match_basis").notNull().$type<{
      reasons: string[];
      categoryMatch: boolean;
      capacityDeltaPercent?: number;
      energyClassMatch?: boolean;
      priceDeltaPercent?: number;
      tokenOverlap?: number;
    }>(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_equiv_arcelik").on(t.arcelikProductId),
    index("idx_equiv_brand").on(t.competitorBrand),
    index("idx_equiv_confidence").on(t.matchConfidence),
  ],
);

export const arcelikProductSpecsTable = pgTable(
  "arcelik_product_specs",
  {
    id: serial("id").primaryKey(),
    marketplacePriceId: integer("marketplace_price_id").notNull(),
    marketplace: text("marketplace").notNull(),
    marketplaceProductId: text("marketplace_product_id").notNull(),
    capacityLiters: integer("capacity_liters"),
    capacityKg: doublePrecision("capacity_kg"),
    energyClass: text("energy_class"),
    productType: text("product_type"),
    widthCm: doublePrecision("width_cm"),
    heightCm: doublePrecision("height_cm"),
    depthCm: doublePrecision("depth_cm"),
    noiseLevelDb: integer("noise_level_db"),
    spinRpm: integer("spin_rpm"),
    rawSpecs: jsonb("raw_specs").$type<Record<string, string>>(),
    extractedAt: timestamp("extracted_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_specs_marketplace_pid").on(
      t.marketplace,
      t.marketplaceProductId,
    ),
    index("idx_specs_mp_price").on(t.marketplacePriceId),
  ],
);

export const arcelikMarketplacePriceHistoryTable = pgTable(
  "arcelik_marketplace_price_history",
  {
    id: serial("id").primaryKey(),
    marketplace: text("marketplace").notNull(),
    marketplaceProductId: text("marketplace_product_id").notNull(),
    brand: text("brand").notNull(),
    category: text("category").notNull(),
    price: integer("price").notNull(),
    previousPrice: integer("previous_price"),
    priceChangePercent: doublePrecision("price_change_percent"),
    arcelikProductId: text("arcelik_product_id"),
    scrapeRunId: text("scrape_run_id").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_mp_history_marketplace").on(t.marketplace),
    index("idx_mp_history_pid").on(t.marketplaceProductId),
    index("idx_mp_history_brand").on(t.brand),
    index("idx_mp_history_recorded").on(t.recordedAt),
    index("idx_mp_history_run").on(t.scrapeRunId),
    index("idx_mp_history_arcelik_product").on(t.arcelikProductId),
  ],
);

export const arcelikScrapeLogsTable = pgTable(
  "arcelik_scrape_logs",
  {
    id: text("id").primaryKey(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    scrapedCounts: jsonb("scraped_counts").$type<Record<string, number>>(),
    matchedProducts: integer("matched_products"),
    matchedCompetitors: integer("matched_competitors"),
    totalProducts: integer("total_products"),
    totalCompetitors: integer("total_competitors"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("idx_scrape_logs_status").on(t.status),
    index("idx_scrape_logs_started").on(t.startedAt),
  ],
);
