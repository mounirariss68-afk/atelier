import { db, atelierAuthCredentials, atelierUsers, atelierEmployees, atelierAuditEvents } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./auth/passwords";
import { logger } from "./logger";

/**
 * Idempotent auth credential seed — Task #1.
 *
 * Runs on every server boot (dev AND production) and seeds/repairs the two
 * allowed logins with a hashed password. The plaintext never touches the
 * database — only the scrypt hash. The tables themselves are part of the
 * Drizzle schema (lib/db) and reach production via Replit's Publish flow,
 * which diffs dev vs prod schema on deploy — no DDL happens at runtime.
 */
const USERS: Array<{ email: string; userId: string }> = [
  { email: "mounir@cognirise.ai", userId: "p_mounir_ariss" },
  { email: "gokhan@cognirise.ai", userId: "p_gokhan_guney" },
];

const PASSWORD = "SeptemberEylul2026!";

// Task #186 — official founder titles. The founders' job titles are data in
// atelier_users.title / atelier_employees.title (role_label stays
// "Founding Partner" — that is the RBAC role name, not the job title).
// This idempotent repair runs on every boot so the official titles apply in
// every environment (including production on deploy) and can never be
// reverted by a restart. Each actual change writes an audit event.
const OFFICIAL_TITLES: Array<{ userId: string; title: string }> = [
  { userId: "p_mounir_ariss", title: "CEO and Co-founder" },
  { userId: "p_gokhan_guney", title: "Co-founder" },
];

async function ensureFounderTitles(): Promise<void> {
  for (const f of OFFICIAL_TITLES) {
    const changedUsers = await db
      .update(atelierUsers)
      .set({ title: f.title, updatedAt: new Date() })
      .where(and(eq(atelierUsers.id, f.userId), ne(atelierUsers.title, f.title)))
      .returning({ id: atelierUsers.id, name: atelierUsers.name, orgId: atelierUsers.orgId });
    const changedEmps = await db
      .update(atelierEmployees)
      .set({ title: f.title, updatedAt: new Date() })
      .where(and(eq(atelierEmployees.userId, f.userId), ne(atelierEmployees.title, f.title)))
      .returning({ id: atelierEmployees.id, orgId: atelierEmployees.orgId });
    for (const row of [
      ...changedUsers.map((u) => ({ entityType: "user", entityId: u.id, orgId: u.orgId })),
      ...changedEmps.map((e) => ({ entityType: "employee", entityId: e.id, orgId: e.orgId })),
    ]) {
      await db.insert(atelierAuditEvents).values({
        id: `aud_title_${row.entityType}_${f.userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        orgId: row.orgId,
        entityType: row.entityType,
        entityId: row.entityId,
        actorType: "system",
        actorLabel: "System (official title repair)",
        action: `${row.entityType}.update`,
        payload: { changes: { title: { to: f.title } } },
        payloadSummary: `Official title set to ${f.title}`,
      });
      logger.info({ userId: f.userId, title: f.title, entity: row.entityType }, "founder title repaired");
    }
  }
}

export async function ensureAtelierAuthSeed(): Promise<void> {
  await ensureFounderTitles();
  for (const u of USERS) {
    const [existing] = await db
      .select()
      .from(atelierAuthCredentials)
      .where(eq(atelierAuthCredentials.email, u.email));
    // Task #2 — once a user has changed their own password, the seed must
    // never overwrite it. Only repair the userId link if it drifted.
    if (existing && existing.userManaged) {
      if (existing.userId !== u.userId) {
        await db
          .update(atelierAuthCredentials)
          .set({ userId: u.userId, updatedAt: new Date() })
          .where(eq(atelierAuthCredentials.email, u.email));
        logger.info({ email: u.email }, "auth credential userId repaired (user-managed hash kept)");
      }
      continue;
    }
    if (
      existing &&
      existing.userId === u.userId &&
      verifyPassword(PASSWORD, existing.passwordHash)
    ) {
      continue;
    }
    const passwordHash = hashPassword(PASSWORD);
    await db
      .insert(atelierAuthCredentials)
      .values({ email: u.email, userId: u.userId, passwordHash })
      .onConflictDoUpdate({
        target: atelierAuthCredentials.email,
        set: { userId: u.userId, passwordHash, updatedAt: new Date() },
      });
    logger.info({ email: u.email }, "auth credential seeded/updated");
  }
}
