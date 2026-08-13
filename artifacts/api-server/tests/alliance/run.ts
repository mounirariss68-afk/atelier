/**
 * Task #526 — Alliance evaluation agents probe (deterministic, stub LLM).
 *
 * Covers, end to end against the real app + scratch DB:
 *   1. POST /partners/firms/:id/agents/alliance-cartographer/run → 202,
 *      status poll flips to succeeded, framework proposals (archetype,
 *      tier, fitScorecard, dueDiligence, riskRegister, phasing,
 *      capabilities) land on the firm's pendingUpdates queue.
 *   2. Fit/DD normalisation: weights + verdict computed in code, missing
 *      dimension defaults to 1/unverified with an openQuestion.
 *   3. Chaining: the Alliance Executive Mapper auto-runs after the
 *      Cartographer and queues governed contact proposals.
 *   4. 409 guard when a run is already in flight (DB-visible run row).
 *   5. Chat `alliance_partner_add`: dedupe (existing firm short-circuits),
 *      candidate/agreed clarification, two-phase confirm, commit creates
 *      the firm and launches the evaluation.
 *   6. Chat `alliance_partner_evaluation`: framework summary read.
 *
 * Both LLM calls are served by a local stub Anthropic server (SSE-capable
 * — the web-search path uses anthropic.messages.stream). The Mapper
 * request is distinguished by `known_contacts` in the request body.
 *
 * Run: pnpm exec tsx tests/alliance/run.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const STAMP = Date.now();
const failures: string[] = [];
function check(name: string, cond: unknown, detail?: unknown): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail !== undefined ? ` \u2014 ${JSON.stringify(detail)?.slice(0, 300)}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Raw LLM shape for the Alliance Cartographer — deliberately omits the
// "region_relevance" fit dimension to exercise the code-side default.
const CARTOGRAPHER_OUTPUT = {
  firm: {
    canonicalName: "Alliance Probe Systems",
    website: "https://allianceprobe.example.test",
    country: "T\u00fcrkiye",
    countryCode: "tr",
    hqCity: "Istanbul",
    kind: "delivery_partner",
    speciality: "Cloud engineering and managed delivery",
    summary: "Alliance Probe Systems delivers cloud platforms across EMEA.",
    employeeCount: 420,
    ownership: "Privately held",
  },
  archetype: {
    id: "delivery_backbone",
    rationale: "Large delivery bench complementary to advisory work.",
    evidence: "evidenced",
  },
  recommendedTier: { tier: "preferred", rationale: "Strong regional bench." },
  fitScorecard: [
    { id: "service_alignment", score: 4, evidence: "evidenced", rationale: "Overlapping cloud services.", sourceUrls: ["https://example.test/services"] },
    { id: "industry_coverage", score: 4, evidence: "evidenced", rationale: "Covers BFSI + telco.", sourceUrls: [] },
    { id: "delivery_economics", score: 4, evidence: "inferred", rationale: "Nearshore rates.", sourceUrls: [] },
    { id: "references", score: 4, evidence: "evidenced", rationale: "Public case studies.", sourceUrls: [] },
    { id: "footprint", score: 4, evidence: "evidenced", rationale: "Offices in 4 countries.", sourceUrls: [] },
    { id: "ai_differentiation", score: 4, evidence: "inferred", rationale: "GenAI practice launched 2025.", sourceUrls: [] },
    { id: "relationship_fit", score: 4, evidence: "inferred", rationale: "Partner-led culture.", sourceUrls: [] },
    { id: "portfolio_complementarity", score: 4, evidence: "evidenced", rationale: "No advisory arm.", sourceUrls: [] },
    // region_relevance intentionally missing.
  ],
  dueDiligence: [
    { id: "legal_standing", status: "pass", evidence: "evidenced", notes: "Registered, active.", sourceUrls: [] },
    { id: "financial_viability", status: "pass", evidence: "inferred", notes: "Growing revenue.", sourceUrls: [] },
    { id: "delivery_track_record", status: "pass", evidence: "evidenced", notes: "10+ years.", sourceUrls: [] },
    { id: "security_posture", status: "conditional", evidence: "inferred", notes: "ISO 27001 claimed, certificate not published.", sourceUrls: [] },
    { id: "ownership_transparency", status: "pass", evidence: "evidenced", notes: "Founders public.", sourceUrls: [] },
    { id: "litigation_sanctions", status: "pass", evidence: "inferred", notes: "No adverse media.", sourceUrls: [] },
    { id: "insurance_liability", status: "to_verify", evidence: "unverified", notes: "Not public.", sourceUrls: [] },
  ],
  riskRegister: [
    {
      risk: "Key-person dependency on the founding CTO.",
      mitigation: "Agree named-deputy coverage in the MSA.",
      severity: "med",
      evidence: "inferred",
      sourceUrls: [],
    },
  ],
  phasing: { phase: "pilot", milestone: "Run one co-delivered engagement", note: "Start small." },
  capabilities: { cloud: 5, data: 4, genai: 3 },
  // Task #871 — researched capability profile (drives Riser RAG chunks).
  capabilityProfile: {
    summary: "Cloud platform engineering and managed delivery across EMEA with a growing GenAI practice.",
    domains: [
      {
        id: "cloud_engineering",
        label: "Cloud Engineering",
        description: "Designs and runs cloud platforms on AWS and Azure; 420-person delivery bench.",
        evidence: "evidenced",
        sourceUrls: ["https://example.test/services"],
      },
      {
        id: "genai",
        label: "GenAI Delivery",
        description: "GenAI practice launched 2025 building agentic workflow pilots.",
        evidence: "inferred",
        sourceUrls: ["https://example.test/news1"],
      },
    ],
  },
  sourceSignals: [
    { kind: "news", title: "Alliance Probe expands", url: "https://example.test/news1", summary: "EMEA growth", confidence: "green" },
    { kind: "site", title: "Services page", url: "https://example.test/services", confidence: "green" },
  ],
  openQuestions: ["Confirm the ISO 27001 certificate."],
};

const MAPPER_OUTPUT = {
  decisionMakers: [
    {
      fullName: "Deniz Probe",
      title: "Chief Executive Officer",
      entityName: "Alliance Probe Systems",
      entityScope: "standalone",
      seniority: "c_suite",
      allianceRole: "executive_sponsor",
      sourceUrl: "https://example.test/leadership",
      linkedinUrl: "https://www.linkedin.com/in/deniz-probe",
      confidence: "verified",
      reportsToName: null,
      rationale: "Named CEO on the leadership page.",
    },
    {
      fullName: "Mert Probe",
      title: "Head of Alliances",
      entityName: "Alliance Probe Systems",
      entityScope: "standalone",
      seniority: "director",
      allianceRole: "alliance_manager",
      sourceUrl: "https://example.test/leadership",
      linkedinUrl: null,
      confidence: "verified",
      reportsToName: "Deniz Probe",
      rationale: "Owns the partner channel.",
    },
  ],
  sourceSignals: [
    { kind: "site", title: "Leadership", url: "https://example.test/leadership", confidence: "green" },
  ],
  openQuestions: [],
};

async function main(): Promise<void> {
  // --- stub Anthropic server, up before the app import ---
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const isMapper = body.includes("known_contacts");
      const text = JSON.stringify(isMapper ? MAPPER_OUTPUT : CARTOGRAPHER_OUTPUT);
      const wantsStream = body.includes('"stream":true');
      if (!wantsStream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_alliance_probe",
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
          id: "msg_alliance_probe",
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
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "alliance-stub-key";
  // Task #687 — pin the research layer to the stubbed Anthropic web_search
  // path (the Perplexity mode is covered by perplexity-research-probe.ts).
  process.env.ATELIER_RESEARCH_PROVIDER ??= "anthropic";
  // Keep PDL out — the Mapper path must be fully deterministic.
  delete process.env.PDL_API_KEY;

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierPartnerFirms, atelierAgentRuns, atelierAuditEvents, atelierBackgroundJobs } =
    D as any;
  const { eq, and, like, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  const FP_ID = `p_test_al_fp_${STAMP}`;
  const firmId = `pf_test_al_${STAMP}`;
  const chatFirmName = `Chatprobe Alliance Labs ${STAMP}`;

  async function call(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${FP_ID}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  try {
    await db.insert(atelierUsers).values({
      id: FP_ID,
      orgId: "aico",
      name: "Alliance Probe FP",
      initials: "AP",
      email: `al_${STAMP}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    });
    await db.insert(atelierPartnerFirms).values({
      id: firmId,
      orgId: "aico",
      name: `Alliance Probe Systems ${STAMP}`,
      partnershipStage: "candidate",
      status: "active",
      contacts: [{ id: `pfc_al_${STAMP}`, name: "Known Contact", role: "COO", email: null }],
      createdByUserId: FP_ID,
    });

    // ---- 1. launch → poll → proposals ----
    group("cartographer launch \u2192 status poll \u2192 proposals");
    const launched = await call("POST", `/partners/firms/${firmId}/agents/alliance-cartographer/run`, {
      contextNotes: "probe",
    });
    check("run \u2192 202 started", launched.status === 202 && launched.body?.started === true, launched);

    let statusBody: any = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const s = await call("GET", `/partners/firms/${firmId}/agents/status`);
      statusBody = s.body;
      const cart = s.body?.agents?.alliance_cartographer;
      const map = s.body?.agents?.alliance_executive_mapper;
      // The chained mapper has no launch-map entry — its terminal state is
      // the durable run-row status ("complete").
      const mapDone = map?.status === "succeeded" || map?.status === "complete";
      if (cart?.status === "succeeded" && mapDone) break;
      if (cart?.status === "failed" || map?.status === "failed") break;
    }
    const cartStatus = statusBody?.agents?.alliance_cartographer;
    const mapStatus = statusBody?.agents?.alliance_executive_mapper;
    check("cartographer succeeded", cartStatus?.status === "succeeded", cartStatus);
    check(
      "cartographer summary carries verdict + weightedTotal",
      cartStatus?.summary?.verdict === "proceed" && typeof cartStatus?.summary?.weightedTotal === "number",
      cartStatus?.summary,
    );
    check(
      "mapper auto-chained and completed",
      mapStatus?.status === "succeeded" || mapStatus?.status === "complete",
      mapStatus,
    );

    const [firmRow] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(eq(atelierPartnerFirms.id, firmId));
    const pending = (firmRow?.pendingUpdates ?? []).filter((p: any) => p.status === "pending");
    const fields = new Set(pending.map((p: any) => p.field));
    check("proposals landed as pending", pending.length > 0, pending.length);
    for (const f of ["archetype", "tier", "fitScorecard", "dueDiligence", "riskRegister", "phasing", "capabilities", "capabilityProfile"]) {
      check(`proposal queued: ${f}`, fields.has(f));
    }
    check(
      "empty firmographics proposed (speciality/kind/country)",
      fields.has("speciality") && fields.has("kind") && fields.has("country"),
      [...fields],
    );
    const contactProps = pending.filter((p: any) => p.field === "contact");
    check(
      "mapper queued contact proposals (known contact excluded)",
      contactProps.length === 2 &&
        contactProps.every((p: any) => (p.toValue as any)?.name !== "Known Contact"),
      contactProps.map((p: any) => (p.toValue as any)?.name),
    );

    // ---- 2. fit/DD normalisation ----
    group("fit/DD normalisation \u2014 computed in code");
    const fitProp = pending.find((p: any) => p.field === "fitScorecard");
    const fit = fitProp?.toValue as any;
    check("all 9 dimensions present", fit?.dimensions?.length === 9, fit?.dimensions?.length);
    const missingDim = fit?.dimensions?.find((d: any) => d.id === "region_relevance");
    check(
      "missing dimension defaulted to 1/unverified",
      missingDim?.score === 1 && missingDim?.evidence === "unverified",
      missingDim,
    );
    // 8 dims at 4 + region_relevance at 1 \u2192 0.95*4 + 0.05*1 = 3.85 \u2192 proceed
    check("weightedTotal computed from weights", fit?.weightedTotal === 3.85, fit?.weightedTotal);
    check("verdict proceed at \u22653.5", fit?.verdict === "proceed", fit?.verdict);
    const ddProp = pending.find((p: any) => p.field === "dueDiligence");
    const dd = ddProp?.toValue as any;
    check("all 7 DD gates present", dd?.gates?.length === 7, dd?.gates?.length);
    check("DD overall = worst (conditional)", dd?.overall === "conditional", dd?.overall);
    const runOut = await db
      .select()
      .from(atelierAgentRuns)
      .where(and(eq(atelierAgentRuns.agentId, "alliance_cartographer"), eq(atelierAgentRuns.targetId, firmId)));
    const cartOut = runOut[0]?.output as any;
    check(
      "missing dimension surfaced as an openQuestion",
      (cartOut?.openQuestions ?? []).some((q: string) => q.includes("Region relevance")),
      cartOut?.openQuestions,
    );

    // ---- 3. re-run dedupe: identical result queues no duplicates ----
    group("re-run \u2192 no duplicate proposals");
    const relaunch = await call("POST", `/partners/firms/${firmId}/agents/alliance-cartographer/run`, {});
    check("re-run accepted (202)", relaunch.status === 202, relaunch.status);
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const s = await call("GET", `/partners/firms/${firmId}/agents/status`);
      if (s.body?.agents?.alliance_cartographer?.status !== "running") break;
    }
    await sleep(1500); // let the chained mapper settle too
    const [firmRow2] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(eq(atelierPartnerFirms.id, firmId));
    const pending2 = (firmRow2?.pendingUpdates ?? []).filter((p: any) => p.status === "pending");
    check(
      "identical re-run queues no duplicates",
      pending2.length === pending.length,
      { before: pending.length, after: pending2.length },
    );

    // ---- 4. 409 guard on in-flight run ----
    group("409 guard while a run is in flight");
    const fakeRunId = `agr_test_al_${STAMP}`;
    await db.insert(atelierAgentRuns).values({
      id: fakeRunId,
      orgId: "aico",
      agentId: "alliance_cartographer",
      status: "running",
      targetType: "partner_firm",
      targetId: firmId,
      targetLabel: "probe",
      triggeredByUserId: FP_ID,
    });
    const conflicted = await call("POST", `/partners/firms/${firmId}/agents/alliance-cartographer/run`, {});
    check("run while DB-visible run row \u2192 409", conflicted.status === 409, conflicted.status);
    // NOTE: the status route deliberately prefers the in-process launch map
    // (which says "succeeded" from the earlier run) over the DB row — the DB
    // row only drives the status display after a server restart. The 409
    // above is the guard that matters.
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.id, fakeRunId));

    // ---- 4b. stale "running" rows render as interrupted error (Task #1046) ----
    group("stale running row \u2192 error on the status route + relaunch unblocked");
    const { AGENT_RUN_STALE_MS, INTERRUPTED_RUN_MESSAGE } = await import(
      "../../src/lib/atelier-agents/run-staleness.js"
    );
    // Pristine firm: no in-process/durable launch entries, so the DB row
    // alone drives the status display — exactly the crashed-server case.
    const staleFirmId = `pfrm_stale_${STAMP}`;
    await db.insert(atelierPartnerFirms).values({
      id: staleFirmId,
      orgId: "aico",
      name: `Stale Probe Partners ${STAMP}`,
      partnershipStage: "candidate",
      status: "active",
      contacts: [],
      createdByUserId: FP_ID,
    });
    const staleRunId = `agr_test_stale_${STAMP}`;
    const deadAt = new Date(Date.now() - AGENT_RUN_STALE_MS - 60 * 60 * 1000);
    await db.insert(atelierAgentRuns).values({
      id: staleRunId,
      orgId: "aico",
      agentId: "alliance_executive_mapper",
      status: "running",
      statusMessage: "Working on it\u2026",
      targetType: "partner_firm",
      targetId: staleFirmId,
      targetLabel: "probe",
      triggeredByUserId: FP_ID,
      // Recent createdAt keeps it at the top of activity feeds; the stale
      // heartbeat (updatedAt) is what marks it dead.
      createdAt: new Date(),
      updatedAt: deadAt,
    });
    const staleStatus = await call("GET", `/partners/firms/${staleFirmId}/agents/status`);
    const mapperOut = (staleStatus.body?.agents ?? {})["alliance_executive_mapper"] as
      | { status?: string; phase?: string | null }
      | undefined;
    check(
      "heartbeat-dead running row renders as error, not running",
      mapperOut?.status === "error",
      mapperOut,
    );
    check(
      "interrupted message surfaces as the phase",
      mapperOut?.phase === INTERRUPTED_RUN_MESSAGE,
      mapperOut?.phase,
    );
    // Agents Lens incident evidence runs must also render the stale row as error.
    {
      const { atelierAgentIncidents } = await import("@workspace/db");
      const incId = `inc_test_stale_${STAMP}`;
      await db.insert(atelierAgentIncidents).values({
        id: incId,
        orgId: "aico",
        agentId: "alliance_executive_mapper",
        agentName: "Alliance Executive Mapper",
        title: "Stale run probe incident",
        severity: "low",
        detectedAt: new Date().toISOString(),
        status: "open",
        evidenceRunIds: [staleRunId],
      } as any);
      const inc = await call("GET", `/agents-lens/incidents/${incId}`);
      const evi = (inc.body?.evidenceRuns ?? []).find((r: any) => r.id === staleRunId);
      check(
        "incident evidence run renders the stale row as error",
        evi?.status === "error",
        evi ?? inc.status,
      );
      await db.delete(atelierAgentIncidents).where(eq(atelierAgentIncidents.id, incId));
    }
    // Global activity feed must also render the stale row as error.
    const activity = await call("GET", `/activity?limit=50`);
    const staleInActivity = (activity.body as any[] | null)?.find((x) => x.id === staleRunId);
    check(
      "GET /activity renders the stale row as error",
      staleInActivity?.status === "error",
      staleInActivity,
    );
    // Chat agent-runs listing: normalized status + running filter excludes it.
    {
      const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");
      await import("../../src/lib/atelier-cli/cli-only-capabilities-reads.js");
      const runsCap = findByToolName("agent_runs_status");
      check("agent_runs_status capability registered", !!runsCap);
      if (runsCap) {
        const ctx = { persona: { id: FP_ID, name: "Alliance Probe FP", orgId: "aico", role: "founding_partner" } } as any;
        const all = (await runsCap.run({ limit: 100 }, ctx)) as any;
        const staleItem = (all?.data?.items ?? []).find((i: any) => i.id === staleRunId);
        check("chat listing shows stale row as error", staleItem?.status === "error", staleItem);
        const running = (await runsCap.run({ status: "running", limit: 100 }, ctx)) as any;
        const staleAsRunning = (running?.data?.items ?? []).find((i: any) => i.id === staleRunId);
        check("chat running filter excludes the stale row", !staleAsRunning, staleAsRunning);
      }
    }
    // ---- 4c. >LAUNCH_STALE_MS but HEARTBEATING run stays running ----
    group("old-but-heartbeating run stays running (heartbeat beats start time)");
    const hbFirmId = `pfrm_hb_${STAMP}`;
    await db.insert(atelierPartnerFirms).values({
      id: hbFirmId,
      orgId: "aico",
      name: `Heartbeat Probe Partners ${STAMP}`,
      partnershipStage: "candidate",
      status: "active",
      contacts: [],
      createdByUserId: FP_ID,
    });
    const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000); // > both watchdogs
    const hbJobId = `bgj_test_hb_${STAMP}`;
    await db.insert(atelierBackgroundJobs).values({
      id: hbJobId,
      orgId: "aico",
      startedByUserId: FP_ID,
      kind: "alliance_cartographer",
      lockKey: "alliance_cartographer",
      targetType: "partner_firm",
      targetId: hbFirmId,
      label: "probe heartbeat job",
      status: "running",
      createdAt: longAgo,
      updatedAt: longAgo,
    } as typeof atelierBackgroundJobs.$inferInsert);
    const hbRunId = `agr_test_hb_${STAMP}`;
    await db.insert(atelierAgentRuns).values({
      id: hbRunId,
      orgId: "aico",
      agentId: "alliance_cartographer",
      status: "running",
      statusMessage: "Still crunching…",
      targetType: "partner_firm",
      targetId: hbFirmId,
      targetLabel: "probe",
      triggeredByUserId: FP_ID,
      createdAt: longAgo,
      updatedAt: new Date(), // fresh heartbeat
    });
    const hbStatus = await call("GET", `/partners/firms/${hbFirmId}/agents/status`);
    const hbCarto = (hbStatus.body?.agents ?? {})["alliance_cartographer"] as
      | { status?: string }
      | undefined;
    check(
      "status route keeps a heartbeating >30min run as running (not failed)",
      hbCarto?.status === "running",
      hbCarto,
    );
    const hbRelaunch = await call("POST", `/partners/firms/${hbFirmId}/agents/alliance-cartographer/run`, {});
    check("heartbeating run still 409-blocks a duplicate launch", hbRelaunch.status === 409, hbRelaunch.status);
    const [hbJobAfter] = await db
      .select({ status: atelierBackgroundJobs.status })
      .from(atelierBackgroundJobs)
      .where(eq(atelierBackgroundJobs.id, hbJobId));
    check("launch attempt did NOT reap the heartbeating job", hbJobAfter?.status === "running", hbJobAfter);
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.id, hbRunId));
    await db.delete(atelierBackgroundJobs).where(eq(atelierBackgroundJobs.id, hbJobId));
    await db.delete(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, hbFirmId));

    const staleRelaunch = await call("POST", `/partners/firms/${staleFirmId}/agents/alliance-cartographer/run`, {});
    check(
      "stale row does not 409-block a fresh launch",
      staleRelaunch.status === 202,
      staleRelaunch.status,
    );
    // Let the stub-backed relaunch settle before cleanup so no run row leaks.
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const s = await call("GET", `/partners/firms/${staleFirmId}/agents/status`);
      if (s.body?.agents?.alliance_cartographer?.status !== "running") break;
    }
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.targetId, staleFirmId));
    await db.delete(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, staleFirmId));

    // ---- 5. chat alliance_partner_add ----
    group("chat alliance_partner_add \u2014 dedupe / clarification / confirm / commit");
    await import("../../src/lib/atelier-cli/alliance-partner-capabilities.js");
    const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");
    const addCap = findByToolName("alliance_partner_add");
    const evalCap = findByToolName("alliance_partner_evaluation");
    check("capabilities registered", Boolean(addCap && evalCap));
    const ctx = { persona: { id: FP_ID, name: "Alliance Probe FP", role: "founding_partner", orgId: "aico" } } as any;

    const dup = await addCap!.run({ name: `Alliance Probe Systems ${STAMP}` }, ctx);
    check(
      "dedupe: existing firm short-circuits (no create)",
      dup.ok === true && (dup.data as any)?.alreadyExists === true && (dup.data as any)?.id === firmId,
      dup,
    );

    const needsStage = await addCap!.run({ name: chatFirmName }, ctx);
    check(
      "no stage \u2192 clarification (partnershipStage)",
      needsStage.ok === true &&
        (needsStage as any).clarification?.field === "partnershipStage" &&
        Array.isArray((needsStage as any).clarification?.suggestions),
      needsStage,
    );

    const needsConfirm = await addCap!.run({ name: chatFirmName, partnershipStage: "candidate" }, ctx);
    check(
      "stage set but unconfirmed \u2192 needs_confirm with pending input",
      needsConfirm.ok === false &&
        (needsConfirm as any).errorCode === "needs_confirm" &&
        (needsConfirm as any).confirmation?.pending?.input?.confirm === true,
      needsConfirm,
    );

    const committed = await addCap!.run(
      { name: chatFirmName, partnershipStage: "candidate", confirm: true, contactName: "Chat Contact" },
      ctx,
    );
    const chatFirmId = (committed.data as any)?.id as string | undefined;
    check(
      "confirmed \u2192 firm created + evaluation launched",
      committed.ok === true &&
        Boolean(chatFirmId) &&
        (committed.data as any)?.agent?.status === "launched" &&
        (committed.data as any)?.navigateTo?.path === "/partners/identify",
      committed,
    );
    const [chatFirm] = chatFirmId
      ? await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, chatFirmId))
      : [null];
    // Task #871 — legacy "candidate" input maps to "consideration".
    check(
      "chat-created firm persisted as consideration (legacy candidate alias)",
      chatFirm?.partnershipStage === "consideration" && chatFirm?.agreementStage == null,
      { stage: chatFirm?.partnershipStage, agreement: chatFirm?.agreementStage },
    );

    // Wait for the fire-and-forget evaluation to land proposals.
    let chatPendingCount = 0;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      const [row] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, chatFirmId!));
      chatPendingCount = (row?.pendingUpdates ?? []).filter((p: any) => p.status === "pending").length;
      const runs = await db
        .select()
        .from(atelierAgentRuns)
        .where(and(eq(atelierAgentRuns.targetId, chatFirmId!), eq(atelierAgentRuns.status, "running")));
      if (chatPendingCount > 0 && runs.length === 0) break;
    }
    check("chat-launched evaluation queued proposals", chatPendingCount > 0, chatPendingCount);

    // ---- 6. chat alliance_partner_evaluation ----
    group("chat alliance_partner_evaluation \u2014 framework summary");
    const missing = await evalCap!.run({ name: `Nonexistent Alliance ${STAMP}` }, ctx);
    check("unknown firm \u2192 not_found", missing.ok === false && (missing as any).errorCode === "not_found", missing);

    // Approve the fitScorecard proposal on the main probe firm first so the
    // summary has live framework data to read.
    const fitPropId = (pending.find((p: any) => p.field === "fitScorecard") as any)?.id;
    const approveFit = await call("POST", `/partners/firms/${firmId}/proposals/${fitPropId}/decide`, { action: "approve" });
    check("fitScorecard proposal approved", approveFit.status === 200, approveFit);
    const summary = await evalCap!.run({ name: firmId }, ctx);
    const sd = summary.data as any;
    check(
      "evaluation summary reads applied framework",
      summary.ok === true &&
        sd?.fit?.verdict === "proceed" &&
        sd?.fit?.weightedTotal === 3.85 &&
        typeof sd?.pendingProposalCount === "number" &&
        sd?.pageHref === "/partners/qualify",
      sd,
    );

    // ---- 7. Task #871: two-dimensional stage model (REST) ----
    group("stage model \u2014 partnership + agreement stages");
    const stageFirm = await call("POST", "/partners/firms", {
      name: `Stageprobe Alliance ${STAMP}`,
      partnershipStage: "agreed",
    });
    check(
      "create agreed \u2192 agreementStage defaults to preparing",
      stageFirm.status === 201 && stageFirm.body?.agreementStage === "preparing",
      stageFirm.body?.agreementStage,
    );
    const stageFirmId = stageFirm.body?.id as string;
    const toSigning = await call("PATCH", `/partners/firms/${stageFirmId}`, { agreementStage: "signing" });
    check("PATCH agreementStage \u2192 signing", toSigning.body?.agreementStage === "signing", toSigning.body);
    const toExploration = await call("PATCH", `/partners/firms/${stageFirmId}`, { partnershipStage: "exploration" });
    check(
      "PATCH back to exploration clears agreementStage",
      toExploration.body?.partnershipStage === "exploration" && toExploration.body?.agreementStage == null,
      toExploration.body,
    );

    // ---- 8. Task #871: capability profile approval → RAG refresh ----
    group("capabilityProfile approval \u2192 chunks + entity embedding + org scoping");
    const { atelierPartnerCapabilityChunks, atelierEntityEmbeddings } = D as any;
    const capProp = pending.find((p: any) => p.field === "capabilityProfile") as any;
    check("capabilityProfile proposal present", Boolean(capProp?.id), capProp);
    const approveCap = await call("POST", `/partners/firms/${firmId}/proposals/${capProp.id}/decide`, { action: "approve" });
    check("capabilityProfile approved", approveCap.status === 200, approveCap);
    const [firmAfterCap] = await db.select().from(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, firmId));
    check(
      "approved profile applied to firm row",
      firmAfterCap?.capabilityProfile?.summary?.includes("Cloud platform engineering") &&
        firmAfterCap?.capabilityProfile?.domains?.length === 2,
      firmAfterCap?.capabilityProfile,
    );
    // The RAG refresh is fire-and-forget — poll for the chunks.
    let chunks: any[] = [];
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      chunks = await db
        .select()
        .from(atelierPartnerCapabilityChunks)
        .where(eq(atelierPartnerCapabilityChunks.firmId, firmId));
      if (chunks.length > 0) break;
    }
    check("capability chunks written (summary + 2 domains)", chunks.length === 3, chunks.length);
    check(
      "chunks are org-scoped + cite sources",
      chunks.every((c: any) => c.orgId === "aico") &&
        chunks.some((c: any) => (c.sourceUrls ?? []).includes("https://example.test/services")),
      chunks.map((c: any) => ({ org: c.orgId, urls: c.sourceUrls })),
    );
    const eembRows = await db
      .select()
      .from(atelierEntityEmbeddings)
      .where(
        and(
          eq(atelierEntityEmbeddings.kind, "partner_firm"),
          eq(atelierEntityEmbeddings.targetId, firmId),
        ),
      );
    check("partner_firm entity embedding mirrored", eembRows.length === 1 && eembRows[0].orgId === "aico", eembRows.length);

    const rag = await import("../../src/lib/atelier-cli/partner-capability-rag.js");
    const hitsOwn = await rag.searchPartnerCapabilities("aico", "cloud platform engineering");
    check(
      "search finds the firm's cloud chunk",
      hitsOwn.length > 0 && hitsOwn[0].firmId === firmId,
      hitsOwn.slice(0, 2).map((h) => ({ firm: h.firmName, d: h.domain, s: h.score })),
    );
    const hitsOtherOrg = await rag.searchPartnerCapabilities(`org_other_${STAMP}`, "cloud platform engineering");
    check("other org sees nothing (org perimeter)", hitsOtherOrg.length === 0, hitsOtherOrg.length);

    // ---- 9. Task #871: chat alliance_partner_capabilities ----
    group("chat alliance_partner_capabilities \u2014 grounded, cited answer");
    const capCap = findByToolName("alliance_partner_capabilities");
    check("capability registered", Boolean(capCap));
    const capAnswer = await capCap!.run({ query: "cloud engineering", name: firmId }, ctx);
    const capData = capAnswer.data as any;
    check(
      "firm-scoped answer carries profile + cited matches",
      capAnswer.ok === true &&
        capData?.firm?.id === firmId &&
        capData?.firm?.domains?.length === 2 &&
        capData?.matches?.length > 0 &&
        capData.matches.every((m: any) => Array.isArray(m.sourceUrls)),
      capData,
    );
    const capBroad = await capCap!.run({ query: "who can build GenAI delivery pilots?" }, ctx);
    check(
      "unscoped query surfaces the firm via RAG",
      capBroad.ok === true && ((capBroad.data as any)?.matches ?? []).some((m: any) => m.firmId === firmId),
      (capBroad.data as any)?.matches?.map((m: any) => m.domain),
    );
    check(
      "self-only roles excluded from the capability",
      Array.isArray((capCap as any).requiredRoles) &&
        !(capCap as any).requiredRoles.includes("employee") &&
        !(capCap as any).requiredRoles.includes("contractor"),
      (capCap as any).requiredRoles,
    );

    // Archive cleanup semantics — archived firm disappears from retrieval.
    const archived = await call("POST", `/partners/firms/${stageFirmId}/archive`);
    check("stage-probe firm archived", archived.status === 200 || archived.status === 204, archived.status);

    if (failures.length === 0) console.log("\nALL CHECKS PASSED");
    else {
      console.error(`\n${failures.length} CHECK(S) FAILED:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    }
  } finally {
    // Tag-sweep cleanup — tracked IDs first, then pattern sweeps.
    try {
      const firms = await db
        .select({ id: atelierPartnerFirms.id })
        .from(atelierPartnerFirms)
        .where(like(atelierPartnerFirms.name, `%${STAMP}%`));
      const firmIds = firms.map((f: any) => f.id).concat([firmId]);
      const { atelierPartnerCapabilityChunks: pcap, atelierEntityEmbeddings: eemb } = D as any;
      await db.delete(pcap).where(inArray(pcap.firmId, firmIds));
      await db.delete(eemb).where(inArray(eemb.targetId, firmIds));
      await db.delete(atelierAgentRuns).where(inArray(atelierAgentRuns.targetId, firmIds));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, firmIds));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, firmIds));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, FP_ID));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `%_${STAMP}`));
    } catch (e) {
      console.warn("cleanup failed:", (e as Error).message);
    }
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(1);
});
