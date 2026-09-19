import {
  backfillLegacyTurnMetadata,
  migrateAllLegacyTurns,
  verifyLegacyTurnMetadata,
} from "../src/lib/assistant/legacy-turn-migration.js";

const orgArg = process.argv.find((arg) => arg.startsWith("--org="));
const orgId = orgArg?.slice("--org=".length);
if (!orgId || !/^[A-Za-z0-9_.:-]{1,200}$/.test(orgId)) {
  throw new Error("usage: --org=<safe-org-id> [--backfill] [--limit=<1..5000>]");
}
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 500;
if (!Number.isInteger(limit) || limit < 1 || limit > 5_000) {
  throw new Error("limit must be an integer from 1 to 5000");
}

if (process.argv.includes("--backfill")) {
  const result = await migrateAllLegacyTurns({ orgId, batchSize: limit });
  console.log(JSON.stringify({ phase: "migrate", ...result }));
}
const verification = await verifyLegacyTurnMetadata({ orgId });
console.log(JSON.stringify({ phase: "verify", ...verification }));
if (
  verification.pending > 0 ||
  verification.unconvertedPendingWrites > 0 ||
  verification.expiredLegacyReaders > 0 ||
  verification.insufficientLegacyReaders > 0 ||
  verification.digestMismatches.length > 0
) process.exitCode = 1;