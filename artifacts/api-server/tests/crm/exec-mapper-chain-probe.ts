/**
 * Task — Run Executive Mapper automatically after every Cartographer run.
 *
 * Asserts:
 *   1. POST /accounts/:id/cartographer/refresh chains an Executive Mapper
 *      run (fire-and-forget) that completes and lands its proposals /
 *      audit trail on the account's governed queue.
 *   2. A research-only Cartographer run (chat prefill_from_specialist with
 *      no targetId) does NOT trigger the Executive Mapper — there is no
 *      account to map against.
 *
 * Determinism: both LLM calls are served by a local stub Anthropic server
 * (AI_INTEGRATIONS_ANTHROPIC_BASE_URL is pointed at it BEFORE the app is
 * imported). The stub distinguishes the Executive Mapper request by the
 * presence of `knownContacts` in the request body. All rows cleaned up in
 * `finally`.
 *
 * Run: pnpm exec tsx tests/crm/exec-mapper-chain-probe.ts
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

const CARTOGRAPHER_OUTPUT = {
  account: {
    refreshedSummary: "Chain Probe Co builds regional logistics software.",
    canonicalName: "Chain Probe Co",
    brandName: null,
    country: "AE",
    sector: "Logistics",
    hqCity: "Dubai",
    tier: "B",
  },
  decisionMakers: [],
  sourceSignals: [
    {
      kind: "news",
      title: "Chain Probe Co expands",
      url: "https://example.test/news",
      summary: "Expansion into KSA",
      publishedAt: "2026-07-01",
      confidence: "green",
    },
  ],
  strategicPriorities: [],
  openQuestions: [],
};

const EXEC_MAPPER_OUTPUT = {
  decisionMakers: [
    {
      fullName: "Chained Exec Probe",
      title: "Chief Operating Officer",
      seniority: "c_suite",
      buyerPersona: "economic_buyer",
      sourceUrl: "https://example.test/leadership",
      confidence: "green",
    },
  ],
  sourceSignals: [],
  openQuestions: ["Who chairs the board?"],
};

async function main() {
  // --- stub Anthropic server, up before the app import ---
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const isExecMapper = body.includes("knownContacts");
      const out = isExecMapper ? EXEC_MAPPER_OUTPUT : CARTOGRAPHER_OUTPUT;
      const text = JSON.stringify(out);
      const wantsStream = body.includes('"stream":true');
      if (!wantsStream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_execchain",
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
      // SSE for the web-search streaming path (anthropic.messages.stream).
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
          id: "msg_execchain",
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
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "execchain-stub-key";
  // Keep PDL out of the picture so the Mapper path is fully deterministic.
  delete process.env.PDL_API_KEY;

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts } = D;
  const { eq, and, sql } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const cli = await import("../../src/lib/atelier-cli/index.js");

  const runTag = `execchain_${Date.now()}`;
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

  const execMapperRuns = async () => {
    const rows: any = await db.execute(
      sql`select id, status from atelier_agent_runs where agent_id = 'executive_mapper' and target_id = ${acctId} and deleted_at is null`,
    );
    return (rows.rows ?? rows) as Array<{ id: string; status: string }>;
  };
  const allExecMapperRunCount = async () => {
    const rows: any = await db.execute(
      sql`select count(*)::int as n from atelier_agent_runs where agent_id = 'executive_mapper' and deleted_at is null`,
    );
    return Number((rows.rows ?? rows)[0]?.n ?? 0);
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Exec Chain Probe",
      initials: "EC",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId,
      orgId: "aico",
      name: `Chain Probe Co ${runTag}`,
      country: "AE",
      sector: "Logistics",
      tier: "C",
      partnerOwnerId: userId,
    } as any);

    check("no executive_mapper runs before refresh", (await execMapperRuns()).length === 0);

    // ---- 1. Manual Cartographer refresh chains the Executive Mapper ----
    const refresh = await api("POST", `/accounts/${acctId}/cartographer/refresh`, {});
    check("refresh -> 200", refresh.status === 200, refresh.status);

    // The chain is fire-and-forget — poll for the run to appear + complete.
    let runs: Array<{ id: string; status: string }> = [];
    for (let i = 0; i < 60; i++) {
      runs = await execMapperRuns();
      if (runs.length > 0 && runs.every((r) => r.status !== "running")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    check("refresh chained exactly one executive_mapper run", runs.length === 1, runs);
    check("chained run completed", runs[0]?.status === "complete", runs[0]);

    // Proposals landed on the governed queue.
    const [acct] = await db
      .select({ pending: atelierAccounts.pendingProfileUpdates })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctId));
    const pending = (acct?.pending as any[]) ?? [];
    const mapperProposals = pending.filter((p) => p?.proposedBy === "ag_executive_mapper");
    check(
      "executive mapper proposals landed in pendingProfileUpdates",
      mapperProposals.length > 0,
      pending.map((p) => ({ proposedBy: p?.proposedBy, field: p?.field })),
    );
    check(
      "proposed contact is the canned exec",
      JSON.stringify(mapperProposals).includes("Chained Exec Probe"),
      mapperProposals,
    );

    // Mapper audit event recorded.
    const aud: any = await db.execute(
      sql`select count(*)::int as n from atelier_audit_events where entity_id = ${acctId} and actor_id = 'ag_executive_mapper' and action = 'account.profile.proposeUpdate'`,
    );
    check("mapper propose audit event written", Number((aud.rows ?? aud)[0]?.n ?? 0) >= 1);

    // ---- 2. Research-only Cartographer (chat prefill, no targetId) does
    //         NOT chain the Executive Mapper ----
    const beforeAll = await allExecMapperRunCount();
    const persona = { id: userId, name: "Exec Chain Probe", role: "founding_partner", orgId: "aico" };
    const tool = (cli as any).findToolByName("prefill_from_specialist", persona);
    check("prefill_from_specialist tool resolvable", !!tool);
    if (tool) {
      const result = await tool.run(
        { kind: "account", input: { name: `Research Only Co ${runTag}` } },
        { persona, turnId: `t_${runTag}`, sessionId: `s_${runTag}`, stepIdx: 0 },
      );
      check("research-only prefill returned ok", result?.ok === true, result);
    }
    // Give any (wrongly) fired chain a moment to enqueue, then assert none did.
    await new Promise((r) => setTimeout(r, 2000));
    const afterAll = await allExecMapperRunCount();
    check(
      "research-only run did not trigger the Executive Mapper",
      afterAll === beforeAll,
      { beforeAll, afterAll },
    );
  } finally {
    try {
      await db.execute(sql`delete from atelier_agent_runs where target_id = ${acctId}`).catch(() => undefined);
      await db.execute(sql`delete from atelier_audit_events where entity_id = ${acctId}`).catch(() => undefined);
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
