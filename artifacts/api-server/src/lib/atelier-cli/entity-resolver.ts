/**
 * Task #411 — Hybrid entity resolver (pg_trgm + pgvector).
 *
 * The orchestrator's `resolve_entity` capability and the per-turn
 * pre-LLM resolution prelude both call this helper. It runs a typed
 * cascade:
 *
 *   1. Exact id match — bypass everything when the user pasted an id.
 *   2. pg_trgm similarity — uses the GIN indexes seeded by
 *      `atelier-cli-rag.sql`. Returns rows above SIM_THRESHOLD.
 *      Backed by ILIKE when the extension is missing so callers always
 *      get a usable answer.
 *   3. pgvector ANN — embeds the query text and ranks
 *      `atelier_entity_embeddings` by cosine. Used for the new chat-
 *      owned kinds that don't have a single dedicated `name` column
 *      (raid_item, expense, win_theme, …) and as a tiebreaker for the
 *      6 indexed kinds.
 *
 * The resolver is deterministic — no LLM in the hot path. Callers
 * decide what to do with multiple candidates (the orchestrator emits
 * a disambiguation card; the prelude picks top-1 only when the
 * runner-up is meaningfully behind).
 */

import { sql, and, desc, eq, isNull, or, ilike, inArray } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierOpportunities,
  atelierEngagements,
  atelierContacts,
  atelierDeliverables,
  atelierEntityEmbeddings,
  atelierInvoice,
  atelierRenewal,
  atelierChangeOrder,
  atelierWinThemes,
  atelierBriefs,
  atelierAgentDesigns,
  atelierWinLossDebriefs,
  atelierMeetings,
  atelierRaidItems,
  atelierProposals,
  atelierPovs,
  atelierRateCards,
  atelierPartnerFirms,
  atelierTimesheetEntries,
  atelierExpenses,
  atelierEmployees,
  atelierPartnerFirmResources,
  atelierContract,
} from "@workspace/db";
import { cosine, embedText } from "./embeddings.js";
import { foldRosterName } from "./chat-normalizers.js";

export type ResolverKind =
  | "account"
  | "opportunity"
  | "engagement"
  | "contact"
  | "deliverable"
  // The following kinds have no single dedicated text column we can
  // hit with pg_trgm — they resolve through pgvector entity
  // embeddings only.
  | "expense"
  | "meeting"
  | "raid_item"
  | "proposal"
  | "pov"
  | "change_order"
  | "timesheet_entry"
  | "invoice"
  | "contract"
  | "rate_card"
  | "renewal"
  | "partner_firm"
  | "win_theme"
  | "win_loss_debrief"
  | "brief"
  | "agent_design";

export interface ResolverCandidate {
  id: string;
  label: string;
  secondary?: string;
  /** 0..1 score from the matching path (pg_trgm sim, pgvector cos, or 1.0 for id hit). */
  score: number;
  /** Which path produced this candidate. */
  via: "id" | "trgm" | "vector";
  /**
   * Set on person candidates from the internal rosters (HR employees,
   * partner-firm resources). Used so account-scoped person searches can
   * rank scoped client contacts ahead of internal people at the FINAL
   * merge stage regardless of similarity score.
   */
  roster?: "employee" | "partner_resource";
}

export interface ResolverScopes {
  accountId?: string | null;
  engagementId?: string | null;
}

/** The resolver must never be used without the authenticated persona. */
export interface ResolverActor {
  id: string;
  orgId: string;
  role: string;
}

const TRGM_THRESHOLD = 0.25;
const VECTOR_THRESHOLD = 0.6;
const TOP_K = 5;

function semanticRetrievalEnabled(): boolean {
  return process.env.ATELIER_SEMANTIC_RETRIEVAL_ENABLED !== "false";
}

/**
 * Run the cascade. Returns up to TOP_K candidates ordered by score.
 *
 * The function does NOT throw on missing extensions — pg_trgm calls
 * are guarded with a try/catch and fall back to ILIKE; pgvector is
 * cosine-on-jsonb (no SQL extension required).
 */
export async function hybridResolveEntity(
  kind: ResolverKind,
  query: string,
  orgId: string,
  scopes: ResolverScopes = {},
  actor?: ResolverActor,
): Promise<ResolverCandidate[]> {
  // Legacy callers that do not provide an actor are deliberately fail-closed.
  // Entity labels are disclosure, even when the caller only asks for a
  // disambiguation card.
  if (!actor || actor.orgId !== orgId) return [];
  const q = (query ?? "").trim();
  if (!q) return [];

  // 1. Exact-id short-circuit. Cheap and unambiguous.
  if (/^[a-z]{2,8}_[a-z0-9_]{4,}$/i.test(q)) {
    const idRow = await tryIdLookup(kind, q, orgId);
    if (idRow && (await authorizedCandidate(kind, idRow.id, actor, scopes))) {
      return [{ ...idRow, score: 1, via: "id" }];
    }
  }

  const out = new Map<string, ResolverCandidate>();

  // 2. pg_trgm pass for the kinds with a dedicated name column.
  const trgm = await trigramPass(kind, q, orgId, scopes);
  for (const c of trgm) out.set(c.id, c);

  // 3. pgvector ANN over atelier_entity_embeddings — covers all kinds.
  // Skip the embedding cost when the trgm pass already produced
  // confident hits (≥0.6 sim) — that's the common case.
  const trgmConfident = trgm.some((c) => c.score >= 0.6);
  if (!trgmConfident && semanticRetrievalEnabled()) {
    const vec = await vectorPass(kind, q, orgId);
    for (const c of vec) {
      const prev = out.get(c.id);
      if (!prev || c.score > prev.score) out.set(c.id, c);
    }
  }

  // Apply the actor policy before the final score sort (and re-check vector
  // mirrors against their authoritative source rows). The embedding table is
  // intentionally treated as an untrusted, stale index.
  const authorized = await filterAuthorizedCandidates(kind, Array.from(out.values()), actor, scopes);

  // Account-scoped person search: contacts on the scoped account always
  // rank ahead of internal-roster people (employees / partner-firm),
  // regardless of similarity score — the scope was set because the user
  // most likely means a client contact. Enforced HERE (final merge) so
  // no later score sort can reorder them.
  if (kind === "contact" && scopes.accountId) {
    const merged = authorized;
    const contacts = merged.filter((c) => !c.roster).sort((a, b) => b.score - a.score);
    const internal = merged.filter((c) => c.roster).sort((a, b) => b.score - a.score);
    return [...contacts, ...internal].slice(0, TOP_K);
  }

  return authorized
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}

const ORG_WIDE_RESOLVER_ROLES = new Set([
  "founding_partner", "partner",
]);

export async function contactBelongsToScopedAccount(args: {
  contactId: string;
  orgId: string;
  accountId: string;
}): Promise<boolean> {
  const [contact] = await db
    .select({ accountId: atelierContacts.accountId })
    .from(atelierContacts)
    .where(and(
      eq(atelierContacts.id, args.contactId),
      eq(atelierContacts.orgId, args.orgId),
      isNull(atelierContacts.deletedAt),
    ))
    .limit(1);
  return contact?.accountId === args.accountId;
}

async function authorizedCandidate(
  kind: ResolverKind,
  id: string,
  actor: ResolverActor,
  scopes: ResolverScopes,
): Promise<boolean> {
  if (ORG_WIDE_RESOLVER_ROLES.has(actor.role)) return true;
  // Account and engagement visibility are delegated to their existing
  // policy helpers. Do not reproduce CRM ACL rules in the index.
  if (kind === "account") {
    const { canSeeAccount } = await import("../../routes/atelier/accountRoutes.js");
    const { accessibleEngagementIds } = await import("../../routes/atelier/engagementRoutes.js");
    const access = await accessibleEngagementIds({ id: actor.id, role: actor.role } as never);
    return canSeeAccount(access, { id: actor.id, role: actor.role, orgId: actor.orgId } as never, id);
  }
  if (kind === "engagement") {
    const { accessibleEngagementIds } = await import("../../routes/atelier/engagementRoutes.js");
    const access = await accessibleEngagementIds({ id: actor.id, role: actor.role } as never);
    return access.all === true || access.ids.has(id);
  }
  // A contact is only safe for a restricted persona when it is explicitly
  // scoped to an account they can see, or is the caller's own roster row.
  if (kind === "contact") {
    const [own] = await db.select({ id: atelierEmployees.id }).from(atelierEmployees)
      .where(and(eq(atelierEmployees.id, id), eq(atelierEmployees.orgId, actor.orgId), eq(atelierEmployees.userId, actor.id), isNull(atelierEmployees.deletedAt))).limit(1);
    if (own) return true;
    if (!scopes.accountId) return false;
    if (!(await contactBelongsToScopedAccount({
      contactId: id,
      orgId: actor.orgId,
      accountId: scopes.accountId,
    }))) return false;
    const { canSeeAccount } = await import("../../routes/atelier/accountRoutes.js");
    const { accessibleEngagementIds } = await import("../../routes/atelier/engagementRoutes.js");
    const access = await accessibleEngagementIds({ id: actor.id, role: actor.role } as never);
    return canSeeAccount(access, { id: actor.id, role: actor.role, orgId: actor.orgId } as never, scopes.accountId);
  }
  // Unknown domain ACLs are not guessed from an embedding. Existing
  // privileged personas retain the established behavior above.
  return false;
}

export async function filterAuthorizedCandidates(
  kind: ResolverKind,
  candidates: ResolverCandidate[],
  actor: ResolverActor,
  scopes: ResolverScopes,
): Promise<ResolverCandidate[]> {
  const checked = await Promise.all(candidates.map(async (candidate) => {
    // Every vector hit must still exist in its authoritative table. This
    // removes orphaned rows after archive/delete before any disclosure.
    // Replace projection labels with current source labels as well: a stale
    // embedding may rank a row, but it must never disclose stale source text.
    let current = candidate;
    if (candidate.via === "vector") {
      const source = await tryIdLookup(kind, candidate.id, actor.orgId);
      if (!source) return null;
      current = {
        ...candidate,
        label: source.label,
        secondary: source.secondary,
      };
    }
    return (await authorizedCandidate(kind, current.id, actor, scopes)) ? current : null;
  }));
  return checked.filter((candidate): candidate is ResolverCandidate => candidate !== null);
}

async function tryIdLookup(
  kind: ResolverKind,
  id: string,
  orgId: string,
): Promise<{ id: string; label: string; secondary?: string } | null> {
  if (kind === "account") {
    const [r] = await db
      .select({ id: atelierAccounts.id, name: atelierAccounts.name, brandName: atelierAccounts.brandName, country: atelierAccounts.country })
      .from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, id), eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt)))
      .limit(1);
    return r ? { id: r.id, label: r.brandName ?? r.name, secondary: r.country ?? undefined } : null;
  }
  if (kind === "opportunity") {
    const [r] = await db
      .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, salesStage: atelierOpportunities.salesStage, accountId: atelierOpportunities.accountId })
      .from(atelierOpportunities)
      .where(and(eq(atelierOpportunities.id, id), eq(atelierOpportunities.orgId, orgId), isNull(atelierOpportunities.deletedAt)))
      .limit(1);
    if (!r) return null;
    const [acc] = await db
      .select({ name: atelierAccounts.name, brandName: atelierAccounts.brandName })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, r.accountId))
      .limit(1);
    const accLabel = acc ? (acc.brandName ?? acc.name) : null;
    return { id: r.id, label: r.name, secondary: accLabel ? `${accLabel} — stage: ${r.salesStage}` : `stage: ${r.salesStage}` };
  }
  if (kind === "engagement") {
    const [r] = await db
      .select({ id: atelierEngagements.id, name: atelierEngagements.name, plmStage: atelierEngagements.plmStage, accountId: atelierEngagements.accountId })
      .from(atelierEngagements)
      .where(and(eq(atelierEngagements.id, id), eq(atelierEngagements.orgId, orgId), isNull(atelierEngagements.deletedAt)))
      .limit(1);
    if (!r) return null;
    const [acc] = await db
      .select({ name: atelierAccounts.name, brandName: atelierAccounts.brandName })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, r.accountId))
      .limit(1);
    const accLabel = acc ? (acc.brandName ?? acc.name) : null;
    return { id: r.id, label: r.name, secondary: accLabel ? `${accLabel} — stage: ${r.plmStage}` : r.plmStage };
  }
  if (kind === "contact") {
    const [r] = await db
      .select({ id: atelierContacts.id, fullName: atelierContacts.fullName, title: atelierContacts.title })
      .from(atelierContacts)
      .where(and(eq(atelierContacts.id, id), eq(atelierContacts.orgId, orgId), isNull(atelierContacts.deletedAt)))
      .limit(1);
    if (r) return { id: r.id, label: r.fullName, secondary: r.title ?? undefined };
    // People also live in the HR roster and partner-firm rosters — an
    // exact id for either should resolve just like a client contact.
    const [e] = await db
      .select({ id: atelierEmployees.id, fullName: atelierEmployees.fullName, title: atelierEmployees.title })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.id, id), eq(atelierEmployees.orgId, orgId), isNull(atelierEmployees.deletedAt)))
      .limit(1);
    if (e) return { id: e.id, label: e.fullName, secondary: e.title ? `Employee — ${e.title}` : "Employee" };
    const [p] = await db
      .select({ id: atelierPartnerFirmResources.id, fullName: atelierPartnerFirmResources.fullName, role: atelierPartnerFirmResources.role })
      .from(atelierPartnerFirmResources)
      .where(and(eq(atelierPartnerFirmResources.id, id), eq(atelierPartnerFirmResources.orgId, orgId), isNull(atelierPartnerFirmResources.deletedAt)))
      .limit(1);
    if (p) return { id: p.id, label: p.fullName, secondary: p.role ? `Partner resource — ${p.role}` : "Partner resource" };
    return null;
  }
  if (kind === "deliverable") {
    const [r] = await db
      .select({ id: atelierDeliverables.id, name: atelierDeliverables.name, status: atelierDeliverables.status })
      .from(atelierDeliverables)
      .where(and(eq(atelierDeliverables.id, id), eq(atelierDeliverables.orgId, orgId), isNull(atelierDeliverables.deletedAt)))
      .limit(1);
    return r ? { id: r.id, label: r.name, secondary: r.status ?? undefined } : null;
  }
  // Non-trigram kinds must be checked against their authoritative source
  // first. An embedding mirror is never sufficient proof that an exact id
  // is live (or even that its source was not archived).
  return await directIdLookup(kind, id, orgId);
}

/**
 * Per-kind direct table lookup used as the last fallback for exact-id
 * resolution on kinds without a dedicated name column. Returns
 * `{id, label}` if the row exists in the source table, else `null`.
 * Keeps deterministic identifier handling intact even when the
 * `atelier_entity_embeddings` mirror is empty.
 */
export async function directIdLookup(
  kind: ResolverKind,
  id: string,
  orgId: string,
): Promise<{ id: string; label: string; secondary?: string } | null> {
  const probe = async <T extends { id: string }>(rows: T[], label: (r: T) => string, secondary?: (r: T) => string | null | undefined) =>
    rows[0] ? { id: rows[0].id, label: label(rows[0]), secondary: secondary?.(rows[0]) ?? undefined } : null;
  switch (kind) {
    case "contact":
      return probe(
        await db
          .select({
            id: atelierContacts.id,
            fullName: atelierContacts.fullName,
            title: atelierContacts.title,
          })
          .from(atelierContacts)
          .where(and(
            eq(atelierContacts.id, id),
            eq(atelierContacts.orgId, orgId),
            isNull(atelierContacts.deletedAt),
          ))
          .limit(1),
        (row) => row.fullName,
        (row) => row.title,
      );
    case "invoice":
      return probe(
        await db.select({ id: atelierInvoice.id, status: atelierInvoice.status }).from(atelierInvoice)
          .where(and(eq(atelierInvoice.id, id), eq(atelierInvoice.orgId, orgId), isNull(atelierInvoice.deletedAt))).limit(1),
        (r) => `invoice ${r.id}`, (r) => r.status,
      );
    case "renewal":
      return probe(
        await db.select({ id: atelierRenewal.id, status: atelierRenewal.status }).from(atelierRenewal)
          .where(and(eq(atelierRenewal.id, id), eq(atelierRenewal.orgId, orgId), isNull(atelierRenewal.deletedAt))).limit(1),
        (r) => `renewal ${r.id}`, (r) => r.status,
      );
    case "change_order":
      return probe(
        await db.select({ id: atelierChangeOrder.id, summary: atelierChangeOrder.summary, status: atelierChangeOrder.status }).from(atelierChangeOrder)
          .where(and(eq(atelierChangeOrder.id, id), eq(atelierChangeOrder.orgId, orgId), isNull(atelierChangeOrder.deletedAt))).limit(1),
        (r) => r.summary || `change_order ${r.id}`, (r) => r.status,
      );
    case "win_theme":
      return probe(
        await db.select({ id: atelierWinThemes.id, name: atelierWinThemes.name }).from(atelierWinThemes)
          .where(and(eq(atelierWinThemes.id, id), eq(atelierWinThemes.orgId, orgId), isNull(atelierWinThemes.deletedAt))).limit(1),
        (r) => r.name,
      );
    case "brief":
      return probe(
        await db.select({ id: atelierBriefs.id, status: atelierBriefs.status }).from(atelierBriefs)
          .where(and(eq(atelierBriefs.id, id), eq(atelierBriefs.orgId, orgId), isNull(atelierBriefs.deletedAt))).limit(1),
        (r) => `brief ${r.id}`, (r) => r.status,
      );
    case "agent_design":
      return probe(
        await db.select({ id: atelierAgentDesigns.id, status: atelierAgentDesigns.status }).from(atelierAgentDesigns)
          .where(and(eq(atelierAgentDesigns.id, id), eq(atelierAgentDesigns.orgId, orgId), isNull(atelierAgentDesigns.deletedAt))).limit(1),
        (r) => `agent_design ${r.id}`, (r) => r.status,
      );
    case "win_loss_debrief":
      return probe(
        await db.select({ id: atelierWinLossDebriefs.id, outcome: atelierWinLossDebriefs.outcome }).from(atelierWinLossDebriefs)
          .where(and(eq(atelierWinLossDebriefs.id, id), eq(atelierWinLossDebriefs.orgId, orgId), isNull(atelierWinLossDebriefs.deletedAt))).limit(1),
        (r) => `debrief ${r.id}`, (r) => r.outcome,
      );
    case "meeting": {
      // Meetings hang off a polymorphic parent (opportunity | engagement)
      // with no FK cascade — a hard-deleted parent can leave orphan rows.
      // Only resolve a meeting whose parent still exists (and isn't
      // soft-deleted) so orphans never surface via entity resolution.
      const [mtg] = await db
        .select({ id: atelierMeetings.id, parentType: atelierMeetings.parentType, parentId: atelierMeetings.parentId })
        .from(atelierMeetings)
        .where(and(eq(atelierMeetings.id, id), eq(atelierMeetings.orgId, orgId), isNull(atelierMeetings.deletedAt)))
        .limit(1);
      if (!mtg) return null;
      const parentAlive =
        // Task #553 — standalone internal meetings have no CRM parent;
        // the row itself being live is enough.
        mtg.parentType === "internal"
          ? true
          :
        mtg.parentType === "opportunity"
          ? (await db.select({ id: atelierOpportunities.id }).from(atelierOpportunities)
              .where(and(eq(atelierOpportunities.id, mtg.parentId), eq(atelierOpportunities.orgId, orgId), isNull(atelierOpportunities.deletedAt))).limit(1)).length > 0
          : mtg.parentType === "engagement"
            ? (await db.select({ id: atelierEngagements.id }).from(atelierEngagements)
                .where(and(eq(atelierEngagements.id, mtg.parentId), eq(atelierEngagements.orgId, orgId), isNull(atelierEngagements.deletedAt))).limit(1)).length > 0
            : false;
      return parentAlive ? { id: mtg.id, label: `meeting ${mtg.id}` } : null;
    }
    case "raid_item":
      return probe(
        await db.select({ id: atelierRaidItems.id }).from(atelierRaidItems)
          .where(and(eq(atelierRaidItems.id, id), eq(atelierRaidItems.orgId, orgId), isNull(atelierRaidItems.deletedAt))).limit(1),
        (r) => `raid ${r.id}`,
      );
    case "proposal":
      return probe(
        await db.select({ id: atelierProposals.id }).from(atelierProposals)
          .where(and(eq(atelierProposals.id, id), eq(atelierProposals.orgId, orgId), isNull(atelierProposals.deletedAt))).limit(1),
        (r) => `proposal ${r.id}`,
      );
    case "pov":
      return probe(
        await db.select({ id: atelierPovs.id }).from(atelierPovs)
          .where(and(eq(atelierPovs.id, id), eq(atelierPovs.orgId, orgId), isNull(atelierPovs.deletedAt))).limit(1),
        (r) => `pov ${r.id}`,
      );
    case "rate_card":
      return probe(
        await db.select({ id: atelierRateCards.id, name: atelierRateCards.name }).from(atelierRateCards)
          .where(and(eq(atelierRateCards.id, id), eq(atelierRateCards.orgId, orgId), isNull(atelierRateCards.deletedAt))).limit(1),
        (r) => r.name,
      );
    case "partner_firm":
      return probe(
        await db.select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name }).from(atelierPartnerFirms)
          .where(and(eq(atelierPartnerFirms.id, id), eq(atelierPartnerFirms.orgId, orgId), isNull(atelierPartnerFirms.deletedAt))).limit(1),
        (r) => r.name,
      );
    case "timesheet_entry":
      return probe(
        await db.select({ id: atelierTimesheetEntries.id }).from(atelierTimesheetEntries)
          .where(and(eq(atelierTimesheetEntries.id, id), eq(atelierTimesheetEntries.orgId, orgId), isNull(atelierTimesheetEntries.deletedAt))).limit(1),
        (r) => `timesheet ${r.id}`,
      );
    case "expense":
      return probe(
        await db.select({ id: atelierExpenses.id }).from(atelierExpenses)
          .where(and(eq(atelierExpenses.id, id), eq(atelierExpenses.orgId, orgId), isNull(atelierExpenses.deletedAt))).limit(1),
        (r) => `expense ${r.id}`,
      );
    case "contract":
      return probe(
        await db.select({ id: atelierContract.id, title: atelierContract.title, status: atelierContract.status })
          .from(atelierContract)
          .where(and(eq(atelierContract.id, id), eq(atelierContract.orgId, orgId), isNull(atelierContract.deletedAt))).limit(1),
        (r) => r.title || `contract ${r.id}`, (r) => r.status,
      );
    default:
      return null;
  }
}

/**
 * Mirror an entity into `atelier_entity_embeddings` so the hybrid
 * resolver (and pgvector ANN) can find it on subsequent turns.
 *
 * Called fire-and-forget from chat-write capabilities and from the
 * propose_write commit dispatcher. Failures are swallowed — the
 * write itself has already succeeded; an embedding miss only
 * degrades resolver recall on this row, not correctness.
 */
export async function mirrorEntityEmbedding(
  orgId: string,
  kind: ResolverKind | string,
  id: string,
  label: string,
  summary?: string,
): Promise<void> {
  try {
    const text = summary && summary.trim().length > 0 ? `${label} — ${summary}` : label;
    const { vec, dim, provider } = await embedText(text);
    const rowId = `eemb_${kind}_${id}`;
    await db
      .insert(atelierEntityEmbeddings)
      .values({
        id: rowId,
        orgId,
        kind,
        targetId: id,
        label,
        summaryText: text,
        provider,
        vec,
        dim,
      })
      .onConflictDoUpdate({
        target: [atelierEntityEmbeddings.kind, atelierEntityEmbeddings.targetId, atelierEntityEmbeddings.orgId],
        set: { label, summaryText: text, provider, vec, dim, updatedAt: new Date() },
      });
  } catch (err) {
    // Best-effort — the write already succeeded; an embedding miss only
    // degrades resolver recall on this row. Log loudly so gaps are visible
    // in workflow logs and can be diagnosed without a silent failure.
    console.error(
      "[entity-resolver] mirrorEntityEmbedding failed",
      kind,
      id,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function trigramPass(
  kind: ResolverKind,
  query: string,
  orgId: string,
  scopes: ResolverScopes,
): Promise<ResolverCandidate[]> {
  // Indexed name columns per kind.
  const nameCol: Record<string, { col: ReturnType<typeof sql.raw>; table: string } | null> = {
    account: null, // handled below (two columns).
    opportunity: { col: sql.raw("name"), table: "atelier_opportunities" },
    engagement: { col: sql.raw("name"), table: "atelier_engagements" },
    contact: { col: sql.raw("full_name"), table: "atelier_contacts" },
    deliverable: { col: sql.raw("name"), table: "atelier_deliverables" },
  };
  if (kind === "account") {
    return safeTrigram<ResolverCandidate>(async () => {
      const r = await db.execute<{ id: string; name: string; brand_name: string | null; country: string | null; sim: number }>(sql`
        SELECT id, name, brand_name, country,
               GREATEST(similarity(name, ${query}), similarity(coalesce(brand_name, ''), ${query})) AS sim
          FROM atelier_accounts
         WHERE org_id = ${orgId} AND deleted_at IS NULL
           AND (name % ${query} OR brand_name % ${query})
         ORDER BY sim DESC
         LIMIT ${TOP_K}
      `);
      return (r.rows as unknown as Array<{ id: string; name: string; brand_name: string | null; country: string | null; sim: number }>)
        .filter((row) => row.sim >= TRGM_THRESHOLD)
        .map((row) => ({
          id: row.id,
          label: row.brand_name ?? row.name,
          secondary: row.country ?? undefined,
          score: Number(row.sim),
          via: "trgm" as const,
        }));
    }, () => fallbackIlikeAccount(query, orgId));
  }
  const desc = nameCol[kind];
  if (!desc) return [];
  // Person searches span three rosters: client contacts, HR employees,
  // and partner-firm resources. Run the extra passes alongside the
  // regular contacts pass and merge (contacts win ties via ordering).
  if (kind === "contact") {
    const [contacts, people] = await Promise.all([
      safeTrigram<ResolverCandidate>(async () => {
        const scopeFilter = scopes.accountId ? sql` AND c.account_id = ${scopes.accountId}` : sql``;
        // Task #538 — also match structured person fields (preferred/display
        // name) so "find Mo" hits Mohammed whose preferred name is Mo.
        const r = await db.execute<{ id: string; label: string; sim: number }>(sql`
          SELECT c.id, c.full_name AS label,
                 GREATEST(similarity(c.full_name, ${query}),
                          COALESCE(similarity(p.preferred_name, ${query}), 0),
                          COALESCE(similarity(p.display_name, ${query}), 0)) AS sim
            FROM atelier_contacts c
            LEFT JOIN atelier_persons p ON p.id = c.person_id
           WHERE c.org_id = ${orgId} AND c.deleted_at IS NULL
             AND (c.full_name % ${query} OR p.preferred_name % ${query} OR p.display_name % ${query})
             ${scopeFilter}
           ORDER BY sim DESC
           LIMIT ${TOP_K}
        `);
        return (r.rows as unknown as Array<{ id: string; label: string; sim: number }>)
          .filter((row) => row.sim >= TRGM_THRESHOLD)
          .map((row) => ({ id: row.id, label: row.label, score: Number(row.sim), via: "trgm" as const }));
      }, () => fallbackIlikeGeneric("contact", query, orgId, scopes)),
      // Internal rosters (employees + partner-firm people) are always
      // searched too — people ask about colleagues from inside account
      // workspaces ("add a mobile number for <employee>"). When the
      // search is account-scoped, contacts on that account rank ahead
      // of internal people regardless of similarity score, so the
      // account-scope precision (a scoped person search usually means
      // a client contact) is preserved.
      internalPeoplePass(query, orgId),
    ]);
    if (scopes.accountId) {
      return [
        ...contacts.sort((a, b) => b.score - a.score),
        ...people.sort((a, b) => b.score - a.score),
      ].slice(0, TOP_K);
    }
    return [...contacts, ...people].sort((a, b) => b.score - a.score).slice(0, TOP_K);
  }
  const directHits = await safeTrigram(async () => {
    const scopeFilter = scopes.accountId && kind === "opportunity"
      ? sql` AND account_id = ${scopes.accountId}`
      : scopes.accountId && kind === "engagement"
        ? sql` AND account_id = ${scopes.accountId}`
        : scopes.engagementId && kind === "deliverable"
          ? sql` AND engagement_id = ${scopes.engagementId}`
          : sql``;
    const r = await db.execute<{ id: string; label: string; secondary: string | null; sim: number }>(sql`
      SELECT id, ${desc.col} AS label, NULL::text AS secondary,
             similarity(${desc.col}, ${query}) AS sim
        FROM ${sql.raw(desc.table)}
       WHERE org_id = ${orgId} AND deleted_at IS NULL
         AND ${desc.col} % ${query}
         ${scopeFilter}
       ORDER BY sim DESC
       LIMIT ${TOP_K}
    `);
    return (r.rows as unknown as Array<{ id: string; label: string; sim: number }>)
      .filter((row) => row.sim >= TRGM_THRESHOLD)
      .map((row) => ({ id: row.id, label: row.label, score: Number(row.sim), via: "trgm" as const }));
  }, () => fallbackIlikeGeneric(kind, query, orgId, scopes) as Promise<Array<{ id: string; label: string; score: number; via: "trgm" }>>);

  // Task #769 — account-name join pass. When the query does not match
  // any opportunity/engagement name directly (no confident trgm hits),
  // also try resolving the query as an ACCOUNT name and return entities
  // under matching accounts. This lets "opportunity at U Mobile" succeed
  // even when no opportunity name contains "U Mobile".
  if (kind === "opportunity" || kind === "engagement") {
    const hasConfident = directHits.some((c) => c.score >= 0.6);
    if (!hasConfident) {
      const accJoined = await accountNameJoinPass(kind, query, orgId, scopes);
      const merged = new Map<string, ResolverCandidate>(
        directHits.map((c) => [c.id, c]),
      );
      for (const c of accJoined) {
        const prev = merged.get(c.id);
        if (!prev || c.score > prev.score) merged.set(c.id, c);
      }
      return Array.from(merged.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K);
    }
  }

  return directHits;
}

/**
 * Fuzzy pass over the two internal people rosters — HR employees and
 * partner-firm resources. Merged into the "contact" kind so a person
 * search finds people wherever they live. Candidates carry a
 * `secondary` tag so the disambiguation card (and the LLM) can tell
 * the rosters apart and route writes to the right record.
 */
async function internalPeoplePass(query: string, orgId: string): Promise<ResolverCandidate[]> {
  const employees = safeTrigram<ResolverCandidate>(async () => {
    // Task #538 — also match preferred/display name from the person record.
    const r = await db.execute<{ id: string; label: string; title: string | null; sim: number }>(sql`
      SELECT e.id, e.full_name AS label, e.title,
             GREATEST(similarity(e.full_name, ${query}),
                      COALESCE(similarity(e.preferred_name, ${query}), 0),
                      COALESCE(similarity(p.preferred_name, ${query}), 0),
                      COALESCE(similarity(p.display_name, ${query}), 0)) AS sim
        FROM atelier_employees e
        LEFT JOIN atelier_persons p ON p.id = e.person_id
       WHERE e.org_id = ${orgId} AND e.deleted_at IS NULL
         AND (e.full_name % ${query} OR e.preferred_name % ${query}
              OR p.preferred_name % ${query} OR p.display_name % ${query})
       ORDER BY sim DESC
       LIMIT ${TOP_K}
    `);
    return (r.rows as unknown as Array<{ id: string; label: string; title: string | null; sim: number }>)
      .filter((row) => row.sim >= TRGM_THRESHOLD)
      .map((row) => ({
        id: row.id,
        label: row.label,
        secondary: row.title ? `Employee — ${row.title}` : "Employee",
        score: Number(row.sim),
        via: "trgm" as const,
        roster: "employee" as const,
      }));
  }, async () => {
    const like = `%${query.replace(/[%_]/g, "")}%`;
    const r = await db
      .select({ id: atelierEmployees.id, fullName: atelierEmployees.fullName, title: atelierEmployees.title })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.orgId, orgId), isNull(atelierEmployees.deletedAt), ilike(atelierEmployees.fullName, like)))
      .limit(TOP_K);
    return r.map((e) => ({
      id: e.id,
      label: e.fullName,
      secondary: e.title ? `Employee — ${e.title}` : "Employee",
      score: 0.4,
      via: "trgm" as const,
      roster: "employee" as const,
    }));
  });
  const partners = safeTrigram<ResolverCandidate>(async () => {
    // Task #538 — also match preferred/display name from the person record.
    const r = await db.execute<{ id: string; label: string; role: string | null; sim: number }>(sql`
      SELECT pr.id, pr.full_name AS label, pr.role,
             GREATEST(similarity(pr.full_name, ${query}),
                      COALESCE(similarity(p.preferred_name, ${query}), 0),
                      COALESCE(similarity(p.display_name, ${query}), 0)) AS sim
        FROM atelier_partner_firm_resources pr
        LEFT JOIN atelier_persons p ON p.id = pr.person_id
       WHERE pr.org_id = ${orgId} AND pr.deleted_at IS NULL
         AND (pr.full_name % ${query} OR p.preferred_name % ${query} OR p.display_name % ${query})
       ORDER BY sim DESC
       LIMIT ${TOP_K}
    `);
    return (r.rows as unknown as Array<{ id: string; label: string; role: string | null; sim: number }>)
      .filter((row) => row.sim >= TRGM_THRESHOLD)
      .map((row) => ({
        id: row.id,
        label: row.label,
        secondary: row.role ? `Partner resource — ${row.role}` : "Partner resource",
        score: Number(row.sim),
        via: "trgm" as const,
        roster: "partner_resource" as const,
      }));
  }, async () => {
    const like = `%${query.replace(/[%_]/g, "")}%`;
    const r = await db
      .select({ id: atelierPartnerFirmResources.id, fullName: atelierPartnerFirmResources.fullName, role: atelierPartnerFirmResources.role })
      .from(atelierPartnerFirmResources)
      .where(and(eq(atelierPartnerFirmResources.orgId, orgId), isNull(atelierPartnerFirmResources.deletedAt), ilike(atelierPartnerFirmResources.fullName, like)))
      .limit(TOP_K);
    return r.map((p) => ({
      id: p.id,
      label: p.fullName,
      secondary: p.role ? `Partner resource — ${p.role}` : "Partner resource",
      score: 0.4,
      via: "trgm" as const,
      roster: "partner_resource" as const,
    }));
  });
  const [e, p] = await Promise.all([employees, partners]);
  const merged = [...e, ...p];
  if (merged.length > 0) return merged;
  // Task #570 — accent-insensitive fallback: trigram/ILIKE can't fold
  // ö/ü/ş/ı ("gokhan" vs "Gökhan"). On a total miss, fold-compare in JS
  // over both rosters.
  const needle = foldRosterName(query);
  if (!needle) return merged;
  const [emps, prs] = await Promise.all([
    db
      .select({ id: atelierEmployees.id, fullName: atelierEmployees.fullName, title: atelierEmployees.title })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.orgId, orgId), isNull(atelierEmployees.deletedAt))),
    db
      .select({ id: atelierPartnerFirmResources.id, fullName: atelierPartnerFirmResources.fullName, role: atelierPartnerFirmResources.role })
      .from(atelierPartnerFirmResources)
      .where(and(eq(atelierPartnerFirmResources.orgId, orgId), isNull(atelierPartnerFirmResources.deletedAt))),
  ]);
  return [
    ...emps
      .filter((r) => foldRosterName(r.fullName).includes(needle))
      .slice(0, TOP_K)
      .map((r) => ({
        id: r.id,
        label: r.fullName,
        secondary: r.title ? `Employee — ${r.title}` : "Employee",
        score: 0.4,
        via: "trgm" as const,
        roster: "employee" as const,
      })),
    ...prs
      .filter((r) => foldRosterName(r.fullName).includes(needle))
      .slice(0, TOP_K)
      .map((r) => ({
        id: r.id,
        label: r.fullName,
        secondary: r.role ? `Partner resource — ${r.role}` : "Partner resource",
        score: 0.4,
        via: "trgm" as const,
        roster: "partner_resource" as const,
      })),
  ];
}

async function safeTrigram<T>(primary: () => Promise<T[]>, fallback: () => Promise<T[]>): Promise<T[]> {
  try {
    return await primary();
  } catch {
    return fallback();
  }
}

/**
 * Task #769 — Secondary resolver pass for opportunity/engagement: match
 * `query` against account names (trgm, ILIKE fallback) then return
 * all non-deleted entities linked to any matching account.
 *
 * Candidates score 0.45 — above the ILIKE floor (0.4) but below a
 * strong direct name match (≥0.6), so they surface as plausible
 * alternatives without displacing a direct hit.
 */
async function accountNameJoinPass(
  kind: "opportunity" | "engagement",
  query: string,
  orgId: string,
  scopes: ResolverScopes,
): Promise<ResolverCandidate[]> {
  // Step 1 — find accounts whose name/brandName resembles the query.
  const accRows = await safeTrigram<{ id: string; label: string }>(
    async () => {
      const r = await db.execute<{
        id: string;
        name: string;
        brand_name: string | null;
        sim: number;
      }>(sql`
        SELECT id, name, brand_name,
               GREATEST(similarity(name, ${query}),
                        similarity(coalesce(brand_name,''), ${query})) AS sim
          FROM atelier_accounts
         WHERE org_id = ${orgId} AND deleted_at IS NULL
           AND (name % ${query} OR brand_name % ${query})
         ORDER BY sim DESC
         LIMIT 3
      `);
      return (
        r.rows as unknown as Array<{
          id: string;
          name: string;
          brand_name: string | null;
          sim: number;
        }>
      )
        .filter((row) => row.sim >= TRGM_THRESHOLD)
        .map((row) => ({ id: row.id, label: row.brand_name ?? row.name }));
    },
    async () => {
      const like = `%${query.replace(/[%_]/g, "")}%`;
      const r = await db
        .select({
          id: atelierAccounts.id,
          name: atelierAccounts.name,
          brandName: atelierAccounts.brandName,
        })
        .from(atelierAccounts)
        .where(
          and(
            eq(atelierAccounts.orgId, orgId),
            isNull(atelierAccounts.deletedAt),
            or(
              ilike(atelierAccounts.name, like),
              ilike(atelierAccounts.brandName, like),
            ),
          ),
        )
        .limit(3);
      return r.map((a) => ({ id: a.id, label: a.brandName ?? a.name }));
    },
  );
  if (accRows.length === 0) return [];

  // Honour an existing accountId scope: if the resolver is already
  // restricted to one account, only return entities from that account.
  const accIds = scopes.accountId
    ? accRows.filter((a) => a.id === scopes.accountId).map((a) => a.id)
    : accRows.map((a) => a.id);
  if (accIds.length === 0) return [];

  const accLabelById = new Map(accRows.map((a) => [a.id, a.label]));

  if (kind === "opportunity") {
    const rows = await db
      .select({
        id: atelierOpportunities.id,
        name: atelierOpportunities.name,
        salesStage: atelierOpportunities.salesStage,
        accountId: atelierOpportunities.accountId,
      })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.orgId, orgId),
          isNull(atelierOpportunities.deletedAt),
          inArray(atelierOpportunities.accountId, accIds),
        ),
      )
      .limit(TOP_K);
    return rows.map((r) => ({
      id: r.id,
      label: r.name,
      secondary: `${accLabelById.get(r.accountId) ?? r.accountId} — stage: ${r.salesStage}`,
      score: 0.45,
      via: "trgm" as const,
    }));
  }

  // engagement
  const rows = await db
    .select({
      id: atelierEngagements.id,
      name: atelierEngagements.name,
      plmStage: atelierEngagements.plmStage,
      accountId: atelierEngagements.accountId,
    })
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.orgId, orgId),
        isNull(atelierEngagements.deletedAt),
        inArray(atelierEngagements.accountId, accIds),
      ),
    )
    .limit(TOP_K);
  return rows.map((r) => ({
    id: r.id,
    label: r.name,
    secondary: `${accLabelById.get(r.accountId) ?? r.accountId} — stage: ${r.plmStage}`,
    score: 0.45,
    via: "trgm" as const,
  }));
}

async function fallbackIlikeAccount(query: string, orgId: string): Promise<ResolverCandidate[]> {
  const like = `%${query.replace(/[%_]/g, "")}%`;
  const r = await db
    .select({ id: atelierAccounts.id, name: atelierAccounts.name, brandName: atelierAccounts.brandName, country: atelierAccounts.country })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt), or(ilike(atelierAccounts.name, like), ilike(atelierAccounts.brandName, like))))
    .limit(TOP_K);
  return r.map((a) => ({ id: a.id, label: a.brandName ?? a.name, secondary: a.country ?? undefined, score: 0.4, via: "trgm" as const }));
}

async function fallbackIlikeGeneric(
  kind: ResolverKind,
  query: string,
  orgId: string,
  scopes: ResolverScopes,
): Promise<ResolverCandidate[]> {
  const like = `%${query.replace(/[%_]/g, "")}%`;
  if (kind === "opportunity") {
    const conds = [eq(atelierOpportunities.orgId, orgId), isNull(atelierOpportunities.deletedAt), ilike(atelierOpportunities.name, like)];
    if (scopes.accountId) conds.push(eq(atelierOpportunities.accountId, scopes.accountId));
    const r = await db
      .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, salesStage: atelierOpportunities.salesStage, accountId: atelierOpportunities.accountId })
      .from(atelierOpportunities)
      .where(and(...conds))
      .limit(TOP_K);
    // Enrich with account names so disambiguation options are informative.
    const accIds = [...new Set(r.map((o) => o.accountId))];
    const accs = accIds.length > 0
      ? await db.select({ id: atelierAccounts.id, name: atelierAccounts.name, brandName: atelierAccounts.brandName }).from(atelierAccounts).where(inArray(atelierAccounts.id, accIds)).limit(accIds.length)
      : [];
    const accMap = new Map(accs.map((a) => [a.id, a.brandName ?? a.name]));
    return r.map((o) => ({
      id: o.id,
      label: o.name,
      secondary: accMap.has(o.accountId) ? `${accMap.get(o.accountId)} — stage: ${o.salesStage}` : `stage: ${o.salesStage}`,
      score: 0.4,
      via: "trgm" as const,
    }));
  }
  if (kind === "engagement") {
    const conds = [eq(atelierEngagements.orgId, orgId), isNull(atelierEngagements.deletedAt), ilike(atelierEngagements.name, like)];
    if (scopes.accountId) conds.push(eq(atelierEngagements.accountId, scopes.accountId));
    const r = await db
      .select({ id: atelierEngagements.id, name: atelierEngagements.name, plmStage: atelierEngagements.plmStage, accountId: atelierEngagements.accountId })
      .from(atelierEngagements)
      .where(and(...conds))
      .limit(TOP_K);
    const accIds = [...new Set(r.map((e) => e.accountId))];
    const accs = accIds.length > 0
      ? await db.select({ id: atelierAccounts.id, name: atelierAccounts.name, brandName: atelierAccounts.brandName }).from(atelierAccounts).where(inArray(atelierAccounts.id, accIds)).limit(accIds.length)
      : [];
    const accMap = new Map(accs.map((a) => [a.id, a.brandName ?? a.name]));
    return r.map((e) => ({
      id: e.id,
      label: e.name,
      secondary: accMap.has(e.accountId) ? `${accMap.get(e.accountId)} — stage: ${e.plmStage}` : e.plmStage,
      score: 0.4,
      via: "trgm" as const,
    }));
  }
  if (kind === "contact") {
    const nameMatch = or(
      ilike(atelierContacts.fullName, like),
      sql`EXISTS (SELECT 1 FROM atelier_persons p WHERE p.id = ${atelierContacts.personId} AND (p.preferred_name ILIKE ${like} OR p.display_name ILIKE ${like}))`,
    )!;
    const conds = [eq(atelierContacts.orgId, orgId), isNull(atelierContacts.deletedAt), nameMatch];
    if (scopes.accountId) conds.push(eq(atelierContacts.accountId, scopes.accountId));
    const r = await db.select({ id: atelierContacts.id, fullName: atelierContacts.fullName, title: atelierContacts.title }).from(atelierContacts).where(and(...conds)).limit(TOP_K);
    return r.map((c) => ({ id: c.id, label: c.fullName, secondary: c.title ?? undefined, score: 0.4, via: "trgm" as const }));
  }
  if (kind === "deliverable") {
    const conds = [eq(atelierDeliverables.orgId, orgId), isNull(atelierDeliverables.deletedAt), ilike(atelierDeliverables.name, like)];
    if (scopes.engagementId) conds.push(eq(atelierDeliverables.engagementId, scopes.engagementId));
    const r = await db.select({ id: atelierDeliverables.id, name: atelierDeliverables.name }).from(atelierDeliverables).where(and(...conds)).limit(TOP_K);
    return r.map((d) => ({ id: d.id, label: d.name, score: 0.4, via: "trgm" as const }));
  }
  return [];
}

async function vectorPass(kind: ResolverKind, query: string, orgId: string): Promise<ResolverCandidate[]> {
  let rows: Array<{ targetId: string; label: string; vec: number[]; dim: number }>;
  try {
    const all = await db
      .select({ targetId: atelierEntityEmbeddings.targetId, label: atelierEntityEmbeddings.label, vec: atelierEntityEmbeddings.vec, dim: atelierEntityEmbeddings.dim })
      .from(atelierEntityEmbeddings)
      .where(and(eq(atelierEntityEmbeddings.kind, kind), eq(atelierEntityEmbeddings.orgId, orgId)));
    rows = all.map((r) => ({ targetId: r.targetId, label: r.label, vec: r.vec as number[], dim: r.dim }));
  } catch {
    return [];
  }
  if (rows.length === 0) return [];
  const queryEmb = await embedText(query);
  const compatible = rows.filter((r) => r.dim === queryEmb.dim);
  if (compatible.length === 0) return [];
  const scored = compatible
    .map((r) => ({ id: r.targetId, label: r.label, score: cosine(queryEmb.vec, r.vec), via: "vector" as const }))
    .filter((c) => c.score >= VECTOR_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
  return scored;
}

/** Top-1 helper used by the runTurn prelude — only when the runner-up is meaningfully behind. */
export function pickConfident(candidates: ResolverCandidate[], margin = 0.15): ResolverCandidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const [a, b] = candidates;
  return a.score - b.score >= margin ? a : null;
}

// Re-export desc to keep "imported but unused" off the lint radar.
export { desc };
