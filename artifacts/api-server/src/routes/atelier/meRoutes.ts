/**
 * Atelier — Task #50: Me lens self-scope routes.
 *
 * Every endpoint here answers ONLY for the caller's own identity — no ids
 * from the URL/body are accepted for reads, so there is nothing to IDOR.
 * These are the routes the self-only personas (role=employee, contractor)
 * are allowlisted for in the non-employee boundary middleware (index.ts),
 * but every persona may use them — the Me lens is visible to all.
 *
 *   GET  /me/profile                      → persona + own roster record
 *   GET  /me/notifications                → own non-dismissed cards
 *   POST /me/notifications/:id/dismiss    → dismiss one of your own cards
 *
 * `emitSelfNotification` is the write helper other surfaces call to put a
 * card on someone's Me home ("timesheet due Friday", "expense approved").
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierSelfNotifications,
} from "@workspace/db";
import {
  AtelierGetMyProfileResponse,
  AtelierListMyNotificationsResponse,
  AtelierDismissMyNotificationResponse,
} from "@workspace/api-zod";
import { personaToWire } from "./personaCookie";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

export interface SelfPersonWire {
  id: string;
  workerType: "employee" | "contractor";
  fullName: string;
  email: string;
  title: string | null;
  startDate: string | null;
  employmentType: string | null;
  homeOffice: string | null;
  country: string | null;
  status: string | null;
}

/**
 * Resolve the caller's own roster/person record.
 *
 * Employees link via atelier_employees.user_id (backfilled at boot for the
 * founders; set at creation time by the HR add-joiner flow). Contractors
 * have no user_id column — they link by lower-cased email, the same rule
 * `resolveLinkedUserId` in rosterRoutes.ts uses in the other direction.
 * Org-scoped: only rows in the caller's own org are considered.
 */
export async function resolveSelfPerson(
  me: typeof atelierUsers.$inferSelect,
): Promise<SelfPersonWire | null> {
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, me.orgId),
        eq(atelierEmployees.userId, me.id),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp) {
    return {
      id: emp.id,
      workerType: "employee",
      fullName: emp.fullName,
      email: emp.email,
      title: emp.title ?? null,
      startDate: emp.startDate ?? null,
      employmentType: emp.employmentType ?? null,
      homeOffice: emp.homeOffice ?? null,
      country: emp.country ?? null,
      status: emp.status ?? null,
    };
  }
  const email = me.email.trim().toLowerCase();
  const cts = await db
    .select()
    .from(atelierContractors)
    .where(
      and(
        eq(atelierContractors.orgId, me.orgId),
        isNull(atelierContractors.deletedAt),
      ),
    );
  const ct = cts.find((c) => c.email.trim().toLowerCase() === email);
  if (ct) {
    return {
      id: ct.id,
      workerType: "contractor",
      fullName: ct.fullName,
      email: ct.email,
      title: null,
      startDate: ct.contractStart ?? null,
      employmentType: ct.contractType ?? null,
      homeOffice: null,
      country: ct.country ?? null,
      status: ct.status ?? null,
    };
  }
  return null;
}

/**
 * Write helper — puts a card on a user's Me home. Callers pass the OWNING
 * user id explicitly; the card is only ever readable by that user.
 */
export async function emitSelfNotification(
  args: {
    orgId: string;
    userId: string;
    kind: string;
    title: string;
    body?: string;
    href?: string | null;
  },
  // Optional transaction executor so callers can emit atomically with
  // their other writes (e.g. add-joiner onboarding).
  tx: Pick<typeof db, "insert"> = db,
): Promise<string> {
  const id = rid("selfnotif");
  await tx.insert(atelierSelfNotifications).values({
    id,
    orgId: args.orgId,
    userId: args.userId,
    kind: args.kind,
    title: args.title,
    body: args.body ?? "",
    href: args.href ?? null,
  });
  return id;
}

/**
 * Task #53 — resolve the atelier_users id that owns a roster person row so
 * status-change surfaces (timesheet/leave/expense decisions) can drop a
 * card on the right person's Me home. Employees link via employees.userId;
 * contractors link by lower-cased email. Org-scoped. Returns null when the
 * person has no login — callers should just skip the notification.
 */
export async function resolveUserIdForPerson(
  orgId: string,
  personId: string,
): Promise<string | null> {
  const [emp] = await db
    .select({ userId: atelierEmployees.userId })
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, orgId),
        eq(atelierEmployees.id, personId),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp?.userId) return emp.userId;
  const [con] = await db
    .select({ email: atelierContractors.email })
    .from(atelierContractors)
    .where(
      and(
        eq(atelierContractors.orgId, orgId),
        eq(atelierContractors.id, personId),
        isNull(atelierContractors.deletedAt),
      ),
    );
  if (!con?.email) return null;
  const email = con.email.trim().toLowerCase();
  const users = await db
    .select({ id: atelierUsers.id, email: atelierUsers.email })
    .from(atelierUsers)
    .where(eq(atelierUsers.orgId, orgId));
  const hit = users.find((u) => u.email.trim().toLowerCase() === email);
  return hit?.id ?? null;
}

function notifToWire(n: typeof atelierSelfNotifications.$inferSelect) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    status: n.status as "unread" | "dismissed",
    createdAt: n.createdAt.toISOString(),
  };
}

// @cli-skip: self-scope identity read; no CLI shape (Task #50)
router.get("/me/profile", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await resolveSelfPerson(me);
    res.json(
      AtelierGetMyProfileResponse.parse({
        user: personaToWire(me),
        person,
      }),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope notification read; no CLI shape (Task #50)
router.get("/me/notifications", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierSelfNotifications)
      .where(
        and(
          eq(atelierSelfNotifications.orgId, me.orgId),
          eq(atelierSelfNotifications.userId, me.id),
          eq(atelierSelfNotifications.status, "unread"),
          isNull(atelierSelfNotifications.deletedAt),
        ),
      )
      .orderBy(desc(atelierSelfNotifications.createdAt));
    res.json(AtelierListMyNotificationsResponse.parse(rows.map(notifToWire)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope notification dismiss; no CLI shape (Task #50)
router.post("/me/notifications/:id/dismiss", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Ownership is part of the WHERE — a foreign id 404s, never leaks.
    const [row] = await db
      .update(atelierSelfNotifications)
      .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(atelierSelfNotifications.id, req.params.id),
          eq(atelierSelfNotifications.orgId, me.orgId),
          eq(atelierSelfNotifications.userId, me.id),
          isNull(atelierSelfNotifications.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    res.json(AtelierDismissMyNotificationResponse.parse(notifToWire(row)));
  } catch (err) {
    next(err);
  }
});

export default router;
