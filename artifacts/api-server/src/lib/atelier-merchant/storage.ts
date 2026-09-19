/**
 * Task #396 — Drizzle-backed storage for the merchant matcher
 * (adapted from the kit's MerchantStorage interface; the per-user mapping
 * tier is replaced by the org-wide Task #383 merchant memory, which the
 * caller resolves before invoking the matcher).
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  atelierGlobalMerchants,
  atelierUnmatchedMerchants,
} from "@workspace/db";

export interface GlobalMerchantRow {
  merchantId: string;
  merchantName: string;
  normalizedName: string;
  variant: string | null;
  categoryCode: string;
  subCategoryCode: string;
  confidence: number;
}

export interface MerchantStorage {
  listGlobalMerchants(): Promise<GlobalMerchantRow[]>;
  findGlobalMerchantByNormalizedName(
    normalized: string,
  ): Promise<GlobalMerchantRow | null>;
  logUnmatchedMerchant(input: {
    orgId: string;
    rawMerchantText: string;
    normalizedMerchantText: string;
    region?: string | null;
  }): Promise<void>;
}

export const drizzleMerchantStorage: MerchantStorage = {
  async listGlobalMerchants() {
    const rows = await db
      .select({
        merchantId: atelierGlobalMerchants.merchantId,
        merchantName: atelierGlobalMerchants.merchantName,
        normalizedName: atelierGlobalMerchants.normalizedName,
        variant: atelierGlobalMerchants.variant,
        categoryCode: atelierGlobalMerchants.categoryCode,
        subCategoryCode: atelierGlobalMerchants.subCategoryCode,
        confidence: atelierGlobalMerchants.confidence,
      })
      .from(atelierGlobalMerchants);
    return rows;
  },

  async findGlobalMerchantByNormalizedName(normalized: string) {
    if (!normalized) return null;
    const rows = await db
      .select({
        merchantId: atelierGlobalMerchants.merchantId,
        merchantName: atelierGlobalMerchants.merchantName,
        normalizedName: atelierGlobalMerchants.normalizedName,
        variant: atelierGlobalMerchants.variant,
        categoryCode: atelierGlobalMerchants.categoryCode,
        subCategoryCode: atelierGlobalMerchants.subCategoryCode,
        confidence: atelierGlobalMerchants.confidence,
      })
      .from(atelierGlobalMerchants)
      .where(eq(atelierGlobalMerchants.normalizedName, normalized))
      .limit(1);
    return rows[0] ?? null;
  },

  async logUnmatchedMerchant(input) {
    const raw = input.rawMerchantText.slice(0, 500);
    await db
      .insert(atelierUnmatchedMerchants)
      .values({
        id: randomUUID(),
        orgId: input.orgId,
        rawMerchantText: raw,
        normalizedMerchantText: input.normalizedMerchantText.slice(0, 500),
        region: input.region ?? null,
      })
      .onConflictDoUpdate({
        target: [
          atelierUnmatchedMerchants.orgId,
          atelierUnmatchedMerchants.rawMerchantText,
        ],
        set: {
          count: sql`${atelierUnmatchedMerchants.count} + 1`,
          lastSeenAt: new Date(),
        },
      });
  },
};
