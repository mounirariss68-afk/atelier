import { pgTable, text, timestamp, date, jsonb, index, uniqueIndex, doublePrecision, boolean } from "drizzle-orm/pg-core";
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

/** Normalized ownership/economics model. Names are labels only; links use IDs. */
export const atelierOwnershipStructures = pgTable("atelier_ownership_structures", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"),
  name: text("name").notNull(), structureType: text("structure_type").notNull(), // holding|entity|territory|franchise
  status: text("status").notNull().default("planned"), // planned|incorporated|franchise_operated|archived
  approvalStatus: text("approval_status").notNull().default("pending"), // pending|approved|rejected
  proposedBy: text("proposed_by"), approvedBy: text("approved_by"), approvedAt: timestamp("approved_at"),
  legalEntityId: text("legal_entity_id"), country: text("country"), jurisdiction: text("jurisdiction"),
  effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"),
  sourceAgreementId: text("source_agreement_id"), notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("idx_atelier_ownership_structure_org").on(t.orgId), uniqueIndex("uq_atelier_ownership_structure_name_date").on(t.orgId, t.name, t.effectiveFrom)]);

export const atelierOwnershipStakeholders = pgTable("atelier_ownership_stakeholders", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"),
  label: text("label").notNull(), stakeholderType: text("stakeholder_type").notNull(), // person|entity|external_party
  personId: text("person_id"), legalEntityId: text("legal_entity_id"), stableKey: text("stable_key"),
  externalRef: text("external_ref"), notes: text("notes"), createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_atelier_ownership_stakeholder_org").on(t.orgId), uniqueIndex("uq_atelier_ownership_stakeholder_stable").on(t.orgId, t.stableKey)]);

export const atelierOwnershipStructureLinks = pgTable("atelier_ownership_structure_links", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), parentStructureId: text("parent_structure_id").notNull(), childStructureId: text("child_structure_id").notNull(),
  relationship: text("relationship").notNull().default("owns"), effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  status: text("status").notNull().default("pending"), proposedBy: text("proposed_by"), approvedBy: text("approved_by"), approvedAt: timestamp("approved_at"),
}, (t) => [index("idx_atelier_ownership_link_parent").on(t.orgId, t.parentStructureId), uniqueIndex("uq_atelier_ownership_link_date").on(t.orgId, t.parentStructureId, t.childStructureId, t.effectiveFrom)]);

export const atelierOwnershipInterests = pgTable("atelier_ownership_interests", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), structureId: text("structure_id").notNull(), stakeholderId: text("stakeholder_id").notNull(),
  legalPct: doublePrecision("legal_pct").notNull().default(0), votingPct: doublePrecision("voting_pct").notNull().default(0), profitPct: doublePrecision("profit_pct").notNull().default(0),
  shareClass: text("share_class"), status: text("status").notNull().default("pending"), effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"),
  sourceAgreementId: text("source_agreement_id"), pendingTerms: boolean("pending_terms").notNull().default(false), provenance: jsonb("provenance").notNull().default({}),
  proposedBy: text("proposed_by"), approvedBy: text("approved_by"), approvedAt: timestamp("approved_at"), createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_atelier_ownership_interest_structure").on(t.orgId, t.structureId), index("idx_atelier_ownership_interest_holder").on(t.orgId, t.stakeholderId), uniqueIndex("uq_atelier_ownership_interest_version").on(t.orgId, t.structureId, t.stakeholderId, t.effectiveFrom)]);

export const atelierCommercialRights = pgTable("atelier_commercial_rights", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), structureId: text("structure_id").notNull(), holderStakeholderId: text("holder_stakeholder_id").notNull(),
  rightType: text("right_type").notNull(), // revenue_share|royalty|sponsor|franchise
  ratePct: doublePrecision("rate_pct"), basis: text("basis"), currency: text("currency"), feeAmount: doublePrecision("fee_amount"),
  territory: text("territory"), agreementTerm: text("agreement_term"), pendingTerms: boolean("pending_terms").notNull().default(false),
  status: text("status").notNull().default("pending"), effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"), sourceAgreementId: text("source_agreement_id"), terms: jsonb("terms").notNull().default({}), proposedBy: text("proposed_by"), approvedBy: text("approved_by"), approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(), updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("idx_atelier_commercial_right_structure").on(t.orgId, t.structureId), uniqueIndex("uq_atelier_commercial_right_version").on(t.orgId, t.structureId, t.holderStakeholderId, t.effectiveFrom)]);

export const atelierDistributionPolicies = pgTable("atelier_distribution_policies", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), structureId: text("structure_id").notNull(), effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"),
  reserveCash: doublePrecision("reserve_cash").notNull().default(0), reserveOperatingCapital: doublePrecision("reserve_operating_capital").notNull().default(0), notes: text("notes"), status: text("status").notNull().default("pending"),
  proposedBy: text("proposed_by"), approvedBy: text("approved_by"), approvedAt: timestamp("approved_at"), createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_atelier_distribution_policy_version").on(t.orgId, t.structureId, t.effectiveFrom)]);

export const atelierDistributionDeclarations = pgTable("atelier_distribution_declarations", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), structureId: text("structure_id").notNull(), fiscalYear: text("fiscal_year").notNull(), kind: text("kind").notNull().default("estimated"),
  estimatedProfit: doublePrecision("estimated_profit").notNull().default(0), actualProfit: doublePrecision("actual_profit"), reserveCash: doublePrecision("reserve_cash").notNull().default(0), reserveOperatingCapital: doublePrecision("reserve_operating_capital").notNull().default(0), distributableProfit: doublePrecision("distributable_profit"),
  status: text("status").notNull().default("draft"), interestSnapshotId: text("interest_snapshot_id"), proposedBy: text("proposed_by"), approvedBy: text("approved_by"), approvedAt: timestamp("approved_at"), createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_atelier_distribution_declaration_year").on(t.orgId, t.structureId, t.fiscalYear)]);

export const atelierDistributionSnapshots = pgTable("atelier_distribution_snapshots", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), declarationId: text("declaration_id").notNull(), capturedAt: timestamp("captured_at").notNull().defaultNow(), asOf: date("as_of").notNull(), rows: jsonb("rows").notNull().default([]), frozen: boolean("frozen").notNull().default(true),
}, (t) => [uniqueIndex("uq_atelier_distribution_snapshot_declaration").on(t.declarationId)]);

export const atelierDistributionAllocations = pgTable("atelier_distribution_allocations", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), declarationId: text("declaration_id").notNull(), stakeholderId: text("stakeholder_id").notNull(), profitPct: doublePrecision("profit_pct").notNull(), amount: doublePrecision("amount").notNull(), status: text("status").notNull().default("approved"), createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_atelier_distribution_allocation_declaration").on(t.orgId, t.declarationId)]);

export const atelierDistributionPayments = pgTable("atelier_distribution_payments", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), allocationId: text("allocation_id").notNull(), amount: doublePrecision("amount").notNull(), paidAt: date("paid_at"), status: text("status").notNull().default("scheduled"), reference: text("reference"), createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const atelierDistributionTrueUps = pgTable("atelier_distribution_trueups", {
  id: text("id").primaryKey(), orgId: text("org_id").notNull().default("aico"), declarationId: text("declaration_id").notNull(), stakeholderId: text("stakeholder_id").notNull(), expectedAmount: doublePrecision("expected_amount").notNull(), actualAmount: doublePrecision("actual_amount").notNull(), deltaAmount: doublePrecision("delta_amount").notNull(), rationale: text("rationale").notNull(), createdBy: text("created_by").notNull(), createdAt: timestamp("created_at").notNull().defaultNow(),
});