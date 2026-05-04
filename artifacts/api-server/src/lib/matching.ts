import {
  db,
  arcelikProductsTable,
  arcelikMarketplacePricesTable,
  arcelikProductEquivalencesTable,
  arcelikProductSpecsTable,
} from "@workspace/db";
import { gte, eq, or, like } from "drizzle-orm";

function normalizeBrand(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim();
}

const ARCELIK_BRAND_FAMILY_NORMALIZED = new Set(
  ["Arçelik", "Beko", "Grundig", "Altus"].map(normalizeBrand),
);

function isArcelikFamilyBrand(brand: string): boolean {
  return ARCELIK_BRAND_FAMILY_NORMALIZED.has(normalizeBrand(brand));
}

const ENERGY_TIER: Record<string, number> = {
  "A+++": 0,
  "A++": 1,
  "A+": 2,
  A: 3,
  B: 4,
  C: 5,
  D: 6,
  E: 7,
  F: 8,
  G: 9,
};

function energyTierDistance(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ai = ENERGY_TIER[a.toUpperCase()];
  const bi = ENERGY_TIER[b.toUpperCase()];
  if (ai === undefined || bi === undefined) return null;
  return Math.abs(ai - bi);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

interface ProductForMatching {
  id: string;
  modelCode: string;
  name: string;
  category: string;
  tsfPrice: number;
  energyClass: string;
  features: string[];
}

interface MarketplaceForMatching {
  id: number;
  marketplace: string;
  marketplaceProductId: string;
  brand: string;
  title: string;
  category: string;
  price: number;
  capacityLiters: number | null;
  capacityKg: number | null;
  energyClass: string | null;
  // Structured spec values (joined from arcelik_product_specs); preferred
  // over title-parsed fields when present.
  specCapacityLiters: number | null;
  specCapacityKg: number | null;
  specEnergyClass: string | null;
  specProductType: string | null;
}

export interface EquivalenceResult {
  scanned: number;
  created: number;
  avgConfidence: number;
}

function approximateCapacityFromFeatures(features: string[]): {
  liters: number | null;
  kg: number | null;
} {
  const joined = features.join(" ");
  const literMatch = joined.match(/\b(\d{2,4})\s*(?:lt|l\b|litre|L\b)/i);
  const kgMatch = joined.match(/\b(\d{1,2}(?:[.,]\d)?)\s*kg/i);
  return {
    liters: literMatch ? parseInt(literMatch[1], 10) : null,
    kg: kgMatch ? parseFloat(kgMatch[1].replace(",", ".")) : null,
  };
}

export async function rebuildEquivalences(
  scrapeRunId: string,
): Promise<EquivalenceResult> {
  const arcelikProducts = (await db
    .select()
    .from(arcelikProductsTable)) as ProductForMatching[];

  const recentSince = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);
  // LEFT JOIN structured specs so the matcher can use real PDP-extracted
  // capacity/energy when available, falling back to title-parsed values.
  const rawRows = await db
    .select({
      id: arcelikMarketplacePricesTable.id,
      marketplace: arcelikMarketplacePricesTable.marketplace,
      marketplaceProductId:
        arcelikMarketplacePricesTable.marketplaceProductId,
      brand: arcelikMarketplacePricesTable.brand,
      title: arcelikMarketplacePricesTable.title,
      category: arcelikMarketplacePricesTable.category,
      price: arcelikMarketplacePricesTable.price,
      capacityLiters: arcelikMarketplacePricesTable.capacityLiters,
      capacityKg: arcelikMarketplacePricesTable.capacityKg,
      energyClass: arcelikMarketplacePricesTable.energyClass,
      specCapacityLiters: arcelikProductSpecsTable.capacityLiters,
      specCapacityKg: arcelikProductSpecsTable.capacityKg,
      specEnergyClass: arcelikProductSpecsTable.energyClass,
      specProductType: arcelikProductSpecsTable.productType,
    })
    .from(arcelikMarketplacePricesTable)
    .leftJoin(
      arcelikProductSpecsTable,
      eq(arcelikProductSpecsTable.marketplacePriceId, arcelikMarketplacePricesTable.id),
    )
    .where(gte(arcelikMarketplacePricesTable.scrapedAt, recentSince));
  const marketplaceRecords = rawRows as MarketplaceForMatching[];

  if (marketplaceRecords.length === 0) {
    return { scanned: 0, created: 0, avgConfidence: 0 };
  }

  const created: Array<{
    arcelikProductId: string;
    competitorBrand: string;
    competitorModel: string;
    competitorMarketplaceId: number;
    matchConfidence: number;
    matchBasis: {
      reasons: string[];
      categoryMatch: boolean;
      capacityDeltaPercent?: number;
      energyClassMatch?: boolean;
      priceDeltaPercent?: number;
      tokenOverlap?: number;
    };
    source: string;
  }> = [];

  for (const product of arcelikProducts) {
    const productTokens = tokenize(`${product.name} ${product.modelCode}`);
    const { liters: pLiters, kg: pKg } = approximateCapacityFromFeatures(
      product.features,
    );

    const candidates = marketplaceRecords.filter(
      (m) =>
        m.category === product.category && !isArcelikFamilyBrand(m.brand),
    );

    const ranked: Array<{
      mp: MarketplaceForMatching;
      score: number;
      basis: {
        reasons: string[];
        categoryMatch: boolean;
        capacityDeltaPercent?: number;
        energyClassMatch?: boolean;
        priceDeltaPercent?: number;
        tokenOverlap?: number;
      };
    }> = [];

    for (const mp of candidates) {
      const reasons: string[] = ["category-match"];
      let score = 0.3; // baseline for category match
      // Prefer structured specs (from PDP scrape) over title-parsed fallbacks.
      const mpLiters = mp.specCapacityLiters ?? mp.capacityLiters;
      const mpKg = mp.specCapacityKg ?? mp.capacityKg;
      const mpEnergy = mp.specEnergyClass ?? mp.energyClass;
      const usedSpec = mp.specCapacityLiters !== null || mp.specCapacityKg !== null;
      if (usedSpec) reasons.push("spec-data-used");

      // Capacity comparison
      let capacityDelta: number | undefined;
      if (pLiters && mpLiters) {
        capacityDelta =
          Math.round((Math.abs(mpLiters - pLiters) / pLiters) * 1000) / 10;
        if (capacityDelta <= 10) {
          score += usedSpec ? 0.3 : 0.25;
          reasons.push(`capacity-within-10pct (${capacityDelta}%)`);
        } else if (capacityDelta <= 20) {
          score += 0.1;
          reasons.push(`capacity-within-20pct (${capacityDelta}%)`);
        }
      } else if (pKg && mpKg) {
        capacityDelta =
          Math.round((Math.abs(mpKg - pKg) / pKg) * 1000) / 10;
        if (capacityDelta <= 15) {
          score += usedSpec ? 0.3 : 0.25;
          reasons.push(`capacity-kg-within-15pct (${capacityDelta}%)`);
        }
      }

      // Energy class (uses spec value when available)
      const energyDistance = energyTierDistance(
        product.energyClass,
        mpEnergy,
      );
      const energyClassMatch =
        energyDistance !== null ? energyDistance <= 1 : undefined;
      if (energyDistance !== null) {
        if (energyDistance === 0) {
          score += 0.2;
          reasons.push("energy-class-exact");
        } else if (energyDistance === 1) {
          score += 0.1;
          reasons.push("energy-class-one-tier-off");
        }
      }

      // Price comparison (within 25%)
      const priceDelta =
        Math.round((Math.abs(mp.price - product.tsfPrice) / product.tsfPrice) * 1000) / 10;
      if (priceDelta <= 25) {
        score += 0.15;
        reasons.push(`price-within-25pct (${priceDelta}%)`);
      } else if (priceDelta <= 50) {
        score += 0.05;
        reasons.push(`price-within-50pct (${priceDelta}%)`);
      }

      // Token overlap
      const titleTokens = tokenize(mp.title);
      const overlap = tokenOverlap(productTokens, titleTokens);
      if (overlap >= 0.4) {
        score += 0.15;
        reasons.push(`title-token-overlap (${(overlap * 100).toFixed(0)}%)`);
      } else if (overlap >= 0.2) {
        score += 0.05;
        reasons.push(`weak-title-overlap (${(overlap * 100).toFixed(0)}%)`);
      }

      const finalScore = Math.min(1, Math.round(score * 100) / 100);
      if (finalScore < 0.5) continue;

      ranked.push({
        mp,
        score: finalScore,
        basis: {
          reasons,
          categoryMatch: true,
          capacityDeltaPercent: capacityDelta,
          energyClassMatch,
          priceDeltaPercent: priceDelta,
          tokenOverlap: Math.round(overlap * 100) / 100,
        },
      });
    }

    // Take top 3 per competitor brand to avoid one product being matched to dozens
    const byBrand = new Map<string, typeof ranked>();
    for (const r of ranked) {
      const list = byBrand.get(r.mp.brand) ?? [];
      list.push(r);
      byBrand.set(r.mp.brand, list);
    }

    for (const [brand, list] of byBrand) {
      list.sort((a, b) => b.score - a.score);
      for (const top of list.slice(0, 3)) {
        created.push({
          arcelikProductId: product.id,
          competitorBrand: brand,
          competitorModel: top.mp.title.slice(0, 200),
          competitorMarketplaceId: top.mp.id,
          matchConfidence: top.score,
          matchBasis: top.basis,
          // Tag with the actual marketplace so the flush below targets only
          // marketplace-sourced equivalences and we can audit per-source.
          source: `${top.mp.marketplace}/${scrapeRunId}`,
        });
      }
    }
  }

  // Reset stale matches before re-matching; upsert preserves them otherwise.
  await db
    .update(arcelikMarketplacePricesTable)
    .set({ arcelikProductId: null, matchConfidence: null })
    .where(
      or(
        eq(arcelikMarketplacePricesTable.marketplace, "n11"),
        eq(arcelikMarketplacePricesTable.marketplace, "trendyol"),
      ),
    );

  if (created.length === 0) {
    await db
      .delete(arcelikProductEquivalencesTable)
      .where(
        or(
          like(arcelikProductEquivalencesTable.source, "n11/%"),
          like(arcelikProductEquivalencesTable.source, "trendyol/%"),
        ),
      );
    return { scanned: marketplaceRecords.length, created: 0, avgConfidence: 0 };
  }

  // Replace ALL marketplace-sourced equivalences (not just this run) so that
  // older matches built before brand normalization or against stale marketplace
  // rows are flushed and rebuilt from the freshest 7-day snapshot. Both n11
  // and trendyol live in this table; only flush rows we own.
  await db
    .delete(arcelikProductEquivalencesTable)
    .where(
      or(
        like(arcelikProductEquivalencesTable.source, "n11/%"),
        like(arcelikProductEquivalencesTable.source, "trendyol/%"),
      ),
    );

  for (let i = 0; i < created.length; i += 100) {
    await db
      .insert(arcelikProductEquivalencesTable)
      .values(created.slice(i, i + 100));
  }

  // Also update the marketplace_prices rows with their best Arçelik product link
  const bestPerMp = new Map<
    number,
    { arcelikProductId: string; confidence: number }
  >();
  for (const c of created) {
    const prev = bestPerMp.get(c.competitorMarketplaceId);
    if (!prev || c.matchConfidence > prev.confidence) {
      bestPerMp.set(c.competitorMarketplaceId, {
        arcelikProductId: c.arcelikProductId,
        confidence: c.matchConfidence,
      });
    }
  }
  for (const [mpId, best] of bestPerMp) {
    await db
      .update(arcelikMarketplacePricesTable)
      .set({
        arcelikProductId: best.arcelikProductId,
        matchConfidence: best.confidence,
      })
      .where(eq(arcelikMarketplacePricesTable.id, mpId));
  }
  const avgConfidence =
    Math.round(
      (created.reduce((s, c) => s + c.matchConfidence, 0) / created.length) *
        1000,
    ) / 1000;

  return {
    scanned: marketplaceRecords.length,
    created: created.length,
    avgConfidence,
  };
}
