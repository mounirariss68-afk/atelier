/**
 * Task #396 — seed atelier_global_merchants from the invoice-scanner kit CSVs.
 *
 * Reference data, not demo data. The 23MB EU CSV is NOT committed to the
 * repo — this script unzips the attached kit archive at runtime.
 *
 * Run:  cd artifacts/api-server && npx tsx scripts/seed-global-merchants.ts
 *
 * Idempotent: onConflictDoNothing on merchant_id. Verifies that every
 * DISTINCT category label in the CSVs is explicitly present in the alias
 * map and that every mapped pair is valid against DEFAULT_TAXONOMY.
 */

import { execSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse";
import { db, atelierGlobalMerchants } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  EU_LABEL_MAP,
  NA_LABEL_MAP,
  mapEuLabel,
  mapNaLabel,
} from "../src/lib/atelier-merchant/aliasMap";
import { normalizeMerchant } from "../src/lib/atelier-merchant/normalizer";
import { DEFAULT_TAXONOMY } from "../src/lib/atelier-expense-taxonomy";

const ZIP = path.resolve(
  __dirname,
  "../../../attached_assets/invoice-scanner-kit_1784546186938.zip",
);
const TMP = "/tmp/kit-seed";

function validatePairs(): void {
  const valid = new Map<string, Set<string>>();
  for (const cat of DEFAULT_TAXONOMY) {
    valid.set(cat.code, new Set((cat.children ?? []).map((c) => c.code)));
  }
  const bad: string[] = [];
  for (const [label, pair] of [
    ...Object.entries(EU_LABEL_MAP),
    ...Object.entries(NA_LABEL_MAP),
  ]) {
    const subs = valid.get(pair.categoryCode);
    if (!subs || !subs.has(pair.subCategoryCode)) {
      bad.push(`${label} -> ${pair.categoryCode}/${pair.subCategoryCode}`);
    }
  }
  if (bad.length) {
    throw new Error(`Alias map pairs invalid vs DEFAULT_TAXONOMY:\n${bad.join("\n")}`);
  }
  console.log("[seed] alias map pairs validated against taxonomy");
}

async function* readCsv(file: string): AsyncGenerator<Record<string, string>> {
  const parser = createReadStream(file).pipe(
    parse({ columns: true, skip_empty_lines: true, relax_quotes: true }),
  );
  for await (const record of parser) yield record as Record<string, string>;
}

type InsertRow = typeof atelierGlobalMerchants.$inferInsert;

async function flush(batch: InsertRow[]): Promise<number> {
  if (!batch.length) return 0;
  const inserted = await db
    .insert(atelierGlobalMerchants)
    .values(batch)
    .onConflictDoNothing({ target: atelierGlobalMerchants.merchantId })
    .returning({ id: atelierGlobalMerchants.id });
  return inserted.length;
}

async function main() {
  validatePairs();

  if (!existsSync(ZIP)) throw new Error(`kit zip not found: ${ZIP}`);
  execSync(`rm -rf ${TMP} && mkdir -p ${TMP} && unzip -q -o ${ZIP} -d ${TMP}`);
  const dataDir = path.join(TMP, "invoice-scanner-kit", "data");

  const unmappedEu = new Map<string, number>();
  const unmappedNa = new Map<string, number>();
  let euRows = 0;
  let naRows = 0;
  let insertedTotal = 0;
  let batch: InsertRow[] = [];
  const seenMerchantIds = new Set<string>();

  // EU file
  for await (const r of readCsv(path.join(dataDir, "merchants_eu.csv"))) {
    euRows++;
    const { pair, mapped } = mapEuLabel(r.category_group, r.category);
    if (!mapped) {
      const key = `${r.category_group}|${r.category}`;
      unmappedEu.set(key, (unmappedEu.get(key) ?? 0) + 1);
    }
    const merchantId = `EU_${r.merchant_id}`;
    if (seenMerchantIds.has(merchantId)) continue;
    seenMerchantIds.add(merchantId);
    batch.push({
      id: randomUUID(),
      merchantId,
      merchantName: r.merchant_name,
      normalizedName: normalizeMerchant(r.merchant_name),
      variant: r.variant || null,
      categoryCode: pair.categoryCode,
      subCategoryCode: pair.subCategoryCode,
      rawCategoryGroup: r.category_group || null,
      rawCategory: r.category || null,
      subcategoryLabel: null,
      region: r.region || "EU",
      confidence: Number(r.confidence) || 1.0,
      source: r.source || "kit_eu_csv",
    });
    if (batch.length >= 2000) {
      insertedTotal += await flush(batch);
      batch = [];
      if (euRows % 20000 === 0) console.log(`[seed] EU progress: ${euRows} rows`);
    }
  }
  insertedTotal += await flush(batch);
  batch = [];

  // NA file (pipe-separated variants → semicolon)
  for await (const r of readCsv(path.join(dataDir, "merchants_north_america.csv"))) {
    naRows++;
    const { pair, mapped } = mapNaLabel(r.category);
    if (!mapped) {
      unmappedNa.set(r.category, (unmappedNa.get(r.category) ?? 0) + 1);
    }
    const merchantId = `NA_${r.brand_id}`;
    if (seenMerchantIds.has(merchantId)) continue;
    seenMerchantIds.add(merchantId);
    const variants = (r.merchant_name_variations || "")
      .split("|")
      .map((v) => v.trim())
      .filter(Boolean)
      .join("; ");
    batch.push({
      id: randomUUID(),
      merchantId,
      merchantName: r.normalized_brand_name,
      normalizedName: normalizeMerchant(r.normalized_brand_name),
      variant: variants || null,
      categoryCode: pair.categoryCode,
      subCategoryCode: pair.subCategoryCode,
      rawCategoryGroup: r.category || null,
      rawCategory: r.category || null,
      subcategoryLabel: r.subcategory || null,
      region: r.primary_market || r.region || "NA",
      confidence: 1.0,
      source: "kit_na_csv",
    });
  }
  insertedTotal += await flush(batch);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(atelierGlobalMerchants);

  console.log(
    `[seed] EU rows: ${euRows}, NA rows: ${naRows}, inserted this run: ${insertedTotal}, table total: ${count}`,
  );

  if (unmappedEu.size || unmappedNa.size) {
    console.error("[seed] UNMAPPED LABELS FOUND — add them to aliasMap.ts:");
    for (const [k, n] of unmappedEu) console.error(`  EU ${k} (${n} rows)`);
    for (const [k, n] of unmappedNa) console.error(`  NA ${k} (${n} rows)`);
    process.exit(1);
  }
  console.log("[seed] all distinct CSV labels covered by the alias map");
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed] failed:", e);
  process.exit(1);
});
