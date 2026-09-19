import { createHash } from "node:crypto";
import {
  CATALOG_SCHEMA_VERSION,
  hashSchema,
  listCapabilities,
  type CapabilityEntry,
} from "./capability-catalog.js";

export interface CapabilityManifestEntryV1 {
  capabilityId: string;
  toolName: string;
  source: CapabilityEntry["source"];
  catalogVersion: number;
  inputSchemaVersion: number;
  inputSchemaHash: string;
  resultSchemaHash: string;
  effect: "read" | "write";
  executionStatus: "executable" | "unsupported" | "legacy_compat";
  roles: readonly string[];
  approverRoles: readonly string[];
  confirmation: {
    required: boolean;
    irreversible: boolean;
    outboundChannel: string | null;
  };
  presentation: { cardType: string | null };
}

const STANDARD_RESULT_SCHEMA_HASH = createHash("sha256")
  .update("atelier-tool-result-v1")
  .digest("hex")
  .slice(0, 12);

function assertManifestEntry(entry: CapabilityEntry): void {
  if (!/^[a-z0-9_.-]+$/.test(entry.id)) throw new Error(`manifest-invalid-id:${entry.id}`);
  if (!/^[a-z0-9_]+$/.test(entry.toolName)) {
    throw new Error(`manifest-invalid-tool:${entry.id}`);
  }
  if (entry.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new Error(`manifest-catalog-version-mismatch:${entry.id}`);
  }
  if (entry.schemaHash !== hashSchema(entry.inputSchema)) {
    throw new Error(`manifest-schema-hash-mismatch:${entry.id}`);
  }
  if (entry.inputSchema.type !== "object") throw new Error(`manifest-non-object-input:${entry.id}`);
  if (!entry.isWrite && entry.twoPhaseConfirm) {
    throw new Error(`manifest-read-confirm-mismatch:${entry.id}`);
  }
  if (
    entry.executionStatus !== "unsupported" &&
    typeof entry.run !== "function"
  ) {
    throw new Error(`manifest-missing-executor:${entry.id}`);
  }
}

export function generateCapabilityManifestV1(): readonly CapabilityManifestEntryV1[] {
  const capabilities = [...listCapabilities()];
  const ids = new Set<string>();
  const tools = new Set<string>();
  const manifest = capabilities.map((entry) => {
    assertManifestEntry(entry);
    if (ids.has(entry.id)) throw new Error(`manifest-duplicate-id:${entry.id}`);
    if (tools.has(entry.toolName)) throw new Error(`manifest-duplicate-tool:${entry.toolName}`);
    ids.add(entry.id);
    tools.add(entry.toolName);
    return {
      capabilityId: entry.id,
      toolName: entry.toolName,
      source: entry.source,
      catalogVersion: CATALOG_SCHEMA_VERSION,
      inputSchemaVersion: entry.schemaVersion,
      inputSchemaHash: entry.schemaHash,
      resultSchemaHash: STANDARD_RESULT_SCHEMA_HASH,
      effect: entry.isWrite ? "write" as const : "read" as const,
      executionStatus:
        entry.executionStatus ??
        (entry.isWrite && !entry.twoPhaseConfirm ? "legacy_compat" : "executable"),
      roles: [...(entry.requiredRoles ?? [])].sort(),
      approverRoles: [...(entry.approverRoles ?? entry.requiredRoles ?? [])].sort(),
      confirmation: {
        required: entry.twoPhaseConfirm,
        irreversible: entry.irreversible,
        outboundChannel: entry.outboundChannel,
      },
      presentation: { cardType: entry.resultCard },
    };
  });
  if (manifest.length !== capabilities.length || ids.size !== capabilities.length) {
    throw new Error("manifest-incomplete");
  }
  return manifest.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}

export function capabilityManifestVersion(
  manifest = generateCapabilityManifestV1(),
): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}