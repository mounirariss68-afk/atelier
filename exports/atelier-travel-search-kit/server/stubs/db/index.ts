/**
 * STUB — replaces the Atelier monorepo's `@workspace/db` package.
 *
 * `travel-companion-capabilities.ts` (the traveller-companion picker) is
 * the only travel module that touches the database. The core flight /
 * hotel / Airbnb search tools are fully DB-free.
 *
 * INTEGRATION POINT: point these at your own Drizzle instance + schema,
 * or rewrite the companion module's queries against your own ORM. The
 * table shapes below carry only the columns the travel modules read.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const atelierUsers = pgTable("atelier_users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
});

export const atelierEmployees = pgTable("atelier_employees", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  userId: text("user_id"),
  fullName: text("full_name").notNull(),
  email: text("email"),
  deletedAt: timestamp("deleted_at"),
  // Task #744 travel prefs live in a jsonb column on the real table;
  // integration-reference/travel-preferences-db.ts shows the read path.
});

export const atelierContractors = pgTable("atelier_contractors", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email"),
  fullName: text("full_name").notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const atelierDependents = pgTable("atelier_dependents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  personId: text("person_id").notNull(),
  personType: text("person_type").notNull(),
  fullName: text("full_name").notNull(),
  relationship: text("relationship"),
  deletedAt: timestamp("deleted_at"),
});

/**
 * Throwing placeholder for the Drizzle client. Any accidental query in
 * an unwired deployment fails loudly instead of returning fake rows.
 */
export const db: any = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "[travel-kit stub] db is not wired — provide your own drizzle(pool) instance in server/stubs/db/index.ts.",
      );
    },
  },
);
