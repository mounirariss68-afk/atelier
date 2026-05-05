export const MARKETPLACE_SOURCES = ["n11", "trendyol", "hepsiburada"] as const;
export type MarketplaceSource = (typeof MARKETPLACE_SOURCES)[number];

export function isMarketplaceSource(value: string): value is MarketplaceSource {
  return (MARKETPLACE_SOURCES as readonly string[]).includes(value);
}
