import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSISTANT_PRIVACY_POLICY_VERSION,
  ASSISTANT_PROTOCOL_VERSION,
  PRESENTATION_MINIMUM_DATA_VERSION,
  RiserEvalDatasetV1Schema,
  type RiserEvalMetricV1,
} from "@workspace/assistant-protocol";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import { currentCapabilityManifestVersion } from "../../src/lib/atelier-cli/capability-manifest.js";
import {
  INTENT_ROUTER_MODEL_VERSION,
  INTENT_ROUTER_PROMPT_VERSION,
  INTENT_ROUTER_VERSION,
} from "../../src/lib/atelier-cli/intent-router.js";
import { PRESENTATION_RENDERER_VERSION } from "../../src/lib/atelier-cli/presentation-registry.js";
import {
  collectPureRiserEvalObservations,
  type RiserEvalObservation,
} from "./pure-observations.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataset = RiserEvalDatasetV1Schema.parse(
  JSON.parse(readFileSync(resolve(here, "fixtures.v1.json"), "utf8")),
);
const baseline = JSON.parse(
  readFileSync(resolve(here, dataset.baseline), "utf8"),
) as {
  version: string;
  datasetVersion: string;
  metricMinimums: Record<RiserEvalMetricV1, number>;
};

assert.equal(dataset.protocolVersion, ASSISTANT_PROTOCOL_VERSION);
assert.equal(dataset.presentationDataVersion, PRESENTATION_MINIMUM_DATA_VERSION);
assert.equal(dataset.privacyPolicyVersion, ASSISTANT_PRIVACY_POLICY_VERSION);
assert.equal(dataset.catalogVersion, currentCapabilityManifestVersion());
assert.equal(dataset.routerVersion, INTENT_ROUTER_VERSION);
assert.equal(dataset.modelVersion, INTENT_ROUTER_MODEL_VERSION);
assert.equal(dataset.promptVersion, INTENT_ROUTER_PROMPT_VERSION);
assert.equal(dataset.rendererVersion, PRESENTATION_RENDERER_VERSION);
assert.equal(baseline.version, dataset.version);
assert.equal(baseline.datasetVersion, dataset.datasetVersion);
assert.deepEqual(
  [...dataset.changeClasses].sort(),
  ["catalog", "model", "policy", "prompt", "protocol", "renderer", "router"],
);

const securityReportPath = `/tmp/riser-eval-security-${process.pid}.json`;
execFileSync("pnpm", ["exec", "tsx", "./tests/riser-eval/security-observations.ts"], {
  cwd: resolve(here, "../.."),
  env: {
    ...process.env,
    CRM_TEST_DB_NAME: "crm_test_riser_eval",
    RISER_EVAL_SECURITY_REPORT: securityReportPath,
    RISER_EVAL_SEED: String(dataset.seed),
  },
  stdio: "inherit",
});
const securityObservations = JSON.parse(
  readFileSync(securityReportPath, "utf8"),
) as RiserEvalObservation[];
const observations = [
  ...(await collectPureRiserEvalObservations(dataset.seed)),
  ...securityObservations,
];

const corpusFailures = dataset.corpora.flatMap((corpus) => {
  const count = observations.filter(
    (entry) => entry.metric === corpus.metric,
  ).length;
  return count >= corpus.minimumFixtures
    ? []
    : [{
        corpusId: corpus.id,
        metric: corpus.metric,
        expectedMinimum: corpus.minimumFixtures,
        actual: count,
      }];
});

const metrics = Object.fromEntries(
  dataset.corpora.map((corpus) => {
    const rows = observations.filter((entry) => entry.metric === corpus.metric);
    const passed = rows.filter((entry) => entry.passed).length;
    const denominator = rows.length;
    const rate = denominator === 0 ? 0 : passed / denominator;
    const threshold = baseline.metricMinimums[corpus.metric];
    return [
      corpus.metric,
      {
        passed,
        failed: denominator - passed,
        denominator,
        rate,
        threshold,
        gatePassed: denominator >= corpus.minimumFixtures && rate >= threshold,
      },
    ];
  }),
) as Record<
  RiserEvalMetricV1,
  {
    passed: number;
    failed: number;
    denominator: number;
    rate: number;
    threshold: number;
    gatePassed: boolean;
  }
>;

const severityOneFailures = observations.filter(
  (entry) => entry.severity === "one" && !entry.passed,
);
const capabilityRows = new Map<string, RiserEvalObservation[]>();
for (const entry of observations) {
  if (!entry.capabilityId || entry.metric !== "capability_top_3") continue;
  const rows = capabilityRows.get(entry.capabilityId) ?? [];
  rows.push(entry);
  capabilityRows.set(entry.capabilityId, rows);
}
const capabilityFailures = Array.from(capabilityRows.entries()).flatMap(
  ([capabilityId, rows]) => {
    const passed = rows.filter((entry) => entry.passed).length;
    const rate = passed / rows.length;
    return rows.length >= dataset.minimumCapabilityFixtures &&
      rate >= dataset.perCapabilityTop3Minimum
      ? []
      : [{
          capabilityId,
          passed,
          denominator: rows.length,
          rate,
          minimum: dataset.perCapabilityTop3Minimum,
          minimumFixtures: dataset.minimumCapabilityFixtures,
        }];
  },
);
const namedFailures = observations
  .filter((entry) => !entry.passed)
  .map((entry) => ({
    id: entry.id,
    metric: entry.metric,
    severity: entry.severity,
    expected: entry.expected,
    actual: entry.actual,
  }));
const gatePassed =
  corpusFailures.length === 0 &&
  severityOneFailures.length === 0 &&
  capabilityFailures.length === 0 &&
  Object.values(metrics).every((metric) => metric.gatePassed);
const report = {
  version: dataset.version,
  datasetVersion: dataset.datasetVersion,
  mode: process.env.RISER_EVAL_MODE === "canary" ? "canary" : "ci",
  catalogVersion: dataset.catalogVersion,
  routerVersion: dataset.routerVersion,
  modelVersion: dataset.modelVersion,
  promptVersion: dataset.promptVersion,
  rendererVersion: dataset.rendererVersion,
  privacyPolicyVersion: dataset.privacyPolicyVersion,
  protocolVersion: dataset.protocolVersion,
  seed: dataset.seed,
  baseline: dataset.baseline,
  denominator: dataset.denominator,
  statisticalMethod: dataset.statisticalMethod,
  confidence: dataset.confidence,
  changeClasses: dataset.changeClasses,
  observationCount: observations.length,
  metrics,
  corpusFailures,
  capabilityFailures,
  namedFailures,
  gatePassed,
};
writeFileSync(
  resolve(here, "report.v1.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (!gatePassed) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    `riser-eval/v1: PASS (${observations.length} measured observations, ${capabilityRows.size} capability scopes)`,
  );
}