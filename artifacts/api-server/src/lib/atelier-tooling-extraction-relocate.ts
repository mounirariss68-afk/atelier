import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * One-time data repair (idempotent, boot-safe): two merged features had both
 * claimed atelier_partner_firm_invoices.line_items — the supplier-invoice
 * itemization stores an ARRAY there, while the vendor tooling-cost extraction
 * used to store an OBJECT (with a `status` key) in the same slot. The
 * extraction now lives in its own `tooling_extraction` column, and all readers
 * use only that column, so any extraction payload still sitting in
 * `line_items` would silently disappear from the tooling screens.
 *
 * Schema changes reach production via the push-based diff (which adds the
 * empty column but never moves data), so this relocation must ride the boot
 * chores: move status-bearing OBJECTS out of line_items exactly once, leave
 * legitimate array itemizations untouched, and no-op on every later boot.
 */
export async function ensureToolingExtractionRelocated(): Promise<number> {
  const [{ exists }] = (
    await db.execute<{ exists: boolean }>(sql`
      SELECT to_regclass('atelier_partner_firm_invoices') IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_name = 'atelier_partner_firm_invoices'
                 AND column_name = 'tooling_extraction'
             ) AS exists
    `)
  ).rows;
  if (!exists) return 0;
  const res = await db.execute(sql`
    UPDATE atelier_partner_firm_invoices
    SET tooling_extraction = line_items,
        line_items = NULL
    WHERE tooling_extraction IS NULL
      AND line_items IS NOT NULL
      AND jsonb_typeof(line_items) = 'object'
      AND line_items ? 'status'
  `);
  return res.rowCount ?? 0;
}
