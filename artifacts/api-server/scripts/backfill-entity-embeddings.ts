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
 * NOTE: must be re-run on main and prod after merge; task-agent DB data
 * never auto-merges into the production database.
 */

import "dotenv/config";
import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  atelierAccounts,
  atelierOpportunities,
  atelierEngagements,
  atelierContacts,
  atelierEntityEmbeddings,
} from "@workspace/db/schema";
import { mirrorEntityEmbedding } from "../src/lib/atelier-cli/entity-resolver.js";

const APPLY = process.argv.includes("--apply");
const BATCH = 50;

if (!APPLY) {
  console.log("🔍  Dry-run mode (pass --apply to write). Counting gaps...\n");
}

interface Gap {
  orgId: string;
  kind: string;
  id: string;
  label: string;
}

async function collectGaps(): Promise<Gap[]> {
  const gaps: Gap[] = [];

  // ── Accounts ──────────────────────────────────────────────────────────────
  const accounts = await db
    .select({ id: atelierAccounts.id, orgId: atelierAccounts.orgId, name: atelierAccounts.name, brandName: atelierAccounts.brandName })
    .from(atelierAccounts)
    .where(isNull(atelierAccounts.deletedAt));

  for (const a of accounts) {
    const label = a.brandName ?? a.name;
    const [emb] = await db
      .select({ label: atelierEntityEmbeddings.label })
      .from(atelierEntityEmbeddings)
      .where(
        and(
          eq(atelierEntityEmbeddings.targetId, a.id),
          eq(atelierEntityEmbeddings.orgId, a.orgId),
          eq(atelierEntityEmbeddings.kind, "account"),
        ),
      )
      .limit(1);
    if (!emb || emb.label !== label) {
      gaps.push({ orgId: a.orgId, kind: "account", id: a.id, label });
    }
  }

  // ── Opportunities ──────────────────────────────────────────────────────────
  const opps = await db
    .select({ id: atelierOpportunities.id, orgId: atelierOpportunities.orgId, name: atelierOpportunities.name })
    .from(atelierOpportunities)
    .where(isNull(atelierOpportunities.deletedAt));

  for (const o of opps) {
    const [emb] = await db
      .select({ label: atelierEntityEmbeddings.label })
      .from(atelierEntityEmbeddings)
      .where(
        and(
          eq(atelierEntityEmbeddings.targetId, o.id),
          eq(atelierEntityEmbeddings.orgId, o.orgId),
          eq(atelierEntityEmbeddings.kind, "opportunity"),
        ),
      )
      .limit(1);
    if (!emb || emb.label !== o.name) {
      gaps.push({ orgId: o.orgId, kind: "opportunity", id: o.id, label: o.name });
    }
  }

  // ── Engagements ────────────────────────────────────────────────────────────
  const engs = await db
    .select({ id: atelierEngagements.id, orgId: atelierEngagements.orgId, name: atelierEngagements.name })
    .from(atelierEngagements)
    .where(isNull(atelierEngagements.deletedAt));

  for (const e of engs) {
    const [emb] = await db
      .select({ label: atelierEntityEmbeddings.label })
      .from(atelierEntityEmbeddings)
      .where(
        and(
          eq(atelierEntityEmbeddings.targetId, e.id),
          eq(atelierEntityEmbeddings.orgId, e.orgId),
          eq(atelierEntityEmbeddings.kind, "engagement"),
        ),
      )
      .limit(1);
    if (!emb || emb.label !== e.name) {
      gaps.push({ orgId: e.orgId, kind: "engagement", id: e.id, label: e.name });
    }
  }

  // ── Contacts ───────────────────────────────────────────────────────────────
  const contacts = await db
    .select({ id: atelierContacts.id, orgId: atelierContacts.orgId, fullName: atelierContacts.fullName })
    .from(atelierContacts)
    .where(isNull(atelierContacts.deletedAt));

  for (const c of contacts) {
    const [emb] = await db
      .select({ label: atelierEntityEmbeddings.label })
      .from(atelierEntityEmbeddings)
      .where(
        and(
          eq(atelierEntityEmbeddings.targetId, c.id),
          eq(atelierEntityEmbeddings.orgId, c.orgId),
          eq(atelierEntityEmbeddings.kind, "contact"),
        ),
      )
      .limit(1);
    if (!emb || emb.label !== c.fullName) {
      gaps.push({ orgId: c.orgId, kind: "contact", id: c.id, label: c.fullName });
    }
  }

  return gaps;
}

async function main() {
  const gaps = await collectGaps();

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

  console.log("\nWriting embeddings in batches of", BATCH, "...");
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < gaps.length; i += BATCH) {
    const batch = gaps.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (g) => {
        try {
          await mirrorEntityEmbedding(g.orgId, g.kind as Parameters<typeof mirrorEntityEmbedding>[1], g.id, g.label);
          ok++;
        } catch (err) {
          console.error(`  ✗ ${g.kind} ${g.id}: ${err instanceof Error ? err.message : String(err)}`);
          fail++;
        }
      }),
    );
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: ${Math.min(i + BATCH, gaps.length)}/${gaps.length} processed`);
  }

  console.log(`\n✓ done — ${ok} written, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
