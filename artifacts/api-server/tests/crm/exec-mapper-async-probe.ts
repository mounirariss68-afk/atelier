/**
 * Task #201 — Map Executives / Cartographer refresh must never 502 on long runs.
 *
 * Asserts the async start-then-poll contract:
 *   1. POST /accounts/:id/executive-mapper/run returns 202 IMMEDIATELY
 *      (never holds the connection for the run duration).
 *   2. GET /accounts/:id/executive-mapper/status reports "running" while the
 *      background sweep is in flight (reload-recovery source of truth).
 *   3. Status settles to "succeeded" with proposedCount once the governed
 *      queue write lands; proposals are on pendingProfileUpdates.
 *   4. A second start while running is a 409 (duplicate-run guard).
 *   5. POST /accounts/:id/cartographer/refresh returns the workspace
 *      immediately with cartographerStatus === "running"; the queue write
 *      lands in the background.
 *   6. A forced LLM failure surfaces via status = "failed" with the error
 *      detail (exec mapper) and cartographerStatus === "failed" (refresh).
 *
 * Determinism: LLM calls served by a local stub Anthropic server; a mutable
 * flag flips it to 500s for the failure legs. Rows cleaned up in `finally`.
 *
 * Run: pnpm exec tsx tests/crm/exec-mapper-async-probe.ts
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
      fullName: "Async Probe Exec",
      title: "Chief Financial Officer",
      seniority: "c_suite",
      buyerPersona: "economic_buyer",
      sourceUrl: "https://example.test/leadership",
      confidence: "green",
    },
  ],
  sourceSignals: [],
  openQuestions: [],
};

const CARTOGRAPHER_OUTPUT = {
  account: {
    refreshedSummary: "Async Probe Co provides regional consulting.",
    canonicalName: "Async Probe Co",
    brandName: null,
    country: "AE",
    sector: "Consulting",
    hqCity: "Dubai",
    tier: "B",
  },
  decisionMakers: [],
  sourceSignals: [],
  strategicPriorities: [],
  openQuestions: [],
};

// Mutable stub behaviour switches.
let stubFail = false;
let stubDelayMs = 0;

async function main() {
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      setTimeout(() => {
        if (stubFail) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              type: "error",
              error: { type: "api_error", message: "stub forced failure" },
            }),
          );
          return;
        }
        const isExecMapper = body.includes("knownContacts");
        const out = isExecMapper ? EXEC_MAPPER_OUTPUT : CARTOGRAPHER_OUTPUT;
        const text = JSON.stringify(out);
        const wantsStream = body.includes('"stream":true');
        if (!wantsStream) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "msg_asyncprobe",
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
            id: "msg_asyncprobe",
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
      }, stubDelayMs);
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "asyncprobe-stub-key";
  delete process.env.PDL_API_KEY;

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts } = D;
  const { eq, sql } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `execasync_${Date.now()}`;
  const userId = `u_${runTag}`;
  const acctA = `acct_${runTag}_a`; // exec mapper success + 409
  const acctB = `acct_${runTag}_b`; // cartographer refresh success
  const acctC = `acct_${runTag}_c`; // exec mapper forced failure
  const acctD = `acct_${runTag}_d`; // cartographer forced failure

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

  const pollStatus = async (acctId: string, until: (s: any) => boolean, tries = 120) => {
    let s: any = null;
    for (let i = 0; i < tries; i++) {
      const r = await api("GET", `/accounts/${acctId}/executive-mapper/status`);
      s = r.body;
      if (until(s)) return s;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    return s;
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      name: "Exec Async Probe",
      initials: "EA",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    for (const id of [acctA, acctB, acctC, acctD]) {
      await db.insert(atelierAccounts).values({
        id,
        orgId: "aico",
        name: `Async Probe Co ${id}`,
        country: "AE",
        sector: "Consulting",
        tier: "C",
        partnerOwnerId: userId,
      } as any);
    }

    // ---- 1–4. Executive Mapper async happy path + duplicate guard ----
    stubDelayMs = 1500; // long enough to observe "running" + hit the 409
    const t0 = Date.now();
    const start = await api("POST", `/accounts/${acctA}/executive-mapper/run`, {});
    const startMs = Date.now() - t0;
    check("exec run -> 202", start.status === 202, start);
    check("exec run returns immediately (<1s)", startMs < 1000, `${startMs}ms`);
    check("exec run body says running", start.body?.status === "running", start.body);

    const running = await api("GET", `/accounts/${acctA}/executive-mapper/status`);
    check("status shows running mid-run", running.body?.status === "running", running.body);

    const dup = await api("POST", `/accounts/${acctA}/executive-mapper/run`, {});
    check("second start while running -> 409", dup.status === 409, dup);

    const settled = await pollStatus(acctA, (s) => s?.status !== "running");
    check("status settles to succeeded", settled?.status === "succeeded", settled);
    check("succeeded reports proposedCount", typeof settled?.proposedCount === "number" && settled.proposedCount > 0, settled);

    const [rowA] = await db
      .select({ pending: atelierAccounts.pendingProfileUpdates })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctA));
    const pendA = (rowA?.pending as any[]) ?? [];
    check(
      "proposals landed on the governed queue",
      pendA.some((p) => p?.proposedBy === "ag_executive_mapper"),
      pendA.map((p) => p?.proposedBy),
    );

    // ---- 5. Cartographer refresh: instant response + background queue write ----
    stubDelayMs = 1500;
    const t1 = Date.now();
    const refresh = await api("POST", `/accounts/${acctB}/cartographer/refresh`, {});
    const refreshMs = Date.now() - t1;
    check("refresh -> 200", refresh.status === 200, refresh.status);
    check("refresh returns immediately (<2s)", refreshMs < 2000, `${refreshMs}ms`);
    check(
      "refresh workspace shows cartographerStatus running",
      refresh.body?.account?.cartographerStatus === "running",
      refresh.body?.account?.cartographerStatus,
    );
    const dupRefresh = await api("POST", `/accounts/${acctB}/cartographer/refresh`, {});
    check("second refresh while running -> 409", dupRefresh.status === 409, dupRefresh.status);

    // Poll the workspace until the run settles and proposals land.
    let wsB: any = null;
    for (let i = 0; i < 120; i++) {
      const r = await api("GET", `/accounts/${acctB}`);
      wsB = r.body;
      if (wsB?.account?.cartographerStatus !== "running") break;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    check(
      "refresh settles (cartographerStatus no longer running)",
      wsB?.account?.cartographerStatus !== "running",
      wsB?.account?.cartographerStatus,
    );
    const [rowB] = await db
      .select({ pending: atelierAccounts.pendingProfileUpdates, enrichedAt: atelierAccounts.enrichedAt })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctB));
    check("refresh recorded enrichedAt in the background", !!rowB?.enrichedAt, rowB);

    // ---- 6a. Forced exec-mapper failure surfaces error detail ----
    stubFail = true;
    stubDelayMs = 0;
    const failStart = await api("POST", `/accounts/${acctC}/executive-mapper/run`, {});
    check("exec run (failure leg) -> 202", failStart.status === 202, failStart);
    const failSettled = await pollStatus(acctC, (s) => s?.status !== "running" && s?.status !== "idle", 240);
    check("failed run reports status=failed", failSettled?.status === "failed", failSettled);
    check(
      "failed run carries an error detail",
      typeof failSettled?.error === "string" && failSettled.error.length > 0,
      failSettled,
    );

    // ---- 6b. Forced cartographer failure -> cartographerStatus failed ----
    const failRefresh = await api("POST", `/accounts/${acctD}/cartographer/refresh`, {});
    check("refresh (failure leg) -> 200", failRefresh.status === 200, failRefresh.status);
    let wsD: any = null;
    for (let i = 0; i < 240; i++) {
      const r = await api("GET", `/accounts/${acctD}`);
      wsD = r.body;
      if (wsD?.account?.cartographerStatus === "failed") break;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    check(
      "failed refresh surfaces cartographerStatus=failed",
      wsD?.account?.cartographerStatus === "failed",
      wsD?.account?.cartographerStatus,
    );
    check(
      "failed refresh surfaces a failure reason (cartographerPhase)",
      typeof wsD?.account?.cartographerPhase === "string" && wsD.account.cartographerPhase.length > 0,
      wsD?.account?.cartographerPhase,
    );
    stubFail = false;
  } finally {
    try {
      // Give fire-and-forget chains a beat to finish before deleting rows.
      await new Promise((r) => setTimeout(r, 1500));
      for (const id of [acctA, acctB, acctC, acctD]) {
        await db.execute(sql`delete from atelier_agent_runs where target_id = ${id}`).catch(() => undefined);
        await db.execute(sql`delete from atelier_audit_events where entity_id = ${id}`).catch(() => undefined);
        await db.delete(atelierAccounts).where(eq(atelierAccounts.id, id));
      }
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
