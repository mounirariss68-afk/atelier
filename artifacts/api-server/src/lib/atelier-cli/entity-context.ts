/**
 * Task #411 — Context graph traverser.
 *
 * Walks the existing FK graph in Postgres up to `depth` hops from a
 * resolved entity and returns a typed neighbourhood. The orchestrator
 * injects this as a structured `<context>` block into the Sonnet
 * system prompt so the model never has to guess parent ids or
 * adjacent-entity status — the data is in front of it.
 *
 * Why not a graph DB: ~90% of orchestrator queries are 1–2 hops, the
 * FK graph already exists, and pgvector + pg_trgm cover the semantic
 * edge cases without a second store. See the architectural decision
 * in task-411.md.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierOpportunities,
  atelierOpportunityStageTransitions,
  atelierEngagements,
  atelierContacts,
  atelierDeliverables,
  atelierRaidItems,
} from "@workspace/db";

export type ContextKind =
  | "account"
  | "opportunity"
  | "engagement"
  | "contact"
  | "deliverable";

export interface EntityContext {
  kind: ContextKind;
  id: string;
  label: string;
  fields: Record<string, unknown>;
  /** Immediate FK neighbours, grouped by relationship. */
  related: Array<{
    relation: string;
    kind: string;
    id: string;
    label: string;
    summary?: string;
  }>;
  /** Depth=2 expansions for the model when the verb implies them. */
  deeper?: Record<string, EntityContext[]>;
}

const HOP_LIMIT_PER_RELATION = 5;

export async function getEntityContext(
  kind: ContextKind,
  id: string,
  orgId: string,
  depth: 1 | 2 = 1,
): Promise<EntityContext | null> {
  if (kind === "account") return accountContext(id, orgId, depth);
  if (kind === "opportunity") return opportunityContext(id, orgId, depth);
  if (kind === "engagement") return engagementContext(id, orgId, depth);
  if (kind === "contact") return contactContext(id, orgId);
  if (kind === "deliverable") return deliverableContext(id, orgId);
  return null;
}

async function accountContext(id: string, orgId: string, depth: 1 | 2): Promise<EntityContext | null> {
  const [a] = await db
    .select()
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, id), eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt)))
    .limit(1);
  if (!a) return null;
  const opps = await db
    .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, salesStage: atelierOpportunities.salesStage })
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.accountId, id), eq(atelierOpportunities.orgId, orgId), isNull(atelierOpportunities.deletedAt)))
    .limit(HOP_LIMIT_PER_RELATION);
  const contacts = await db
    .select({ id: atelierContacts.id, fullName: atelierContacts.fullName, title: atelierContacts.title })
    .from(atelierContacts)
    .where(and(eq(atelierContacts.accountId, id), eq(atelierContacts.orgId, orgId), isNull(atelierContacts.deletedAt)))
    .limit(HOP_LIMIT_PER_RELATION);
  const ctx: EntityContext = {
    kind: "account",
    id: a.id,
    label: a.brandName ?? a.name,
    fields: {
      sector: a.sector,
      country: a.country,
      tier: a.tier,
      status: a.status,
      partnerOwnerId: a.partnerOwnerId,
    },
    related: [
      ...opps.map((o) => ({ relation: "opportunity", kind: "opportunity", id: o.id, label: o.name, summary: `stage: ${o.salesStage}` })),
      ...contacts.map((c) => ({ relation: "contact", kind: "contact", id: c.id, label: c.fullName, summary: c.title ?? undefined })),
    ],
  };
  if (depth >= 2) {
    ctx.deeper = {
      opportunities: await Promise.all(opps.map(async (o) => (await opportunityContext(o.id, orgId, 1)) as EntityContext)),
    };
  }
  return ctx;
}

async function opportunityContext(id: string, orgId: string, depth: 1 | 2): Promise<EntityContext | null> {
  const [o] = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, id), eq(atelierOpportunities.orgId, orgId), isNull(atelierOpportunities.deletedAt)))
    .limit(1);
  if (!o) return null;
  const [acct] = await db
    .select({ id: atelierAccounts.id, name: atelierAccounts.name, brandName: atelierAccounts.brandName, country: atelierAccounts.country, sector: atelierAccounts.sector })
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, o.accountId))
    .limit(1);
  const transitions = await db
    .select({ id: atelierOpportunityStageTransitions.id, fromStage: atelierOpportunityStageTransitions.fromStage, toStage: atelierOpportunityStageTransitions.toStage, createdAt: atelierOpportunityStageTransitions.createdAt })
    .from(atelierOpportunityStageTransitions)
    .where(eq(atelierOpportunityStageTransitions.opportunityId, id))
    .orderBy(desc(atelierOpportunityStageTransitions.createdAt))
    .limit(3);
  const engs = await db
    .select({ id: atelierEngagements.id, name: atelierEngagements.name, plmStage: atelierEngagements.plmStage })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.opportunityId, id), eq(atelierEngagements.orgId, orgId), isNull(atelierEngagements.deletedAt)))
    .limit(HOP_LIMIT_PER_RELATION);
  return {
    kind: "opportunity",
    id: o.id,
    label: o.name,
    fields: {
      salesStage: o.salesStage,
      plmStage: o.plmStage,
      probabilityPct: o.probabilityPct,
      dealSizeHypothesis: o.dealSizeHypothesis,
      partnerOwnerId: o.partnerOwnerId,
      engagementLeadId: o.engagementLeadId,
      runnerEnteredAt: o.runnerEnteredAt,
      contractSignedAt: o.contractSignedAt,
    },
    related: [
      acct ? { relation: "account", kind: "account", id: acct.id, label: acct.brandName ?? acct.name, summary: `${acct.sector} / ${acct.country}` } : null,
      ...engs.map((e) => ({ relation: "engagement", kind: "engagement", id: e.id, label: e.name, summary: `phase: ${e.plmStage}` })),
      ...transitions.map((t) => ({
        relation: "stage_transition",
        kind: "stage_transition",
        id: t.id,
        label: `${t.fromStage ?? "∅"} → ${t.toStage}`,
        summary: t.createdAt ? new Date(t.createdAt).toISOString() : undefined,
      })),
    ].filter((x): x is NonNullable<typeof x> => Boolean(x)),
    deeper: depth >= 2 && acct ? { account: [(await accountContext(acct.id, orgId, 1)) as EntityContext] } : undefined,
  };
}

async function engagementContext(id: string, orgId: string, depth: 1 | 2): Promise<EntityContext | null> {
  const [e] = await db
    .select()
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, id), eq(atelierEngagements.orgId, orgId), isNull(atelierEngagements.deletedAt)))
    .limit(1);
  if (!e) return null;
  const raids = await db
    .select({ id: atelierRaidItems.id, kind: atelierRaidItems.kind, description: atelierRaidItems.description, status: atelierRaidItems.status })
    .from(atelierRaidItems)
    .where(and(eq(atelierRaidItems.engagementId, id), eq(atelierRaidItems.orgId, orgId), isNull(atelierRaidItems.deletedAt)))
    .limit(HOP_LIMIT_PER_RELATION);
  const dels = await db
    .select({ id: atelierDeliverables.id, name: atelierDeliverables.name, status: atelierDeliverables.status })
    .from(atelierDeliverables)
    .where(and(eq(atelierDeliverables.engagementId, id), eq(atelierDeliverables.orgId, orgId), isNull(atelierDeliverables.deletedAt)))
    .limit(HOP_LIMIT_PER_RELATION);
  return {
    kind: "engagement",
    id: e.id,
    label: e.name,
    fields: {
      plmStage: e.plmStage,
      raidStatus: e.raidStatus,
      partnerOwnerId: e.partnerOwnerId,
      engagementLeadId: e.engagementLeadId,
      startDate: e.startDate,
      plannedEndDate: e.plannedEndDate,
    },
    related: [
      ...raids.map((r) => ({ relation: "raid_item", kind: "raid_item", id: r.id, label: r.description, summary: `${r.kind} / ${r.status}` })),
      ...dels.map((d) => ({ relation: "deliverable", kind: "deliverable", id: d.id, label: d.name, summary: d.status })),
    ],
  };
}

async function contactContext(id: string, orgId: string): Promise<EntityContext | null> {
  const [c] = await db
    .select()
    .from(atelierContacts)
    .where(and(eq(atelierContacts.id, id), eq(atelierContacts.orgId, orgId), isNull(atelierContacts.deletedAt)))
    .limit(1);
  if (!c) return null;
  return {
    kind: "contact",
    id: c.id,
    label: c.fullName,
    fields: { title: c.title, accountId: c.accountId, disposition: c.disposition, influenceScore: c.influenceScore },
    related: [],
  };
}

async function deliverableContext(id: string, orgId: string): Promise<EntityContext | null> {
  const [d] = await db
    .select()
    .from(atelierDeliverables)
    .where(and(eq(atelierDeliverables.id, id), eq(atelierDeliverables.orgId, orgId), isNull(atelierDeliverables.deletedAt)))
    .limit(1);
  if (!d) return null;
  return {
    kind: "deliverable",
    id: d.id,
    label: d.name,
    fields: { status: d.status, type: d.type, criticReadiness: d.criticReadiness, engagementId: d.engagementId, dueDate: d.dueDate },
    related: [],
  };
}

/** Compact textual summary the model can read from the system prompt. */
export function formatContextForPrompt(ctx: EntityContext | null): string {
  if (!ctx) return "";
  const lines: string[] = [
    `<context kind="${ctx.kind}" id="${ctx.id}" label="${ctx.label.replace(/"/g, "'")}">`,
  ];
  for (const [k, v] of Object.entries(ctx.fields)) {
    if (v == null || v === "") continue;
    lines.push(`  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  if (ctx.related.length > 0) {
    lines.push("  related:");
    for (const r of ctx.related) {
      lines.push(`    - ${r.relation} ${r.kind}/${r.id} "${r.label}"${r.summary ? ` (${r.summary})` : ""}`);
    }
  }
  lines.push("</context>");
  return lines.join("\n");
}
