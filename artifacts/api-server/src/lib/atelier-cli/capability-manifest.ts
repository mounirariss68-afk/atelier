import { createHash } from "node:crypto";
import {
  CATALOG_SCHEMA_VERSION,
  hashSchema,
  listCapabilities,
  type CapabilityEntry,
  capabilitiesForPersona,
} from "./capability-catalog.js";
import { assertCapabilityDivergences } from "./capability-divergences.js";
import { ATELIER_PERSONA_ROLES } from "../../routes/atelier/personaRoles.js";
import reviewedManifestJson from "./generated/capability-manifest.v1.json";

export interface CapabilityManifestEntryV1 {
  capabilityId: string;
  toolName: string;
  source: CapabilityEntry["source"];
  catalogVersion: number;
  inputSchemaVersion: number;
  inputSchemaHash: string;
  resultSchemaHash: string;
  effect: "read" | "write";
  effectClass: CapabilityEntry["effectClass"];
  executionStatus: "executable" | "unsupported" | "legacy_compat";
  policyClass: CapabilityEntry["policyClass"];
  implementationVersion: string;
  roles: readonly string[];
  effectiveRoles: readonly string[];
  approverRoles: readonly string[];
  confirmation: {
    required: boolean;
    irreversible: boolean;
    outboundChannel: string | null;
  };
  presentation: CapabilityEntry["presentationContract"];
  divergenceIds: readonly string[];
}

export interface CapabilityManifestDocumentV1 {
  manifestSchemaVersion: 1;
  catalogSchemaVersion: number;
  manifestVersion: string;
  entryCount: number;
  entries: readonly CapabilityManifestEntryV1[];
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
  if (!/^[a-f0-9]{12}$/.test(entry.implementationVersion)) {
    throw new Error(`manifest-invalid-implementation-version:${entry.id}`);
  }
  if (entry.executionStatus === "executable" && entry.isWrite && !entry.twoPhaseConfirm) {
    throw new Error(`manifest-executable-write-without-confirmation:${entry.id}`);
  }
  if (entry.executionStatus === "legacy_compat" && entry.divergenceIds.length === 0) {
    throw new Error(`manifest-legacy-without-divergence:${entry.id}`);
  }
  if (entry.source === "cli-only" && !entry.divergenceIds.includes("cli-only-route-parity-v1")) {
    throw new Error(`manifest-cli-only-without-divergence:${entry.id}`);
  }
  if (entry.presentationContract.cardType !== entry.resultCard) {
    throw new Error(`manifest-presentation-contract-mismatch:${entry.id}`);
  }
  assertCapabilityDivergences(entry.divergenceIds);
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
      effectClass: entry.effectClass,
      executionStatus:
        entry.executionStatus ??
        (entry.isWrite && !entry.twoPhaseConfirm ? "legacy_compat" : "executable"),
      roles: [...(entry.requiredRoles ?? [])].sort(),
      effectiveRoles: ATELIER_PERSONA_ROLES.filter((role) =>
        capabilitiesForPersona({
          id: "manifest-role-probe",
          name: "Manifest role probe",
          orgId: "manifest",
          role,
        }).some((candidate) => candidate.id === entry.id)
      ).sort(),
      policyClass: entry.policyClass,
      implementationVersion: entry.implementationVersion,
      approverRoles: [...(entry.approverRoles ?? entry.requiredRoles ?? [])].sort(),
      confirmation: {
        required: entry.twoPhaseConfirm,
        irreversible: entry.irreversible,
        outboundChannel: entry.outboundChannel,
      },
      presentation: entry.presentationContract,
      divergenceIds: [...entry.divergenceIds],
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

export function generateCapabilityManifestDocumentV1(): CapabilityManifestDocumentV1 {
  const entries = generateCapabilityManifestV1();
  return {
    manifestSchemaVersion: 1,
    catalogSchemaVersion: CATALOG_SCHEMA_VERSION,
    manifestVersion: capabilityManifestVersion(entries),
    entryCount: entries.length,
    entries,
  };
}

export function currentCapabilityManifestVersion(): string {
  assertRuntimeCatalogMatchesReviewedManifest();
  return reviewedCapabilityManifestDocument().manifestVersion;
}

export function assertCurrentCapabilityManifestVersion(version: string): void {
  if (version !== currentCapabilityManifestVersion()) {
    throw new Error("capability-manifest-version-unsupported");
  }
}

export function reviewedCapabilityManifestDocument(): CapabilityManifestDocumentV1 {
  return reviewedManifestJson as CapabilityManifestDocumentV1;
}

export function assertRuntimeCatalogMatchesReviewedManifest(): void {
  const live = generateCapabilityManifestDocumentV1();
  const reviewed = reviewedCapabilityManifestDocument();
  if (JSON.stringify(live) !== JSON.stringify(reviewed)) {
    throw new Error("capability-reviewed-manifest-drift");
  }
}

export function reviewedCapabilityManifestEntry(
  capabilityId: string,
): CapabilityManifestEntryV1 | undefined {
  return reviewedCapabilityManifestDocument().entries.find(
    (entry) => entry.capabilityId === capabilityId,
  );
}