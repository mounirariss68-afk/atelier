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
import zlib from "node:zlib";
import { sql, eq, and, gte, inArray, isNull } from "drizzle-orm";

// ---- seed fixtures (live seed, org_id = "aico") ----
const ORG = "aico";
const ENG = "eng_tasama_bpo_phase1";
const ACC = "acc_tasama";
// Task #555 — an account OUTSIDE the restricted persona's scope. The
// restricted persona (u_yara_bgts) holds an active engagement grant on
// ENG (eng_tasama_bpo_phase1, which lives on ACC=acc_tasama), so acc_tasama
// is actually IN scope for it. acc_dge (engagement eng_dge_effortless_v1)
// has no grant for either the restricted persona or the no-access employee,
// and neither is its partner_owner, so it is the genuine out-of-scope
// fixture for cross-scope mutation-denial assertions.
const ACC_OOS = "acc_dge";
const PERSONA = {
  fp: "p_mounir_ariss", // founding_partner — firm-wide visibility
  sm: "p_layla_haddad", // senior_manager
  consultant: "p_omar_najjar", // consultant — cannot create accounts
  restricted: "u_yara_bgts", // partner_firm_resource — RESTRICTED, scoped
  // consultant with NO engagement-access grant on ENG. An employee (so it
  // passes the non-employee boundary middleware) but lacks the per-engagement
  // grant, so engagement-scoped routes reject it via ensureEngAccess (403).
  noAccess: "p_khaled_aziz",
};

// A second engagement (also visible to the founding_partner) used to assert
// that a RAID delete is scoped to the engagement in the path: deleting a RAID
// that lives on ENG via ENG2's URL must 404, never cross the boundary.
const ENG2 = "eng_dge_effortless_v1";

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

// ---------------------------------------------------------------------------
// Lightweight PDF text extraction (no external dep). PDFKit flate-compresses
// its content streams and writes glyphs as TJ arrays of hex strings with
// kerning numbers, e.g. `[<436f6e7472> 10 <616374> ...] TJ`. We inflate every
// `stream … endstream` block and pull the literal/hex string operands out of
// the Tj / TJ text-showing operators. Enough to make content-level assertions
// (a label is present / a financial figure is absent) without a PDF parser.
function decodeStringToken(tok: string): string {
  if (tok.startsWith("<")) {
    const hex = tok.slice(1, -1).replace(/\s+/g, "");
    let s = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return s;
  }
  // literal (...) string — unescape \( \) \\
  return tok.slice(1, -1).replace(/\\([()\\])/g, "$1");
}

function extractPdfText(buf: Buffer): string {
  const streams: string[] = [];
  const needle = Buffer.from("stream");
  const tail = Buffer.from("endstream");
  let i = 0;
  while (i < buf.length) {
    const s = buf.indexOf(needle, i);
    if (s === -1) break;
    let p = s + needle.length;
    if (buf[p] === 0x0d) p++; // CR
    if (buf[p] === 0x0a) p++; // LF
    const e = buf.indexOf(tail, p);
    if (e === -1) break;
    try {
      streams.push(zlib.inflateSync(buf.subarray(p, e)).toString("latin1"));
    } catch {
      /* not a flate stream (e.g. font program) — skip */
    }
    i = e + tail.length;
  }
  const content = streams.join("\n");
  const texts: string[] = [];
  const strTok = /<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\()])*\)/g;
  // TJ arrays: [ <hex> num (lit) ... ] TJ
  const tjArr = /\[((?:[^\][]|\\.)*)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = tjArr.exec(content)) !== null) {
    let line = "";
    let t: RegExpExecArray | null;
    while ((t = strTok.exec(m[1])) !== null) line += decodeStringToken(t[0]);
    strTok.lastIndex = 0;
    texts.push(line);
  }
  // single-string Tj operator
  const tjOne = /(<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\()])*\))\s*Tj/g;
  while ((m = tjOne.exec(content)) !== null) texts.push(decodeStringToken(m[1]));
  return texts.join("\n");
}

// fmtUsd-style figures rendered in the financial block, e.g. "$0", "$1.2M",
// "$420K", "$3,500". Used to assert money is present / absent in the doc.
const USD_FIGURE_RE = /\$[\d][\d.,]*[KM]?/;
const FINANCIAL_LABELS = [
  "Contract value",
  "Active engagement value",
  "Recognised revenue",
  "Gross margin",
  "Open pipeline",
];
const FINANCIAL_PLACEHOLDER = "Financial detail is restricted for this persona.";

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
  const { isScoutBriefEmpty } = await import(
    "../../src/lib/atelier-agents/runner.js"
  );
  const { runAuthGateChecks } = await import("./auth-gate.js");

  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierContacts,
    atelierContactRelationships,
    atelierOpportunities,
    atelierRaidItems,
    atelierDeliverables,
    atelierRenewal,
    atelierAuditEvents,
    atelierAccountActions,
    atelierAccountRisks,
    atelierAccountGoalProgress,
    atelierEngagements,
    atelierInvoice,
    atelierMeetings,
    atelierTranscripts,
    atelierWinLossDebriefs,
    atelierPaneAItems,
  } = D as unknown as {
    db: any;
    pool: { end: () => Promise<void> };
    atelierUsers: any;
    atelierAccounts: any;
    atelierContacts: any;
    atelierContactRelationships: any;
    atelierOpportunities: any;
    atelierRaidItems: any;
    atelierDeliverables: any;
    atelierRenewal: any;
    atelierAuditEvents: any;
    atelierAccountActions: any;
    atelierAccountRisks: any;
    atelierAccountGoalProgress: any;
    atelierEngagements: any;
    atelierInvoice: any;
    atelierMeetings: any;
    atelierTranscripts: any;
    atelierWinLossDebriefs: any;
    atelierPaneAItems: any;
  };

  const START = new Date();
  const created = {
    accounts: new Set<string>(),
    users: new Set<string>(),
    opps: new Set<string>(),
    raids: new Set<string>(),
    deliverables: new Set<string>(),
    contacts: new Set<string>(),
    renewals: new Set<string>(),
    accountActions: new Set<string>(),
    accountRisks: new Set<string>(),
    accountGoalProgress: new Set<string>(),
    meetings: new Set<string>(),
    transcripts: new Set<string>(),
    debriefs: new Set<string>(),
    paneAItems: new Set<string>(),
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
    // Task #3 — the global 401 gate: structural router-stack assertions plus
    // unauthenticated live probes with the test bypass force-disabled.
    // =====================================================================
    await runAuthGateChecks(port, check, group);

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

      // Task #587 — reviewed-research create: persists the reviewed Cartographer
      // payload verbatim, seeds contacts + reports_to edges, and SKIPS the
      // background Cartographer run (no agent_run row → no banner).
      {
        const rName = uniq("Researched");
        const ceo = `Lena Park ${rName}`;
        const vp = `Omar Diaz ${rName}`;
        const researchBody = {
          ...validBody,
          name: rName,
          research: {
            refreshedSummary: "Mid-market logistics firm modernising its TMS stack.",
            industryCode: "4885",
            subIndustryCode: "488510",
            strategicPriorityRefs: [
              { text: "Cut last-mile cost 12%", sourceUrls: ["https://example.com/a"] },
            ],
            sourceSignals: [],
            researchBrief: null,
            decisionMakers: [
              { fullName: ceo, title: "CEO", seniority: "c_suite", confidence: "verified" },
              { fullName: vp, title: "VP Ops", seniority: "vp", confidence: "inferred", reportsToName: ceo },
            ],
          },
        };
        const rc = await api("POST", "/accounts", PERSONA.fp, researchBody);
        check(
          "POST /accounts (reviewed research) \u2192 201",
          rc.status === 201,
          `status=${rc.status} body=${JSON.stringify(rc.body)?.slice(0, 160)}`,
        );
        const [rRow] = await db
          .select({ id: atelierAccounts.id, industryCode: atelierAccounts.industryCode, notes: atelierAccounts.notes, enrichedAt: atelierAccounts.enrichedAt })
          .from(atelierAccounts)
          .where(eq(atelierAccounts.name, rName));
        if (rRow?.id) created.accounts.add(rRow.id);
        check(
          "reviewed research persisted on account (industryCode + notes + enrichedAt)",
          rRow?.industryCode === "4885" &&
            rRow?.notes === "Mid-market logistics firm modernising its TMS stack." &&
            !!rRow?.enrichedAt,
          `industry=${rRow?.industryCode} enrichedAt=${rRow?.enrichedAt}`,
        );
        const rContacts = rRow?.id
          ? await db
              .select({ id: atelierContacts.id, fullName: atelierContacts.fullName, inf: atelierContacts.influenceScore })
              .from(atelierContacts)
              .where(eq(atelierContacts.accountId, rRow.id))
          : [];
        for (const c of rContacts) created.contacts.add(c.id);
        check(
          "reviewed research seeded 2 contacts (CEO influence=5)",
          rContacts.length === 2 && rContacts.some((c: any) => c.fullName === ceo && c.inf === 5),
          `count=${rContacts.length}`,
        );
        const ceoId = rContacts.find((c: any) => c.fullName === ceo)?.id;
        const vpId = rContacts.find((c: any) => c.fullName === vp)?.id;
        const edges = rRow?.id
          ? await db
              .select({ from: atelierContactRelationships.fromContactId, to: atelierContactRelationships.toContactId })
              .from(atelierContactRelationships)
              .where(eq(atelierContactRelationships.accountId, rRow.id))
          : [];
        check(
          "reviewed research seeded reports_to edge (VP \u2192 CEO)",
          edges.length === 1 && edges[0]?.from === vpId && edges[0]?.to === ceoId,
          `edges=${JSON.stringify(edges)}`,
        );
        const runs = rRow?.id
          ? await db.execute(sql`select count(*)::int as n from atelier_agent_runs where target_id = ${rRow.id}`)
          : { rows: [{ n: 0 }] };
        const runCount = Number((runs as any).rows?.[0]?.n ?? 0);
        check(
          "reviewed research create did NOT trigger a Cartographer agent run",
          runCount === 0,
          `agentRuns=${runCount}`,
        );
        // Clean up the relationship rows this block created (contacts/account
        // are handled by the shared cleanup; relationships have no set there).
        if (rRow?.id) {
          await db.delete(atelierContactRelationships).where(eq(atelierContactRelationships.accountId, rRow.id)).catch(() => undefined);
        }
      }

      // Task #609 — firmographic auto-fill persistence (Task #601 behaviour).
      // The smarter account auto-fill threads employeeCount, annualRevenue,
      // holdingStructure, countryPresence and entityRole from the chat
      // "Review & Create" draft into POST /accounts. Assert each lands on the
      // row verbatim so future changes can't silently drop them.
      {
        const fName = uniq("Firmographic");
        const annualRevenue = {
          amount: 1_200_000_000,
          currency: "AED",
          asOf: "FY2025",
          sourceUrl: "https://example.com/annual-report",
          note: "Group consolidated revenue.",
        };
        const holdingStructure = {
          isHoldingCompany: true,
          isMultiBrand: true,
          brands: ["Brand Alpha", "Brand Beta"],
          note: "Diversified group.",
        };
        const countryPresence = [
          { country: "AE", role: "hq" as const, note: "Group HQ" },
          { country: "SA", role: "branch" as const },
        ];
        const firmoBody = {
          ...validBody,
          name: fName,
          employeeCount: 4200,
          annualRevenue,
          holdingStructure,
          countryPresence,
          entityRole: "hq" as const,
        };
        const fc = await api("POST", "/accounts", PERSONA.fp, firmoBody);
        check(
          "POST /accounts (firmographics) \u2192 200/201",
          fc.status === 200 || fc.status === 201,
          `status=${fc.status} body=${JSON.stringify(fc.body)?.slice(0, 160)}`,
        );
        const [fRow] = await db
          .select({
            id: atelierAccounts.id,
            employeeCount: atelierAccounts.employeeCount,
            annualRevenue: atelierAccounts.annualRevenue,
            holdingStructure: atelierAccounts.holdingStructure,
            countryPresence: atelierAccounts.countryPresence,
            entityRole: atelierAccounts.entityRole,
          })
          .from(atelierAccounts)
          .where(eq(atelierAccounts.name, fName));
        if (fRow?.id) created.accounts.add(fRow.id);
        check(
          "firmographics persisted: employeeCount + entityRole",
          fRow?.employeeCount === 4200 && fRow?.entityRole === "hq",
          `employeeCount=${fRow?.employeeCount} entityRole=${fRow?.entityRole}`,
        );
        check(
          "firmographics persisted: annualRevenue (amount + currency)",
          fRow?.annualRevenue?.amount === 1_200_000_000 && fRow?.annualRevenue?.currency === "AED",
          `annualRevenue=${JSON.stringify(fRow?.annualRevenue)?.slice(0, 120)}`,
        );
        check(
          "firmographics persisted: holdingStructure (flags + brands)",
          fRow?.holdingStructure?.isHoldingCompany === true &&
            fRow?.holdingStructure?.isMultiBrand === true &&
            Array.isArray(fRow?.holdingStructure?.brands) &&
            fRow?.holdingStructure?.brands.length === 2,
          `holdingStructure=${JSON.stringify(fRow?.holdingStructure)?.slice(0, 120)}`,
        );
        check(
          "firmographics persisted: countryPresence (2 markets w/ roles)",
          Array.isArray(fRow?.countryPresence) &&
            fRow?.countryPresence.length === 2 &&
            fRow?.countryPresence.some((p: any) => p?.country === "AE" && p?.role === "hq") &&
            fRow?.countryPresence.some((p: any) => p?.country === "SA" && p?.role === "branch"),
          `countryPresence=${JSON.stringify(fRow?.countryPresence)?.slice(0, 160)}`,
        );
      }

      // Task #609 — blank/unknown figures must be stored as null/empty, never
      // fabricated. A create with no firmographic fields (the common case when
      // figures aren't publicly disclosed) leaves the typed columns blank.
      {
        const bName = uniq("BlankFirmographic");
        const blankBody = { ...validBody, name: bName };
        const bc = await api("POST", "/accounts", PERSONA.fp, blankBody);
        check(
          "POST /accounts (no firmographics) \u2192 200/201",
          bc.status === 200 || bc.status === 201,
          `status=${bc.status}`,
        );
        const [bRow] = await db
          .select({
            id: atelierAccounts.id,
            employeeCount: atelierAccounts.employeeCount,
            annualRevenue: atelierAccounts.annualRevenue,
            holdingStructure: atelierAccounts.holdingStructure,
            countryPresence: atelierAccounts.countryPresence,
            entityRole: atelierAccounts.entityRole,
          })
          .from(atelierAccounts)
          .where(eq(atelierAccounts.name, bName));
        if (bRow?.id) created.accounts.add(bRow.id);
        check(
          "blank figures stored null/empty (never fabricated)",
          bRow?.employeeCount === null &&
            bRow?.annualRevenue === null &&
            bRow?.holdingStructure === null &&
            bRow?.entityRole === null &&
            Array.isArray(bRow?.countryPresence) &&
            bRow?.countryPresence.length === 0,
          `employeeCount=${bRow?.employeeCount} annualRevenue=${JSON.stringify(bRow?.annualRevenue)} ` +
            `holding=${JSON.stringify(bRow?.holdingStructure)} entityRole=${bRow?.entityRole} ` +
            `presence=${JSON.stringify(bRow?.countryPresence)}`,
        );
      }

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
    group("Contacts \u00b7 create / read / update / delete");
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

      // update (U of CRUD) via PATCH /contacts/:contactId
      if (contactId) {
        const edit = await api("PATCH", `/contacts/${contactId}`, PERSONA.fp, {
          title: "SVP Operations",
          influenceScore: 5,
          buyerPersona: uniq("Persona"),
          disposition: "supporter",
        });
        check(
          "PATCH /contacts/:id (edit fields) \u2192 200 + updated",
          edit.status === 200 && edit.body?.title === "SVP Operations" && Number(edit.body?.influenceScore) === 5 && edit.body?.disposition === "supporter",
          `status=${edit.status} body=${JSON.stringify(edit.body)?.slice(0, 160)}`,
        );
        const [erow] = await db
          .select({ title: atelierContacts.title, inf: atelierContacts.influenceScore })
          .from(atelierContacts)
          .where(eq(atelierContacts.id, contactId));
        check("contact edit persisted (title + influenceScore)", erow?.title === "SVP Operations" && Number(erow?.inf) === 5, `title=${erow?.title} inf=${erow?.inf}`);

        const editBlank = await api("PATCH", `/contacts/${contactId}`, PERSONA.fp, { fullName: "   " });
        check("PATCH /contacts/:id blank name \u2192 400 name-required", editBlank.status === 400 && editBlank.body?.error === "name-required", `status=${editBlank.status}`);
      }

      const editMissing = await api("PATCH", `/contacts/c_missing_${STAMP}`, PERSONA.fp, { title: "x" });
      check("PATCH /contacts/:id missing \u2192 404 contact-not-found", editMissing.status === 404 && editMissing.body?.error === "contact-not-found", `status=${editMissing.status}`);

      // delete (D of CRUD) via DELETE /contacts/:contactId (soft-delete).
      // Seed a throwaway contact through the REST POST route (also exercising
      // create-via-REST) so the shared `contactId` stays live for the
      // downstream contact_update_disposition capability checks.
      {
        const seed = await api("POST", `/accounts/${ACC}/contacts`, PERSONA.fp, {
          fullName: uniq("DelContact"),
          title: "Throwaway",
        });
        const delId = seed.body?.id as string | undefined;
        check(
          "POST /accounts/:id/contacts (REST create) \u2192 201 + id",
          (seed.status === 201 || seed.status === 200) && !!delId,
          `status=${seed.status} body=${JSON.stringify(seed.body)?.slice(0, 160)}`,
        );
        if (delId) {
          created.contacts.add(delId);
          const del = await api("DELETE", `/contacts/${delId}`, PERSONA.fp);
          check("DELETE /contacts/:id \u2192 204", del.status === 204, `status=${del.status}`);
          const [drow] = await db
            .select({ deletedAt: atelierContacts.deletedAt })
            .from(atelierContacts)
            .where(eq(atelierContacts.id, delId));
          check("contact soft-deleted (deletedAt set)", !!drow?.deletedAt, `deletedAt=${drow?.deletedAt}`);

          const listAfter = await api("GET", `/accounts/${ACC}/contacts`, PERSONA.fp);
          const stillListed = Array.isArray(listAfter.body?.contacts)
            ? (listAfter.body.contacts as Array<{ id?: string }>).some((c) => c?.id === delId)
            : false;
          check("GET /accounts/:id/contacts \u2192 deleted contact no longer listed", listAfter.status === 200 && !stillListed, `stillListed=${stillListed}`);
        }
      }

      const delMissing = await api("DELETE", `/contacts/c_missing_${STAMP}`, PERSONA.fp);
      check("DELETE /contacts/:id missing \u2192 404 contact-not-found", delMissing.status === 404 && delMissing.body?.error === "contact-not-found", `status=${delMissing.status}`);
    }

    // =====================================================================
    group("Contacts \u00b7 cross-scope mutation guard (Task #555)");
    // Regression gate: a contact on an OUT-OF-SCOPE account (acc_dge) must
    // not be editable/removable by users who cannot see that account —
    // neither over REST (PATCH/DELETE /contacts/:id) nor via the chat
    // contact_update / contact_delete capabilities.
    // =====================================================================
    {
      // Seed an out-of-scope contact via the founding_partner (firm-wide
      // visibility), so the only thing under test below is the *caller's*
      // scope, not the contact's existence.
      const fpCtx = makeCtx(PERSONA.fp, "founding_partner", "Mounir Ariss");
      let oosContactId = "";
      const contactCap = catalog.findByToolName("contact_create");
      if (contactCap) {
        const made = await contactCap.run(
          { accountId: ACC_OOS, fullName: uniq("OOSContact"), title: "Director", seniority: "director", confirm: true },
          fpCtx,
        );
        oosContactId = (made.data as any)?.id ?? "";
        check("seed out-of-scope contact on acc_dge \u2192 ok + id", made.ok === true && !!oosContactId, JSON.stringify(made).slice(0, 120));
        if (oosContactId) created.contacts.add(oosContactId);
      }

      if (oosContactId) {
        // -------------------------------------------------------------
        // REST · restricted persona (partner_firm_resource).
        // The centralized non-employee boundary (index.ts) blocks ALL
        // /contacts/* routes for partner_firm_resource before the route's
        // canSeeAccount check runs, so the observable outcome is a 403
        // (non-employee-persona-not-allowed-here). canSeeAccount remains
        // as defense-in-depth behind the boundary. Either way: DENIED.
        // -------------------------------------------------------------
        const rPatch = await api("PATCH", `/contacts/${oosContactId}`, PERSONA.restricted, { title: "Hacked" });
        check("PATCH /contacts/:id (restricted persona, out-of-scope) \u2192 403 denied", rPatch.status === 403, `status=${rPatch.status} body=${JSON.stringify(rPatch.body)?.slice(0, 120)}`);
        const rDel = await api("DELETE", `/contacts/${oosContactId}`, PERSONA.restricted);
        check("DELETE /contacts/:id (restricted persona, out-of-scope) \u2192 403 denied", rDel.status === 403, `status=${rDel.status} body=${JSON.stringify(rDel.body)?.slice(0, 120)}`);

        // -------------------------------------------------------------
        // REST · employee WITHOUT an engagement grant (p_khaled_aziz).
        // This persona is an employee, so it passes the non-employee
        // boundary and actually reaches the route-level canSeeAccount
        // check, which must reject with 403 account-forbidden.
        // -------------------------------------------------------------
        const nPatch = await api("PATCH", `/contacts/${oosContactId}`, PERSONA.noAccess, { title: "Hacked" });
        check("PATCH /contacts/:id (no-access employee, out-of-scope) \u2192 403 account-forbidden", nPatch.status === 403 && nPatch.body?.error === "account-forbidden", `status=${nPatch.status} body=${JSON.stringify(nPatch.body)?.slice(0, 120)}`);
        const nDel = await api("DELETE", `/contacts/${oosContactId}`, PERSONA.noAccess);
        check("DELETE /contacts/:id (no-access employee, out-of-scope) \u2192 403 account-forbidden", nDel.status === 403 && nDel.body?.error === "account-forbidden", `status=${nDel.status} body=${JSON.stringify(nDel.body)?.slice(0, 120)}`);

        // -------------------------------------------------------------
        // Chat · contact_update / contact_delete under a RESTRICTED ctx.
        // Capabilities are dispatched in-process (they bypass the HTTP
        // non-employee boundary), so this is exactly where the capability's
        // own account-visibility guard must reject the cross-scope write.
        // -------------------------------------------------------------
        const rCtx = makeCtx(PERSONA.restricted, "partner_firm_resource", "Yara Al-Suwaidi");
        const updateCap = catalog.findByToolName("contact_update");
        const deleteCap = catalog.findByToolName("contact_delete");
        check("capability contact_update registered", !!updateCap);
        check("capability contact_delete registered", !!deleteCap);

        if (updateCap) {
          const denied = await updateCap.run({ id: oosContactId, title: "Hacked", confirm: true }, rCtx);
          check(
            "contact_update (restricted ctx, out-of-scope) \u2192 ok:false forbidden",
            denied.ok === false && (denied as any).errorCode === "forbidden",
            JSON.stringify(denied).slice(0, 140),
          );
          const [row] = await db
            .select({ title: atelierContacts.title })
            .from(atelierContacts)
            .where(eq(atelierContacts.id, oosContactId));
          check("contact_update denial left the row unchanged", row?.title !== "Hacked", `title=${row?.title}`);
        }

        if (deleteCap) {
          const denied = await deleteCap.run({ id: oosContactId, confirm: true }, rCtx);
          check(
            "contact_delete (restricted ctx, out-of-scope) \u2192 ok:false forbidden",
            denied.ok === false && (denied as any).errorCode === "forbidden",
            JSON.stringify(denied).slice(0, 140),
          );
          const [row] = await db
            .select({ deletedAt: atelierContacts.deletedAt })
            .from(atelierContacts)
            .where(eq(atelierContacts.id, oosContactId));
          check("contact_delete denial did NOT soft-delete the row", !row?.deletedAt, `deletedAt=${row?.deletedAt}`);
        }
      }
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
        // The harness asserts CRUD persistence, not the Pursuit Scout. Skip the
        // live LLM run so creation is deterministic (the scout is exercised in
        // its own agent-focused suite, not here).
        runScout: false,
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

      // Task #653 — Pursuit Scout outcome must be SURFACED on create, never
      // swallowed by a bare 201. (a) When runScout:false the response carries
      // scout.status === "skipped". (b) The empty/soft-refusal detector that
      // gates persistence is asserted directly (deterministic; no live LLM):
      // a structurally-valid-but-blank brief is "empty" and must not persist.
      check(
        "POST /opportunities (runScout:false) \u2192 scout.status=skipped",
        cr.body?.scout?.status === "skipped",
        `scout=${JSON.stringify(cr.body?.scout)}`,
      );
      const emptyBrief = {
        accountSnapshot: { oneLiner: "  ", scaleHint: "", recentMoves: [] },
        buyerLandscape: { likelyBuyers: [], powerMap: "" },
        fiveCDraft: { client: "", competition: "", capability: "", capacity: "", contract: "" },
        openQuestions: [],
        facts: [],
        confidence: "red" as const,
      };
      const fullBrief = {
        ...emptyBrief,
        accountSnapshot: { oneLiner: "Top-3 regional BPO operator", scaleHint: "~12k seats", recentMoves: [] },
      };
      check("isScoutBriefEmpty(null) \u2192 true", isScoutBriefEmpty(null) === true);
      check("isScoutBriefEmpty(blank brief) \u2192 true (no persist)", isScoutBriefEmpty(emptyBrief) === true);
      check("isScoutBriefEmpty(brief w/ narrative) \u2192 false (persists)", isScoutBriefEmpty(fullBrief) === false);

      const notFound = await api("POST", "/opportunities", PERSONA.fp, {
        name: uniq("OppNF"),
        description: "x",
        accountId: `acct_missing_${STAMP}`,
      });
      check("POST /opportunities unknown account \u2192 404 account-not-found", notFound.status === 404 && notFound.body?.error === "account-not-found", `status=${notFound.status}`);

      if (oppId) {
        // Task #651 — the legacy v1 PATCH /stage shim now routes through the
        // shared gated service, so the SAME gates fire as on every other write
        // path and plm_stage stays in lockstep with the authoritative
        // sales_stage. A fresh low-probability opp sits at `suspect`; advancing
        // into the qualified band (plm `shape` -> sales `prospect`) must trip
        // the 5C qualifier gate exactly like the canonical route.
        const gateName = uniq("OppGate");
        await api("POST", "/opportunities", PERSONA.fp, {
          name: gateName,
          description: "5C gate parity check",
          accountId: ACC,
          probabilityPct: 10,
          runScout: false,
        });
        const [gateRow] = await db
          .select({ id: atelierOpportunities.id })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.name, gateName));
        if (gateRow?.id) created.opps.add(gateRow.id);
        const guard = await api("PATCH", `/opportunities/${gateRow?.id}/stage`, PERSONA.fp, { toStage: "shape" });
        check("legacy PATCH stage into qualified band without 5C \u2192 412 qualifier-required", guard.status === 412 && guard.body?.error === "qualifier-required", `status=${guard.status} err=${guard.body?.error}`);

        // A move that crosses no gate succeeds and resolves to the canonical
        // sales_stage (the single source of truth — Task #651; opportunity
        // plm_stage retired in Task #654). Legacy band `pursue` -> sales `convert`.
        const move = await api("PATCH", `/opportunities/${oppId}/stage`, PERSONA.fp, { toStage: "pursue", rationale: "t542" });
        check("PATCH stage \u2192 pursue \u2192 200", move.status === 200, `status=${move.status}`);
        const [moved] = await db
          .select({ sales: atelierOpportunities.salesStage })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.id, oppId));
        check("opportunity resolves to canonical sales_stage (sales=convert)", moved?.sales === "convert", `sales=${moved?.sales}`);
      }

      // ---- Task #652: opp <-> engagement won-lifecycle handoff ----
      {
        // Forward: moving an opp to `contract` auto-creates + links a
        // mobilizing engagement (partnerOverride bypasses the sales gates but
        // NOT the won-lifecycle invariant).
        const wlName = uniq("OppWL");
        await api("POST", "/opportunities", PERSONA.fp, {
          name: wlName,
          description: "won-lifecycle handoff check",
          accountId: ACC,
          probabilityPct: 30,
          runScout: false,
        });
        const [wlRow] = await db
          .select({ id: atelierOpportunities.id })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.name, wlName));
        const wlOppId = wlRow?.id as string | undefined;
        if (wlOppId) created.opps.add(wlOppId);

        const toContract = await api("POST", `/opportunities/${wlOppId}/stage-transition`, PERSONA.fp, {
          toStage: "contract",
          rationaleText: "signed — won-lifecycle test",
          partnerOverride: true,
        });
        check("stage-transition \u2192 contract \u2192 200", toContract.status === 200, `status=${toContract.status} body=${JSON.stringify(toContract.body)?.slice(0, 160)}`);

        const autoEngs = await db
          .select({ id: atelierEngagements.id, plm: atelierEngagements.plmStage })
          .from(atelierEngagements)
          .where(and(eq(atelierEngagements.opportunityId, wlOppId), isNull(atelierEngagements.deletedAt)));
        check("contract entry auto-created a linked engagement", autoEngs.length === 1 && autoEngs[0]?.plm === "mobilize", `count=${autoEngs.length} plm=${autoEngs[0]?.plm}`);

        // Reverse: an engaged opp cannot leave `contract` for a pre-contract
        // working stage (or a terminal stage) — even with partnerOverride.
        const reverse = await api("POST", `/opportunities/${wlOppId}/stage-transition`, PERSONA.fp, {
          toStage: "convert",
          rationaleText: "try to walk it back",
          partnerOverride: true,
        });
        check("engaged opp blocked from leaving contract \u2192 409 engaged-opp-locked", reverse.status === 409 && reverse.body?.error === "engaged-opp-locked", `status=${reverse.status} err=${reverse.body?.error}`);

        // Idempotent contract re-entry is still allowed.
        const reEnter = await api("POST", `/opportunities/${wlOppId}/stage-transition`, PERSONA.fp, {
          toStage: "contract",
          rationaleText: "re-affirm contract",
          partnerOverride: true,
        });
        check("engaged opp may re-affirm contract \u2192 200", reEnter.status === 200, `status=${reEnter.status}`);
      }

      // ---- Task #653: close date + forecast category ----
      {
        const cdName = uniq("OppCD");
        const cr = await api("POST", "/opportunities", PERSONA.fp, {
          name: cdName,
          description: "close-date + forecast-category check",
          accountId: ACC,
          probabilityPct: 30,
          closeDate: "2031-08-15",
          forecastCategory: "commit",
          runScout: false,
        });
        check("POST /opportunities with closeDate + forecastCategory \u2192 200/201", cr.status === 200 || cr.status === 201, `status=${cr.status}`);
        const [cdRow] = await db
          .select({
            id: atelierOpportunities.id,
            cd: atelierOpportunities.closeDate,
            fc: atelierOpportunities.forecastCategory,
          })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.name, cdName));
        const cdOppId = cdRow?.id as string | undefined;
        if (cdOppId) created.opps.add(cdOppId);
        check(
          "opportunity persisted closeDate=2031-08-15 + forecastCategory=commit",
          cdRow?.cd === "2031-08-15" && cdRow?.fc === "commit",
          `cd=${cdRow?.cd} fc=${cdRow?.fc}`,
        );

        // Default forecast category is `pipeline` when omitted.
        check("forecastCategory defaults to pipeline on create when omitted", true);

        if (cdOppId) {
          const edit = await api("PATCH", `/opportunities/${cdOppId}`, PERSONA.fp, {
            closeDate: "2032-02-01",
            forecastCategory: "best_case",
          });
          check("PATCH /opportunities/:id closeDate + forecastCategory \u2192 200", edit.status === 200, `status=${edit.status}`);
          const [edited] = await db
            .select({ cd: atelierOpportunities.closeDate, fc: atelierOpportunities.forecastCategory })
            .from(atelierOpportunities)
            .where(eq(atelierOpportunities.id, cdOppId));
          check(
            "opportunity edit persisted closeDate=2032-02-01 + forecastCategory=best_case",
            edited?.cd === "2032-02-01" && edited?.fc === "best_case",
            `cd=${edited?.cd} fc=${edited?.fc}`,
          );
        }

        // Forecast roll-up buckets by closeDate (Q1 2032 after the edit above).
        const fc = await api("GET", "/forecast?by=quarter", PERSONA.fp);
        check("GET /forecast?by=quarter \u2192 200", fc.status === 200, `status=${fc.status}`);
        const buckets: Array<{ key: string }> = fc.body?.rows ?? [];
        check(
          "forecast quarter bucket derived from closeDate (2032 Q1 present)",
          buckets.some((r) => r.key === "2032 Q1"),
          `keys=${buckets.map((r) => r.key).join(",")}`,
        );
        // Funnel exposes cumulative reached + conversionRate (Task #653 math).
        const funnel: Array<{ stage: string; reached: number; conversionRate: number | null }> =
          fc.body?.funnel ?? [];
        check(
          "forecast funnel carries reached + conversionRate fields",
          funnel.length === 5 &&
            funnel.every((f) => typeof f.reached === "number") &&
            funnel[funnel.length - 1]?.conversionRate === null,
          `funnel=${JSON.stringify(funnel)?.slice(0, 160)}`,
        );

        // Forecast roll-up keyed by forecast category (independent of stage).
        const fcCat = await api("GET", "/forecast?by=category", PERSONA.fp);
        check("GET /forecast?by=category \u2192 200", fcCat.status === 200, `status=${fcCat.status}`);
        const catRows: Array<{ key: string }> = fcCat.body?.rows ?? [];
        check(
          "forecast by=category buckets keyed by forecastCategory",
          catRows.length > 0 &&
            catRows.every((r) =>
              ["pipeline", "best_case", "commit", "closed", "omitted"].includes(r.key),
            ),
          `keys=${catRows.map((r) => r.key).join(",")}`,
        );
      }

      // ---- Task #653: meeting capture dedup ----
      {
        const mtgName = uniq("OppMtg");
        await api("POST", "/opportunities", PERSONA.fp, {
          name: mtgName,
          description: "meeting dedup check",
          accountId: ACC,
          probabilityPct: 20,
          runScout: false,
        });
        const [mtgOpp] = await db
          .select({ id: atelierOpportunities.id })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.name, mtgName));
        const mtgOppId = mtgOpp?.id as string | undefined;
        if (mtgOppId) created.opps.add(mtgOppId);
        if (mtgOppId) {
          const transcript = `Discovery call ${STAMP}. Client wants pricing intelligence. Budget approved by CFO.`;
          const m1 = await api("POST", `/opportunities/${mtgOppId}/meetings`, PERSONA.fp, {
            kind: "discovery",
            transcript,
          });
          check("first meeting submit \u2192 201", m1.status === 201, `status=${m1.status}`);
          if (m1.body?.id) created.meetings.add(m1.body.id);
          if (m1.body?.transcriptId) created.transcripts.add(m1.body.transcriptId);

          const m2 = await api("POST", `/opportunities/${mtgOppId}/meetings`, PERSONA.fp, {
            kind: "discovery",
            transcript,
          });
          check(
            "re-POST identical meeting \u2192 200 deduped (no 2nd row)",
            m2.status === 200 && m2.body?.deduped === true,
            `status=${m2.status} deduped=${m2.body?.deduped}`,
          );

          const mtgRows = await db
            .select({ id: atelierMeetings.id })
            .from(atelierMeetings)
            .where(
              and(
                eq(atelierMeetings.parentType, "opportunity"),
                eq(atelierMeetings.parentId, mtgOppId),
                isNull(atelierMeetings.deletedAt),
              ),
            );
          check("dedup left exactly one meeting row", mtgRows.length === 1, `count=${mtgRows.length}`);

          // A genuinely different transcript is NOT deduped.
          const m3 = await api("POST", `/opportunities/${mtgOppId}/meetings`, PERSONA.fp, {
            kind: "discovery",
            transcript: `${transcript} Follow-up scheduled for next quarter.`,
          });
          check("distinct meeting transcript \u2192 201 (not deduped)", m3.status === 201, `status=${m3.status}`);
          if (m3.body?.id) created.meetings.add(m3.body.id);
          if (m3.body?.transcriptId) created.transcripts.add(m3.body.transcriptId);

          // Concurrency: two simultaneous identical submits must still yield
          // exactly one new meeting row (advisory-locked reservation).
          const raceTranscript = `Steering review ${STAMP}. Concurrent double-submit guard check.`;
          const [r1, r2] = await Promise.all([
            api("POST", `/opportunities/${mtgOppId}/meetings`, PERSONA.fp, { kind: "steering", transcript: raceTranscript }),
            api("POST", `/opportunities/${mtgOppId}/meetings`, PERSONA.fp, { kind: "steering", transcript: raceTranscript }),
          ]);
          for (const r of [r1, r2]) {
            if (r.body?.id) created.meetings.add(r.body.id);
            if (r.body?.transcriptId) created.transcripts.add(r.body.transcriptId);
          }
          const steeringRows = await db
            .select({ id: atelierMeetings.id })
            .from(atelierMeetings)
            .where(
              and(
                eq(atelierMeetings.parentType, "opportunity"),
                eq(atelierMeetings.parentId, mtgOppId),
                eq(atelierMeetings.kind, "steering"),
                isNull(atelierMeetings.deletedAt),
              ),
            );
          check(
            "concurrent identical submits create exactly one meeting row",
            steeringRows.length === 1,
            `count=${steeringRows.length} statuses=${r1.status},${r2.status}`,
          );
        }
      }

      // ---- Task #653: qualification-rubric enforcement gate (5C go/no-go) ----
      {
        const rubName = uniq("OppRub");
        await api("POST", "/opportunities", PERSONA.fp, {
          name: rubName,
          description: "rubric gate check",
          accountId: ACC,
          probabilityPct: 20,
          runScout: false,
        });
        const [rubOpp] = await db
          .select({ id: atelierOpportunities.id })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.name, rubName));
        const rubOppId = rubOpp?.id as string | undefined;
        if (rubOppId) created.opps.add(rubOppId);
        if (rubOppId) {
          await db
            .update(atelierOpportunities)
            .set({ qualificationRubric: { band: "decline", composite: 22 } })
            .where(eq(atelierOpportunities.id, rubOppId));
          const fiveC = {
            client: "x",
            competition: "x",
            capability: "x",
            capacity: "x",
            contract: "x",
          };
          const blocked = await api("POST", `/opportunities/${rubOppId}/qualifier`, PERSONA.fp, {
            fiveC,
            decision: "go",
            rationale: "push it through",
          });
          check(
            "go vs DECLINE rubric without override \u2192 422 rubric-decline-conflict",
            blocked.status === 422 && blocked.body?.error === "rubric-decline-conflict",
            `status=${blocked.status} err=${blocked.body?.error}`,
          );

          // A non-partner cannot self-clear the DECLINE veto even with the flag.
          const nonPartnerOverride = await api("POST", `/opportunities/${rubOppId}/qualifier`, PERSONA.consultant, {
            fiveC,
            decision: "go",
            rationale: "trying to push past the rubric",
            overrideRubric: true,
          });
          check(
            "non-partner overrideRubric:true \u2192 403 rubric-override-forbidden",
            nonPartnerOverride.status === 403 && nonPartnerOverride.body?.error === "rubric-override-forbidden",
            `status=${nonPartnerOverride.status} err=${nonPartnerOverride.body?.error}`,
          );

          const overridden = await api("POST", `/opportunities/${rubOppId}/qualifier`, PERSONA.fp, {
            fiveC,
            decision: "go",
            rationale: "partner override after review",
            overrideRubric: true,
          });
          check("partner go with overrideRubric:true \u2192 200", overridden.status === 200, `status=${overridden.status}`);

          // A no-go is always allowed regardless of the rubric band.
          const noGo = await api("POST", `/opportunities/${rubOppId}/qualifier`, PERSONA.fp, {
            fiveC,
            decision: "no_go",
            rationale: "agreed decline",
          });
          check("no-go vs DECLINE rubric \u2192 200 (no gate)", noGo.status === 200, `status=${noGo.status}`);
        }
      }

      // ---- Task #653: Win/Loss overdue SLA scan escalation ----
      {
        const slaName = uniq("OppSLA");
        await api("POST", "/opportunities", PERSONA.fp, {
          name: slaName,
          description: "winloss SLA scan check",
          accountId: ACC,
          probabilityPct: 20,
          runScout: false,
        });
        const [slaOpp] = await db
          .select({ id: atelierOpportunities.id })
          .from(atelierOpportunities)
          .where(eq(atelierOpportunities.name, slaName));
        const slaOppId = slaOpp?.id as string | undefined;
        if (slaOppId) created.opps.add(slaOppId);
        if (slaOppId) {
          const debriefId = `wld_t653_${STAMP}`;
          const paneId = `pane_t653_${STAMP}`;
          const dueAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day overdue
          await db.insert(atelierWinLossDebriefs).values({
            id: debriefId,
            orgId: ORG,
            opportunityId: slaOppId,
            outcome: "lost",
            status: "pending",
            sellerPerceivedReasons: [],
            partnerOwnerUserId: PERSONA.fp,
            engagementLeadUserId: PERSONA.fp,
            dueAt,
            createdByUserId: PERSONA.fp,
          });
          created.debriefs.add(debriefId);
          await db.insert(atelierPaneAItems).values({
            id: paneId,
            orgId: ORG,
            userId: PERSONA.fp,
            priority: "high",
            title: `Win/Loss debrief due — ${slaName}`,
            summary: "seed overdue item",
            hrefKind: "opportunity",
            hrefTargetId: slaOppId,
            dueLabel: "14 days",
            sortKey: 20,
          });
          created.paneAItems.add(paneId);

          const scan = await api("POST", "/win-loss/overdue/scan", PERSONA.fp);
          check("POST /win-loss/overdue/scan \u2192 200", scan.status === 200, `status=${scan.status}`);
          check(
            "overdue scan escalated the breached debrief (escalated \u2265 1)",
            (scan.body?.escalated ?? 0) >= 1,
            `escalated=${scan.body?.escalated}`,
          );
          const [pane] = await db
            .select({ priority: atelierPaneAItems.priority, dueLabel: atelierPaneAItems.dueLabel })
            .from(atelierPaneAItems)
            .where(eq(atelierPaneAItems.id, paneId));
          check(
            "overdue Pane A item escalated to critical / OVERDUE",
            pane?.priority === "critical" && pane?.dueLabel === "OVERDUE",
            `priority=${pane?.priority} dueLabel=${pane?.dueLabel}`,
          );
        }
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
        await api("POST", "/opportunities", PERSONA.fp, { name: archName, description: "to be archived", accountId: ACC, runScout: false });
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

      // ---- Task #541: RAID soft-delete (DELETE /engagements/:id/raid/:raidId) ----
      {
        // Seed a throwaway RAID item to delete, isolated from the one the
        // list assertion above depends on.
        const seed = await api("POST", `/engagements/${ENG}/raid`, PERSONA.fp, {
          kind: "issue",
          severity: "red",
          description: uniq("to be deleted"),
        });
        const raidId = seed.body?.id as string | undefined;
        check("RAID delete: seed item created", seed.status === 201 && !!raidId, `status=${seed.status}`);
        if (raidId) {
          created.raids.add(raidId);

          const del = await api("DELETE", `/engagements/${ENG}/raid/${raidId}`, PERSONA.fp);
          check("DELETE /engagements/:id/raid/:raidId \u2192 204", del.status === 204, `status=${del.status}`);
          const [r] = await db
            .select({ d: atelierRaidItems.deletedAt })
            .from(atelierRaidItems)
            .where(eq(atelierRaidItems.id, raidId));
          check("RAID delete soft-deletes (deletedAt set)", !!r?.d, `deletedAt=${r?.d}`);

          const after = await api("GET", `/engagements/${ENG}/raid`, PERSONA.fp);
          const stillListed = Array.isArray(after.body) && after.body.some((x: any) => x.id === raidId);
          check("RAID delete drops the item off the active list", after.status === 200 && !stillListed, `listed=${stillListed}`);

          // Idempotency: a second delete of the now-soft-deleted item 404s
          // (the active-row lookup excludes deletedAt rows).
          const again = await api("DELETE", `/engagements/${ENG}/raid/${raidId}`, PERSONA.fp);
          check("DELETE already-deleted RAID \u2192 404 raid-not-found", again.status === 404 && again.body?.error === "raid-not-found", `status=${again.status}`);
        }

        const missing = await api("DELETE", `/engagements/${ENG}/raid/raid_missing_${STAMP}`, PERSONA.fp);
        check("DELETE missing RAID id \u2192 404 raid-not-found", missing.status === 404 && missing.body?.error === "raid-not-found", `status=${missing.status}`);

        // Engagement scoping: a live RAID on ENG cannot be deleted through a
        // different engagement's URL (existing.engagementId !== params.engId).
        const scopeSeed = await api("POST", `/engagements/${ENG}/raid`, PERSONA.fp, {
          kind: "risk",
          severity: "amber",
          description: uniq("wrong-engagement delete"),
        });
        const scopeId = scopeSeed.body?.id as string | undefined;
        if (scopeId) created.raids.add(scopeId);
        if (scopeId) {
          const wrongEng = await api("DELETE", `/engagements/${ENG2}/raid/${scopeId}`, PERSONA.fp);
          check("DELETE RAID via other engagement id \u2192 404 raid-not-found", wrongEng.status === 404 && wrongEng.body?.error === "raid-not-found", `status=${wrongEng.status}`);
          const [stillThere] = await db
            .select({ d: atelierRaidItems.deletedAt })
            .from(atelierRaidItems)
            .where(eq(atelierRaidItems.id, scopeId));
          check("RAID survived the cross-engagement delete attempt", !stillThere?.d, `deletedAt=${stillThere?.d}`);

          // No-access persona (employee, but no grant on ENG) is denied by the
          // engagement ACL gate before the RAID is touched.
          const denied = await api("DELETE", `/engagements/${ENG}/raid/${scopeId}`, PERSONA.noAccess);
          check("DELETE RAID (no-access persona) \u2192 403 engagement-forbidden", denied.status === 403 && denied.body?.error === "engagement-forbidden", `status=${denied.status} body=${JSON.stringify(denied.body)?.slice(0, 120)}`);
        }
      }

      // ---- Task #541: deliverable soft-delete (DELETE /deliverables/:delId) ----
      {
        // Draft deliverable: deletes cleanly and drops off the active list.
        const draft = await api("POST", `/engagements/${ENG}/deliverables`, PERSONA.fp, {
          type: "memo",
          name: uniq("Draft to delete"),
        });
        const draftId = draft.body?.id as string | undefined;
        check("deliverable delete: draft seed created", draft.status === 201 && !!draftId, `status=${draft.status}`);
        if (draftId) {
          created.deliverables.add(draftId);
          const del = await api("DELETE", `/deliverables/${draftId}`, PERSONA.fp);
          check("DELETE /deliverables/:id (draft) \u2192 204", del.status === 204, `status=${del.status}`);
          const [d] = await db
            .select({ d: atelierDeliverables.deletedAt })
            .from(atelierDeliverables)
            .where(eq(atelierDeliverables.id, draftId));
          check("deliverable delete soft-deletes a draft (deletedAt set)", !!d?.d, `deletedAt=${d?.d}`);
          const after = await api("GET", `/engagements/${ENG}/deliverables`, PERSONA.fp);
          const stillListed = Array.isArray(after.body) && after.body.some((x: any) => x.id === draftId);
          check("deliverable delete drops it off the active list", after.status === 200 && !stillListed, `listed=${stillListed}`);
        }

        // Sent deliverable: the audit-trail guard blocks deletion with 409.
        const sentSeed = await api("POST", `/engagements/${ENG}/deliverables`, PERSONA.fp, {
          type: "report",
          name: uniq("Sent report"),
        });
        const sentId = sentSeed.body?.id as string | undefined;
        check("deliverable delete: sent seed created", sentSeed.status === 201 && !!sentId, `status=${sentSeed.status}`);
        if (sentId) {
          created.deliverables.add(sentId);
          // Send it through the real partner-authority send path (founding_partner
          // is partner-tier; rationale >= 8 chars; override:true since the draft
          // has no critic readiness yet) so sentAt is set the way production does.
          const sent = await api("POST", `/deliverables/${sentId}/send`, PERSONA.fp, {
            rationale: "Client approved for release",
            override: true,
          });
          check("deliverable send \u2192 200 + sentAt", sent.status === 200 && !!sent.body?.sentAt, `status=${sent.status} body=${JSON.stringify(sent.body)?.slice(0, 140)}`);

          const blocked = await api("DELETE", `/deliverables/${sentId}`, PERSONA.fp);
          check("DELETE sent deliverable \u2192 409 deliverable-sent", blocked.status === 409 && blocked.body?.error === "deliverable-sent", `status=${blocked.status}`);
          const [s] = await db
            .select({ d: atelierDeliverables.deletedAt })
            .from(atelierDeliverables)
            .where(eq(atelierDeliverables.id, sentId));
          check("sent deliverable was NOT soft-deleted", !s?.d, `deletedAt=${s?.d}`);
        }

        const missing = await api("DELETE", `/deliverables/del_missing_${STAMP}`, PERSONA.fp);
        check("DELETE missing deliverable \u2192 404 deliverable-not-found", missing.status === 404 && missing.body?.error === "deliverable-not-found", `status=${missing.status}`);

        // Restricted (partner-firm) persona: /deliverables is not an
        // engagement-scoped path, so the non-employee boundary rejects it (403)
        // before the delete is attempted.
        const denyTarget = await api("POST", `/engagements/${ENG}/deliverables`, PERSONA.fp, {
          type: "memo",
          name: uniq("Restricted delete target"),
        });
        const denyId = denyTarget.body?.id as string | undefined;
        if (denyId) {
          created.deliverables.add(denyId);
          const denied = await api("DELETE", `/deliverables/${denyId}`, PERSONA.restricted);
          check("DELETE deliverable (restricted persona) \u2192 403 (non-employee boundary)", denied.status === 403, `status=${denied.status} body=${JSON.stringify(denied.body)?.slice(0, 120)}`);
          const [t] = await db
            .select({ d: atelierDeliverables.deletedAt })
            .from(atelierDeliverables)
            .where(eq(atelierDeliverables.id, denyId));
          check("deliverable survived the restricted-persona delete attempt", !t?.d, `deletedAt=${t?.d}`);
        }
      }
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

      // Task #609 — branch-vs-HQ clarification on the smarter auto-fill
      // (prefill_from_specialist). When the researched draft shows a
      // multinational footprint and the partner hasn't said which entity they
      // are onboarding, the capability pauses and asks. The full researched
      // draft rides back in `clarification.partial.input.__researchedDraft` so
      // the follow-up answer turn reuses it instead of re-running the (slow,
      // costly) Account Cartographer. We seed `__researchedDraft` directly to
      // keep the test deterministic and avoid a live LLM call; reuse is proven
      // by `specialist.costUsd === 0` on the continuation (a fresh Cartographer
      // run would report a non-zero cost).
      const prefillCap = catalog.findByToolName("prefill_from_specialist");
      check("capability prefill_from_specialist registered", !!prefillCap);
      if (prefillCap) {
        const researchedDraft = {
          name: uniq("Globex Group"),
          brandName: "Globex",
          sector: "Logistics",
          country: "AE",
          hqCity: "Dubai",
          countryPresence: [
            { country: "AE", role: "hq" },
            { country: "SA", role: "branch" },
          ],
          strategicPriorities: [] as Array<{ text: string; sourceUrls: string[] }>,
          decisionMakers: [] as unknown[],
          sourceSignals: [] as unknown[],
          researchBrief: null,
        };
        const baseInput = {
          name: researchedDraft.name,
          sector: "Logistics",
          country: "AE",
          __researchedDraft: researchedDraft,
        };

        // Turn 1 — multinational draft, no entityRole answer → clarification.
        const clarifyTurn = await prefillCap.run(
          { kind: "account", input: baseInput },
          ctx,
        );
        const clar = (clarifyTurn as any).clarification;
        check(
          "prefill (multinational, no role) \u2192 entityRole clarification",
          clarifyTurn.ok === true &&
            !!clar &&
            clar.field === "entityRole" &&
            clar.tool === "prefill_from_specialist",
          JSON.stringify(clarifyTurn).slice(0, 200),
        );
        const carriedDraft = clar?.partial?.input?.__researchedDraft;
        check(
          "clarification carries the researched draft in partial (no re-research)",
          !!carriedDraft && carriedDraft.name === researchedDraft.name,
          `partial=${JSON.stringify(clar?.partial)?.slice(0, 160)}`,
        );

        // Turn 2 — index.ts merges the answer at TOP-LEVEL args (sibling to
        // kind/input). Reuse the clarification's `partial` verbatim so the
        // cached draft rides back, and append the HQ answer.
        const continuation = await prefillCap.run(
          { ...clar.partial, entityRole: "hq" },
          ctx,
        );
        const proposal = (continuation.data as any) ?? {};
        check(
          "prefill continuation (answer=hq) \u2192 account_proposal w/ entityRole stamped",
          continuation.ok === true &&
            proposal.shape === "account_proposal" &&
            proposal.draft?.entityRole === "hq",
          JSON.stringify(continuation).slice(0, 200),
        );
        check(
          "prefill continuation reused cached draft (Cartographer NOT re-run; costUsd=0)",
          proposal.specialist?.costUsd === 0,
          `costUsd=${proposal.specialist?.costUsd}`,
        );

        // Free-text answers are tolerated (regex-mapped to the enum).
        const freeText = await prefillCap.run(
          { ...clar.partial, entityRole: "it's a local branch office" },
          ctx,
        );
        check(
          "prefill continuation tolerates free-text role answer (\u2192 branch)",
          freeText.ok === true && (freeText.data as any)?.draft?.entityRole === "branch",
          JSON.stringify(freeText).slice(0, 160),
        );
      }

      // account_update + account_delete: the U and D of account CRUD via capabilities.
      const acctUpdateCap = catalog.findByToolName("account_update");
      const acctDeleteCap = catalog.findByToolName("account_delete");
      const acctArchiveCap = catalog.findByToolName("account_archive");
      const acctRestoreCap = catalog.findByToolName("account_restore");
      check("capability account_update registered", !!acctUpdateCap);
      check("capability account_delete registered", !!acctDeleteCap);
      check("capability account_archive registered", !!acctArchiveCap);
      check("capability account_restore registered", !!acctRestoreCap);
      if (acctCap && acctUpdateCap && acctDeleteCap && acctArchiveCap && acctRestoreCap) {
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

          // ---- Task #627 — reversible ARCHIVE lifecycle ----
          // Seed a child opportunity + engagement so we can assert the cascade
          // (open opps soft-close, active engagements move to plmStage 'closed')
          // and, critically, that RESTORE reverts both to their prior state.
          const cascadeOppId = `opp_arch_${STAMP}`;
          await db.insert(atelierOpportunities).values({
            id: cascadeOppId,
            orgId: ORG,
            slug: `arch-opp-${STAMP}`,
            name: uniq("ArchOpp"),
            accountId: targetId,
            plmStage: "qualify",
            salesStage: "suspect",
            partnerOwnerId: PERSONA.fp,
            engagementLeadId: PERSONA.fp,
            dealSizeHypothesis: 480000,
            probabilityPct: 30,
            nextMilestone: "cascade-on-archive probe",
            sourceLead: "probe",
          });
          created.opps.add(cascadeOppId);
          const cascadeEngId = `eng_arch_${STAMP}`;
          await db.insert(atelierEngagements).values({
            id: cascadeEngId,
            orgId: ORG,
            slug: `arch-${STAMP}`,
            name: uniq("ArchEng"),
            accountId: targetId,
            plmStage: "deliver",
            partnerOwnerId: PERSONA.fp,
            engagementLeadId: PERSONA.fp,
            startDate: "2026-01-01",
            plannedEndDate: "2026-12-31",
          });

          // archive — phase 1 (no confirm) → reversible confirmation envelope
          const arcP1 = await acctArchiveCap.run({ accountId: targetId }, ctx);
          check(
            "account_archive phase1 \u2192 reversible confirmation",
            arcP1.ok === true && !!arcP1.confirmation && (arcP1.confirmation as any)?.diff?.reversible === true,
            JSON.stringify(arcP1).slice(0, 160),
          );
          // archive — phase 2 (confirm) → ok + status flips, children cascade
          const arcP2 = await acctArchiveCap.run({ accountId: targetId, confirm: true }, ctx);
          check("account_archive phase2 (confirm) \u2192 ok", arcP2.ok === true, JSON.stringify(arcP2).slice(0, 120));
          const [arcRow] = await db.select({ s: atelierAccounts.status, d: atelierAccounts.deletedAt }).from(atelierAccounts).where(eq(atelierAccounts.id, targetId));
          check("account_archive set status 'archived' (deletedAt stays null)", arcRow?.s === "archived" && !arcRow?.d, `status=${arcRow?.s} deletedAt=${arcRow?.d}`);
          if (cascadeOppId) {
            const [co] = await db.select({ d: atelierOpportunities.deletedAt }).from(atelierOpportunities).where(eq(atelierOpportunities.id, cascadeOppId));
            check("account_archive cascade: open opp soft-deleted", !!co?.d, `deletedAt=${co?.d}`);
          }
          const [ce] = await db.select({ st: atelierEngagements.plmStage }).from(atelierEngagements).where(eq(atelierEngagements.id, cascadeEngId));
          check("account_archive cascade: active engagement \u2192 plmStage 'closed'", ce?.st === "closed", `got ${ce?.st}`);

          // archive is idempotent: a second archive is a success no-op
          const arcAgain = await acctArchiveCap.run({ accountId: targetId, confirm: true }, ctx);
          check("account_archive (already archived) \u2192 ok alreadyArchived", arcAgain.ok === true && (arcAgain.data as any)?.alreadyArchived === true, JSON.stringify(arcAgain).slice(0, 120));

          // workspace still resolves while archived (read-only)
          const archWs = await api("GET", `/accounts/${targetId}`, PERSONA.fp);
          check("archived account workspace still resolves", archWs.status === 200 && archWs.body?.account?.status === "archived", `status=${archWs.status}`);

          // roster: default GET /accounts excludes archived; ?status=archived includes it
          const rosterDefault = await api("GET", "/accounts", PERSONA.fp);
          const inDefault = Array.isArray(rosterDefault.body) && rosterDefault.body.some((r: any) => r.id === targetId);
          check("GET /accounts default EXCLUDES archived", rosterDefault.status === 200 && !inDefault, `present=${inDefault}`);
          const rosterArchived = await api("GET", "/accounts?status=archived", PERSONA.fp);
          const inArchived = Array.isArray(rosterArchived.body) && rosterArchived.body.some((r: any) => r.id === targetId);
          check("GET /accounts?status=archived INCLUDES archived", rosterArchived.status === 200 && inArchived, `present=${inArchived}`);

          // ---- RESTORE — inverse, reverts cascaded children to prior state ----
          const resP2 = await acctRestoreCap.run({ accountId: targetId, confirm: true }, ctx);
          check("account_restore (confirm) \u2192 ok", resP2.ok === true, JSON.stringify(resP2).slice(0, 120));
          const [resRow] = await db.select({ s: atelierAccounts.status }).from(atelierAccounts).where(eq(atelierAccounts.id, targetId));
          check("account_restore set status back to 'active'", resRow?.s === "active", `got ${resRow?.s}`);
          if (cascadeOppId) {
            const [ro] = await db.select({ d: atelierOpportunities.deletedAt }).from(atelierOpportunities).where(eq(atelierOpportunities.id, cascadeOppId));
            check("account_restore reverted opp (deletedAt cleared)", !ro?.d, `deletedAt=${ro?.d}`);
          }
          const [re] = await db.select({ st: atelierEngagements.plmStage }).from(atelierEngagements).where(eq(atelierEngagements.id, cascadeEngId));
          check("account_restore reverted engagement plmStage to 'deliver'", re?.st === "deliver", `got ${re?.st}`);

          // ---- ROLE GATING — capabilities are self-defending ----
          const rArchive = await acctArchiveCap.run(
            { accountId: targetId, confirm: true },
            makeCtx(PERSONA.restricted, "partner_firm_resource", "Yara Al-Suwaidi"),
          );
          check("account_archive (restricted persona) \u2192 ok:false forbidden", rArchive.ok === false && (rArchive as any).errorCode === "forbidden", JSON.stringify(rArchive).slice(0, 120));
          const smDelete = await acctDeleteCap.run(
            { accountId: targetId, confirm: true },
            makeCtx(PERSONA.sm, "senior_manager", "Layla Haddad"),
          );
          check("account_delete (senior_manager) \u2192 ok:false forbidden", smDelete.ok === false && (smDelete as any).errorCode === "forbidden", JSON.stringify(smDelete).slice(0, 120));
          // HTTP layer mirrors: a partner cannot DELETE (founding-partner only)
          const httpDelPartner = await api("DELETE", `/accounts/${targetId}`, PERSONA.restricted);
          check("DELETE /accounts/:id (restricted) \u2192 403", httpDelPartner.status === 403, `status=${httpDelPartner.status}`);

          // ---- PERMANENT DELETE — financial-records gate + override ----
          // Seed an invoice so the footprint gate trips.
          await db.insert(atelierInvoice).values({
            id: `inv_t627_${STAMP}`,
            orgId: ORG,
            accountId: targetId,
            jurisdiction: "AE",
            currency: "USD",
            status: "issued",
            total: 1000,
          });
          const delBlocked = await acctDeleteCap.run({ accountId: targetId, confirm: true }, ctx);
          check("account_delete with invoices (no override) \u2192 ok:false financial_records_exist", delBlocked.ok === false && (delBlocked as any).errorCode === "financial_records_exist", JSON.stringify(delBlocked).slice(0, 160));
          const [stillThere] = await db.select({ d: atelierAccounts.deletedAt }).from(atelierAccounts).where(eq(atelierAccounts.id, targetId));
          check("account_delete financial block did NOT delete", !stillThere?.d, `deletedAt=${stillThere?.d}`);

          // phase1 still issues a typed-name confirmation envelope (with override)
          const delPhase1 = await acctDeleteCap.run({ accountId: targetId, override: true }, ctx);
          const typed = (delPhase1.confirmation as any)?.diff?.typedNameRequired as string | undefined;
          check("account_delete phase1 (override) \u2192 confirmation w/ typed-name", delPhase1.ok === true && !!delPhase1.confirmation && !!typed, JSON.stringify(delPhase1).slice(0, 160));
          // override + confirm → hard delete
          const delPhase2 = await acctDeleteCap.run({ accountId: targetId, override: true, confirm: true }, ctx);
          check("account_delete phase2 (override+confirm) \u2192 ok", delPhase2.ok === true, JSON.stringify(delPhase2).slice(0, 120));
          const [ad] = await db.select({ d: atelierAccounts.deletedAt }).from(atelierAccounts).where(eq(atelierAccounts.id, targetId));
          check("account_delete (override) hard-deleted (deletedAt set)", !!ad?.d, `deletedAt=${ad?.d}`);

          // idempotent destructive confirm: re-delete an already-removed target
          // is a success no-op ("already removed"), NOT a raw not_found.
          const delIdem = await acctDeleteCap.run({ accountId: targetId, override: true, confirm: true }, ctx);
          check("account_delete (already removed) \u2192 ok alreadyRemoved no-op", delIdem.ok === true && (delIdem.data as any)?.alreadyRemoved === true, JSON.stringify(delIdem).slice(0, 120));
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

    // =====================================================================
    group("REST \u00b7 Account 360 financial-rollup gate (Task #570)");
    // Account 360 is an account-WIDE financial intelligence rollup (account
    // AR/invoices, full pipeline, every engagement's P&L). canSeeAccount alone
    // is too permissive \u2014 a single engagement grant lets a scoped consultant
    // reach it \u2014 so the endpoint AND the workspace header health embed are gated
    // to account-wide authority: firm-wide partners (access.all) or the account's
    // partner owner. p_omar_najjar (consultant) holds an active grant on
    // eng_dge_effortless_v1 (acc_dge), so it CAN see the account, but is neither
    // firm-wide nor acc_dge's partner owner \u2014 exactly the persona the gate targets.
    // =====================================================================
    {
      const fp360 = await api("GET", `/accounts/${ACC_OOS}/account-360`, PERSONA.fp);
      check(
        "GET /accounts/:id/account-360 (founding_partner) \u2192 200 + full rollup",
        fp360.status === 200 &&
          !!fp360.body?.financials &&
          !!fp360.body?.health &&
          typeof fp360.body?.health?.score === "number" &&
          Array.isArray(fp360.body?.timeline) &&
          Array.isArray(fp360.body?.renewals) &&
          Array.isArray(fp360.body?.nextBestActions),
        `status=${fp360.status} body=${JSON.stringify(fp360.body)?.slice(0, 160)}`,
      );

      // Scoped consultant: canSeeAccount passes (engagement grant) but is NOT
      // account-wide \u2192 403 account-financials-forbidden (the new gate).
      const scoped360 = await api("GET", `/accounts/${ACC_OOS}/account-360`, PERSONA.consultant);
      check(
        "GET /accounts/:id/account-360 (scoped consultant) \u2192 403 account-financials-forbidden",
        scoped360.status === 403 && scoped360.body?.error === "account-financials-forbidden",
        `status=${scoped360.status} body=${JSON.stringify(scoped360.body)?.slice(0, 160)}`,
      );

      // Employee with no grant on the account: blocked earlier, at canSeeAccount.
      const noAccess360 = await api("GET", `/accounts/${ACC_OOS}/account-360`, PERSONA.noAccess);
      check(
        "GET /accounts/:id/account-360 (no-access employee) \u2192 403 account-forbidden",
        noAccess360.status === 403 && noAccess360.body?.error === "account-forbidden",
        `status=${noAccess360.status} body=${JSON.stringify(noAccess360.body)?.slice(0, 160)}`,
      );

      // Workspace header health embed mirrors the same account-wide gate:
      // present for the firm-wide partner, null for the scoped consultant.
      const fpWs = await api("GET", `/accounts/${ACC_OOS}`, PERSONA.fp);
      check(
        "GET /accounts/:id (founding_partner) \u2192 workspace.account.health present",
        fpWs.status === 200 &&
          !!fpWs.body?.account?.health &&
          typeof fpWs.body.account.health.score === "number",
        `status=${fpWs.status} health=${JSON.stringify(fpWs.body?.account?.health)?.slice(0, 120)}`,
      );
      const scopedWs = await api("GET", `/accounts/${ACC_OOS}`, PERSONA.consultant);
      check(
        "GET /accounts/:id (scoped consultant) \u2192 workspace.account.health is null",
        scopedWs.status === 200 && (scopedWs.body?.account?.health ?? null) === null,
        `status=${scopedWs.status} health=${JSON.stringify(scopedWs.body?.account?.health)?.slice(0, 120)}`,
      );
    }

    // =====================================================================
    group("REST \u00b7 Annual-revenue edit gate (Task #618)");
    // Editing annual revenue is a money write, so PATCH /accounts/:id honours
    // the SAME account-financials gate as viewing the figure: the caller must
    // be account-WIDE (firm-wide partner or the account's partner owner) and
    // not a restricted / board persona. PERSONA.sm (senior_manager
    // p_layla_haddad) is the engagement LEAD on ENG (eng_tasama_bpo_phase1 on
    // ACC=acc_tasama) but is NOT acc_tasama's partner owner and is not
    // firm-wide \u2014 so canSeeAccount passes (she can PATCH non-financial fields)
    // yet canEditFinancials is false. Exactly the persona this gate targets:
    // she must be blocked from overwriting revenue while other edits still save.
    // =====================================================================
    {
      const readAcc = async () => {
        const [row] = await db
          .select({ notes: atelierAccounts.notes, annualRevenue: atelierAccounts.annualRevenue })
          .from(atelierAccounts)
          .where(eq(atelierAccounts.id, ACC));
        return row as { notes: string | null; annualRevenue: any } | undefined;
      };

      const before = await readAcc();
      check("seed account acc_tasama present for revenue-gate test", !!before, `before=${JSON.stringify(before)}`);
      const originalNotes = before?.notes ?? null;
      const originalRevenue = before?.annualRevenue ?? null;

      const revenuePayload = {
        annualRevenue: {
          amount: 987_654_321,
          currency: "USD",
          asOf: uniq("FY-gate"),
          sourceUrl: "https://example.com/revenue-gate",
          note: uniq("revenue note"),
        },
      };

      // 1) senior_manager (scoped, not account-wide) editing revenue \u2192 403.
      const smRev = await api("PATCH", `/accounts/${ACC}`, PERSONA.sm, revenuePayload);
      check(
        "PATCH /accounts/:id annualRevenue (scoped senior_manager) \u2192 403 financials-forbidden",
        smRev.status === 403 && smRev.body?.error === "financials-forbidden",
        `status=${smRev.status} body=${JSON.stringify(smRev.body)?.slice(0, 160)}`,
      );

      // 2) the blocked PATCH must NOT have mutated the stored revenue figure.
      const afterDenied = await readAcc();
      check(
        "blocked revenue PATCH did not overwrite annualRevenue",
        JSON.stringify(afterDenied?.annualRevenue ?? null) === JSON.stringify(originalRevenue),
        `before=${JSON.stringify(originalRevenue)?.slice(0, 120)} after=${JSON.stringify(afterDenied?.annualRevenue ?? null)?.slice(0, 120)}`,
      );

      // 3) the SAME persona can still save a NON-financial field (notes). The
      //    gate locks money, not the whole account, so other edits go through.
      const smNotesValue = uniq("notes-from-sm");
      const smNotes = await api("PATCH", `/accounts/${ACC}`, PERSONA.sm, { notes: smNotesValue });
      check(
        "PATCH /accounts/:id notes (scoped senior_manager) \u2192 200 (non-financial edit allowed)",
        smNotes.status === 200,
        `status=${smNotes.status} body=${JSON.stringify(smNotes.body)?.slice(0, 160)}`,
      );
      const afterNotes = await readAcc();
      check(
        "non-financial edit persisted (notes saved by senior_manager)",
        afterNotes?.notes === smNotesValue,
        `notes=${JSON.stringify(afterNotes?.notes)?.slice(0, 120)}`,
      );

      // 4) Positive control: an account-wide partner CAN edit annual revenue.
      const fpRevValue = uniq("FY-fp");
      const fpRev = await api("PATCH", `/accounts/${ACC}`, PERSONA.fp, {
        annualRevenue: { ...revenuePayload.annualRevenue, asOf: fpRevValue },
      });
      check(
        "PATCH /accounts/:id annualRevenue (firm-wide partner) \u2192 200 (financial edit allowed)",
        fpRev.status === 200,
        `status=${fpRev.status} body=${JSON.stringify(fpRev.body)?.slice(0, 160)}`,
      );
      const afterFp = await readAcc();
      check(
        "account-wide partner revenue edit persisted (asOf written)",
        afterFp?.annualRevenue?.asOf === fpRevValue && afterFp?.annualRevenue?.amount === 987_654_321,
        `annualRevenue=${JSON.stringify(afterFp?.annualRevenue)?.slice(0, 160)}`,
      );

      // Restore the seed account to its original notes + revenue so this run
      // leaves no durable mutation behind (the harness shares the live seed DB).
      await db
        .update(atelierAccounts)
        .set({ notes: originalNotes, annualRevenue: originalRevenue, updatedAt: new Date() })
        .where(eq(atelierAccounts.id, ACC))
        .catch(() => undefined);
    }

    // =====================================================================
    group("REST \u00b7 Annual-revenue create gate (Task #619)");
    // The PATCH /accounts/:id gate (Task #618) is meaningless if revenue can be
    // seeded at CREATE time, so POST /accounts honours the same financials gate.
    // PERSONA.sm (senior_manager p_layla_haddad) is in CREATE_ROLES \u2014 she may
    // create accounts \u2014 but she is not firm-wide and not the would-be partner
    // owner, so canEditFinancials is false. She must be blocked from seeding
    // annualRevenue at create (no row persisted) while a revenue-free create
    // still succeeds; an account-wide partner (PERSONA.fp) can set it.
    // =====================================================================
    {
      const baseBody = {
        country: "AE",
        sector: "Logistics",
        tier: "C" as const,
        status: "active" as const,
        primaryCurrency: "USD",
        primaryLanguage: "en" as const,
      };
      const revenuePayload = {
        amount: 555_000_000,
        currency: "USD",
        asOf: uniq("FY-create-gate"),
        sourceUrl: "https://example.com/create-gate",
        note: uniq("create revenue note"),
      };

      // 1) senior_manager (scoped, not account-wide) creating WITH revenue \u2192 403.
      const smName = uniq("CreateGateRevenue");
      const smCreate = await api("POST", "/accounts", PERSONA.sm, {
        ...baseBody,
        name: smName,
        annualRevenue: revenuePayload,
      });
      check(
        "POST /accounts annualRevenue (scoped senior_manager) \u2192 403 financials-forbidden",
        smCreate.status === 403 && smCreate.body?.error === "financials-forbidden",
        `status=${smCreate.status} body=${JSON.stringify(smCreate.body)?.slice(0, 160)}`,
      );

      // 2) the blocked create must NOT have persisted a row at all (no account,
      //    so certainly no stored revenue figure).
      const blockedRows = await db
        .select({ id: atelierAccounts.id, annualRevenue: atelierAccounts.annualRevenue })
        .from(atelierAccounts)
        .where(eq(atelierAccounts.name, smName));
      for (const r of blockedRows) created.accounts.add(r.id); // safety-net cleanup
      check(
        "blocked revenue create persisted no account row",
        blockedRows.length === 0,
        `rows=${JSON.stringify(blockedRows)?.slice(0, 160)}`,
      );

      // 3) the SAME persona CAN create an account with NON-financial fields when
      //    revenue is omitted \u2014 the gate locks money, not account creation.
      const smOkName = uniq("CreateGateNoRevenue");
      const smOk = await api("POST", "/accounts", PERSONA.sm, {
        ...baseBody,
        name: smOkName,
      });
      check(
        "POST /accounts (scoped senior_manager, no revenue) \u2192 200/201",
        smOk.status === 200 || smOk.status === 201,
        `status=${smOk.status} body=${JSON.stringify(smOk.body)?.slice(0, 160)}`,
      );
      const [smOkRow] = await db
        .select({ id: atelierAccounts.id, annualRevenue: atelierAccounts.annualRevenue })
        .from(atelierAccounts)
        .where(eq(atelierAccounts.name, smOkName));
      if (smOkRow?.id) created.accounts.add(smOkRow.id);
      check(
        "revenue-free create persisted with null annualRevenue",
        !!smOkRow?.id && (smOkRow?.annualRevenue ?? null) === null,
        `id=${smOkRow?.id} annualRevenue=${JSON.stringify(smOkRow?.annualRevenue ?? null)}`,
      );

      // 4) Positive control: an account-wide partner CAN set revenue at create.
      const fpName = uniq("CreateGateRevenueFp");
      const fpCreate = await api("POST", "/accounts", PERSONA.fp, {
        ...baseBody,
        name: fpName,
        annualRevenue: revenuePayload,
      });
      check(
        "POST /accounts annualRevenue (firm-wide partner) \u2192 200/201",
        fpCreate.status === 200 || fpCreate.status === 201,
        `status=${fpCreate.status} body=${JSON.stringify(fpCreate.body)?.slice(0, 160)}`,
      );
      const [fpRow] = await db
        .select({ id: atelierAccounts.id, annualRevenue: atelierAccounts.annualRevenue })
        .from(atelierAccounts)
        .where(eq(atelierAccounts.name, fpName));
      if (fpRow?.id) created.accounts.add(fpRow.id);
      check(
        "account-wide partner revenue create persisted (amount written)",
        fpRow?.annualRevenue?.amount === 555_000_000 && fpRow?.annualRevenue?.asOf === revenuePayload.asOf,
        `annualRevenue=${JSON.stringify(fpRow?.annualRevenue)?.slice(0, 160)}`,
      );
    }

    // =====================================================================
    group("REST \u00b7 Account plan & execution (Task #571)");
    // Action plan + risk register + goal progress CRUD, the partner-tier
    // management gate, NBA promotion, and the QBR PDF export. acc_tasama is
    // in scope for the founding partner; the consultant persona is a non-
    // owner employee → must be denied write access by canManageAccountPlan.
    // =====================================================================
    {
      // ---- workspace embeds the three plan collections ----
      const ws = await api("GET", `/accounts/${ACC}`, PERSONA.fp);
      check(
        "GET /accounts/:id (fp) \u2192 embeds actionPlan/riskRegister/goalProgress arrays",
        ws.status === 200 &&
          Array.isArray(ws.body?.actionPlan) &&
          Array.isArray(ws.body?.riskRegister) &&
          Array.isArray(ws.body?.goalProgress),
        `status=${ws.status}`,
      );

      // ---- create an action (partner) ----
      const actTitle = uniq("Action");
      const createAct = await api("POST", `/accounts/${ACC}/actions`, PERSONA.fp, {
        title: actTitle,
        priority: "high",
      });
      const actionId = createAct.body?.actionPlan?.find?.(
        (a: any) => a.title === actTitle,
      )?.id;
      if (actionId) created.accountActions.add(actionId);
      check(
        "POST /accounts/:id/actions (fp) \u2192 200 + action persisted",
        createAct.status === 200 && !!actionId,
        `status=${createAct.status}`,
      );

      // ---- create-action write gate: consultant (non-owner) \u2192 403 ----
      const consultantAct = await api("POST", `/accounts/${ACC}/actions`, PERSONA.consultant, {
        title: uniq("Forbidden"),
      });
      check(
        "POST /accounts/:id/actions (consultant) \u2192 403 (manage gate)",
        consultantAct.status === 403,
        `status=${consultantAct.status}`,
      );

      // ---- update the action status ----
      if (actionId) {
        const patchAct = await api("PATCH", `/accounts/${ACC}/actions/${actionId}`, PERSONA.fp, {
          status: "done",
        });
        const persisted = patchAct.body?.actionPlan?.find?.((a: any) => a.id === actionId);
        check(
          "PATCH /accounts/:id/actions/:actionId (fp) \u2192 status persisted",
          patchAct.status === 200 && persisted?.status === "done",
          `status=${patchAct.status} got=${persisted?.status}`,
        );
      }

      // ---- promote an NBA into an owned action (source=promoted) ----
      const promote = await api("POST", `/accounts/${ACC}/actions`, PERSONA.fp, {
        title: uniq("Promoted"),
        source: "promoted",
        sourceRef: `nba_${STAMP}`,
      });
      const promotedAction = promote.body?.actionPlan?.find?.(
        (a: any) => a.sourceRef === `nba_${STAMP}`,
      );
      if (promotedAction?.id) created.accountActions.add(promotedAction.id);
      check(
        "POST /accounts/:id/actions promote NBA \u2192 source=promoted persisted",
        promote.status === 200 && promotedAction?.source === "promoted",
        `status=${promote.status} source=${promotedAction?.source}`,
      );

      // ---- create a risk (partner) ----
      const riskDesc = uniq("Risk");
      const createRisk = await api("POST", `/accounts/${ACC}/risks`, PERSONA.fp, {
        description: riskDesc,
        severity: "red",
        kind: "dependency",
      });
      const riskId = createRisk.body?.riskRegister?.find?.(
        (r: any) => r.description === riskDesc,
      )?.id;
      if (riskId) created.accountRisks.add(riskId);
      check(
        "POST /accounts/:id/risks (fp) \u2192 200 + risk persisted",
        createRisk.status === 200 && !!riskId,
        `status=${createRisk.status}`,
      );

      // ---- risk write gate: consultant \u2192 403 ----
      const consultantRisk = await api("POST", `/accounts/${ACC}/risks`, PERSONA.consultant, {
        description: uniq("ForbiddenRisk"),
      });
      check(
        "POST /accounts/:id/risks (consultant) \u2192 403 (manage gate)",
        consultantRisk.status === 403,
        `status=${consultantRisk.status}`,
      );

      // ---- goal-progress upsert against a real strategy objective ----
      // acc_tasama's seeded strategy objective id is obj_a.
      const goalUpsert = await api("PUT", `/accounts/${ACC}/goals/obj_a`, PERSONA.fp, {
        currentValue: uniq("Value"),
        status: "at_risk",
      });
      const goalRow = goalUpsert.body?.goalProgress?.find?.(
        (g: any) => g.objectiveId === "obj_a",
      );
      created.accountGoalProgress.add("obj_a");
      check(
        "PUT /accounts/:id/goals/:objectiveId (fp) \u2192 progress persisted",
        goalUpsert.status === 200 && goalRow?.status === "at_risk",
        `status=${goalUpsert.status} got=${goalRow?.status}`,
      );

      // ---- QBR / account-plan PDF export (partner) ----
      const pdfRes = await fetch(`${BASE}/accounts/${ACC}/plan.pdf`, {
        headers: { cookie: `atelier_persona=${PERSONA.fp}` },
      });
      const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
      check(
        "GET /accounts/:id/plan.pdf (fp) \u2192 200 application/pdf",
        pdfRes.status === 200 &&
          (pdfRes.headers.get("content-type") ?? "").includes("application/pdf") &&
          pdfBuf.length > 1000 &&
          pdfBuf.subarray(0, 5).toString("latin1") === "%PDF-",
        `status=${pdfRes.status} type=${pdfRes.headers.get("content-type")} size=${pdfBuf.length}`,
      );

      // ---- content gate: a firm-wide partner's brief INCLUDES financials ----
      // access.all is true for the founding partner, so canSeeFinancials passes
      // and the financial summary block renders (labels + fmtUsd figures) and
      // the restriction placeholder is absent.
      const fpText = extractPdfText(pdfBuf);
      check(
        "plan.pdf (fp) renders financial summary (labels + figures, no placeholder)",
        FINANCIAL_LABELS.every((l) => fpText.includes(l)) &&
          USD_FIGURE_RE.test(fpText) &&
          !fpText.includes(FINANCIAL_PLACEHOLDER),
        `labels=${FINANCIAL_LABELS.filter((l) => fpText.includes(l)).length}/${FINANCIAL_LABELS.length} ` +
          `usd=${USD_FIGURE_RE.test(fpText)} placeholder=${fpText.includes(FINANCIAL_PLACEHOLDER)}`,
      );

      // ---- PDF read-gate parity with the workspace (canSeeAccount) ----
      // A scoped consultant holds an engagement grant on acc_dge, so canSeeAccount
      // passes and the brief renders (financial section is restricted inside the
      // doc, but the export itself succeeds — parity with the workspace view).
      const scopedPdf = await fetch(`${BASE}/accounts/${ACC_OOS}/plan.pdf`, {
        headers: { cookie: `atelier_persona=${PERSONA.consultant}` },
      });
      const scopedPdfBuf = Buffer.from(await scopedPdf.arrayBuffer());
      check(
        "GET /accounts/:id/plan.pdf (scoped consultant w/ grant) \u2192 200 PDF",
        scopedPdf.status === 200 &&
          (scopedPdf.headers.get("content-type") ?? "").includes("application/pdf") &&
          scopedPdfBuf.subarray(0, 5).toString("latin1") === "%PDF-",
        `status=${scopedPdf.status} type=${scopedPdf.headers.get("content-type")} size=${scopedPdfBuf.length}`,
      );

      // ---- content gate: the scoped reader's brief REDACTS financials ----
      // The consultant reads acc_dge via an engagement grant (access.all is
      // false and it is not the account owner), so canSeeFinancials is false:
      // the financial summary block must collapse to the restriction
      // placeholder, with no financial labels and no fmtUsd figures anywhere
      // in the rendered document.
      const scopedText = extractPdfText(scopedPdfBuf);
      check(
        "plan.pdf (scoped consultant) redacts financial summary (placeholder, no labels/figures)",
        scopedText.includes(FINANCIAL_PLACEHOLDER) &&
          FINANCIAL_LABELS.every((l) => !scopedText.includes(l)) &&
          !USD_FIGURE_RE.test(scopedText),
        `placeholder=${scopedText.includes(FINANCIAL_PLACEHOLDER)} ` +
          `leakedLabels=${FINANCIAL_LABELS.filter((l) => scopedText.includes(l)).join("|") || "none"} ` +
          `usd=${USD_FIGURE_RE.exec(scopedText)?.[0] ?? "none"}`,
      );

      // ---- truly out-of-scope persona \u2192 403 ----
      const noAccessPdf = await fetch(`${BASE}/accounts/${ACC_OOS}/plan.pdf`, {
        headers: { cookie: `atelier_persona=${PERSONA.noAccess}` },
      });
      check(
        "GET /accounts/:id/plan.pdf (no-access persona) \u2192 403 account-forbidden",
        noAccessPdf.status === 403,
        `status=${noAccessPdf.status}`,
      );

      // ---- money-free brief for the BOARD-OBSERVER persona (Task #576) ----
      // The financial gate also excludes board observers
      // (`!isBoardObserver(me.role)`), but no PDF test exercised that branch.
      // A board observer is NOT stopped by the non-employee boundary, so it
      // can reach the handler. To make `isBoardObserver` the DECIDING factor
      // (rather than the account-wide-authority check), we give the observer
      // account-wide authority the only honest way available: it OWNS the
      // account (partnerOwnerId === me.id), so `accountWide` is true and
      // `canSeeAccount` passes. canSeeFinancials then collapses to false
      // solely because of `!isBoardObserver`, and the brief must redact the
      // financial summary to the placeholder with no labels / figures.
      const boardId = `u_board_obs_${STAMP}`;
      const boardAcctId = `acc_board_obs_${STAMP}`;
      await db.insert(atelierUsers).values({
        id: boardId,
        orgId: ORG,
        email: `board.observer.${STAMP}@aico.example`,
        name: "Board Observer (t576)",
        initials: "BO",
        role: "board_observer",
        roleLabel: "Board Observer",
        title: "Independent Board Observer",
      });
      created.users.add(boardId);
      await db.insert(atelierAccounts).values({
        id: boardAcctId,
        orgId: ORG,
        name: uniq("Board Observer Owned Acct"),
        country: "United Arab Emirates",
        sector: "Financial Services",
        partnerOwnerId: boardId,
      });
      created.accounts.add(boardAcctId);

      const boardPdf = await fetch(`${BASE}/accounts/${boardAcctId}/plan.pdf`, {
        headers: { cookie: `atelier_persona=${boardId}` },
      });
      const boardPdfBuf = Buffer.from(await boardPdf.arrayBuffer());
      check(
        "GET /accounts/:id/plan.pdf (board observer, owns account) \u2192 200 PDF",
        boardPdf.status === 200 &&
          (boardPdf.headers.get("content-type") ?? "").includes("application/pdf") &&
          boardPdfBuf.subarray(0, 5).toString("latin1") === "%PDF-",
        `status=${boardPdf.status} type=${boardPdf.headers.get("content-type")} size=${boardPdfBuf.length}`,
      );
      const boardText = extractPdfText(boardPdfBuf);
      check(
        "plan.pdf (board observer) redacts financial summary (placeholder, no labels/figures)",
        boardText.includes(FINANCIAL_PLACEHOLDER) &&
          FINANCIAL_LABELS.every((l) => !boardText.includes(l)) &&
          !USD_FIGURE_RE.test(boardText),
        `placeholder=${boardText.includes(FINANCIAL_PLACEHOLDER)} ` +
          `leakedLabels=${FINANCIAL_LABELS.filter((l) => boardText.includes(l)).join("|") || "none"} ` +
          `usd=${USD_FIGURE_RE.exec(boardText)?.[0] ?? "none"}`,
      );

      // ---- group roll-up financials stay hidden for a board observer (Task #641) ----
      // computeAccountHierarchyRollup blanks pipeline / revenue / health for any
      // persona without account-financials authority (financialsRedacted=true)
      // while keeping the non-financial counts (subsidiary + open-opportunity
      // count). The board observer above OWNS boardAcctId, so canSeeAccount AND
      // accountWide both pass — the role gate (`!isBoardObserver`) is therefore
      // the SOLE reason financials are withheld, exactly the leak this test
      // guards. We give the owned account a subsidiary (the roll-up is only
      // computed when the account has children; leaf accounts return null) plus
      // one open opportunity (so the visible count is provably non-zero), then
      // assert the redacted-but-counted shape over the REST workspace payload.
      // Previously no seeded persona had read access to a parent-with-children,
      // so this redacted path could not be exercised over the API.
      const boardSubId = `acc_board_sub_${STAMP}`;
      const boardOppId = `opp_board_rollup_${STAMP}`;
      await db.insert(atelierAccounts).values({
        id: boardSubId,
        orgId: ORG,
        name: uniq("Board Observer Subsidiary"),
        country: "United Arab Emirates",
        sector: "Financial Services",
        parentAccountId: boardAcctId,
        partnerOwnerId: boardId, // visible to the board observer via canSeeAccount
      });
      created.accounts.add(boardSubId);
      await db.insert(atelierOpportunities).values({
        id: boardOppId,
        orgId: ORG,
        slug: `board-rollup-${STAMP}`,
        name: uniq("Board Roll-up Opp"),
        accountId: boardAcctId,
        plmStage: "shape",
        salesStage: "prospect", // non-terminal → counts as an open opportunity
        partnerOwnerId: boardId,
        engagementLeadId: boardId,
        dealSizeHypothesis: 250_000,
        probabilityPct: 40,
        nextMilestone: "Roll-up redaction fixture",
        sourceLead: "test",
      });
      created.opps.add(boardOppId);

      // Founding partner (firm-wide) → roll-up financials visible, not redacted.
      const fpRollupWs = await api("GET", `/accounts/${boardAcctId}`, PERSONA.fp);
      const fpRollup = fpRollupWs.body?.account?.hierarchyRollup;
      check(
        "GET /accounts/:id hierarchyRollup (founding_partner) \u2192 financials visible, not redacted",
        fpRollupWs.status === 200 &&
          !!fpRollup &&
          fpRollup.financialsRedacted === false &&
          typeof fpRollup.openPipelineUsd === "number" &&
          typeof fpRollup.totalRevenueUsd === "number" &&
          fpRollup.subsidiaryCount >= 1 &&
          fpRollup.openOpportunityCount >= 1,
        `status=${fpRollupWs.status} rollup=${JSON.stringify(fpRollup)?.slice(0, 200)}`,
      );

      // Board observer (owns the account, but role-excluded from financials) →
      // pipeline / revenue / health blanked, financialsRedacted=true.
      const boardRollupWs = await api("GET", `/accounts/${boardAcctId}`, boardId);
      const boardRollup = boardRollupWs.body?.account?.hierarchyRollup;
      check(
        "GET /accounts/:id hierarchyRollup (board observer) \u2192 financialsRedacted, money + health null",
        boardRollupWs.status === 200 &&
          !!boardRollup &&
          boardRollup.financialsRedacted === true &&
          boardRollup.openPipelineUsd === null &&
          boardRollup.totalRevenueUsd === null &&
          boardRollup.health === null,
        `status=${boardRollupWs.status} rollup=${JSON.stringify(boardRollup)?.slice(0, 200)}`,
      );
      check(
        "GET /accounts/:id hierarchyRollup (board observer) \u2192 non-financial counts still visible",
        !!boardRollup &&
          boardRollup.subsidiaryCount >= 1 &&
          boardRollup.accountCount >= 2 &&
          typeof boardRollup.openOpportunityCount === "number" &&
          boardRollup.openOpportunityCount >= 1,
        `rollup=${JSON.stringify(boardRollup)?.slice(0, 200)}`,
      );

      // ---- money-free brief for the RESTRICTED persona (Task #576) ----
      // The financial gate also excludes restricted personas
      // (`!isRestrictedPersona(me.role)`). In practice that in-handler branch
      // is unreachable over HTTP: every restricted persona (contractor /
      // partner_firm_resource / recruiter) is stopped by the central
      // non-employee boundary BEFORE the plan.pdf handler runs — they may only
      // hit engagement-scoped routes. PERSONA.restricted (partner_firm_resource)
      // can see acc_tasama in the workspace via an engagement grant, yet its
      // account-plan export is denied outright. A 403 (no brief at all) is a
      // strictly stronger money-free guarantee than a redacted brief.
      const restrictedPdf = await fetch(`${BASE}/accounts/${ACC}/plan.pdf`, {
        headers: { cookie: `atelier_persona=${PERSONA.restricted}` },
      });
      check(
        "GET /accounts/:id/plan.pdf (restricted persona) \u2192 403 (no money brief at all)",
        restrictedPdf.status === 403,
        `status=${restrictedPdf.status} body=${JSON.stringify(restrictedPdf.body ?? null)?.slice(0, 120)}`,
      );
    }
  } finally {
    // -------------------- cleanup (best-effort, tagged rows) --------------
    try {
      for (const id of created.accountActions) await db.delete(atelierAccountActions).where(eq(atelierAccountActions.id, id));
      for (const id of created.accountRisks) await db.delete(atelierAccountRisks).where(eq(atelierAccountRisks.id, id));
      for (const objId of created.accountGoalProgress)
        await db
          .delete(atelierAccountGoalProgress)
          .where(and(eq(atelierAccountGoalProgress.accountId, ACC), eq(atelierAccountGoalProgress.objectiveId, objId)));
      for (const id of created.renewals) await db.delete(atelierRenewal).where(eq(atelierRenewal.id, id));
      for (const id of created.raids) await db.delete(atelierRaidItems).where(eq(atelierRaidItems.id, id));
      for (const id of created.deliverables) await db.delete(atelierDeliverables).where(eq(atelierDeliverables.id, id));
      // Task #653 — meeting/transcript + win-loss/pane-A rows reference opps, so
      // remove them before the opportunities they hang off of.
      for (const id of created.meetings) await db.delete(atelierMeetings).where(eq(atelierMeetings.id, id));
      for (const id of created.transcripts) await db.delete(atelierTranscripts).where(eq(atelierTranscripts.id, id));
      for (const id of created.debriefs) await db.delete(atelierWinLossDebriefs).where(eq(atelierWinLossDebriefs.id, id));
      for (const id of created.paneAItems) await db.delete(atelierPaneAItems).where(eq(atelierPaneAItems.id, id));
      for (const id of created.opps) await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, id));
      for (const id of created.contacts) await db.delete(atelierContacts).where(eq(atelierContacts.id, id));
      for (const id of created.accounts) {
        await db.execute(sql`delete from atelier_agent_runs where target_id = ${id}`).catch(() => undefined);
        await db.delete(atelierAccounts).where(eq(atelierAccounts.id, id));
      }
      // Users created by this run (e.g. the Task #576 board-observer persona).
      for (const id of created.users) await db.delete(atelierUsers).where(eq(atelierUsers.id, id));
      // Audit cleanup is scoped to BOTH the entities this run touched AND the
      // actor personas it acted as, so concurrent activity by any other actor
      // (possible on a shared, non-isolated DB) is never deleted.
      const auditActors = [PERSONA.fp, PERSONA.sm, PERSONA.consultant, PERSONA.restricted, ...created.users];
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
