/**
 * Task #869 — POV revision loop + bug fixes probe (deterministic, stub LLM).
 *
 * Covers, end to end against the real app + scratch DB:
 *   1. Start POV → outline created (status "outline").
 *   2. Edit title/objective via PATCH; outline edit allowed while in outline.
 *   3. Regenerate the outline with feedback (status stays "outline").
 *   4. Draft-route replay guard: draft only runs while status "outline";
 *      approving the outline does NOT flip the POV to "approved".
 *   5. Approve outline → draft (v1); replaying draft is now 409.
 *   6. Revise with feedback → v2 (prior v1 kept & viewable); currentVersionId
 *      advances; status resets to "drafted".
 *   7. Revise requires feedback (400 on blank).
 *   8. PDF export honours ?povId= / ?versionId= (on-screen POV/version).
 *   9. Outline edit rejected once a draft exists (409 outline-frozen).
 *
 * Both LLM calls are served by a local stub Anthropic server. The draft
 * request is distinguished by the "Phase B (sections)" directive in the body.
 *
 * Run: pnpm exec tsx tests/crm/pov-revision-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

const OUTLINE_OUTPUT = {
  title: "AI Ops POV",
  thesis: "A board-mandated AI push demands fast-cycle delivery.",
  sections: [
    { id: "s1", heading: "The Mandate", intent: "Frame the board mandate", factIds: ["f1"] },
    { id: "s2", heading: "Our Approach", intent: "Differentiate on speed", factIds: ["f1"] },
  ],
};

const DRAFT_OUTPUT = {
  sections: [
    { id: "s1", heading: "The Mandate", body: "There is a clear board mandate.<script>alert(1)</script>", citationIds: ["f1"] },
    { id: "s2", heading: "Our Approach", body: "We deliver fast-cycle AI pilots.", citationIds: ["f1"] },
  ],
  html: "<h1>AI Ops POV</h1><p>There is a clear board mandate.</p><img src=x onerror=alert(1)>",
  citationCoverage: 0.9,
  voiceFlags: [],
  wordCount: 12,
};

async function main() {
  // --- stub Anthropic server, up before the app import ---
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const isDraft = body.includes("Phase B (sections)");
      const text = JSON.stringify(isDraft ? DRAFT_OUTPUT : OUTLINE_OUTPUT);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_pov_probe",
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
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "pov-stub-key";

  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierResearchFacts,
  } = D as any;
  const { eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `pov869_${Date.now()}`;
  const partnerId = `u_${runTag}_fp`;
  const acctId = `acct_${runTag}`;
  const oppId = `opp_${runTag}`;
  const factId = `f1_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  async function call(method: string, path: string, jsonBody?: unknown) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${partnerId}` },
      ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {}),
    });
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/pdf")) {
      return { status: res.status, headers: res.headers, pdf: Buffer.from(await res.arrayBuffer()), body: null as any };
    }
    let b: any = null;
    try { b = await res.json(); } catch { b = null; }
    return { status: res.status, headers: res.headers, pdf: null as Buffer | null, body: b };
  }

  try {
    await db.insert(atelierUsers).values([
      {
        id: partnerId, orgId: "aico", name: "Probe Partner", initials: "PP",
        email: `${runTag}-fp@example.test`, role: "founding_partner",
        roleLabel: "Founding Partner", title: "Founding Partner",
      },
    ] as any);
    await db.insert(atelierAccounts).values([
      { id: acctId, orgId: "aico", name: `Probe Corp ${runTag}`, country: "AE", sector: "Technology", partnerOwnerId: partnerId },
    ] as any);
    await db.insert(atelierOpportunities).values([
      {
        id: oppId, orgId: "aico", accountId: acctId, name: `AI Ops ${runTag}`,
        slug: `ai-ops-${runTag}`, offeringAnchor: "AI operations",
        salesStage: "identify", partnerOwnerId: partnerId, engagementLeadId: partnerId,
        dealSizeHypothesis: 250000, probabilityPct: 25, nextMilestone: "Scout",
        sourceLead: "Probe seed", createdByUserId: partnerId,
      },
    ] as any);
    await db.insert(atelierResearchFacts).values([
      {
        id: factId, orgId: "aico", opportunityId: oppId, topic: "Mandate",
        statement: "The board has mandated AI delivery by Q4.",
        sourceUrl: "https://example.com/ref1", sourceTitle: "Q2 call",
        snippet: "AI mandate", confidence: "green", promoted: true,
      },
    ] as any);

    // 1. Start POV → outline
    const rStart = await call("POST", `/opportunities/${oppId}/povs`, { title: "AI Ops POV", audience: "CIO", objective: "Land fast delivery" });
    check("start: 201 outline created", rStart.status === 201 && rStart.body?.status === "outline", rStart.body);
    const povId = rStart.body?.id as string;
    check("start: outline has sections", (rStart.body?.outline?.length ?? 0) === 2, rStart.body?.outline);
    const outlineRunId = rStart.body?.runId as string;

    // 2. PATCH title/objective
    const rPatch = await call("PATCH", `/povs/${povId}`, { title: "AI Ops POV v2", objective: "Land board-level fast delivery" });
    check("patch: 200 title updated", rPatch.status === 200 && rPatch.body?.title === "AI Ops POV v2", rPatch.body);
    check("patch: objective updated", rPatch.body?.objective === "Land board-level fast delivery", rPatch.body);

    // 2b. Outline edit allowed while in outline
    const editedOutline = [
      { id: "s1", heading: "The Mandate (edited)", intent: "Frame it", factIds: [factId] },
      { id: "s2", heading: "Approach", intent: "Speed", factIds: [factId] },
      { id: "s3", heading: "Risk", intent: "Delivery risk", factIds: [] },
    ];
    const rEditOutline = await call("PATCH", `/povs/${povId}`, { outline: editedOutline });
    check("patch: outline editable in outline status", rEditOutline.status === 200 && rEditOutline.body?.outline?.length === 3, rEditOutline.body);

    // 3. Regenerate outline with feedback
    const rRegen = await call("POST", `/povs/${povId}/outline/regenerate`, { feedback: "Lead with cost tension." });
    check("regenerate: 200 status still outline", rRegen.status === 200 && rRegen.body?.status === "outline", rRegen.body);
    check("regenerate: new outline run id", typeof rRegen.body?.runId === "string" && rRegen.body.runId !== outlineRunId, { was: outlineRunId, now: rRegen.body?.runId });
    const newOutlineRunId = rRegen.body?.runId as string;

    // 4. Draft without outline approval → 412
    const rDraftNoApprove = await call("POST", `/povs/${povId}/draft`);
    check("draft: 412 without outline approval", rDraftNoApprove.status === 412 && rDraftNoApprove.body?.error === "outline-not-approved", rDraftNoApprove.body);

    // Approve the (current) outline run — must NOT flip status to approved.
    const rApproveOutline = await call("POST", `/agent-runs/${newOutlineRunId}/decision`, { decision: "approve", rationale: "ok" });
    check("decision: outline approve 200", rApproveOutline.status === 200, rApproveOutline.body);
    const rAfterApprove = await call("GET", `/opportunities/${oppId}/povs`);
    const povAfterApprove = (rAfterApprove.body ?? []).find((p: any) => p.id === povId);
    check("decision: outline approve keeps status 'outline'", povAfterApprove?.status === "outline", povAfterApprove);

    // Draft/revise are async now: 202 {started} then poll /draft-status.
    async function pollLaunch(): Promise<any> {
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const s = await call("GET", `/povs/${povId}/draft-status`);
        if (s.body?.status && s.body.status !== "running") return s.body;
      }
      return { status: "timeout" };
    }

    // 5. Draft (v1)
    const rDraft = await call("POST", `/povs/${povId}/draft`);
    check("draft: 202 started", rDraft.status === 202 && rDraft.body?.started === true, rDraft.body);
    const dDone = await pollLaunch();
    check("draft: launch done v1", dDone.status === "done" && dDone.versionNumber === 1, dDone);
    const v1Id = dDone.versionId as string;

    // 5b. Replay draft → 409
    const rDraftReplay = await call("POST", `/povs/${povId}/draft`);
    check("draft: replay 409 (already drafted)", rDraftReplay.status === 409 && rDraftReplay.body?.error === "pov-already-drafted", rDraftReplay.body);

    // 6. Revise → v2
    const rRevise = await call("POST", `/povs/${povId}/revise`, { feedback: "Sharpen the close.", baseVersionId: v1Id });
    check("revise: 202 started", rRevise.status === 202 && rRevise.body?.started === true, rRevise.body);
    const rDone = await pollLaunch();
    check("revise: launch done v2", rDone.status === "done" && rDone.versionNumber === 2, rDone);
    const v2Id = rDone.versionId as string;

    const rVersions = await call("GET", `/povs/${povId}/versions`);
    check("revise: both versions kept", (rVersions.body ?? []).length === 2, rVersions.body?.map((v: any) => v.versionNumber));
    const rPovList = await call("GET", `/opportunities/${oppId}/povs`);
    const povNow = (rPovList.body ?? []).find((p: any) => p.id === povId);
    check("revise: currentVersionId advanced to v2", povNow?.currentVersionId === v2Id, povNow?.currentVersionId);
    check("revise: status reset to 'drafted'", povNow?.status === "drafted", povNow?.status);

    // 7. Revise requires feedback
    const rReviseBlank = await call("POST", `/povs/${povId}/revise`, { feedback: "   " });
    check("revise: 400 on blank feedback", rReviseBlank.status === 400, rReviseBlank.body);

    // 8. PDF honours povId + versionId
    const rPdfV1 = await call("GET", `/opportunities/${oppId}/pov.pdf?povId=${povId}&versionId=${v1Id}`);
    check("pdf: 200 for pinned v1", rPdfV1.status === 200 && !!rPdfV1.pdf && rPdfV1.pdf.subarray(0, 5).toString() === "%PDF-", rPdfV1.status);
    const rPdfDefault = await call("GET", `/opportunities/${oppId}/pov.pdf?povId=${povId}`);
    check("pdf: 200 default current version", rPdfDefault.status === 200 && !!rPdfDefault.pdf, rPdfDefault.status);
    const rPdfBadVersion = await call("GET", `/opportunities/${oppId}/pov.pdf?povId=${povId}&versionId=povv_missing`);
    check("pdf: 404 for unknown version", rPdfBadVersion.status === 404, rPdfBadVersion.body);

    // 9. Outline edit rejected once drafted
    const rEditFrozen = await call("PATCH", `/povs/${povId}`, { outline: editedOutline });
    check("patch: outline frozen after draft (409)", rEditFrozen.status === 409 && rEditFrozen.body?.error === "outline-frozen", rEditFrozen.body);

    // 9b. Regenerate rejected once drafted
    const rRegenFrozen = await call("POST", `/povs/${povId}/outline/regenerate`, { feedback: "x" });
    check("regenerate: 409 after draft exists", rRegenFrozen.status === 409, rRegenFrozen.body);
  } finally {
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll POV revision probe checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
