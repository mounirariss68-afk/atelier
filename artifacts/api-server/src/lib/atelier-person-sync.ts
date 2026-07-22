/**
 * Task #538 — person-record DB sync helpers.
 *
 * Every name write in every domain flows through here so the person row,
 * the derived display/full names, initials, and the legacy columns on the
 * domain tables stay consistent. Routes keep owning their own ACLs and
 * audit; this module only owns the person row + legacy-column mirroring.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  atelierPersons,
  atelierUsers,
  atelierContacts,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirmResources,
} from "@workspace/db";
import { inArray, isNull, sql } from "drizzle-orm";
import {
  type StructuredName,
  composeDisplayName,
  composeFullName,
  composeLegalName,
  computeInitials,
  newPersonId,
  parsePersonName,
  sanitizeStructuredName,
} from "./atelier-person-model.js";

type Dbish = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface PersonWriteResult {
  personId: string;
  displayName: string;
  fullName: string;
  initials: string;
  structured: StructuredName;
}

/**
 * Create or update a person row from structured fields. `personId` null →
 * insert. Display name is always recomputed here — never trusted from the
 * caller. Returns everything a route needs to mirror legacy columns.
 */
export async function writePerson(
  exec: Dbish,
  opts: {
    orgId: string;
    personId?: string | null;
    structured: StructuredName;
    sourceKind?: string;
    createdByUserId?: string | null;
    /** preserve/clear the migration ambiguity flag; manual edits clear it */
    parseReview?: string | null;
  },
): Promise<PersonWriteResult> {
  const s = sanitizeStructuredName(opts.structured);
  const displayName = composeDisplayName(s);
  const fullName = composeFullName(s);
  const initials = computeInitials(s);
  const now = new Date();
  if (opts.personId) {
    await exec
      .update(atelierPersons)
      .set({
        honorific: s.honorific,
        firstName: s.firstName,
        middleName: s.middleName,
        lastName: s.lastName,
        preferredName: s.preferredName ?? null,
        displayName,
        parseReview: opts.parseReview !== undefined ? opts.parseReview : null,
        updatedAt: now,
      })
      .where(and(eq(atelierPersons.id, opts.personId), eq(atelierPersons.orgId, opts.orgId)));
    return { personId: opts.personId, displayName, fullName, initials, structured: s };
  }
  const id = newPersonId();
  await exec.insert(atelierPersons).values({
    id,
    orgId: opts.orgId,
    honorific: s.honorific,
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    preferredName: s.preferredName ?? null,
    displayName,
    sourceKind: opts.sourceKind ?? "manual",
    parseReview: opts.parseReview ?? null,
    createdByUserId: opts.createdByUserId ?? null,
  });
  return { personId: id, displayName, fullName, initials, structured: s };
}

/**
 * Convenience for write paths that still receive a single free-text
 * fullName (agents, chat, legacy API fields): parse → writePerson.
 * The parse-review flag is stored so ambiguous agent-written names stay
 * visible for review.
 */
export async function writePersonFromFullName(
  exec: Dbish,
  opts: {
    orgId: string;
    personId?: string | null;
    fullName: string;
    preferredName?: string | null;
    sourceKind?: string;
    createdByUserId?: string | null;
  },
): Promise<PersonWriteResult> {
  const parsed = parsePersonName(opts.fullName);
  if (parsed.review === "empty") {
    throw new Error("empty person name");
  }
  return writePerson(exec, {
    orgId: opts.orgId,
    personId: opts.personId,
    structured: { ...parsed, preferredName: opts.preferredName ?? null },
    sourceKind: opts.sourceKind,
    createdByUserId: opts.createdByUserId,
    parseReview: parsed.review,
  });
}

/**
 * Mirror a person write onto the legacy columns of every domain row linked
 * to it (users.name/initials, contacts.full_name, employees.full_name/
 * preferred_name, contractors.full_name, partner_firm_resources.full_name).
 * Cheap targeted updates; org-scoped.
 */
export async function syncLegacyColumns(
  exec: Dbish,
  orgId: string,
  personId: string,
  w: { displayName: string; fullName: string; initials: string; structured: StructuredName },
): Promise<void> {
  const now = new Date();
  await exec
    .update(atelierUsers)
    .set({ name: w.fullName, initials: w.initials, updatedAt: now })
    .where(and(eq(atelierUsers.personId, personId), eq(atelierUsers.orgId, orgId)));
  await exec
    .update(atelierContacts)
    .set({ fullName: w.fullName, updatedAt: now })
    .where(and(eq(atelierContacts.personId, personId), eq(atelierContacts.orgId, orgId)));
  await exec
    .update(atelierEmployees)
    .set({
      fullName: w.fullName,
      preferredName: w.structured.preferredName ?? null,
      updatedAt: now,
    })
    .where(and(eq(atelierEmployees.personId, personId), eq(atelierEmployees.orgId, orgId)));
  await exec
    .update(atelierContractors)
    .set({ fullName: w.fullName, updatedAt: now })
    .where(and(eq(atelierContractors.personId, personId), eq(atelierContractors.orgId, orgId)));
  await exec
    .update(atelierPartnerFirmResources)
    .set({ fullName: w.fullName, updatedAt: now })
    .where(
      and(
        eq(atelierPartnerFirmResources.personId, personId),
        eq(atelierPartnerFirmResources.orgId, orgId),
      ),
    );
}

/** writePerson + syncLegacyColumns in one call — the default for routes. */
export async function writePersonAndSync(
  exec: Dbish,
  opts: Parameters<typeof writePerson>[1],
): Promise<PersonWriteResult> {
  const w = await writePerson(exec, opts);
  await syncLegacyColumns(exec, opts.orgId, w.personId, w);
  return w;
}

/**
 * Resolve the full LEGAL name (honorific + first + middle + last) for a set
 * of email addresses by walking the person links on users, contacts and
 * employees. Used when composing NEW contract / e-sign signer snapshots so
 * they carry the formal name instead of the casual display mirror. Emails
 * without a linked person are simply absent from the returned map.
 */
export async function legalNamesByEmail(
  orgId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return out;
  const collect = async (
    rows: Array<{ email: string | null; personId: string | null }>,
  ): Promise<void> => {
    const pids = [
      ...new Set(rows.map((r) => r.personId).filter((v): v is string => !!v)),
    ];
    if (pids.length === 0) return;
    const persons = await db
      .select()
      .from(atelierPersons)
      .where(and(eq(atelierPersons.orgId, orgId), inArray(atelierPersons.id, pids)));
    const byId = new Map(persons.map((p) => [p.id, p]));
    for (const r of rows) {
      const email = r.email?.trim().toLowerCase();
      if (!email || !r.personId || out.has(email)) continue;
      const p = byId.get(r.personId);
      if (!p) continue;
      out.set(
        email,
        composeLegalName({
          honorific: p.honorific,
          firstName: p.firstName,
          middleName: p.middleName,
          lastName: p.lastName,
          preferredName: p.preferredName,
        }),
      );
    }
  };
  const emailIn = (col: unknown) => inArray(sql`lower(${col})`, wanted);
  await collect(
    await db
      .select({ email: atelierUsers.email, personId: atelierUsers.personId })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.orgId, orgId), isNull(atelierUsers.deletedAt), emailIn(atelierUsers.email))),
  );
  await collect(
    await db
      .select({ email: atelierEmployees.email, personId: atelierEmployees.personId })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.orgId, orgId), emailIn(atelierEmployees.email))),
  );
  await collect(
    await db
      .select({ email: atelierContacts.email, personId: atelierContacts.personId })
      .from(atelierContacts)
      .where(and(eq(atelierContacts.orgId, orgId), emailIn(atelierContacts.email))),
  );
  return out;
}
