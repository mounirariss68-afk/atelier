import { pgTable, text, timestamp, date, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
/** Canonical, effective-dated relationship classification for a stable person. */
export const atelierPersonRelationshipClassifications = pgTable("atelier_person_relationship_classifications", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"),
  personId: text("person_id").notNull(),
  relationshipType: text("relationship_type").notNull(), // employee|contractor|equity_partner|non_equity_partner|partner_firm_resource
  compensationBasis: text("compensation_basis"), // salary|day_rate|profit_sharing|none
  status: text("status").notNull().default("active"),
  effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"),
  source: text("source").notNull().default("admin"), provenanceId: text("provenance_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: text("created_by_user_id"), deletedAt: timestamp("deleted_at"),
}, (t) => [uniqueIndex("uq_atelier_person_relationship_effective").on(t.orgId, t.personId, t.effectiveFrom), index("idx_atelier_person_relationship_person").on(t.orgId, t.personId)]);
/** Stable legacy/import key. It never resolves by display name. */
export const atelierAdminPersonMappings = pgTable("atelier_admin_person_mappings", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), stableKey: text("stable_key").notNull(), personId: text("person_id").notNull(), metadata: jsonb("metadata").notNull().default({}), createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(), createdByUserId: text("created_by_user_id"), deletedAt: timestamp("deleted_at"),
}, (t) => [uniqueIndex("uq_atelier_admin_mapping_key").on(t.orgId, t.stableKey)]);