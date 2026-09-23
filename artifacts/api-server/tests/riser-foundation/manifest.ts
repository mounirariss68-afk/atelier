import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  capabilityManifestVersion,
  generateCapabilityManifestDocumentV1,
  generateCapabilityManifestV1,
} from "../../src/lib/atelier-cli/capability-manifest.js";
import {
  findByToolName,
  listCapabilities,
  assertExecutionProofContract,
  assertValidCapabilityInputSchema,
} from "../../src/lib/atelier-cli/capability-catalog.js";
import {
  CAPABILITY_DIVERGENCES,
  assertCapabilityDivergences,
} from "../../src/lib/atelier-cli/capability-divergences.js";

const manifest = generateCapabilityManifestV1();
const document = generateCapabilityManifestDocumentV1();
const checkedIn = JSON.parse(
  await readFile(
    new URL(
      "../../src/lib/atelier-cli/generated/capability-manifest.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const parityCapabilitySource = await readFile(
  new URL("../../src/lib/atelier-cli/parity-capabilities.ts", import.meta.url),
  "utf8",
);
assert.deepEqual(checkedIn, document, "checked-in manifest must match runtime registry");
assert.equal(manifest.length, 329);
assert.equal(document.entryCount, 329);
assert.equal(document.manifestVersion, capabilityManifestVersion(manifest));
assert.equal(new Set(manifest.map((entry) => entry.capabilityId)).size, manifest.length);
assert.equal(new Set(manifest.map((entry) => entry.toolName)).size, manifest.length);
assert.match(capabilityManifestVersion(manifest), /^[a-f0-9]{64}$/);
assert.equal(CAPABILITY_DIVERGENCES.length, 4);
for (const invalidSchema of [
  { type: "object", additionalProperties: "yes" },
  { type: "object", properties: { value: { type: "string", minLength: -1 } } },
  { type: "object", properties: { value: { type: "string", enum: "not-an-array" } } },
  { type: "object", properties: { value: { type: "number", minimum: "zero" } } },
]) {
  assert.throws(
    () => assertValidCapabilityInputSchema(invalidSchema, "negative-probe"),
    /capability-invalid-json-schema/,
  );
}
await assert.rejects(
  () =>
    assertExecutionProofContract("negative.synthetic-dispatch", "executable", {
      ok: true,
      data: { dispatched: true, navigateTo: null },
    }, "test-org"),
  /capability-synthetic-dispatch/,
);
await assert.rejects(
  () =>
    assertExecutionProofContract("negative.synthetic-queue", "executable", {
      ok: true,
      data: {
        agentRun: { id: "generated-only", status: "queued" },
        navigateTo: null,
      },
    }, "test-org"),
  /capability-unverified-execution/,
);
await assert.rejects(
  () =>
    assertExecutionProofContract("negative.top-level-queue", "executable", {
      ok: true,
      data: {
        status: "queued",
        workItemId: "fabricated",
        navigateTo: null,
      },
    }, "test-org"),
  /capability-unverified-execution/,
);
await assert.rejects(
  () =>
    assertExecutionProofContract("negative.self-asserted-persistence", "executable", {
      ok: true,
      data: {
        status: "queued",
        execution: { kind: "work_item", id: "fabricated", status: "queued" },
        navigateTo: null,
      },
    }, "test-org"),
  /capability-unverified-work-item/,
);
const cartographerExecutor =
  parityCapabilitySource.match(
    /id: "account\.refresh_cartographer"[\s\S]*?(?=\ndefineCapability\()/,
  )?.[0] ?? "";
assert.match(cartographerExecutor, /createServerOwnedCrmWorkflow\(/);
assert.match(cartographerExecutor, /workItemId: work\.workItemId/);
assert.doesNotMatch(cartographerExecutor, /dispatched:\s*true/);
const charterExecutor =
  parityCapabilitySource.match(
    /id: "engagement\.redraft_charter"[\s\S]*?(?=\ndefineCapability\()/,
  )?.[0] ?? "";
assert.match(charterExecutor, /runCharterArchitect\(/);
assert.match(charterExecutor, /eq\(atelierEngagements\.orgId, ctx\.persona\.orgId\)/);
assert.match(charterExecutor, /\.insert\(atelierCharterVersions\)/);
assert.match(charterExecutor, /orgId: ctx\.persona\.orgId/);
assert.match(charterExecutor, /runId: result\.runId/);
assert.doesNotMatch(charterExecutor, /dispatched:\s*true/);

for (const entry of manifest) {
  assert.match(entry.inputSchemaHash, /^[a-f0-9]{12}$/);
  assert.match(entry.resultSchemaHash, /^[a-f0-9]{12}$/);
  assert.match(entry.implementationVersion, /^[a-f0-9]{12}$/);
  assert.ok(entry.policyClass.length > 0, `${entry.capabilityId} policy class`);
  assert.ok(entry.effectClass.length > 0, `${entry.capabilityId} effect class`);
  assert.equal(entry.presentation.contractVersion, 1);
  assert.equal(entry.presentation.minimumDataVersion, 1);
  assertCapabilityDivergences(entry.divergenceIds);
  if (entry.effect === "write" && entry.executionStatus === "executable") {
    assert.equal(entry.confirmation.required, true, `${entry.capabilityId} must confirm`);
  }
  if (entry.executionStatus === "legacy_compat") {
    assert.ok(
      entry.divergenceIds.includes("legacy-confirmation-compat-v1"),
      `${entry.capabilityId} legacy confirmation divergence`,
    );
  }
  if (entry.source === "cli-only") {
    assert.ok(
      entry.divergenceIds.includes("cli-only-route-parity-v1"),
      `${entry.capabilityId} route-parity divergence`,
    );
  }
}

const capabilities = listCapabilities();
assert.equal(capabilities.length, manifest.length);
const foreignEngagementId = `eng_riser_tenant_${randomUUID()}`;
await db.execute(sql`
  insert into atelier_engagements (
    id, org_id, slug, name, account_id, plm_stage,
    partner_owner_id, engagement_lead_id, start_date, planned_end_date
  ) values (
    ${foreignEngagementId}, 'riser-foreign-org', ${foreignEngagementId},
    'Foreign tenant charter probe', 'acct_foreign_probe', 'mobilize',
    'foreign-partner', 'foreign-lead', '2026-09-20', '2026-12-20'
  )
`);
try {
  const charter = capabilities.find((entry) => entry.id === "engagement.redraft_charter");
  assert.ok(charter);
  const result = await charter.run(
    { engagementId: foreignEngagementId, confirm: true },
    {
      persona: {
        id: "local-partner",
        name: "Local Partner",
        role: "founding_partner",
        orgId: "riser-local-org",
      },
      sessionId: "tenant-probe-session",
      turnId: "tenant-probe-turn",
    } as never,
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "not_found");
} finally {
  await db.execute(sql`delete from atelier_engagements where id = ${foreignEngagementId}`);
}
const agents = capabilities.filter((entry) => entry.source === "agent");
assert.equal(agents.length, 60);
assert.equal(capabilities.filter((entry) => entry.source === "cli-only").length, 269);
for (const agent of agents) {
  assert.equal(agent.executionStatus, "unsupported");
  assert.equal(agent.policyClass, "unsupported");
  assert.ok(agent.divergenceIds.includes("agent-executor-unsupported-v1"));
  assert.equal(findByToolName(agent.toolName), undefined);
  const result = await agent.run({}, {
    persona: { id: "test-user", name: "Test", role: "founding_partner", orgId: "test-org" },
    sessionId: "test-session",
    turnId: "test-turn",
  } as never);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "unsupported");
  assert.equal(JSON.stringify(result).includes("dispatched"), false);
}
for (const id of [
  "codex.contract_compose",
  "codex.contract_dispatch",
  "codex.contract_record_redline",
  "codex.dpa_review",
  "codex.renewal_watchdog_run",
]) {
  const capability = capabilities.find((entry) => entry.id === id);
  assert.ok(capability, `${id} remains represented for governance`);
  assert.equal(capability.executionStatus, "unsupported");
  assert.equal(findByToolName(capability.toolName), undefined);
  assert.ok(capability.divergenceIds.includes("riser-adapter-not-integrated-v1"));
}
for (const capability of capabilities) {
  assert.equal(typeof capability.run, "function", `${capability.id} executor`);
  assert.equal(capability.presentationContract.cardType, capability.resultCard);
  if (capability.isWrite) {
    assert.equal(
      (capability.run as unknown as { __navContractWrapped?: boolean }).__navContractWrapped,
      true,
      `${capability.id} write executor contract wrapper`,
    );
  }
}

console.log("riser capability manifest probes passed");
