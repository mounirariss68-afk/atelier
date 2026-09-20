/**
 * Task 1350 — deterministic CRM semantic quality release lane.
 * Run: pnpm exec tsx tests/crm-agent-contracts/evaluate.ts
 *
 * This module intentionally imports no application, database, network, or
 * model code. `liveModelProbes` in the reviewed document are inventory only.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeSweepRoster } from "../../src/lib/atelier-agents/person-name.js";
import { findNearDuplicateFacts } from "../../src/lib/atelier-agents/pov-quality.js";
import { classifyMarginGate } from "../../src/lib/atelier-pricing.js";
import {
  DEFAULT_SECTIONS_REQUIRED,
  orderSectionsBySpine,
  type ProposalSectionLite,
} from "../../src/lib/atelier-proposal-html.js";

type AnyRecord = Record<string, any>;
type Case = { id: string; input: AnyRecord; output: AnyRecord; expectedPass?: boolean };
type Agent = { threshold: number; cases: Case[] };
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "v1.reviewed.json");
const CANONICAL_EXECUTABLE_OR_ADVISORY = new Set([
  "ag_account_cartographer", "ag_brand_profile_writer", "ag_charter_architect",
  "ag_executive_mapper", "ag_meeting_scribe", "ag_next_best_action", "ag_pipeline_forecaster",
  "ag_pov_author", "ag_pov_draft", "ag_pov_researcher", "ag_pre_meeting_briefing", "ag_pricing_analyst",
  "ag_pricing_researcher", "ag_pricing_strategist", "ag_procurement_navigator", "ag_proposal_composer",
  "ag_pursuit_scout", "ag_qbr_composer", "ag_relationship_health", "ag_strategy_developer",
  "ag_synthesis_critic", "ag_theme_curator", "ag_whitespace_mapper", "ag_win_loss_interviewer",
]);

const url = (v: unknown) => typeof v === "string" && /^https?:\/\/[^/\s]+(?:\/\S*)?$/i.test(v);
const email = (v: unknown) => typeof v === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export function evaluateCase(agent: string, c: Case): { pass: boolean; dimensions: Record<string, boolean>; zeroTolerance: string[] } {
  const i = c.input, o = c.output;
  const d: Record<string, boolean> = {};
  const zero: string[] = [];
  if (agent === "scout") {
    const facts = Array.isArray(i.facts) ? i.facts : [];
    d.citationProvenance = (i.expectedEmpty && o.text === "") || (
      o.factIds?.every((id: string) => facts.some((f: AnyRecord) => f.id === id && url(f.sourceUrl))) &&
      o.citations?.every(url) && o.factIds?.every((id: string) => o.text.includes(`[${id}]`))
    );
    d.refusalAndEmptyOutput = i.expectedEmpty ? o.refused === true && o.text === "" : o.refused !== true && !!o.text?.trim();
    d.factPromotion = o.factIds?.every((id: string) => facts.some((f: AnyRecord) => f.id === id && !!f.statement?.trim())) ?? false;
  } else if (agent === "contact") {
    d.contactQuality = typeof o.name === "string" && o.name.trim().length >= 3 && email(o.email) && o.tenantId === i.tenantId;
    d.duplicateSuppression = !(i.existing ?? []).includes(o.email) || o.write !== true;
    if (!d.duplicateSuppression) zero.push("duplicate writes");
    d.tenantIsolation = o.tenantId === i.tenantId;
    if (!d.tenantIsolation) zero.push("tenant isolation");
  } else if (agent === "proposal") {
    d.proposalCompliance = (i.requiredSections ?? []).every((s: string) => (o.sections ?? []).includes(s)) && o.approved === true;
    d.citationProvenance = (o.citationUrls ?? []).every(url) && (i.citations ?? []).every((u: string) => (o.citationUrls ?? []).includes(u));
    d.securityAuthorization = o.approved !== true ||
      ((i.requiredSections ?? []).includes("approval") && (o.sections ?? []).includes("approval"));
    if (!d.securityAuthorization) zero.push("authorization/approval");
  } else if (agent === "pricing") {
    const calculated = o.price > 0 ? (o.price - o.cost) / o.price : -1;
    d.pricingMargins = calculated >= i.targetMargin && Math.abs(calculated - o.margin) < 0.001;
    d.securityAuthorization = calculated < i.targetMargin ? o.approved !== true : true;
    if (!d.securityAuthorization) zero.push("authorization/approval");
  } else if (agent === "forecast") {
    d.forecastCalibration = Math.abs(o.forecast - i.actual) / Math.max(1, Math.abs(i.actual)) <= i.tolerance;
  } else if (agent === "security") {
    d.securityAuthorization = i.authorized === o.allowed && (i.authorized || o.allowed !== true);
    d.tenantIsolation = i.tenantId === i.actorTenantId;
    d.duplicateSuppression = !i.duplicateWrite || o.allowed !== true;
    if (!d.securityAuthorization) zero.push("security authorization");
    if (!d.tenantIsolation) zero.push("tenant isolation");
    if (!d.duplicateSuppression) zero.push("duplicate writes");
  }
  return { pass: Object.values(d).every(Boolean), dimensions: d, zeroTolerance: zero };
}

/** Deliberately independent of aggregate scoring: one gate violation blocks. */
export function zeroToleranceBlocks(violations: string[]): boolean {
  return violations.length > 0;
}

function assertProductionSeams(): void {
  const contacts = [
    { name: "Ada Lovelace", title: "" },
    { name: "Ada  Lovelace", title: "CTO" },
  ];
  const deduped = dedupeSweepRoster(
    contacts,
    (entry) => entry.name,
    (existing, duplicate) => { existing.title ||= duplicate.title; },
  );
  if (deduped.length !== 1 || deduped[0]?.title !== "CTO") {
    throw new Error("production contact-deduplication seam regressed");
  }

  const factDuplicates = findNearDuplicateFacts([
    { id: "old", statement: "Revenue grew twenty percent in 2025", promoted: false },
    { id: "reviewed", statement: "Revenue grew twenty percent in 2025", promoted: true },
  ]);
  if (factDuplicates.get("old") !== "reviewed") {
    throw new Error("production fact-promotion/deduplication seam regressed");
  }

  const policy = {
    targetMarginPct: 0.55,
    amberThresholdPct: 0.45,
    redThresholdPct: 0.35,
    twoPartnerThresholdPct: 0.4,
  };
  const healthy = classifyMarginGate(0.6, policy);
  const belowTarget = classifyMarginGate(0.5, policy);
  const critical = classifyMarginGate(0.3, policy);
  if (healthy.partnerOverrideRequired || !belowTarget.partnerOverrideRequired || !critical.twoPartnerRequired) {
    throw new Error("production pricing margin/override seam regressed");
  }

  const proposalSections: ProposalSectionLite[] = [
    { sectionId: "compliance", name: "Compliance", ownerAgent: "compliance_reviewer", status: "approved", content: "ok" },
    { sectionId: "pricing", name: "Pricing", ownerAgent: "pricing_analyst", status: "approved", content: "ok" },
  ];
  const ordered = orderSectionsBySpine(proposalSections);
  if (
    ordered[0]?.sectionId !== "pricing" ||
    !DEFAULT_SECTIONS_REQUIRED.includes("compliance") ||
    !DEFAULT_SECTIONS_REQUIRED.includes("pricing")
  ) {
    throw new Error("production proposal compliance/spine seam regressed");
  }
}

function main(): void {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8")) as any;
  if (doc.schemaVersion !== "1.0.0" || doc.reviewStatus !== "reviewed") throw new Error("fixture must be a reviewed v1 document");
  if (!Array.isArray(doc.liveModelProbes) || !Array.isArray(doc.supplementalDeterministicProbes)) {
    throw new Error("live and supplemental deterministic probes must be listed separately");
  }
  const source = readFileSync(new URL(import.meta.url), "utf8");
  if (/\b(?:import|require)\s*[^;\n]*(tone-probe-live|perplexity-research-probe)/.test(source)) throw new Error("offline evaluator imported a live probe");
  const evalIds = new Set<string>();
  for (const e of doc.evalDefinitions ?? []) {
    if (evalIds.has(e.id) || !e.fixtureAgent || !doc.agents[e.fixtureAgent]) throw new Error(`invalid eval definition: ${e.id}`);
    evalIds.add(e.id);
    if (!e.positiveCaseIds?.length || !e.negativeCaseIds?.length) throw new Error(`${e.id} requires positive and negative cases`);
    const ids = new Set(doc.agents[e.fixtureAgent].cases.map((c: Case) => c.id));
    for (const id of [...e.positiveCaseIds, ...e.negativeCaseIds]) if (!ids.has(id)) throw new Error(`${e.id} references missing case ${id}`);
    for (const id of e.coveredSpecialistIds) if (!CANONICAL_EXECUTABLE_OR_ADVISORY.has(id)) throw new Error(`${e.id} covers non-specialist ${id}`);
  }
  const thresholdIds = new Set<string>();
  for (const t of doc.specialistThresholds ?? []) {
    thresholdIds.add(t.specialistId);
    if (!CANONICAL_EXECUTABLE_OR_ADVISORY.has(t.specialistId) || !t.evalIds?.every((id: string) => evalIds.has(id))) throw new Error(`invalid threshold record ${t.specialistId}`);
  }
  for (const id of CANONICAL_EXECUTABLE_OR_ADVISORY) if (!thresholdIds.has(id)) throw new Error(`specialist missing deterministic threshold/eval: ${id}`);
  for (const p of doc.liveModelProbes) if (p.runWith !== "manual-only/online" || !p.path?.startsWith("tests/crm/")) throw new Error(`live probe is not opt-in/online: ${p.id}`);
  for (const p of doc.supplementalDeterministicProbes) {
    if (p.runWith !== "opt-in/offline" || !p.path?.startsWith("tests/crm/")) {
      throw new Error(`supplemental deterministic probe is misclassified: ${p.id}`);
    }
  }
  const summaries: string[] = [];
  let failures = 0;
  const caseResults = new Map<string, ReturnType<typeof evaluateCase>>();
  for (const [agent, spec] of Object.entries(doc.agents)) {
    const zero: string[] = [];
    let positive = 0; let positivePassed = 0;
    for (const c of spec.cases) {
      const result = evaluateCase(agent, c);
      caseResults.set(`${agent}/${c.id}`, result);
      const expected = c.expectedPass !== false;
      if (expected) { positive++; if (result.pass) positivePassed++; }
      if (result.pass !== expected) failures++;
      if (expected) zero.push(...result.zeroTolerance.map((x) => `${c.id}: ${x}`));
      console.log(
        `${expected ? (result.pass ? "PASS" : "FAIL") : (result.pass ? "UNEXPECTED_PASS" : "EXPECTED_REJECT")} ${agent}/${c.id}`,
      );
    }
    const score = positivePassed / Math.max(1, positive);
    if (score < spec.threshold) { failures++; summaries.push(`${agent} score ${(score * 100).toFixed(1)}% < ${(spec.threshold * 100).toFixed(1)}%`); }
    if (zeroToleranceBlocks(zero)) { failures += zero.length; summaries.push(`${agent} zero-tolerance: ${zero.join(", ")}`); }
    console.log(`SCORE ${agent} ${(score * 100).toFixed(1)}% (threshold ${(spec.threshold * 100).toFixed(1)}%)`);
  }
  const evalScores = new Map<string, number>();
  for (const definition of doc.evalDefinitions) {
    const positive = definition.positiveCaseIds.map(
      (id: string) => caseResults.get(`${definition.fixtureAgent}/${id}`)?.pass === true,
    );
    const negativesRejected = definition.negativeCaseIds.every(
      (id: string) => caseResults.get(`${definition.fixtureAgent}/${id}`)?.pass === false,
    );
    const score = positive.filter(Boolean).length / Math.max(1, positive.length);
    if (!negativesRejected) {
      failures++;
      summaries.push(`${definition.id} accepted a reviewed negative mutation`);
    }
    evalScores.set(definition.id, score);
  }
  for (const threshold of doc.specialistThresholds) {
    const scores = threshold.evalIds.map((id: string) => evalScores.get(id) ?? 0);
    const score = scores.reduce((sum: number, value: number) => sum + value, 0) / Math.max(1, scores.length);
    if (score < threshold.threshold) {
      failures++;
      summaries.push(`${threshold.specialistId} score ${(score * 100).toFixed(1)}% < ${(threshold.threshold * 100).toFixed(1)}%`);
    }
  }
  assertProductionSeams();
  // Contract self-tests ensure future edits cannot make validators vacuous.
  const good = evaluateCase("scout", doc.agents.scout.cases[0]);
  const bad = evaluateCase("security", doc.agents.security.cases[1]);
  if (!good.pass || bad.pass || bad.zeroTolerance.length === 0) throw new Error("validator self-test failed");
  // Mutation test: even a perfect aggregate cannot override a zero-tolerance gate.
  if (!zeroToleranceBlocks(["mutated tenant isolation violation"]) || zeroToleranceBlocks([])) throw new Error("zero-tolerance mutation self-test failed");
  if (failures) { console.error(`RELEASE BLOCKED: ${failures} expected fixture failure(s); ${summaries.join(" | ")}`); process.exit(1); }
  console.log("RELEASE LANE PASS — all reviewed semantic cases passed");
}
main();