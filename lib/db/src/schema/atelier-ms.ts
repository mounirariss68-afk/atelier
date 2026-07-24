import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Task #327 — Per-user Microsoft 365 connections.
 *
 * One row per Atelier user who has voluntarily linked their own Microsoft
 * 365 work account (delegated Graph permissions only). The refresh token
 * is encrypted at rest (AES-256-GCM, app-level key — see
 * api-server/src/lib/msGraph.ts) and is NEVER exposed through any API
 * response. Disconnect deletes the row outright (no soft delete — tokens
 * must not linger).
 */

const ORG = (name: string) => text(name).notNull().default("aico");

/**
 * Task #336 — Auto-logged Microsoft 365 meetings.
 *
 * One row per (user, Graph event, matched account) that the auto-log job
 * has processed. The row is the dedupe ledger: once an event/account pair
 * is here, the job never logs it again — even after the employee removes
 * the CRM entry (status flips to "removed" and the activity is
 * soft-deleted, but the ledger row stays so the meeting doesn't reappear).
 */
export const atelierMsMeetingLogs = pgTable(
  "atelier_ms_meeting_logs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    /** FK → atelier_users.id (whose calendar produced the entry). */
    userId: text("user_id").notNull(),
    /** Microsoft Graph event id (per-user id space). */
    msEventId: text("ms_event_id").notNull(),
    /** CRM account the meeting was matched to. */
    accountId: text("account_id").notNull(),
    /** The atelier_activities row created for this meeting. */
    activityId: text("activity_id").notNull(),
    subject: text("subject").notNull(),
    meetingStart: timestamp("meeting_start").notNull(),
    meetingEnd: timestamp("meeting_end").notNull(),
    /** Matched CRM contacts at log time: [{contactId, contactName}] */
    matchedContacts: jsonb("matched_contacts")
      .notNull()
      .$type<Array<{ contactId: string; contactName: string }>>()
      .default([]),
    /** "ai" when an AI summary was included, else "metadata". */
    summarySource: text("summary_source").notNull().default("metadata"),
    /** logged | removed */
    status: text("status").notNull().default("logged"),
    removedAt: timestamp("removed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_atelier_ms_meeting_logs_event").on(
      t.orgId,
      t.userId,
      t.msEventId,
      t.accountId,
    ),
    index("idx_atelier_ms_meeting_logs_user").on(t.orgId, t.userId),
    index("idx_atelier_ms_meeting_logs_account").on(t.accountId),
  ],
);

/**
 * Task #628 — Microsoft 365 provisioning ledger.
 *
 * One row per roster person whose @cognirise.ai Microsoft account is
 * managed (or deliberately not managed) by the Atelier. Keys on the
 * roster person id (employees/contractors), NOT the login row — a person
 * can have a mailbox before/without an Atelier login. `userId` is filled
 * once the login exists so offboarding can resolve the row from either
 * side.
 *
 * status values:
 *   not_provisioned  — HR chose "no Microsoft account" (or never ran it)
 *   provisioning     — a provisioning run is in flight
 *   provisioned      — account created by us, license assigned, mailbox live
 *   linked_existing  — address already existed in the tenant; linked, not created
 *   pending_license  — account exists but no license was available (manual
 *                      GoDaddy purchase needed; re-check path re-assigns)
 *   blocked          — the tenant refused an operation (admin consent missing
 *                      or a GoDaddy-resold restriction); lastError explains
 *   deprovisioned    — offboarded: sign-in blocked and license freed
 */
export const atelierMsProvisioning = pgTable(
  "atelier_ms_provisioning",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    /** Roster person id (emp_* / ct_*). */
    personId: text("person_id").notNull(),
    personType: text("person_type").notNull(), // employee | contractor
    /** atelier_users.id once a login exists (nullable — mailbox can precede login). */
    userId: text("user_id"),
    /** The address/UPN being provisioned (lower-cased). */
    email: text("email").notNull(),
    status: text("status").notNull().default("not_provisioned"),
    /** Entra object id of the Microsoft user once created/linked. */
    msUserId: text("ms_user_id"),
    /** employee | contractor — which default service profile applies. */
    serviceProfile: text("service_profile").notNull().default("employee"),
    /** SKU assigned (or targeted) for this person. */
    skuId: text("sku_id"),
    /** Service-plan ids disabled on the assigned license (per-person override). */
    disabledPlans: jsonb("disabled_plans").notNull().$type<string[]>().default([]),
    /** Offboarding state. */
    signInBlocked: text("sign_in_blocked").notNull().default("no"), // yes | no
    mailboxRetained: text("mailbox_retained").notNull().default("no"), // yes | no (leaver kept mailbox for handover)
    licenseFreed: text("license_freed").notNull().default("no"), // yes | no
    /** Last provisioning failure, user-visible (cleared on success). */
    lastError: text("last_error"),
    provisionedAt: timestamp("provisioned_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_atelier_ms_provisioning_person").on(t.orgId, t.personId),
    index("idx_atelier_ms_provisioning_user").on(t.orgId, t.userId),
    index("idx_atelier_ms_provisioning_status").on(t.orgId, t.status),
  ],
);

export const atelierMsConnections = pgTable(
  "atelier_ms_connections",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    /** FK → atelier_users.id (the Atelier persona who connected). */
    userId: text("user_id").notNull(),
    /** Microsoft account identity captured at connect time. */
    msEmail: text("ms_email").notNull(),
    msOid: text("ms_oid").notNull(), // Entra object id of the MS user
    msDisplayName: text("ms_display_name"),
    /** AES-256-GCM ciphertext (base64: iv.tag.data) — never plaintext. */
    encRefreshToken: text("enc_refresh_token").notNull(),
    /** Delegated scopes actually granted at consent time. */
    scopes: jsonb("scopes").notNull().$type<string[]>().default([]),
    connectedAt: timestamp("connected_at").notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at"),
    /** Last Graph/refresh failure (cleared on success) for the status UI. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_atelier_ms_connections_org_user").on(t.orgId, t.userId),
    index("idx_atelier_ms_connections_org").on(t.orgId),
  ],
);
