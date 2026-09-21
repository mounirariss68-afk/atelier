import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ATELIER_AGENTS } from "@workspace/agents";
import { z } from "zod";
import {
  CRM_CONTRACT_ENTRIES,
  schemaFingerprint,
  sha256,
} from "../../src/lib/atelier-agents/crm-contract-manifest.js";

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const document = JSON.parse(readFileSync(resolve(API_ROOT, "src/lib/atelier-agents/generated/crm-agent-manifest.v1.json"), "utf8")) as {
  version: number; entryCount: number; entries: Array<{ id: string; name: string; aliases: string[]; classification: string; registryId: string | null; route: { hint: string } | null; runner: unknown; fixtureRefs: string[]; operationalStatus: string; agentsLens: { recordKey: string | null; sourceMode: string }; deterministicEvalIds: string[] }>;
};
if (document.version !== 1 || document.entryCount !== CRM_CONTRACT_ENTRIES.length) throw new Error("invalid CRM manifest header");
if (document.entries.length !== CRM_CONTRACT_ENTRIES.length) throw new Error("manifest entry count drift");
const ids = new Set<string>();
const aliases = new Map<string, string>();
const quality = JSON.parse(
  readFileSync(resolve(API_ROOT, "tests/crm-agent-contracts/v1.reviewed.json"), "utf8"),
) as {
  evalDefinitions: Array<{ id: string }>;
  specialistThresholds: Array<{ specialistId: string; evalIds: string[] }>;
  excludedSpecialists: Array<{ specialistId: string }>;
};
const evalIds = new Set(quality.evalDefinitions.map((definition) => definition.id));
const thresholds = new Map(
  quality.specialistThresholds.map((threshold) => [threshold.specialistId, threshold.evalIds]),
);
const exclusions = new Set(quality.excludedSpecialists.map((entry) => entry.specialistId));
const registry = new Map(ATELIER_AGENTS.map((a) => [a.id, a]));
const classes = new Set<string>();
const normalizeAlias = (value: string) =>
  value.trim().toLocaleLowerCase("en").replace(/[\s/_-]+/g, " ");
const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
};
const schemaHash = (schema: unknown) => sha256(stable(schemaFingerprint(schema)));
if (
  schemaHash(z.object({ name: z.string() })) ===
  schemaHash(z.object({ name: z.string(), email: z.string().email().optional() }))
) {
  throw new Error("schema fingerprint mutation test failed");
}
for (const entry of document.entries) {
  if (ids.has(entry.id)) throw new Error(`duplicate canonical id: ${entry.id}`);
  ids.add(entry.id);
  if (!["executable", "advisory", "unsupported", "utility"].includes(entry.classification)) {
    throw new Error(`invalid classification: ${entry.id}`);
  }
  classes.add(entry.classification);
  if (entry.route && ["router", "route"].includes(entry.route.hint)) throw new Error(`generic route hint: ${entry.id}`);
  if (entry.classification === "unsupported" && (entry.runner || entry.route)) throw new Error(`unsupported executor: ${entry.id}`);
  if (
    !["runtime-registry", "manual-record", "not-applicable"].includes(entry.agentsLens.sourceMode) ||
    (entry.agentsLens.sourceMode === "not-applicable" ? entry.agentsLens.recordKey !== null : !entry.agentsLens.recordKey)
  ) throw new Error(`invalid Agents Lens link: ${entry.id}`);
  for (const evalId of entry.deterministicEvalIds) if (!evalIds.has(evalId)) throw new Error(`unknown eval: ${evalId}`);
  if (entry.classification === "executable" || entry.classification === "advisory") {
    if (JSON.stringify(entry.deterministicEvalIds) !== JSON.stringify(thresholds.get(entry.id))) {
      throw new Error(`quality threshold linkage drift: ${entry.id}`);
    }
  } else if (!exclusions.has(entry.id) || entry.deterministicEvalIds.length) {
    throw new Error(`missing or invalid semantic exclusion: ${entry.id}`);
  }
  const registered = entry.registryId ? registry.get(entry.registryId) : undefined;
  if (registered && entry.operationalStatus !== registered.status) throw new Error(`status mismatch: ${entry.id}`);
  if (entry.registryId && !registered) throw new Error(`missing governed registry entry: ${entry.id}`);
  if (["ag_account_cartographer", "ag_executive_mapper"].includes(entry.id) && registered?.capabilityType !== "account_scoped") {
    throw new Error(`account capability is not account-scoped: ${entry.id}`);
  }
  if (entry.id === "ag_riser_orchestrator" && registered?.capabilityType !== "orchestrator") {
    throw new Error("Riser is not classified as an orchestrator");
  }
  if (entry.operationalStatus === "mvp" && (
    !entry.registryId ||
    !entry.fixtureRefs.includes(`artifacts/api-server/tests/agents/${entry.registryId}/golden.json`)
  )) {
    throw new Error(`mvp missing agent-specific golden fixture: ${entry.id}`);
  }
  for (const alias of [entry.id, entry.name, ...entry.aliases]) {
    const aliasKey = normalizeAlias(alias);
    const previous = aliases.get(aliasKey);
    if (previous && previous !== entry.id) throw new Error(`duplicate alias: ${alias}`);
    aliases.set(aliasKey, entry.id);
  }
  if (entry.registryId === entry.id && !entry.id.startsWith("ag_")) throw new Error(`invalid registry id: ${entry.id}`);
}
for (const required of ["executable", "advisory", "unsupported", "utility"]) if (!classes.has(required)) throw new Error(`classification missing: ${required}`);
console.log(`[test:crm-agent-contracts] OK — ${document.entries.length} canonical CRM entries`);