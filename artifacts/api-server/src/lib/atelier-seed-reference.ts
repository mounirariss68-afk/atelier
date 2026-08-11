/**
 * Atelier — reference-data boot seed.
 *
 * Ensures `atelier_countries` (249 ISO 3166-1 alpha-2 entries with EN/AR/TR
 * display names from `i18n-iso-countries` plus firm-specific extras),
 * `atelier_industries` (9 Cognirise sectors), and `atelier_sub_industries`
 * (44 entries) are populated. This is reference/configuration data — NOT
 * demo data — and the UI dropdowns (ReferenceCombobox) are unusable
 * without it, so it runs idempotently on every cold start.
 *
 * Self-healing and edit-safe: rows are inserted with ON CONFLICT DO NOTHING
 * under a pg advisory lock, and each table is only touched when it holds
 * fewer rows than the canonical set — so an interrupted or racing boot
 * repairs missing rows on the next start, while user edits made through the
 * admin Reference Data page are never overwritten.
 */

import {
  db,
  atelierCountries,
  atelierIndustries,
  atelierSubIndustries,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import arLocale from "i18n-iso-countries/langs/ar.json";
import trLocale from "i18n-iso-countries/langs/tr.json";
import {
  COUNTRY_EXTRAS,
  INDUSTRIES,
  REGION_BY_ISO,
  SUB_INDUSTRIES,
} from "./data/atelier-reference-data.js";
import { logger } from "./logger.js";

countries.registerLocale(enLocale as Parameters<typeof countries.registerLocale>[0]);
countries.registerLocale(arLocale as Parameters<typeof countries.registerLocale>[0]);
countries.registerLocale(trLocale as Parameters<typeof countries.registerLocale>[0]);

async function tableCount(table: string): Promise<number> {
  const res = await db.execute(
    sql.raw(`SELECT count(*)::int AS n FROM ${table}`),
  );
  const rows = res.rows as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// Arbitrary but stable advisory-lock key for reference seeding, so
// concurrent cold starts (multi-instance deploys) don't race each other.
const REFERENCE_SEED_LOCK_KEY = 74_291_003;

export async function ensureAtelierReferenceSeed(): Promise<void> {
  await db.execute(
    sql`SELECT pg_advisory_lock(${REFERENCE_SEED_LOCK_KEY})`,
  );
  try {
    await seedMissingRows();
    await normalizeRetiredGenderValues();
  } finally {
    await db.execute(
      sql`SELECT pg_advisory_unlock(${REFERENCE_SEED_LOCK_KEY})`,
    );
  }
}

async function seedMissingRows(): Promise<void> {
  // ---- COUNTRIES ----
  if ((await tableCount("atelier_countries")) < 249) {
    // i18n-iso-countries includes "XK" (Kosovo, user-assigned, not ISO
    // 3166-1). Strip it so we ship exactly the 249 official entries.
    const allAlpha2 = Object.keys(countries.getAlpha2Codes()).filter(
      (c) => c !== "XK",
    );
    const countryRows = allAlpha2.map((iso2) => {
      const extras = COUNTRY_EXTRAS[iso2] ?? {};
      const region = extras.region ?? REGION_BY_ISO[iso2] ?? "Asia";
      return {
        isoAlpha2: iso2,
        isoAlpha3: countries.alpha2ToAlpha3(iso2) ?? iso2,
        isoNumeric: countries.alpha2ToNumeric(iso2) ?? "",
        displayNameEn: countries.getName(iso2, "en") ?? iso2,
        displayNameAr: countries.getName(iso2, "ar") ?? null,
        displayNameTr:
          extras.displayNameTr ?? countries.getName(iso2, "tr") ?? null,
        aliases: extras.aliases ?? [],
        region,
        subRegion: extras.subRegion ?? null,
        flagEmoji: extras.flagEmoji ?? isoToFlagEmoji(iso2),
        primaryCurrency: extras.primaryCurrency ?? null,
        primaryLanguage: extras.primaryLanguage ?? null,
        dialCode: extras.dialCode ?? null,
        vatDefaultPct: extras.vatDefaultPct ?? null,
        isGcc: extras.isGcc ?? false,
        isCogniriseTargetMarket: extras.isCogniriseTargetMarket ?? false,
        status: "active" as const,
        displayOrderOverride: extras.displayOrderOverride ?? null,
        createdByUserId: "system",
      };
    });
    for (let i = 0; i < countryRows.length; i += 100) {
      await db
        .insert(atelierCountries)
        .values(countryRows.slice(i, i + 100))
        .onConflictDoNothing();
    }
    logger.info({ count: countryRows.length }, "Reference seed: countries");
  }

  // ---- INDUSTRIES ----
  if ((await tableCount("atelier_industries")) < INDUSTRIES.length) {
    await db.insert(atelierIndustries).values(
      INDUSTRIES.map((i) => ({
        code: i.code,
        displayNameEn: i.displayNameEn,
        displayNameAr: i.displayNameAr,
        shortDescription: i.shortDescription,
        displayOrder: i.displayOrder,
        status: "active" as const,
        createdByUserId: "system",
      })),
    ).onConflictDoNothing();
    logger.info({ count: INDUSTRIES.length }, "Reference seed: industries");
  }

  // ---- SUB-INDUSTRIES ----
  if ((await tableCount("atelier_sub_industries")) < SUB_INDUSTRIES.length) {
    await db.insert(atelierSubIndustries).values(
      SUB_INDUSTRIES.map((s) => ({
        code: s.code,
        industryCode: s.industryCode,
        displayNameEn: s.displayNameEn,
        shortDescription: s.shortDescription,
        defaultOfferingAnchor: s.defaultOfferingAnchor,
        displayOrder: s.displayOrder,
        status: "active" as const,
        createdByUserId: "system",
      })),
    ).onConflictDoNothing();
    logger.info(
      { count: SUB_INDUSTRIES.length },
      "Reference seed: sub-industries",
    );
  }
}

/**
 * One-way data backfill: "non_binary" was removed from the gender option
 * list (now female | male | unspecified), so any legacy rows still holding
 * the retired value are folded into "unspecified". Idempotent and cheap
 * (no-op UPDATE once clean), so it runs on every cold start — this also
 * covers the production database on the next deploy. Guarded with
 * to_regclass so a fresh DB mid-provisioning doesn't abort the boot batch.
 */
async function normalizeRetiredGenderValues(): Promise<void> {
  const tables = [
    "atelier_employees",
    "atelier_contractors",
    "atelier_partner_firm_resources",
  ];
  for (const table of tables) {
    const exists = await db.execute(
      sql.raw(`SELECT to_regclass('${table}') IS NOT NULL AS present`),
    );
    if (!(exists.rows[0] as { present?: boolean } | undefined)?.present) continue;
    const res = await db.execute(
      sql.raw(
        `UPDATE ${table} SET gender = 'unspecified' WHERE gender = 'non_binary'`,
      ),
    );
    const updated = res.rowCount ?? 0;
    if (updated > 0) {
      logger.info(
        { table, updated },
        "Gender backfill: normalized retired non_binary value to unspecified",
      );
    }
  }
}

function isoToFlagEmoji(iso2: string): string {
  if (!/^[A-Z]{2}$/.test(iso2)) return "";
  const offset = 127397;
  return String.fromCodePoint(
    ...iso2.split("").map((c) => c.charCodeAt(0) + offset),
  );
}
