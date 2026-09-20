/**
 * Task #1389 — persisted Agents operations boundary probe.
 *
 * Uses the isolated scratch DB and deterministic rows only; no provider or
 * agent execution is invoked. Run with:
 *   pnpm --filter @workspace/api-server test:agent-operations
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
import "../crm/scratch-db.js";
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
  const { db, pool, atelierUsers, atelierAccounts, atelierAgents, atelierAgentRuns, atelierAuditEvents, atelierPrompts } = D;
  const { and, eq, ilike, inArray } = await import("drizzle-orm");
  const { default: app } = await import("../../src/app.js");
  const tag = `agent_ops_${Date.now()}`;
  const orgA = `org_${tag}_a`;
  const orgB = `org_${tag}_b`;
  const userA = `user_${tag}_a`;
  const userB = `user_${tag}_b`;
  const userC = `user_${tag}_c`;
  const runA = `run_${tag}_a`;
  const runB = `run_${tag}_b`;
  const runC = `run_${tag}_c`;
  const runUnknown = `run_${tag}_unknown`;
  const runRegistryA = `run_${tag}_registry_a`;
  const runRegistryB = `run_${tag}_registry_b`;
  const accountC = `acct_${tag}_c`;
  const ids = [userA, userB, userC, runA, runB, runC, runUnknown, runRegistryA, runRegistryB, accountC, `ag_missing_${tag}`, `ag_stub_${tag}`, `ag_pursuit_scout`];
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (method: string, path: string, persona: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${persona}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values([
      {
        id: userA, orgId: orgA, name: "Agent Ops A", initials: "AO",
        email: `${userA}@example.test`, role: "founding_partner",
        roleLabel: "Founding Partner", title: "Founding Partner",
      },
      {
        id: userB, orgId: orgB, name: "Agent Ops B", initials: "BO",
        email: `${userB}@example.test`, role: "founding_partner",
        roleLabel: "Founding Partner", title: "Founding Partner",
      },
      {
        id: userC, orgId: orgA, name: "Agent Ops C", initials: "CO",
        email: `${userC}@example.test`, role: "consultant",
        roleLabel: "Consultant", title: "Consultant",
      },
    ] as any);
    await db.insert(atelierAccounts).values({
      id: accountC, orgId: orgA, name: "Out of scope", country: "AE", sector: "Technology",
      partnerOwnerId: userA,
    } as any);
    await db.insert(atelierAgents).values([
      {
        id: "ag_pursuit_scout", orgId: orgA, name: "stale name", group: "Atelier",
        stage: "Pursue", purpose: "stale", model: "stale", status: "stub",
      },
      {
        id: `ag_missing_${tag}`, orgId: orgA, name: "Missing runtime", group: "Atelier",
        stage: "Pursue", purpose: "not executable", model: "none", status: "mvp",
      },
      {
        id: `ag_stub_${tag}`, orgId: orgA, name: "Stub runtime", group: "Atelier",
        stage: "Pursue", purpose: "not executable", model: "none", status: "stub",
      },
    ] as any);
    await db.insert(atelierAgentRuns).values([
      {
        id: runA, orgId: orgA, agentId: "ag_pursuit_scout", triggeredByUserId: userA,
        inputs: { accountName: "Persisted target" }, output: { answer: "stable" },
        steps: [{ index: 1, message: "complete" }], toolCalls: [],
        humanDecisions: [], status: "complete", statusMessage: "Done",
        progressPct: 100, sourcesCount: 2, costUsd: 0.0123, durationMs: 321,
        targetType: null, targetId: null, targetLabel: null,
      },
      {
        id: runB, orgId: orgB, agentId: "ag_pursuit_scout", triggeredByUserId: userB,
        inputs: { accountName: "Tenant B" }, output: { answer: "private" },
        steps: [], toolCalls: [], humanDecisions: [], status: "complete",
      },
      {
        id: runC, orgId: orgA, agentId: "ag_pursuit_scout", triggeredByUserId: userA,
        inputs: {}, output: { answer: "restricted" }, steps: [], toolCalls: [], humanDecisions: [],
        status: "complete", targetType: "account", targetId: accountC, targetLabel: "Out of scope",
      },
      {
        id: runUnknown, orgId: orgA, agentId: "ag_pursuit_scout", triggeredByUserId: userA,
        inputs: {}, output: { answer: "unknown" }, steps: [], toolCalls: [], humanDecisions: [],
        status: "complete", targetType: "future_target", targetId: "future_1", targetLabel: "Unknown",
      },
      {
        id: runRegistryA, orgId: orgA, agentId: "ag_pov_author", triggeredByUserId: userA,
        inputs: {}, output: { answer: "registry-backed" }, steps: [], toolCalls: [], humanDecisions: [],
        status: "complete",
      },
      {
        id: runRegistryB, orgId: orgB, agentId: "ag_pov_author", triggeredByUserId: userB,
        inputs: {}, output: { answer: "foreign" }, steps: [], toolCalls: [], humanDecisions: [],
        status: "complete",
      },
    ] as any);

    const catalogue = await api("GET", "/agents", userA);
    const catalogueIds = (catalogue.body ?? []).map((x: any) => x.id);
    check("catalogue returns executable runtime row", catalogueIds.includes("ag_pursuit_scout"), catalogue.body);
    const unavailableMissing = catalogue.body.find((a: any) => a.id === `ag_missing_${tag}`);
    const unavailableStub = catalogue.body.find((a: any) => a.id === `ag_stub_${tag}`);
    check("catalogue marks runtime-missing row unavailable", unavailableMissing?.executable === false, catalogue.body);
    check("catalogue marks stub row unavailable", unavailableStub?.executable === false, catalogue.body);
    const registryBacked = catalogue.body.find((a: any) => a.id === "ag_pov_author");
    check("registry agent appears without a catalogue row", registryBacked?.executable === true, catalogue.body);
    check("registry run count is org scoped", registryBacked?.runsLast30d === 1, registryBacked);

    const basePrompt = await api("GET", "/agents/ag_pov_author/prompt", userA);
    check("full filesystem prompt is readable", basePrompt.status === 200 &&
      basePrompt.body?.source === "filesystem" &&
      typeof basePrompt.body?.body === "string" &&
      basePrompt.body.body.length > 20, basePrompt);
    const deniedPromptEdit = await api("PUT", "/agents/ag_pov_author/prompt", userC, {
      body: "Consultants must not be able to replace agent prompts.",
    });
    check("non-partner prompt edit is denied", deniedPromptEdit.status === 403, deniedPromptEdit);
    const firstPromptEdit = await api("PUT", "/agents/ag_pov_author/prompt", userA, {
      body: "Organisation A prompt override version one.",
    });
    check("partner can create an active prompt override", firstPromptEdit.status === 200 &&
      firstPromptEdit.body?.source === "override" &&
      firstPromptEdit.body?.version === 1, firstPromptEdit);
    const foreignPrompt = await api("GET", "/agents/ag_pov_author/prompt", userB);
    check("prompt overrides are isolated by organisation", foreignPrompt.status === 200 &&
      foreignPrompt.body?.source === "filesystem" &&
      foreignPrompt.body?.body !== firstPromptEdit.body?.body, foreignPrompt);
    const secondPromptEdit = await api("PUT", "/agents/ag_pov_author/prompt", userA, {
      body: "Organisation A prompt override version two.",
    });
    check("prompt edits create immutable versions", secondPromptEdit.status === 200 &&
      secondPromptEdit.body?.version === 2, secondPromptEdit);
    const promptVersions = await db.select().from(atelierPrompts).where(and(
      eq(atelierPrompts.orgId, orgA),
      eq(atelierPrompts.agentId, "ag_pov_author"),
    ));
    check("only the latest prompt version is active", promptVersions.length === 2 &&
      promptVersions.filter((row) => row.status === "active").length === 1 &&
      promptVersions.some((row) => row.status === "deprecated"), promptVersions);
    const { resolveEffectiveAgentPrompt } = await import("../../src/lib/atelier-agents/loader.js");
    const runtimePrompt = await resolveEffectiveAgentPrompt({ orgId: orgA, agentId: "pov_author" });
    check("bare runner id resolves the canonical org override", runtimePrompt.source === "override" &&
      runtimePrompt.body === secondPromptEdit.body?.body, runtimePrompt);

    const first = await api("GET", `/agent-runs/${runA}`, userA);
    const second = await api("GET", `/agent-runs/${runA}`, userA);
    check("same-org run detail is readable", first.status === 200);
    check("persisted run detail survives repeated GET", JSON.stringify(first.body) === JSON.stringify(second.body));
    check("authoritative run fields survive refresh", first.body?.status === "complete" &&
      first.body?.progressPct === 100 && first.body?.costUsd === 0.0123 &&
      first.body?.durationMs === 321 && first.body?.sourcesCount === 2);

    const foreignGet = await api("GET", `/agent-runs/${runB}`, userA);
    const foreignDecision = await api("POST", `/agent-runs/${runB}/decision`, userA, {
      decision: "approve", rationale: "cross-org probe",
    });
    check("org A cannot get org B run", foreignGet.status === 404, foreignGet);
    check("org A cannot decide org B run", foreignDecision.status === 404, foreignDecision);
    const restrictedList = await api("GET", "/agents/ag_pursuit_scout/runs", userC);
    const restrictedGet = await api("GET", `/agent-runs/${runC}`, userC);
    const restrictedDecision = await api("POST", `/agent-runs/${runC}/decision`, userC, {
      decision: "approve", rationale: "out-of-scope probe",
    });
    const unknownGet = await api("GET", `/agent-runs/${runUnknown}`, userA);
    check("same-org out-of-scope run omitted from list", !(restrictedList.body ?? []).some((x: any) => x.id === runC), restrictedList);
    check("same-org out-of-scope run detail denied", restrictedGet.status === 404, restrictedGet);
    check("same-org out-of-scope decision denied", restrictedDecision.status === 404, restrictedDecision);
    check("unknown target run denied by default", unknownGet.status === 404, unknownGet);

    const decision = await api("POST", `/agent-runs/${runA}/decision`, userA, {
      decision: "approve", rationale: "persisted approval",
    });
    const repeat = await api("POST", `/agent-runs/${runA}/decision`, userA, {
      decision: "approve", rationale: "duplicate approval",
    });
    check("same-org decision succeeds", decision.status === 200, decision);
    check("repeat decision is rejected", repeat.status === 409, repeat);

    const [saved] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, runA));
    const audits = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityId, runA),
      ilike(atelierAuditEvents.action, "human.%"),
    ));
    check("decision persists in run row", Array.isArray(saved?.humanDecisions) &&
      (saved.humanDecisions as any[]).some((d) => d.decision === "approve"));
    check("decision audit is attributed to org A", audits.length > 0 && audits.every((a) => a.orgId === orgA), audits);
  } finally {
    await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [runA, runB, "ag_pov_author"]));
    await db.delete(atelierPrompts).where(inArray(atelierPrompts.orgId, [orgA, orgB]));
    await db.delete(atelierAgentRuns).where(inArray(atelierAgentRuns.id, [runA, runB, runC, runUnknown, runRegistryA, runRegistryB]));
    await db.delete(atelierAccounts).where(eq(atelierAccounts.id, accountC));
    await db.delete(atelierAgents).where(inArray(atelierAgents.id, [`ag_missing_${tag}`, `ag_stub_${tag}`, `ag_pursuit_scout`]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [userA, userB, userC]));
    server.close();
    await pool.end();
  }
  if (failures) process.exit(1);
  console.log("All agent operations checks passed");
}

await main();