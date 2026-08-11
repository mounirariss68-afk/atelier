/**
 * Task #969 — the canonical NEP schema moved into src/lib so the boot-time
 * ingestion seed (src/lib/atelier-seed-nep-template.ts) can import it inside
 * the api-server's rootDir. This file stays as a re-export so the scripts
 * and tests that import it keep working unchanged.
 */
export * from "../src/lib/nep-template-schema.js";
