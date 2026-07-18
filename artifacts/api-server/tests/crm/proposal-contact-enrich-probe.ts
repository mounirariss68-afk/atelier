/**
 * Task #99 — integration probe: approving a Cartographer contact proposal
 * whose name is a spelling VARIANT of an existing CRM contact must ENRICH
 * the existing row (fuzzy person-name match), never create a duplicate.
 *
 * Boots the app in-process (app.listen(0)), seeds its own account + contacts
 * via db.insert (harness convention — never REST), then approves a seeded
 * pending proposal through the real route:
 *   POST /accounts/:accountId/profile-updates/:updateId/decision
 *
 * Asserts:
 *   1. "Mohammed Al Jasser" proposal enriches seeded
 *      "Dr. Mohammed bin Nasser Al-Jasser" — one row survives, keeps the
 *      richer name spelling, merges proposed fields (title/seniority/…)
 *      and does NOT blank the existing LinkedIn URL.
 *   2. reports_to edge creation resolves the manager name fuzzily
 *      ("Khalid Al-Falih" → seeded "Eng. Khalid AlFalih").
 *   3. Positive control — a genuinely new name in a proposal DOES create a
 *      new contact row (the matcher isn't trivially collapsing everyone).
 *   4. Queue items are stamped approved with decider provenance.
 *
 * Run: pnpm exec tsx tests/crm/proposal-contact-enrich-probe.ts
 * Cleanup: all fixtures are __probe99_* rows deleted in finally.
 */

// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "./scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, inArray, isNull } from "drizzle-orm";

const failures: string[] = [];
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

const FP = "p_mounir_ariss"; // founding_partner — firm-wide visibility
const STAMP = Date.now();
const ACC = `__probe99_acc_${STAMP}`;
const CT_EXEC = `__probe99_ct_exec_${STAMP}`;
const CT_MGR = `__probe99_ct_mgr_${STAMP}`;
const UPD_ENRICH = `__probe99_upd_enrich_${STAMP}`;
const UPD_NEW = `__probe99_upd_new_${STAMP}`;

const EXISTING_NAME = "Dr. Mohammed bin Nasser Al-Jasser";
const VARIANT_NAME = "Mohammed Al Jasser";
const MANAGER_NAME = "Eng. Khalid AlFalih";
const MANAGER_VARIANT = "Khalid Al-Falih";
const NEW_PERSON = "Layla Al Busaidi";
const EXISTING_LINKEDIN = "https://www.linkedin.com/in/probe99-maljasser";

async function main() {
  const { default: app } = await import("../../src/app.js");
  const {
    db,
    atelierAccounts,
    atelierContacts,
    atelierContactRelationships,
  } = await import("@workspace/db");

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  async function post(path: string, body: unknown, persona: string) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${persona}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-json */
    }
    return { status: res.status, json, text };
  }

  const now = new Date().toISOString();
  const mkContactProposal = (id: string, toValue: unknown) => ({
    id,
    proposedBy: "agent_account_cartographer",
    proposedAt: now,
    field: "contact",
    fromValue: null,
    toValue,
    rationale: "seeded for probe99",
    status: "pending",
  });

  try {
    // ---- seed fixtures via db.insert (harness convention) ----
    await db.insert(atelierAccounts).values({
      id: ACC,
      orgId: "aico",
      name: `Probe99 Enrich Co ${STAMP}`,
      country: "Saudi Arabia",
      sector: "Financial Services",
      pendingProfileUpdates: [
        mkContactProposal(UPD_ENRICH, {
          fullName: VARIANT_NAME,
          title: "Group Chief Executive Officer",
          seniority: "c_suite",
          entityName: "Probe99 Enrich Co",
          entityScope: "group",
          buyerPersona: "CEO",
          timeInRole: "3 years",
          careerHistory: [
            { role: "CEO", company: "Probe99 Enrich Co", period: "2023–" },
          ],
          education: [{ institution: "KFUPM", programme: "MBA" }],
          sourceUrl: "https://example.test/probe99-profile",
          confidence: "verified",
          reportsToName: MANAGER_VARIANT,
          rationale: "richer variant of an existing contact",
        }),
        mkContactProposal(UPD_NEW, {
          fullName: NEW_PERSON,
          title: "Chief Information Officer",
          seniority: "c_suite",
          confidence: "inferred",
        }),
      ],
    } as any);

    await db.insert(atelierContacts).values([
      {
        id: CT_EXEC,
        orgId: "aico",
        accountId: ACC,
        fullName: EXISTING_NAME,
        title: "CEO",
        linkedinUrl: EXISTING_LINKEDIN,
        disposition: "unknown",
      },
      {
        id: CT_MGR,
        orgId: "aico",
        accountId: ACC,
        fullName: MANAGER_NAME,
        title: "Chairman",
        disposition: "unknown",
      },
    ] as any);

    // ---- [1] approve the spelling-variant proposal ----
    console.log(`\n[1] approve variant proposal "${VARIANT_NAME}"`);
    const r1 = await post(
      `/accounts/${ACC}/profile-updates/${UPD_ENRICH}/decision`,
      { decision: "approve" },
      FP,
    );
    check("decision route returns 200", r1.status === 200, {
      status: r1.status,
      body: r1.text.slice(0, 300),
    });

    const contacts = await db
      .select()
      .from(atelierContacts)
      .where(and(eq(atelierContacts.accountId, ACC), isNull(atelierContacts.deletedAt)));

    check(
      "no duplicate contact row created (still 2 contacts)",
      contacts.length === 2,
      contacts.map((c) => c.fullName),
    );
    const exec = contacts.find((c) => c.id === CT_EXEC);
    check("existing contact row survives", !!exec);
    check(
      "surviving row keeps the RICHER name spelling",
      exec?.fullName === EXISTING_NAME,
      exec?.fullName,
    );
    check(
      "proposed fields merged onto existing row (title)",
      exec?.title === "Group Chief Executive Officer",
      exec?.title,
    );
    check("seniority merged", exec?.seniority === "c_suite", exec?.seniority);
    check("buyerPersona merged", exec?.buyerPersona === "CEO", exec?.buyerPersona);
    check(
      "careerHistory merged",
      Array.isArray(exec?.careerHistory) && (exec?.careerHistory as any[]).length === 1,
      exec?.careerHistory,
    );
    check(
      "existing LinkedIn URL NOT blanked by proposal without one",
      exec?.linkedinUrl === EXISTING_LINKEDIN,
      exec?.linkedinUrl,
    );

    // ---- [2] reports_to edge resolved fuzzily ----
    console.log(`\n[2] reports_to edge via fuzzy manager "${MANAGER_VARIANT}"`);
    const edges = await db
      .select()
      .from(atelierContactRelationships)
      .where(
        and(
          eq(atelierContactRelationships.accountId, ACC),
          eq(atelierContactRelationships.type, "reports_to"),
          isNull(atelierContactRelationships.deletedAt),
        ),
      );
    check("exactly one reports_to edge created", edges.length === 1, edges);
    check(
      "edge is survivor → fuzzily-resolved manager",
      edges[0]?.fromContactId === CT_EXEC && edges[0]?.toContactId === CT_MGR,
      edges[0],
    );

    // ---- [3] positive control: genuinely new name creates a row ----
    console.log(`\n[3] approve new-person proposal "${NEW_PERSON}"`);
    const r2 = await post(
      `/accounts/${ACC}/profile-updates/${UPD_NEW}/decision`,
      { decision: "approve" },
      FP,
    );
    check("new-person decision returns 200", r2.status === 200, r2.status);
    const contacts2 = await db
      .select()
      .from(atelierContacts)
      .where(and(eq(atelierContacts.accountId, ACC), isNull(atelierContacts.deletedAt)));
    check(
      "genuinely new name DID create a third contact",
      contacts2.length === 3 &&
        contacts2.some((c) => c.fullName === NEW_PERSON),
      contacts2.map((c) => c.fullName),
    );

    // ---- [4] queue provenance ----
    const [acc] = await db
      .select({ q: atelierAccounts.pendingProfileUpdates })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, ACC));
    const queue = (acc?.q ?? []) as Array<{
      id: string;
      status: string;
      decidedBy?: string;
      decidedAt?: string;
    }>;
    const stamped = queue.find((u) => u.id === UPD_ENRICH);
    check(
      "queue item stamped approved with decider provenance",
      stamped?.status === "approved" && stamped?.decidedBy === FP && !!stamped?.decidedAt,
      stamped,
    );
  } finally {
    // ---- cleanup (children first) ----
    await db
      .delete(atelierContactRelationships)
      .where(eq(atelierContactRelationships.accountId, ACC));
    await db.delete(atelierContacts).where(eq(atelierContacts.accountId, ACC));
    await db.delete(atelierAccounts).where(eq(atelierAccounts.id, ACC));
    server.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} FAILURES:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nALL PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
