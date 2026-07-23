import {
  db,
  atelierAuthCredentials,
  atelierUsers,
  atelierEmployees,
  atelierAuditEvents,
  atelierExpenses,
  atelierMeetings,
} from "@workspace/db";
import { and, eq, lt, ne } from "drizzle-orm";
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

// Task #538 — unified person model. Idempotent repair: make sure each
// founder login row (and their employee roster row) is linked to an
// atelier_persons record. Data-only; never overwrites an existing link and
// never rewrites names — it only parses the already-stored name when a
// person row has to be created.
async function ensureFounderPersonLinks(): Promise<void> {
  const { writePersonFromFullName } = await import("./atelier-person-sync");
  for (const u of USERS) {
    const [user] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, u.userId));
    if (!user) continue;
    let personId = user.personId;
    if (!personId) {
      const w = await writePersonFromFullName(db, {
        orgId: user.orgId,
        fullName: user.name,
        sourceKind: "user",
      });
      personId = w.personId;
      await db
        .update(atelierUsers)
        .set({ personId, updatedAt: new Date() })
        .where(eq(atelierUsers.id, u.userId));
      logger.info({ userId: u.userId, personId }, "founder person row created + linked");
    }
    const [emp] = await db
      .select({ id: atelierEmployees.id, personId: atelierEmployees.personId })
      .from(atelierEmployees)
      .where(eq(atelierEmployees.userId, u.userId));
    if (emp && !emp.personId) {
      await db
        .update(atelierEmployees)
        .set({ personId, updatedAt: new Date() })
        .where(eq(atelierEmployees.id, emp.id));
      logger.info({ userId: u.userId, personId, employeeId: emp.id }, "founder employee row linked to person");
    }
  }
}

// Task #621 — App Store review demo account. A real (data-only) login with
// the restricted self-only `employee` persona, so the reviewer can browse
// the Me lens without seeing any client/financial data. Every mutating HTTP
// method is hard-blocked server-side for this user (see demoReadOnlyGuard in
// routes/index.ts), and the credential is force-repaired on every boot:
// the password can never drift (change-password is blocked for this user)
// and mustChangePassword can never brick it.
export const DEMO_EMAIL = "demo@cognirise.ai";
export const DEMO_USER_ID = "p_demo_reviewer";
const DEMO_PASSWORD = "demoact!23";
// Per user request (2026-07-23): the demo account presents as a fictional
// employee "Max Headrom" with a US phone so the Me page + vCard QR look real.
const DEMO_NAME = "Max Headrom";
const DEMO_INITIALS = "MH";
const DEMO_PHONE = "+1 555 555 555 1";

async function ensureDemoAccount(): Promise<void> {
  // Anchor the demo user to the founders' org.
  const [founder] = await db
    .select({ orgId: atelierUsers.orgId })
    .from(atelierUsers)
    .where(eq(atelierUsers.id, "p_mounir_ariss"));
  if (!founder) {
    logger.warn("demo account seed skipped — founder org not found");
    return;
  }
  const orgId = founder.orgId;
  const [user] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, DEMO_USER_ID));
  if (!user) {
    await db.insert(atelierUsers).values({
      id: DEMO_USER_ID,
      orgId,
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      initials: DEMO_INITIALS,
      role: "employee",
      roleLabel: "Employee",
      title: "App Review (read-only demo)",
    });
    logger.info({ userId: DEMO_USER_ID }, "demo user row created");
  } else if (user.name !== DEMO_NAME || user.initials !== DEMO_INITIALS) {
    // Idempotent identity repair (e.g. rename Demo Reviewer → Max Headrom).
    await db
      .update(atelierUsers)
      .set({ name: DEMO_NAME, initials: DEMO_INITIALS, updatedAt: new Date() })
      .where(eq(atelierUsers.id, DEMO_USER_ID));
    if (user.personId) {
      const { writePersonAndSync } = await import("./atelier-person-sync");
      const { parsePersonName } = await import("./atelier-person-model");
      const parsed = parsePersonName(DEMO_NAME);
      await writePersonAndSync(db, {
        orgId,
        personId: user.personId,
        structured: { ...parsed, preferredName: null },
        sourceKind: "user",
        parseReview: parsed.review,
      });
    }
    logger.info({ userId: DEMO_USER_ID, name: DEMO_NAME }, "demo user identity repaired");
  }
  // Person link (same pattern as the founder repair — idempotent).
  const { writePersonFromFullName } = await import("./atelier-person-sync");
  const [demoUser] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, DEMO_USER_ID));
  if (demoUser && !demoUser.personId) {
    const w = await writePersonFromFullName(db, {
      orgId,
      fullName: DEMO_NAME,
      sourceKind: "user",
    });
    await db
      .update(atelierUsers)
      .set({ personId: w.personId, updatedAt: new Date() })
      .where(eq(atelierUsers.id, DEMO_USER_ID));
  }
  // Employee roster row so the Me lens resolves a self record.
  const [emp] = await db
    .select({
      id: atelierEmployees.id,
      personId: atelierEmployees.personId,
      fullName: atelierEmployees.fullName,
      cellPhones: atelierEmployees.cellPhones,
    })
    .from(atelierEmployees)
    .where(eq(atelierEmployees.userId, DEMO_USER_ID));
  if (!emp) {
    const [linked] = await db
      .select({ personId: atelierUsers.personId })
      .from(atelierUsers)
      .where(eq(atelierUsers.id, DEMO_USER_ID));
    await db.insert(atelierEmployees).values({
      id: "emp_demo_reviewer",
      orgId,
      userId: DEMO_USER_ID,
      fullName: DEMO_NAME,
      email: DEMO_EMAIL,
      role: "employee",
      title: "App Review (read-only demo)",
      personId: linked?.personId ?? null,
      cellPhones: [{ country: "US", number: DEMO_PHONE }],
    });
    logger.info("demo employee roster row created");
  } else {
    // Idempotent repair: keep the demo roster identity + phone in shape so
    // the Me page (and its vCard QR) always show the review persona.
    const patch: Partial<typeof atelierEmployees.$inferInsert> = {};
    if (emp.fullName !== DEMO_NAME) patch.fullName = DEMO_NAME;
    const phones = emp.cellPhones ?? [];
    if (!phones.some((p) => p.number === DEMO_PHONE)) {
      patch.cellPhones = [{ country: "US", number: DEMO_PHONE }];
    }
    if (Object.keys(patch).length > 0) {
      await db
        .update(atelierEmployees)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(atelierEmployees.id, emp.id));
      logger.info("demo employee roster row repaired");
    }
  }
  await ensureDemoShowcaseData(orgId);
  // Credential: unlike the founder rows, the demo credential is ALWAYS
  // repaired to the published review password with no pending forced
  // change — a partner reset or drift must never brick Apple's review.
  const [cred] = await db
    .select()
    .from(atelierAuthCredentials)
    .where(eq(atelierAuthCredentials.email, DEMO_EMAIL));
  const needsRepair =
    !cred ||
    cred.userId !== DEMO_USER_ID ||
    cred.disabled ||
    cred.mustChangePassword ||
    !verifyPassword(DEMO_PASSWORD, cred.passwordHash);
  if (needsRepair) {
    const passwordHash = hashPassword(DEMO_PASSWORD);
    await db
      .insert(atelierAuthCredentials)
      .values({
        email: DEMO_EMAIL,
        userId: DEMO_USER_ID,
        passwordHash,
        userManaged: false,
        mustChangePassword: false,
        disabled: false,
      })
      .onConflictDoUpdate({
        target: atelierAuthCredentials.email,
        set: {
          userId: DEMO_USER_ID,
          passwordHash,
          userManaged: false,
          mustChangePassword: false,
          mustChangeReason: null,
          disabled: false,
          updatedAt: new Date(),
        },
      });
    logger.info({ email: DEMO_EMAIL }, "demo credential seeded/repaired");
  }
}

/**
 * Per user request (2026-07-23): a small set of DEMO-ONLY showcase rows so
 * the App Store reviewer (and screenshots) never see blank Expenses /
 * Meetings pages. Strictly scoped to the read-only demo persona — this is
 * NOT general seeding (that policy stands). Idempotent: expenses insert
 * once by fixed id; meetings roll forward into the upcoming week whenever
 * they've drifted into the past so the calendar view is never empty.
 */
async function ensureDemoShowcaseData(orgId: string): Promise<void> {
  const today = new Date();
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const daysAgo = (n: number): Date =>
    new Date(today.getTime() - n * 24 * 3600 * 1000);

  const expenses: Array<Partial<typeof atelierExpenses.$inferInsert>> = [
    {
      id: "exp_demo_1",
      merchant: "Uber",
      description: "Airport transfer — client visit",
      category: "ground_transport",
      amount: 42.5,
      currency: "USD",
      usdAmount: 42.5,
      expenseDate: iso(daysAgo(2)),
      status: "draft",
    },
    {
      id: "exp_demo_2",
      merchant: "Starbucks",
      description: "Coffee with prospect",
      category: "meals",
      amount: 18.75,
      currency: "USD",
      usdAmount: 18.75,
      expenseDate: iso(daysAgo(5)),
      status: "submitted",
      submittedAt: daysAgo(5),
    },
    {
      id: "exp_demo_3",
      merchant: "Marriott Downtown",
      description: "Hotel — 1 night, workshop trip",
      category: "lodging",
      amount: 289.0,
      currency: "USD",
      usdAmount: 289.0,
      expenseDate: iso(daysAgo(9)),
      status: "submitted",
      submittedAt: daysAgo(8),
    },
  ];
  for (const e of expenses) {
    await db
      .insert(atelierExpenses)
      .values({
        ...e,
        id: e.id!,
        orgId,
        personId: DEMO_USER_ID,
        personType: "employee",
        expenseDate: e.expenseDate!,
        captureSource: "manual",
        summary: `${e.merchant} — ${e.description}`,
      } as typeof atelierExpenses.$inferInsert)
      .onConflictDoNothing({ target: atelierExpenses.id });
  }

  // "Catch up" meetings with fictional colleagues; visible on /me/calendar
  // because the demo user is an internal attendee. Times are kept in the
  // NEXT few days — rolled forward whenever a boot finds them in the past.
  const attendeeSets = [
    { id: "mtg_demo_1", withWhom: "Matt Fewer", daysAhead: 1, hourUtc: 7 },
    { id: "mtg_demo_2", withWhom: "Ricky Norton", daysAhead: 2, hourUtc: 11 },
    {
      id: "mtg_demo_3",
      withWhom: "Matt Fewer, Ricky Norton",
      daysAhead: 4,
      hourUtc: 9,
    },
  ];
  const extAttendees = (who: string) =>
    who.split(", ").map((name) => ({
      userId: `ext_${name.toLowerCase().replace(/\s+/g, "_")}`,
      name,
      email: null,
    }));
  for (const m of attendeeSets) {
    const startAt = new Date(today.getTime() + m.daysAhead * 24 * 3600 * 1000);
    startAt.setUTCHours(m.hourUtc, 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
    const internalAttendees = [
      { userId: DEMO_USER_ID, name: DEMO_NAME, email: DEMO_EMAIL },
      ...extAttendees(m.withWhom),
    ];
    const inserted = await db
      .insert(atelierMeetings)
      .values({
        id: m.id,
        orgId,
        parentType: "internal",
        parentId: "internal",
        mode: "scheduled",
        kind: "internal",
        title: "Catch up",
        date: iso(startAt),
        startAt,
        endAt,
        locationType: "online",
        internalAttendees,
        attendees: internalAttendees.map((a) => a.name),
        status: "scheduled",
        createdByUserId: DEMO_USER_ID,
      })
      .onConflictDoNothing({ target: atelierMeetings.id })
      .returning({ id: atelierMeetings.id });
    if (inserted.length === 0) {
      // Row exists — roll it forward if it has drifted into the past so the
      // reviewer's calendar week always shows the demo meetings.
      await db
        .update(atelierMeetings)
        .set({ startAt, endAt, date: iso(startAt), deletedAt: null, updatedAt: new Date() })
        .where(and(eq(atelierMeetings.id, m.id), lt(atelierMeetings.startAt, today)));
    }
  }
}

export async function ensureAtelierAuthSeed(): Promise<void> {
  await ensureFounderTitles();
  await ensureFounderPersonLinks();
  await ensureDemoAccount().catch((err) => {
    logger.error({ err }, "demo account seed failed — App Store review login may not work");
  });
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
