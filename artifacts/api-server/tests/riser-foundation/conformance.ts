import assert from "node:assert/strict";
import conformance from "../../src/lib/atelier-cli/generated/route-conformance.v1.json";
import manifest from "../../src/lib/atelier-cli/generated/capability-manifest.v1.json";

assert.equal(conformance.schemaVersion, 1);
assert.equal(conformance.capabilityCount, manifest.entryCount);
assert.equal(conformance.capabilities.length, manifest.entryCount);
assert.equal(conformance.unexplainedRouteCount, 0);
assert.equal(conformance.unexplainedCapabilityCount, 0);
assert.match(conformance.conformanceVersion, /^[a-f0-9]{64}$/);
assert.equal(
  new Set(conformance.routes.map((route) => route.routeId)).size,
  conformance.routes.length,
);

let sharedRoutes = 0;
for (const route of conformance.routes) {
  assert.ok(route.file.startsWith("artifacts/api-server/src/routes/"));
  assert.match(route.method, /^(get|post|put|patch|delete)$/);
  assert.ok(route.path.length > 0);
  assert.ok(route.divergence, `${route.method} ${route.path} must explain route-only authority`);
  assert.equal(route.divergence.status, "approved");
  assert.ok(route.divergence.reason.length > 10);
  assert.match(route.divergence.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  if (route.executorContract) {
    sharedRoutes += 1;
    assert.equal(route.divergence.owner, "Agent Platform");
    assert.equal(route.executorContract, "account-dossier-read-v1");
    assert.ok(Object.values(route.conformance).some((value) => value.startsWith("proven:")));
    assert.ok(Object.values(route.conformance).every((value) => value !== "unproven"));
  } else {
    assert.ok(route.divergence.owner.length > 2);
    assert.ok(
      Object.values(route.conformance).every((value) => value === "unproven"),
      `${route.method} ${route.path} must not claim untested equivalence`,
    );
  }
  if (route.capabilityId) {
    assert.ok(
      manifest.entries.some((entry) => entry.capabilityId === route.capabilityId),
      `${route.method} ${route.path} references a missing capability`,
    );
    assert.equal(
      route.evidence,
      route.executorContract
        ? "tests/riser-foundation/account-dossier-conformance.ts"
        : "curated_surface_mapping",
    );
  }
}
assert.equal(sharedRoutes, 1);

console.log(
  `riser route conformance probes passed (${conformance.routeCount} routes, zero unexplained)`,
);