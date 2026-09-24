import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RiserEvalObservation } from "./pure-observations.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// Bind the database-backed security observations to the code and schema they
// exercised. The publish builder cannot provision a scratch database; changes
// to these authorities require a fresh full evaluation before publishing.
const securitySources = [
  "artifacts/api-server/tests/riser-eval/security-observations.ts",
  "artifacts/api-server/src/lib/assistant/action-runtime.ts",
  "artifacts/api-server/src/lib/assistant/durable-account-update.ts",
  "artifacts/api-server/src/lib/assistant/durable-account-update-confirmation.ts",
  "artifacts/api-server/src/lib/assistant/control-runtime.ts",
  "artifacts/api-server/src/lib/atelier-cli/capability-catalog.ts",
  "artifacts/api-server/src/routes/atelier/accountRoutes.ts",
  "artifacts/api-server/src/routes/atelier/engagementRoutes.ts",
  "lib/db/src/schema/atelier-assistant.ts",
  "lib/db/src/schema/atelier.ts",
  "lib/db/src/atelier-rls.sql",
] as const;

export function securitySourceDigest(): string {
  const hash = createHash("sha256");
  for (const path of securitySources) {
    hash.update(path).update("\0").update(readFileSync(resolve(root, path))).update("\0");
  }
  return hash.digest("hex");
}

export interface ReviewedSecurityEvidence {
  sourceDigest: string;
  catalogVersion: string;
  datasetVersion: string;
  observations: RiserEvalObservation[];
}