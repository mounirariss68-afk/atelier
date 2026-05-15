/**
 * THE ATELIER — Committed FP&A scenario history (Task #446).
 *
 * Append-only log of "this scenario is the committed forecast" decisions
 * made by finance leadership on /finance/plan/scenarios. The current
 * committed scenario is the most recent row; earlier rows form the audit
 * trail. Persisted to Postgres so the lock survives an API server restart
 * and is visible to all personas (variance / board-pack readers).
 *
 * SQL migration: 0038_atelier_finance_plan_commits.sql.
 */

import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const atelierFinancePlanCommits = pgTable(
  "atelier_finance_plan_commits",
  {
    id: text("id").primaryKey(),
    scenarioId: text("scenario_id").notNull(),
    scenarioLabel: text("scenario_label").notNull(),
    periodLabel: text("period_label").notNull().default(""),
    note: text("note").notNull().default(""),
    byUserId: text("by_user_id").notNull(),
    byUserName: text("by_user_name").notNull(),
    byRole: text("by_role").notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_finance_plan_commits_committed_at").on(t.committedAt),
  ],
);
