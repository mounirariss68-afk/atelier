/**
 * Task 1351 — real, deterministic outcome-ledger contract probe.
 * The CRM scratch-db harness is intentionally the first import: no live DB,
 * AI, or network service is contacted.
 */
import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail ?? ""); }
}
async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAgentRuns, atelierAgentRunSnapshots,
    atelierAgentOutcomeEvents, atelierAuditEvents } = D as any;
  const { eq, and, count } = await import("drizzle-orm");
  const { recordAgentOutcome } = await import("../../src/lib/atelier-agents/outcome-ledger.js");
  const { startRun } = await import("../../src/lib/atelier-agents/runner.js");
  const app = (await import("../../src/app.js")).default;
  const tag = `o1351_${Date.now()}`;
  const org = `org_${tag}`, otherOrg = `org_other_${tag}`;
  const user = `user_${tag}`, otherUser = `other_user_${tag}`, contractor = `contractor_${tag}`;
  const run = `run_${tag}`, metricsRun = `run_metrics_${tag}`, otherRun = `other_run_${tag}`;
  const origin = `opp_${tag}`;
  const now = new Date("2040-01-02T03:04:05.000Z");
  const snapshot = {
    runId: run, orgId: org, agentId: "scout", agentVersion: "real-v7",
    registryVersion: "registry-v3", promptVersion: "prompt-v9",
    promptHash: "hash-v9", model: "offline-model", entryPath: "probe.entry",
    dataQualityFlags: [], recordedAt: now,
  };
  const base: any = {
    orgId: org, eventKey: `event_${tag}`, occurredAt: new Date("2039-12-01T00:00:00Z"),
    runId: run, agentId: "scout", agentVersion: "caller-must-not-win",
    registryVersion: "caller", promptVersion: "caller", promptHash: "caller",
    model: "caller", actorUserId: user, originEntityType: "opportunity", originEntityId: origin,
    entityType: "opportunity", entityId: origin, entryPath: "caller.entry",
    outcomeKind: "decision", outcomeStatus: "accepted", metadata: {
      confidence: 0.9, decision: "accepted", prompt: "strip this", url: "strip this",
      harmless: "not-allowlisted",
    }, missingLinks: ["source-domain"], dataQualityFlags: ["fixture"],
  };
  const expectReject = async (label: string, input: any) => {
    try { await recordAgentOutcome(input); check(label, false); }
    catch { check(label, true); }
  };
  const server = app.listen(0);
  let systemRun: string | null = null;
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const api = async (path: string, persona = user) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/atelier${path}`, {
      headers: { cookie: `atelier_persona=${persona}` },
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await db.insert(atelierUsers).values([
      { id: user, orgId: org, name: "Outcome Probe", initials: "OP", email: `${user}@test`, role: "founding_partner", roleLabel: "Partner", title: "Partner" },
      { id: otherUser, orgId: otherOrg, name: "Other Probe", initials: "XP", email: `${otherUser}@test`, role: "founding_partner", roleLabel: "Partner", title: "Partner" },
      { id: contractor, orgId: org, name: "Contractor Probe", initials: "CP", email: `${contractor}@test`, role: "contractor", roleLabel: "Contractor", title: "Contractor" },
    ] as any);
    systemRun = await startRun({
      agentId: "system-probe",
      triggeredByUserId: null,
      targetType: "probe.system",
      targetId: `system_${tag}`,
      targetLabel: "System probe",
      actorLabel: "System Probe",
      inputs: {},
    });
    const [systemRunRow] = await db.select({ orgId: atelierAgentRuns.orgId })
      .from(atelierAgentRuns).where(eq(atelierAgentRuns.id, systemRun));
    const [systemAudit] = await db.select({ orgId: atelierAuditEvents.orgId })
      .from(atelierAuditEvents).where(and(
        eq(atelierAuditEvents.entityType, "probe.system"),
        eq(atelierAuditEvents.entityId, `system_${tag}`),
      ));
    check("null-actor scheduled run preserves explicit firm-system tenant",
      systemRunRow?.orgId === "aico" && systemAudit?.orgId === "aico");
    await db.insert(atelierAgentRuns).values([
      { id: run, orgId: org, agentId: "scout", triggeredByUserId: user, targetType: "opportunity", targetId: origin, status: "completed", inputs: {} },
      { id: metricsRun, orgId: org, agentId: "scout", triggeredByUserId: user, targetType: "opportunity", targetId: origin, status: "completed", inputs: {} },
      { id: otherRun, orgId: otherOrg, agentId: "scout", triggeredByUserId: otherUser, targetType: "opportunity", targetId: `other_${origin}`, status: "completed", inputs: {} },
    ] as any);
    await db.insert(atelierAgentRunSnapshots).values(snapshot as any);
    await db.insert(atelierAgentRunSnapshots).values({
      ...snapshot, runId: metricsRun, entryPath: "metrics.probe",
    } as any);
    await db.insert(atelierAgentRunSnapshots).values({ ...snapshot, runId: otherRun, orgId: otherOrg } as any);

    const [first] = await Promise.all(
      Array.from({ length: 8 }, () => recordAgentOutcome({ ...base })),
    );
    const rows = await db.select().from(atelierAgentOutcomeEvents).where(eq(atelierAgentOutcomeEvents.orgId, org));
    check("Promise.all converges on unique org/event row", rows.length === 1 && first.id === rows[0].id);
    check("late occurredAt retained independently of recordedAt", rows[0].occurredAt.toISOString() === base.occurredAt.toISOString());
    check("version/model/entry attribution comes from run snapshot",
      rows[0].agentVersion === "real-v7" && rows[0].registryVersion === "registry-v3" &&
      rows[0].promptVersion === "prompt-v9" && rows[0].model === "offline-model" && rows[0].entryPath === "probe.entry");
    check("safe metadata strips prompt/url and unknown keys",
      rows[0].metadata.confidence === 0.9 && !("prompt" in rows[0].metadata) && !("url" in rows[0].metadata) && !("harmless" in rows[0].metadata));
    check("missingLinks is persisted for coverage", rows[0].missingLinks.includes("source-domain"));
    const audits = await db.select({ n: count() }).from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.orgId, org), eq(atelierAuditEvents.action, "agent.outcome.recorded"),
    ));
    check("one explicit audit row for concurrent insert", Number(audits[0].n) === 1);
    await expectReject("same-key conflicting metadata rejected", {
      ...base,
      metadata: { confidence: 0.1, decision: "different" },
    });

    const replacement = await recordAgentOutcome({
      ...base, eventKey: `replacement_${tag}`, supersedesEventId: first.id,
      occurredAt: new Date("2040-01-03T00:00:00Z"), metadata: {},
      missingLinks: [], dataQualityFlags: [],
    });
    const otherOutcome = await recordAgentOutcome({
      ...base, orgId: otherOrg, eventKey: `other_${tag}`, runId: otherRun,
      actorUserId: otherUser, originEntityId: `other_${origin}`, entityId: `other_${origin}`,
    });
    check("supersession link points to prior same-tenant event", replacement.supersedesEventId === first.id);
    await expectReject("cross-org run rejected", { ...base, eventKey: `crossrun_${tag}`, runId: otherRun });
    await expectReject("cross-org actor rejected", { ...base, eventKey: `crossactor_${tag}`, actorUserId: otherUser });
    await expectReject("cross-org supersedes rejected", { ...base, eventKey: `crosssup_${tag}`, supersedesEventId: otherOutcome.id });

    const report = await api(`/agents-lens/outcomes?agentId=scout&entryPath=probe.entry&from=2039-01-01&to=2041-01-01`);
    check("GET outcomes aggregates and tenant filters", report.status === 200 &&
      report.body.totals.events === 2 && report.body.coverage.missingLinkEvents === 1 &&
      report.body.breakdowns.agentId.some((x: any) => x.key === "scout"), report.body);
    const otherReport = await api("/agents-lens/outcomes", otherUser);
    check("outcomes report is scoped to active tenant", otherReport.status === 200 && otherReport.body.totals.events === 1);
    check("outcomes leadership role gate", (await api("/agents-lens/outcomes", contractor)).status === 403);

    const metricBase = {
      ...base,
      runId: metricsRun,
      entryPath: "caller-is-overwritten",
      missingLinks: [],
      dataQualityFlags: [],
      metadata: {},
    };
    await recordAgentOutcome({
      ...metricBase, eventKey: `metric_decision_${tag}`,
      outcomeKind: "decision", outcomeStatus: "accepted",
      metadata: { approvalLatencyMs: 1000 },
    });
    await recordAgentOutcome({
      ...metricBase, eventKey: `metric_proposal_edit_${tag}`,
      outcomeKind: "proposal", outcomeStatus: "edited", reworkCount: 1,
    });
    await recordAgentOutcome({
      ...metricBase, eventKey: `metric_source_${tag}`,
      outcomeKind: "source", outcomeStatus: "accepted",
      sourceAcceptedCount: 3, sourceRejectedCount: 1,
    });
    await recordAgentOutcome({
      ...metricBase, eventKey: `metric_pricing_accept_${tag}`,
      outcomeKind: "pricing", outcomeStatus: "accepted",
    });
    await recordAgentOutcome({
      ...metricBase, eventKey: `metric_pricing_override_${tag}`,
      outcomeKind: "pricing", outcomeStatus: "edited",
    });
    await recordAgentOutcome({
      ...metricBase, eventKey: `metric_forecast_${tag}`,
      outcomeKind: "forecast", outcomeStatus: "generated",
    });
    const metricsReport = await api("/agents-lens/outcomes?entryPath=metrics.probe");
    check("aggregate metric numerators and denominators are exact",
      metricsReport.status === 200 &&
      metricsReport.body.metrics.approvalLatencyMs === 1000 &&
      metricsReport.body.metrics.editReworkRate === 0.5 &&
      metricsReport.body.metrics.sourceAcceptanceRate === 0.75 &&
      metricsReport.body.metrics.marginOverrideRate === 0.5,
      metricsReport.body);
    check("unavailable POV and forecast metrics remain null",
      metricsReport.body.metrics.povSendRate === null &&
      metricsReport.body.metrics.forecastErrorPct === null,
      metricsReport.body.metrics);
  } finally {
    server.close();
    if (systemRun) {
      await db.delete(atelierAgentRunSnapshots).where(eq(atelierAgentRunSnapshots.runId, systemRun));
      await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.id, systemRun));
      await db.delete(atelierAuditEvents).where(and(
        eq(atelierAuditEvents.entityType, "probe.system"),
        eq(atelierAuditEvents.entityId, `system_${tag}`),
      ));
    }
    await db.delete(atelierAgentOutcomeEvents).where(eq(atelierAgentOutcomeEvents.orgId, org));
    await db.delete(atelierAgentRunSnapshots).where(eq(atelierAgentRunSnapshots.orgId, org));
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.orgId, org));
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.orgId, org));
    await db.delete(atelierUsers).where(eq(atelierUsers.orgId, org));
    await db.delete(atelierAgentOutcomeEvents).where(eq(atelierAgentOutcomeEvents.orgId, otherOrg));
    await db.delete(atelierAgentRunSnapshots).where(eq(atelierAgentRunSnapshots.orgId, otherOrg));
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.orgId, otherOrg));
    await db.delete(atelierUsers).where(eq(atelierUsers.orgId, otherOrg));
    await pool.end();
  }
  if (failures) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });