/**
 * THE ATELIER — 13-week cash forecast: line overrides + audit (Task #439).
 *
 * Persists treasurer-applied locks / amount / date overrides on the cash
 * forecast lines so they survive an API server restart, and stores the
 * audit trail of override apply / clear actions for the reviewer-facing
 * audit log.
 *
 * SQL migration: 0037_atelier_cash_overrides_audit.sql.
 */

import { pgTable, text, jsonb, timestamp, doublePrecision, boolean, index } from "drizzle-orm/pg-core";

export const atelierCashLineOverrides = pgTable(
  "atelier_cash_line_overrides",
  {
    lineId: text("line_id").primaryKey(),
    lockedAmount: doublePrecision("locked_amount"),
    lockedDate: text("locked_date"),
    locked: boolean("locked").notNull().default(false),
    note: text("note").notNull().default(""),
    byUserId: text("by_user_id").notNull(),
    byUserName: text("by_user_name").notNull(),
    byRole: text("by_role").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const atelierCashAudit = pgTable(
  "atelier_cash_audit",
  {
    id: text("id").primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    payload: jsonb("payload").notNull().default({}),
  },
  (t) => [
    index("idx_atelier_cash_audit_ts").on(t.ts),
    index("idx_atelier_cash_audit_target").on(t.target),
  ],
);
