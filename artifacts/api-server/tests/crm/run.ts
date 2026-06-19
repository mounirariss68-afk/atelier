/**
 * Task #542 — CRM test coverage & regression harness.
 *
 * A single, self-contained integration suite for the Atelier CRM surface
 * (REST API + chat capabilities) plus org/engagement scoping assertions.
 * Follows the repo's hand-rolled `check()` / failures[] / process.exit(1)
 * convention (no vitest) so it can be wired as a validation step.
 *
 * What it covers
 * --------------
 * 1. REST CRM endpoints (booted in-process via app.listen(0)):
 *      accounts (create / duplicate / invalid / role-gate),
 *      contact disposition, opportunities (create / guards / stage),
 *      engagement RAID + deliverables.
 * 2. Chat capabilities invoked in-process via the catalog `.run(input, ctx)`:
 *      account_create, opportunity_create, contact_update_disposition,
 *      raid_add — including the two-phase confirm envelope and the
 *      dealSizeUsd -> dealSizeHypothesis parity quirk.
 * 3. Scoping:
 *      - RLS primitives `atelier_current_org()` / `atelier_engagement_allowed()`
 *        asserted directly under transaction-local GUC overrides (the
 *        building blocks rls.ts binds per request).
 *      - Application ACL via `accessibleEngagementIds()` + account-level
 *        visibility narrowing for a restricted persona over REST.
 *
 * Note on DB-level RLS: in this environment DATABASE_URL connects as a
 * superuser (BYPASSRLS), so table policies are not *enforced* on the live
 * connection. We therefore assert the scoping *logic* at the two layers
 * where it is observable here: the RLS helper functions (pure SQL) and the
 * application ACL helpers. This keeps the suite deterministic and green.
 *
 * Isolation: every row this suite creates is tagged (TAG) and removed in a
 * `finally` cleanup. Set TEST_DATABASE_URL to point at a throwaway database;
 * otherwise it falls back to DATABASE_URL and cleans up after itself.
 */

// --- env setup MUST run before any value-import of @workspace/db / app ---
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { sql, eq, and, gte, inArray } from "drizzle-orm";

// ---- seed fixtures (live seed, org_id = "aico") ----
const ORG = "aico";
const ENG = "eng_tasama_bpo_phase1";
const ACC = "acc_tasama";
const PERSONA = {
  fp: "p_mounir_ariss", // founding_partner — firm-wide visibility
  sm: "p_layla_haddad", // senior_manager
  consultant: "p_omar_najjar", // consultant — cannot create accounts
  restricted: "u_yara_bgts", // partner_firm_resource — RESTRICTED, scoped
};

const TAG = "__t542";
const STAMP = Date.now();
const uniq = (s: string) => `${TAG} ${s} ${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // Fail fast rather than skip: this is a regression gate, and a silent
    // skip would let the validation check pass without running any assertion.
    console.error(
      "\u2717 DATABASE_URL is not set \u2014 the CRM harness requires a database connection. " +
        "Set TEST_DATABASE_URL (preferred, isolated) or DATABASE_URL.",
    );
    process.exit(1);
  }
  if (!process.env.TEST_DATABASE_URL) {
    console.warn(
      "\u26a0 TEST_DATABASE_URL not set \u2014 running against DATABASE_URL (NOT an isolated DB). " +
        "Every row created here is tagged and removed in the finally cleanup, and audit cleanup is " +
        "scoped to this run's actor personas; set TEST_DATABASE_URL for a fully isolated run.",
    );
  }

  // Dynamic imports AFTER env is finalised so the pool binds the right URL.
  const D = await import("@workspace/db");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  const { accessibleEngagementIds } = await import(
    "../../src/routes/atelier/engagementRoutes.js"
  );
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierContacts,
    atelierOpportunities,
    atelierRaidItems,
    atelierDeliverables,
    atelierRenewal,
    atelierAuditEvents,
  } = D as unknown as {
    db: any;
    pool: { end: () => Promise<void> };
    atelierUsers: any;
    atelierAccounts: any;
    atelierContacts: any;
    atelierOpportunities: any;
    atelierRaidItems: any;
    atelierDeliverables: any;
    atelierRenewal: any;
    atelierAuditEvents: any;
  };

  const START = new Date();
  const created = {
    accounts: new Set<string>(),
    opps: new Set<string>(),
    raids: new Set<string>(),
    deliverables: new Set<string>(),
    contacts: new Set<string>(),
    renewals: new Set<string>(),
  };

  // Boot an ephemeral server on a random port.
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  async function api(
    method: string,
    path: string,
    persona: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    let parsed: any = null;
    const txt = await res.text();
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  }

  function rows(result: any): any[] {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.rows)) return result.rows;
    return [];
  }

  function makeCtx(personaId: string, role: string, name: string) {
    return {
      persona: { id: personaId, name, role, orgId: ORG },
      turnId: `t542-turn-${STAMP}`,
      sessionId: `t542-session-${STAMP}`,
      stepIdx: 0,
    };
  }

  try {
    // =====================================================================
    group("REST \u00b7 Accounts");
    // =====================================================================
    {
      const ping = await api("GET", "/accounts", PERSONA.fp);
      check("GET /accounts (founding_partner) \u2192 200 + array", ping.status === 200 && Array.isArray(ping.body), `status=${ping.status}`);

      const name = uniq("Account");
      const validBody = {
        name,
        country: "AE",
        sector: "Logistics",
        tier: "C",
        status: "active",
        primaryCurrency: "USD",
        primaryLanguage: "en",
      };
      const cr = await api("POST", "/accounts", PERSONA.fp, validBody);
      const okCreate = cr.status === 200 || cr.status === 201;
      check("POST /accounts (founding_partner) \u2192 200/201", okCreate, `status=${cr.status} body=${JSON.stringify(cr.body)?.slice(0, 160)}`);
      const [acctRow] = await db
        .select({ id: atelierAccounts.id })
        .from(atelierAccounts)
        .where(eq(atelierAccounts.name, name));
      check("account row persisted with id", !!acctRow?.id);
      if (acctRow?.id) created.accounts.add(acctRow.id);

      const dup = await api("POST", "/accounts", PERSONA.fp, validBody);
      check("POST /accounts duplicate name \u2192 409 duplicate-name", dup.status === 409 && dup.body?.error === "duplicate-name", `status=${dup.status}`);

      const bad = await api("POST", "/accounts", PERSONA.fp, { name: uniq("Bad"), country: "AE" });
      check("POST /accounts invalid body \u2192 400 invalid-body", bad.status === 400 && bad.body?.error === "invalid-body", `status=${bad.status}`);

      const forbidden = await api("POST", "/accounts", PERSONA.consultant, { ...validBody, name: uniq("Forbidden") });
      check("POST /accounts (consultant) \u2192 403 partner-only", forbidden.status === 403 && forbidden.body?.error === "partner-only", `status=${forbidden.status}`);

      // read (R of CRUD)
      if (acctRow?.id) {
        const read = await api("GET", `/accounts/${acctRow.id}`, PERSONA.fp);
        check(
          "GET /accounts/:id (founding_partner) \u2192 200 + workspace",
          read.status === 200 && !!read.body && typeof read.body === "object",
          `status=${read.status}`,
        );
        const readRestricted = await api("GET", `/accounts/${acctRow.id}`, PERSONA.restricted);
        check(
          "GET /accounts/:id (restricted persona) \u2192 403",
          readRestricted.status === 403,
          `status=${readRestricted.status}`,
        );
      }
    }

    // =====================================================================
    group("Contacts \u00b7 create / read / update");
    // (No contact-delete surface exists in the current codebase, so D is N/A.)
    // =====================================================================
    let contactId = "";
    {
      const ctx = makeCtx(PERSONA.fp, "founding_partner", "Mounir Ariss");

      // create (C of CRUD) via the contact_create capability
      const contactCap = catalog.findByToolName("contact_create");
      check("capability contact_create registered", !!contactCap);
      if (contactCap) {
        const noConfirm = await contactCap.run({ accountId: ACC, fullName: uniq("Contact") }, ctx);
        check(
          "contact_create without confirm \u2192 needs_confirm",
          noConfirm.ok === false && (noConfirm as any).errorCode === "needs_confirm",
          JSON.stringify(noConfirm).slice(0, 120),
        );
        const made = await contactCap.run(
          { accountId: ACC, fullName: uniq("Contact"), title: "VP Operations", seniority: "vp", confirm: true },
          ctx,
        );
        contactId = (made.data as any)?.id ?? "";
        check("contact_create (confirm) \u2192 ok + id", made.ok === true && !!contactId, JSON.stringify(made).slice(0, 120));
        if (contactId) created.contacts.add(contactId);
        const [crow] = await db
          .select({ acc: atelierContacts.accountId })
          .from(atelierContacts)
          .where(eq(atelierContacts.id, contactId || "__none__"));
        check("contact_create persisted under the account", crow?.acc === ACC, `accountId=${crow?.acc}`);
      }

      // read (R of CRUD) via the account-contacts list endpoint
      const list = await api("GET", `/accounts/${ACC}/contacts`, PERSONA.fp);
      const listed = Array.isArray(list.body?.contacts)
        ? (list.body.contacts as Array<{ id?: string }>).find((c) => c?.id === contactId)
        : undefined;
      check(
        "GET /accounts/:id/contacts \u2192 200 listing the new contact",
        list.status === 200 && !!contactId && !!listed,
        `status=${list.status} found=${!!listed}`,
      );

      // update (U of CRUD) via the disposition REST endpoint
      if (contactId) {
        const disp = await api("POST", `/contacts/${contactId}/disposition`, PERSONA.fp, { disposition: "champion" });
        check(
          "POST /contacts/:id/disposition \u2192 200 + updated",
          disp.status === 200 && disp.body?.disposition === "champion",
          `status=${disp.status}`,
        );
      }

      const missing = await api("POST", `/contacts/c_does_not_exist_${STAMP}/disposition`, PERSONA.fp, { disposition: "champion" });
      check("POST disposition on missing contact \u2192 404", missing.status === 404, `status=${missing.status}`);
    }

    // =====================================================================
    group("REST \u00b7 Opportunities");
    // =====================================================================
    let oppId = "";
    {
      const oppName = uniq("Opp");
      const cr = await api("POST", "/opportunities", PERSONA.fp, {
        name: oppName,
        description: "Pursue BPO expansion mandate",
        accountId: ACC,
        dealSizeUsd: 480000,
      });
      check("POST /opportunities (accountId + description) \u2192 200/201", cr.status === 200 || cr.status === 201, `status=${cr.status}`);
      const [oppRow] = await db
        .select({ id: atelierOpportunities.id, deal: atelierOpportunities.dealSizeHypothesis })
        .from(atelierOpportunities)
        .where(eq(atelierOpportunities.name, oppName));
      check("opportunity row persisted", !!oppRow?.id);
      if (oppRow?.id) {
        oppId = oppRow.id;
        created.opps.add(oppId);
      }
      check("REST parity: dealSizeUsd \u2192 dealSizeHypothesis (480000)", Number(oppRow?.deal) === 480000, `got ${oppRow?.deal}`);

      const noDesc = await api("POST", "/opportunities", PERSONA.fp, { name: uniq("OppND"), accountId: ACC });
      check("POST /opportunities missing description \u2192 400", noDesc.status === 400, `status=${noDesc.status}`);

      const notFound = await api("POST", "/opportunities", PERSONA.fp, {
        name: uniq("OppNF"),
        description: "x",
        accountId: `acct_missing_${STAMP}`,
      });
      check("POST /opportunities unknown account \u2192 404 account-not-found", notFound.status === 404 && notFound.body?.error === "account-not-found", `status=${notFound.status}`);

      if (oppId) {
        const guard = await api("PATCH", `/opportunities/${oppId}/stage`, PERSONA.fp, { toStage: "pursue" });
        check("PATCH stage \u2192 pursue without 5C \u2192 412 qualifier-required", guard.status === 412 && guard.body?.error === "qualifier-required", `status=${guard.status}`);

        const move = await api("PATCH", `/opportunities/${oppId}/stage`, PERSONA.fp, { toStage: "shape", rationale: "t542" });
        check("PATCH stage \u2192 shape \u2192 200", move.status === 200, `status=${move.status}`);
        const [moved] = await db
          .select({ stage: atelierOpportunities.plmStage })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.id, oppId));
        check("opportunity plmStage persisted as 'shape'", moved?.stage === "shape", `got ${moved?.stage}`);
      }

      // ---- Task #540: edit core fields (PATCH /opportunities/:oppId) ----
      if (oppId) {
        const edit = await api("PATCH", `/opportunities/${oppId}`, PERSONA.fp, {
          dealSizeUsd: 525000,
          probabilityPct: 40,
          nextMilestone: "SOW review",
        });
        check("PATCH /opportunities/:id (edit fields) \u2192 200", edit.status === 200, `status=${edit.status}`);
        const [edited] = await db
          .select({ deal: atelierOpportunities.dealSizeHypothesis, prob: atelierOpportunities.probabilityPct, nm: atelierOpportunities.nextMilestone })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.id, oppId));
        check(
          "opportunity edit persisted dealSizeHypothesis 525000 + probabilityPct 40 + nextMilestone",
          Number(edited?.deal) === 525000 && Number(edited?.prob) === 40 && edited?.nm === "SOW review",
          `deal=${edited?.deal} prob=${edited?.prob} nm=${edited?.nm}`,
        );

        const editBlank = await api("PATCH", `/opportunities/${oppId}`, PERSONA.fp, { name: "   " });
        check("PATCH /opportunities/:id blank name \u2192 400 name-required", editBlank.status === 400 && editBlank.body?.error === "name-required", `status=${editBlank.status}`);

        const editBadOwner = await api("PATCH", `/opportunities/${oppId}`, PERSONA.fp, { partnerOwnerId: `usr_missing_${STAMP}` });
        check("PATCH /opportunities/:id unknown partner owner \u2192 400 invalid-partner-owner", editBadOwner.status === 400 && editBadOwner.body?.error === "invalid-partner-owner", `status=${editBadOwner.status}`);

        const editMissing = await api("PATCH", `/opportunities/opp_missing_${STAMP}`, PERSONA.fp, { probabilityPct: 10 });
        check("PATCH /opportunities/:id missing \u2192 404 opportunity-not-found", editMissing.status === 404 && editMissing.body?.error === "opportunity-not-found", `status=${editMissing.status}`);

        // ---- Task #540: structured qualification rubric guards ----
        const rubMissing = await api("POST", `/opportunities/opp_missing_${STAMP}/qualification-rubric`, PERSONA.fp, { attachmentIds: ["att_x"] });
        check("POST rubric on missing opp \u2192 404 opportunity-not-found", rubMissing.status === 404 && rubMissing.body?.error === "opportunity-not-found", `status=${rubMissing.status}`);

        const rubBad = await api("POST", `/opportunities/${oppId}/qualification-rubric`, PERSONA.fp, {});
        check("POST rubric empty body \u2192 400 invalid-body", rubBad.status === 400 && rubBad.body?.error === "invalid-body", `status=${rubBad.status}`);

        const rubNoChunks = await api("POST", `/opportunities/${oppId}/qualification-rubric`, PERSONA.fp, { attachmentIds: [`att_none_${STAMP}`] });
        check("POST rubric with unknown attachments \u2192 422 no-chunks", rubNoChunks.status === 422 && rubNoChunks.body?.error === "no-chunks", `status=${rubNoChunks.status}`);
      }

      // ---- Task #540: archive (soft-delete) over REST ----
      {
        const archName = uniq("ArchOpp");
        await api("POST", "/opportunities", PERSONA.fp, { name: archName, description: "to be archived", accountId: ACC });
        const [archRow] = await db
          .select({ id: atelierOpportunities.id })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.name, archName));
        const archId = archRow?.id ?? "";
        if (archId) created.opps.add(archId);
        check("archive: seed opportunity created", !!archId);
        if (archId) {
          const arch = await api("POST", `/opportunities/${archId}/archive`, PERSONA.fp, { rationale: "duplicate pursuit" });
          check("POST /opportunities/:id/archive \u2192 200 ok", arch.status === 200 && arch.body?.ok === true, `status=${arch.status}`);
          const [archived] = await db
            .select({ d: atelierOpportunities.deletedAt })
            .from(atelierOpportunities)
            .where(eq(atelierOpportunities.id, archId));
          check("opportunity archive soft-deleted (deletedAt set)", !!archived?.d, `deletedAt=${archived?.d}`);

          const afterArch = await api("PATCH", `/opportunities/${archId}`, PERSONA.fp, { probabilityPct: 5 });
          check("PATCH on archived opp \u2192 404 (drops off active set)", afterArch.status === 404, `status=${afterArch.status}`);
        }

        const archMissing = await api("POST", `/opportunities/opp_missing_${STAMP}/archive`, PERSONA.fp, {});
        check("POST archive on missing opp \u2192 404 opportunity-not-found", archMissing.status === 404 && archMissing.body?.error === "opportunity-not-found", `status=${archMissing.status}`);
      }
    }

    // =====================================================================
    group("REST \u00b7 Engagement RAID + deliverables");
    // =====================================================================
    {
      const raid = await api("POST", `/engagements/${ENG}/raid`, PERSONA.fp, {
        kind: "risk",
        severity: "amber",
        description: uniq("vendor SLA may slip"),
      });
      check("POST /engagements/:id/raid \u2192 201 + id", raid.status === 201 && !!raid.body?.id, `status=${raid.status}`);
      if (raid.body?.id) created.raids.add(raid.body.id);

      const list = await api("GET", `/engagements/${ENG}/raid`, PERSONA.fp);
      const hasOurs = Array.isArray(list.body) && list.body.some((r: any) => r.id === raid.body?.id);
      check("GET /engagements/:id/raid lists the new item", list.status === 200 && hasOurs, `status=${list.status}`);

      const deliverable = await api("POST", `/engagements/${ENG}/deliverables`, PERSONA.fp, {
        type: "report",
        name: uniq("Phase 1 Report"),
      });
      check("POST /engagements/:id/deliverables \u2192 201 + id", deliverable.status === 201 && !!deliverable.body?.id, `status=${deliverable.status}`);
      if (deliverable.body?.id) created.deliverables.add(deliverable.body.id);
    }

    // =====================================================================
    group("REST \u00b7 Renewals");
    // =====================================================================
    let renewalId = "";
    {
      const open = await api("POST", "/crm/renewals", PERSONA.fp, {
        accountId: ACC,
        currentArrUsd: 100000,
        proposedArrUsd: 120000,
        riskTier: "green",
      });
      check("POST /crm/renewals (founding_partner) \u2192 ok + id", open.status === 200 && open.body?.ok === true && !!open.body?.data?.id, `status=${open.status} body=${JSON.stringify(open.body)?.slice(0, 140)}`);
      renewalId = open.body?.data?.id ?? "";
      if (renewalId) created.renewals.add(renewalId);
      if (renewalId) {
        const [r] = await db
          .select({ nrr: atelierRenewal.nrrDeltaPct, status: atelierRenewal.status })
          .from(atelierRenewal)
          .where(eq(atelierRenewal.id, renewalId));
        check("renewal persisted: NRR delta derived as +20%", Number(r?.nrr) === 20, `got ${r?.nrr}`);
        check("renewal persisted with status 'open'", r?.status === "open", `got ${r?.status}`);
      }

      const invalid = await api("POST", "/crm/renewals", PERSONA.fp, { currentArrUsd: 5000 });
      check("POST /crm/renewals without account/contract/engagement \u2192 400 invalid_input", invalid.status === 400 && invalid.body?.error === "invalid_input", `status=${invalid.status}`);

      const denied = await api("POST", "/crm/renewals", PERSONA.restricted, { accountId: ACC });
      check("POST /crm/renewals (restricted persona) \u2192 403", denied.status === 403, `status=${denied.status}`);

      if (renewalId) {
        const risk = await api("POST", `/crm/renewals/${renewalId}/risk`, PERSONA.fp, { riskTier: "amber", proposedArrUsd: 90000 });
        check("POST /crm/renewals/:id/risk \u2192 200 + recomputed NRR (-10%)", risk.status === 200 && Number(risk.body?.data?.nrrDeltaPct) === -10, `status=${risk.status} nrr=${risk.body?.data?.nrrDeltaPct}`);
        const [r] = await db.select({ tier: atelierRenewal.riskTier }).from(atelierRenewal).where(eq(atelierRenewal.id, renewalId));
        check("renewal risk tier persisted as 'amber'", r?.tier === "amber", `got ${r?.tier}`);

        const won = await api("POST", `/crm/renewals/${renewalId}/won`, PERSONA.fp, { rationale: "t542 signed" });
        check("POST /crm/renewals/:id/won (partner-tier) \u2192 200 ok", won.status === 200 && won.body?.ok === true, `status=${won.status}`);
        const [closed] = await db.select({ status: atelierRenewal.status }).from(atelierRenewal).where(eq(atelierRenewal.id, renewalId));
        check("renewal status persisted as 'won'", closed?.status === "won", `got ${closed?.status}`);
      }
    }

    // =====================================================================
    group("Chat capabilities \u00b7 parity");
    // =====================================================================
    {
      const ctx = makeCtx(PERSONA.fp, "founding_partner", "Mounir Ariss");

      // opportunity_create: two-phase + dealSizeUsd -> dealSizeHypothesis.
      const oppCap = catalog.findByToolName("opportunity_create");
      check("capability opportunity_create registered", !!oppCap);
      if (oppCap) {
        const phase1 = await oppCap.run({ name: uniq("CapOpp") }, ctx);
        const p1ok = phase1.ok === true && !!phase1.confirmation && Array.isArray((phase1.data as any)?.missingFields) && (phase1.data as any).missingFields.includes("account");
        check("opportunity_create phase1 \u2192 confirmation envelope (missing account)", p1ok);

        const capOppName = uniq("CapOpp");
        const phase2 = await oppCap.run({ name: capOppName, accountId: ACC, dealSizeUsd: 333000, confirm: true }, ctx);
        const id = (phase2.data as any)?.id as string | undefined;
        check("opportunity_create phase2 (confirm) \u2192 ok + id", phase2.ok === true && !!id, JSON.stringify(phase2).slice(0, 160));
        if (id) {
          created.opps.add(id);
          const [r] = await db
            .select({ deal: atelierOpportunities.dealSizeHypothesis })
            .from(atelierOpportunities)
            .where(eq(atelierOpportunities.id, id));
          check("capability parity: dealSizeUsd \u2192 dealSizeHypothesis (333000)", Number(r?.deal) === 333000, `got ${r?.deal}`);
        }
      }

      // opportunity_edit + opportunity_archive (Task #540): two-phase confirm + DB parity.
      const oppEditCap = catalog.findByToolName("opportunity_edit");
      const oppArchiveCap = catalog.findByToolName("opportunity_archive");
      check("capability opportunity_edit registered", !!oppEditCap);
      check("capability opportunity_archive registered", !!oppArchiveCap);
      if (oppCap && oppEditCap && oppArchiveCap) {
        // Seed a throwaway opp to edit then archive (isolated from rows other groups assert against).
        const seed = await oppCap.run({ name: uniq("CapEditOpp"), accountId: ACC, dealSizeUsd: 100000, confirm: true }, ctx);
        const seedId = (seed.data as any)?.id as string | undefined;
        check("opportunity edit/archive: seed opp created", seed.ok === true && !!seedId, JSON.stringify(seed).slice(0, 120));
        if (seedId) {
          created.opps.add(seedId);

          // edit — phase 1 (no confirm) → ok:true + confirmation envelope
          const editP1 = await oppEditCap.run({ opportunityId: seedId, probabilityPct: 55, dealSizeUsd: 250000 }, ctx);
          check("opportunity_edit phase1 \u2192 confirmation envelope", editP1.ok === true && !!editP1.confirmation, JSON.stringify(editP1).slice(0, 120));

          // edit — no editable fields → invalid
          const editNoop = await oppEditCap.run({ opportunityId: seedId, confirm: true }, ctx);
          check("opportunity_edit with no editable fields \u2192 ok:false", editNoop.ok === false, JSON.stringify(editNoop).slice(0, 120));

          // edit — phase 2 (confirm) → ok + persisted
          const editP2 = await oppEditCap.run({ opportunityId: seedId, probabilityPct: 55, dealSizeUsd: 250000, confirm: true }, ctx);
          check("opportunity_edit phase2 (confirm) \u2192 ok", editP2.ok === true, JSON.stringify(editP2).slice(0, 120));
          const [er] = await db
            .select({ deal: atelierOpportunities.dealSizeHypothesis, prob: atelierOpportunities.probabilityPct })
            .from(atelierOpportunities)
            .where(eq(atelierOpportunities.id, seedId));
          check("opportunity_edit persisted dealSizeHypothesis 250000 + probabilityPct 55", Number(er?.deal) === 250000 && Number(er?.prob) === 55, `deal=${er?.deal} prob=${er?.prob}`);

          // archive — phase 1 (no confirm) → ok:true + confirmation envelope
          const archP1 = await oppArchiveCap.run({ opportunityId: seedId }, ctx);
          check("opportunity_archive phase1 \u2192 confirmation envelope", archP1.ok === true && !!archP1.confirmation, JSON.stringify(archP1).slice(0, 120));

          // archive — phase 2 (confirm) → ok + soft-deleted
          const archP2 = await oppArchiveCap.run({ opportunityId: seedId, rationale: "superseded", confirm: true }, ctx);
          check("opportunity_archive phase2 (confirm) \u2192 ok", archP2.ok === true, JSON.stringify(archP2).slice(0, 120));
          const [ar] = await db
            .select({ d: atelierOpportunities.deletedAt })
            .from(atelierOpportunities)
            .where(eq(atelierOpportunities.id, seedId));
          check("opportunity_archive soft-deleted (deletedAt set)", !!ar?.d, `deletedAt=${ar?.d}`);

          // archive — already archived → not_found (drops off active set)
          const archGone = await oppArchiveCap.run({ opportunityId: seedId, confirm: true }, ctx);
          check("opportunity_archive on archived opp \u2192 ok:false not_found", archGone.ok === false && (archGone as any).errorCode === "not_found", JSON.stringify(archGone).slice(0, 120));
        }
      }

      // account_create: two-phase + role gate + persistence.
      const acctCap = catalog.findByToolName("account_create");
      check("capability account_create registered", !!acctCap);
      if (acctCap) {
        const phase1 = await acctCap.run({ name: uniq("CapAcct") }, ctx);
        const miss = (phase1.data as any)?.missingFields as string[] | undefined;
        const p1ok = phase1.ok === true && !!phase1.confirmation && !!miss && miss.includes("country") && miss.some((m) => m.startsWith("sector"));
        check("account_create phase1 \u2192 confirmation envelope (missing country/sector)", p1ok, JSON.stringify(miss));

        const capAcctName = uniq("CapAcct");
        const phase2 = await acctCap.run({ name: capAcctName, country: "AE", sector: "Technology", confirm: true }, ctx);
        const id = (phase2.data as any)?.id as string | undefined;
        check("account_create phase2 (confirm) \u2192 ok + id", phase2.ok === true && !!id, JSON.stringify(phase2).slice(0, 160));
        if (id) {
          created.accounts.add(id);
          const [r] = await db.select({ id: atelierAccounts.id }).from(atelierAccounts).where(eq(atelierAccounts.id, id));
          check("account_create persisted account row", !!r?.id);
        }

        // role gate: consultant persona is denied.
        const denied = await acctCap.run(
          { name: uniq("CapAcctDenied"), country: "AE", sector: "Technology", confirm: true },
          makeCtx(PERSONA.consultant, "consultant", "Omar Najjar"),
        );
        check("account_create (consultant) \u2192 ok:false forbidden", denied.ok === false, JSON.stringify(denied).slice(0, 120));
      }

      // account_update + account_delete: the U and D of account CRUD via capabilities.
      const acctUpdateCap = catalog.findByToolName("account_update");
      const acctDeleteCap = catalog.findByToolName("account_delete");
      check("capability account_update registered", !!acctUpdateCap);
      check("capability account_delete registered", !!acctDeleteCap);
      if (acctCap && acctUpdateCap && acctDeleteCap) {
        // Seed a throwaway account to mutate then soft-delete (isolated from
        // the rows other groups assert against).
        const seed = await acctCap.run({ name: uniq("CrudAcct"), country: "AE", sector: "Technology", confirm: true }, ctx);
        const targetId = (seed.data as any)?.id as string | undefined;
        check("account CRUD: seed account created", seed.ok === true && !!targetId, JSON.stringify(seed).slice(0, 120));
        if (targetId) {
          created.accounts.add(targetId);

          // update
          const updNo = await acctUpdateCap.run({ id: targetId, status: "dormant" }, ctx);
          check("account_update without confirm \u2192 needs_confirm", updNo.ok === false && (updNo as any).errorCode === "needs_confirm", JSON.stringify(updNo).slice(0, 120));
          const upd = await acctUpdateCap.run({ id: targetId, status: "dormant", notes: uniq("note"), confirm: true }, ctx);
          check("account_update (confirm) \u2192 ok", upd.ok === true, JSON.stringify(upd).slice(0, 120));
          const [au] = await db.select({ s: atelierAccounts.status }).from(atelierAccounts).where(eq(atelierAccounts.id, targetId));
          check("account_update persisted status 'dormant'", au?.s === "dormant", `got ${au?.s}`);

          // delete (two-phase: typed-name re-confirm)
          const delPhase1 = await acctDeleteCap.run({ accountId: targetId }, ctx);
          const typed = (delPhase1.confirmation as any)?.diff?.typedNameRequired as string | undefined;
          check("account_delete phase1 \u2192 confirmation w/ typed-name", delPhase1.ok === true && !!delPhase1.confirmation && !!typed, JSON.stringify(delPhase1).slice(0, 140));
          const delPhase2 = await acctDeleteCap.run({ accountId: targetId, confirm: true }, ctx);
          check("account_delete phase2 (confirm) \u2192 ok", delPhase2.ok === true, JSON.stringify(delPhase2).slice(0, 120));
          const [ad] = await db.select({ d: atelierAccounts.deletedAt }).from(atelierAccounts).where(eq(atelierAccounts.id, targetId));
          check("account_delete soft-deleted (deletedAt set)", !!ad?.d, `deletedAt=${ad?.d}`);
        }
      }

      // contact_update_disposition: two-phase + persistence.
      const dispCap = catalog.findByToolName("contact_update_disposition");
      check("capability contact_update_disposition registered", !!dispCap);
      if (dispCap && contactId) {
        const phase1 = await dispCap.run({ contactId, disposition: "blocker" }, ctx);
        check("contact_update_disposition phase1 \u2192 confirmation", phase1.ok === true && !!phase1.confirmation);

        const phase2 = await dispCap.run({ contactId, disposition: "supporter", confirm: true }, ctx);
        check("contact_update_disposition phase2 (confirm) \u2192 ok", phase2.ok === true && (phase2.data as any)?.disposition === "supporter", JSON.stringify(phase2).slice(0, 120));
        const [c] = await db.select({ d: atelierContacts.disposition }).from(atelierContacts).where(eq(atelierContacts.id, contactId));
        check("disposition persisted as 'supporter'", c?.d === "supporter", `got ${c?.d}`);
      }

      // raid_add: confirm-required quick-add.
      const raidCap = catalog.findByToolName("raid_add");
      check("capability raid_add registered", !!raidCap);
      if (raidCap) {
        const noConfirm = await raidCap.run({ engagementId: ENG, kind: "issue", description: uniq("cap raid") }, ctx);
        check("raid_add without confirm \u2192 ok:false needs_confirm", noConfirm.ok === false && noConfirm.errorCode === "needs_confirm");

        const done = await raidCap.run({ engagementId: ENG, kind: "issue", description: uniq("cap raid"), severity: "red", confirm: true }, ctx);
        const id = (done.data as any)?.id as string | undefined;
        check("raid_add (confirm) \u2192 ok + id", done.ok === true && !!id, JSON.stringify(done).slice(0, 120));
        if (id) {
          created.raids.add(id);
          const [r] = await db.select({ s: atelierRaidItems.severity }).from(atelierRaidItems).where(eq(atelierRaidItems.id, id));
          check("raid_add persisted severity 'red'", r?.s === "red", `got ${r?.s}`);
        }
      }

      // renewal_create / renewal_update: confirm-gated write + DB parity.
      const renewalCreateCap = catalog.findByToolName("renewal_create");
      const renewalUpdateCap = catalog.findByToolName("renewal_update");
      check("capability renewal_create registered", !!renewalCreateCap);
      check("capability renewal_update registered", !!renewalUpdateCap);
      if (renewalCreateCap && renewalUpdateCap) {
        const noConfirm = await renewalCreateCap.run({ accountId: ACC, currentArrUsd: 50000, proposedArrUsd: 55000 }, ctx);
        check("renewal_create without confirm \u2192 ok:false needs_confirm", noConfirm.ok === false && noConfirm.errorCode === "needs_confirm");

        const done = await renewalCreateCap.run({ accountId: ACC, currentArrUsd: 50000, proposedArrUsd: 55000, riskTier: "green", confirm: true }, ctx);
        const id = (done.data as any)?.id as string | undefined;
        check("renewal_create (confirm) \u2192 ok + id", done.ok === true && !!id, JSON.stringify(done).slice(0, 120));
        if (id) {
          created.renewals.add(id);
          const updNoConfirm = await renewalUpdateCap.run({ id, riskTier: "red" }, ctx);
          check("renewal_update without confirm \u2192 ok:false needs_confirm", updNoConfirm.ok === false && updNoConfirm.errorCode === "needs_confirm");

          const upd = await renewalUpdateCap.run({ id, riskTier: "red", status: "won", confirm: true }, ctx);
          check("renewal_update (confirm) \u2192 ok", upd.ok === true, JSON.stringify(upd).slice(0, 120));
          const [r] = await db.select({ tier: atelierRenewal.riskTier, status: atelierRenewal.status }).from(atelierRenewal).where(eq(atelierRenewal.id, id));
          check("renewal_update persisted riskTier 'red' + status 'won'", r?.tier === "red" && r?.status === "won", `tier=${r?.tier} status=${r?.status}`);
        }
      }
    }

    // =====================================================================
    group("Scoping \u00b7 RLS primitives + application ACL");
    // =====================================================================
    {
      // --- RLS helper functions (pure SQL, GUC-driven) ---
      const orgDefault = rows(await db.execute(sql`select atelier_current_org() as org`))[0];
      check("atelier_current_org() defaults to 'aico'", orgDefault?.org === ORG, `got ${orgDefault?.org}`);

      await db.transaction(async (tx: any) => {
        await tx.execute(sql`select set_config('app.org_id', 'zzz_other_org', true)`);
        const o = rows(await tx.execute(sql`select atelier_current_org() as org`))[0];
        check("atelier_current_org() honours app.org_id override", o?.org === "zzz_other_org", `got ${o?.org}`);
      });

      await db.transaction(async (tx: any) => {
        await tx.execute(sql`select set_config('app.engagement_ids', '', true)`);
        const allowAll = rows(await tx.execute(sql`select atelier_engagement_allowed(${ENG}) as a`))[0];
        check("engagement_allowed: empty list = allow-all", allowAll?.a === true, `got ${allowAll?.a}`);
      });

      await db.transaction(async (tx: any) => {
        await tx.execute(sql`select set_config('app.engagement_ids', '__atelier_deny_all__', true)`);
        const denied = rows(await tx.execute(sql`select atelier_engagement_allowed(${ENG}) as a`))[0];
        check("engagement_allowed: deny sentinel \u2192 false", denied?.a === false, `got ${denied?.a}`);
      });

      await db.transaction(async (tx: any) => {
        await tx.execute(sql`select set_config('app.engagement_ids', ${ENG}, true)`);
        const match = rows(await tx.execute(sql`select atelier_engagement_allowed(${ENG}) as a`))[0];
        const other = rows(await tx.execute(sql`select atelier_engagement_allowed(${"eng_not_granted"}) as a`))[0];
        check("engagement_allowed: scoped list grants the listed engagement", match?.a === true, `got ${match?.a}`);
        check("engagement_allowed: scoped list denies an unlisted engagement", other?.a === false, `got ${other?.a}`);
      });

      // --- application ACL helpers ---
      const [fpUser] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, PERSONA.fp));
      const [restrictedUser] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, PERSONA.restricted));
      check("seed users present (fp + restricted)", !!fpUser && !!restrictedUser);

      if (fpUser) {
        const acc = await accessibleEngagementIds(fpUser);
        check("accessibleEngagementIds(founding_partner) = firm-wide (all)", acc.all === true);
      }
      if (restrictedUser) {
        const acc = await accessibleEngagementIds(restrictedUser);
        check("accessibleEngagementIds(restricted) = scoped grant set", acc.all === false);
      }

      // Account-level scoping over REST. The founding_partner sees the full
      // firm-wide list; the restricted persona (partner_firm_resource) is
      // blocked from /accounts entirely by the non-employee boundary
      // middleware and must receive a 403 (its allowlist covers only
      // engagement-scoped + identity routes). Asserting the precise mode
      // (denied) avoids masking a regression where it begins leaking rows.
      const fpAccounts = await api("GET", "/accounts", PERSONA.fp);
      const restrictedAccounts = await api("GET", "/accounts", PERSONA.restricted);
      const fpCount = Array.isArray(fpAccounts.body) ? fpAccounts.body.length : -1;
      check("GET /accounts: founding_partner sees a non-empty firm-wide list", fpCount > 0, `fp=${fpCount}`);
      check("GET /accounts: restricted persona is denied with 403 (non-employee boundary)", restrictedAccounts.status === 403, `status=${restrictedAccounts.status} body=${JSON.stringify(restrictedAccounts.body)?.slice(0, 120)}`);
    }
  } finally {
    // -------------------- cleanup (best-effort, tagged rows) --------------
    try {
      for (const id of created.renewals) await db.delete(atelierRenewal).where(eq(atelierRenewal.id, id));
      for (const id of created.raids) await db.delete(atelierRaidItems).where(eq(atelierRaidItems.id, id));
      for (const id of created.deliverables) await db.delete(atelierDeliverables).where(eq(atelierDeliverables.id, id));
      for (const id of created.opps) await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, id));
      for (const id of created.contacts) await db.delete(atelierContacts).where(eq(atelierContacts.id, id));
      for (const id of created.accounts) {
        await db.execute(sql`delete from atelier_agent_runs where target_id = ${id}`).catch(() => undefined);
        await db.delete(atelierAccounts).where(eq(atelierAccounts.id, id));
      }
      // Audit cleanup is scoped to BOTH the entities this run touched AND the
      // actor personas it acted as, so concurrent activity by any other actor
      // (possible on a shared, non-isolated DB) is never deleted.
      const auditActors = [PERSONA.fp, PERSONA.sm, PERSONA.consultant, PERSONA.restricted];
      const auditTargets = new Set<string>([
        ...created.accounts,
        ...created.opps,
        ...created.raids,
        ...created.deliverables,
        ...created.renewals,
        ...created.contacts,
        ENG,
        ACC,
      ]);
      for (const entityId of auditTargets) {
        await db
          .delete(atelierAuditEvents)
          .where(
            and(
              eq(atelierAuditEvents.entityId, entityId),
              gte(atelierAuditEvents.createdAt, START),
              inArray(atelierAuditEvents.actorId, auditActors),
            ),
          );
      }
    } catch (err) {
      console.warn("[t542] cleanup warning:", (err as Error)?.message ?? err);
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await pool.end();
    } catch {
      /* pool may already be closing */
    }
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`\u2717 CRM harness: ${failures.length} check(s) failed:`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  console.log("\u2713 CRM harness: all checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("CRM harness crashed:", err);
  process.exit(1);
});
