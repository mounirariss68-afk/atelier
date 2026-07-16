/**
 * Task #9 probe — verifies the enriched brief envelope end-to-end:
 * boots the app in-process, provisions an ephemeral founding_partner +
 * account + opportunity (runScout:false), inserts a brief row directly,
 * then asserts GET /brief returns fiveCFactIds / completeness / ageDays /
 * refreshRecommended. Also unit-checks the pure brief-quality helpers.
 * Cleans up all rows in finally. Run: pnpm exec tsx tests/crm/brief-quality-probe.ts
 */
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts, atelierOpportunities, atelierBriefs } = D;
  const { eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const bq = await import("../../src/lib/atelier-agents/brief-quality.js");

  // --- unit checks on the pure helpers ---
  const facts = [
    { id: "f1", topic: "market", statement: "Acme dominates regional logistics software market", sourceUrl: "https://x.com/a", confidence: "green" },
    { id: "f2", topic: "competitor", statement: "Rival CorpZ won the logistics software tender", sourceUrl: null, confidence: "amber" },
    { id: "f3", topic: "hq", statement: "zzz qqq", confidence: "red" },
  ] as any[];
  const links = bq.linkFactsToFiveC(
    { client: "Acme is a regional logistics software leader dominating its market", competition: "CorpZ rival won a major logistics software tender recently" },
    facts,
  );
  check("linkFactsToFiveC matches client→f1", links.client.includes("f1"), links);
  check("linkFactsToFiveC matches competition→f2", links.competition.includes("f2"), links);
  check("linkFactsToFiveC empty for blank section", links.contract.length === 0);

  const comp = bq.computeBriefCompleteness(
    { accountSnapshot: { oneLiner: "x", scaleHint: "", recentMoves: [] } as any, fiveCDraft: { client: "a" } as any, openQuestions: [] },
    facts,
  );
  check("completeness flags missing sections", comp.missingSections.includes("fiveC.contract") && comp.missingSections.includes("openQuestions"), comp);
  check("completeness sourcedFactCount", comp.sourcedFactCount === 1, comp);
  check("completeness confidenceMix", comp.confidenceMix.green === 1 && comp.confidenceMix.amber === 1 && comp.confidenceMix.red === 1, comp.confidenceMix);

  // --- account-side helpers (Task #9 account brief quality) ---
  const acctBrief = {
    whatsChanging: [
      { text: "Acme expanding regional logistics footprint into Saudi market", evidence: "press release", sourceUrls: ["https://x.com/a"] },
    ],
    executiveTensions: [{ text: "COO under margin pressure from fuel costs", evidence: "", sourceUrls: [] }],
    serviceLineFit: [],
    partnerEcosystem: [],
    mandateAngles: [],
    whyNowHypothesis: "Acme regional logistics expansion into Saudi creates an ops mandate now",
    openQuestions: ["Budget owner?"],
    singleMostImportant: "Saudi expansion of the regional logistics footprint is the wedge",
  } as any;
  const nl = bq.linkAccountNarrativeToFacts(acctBrief);
  check("account narrative links whyNow→whatsChanging:0", nl.whyNowHypothesis.includes("whatsChanging:0"), nl);
  check("account narrative links oneThing→whatsChanging:0", nl.singleMostImportant.includes("whatsChanging:0"), nl);
  const acomp = bq.computeAccountBriefCompleteness(acctBrief, [
    { confidence: "green" }, { confidence: "red" },
  ] as any);
  check("account completeness missing serviceLineFit", acomp.missingSections.includes("serviceLineFit"), acomp.missingSections);
  check("account completeness sourced 1/2", acomp.sourcedFactCount === 1 && acomp.factCount === 2, acomp);
  check("account completeness signal mix", acomp.confidenceMix.green === 1 && acomp.confidenceMix.red === 1, acomp.confidenceMix);

  const fresh = bq.briefAge(new Date());
  const old = bq.briefAge(new Date(Date.now() - 40 * 86_400_000));
  check("briefAge fresh", fresh.ageDays === 0 && !fresh.refreshRecommended, fresh);
  check("briefAge stale", old.ageDays === 40 && old.refreshRecommended, old);

  // --- end-to-end envelope check ---
  const runTag = `probe9_${Date.now()}`;
  const userId = `u_${runTag}`;
  const acctId = `acct_${runTag}`;
  let oppId: string | null = null;
  const briefId = `brief_${runTag}`;

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
      name: "Probe Nine",
      initials: "PN",
      email: `${runTag}@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId,
      orgId: "aico",
      name: `Probe Nine Co ${runTag}`,
      country: "AE",
      sector: "Logistics",
      tier: "C",
      partnerOwnerId: userId,
      researchBrief: acctBrief,
      sourceSignals: [
        { kind: "news", title: "Expansion", url: "https://x.com/a", confidence: "green" },
        { kind: "manual", title: "Search", url: "https://s.com/q", confidence: "red" },
      ],
      enrichedAt: new Date(Date.now() - 45 * 86_400_000),
    } as any);

    const created = await api("POST", "/opportunities", {
      accountId: acctId,
      name: `Probe opp ${runTag}`,
      description: "Probe of enriched brief envelope",
      dealSizeUsd: 100000,
      runScout: false,
    });
    check("opp created", created.status === 201, created);
    oppId = created.body?.opportunity?.id ?? created.body?.id ?? null;
    check("opp id present", !!oppId, created.body);

    const oldDate = new Date(Date.now() - 45 * 86_400_000);
    await db.insert(atelierBriefs).values({
      id: briefId,
      orgId: "aico",
      opportunityId: oppId!,
      accountSnapshot: { oneLiner: "Regional logistics software leader", scaleHint: "~2k staff", recentMoves: ["Opened Riyadh office"] },
      buyerLandscape: { likelyBuyers: [{ title: "COO", rationale: "ops mandate" }], powerMap: "COO decides" },
      fiveCDraft: { client: "Acme regional logistics software leader with growing operations", competition: "CorpZ rival logistics software tender winner", capability: "", capacity: "", contract: "" },
      openQuestions: ["Budget cycle?"],
      citations: facts,
      confidence: "amber",
      createdAt: oldDate,
    } as any);

    const got = await api("GET", `/opportunities/${oppId}/brief`);
    check("GET brief 200", got.status === 200, got.status);
    const env = got.body ?? {};
    check("envelope has fiveCFactIds.client", Array.isArray(env.fiveCFactIds?.client) && env.fiveCFactIds.client.includes("f1"), env.fiveCFactIds);
    check("envelope completeness flags capability missing", env.completeness?.missingSections?.includes("fiveC.capability") === true, env.completeness);
    check("envelope completeness score number", typeof env.completeness?.score === "number", env.completeness);
    check("envelope ageDays ~45", env.ageDays === 45, env.ageDays);
    check("envelope refreshRecommended", env.refreshRecommended === true, env.refreshRecommended);

    // --- account workspace researchQuality envelope ---
    const wsRes = await api("GET", `/accounts/${acctId}`);
    check("GET account workspace 200", wsRes.status === 200, wsRes.status);
    const rq = wsRes.body?.account?.researchQuality;
    check("account researchQuality present", !!rq, wsRes.body?.account ? Object.keys(wsRes.body.account) : wsRes.body);
    check("account rq completeness score number", typeof rq?.completeness?.score === "number", rq?.completeness);
    check("account rq missing serviceLineFit", rq?.completeness?.missingSections?.includes("serviceLineFit") === true, rq?.completeness?.missingSections);
    check("account rq narrative link whyNow", rq?.narrativeLinks?.whyNowHypothesis?.includes("whatsChanging:0") === true, rq?.narrativeLinks);
    check("account rq ageDays 45 + refresh", rq?.ageDays === 45 && rq?.refreshRecommended === true, { ageDays: rq?.ageDays, refresh: rq?.refreshRecommended });
  } finally {
    try {
      await db.delete(atelierBriefs).where(eq(atelierBriefs.id, briefId));
      if (oppId) await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, oppId));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, userId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
