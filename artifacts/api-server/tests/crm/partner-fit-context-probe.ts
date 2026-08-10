/**
 * Task #872 — alliance-partner opportunity-fit evaluation in Cartographer &
 * Pursuit Scout.
 *
 * Asserts, fully offline (stub Anthropic SSE + stub Perplexity):
 *  1. buildAllianceCapabilityContext includes ONLY agreed, non-deleted firms
 *     (exploration + archived firms filtered), org-scoped and capped.
 *  2. filterPartnerFit keeps only entries naming active firms, drops
 *     rationale-less entries, caps the list, and forces [] with no partners.
 *  3. The Scout auto-run on opportunity creation injects the
 *     alliancePartnerContext block into the LLM user prompt (agreed firm
 *     present; exploration/archived firm names absent).
 *  4. The persisted brief carries only ALLOWED partnerFit entries (a canned
 *     entry naming the exploration firm + an invented firm is filtered), and
 *     GET /brief returns them.
 *  5. Archiving the agreed partner: future context is empty, while the
 *     previously persisted brief keeps its historical partnerFit unchanged.
 *
 * Run: pnpm exec tsx tests/crm/partner-fit-context-probe.ts
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

const AGREED_FIRM = "Probe Ekimetrics 872";
const EXPLORATION_FIRM = "Probe Explorer 872";
const ARCHIVED_FIRM = "Probe Archived 872";

// Canned Scout output: 3 partnerFit entries — only the AGREED one may survive.
const SCOUT_OUTPUT = {
  accountSnapshot: {
    oneLiner: "Fit Probe Co is a regional retail analytics leader",
    scaleHint: "~800 staff",
    recentMoves: ["Launched a loyalty programme"],
  },
  buyerLandscape: {
    likelyBuyers: [{ title: "CMO", rationale: "owns loyalty" }],
    powerMap: "CMO decides with CFO sign-off",
  },
  fiveCDraft: {
    client: "Fit Probe Co retail analytics leader",
    competition: "RivalCo",
    capability: "Strong data science fit",
    capacity: "Bench available",
    contract: "Framework possible",
  },
  openQuestions: ["Budget owner?"],
  facts: [
    {
      id: "pf1",
      topic: "market",
      statement: "Fit Probe Co leads regional retail analytics",
      sourceUrl: "https://example.test/a",
      confidence: "green",
    },
  ],
  confidence: "amber",
  partnerFit: [
    {
      partnerName: AGREED_FIRM,
      capabilityDomain: "Marketing science",
      rationale: "Loyalty analytics need matches partner MMM capability.",
      sourceUrls: ["https://example.test/a"],
    },
    {
      partnerName: EXPLORATION_FIRM,
      capabilityDomain: "Anything",
      rationale: "Should be filtered — not an agreed partner.",
      sourceUrls: [],
    },
    {
      partnerName: "Invented Partner LLC",
      capabilityDomain: "Fabrication",
      rationale: "Should be filtered — not in registry.",
      sourceUrls: [],
    },
  ],
};

async function main() {
  const anthropicRequests: string[] = [];
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      anthropicRequests.push(body);
      const text = JSON.stringify(SCOUT_OUTPUT);
      const wantsStream = body.includes('"stream":true');
      if (!wantsStream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_probe872",
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
          id: "msg_probe872",
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
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe872-stub-key";

  // Perplexity stub so the retrieval stage stays offline.
  const perplexityStub = createServer((req, res) => {
    let b = "";
    req.on("data", (ch) => (b += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "pplx_872",
          model: "sonar-pro",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Fit Probe Co is a retail analytics firm (2026).",
              },
            },
          ],
          search_results: [{ title: "Fit Probe Co", url: "https://example.test/a" }],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }),
      );
    });
  });
  perplexityStub.listen(0);
  await new Promise<void>((r) => perplexityStub.once("listening", () => r()));
  process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${(perplexityStub.address() as AddressInfo).port}`;
  process.env.PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || "probe872";

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierBriefs,
    atelierResearchFacts,
    atelierPartnerFirms,
  } = D;
  const { eq, sql, inArray } = await import("drizzle-orm");
  const { buildAllianceCapabilityContext, filterPartnerFit } = await import(
    "../../src/lib/atelier-agents/alliance-capability-context.js"
  );
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe872_${Date.now()}`;
  const userId = `u_${runTag}`;
  const acctId = `acct_${runTag}`;
  const firmIds = [`pf_agreed_${runTag}`, `pf_expl_${runTag}`, `pf_arch_${runTag}`];
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
      name: "Probe 872",
      initials: "P8",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId,
      orgId: "aico",
      name: `Fit Probe Co ${runTag}`,
      country: "AE",
      sector: "Retail",
      tier: "C",
      partnerOwnerId: userId,
    } as any);
    await db.insert(atelierPartnerFirms).values([
      {
        id: firmIds[0],
        orgId: "aico",
        name: AGREED_FIRM,
        partnershipStage: "agreed",
        agreementStage: "signed",
        speciality: "Data science",
        capabilityProfile: {
          summary: "Marketing-science consultancy focused on MMM and loyalty analytics.",
          domains: [
            { id: "d1", label: "Marketing science", description: "MMM, loyalty analytics", evidence: "evidenced" },
            { id: "d2", label: "Data platforms", description: "Retail data foundations", evidence: "inferred" },
          ],
          researchedAt: new Date().toISOString(),
          researchedBy: "probe",
        },
      },
      {
        id: firmIds[1],
        orgId: "aico",
        name: EXPLORATION_FIRM,
        partnershipStage: "exploration",
        speciality: "Exploration stage — must be excluded",
      },
      {
        id: firmIds[2],
        orgId: "aico",
        name: ARCHIVED_FIRM,
        partnershipStage: "agreed",
        speciality: "Archived — must be excluded",
        deletedAt: new Date(),
      },
    ] as any);

    // ---- 1. context builder filtering ----
    const ctx = await buildAllianceCapabilityContext("aico");
    check("context includes agreed firm", !!ctx.block?.includes(AGREED_FIRM), ctx.block);
    check("context excludes exploration firm", !ctx.block?.includes(EXPLORATION_FIRM));
    check("context excludes archived firm", !ctx.block?.includes(ARCHIVED_FIRM));
    check("context includes capability domain", !!ctx.block?.includes("Marketing science"));
    check(
      "firmNames = active agreed only",
      ctx.firmNames.length >= 1 &&
        ctx.firmNames.includes(AGREED_FIRM) &&
        !ctx.firmNames.includes(EXPLORATION_FIRM) &&
        !ctx.firmNames.includes(ARCHIVED_FIRM),
      ctx.firmNames,
    );
    const otherOrg = await buildAllianceCapabilityContext("someotherorg_872");
    check("context is org-scoped", otherOrg.block === null && otherOrg.firmNames.length === 0);

    // ---- 2. filterPartnerFit guard ----
    const filtered = filterPartnerFit(SCOUT_OUTPUT.partnerFit, [AGREED_FIRM]);
    check("filterPartnerFit keeps only allowed firm", filtered.length === 1, filtered);
    check(
      "filterPartnerFit forces [] with no active partners",
      filterPartnerFit(SCOUT_OUTPUT.partnerFit, []).length === 0,
    );
    check(
      "filterPartnerFit drops rationale-less entries",
      filterPartnerFit([{ partnerName: AGREED_FIRM, rationale: "  " }], [AGREED_FIRM]).length === 0,
    );
    check(
      "filterPartnerFit caps entries",
      filterPartnerFit(
        Array.from({ length: 9 }, (_, i) => ({
          partnerName: AGREED_FIRM,
          rationale: `r${i}`,
        })),
        [AGREED_FIRM],
      ).length === 5,
    );

    // ---- 3+4. Scout auto-run on opportunity create ----
    const created = await api("POST", "/opportunities", {
      accountId: acctId,
      name: `Fit probe opp ${runTag}`,
      description: "Loyalty analytics modernisation pursuit",
      dealSizeUsd: 100000,
    });
    check("opp created with scout run", created.status === 201, created);
    check("scout status completed", created.body?.scout?.status === "completed", created.body?.scout);
    oppId = created.body?.opportunity?.id ?? created.body?.id ?? null;
    check("opp id present", !!oppId, created.body);

    const synthReq = anthropicRequests.find((r) => r.includes("alliancePartnerContext"));
    check("LLM prompt carries alliancePartnerContext", !!synthReq, anthropicRequests.length);
    check("prompt context names agreed firm", !!synthReq?.includes(AGREED_FIRM));
    check("prompt context omits exploration firm", !synthReq?.includes(EXPLORATION_FIRM));
    check("prompt context omits archived firm", !synthReq?.includes(ARCHIVED_FIRM));

    const got = await api("GET", `/opportunities/${oppId}/brief`);
    check("GET /brief -> 200", got.status === 200, got.status);
    const pfit = got.body?.brief?.partnerFit;
    check("brief partnerFit has exactly the allowed entry", Array.isArray(pfit) && pfit.length === 1, pfit);
    check(
      "brief partnerFit entry names agreed firm w/ rationale",
      pfit?.[0]?.partnerName === AGREED_FIRM &&
        typeof pfit?.[0]?.rationale === "string" &&
        pfit[0].rationale.length > 0 &&
        pfit?.[0]?.capabilityDomain === "Marketing science",
      pfit,
    );

    // ---- 5. deletion semantics ----
    await db
      .update(atelierPartnerFirms)
      .set({ deletedAt: new Date() })
      .where(eq(atelierPartnerFirms.id, firmIds[0]));
    const afterArchive = await buildAllianceCapabilityContext("aico");
    check(
      "archived agreed partner drops from future context",
      afterArchive.block === null && afterArchive.firmNames.length === 0,
      afterArchive,
    );
    const got2 = await api("GET", `/opportunities/${oppId}/brief`);
    check(
      "historical brief partnerFit unchanged after archive",
      got2.body?.brief?.partnerFit?.[0]?.partnerName === AGREED_FIRM,
      got2.body?.brief?.partnerFit,
    );
  } finally {
    try {
      if (oppId) {
        await db.delete(atelierResearchFacts).where(eq(atelierResearchFacts.opportunityId, oppId));
        await db.delete(atelierBriefs).where(eq(atelierBriefs.opportunityId, oppId));
        await db.execute(sql`delete from atelier_agent_runs where target_id = ${oppId}`).catch(() => undefined);
        await db.execute(sql`delete from atelier_audit_events where entity_id = ${oppId}`).catch(() => undefined);
        const { hardDeleteOpportunities } = await import("../../src/lib/atelier-opportunity-delete.js");
        await hardDeleteOpportunities([oppId]);
      }
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, firmIds));
      await db.execute(sql`delete from atelier_audit_events where entity_id = ${acctId}`).catch(() => undefined);
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    stub.close();
    perplexityStub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
