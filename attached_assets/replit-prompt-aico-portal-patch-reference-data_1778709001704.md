# Replit Build Prompt — Patch: Reference Data (Countries + Industries)

**For:** AICo (working name "Maven AI").
**Authored:** May 12 2026 — Mounir Ariss with Claude.
**Type:** Patch document. Modifies v1, v2, and v3 wherever a country or industry value is captured.
**Status:** Drop-in patch. Apply during or after the v1/v2/v3 build. Safe to apply at any point; the migration is idempotent.

**Pitch in one line:** Every place in the portal that captures a country or industry becomes a **searchable combobox** backed by a standardized lookup — one source of truth, one component, one consistent set of values everywhere.

---

## How to use this document

Paste everything below `<<<REPLIT PROMPT BEGINS>>>` into Replit's AI Agent on the same repo as v1 + v2 + v3. The agent will create a `reference_data` module, replace every text country/industry field with foreign-key references, add a reusable typeahead combobox component, and write a migration that maps existing values to the new lookup.

**Two seed lists are embedded in this patch:**

1. **Countries** — ISO 3166-1 alpha-2, 249 entries, with region tags and GCC priority flags.
2. **Industries** — 8 primary industries + ~45 sub-industries (Mounir-approved AICo taxonomy).

Both lists are editable post-seed by Founding Partner or HR at `/admin/reference-data`. Edits are versioned and audit-logged.

---

<<<REPLIT PROMPT BEGINS>>>

# Project Patch: Reference Data Standardization

You are extending the AICo Atelier app (v1 + v2 + v3) with a single source of truth for countries and industries. Every field in the portal that previously accepted free-text country or industry values is replaced with a foreign-key reference to a seeded lookup table, surfaced through a shared searchable combobox component.

Inherit all v1 + v2 + v3 non-negotiables.

---

## 0. Non-negotiable principles (additions)

1. **No free-text countries or industries anywhere.** Every input that captures a country or industry uses the standard combobox. Pasting an unrecognized value is rejected with a helpful suggestion.
2. **GCC priority is structural.** GCC countries float to the top of every country combobox by default. The firm sells primarily in KSA + UAE; the UI respects that.
3. **The lookups are editable but auditable.** Founding Partner / HR can add or deprecate entries; every edit writes a versioned record so reports remain reproducible after a renaming.
4. **Deprecation, not deletion.** Lookup entries are never deleted (existing records reference them). Instead they are marked `deprecated` and hidden from new selections.
5. **Industries are hierarchical: primary + optional sub-industry.** Reports roll up at the primary level; case-study matching and skill graph use the sub-industry for relevance.
6. **Countries have a stable ISO code; display names can change.** The code (e.g., `SA`) is the foreign key; the display name is a property that can be updated without breaking references.

---

## 1. The country list (ISO 3166-1 alpha-2)

### 1.1 Schema

```ts
Country {
  iso_alpha_2,                       // primary key — 'SA' | 'AE' | 'TR' | ...
  iso_alpha_3,                       // 'SAU' | 'ARE' | 'TUR'
  iso_numeric,                       // 682, 784, 792
  display_name_en,                   // 'Saudi Arabia'
  display_name_ar,                   // 'المملكة العربية السعودية'
  display_name_tr?,                  // 'Suudi Arabistan' (Türkiye localization since AICo has a Türkiye entity)
  aliases[],                         // ['KSA', 'Kingdom of Saudi Arabia']
  region,                            // 'GCC' | 'MENA' | 'Africa' | 'Asia' | 'Europe' | 'Americas' | 'Oceania' | 'Antarctica'
  sub_region,                        // 'Western Asia' | 'Northern Africa' | 'Southern Europe' | ...
  flag_emoji,                        // '🇸🇦'
  primary_currency,                  // 'SAR'
  primary_language,                  // 'ar'
  dial_code,                         // '+966'
  vat_default_pct,                   // 15
  is_gcc,                            // bool — used for priority sort
  is_aico_target_market,             // bool — KSA, UAE, Türkiye = true day 1; others adjustable
  status,                            // 'active' | 'deprecated'
  display_order_override?            // for pinning specific countries to top (rare)
}
```

### 1.2 Seed

Seed all **249 ISO 3166-1 alpha-2 countries** (including territories). The Replit agent should pull the canonical list from a static JSON file shipped with this patch (or write one to `/seed/countries.json`).

The seed must include (mandatory accuracy):

- **GCC (`is_gcc=true`, surface at top of every list):** SA (Saudi Arabia), AE (United Arab Emirates), QA (Qatar), KW (Kuwait), BH (Bahrain), OM (Oman). Display order: SA, AE, QA, KW, BH, OM.
- **AICo target markets day 1 (`is_aico_target_market=true`):** SA, AE, TR (Türkiye). Mark these explicitly for UI hints.
- **Common GCC adjacency:** EG (Egypt), JO (Jordan), LB (Lebanon), IQ (Iraq), YE (Yemen).
- **All 47 African countries, 47 European countries, 50 Asian countries, etc.** Use the standard ISO 3166-1 list.

The Replit agent must compile the seed JSON before running the migration; it should be derivable from any standard ISO library (e.g., `i18n-iso-countries` npm package). Aliases must include common informal names ("UAE" → "AE", "KSA" → "SA", "UK" → "GB", "US" → "US", "Holland" → "NL", "Burma" → "MM").

### 1.3 Region tags (used in reports)

```
GCC:       SA, AE, QA, KW, BH, OM
MENA:      DZ, BH, KM, DJ, EG, IR, IQ, IL, JO, KW, LB, LY, MR, MA, OM, PS, QA, SA, SO, SD, SY, TN, AE, YE
Africa:    [all 54 African ISO codes]
Asia:      [all 48 Asian ISO codes, including GCC and TR]
Europe:    [all 44 European ISO codes]
Americas:  [all North + South + Central American + Caribbean codes]
Oceania:   [all 14 Oceania codes]
```

Note: GCC is a sub-region; the `region` field on a GCC country is `MENA` for region-level reports and `GCC` is captured via the `is_gcc` flag. This avoids region duplication while preserving the priority sort.

---

## 2. The industry list (AICo taxonomy)

### 2.1 Schema

```ts
Industry {
  code,                              // primary key — 'FS' | 'HPS' | 'TMT' | 'RC' | 'ER' | 'IGR' | 'TTH' | 'XSEC'
  display_name_en,                   // 'Financial Services'
  display_name_ar?,
  short_description,                 // 'Banks, insurers, capital markets, FinTech'
  display_order,                     // 1..8
  status                             // 'active' | 'deprecated'
}

SubIndustry {
  code,                              // primary key — 'FS_BANKING' | 'HPS_FED' | ...
  industry_code,                     // FK → Industry.code
  display_name_en, display_name_ar?,
  short_description,
  display_order,
  status,
  default_offering_anchor?           // 'agentic_ai' | 'legacy_modernization' | 'data_foundations' | 'ai_product'
}
```

### 2.2 Seed

Seed the **8 primary industries** with the codes and order below. The display orders reflect AICo's strategic priority in the GCC.

| Order | Code | Industry | Notes |
|---|---|---|---|
| 1 | HPS | Health & Public Sector | Largest AICo opportunity in GCC (government, sovereign, healthcare) |
| 2 | FS | Financial Services | Banks, insurers, capital markets, FinTech |
| 3 | TMT | Technology, Media & Telecom | Telcos, media, software, digital natives |
| 4 | ER | Energy & Resources | Oil & gas, mining, utilities, chemicals, renewables |
| 5 | IGR | Industrial Goods & Real Estate | Construction, real estate, manufacturing, A&D |
| 6 | TTH | Travel, Transportation & Hospitality | Aviation, ports, logistics, hospitality |
| 7 | RC | Retail & Consumer Goods | Retail, CPG, luxury, beauty, F&B |
| 8 | XSEC | Cross-Sector / Diversified | Conglomerates, PE, family holdings, NGOs, other |

### 2.3 Sub-industries seed

| Industry | Sub-Industry Code | Display Name |
|---|---|---|
| HPS | HPS_FED | Federal Government |
| HPS | HPS_LOCAL | Local Government / Municipalities |
| HPS | HPS_SOVEREIGN | Sovereign Wealth / SWF |
| HPS | HPS_HEALTHCARE | Healthcare Providers |
| HPS | HPS_PHARMA | Pharma & Life Sciences |
| HPS | HPS_EDUCATION | Education |
| HPS | HPS_DEFENSE_CIVIL | Defense (civilian / non-classified) |
| HPS | HPS_NGO | NGO / Multilateral |
| FS | FS_BANKING | Banking |
| FS | FS_INSURANCE | Insurance |
| FS | FS_CAPMKT | Capital Markets |
| FS | FS_WEALTH | Wealth & Asset Management |
| FS | FS_FINTECH | FinTech |
| FS | FS_ISLAMIC | Islamic Finance |
| TMT | TMT_TELECOM | Telecom |
| TMT | TMT_MEDIA | Media & Entertainment |
| TMT | TMT_SOFTWARE | Software |
| TMT | TMT_HIGHTECH | High Tech / Hardware |
| TMT | TMT_DIGITAL_NATIVE | Digital Native |
| ER | ER_OIL_GAS | Oil & Gas |
| ER | ER_MINING | Mining & Metals |
| ER | ER_UTILITIES | Utilities (Power & Water) |
| ER | ER_CHEMICALS | Chemicals |
| ER | ER_PETROCHEM | Petrochemicals |
| ER | ER_RENEWABLES | Renewables / Clean Energy |
| IGR | IGR_CONSTRUCTION | Construction & Engineering |
| IGR | IGR_REAL_ESTATE | Real Estate Development |
| IGR | IGR_MANUFACTURING | Industrial Manufacturing |
| IGR | IGR_AEROSPACE_DEFENSE | Aerospace & Defense (commercial) |
| IGR | IGR_ENG_SVCS | Engineering Services |
| TTH | TTH_AVIATION | Aviation |
| TTH | TTH_PORTS_SHIPPING | Ports & Shipping |
| TTH | TTH_LOGISTICS | Logistics |
| TTH | TTH_HOSPITALITY | Hospitality |
| TTH | TTH_TOURISM_AUTHORITY | Tourism Authorities |
| RC | RC_RETAIL | Retail |
| RC | RC_CPG | Consumer Packaged Goods |
| RC | RC_LUXURY | Luxury |
| RC | RC_BEAUTY | Beauty & Personal Care |
| RC | RC_FB | Food & Beverage |
| XSEC | XSEC_CONGLOMERATE | Conglomerate / Family Holding |
| XSEC | XSEC_PE | Private Equity / Investment |
| XSEC | XSEC_OTHER | Other / Unclassified |

Total: 43 sub-industries across 8 primary industries.

---

## 3. The shared combobox component

### 3.1 Component spec

Build one React component `<ReferenceCombobox />` with two configurations: `kind="country"` and `kind="industry"`. Used everywhere a country or industry is captured.

```tsx
<ReferenceCombobox
  kind="country" | "industry" | "sub_industry"
  value={iso_alpha_2 | code}
  onChange={(code) => ...}
  required?
  parentIndustry?       // for sub_industry: restrict to one primary
  allowDeprecated={false}
  placeholder="Search countries…"
  size="sm" | "md" | "lg"
  disabled?
/>
```

### 3.2 UX behavior

- **Typeahead search** — searches `display_name_en`, `display_name_ar`, `display_name_tr`, `aliases`, ISO codes. Match is case-insensitive and accent-insensitive.
- **Default sort for countries:**
  1. GCC countries first (SA, AE, QA, KW, BH, OM — in that order).
  2. Then AICo target markets (TR).
  3. Then MENA non-GCC.
  4. Then everything else alphabetically.
  5. Deprecated entries excluded unless `allowDeprecated=true`.
- **Default sort for industries:** by `display_order` (HPS, FS, TMT, ER, IGR, TTH, RC, XSEC).
- **Default sort for sub-industries:** by `display_order` within the selected parent industry.
- **Visual elements:**
  - Country: flag emoji + display name + ISO code in muted text (`🇸🇦 Saudi Arabia · SA`).
  - Industry: code chip + display name + short description on hover.
  - Sub-industry: parent industry chip + display name.
- **Keyboard navigation** — arrow keys, Enter to select, Escape to clear.
- **A11y** — ARIA combobox role, `aria-expanded`, screen-reader-announced results count.
- **Empty state** — "No matches. Add 'X' as a new entry?" (button only visible to Founding Partner / HR; logs a request otherwise).
- **Bilingual** — when the UI language is AR, display names render in Arabic and the search input switches to RTL.

### 3.3 Implementation note

Use **shadcn/ui Command** (built on cmdk) for the underlying combobox. The lookup list is hydrated once on app boot via a single fetch to `/api/reference-data/bootstrap` (cached client-side; invalidated when admin edits a lookup).

---

## 4. Tables that change

Every existing column that previously captured a country or industry as text is now a foreign-key reference to the lookup table.

### 4.1 Countries

| Table.column | Old type | New type |
|---|---|---|
| `accounts.country` | text | `country_iso_alpha_2` FK |
| `accounts.hq_city` | text | text (no change — city is free text; country is the FK) |
| `contacts.country` (new) | — | `country_iso_alpha_2` FK |
| `employees.payroll_country` | text | `country_iso_alpha_2` FK |
| `employees.languages` (jsonb) | n/a | per-language ISO 639-1 code (separate lookup, v4) |
| `contractors.contracting_entity_country` | text | `country_iso_alpha_2` FK |
| `partner_firms.hq_country` | text | `country_iso_alpha_2` FK |
| `partner_firms.operating_countries` (jsonb[]) | text[] | `country_iso_alpha_2[]` FK |
| `partner_firm_resources.country` (new) | — | `country_iso_alpha_2` FK |
| `rate_cards.geography` | text | `country_iso_alpha_2[]` FK (a rate card can apply to multiple countries) |
| `expenses.country` | text | `country_iso_alpha_2` FK |
| `vat_register.country` | text | `country_iso_alpha_2` FK |
| `meetings.location_country` (new, in-person meetings) | — | `country_iso_alpha_2` FK |
| `compliance_records.jurisdiction` | text | `country_iso_alpha_2` FK |
| `credentials.client_country` (new) | — | `country_iso_alpha_2` FK |
| `case_studies.sector_country` | text | `country_iso_alpha_2` FK |
| `board_users.affiliated_party_country` (new) | — | `country_iso_alpha_2` FK |

When v4 ships, the same FK pattern applies to: entities (license country), bank accounts (country), payroll handoffs (country), intercompany invoices (from/to country), tax filings (country).

### 4.2 Industries

| Table.column | Old type | New type |
|---|---|---|
| `accounts.sector` | text | `industry_code` FK + `sub_industry_code?` FK |
| `opportunities.target_industry` (new) | — | inherited from account; overridable |
| `engagements.engagement_industry` (new) | — | inherited from opportunity; overridable |
| `partner_firms.focus_industries` (jsonb) | text[] | `industry_code[]` FK |
| `partner_firm_resources.industry_experience` (new) | — | `industry_code[]` FK |
| `credentials.industry` | text | `industry_code` FK + `sub_industry_code?` FK |
| `case_studies.industry` | text | `industry_code` FK + `sub_industry_code?` FK |
| `atelier_assets.industry_tags` (new) | — | `industry_code[]` FK |
| `skills.industry_relevance` (new) | — | `industry_code[]` FK |
| `person_skills.industry_specialization` (new) | — | `industry_code[]` FK |
| `employees.industry_experience` (new) | — | `industry_code[]` FK (used by Bio Crafter) |
| `proposals.industry_anchor` (new) | — | `industry_code` FK + `sub_industry_code?` FK |

When v4 ships, the same pattern applies to: thought-leadership articles, win themes (industry tag), QBR canvases.

---

## 5. Migration

Write a Drizzle migration that:

### 5.1 Step 1 — Create lookups

1. Create `countries`, `industries`, `sub_industries` tables.
2. Seed all 249 countries from `/seed/countries.json` with the metadata in §1.2.
3. Seed 8 industries and 43 sub-industries from §2.2 and §2.3.

### 5.2 Step 2 — Add new FK columns

For every table in §4, add the new FK columns *alongside* the existing text columns (don't drop yet). Keep both populated during migration.

### 5.3 Step 3 — Map existing values

Run a mapping script that for every row with a populated text country/industry field, attempts to map to the FK:

**Country mapping:**
1. Exact match on `display_name_en` (case-insensitive).
2. Match on aliases.
3. Match on ISO codes (alpha-2 or alpha-3).
4. Fuzzy match (Levenshtein distance ≤ 2) with a confidence score.
5. Unmapped values → write to a `migration_unmapped_countries` table for HR/Founding Partner manual resolution.

**Industry mapping (for the v2 sector text values):**

| Old text value | New industry / sub-industry |
|---|---|
| Public Sector | HPS / HPS_FED (default to Federal; HR can refine) |
| Government | HPS / HPS_FED |
| Telecom | TMT / TMT_TELECOM |
| BFSI | FS / FS_BANKING (default; refine to Insurance / CapMkt manually) |
| Banking | FS / FS_BANKING |
| Insurance | FS / FS_INSURANCE |
| Real Estate | IGR / IGR_REAL_ESTATE |
| Healthcare | HPS / HPS_HEALTHCARE |
| Construction | IGR / IGR_CONSTRUCTION |
| Oil & Gas | ER / ER_OIL_GAS |
| Retail | RC / RC_RETAIL |
| Aviation | TTH / TTH_AVIATION |
| Hospitality | TTH / TTH_HOSPITALITY |
| Sovereign | HPS / HPS_SOVEREIGN |
| Other / Diversified / "" | XSEC / XSEC_OTHER |

Unmapped industries → `migration_unmapped_industries` for resolution.

### 5.4 Step 4 — Validate

Before dropping the text columns, the migration runs a validation pass:

- Every row in the affected tables has a populated FK (or is in `migration_unmapped_*`).
- Every FK references an active (not deprecated) lookup entry.
- The total count of mapped rows equals the prior count of non-null text values.

If validation fails on any table, the migration halts with a report of the failing rows. Founding Partner / HR resolves manually at `/admin/reference-data/migration` before the migration completes.

### 5.5 Step 5 — Drop text columns

After validation passes, drop the old text columns. Log the drop in audit. Existing reports recompute against the FK columns.

### 5.6 Audit

Every migrated row writes a `reference_data_migration` audit event with:
- `entity_type`, `entity_id`
- `field_name`
- `old_text_value`
- `new_fk_code`
- `confidence` (`exact` | `alias` | `iso_code` | `fuzzy_score` | `manual`)
- `resolved_by_user_id` (for manual resolutions)
- `ts`

---

## 6. Admin surfaces

### 6.1 `/admin/reference-data` (Founding Partner + HR)

Two tabs:

**Countries tab:**
- List of all 249 entries, filterable by region.
- Edit display names (EN / AR / TR), aliases, target-market flag, GCC flag.
- Deprecate / un-deprecate entries.
- Cannot delete (ever). Cannot change ISO codes.
- Audit feed at the bottom.

**Industries tab:**
- List of 8 primary + 43 sub-industries, filterable by primary.
- Add / edit / deprecate sub-industries.
- Cannot delete primary industries (deprecate instead).
- Reorder via drag (writes `display_order`).
- Adding a new sub-industry: requires a `default_offering_anchor` and a `short_description`.

### 6.2 `/admin/reference-data/migration` (Founding Partner + HR)

Shown only while unmapped rows exist. A table of every row that couldn't be auto-mapped, with the original text value, a suggested mapping (best fuzzy match), and a one-click "Apply" button. Bulk-apply works too. Closes when zero unmapped rows remain.

---

## 7. Reports and aggregations that benefit

Add or update these views once the FKs are in place:

1. **Pipeline by industry** — opportunities grouped by `industry_code` (with sub-industry drill-down). Replaces ad-hoc text grouping in v2 §5 Report 1.
2. **Win rate by industry** — extends v2 §5 Report 5 with sub-industry drill-down.
3. **Pipeline by country / region** — opportunities and engagements grouped by `country_iso_alpha_2`, then rolled up by `region` and `is_gcc`.
4. **Senior-delivery proof by country** — extends v2 §5 Report 9 with geography.
5. **Atelier reuse by industry** — extends v2 §5 Report 8 with the industry tag from each asset.
6. **Engagement health by region** — extends v2 §5 Report 7 with GCC vs. MENA vs. Other roll-ups.
7. **Skill graph density by industry** — for each industry, how many people have skills tagged to it.

---

## 8. Agents affected (no new agents; existing agents now use the lookups)

These agents start respecting the lookups in their inputs and outputs:

- **Account Cartographer** (v2) — when proposing decision-maker additions, must select a country from the lookup.
- **Pursuit Scout** (v1) — produces opportunity briefs with industry codes (not free text); enables better case-study matching.
- **Case Study Picker** (v1) — relevance ranking now keys on `industry_code` + `sub_industry_code` + `country_iso_alpha_2` overlap with the open opportunity.
- **POV Author** (v1) — accepts industry / sub-industry / country as structured prompt fields; uses them to pull comparable POVs.
- **Bio Crafter** (proposal patch) — pulls bios filtered by industry experience.
- **Win/Loss Interviewer** (v2) — themes are now industry-tagged so the Theme Curator can roll up by sector.
- **Whitespace Mapper** (v2) — operates on the industry × buyer-persona grid using the new lookups.

---

## 9. MVP scope of this patch

### 9.1 What ships

1. `countries` and `industries` + `sub_industries` lookup tables, seeded.
2. `<ReferenceCombobox />` component, used in every form.
3. Migration with the auto-mapping + manual-resolution flow.
4. `/admin/reference-data` + `/admin/reference-data/migration` admin surfaces.
5. The 7 updated reports (above) use the FK columns.
6. Bilingual (EN + AR) display names for all countries and industries.

### 9.2 Acceptance criteria

A reviewer should be able to:

1. Open the Account create form and select a country from a searchable combobox. Type "K" — GCC countries (KW, then non-GCC starting with K) surface first.
2. Type "UAE" — the alias matches "AE / United Arab Emirates".
3. Type "ksa" — the alias matches "SA / Saudi Arabia".
4. Type "Holland" — alias matches "NL / Netherlands".
5. Open the Account edit form for Tasama; verify that the legacy "Public Sector" text value has been mapped to **HPS / Federal Government** (or whichever sub-industry HR chose during migration).
6. Open `/admin/reference-data`; switch language to AR; verify that all country names render in Arabic and the combobox switches to RTL.
7. Try to type "Mars" into a country field; the empty state offers to "Request 'Mars' be added" — only Founding Partner / HR sees the request-add button.
8. Add a new sub-industry under FS called "Digital Banking" with a description; verify it appears in subsequent industry comboboxes in display-order.
9. Deprecate the "RC_LUXURY" sub-industry; verify it disappears from new selections but existing engagements tagged with it still display it correctly.
10. Run "Pipeline by industry" report; verify it rolls up to 8 primary industries with sub-industry drill-down, GCC countries clearly distinguished.
11. Open the Case Study Picker on a new Tasama opportunity (HPS / Federal Government / SA); verify the top-ranked case studies match on industry + sub-industry + country.

### 9.3 Non-functional

- Combobox first-paint < 100ms (lookup hydrated once at app boot).
- Search response < 50ms locally (no network call per keystroke).
- Bilingual display names parity.
- Empty-state CTA visible only to Founding Partner + HR (per personas patch §3 access matrix).

---

## 10. Out of scope for this patch

- Languages lookup (ISO 639-1) — implied but deferred. Free text for now; v4 patch adds the lookup.
- Currencies lookup (ISO 4217) — implied; v3 already uses currency codes loosely. v4 finance patch formalizes.
- Time zones lookup (IANA) — v4.
- Phone-country dial codes as a separate combobox — v4.
- Region groupings beyond the seven above (e.g., "BENELUX", "DACH") — added only on demand.
- Multi-language extensions beyond EN / AR / TR — pulled by demand.

---

## 11. Build order

1. Lookup schemas + seed CSVs.
2. `<ReferenceCombobox />` component (countries first, then industries / sub-industries).
3. Add FK columns alongside text columns on all affected tables.
4. Auto-mapping migration script.
5. `/admin/reference-data/migration` resolution surface.
6. Drop text columns after validation passes.
7. `/admin/reference-data` admin surfaces.
8. Update the 7 affected reports.
9. Wire the existing agents (Cartographer, Pursuit Scout, Case Study Picker, POV Author, Bio Crafter, Win/Loss Interviewer, Whitespace Mapper) to consume the lookups.
10. Acceptance walkthrough; ship.

---

## 12. North star for this patch (paste into first system prompt)

> AICo's portal speaks one language for places and one for industries. Every country comes from the ISO list, GCC floats to the top, Türkiye sits with KSA and UAE in the day-1 target-market group, and "UAE" still finds "United Arab Emirates." Every industry comes from AICo's eight-bucket strategic taxonomy — HPS, FS, TMT, ER, IGR, TTH, RC, XSEC — with sub-industries that match how the firm actually staffs and how case studies actually match. No more free-text variants. One source of truth, one component, one consistent view of the world.

<<<REPLIT PROMPT ENDS>>>

---

## Appendix F — How to adjust the industry list before applying

If you want to change the eight primary industries before the patch runs:

1. Edit §2.2 (the primary industries table) with your final list.
2. Edit §2.3 (the sub-industries table) with the matching children.
3. Edit §5.3 (the migration mapping) so the old text values map to your new codes.
4. Apply the patch.

The codes themselves (HPS, FS, TMT, etc.) are stable identifiers; if you want different codes, change them in the seed before the migration runs — the Replit agent will use whatever codes the seed has.

---

*End of patch. Pairs with the personas patch (industry / country fields respect the same data sensitivity rules); precedes v4 finance (where bank accounts, entities, and taxes will use the same country FK).*
