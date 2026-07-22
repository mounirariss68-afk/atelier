/**
 * Task #538 — one-time, idempotent migration to the unified person model.
 *
 * Creates an `atelier_persons` row for every existing individual across:
 *   atelier_users, atelier_contacts, atelier_employees, atelier_contractors,
 *   atelier_partner_firm_resources, and the partner-firm jsonb contact lists
 *   (promoted to real atelier_partner_firm_resources rows, jsonb kept
 *   readable + stamped with personId).
 *
 * Rules:
 *   - Idempotent: rows that already carry person_id are skipped; re-running
 *     is a no-op. Promoted jsonb contacts use deterministic row ids.
 *   - Parsing via the particle/honorific-aware parser (person-model helper).
 *   - Dedupe is CONSERVATIVE: same org + same normalised email + fuzzy
 *     same-person name (token matcher). Never merged on name alone.
 *   - Legacy fullName/name columns are NOT rewritten (originals preserved);
 *     only users.initials is recomputed where it drifts from the structured
 *     parse. Future writes flow through the sync helpers.
 *   - Ambiguous parses (single token, 4+ tokens, honorific-only) are flagged
 *     on the person row (parse_review) AND listed in the review report.
 *   - NO seeding — this only migrates data that already exists.
 *
 * Run: cd artifacts/api-server && npx tsx scripts/migrate-person-model.ts
 * Report: artifacts/api-server/scripts/out/person-model-report.md
 */

import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  pool,
  atelierPersons,
  atelierUsers,
  atelierContacts,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirms,
  atelierPartnerFirmResources,
} from "@workspace/db";
import {
  parsePersonName,
  composeFullName,
  computeInitials,
  newPersonId,
  type ParsedPersonName,
} from "../src/lib/atelier-person-model.js";
import { samePersonName } from "../src/lib/atelier-agents/person-name.js";
import { mirrorEntityEmbedding } from "../src/lib/atelier-cli/entity-resolver.js";

interface RegEntry {
  personId: string;
  email: string | null; // normalised
  fullName: string; // original raw name used for fuzzy compare
}

interface ReportRow {
  domain: string;
  rowId: string;
  name: string;
  action: "created" | "linked" | "skipped_existing" | "promoted";
  personId: string;
  review?: string | null;
  note?: string;
}

const report: ReportRow[] = [];
const reviewRows: ReportRow[] = [];

function normEmail(e: string | null | undefined): string | null {
  const t = (e ?? "").trim().toLowerCase();
  return t.includes("@") ? t : null;
}

async function createPerson(
  orgId: string,
  parsed: ParsedPersonName,
  preferredName: string | null,
  sourceKind: string,
): Promise<string> {
  const structured = {
    honorific: parsed.honorific,
    firstName: parsed.firstName,
    middleName: parsed.middleName,
    lastName: parsed.lastName,
    preferredName,
  };
  const id = newPersonId();
  await db.insert(atelierPersons).values({
    id,
    orgId,
    honorific: structured.honorific,
    firstName: structured.firstName,
    middleName: structured.middleName,
    lastName: structured.lastName,
    preferredName,
    displayName: preferredName
      ? `${preferredName} ${structured.lastName}`.trim()
      : composeFullName(structured),
    sourceKind,
    parseReview: parsed.review,
  });
  return id;
}

async function main(): Promise<void> {
  // Registry of persons per org, seeded from rows already linked (idempotent
  // re-run) so dedupe works across runs too.
  const registry = new Map<string, RegEntry[]>(); // orgId -> entries

  const regFor = (orgId: string): RegEntry[] => {
    let r = registry.get(orgId);
    if (!r) {
      r = [];
      registry.set(orgId, r);
    }
    return r;
  };

  // Conservative dedupe: email must match AND names must fuzzy-agree.
  const findMatch = (orgId: string, email: string | null, name: string): RegEntry | null => {
    if (!email) return null;
    for (const e of regFor(orgId)) {
      if (e.email && e.email === email && samePersonName(e.fullName, name)) return e;
    }
    return null;
  };

  // Preload existing person rows (via already-linked domain rows) into the
  // registry so re-runs and partial runs dedupe correctly.
  const preload = async (
    rows: Array<{ orgId: string; personId: string | null; email?: string | null; name: string }>,
  ) => {
    for (const r of rows) {
      if (!r.personId) continue;
      const reg = regFor(r.orgId);
      if (!reg.some((e) => e.personId === r.personId)) {
        reg.push({ personId: r.personId, email: normEmail(r.email), fullName: r.name });
      }
    }
  };

  const users = await db
    .select()
    .from(atelierUsers)
    .where(isNull(atelierUsers.deletedAt));
  const employees = await db
    .select()
    .from(atelierEmployees)
    .where(isNull(atelierEmployees.deletedAt));
  const contractors = await db
    .select()
    .from(atelierContractors)
    .where(isNull(atelierContractors.deletedAt));
  const contacts = await db
    .select()
    .from(atelierContacts)
    .where(isNull(atelierContacts.deletedAt));
  const pfrs = await db
    .select()
    .from(atelierPartnerFirmResources)
    .where(isNull(atelierPartnerFirmResources.deletedAt));
  const firms = await db
    .select()
    .from(atelierPartnerFirms)
    .where(isNull(atelierPartnerFirms.deletedAt));

  await preload(users.map((u) => ({ orgId: u.orgId, personId: u.personId, email: u.email, name: u.name })));
  await preload(employees.map((e) => ({ orgId: e.orgId, personId: e.personId, email: e.email, name: e.fullName })));
  await preload(contractors.map((c) => ({ orgId: c.orgId, personId: c.personId, email: c.email, name: c.fullName })));
  await preload(contacts.map((c) => ({ orgId: c.orgId, personId: c.personId, email: c.email, name: c.fullName })));
  await preload(pfrs.map((p) => ({ orgId: p.orgId, personId: p.personId, email: p.email, name: p.fullName })));

  // Generic per-row processor. Returns the personId linked.
  const processRow = async (opts: {
    domain: string;
    rowId: string;
    orgId: string;
    personId: string | null;
    name: string;
    email: string | null | undefined;
    preferredName?: string | null;
    sourceKind: string;
    link: (personId: string) => Promise<void>;
  }): Promise<string | null> => {
    if (opts.personId) {
      report.push({ domain: opts.domain, rowId: opts.rowId, name: opts.name, action: "skipped_existing", personId: opts.personId });
      return opts.personId;
    }
    const parsed = parsePersonName(opts.name);
    if (parsed.review === "empty") {
      const row: ReportRow = { domain: opts.domain, rowId: opts.rowId, name: opts.name, action: "skipped_existing", personId: "", review: "empty", note: "empty name — NOT migrated" };
      report.push(row);
      reviewRows.push(row);
      return null;
    }
    const email = normEmail(opts.email);
    const match = findMatch(opts.orgId, email, opts.name);
    let personId: string;
    let action: ReportRow["action"];
    if (match) {
      personId = match.personId;
      action = "linked";
    } else {
      personId = await createPerson(opts.orgId, parsed, opts.preferredName ?? null, opts.sourceKind);
      regFor(opts.orgId).push({ personId, email, fullName: opts.name });
      action = "created";
    }
    await opts.link(personId);
    const row: ReportRow = { domain: opts.domain, rowId: opts.rowId, name: opts.name, action, personId, review: parsed.review };
    report.push(row);
    if (parsed.review) reviewRows.push(row);
    return personId;
  };

  // Order matters for dedupe quality: users → employees → contractors →
  // contacts → partner-firm resources → promoted jsonb contacts.
  for (const u of users) {
    const pid = await processRow({
      domain: "user", rowId: u.id, orgId: u.orgId, personId: u.personId,
      name: u.name, email: u.email, sourceKind: "user",
      link: async (personId) => {
        await db.update(atelierUsers).set({ personId, updatedAt: new Date() }).where(eq(atelierUsers.id, u.id));
      },
    });
    // Initials recompute (report-only when unchanged).
    if (pid) {
      const parsed = parsePersonName(u.name);
      if (parsed.review !== "empty") {
        const init = computeInitials(parsed);
        if (init !== "?" && init !== u.initials) {
          await db.update(atelierUsers).set({ initials: init, updatedAt: new Date() }).where(eq(atelierUsers.id, u.id));
          report.push({ domain: "user", rowId: u.id, name: u.name, action: "linked", personId: pid, note: `initials ${u.initials} → ${init}` });
        }
      }
    }
  }

  for (const e of employees) {
    await processRow({
      domain: "employee", rowId: e.id, orgId: e.orgId, personId: e.personId,
      name: e.fullName, email: e.email, preferredName: e.preferredName, sourceKind: "employee",
      link: async (personId) => {
        await db.update(atelierEmployees).set({ personId, updatedAt: new Date() }).where(eq(atelierEmployees.id, e.id));
        // Carry preferredName onto an existing person row if it lacks one.
        if (e.preferredName) {
          await db.execute(
            (await import("drizzle-orm")).sql`UPDATE atelier_persons SET preferred_name = ${e.preferredName} WHERE id = ${personId} AND preferred_name IS NULL`,
          );
        }
      },
    });
  }

  for (const c of contractors) {
    await processRow({
      domain: "contractor", rowId: c.id, orgId: c.orgId, personId: c.personId,
      name: c.fullName, email: c.email, sourceKind: "contractor",
      link: async (personId) => {
        await db.update(atelierContractors).set({ personId, updatedAt: new Date() }).where(eq(atelierContractors.id, c.id));
      },
    });
  }

  for (const c of contacts) {
    const wasUnlinked = !c.personId;
    const pid = await processRow({
      domain: "contact", rowId: c.id, orgId: c.orgId, personId: c.personId,
      name: c.fullName, email: c.email, sourceKind: "contact",
      link: async (personId) => {
        await db.update(atelierContacts).set({ personId, updatedAt: new Date() }).where(eq(atelierContacts.id, c.id));
      },
    });
    // Refresh the name-derived entity embedding for records this run
    // migrated (contact is the only resolver kind mirrored from a person
    // name). Best-effort by design — mirrorEntityEmbedding never throws.
    if (pid && wasUnlinked) {
      await mirrorEntityEmbedding(c.orgId, "contact", c.id, c.fullName);
      report.push({ domain: "contact", rowId: c.id, name: c.fullName, action: "linked", personId: pid, note: "entity embedding refreshed" });
    }
  }

  for (const p of pfrs) {
    await processRow({
      domain: "partner_firm_resource", rowId: p.id, orgId: p.orgId, personId: p.personId,
      name: p.fullName, email: p.email, sourceKind: "partner_firm_resource",
      link: async (personId) => {
        await db.update(atelierPartnerFirmResources).set({ personId, updatedAt: new Date() }).where(eq(atelierPartnerFirmResources.id, p.id));
      },
    });
  }

  // Partner-firm jsonb contacts → promote to REAL atelier_partner_firm_resources
  // rows (deterministic id pfr_pfc_<entryId>), backed by person rows. The jsonb
  // stays readable (UI still reads it) and each entry gets stamped with the
  // personId for traceability + idempotency.
  for (const firm of firms) {
    const list = Array.isArray(firm.contacts) ? firm.contacts : [];
    if (list.length === 0) continue;
    let changed = false;
    const updated = [] as typeof list;
    for (const entry of list) {
      const withPid = entry as typeof entry & { personId?: string };
      if (!entry.name || !entry.name.trim()) {
        updated.push(entry);
        continue;
      }
      const rowId = `pfr_pfc_${entry.id}`;
      const [existing] = await db
        .select({ id: atelierPartnerFirmResources.id, personId: atelierPartnerFirmResources.personId })
        .from(atelierPartnerFirmResources)
        .where(and(eq(atelierPartnerFirmResources.id, rowId), eq(atelierPartnerFirmResources.orgId, firm.orgId)));
      if (existing && withPid.personId) {
        updated.push(entry);
        continue; // fully promoted already
      }
      const parsed = parsePersonName(entry.name);
      if (parsed.review === "empty") {
        updated.push(entry);
        continue;
      }
      const email = normEmail(entry.email);
      const match = findMatch(firm.orgId, email, entry.name);
      let personId: string;
      if (existing?.personId) {
        personId = existing.personId;
      } else if (match) {
        personId = match.personId;
      } else {
        personId = await createPerson(firm.orgId, parsed, null, "partner_firm_contact");
        regFor(firm.orgId).push({ personId, email, fullName: entry.name });
      }
      if (!existing) {
        await db.insert(atelierPartnerFirmResources).values({
          id: rowId,
          orgId: firm.orgId,
          partnerFirmId: firm.id,
          fullName: entry.name.trim(),
          personId,
          email: entry.email ?? null,
          role: entry.role ?? null,
          status: "active",
          notes: "Promoted from partner-firm contact list (Task #538).",
        });
      } else if (!existing.personId) {
        await db.update(atelierPartnerFirmResources).set({ personId, updatedAt: new Date() }).where(eq(atelierPartnerFirmResources.id, rowId));
      }
      updated.push({ ...entry, personId } as typeof entry);
      changed = true;
      const row: ReportRow = { domain: "partner_firm_contact", rowId: `${firm.id}:${entry.id}`, name: entry.name, action: "promoted", personId, review: parsed.review };
      report.push(row);
      if (parsed.review) reviewRows.push(row);
    }
    if (changed) {
      await db.update(atelierPartnerFirms).set({ contacts: updated, updatedAt: new Date() }).where(eq(atelierPartnerFirms.id, firm.id));
    }
  }

  // ---- report ----
  const outDir = path.join(process.cwd(), "scripts", "out");
  fs.mkdirSync(outDir, { recursive: true });
  const counts: Record<string, number> = {};
  for (const r of report) counts[`${r.domain}:${r.action}`] = (counts[`${r.domain}:${r.action}`] ?? 0) + 1;
  const md = [
    "# Person-model migration report",
    `Run: ${new Date().toISOString()}`,
    "",
    "## Counts",
    ...Object.entries(counts).sort().map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Ambiguous parses (review these)",
    reviewRows.length === 0 ? "_none_" : "",
    ...reviewRows.map((r) => `- [${r.domain} ${r.rowId}] "${r.name}" → person ${r.personId || "(not migrated)"} — ${r.review}${r.note ? ` (${r.note})` : ""}`),
    "",
    "## Notes",
    ...report.filter((r) => r.note).map((r) => `- [${r.domain} ${r.rowId}] ${r.note}`),
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "person-model-report.md"), md);
  fs.writeFileSync(path.join(outDir, "person-model-report.json"), JSON.stringify(report, null, 2));
  console.log(md);
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate-person-model] FAILED:", err);
  process.exit(1);
});
