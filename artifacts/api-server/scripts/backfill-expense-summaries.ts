/**
 * Task #505 — One-off backfill: recompose enriched expense summaries
 * (trip route, flight class, hotel nights, …) for expenses parsed BEFORE
 * the enrichment change, using the details still stored in ocrPayload.
 * Rows whose ocrPayload has already been redacted by the 90-day sweep are
 * skipped (nothing to recompose from).
 *
 * Run from the repo root:
 *   npx tsx artifacts/api-server/scripts/backfill-expense-summaries.ts          # dry run
 *   npx tsx artifacts/api-server/scripts/backfill-expense-summaries.ts --apply  # write
 */
import { db, atelierExpenses } from "@workspace/db";
import { eq, isNull, isNotNull, and } from "drizzle-orm";
import {
  sanitizeReceiptDetails,
  formatReceiptDetails,
} from "../src/lib/atelier-receipt-parse";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await db
    .select({
      id: atelierExpenses.id,
      summary: atelierExpenses.summary,
      ocrPayload: atelierExpenses.ocrPayload,
    })
    .from(atelierExpenses)
    .where(
      and(
        isNull(atelierExpenses.deletedAt),
        isNull(atelierExpenses.ocrPayloadRedactedAt),
        isNotNull(atelierExpenses.ocrPayload),
      ),
    );

  let updated = 0;
  let skippedNoDetails = 0;
  let skippedAlreadyEnriched = 0;

  for (const row of rows) {
    const payload = row.ocrPayload as Record<string, unknown> | null;
    const details = sanitizeReceiptDetails(payload?.details);
    if (!details) {
      skippedNoDetails++;
      continue;
    }
    const fragment = formatReceiptDetails(details);
    if (!fragment) {
      skippedNoDetails++;
      continue;
    }
    const base = (row.summary ?? "").trim();
    if (base.includes(fragment)) {
      skippedAlreadyEnriched++;
      continue;
    }
    const next = base ? `${base} — ${fragment}` : fragment;
    console.log(`[${APPLY ? "UPDATE" : "DRY"}] ${row.id}`);
    console.log(`  before: ${base || "(empty)"}`);
    console.log(`  after:  ${next}`);
    if (APPLY) {
      await db
        .update(atelierExpenses)
        .set({ summary: next, updatedAt: new Date() })
        .where(eq(atelierExpenses.id, row.id));
    }
    updated++;
  }

  console.log(
    `\nDone. scanned=${rows.length} ${APPLY ? "updated" : "would-update"}=${updated} ` +
      `no-details=${skippedNoDetails} already-enriched=${skippedAlreadyEnriched}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
