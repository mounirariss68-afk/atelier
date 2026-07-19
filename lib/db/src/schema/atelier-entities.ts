/**
 * Task #249 — Legal-entity registry.
 *
 * Persistent registry of the firm's own legal entities (the Dubai LLC
 * first). One row per entity; child collections (registrations,
 * licensed activities, owners/managers, lease) are typed jsonb columns
 * edited as whole collections through the entity CRUD API. Bilingual
 * fields keep the English and Arabic strings side by side, verbatim
 * from the source documents.
 *
 * Entities are archived, never hard-deleted. Vault documents link to an
 * entity via atelier_documents.entity_id.
 */

import { pgTable, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export interface EntityRegistration {
  id: string;
  /** trade_license | commercial_register | chamber_membership | establishment_card | tax | other */
  type: string;
  label: string;
  number: string;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
}

export interface EntityActivity {
  code: string;
  nameEn: string;
  nameAr: string | null;
  status: string | null;
}

export interface EntityOwner {
  name: string;
  nameAr: string | null;
  roles: string[];
  sharePct: number | null;
  nationality: string | null;
  passportNo: string | null;
  personNo: string | null;
  /** Linked Atelier login (users table id) when this person is on the roster. */
  userId: string | null;
}

export interface EntityPremises {
  addressLine: string | null;
  building: string | null;
  unit: string | null;
  area: string | null;
  city: string | null;
  plotNumber: string | null;
  makaniNo: string | null;
  sizeSqm: number | null;
  usage: string | null;
}

export interface EntityLease {
  contractNo: string | null;
  ejariTenantNo: string | null;
  lessorName: string | null;
  lessorLicenseNo: string | null;
  ownerName: string | null;
  startDate: string | null;
  endDate: string | null;
  annualRentAed: number | null;
  securityDepositAed: number | null;
  areaSqm: number | null;
  registrationFeesAed: number | null;
  notes: string | null;
}

/**
 * Task #271 — fiscal calendar per entity. Entered by finance leadership
 * (never fabricated); drives the tax_vat / tax_ct disbursement lines in
 * the 13-week cash forecast. Dates are YYYY-MM-DD; amounts are in the
 * entity's base currency.
 */
export interface EntityFiscal {
  /** monthly | quarterly */
  vatPeriod: string | null;
  nextVatFilingDate: string | null;
  vatExpectedAmount: number | null;
  nextCtFilingDate: string | null;
  ctExpectedAmount: number | null;
}

export const atelierLegalEntities = pgTable(
  "atelier_legal_entities",
  {
    id: text("id").primaryKey(), // lent_...
    orgId: text("org_id").notNull().default("aico"),
    legalNameEn: text("legal_name_en").notNull(),
    legalNameAr: text("legal_name_ar"),
    shortName: text("short_name").notNull().default(""),
    /** e.g. "Limited Liability Company (LLC)" */
    legalForm: text("legal_form").notNull().default(""),
    /** ISO-3166 alpha-2 (AE, SA, GB, ...). */
    country: text("country").notNull(),
    jurisdiction: text("jurisdiction").notNull().default(""),
    /** active | in_formation | dormant | winding_down | archived */
    status: text("status").notNull().default("active"),
    incorporationDate: text("incorporation_date"),
    durationYears: integer("duration_years"),
    baseCurrency: text("base_currency").notNull().default(""),
    registeredAddress: text("registered_address").notNull().default(""),
    governingLaw: text("governing_law").notNull().default(""),
    courts: text("courts").notNull().default(""),
    registrations: jsonb("registrations").$type<EntityRegistration[]>().notNull().default([]),
    activities: jsonb("activities").$type<EntityActivity[]>().notNull().default([]),
    owners: jsonb("owners").$type<EntityOwner[]>().notNull().default([]),
    premises: jsonb("premises").$type<EntityPremises | null>(),
    lease: jsonb("lease").$type<EntityLease | null>(),
    fiscal: jsonb("fiscal").$type<EntityFiscal | null>(),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_legal_entities_org").on(t.orgId),
    index("idx_atelier_legal_entities_country").on(t.orgId, t.country),
  ],
);
