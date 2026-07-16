/**
 * Task #15 — API contract test for the enriched brief-quality envelope.
 *
 * Asserts fiveCFactIds / completeness / ageDays / refreshRecommended are
 * present and correctly typed on BOTH:
 *   - GET  /opportunities/:id/brief   (validated with AtelierGetBriefResponse)
 *   - POST /opportunities/:id/scout   (validated with AtelierRunPursuitScoutResponse)
 * The zod schemas come from @workspace/api-zod (orval-generated from
 * lib/api-spec/openapi.yaml), so any silent drift between the route payloads
 * and the OpenAPI contract fails this probe.
 *
 * Determinism: the scout run's LLM call is served by a local stub Anthropic
 * server (AI_INTEGRATIONS_ANTHROPIC_BASE_URL is pointed at it BEFORE the app
 * is imported), so no live model is involved and the returned brief content
 * is canned. All rows are cleaned up in `finally`.
 *
 * Run: pnpm exec tsx tests/crm/brief-envelope-contract-probe.ts
 */
// The persona-cookie auth bypass only exists under NODE_ENV=test — must be
// set before the app module is imported.
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

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

// Canned Pursuit Scout output (non-empty per isScoutBriefEmpty, with one
// sourced green fact so the completeness math has real inputs).
const SCOUT_OUTPUT = {
  accountSnapshot: {
    oneLiner: "Contract Probe Co is a regional logistics software leader",
    scaleHint: "~500 staff",
    recentMoves: ["Opened a Riyadh office"],
  },
  buyerLandscape: {
    likelyBuyers: [{ title: "COO", rationale: "owns the ops mandate" }],
    powerMap: "COO decides with CFO sign-off",
  },
  fiveCDraft: {
    client: "Contract Probe Co regional logistics software leader expanding fast",
    competition: "RivalSoft won the last logistics software tender",
    capability: "Strong fit with agentic ops offerings",
    capacity: "Delivery bench available next quarter",
    contract: "Framework agreement possible within two quarters",
  },
  openQuestions: ["Who owns the budget line?"],
  facts: [
    {
      id: "cf1",
      topic: "market",
      statement: "Contract Probe Co dominates regional logistics software",
      sourceUrl: "https://example.test/a",
      confidence: "green",
    },
    {
      id: "cf2",
      topic: "competitor",
      statement: "RivalSoft won the logistics software tender",
      confidence: "amber",
    },
  ],
  confidence: "amber",
};

/** Assert the four envelope quality fields are present and correctly typed. */
function checkEnvelopeFields(label: string, env: any, expectStale: boolean) {
  const f = env?.fiveCFactIds;
  check(
    `${label}: fiveCFactIds present with 5 string[] sections`,
    !!f &&
      (["client", "competition", "capability", "capacity", "contract"] as const).every(
        (k) => Array.isArray(f[k]) && f[k].every((x: unknown) => typeof x === "string"),
      ),
    f,
  );
  const c = env?.completeness;
  check(
    `${label}: completeness present and typed`,
    !!c &&
      typeof c.score === "number" &&
      typeof c.factCount === "number" &&
      typeof c.sourcedFactCount === "number" &&
      Array.isArray(c.missingSections) &&
      c.confidenceMix &&
      typeof c.confidenceMix.green === "number" &&
      typeof c.confidenceMix.amber === "number" &&
      typeof c.confidenceMix.red === "number",
    c,
  );
  check(`${label}: ageDays is a number`, typeof env?.ageDays === "number", env?.ageDays);
  check(
    `${label}: refreshRecommended is a boolean`,
    typeof env?.refreshRecommended === "boolean",
    env?.refreshRecommended,
  );
  if (expectStale) {
    check(`${label}: stale brief flags refreshRecommended`, env?.refreshRecommended === true, {
      ageDays: env?.ageDays,
      refreshRecommended: env?.refreshRecommended,
    });
  }
}

async function main() {
  // --- stub Anthropic server MUST exist before the app (and the anthropic
  // client) is imported, because the client reads env at import time. ---
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe15",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: JSON.stringify(SCOUT_OUTPUT) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe15-stub-key";

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts, atelierOpportunities, atelierBriefs, atelierResearchFacts } = D;
  const { eq, sql } = await import("drizzle-orm");
  const zodApi = await import("@workspace/api-zod");
  const { AtelierGetBriefResponse, AtelierRunPursuitScoutResponse } = zodApi as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  check("api-zod exports AtelierGetBriefResponse", !!AtelierGetBriefResponse);
  check("api-zod exports AtelierRunPursuitScoutResponse", !!AtelierRunPursuitScoutResponse);

  // OpenAPI-side contract: the generated GET-brief schema must know all four
  // quality fields (a spec regression regenerates api-zod without them).
  {
    const shape = (AtelierGetBriefResponse as any)?.shape ?? {};
    for (const k of ["fiveCFactIds", "completeness", "ageDays", "refreshRecommended"]) {
      check(`openapi contract: AtelierGetBriefResponse has ${k}`, k in shape, Object.keys(shape));
    }
    const scoutShape = (AtelierRunPursuitScoutResponse as any)?.shape ?? {};
    for (const k of ["fiveCFactIds", "completeness", "ageDays", "refreshRecommended"]) {
      check(
        `openapi contract: AtelierRunPursuitScoutResponse has ${k}`,
        k in scoutShape,
        Object.keys(scoutShape),
      );
    }
  }

  const runTag = `probe15_${Date.now()}`;
  const userId = `u_${runTag}`;
  const acctId = `acct_${runTag}`;
  const briefId = `brief_${runTag}`;
  let oppId: string | null = null;

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
      name: "Probe Fifteen",
      initials: "PF",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId,
      orgId: "aico",
      name: `Contract Probe Co ${runTag}`,
      country: "AE",
      sector: "Logistics",
      tier: "C",
      partnerOwnerId: userId,
    } as any);

    const created = await api("POST", "/opportunities", {
      accountId: acctId,
      name: `Probe opp ${runTag}`,
      description: "Contract probe of the brief-quality envelope",
      dealSizeUsd: 100000,
      runScout: false,
    });
    check("opp created (runScout:false)", created.status === 201, created);
    oppId = created.body?.opportunity?.id ?? created.body?.id ?? null;
    check("opp id present", !!oppId, created.body);

    // ---- GET /brief contract (against a directly-inserted stale brief) ----
    await db.insert(atelierBriefs).values({
      id: briefId,
      orgId: "aico",
      opportunityId: oppId!,
      accountSnapshot: SCOUT_OUTPUT.accountSnapshot,
      buyerLandscape: SCOUT_OUTPUT.buyerLandscape,
      fiveCDraft: SCOUT_OUTPUT.fiveCDraft,
      openQuestions: SCOUT_OUTPUT.openQuestions,
      citations: SCOUT_OUTPUT.facts,
      confidence: "amber",
      createdAt: new Date(Date.now() - 45 * 86_400_000),
    } as any);

    const got = await api("GET", `/opportunities/${oppId}/brief`);
    check("GET /brief -> 200", got.status === 200, got.status);
    const getParsed = AtelierGetBriefResponse.safeParse(got.body);
    check(
      "GET /brief body conforms to AtelierGetBriefResponse",
      getParsed.success,
      getParsed.success ? undefined : getParsed.error?.issues?.slice(0, 5),
    );
    checkEnvelopeFields("GET /brief", got.body, true);
    check(
      "GET /brief fiveCFactIds links sourced fact",
      got.body?.fiveCFactIds?.client?.includes("cf1") === true,
      got.body?.fiveCFactIds,
    );

    // ---- POST /scout contract (stubbed LLM -> fresh persisted brief) ----
    const scout = await api("POST", `/opportunities/${oppId}/scout`, { contextBlurb: "probe" });
    check("POST /scout -> 200", scout.status === 200, scout);
    const scoutParsed = AtelierRunPursuitScoutResponse.safeParse(scout.body);
    check(
      "POST /scout body conforms to AtelierRunPursuitScoutResponse",
      scoutParsed.success,
      scoutParsed.success ? undefined : scoutParsed.error?.issues?.slice(0, 5),
    );
    check("POST /scout returns brief", !!scout.body?.brief, scout.body);
    check("POST /scout returns runId string", typeof scout.body?.runId === "string", scout.body?.runId);
    checkEnvelopeFields("POST /scout", scout.body, false);
    check("POST /scout fresh brief ageDays 0", scout.body?.ageDays === 0, scout.body?.ageDays);
    check(
      "POST /scout fresh brief not flagged for refresh",
      scout.body?.refreshRecommended === false,
      scout.body?.refreshRecommended,
    );
    check(
      "POST /scout fiveCFactIds links canned fact",
      scout.body?.fiveCFactIds?.client?.includes("cf1") === true,
      scout.body?.fiveCFactIds,
    );
  } finally {
    try {
      if (oppId) {
        await db.delete(atelierResearchFacts).where(eq(atelierResearchFacts.opportunityId, oppId));
        await db.delete(atelierBriefs).where(eq(atelierBriefs.opportunityId, oppId));
        await db.execute(sql`delete from atelier_agent_runs where target_id = ${oppId}`).catch(() => undefined);
        await db.execute(sql`delete from atelier_audit_events where entity_id = ${oppId}`).catch(() => undefined);
        await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, oppId));
      }
      await db.execute(sql`delete from atelier_audit_events where entity_id = ${acctId}`).catch(() => undefined);
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
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
