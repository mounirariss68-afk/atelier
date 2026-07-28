/**
 * Task #699 — Account Strategy Developer agent probe.
 *
 * Asserts, against a stubbed Anthropic server:
 *   1. strategyGuidance round-trips via PATCH /accounts/:id and shows on the
 *      workspace; editing the strategy (PATCH) indexes an exemplar row.
 *   2. POST .../agents/strategy-developer/run returns 202 immediately;
 *      status polls to "drafted" with a schema-valid, clamped draft; the
 *      prompt sent to the LLM carries the guidance + org-scoped exemplars
 *      (and NEVER exemplars from another org or the account itself).
 *   3. Dismiss leaves the account strategy untouched (audited).
 *   4. Approve applies the clamped draft, audits, and re-indexes the
 *      exemplar; approved run can't be re-used after decision.
 *   5. Restricted personas (employee) get 403 on run/status/approve.
 *
 * Run: pnpm exec tsx tests/crm/strategy-developer-probe.ts
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

// Oversized fields to prove server-side clamping (objective text > 400,
// winHypothesis > 1200, 15 key plays > cap of 12).
const LONG = "x".repeat(600);
const DRAFT_OUTPUT = {
  draftStrategy: {
    objectives: [
      { text: `Grow agentic platform revenue ${LONG}`, targetValue: "$3M", targetDate: "Q4 2026" },
      { text: "Land CFO agenda", targetValue: null, targetDate: null },
    ],
    targetServiceLines: ["Agentic Build", "Applied AI Strategy"],
    winHypothesis: `We win by pairing the CFO agenda with delivery pace. ${"y".repeat(1400)}`,
    keyPlays: Array.from({ length: 15 }, (_, i) => `Play ${i + 1}`),
  },
  rationale: "Built from partner guidance and the research brief.",
  guidanceUsed: "Led with the CFO agenda per the partner's direction.",
  sourcesUsed: ["partner guidance", "research brief", "exemplar: Exemplar SameOrg Co"],
  confidence: "green",
};

let lastPromptBody = "";

async function main() {
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      lastPromptBody = body;
      const text = JSON.stringify(DRAFT_OUTPUT);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_stratprobe",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
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
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "stratprobe-stub-key";

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts, atelierStrategyExemplars, atelierAuditEvents } = D as any;
  const { eq, and, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `strat_${Date.now()}`;
  const partnerId = `u_${runTag}_p`;
  const employeeId = `u_${runTag}_e`;
  const acctMain = `acct_${runTag}_main`;
  const acctExemplar = `acct_${runTag}_ex`; // same org — should be retrievable
  const acctOtherOrg = `acct_${runTag}_xorg`; // other org — must never leak

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;
  const api = async (method: string, path: string, body?: unknown, as = partnerId) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${as}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };
  const pollStatus = async (until: (s: any) => boolean, tries = 240) => {
    let s: any = null;
    for (let i = 0; i < tries; i++) {
      const r = await api("GET", `/accounts/${acctMain}/agents/strategy-developer/status`);
      s = r.body;
      if (until(s)) return s;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    return s;
  };

  try {
    await db.insert(atelierUsers).values([
      {
        id: partnerId,
        orgId: "aico",
        name: "Strat Probe Partner",
        initials: "SP",
        email: `${runTag}-p@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
      {
        id: employeeId,
        orgId: "aico",
        name: "Strat Probe Employee",
        initials: "SE",
        email: `${runTag}-e@example.test`,
        role: "employee",
        roleLabel: "Consultant",
        title: "Consultant",
      },
    ] as any);
    await db.insert(atelierAccounts).values([
      {
        id: acctMain,
        orgId: "aico",
        name: `Strat Probe Main Co ${runTag}`,
        country: "AE",
        sector: "Consulting",
        tier: "B",
        partnerOwnerId: partnerId,
      },
      {
        id: acctExemplar,
        orgId: "aico",
        name: "Exemplar SameOrg Co",
        country: "AE",
        sector: "Consulting",
        tier: "B",
        partnerOwnerId: partnerId,
        accountStrategy: {
          objectives: [{ id: "obj_ex1", text: "Expand data platform footprint", targetValue: "$1M", targetDate: null }],
          targetServiceLines: ["Data Platforms"],
          winHypothesis: "Win on delivery credibility with the COO.",
          keyPlays: ["Quarterly exec briefing cadence"],
        },
      },
      {
        id: acctOtherOrg,
        orgId: "other_org",
        name: "CrossOrg Leak Co",
        country: "AE",
        sector: "Consulting",
        tier: "B",
        partnerOwnerId: partnerId,
        accountStrategy: {
          objectives: [{ id: "obj_x1", text: "SECRET cross-org objective", targetValue: null, targetDate: null }],
          targetServiceLines: ["Secret Line"],
          winHypothesis: "SECRET cross-org hypothesis marker.",
          keyPlays: ["SECRET play"],
        },
      },
    ] as any);

    // Index the exemplar rows directly (simulating prior strategy writes).
    const { indexAccountStrategyExemplar } = await import(
      "../../src/lib/atelier-agents/strategy-exemplars.js"
    );
    await indexAccountStrategyExemplar(acctExemplar);
    await indexAccountStrategyExemplar(acctOtherOrg);
    const exRows = await db
      .select()
      .from(atelierStrategyExemplars)
      .where(inArray(atelierStrategyExemplars.accountId, [acctExemplar, acctOtherOrg]));
    check("exemplar indexing writes both rows", exRows.length === 2, exRows.length);

    // ---- 1. Partner guidance round-trip + PATCH-triggered indexing ----
    const guidanceText = "Lead with the CFO agenda; avoid competing on price.";
    const patch = await api("PATCH", `/accounts/${acctMain}`, {
      strategyGuidance: guidanceText,
      accountStrategy: {
        objectives: [{ id: "obj_probe1", text: "Existing modest objective" }],
        targetServiceLines: [],
        winHypothesis: "Old hypothesis.",
        keyPlays: [],
      },
    });
    check("PATCH guidance+strategy -> 200", patch.status === 200, patch.status);
    check("workspace echoes strategyGuidance", patch.body?.account?.strategyGuidance === guidanceText, patch.body?.account?.strategyGuidance);
    // fire-and-forget indexing — give it a moment
    await new Promise((r) => setTimeout(r, 2500));
    const [mainEx] = await db
      .select()
      .from(atelierStrategyExemplars)
      .where(eq(atelierStrategyExemplars.accountId, acctMain));
    check("PATCH strategy indexed own exemplar", !!mainEx, mainEx?.accountId);

    // ---- 2. Run: instant 202, drafted status, prompt contents ----
    const t0 = Date.now();
    const run = await api("POST", `/accounts/${acctMain}/agents/strategy-developer/run`, {});
    check("run -> 202 immediately", run.status === 202 && Date.now() - t0 < 1500, { status: run.status, ms: Date.now() - t0 });
    const settled = await pollStatus((s) => s?.status && s.status !== "running" && s.status !== "idle");
    check("status settles to drafted", settled?.status === "drafted", settled?.status ?? settled);
    check("drafted status carries runId", typeof settled?.runId === "string" && settled.runId.length > 0, settled?.runId);
    const draft = settled?.draft;
    check("draft present with rationale + sources", !!draft?.draftStrategy && typeof draft?.rationale === "string" && Array.isArray(draft?.sourcesUsed), draft && Object.keys(draft));
    const ds = draft?.draftStrategy ?? {};
    check("clamp: objective text <= 400", (ds.objectives ?? []).every((o: any) => o.text.length <= 400 && typeof o.id === "string"), ds.objectives?.[0]?.text?.length);
    check("clamp: winHypothesis <= 1200", (ds.winHypothesis ?? "").length <= 1200, ds.winHypothesis?.length);
    check("clamp: keyPlays <= 12", (ds.keyPlays ?? []).length <= 12, ds.keyPlays?.length);
    check("status includes current strategy for side-by-side", settled?.currentStrategy?.winHypothesis === "Old hypothesis.", settled?.currentStrategy);
    check("status includes guidance", settled?.strategyGuidance === guidanceText, settled?.strategyGuidance);
    // Prompt inspection: guidance + same-org exemplar in, cross-org + self out.
    check("prompt carries partner guidance", lastPromptBody.includes("CFO agenda"), null);
    check("prompt carries same-org exemplar", lastPromptBody.includes("Exemplar SameOrg Co"), null);
    check("prompt NEVER carries cross-org exemplar", !lastPromptBody.includes("SECRET cross-org"), null);
    check(
      "prompt excludes the account's own exemplar from exemplarStrategies",
      !lastPromptBody.includes(`Strat Probe Main Co ${runTag}\\`) ||
        !JSON.parse(JSON.parse(lastPromptBody).messages[0].content).exemplarStrategies?.some?.(
          (e: any) => e.accountName?.includes("Main Co"),
        ),
      null,
    );

    // ---- 3. Dismiss leaves strategy untouched ----
    const dismissRunId = settled.runId;
    const dismiss = await api("POST", `/accounts/${acctMain}/agents/strategy-developer/dismiss`, { runId: dismissRunId, reason: "not yet" });
    check("dismiss -> ok", dismiss.status === 200 && dismiss.body?.ok === true, dismiss);
    const [afterDismiss] = await db
      .select({ s: atelierAccounts.accountStrategy })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctMain));
    check("dismiss leaves strategy untouched", (afterDismiss?.s as any)?.winHypothesis === "Old hypothesis.", afterDismiss?.s);
    const statusAfterDismiss = await api("GET", `/accounts/${acctMain}/agents/strategy-developer/status`);
    check("dismissed run no longer offered", statusAfterDismiss.body?.status === "idle" && statusAfterDismiss.body?.draft === null, statusAfterDismiss.body?.status);
    const approveDismissed = await api("POST", `/accounts/${acctMain}/agents/strategy-developer/approve`, { runId: dismissRunId });
    check("approving a dismissed run -> 409", approveDismissed.status === 409, approveDismissed.status);

    // ---- 4. Fresh run → approve applies + audits + re-indexes ----
    const run2 = await api("POST", `/accounts/${acctMain}/agents/strategy-developer/run`, {});
    check("second run -> 202", run2.status === 202, run2.status);
    const settled2 = await pollStatus((s) => s?.status === "drafted" && s.runId && s.runId !== dismissRunId);
    check("second draft ready", settled2?.status === "drafted" && settled2.runId !== dismissRunId, settled2?.status);
    const approve = await api("POST", `/accounts/${acctMain}/agents/strategy-developer/approve`, { runId: settled2.runId });
    check("approve -> ok with clamped strategy", approve.status === 200 && approve.body?.ok === true && (approve.body?.accountStrategy?.keyPlays ?? []).length <= 12, approve);
    const [afterApprove] = await db
      .select({ s: atelierAccounts.accountStrategy })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, acctMain));
    const appliedStrategy = afterApprove?.s as any;
    check("approve applied draft to account", appliedStrategy?.winHypothesis?.startsWith("We win by pairing"), appliedStrategy?.winHypothesis?.slice(0, 40));
    check("applied objectives have ids", (appliedStrategy?.objectives ?? []).every((o: any) => typeof o.id === "string" && o.id.length > 0), appliedStrategy?.objectives);
    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(and(eq(atelierAuditEvents.entityId, acctMain), inArray(atelierAuditEvents.action, ["agent.approved", "agent.dismissed"])));
    check(
      "approve + dismiss audited with runIds",
      audits.some((a: any) => a.action === "agent.approved" && a.payload?.runId === settled2.runId) &&
        audits.some((a: any) => a.action === "agent.dismissed" && a.payload?.runId === dismissRunId),
      audits.map((a: any) => a.action),
    );
    await new Promise((r) => setTimeout(r, 2500)); // fire-and-forget re-index
    const [mainEx2] = await db
      .select()
      .from(atelierStrategyExemplars)
      .where(eq(atelierStrategyExemplars.accountId, acctMain));
    check("approve re-indexed exemplar with new text", !!mainEx2 && mainEx2.text.includes("We win by pairing"), mainEx2?.text?.slice(0, 60));
    const statusAfterApprove = await api("GET", `/accounts/${acctMain}/agents/strategy-developer/status`);
    check("approved run no longer offered", statusAfterApprove.body?.status === "idle", statusAfterApprove.body?.status);
    const reApprove = await api("POST", `/accounts/${acctMain}/agents/strategy-developer/approve`, { runId: settled2.runId });
    check("re-approving an approved run -> 409", reApprove.status === 409, reApprove.status);

    // ---- 5. Restricted persona 403s ----
    const empRun = await api("POST", `/accounts/${acctMain}/agents/strategy-developer/run`, {}, employeeId);
    const empStatus = await api("GET", `/accounts/${acctMain}/agents/strategy-developer/status`, undefined, employeeId);
    const empApprove = await api("POST", `/accounts/${acctMain}/agents/strategy-developer/approve`, { runId: settled2.runId }, employeeId);
    check("employee run -> 403", empRun.status === 403, empRun.status);
    check("employee status -> 403", empStatus.status === 403, empStatus.status);
    check("employee approve -> 403", empApprove.status === 403, empApprove.status);
  } finally {
    try {
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [acctMain, acctExemplar, acctOtherOrg]));
      await db.delete(atelierStrategyExemplars).where(inArray(atelierStrategyExemplars.accountId, [acctMain, acctExemplar, acctOtherOrg]));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [acctMain, acctExemplar, acctOtherOrg]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [partnerId, employeeId]));
    } catch (e) {
      console.error("cleanup failed", e);
    }
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
