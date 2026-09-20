/**
 * Task #1353 — won-project mobilization.
 *
 * Staffing requirements deliberately remain separate from named assignments:
 * a project can be planned and validated before a person receives access.
 * Assignment rows are the lifecycle ledger; atelier_engagement_access remains
 * the effective ACL and is synchronized by the API service.
 */
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { atelierEngagements, atelierUsers, atelierPersons } from "./atelier";

const ORG = (name: string) => text(name).notNull().default("aico");
const COMMON = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: text("created_by_user_id"),
  deletedAt: timestamp("deleted_at"),
};

export const atelierStaffingRequirements = pgTable(
  "atelier_staffing_requirements",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull().references(() => atelierEngagements.id),
    role: text("role").notNull(),
    seniority: text("seniority").notNull(),
    allocationPct: integer("allocation_pct").notNull().default(0),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    required: boolean("required").notNull().default(true),
    rateSource: text("rate_source"), // rate_card | person_rate | manual | pending
    rateAmount: doublePrecision("rate_amount"),
    rateCurrency: text("rate_currency").notNull().default("USD"),
    availabilityStatus: text("availability_status").notNull().default("unknown"),
    notes: text("notes"),
    status: text("status").notNull().default("open"), // open | filled | waived
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_staff_req_eng").on(t.engagementId),
    index("idx_atelier_staff_req_status").on(t.status),
    check("chk_atelier_staff_req_allocation", sql`${t.allocationPct} between 0 and 100`),
    check("chk_atelier_staff_req_dates", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const atelierStaffingAssignments = pgTable(
  "atelier_staffing_assignments",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull().references(() => atelierEngagements.id),
    requirementId: text("requirement_id").references(() => atelierStaffingRequirements.id),
    // person_id is the roster identity; user_id is the ACL/login identity
    // resolved by the service. Contractors without a login may be proposed.
    personId: text("person_id").notNull().references(() => atelierPersons.id),
    userId: text("user_id").references(() => atelierUsers.id),
    role: text("role").notNull(),
    seniority: text("seniority").notNull(),
    allocationPct: integer("allocation_pct").notNull().default(0),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    required: boolean("required").notNull().default(true),
    rateSource: text("rate_source"),
    rateAmount: doublePrecision("rate_amount"),
    rateCurrency: text("rate_currency").notNull().default("USD"),
    availabilityStatus: text("availability_status").notNull().default("unknown"),
    state: text("state").notNull().default("proposed"), // proposed|accepted|declined|replaced|ended
    replacedByAssignmentId: text("replaced_by_assignment_id"),
    stateReason: text("state_reason"),
    acceptedAt: timestamp("accepted_at"),
    endedAt: timestamp("ended_at"),
    idempotencyKey: text("idempotency_key"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_staff_assign_eng").on(t.engagementId),
    index("idx_atelier_staff_assign_person").on(t.personId),
    index("idx_atelier_staff_assign_state").on(t.state),
    uniqueIndex("uq_atelier_staff_assign_idempotency").on(t.orgId, t.idempotencyKey),
    check("chk_atelier_staff_assign_allocation", sql`${t.allocationPct} between 0 and 100`),
    check("chk_atelier_staff_assign_dates", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const atelierMobilizationHandoffs = pgTable(
  "atelier_mobilization_handoffs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull().references(() => atelierEngagements.id),
    assignmentId: text("assignment_id").references(() => atelierStaffingAssignments.id),
    kind: text("kind").notNull(), // owner | lead | finance | assignee
    fromUserId: text("from_user_id").references(() => atelierUsers.id),
    toUserId: text("to_user_id").notNull().references(() => atelierUsers.id),
    status: text("status").notNull().default("pending"), // pending|accepted|declined|completed
    idempotencyKey: text("idempotency_key").notNull(),
    completedAt: timestamp("completed_at"),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_mob_handoff_eng").on(t.engagementId),
    index("idx_atelier_mob_handoff_to").on(t.toUserId),
    uniqueIndex("uq_atelier_mob_handoff_idempotency").on(t.orgId, t.idempotencyKey),
  ],
);

export const atelierMobilizationNotifications = pgTable(
  "atelier_mobilization_notifications",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull().references(() => atelierEngagements.id),
    recipientUserId: text("recipient_user_id").notNull().references(() => atelierUsers.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    readAt: timestamp("read_at"),
  },
  (t) => [
    index("idx_atelier_mob_notif_recipient").on(t.recipientUserId),
    index("idx_atelier_mob_notif_eng").on(t.engagementId),
    uniqueIndex("uq_atelier_mob_notif_dedupe").on(t.orgId, t.dedupeKey),
  ],
);