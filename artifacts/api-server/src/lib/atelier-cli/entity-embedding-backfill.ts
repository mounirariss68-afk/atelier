/**
 * Entity-embedding gap backfill (Task #779).
 *
 * Fills `atelier_entity_embeddings` for live accounts, opportunities,
 * engagements, and contacts that are either missing a row entirely or
 * whose stored label no longer matches the entity's current name.
 *
 * Idempotent and re-runnable. Deliberately leaves orphan embedding rows
 * for deleted entities — the resolver tolerates missing targets.
 *
 * Used from two places:
 *  - the boot-chore chain in src/index.ts (runs against whatever DB the
 *    server is deployed on — this is how production gets backfilled at
 *    go-live, since the workspace has no prod write credentials), and
 *  - scripts/backfill-entity-embeddings.ts for manual dry-run/apply.
 */
import { eq, isNull, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  atelierAccounts,
  atelierOpportunities,
  atelierEngagements,
  atelierContacts,
  atelierEntityEmbeddings,
} from "@workspace/db/schema";
import { mirrorEntityEmbedding } from "./entity-resolver.js";

export interface EntityEmbeddingGap {
  orgId: string;
  kind: "account" | "opportunity" | "engagement" | "contact";
  id: string;
  label: string;
}

async function existingLabel(
  orgId: string,
  kind: string,
  targetId: string,
): Promise<string | null> {
  const [emb] = await db
    .select({ label: atelierEntityEmbeddings.label })
    .from(atelierEntityEmbeddings)
    .where(
      and(
        eq(atelierEntityEmbeddings.targetId, targetId),
        eq(atelierEntityEmbeddings.orgId, orgId),
        eq(atelierEntityEmbeddings.kind, kind),
      ),
    )
    .limit(1);
  return emb ? emb.label : null;
}

export async function collectEntityEmbeddingGaps(): Promise<EntityEmbeddingGap[]> {
  const gaps: EntityEmbeddingGap[] = [];

  const accounts = await db
    .select({
      id: atelierAccounts.id,
      orgId: atelierAccounts.orgId,
      name: atelierAccounts.name,
      brandName: atelierAccounts.brandName,
    })
    .from(atelierAccounts)
    .where(isNull(atelierAccounts.deletedAt));
  for (const a of accounts) {
    const label = a.brandName ?? a.name;
    if ((await existingLabel(a.orgId, "account", a.id)) !== label) {
      gaps.push({ orgId: a.orgId, kind: "account", id: a.id, label });
    }
  }

  const opps = await db
    .select({ id: atelierOpportunities.id, orgId: atelierOpportunities.orgId, name: atelierOpportunities.name })
    .from(atelierOpportunities)
    .where(isNull(atelierOpportunities.deletedAt));
  for (const o of opps) {
    if ((await existingLabel(o.orgId, "opportunity", o.id)) !== o.name) {
      gaps.push({ orgId: o.orgId, kind: "opportunity", id: o.id, label: o.name });
    }
  }

  const engs = await db
    .select({ id: atelierEngagements.id, orgId: atelierEngagements.orgId, name: atelierEngagements.name })
    .from(atelierEngagements)
    .where(isNull(atelierEngagements.deletedAt));
  for (const e of engs) {
    if ((await existingLabel(e.orgId, "engagement", e.id)) !== e.name) {
      gaps.push({ orgId: e.orgId, kind: "engagement", id: e.id, label: e.name });
    }
  }

  const contacts = await db
    .select({ id: atelierContacts.id, orgId: atelierContacts.orgId, fullName: atelierContacts.fullName })
    .from(atelierContacts)
    .where(isNull(atelierContacts.deletedAt));
  for (const c of contacts) {
    if ((await existingLabel(c.orgId, "contact", c.id)) !== c.fullName) {
      gaps.push({ orgId: c.orgId, kind: "contact", id: c.id, label: c.fullName });
    }
  }

  return gaps;
}

const BATCH = 50;

/**
 * Write embeddings for every gap. mirrorEntityEmbedding swallows its own
 * errors (logging loudly), so this never throws per-row; callers can
 * verify by re-collecting gaps afterwards.
 */
export async function backfillEntityEmbeddings(
  gaps?: EntityEmbeddingGap[],
): Promise<{ processed: number; byKind: Record<string, number> }> {
  const work = gaps ?? (await collectEntityEmbeddingGaps());
  const byKind: Record<string, number> = {};
  for (const g of work) byKind[g.kind] = (byKind[g.kind] ?? 0) + 1;

  for (let i = 0; i < work.length; i += BATCH) {
    const batch = work.slice(i, i + BATCH);
    await Promise.all(
      batch.map((g) => mirrorEntityEmbedding(g.orgId, g.kind, g.id, g.label)),
    );
  }
  return { processed: work.length, byKind };
}
