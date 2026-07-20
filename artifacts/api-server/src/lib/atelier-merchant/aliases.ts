/**
 * Task #408 — org-scoped merchant aliases learned from manual corrections.
 *
 * When a parsed merchant is wrong ("AMZN MKTP*2233" → "Amazon") the user can
 * opt to remember the correction. The alias is keyed on the matcher's
 * normalizeMerchant() output of the ORIGINAL text and consulted before every
 * other matcher tier, so recognition improves immediately without waiting
 * for the AI-classify batch run.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, atelierMerchantAliases } from "@workspace/db";
import { normalizeMerchant } from "./normalizer";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export interface MerchantAliasHit {
  id: string;
  aliasLabel: string;
  matchKey: string;
}

/** Tier 0 — org alias lookup by normalized raw text. */
export async function lookupMerchantAlias(
  rawText: string,
  orgId: string,
): Promise<MerchantAliasHit | null> {
  const key = normalizeMerchant(rawText);
  if (!key) return null;
  const [row] = await db
    .select()
    .from(atelierMerchantAliases)
    .where(
      and(
        eq(atelierMerchantAliases.orgId, orgId),
        eq(atelierMerchantAliases.matchKey, key),
        isNull(atelierMerchantAliases.deletedAt),
      ),
    );
  if (!row) return null;
  return { id: row.id, aliasLabel: row.aliasLabel, matchKey: row.matchKey };
}

/**
 * Remember a manual correction: original raw text → corrected label.
 * Upserts on (orgId, matchKey); a newer correction overwrites the label.
 * Returns the stored matchKey, or null when the original text normalizes
 * to nothing (nothing learnable).
 */
export async function rememberMerchantAlias(input: {
  originalText: string;
  correctedLabel: string;
  orgId: string;
  userId: string | null;
}): Promise<MerchantAliasHit | null> {
  const key = normalizeMerchant(input.originalText);
  const label = input.correctedLabel.trim().slice(0, 200);
  if (!key || !label) return null;
  // A self-referential alias (correction normalizes to the same key) would
  // be a no-op loop — skip it.
  if (normalizeMerchant(label) === key && label === input.originalText.trim()) {
    return null;
  }
  const now = new Date();
  const [existing] = await db
    .select()
    .from(atelierMerchantAliases)
    .where(
      and(
        eq(atelierMerchantAliases.orgId, input.orgId),
        eq(atelierMerchantAliases.matchKey, key),
      ),
    );
  if (existing) {
    await db
      .update(atelierMerchantAliases)
      .set({
        aliasLabel: label,
        rawSample: input.originalText.trim().slice(0, 500),
        createdByUserId: input.userId,
        updatedAt: now,
        deletedAt: null,
      })
      .where(eq(atelierMerchantAliases.id, existing.id));
    return { id: existing.id, aliasLabel: label, matchKey: key };
  }
  const id = rid("merchalias");
  await db.insert(atelierMerchantAliases).values({
    id,
    orgId: input.orgId,
    matchKey: key,
    rawSample: input.originalText.trim().slice(0, 500),
    aliasLabel: label,
    createdByUserId: input.userId,
  });
  return { id, aliasLabel: label, matchKey: key };
}

/** All active alias match-keys for an org (used to filter the unmatched list). */
export async function listAliasMatchKeys(orgId: string): Promise<Set<string>> {
  const rows = await db
    .select({ matchKey: atelierMerchantAliases.matchKey })
    .from(atelierMerchantAliases)
    .where(
      and(
        eq(atelierMerchantAliases.orgId, orgId),
        isNull(atelierMerchantAliases.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.matchKey));
}
