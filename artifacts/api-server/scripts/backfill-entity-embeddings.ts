/**
 * scripts/backfill-entity-embeddings.ts
 *
 * Backfill atelier_entity_embeddings for accounts, opportunities,
 * engagements, and contacts that are either missing a row entirely
 * or whose stored label no longer matches the entity's current name.
 *
 * Usage:
 *   npx tsx artifacts/api-server/scripts/backfill-entity-embeddings.ts            # dry-run
 *   npx tsx artifacts/api-server/scripts/backfill-entity-embeddings.ts --apply    # write
 *
 * NOTE (Task #779): the same gap-fill now also runs automatically as a
 * boot chore in src/index.ts, so production self-heals on deploy/go-live
 * (the workspace has no prod write credentials). This script remains for
 * manual dry-run inspection and ad-hoc reruns against the dev DB.
 */

import "dotenv/config";
import {
  collectEntityEmbeddingGaps,
  backfillEntityEmbeddings,
} from "../src/lib/atelier-cli/entity-embedding-backfill.js";

const APPLY = process.argv.includes("--apply");

if (!APPLY) {
  console.log("🔍  Dry-run mode (pass --apply to write). Counting gaps...\n");
}

async function main() {
  const gaps = await collectEntityEmbeddingGaps();

  const byKind: Record<string, number> = {};
  for (const g of gaps) byKind[g.kind] = (byKind[g.kind] ?? 0) + 1;

  console.log(`Found ${gaps.length} entity embedding gap(s):`);
  for (const [kind, count] of Object.entries(byKind)) {
    console.log(`  ${kind}: ${count}`);
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to write the embeddings.");
    process.exit(0);
  }

  console.log("\nWriting embeddings...");
  const res = await backfillEntityEmbeddings(gaps);

  // mirrorEntityEmbedding swallows per-row errors (logging them), so
  // verify by re-collecting gaps after the write.
  const remaining = await collectEntityEmbeddingGaps();
  console.log(
    `\n✓ done — ${res.processed} processed, ${remaining.length} gap(s) remaining`,
  );
  process.exit(remaining.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
