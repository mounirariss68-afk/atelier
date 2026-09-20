import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = resolve(root, "docs/atelier-cli");
const operationsPath = resolve(docsDir, "riser-operations-v1.md");
const signoffPath = resolve(docsDir, "riser-ownership-signoff-v1.json");
const structureOnly = process.argv.includes("--structure");
const failures: string[] = [];

const operations = readFileSync(operationsPath, "utf8");
const requiredHeadings = [
  "Versioned contracts and generated references",
  "Authority and security boundary",
  "Threat model",
  "Provider data-classification matrix",
  "Capability authoring rules",
  "Migration guide",
  "Canary and rollback runbook",
  "Client compatibility and deprecation policy",
  "Incident response and observability",
  "Ownership and release approvals",
];
for (const heading of requiredHeadings) {
  if (!operations.includes(`# ${heading}`) && !operations.includes(`## ${heading}`) &&
      !operations.includes(`### ${heading}`)) {
    failures.push(`missing heading: ${heading}`);
  }
}

for (const match of operations.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  const target = match[1]!;
  if (/^(https?:|#)/.test(target)) continue;
  const [path] = target.split("#", 1);
  if (!path || !existsSync(resolve(docsDir, path))) {
    failures.push(`broken local link: ${target}`);
  }
}

const signoff = JSON.parse(readFileSync(signoffPath, "utf8")) as {
  version?: string;
  status?: string;
  owners?: Record<string, string | null>;
  stageSignoffs?: Record<string, { status?: string; approvedBy?: string | null; evidence?: string | null }>;
  finalApprovals?: Record<string, { status?: string; approvedBy?: string | null; evidence?: string | null }>;
  sunset?: {
    approvedThreshold?: number | null;
    measuredAdoption?: number | null;
    supportedLegacyWriters?: number | null;
    evidence?: string | null;
  };
};
const ownerDomains = [
  "assistant_schemas_compatibility",
  "interpretation_retrieval_evaluation",
  "resolver_policy",
  "action_execution_idempotency",
  "catalog_all_entry_parity",
  "web_mobile_chat_core",
  "workflow_specialist_adapters",
  "security_privacy",
  "data_migrations",
  "sre_telemetry_incident_response",
];
const stages = ["S0", "S1", "S2", "S3", "S4"];
const approvals = [
  "security",
  "data_migration",
  "mobile_web",
  "workflow",
  "sre",
  "release_program",
];
if (signoff.version !== "riser-ownership-signoff/v1") {
  failures.push("invalid sign-off version");
}
for (const domain of ownerDomains) {
  if (!(domain in (signoff.owners ?? {}))) failures.push(`missing owner domain: ${domain}`);
}
for (const stage of stages) {
  if (!(stage in (signoff.stageSignoffs ?? {}))) failures.push(`missing stage sign-off: ${stage}`);
}
for (const approval of approvals) {
  if (!(approval in (signoff.finalApprovals ?? {}))) {
    failures.push(`missing final approval: ${approval}`);
  }
}

if (!structureOnly) {
  for (const domain of ownerDomains) {
    const owner = signoff.owners?.[domain];
    if (typeof owner !== "string" || owner.trim().length < 3) {
      failures.push(`accountable owner pending: ${domain}`);
    }
  }
  for (const stage of stages) {
    const approval = signoff.stageSignoffs?.[stage];
    if (
      approval?.status !== "approved" ||
      !approval.approvedBy ||
      !approval.evidence
    ) {
      failures.push(`stage approval pending: ${stage}`);
    }
  }
  for (const name of approvals) {
    const approval = signoff.finalApprovals?.[name];
    if (
      approval?.status !== "approved" ||
      !approval.approvedBy ||
      !approval.evidence
    ) {
      failures.push(`final approval pending: ${name}`);
    }
  }
  const sunset = signoff.sunset;
  if (
    typeof sunset?.approvedThreshold !== "number" ||
    typeof sunset.measuredAdoption !== "number" ||
    sunset.measuredAdoption < sunset.approvedThreshold ||
    sunset.supportedLegacyWriters !== 0 ||
    !sunset.evidence
  ) {
    failures.push("client adoption/sunset evidence pending");
  }
  if (signoff.status !== "approved") failures.push("overall owner sign-off pending");
}

if (failures.length > 0) {
  console.error(`riser docs/sign-off: FAIL\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(
    `riser docs/sign-off: PASS (${structureOnly ? "structure" : "production approvals"})`,
  );
}