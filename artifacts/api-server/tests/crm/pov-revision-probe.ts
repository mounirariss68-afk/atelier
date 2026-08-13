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

// Fact id is decided at runtime (runTag) — the stub reads these mutable refs.
const fixture = {
  factId: "f1",
  /**
   * "good" = valid citations; "hallucinate" = invented fact ids (gate must
   * fail); "dropcitations" = stylist keeps headings but drops every citation
   * from the final HTML (final-output gate must fail even though the
   * first-pass sections were correctly cited).
   */
  mode: "good" as "good" | "hallucinate" | "dropcitations" | "proseheading" | "dupheading" | "h3heading",
};

function outlineOutput() {
  return {
    title: "AI Ops POV",
    thesis: "A board-mandated AI push demands fast-cycle delivery.",
    sections: [
      { id: "s1", heading: "The Mandate", intent: "Frame the board mandate", factIds: [fixture.factId] },
      { id: "s2", heading: "Our Approach", intent: "Differentiate on speed", factIds: [fixture.factId] },
    ],
  };
}

function sectionsOutput() {
  // "dropcitations" keeps the first pass correctly cited — only the stylist
  // output loses the markers.
  const cid = fixture.mode === "hallucinate" ? "f_invented" : fixture.factId;
  return {
    sections: [
      { id: "s1", heading: "The Mandate", body: `There is a clear board mandate. [#${cid}]<script>alert(1)</script>`, citationIds: [cid] },
      { id: "s2", heading: "Our Approach", body: `We deliver fast-cycle AI pilots. [#${cid}]`, citationIds: [cid] },
    ],
  };
}

const CRITIC_OUTPUT = {
  coverage: 0.9,
  voiceFlags: [],
  verdict: "pass",
  notes: "Well grounded.",
  unsupportedClaims: [],
};

function stylistOutput() {
  if (fixture.mode === "dropcitations") {
    return {
      html:
        `<h1>AI Ops POV</h1><h2>The Mandate</h2><p>There is a clear board mandate.</p>` +
        `<h2>Our Approach</h2><p>We deliver fast-cycle AI pilots.</p>`,
      wordCount: 16,
    };
  }
  const cid = fixture.mode === "hallucinate" ? "f_invented" : fixture.factId;
  if (fixture.mode === "proseheading") {
    // Heading text survives only as prose — the gate must require actual
    // heading elements, so this fails even though citations are valid.
    return {
      html:
        `<h1>AI Ops POV</h1><p>The Mandate is clear from the board <sup data-fact="${cid}">1</sup>.</p>` +
        `<p>Our Approach centres on fast pilots <sup data-fact="${cid}">2</sup>.</p>`,
      wordCount: 22,
    };
  }
  if (fixture.mode === "h3heading") {
    // One section demoted from <h2> to <h3> — contract requires <h2>, so
    // that section is fail-closed even with valid citations.
    return {
      html:
        `<h1>AI Ops POV</h1><h2>The Mandate</h2><p>Cited <sup data-fact="${cid}">1</sup>.</p>` +
        `<h3>Our Approach</h3><p>Cited <sup data-fact="${cid}">2</sup>.</p>`,
      wordCount: 18,
    };
  }
  if (fixture.mode === "dupheading") {
    // "The Mandate" appears as TWO h2 elements → ambiguous → that section is
    // fail-closed unsupported; coverage 0.5 < floor → run fails.
    return {
      html:
        `<h1>AI Ops POV</h1><h2>The Mandate</h2><p>Cited <sup data-fact="${cid}">1</sup>.</p>` +
        `<h2>The Mandate</h2><p>Repeated heading.</p>` +
        `<h2>Our Approach</h2><p>Cited <sup data-fact="${cid}">2</sup>.</p>`,
      wordCount: 20,
    };
  }
  return {
    html:
      `<h1>AI Ops POV</h1><h2>The Mandate</h2><p>There is a clear board mandate. <sup data-fact="${cid}">1</sup></p>` +
      `<h2>Our Approach</h2><p>We deliver fast-cycle AI pilots. <sup data-fact="${cid}">1</sup><sup data-fact="f_bogus">9</sup></p><img src=x onerror=alert(1)>`,
    wordCount: 18,
  };
}

const RESEARCH_SYNTH_OUTPUT = {
  facts: [
    {
      topic: "results",
      statement: "Probe Corp revenue rose 12% in H1 2026.",
      sourceUrl: "https://example.test/deep1",
      sourceTitle: "Deep source",
      snippet: "Revenue rose 12% in H1 2026 (2026-08-01).",
      confidence: "green",
    },
    {
      // Valid-looking URL the Perplexity dossier never retrieved — the
      // provenance gate must reject this fact before persistence.
      topic: "results",
      statement: "Probe Corp margin expanded 400bps in H1 2026.",
      sourceUrl: "https://example.test/hallucinated-report",
      sourceTitle: "Invented source",
      snippet: "Margin expanded 400bps.",
      confidence: "green",
    },
  ],
};

function sseBody(res: import("node:http").ServerResponse, text: string) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  ev("message_start", {
    type: "message_start",
    message: { id: "msg_pov_probe", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } },
  });
  ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
  ev("content_block_stop", { type: "content_block_stop", index: 0 });
  ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } });
  ev("message_stop", { type: "message_stop" });
  res.end();
}

async function main() {
  // --- stub Anthropic server, up before the app import ---
  // Multi-pass: each POV phase is a separate call distinguished by its
  // run-time directive marker. Streaming calls (deep-research synthesis) get
  // SSE; the rest get plain JSON messages.
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const out = body.includes("Phase C (critic)")
        ? CRITIC_OUTPUT
        : body.includes("Phase D (stylist)")
          ? stylistOutput()
          : body.includes("Phase B (sections)")
            ? sectionsOutput()
            : body.includes("ATOMIC, verifiable facts")
              ? RESEARCH_SYNTH_OUTPUT
              : outlineOutput();
      const text = JSON.stringify(out);
      if (body.includes('"stream":true')) {
        sseBody(res, text);
        return;
      }
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

  // --- stub Perplexity server (deep-research retrieval), search_results with
  // date + snippet so richer citation metadata flows through ---
  let pplxHits = 0;
  const pplxStub = createServer((req, res) => {
    pplxHits++;
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      // Task #1027 — the re-verify probe fact whose statement carries the
      // dead-source marker gets NO citations back (source dead path).
      const dead = body.includes("DEADSOURCEPROBE");
      res.end(
        JSON.stringify({
          id: "pplx_stub",
          model: "sonar-pro",
          choices: [{ message: { role: "assistant", content: dead ? "No current sources support this." : "Revenue rose 12% in H1 2026." } }],
          search_results: dead
            ? []
            : [
                { url: "https://example.test/deep1", title: "Deep source", date: "2026-08-01", snippet: "Revenue rose 12% in H1 2026." },
              ],
          usage: { prompt_tokens: 5, completion_tokens: 5 },
        }),
      );
    });
  });
  pplxStub.listen(0);
  await new Promise<void>((r) => pplxStub.once("listening", () => r()));
  const pplxPort = (pplxStub.address() as AddressInfo).port;
  process.env.ATELIER_PERPLEXITY_BASE_URL = `http://127.0.0.1:${pplxPort}`;
  process.env.PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY ?? "pov-pplx-stub";
  // scratch-db defaults ATELIER_RESEARCH_PROVIDER to the legacy anthropic
  // path; the deep-research provenance gate needs real Perplexity dossier
  // citations, so force the (stubbed) perplexity provider here.
  process.env.ATELIER_RESEARCH_PROVIDER = "perplexity";

  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierResearchFacts,
    atelierPovs,
  } = D as any;
  const { eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `pov869_${Date.now()}`;
  const partnerId = `u_${runTag}_fp`;
  const acctId = `acct_${runTag}`;
  const oppId = `opp_${runTag}`;
  const factId = `f1_${runTag}`;
  fixture.factId = factId;
  const dupFactId = `f1dup_${runTag}`;

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
      // Near-duplicate of factId (later createdAt) — must surface duplicateOfId.
      {
        id: dupFactId, orgId: "aico", opportunityId: oppId, topic: "Mandate",
        statement: "The board has mandated AI delivery by Q4!",
        sourceUrl: "https://example.com/ref2", sourceTitle: "Q2 call again",
        snippet: "AI mandate", confidence: "amber", promoted: false,
        createdAt: new Date(Date.now() + 1000), retrievedAt: new Date(Date.now() + 1000),
      },
    ] as any);

    // 0. Fact hygiene projection on GET research
    const rFacts0 = await call("GET", `/opportunities/${oppId}/research`);
    const dupRow = (rFacts0.body ?? []).find((f: any) => f.id === dupFactId);
    check("hygiene: near-duplicate flagged with duplicateOfId", dupRow?.duplicateOfId === factId, dupRow);
    check("hygiene: flags object present (lowConfidence for amber)", dupRow?.flags?.lowConfidence === true && dupRow?.flags?.stale === false, dupRow?.flags);
    check("hygiene: retrievedAt exposed", typeof dupRow?.retrievedAt === "string", dupRow?.retrievedAt);

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

    // No snapshot exists yet — it freezes at approval, not outline creation.
    const [povRowPreApprove] = await db.select().from(atelierPovs).where(eq(atelierPovs.id, povId));
    check("snapshot: absent before outline approval", povRowPreApprove?.factSnapshotAt == null, povRowPreApprove?.factSnapshotAt);

    // Evidence changes during outline review: promote the duplicate fact
    // BEFORE approval — it must be captured by the approval-time snapshot.
    const rPromoteDup = await call("POST", `/opportunities/${oppId}/research/${dupFactId}/promote`, { promote: true });
    check("review: dup fact promoted during review", rPromoteDup.status === 200, rPromoteDup.body);

    // Approve the (current) outline run — must NOT flip status to approved.
    const rApproveOutline = await call("POST", `/agent-runs/${newOutlineRunId}/decision`, { decision: "approve", rationale: "ok" });
    check("decision: outline approve 200", rApproveOutline.status === 200, rApproveOutline.body);
    const rAfterApprove = await call("GET", `/opportunities/${oppId}/povs`);
    const povAfterApprove = (rAfterApprove.body ?? []).find((p: any) => p.id === povId);
    check("decision: outline approve keeps status 'outline'", povAfterApprove?.status === "outline", povAfterApprove);

    // Draft/revise are async now: 202 {started} then poll /draft-status.
    async function pollLaunch(id: string = povId): Promise<any> {
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const s = await call("GET", `/povs/${id}/draft-status`);
        if (s.body?.status && s.body.status !== "running") return s.body;
      }
      return { status: "timeout" };
    }

    // Snapshot semantics part 1: the snapshot freezes at APPROVAL, not at
    // outline creation. dupFact was promoted during review (before approval)
    // so it must be inside the snapshot; the approval above must have stamped
    // factSnapshotAt.
    const [povRowAfterApprove] = await db.select().from(atelierPovs).where(eq(atelierPovs.id, povId));
    const snapIds = ((povRowAfterApprove?.factSnapshot ?? []) as any[]).map((f) => f.id);
    check("snapshot: frozen at approval (factSnapshotAt set)", povRowAfterApprove?.factSnapshotAt != null, povRowAfterApprove?.factSnapshotAt);
    check("snapshot: includes fact promoted during outline review", snapIds.includes(factId) && snapIds.includes(dupFactId), snapIds);

    // Snapshot semantics part 2: demote the original fact AFTER approval —
    // the draft must still run on the snapshotted evidence.
    const rDemote = await call("POST", `/opportunities/${oppId}/research/${factId}/promote`, { promote: false });
    check("snapshot: fact demoted post-approval", rDemote.status === 200, rDemote.body);

    // 5. Draft (v1)
    const rDraft = await call("POST", `/povs/${povId}/draft`);
    check("draft: 202 started", rDraft.status === 202 && rDraft.body?.started === true, rDraft.body);
    const dDone = await pollLaunch();
    check("draft: launch done v1 (snapshot evidence despite demotion)", dDone.status === "done" && dDone.versionNumber === 1, dDone);
    const v1Id = dDone.versionId as string;

    // 5a. Deterministic gate sanitization: valid citation kept, bogus stripped,
    // server-computed coverage persisted.
    const rV1 = await call("GET", `/povs/${povId}/versions`);
    const v1Row = (rV1.body ?? []).find((v: any) => v.id === v1Id);
    check("gate: valid data-fact citation kept", (v1Row?.body ?? "").includes(`data-fact="${factId}"`), v1Row?.body);
    check("gate: hallucinated data-fact stripped", !(v1Row?.body ?? "").includes("f_bogus"), v1Row?.body);
    check("gate: server-computed coverage persisted (1.0)", v1Row?.citationCoverage === 1, v1Row?.citationCoverage);

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

    // 10. Hallucinated-citation fixture MUST fail the deterministic gate.
    await call("POST", `/opportunities/${oppId}/research/${factId}/promote`, { promote: true });
    fixture.mode = "hallucinate";
    const rStart2 = await call("POST", `/opportunities/${oppId}/povs`, { title: "Hallucinated POV", audience: "CIO", objective: "Test the gate" });
    check("gate-fail: second POV outline created", rStart2.status === 201, rStart2.body);
    const pov2Id = rStart2.body?.id as string;
    const rApprove2 = await call("POST", `/agent-runs/${rStart2.body?.runId}/decision`, { decision: "approve", rationale: "ok" });
    check("gate-fail: outline approved", rApprove2.status === 200, rApprove2.body);
    const rDraft2 = await call("POST", `/povs/${pov2Id}/draft`);
    check("gate-fail: draft 202 started", rDraft2.status === 202, rDraft2.body);
    const d2 = await pollLaunch(pov2Id);
    check("gate-fail: launch FAILED on invented citations", d2.status === "failed", d2);
    check("gate-fail: error names citation coverage", /citation|coverage|unsupported/i.test(d2.error ?? ""), d2.error);
    const rV2list = await call("GET", `/povs/${pov2Id}/versions`);
    check("gate-fail: no version persisted", (rV2list.body ?? []).length === 0, rV2list.body);
    // 10b. Stylist-drops-citations fixture MUST fail: sections were correctly
    // cited in the first pass, but the FINAL html carries no citations — the
    // gate audits the final output, not the pre-stylist sections.
    fixture.mode = "dropcitations";
    const rStart3 = await call("POST", `/opportunities/${oppId}/povs`, { title: "Dropped Citations POV", audience: "CIO", objective: "Test the final-output gate" });
    check("stylist-drop: third POV outline created", rStart3.status === 201, rStart3.body);
    const pov3Id = rStart3.body?.id as string;
    const rApprove3 = await call("POST", `/agent-runs/${rStart3.body?.runId}/decision`, { decision: "approve", rationale: "ok" });
    check("stylist-drop: outline approved", rApprove3.status === 200, rApprove3.body);
    const rDraft3 = await call("POST", `/povs/${pov3Id}/draft`);
    check("stylist-drop: draft 202 started", rDraft3.status === 202, rDraft3.body);
    const d3 = await pollLaunch(pov3Id);
    check("stylist-drop: launch FAILED when final html lost citations", d3.status === "failed", d3);
    check("stylist-drop: error names citation coverage", /citation|coverage|unsupported/i.test(d3.error ?? ""), d3.error);
    const rV3list = await call("GET", `/povs/${pov3Id}/versions`);
    check("stylist-drop: no version persisted", (rV3list.body ?? []).length === 0, rV3list.body);
    // 10c. Heading kept only as prose (no <h2>) MUST fail: the gate matches
    // actual heading elements, not substrings.
    fixture.mode = "proseheading";
    const rStart4 = await call("POST", `/opportunities/${oppId}/povs`, { title: "Prose Heading POV", audience: "CIO", objective: "Test heading-element matching" });
    check("prose-heading: POV outline created", rStart4.status === 201, rStart4.body);
    const pov4Id = rStart4.body?.id as string;
    const rApprove4 = await call("POST", `/agent-runs/${rStart4.body?.runId}/decision`, { decision: "approve", rationale: "ok" });
    check("prose-heading: outline approved", rApprove4.status === 200, rApprove4.body);
    const rDraft4 = await call("POST", `/povs/${pov4Id}/draft`);
    check("prose-heading: draft 202 started", rDraft4.status === 202, rDraft4.body);
    const d4 = await pollLaunch(pov4Id);
    check("prose-heading: launch FAILED when headings demoted to prose", d4.status === "failed", d4);
    check("prose-heading: error names citation coverage", /citation|coverage|unsupported/i.test(d4.error ?? ""), d4.error);

    // 10d. Duplicated <h2> heading MUST fail: ambiguous match is fail-closed.
    fixture.mode = "dupheading";
    const rStart5 = await call("POST", `/opportunities/${oppId}/povs`, { title: "Duplicate Heading POV", audience: "CIO", objective: "Test duplicate-heading ambiguity" });
    check("dup-heading: POV outline created", rStart5.status === 201, rStart5.body);
    const pov5Id = rStart5.body?.id as string;
    const rApprove5 = await call("POST", `/agent-runs/${rStart5.body?.runId}/decision`, { decision: "approve", rationale: "ok" });
    check("dup-heading: outline approved", rApprove5.status === 200, rApprove5.body);
    const rDraft5 = await call("POST", `/povs/${pov5Id}/draft`);
    check("dup-heading: draft 202 started", rDraft5.status === 202, rDraft5.body);
    const d5 = await pollLaunch(pov5Id);
    check("dup-heading: launch FAILED on ambiguous duplicate heading", d5.status === "failed", d5);
    check("dup-heading: error names citation coverage", /citation|coverage|unsupported/i.test(d5.error ?? ""), d5.error);
    // 10e. Section demoted to <h3> MUST fail: the final-document contract is
    // <h2> exactly.
    fixture.mode = "h3heading";
    const rStart6 = await call("POST", `/opportunities/${oppId}/povs`, { title: "H3 Heading POV", audience: "CIO", objective: "Test h2-only heading contract" });
    check("h3-heading: POV outline created", rStart6.status === 201, rStart6.body);
    const pov6Id = rStart6.body?.id as string;
    const rApprove6 = await call("POST", `/agent-runs/${rStart6.body?.runId}/decision`, { decision: "approve", rationale: "ok" });
    check("h3-heading: outline approved", rApprove6.status === 200, rApprove6.body);
    const rDraft6 = await call("POST", `/povs/${pov6Id}/draft`);
    check("h3-heading: draft 202 started", rDraft6.status === 202, rDraft6.body);
    const d6 = await pollLaunch(pov6Id);
    check("h3-heading: launch FAILED when a section heading is demoted to h3", d6.status === "failed", d6);
    check("h3-heading: error names citation coverage", /citation|coverage|unsupported/i.test(d6.error ?? ""), d6.error);
    fixture.mode = "good";

    // 11. POV deep-research pass (stub Perplexity + stream synthesis).
    const rResearchStatus0 = await call("GET", `/opportunities/${oppId}/pov-research-status`);
    check("research: status idle before run", rResearchStatus0.status === 200 && rResearchStatus0.body?.status === "idle", rResearchStatus0.body);
    const rResearch = await call("POST", `/opportunities/${oppId}/pov-research`, { objective: "Land fast delivery", angles: ["cost pressure"] });
    check("research: 202 started", rResearch.status === 202, rResearch.body);
    let researchDone: any = { status: "timeout" };
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const s = await call("GET", `/opportunities/${oppId}/pov-research-status`);
      if (s.body?.status && s.body.status !== "running" && s.body.status !== "idle") { researchDone = s.body; break; }
    }
    console.log("research status detail:", JSON.stringify(researchDone));
    check("research: run done with facts", researchDone.status === "done" && (researchDone.factCount ?? 0) > 0, researchDone);
    const rFactsAfter = await call("GET", `/opportunities/${oppId}/research`);
    const deepFact = (rFactsAfter.body ?? []).find((f: any) => /revenue rose 12%/i.test(f.statement ?? ""));
    check("research: candidate fact landed unpromoted", !!deepFact && deepFact.promoted === false, deepFact);
    check("research: retrievedAt stamped", typeof deepFact?.retrievedAt === "string", deepFact?.retrievedAt);
    // Provenance gate: the synthesis stub also emitted a fact with a
    // valid-looking URL the dossier never retrieved — it must NOT persist.
    const inventedFact = (rFactsAfter.body ?? []).find((f: any) => /margin expanded 400bps/i.test(f.statement ?? ""));
    check("research: hallucinated-URL fact rejected by provenance gate", inventedFact == null, inventedFact);

    // 12. Task #1027 — fact hygiene actions: merge duplicates + re-verify.
    const hygCanonicalId = `hyg_canon_${runTag}`;
    const hygDupId = `hyg_dup_${runTag}`;
    const hygStaleId = `hyg_stale_${runTag}`;
    const hygDeadId = `hyg_dead_${runTag}`;
    const staleDate = new Date(Date.now() - 400 * 86_400_000);
    await db.insert(atelierResearchFacts).values([
      {
        id: hygCanonicalId, orgId: "aico", opportunityId: oppId, topic: "Hygiene",
        statement: "Hygiene probe alpha statement about market entry timing",
        sourceUrl: "https://example.com/hyg1", sourceTitle: "Hyg source",
        confidence: "green", promoted: false,
      },
      // Near-duplicate, later createdAt, PROMOTED — merge must carry promotion.
      {
        id: hygDupId, orgId: "aico", opportunityId: oppId, topic: "Hygiene",
        statement: "Hygiene probe alpha statement about market entry timing!!",
        sourceUrl: "https://example.com/hyg2", sourceTitle: "Hyg source 2",
        confidence: "amber", promoted: true, promotedAt: new Date(),
        createdAt: new Date(Date.now() + 2000),
      },
      // Stale fact — re-verify succeeds via the pplx stub (has citations).
      {
        id: hygStaleId, orgId: "aico", opportunityId: oppId, topic: "Stale",
        statement: "Old revenue growth claim needing refresh.",
        sourceUrl: "https://example.test/deep1", sourceTitle: "Deep source",
        confidence: "green", retrievedAt: staleDate, createdAt: staleDate,
      },
      // Dead-source fact — stub returns zero citations for this marker.
      {
        id: hygDeadId, orgId: "aico", opportunityId: oppId, topic: "Dead",
        statement: "DEADSOURCEPROBE claim whose source vanished.",
        sourceUrl: "https://example.com/gone", sourceTitle: "Gone",
        confidence: "amber", retrievedAt: staleDate, createdAt: staleDate,
      },
    ] as any);

    // Merge on a non-duplicate → 409.
    const rMergeNotDup = await call("POST", `/opportunities/${oppId}/research/${hygStaleId}/merge`);
    check("merge: 409 when not flagged duplicate", rMergeNotDup.status === 409 && rMergeNotDup.body?.error === "not-a-duplicate", rMergeNotDup.body);

    // Because the dup is promoted and the canonical is not, the projection
    // makes the PROMOTED copy canonical → the unpromoted alpha is the dup.
    const rHygList = await call("GET", `/opportunities/${oppId}/research`);
    const alphaRow = (rHygList.body ?? []).find((f: any) => f.id === hygCanonicalId);
    check("merge: promoted copy wins canonical in projection", alphaRow?.duplicateOfId === hygDupId, alphaRow);
    const rMerge = await call("POST", `/opportunities/${oppId}/research/${hygCanonicalId}/merge`);
    check("merge: 200 archives the duplicate", rMerge.status === 200 && rMerge.body?.merged === true && rMerge.body?.archivedFactId === hygCanonicalId && rMerge.body?.canonicalFactId === hygDupId, rMerge.body);
    const rHygList2 = await call("GET", `/opportunities/${oppId}/research`);
    check("merge: archived dup gone from list", !(rHygList2.body ?? []).some((f: any) => f.id === hygCanonicalId), null);
    check("merge: replay 404 (already archived)", (await call("POST", `/opportunities/${oppId}/research/${hygCanonicalId}/merge`)).status === 404, null);

    // Promotion carry-over: archive a promoted dup into an unpromoted canonical.
    const carryCanonId = `hyg_carry_c_${runTag}`;
    const carryDupId = `hyg_carry_d_${runTag}`;
    await db.insert(atelierResearchFacts).values([
      { id: carryCanonId, orgId: "aico", opportunityId: oppId, topic: "Carry", statement: "Carry probe beta statement on regulatory approvals timeline", sourceUrl: "https://example.com/c1", confidence: "green", promoted: true, promotedAt: new Date() },
      { id: carryDupId, orgId: "aico", opportunityId: oppId, topic: "Carry", statement: "Carry probe beta statement on regulatory approvals timeline??", sourceUrl: "https://example.com/c2", confidence: "amber", promoted: false, createdAt: new Date(Date.now() + 3000) },
    ] as any);
    const rMergeCarry = await call("POST", `/opportunities/${oppId}/research/${carryDupId}/merge`);
    check("merge: unpromoted dup archives into promoted canonical", rMergeCarry.status === 200 && rMergeCarry.body?.canonicalFactId === carryCanonId && rMergeCarry.body?.carriedPromotion === false, rMergeCarry.body);

    // Re-verify success path: retrievedAt refreshed, stale flag clears.
    const rRev = await call("POST", `/opportunities/${oppId}/research/${hygStaleId}/reverify`);
    check("reverify: 200 verified", rRev.status === 200 && rRev.body?.verified === true, rRev.body);
    check("reverify: retrievedAt refreshed (stale cleared)", rRev.body?.fact?.flags?.stale === false && rRev.body?.fact?.flags?.sourceDead === false, rRev.body?.fact);
    check("reverify: snippet refreshed from retrieval", /Revenue rose 12%/i.test(rRev.body?.fact?.snippet ?? ""), rRev.body?.fact?.snippet);
    check("reverify: partner-reviewed sourceUrl NOT overwritten", rRev.body?.fact?.sourceUrl === "https://example.test/deep1", rRev.body?.fact?.sourceUrl);

    // Re-verify dead path: zero citations → sourceDeadAt stamped.
    const rDead = await call("POST", `/opportunities/${oppId}/research/${hygDeadId}/reverify`);
    check("reverify: dead source marked", rDead.status === 200 && rDead.body?.verified === false && rDead.body?.fact?.flags?.sourceDead === true, rDead.body);
    const rHygList3 = await call("GET", `/opportunities/${oppId}/research`);
    const deadRow = (rHygList3.body ?? []).find((f: any) => f.id === hygDeadId);
    check("reverify: sourceDead flag surfaces in list projection", deadRow?.flags?.sourceDead === true, deadRow?.flags);

    // Object-level authorization: a persona who cannot see the account must
    // get a non-oracular 404 from merge AND reverify, with no fact mutation
    // and NO external retrieval spend.
    const outsiderId = `u_${runTag}_emp`;
    await db.insert(atelierUsers).values({
      id: outsiderId, orgId: "aico", email: `${outsiderId}@test.local`, name: "Probe Outsider",
      initials: "PO", role: "consultant", roleLabel: "Consultant", title: "Probe",
    } as any);
    const callAs = async (uid: string, method: string, path: string) => {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "content-type": "application/json", cookie: `atelier_persona=${uid}` },
      });
      let b: any = null;
      try { b = await res.json(); } catch {}
      return { status: res.status, body: b };
    };
    const hitsBefore = pplxHits;
    const rOutMerge = await callAs(outsiderId, "POST", `/opportunities/${oppId}/research/${hygStaleId}/merge`);
    check("authz: out-of-scope merge → 404 (non-oracular)", rOutMerge.status === 404 && rOutMerge.body?.error === "opportunity-not-found", rOutMerge);
    const rOutRev = await callAs(outsiderId, "POST", `/opportunities/${oppId}/research/${hygStaleId}/reverify`);
    check("authz: out-of-scope reverify → 404 (non-oracular)", rOutRev.status === 404 && rOutRev.body?.error === "opportunity-not-found", rOutRev);
    check("authz: no external retrieval on denied reverify", pplxHits === hitsBefore, pplxHits - hitsBefore);
    const [staleStill] = await db.select().from(atelierResearchFacts).where(eq(atelierResearchFacts.id, hygStaleId));
    check("authz: denied merge mutated nothing (fact still live)", staleStill != null && staleStill.deletedAt == null, staleStill?.deletedAt);
    await db.delete(atelierUsers).where(eq(atelierUsers.id, outsiderId));

    // Snapshot immutability: the first POV's approval-time snapshot contains
    // factId + dupFactId. Merging dupFactId (archive) must NOT mutate the
    // frozen snapshot.
    const [povRowPreMerge] = await db.select().from(atelierPovs).where(eq(atelierPovs.id, povId));
    const snapBefore = JSON.stringify(povRowPreMerge?.factSnapshot ?? null);
    const rFactsNow = await call("GET", `/opportunities/${oppId}/research`);
    const dupNow = (rFactsNow.body ?? []).find((f: any) => f.id === dupFactId);
    if (dupNow?.duplicateOfId) {
      const rMergeSnap = await call("POST", `/opportunities/${oppId}/research/${dupFactId}/merge`);
      check("snapshot-immutability: merge of snapshotted fact 200", rMergeSnap.status === 200, rMergeSnap.body);
    } else {
      // The original fact was demoted earlier; archive whichever side is dup.
      const origNow = (rFactsNow.body ?? []).find((f: any) => f.id === factId);
      const target = origNow?.duplicateOfId ? factId : dupFactId;
      const rMergeSnap = await call("POST", `/opportunities/${oppId}/research/${target}/merge`);
      check("snapshot-immutability: merge of snapshotted fact 200", rMergeSnap.status === 200, rMergeSnap.body);
    }
    const [povRowPostMerge] = await db.select().from(atelierPovs).where(eq(atelierPovs.id, povId));
    check("snapshot-immutability: factSnapshot byte-identical after merge", JSON.stringify(povRowPostMerge?.factSnapshot ?? null) === snapBefore, null);

    // Audit trail entries exist for merge + reverify.
    const rAudit = await call("GET", `/audit?limit=100`);
    const auditActions = (rAudit.body ?? []).map((a: any) => a.action);
    check("audit: fact.merge recorded", auditActions.includes("fact.merge"), auditActions.slice(0, 10));
    check("audit: fact.reverified recorded", auditActions.includes("fact.reverified"), null);
    check("audit: fact.source_dead recorded", auditActions.includes("fact.source_dead"), null);
  } finally {
    server.close();
    stub.close();
    pplxStub.close();
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
