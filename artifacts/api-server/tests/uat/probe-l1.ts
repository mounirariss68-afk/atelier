/**
 * UAT gap probe — L1 capability layer (chat CRM surface).
 *
 * Covers scenarios NOT already asserted by tests/crm/run.ts:
 *   account_lookup (exact / ambiguous / not-found), account_dossier,
 *   account_changes, resolve_entity, pipeline_by_stage,
 *   opportunity_list_by_stage, opportunity_move_stage (envelope, gate,
 *   invalid stage, role gate), opportunity_update_qualifier, undo_last
 *   (no-write case), contact_relationship_create/delete (incl. cycle
 *   guard), REST account merge (merged / already_merged / same-record /
 *   role gate), account_update out-of-scope denial, board_observer
 *   write denial.
 *
 * Same conventions as tests/crm/run.ts: hand-rolled check(), tagged
 * rows, finally-cleanup, app.listen(0).
 */

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";

const ORG = "aico";
const ACC_OOS = "acc_dge"; // out of scope for the restricted persona
// Task T003 — the demo personas were removed from the seed; this probe now
// provisions its own EPHEMERAL personas (created in the try block, cleaned up
// in finally) with the same roles the old personas had.
const PERSONA = {
  fp: "p_mounir_ariss", // real founding partner (stays in the seed)
  consultant: "p_test_probe_consultant", // consultant — role gate only
  restricted: "p_test_probe_restricted", // partner_firm_resource — RESTRICTED
};
const EPHEMERAL_PERSONAS = [
  {
    id: PERSONA.consultant,
    email: "test.probe.consultant@cognirise.ai",
    name: "Test Probe Consultant",
    initials: "PC",
    role: "consultant",
    roleLabel: "Consultant — Public Sector",
    title: "Senior Consultant · Public Sector",
    permissions: ["sme.review"],
    bdActive: false,
  },
  {
    id: PERSONA.restricted,
    email: "test.probe.restricted@bgts.example",
    name: "Test Probe Restricted",
    initials: "PR",
    role: "partner_firm_resource",
    roleLabel: "Senior Consultant — BGTS",
    title: "Senior Consultant — BGTS",
    permissions: [] as string[],
    bdActive: false,
  },
];
const STAMP = Date.now().toString(36);
const TAG = `UATGAP-${STAMP}`;
const uniq = (p: string) => `${TAG} ${p}`;

let passed = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } else {
    failures.push(label);
    console.log(`  \u2717 ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)?.slice(0, 400)}` : ""}`);
  }
}
function group(name: string) {
  console.log(`\n\u2500\u2500 ${name}`);
}

async function main() {
  const D = await import("@workspace/db");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const { db, pool, atelierUsers, atelierAccounts, atelierContacts, atelierContactRelationships, atelierOpportunities, atelierAuditEvents } =
    D as any;

  const created = {
    accounts: new Set<string>(),
    contacts: new Set<string>(),
    rels: new Set<string>(),
    opps: new Set<string>(),
    users: new Set<string>(),
  };

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  async function api(method: string, path: string, persona: string, body?: Record<string, unknown>) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  }

  function makeCtx(personaId: string, role: string, name: string) {
    return {
      persona: { id: personaId, name, role, orgId: ORG },
      turnId: `uatgap-turn-${STAMP}`,
      sessionId: `uatgap-session-${STAMP}`,
      stepIdx: 0,
    };
  }
  const fpCtx = makeCtx(PERSONA.fp, "founding_partner", "Mounir Ariss");
  const cap = (tool: string) => {
    const c = catalog.findByToolName(tool);
    if (!c) throw new Error(`capability ${tool} not registered`);
    return c;
  };

  try {
    // ---- provision ephemeral RBAC personas (Task T003) ----
    for (const p of EPHEMERAL_PERSONAS) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: p.email,
          name: p.name,
          initials: p.initials,
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.title,
          permissions: p.permissions,
          bdActive: p.bdActive,
        })
        .onConflictDoNothing();
      created.users.add(p.id);
    }

    // ---- seed fixture accounts via REST (fp) ----
    group("Seed");
    const mk = async (name: string) => {
      const r = await api("POST", "/accounts", PERSONA.fp, {
        name,
        country: "AE",
        sector: "Technology",
        tier: "B",
        status: "active",
        primaryCurrency: "AED",
        primaryLanguage: "en",
      });
      const id = r.body?.account?.id ?? r.body?.id;
      if (id) created.accounts.add(id);
      return { status: r.status, id };
    };
    const solo = await mk(uniq("Solo Systems"));
    const ambA = await mk(uniq("Ambig Alpha"));
    const ambB = await mk(uniq("Ambig Beta"));
    const dup = await mk(uniq("MergeDup Co"));
    check("seed accounts created (4)", Boolean(solo.id && ambA.id && ambB.id && dup.id), { solo, ambA, ambB, dup });

    // =====================================================
    group("A6 \u00b7 account_lookup (exact / ambiguous / not-found)");
    {
      const exact = await cap("account_lookup").run({ query: uniq("Solo Systems") }, fpCtx);
      check("lookup exact \u2192 ok + resolved id", exact.ok === true && exact.data?.id === solo.id, exact);
      check("lookup exact \u2192 navigateTo account workspace", exact.data?.navigateTo?.path === `/accounts/${solo.id}`, exact.data);
      const amb = await cap("account_lookup").run({ query: `${TAG} Ambig` }, fpCtx);
      check(
        "lookup ambiguous \u2192 disambiguation with \u22652 options",
        amb.ok === true && Array.isArray(amb.disambiguation?.options) && amb.disambiguation.options.length >= 2,
        amb,
      );
      const none = await cap("account_lookup").run({ query: `zzz-none-${STAMP}` }, fpCtx);
      check("lookup no match \u2192 ok:false not_found", none.ok === false && none.errorCode === "not_found", none);
    }

    // =====================================================
    group("A7 \u00b7 account_dossier");
    {
      const byId = await cap("account_dossier").run({ accountId: solo.id }, fpCtx);
      check("dossier by id \u2192 ok + counts", byId.ok === true && typeof byId.data?.contactCount === "number", byId);
      const byAmb = await cap("account_dossier").run({ accountQuery: `${TAG} Ambig` }, fpCtx);
      check("dossier ambiguous query \u2192 disambiguation", byAmb.ok === true && Array.isArray(byAmb.disambiguation?.options), byAmb);
      const byNone = await cap("account_dossier").run({}, fpCtx);
      check("dossier no input \u2192 invalid_input", byNone.ok === false && byNone.errorCode === "invalid_input", byNone);
    }

    // =====================================================
    group("A8 \u00b7 account_changes");
    {
      const ch = await cap("account_changes").run({ accountId: solo.id, sinceDays: 7 }, fpCtx);
      check("changes by id \u2192 ok + items array", ch.ok === true && Array.isArray(ch.data?.items ?? ch.data?.events ?? ch.data?.rows ?? null) || (ch.ok === true && typeof ch.data === "object"), ch);
    }

    // =====================================================
    group("A6b \u00b7 orchestrator resolve_entity");
    {
      const one = await cap("resolve_entity").run({ kind: "account", query: uniq("Solo Systems") }, fpCtx);
      check("resolve_entity unique \u2192 ok + entity", one.ok === true && (one.data?.entity?.id === solo.id || one.data?.id === solo.id), one);
      const many = await cap("resolve_entity").run({ kind: "account", query: `${TAG} Ambig` }, fpCtx);
      const manyOpts = many.disambiguation?.options ?? many.data?.options;
      check("resolve_entity ambiguous \u2192 disambiguation options", many.ok === true && Array.isArray(manyOpts) && manyOpts.length >= 2, many);
    }

    // =====================================================
    group("C7 \u00b7 pipeline_by_stage + opportunity_list_by_stage");
    {
      const pipe = await cap("pipeline_by_stage").run({}, fpCtx);
      check("pipeline_by_stage \u2192 ok + stages[]", pipe.ok === true && Array.isArray(pipe.data?.stages), pipe);
      const list = await cap("opportunity_list_by_stage").run({ stage: "pursue", limit: 5 }, fpCtx);
      check("list_by_stage(pursue) \u2192 ok + items[]", list.ok === true && Array.isArray(list.data?.items), list);
      const bogus = await cap("opportunity_list_by_stage").run({ stage: "warpdrive" }, fpCtx);
      check(
        "list_by_stage(bogus stage) \u2192 handled (ok with empty set, or clean error)",
        (bogus.ok === true && Array.isArray(bogus.data?.items)) || bogus.ok === false,
        bogus,
      );
    }

    // =====================================================
    group("C4 \u00b7 opportunity_move_stage (envelope / gate / invalid / role)");
    {
      const seedOpp = await api("POST", "/opportunities", PERSONA.fp, {
        accountId: solo.id,
        name: uniq("StageOpp"),
        description: "UAT stage-move probe opportunity",
        dealSizeUsd: 120000,
      });
      const oppId = seedOpp.body?.opportunity?.id ?? seedOpp.body?.id;
      if (oppId) created.opps.add(oppId);
      check("seed opp created", Boolean(oppId), seedOpp);

      const move = cap("opportunity_move_stage");
      const env = await move.run({ opportunityId: oppId, toStage: "prospect" }, fpCtx);
      check("move w/o confirm \u2192 confirmation envelope", env.ok === true && Boolean(env.confirmation?.pending), env);
      const legal = await move.run({ opportunityId: oppId, toStage: "prospect", confirm: true }, fpCtx);
      check("move suspect\u2192prospect (confirm) \u2192 ok", legal.ok === true && legal.data?.toStage === "prospect", legal);

      const gated = await move.run({ opportunityId: oppId, toStage: "runner", confirm: true }, fpCtx);
      check(
        "move into qualified band without 5C \u2192 stage_gate_failed",
        gated.ok === false && gated.errorCode === "stage_gate_failed",
        gated,
      );

      const qual = await cap("opportunity_update_qualifier").run(
        {
          opportunityId: oppId,
          fiveC: { client: "strong", competition: "weak", capability: "strong", capacity: "ok", contract: "clean" },
          decision: "pursue",
          rationale: "UAT probe",
          confirm: true,
        },
        fpCtx,
      );
      check("update_qualifier (confirm) \u2192 ok", qual.ok === true, qual);
      const [qrow] = await db.select().from(atelierOpportunities).where(eq(atelierOpportunities.id, oppId));
      check("qualifier persisted (qualify5c.client)", qrow?.qualify5c?.client === "strong", qrow?.qualify5c);

      const afterQual = await move.run({ opportunityId: oppId, toStage: "runner", confirm: true }, fpCtx);
      check("move \u2192 runner after 5C \u2192 ok", afterQual.ok === true && afterQual.data?.toStage === "runner", afterQual);

      const invalid = await move.run({ opportunityId: oppId, toStage: "warpdrive", confirm: true }, fpCtx);
      check("move to unrecognised stage \u2192 clean invalid error", invalid.ok === false, invalid);

      const missing = await move.run({ opportunityId: `opp_none_${STAMP}`, toStage: "prospect", confirm: true }, fpCtx);
      check("move on missing opp \u2192 not_found", missing.ok === false && missing.errorCode === "not_found", missing);

      const obs = await move.run(
        { opportunityId: oppId, toStage: "prospect", confirm: true },
        makeCtx("p_board_obs", "board_observer", "Board Observer"),
      );
      check("move as board_observer \u2192 forbidden", obs.ok === false, obs);
    }

    // =====================================================
    group("E1 \u00b7 undo_last (no prior write in session)");
    {
      const undo = await cap("undo_last").run({}, makeCtx(PERSONA.fp, "founding_partner", "Mounir Ariss"));
      check("undo with no session write \u2192 ok + canUndo:false", undo.ok === true && undo.data?.canUndo === false, undo);
    }

    // =====================================================
    group("B3 \u00b7 contact_relationship_create/delete + cycle guard");
    {
      const mkContact = async (n: string) => {
        const r = await cap("contact_create").run({ accountId: solo.id, fullName: uniq(n), confirm: true }, fpCtx);
        const id = r.data?.id;
        if (id) created.contacts.add(id);
        return id;
      };
      const c1 = await mkContact("Rel One");
      const c2 = await mkContact("Rel Two");
      check("two contacts created", Boolean(c1 && c2), { c1, c2 });

      const relCap = cap("contact_relationship_create");
      const noConfirm = await relCap.run({ fromContactId: c1, toContactId: c2, type: "reports_to" }, fpCtx);
      check("relationship w/o confirm \u2192 needs_confirm", noConfirm.ok === false && noConfirm.errorCode === "needs_confirm", noConfirm);
      const rel = await relCap.run({ fromContactId: c1, toContactId: c2, type: "reports_to", confirm: true }, fpCtx);
      const relId = rel.data?.id;
      if (relId) created.rels.add(relId);
      check("relationship create (confirm) \u2192 ok + id", rel.ok === true && Boolean(relId), rel);

      const cycle = await relCap.run({ fromContactId: c2, toContactId: c1, type: "reports_to", confirm: true }, fpCtx);
      check("reverse edge \u2192 reporting-cycle rejected", cycle.ok === false && /cycle/i.test(String(cycle.errorMessage)), cycle);

      const self = await relCap.run({ fromContactId: c1, toContactId: c1, type: "reports_to", confirm: true }, fpCtx);
      check("self edge \u2192 invalid", self.ok === false, self);

      const dupe = await relCap.run({ fromContactId: c1, toContactId: c2, type: "reports_to", confirm: true }, fpCtx);
      check("duplicate edge \u2192 idempotent (same id)", dupe.ok === true && dupe.data?.id === relId, dupe);

      const del = await cap("contact_relationship_delete").run({ id: relId, confirm: true }, fpCtx);
      check("relationship delete \u2192 ok", del.ok === true, del);
      const delAgain = await cap("contact_relationship_delete").run({ id: relId, confirm: true }, fpCtx);
      check("delete again \u2192 not_found", delAgain.ok === false && delAgain.errorCode === "not_found", delAgain);
    }

    // =====================================================
    group("A12 \u00b7 REST account merge");
    {
      const merged = await api("POST", `/accounts/${solo.id}/merge`, PERSONA.fp, { duplicateAccountId: dup.id });
      check("merge dup into solo \u2192 ok status merged", merged.status === 200 && merged.body?.ok === true && merged.body?.status === "merged", merged);
      const again = await api("POST", `/accounts/${solo.id}/merge`, PERSONA.fp, { duplicateAccountId: dup.id });
      check("merge replay \u2192 already_merged", again.status === 200 && again.body?.status === "already_merged", again);
      const self = await api("POST", `/accounts/${solo.id}/merge`, PERSONA.fp, { duplicateAccountId: solo.id });
      check("merge into itself \u2192 400 same-record", self.status === 400 && self.body?.error === "same-record", self);
      const denied = await api("POST", `/accounts/${solo.id}/merge`, PERSONA.consultant, { duplicateAccountId: ambA.id });
      check("merge as consultant \u2192 403 partner-only", denied.status === 403, denied);
    }

    // =====================================================
    group("A9/A4 \u00b7 scope + role denials on account writes");
    {
      const rCtx = makeCtx(PERSONA.restricted, "partner_firm_resource", "Yara Al-Suwaidi");
      const oos = await cap("account_update").run({ accountId: ACC_OOS, notes: "hacked", confirm: true }, rCtx);
      check("account_update out-of-scope (restricted) \u2192 forbidden", oos.ok === false, oos);
      const obs = await cap("account_create").run(
        { name: uniq("Observer Co"), country: "AE", sector: "Technology", confirm: true },
        makeCtx("p_board_obs", "board_observer", "Board Observer"),
      );
      check("account_create as board_observer \u2192 forbidden", obs.ok === false, obs);
      if (obs.ok === true && obs.data?.id) created.accounts.add(obs.data.id);
    }
  } finally {
    // ---- cleanup all tagged rows ----
    try {
      if (created.rels.size) await db.delete(atelierContactRelationships).where(inArray(atelierContactRelationships.id, [...created.rels]));
      if (created.contacts.size) await db.delete(atelierContacts).where(inArray(atelierContacts.id, [...created.contacts]));
      const { hardDeleteOpportunities } = await import("../../src/lib/atelier-opportunity-delete.js");
      const oppIdsToDelete = new Set<string>(created.opps);
      // opportunities created as side effects on tagged accounts
      if (created.accounts.size) {
        const sideEffectOpps = await db
          .select({ id: atelierOpportunities.id })
          .from(atelierOpportunities)
          .where(inArray(atelierOpportunities.accountId, [...created.accounts]));
        for (const o of sideEffectOpps) oppIdsToDelete.add(o.id);
      }
      if (oppIdsToDelete.size) await hardDeleteOpportunities([...oppIdsToDelete]);
      if (created.accounts.size) {
        await db.delete(atelierContacts).where(inArray(atelierContacts.accountId, [...created.accounts]));
        await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [...created.accounts]));
      }
      const tagged = await db.select({ id: atelierAccounts.id }).from(atelierAccounts).where(eq(atelierAccounts.orgId, ORG));
      const leftovers = tagged.filter((r: any) => String(r.id).includes(STAMP));
      if (leftovers.length) await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, leftovers.map((r: any) => r.id)));
      if (created.accounts.size) {
        await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [...created.accounts, ...created.opps, ...created.contacts, ...created.rels]));
      }
      // ephemeral RBAC personas (Task T003)
      if (created.users.size) await db.delete(atelierUsers).where(inArray(atelierUsers.id, [...created.users]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("FAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
