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
