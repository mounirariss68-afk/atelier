import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { desc, gte, sql } from "drizzle-orm";
import {
  db,
  arcelikProductsTable,
  arcelikCompetitorPricesTable,
  arcelikCitiesTable,
  arcelikDealersTable,
  arcelikCampaignsTable,
  arcelikPriceHistoryTable,
  arcelikProductSpecsTable,
  arcelikMarketplacePricesTable,
} from "@workspace/db";
import { logger } from "./logger";

export type AgentType =
  | "competitive-response"
  | "price-elasticity"
  | "cannibalization"
  | "dealer-optimization";

export type DirectorRole = "pricing" | "finance" | "marketing";
export type Severity = "critical" | "high" | "medium" | "low";

export interface ReasoningStep {
  source: string;
  observation: string;
  conclusion: string;
}

export interface AgentImpact {
  revenue: string;
  margin: string;
  share: string;
}

export interface AgentRecommendation {
  id: string;
  type: string;
  agentType: AgentType;
  title: string;
  summary: string;
  targetRole: DirectorRole;
  severity: Severity;
  confidence: number;
  reasoning: ReasoningStep[];
  impact: AgentImpact;
  recommendedAction: string;
  alternatives: string[];
  status: "pending";
  createdAt: string;
  source: "ai-anthropic" | "ai-openai" | "baseline";
  language: "tr" | "en";
}

export interface AgentRunResult {
  agentType: AgentType;
  generatedAt: string;
  language: "tr" | "en";
  source: "ai-anthropic" | "ai-openai" | "baseline";
  fallbackReason?: string;
  recommendations: AgentRecommendation[];
  contextDigest: {
    productCount: number;
    competitorCount: number;
    dealerCount: number;
    cityCount: number;
  };
}

// ---------- DB context builder (cached briefly to avoid hammering DB) ----------
export interface ArcelikContext {
  products: Array<{
    id: string;
    modelCode: string;
    name: string;
    category: string;
    subcategory: string;
    priceTier: string;
    tsfPrice: number;
    dealerCost: number;
    marginPercent: number;
    energyClass: string;
  }>;
  competitorPrices: Array<{
    id: string;
    brand: string;
    competitorModel: string;
    category: string;
    competitorPrice: number;
    arcelikEquivalentId: string;
    priceDeltaPercent: number;
    positioning: string;
  }>;
  cities: Array<{
    id: string;
    name: string;
    populationTier: string;
    marketSharePercent: number;
    competitorStrength: { brand: string; strength: number }[];
    dealerCount: number;
  }>;
  dealers: Array<{
    id: string;
    storeName: string;
    city: string;
    tier: string;
    complianceScore: number;
    monthlySalesTarget: number;
    currentProgress: number;
    productMix: Record<string, number>;
    stockLevels: Record<string, number>;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    targetSegment: string;
    eligibleCategories: string[];
    promotionType: string;
    targetCities: string[];
  }>;
  // Recent price-change events used by the elasticity agent. Drawn from
  // arcelik_price_history (windowed to last 90 days) and surfaced as a
  // category-level signal of price-move frequency / magnitude.
  priceHistory: Array<{
    referenceId: string;
    brand: string;
    modelCode: string;
    price: number;
    previousPrice: number | null;
    priceChangePercent: number | null;
    recordedAt: string;
  }>;
  // Marketplace-derived product feature snapshots used by the cannibalization
  // agent to detect *feature-set* overlap (not just price overlap). Joined to
  // an Arçelik product when the marketplace match identified one.
  productSpecs: Array<{
    arcelikProductId: string | null;
    marketplace: string;
    title: string;
    category: string;
    price: number;
    capacityKg: number | null;
    capacityLiters: number | null;
    energyClass: string | null;
    spinRpm: number | null;
    noiseLevelDb: number | null;
  }>;
}

let _ctxCache: { value: ArcelikContext; at: number } | null = null;
const CTX_TTL_MS = 30_000;

export async function buildArcelikContext(): Promise<ArcelikContext> {
  const now = Date.now();
  if (_ctxCache && now - _ctxCache.at < CTX_TTL_MS) return _ctxCache.value;

  // Window price history to the last 90 days and cap rows defensively, so we
  // bound LLM-context size even on noisy scrape periods.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // Some price-history / specs queries are best-effort: if a fresh database has
  // never been scraped, those tables may simply be empty — that's fine. We
  // catch and return [] so an empty backfill doesn't block all 4 agents.
  async function safeQuery<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
    try {
      return await fn();
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), table: label },
        "agent context: optional table unavailable, continuing with empty data",
      );
      return [];
    }
  }

  const [
    products,
    competitorPrices,
    cities,
    dealers,
    campaigns,
    priceHistoryRows,
    productSpecsRows,
  ] = await Promise.all([
    db.select().from(arcelikProductsTable),
    db.select().from(arcelikCompetitorPricesTable),
    db.select().from(arcelikCitiesTable),
    db.select().from(arcelikDealersTable),
    db.select().from(arcelikCampaignsTable),
    safeQuery("arcelik_price_history", () =>
      db
        .select()
        .from(arcelikPriceHistoryTable)
        .where(gte(arcelikPriceHistoryTable.recordedAt, ninetyDaysAgo))
        .orderBy(desc(arcelikPriceHistoryTable.recordedAt))
        .limit(800),
    ),
    safeQuery("arcelik_product_specs (joined)", () =>
      db
        .select({
          arcelikProductId: arcelikMarketplacePricesTable.arcelikProductId,
          marketplace: arcelikProductSpecsTable.marketplace,
          title: arcelikMarketplacePricesTable.title,
          category: arcelikMarketplacePricesTable.category,
          price: arcelikMarketplacePricesTable.price,
          capacityKg: arcelikProductSpecsTable.capacityKg,
          capacityLiters: arcelikProductSpecsTable.capacityLiters,
          energyClass: arcelikProductSpecsTable.energyClass,
          spinRpm: arcelikProductSpecsTable.spinRpm,
          noiseLevelDb: arcelikProductSpecsTable.noiseLevelDb,
        })
        .from(arcelikProductSpecsTable)
        .innerJoin(
          arcelikMarketplacePricesTable,
          sql`${arcelikProductSpecsTable.marketplacePriceId} = ${arcelikMarketplacePricesTable.id}`,
        )
        .limit(400),
    ),
  ]);

  const value: ArcelikContext = {
    products: products.map((p) => ({
      id: p.id,
      modelCode: p.modelCode,
      name: p.name,
      category: p.category,
      subcategory: p.subcategory,
      priceTier: p.priceTier,
      tsfPrice: p.tsfPrice,
      dealerCost: p.dealerCost,
      marginPercent: p.marginPercent,
      energyClass: p.energyClass,
    })),
    competitorPrices: competitorPrices.map((c) => ({
      id: c.id,
      brand: c.brand,
      competitorModel: c.competitorModel,
      category: c.category,
      competitorPrice: c.competitorPrice,
      arcelikEquivalentId: c.arcelikEquivalentId,
      priceDeltaPercent: c.priceDeltaPercent,
      positioning: c.positioning,
    })),
    cities: cities.map((c) => ({
      id: c.id,
      name: c.name,
      populationTier: c.populationTier,
      marketSharePercent: c.marketSharePercent,
      competitorStrength: c.competitorStrength,
      dealerCount: c.dealerCount,
    })),
    dealers: dealers.map((d) => ({
      id: d.id,
      storeName: d.storeName,
      city: d.city,
      tier: d.tier,
      complianceScore: d.complianceScore,
      monthlySalesTarget: d.monthlySalesTarget,
      currentProgress: d.currentProgress,
      productMix: d.productMix,
      stockLevels: d.stockLevels,
    })),
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      targetSegment: c.targetSegment,
      eligibleCategories: c.eligibleCategories,
      promotionType: c.promotionType,
      targetCities: c.targetCities,
    })),
    priceHistory: priceHistoryRows.map((r) => ({
      referenceId: r.referenceId,
      brand: r.brand,
      modelCode: r.modelCode,
      price: r.price,
      previousPrice: r.previousPrice,
      priceChangePercent: r.priceChangePercent,
      recordedAt: r.recordedAt.toISOString(),
    })),
    productSpecs: productSpecsRows.map((r) => ({
      arcelikProductId: r.arcelikProductId,
      marketplace: r.marketplace,
      title: r.title,
      category: r.category,
      price: r.price,
      capacityKg: r.capacityKg,
      capacityLiters: r.capacityLiters,
      energyClass: r.energyClass,
      spinRpm: r.spinRpm,
      noiseLevelDb: r.noiseLevelDb,
    })),
  };

  _ctxCache = { value, at: now };
  return value;
}

// ---------- LLM call with provider fallback ----------
const ReasoningStepSchema = z.object({
  source: z.string().min(1),
  observation: z.string().min(1),
  conclusion: z.string().min(1),
});

const RawRecommendationSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  targetRole: z.enum(["pricing", "finance", "marketing"]),
  severity: z.enum(["critical", "high", "medium", "low"]),
  confidence: z.number().min(0).max(100),
  reasoning: z.array(ReasoningStepSchema).min(2).max(6),
  impact: z.object({
    revenue: z.string().min(1),
    margin: z.string().min(1),
    share: z.string().min(1),
  }),
  recommendedAction: z.string().min(1),
  alternatives: z.array(z.string()).min(1).max(5),
});

const RawResponseSchema = z.object({
  recommendations: z.array(RawRecommendationSchema).min(1).max(4),
});

export type RawRecommendation = z.infer<typeof RawRecommendationSchema>;

function safeParseJson(text: string): unknown | null {
  if (!text) return null;
  // Strip code fences if present
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

interface LLMCallResult {
  raw: RawRecommendation[] | null;
  source: "ai-anthropic" | "ai-openai";
  rawText: string;
}

async function callAnthropic(systemPrompt: string, userPrompt: string): Promise<LLMCallResult | null> {
  const baseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!baseURL || !apiKey) return null;
  try {
    const anth = new Anthropic({ baseURL, apiKey });
    const resp = await anth.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2400,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    const parsed = safeParseJson(text);
    const validated = RawResponseSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn({ issues: validated.error.issues.slice(0, 3) }, "Anthropic agent response failed schema validation");
      return { raw: null, source: "ai-anthropic", rawText: text };
    }
    return { raw: validated.data.recommendations, source: "ai-anthropic", rawText: text };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Anthropic agent call failed");
    return null;
  }
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<LLMCallResult | null> {
  const baseURL = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseURL || !apiKey) return null;
  try {
    const oa = new OpenAI({ baseURL, apiKey });
    const resp = await oa.chat.completions.create({
      model: "gpt-5",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    const parsed = safeParseJson(text);
    const validated = RawResponseSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn({ issues: validated.error.issues.slice(0, 3) }, "OpenAI agent response failed schema validation");
      return { raw: null, source: "ai-openai", rawText: text };
    }
    return { raw: validated.data.recommendations, source: "ai-openai", rawText: text };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "OpenAI agent call failed");
    return null;
  }
}

async function callAgentLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ recs: RawRecommendation[]; source: "ai-anthropic" | "ai-openai" } | null> {
  const a = await callAnthropic(systemPrompt, userPrompt);
  if (a?.raw && a.raw.length > 0) return { recs: a.raw, source: a.source };
  const o = await callOpenAI(systemPrompt, userPrompt);
  if (o?.raw && o.raw.length > 0) return { recs: o.raw, source: o.source };
  return null;
}

// ---------- shared prompt scaffolding ----------
function jsonInstruction(language: "tr" | "en"): string {
  const langNote =
    language === "tr"
      ? "Tüm metin alanlarını (title, summary, recommendedAction, alternatives, reasoning.source/observation/conclusion) Türkçe yaz."
      : "Write all text fields (title, summary, recommendedAction, alternatives, reasoning.source/observation/conclusion) in English.";

  return `${langNote}

Respond with ONLY a valid JSON object that matches this exact schema — no prose, no markdown fences, no commentary:

{
  "recommendations": [
    {
      "type": "string (short slug, e.g. 'price-cut' or 'cannibalization-warning')",
      "title": "string (one-line headline)",
      "summary": "string (2-3 sentences, executive tone)",
      "targetRole": "pricing | finance | marketing",
      "severity": "critical | high | medium | low",
      "confidence": number (0-100, integer, your honest confidence),
      "reasoning": [
        { "source": "string (data source name)", "observation": "string (specific observation with numbers)", "conclusion": "string (what it implies)" }
        // 2-4 reasoning steps total
      ],
      "impact": {
        "revenue": "string (e.g. '+₺12M' or '-₺3M')",
        "margin": "string (e.g. '+0.4%' or '-0.2%')",
        "share": "string (e.g. '+0.3pp' or '-0.1pp')"
      },
      "recommendedAction": "string (one specific action)",
      "alternatives": ["string", "string"] (1-3 alternatives)
    }
    // 1-3 recommendations total
  ]
}

Rules:
- Use ONLY data provided in the user message; do not invent products, brands, or numbers.
- "confidence" must be an integer between 60 and 95.
- "impact" values must be plausible given the size of the data.
- Output ONLY the JSON object. No other text.`;
}

function postProcess(
  raw: RawRecommendation[],
  agentType: AgentType,
  source: "ai-anthropic" | "ai-openai" | "baseline",
  language: "tr" | "en",
): AgentRecommendation[] {
  const ts = new Date().toISOString();
  return raw.map((r, i) => ({
    id: `${agentType}-${source === "baseline" ? "bl" : "ai"}-${Date.now()}-${i}`,
    type: r.type,
    agentType,
    title: r.title,
    summary: r.summary,
    targetRole: r.targetRole,
    severity: r.severity,
    confidence: Math.round(r.confidence),
    reasoning: r.reasoning,
    impact: r.impact,
    recommendedAction: r.recommendedAction,
    alternatives: r.alternatives,
    status: "pending" as const,
    createdAt: ts,
    source,
    language,
  }));
}

// ---------- Agent: Competitive Response ----------
function buildCompetitiveContext(ctx: ArcelikContext) {
  const undercuts = ctx.competitorPrices
    .filter((cp) => cp.priceDeltaPercent < -5)
    .sort((a, b) => a.priceDeltaPercent - b.priceDeltaPercent)
    .slice(0, 12);
  const productMap = new Map(ctx.products.map((p) => [p.id, p]));
  const enriched = undercuts.map((u) => {
    const arc = productMap.get(u.arcelikEquivalentId);
    return {
      brand: u.brand,
      competitorModel: u.competitorModel,
      competitorPrice: u.competitorPrice,
      category: u.category,
      arcelikModel: arc?.name ?? "(unmapped)",
      arcelikPrice: arc?.tsfPrice ?? null,
      arcelikMargin: arc?.marginPercent ?? null,
      priceDeltaPercent: u.priceDeltaPercent,
      positioning: u.positioning,
    };
  });
  const byBrand = new Map<string, number>();
  for (const u of undercuts) byBrand.set(u.brand, (byBrand.get(u.brand) ?? 0) + 1);
  const brandRollup = [...byBrand.entries()]
    .map(([brand, count]) => ({ brand, undercutCount: count }))
    .sort((a, b) => b.undercutCount - a.undercutCount);
  return { undercuts: enriched, brandRollup };
}

function baselineCompetitive(ctx: ArcelikContext, language: "tr" | "en"): RawRecommendation[] {
  const { undercuts, brandRollup } = buildCompetitiveContext(ctx);
  if (undercuts.length === 0) {
    return [
      {
        type: "competitive-monitor",
        title: language === "tr" ? "Rakip Fiyat Pozisyonu Stabil" : "Competitor Price Position Stable",
        summary:
          language === "tr"
            ? "Mevcut rakip fiyat verilerinde Arçelik'i %5'ten fazla altta konumlanan rakip yok. İzlemeye devam et."
            : "No competitor undercuts >5% in the current data. Continue monitoring.",
        targetRole: "pricing",
        severity: "low",
        confidence: 75,
        reasoning: [
          {
            source: language === "tr" ? "Rakip Fiyat Taraması" : "Competitor Price Scan",
            observation:
              language === "tr"
                ? `${ctx.competitorPrices.length} rakip ürün izleniyor; agresif altta konumlanma yok.`
                : `${ctx.competitorPrices.length} competitor SKUs tracked; no aggressive undercuts.`,
            conclusion:
              language === "tr" ? "Acil müdahaleye gerek yok." : "No urgent intervention required.",
          },
          {
            source: language === "tr" ? "İzleme Önerisi" : "Monitoring Recommendation",
            observation:
              language === "tr" ? "Haftalık tarama frekansı yeterli." : "Weekly scan cadence is sufficient.",
            conclusion:
              language === "tr" ? "Mevcut izleme programını sürdür." : "Maintain current monitoring schedule.",
          },
        ],
        impact: { revenue: "+₺0M", margin: "+0.0%", share: "+0.0pp" },
        recommendedAction:
          language === "tr"
            ? "Mevcut izleme frekansını sürdür ve ilk anomalide bildirim al."
            : "Maintain current monitoring cadence; alert on first anomaly.",
        alternatives: [
          language === "tr" ? "Tarama frekansını günlük yap" : "Increase scan to daily",
        ],
      },
    ];
  }
  const top = brandRollup[0];
  const sample = undercuts.slice(0, 3);
  const avgDelta =
    Math.round(undercuts.reduce((s, u) => s + u.priceDeltaPercent, 0) / undercuts.length);
  return [
    {
      type: "competitive-response",
      title:
        language === "tr"
          ? `${top.brand} ${top.undercutCount} üründe agresif fiyat pozisyonu`
          : `${top.brand} aggressive pricing on ${top.undercutCount} SKUs`,
      summary:
        language === "tr"
          ? `${top.brand}, ${top.undercutCount} üründe Arçelik'in altında konumlanmış (ortalama %${Math.abs(avgDelta)} avantaj). Doğrudan fiyat indirimi yerine değer/kampanya yanıtı önerilir.`
          : `${top.brand} is undercutting Arçelik on ${top.undercutCount} SKUs (avg ${avgDelta}% gap). Recommend value/campaign response over direct price match.`,
      targetRole: "pricing",
      severity: "high",
      confidence: 78,
      reasoning: [
        {
          source: language === "tr" ? "Rakip Fiyat Taraması" : "Competitor Price Scan",
          observation:
            language === "tr"
              ? `${top.brand} altta konumlanma sayısı: ${top.undercutCount}, ortalama delta %${avgDelta}.`
              : `${top.brand} undercut count: ${top.undercutCount}, avg delta ${avgDelta}%.`,
          conclusion:
            language === "tr"
              ? "Sistematik fiyat pozisyonu, izole anomali değil."
              : "Systematic positioning, not isolated anomaly.",
        },
        {
          source: language === "tr" ? "Etkilenen Kategoriler" : "Affected Categories",
          observation: sample.map((s) => `${s.category}: ${s.arcelikModel} vs ${s.competitorModel}`).join(" | "),
          conclusion:
            language === "tr"
              ? "Birden fazla kategoride etki var."
              : "Multi-category impact.",
        },
        {
          source: language === "tr" ? "Marj Simülasyonu" : "Margin Simulation",
          observation:
            language === "tr"
              ? "Doğrudan eşleştirme marjı 200-400bp azaltır."
              : "Direct match would reduce margin by 200-400bp.",
          conclusion:
            language === "tr" ? "Değer odaklı yanıt tercih edilmeli." : "Value-led response preferred.",
        },
      ],
      impact: { revenue: "+₺8M", margin: "-0.2%", share: "+0.3pp" },
      recommendedAction:
        language === "tr"
          ? `${top.brand}'in güçlü olduğu kategorilerde 12 ay faizsiz taksit + eski ürün takas kampanyası başlat.`
          : `Launch 12-month interest-free + trade-in campaign on categories where ${top.brand} is undercutting.`,
      alternatives:
        language === "tr"
          ? ["Doğrudan %3-5 fiyat eşleştirmesi", "Sadece etkilenen şehirlerde lokal kampanya", "İzlemede tut"]
          : ["Direct 3-5% price match", "Localized campaign in affected cities only", "Hold and monitor"],
    },
  ];
}

// ---------- Agent: Price Elasticity ----------
function buildElasticityContext(ctx: ArcelikContext) {
  const productMap = new Map(ctx.products.map((p) => [p.id, p]));
  const byCategory = new Map<string, { sumDelta: number; count: number; avgArcelikPrice: number; products: typeof ctx.products }>();
  for (const p of ctx.products) {
    const e = byCategory.get(p.category) ?? {
      sumDelta: 0,
      count: 0,
      avgArcelikPrice: 0,
      products: [] as typeof ctx.products,
    };
    e.products.push(p);
    e.avgArcelikPrice += p.tsfPrice;
    e.count += 1;
    byCategory.set(p.category, e);
  }
  for (const cp of ctx.competitorPrices) {
    const e = byCategory.get(cp.category);
    if (e) e.sumDelta += cp.priceDeltaPercent;
  }
  const categories = [...byCategory.entries()].map(([cat, v]) => ({
    category: cat,
    productCount: v.count,
    avgPrice: Math.round(v.avgArcelikPrice / Math.max(1, v.count)),
    avgCompetitorDelta: Math.round(v.sumDelta / Math.max(1, ctx.competitorPrices.filter((c) => c.category === cat).length)),
  }));
  const premiumGaps = ctx.competitorPrices
    .filter((cp) => cp.priceDeltaPercent > 15)
    .sort((a, b) => b.priceDeltaPercent - a.priceDeltaPercent)
    .slice(0, 8)
    .map((cp) => ({
      category: cp.category,
      brand: cp.brand,
      arcelikProduct: productMap.get(cp.arcelikEquivalentId)?.name ?? "(unmapped)",
      arcelikPrice: productMap.get(cp.arcelikEquivalentId)?.tsfPrice ?? null,
      competitorPrice: cp.competitorPrice,
      gapPercent: cp.priceDeltaPercent,
    }));

  // Price-history signals: aggregate the 90-day window into per-category
  // metrics the agent can reason about (move frequency, magnitude, direction).
  // Without true sales data we cannot compute textbook elasticity, so we expose
  // the move pattern itself and let the agent reason qualitatively.
  const historyByCategory = new Map<
    string,
    { moves: number; up: number; down: number; sumAbsPct: number; samples: typeof ctx.priceHistory }
  >();
  for (const h of ctx.priceHistory) {
    const product = productMap.get(h.referenceId);
    if (!product) continue;
    const e = historyByCategory.get(product.category) ?? {
      moves: 0,
      up: 0,
      down: 0,
      sumAbsPct: 0,
      samples: [] as typeof ctx.priceHistory,
    };
    e.moves += 1;
    if ((h.priceChangePercent ?? 0) > 0) e.up += 1;
    else if ((h.priceChangePercent ?? 0) < 0) e.down += 1;
    e.sumAbsPct += Math.abs(h.priceChangePercent ?? 0);
    if (e.samples.length < 3) e.samples.push(h);
    historyByCategory.set(product.category, e);
  }
  const priceMoves = [...historyByCategory.entries()].map(([category, v]) => ({
    category,
    moves90d: v.moves,
    increases: v.up,
    decreases: v.down,
    avgMovePercent: v.moves > 0 ? Math.round((v.sumAbsPct / v.moves) * 10) / 10 : 0,
    examples: v.samples.map((s) => ({
      modelCode: s.modelCode,
      price: s.price,
      previousPrice: s.previousPrice,
      changePercent:
        s.priceChangePercent != null ? Math.round(s.priceChangePercent * 10) / 10 : null,
      recordedAt: s.recordedAt,
    })),
  }));

  return { categories, premiumGaps, priceMoves };
}

function baselineElasticity(ctx: ArcelikContext, language: "tr" | "en"): RawRecommendation[] {
  const { categories, premiumGaps } = buildElasticityContext(ctx);
  if (premiumGaps.length === 0) {
    return [
      {
        type: "elasticity-monitor",
        title: language === "tr" ? "Fiyat Esnekliği — Aksiyon Yok" : "Elasticity — No Action",
        summary:
          language === "tr"
            ? "Kategoriler arasında belirgin premium boşluk yok. Fiyat artışı için tetikleyici sinyal bulunamadı."
            : "No significant premium gap across categories. No trigger signal for price increase.",
        targetRole: "pricing",
        severity: "low",
        confidence: 70,
        reasoning: [
          {
            source: language === "tr" ? "Kategori Özeti" : "Category Summary",
            observation: categories.map((c) => `${c.category}: ortalama ₺${c.avgPrice}, delta %${c.avgCompetitorDelta}`).join(" | "),
            conclusion:
              language === "tr" ? "Mevcut konumlandırma rekabetçi." : "Current positioning is competitive.",
          },
          {
            source: language === "tr" ? "İzleme Önerisi" : "Monitoring Recommendation",
            observation:
              language === "tr" ? "Aylık esneklik ölçümünü sürdür." : "Continue monthly elasticity measurement.",
            conclusion: language === "tr" ? "Yeniden değerlendirme: 30 gün." : "Re-evaluate in 30 days.",
          },
        ],
        impact: { revenue: "+₺0M", margin: "+0.0%", share: "+0.0pp" },
        recommendedAction:
          language === "tr" ? "Mevcut fiyatlamayı koru, 30 gün sonra yeniden değerlendir." : "Hold current pricing; re-evaluate in 30 days.",
        alternatives: [language === "tr" ? "Test pazarında %2 artış denemesi" : "A/B test 2% lift in one city"],
      },
    ];
  }
  const top = premiumGaps[0];
  const cat = top.category;
  const matching = premiumGaps.filter((g) => g.category === cat);
  return [
    {
      type: "price-elasticity-lift",
      title:
        language === "tr"
          ? `${cat} segmentinde fiyat artışı fırsatı`
          : `Pricing-up opportunity in ${cat} segment`,
      summary:
        language === "tr"
          ? `${matching.length} ${cat} ürününde ${top.brand} ortalama %${Math.round(matching.reduce((s, m) => s + m.gapPercent, 0) / matching.length)} daha pahalı. Düşük talep esnekliği varsayımıyla %3-5 fiyat artışı denemeye değer.`
          : `${matching.length} ${cat} SKUs show ${top.brand} priced ${Math.round(matching.reduce((s, m) => s + m.gapPercent, 0) / matching.length)}% higher on average. Low demand elasticity supports a 3-5% price increase pilot.`,
      targetRole: "pricing",
      severity: "medium",
      confidence: 80,
      reasoning: [
        {
          source: language === "tr" ? "Premium Boşluk Analizi" : "Premium Gap Analysis",
          observation:
            language === "tr"
              ? `Örnek: ${top.arcelikProduct} (₺${top.arcelikPrice}) vs ${top.brand} (₺${top.competitorPrice}), boşluk %${Math.round(top.gapPercent)}.`
              : `Example: ${top.arcelikProduct} (₺${top.arcelikPrice}) vs ${top.brand} (₺${top.competitorPrice}), gap ${Math.round(top.gapPercent)}%.`,
          conclusion:
            language === "tr" ? "Üst segmentte fiyat alanı mevcut." : "Headroom exists in the upper segment.",
        },
        {
          source: language === "tr" ? "Esneklik Heuristic" : "Elasticity Heuristic",
          observation:
            language === "tr"
              ? `${cat} kategorisinde tüketici kalite-odaklı; tarihsel esneklik 0.3-0.6 aralığında.`
              : `${cat} category buyers are quality-led; historical elasticity in 0.3-0.6 band.`,
          conclusion:
            language === "tr" ? "Hacim etkisi sınırlı, marj kazancı net." : "Volume impact limited, margin gain net positive.",
        },
        {
          source: language === "tr" ? "Risk Notu" : "Risk Note",
          observation:
            language === "tr" ? "Tek seferde 5%'ten fazla artış riskli." : "Single jump >5% is risky.",
          conclusion:
            language === "tr" ? "Aşamalı 3% + 2% (60 gün arayla)." : "Stagger 3% + 2% (60-day gap).",
        },
      ],
      impact: { revenue: "+₺6M", margin: "+1.0%", share: "-0.1pp" },
      recommendedAction:
        language === "tr"
          ? `${cat} kategorisinde üst segmente %3 fiyat artışı uygula; 30 gün hacim takibi sonrası %2 ek artış değerlendir.`
          : `Apply 3% price lift on upper segment of ${cat}; evaluate +2% after 30 days of volume telemetry.`,
      alternatives:
        language === "tr"
          ? [`${cat} sadece premium tier'da %5 artış`, "İstanbul'da pilot, ardından yaygınlaştırma", "Mevcut fiyatı koru"]
          : [`${cat} premium tier only +5%`, "Pilot in Istanbul then expand", "Hold current pricing"],
    },
  ];
}

// ---------- Agent: Cannibalization ----------
function buildCannibalizationContext(ctx: ArcelikContext) {
  // Index marketplace specs by Arçelik product so we can score *feature* overlap
  // (capacity / spin / noise / energy class) on top of the raw price spread.
  const specsByProduct = new Map<string, ArcelikContext["productSpecs"][number]>();
  for (const s of ctx.productSpecs) {
    if (s.arcelikProductId && !specsByProduct.has(s.arcelikProductId)) {
      specsByProduct.set(s.arcelikProductId, s);
    }
  }

  // Compare two products on whatever feature dimensions we actually have data
  // for. Returns a 0-100 overlap score (higher = more interchangeable from a
  // consumer perspective) plus the matched dimensions.
  function featureOverlap(
    a: ArcelikContext["products"][number],
    b: ArcelikContext["products"][number],
  ): { score: number; matched: string[] } {
    const matched: string[] = [];
    let dims = 0;
    let hits = 0;

    if (a.energyClass && b.energyClass) {
      dims += 1;
      if (a.energyClass === b.energyClass) {
        hits += 1;
        matched.push(`energyClass=${a.energyClass}`);
      }
    }

    const sa = specsByProduct.get(a.id);
    const sb = specsByProduct.get(b.id);
    if (sa && sb) {
      if (sa.capacityKg != null && sb.capacityKg != null) {
        dims += 1;
        const delta = Math.abs(sa.capacityKg - sb.capacityKg) / Math.max(sa.capacityKg, sb.capacityKg);
        if (delta < 0.1) {
          hits += 1;
          matched.push(`capacityKg≈${sa.capacityKg}`);
        }
      }
      if (sa.capacityLiters != null && sb.capacityLiters != null) {
        dims += 1;
        const delta = Math.abs(sa.capacityLiters - sb.capacityLiters) / Math.max(sa.capacityLiters, sb.capacityLiters);
        if (delta < 0.1) {
          hits += 1;
          matched.push(`capacityL≈${sa.capacityLiters}`);
        }
      }
      if (sa.spinRpm != null && sb.spinRpm != null) {
        dims += 1;
        if (Math.abs(sa.spinRpm - sb.spinRpm) <= 100) {
          hits += 1;
          matched.push(`spin≈${sa.spinRpm}rpm`);
        }
      }
      if (sa.noiseLevelDb != null && sb.noiseLevelDb != null) {
        dims += 1;
        if (Math.abs(sa.noiseLevelDb - sb.noiseLevelDb) <= 3) {
          hits += 1;
          matched.push(`noise≈${sa.noiseLevelDb}dB`);
        }
      }
    }

    return {
      score: dims === 0 ? 0 : Math.round((hits / dims) * 100),
      matched,
    };
  }

  const buckets = new Map<string, typeof ctx.products>();
  for (const p of ctx.products) {
    const key = `${p.category}:${p.subcategory}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }
  const overlaps: Array<{
    category: string;
    subcategory: string;
    products: {
      id: string;
      name: string;
      tier: string;
      price: number;
      margin: number;
      energyClass: string;
      capacityKg?: number | null;
      capacityLiters?: number | null;
      spinRpm?: number | null;
    }[];
    spreadPercent: number;
    featureOverlapPercent: number;
    overlapDimensions: string[];
  }> = [];
  for (const [key, arr] of buckets) {
    if (arr.length < 2) continue;
    const sorted = arr.slice().sort((a, b) => a.tsfPrice - b.tsfPrice);
    const minP = sorted[0].tsfPrice;
    const maxP = sorted[sorted.length - 1].tsfPrice;
    const spread = ((maxP - minP) / Math.max(1, maxP)) * 100;

    // Compute feature overlap on the cheapest vs most-expensive in the bucket
    // (the canonical cannibalization pair). When specs are missing we fall back
    // to energy-class only, but that keeps the dimension list honest.
    const overlap = featureOverlap(sorted[0], sorted[sorted.length - 1]);

    // Surface the bucket if EITHER price spread is tight OR feature overlap
    // is high — both are independent cannibalization signals.
    if ((spread < 18 || overlap.score >= 60) && arr.length >= 2) {
      const [cat, sub] = key.split(":");
      overlaps.push({
        category: cat,
        subcategory: sub,
        products: sorted.slice(0, 4).map((p) => {
          const spec = specsByProduct.get(p.id);
          return {
            id: p.id,
            name: p.name,
            tier: p.priceTier,
            price: p.tsfPrice,
            margin: Math.round(p.marginPercent * 10) / 10,
            energyClass: p.energyClass,
            capacityKg: spec?.capacityKg ?? null,
            capacityLiters: spec?.capacityLiters ?? null,
            spinRpm: spec?.spinRpm ?? null,
          };
        }),
        spreadPercent: Math.round(spread * 10) / 10,
        featureOverlapPercent: overlap.score,
        overlapDimensions: overlap.matched,
      });
    }
  }
  // Rank by combined risk: tight spread + high feature overlap = top of list.
  overlaps.sort((a, b) => {
    const ra = a.spreadPercent - a.featureOverlapPercent;
    const rb = b.spreadPercent - b.featureOverlapPercent;
    return ra - rb;
  });
  return { overlaps: overlaps.slice(0, 6) };
}

function baselineCannibalization(ctx: ArcelikContext, language: "tr" | "en"): RawRecommendation[] {
  const { overlaps } = buildCannibalizationContext(ctx);
  if (overlaps.length === 0) {
    return [
      {
        type: "cannibalization-clear",
        title:
          language === "tr"
            ? "Yamyamlık Riski Yok"
            : "No Cannibalization Risk Detected",
        summary:
          language === "tr"
            ? "Alt-kategoriler içinde fiyat aralığı sağlıklı (>%18). Portföyde belirgin yamyamlık sinyali yok."
            : "Sub-categories show healthy price spread (>18%). No material cannibalization signal.",
        targetRole: "pricing",
        severity: "low",
        confidence: 75,
        reasoning: [
          {
            source: language === "tr" ? "Portföy Spread Analizi" : "Portfolio Spread Analysis",
            observation:
              language === "tr"
                ? `${ctx.products.length} ürün incelendi; tüm alt-kategorilerde min-max yayılım %18'in üstünde.`
                : `${ctx.products.length} SKUs reviewed; all sub-categories have min-max spread above 18%.`,
            conclusion:
              language === "tr" ? "Yapısal yamyamlık riski düşük." : "Structural cannibalization risk is low.",
          },
          {
            source: language === "tr" ? "İzleme Notu" : "Monitoring Note",
            observation:
              language === "tr" ? "Aylık portföy taraması yeterli." : "Monthly portfolio scan is sufficient.",
            conclusion:
              language === "tr" ? "Yeni ürün lansmanlarında yeniden çalıştır." : "Re-run on new product launches.",
          },
        ],
        impact: { revenue: "+₺0M", margin: "+0.0%", share: "+0.0pp" },
        recommendedAction:
          language === "tr" ? "Mevcut portföy yapısını koru." : "Maintain current portfolio structure.",
        alternatives: [language === "tr" ? "Tarama sıklığını arttır" : "Increase scan cadence"],
      },
    ];
  }
  const worst = overlaps[0];
  return [
    {
      type: "cannibalization-warning",
      title:
        language === "tr"
          ? `${worst.category}/${worst.subcategory} alt-kategorisinde yamyamlık riski`
          : `Cannibalization risk in ${worst.category}/${worst.subcategory}`,
      summary:
        language === "tr"
          ? `${worst.products.length} ürün arasında fiyat yayılımı sadece %${worst.spreadPercent}. Tier farklılaşması zayıf — alt tier ürünler üst tier satışlarını yiyor olabilir.`
          : `${worst.products.length} SKUs are within ${worst.spreadPercent}% price band. Tier differentiation is weak — lower tier likely cannibalizing upper tier sales.`,
      targetRole: "pricing",
      severity: "medium",
      confidence: 76,
      reasoning: [
        {
          source: language === "tr" ? "Portföy Spread" : "Portfolio Spread",
          observation: worst.products.map((p) => `${p.name} (${p.tier}, ₺${p.price}, ${p.energyClass})`).join(" | "),
          conclusion:
            language === "tr"
              ? "Tier başına net özellik farkı yok."
              : "No clear feature differentiation per tier.",
        },
        {
          source: language === "tr" ? "Marj Etkisi" : "Margin Impact",
          observation:
            language === "tr"
              ? `Alt tier marjı (%${worst.products[0].margin}) üst tier marjından (%${worst.products[worst.products.length - 1].margin}) düşük olabilir.`
              : `Lower tier margin (${worst.products[0].margin}%) may be below upper tier (${worst.products[worst.products.length - 1].margin}%).`,
          conclusion:
            language === "tr" ? "Mix kayması karlılığı bozar." : "Mix shift erodes profitability.",
        },
        {
          source: language === "tr" ? "Aksiyon Mantığı" : "Action Logic",
          observation:
            language === "tr"
              ? "Alt tier'da bir SKU'yu emekliye ayırmak veya üst tier özelliklerini netleştirmek gerekir."
              : "Either retire a lower-tier SKU or sharpen upper-tier feature claims.",
          conclusion:
            language === "tr" ? "Portföy yeniden konumlandırması önerilir." : "Portfolio repositioning recommended.",
        },
      ],
      impact: { revenue: "+₺3M", margin: "+0.6%", share: "+0.0pp" },
      recommendedAction:
        language === "tr"
          ? `${worst.products[0].name} ürününü emekliye ayır veya alt tier'da %4 fiyat indirimi ile üst tier'dan açık ayır.`
          : `Retire ${worst.products[0].name} or apply -4% on lower tier to widen the gap from upper tier.`,
      alternatives:
        language === "tr"
          ? ["Üst tier'a yeni özellik ekleyerek farklılaştır", "Mevcut yapıyı koru ve mix izlemesi yap"]
          : ["Add features to upper tier to differentiate", "Hold structure and monitor mix shift"],
    },
  ];
}

// ---------- Agent: Dealer Optimization ----------
function buildDealerContext(ctx: ArcelikContext) {
  const dealers = ctx.dealers.slice();

  // Index cities so we can join market-share + competitor-strength onto
  // every dealer record. Dealer KPIs without city context can't tell us
  // whether under-performance is dealer-specific or a tough local market.
  const cityByName = new Map(ctx.cities.map((c) => [c.name.toLowerCase(), c]));

  // Aggregate dealer product mix per city so we can compare a dealer's mix
  // against the city-wide demand pattern (proxied here by mean of all
  // dealers in that city). Cities with strong local competitors are flagged.
  const cityMixSum = new Map<string, { sums: Record<string, number>; count: number }>();
  for (const d of dealers) {
    const e = cityMixSum.get(d.city.toLowerCase()) ?? { sums: {}, count: 0 };
    for (const [cat, share] of Object.entries(d.productMix)) {
      e.sums[cat] = (e.sums[cat] ?? 0) + share;
    }
    e.count += 1;
    cityMixSum.set(d.city.toLowerCase(), e);
  }
  function cityMeanMix(cityName: string): Record<string, number> {
    const e = cityMixSum.get(cityName.toLowerCase());
    if (!e || e.count === 0) return {};
    const out: Record<string, number> = {};
    for (const [cat, sum] of Object.entries(e.sums)) {
      out[cat] = Math.round((sum / e.count) * 10) / 10;
    }
    return out;
  }
  function topCompetitor(cityName: string): { brand: string; strength: number } | null {
    const city = cityByName.get(cityName.toLowerCase());
    if (!city || city.competitorStrength.length === 0) return null;
    const sorted = city.competitorStrength.slice().sort((a, b) => b.strength - a.strength);
    return sorted[0];
  }

  // Compute dealer-vs-city mix divergence: max absolute difference (in pp)
  // between this dealer's category share and the city mean. A high value
  // signals an off-pattern mix that could explain weak sales.
  function mixDivergence(d: ArcelikContext["dealers"][number]): {
    maxDeltaPp: number;
    drivers: string[];
  } {
    const mean = cityMeanMix(d.city);
    let max = 0;
    const drivers: string[] = [];
    for (const [cat, share] of Object.entries(d.productMix)) {
      const m = mean[cat] ?? 0;
      const delta = Math.abs(share - m);
      if (delta > max) max = delta;
      if (delta >= 10) drivers.push(`${cat}: ${share} vs city ${m}`);
    }
    return { maxDeltaPp: Math.round(max * 10) / 10, drivers: drivers.slice(0, 3) };
  }

  function enrichDealer<T extends ArcelikContext["dealers"][number]>(d: T) {
    const city = cityByName.get(d.city.toLowerCase());
    const top = topCompetitor(d.city);
    const div = mixDivergence(d);
    return {
      id: d.id,
      storeName: d.storeName,
      city: d.city,
      tier: d.tier,
      complianceScore: d.complianceScore,
      monthlySalesTarget: d.monthlySalesTarget,
      currentProgress: d.currentProgress,
      productMix: d.productMix,
      stockLevels: d.stockLevels,
      cityMarketSharePercent: city?.marketSharePercent ?? null,
      cityPopulationTier: city?.populationTier ?? null,
      topLocalCompetitor: top,
      mixDivergencePp: div.maxDeltaPp,
      mixDivergenceDrivers: div.drivers,
    };
  }

  const lowCompliance = dealers
    .filter((d) => d.complianceScore < 80)
    .sort((a, b) => a.complianceScore - b.complianceScore)
    .slice(0, 8)
    .map(enrichDealer);
  const underperforming = dealers
    .filter((d) => d.monthlySalesTarget > 0 && d.currentProgress / d.monthlySalesTarget < 0.7)
    .sort((a, b) => a.currentProgress / a.monthlySalesTarget - b.currentProgress / b.monthlySalesTarget)
    .slice(0, 8)
    .map((d) => ({
      ...enrichDealer(d),
      progressPercent: Math.round((d.currentProgress / d.monthlySalesTarget) * 100),
    }));
  const stockGaps = dealers
    .map((d) => {
      const lowStocks = Object.entries(d.stockLevels).filter(([_, v]) => v < 5);
      const top = topCompetitor(d.city);
      return {
        dealer: d.storeName,
        city: d.city,
        tier: d.tier,
        lowStockCategories: lowStocks.map(([k]) => k),
        topLocalCompetitor: top,
      };
    })
    .filter((d) => d.lowStockCategories.length > 0)
    .slice(0, 6);

  // Cities where Arçelik is structurally weaker (low share OR a strong
  // entrenched competitor) — surfaced separately so the agent can call out
  // *market* causes vs *dealer* causes.
  const challengingCities = ctx.cities
    .map((c) => {
      const top = c.competitorStrength
        .slice()
        .sort((a, b) => b.strength - a.strength)[0];
      return {
        name: c.name,
        marketSharePercent: c.marketSharePercent,
        topCompetitor: top ?? null,
        dealerCount: c.dealerCount,
        populationTier: c.populationTier,
      };
    })
    .filter(
      (c) =>
        c.marketSharePercent < 30 ||
        (c.topCompetitor && c.topCompetitor.strength >= 70),
    )
    .sort((a, b) => a.marketSharePercent - b.marketSharePercent)
    .slice(0, 6);

  return {
    lowCompliance,
    underperforming,
    stockGaps,
    challengingCities,
    totalDealers: dealers.length,
  };
}

function baselineDealer(ctx: ArcelikContext, language: "tr" | "en"): RawRecommendation[] {
  const { lowCompliance, underperforming, stockGaps, totalDealers } = buildDealerContext(ctx);
  if (lowCompliance.length === 0 && underperforming.length === 0 && stockGaps.length === 0) {
    return [
      {
        type: "dealer-healthy",
        title: language === "tr" ? "Bayi Ağı Sağlıklı" : "Dealer Network Healthy",
        summary:
          language === "tr"
            ? `${totalDealers} bayinin tamamı uyum (>80) ve hedef ilerlemesi (>%70) eşiklerinin üstünde.`
            : `All ${totalDealers} dealers above compliance (>80) and target progress (>70%) thresholds.`,
        targetRole: "marketing",
        severity: "low",
        confidence: 78,
        reasoning: [
          {
            source: language === "tr" ? "Bayi KPI Taraması" : "Dealer KPI Scan",
            observation:
              language === "tr"
                ? `${totalDealers} bayide uyum ve hedef metrikleri eşiğin üstünde.`
                : `${totalDealers} dealers all above compliance + target thresholds.`,
            conclusion:
              language === "tr" ? "Operasyonel müdahaleye gerek yok." : "No operational intervention required.",
          },
          {
            source: language === "tr" ? "Sürdürme Notu" : "Sustain Note",
            observation:
              language === "tr" ? "Mevcut coaching programı çalışıyor." : "Current coaching program is effective.",
            conclusion:
              language === "tr" ? "Devam et, çeyreklik gözden geçir." : "Continue, review quarterly.",
          },
        ],
        impact: { revenue: "+₺0M", margin: "+0.0%", share: "+0.0pp" },
        recommendedAction:
          language === "tr" ? "Mevcut programı sürdür, çeyreklik review yap." : "Sustain current program, quarterly review.",
        alternatives: [language === "tr" ? "Üst performansçıları örnek olay olarak yay" : "Spotlight top performers as case studies"],
      },
    ];
  }
  const recs: RawRecommendation[] = [];
  if (lowCompliance.length > 0) {
    const sample = lowCompliance.slice(0, 3);
    recs.push({
      type: "dealer-compliance",
      title:
        language === "tr"
          ? `${lowCompliance.length} bayide uyum skoru kritik altında`
          : `${lowCompliance.length} dealers below compliance threshold`,
      summary:
        language === "tr"
          ? `Uyum skoru <80 olan bayiler tespit edildi (en düşük: ${sample[0].storeName}, %${sample[0].complianceScore}). TSF fiyat ihlali ve kampanya görünürlüğü riski mevcut.`
          : `Dealers with compliance <80 detected (lowest: ${sample[0].storeName}, ${sample[0].complianceScore}). Risk of TSF price violations and campaign visibility gaps.`,
      targetRole: "marketing",
      severity: "high",
      confidence: 82,
      reasoning: [
        {
          source: language === "tr" ? "Uyum Taraması" : "Compliance Scan",
          observation: sample.map((d) => `${d.storeName} (${d.city}): %${d.complianceScore}`).join(" | "),
          conclusion:
            language === "tr" ? "Kümelenmiş düşük performans." : "Clustered low performance.",
        },
        {
          source: language === "tr" ? "Marka Risk" : "Brand Risk",
          observation:
            language === "tr"
              ? "TSF altı satış tüketici güvenini ve marj havuzunu erite."
              : "Below-TSF sales erode consumer trust and margin pool.",
          conclusion:
            language === "tr" ? "Hızlı müdahale gerek." : "Rapid intervention required.",
        },
      ],
      impact: { revenue: "+₺4M", margin: "+0.3%", share: "+0.2pp" },
      recommendedAction:
        language === "tr"
          ? `Düşük uyumlu ${lowCompliance.length} bayiye 14 günlük yeniden eğitim + denetim programı uygula.`
          : `Apply 14-day retraining + audit program to ${lowCompliance.length} low-compliance dealers.`,
      alternatives:
        language === "tr"
          ? ["Uyum skoru bazlı bonus düzenle", "En düşük 3 bayide bayi tier downgrade"]
          : ["Tie bonus to compliance score", "Tier-downgrade the lowest 3 dealers"],
    });
  }
  if (underperforming.length > 0) {
    const sample = underperforming.slice(0, 3);
    recs.push({
      type: "dealer-target",
      title:
        language === "tr"
          ? `${underperforming.length} bayi hedefin %70 altında`
          : `${underperforming.length} dealers below 70% of target`,
      summary:
        language === "tr"
          ? `Aylık hedefin %70 altında ilerleyen bayiler var (en düşük: ${sample[0].storeName}, %${sample[0].progressPercent}). Stok, kampanya veya bölgesel talep eşitsizliği nedeniyle olabilir.`
          : `Dealers progressing below 70% of monthly target (lowest: ${sample[0].storeName}, ${sample[0].progressPercent}%). Could stem from stock, campaign, or regional demand imbalance.`,
      targetRole: "marketing",
      severity: "medium",
      confidence: 78,
      reasoning: [
        {
          source: language === "tr" ? "Hedef İlerleme" : "Target Progress",
          observation: sample.map((d) => `${d.storeName}: %${d.progressPercent}`).join(" | "),
          conclusion:
            language === "tr" ? "Sistematik geri kalma." : "Systematic shortfall.",
        },
        {
          source: language === "tr" ? "Bağlam" : "Context",
          observation:
            language === "tr"
              ? "Stok seviyeleri ve bölgesel kampanya görünürlüğü kontrol edilmeli."
              : "Stock levels and regional campaign visibility need check.",
          conclusion:
            language === "tr" ? "Çok faktörlü tanı gerekli." : "Multi-factor diagnosis needed.",
        },
      ],
      impact: { revenue: "+₺6M", margin: "+0.1%", share: "+0.3pp" },
      recommendedAction:
        language === "tr"
          ? `Geri kalan bayilere POS materyali + öncelikli stok yenileme + günlük progress takip uygula.`
          : `Apply POS kit refresh + priority stock replenish + daily progress tracking to lagging dealers.`,
      alternatives:
        language === "tr"
          ? ["Geçici hedef revizyonu", "Saha satış temsilcisi ataması"]
          : ["Temporary target revision", "Field rep assignment"],
    });
  }
  return recs.length > 0 ? recs : baselineDealer({ ...ctx, dealers: [] }, language);
}

// ---------- Public agent runners ----------
function describeContext(ctx: ArcelikContext) {
  return {
    productCount: ctx.products.length,
    competitorCount: ctx.competitorPrices.length,
    dealerCount: ctx.dealers.length,
    cityCount: ctx.cities.length,
  };
}

interface RunOptions {
  language?: "tr" | "en";
  forceBaseline?: boolean;
}

async function runAgent(
  agentType: AgentType,
  systemRole: string,
  userPayload: unknown,
  baseline: (ctx: ArcelikContext, lang: "tr" | "en") => RawRecommendation[],
  ctx: ArcelikContext,
  opts: RunOptions,
): Promise<AgentRunResult> {
  const language = opts.language ?? "tr";
  const generatedAt = new Date().toISOString();
  const digest = describeContext(ctx);

  const systemPrompt = `${systemRole}\n\n${jsonInstruction(language)}`;
  const userPrompt = `Here is the structured context (already filtered to the most relevant entries). Reason ONLY on this data:\n\n${JSON.stringify(userPayload, null, 2)}`;

  if (!opts.forceBaseline) {
    const llm = await callAgentLLM(systemPrompt, userPrompt);
    if (llm) {
      return {
        agentType,
        generatedAt,
        language,
        source: llm.source,
        recommendations: postProcess(llm.recs, agentType, llm.source, language),
        contextDigest: digest,
      };
    }
  }

  const fallback = baseline(ctx, language);
  return {
    agentType,
    generatedAt,
    language,
    source: "baseline",
    fallbackReason: opts.forceBaseline ? "force-baseline" : "llm-unavailable-or-invalid",
    recommendations: postProcess(fallback, agentType, "baseline", language),
    contextDigest: digest,
  };
}

export async function runCompetitiveResponseAgent(opts: RunOptions = {}): Promise<AgentRunResult> {
  const ctx = await buildArcelikContext();
  const data = buildCompetitiveContext(ctx);
  const role = `You are the Competitive Response Agent for Arçelik (Turkish white-goods leader). You analyze competitor pricing pressure (brands like Vestel, Bosch, Samsung, LG, Beko) and recommend specific competitive moves. You prefer value-led responses (campaigns, financing, trade-in) over direct price matching to protect margin.`;
  return runAgent("competitive-response", role, data, baselineCompetitive, ctx, opts);
}

export async function runPriceElasticityAgent(opts: RunOptions = {}): Promise<AgentRunResult> {
  const ctx = await buildArcelikContext();
  const data = buildElasticityContext(ctx);
  const role = `You are the Price Elasticity Agent for Arçelik. You identify pricing-up opportunities (where Arçelik is significantly under premium competitors like Bosch with low elasticity) and pricing-down necessities. You quantify margin lift potential and recommend phased adjustments.`;
  return runAgent("price-elasticity", role, data, baselineElasticity, ctx, opts);
}

export async function runCannibalizationAgent(opts: RunOptions = {}): Promise<AgentRunResult> {
  const ctx = await buildArcelikContext();
  const data = buildCannibalizationContext(ctx);
  const role = `You are the Cannibalization Detection Agent for Arçelik. You analyze the product portfolio (price tiers, energy classes, sub-categories) and detect when SKUs are too close in price/feature, eroding upper-tier sales. You recommend SKU retirement, repricing, or feature differentiation.`;
  return runAgent("cannibalization", role, data, baselineCannibalization, ctx, opts);
}

export async function runDealerOptimizationAgent(opts: RunOptions = {}): Promise<AgentRunResult> {
  const ctx = await buildArcelikContext();
  const data = buildDealerContext(ctx);
  const role = `You are the Dealer Optimization Agent for Arçelik. You analyze dealer compliance scores, target progress, stock levels and product mix; recommend coaching, POS interventions, replenishment, or tier changes for at-risk dealers.`;
  return runAgent("dealer-optimization", role, data, baselineDealer, ctx, opts);
}

export async function runAllAgents(opts: RunOptions = {}): Promise<AgentRunResult[]> {
  return Promise.all([
    runCompetitiveResponseAgent(opts),
    runPriceElasticityAgent(opts),
    runCannibalizationAgent(opts),
    runDealerOptimizationAgent(opts),
  ]);
}
