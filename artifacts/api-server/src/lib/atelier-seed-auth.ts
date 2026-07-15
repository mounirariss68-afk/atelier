import { db, atelierAuthCredentials } from "@workspace/db";
import { eq } from "drizzle-orm";
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

export async function ensureAtelierAuthSeed(): Promise<void> {
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
