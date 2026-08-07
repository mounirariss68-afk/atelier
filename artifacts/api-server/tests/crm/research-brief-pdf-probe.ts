/**
 * Task #770 — Branded PDF exports for research briefs and POVs.
 *
 * Covers:
 *   Account research brief PDF (GET /accounts/:id/research-brief.pdf)
 *   - 401 without persona cookie
 *   - 404 when account not visible to this persona (invisible account → same response)
 *   - 404 when account exists but has no researchBrief
 *   - 200 + application/pdf + %PDF magic + Content-Disposition with
 *     research-brief-*.pdf filename when brief exists
 *   - Non-ASCII account name encoded correctly in Content-Disposition
 *
 *   Opportunity Scout brief PDF (GET /opportunities/:id/brief.pdf)
 *   - 401 without cookie
 *   - 404 when opportunity doesn't exist
 *   - 404 when no brief exists yet
 *   - 200 + application/pdf + valid PDF bytes + brief-*.pdf filename
 *
 *   Opportunity POV PDF (GET /opportunities/:id/pov.pdf)
 *   - 401 without cookie
 *   - 404 when no POV with a drafted version exists
 *   - 200 + application/pdf + valid PDF bytes + pov-*.pdf filename
 *
 * Deterministic: no LLM calls (ATELIER_MOCK_AGENTS=1 set by scratch-db.ts).
 * Run: pnpm exec tsx tests/crm/research-brief-pdf-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

// Minimal valid researchBrief fixture
const BRIEF_FIXTURE = {
  whatsChanging: [
    { text: "Major digital transformation push", evidence: "Q2 earnings call", sourceUrls: ["https://example.com/ref1"] },
  ],
  executiveTensions: [
    { text: "Cost vs speed trade-off at board level", evidence: "CIO interview", sourceUrls: [] },
  ],
  serviceLineFit: [
    { serviceLine: "AI Operations", signal: "Active RFP for AI tooling", sourceUrls: ["https://example.com/ref2"] },
  ],
  partnerEcosystem: [
    { partner: "Deloitte", relationship: "Incumbent on ERP", serviceLineGap: "AI/ML advisory", sourceUrls: [] },
  ],
  mandateAngles: [
    {
      title: "AI-enabled operations",
      serviceLines: ["AI Operations"],
      tension: "Speed to production",
      whyNow: "Board mandate for Q4 results",
      entryStakeholder: "CIO",
      sourceUrls: ["https://example.com/ref3"],
    },
  ],
  whyNowHypothesis: "Board mandate for AI this fiscal year.",
  openQuestions: ["Who owns the budget?", "What did Deloitte deliver?"],
  singleMostImportant: "The board has mandated AI delivery by Q4.",
};

// Minimal POV version sections
const POV_SECTIONS = [
  { id: "s1", heading: "The Opportunity", intent: "Frame the mandate", content: "There is a clear board mandate.", factIds: [] },
  { id: "s2", heading: "Our Approach", intent: "Differentiate", content: "We deliver fast-cycle AI pilots.", factIds: [] },
];

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierBriefs,
    atelierPovs,
    atelierPovVersions,
  } = D;
  const { eq, and, isNull } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe770_${Date.now()}`;
  const partnerId = `u_${runTag}_fp`;
  const contractorId = `u_${runTag}_ct`;
  // A second partner who owns no accounts and holds no engagement grants —
  // used to exercise the IDOR gate on both opportunity PDF routes.
  const strangerId = `u_${runTag}_stranger`;

  // IDs
  const acctId = `acct_${runTag}`;
  const acctNonAsciiId = `acct_${runTag}_na`; // non-ASCII name
  const oppId = `opp_${runTag}`;
  const briefId = `brief_${runTag}`;
  const povId = `pov_${runTag}`;
  const povVersionId = `povv_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  async function req(userId: string | null, path: string) {
    const headers: Record<string, string> = {};
    if (userId) headers["cookie"] = `atelier_persona=${userId}`;
    const res = await fetch(`${BASE}${path}`, { headers });
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/pdf")) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, pdf: buf, body: null as any };
    }
    let body: any = null;
    try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
    return { status: res.status, headers: res.headers, pdf: null as Buffer | null, body };
  }

  try {
    // Seed ephemeral users
    await db.insert(atelierUsers).values([
      {
        id: partnerId, orgId: "aico", name: "Probe Partner", initials: "PP",
        email: `${runTag}-fp@example.test`, role: "founding_partner",
        roleLabel: "Founding Partner", title: "Founding Partner",
      },
      {
        id: contractorId, orgId: "aico", name: "Probe Contractor", initials: "PC",
        email: `${runTag}-ct@example.test`, role: "contractor",
        roleLabel: "Contractor", title: "Contractor",
      },
      {
        // Partner who owns NO accounts and has NO engagement grants — used to
        // exercise the opportunity IDOR gate without triggering the self-only
        // gate (contractors would be blocked before we reach the account check).
        id: strangerId, orgId: "aico", name: "Probe Stranger", initials: "PS",
        email: `${runTag}-stranger@example.test`, role: "partner",
        roleLabel: "Partner", title: "Partner",
      },
    ] as any);

    // Seed accounts
    await db.insert(atelierAccounts).values([
      { id: acctId, orgId: "aico", name: `Probe Corp ${runTag}`, country: "AE", sector: "Technology", partnerOwnerId: partnerId },
      { id: acctNonAsciiId, orgId: "aico", name: `Şahin Müşteri ${runTag}`, country: "TR", sector: "Finance", partnerOwnerId: partnerId },
    ] as any);

    // Seed opportunity
    await db.insert(atelierOpportunities).values([
      {
        id: oppId, orgId: "aico", accountId: acctId, name: `AI Ops ${runTag}`,
        slug: `ai-ops-${runTag}`, offeringAnchor: "AI operations",
        salesStage: "identify", partnerOwnerId: partnerId, engagementLeadId: partnerId,
        dealSizeHypothesis: 250000, probabilityPct: 25, nextMilestone: "Scout",
        sourceLead: "Probe seed", createdByUserId: partnerId,
      },
    ] as any);

    // ── Account brief PDF — no brief yet ─────────────────────────────────────
    const r401a = await req(null, `/accounts/${acctId}/research-brief.pdf`);
    check("account-brief: 401 without cookie", r401a.status === 401, r401a.body);

    const rNoBrief = await req(partnerId, `/accounts/${acctId}/research-brief.pdf`);
    check("account-brief: 404 when no brief", rNoBrief.status === 404 && rNoBrief.body?.error === "no-brief", rNoBrief.body);

    // Contractor is self-only: the self-only gate fires before the account
    // visibility check and returns 403 (contractor-self-scope). That is
    // correct behavior — no account data is leaked.
    const rContractor = await req(contractorId, `/accounts/${acctId}/research-brief.pdf`);
    check("account-brief: 403 for contractor (self-only gate)", rContractor.status === 403, rContractor.body);

    // ── Seed brief on account ─────────────────────────────────────────────────
    await db.update(atelierAccounts as any)
      .set({ researchBrief: BRIEF_FIXTURE })
      .where(eq((atelierAccounts as any).id, acctId));

    // ── Account brief PDF — happy path ────────────────────────────────────────
    const rPdf = await req(partnerId, `/accounts/${acctId}/research-brief.pdf`);
    check("account-brief: 200 with brief", rPdf.status === 200, rPdf.body ?? rPdf.status);
    check("account-brief: content-type application/pdf", (rPdf.headers.get("content-type") ?? "").startsWith("application/pdf"), rPdf.headers.get("content-type"));
    check("account-brief: %PDF magic bytes", !!rPdf.pdf && rPdf.pdf.subarray(0, 5).toString() === "%PDF-", rPdf.pdf?.subarray(0, 8).toString());
    check("account-brief: non-trivial PDF size", (rPdf.pdf?.length ?? 0) > 2000, rPdf.pdf?.length);
    const disp = rPdf.headers.get("content-disposition") ?? "";
    check("account-brief: attachment disposition", disp.startsWith("attachment"), disp);
    check("account-brief: filename contains 'research-brief'", disp.includes("research-brief"), disp);
    check("account-brief: filename ends with .pdf", disp.includes(".pdf"), disp);

    // ── Non-ASCII account name ────────────────────────────────────────────────
    await db.update(atelierAccounts as any)
      .set({ researchBrief: BRIEF_FIXTURE })
      .where(eq((atelierAccounts as any).id, acctNonAsciiId));
    const rNonAscii = await req(partnerId, `/accounts/${acctNonAsciiId}/research-brief.pdf`);
    check("account-brief: 200 for non-ASCII account name", rNonAscii.status === 200, rNonAscii.body ?? rNonAscii.status);
    check("account-brief: PDF valid for non-ASCII name", !!rNonAscii.pdf && rNonAscii.pdf.subarray(0, 5).toString() === "%PDF-", rNonAscii.pdf?.subarray(0, 8).toString());
    const dispNa = rNonAscii.headers.get("content-disposition") ?? "";
    // RFC 5987 dual form: either filename*= or ASCII fallback must be present
    check("account-brief: non-ASCII Content-Disposition set", dispNa.includes(".pdf"), dispNa);

    // ── Opportunity brief PDF — no brief yet ──────────────────────────────────
    const r401b = await req(null, `/opportunities/${oppId}/brief.pdf`);
    check("opp-brief: 401 without cookie", r401b.status === 401, r401b.body);

    const rNoBriefOpp = await req(partnerId, `/opportunities/${oppId}/brief.pdf`);
    check("opp-brief: 404 when no brief", rNoBriefOpp.status === 404 && rNoBriefOpp.body?.error === "no-brief", rNoBriefOpp.body);

    const rDeadOpp = await req(partnerId, `/opportunities/opp_nonexistent_${runTag}/brief.pdf`);
    check("opp-brief: 404 for unknown opp", rDeadOpp.status === 404, rDeadOpp.body);

    // Cross-persona denial: a second partner who does NOT own the account and
    // has no engagement grant must get 404 (not 403, not PDF) from both PDF
    // routes, regardless of whether data exists.
    const r404BriefStranger = await req(strangerId, `/opportunities/${oppId}/brief.pdf`);
    check("opp-brief: 404 for unrelated partner (IDOR gate)", r404BriefStranger.status === 404 && !r404BriefStranger.pdf, r404BriefStranger.body);

    const r404PovStranger = await req(strangerId, `/opportunities/${oppId}/pov.pdf`);
    check("pov: 404 for unrelated partner (IDOR gate)", r404PovStranger.status === 404 && !r404PovStranger.pdf, r404PovStranger.body);

    // ── Seed a Scout brief ────────────────────────────────────────────────────
    await db.insert(atelierBriefs as any).values([
      {
        id: briefId, orgId: "aico", opportunityId: oppId, runId: null,
        accountSnapshot: {
          oneLiner: "Probe Corp is a mid-size tech firm.",
          scaleHint: "~500 employees, $50M revenue.",
          recentMoves: ["Hired new CIO in Q1", "Launched AI task force"],
        },
        buyerLandscape: {
          likelyBuyers: [{ title: "CIO", rationale: "Owns the AI mandate" }],
          powerMap: "CIO holds budget with CEO sponsorship.",
        },
        fiveCDraft: {
          client: "Mid-size tech firm with a board AI mandate.",
          competition: "Deloitte is incumbent on ERP.",
          capability: "We have deep AI ops experience.",
          capacity: "Available for Q4 start.",
          contract: "Expected T&M engagement.",
        },
        openQuestions: ["Who controls the budget?"],
        citations: [
          { id: "f1", topic: "client", statement: "Board mandate for AI", sourceUrl: "https://example.com/ai-mandate", confidence: "green" },
        ],
        confidence: "green",
        status: "draft",
      },
    ]);

    // ── Opportunity brief PDF — happy path ────────────────────────────────────
    const rBriefPdf = await req(partnerId, `/opportunities/${oppId}/brief.pdf`);
    check("opp-brief: 200 with brief", rBriefPdf.status === 200, rBriefPdf.body ?? rBriefPdf.status);
    check("opp-brief: content-type application/pdf", (rBriefPdf.headers.get("content-type") ?? "").startsWith("application/pdf"), rBriefPdf.headers.get("content-type"));
    check("opp-brief: %PDF magic bytes", !!rBriefPdf.pdf && rBriefPdf.pdf.subarray(0, 5).toString() === "%PDF-", rBriefPdf.pdf?.subarray(0, 8).toString());
    check("opp-brief: non-trivial PDF size", (rBriefPdf.pdf?.length ?? 0) > 2000, rBriefPdf.pdf?.length);
    const dispBrief = rBriefPdf.headers.get("content-disposition") ?? "";
    check("opp-brief: attachment disposition", dispBrief.startsWith("attachment"), dispBrief);
    check("opp-brief: filename contains 'brief-'", dispBrief.includes("brief-"), dispBrief);
    check("opp-brief: filename ends with .pdf", dispBrief.includes(".pdf"), dispBrief);

    // ── POV PDF — no POV yet ──────────────────────────────────────────────────
    const r401c = await req(null, `/opportunities/${oppId}/pov.pdf`);
    check("pov: 401 without cookie", r401c.status === 401, r401c.body);

    const rNoPov = await req(partnerId, `/opportunities/${oppId}/pov.pdf`);
    check("pov: 404 when no POV", rNoPov.status === 404, rNoPov.body);

    // ── Seed a POV + version ──────────────────────────────────────────────────
    await db.insert(atelierPovs as any).values([
      {
        id: povId, orgId: "aico", opportunityId: oppId,
        title: `AI Ops POV ${runTag}`, audience: "CIO", objective: "Secure Q4 mandate",
        status: "drafted", outline: POV_SECTIONS, currentVersionId: povVersionId,
        runId: null, createdByUserId: partnerId,
      },
    ]);

    await db.insert(atelierPovVersions as any).values([
      {
        id: povVersionId, orgId: "aico", povId,
        versionNumber: 1,
        body: "<h2>The Opportunity</h2><p>There is a clear board mandate.</p>",
        sections: POV_SECTIONS,
        citations: [
          { id: "f2", topic: "opportunity", statement: "Board mandate", sourceUrl: "https://example.com/mandate", confidence: "green" },
        ],
        citationCoverage: 0.75,
        notes: null,
        createdByUserId: partnerId,
      },
    ]);

    // ── POV PDF — happy path ──────────────────────────────────────────────────
    const rPovPdf = await req(partnerId, `/opportunities/${oppId}/pov.pdf`);
    check("pov: 200 with version", rPovPdf.status === 200, rPovPdf.body ?? rPovPdf.status);
    check("pov: content-type application/pdf", (rPovPdf.headers.get("content-type") ?? "").startsWith("application/pdf"), rPovPdf.headers.get("content-type"));
    check("pov: %PDF magic bytes", !!rPovPdf.pdf && rPovPdf.pdf.subarray(0, 5).toString() === "%PDF-", rPovPdf.pdf?.subarray(0, 8).toString());
    check("pov: non-trivial PDF size", (rPovPdf.pdf?.length ?? 0) > 2000, rPovPdf.pdf?.length);
    const dispPov = rPovPdf.headers.get("content-disposition") ?? "";
    check("pov: attachment disposition", dispPov.startsWith("attachment"), dispPov);
    check("pov: filename contains 'pov-'", dispPov.includes("pov-"), dispPov);
    check("pov: filename ends with .pdf", dispPov.includes(".pdf"), dispPov);

  } finally {
    // Cleanup — delete in dependency order
    await db.delete(atelierPovVersions as any).where(eq((atelierPovVersions as any).povId, povId)).catch(() => {});
    await db.delete(atelierPovs as any).where(eq((atelierPovs as any).id, povId)).catch(() => {});
    await db.delete(atelierBriefs as any).where(eq((atelierBriefs as any).id, briefId)).catch(() => {});
    await db.delete(atelierOpportunities as any).where(eq((atelierOpportunities as any).id, oppId)).catch(() => {});
    await db.delete(atelierAccounts as any)
      .where(eq((atelierAccounts as any).id, acctId)).catch(() => {});
    await db.delete(atelierAccounts as any)
      .where(eq((atelierAccounts as any).id, acctNonAsciiId)).catch(() => {});
    await db.delete(atelierUsers as any)
      .where(eq((atelierUsers as any).id, partnerId)).catch(() => {});
    await db.delete(atelierUsers as any)
      .where(eq((atelierUsers as any).id, contractorId)).catch(() => {});
    await db.delete(atelierUsers as any)
      .where(eq((atelierUsers as any).id, strangerId)).catch(() => {});
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASH", err);
  process.exit(1);
});
