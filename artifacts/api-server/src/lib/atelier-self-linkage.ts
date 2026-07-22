import { db, atelierUsers, atelierEmployees } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "./logger";
// Task #538 — repaired/created rows are backed by a person record.
import { writePersonFromFullName } from "./atelier-person-sync.js";

/**
 * Task #50 — user ↔ person linkage repair (boot-time, idempotent).
 *
 * The Me lens resolves an employee's roster record via
 * atelier_employees.user_id. Users who predate the HR add-joiner flow
 * (the two founders, and any user created by hand) may have an employee
 * row with a matching email but a NULL user_id — or no employee row at
 * all. This repairs both cases so /me/profile works for everyone:
 *
 *   1. If an employee row in the user's org has the same (lower-cased)
 *      email and no user_id → link it.
 *   2. If the user is an employee-type persona and has NO employee row →
 *      create a minimal one (name/email/role/title only).
 *
 * This is data-only identity repair, NOT demo seeding (which was
 * permanently removed 2026-07-16): it never invents people, it only
 * mirrors already-existing atelier_users identities into the roster.
 * Contractor / partner-firm / board personas are skipped — contractors
 * link by email at read time and have no user_id column.
 */

const EMPLOYEE_TYPE_ROLES = new Set([
  "founding_partner",
  "partner",
  "finance",
  "hr",
  "senior_manager",
  "consultant",
  "recruiter",
  "compliance_officer",
  "employee",
]);

export async function ensureAtelierSelfLinkage(): Promise<void> {
  const users = await db
    .select()
    .from(atelierUsers)
    .where(isNull(atelierUsers.deletedAt));

  for (const u of users) {
    if (!EMPLOYEE_TYPE_ROLES.has(u.role)) continue;

    // Already linked?
    const [linked] = await db
      .select({ id: atelierEmployees.id })
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.orgId, u.orgId),
          eq(atelierEmployees.userId, u.id),
          isNull(atelierEmployees.deletedAt),
        ),
      );
    if (linked) continue;

    const email = u.email.trim().toLowerCase();
    const orgEmployees = await db
      .select()
      .from(atelierEmployees)
      .where(
        and(eq(atelierEmployees.orgId, u.orgId), isNull(atelierEmployees.deletedAt)),
      );
    const byEmail = orgEmployees.find(
      (e) => e.email.trim().toLowerCase() === email,
    );

    if (byEmail) {
      if (!byEmail.userId) {
        await db
          .update(atelierEmployees)
          .set({ userId: u.id })
          .where(eq(atelierEmployees.id, byEmail.id));
        logger.info(
          { userId: u.id, employeeId: byEmail.id },
          "self-linkage: linked existing employee row by email",
        );
      }
      // Linked to someone else — leave it alone; ambiguous links are a
      // human decision, never an automatic overwrite.
      continue;
    }

    const employeeId = `emp_link_${u.id}`;
    // Task #538 — reuse the user's person record when it has one; otherwise
    // parse the login name into a new person so the roster row is backed.
    let personId = u.personId ?? null;
    if (!personId) {
      try {
        const w = await writePersonFromFullName(db, {
          orgId: u.orgId,
          fullName: u.name,
          sourceKind: "user",
          createdByUserId: u.id,
        });
        personId = w.personId;
        await db
          .update(atelierUsers)
          .set({ personId, updatedAt: new Date() })
          .where(eq(atelierUsers.id, u.id));
      } catch {
        // empty/unparseable name — link without a person record.
      }
    }
    await db
      .insert(atelierEmployees)
      .values({
        id: employeeId,
        orgId: u.orgId,
        userId: u.id,
        personId,
        fullName: u.name,
        email: u.email,
        role: u.role,
        title: u.title,
      })
      .onConflictDoNothing();
    logger.info(
      { userId: u.id, employeeId },
      "self-linkage: created minimal employee row for existing user",
    );
  }
}
