/* eslint-disable no-console */
/**
 * The Atelier — reference-data seed (Task #290).
 *
 * Populates `atelier_countries` with all 249 ISO 3166-1 alpha-2 entries
 * (EN/AR/TR display names sourced from `i18n-iso-countries`, augmented with
 * firm-specific extras from `data/atelier-countries.ts`), the 8 primary
 * `atelier_industries`, and the 43 `atelier_sub_industries`.
 *
 * Idempotent: TRUNCATE then INSERT under org_id='aico'. Safe to call from
 * `seed-atelier.ts` or invoke standalone via `pnpm tsx scripts/src/seed-atelier-reference.ts`.
 */

import {
  db,
  pool,
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
} from "./data/atelier-countries.js";

countries.registerLocale(enLocale as Parameters<typeof countries.registerLocale>[0]);
countries.registerLocale(arLocale as Parameters<typeof countries.registerLocale>[0]);
countries.registerLocale(trLocale as Parameters<typeof countries.registerLocale>[0]);

export async function seedAtelierReference(): Promise<{
  countries: number;
  industries: number;
  subIndustries: number;
}> {
  // Idempotent reset.
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE atelier_sub_industries, atelier_industries, atelier_countries RESTART IDENTITY CASCADE`,
    ),
  );

  // ---- COUNTRIES ----
  // i18n-iso-countries includes "XK" (Kosovo, user-assigned, not part of
  // ISO 3166-1). Strip it so we ship exactly the 249 official ISO alpha-2
  // entries the spec calls for.
  const allAlpha2 = Object.keys(countries.getAlpha2Codes()).filter(
    (c) => c !== "XK",
  );
  if (allAlpha2.length !== 249) {
    throw new Error(
      `[seed-atelier-reference] expected 249 ISO 3166-1 alpha-2 codes, got ${allAlpha2.length}`,
    );
  }
  const countryRows = allAlpha2.map((iso2) => {
    const extras = COUNTRY_EXTRAS[iso2] ?? {};
    const region = extras.region ?? REGION_BY_ISO[iso2] ?? "Asia";
    const isoAlpha3 = countries.alpha2ToAlpha3(iso2) ?? iso2;
    const isoNumeric = countries.alpha2ToNumeric(iso2) ?? "";
    const nameEn = countries.getName(iso2, "en") ?? iso2;
    const nameAr = countries.getName(iso2, "ar") ?? null;
    const nameTr = extras.displayNameTr ?? countries.getName(iso2, "tr") ?? null;
    return {
      isoAlpha2: iso2,
      isoAlpha3,
      isoNumeric,
      displayNameEn: nameEn,
      displayNameAr: nameAr,
      displayNameTr: nameTr,
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

  // Chunked insert (PG parameter cap is ~64k; ~17 cols × 249 rows is fine
  // in one shot but stay defensive).
  for (let i = 0; i < countryRows.length; i += 100) {
    await db.insert(atelierCountries).values(countryRows.slice(i, i + 100));
  }

  // ---- INDUSTRIES ----
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
  );

  // ---- SUB-INDUSTRIES ----
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
  );

  return {
    countries: countryRows.length,
    industries: INDUSTRIES.length,
    subIndustries: SUB_INDUSTRIES.length,
  };
}

function isoToFlagEmoji(iso2: string): string {
  if (!/^[A-Z]{2}$/.test(iso2)) return "";
  const offset = 127397; // 'A'.codePointAt(0)! (65) + 127362
  return String.fromCodePoint(...iso2.split("").map((c) => c.charCodeAt(0) + offset));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedAtelierReference()
    .then((counts) => {
      console.log("[seed-atelier-reference] done", counts);
      return pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
