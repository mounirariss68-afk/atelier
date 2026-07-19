/**
 * Task #206 — Executive Mapper critical-role targeting, end-to-end with a
 * stubbed Anthropic server.
 *
 * The stub returns a roster that mixes:
 *   - a hallucinated criticalRole claim (engineer claimed as head_of_ai),
 *   - a wrong claim on a real chief (CMO claimed as ceo),
 *   - a missing claim on a Group CTO,
 *   - a generic IT Director and a Marketing Manager (below the floor).
 *
 * Asserts, via POST /accounts/:id/executive-mapper/run and the stored run
 * output + GET .../executive-mapper/coverage:
 *   1. Claims are overwritten from the verbatim title (never trusted).
 *   2. Juniors/generic directors are dropped AND logged.
 *   3. criticalRoleCoverage is code-computed (all 15 roles, honest gaps) and
 *      unfound roles land in openQuestions.
 *   4. Contact proposals carry the machine-validated criticalRole tag; no
 *      proposal exists for dropped people.
 *
 * Run: pnpm --filter @workspace/api-server run test:exec-mapper-critical
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const EXEC_MAPPER_OUTPUT = {
  decisionMakers: [
    {
      fullName: "Amal Hallucinated",
      title: "AI Engineer",
      seniority: "ic",
      buyerPersona: "technical_evaluator",
      criticalRole: "head_of_ai", // hallucinated claim — title says IC
      sourceUrl: "https://example.test/team",
      confidence: "verified",
    },
    {
      fullName: "Mona Marketer",
      title: "Chief Marketing Officer",
      seniority: "c_suite",
      buyerPersona: "CXO",
      criticalRole: "ceo", // wrong claim — title says CMO
      sourceUrl: "https://example.test/leadership",
      confidence: "verified",
    },
    {
      fullName: "Tariq Tech",
      title: "Group CTO",
      seniority: "c_suite",
      buyerPersona: "CIO",
      criticalRole: null, // missing claim — classifier must backfill
      sourceUrl: "https://example.test/leadership",
      confidence: "verified",
    },
    {
      fullName: "Iman Generic",
      title: "IT Director",
      seniority: "director",
      buyerPersona: "technical_evaluator",
      criticalRole: "cio", // stretched claim on a generic director
      sourceUrl: "https://example.test/team",
      confidence: "inferred",
    },
    {
      fullName: "Sami Junior",
      title: "Marketing Manager",
      seniority: "manager",
      buyerPersona: "business_head",
      criticalRole: "cmo", // stretched claim on a manager
      sourceUrl: "https://example.test/team",
      confidence: "inferred",
    },
  ],
  criticalRoleCoverage: [
    // Hallucinated summary — must be discarded and recomputed in code.
    { role: "head_of_ai", found: true, personName: "Amal Hallucinated" },
    { role: "ceo", found: true, personName: "Mona Marketer" },
  ],
  sourceSignals: [
    {
      kind: "press",
      title: "Critical Probe Co leadership",
      url: "https://example.test/leadership",
      summary: "Leadership page",
      confidence: "green",
    },
  ],
  openQuestions: [],
};

async function main() {
  // --- stub Anthropic server, up before the app import ---
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const text = JSON.stringify(EXEC_MAPPER_OUTPUT);
      const wantsStream = body.includes('"stream":true');
      if (!wantsStream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_critroles",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 20 },
          }),
        );
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const ev = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      ev("message_start", {
        type: "message_start",
        message: {
          id: "msg_critroles",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      });
      ev("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      ev("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      });
      ev("content_block_stop", { type: "content_block_stop", index: 0 });
      ev("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 20 },
      });
      ev("message_stop", { type: "message_stop" });
      res.end();
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "critroles-stub-key";
  // Keep PDL out of the picture so the roster is fully deterministic.
  delete process.env.PDL_API_KEY;

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts } = D;
  const { eq, sql } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `critroles_${Date.now()}`;
  const userId = `u_${runTag}`;
  const acctId = `acct_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${userId}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Crit Roles Probe",
      initials: "CR",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId,
      orgId: "aico",
      name: `Critical Probe Co ${runTag}`,
      country: "AE",
      sector: "Logistics",
      tier: "C",
      partnerOwnerId: userId,
    } as any);

    // ---- run the Mapper through the real route ----
    const run = await api("POST", `/accounts/${acctId}/executive-mapper/run`, {});
    check("run -> 200", run.status === 200, run.status);
    check(
      "route response carries code-computed coverage",
      Array.isArray(run.body?.criticalRoleCoverage) &&
        run.body.criticalRoleCoverage.length === 15,
      run.body?.criticalRoleCoverage?.length,
    );

    // ---- stored run output: guard applied ----
    const rows: any = await db.execute(
      sql`select output from atelier_agent_runs where agent_id = 'executive_mapper' and target_id = ${acctId} and status = 'complete' and deleted_at is null order by created_at desc limit 1`,
    );
    const output = ((rows.rows ?? rows)[0]?.output ?? {}) as any;
    const dms: any[] = output.decisionMakers ?? [];
    const byName = (n: string) => dms.find((d) => d.fullName === n);

    check("engineer dropped from roster", !byName("Amal Hallucinated"), dms.map((d) => d.fullName));
    check("IT Director dropped from roster", !byName("Iman Generic"));
    check("Marketing Manager dropped from roster", !byName("Sami Junior"));
    check(
      "wrong ceo claim overwritten to cmo",
      byName("Mona Marketer")?.criticalRole === "cmo",
      byName("Mona Marketer")?.criticalRole,
    );
    check(
      "missing claim backfilled to cto",
      byName("Tariq Tech")?.criticalRole === "cto",
      byName("Tariq Tech")?.criticalRole,
    );
    const drops: any[] = output.droppedBySeniorityGuard ?? [];
    check(
      "guard drops logged with reasons",
      drops.length === 3 && drops.every((d) => typeof d.reason === "string" && d.reason.length > 0),
      drops,
    );
    const cov: any[] = output.criticalRoleCoverage ?? [];
    check("coverage recomputed over all 15 roles", cov.length === 15, cov.length);
    check(
      "hallucinated head_of_ai coverage discarded (honest gap)",
      cov.find((c) => c.role === "head_of_ai")?.found === false,
    );
    check(
      "hallucinated ceo coverage discarded",
      cov.find((c) => c.role === "ceo")?.found === false,
    );
    check(
      "cmo + cto coverage found from surviving chiefs",
      cov.find((c) => c.role === "cmo")?.found === true &&
        cov.find((c) => c.role === "cto")?.found === true,
    );
    check(
      "unfound roles recorded in openQuestions",
      (output.openQuestions ?? []).some((q: string) =>
        q.includes("Critical roles not yet identified"),
      ),
      output.openQuestions,
    );

    // ---- proposals: tag rides, dropped people never appear ----
    const [acct] = await db
      .select({ pending: atelierAccounts.pendingProfileUpdates })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctId));
    const pending = (acct?.pending as any[]) ?? [];
    const contactProps = pending.filter(
      (p) => p?.proposedBy === "ag_executive_mapper" && p?.field === "contact",
    );
    const propNames = contactProps.map((p) => p?.toValue?.fullName);
    check(
      "only above-floor people proposed",
      propNames.length === 2 &&
        propNames.includes("Mona Marketer") &&
        propNames.includes("Tariq Tech"),
      propNames,
    );
    check(
      "proposals carry machine-validated criticalRole",
      contactProps.find((p) => p?.toValue?.fullName === "Mona Marketer")?.toValue?.criticalRole ===
        "cmo" &&
        contactProps.find((p) => p?.toValue?.fullName === "Tariq Tech")?.toValue?.criticalRole ===
          "cto",
      contactProps.map((p) => p?.toValue?.criticalRole),
    );

    // ---- coverage read route ----
    const covRes = await api("GET", `/accounts/${acctId}/executive-mapper/coverage`);
    check("coverage route -> 200", covRes.status === 200, covRes.status);
    check(
      "coverage route returns the stored 15-role summary",
      Array.isArray(covRes.body?.coverage) && covRes.body.coverage.length === 15,
      covRes.body?.coverage?.length,
    );
    check(
      "coverage route exposes guard drops",
      Array.isArray(covRes.body?.droppedBySeniorityGuard) &&
        covRes.body.droppedBySeniorityGuard.length === 3,
      covRes.body?.droppedBySeniorityGuard?.length,
    );

    // ---- Task #208: approving a proposal carries the tag onto the contact ----
    const tariqProp = contactProps.find((p) => p?.toValue?.fullName === "Tariq Tech");
    const dec = await api(
      "POST",
      `/accounts/${acctId}/profile-updates/${tariqProp?.id}/decision`,
      { decision: "approve" },
    );
    check("approve Tariq proposal -> 200", dec.status === 200, dec.status);
    const graph = await api("GET", `/accounts/${acctId}/contacts`);
    const tariqContact = (graph.body?.contacts ?? []).find(
      (c: any) => c.fullName === "Tariq Tech",
    );
    check(
      "stored contact wire carries derived criticalRole=cto",
      tariqContact?.criticalRole === "cto",
      tariqContact,
    );
    const covRes2 = await api("GET", `/accounts/${acctId}/executive-mapper/coverage`);
    const ctoEntry = (covRes2.body?.coverage ?? []).find((c: any) => c.role === "cto");
    check(
      "coverage cto now sourced from live CRM roster",
      ctoEntry?.found === true &&
        ctoEntry?.source === "crm" &&
        ctoEntry?.personName === "Tariq Tech",
      ctoEntry,
    );
    const cmoEntry = (covRes2.body?.coverage ?? []).find((c: any) => c.role === "cmo");
    check(
      "unapproved cmo still falls back to the run",
      cmoEntry?.found === true && cmoEntry?.source === "run",
      cmoEntry,
    );
  } finally {
    try {
      await db.execute(sql`delete from atelier_agent_runs where target_id = ${acctId}`).catch(() => undefined);
      await db.execute(sql`delete from atelier_audit_events where entity_id = ${acctId}`).catch(() => undefined);
      await db.execute(sql`delete from atelier_contact_relationships where account_id = ${acctId}`).catch(() => undefined);
      await db.execute(sql`delete from atelier_contacts where account_id = ${acctId}`).catch(() => undefined);
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
      // Tag sweep — hook-created rows that slipped the tracked deletes.
      await db.execute(sql`delete from atelier_audit_events where payload_summary like ${"%" + runTag + "%"}`).catch(() => undefined);
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
