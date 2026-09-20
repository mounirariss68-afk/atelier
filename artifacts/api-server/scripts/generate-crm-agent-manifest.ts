import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ATELIER_AGENTS } from "@workspace/agents";
import { CRM_CONTRACT_ENTRIES, schemaFingerprint, sha256, sortedEntries, type CrmManifestEntry } from "../src/lib/atelier-agents/crm-contract-manifest.js";

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(API_ROOT, "../..");
const target = resolve(API_ROOT, "src/lib/atelier-agents/generated/crm-agent-manifest.v1.json");
const registrySource = resolve(ROOT, "lib/agents/src/registry.ts");

export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
function hashFile(path: string): string { return createHash("sha256").update(requireRead(path)).digest("hex"); }
const fileCache = new Map<string, string>();
function requireRead(path: string): string {
  const value = fileCache.get(path);
  if (value !== undefined) return value;
  const text = readFileSync(path, "utf8");
  fileCache.set(path, text);
  return text;
}
const qualityContract = JSON.parse(
  requireRead(resolve(API_ROOT, "tests/crm-agent-contracts/v1.reviewed.json")),
) as {
  evalDefinitions?: Array<{ id: string }>;
  specialistThresholds?: Array<{ specialistId: string; evalIds: string[] }>;
  excludedSpecialists?: Array<{ specialistId: string; reason: string }>;
};
const reviewedEvalIds = new Set(
  qualityContract.evalDefinitions?.map((definition) => definition.id) ?? [],
);
const thresholdBySpecialist = new Map(
  qualityContract.specialistThresholds?.map((threshold) => [
    threshold.specialistId,
    threshold.evalIds,
  ]) ?? [],
);
const excludedSpecialists = new Set(
  qualityContract.excludedSpecialists?.map((entry) => entry.specialistId) ?? [],
);
const reviewedDivergenceIds = new Set(["div_case_study_embedded_label"]);
function normalizedAlias(value: string): string {
  return value.trim().toLocaleLowerCase("en").replace(/[\s/_-]+/g, " ");
}
function checkSymbol(file: string, symbol: string): boolean {
  return new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${symbol}\\b|\\bexport\\s+(?:const|let)\\s+${symbol}\\b`).test(requireRead(resolve(ROOT, file)));
}
function fail(messages: string[]): never {
  throw new Error(`CRM manifest validation failed:\n${messages.map((m) => `- ${m}`).join("\n")}`);
}

function resolvePrompt(ref: string): { path: string; marker: string | null } {
  if (!ref.startsWith("inline:")) return { path: resolve(API_ROOT, ref), marker: null };
  const [file, marker] = ref.slice("inline:".length).split("#", 2);
  return { path: resolve(ROOT, file), marker: marker ?? null };
}

async function generate(): Promise<string> {
  const errors: string[] = [];
  const registry = new Map(ATELIER_AGENTS.map((a) => [a.id, a]));
  const aliases = new Map<string, string>();
  const entries: CrmManifestEntry[] = sortedEntries().map((entry) => {
    const agent = entry.registryId ? registry.get(entry.registryId) : undefined;
    if (entry.registryId && !agent) errors.push(`${entry.id}: missing registry entry ${entry.registryId}`);
    if (agent && entry.operationalStatus !== agent.status && !entry.approvedDivergences.some((d) => d.id === "div_status_parity_reviewed")) {
      errors.push(`${entry.id}: operational status does not match registry status`);
    }
    for (const alias of [entry.id, entry.name, ...entry.aliases]) {
      const aliasKey = normalizedAlias(alias);
      const previous = aliases.get(aliasKey);
      if (previous && previous !== entry.id) errors.push(`duplicate alias "${alias}" (${previous}, ${entry.id})`);
      aliases.set(aliasKey, entry.id);
    }
    if (!entry.runner) {
      if (entry.classification !== "unsupported") errors.push(`${entry.id}: runner is required`);
    } else if (!existsSync(resolve(ROOT, entry.runner.file))) errors.push(`${entry.id}: runner file missing`);
    else if (!checkSymbol(entry.runner.file, entry.runner.symbol)) errors.push(`${entry.id}: runner symbol ${entry.runner.symbol} missing`);
    if (entry.route) {
      if (!existsSync(resolve(ROOT, entry.route.file))) errors.push(`${entry.id}: route file missing`);
      else if (!requireRead(resolve(ROOT, entry.route.file)).toLowerCase().includes(entry.route.hint.toLowerCase())) errors.push(`${entry.id}: route hint not found`);
    }
    if (entry.promptRef) {
      const prompt = resolvePrompt(entry.promptRef);
      if (!existsSync(prompt.path)) errors.push(`${entry.id}: prompt ref missing`);
      else if (prompt.marker && !requireRead(prompt.path).includes(prompt.marker)) errors.push(`${entry.id}: inline prompt marker missing`);
    }
    for (const ref of entry.fixtureRefs) if (!existsSync(resolve(ROOT, ref))) errors.push(`${entry.id}: fixture ref missing: ${ref}`);
    for (const mount of entry.uiMounts) if (!existsSync(resolve(ROOT, mount))) errors.push(`${entry.id}: UI mount missing: ${mount}`);
    if (
      !entry.agentsLens ||
      !["runtime-registry", "manual-record", "not-applicable"].includes(entry.agentsLens.sourceMode) ||
      (entry.agentsLens.sourceMode === "not-applicable" ? entry.agentsLens.recordKey !== null : !entry.agentsLens.recordKey)
    ) errors.push(`${entry.id}: invalid Agents Lens link`);
    for (const evalId of entry.deterministicEvalIds) if (!reviewedEvalIds.has(evalId)) errors.push(`${entry.id}: unknown deterministic eval ${evalId}`);
    const thresholdEvals = thresholdBySpecialist.get(entry.id) ?? [];
    if (entry.classification === "executable" || entry.classification === "advisory") {
      if (!entry.deterministicEvalIds.length) errors.push(`${entry.id}: executable/advisory specialist has no deterministic eval`);
      if (JSON.stringify([...entry.deterministicEvalIds].sort()) !== JSON.stringify([...thresholdEvals].sort())) {
        errors.push(`${entry.id}: manifest evals do not match reviewed specialist threshold`);
      }
    } else if (!excludedSpecialists.has(entry.id) || entry.deterministicEvalIds.length > 0) {
      errors.push(`${entry.id}: unsupported/utility entry must be explicitly excluded from semantic evals`);
    }
    for (const divergence of entry.approvedDivergences) if (!reviewedDivergenceIds.has(divergence.id) || !divergence.reason || !divergence.owner || !divergence.reviewBy) errors.push(`${entry.id}: unapproved or malformed divergence`);
    if (entry.classification === "unsupported" && (entry.runner || entry.route)) errors.push(`${entry.id}: unsupported entries cannot claim an executor`);
    if (entry.operationalStatus === "mvp") {
      if (!entry.runner || !entry.route || !entry.promptRef || !entry.fixtureRefs.length || !entry.uiMounts.length || !entry.deterministicEvalIds.length) {
        errors.push(`${entry.id}: dishonest mvp status; runner, route, prompt, fixture, UI and deterministic eval are required`);
      }
      if (!entry.registryId || !entry.fixtureRefs.includes(`artifacts/api-server/tests/agents/${entry.registryId}/golden.json`)) {
        errors.push(`${entry.id}: mvp status requires an agent-specific golden fixture`);
      }
    }
    const out: CrmManifestEntry = { ...entry };
    out.sourceHash = sha256([
      entry.runner ? requireRead(resolve(ROOT, entry.runner.file)) : entry.id,
      entry.route ? requireRead(resolve(ROOT, entry.route.file)) : "",
    ].join("\n"));
    out.promptHash = entry.promptRef ? hashFile(resolvePrompt(entry.promptRef).path) : null;
    if (agent) {
      out.inputSchemaHash = sha256(stable(schemaFingerprint(agent.inputSchema)));
      out.outputSchemaHash = sha256(stable(schemaFingerprint(agent.outputSchema)));
    }
    return out;
  });
  if (errors.length) fail(errors);
  return `${JSON.stringify({ manifestVersion: "crm-agent-manifest.v1", version: 1, generatedFrom: "atelier-crm-agent-workflows-audit.md", entryCount: entries.length, entries }, null, 2)}\n`;
}

const content = await generate();
if (process.argv.includes("--check")) {
  const existing = await readFile(target, "utf8").catch(() => "");
  if (existing !== content) fail(["checked-in generated JSON is stale; run generate:crm-agent-manifest"]);
  console.log("CRM agent manifest is current.");
} else {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  console.log(`Wrote ${JSON.parse(content).entryCount} CRM manifest entries.`);
}