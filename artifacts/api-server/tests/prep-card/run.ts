/**
 * Task #1188 — First-meeting prep card branding + watch-out talking points.
 *
 * Locks down GET /atelier/accounts/:accountId/meeting-prep.html:
 *   1. No Brandfetch CDN logo guess anywhere in the card — the header
 *      renders the account/brand name as a wordmark.
 *   2. Cognirise brand chrome present (navy strip + gradient rule,
 *      Plus Jakarta Sans stack) and the byline is "Prepared by Riser"
 *      — never the requesting user's personal name.
 *   3. Each distilled watch-out carries an LLM-suggested answer ("If they
 *      raise it") generated via the stub-Anthropic pattern.
 *   4. Regenerating the card serves the talking points from the cache
 *      persisted in researchBrief (no second LLM call).
 *   5. Accounts without research degrade gracefully (no LLM call, empty
 *      note renders).
 *
 * Runs standalone: tsx ./tests/prep-card/run.ts
 */

process.env.ATELIER_MOCK_AGENTS = process.env.ATELIER_MOCK_AGENTS ?? "1";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_pcfp_${STAMP}`;
const FP_NAME = "Prepcard Probe Partner";
const ACCT = `__probe1188_acct_${STAMP}`;
const ACCT_EMPTY = `__probe1188_empty_${STAMP}`;

const WATCH_A = "Their CFO may see AI spend as discretionary.";
const WATCH_B = "A rival integrator already has the data estate mandate.";
const ANSWER_A = "Anchor on the cost-out cases: agentic ops typically self-funds within two quarters.";
const ANSWER_B = "Position Cognirise as complementary — we take the agentic layer, not the data plumbing.";

let stubCalls = 0;
// When set, the stub holds its next response until this promise resolves —
// lets the probe interleave a concurrent researchBrief rewrite while the
// LLM call is in flight (Task #1188 concurrency defense).
let holdNextResponse: Promise<void> | null = null;

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg: string): void {
  console.log(`ok - ${msg}`);
}

async function main(): Promise<void> {
  // --- stub Anthropic server, up before the app import ---
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", async () => {
      stubCalls += 1;
      if (holdNextResponse) {
        const gate = holdNextResponse;
        holdNextResponse = null;
        await gate;
      }
      const text = JSON.stringify({
        points: [
          { watchOut: WATCH_A, answer: ANSWER_A },
          { watchOut: WATCH_B, answer: ANSWER_B },
        ],
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_prepcard_probe",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text }],
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
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "prepcard-stub-key";

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts } = D as any;
  const { inArray, eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function getHtml(path: string): Promise<{ status: number; text: string }> {
    const res = await fetch(`${API}${path}`, {
      headers: { cookie: `atelier_persona=${FP_ID}` },
    });
    return { status: res.status, text: await res.text() };
  }

  try {
    // ---- fixtures ----
    await db
      .insert(atelierUsers)
      .values({
        id: FP_ID,
        orgId: ORG,
        email: `${FP_ID}@cognirise.ai`,
        name: FP_NAME,
        initials: "PP",
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: FP_NAME,
        permissions: [],
        bdActive: false,
      })
      .onConflictDoNothing();

    const researchBrief = {
      whatsChanging: [{ text: "New group CEO announced an AI-first agenda.", evidence: "evidenced", sourceUrls: [] }],
      executiveTensions: [],
      serviceLineFit: [],
      partnerEcosystem: [],
      mandateAngles: [],
      whyNowHypothesis: "They need an agentic operating layer before the next budget cycle.",
      openQuestions: [],
      singleMostImportant: "AI-first agenda with no delivery partner yet.",
      stressTest: {
        failureScenarios: [],
        assumptions: { evidenced: ["AI agenda is public"], untestedButLikely: [], uncertain: [] },
        likelyObjections: [WATCH_A, WATCH_B],
        evidenceToStrengthen: [],
        revisedHypothesis: "Lead with a scoped agentic-ops pilot tied to the CEO agenda.",
      },
    };

    await db.insert(atelierAccounts).values([
      {
        id: ACCT,
        orgId: ORG,
        name: `Probe1188 Research Co ${STAMP}`,
        brandName: `Probe1188 Brand ${STAMP}`,
        country: "UAE",
        sector: "Probe",
        partnerOwnerId: FP_ID,
        createdByUserId: FP_ID,
        researchBrief,
      },
      {
        id: ACCT_EMPTY,
        orgId: ORG,
        name: `Probe1188 Empty Co ${STAMP}`,
        country: "UAE",
        sector: "Probe",
        partnerOwnerId: FP_ID,
        createdByUserId: FP_ID,
      },
    ] as any);

    // ---- 1+2+3: branded card with talking points ----
    const first = await getHtml(`/accounts/${ACCT}/meeting-prep.html`);
    if (first.status !== 200) fail(`researched card status ${first.status}`);
    if (/brandfetch/i.test(first.text)) fail("Brandfetch reference still present");
    ok("no Brandfetch CDN reference");
    if (!first.text.includes(`Probe1188 Brand ${STAMP}`)) fail("brand wordmark missing");
    ok("account brand wordmark in header");
    if (!first.text.includes("Prepared by Riser")) fail("'Prepared by Riser' byline missing");
    if (first.text.includes(FP_NAME)) fail("requesting user's personal name leaked into the card");
    ok("byline is Riser, not the requesting user");
    if (!first.text.includes("brand-strip") || !first.text.includes("brand-rule"))
      fail("brand chrome (navy strip / gradient rule) missing");
    if (!first.text.includes("Plus Jakarta Sans")) fail("brand type stack missing");
    ok("Cognirise brand chrome present");
    if (!first.text.includes(ANSWER_A) || !first.text.includes(ANSWER_B))
      fail("watch-out talking points missing");
    if (!first.text.includes("If they raise it")) fail("guidance label missing");
    ok("talking points rendered under watch-outs");
    if (stubCalls !== 1) fail(`expected 1 LLM call, saw ${stubCalls}`);

    // ---- 4: regenerate — served from the persisted cache ----
    const [row] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, ACCT));
    const cached = row?.researchBrief?.watchOutTalkingPoints;
    if (!cached?.key || !Array.isArray(cached?.points) || cached.points.length !== 2)
      fail("talking points not persisted into researchBrief");
    ok("talking points persisted in researchBrief cache");
    const second = await getHtml(`/accounts/${ACCT}/meeting-prep.html`);
    if (second.status !== 200) fail(`second fetch status ${second.status}`);
    if (!second.text.includes(ANSWER_A)) fail("cached talking points missing on regenerate");
    if (stubCalls !== 1) fail(`cache miss on regenerate — ${stubCalls} LLM calls`);
    ok("regenerate serves talking points from cache (no second LLM call)");

    // ---- 5: no-research account degrades gracefully ----
    const empty = await getHtml(`/accounts/${ACCT_EMPTY}/meeting-prep.html`);
    if (empty.status !== 200) fail(`empty-account card status ${empty.status}`);
    if (!empty.text.includes("has not been stress-tested")) fail("empty-state note missing");
    if (/brandfetch/i.test(empty.text)) fail("Brandfetch reference on empty card");
    if (!empty.text.includes("Prepared by Riser")) fail("Riser byline missing on empty card");
    if (stubCalls !== 1) fail(`LLM called for account without research (${stubCalls})`);
    ok("no-research account degrades gracefully without LLM calls");

    // ---- 6: a brief rewritten DURING generation is never clobbered ----
    // Invalidate the cache (new watch-outs) so the next card build calls the
    // LLM; hold the stub response, rewrite the brief mid-flight, release.
    const NEW_HYPOTHESIS = `Concurrent rewrite hypothesis ${STAMP}`;
    const preFlight = {
      ...researchBrief,
      stressTest: { ...researchBrief.stressTest, likelyObjections: [WATCH_A] },
    };
    await db.update(atelierAccounts).set({ researchBrief: preFlight }).where(eq(atelierAccounts.id, ACCT));
    let releaseStub!: () => void;
    holdNextResponse = new Promise<void>((r) => (releaseStub = r));
    const inflight = getHtml(`/accounts/${ACCT}/meeting-prep.html`);
    // Give the route time to reach the (held) LLM call, then rewrite.
    await new Promise((r) => setTimeout(r, 300));
    const rewritten = { ...researchBrief, whyNowHypothesis: NEW_HYPOTHESIS };
    delete (rewritten as any).watchOutTalkingPoints;
    await db.update(atelierAccounts).set({ researchBrief: rewritten }).where(eq(atelierAccounts.id, ACCT));
    releaseStub();
    const third = await inflight;
    if (third.status !== 200) fail(`in-flight card status ${third.status}`);
    const [after] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, ACCT));
    if (after?.researchBrief?.whyNowHypothesis !== NEW_HYPOTHESIS)
      fail("concurrent researchBrief rewrite was clobbered by the talking-points cache write");
    ok("brief rewritten during generation survives (cache write patches only its own key)");

    console.log("\nprep-card probe: ALL PASS");

  } finally {
    try {
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [ACCT, ACCT_EMPTY]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP_ID]));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
    stub.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
