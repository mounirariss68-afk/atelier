/**
 * Task #853 — Universal entity lookups + finance rollups.
 *
 * One generic `entity.detail` read capability backed by a detail-provider
 * registry (one small provider per entity kind), plus two AR rollup
 * capabilities:
 *
 *   - `finance.statement_of_account` — per-client AR ledger (issued
 *     invoices, payments applied, outstanding, aging buckets).
 *   - `finance.pending_invoices` — outstanding invoices for a fuzzily
 *     resolved engagement OR account (choice chip when both match).
 *
 * Ground rules (mirrors the rest of the chat surface):
 *   - Every provider reuses the SAME ACL helpers as the REST routes
 *     (canSeeAccount, accessibleEngagementIds, canSeeDocument, persona
 *     role predicates). Candidates are ACL-filtered BEFORE capping so
 *     disambiguation chips can never leak out-of-perimeter labels.
 *   - Disambiguation option ids are the exact entity ids the tool
 *     accepts in its `id` input, so chip resumption is deterministic.
 *   - Self-only personas (employee / contractor) may use `entity.detail`
 *     ONLY for accounts / engagements / deliverables they are staffed
 *     on (engagement grant or account-team membership). Everything
 *     else stays me.*-only — see `capabilitiesForPersona`.
 *   - AR detail (statement / pending invoices) is denied to restricted
 *     personas AND board observers (rollup-only access lives on the
 *     existing `wallet.ar.aging` capability), matching invoiceRoutes.
 */

import { and, eq, isNull, ilike, or, desc, inArray } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierContacts,
  atelierOpportunities,
  atelierEngagements,
  atelierDeliverables,
  atelierDeliverableVersions,
  atelierPovs,
  atelierPovVersions,
  atelierBriefs,
  atelierMeetings,
  atelierInvoice,
  atelierInvoiceLine,
  atelierDunningEvent,
  atelierPromiseToPay,
  atelierCashApplication,
  atelierPartnerFirms,
  atelierContractRecords,
  atelierDocuments,
  atelierDocumentVersions,
  atelierRaidItems,
  atelierAccountTeamMembers,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  findByToolName,
  SELF_ONLY_CHAT_ROLES,
} from "./capability-catalog.js";
import { hybridResolveEntity, type ResolverCandidate } from "./entity-resolver.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import { canSeeAccount } from "../../routes/atelier/accountRoutes.js";
import { canSeeDocument } from "../../routes/atelier/documentRoutes.js";
import {
  isRestrictedPersona,
  isBoardObserver,
} from "../../routes/atelier/personaRoles.js";
import { resolveSalesStage } from "../atelier-agents/pipeline.js";
import type { CliPersona, ToolContext, ToolResult } from "./index.js";

// ---------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------

function denyForbidden(reason: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: reason };
}

function notFound(what: string): ToolResult {
  return { ok: false, errorCode: "not_found", errorMessage: `${what} not found` };
}

async function engAclFor(persona: CliPersona) {
  return accessibleEngagementIds({
    id: persona.id,
    role: persona.role,
  } as Parameters<typeof accessibleEngagementIds>[0]);
}

type EngAccess = Awaited<ReturnType<typeof accessibleEngagementIds>>;

function meOf(ctx: ToolContext) {
  return { id: ctx.persona.id, role: ctx.persona.role, orgId: ctx.persona.orgId };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(due)) return 0;
  const d = Math.floor((Date.now() - due) / 86_400_000);
  return d > 0 ? d : 0;
}

/** Trim long jsonb arrays for depth blocks so cards stay bounded. */
function take<T>(arr: T[] | null | undefined, n: number): T[] {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

// ---------------------------------------------------------------------
// provider registry
// ---------------------------------------------------------------------

export interface DetailCandidate {
  id: string;
  label: string;
  secondary?: string;
  score: number;
}

export type DetailFetch =
  | { ok: true; data: Record<string, unknown> }
  | { forbidden: string }
  | null;

export interface EntityDetailProvider {
  /** Canonical kind name accepted in the tool's `kind` input. */
  kind: string;
  /** Extra names the model may pass as the kind hint. */
  aliases: readonly string[];
  /** Self-only personas may reach this kind (staffed-scope enforced in visible()). */
  selfOnlyAllowed?: boolean;
  /** Fuzzy candidates for a free-text query. NO ACL — caller filters via visible(). */
  search(q: string, ctx: ToolContext): Promise<DetailCandidate[]>;
  /** ACL predicate — same helpers as the REST routes. */
  visible(id: string, ctx: ToolContext, access: EngAccess): Promise<boolean>;
  /** Full card + depth block. Enforces ACL itself too (defense in depth). */
  fetch(id: string, ctx: ToolContext, access: EngAccess): Promise<DetailFetch>;
}

const PROVIDERS: EntityDetailProvider[] = [];

export function registerDetailProvider(p: EntityDetailProvider): void {
  if (PROVIDERS.some((x) => x.kind === p.kind)) {
    throw new Error(`duplicate detail provider: ${p.kind}`);
  }
  PROVIDERS.push(p);
}

export function detailProviderFor(kindHint: string | null | undefined): EntityDetailProvider | null {
  if (!kindHint) return null;
  const k = kindHint.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (
    PROVIDERS.find((p) => p.kind === k) ??
    PROVIDERS.find((p) => p.aliases.includes(k)) ??
    null
  );
}

export function listDetailProviders(): readonly EntityDetailProvider[] {
  return PROVIDERS;
}

/** Resolver-backed search shared by most providers. */
function resolverSearch(kind: Parameters<typeof hybridResolveEntity>[0]) {
  return async (q: string, ctx: ToolContext): Promise<DetailCandidate[]> => {
    const c: ResolverCandidate[] = await hybridResolveEntity(kind, q, ctx.persona.orgId);
    return c.map((r) => ({ id: r.id, label: r.label, secondary: r.secondary, score: r.score }));
  };
}

/**
 * Bridge fetch: run an existing dedicated detail tool with an id input.
 * Keeps the dedicated tools as the single source of truth for card
 * shape + ACL for the 3 person-ish kinds.
 */
function bridgeFetch(toolName: string, idField: string) {
  return async (id: string, ctx: ToolContext): Promise<DetailFetch> => {
    const cap = findByToolName(toolName);
    if (!cap) return null;
    const res = (await cap.run({ [idField]: id }, ctx)) as ToolResult;
    if (res.ok && res.data && typeof res.data === "object") {
      return { ok: true, data: res.data as Record<string, unknown> };
    }
    if (!res.ok && res.errorCode === "forbidden") {
      return { forbidden: res.errorMessage ?? "You don't have access to this record." };
    }
    return null;
  };
}

function bridgeVisible(toolName: string, idField: string) {
  return async (id: string, ctx: ToolContext): Promise<boolean> => {
    const r = await bridgeFetch(toolName, idField)(id, ctx);
    return !!r && "ok" in r;
  };
}

// ---------------------------------------------------------------------
// staffing helpers (self-only widening — Task #853 step 8)
// ---------------------------------------------------------------------

/** Accounts a self-only persona is staffed on: accounts of granted
 *  engagements + explicit account-team membership. */
async function staffedAccountIds(ctx: ToolContext, access: EngAccess): Promise<Set<string>> {
  const out = new Set<string>();
  if (access.all !== true && access.ids.size > 0) {
    const engs = await db
      .select({ accountId: atelierEngagements.accountId })
      .from(atelierEngagements)
      .where(
        and(
          inArray(atelierEngagements.id, [...access.ids]),
          eq(atelierEngagements.orgId, ctx.persona.orgId),
          isNull(atelierEngagements.deletedAt),
        ),
      );
    for (const e of engs) out.add(e.accountId);
  }
  const team = await db
    .select({ accountId: atelierAccountTeamMembers.accountId })
    .from(atelierAccountTeamMembers)
    .where(
      and(
        eq(atelierAccountTeamMembers.userId, ctx.persona.id),
        eq(atelierAccountTeamMembers.orgId, ctx.persona.orgId),
        isNull(atelierAccountTeamMembers.deletedAt),
      ),
    );
  for (const t of team) out.add(t.accountId);
  return out;
}

const isSelfOnly = (ctx: ToolContext) => SELF_ONLY_CHAT_ROLES.has(ctx.persona.role);

// ---------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------

// ---- account ---------------------------------------------------------
registerDetailProvider({
  kind: "account",
  aliases: ["client", "company", "customer"],
  selfOnlyAllowed: true,
  search: resolverSearch("account"),
  async visible(id, ctx, access) {
    if (isSelfOnly(ctx)) {
      return (await staffedAccountIds(ctx, access)).has(id);
    }
    return canSeeAccount(access, { id: ctx.persona.id }, id);
  },
  async fetch(id, ctx, access) {
    if (!(await this.visible(id, ctx, access))) {
      return { forbidden: "You don't have access to this account." };
    }
    const [acc] = await db
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, id),
          eq(atelierAccounts.orgId, ctx.persona.orgId),
          isNull(atelierAccounts.deletedAt),
        ),
      )
      .limit(1);
    if (!acc) return null;
    const [opps, engs] = await Promise.all([
      db
        .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, salesStage: atelierOpportunities.salesStage })
        .from(atelierOpportunities)
        .where(and(eq(atelierOpportunities.accountId, id), isNull(atelierOpportunities.deletedAt))),
      db
        .select({ id: atelierEngagements.id, name: atelierEngagements.name, plmStage: atelierEngagements.plmStage })
        .from(atelierEngagements)
        .where(and(eq(atelierEngagements.accountId, id), isNull(atelierEngagements.deletedAt))),
    ]);
    const brief = acc.researchBrief ?? null;
    return {
      ok: true,
      data: {
        shape: "entity_card",
        kind: "account",
        id: acc.id,
        name: acc.name,
        country: acc.country,
        sector: acc.sector,
        href: `/accounts/${acc.id}`,
        openOpportunityCount: opps.filter(
          (o) => !["contract", "lost", "no_decision", "withdrawn"].includes(o.salesStage),
        ).length,
        activeEngagementCount: engs.filter((e) => e.plmStage !== "closed").length,
        // Depth layer — research / strategy briefs so "what are their
        // priorities / executive tensions" answers substantively.
        detail: {
          strategicPriorities: take(acc.strategicPriorities, 6),
          hypothesis: acc.cogniriseHypothesis ?? null,
          whatsChanging: take(brief?.whatsChanging, 5).map((x) => ({ text: x.text, evidence: x.evidence })),
          executiveTensions: take(brief?.executiveTensions, 5).map((x) => ({ text: x.text, evidence: x.evidence })),
          serviceLineFit: take(brief?.serviceLineFit, 5).map((x) => ({ serviceLine: x.serviceLine, signal: x.signal })),
          partnerEcosystem: take(brief?.partnerEcosystem, 4).map((x) => ({ partner: x.partner, relationship: x.relationship })),
          recentSignals: take(acc.sourceSignals, 3).map((s) => ({ kind: s.kind, title: s.title })),
        },
        navigateTo: { path: `/accounts/${acc.id}`, when: "on_commit" as const },
      },
    };
  },
});

// ---- opportunity ------------------------------------------------------
registerDetailProvider({
  kind: "opportunity",
  aliases: ["deal", "opp", "pursuit"],
  search: resolverSearch("opportunity"),
  async visible(id, ctx, access) {
    if (isSelfOnly(ctx)) return false;
    const [opp] = await db
      .select({ accountId: atelierOpportunities.accountId })
      .from(atelierOpportunities)
      .where(and(eq(atelierOpportunities.id, id), eq(atelierOpportunities.orgId, ctx.persona.orgId), isNull(atelierOpportunities.deletedAt)))
      .limit(1);
    if (!opp) return false;
    return canSeeAccount(access, { id: ctx.persona.id }, opp.accountId);
  },
  async fetch(id, ctx, access) {
    if (!(await this.visible(id, ctx, access))) {
      return { forbidden: "You don't have access to this opportunity's account." };
    }
    const [opp] = await db
      .select()
      .from(atelierOpportunities)
      .where(and(eq(atelierOpportunities.id, id), eq(atelierOpportunities.orgId, ctx.persona.orgId), isNull(atelierOpportunities.deletedAt)))
      .limit(1);
    if (!opp) return null;
    const [[acc], [brief]] = await Promise.all([
      db.select({ id: atelierAccounts.id, name: atelierAccounts.name }).from(atelierAccounts).where(eq(atelierAccounts.id, opp.accountId)).limit(1),
      db
        .select()
        .from(atelierBriefs)
        .where(and(eq(atelierBriefs.opportunityId, opp.id), isNull(atelierBriefs.deletedAt)))
        .orderBy(desc(atelierBriefs.updatedAt))
        .limit(1),
    ]);
    const fiveC = (brief?.fiveCDraft ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      data: {
        shape: "opportunity_card",
        kind: "opportunity",
        opportunity: {
          id: opp.id,
          name: opp.name,
          stage: resolveSalesStage(opp.salesStage),
          dealSizeUsd: opp.dealSizeHypothesis,
          probabilityPct: opp.probabilityPct,
          daysInStage: opp.daysInStage,
          nextMilestone: opp.nextMilestone ?? null,
        },
        account: acc ? { id: acc.id, name: acc.name } : null,
        href: `/opportunities/${opp.id}`,
        detail: brief
          ? {
              scoutBriefStatus: brief.status,
              confidence: brief.confidence ?? null,
              openQuestions: take(brief.openQuestions, 5),
              fiveC: fiveC,
              accountSnapshot: brief.accountSnapshot ?? null,
              buyerLandscape: brief.buyerLandscape ?? null,
            }
          : null,
      },
    };
  },
});

// ---- engagement -------------------------------------------------------
registerDetailProvider({
  kind: "engagement",
  aliases: ["project"],
  selfOnlyAllowed: true,
  search: resolverSearch("engagement"),
  async visible(id, _ctx, access) {
    // Self-only personas fall through to the grant set: they only ever
    // hold explicit engagement grants (never access.all).
    if (access.all === true) return true;
    return access.ids.has(id);
  },
  async fetch(id, ctx, access) {
    if (!(await this.visible(id, ctx, access))) {
      return { forbidden: "You don't have access to this engagement." };
    }
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(and(eq(atelierEngagements.id, id), eq(atelierEngagements.orgId, ctx.persona.orgId), isNull(atelierEngagements.deletedAt)))
      .limit(1);
    if (!eng) return null;
    const [[acc], raid, delivs] = await Promise.all([
      db.select({ id: atelierAccounts.id, name: atelierAccounts.name }).from(atelierAccounts).where(eq(atelierAccounts.id, eng.accountId)).limit(1),
      db
        .select({ id: atelierRaidItems.id, type: atelierRaidItems.kind, title: atelierRaidItems.description, severity: atelierRaidItems.severity, status: atelierRaidItems.status })
        .from(atelierRaidItems)
        .where(and(eq(atelierRaidItems.engagementId, id), isNull(atelierRaidItems.deletedAt)))
        .orderBy(desc(atelierRaidItems.updatedAt))
        .limit(30),
      db
        .select({ id: atelierDeliverables.id, name: atelierDeliverables.name, status: atelierDeliverables.status, dueDate: atelierDeliverables.dueDate })
        .from(atelierDeliverables)
        .where(and(eq(atelierDeliverables.engagementId, id), isNull(atelierDeliverables.deletedAt)))
        .orderBy(desc(atelierDeliverables.updatedAt))
        .limit(12),
    ]);
    const openRaid = raid.filter((r) => r.status !== "closed" && r.status !== "resolved");
    return {
      ok: true,
      data: {
        shape: "entity_card",
        kind: "engagement",
        id: eng.id,
        name: eng.name,
        stage: eng.plmStage,
        raidStatus: eng.raidStatus,
        startDate: eng.startDate,
        plannedEndDate: eng.plannedEndDate,
        account: acc ? { id: acc.id, name: acc.name } : null,
        href: `/engagements/${eng.id}`,
        detail: {
          charterObjectives: take(eng.charter?.objectives, 5),
          workstreams: take(eng.workstreams, 6).map((w) => ({ name: w.name, status: w.status })),
          openRaid: openRaid.slice(0, 5).map((r) => ({ type: r.type, title: r.title, severity: r.severity })),
          openRaidCount: openRaid.length,
          deliverables: delivs.map((d) => ({ id: d.id, name: d.name, status: d.status, dueDate: d.dueDate })),
        },
        navigateTo: { path: `/engagements/${eng.id}`, when: "on_commit" as const },
      },
    };
  },
});

// ---- pov --------------------------------------------------------------
registerDetailProvider({
  kind: "pov",
  aliases: ["point_of_view", "pov_document"],
  search: resolverSearch("pov"),
  async visible(id, ctx, access) {
    if (isSelfOnly(ctx)) return false;
    const [pov] = await db
      .select({ opportunityId: atelierPovs.opportunityId })
      .from(atelierPovs)
      .where(and(eq(atelierPovs.id, id), eq(atelierPovs.orgId, ctx.persona.orgId), isNull(atelierPovs.deletedAt)))
      .limit(1);
    if (!pov) return false;
    const [opp] = await db
      .select({ accountId: atelierOpportunities.accountId })
      .from(atelierOpportunities)
      .where(and(eq(atelierOpportunities.id, pov.opportunityId), isNull(atelierOpportunities.deletedAt)))
      .limit(1);
    if (!opp) return false;
    return canSeeAccount(access, { id: ctx.persona.id }, opp.accountId);
  },
  async fetch(id, ctx, access) {
    if (!(await this.visible(id, ctx, access))) {
      return { forbidden: "You don't have access to this point of view." };
    }
    const [pov] = await db
      .select()
      .from(atelierPovs)
      .where(and(eq(atelierPovs.id, id), eq(atelierPovs.orgId, ctx.persona.orgId), isNull(atelierPovs.deletedAt)))
      .limit(1);
    if (!pov) return null;
    const [[opp], [ver]] = await Promise.all([
      db
        .select({ id: atelierOpportunities.id, name: atelierOpportunities.name, accountId: atelierOpportunities.accountId })
        .from(atelierOpportunities)
        .where(eq(atelierOpportunities.id, pov.opportunityId))
        .limit(1),
      db
        .select({ versionNumber: atelierPovVersions.versionNumber, sections: atelierPovVersions.sections, citationCoverage: atelierPovVersions.citationCoverage, notes: atelierPovVersions.notes })
        .from(atelierPovVersions)
        .where(and(eq(atelierPovVersions.povId, id), isNull(atelierPovVersions.deletedAt)))
        .orderBy(desc(atelierPovVersions.versionNumber))
        .limit(1),
    ]);
    const sections = Array.isArray(ver?.sections) ? (ver!.sections as Array<Record<string, unknown>>) : [];
    return {
      ok: true,
      data: {
        shape: "pov_card",
        kind: "pov",
        id: pov.id,
        title: pov.title,
        status: pov.status,
        audience: pov.audience ?? null,
        objective: pov.objective ?? null,
        opportunity: opp ? { id: opp.id, name: opp.name } : null,
        href: opp ? `/opportunities/${opp.id}` : null,
        detail: {
          outline: take(pov.outline as unknown[], 8),
          latestVersion: ver
            ? {
                versionNumber: ver.versionNumber,
                citationCoverage: ver.citationCoverage ?? null,
                sectionTitles: sections.map((s) => String(s.title ?? s.heading ?? "")).filter(Boolean).slice(0, 8),
                notes: ver.notes ?? null,
              }
            : null,
        },
      },
    };
  },
});

// ---- deliverable ------------------------------------------------------
registerDetailProvider({
  kind: "deliverable",
  aliases: ["artifact", "output"],
  selfOnlyAllowed: true,
  search: resolverSearch("deliverable"),
  async visible(id, ctx, access) {
    const [d] = await db
      .select({ engagementId: atelierDeliverables.engagementId })
      .from(atelierDeliverables)
      .where(and(eq(atelierDeliverables.id, id), eq(atelierDeliverables.orgId, ctx.persona.orgId), isNull(atelierDeliverables.deletedAt)))
      .limit(1);
    if (!d) return false;
    return access.all === true || access.ids.has(d.engagementId);
  },
  async fetch(id, ctx, access) {
    if (!(await this.visible(id, ctx, access))) {
      return { forbidden: "You don't have access to this deliverable's engagement." };
    }
    const [d] = await db
      .select()
      .from(atelierDeliverables)
      .where(and(eq(atelierDeliverables.id, id), eq(atelierDeliverables.orgId, ctx.persona.orgId), isNull(atelierDeliverables.deletedAt)))
      .limit(1);
    if (!d) return null;
    const [[eng], [ver]] = await Promise.all([
      db.select({ id: atelierEngagements.id, name: atelierEngagements.name }).from(atelierEngagements).where(eq(atelierEngagements.id, d.engagementId)).limit(1),
      db
        .select({ versionNumber: atelierDeliverableVersions.versionNumber, notes: atelierDeliverableVersions.notes })
        .from(atelierDeliverableVersions)
        .where(and(eq(atelierDeliverableVersions.deliverableId, id), isNull(atelierDeliverableVersions.deletedAt)))
        .orderBy(desc(atelierDeliverableVersions.versionNumber))
        .limit(1),
    ]);
    return {
      ok: true,
      data: {
        shape: "deliverable_card",
        kind: "deliverable",
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        dueDate: d.dueDate ?? null,
        clientVisibility: d.clientVisibility,
        engagement: eng ? { id: eng.id, name: eng.name } : null,
        href: `/engagements/${d.engagementId}`,
        detail: {
          criticReadiness: d.criticReadiness ?? null,
          criticSummary: d.criticReportSummary ?? null,
          partnerApproved: !!d.partnerApprovedAt,
          sentAt: d.sentAt ? d.sentAt.toISOString() : null,
          latestVersion: ver ? { versionNumber: ver.versionNumber, notes: ver.notes ?? null } : null,
        },
      },
    };
  },
});

// ---- contact / meeting / person (bridged to dedicated tools) ----------
registerDetailProvider({
  kind: "contact",
  aliases: ["client_contact"],
  search: resolverSearch("contact"),
  async visible(id, ctx) {
    if (isSelfOnly(ctx)) return false;
    return bridgeVisible("contact_detail", "contactId")(id, ctx);
  },
  async fetch(id, ctx) {
    if (isSelfOnly(ctx)) return { forbidden: "Contacts aren't available from your workspace." };
    const r = await bridgeFetch("contact_detail", "contactId")(id, ctx);
    if (r && "ok" in r) r.data.shape = r.data.shape ?? "contact_card";
    return r;
  },
});

registerDetailProvider({
  kind: "meeting",
  aliases: ["call", "session"],
  search: resolverSearch("meeting"),
  async visible(id, ctx) {
    if (isSelfOnly(ctx)) return false;
    return bridgeVisible("meeting_detail", "meetingId")(id, ctx);
  },
  async fetch(id, ctx) {
    if (isSelfOnly(ctx)) return { forbidden: "Meetings aren't available from your workspace here." };
    const r = await bridgeFetch("meeting_detail", "meetingId")(id, ctx);
    if (r && "ok" in r) r.data.shape = r.data.shape ?? "meeting_card";
    return r;
  },
});

registerDetailProvider({
  kind: "person",
  aliases: ["employee", "colleague", "roster_person", "people"],
  async search(q, ctx) {
    // person search + cross-domain fallback lives in person_detail; here we
    // only need candidates for the untyped cross-kind pass. Use the folded
    // roster search inside person_detail by delegating a name query — the
    // dedicated tool returns disambiguation options we can surface.
    const cap = findByToolName("person_detail");
    if (!cap) return [];
    const res = (await cap.run({ name: q }, ctx)) as ToolResult & {
      disambiguation?: { options?: Array<{ id: string; label: string; secondary?: string }> };
    };
    if (res.ok && res.disambiguation?.options) {
      return res.disambiguation.options.map((o, i) => ({
        id: String(o.id),
        label: String(o.label),
        secondary: o.secondary != null ? String(o.secondary) : undefined,
        score: 0.8 - i * 0.05,
      }));
    }
    if (res.ok && res.data && typeof res.data === "object") {
      const d = res.data as { person?: { id?: string; name?: string } };
      if (d.person?.id) return [{ id: d.person.id, label: d.person.name ?? d.person.id, score: 0.9 }];
    }
    return [];
  },
  async visible(id, ctx) {
    if (isSelfOnly(ctx)) return false;
    return bridgeVisible("person_detail", "personId")(id, ctx);
  },
  async fetch(id, ctx) {
    if (isSelfOnly(ctx)) return { forbidden: "People lookups aren't available from your workspace." };
    const r = await bridgeFetch("person_detail", "personId")(id, ctx);
    if (r && "ok" in r) r.data.shape = r.data.shape ?? "contact_card";
    return r;
  },
});

// ---- invoice ----------------------------------------------------------
function arDetailAllowed(ctx: ToolContext): boolean {
  return (
    !isSelfOnly(ctx) &&
    !isRestrictedPersona(ctx.persona.role) &&
    !isBoardObserver(ctx.persona.role)
  );
}

const AR_DENIED_MSG =
  "AR invoice detail isn't available for your role. Board observers can ask for the AR aging rollup instead.";

registerDetailProvider({
  kind: "invoice",
  aliases: ["bill", "ar_invoice"],
  search: resolverSearch("invoice"),
  async visible(_id, ctx) {
    return arDetailAllowed(ctx);
  },
  async fetch(id, ctx) {
    if (!arDetailAllowed(ctx)) return { forbidden: AR_DENIED_MSG };
    const [inv] = await db
      .select()
      .from(atelierInvoice)
      .where(and(eq(atelierInvoice.id, id), eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt)))
      .limit(1);
    if (!inv) return null;
    const [lines, dunning, promises, acc] = await Promise.all([
      db
        .select({ description: atelierInvoiceLine.description, amount: atelierInvoiceLine.amount })
        .from(atelierInvoiceLine)
        .where(eq(atelierInvoiceLine.invoiceId, id))
        .limit(10),
      db
        .select({ stepIndex: atelierDunningEvent.stepIndex, channel: atelierDunningEvent.channel, sentAt: atelierDunningEvent.sentAt })
        .from(atelierDunningEvent)
        .where(eq(atelierDunningEvent.invoiceId, id))
        .orderBy(desc(atelierDunningEvent.sentAt))
        .limit(3),
      db
        .select({ promisedAmount: atelierPromiseToPay.promisedAmount, promisedDate: atelierPromiseToPay.promisedDate, status: atelierPromiseToPay.status })
        .from(atelierPromiseToPay)
        .where(and(eq(atelierPromiseToPay.invoiceId, id), eq(atelierPromiseToPay.status, "open")))
        .limit(2),
      inv.accountId
        ? db.select({ id: atelierAccounts.id, name: atelierAccounts.name }).from(atelierAccounts).where(eq(atelierAccounts.id, inv.accountId)).limit(1)
        : Promise.resolve([]),
    ]);
    const outstanding = round2(inv.total - inv.amountPaid);
    return {
      ok: true,
      data: {
        shape: "invoice_card",
        kind: "invoice",
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? null,
        status: inv.status,
        currency: inv.currency,
        total: inv.total,
        amountPaid: inv.amountPaid,
        outstanding,
        dueDate: inv.dueDate ?? null,
        daysOverdue: inv.status === "issued" && outstanding > 0 ? daysOverdue(inv.dueDate) : 0,
        billTo: inv.billTo?.name ?? null,
        account: acc[0] ? { id: acc[0].id, name: acc[0].name } : null,
        href: `/wallet`,
        detail: {
          lines: lines.map((l) => ({ description: l.description, amount: l.amount })),
          dunning: dunning.map((d) => ({ step: d.stepIndex, channel: d.channel, sentAt: d.sentAt.toISOString() })),
          promisesToPay: promises,
        },
      },
    };
  },
});

// ---- partner firm ------------------------------------------------------
registerDetailProvider({
  kind: "partner_firm",
  aliases: ["partner", "alliance", "alliance_partner", "partner_company"],
  search: resolverSearch("partner_firm"),
  async visible(_id, ctx) {
    return !isSelfOnly(ctx) && !isRestrictedPersona(ctx.persona.role) && !isBoardObserver(ctx.persona.role);
  },
  async fetch(id, ctx, access) {
    if (!(await this.visible(id, ctx, access))) {
      return { forbidden: "The partner-firm registry isn't available for your role." };
    }
    const [pf] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(and(eq(atelierPartnerFirms.id, id), eq(atelierPartnerFirms.orgId, ctx.persona.orgId)))
      .limit(1);
    if (!pf) return null;
    const sc = pf.fitScorecard ?? null;
    return {
      ok: true,
      data: {
        shape: "entity_card",
        kind: "partner_firm",
        id: pf.id,
        name: pf.name,
        country: pf.hqCountry ?? pf.country ?? null,
        tier: pf.tier ?? null,
        firmKind: pf.kind ?? null,
        speciality: pf.speciality ?? null,
        masterAgreementStatus: pf.masterAgreementStatus,
        masterAgreementEnd: pf.masterAgreementEnd ?? null,
        href: `/partners`,
        detail: {
          archetype: pf.archetype ?? null,
          partnershipStage: pf.partnershipStage,
          relationshipStrength: pf.relationshipStrength ?? null,
          anchors: { cognirise: pf.anchorCognirise ?? null, partner: pf.anchorPartner ?? null },
          fitScorecard: sc
            ? {
                weightedTotal: sc.weightedTotal,
                verdict: sc.verdict,
                watchouts: take(sc.watchouts, 3),
                topDimensions: take(sc.dimensions, 4).map((d) => ({ label: d.label, score: d.score })),
              }
            : null,
          contacts: take(pf.contacts, 3).map((c) => ({ name: c.name, role: c.role ?? null })),
        },
      },
    };
  },
});

// ---- contract ----------------------------------------------------------
registerDetailProvider({
  kind: "contract",
  aliases: ["agreement", "nda", "msa", "sow"],
  search: async (q, ctx) => {
    const rows = await db
      .select({ id: atelierContractRecords.id, title: atelierContractRecords.title, counterpartyLabel: atelierContractRecords.counterpartyLabel, status: atelierContractRecords.status })
      .from(atelierContractRecords)
      .where(
        and(
          eq(atelierContractRecords.orgId, ctx.persona.orgId),
          or(ilike(atelierContractRecords.title, `%${q}%`), ilike(atelierContractRecords.counterpartyLabel, `%${q}%`)),
        ),
      )
      .limit(6);
    return rows.map((r, i) => ({ id: r.id, label: r.title, secondary: `${r.counterpartyLabel} — ${r.status}`, score: 0.7 - i * 0.02 }));
  },
  async visible(_id, ctx) {
    return !isSelfOnly(ctx) && !isRestrictedPersona(ctx.persona.role) && !isBoardObserver(ctx.persona.role);
  },
  async fetch(id, ctx, access) {
    if (!(await this.visible(id, ctx, access))) {
      return { forbidden: "Contracts aren't available for your role here. Employees can see their own contracts under Me → Contracts." };
    }
    const [c] = await db
      .select()
      .from(atelierContractRecords)
      .where(and(eq(atelierContractRecords.id, id), eq(atelierContractRecords.orgId, ctx.persona.orgId)))
      .limit(1);
    if (!c) return null;
    return {
      ok: true,
      data: {
        shape: "contract_card",
        kind: "contract",
        id: c.id,
        title: c.title,
        contractType: c.contractType,
        status: c.status,
        counterparty: c.counterpartyLabel || null,
        counterpartyKind: c.counterpartyKind,
        signingEntity: c.signingEntityLabel ?? null,
        href: `/contracts`,
        detail: {
          signatureState: c.status === "signed" ? "signed" : c.status === "out_for_signature" ? "awaiting signature" : c.status,
          firmSignatureRequested: !!c.firmSignatureRequestedAt,
          expiryDate: (c as { expiryDate?: string | null }).expiryDate ?? null,
        },
      },
    };
  },
});

// ---- document ----------------------------------------------------------
registerDetailProvider({
  kind: "document",
  aliases: ["file", "doc"],
  search: async (q, ctx) => {
    const rows = await db
      .select({ id: atelierDocuments.id, title: atelierDocuments.title, category: atelierDocuments.category })
      .from(atelierDocuments)
      .where(
        and(
          eq(atelierDocuments.orgId, ctx.persona.orgId),
          isNull(atelierDocuments.deletedAt),
          ilike(atelierDocuments.title, `%${q}%`),
        ),
      )
      .limit(6);
    return rows.map((r, i) => ({ id: r.id, label: r.title, secondary: r.category, score: 0.7 - i * 0.02 }));
  },
  async visible(id, ctx, access) {
    if (isSelfOnly(ctx)) return false;
    const [doc] = await db
      .select()
      .from(atelierDocuments)
      .where(and(eq(atelierDocuments.id, id), eq(atelierDocuments.orgId, ctx.persona.orgId), isNull(atelierDocuments.deletedAt)))
      .limit(1);
    if (!doc) return false;
    return canSeeDocument(
      meOf(ctx) as Parameters<typeof canSeeDocument>[0],
      access as Parameters<typeof canSeeDocument>[1],
      doc as Parameters<typeof canSeeDocument>[2],
    );
  },
  async fetch(id, ctx, access) {
    if (!(await this.visible(id, ctx, access))) {
      return { forbidden: "You don't have access to this document." };
    }
    const [doc] = await db
      .select()
      .from(atelierDocuments)
      .where(and(eq(atelierDocuments.id, id), eq(atelierDocuments.orgId, ctx.persona.orgId), isNull(atelierDocuments.deletedAt)))
      .limit(1);
    if (!doc) return null;
    const versions = await db
      .select({ versionNumber: atelierDocumentVersions.versionNumber, fileName: atelierDocumentVersions.fileName, createdAt: atelierDocumentVersions.createdAt })
      .from(atelierDocumentVersions)
      .where(eq(atelierDocumentVersions.documentId, id))
      .orderBy(desc(atelierDocumentVersions.versionNumber))
      .limit(5);
    return {
      ok: true,
      data: {
        shape: "entity_card",
        kind: "document",
        id: doc.id,
        name: doc.title,
        category: doc.category,
        status: doc.status,
        uploader: doc.uploaderLabel || null,
        aiRetrieval: doc.aiRetrieval,
        href: `/documents`,
        detail: {
          versions: versions.map((v) => ({ versionNumber: v.versionNumber, fileName: v.fileName, at: v.createdAt.toISOString() })),
          versionCount: versions.length,
          notes: doc.notes ?? null,
        },
      },
    };
  },
});

// ---------------------------------------------------------------------
// entity.detail — the generic lookup capability
// ---------------------------------------------------------------------

/** Kinds probed on an untyped ask, in preference order. */
const UNTYPED_KINDS = [
  "account",
  "opportunity",
  "engagement",
  "contact",
  "deliverable",
  "pov",
  "partner_firm",
  "meeting",
  "invoice",
  "contract",
  "document",
  "person",
] as const;

const SELF_ONLY_DETAIL_KINDS = new Set(["account", "engagement", "deliverable"]);

async function filterVisible(
  p: EntityDetailProvider,
  cands: DetailCandidate[],
  ctx: ToolContext,
  access: EngAccess,
): Promise<DetailCandidate[]> {
  const flags = await Promise.all(cands.map((c) => p.visible(c.id, ctx, access).catch(() => false)));
  return cands.filter((_, i) => flags[i]);
}

defineCapability({
  id: "entity.detail",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "entity_detail",
  description:
    "Universal record lookup: details of ANY record by name or id — account, opportunity, POV, engagement, deliverable, contact, meeting, partner firm, contract, document, invoice, or person. Returns a card with a link plus rich depth data (research briefs, RAID, scout brief, fit scorecard) for follow-up questions. Prefer the dedicated detail tools when the record type is obvious.",
  slashAliases: { en: ["/details", "/lookup", "/show"] },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text name of the record to look up." },
      id: { type: "string", description: "Exact record id when known (e.g. from a disambiguation pick)." },
      kind: {
        type: "string",
        description:
          "Optional record-type hint: account | opportunity | engagement | contact | meeting | pov | deliverable | invoice | partner_firm | contract | document | person.",
      },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home", "account_workspace", "opportunity_workspace", "engagement_dashboard"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Give me details on Tasama", "Show me the market-entry POV", "Details of the Emaar master agreement"],
    ar: ["أعطني تفاصيل Tasama"],
    fr: ["Donne-moi les détails de Tasama"],
  },
  async run(input, ctx) {
    const access = await engAclFor(ctx.persona);
    const selfOnly = isSelfOnly(ctx);
    const kindHint = typeof input.kind === "string" ? input.kind : null;
    const hinted = detailProviderFor(kindHint);
    const id = typeof input.id === "string" ? input.id.trim() : "";
    const query = typeof input.query === "string" ? input.query.trim() : "";

    const providerAllowed = (p: EntityDetailProvider) =>
      !selfOnly || (p.selfOnlyAllowed === true && SELF_ONLY_DETAIL_KINDS.has(p.kind));

    // ---- id path: fetch directly (kind hint narrows the probe) --------
    if (id) {
      const probe = hinted ? [hinted] : PROVIDERS;
      // On an untyped probe a provider may answer "forbidden" for an id it
      // does not even own (visibility checks run before existence checks).
      // Only surface a refusal after every provider had a chance to claim
      // the id — a hinted ask keeps the immediate refusal.
      let firstForbidden: string | null = null;
      for (const p of probe) {
        if (!providerAllowed(p)) continue;
        const r = await p.fetch(id, ctx, access).catch(() => null);
        if (r && "forbidden" in r) {
          if (hinted) return denyForbidden(r.forbidden);
          firstForbidden ??= r.forbidden;
          continue;
        }
        if (r && "ok" in r) return { ok: true, data: r.data };
      }
      if (firstForbidden) return denyForbidden(firstForbidden);
      if (selfOnly) {
        return denyForbidden(
          "From your workspace I can only look up accounts, engagements and deliverables you're staffed on.",
        );
      }
      return notFound("record");
    }

    if (query.length < 2) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "Provide a record name (query) or id." };
    }

    // ---- typed ask ------------------------------------------------------
    if (hinted) {
      if (!providerAllowed(hinted)) {
        return denyForbidden(
          selfOnly
            ? "From your workspace I can only look up accounts, engagements and deliverables you're staffed on."
            : "That record type isn't available for your role.",
        );
      }
      const cands = await hinted.search(query, ctx);
      // ACL-filter BEFORE capping — out-of-perimeter labels must never
      // surface in disambiguation chips.
      const vis = await filterVisible(hinted, cands, ctx, access);
      if (vis.length === 0) {
        return notFound(`${hinted.kind.replace(/_/g, " ")} matching "${query}"`);
      }
      if (vis.length === 1 || vis[0]!.score - (vis[1]?.score ?? 0) >= 0.25) {
        const r = await hinted.fetch(vis[0]!.id, ctx, access);
        if (r && "forbidden" in r) return denyForbidden(r.forbidden);
        if (r && "ok" in r) return { ok: true, data: r.data };
        return notFound(hinted.kind.replace(/_/g, " "));
      }
      const options = vis.slice(0, 5).map((c) => ({ id: c.id, label: c.label, secondary: c.secondary }));
      return {
        ok: true,
        data: { prompt: `Which ${hinted.kind.replace(/_/g, " ")} did you mean by "${query}"?`, options },
        disambiguation: { kind: hinted.kind, options },
      };
    }

    // ---- untyped ask: probe every provider in parallel -----------------
    const kinds = UNTYPED_KINDS.map((k) => detailProviderFor(k)!).filter((p) => providerAllowed(p));
    const results = await Promise.all(
      kinds.map(async (p) => {
        try {
          const cands = await p.search(query, ctx);
          const vis = await filterVisible(p, cands.slice(0, 4), ctx, access);
          return vis.map((c) => ({ ...c, kind: p.kind }));
        } catch {
          return [];
        }
      }),
    );
    const merged = results
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (merged.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: `I couldn't find any record matching "${query}". Try the full name, or tell me what type of record it is (account, deal, engagement, invoice, …).`,
      };
    }
    const top = merged[0]!;
    const clearWinner =
      merged.length === 1 || top.score - merged[1]!.score >= 0.25;
    if (clearWinner) {
      const p = detailProviderFor(top.kind)!;
      const r = await p.fetch(top.id, ctx, access);
      if (r && "forbidden" in r) return denyForbidden(r.forbidden);
      if (r && "ok" in r) return { ok: true, data: r.data };
    }
    const KIND_LABEL: Record<string, string> = {
      account: "Account",
      opportunity: "Opportunity",
      engagement: "Engagement",
      contact: "Contact",
      deliverable: "Deliverable",
      pov: "Point of view",
      partner_firm: "Partner firm",
      meeting: "Meeting",
      invoice: "Invoice",
      contract: "Contract",
      document: "Document",
      person: "Person",
    };
    const options = merged.map((c) => ({
      id: c.id,
      label: c.label,
      secondary: [KIND_LABEL[c.kind] ?? c.kind, c.secondary].filter(Boolean).join(" — "),
    }));
    return {
      ok: true,
      data: { prompt: `I found several records matching "${query}" — which one?`, options },
      disambiguation: { kind: "entity", options },
    };
  },
});

// ---------------------------------------------------------------------
// finance.statement_of_account — per-client AR ledger
// ---------------------------------------------------------------------

export interface StatementOfAccount {
  account: { id: string; name: string };
  currencies: Array<{
    currency: string;
    invoices: Array<{
      id: string;
      invoiceNumber: string | null;
      issuedAt: string | null;
      dueDate: string | null;
      status: string;
      total: number;
      amountPaid: number;
      outstanding: number;
      daysOverdue: number;
    }>;
    totals: { issued: number; paid: number; outstanding: number };
    aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  }>;
  payments: Array<{ at: string; amount: number; currency: string; invoiceNumber: string | null }>;
  invoiceCount: number;
}

/**
 * Shared per-account AR ledger aggregation (Task #853 step 6). Reads the
 * same `atelier_invoice` rows the wallet AR views use (status issued|paid,
 * non-voided, non-deleted) plus cash applications as the payment log.
 */
export async function computeStatementOfAccount(
  orgId: string,
  accountId: string,
): Promise<StatementOfAccount | null> {
  const [acc] = await db
    .select({ id: atelierAccounts.id, name: atelierAccounts.name })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, accountId), eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt)))
    .limit(1);
  if (!acc) return null;
  const invoices = await db
    .select()
    .from(atelierInvoice)
    .where(
      and(
        eq(atelierInvoice.accountId, accountId),
        eq(atelierInvoice.orgId, orgId),
        isNull(atelierInvoice.deletedAt),
        inArray(atelierInvoice.status, ["issued", "paid"]),
      ),
    )
    .orderBy(desc(atelierInvoice.issuedAt));
  const live = invoices.filter((i) => !i.voidedAt);
  const byCurrency = new Map<string, typeof live>();
  for (const inv of live) {
    const arr = byCurrency.get(inv.currency) ?? [];
    arr.push(inv);
    byCurrency.set(inv.currency, arr);
  }
  const currencies = [...byCurrency.entries()].map(([currency, rows]) => {
    const lines = rows.map((inv) => {
      const outstanding = round2(inv.total - inv.amountPaid);
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? null,
        issuedAt: inv.issuedAt ? inv.issuedAt.toISOString().slice(0, 10) : null,
        dueDate: inv.dueDate ?? null,
        status: inv.status,
        total: inv.total,
        amountPaid: inv.amountPaid,
        outstanding: outstanding > 0 ? outstanding : 0,
        daysOverdue: inv.status === "issued" && outstanding > 0 ? daysOverdue(inv.dueDate) : 0,
      };
    });
    const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const l of lines) {
      if (l.outstanding <= 0) continue;
      const d = l.daysOverdue;
      if (d <= 0) aging.current = round2(aging.current + l.outstanding);
      else if (d <= 30) aging.d1_30 = round2(aging.d1_30 + l.outstanding);
      else if (d <= 60) aging.d31_60 = round2(aging.d31_60 + l.outstanding);
      else if (d <= 90) aging.d61_90 = round2(aging.d61_90 + l.outstanding);
      else aging.d90_plus = round2(aging.d90_plus + l.outstanding);
    }
    return {
      currency,
      invoices: lines,
      totals: {
        issued: round2(lines.reduce((s, l) => s + l.total, 0)),
        paid: round2(lines.reduce((s, l) => s + l.amountPaid, 0)),
        outstanding: round2(lines.reduce((s, l) => s + l.outstanding, 0)),
      },
      aging,
    };
  });
  // Payment log: cash applications against this account's invoices
  // (positive rows only — reversals net out of invoice.amountPaid).
  const invIds = live.map((i) => i.id);
  const numberById = new Map(live.map((i) => [i.id, i.invoiceNumber ?? null]));
  const ccyById = new Map(live.map((i) => [i.id, i.currency]));
  const apps =
    invIds.length > 0
      ? await db
          .select({ invoiceId: atelierCashApplication.invoiceId, appliedAmount: atelierCashApplication.appliedAmount, createdAt: atelierCashApplication.createdAt })
          .from(atelierCashApplication)
          .where(and(inArray(atelierCashApplication.invoiceId, invIds), eq(atelierCashApplication.orgId, orgId)))
          .orderBy(desc(atelierCashApplication.createdAt))
          .limit(50)
      : [];
  const payments = apps
    .filter((a) => a.appliedAmount > 0)
    .map((a) => ({
      at: a.createdAt.toISOString().slice(0, 10),
      amount: a.appliedAmount,
      currency: ccyById.get(a.invoiceId) ?? "USD",
      invoiceNumber: numberById.get(a.invoiceId) ?? null,
    }));
  return { account: { id: acc.id, name: acc.name }, currencies, payments, invoiceCount: live.length };
}

defineCapability({
  id: "finance.statement_of_account",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "statement_of_account",
  description:
    "Per-client statement of account (AR ledger): issued invoices, payments applied, outstanding balance and aging summary for one account. Accepts an account id or name.",
  slashAliases: { en: ["/statement", "/soa"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      accountQuery: { type: "string", description: "Account name when the id is unknown." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["wallet", "account_workspace", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "statement_of_account",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show me the statement of account for Tasama", "What does Emaar owe us?"],
    ar: ["أرني كشف حساب Tasama"],
    fr: ["Montre-moi le relevé de compte de Tasama"],
  },
  async run(input, ctx) {
    // Same AR-detail gate as the wallet invoice routes: restricted
    // personas and board observers are denied (observers keep the
    // aging rollup via wallet.ar.aging); self-only personas never
    // reach here (capability not in their catalog slice).
    if (!arDetailAllowed(ctx)) return denyForbidden(AR_DENIED_MSG);
    let accountId = typeof input.accountId === "string" ? input.accountId.trim() : "";
    if (!accountId) {
      const q = typeof input.accountQuery === "string" ? input.accountQuery.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide accountId or accountQuery." };
      }
      const access = await engAclFor(ctx.persona);
      const cands = await hybridResolveEntity("account", q, ctx.persona.orgId);
      const visFlags = await Promise.all(
        cands.map((c) => canSeeAccount(access, { id: ctx.persona.id }, c.id).catch(() => false)),
      );
      const vis = cands.filter((_, i) => visFlags[i]);
      if (vis.length === 0) return notFound(`account matching "${q}"`);
      if (vis.length > 1 && vis[0]!.score - vis[1]!.score < 0.25) {
        const options = vis.slice(0, 5).map((c) => ({ id: c.id, label: c.label, secondary: c.secondary }));
        return {
          ok: true,
          data: { prompt: `Which account did you mean by "${q}"?`, options },
          disambiguation: { kind: "account", options },
        };
      }
      accountId = vis[0]!.id;
    } else {
      const access = await engAclFor(ctx.persona);
      const ok = await canSeeAccount(access, { id: ctx.persona.id }, accountId);
      if (!ok) return denyForbidden("You don't have access to this account.");
    }
    const soa = await computeStatementOfAccount(ctx.persona.orgId, accountId);
    if (!soa) return notFound("account");
    return {
      ok: true,
      data: {
        shape: "statement_of_account",
        ...soa,
        href: `/accounts/${soa.account.id}`,
      },
    };
  },
});

// ---------------------------------------------------------------------
// finance.pending_invoices — outstanding invoices by fuzzy project/account
// ---------------------------------------------------------------------

async function outstandingInvoicesFor(
  orgId: string,
  scope: { accountId?: string; engagementId?: string },
) {
  const rows = await db
    .select()
    .from(atelierInvoice)
    .where(
      and(
        eq(atelierInvoice.orgId, orgId),
        isNull(atelierInvoice.deletedAt),
        eq(atelierInvoice.status, "issued"),
        scope.accountId ? eq(atelierInvoice.accountId, scope.accountId) : undefined,
        scope.engagementId ? eq(atelierInvoice.engagementId, scope.engagementId) : undefined,
      ),
    )
    .orderBy(desc(atelierInvoice.issuedAt));
  const live = rows.filter((i) => !i.voidedAt && round2(i.total - i.amountPaid) > 0);
  const invIds = live.map((i) => i.id);
  const lastDunning = new Map<string, { stepIndex: number; sentAt: Date }>();
  if (invIds.length > 0) {
    const events = await db
      .select({ invoiceId: atelierDunningEvent.invoiceId, stepIndex: atelierDunningEvent.stepIndex, sentAt: atelierDunningEvent.sentAt })
      .from(atelierDunningEvent)
      .where(and(inArray(atelierDunningEvent.invoiceId, invIds), eq(atelierDunningEvent.orgId, orgId)))
      .orderBy(desc(atelierDunningEvent.sentAt));
    for (const e of events) {
      if (!lastDunning.has(e.invoiceId)) lastDunning.set(e.invoiceId, { stepIndex: e.stepIndex, sentAt: e.sentAt });
    }
  }
  return live.map((inv) => {
    const d = lastDunning.get(inv.id);
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber ?? null,
      currency: inv.currency,
      total: inv.total,
      amountDue: round2(inv.total - inv.amountPaid),
      dueDate: inv.dueDate ?? null,
      daysOverdue: daysOverdue(inv.dueDate),
      billTo: inv.billTo?.name ?? null,
      dunning: d ? { step: d.stepIndex, lastSentAt: d.sentAt.toISOString().slice(0, 10) } : null,
    };
  });
}

defineCapability({
  id: "finance.pending_invoices",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "pending_invoices",
  description:
    "List pending (outstanding) invoices for a project (engagement) or account, resolved fuzzily by name — amounts due, days overdue and dunning status. Offers a choice when the name matches both an engagement and an account.",
  slashAliases: { en: ["/pending-invoices", "/outstanding"] },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Project (engagement) or account name." },
      accountId: { type: "string", description: "Exact account id (e.g. from a disambiguation pick)." },
      engagementId: { type: "string", description: "Exact engagement id (e.g. from a disambiguation pick)." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["wallet", "account_workspace", "engagement_dashboard", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "pending_invoices",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["List pending invoices for Tasama", "Which invoices are still unpaid on the NEOM project?"],
    ar: ["اعرض الفواتير المعلقة لشركة Tasama"],
    fr: ["Liste les factures en attente pour Tasama"],
  },
  async run(input, ctx) {
    if (!arDetailAllowed(ctx)) return denyForbidden(AR_DENIED_MSG);
    const access = await engAclFor(ctx.persona);
    const me = { id: ctx.persona.id };

    let scope: { accountId?: string; engagementId?: string } | null = null;
    let scopeLabel = "";

    const accountId = typeof input.accountId === "string" ? input.accountId.trim() : "";
    const engagementId = typeof input.engagementId === "string" ? input.engagementId.trim() : "";
    if (accountId) {
      if (!(await canSeeAccount(access, me, accountId))) return denyForbidden("You don't have access to this account.");
      const [a] = await db.select({ name: atelierAccounts.name }).from(atelierAccounts).where(eq(atelierAccounts.id, accountId)).limit(1);
      if (!a) return notFound("account");
      scope = { accountId };
      scopeLabel = a.name;
    } else if (engagementId) {
      if (!(access.all === true || access.ids.has(engagementId))) return denyForbidden("You don't have access to this engagement.");
      const [e] = await db.select({ name: atelierEngagements.name }).from(atelierEngagements).where(eq(atelierEngagements.id, engagementId)).limit(1);
      if (!e) return notFound("engagement");
      scope = { engagementId };
      scopeLabel = e.name;
    } else {
      const q = typeof input.query === "string" ? input.query.trim() : "";
      if (q.length < 2) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "Provide a project or account name (query)." };
      }
      // A disambiguation pick re-enters through `query` holding the raw id
      // sometimes — accept exact ids transparently.
      const [accCands, engCands] = await Promise.all([
        hybridResolveEntity("account", q, ctx.persona.orgId),
        hybridResolveEntity("engagement", q, ctx.persona.orgId),
      ]);
      const [accFlags, engFlags] = await Promise.all([
        Promise.all(accCands.map((c) => canSeeAccount(access, me, c.id).catch(() => false))),
        Promise.all(engCands.map((c) => Promise.resolve(access.all === true || access.ids.has(c.id)))),
      ]);
      const accVis = accCands.filter((_, i) => accFlags[i]);
      const engVis = engCands.filter((_, i) => engFlags[i]);
      const combined = [
        ...accVis.map((c) => ({ ...c, scopeKind: "account" as const })),
        ...engVis.map((c) => ({ ...c, scopeKind: "engagement" as const })),
      ].sort((a, b) => b.score - a.score);
      if (combined.length === 0) return notFound(`project or account matching "${q}"`);
      const top = combined[0]!;
      const ambiguous = combined.length > 1 && top.score - combined[1]!.score < 0.25;
      if (ambiguous) {
        const options = combined.slice(0, 5).map((c) => ({
          id: c.id,
          label: c.label,
          secondary: `${c.scopeKind === "account" ? "Account" : "Engagement"}${c.secondary ? ` — ${c.secondary}` : ""}`,
        }));
        return {
          ok: true,
          data: { prompt: `"${q}" matches more than one record — which did you mean?`, options },
          disambiguation: { kind: "entity", options },
        };
      }
      scope = top.scopeKind === "account" ? { accountId: top.id } : { engagementId: top.id };
      scopeLabel = top.label;
    }

    const invoices = await outstandingInvoicesFor(ctx.persona.orgId, scope);
    const totals = new Map<string, number>();
    for (const i of invoices) totals.set(i.currency, round2((totals.get(i.currency) ?? 0) + i.amountDue));
    return {
      ok: true,
      data: {
        shape: "pending_invoices",
        scope: { ...scope, label: scopeLabel },
        invoices,
        totalsByCurrency: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
        count: invoices.length,
        href: scope.accountId ? `/accounts/${scope.accountId}` : `/engagements/${scope.engagementId}`,
      },
    };
  },
});
