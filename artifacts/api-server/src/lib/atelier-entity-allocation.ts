/**
 * Task #1095 — Entity Allocation Engine (benefit principle).
 *
 * Every expense and supplier invoice is allocated to the legal entity
 * that BENEFITS from the cost. A deterministic, ordered rule evaluator
 * runs first; an AI allocator runs only when the rules cannot decide.
 * Every allocation carries a written justification + confidence and
 * lands as `proposed` — a human (founding_partner / partner / finance)
 * approves or overrides it before the Bookkeeper posts it.
 *
 * Deterministic precedence (highest first):
 *   explicit_choice      — user picked the entity themselves
 *   engagement_entity    — the engagement's contracting entity
 *   registry_match       — lease/premises/registration/counterparty match
 *   travel_destination   — BD/client/internal/deliver-training travel →
 *                          destination-country entity
 *   travel_home          — attend-training / personal development →
 *                          traveller's home entity
 *   person_home          — person-bound costs → the person's home entity
 *   default_entity       — firm-wide/shared costs → default/head entity
 *                          (flagged `shared` for future recharge)
 *
 * The AI allocator (`ai` rule id) infers trip purpose / destination from
 * receipt or invoice text and picks an entity ONLY with an explicit
 * justification; confidence below AI_CONFIDENCE_FLOOR degrades to
 * `needs_input` — never a guess.
 */

import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierExpenses,
  atelierPartnerFirmInvoices,
  atelierLegalEntities,
  atelierEngagements,
  atelierEmployees,
  atelierContractors,
  atelierUsers,
  atelierAuditEvents,
  atelierInvoice,
  atelierContractorPayments,
  atelierBankTransaction,
  atelierBankAccount,
} from "@workspace/db";
import { extractFirstJsonObject } from "./atelier-agents/runner.js";

export const AI_CONFIDENCE_FLOOR = 0.6;

export type AllocRuleId =
  | "explicit_choice"
  | "engagement_entity"
  | "registry_match"
  | "travel_destination"
  | "travel_home"
  | "person_home"
  | "default_entity"
  | "ai";

export type AllocStatus = "proposed" | "approved" | "overridden" | "needs_input";

export interface AllocEntity {
  id: string;
  shortName: string;
  country: string; // ISO alpha-2
  lessorNames: string[]; // lease lessor/owner names (registry match)
  /** Head/default entity — carries firm-wide/shared costs. */
  isHeadEntity: boolean;
}

export interface AllocationDecision {
  entityId: string;
  ruleId: AllocRuleId;
  justification: string;
  confidence: number;
  decidedBy: "deterministic" | "ai";
  shared: boolean;
}

export interface AllocationRuleInput {
  kind: "expense" | "supplier_invoice";
  /** Explicit user-picked entity (highest precedence). */
  explicitEntityId?: string | null;
  /** The engagement's contracting legal entity, when linked. */
  engagementEntityId?: string | null;
  /** Merchant (expense) or supplier name (invoice). */
  counterpartyName?: string | null;
  /** Two-axis taxonomy (Task #383) + legacy flat category. */
  categoryCode?: string | null;
  subCategoryCode?: string | null;
  category?: string | null;
  /** Trip context: destination (ISO-2) + purpose, user-given or AI-inferred. */
  destinationCountry?: string | null;
  tripPurpose?: string | null;
  /** Country evidenced by the document itself (VAT country / OCR). */
  documentCountry?: string | null;
  /** Submitter's home entity/country (expenses only). */
  homeEntityId?: string | null;
  homeCountry?: string | null;
  entities: AllocEntity[];
  /** Default/head entity for firm-wide costs (single active, or firm default). */
  defaultEntityId?: string | null;
}

// ── Category classification ──────────────────────────────────────────

const TRAVEL_FLAT = new Set([
  "flight", "flights", "hotel", "hotels", "taxi", "transport", "travel",
  "per_diem", "mileage", "meal", "meals",
]);
const TRAVEL_SUBS = new Set([
  "flights", "lodging", "ground_transport", "mileage", "per_diem",
  "client_meals", "team_meals",
]);
const ENTITY_OP_SUBS = new Set([
  "rent_facilities", "utilities", "visas_travel_docs", "printing_postage",
  "office_supplies",
]);
const ENTITY_OP_FLAT = new Set(["bank", "fees", "office", "supplies"]);
const PERSON_SUBS = new Set([
  "it_equipment", "telecom_connectivity", "hardware_provisioning",
]);
const FIRM_WIDE_SUBS = new Set([
  "software_subscriptions", "cloud_internal",
]);
const FIRM_WIDE_FLAT = new Set(["software", "saas", "subscriptions", "marketing"]);

export type CostClass = "travel" | "entity_op" | "person_bound" | "firm_wide" | "other";

export function classifyCost(input: {
  categoryCode?: string | null;
  subCategoryCode?: string | null;
  category?: string | null;
}): CostClass {
  const sub = (input.subCategoryCode ?? "").toLowerCase();
  const top = (input.categoryCode ?? "").toLowerCase();
  const flat = (input.category ?? "").toLowerCase();
  if (top === "travel" || TRAVEL_SUBS.has(sub) || TRAVEL_FLAT.has(flat)) return "travel";
  if (ENTITY_OP_SUBS.has(sub) || ENTITY_OP_FLAT.has(flat)) return "entity_op";
  if (PERSON_SUBS.has(sub)) return "person_bound";
  if (top === "technology" && FIRM_WIDE_SUBS.has(sub)) return "firm_wide";
  if (FIRM_WIDE_SUBS.has(sub) || FIRM_WIDE_FLAT.has(flat)) return "firm_wide";
  return "other";
}

const DESTINATION_PURPOSES = new Set([
  "bd", "client_project", "internal_meeting", "training_deliver",
]);
const HOME_PURPOSES = new Set(["training_attend", "personal_dev"]);

function entityById(entities: AllocEntity[], id: string | null | undefined): AllocEntity | null {
  if (!id) return null;
  return entities.find((e) => e.id === id) ?? null;
}

/** The unique active entity in a country, or null when 0 or 2+. */
function soleEntityInCountry(entities: AllocEntity[], country: string | null | undefined): AllocEntity | null {
  const c = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const hits = entities.filter((e) => e.country.toUpperCase() === c);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Pure, ordered deterministic rule evaluator. Returns null when no rule
 * can decide — the caller then tries the AI allocator (or `needs_input`).
 */
export function evaluateAllocationRules(input: AllocationRuleInput): AllocationDecision | null {
  const { entities } = input;
  if (entities.length === 0) return null;

  // 1. Explicit user choice.
  const explicit = entityById(entities, input.explicitEntityId);
  if (explicit) {
    return {
      entityId: explicit.id, ruleId: "explicit_choice",
      justification: `You picked ${explicit.shortName} explicitly.`,
      confidence: 1, decidedBy: "deterministic", shared: false,
    };
  }

  // 2. Engagement's contracting entity.
  const eng = entityById(entities, input.engagementEntityId);
  if (eng) {
    return {
      entityId: eng.id, ruleId: "engagement_entity",
      justification: `Linked to an engagement contracted by ${eng.shortName} — engagement costs follow the contracting entity.`,
      confidence: 0.95, decidedBy: "deterministic", shared: false,
    };
  }

  const costClass = classifyCost(input);
  const counterparty = (input.counterpartyName ?? "").trim().toLowerCase();

  // 3. Registry match — lease lessor/owner name, or an entity-specific
  //    operating cost in a country with exactly one entity.
  if (counterparty) {
    const leaseHit = entities.find((e) =>
      e.lessorNames.some((n) => {
        const ln = n.trim().toLowerCase();
        return ln.length >= 4 && (counterparty.includes(ln) || ln.includes(counterparty));
      }),
    );
    if (leaseHit) {
      return {
        entityId: leaseHit.id, ruleId: "registry_match",
        justification: `Counterparty "${input.counterpartyName}" matches the registered lessor on ${leaseHit.shortName}'s lease — premises costs belong to that entity.`,
        confidence: 0.9, decidedBy: "deterministic", shared: false,
      };
    }
  }
  if (costClass === "entity_op") {
    const country = input.documentCountry ?? input.destinationCountry ?? null;
    const ent = soleEntityInCountry(entities, country);
    if (ent) {
      return {
        entityId: ent.id, ruleId: "registry_match",
        justification: `Entity-specific operating cost incurred in ${country?.toUpperCase()} — ${ent.shortName} is the registered entity there.`,
        confidence: 0.85, decidedBy: "deterministic", shared: false,
      };
    }
  }

  // 4. Travel purpose (destination vs home).
  if (costClass === "travel") {
    const purpose = (input.tripPurpose ?? "").toLowerCase();
    if (DESTINATION_PURPOSES.has(purpose)) {
      const dest = soleEntityInCountry(entities, input.destinationCountry ?? input.documentCountry);
      if (dest) {
        const label =
          purpose === "bd" ? "business development"
          : purpose === "client_project" ? "client project work"
          : purpose === "internal_meeting" ? "internal meetings"
          : "delivering a training";
        return {
          entityId: dest.id, ruleId: "travel_destination",
          justification: `Travel to ${(input.destinationCountry ?? input.documentCountry ?? "").toUpperCase()} for ${label} — the benefit principle allocates it to the destination entity ${dest.shortName}.`,
          confidence: 0.9, decidedBy: "deterministic", shared: false,
        };
      }
    }
    if (HOME_PURPOSES.has(purpose)) {
      const home =
        entityById(entities, input.homeEntityId) ??
        soleEntityInCountry(entities, input.homeCountry);
      if (home) {
        return {
          entityId: home.id, ruleId: "travel_home",
          justification: `Travel to ${purpose === "training_attend" ? "attend a training" : "personal development"} — the traveller's home entity ${home.shortName} benefits.`,
          confidence: 0.9, decidedBy: "deterministic", shared: false,
        };
      }
    }
    // Travel with unknown purpose — leave for the AI allocator.
    return null;
  }

  // 5. Person-bound costs → home entity.
  if (costClass === "person_bound") {
    const home =
      entityById(entities, input.homeEntityId) ??
      soleEntityInCountry(entities, input.homeCountry);
    if (home) {
      return {
        entityId: home.id, ruleId: "person_home",
        justification: `Person-bound cost (equipment/phone/benefits) — allocated to the person's home entity ${home.shortName}.`,
        confidence: 0.85, decidedBy: "deterministic", shared: false,
      };
    }
  }

  // 6. Firm-wide/shared costs → default entity, flagged shared.
  if (costClass === "firm_wide") {
    const def = entityById(entities, input.defaultEntityId);
    if (def) {
      return {
        entityId: def.id, ruleId: "default_entity",
        justification: `Firm-wide cost (group software/brand/hosting) — carried by the head entity ${def.shortName} and flagged shared for a future intercompany recharge.`,
        confidence: 0.8, decidedBy: "deterministic", shared: true,
      };
    }
  }

  // 7. Single-entity org: everything lands on the only entity.
  if (entities.length === 1) {
    return {
      entityId: entities[0].id, ruleId: "default_entity",
      justification: `${entities[0].shortName} is the only active legal entity.`,
      confidence: 0.9, decidedBy: "deterministic", shared: false,
    };
  }
  return null;
}

// ── Context loading ──────────────────────────────────────────────────

export interface AllocationContext {
  entities: AllocEntity[];
  defaultEntityId: string | null;
}

export async function loadAllocationContext(orgId: string): Promise<AllocationContext> {
  const rows = await db
    .select()
    .from(atelierLegalEntities)
    .where(eq(atelierLegalEntities.orgId, orgId));
  const active = rows.filter((r) => r.status !== "archived" && !r.archivedAt);
  const entities: AllocEntity[] = active.map((r) => ({
    id: r.id,
    shortName: r.shortName || r.legalNameEn,
    country: (r.country ?? "").toUpperCase(),
    lessorNames: [r.lease?.lessorName, r.lease?.ownerName].filter(
      (n): n is string => typeof n === "string" && n.trim().length > 0,
    ),
    isHeadEntity: r.isHeadEntity === true,
  }));
  // Default = the flagged head entity (exactly one — the registry write
  // path clears other flags); a single-entity org defaults to that entity.
  const heads = entities.filter((e) => e.isHeadEntity);
  return {
    entities,
    defaultEntityId:
      heads.length === 1 ? heads[0].id : entities.length === 1 ? entities[0].id : null,
  };
}

/** Engagement's contracting legal entity, when tagged. */
export async function engagementEntityId(
  orgId: string,
  engagementId: string | null | undefined,
): Promise<string | null> {
  if (!engagementId) return null;
  const [eng] = await db
    .select({ legalEntityId: atelierEngagements.legalEntityId })
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, engagementId), eq(atelierEngagements.orgId, orgId)));
  return eng?.legalEntityId ?? null;
}

/** Home entity/country for the submitting USER (expenses.personId = users.id). */
export async function homeInfoForUser(
  orgId: string,
  userId: string,
): Promise<{ homeEntityId: string | null; homeCountry: string | null }> {
  const [emp] = await db
    .select({
      legalEntityId: atelierEmployees.legalEntityId,
      homeCountry: atelierEmployees.homeCountry,
      country: atelierEmployees.country,
    })
    .from(atelierEmployees)
    .where(and(
      eq(atelierEmployees.orgId, orgId),
      eq(atelierEmployees.userId, userId),
      isNull(atelierEmployees.deletedAt),
    ));
  if (emp) {
    return {
      homeEntityId: emp.legalEntityId ?? null,
      homeCountry: (emp.homeCountry ?? emp.country ?? null)?.toUpperCase().slice(0, 2) ?? null,
    };
  }
  // Contractors link by email (no userId column).
  const [user] = await db
    .select({ email: atelierUsers.email })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, userId), eq(atelierUsers.orgId, orgId)));
  if (user?.email) {
    const [con] = await db
      .select({
        homeCountry: atelierContractors.homeCountry,
        countryCode: atelierContractors.countryCode,
        country: atelierContractors.country,
      })
      .from(atelierContractors)
      .where(and(
        eq(atelierContractors.orgId, orgId),
        eq(atelierContractors.email, user.email),
        isNull(atelierContractors.deletedAt),
      ));
    if (con) {
      return {
        homeEntityId: null,
        homeCountry:
          (con.homeCountry ?? con.countryCode ?? null)?.toUpperCase().slice(0, 2) ?? null,
      };
    }
  }
  return { homeEntityId: null, homeCountry: null };
}

// ── AI allocator fallback ────────────────────────────────────────────

const AI_ALLOCATOR_SYSTEM = `You are an intercompany cost-allocation analyst. Allocate a cost to the legal entity that BENEFITS from it (the "benefit principle"):
- Travel for business development, client projects, internal meetings, or DELIVERING trainings benefits the DESTINATION country's entity.
- Travel to ATTEND (receive) a training or personal development benefits the traveller's HOME entity.
- Engagement/project costs benefit the entity that contracts the engagement.
- Entity-specific operating costs (rent, licences, visas, local fees) benefit that entity.
- Person-bound costs (benefits, equipment, phone) benefit the person's home entity.
- Firm-wide/shared costs (group software, brand, hosting) go to the head entity, flagged shared.
Never guess: when the evidence does not clearly identify one entity, return entityId null and explain what a human must decide. Only use entity ids from the provided list.

Return ONLY one JSON object:
{
  "entityId": string|null,
  "tripPurpose": "bd"|"client_project"|"internal_meeting"|"training_deliver"|"training_attend"|"personal_dev"|null,
  "destinationCountry": string|null (ISO-3166 alpha-2),
  "shared": boolean,
  "justification": string (one plain-language sentence a reviewer can read),
  "confidence": number (0-1)
}`;

export interface AiAllocationResult {
  entityId: string | null;
  tripPurpose: string | null;
  destinationCountry: string | null;
  shared: boolean;
  justification: string;
  confidence: number;
}

export async function aiAllocateEntity(args: {
  contextLabel: string;
  text: string;
  entities: AllocEntity[];
  homeCountry?: string | null;
  homeEntityId?: string | null;
}): Promise<AiAllocationResult | null> {
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    const entityList = args.entities
      .map((e) => `- id=${e.id} name="${e.shortName}" country=${e.country}`)
      .join("\n");
    const homeLine = args.homeEntityId
      ? `Submitter's home entity id: ${args.homeEntityId}`
      : args.homeCountry
        ? `Submitter's home country: ${args.homeCountry}`
        : "Submitter's home entity: unknown";
    const resp = await anthropic.messages
      .create(
        {
          model: "claude-haiku-4-5",
          max_tokens: 512,
          system: `${AI_ALLOCATOR_SYSTEM}\n\nIMPORTANT: Reply with ONLY a single JSON object, no prose, no code fences.`,
          messages: [
            {
              role: "user",
              content: `${args.contextLabel}\n\nLegal entities:\n${entityList}\n${homeLine}\n\nCost evidence:\n<<<\n${args.text.slice(0, 20_000)}\n>>>`,
            },
          ],
        },
        { signal: ac.signal },
      )
      .finally(() => clearTimeout(timer));
    const block = resp.content[0];
    const raw = block && block.type === "text" ? block.text.trim() : "";
    const json = extractFirstJsonObject(
      raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
    );
    if (!json) return null;
    const p = JSON.parse(json) as Record<string, unknown>;
    const validId =
      typeof p.entityId === "string" && args.entities.some((e) => e.id === p.entityId)
        ? p.entityId
        : null;
    const conf =
      typeof p.confidence === "number" && Number.isFinite(p.confidence)
        ? Math.max(0, Math.min(1, p.confidence))
        : 0;
    return {
      entityId: validId,
      tripPurpose: typeof p.tripPurpose === "string" ? p.tripPurpose : null,
      destinationCountry:
        typeof p.destinationCountry === "string" && /^[A-Za-z]{2}$/.test(p.destinationCountry)
          ? p.destinationCountry.toUpperCase()
          : null,
      shared: p.shared === true,
      justification:
        typeof p.justification === "string" && p.justification.trim()
          ? p.justification.trim().slice(0, 1000)
          : "AI allocator returned no justification.",
      confidence: conf,
    };
  } catch {
    // Fail-soft: AI unavailability degrades to needs_input, never blocks.
    return null;
  }
}

// ── Orchestrators: propose on expense / supplier invoice ─────────────

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function writeAllocationAudit(args: {
  entityType:
    | "expense"
    | "partner_firm_invoice"
    | "invoice"
    | "contractor_payment"
    | "bank_transaction";
  entityId: string;
  /**
   * Explicit org tenancy. Always supply this in background-job contexts
   * (scheduled sweeps, agent runs without an active request) — without it the
   * row's `org_id` column falls back to the session-level `app.org_id` GUC
   * which defaults to `'aico'` on pooled connections, mis-attributing the
   * audit event to the wrong tenant.
   */
  orgId?: string;
  actorId: string | null;
  actorLabel: string;
  action: "allocation.propose" | "allocation.approve" | "allocation.override" | "allocation.needs_input";
  changes: Array<{ field: string; from: unknown; to: unknown }>;
  ruleId?: string | null;
  justification?: string | null;
  confidence?: number | null;
  decidedBy?: string | null;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    ...(args.orgId ? { orgId: args.orgId } : {}),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: args.actorId ? "human" : "agent",
    actorId: args.actorId ?? "entity_allocator",
    actorLabel: args.actorLabel,
    action: args.action,
    payload: {
      changes: args.changes,
      ruleId: args.ruleId ?? null,
      justification: args.justification ?? null,
      confidence: args.confidence ?? null,
      decidedBy: args.decidedBy ?? null,
    },
    payloadSummary: args.summary,
  });
}

export interface ProposeResult {
  status: AllocStatus | null; // null = row untouched (already decided)
  decision: AllocationDecision | null;
}

/**
 * Run the allocation engine over an expense row and persist a `proposed`
 * (or `needs_input`) allocation. Never touches rows whose allocation a
 * human already approved/overrode, and never overwrites an explicit
 * pre-existing entity tag (that becomes an explicit_choice proposal).
 */
export async function proposeExpenseAllocation(
  expenseId: string,
  opts: {
    allowAi?: boolean;
    actorId?: string | null;
    aiText?: string | null;
    /** User picked the entity up-front (e.g. in the chat confirm card). */
    explicitEntityId?: string | null;
  } = {},
): Promise<ProposeResult> {
  const [row] = await db.select().from(atelierExpenses)
    .where(and(eq(atelierExpenses.id, expenseId), isNull(atelierExpenses.deletedAt)));
  if (!row) return { status: null, decision: null };
  if (row.allocStatus === "approved" || row.allocStatus === "overridden") {
    return { status: null, decision: null };
  }
  const ctx = await loadAllocationContext(row.orgId);
  if (ctx.entities.length === 0) return { status: null, decision: null };
  const [engEnt, home] = await Promise.all([
    engagementEntityId(row.orgId, row.engagementId),
    homeInfoForUser(row.orgId, row.personId),
  ]);
  const ocr = row.ocrPayload as { country?: string; rawText?: string } | null;
  const baseInput: AllocationRuleInput = {
    kind: "expense",
    // An entity tagged before any allocation lifecycle = explicit user choice.
    explicitEntityId: opts.explicitEntityId ?? (row.allocStatus == null ? row.entityId : null),
    engagementEntityId: engEnt,
    counterpartyName: row.merchant,
    categoryCode: row.categoryCode,
    subCategoryCode: row.subCategoryCode,
    category: row.category,
    destinationCountry: row.tripDestinationCountry,
    tripPurpose: row.tripPurpose,
    documentCountry: row.vatCountryCode ?? row.vatCountry ?? ocr?.country ?? null,
    homeEntityId: home.homeEntityId,
    homeCountry: home.homeCountry,
    entities: ctx.entities,
    defaultEntityId: ctx.defaultEntityId,
  };
  let decision = evaluateAllocationRules(baseInput);
  let inferredTrip: { purpose: string | null; destination: string | null } | null = null;

  if (!decision && opts.allowAi !== false) {
    const text = [
      opts.aiText,
      row.description,
      row.summary,
      ocr?.rawText,
      `merchant: ${row.merchant ?? "?"}`,
      `category: ${row.subCategoryCode ?? row.category}`,
      row.tripDestinationCountry ? `destination: ${row.tripDestinationCountry}` : null,
    ].filter(Boolean).join("\n");
    const ai = await aiAllocateEntity({
      contextLabel: `Expense by a roster member (${row.personType}). Amount ${row.currency} ${row.amount}.`,
      text,
      entities: ctx.entities,
      homeCountry: home.homeCountry,
      homeEntityId: home.homeEntityId,
    });
    if (ai) {
      inferredTrip = { purpose: ai.tripPurpose, destination: ai.destinationCountry };
      // Re-run deterministic rules with the AI-inferred trip context —
      // if a rule now fires, the DECISION is deterministic (AI only
      // supplied missing inputs).
      const rerun = evaluateAllocationRules({
        ...baseInput,
        destinationCountry: baseInput.destinationCountry ?? ai.destinationCountry,
        tripPurpose: baseInput.tripPurpose ?? ai.tripPurpose,
      });
      if (rerun) {
        decision = { ...rerun, confidence: Math.min(rerun.confidence, Math.max(ai.confidence, 0.6)) };
      } else if (ai.entityId && ai.confidence >= AI_CONFIDENCE_FLOOR) {
        decision = {
          entityId: ai.entityId, ruleId: "ai",
          justification: ai.justification,
          confidence: ai.confidence, decidedBy: "ai", shared: ai.shared,
        };
      }
    }
  }

  const now = new Date();
  const tripPatch =
    inferredTrip && (!row.tripPurpose || !row.tripDestinationCountry)
      ? {
          ...(row.tripPurpose ? {} : { tripPurpose: inferredTrip.purpose }),
          ...(row.tripDestinationCountry ? {} : { tripDestinationCountry: inferredTrip.destination }),
          ...(row.tripContextSource ? {} : { tripContextSource: "ai" as const }),
        }
      : {};
  if (!decision) {
    await db.update(atelierExpenses).set({
      allocStatus: "needs_input",
      allocRuleId: null,
      allocJustification:
        "Could not determine which entity benefits — pick the entity manually (rules and AI both lacked a confident answer).",
      allocConfidence: null,
      allocDecidedBy: null,
      ...tripPatch,
      updatedAt: now,
    }).where(eq(atelierExpenses.id, row.id));
    await writeAllocationAudit({
      entityType: "expense", entityId: row.id, orgId: row.orgId,
      actorId: opts.actorId ?? null, actorLabel: "Entity Allocator",
      action: "allocation.needs_input",
      changes: [{ field: "allocStatus", from: row.allocStatus, to: "needs_input" }],
      summary: `Entity allocation needs human input for expense ${row.merchant ?? row.id}.`,
    });
    return { status: "needs_input", decision: null };
  }
  await db.update(atelierExpenses).set({
    entityId: decision.entityId,
    allocStatus: "proposed",
    allocRuleId: decision.ruleId,
    allocJustification: decision.justification,
    allocConfidence: decision.confidence,
    allocDecidedBy: decision.decidedBy,
    allocShared: decision.shared,
    ...tripPatch,
    updatedAt: now,
  }).where(eq(atelierExpenses.id, row.id));
  await writeAllocationAudit({
    entityType: "expense", entityId: row.id, orgId: row.orgId,
    actorId: opts.actorId ?? null, actorLabel: "Entity Allocator",
    action: "allocation.propose",
    changes: [
      { field: "entityId", from: row.entityId, to: decision.entityId },
      { field: "allocStatus", from: row.allocStatus, to: "proposed" },
    ],
    ruleId: decision.ruleId, justification: decision.justification,
    confidence: decision.confidence, decidedBy: decision.decidedBy,
    summary: `Proposed entity allocation (${decision.ruleId}) for expense ${row.merchant ?? row.id}: ${decision.justification}`,
  });
  return { status: "proposed", decision };
}

/** Same engine over a supplier / partner-firm invoice row. */
export async function proposeSupplierInvoiceAllocation(
  invoiceId: string,
  opts: {
    allowAi?: boolean;
    actorId?: string | null;
    aiText?: string | null;
    /** User picked the entity up-front (e.g. in the chat confirm card). */
    explicitEntityId?: string | null;
  } = {},
): Promise<ProposeResult> {
  const [row] = await db.select().from(atelierPartnerFirmInvoices)
    .where(and(eq(atelierPartnerFirmInvoices.id, invoiceId), isNull(atelierPartnerFirmInvoices.deletedAt)));
  if (!row) return { status: null, decision: null };
  if (row.allocStatus === "approved" || row.allocStatus === "overridden") {
    return { status: null, decision: null };
  }
  const ctx = await loadAllocationContext(row.orgId);
  if (ctx.entities.length === 0) return { status: null, decision: null };
  const engEnt = await engagementEntityId(row.orgId, row.engagementId);
  const baseInput: AllocationRuleInput = {
    kind: "supplier_invoice",
    explicitEntityId: opts.explicitEntityId ?? (row.allocStatus == null ? row.legalEntityId : null),
    engagementEntityId: engEnt,
    counterpartyName: row.partnerFirmName,
    category: null,
    entities: ctx.entities,
    defaultEntityId: ctx.defaultEntityId,
  };
  let decision = evaluateAllocationRules(baseInput);
  // Build AI text from the row's own fields when the caller doesn't supply it
  // (e.g. scheduled sweep) — this ensures allowAi:true actually fires for
  // supplier invoices regardless of the call site.
  if (!decision && opts.allowAi !== false) {
    const aiText = opts.aiText ?? [
      `supplier: ${row.partnerFirmName}`,
      row.reference ? `reference: ${row.reference}` : null,
      `week: ${row.weekIso}`,
      row.engagementId ? `engagement: ${row.engagementId}` : null,
      row.notes,
    ].filter(Boolean).join("\n");
    const ai = await aiAllocateEntity({
      contextLabel: `Supplier invoice from ${row.partnerFirmName}, ${row.costCurrency} ${row.costAmount}.`,
      text: aiText,
      entities: ctx.entities,
    });
    if (ai?.entityId && ai.confidence >= AI_CONFIDENCE_FLOOR) {
      decision = {
        entityId: ai.entityId, ruleId: "ai",
        justification: ai.justification,
        confidence: ai.confidence, decidedBy: "ai", shared: ai.shared,
      };
    }
  }
  const now = new Date();
  if (!decision) {
    await db.update(atelierPartnerFirmInvoices).set({
      allocStatus: "needs_input",
      allocRuleId: null,
      allocJustification:
        "Could not determine which entity benefits from this invoice — pick the entity manually.",
      allocConfidence: null,
      allocDecidedBy: null,
      updatedAt: now,
    }).where(eq(atelierPartnerFirmInvoices.id, row.id));
    await writeAllocationAudit({
      entityType: "partner_firm_invoice", entityId: row.id, orgId: row.orgId,
      actorId: opts.actorId ?? null, actorLabel: "Entity Allocator",
      action: "allocation.needs_input",
      changes: [{ field: "allocStatus", from: row.allocStatus, to: "needs_input" }],
      summary: `Entity allocation needs human input for supplier invoice ${row.reference ?? row.id}.`,
    });
    return { status: "needs_input", decision: null };
  }
  await db.update(atelierPartnerFirmInvoices).set({
    legalEntityId: decision.entityId,
    allocStatus: "proposed",
    allocRuleId: decision.ruleId,
    allocJustification: decision.justification,
    allocConfidence: decision.confidence,
    allocDecidedBy: decision.decidedBy,
    allocShared: decision.shared,
    updatedAt: now,
  }).where(eq(atelierPartnerFirmInvoices.id, row.id));
  await writeAllocationAudit({
    entityType: "partner_firm_invoice", entityId: row.id, orgId: row.orgId,
    actorId: opts.actorId ?? null, actorLabel: "Entity Allocator",
    action: "allocation.propose",
    changes: [
      { field: "legalEntityId", from: row.legalEntityId, to: decision.entityId },
      { field: "allocStatus", from: row.allocStatus, to: "proposed" },
    ],
    ruleId: decision.ruleId, justification: decision.justification,
    confidence: decision.confidence, decidedBy: decision.decidedBy,
    summary: `Proposed entity allocation (${decision.ruleId}) for supplier invoice ${row.reference ?? row.id}: ${decision.justification}`,
  });
  return { status: "proposed", decision };
}

// ── Propose on the remaining GL untagged kinds (Task #1199) ──────────
//
// Client invoices, contractor payments and bank transactions do not gate
// Bookkeeper posting on allocStatus (out of scope to change), so the
// proposed entity is stored in allocProposedEntityId and legalEntityId is
// written ONLY when a human approves via decideAllocation — a proposal
// can never auto-post.

export type GlProposeKind = "invoice" | "contractor_payment" | "bank_transaction";

const GL_PROPOSE_TABLES = {
  invoice: atelierInvoice,
  contractor_payment: atelierContractorPayments,
  bank_transaction: atelierBankTransaction,
} as const;

export async function proposeGlRecordAllocation(
  kind: GlProposeKind,
  id: string,
  opts: { allowAi?: boolean; actorId?: string | null } = {},
): Promise<ProposeResult> {
  const table = GL_PROPOSE_TABLES[kind];
  const [row] = await db.select().from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)));
  if (!row) return { status: null, decision: null };
  const r = row as {
    orgId: string;
    legalEntityId: string | null;
    allocStatus: string | null;
  };
  if (r.allocStatus === "approved" || r.allocStatus === "overridden") {
    return { status: null, decision: null };
  }
  // Already tagged (e.g. by the Bookkeeper backfill) — nothing to propose.
  if (r.legalEntityId) return { status: null, decision: null };
  const ctx = await loadAllocationContext(r.orgId);
  if (ctx.entities.length === 0) return { status: null, decision: null };

  let decision: AllocationDecision | null = null;
  let aiText: string | null = null;
  let aiContext = "";
  let label = id;

  if (kind === "invoice") {
    const inv = row as typeof atelierInvoice.$inferSelect;
    label = inv.invoiceNumber ?? inv.id;
    const engEnt = entityById(ctx.entities, await engagementEntityId(r.orgId, inv.engagementId));
    const jurEnt = soleEntityInCountry(ctx.entities, inv.jurisdiction);
    if (engEnt) {
      decision = {
        entityId: engEnt.id, ruleId: "engagement_entity",
        justification: `Invoice issued under an engagement contracted by ${engEnt.shortName} — invoiced revenue belongs to the contracting entity.`,
        confidence: 0.95, decidedBy: "deterministic", shared: false,
      };
    } else if (jurEnt) {
      decision = {
        entityId: jurEnt.id, ruleId: "registry_match",
        justification: `Invoice raised in the ${inv.jurisdiction.toUpperCase()} jurisdiction — ${jurEnt.shortName} is the sole registered entity there.`,
        confidence: 0.85, decidedBy: "deterministic", shared: false,
      };
    }
    aiContext = `Client (AR) invoice ${label}, ${inv.currency} ${inv.total}.`;
    aiText = [
      `bill to: ${inv.billTo?.name ?? "?"} (${inv.billTo?.country ?? "?"})`,
      `jurisdiction: ${inv.jurisdiction}`,
      inv.notes,
    ].filter(Boolean).join("\n");
  } else if (kind === "contractor_payment") {
    const cp = row as typeof atelierContractorPayments.$inferSelect;
    label = `${cp.payeeName} · ${cp.weekIso}`;
    const engEnt = entityById(ctx.entities, await engagementEntityId(r.orgId, cp.engagementId));
    if (engEnt) {
      decision = {
        entityId: engEnt.id, ruleId: "engagement_entity",
        justification: `Contractor cost on an engagement contracted by ${engEnt.shortName} — subcontractor costs follow the contracting entity.`,
        confidence: 0.95, decidedBy: "deterministic", shared: false,
      };
    } else {
      const home = await homeInfoForUser(r.orgId, cp.payeeUserId);
      const homeEnt =
        entityById(ctx.entities, home.homeEntityId) ??
        soleEntityInCountry(ctx.entities, home.homeCountry);
      if (homeEnt) {
        decision = {
          entityId: homeEnt.id, ruleId: "person_home",
          justification: `No engagement entity is tagged — allocated to ${cp.payeeName}'s home entity ${homeEnt.shortName}.`,
          confidence: 0.8, decidedBy: "deterministic", shared: false,
        };
      }
    }
    aiContext = `Contractor payment to ${cp.payeeName} for week ${cp.weekIso}, USD ${cp.usdAmount}.`;
    aiText = [cp.notes, `payee: ${cp.payeeName}`].filter(Boolean).join("\n");
  } else {
    const bt = row as typeof atelierBankTransaction.$inferSelect;
    label = `${bt.counterpartyNameRaw ?? "Bank txn"} · ${bt.postedDate}`;
    const [acct] = await db.select().from(atelierBankAccount)
      .where(and(eq(atelierBankAccount.id, bt.bankAccountId), isNull(atelierBankAccount.deletedAt)));
    const acctEnt = entityById(ctx.entities, acct?.legalEntityId);
    if (acctEnt) {
      decision = {
        entityId: acctEnt.id, ruleId: "registry_match",
        justification: `Bank account "${acct!.accountLabel}" is registered to ${acctEnt.shortName} — its transactions belong to that entity.`,
        confidence: 0.95, decidedBy: "deterministic", shared: false,
      };
    }
    aiContext = `Bank transaction (${bt.kind}) of ${bt.currency} ${bt.amount} on ${bt.postedDate}.`;
    aiText = [
      bt.counterpartyNameRaw ? `counterparty: ${bt.counterpartyNameRaw}` : null,
      bt.referenceRaw ? `reference: ${bt.referenceRaw}` : null,
      bt.notes,
    ].filter(Boolean).join("\n");
  }

  // Single-entity org fallback before AI.
  if (!decision && ctx.entities.length === 1) {
    decision = {
      entityId: ctx.entities[0].id, ruleId: "default_entity",
      justification: `${ctx.entities[0].shortName} is the only active legal entity.`,
      confidence: 0.9, decidedBy: "deterministic", shared: false,
    };
  }

  if (!decision && opts.allowAi !== false && aiText) {
    const ai = await aiAllocateEntity({
      contextLabel: aiContext,
      text: aiText,
      entities: ctx.entities,
    });
    if (ai?.entityId && ai.confidence >= AI_CONFIDENCE_FLOOR) {
      decision = {
        entityId: ai.entityId, ruleId: "ai",
        justification: ai.justification,
        confidence: ai.confidence, decidedBy: "ai", shared: ai.shared,
      };
    }
  }

  const now = new Date();
  if (!decision) {
    await db.update(table).set({
      allocStatus: "needs_input",
      allocProposedEntityId: null,
      allocRuleId: null,
      allocJustification:
        "Could not determine which entity this belongs to — pick the entity manually.",
      allocConfidence: null,
      allocDecidedBy: null,
      updatedAt: now,
    }).where(eq(table.id, id));
    await writeAllocationAudit({
      entityType: kind, entityId: id, orgId: r.orgId,
      actorId: opts.actorId ?? null, actorLabel: "Entity Allocator",
      action: "allocation.needs_input",
      changes: [{ field: "allocStatus", from: r.allocStatus, to: "needs_input" }],
      summary: `Entity allocation needs human input for ${kind.replace(/_/g, " ")} ${label}.`,
    });
    return { status: "needs_input", decision: null };
  }
  // Proposal only — legalEntityId stays null until a human approves.
  await db.update(table).set({
    allocStatus: "proposed",
    allocProposedEntityId: decision.entityId,
    allocRuleId: decision.ruleId,
    allocJustification: decision.justification,
    allocConfidence: decision.confidence,
    allocDecidedBy: decision.decidedBy,
    allocShared: decision.shared,
    updatedAt: now,
  }).where(eq(table.id, id));
  await writeAllocationAudit({
    entityType: kind, entityId: id, orgId: r.orgId,
    actorId: opts.actorId ?? null, actorLabel: "Entity Allocator",
    action: "allocation.propose",
    changes: [
      { field: "allocProposedEntityId", from: null, to: decision.entityId },
      { field: "allocStatus", from: r.allocStatus, to: "proposed" },
    ],
    ruleId: decision.ruleId, justification: decision.justification,
    confidence: decision.confidence, decidedBy: decision.decidedBy,
    summary: `Proposed entity allocation (${decision.ruleId}) for ${kind.replace(/_/g, " ")} ${label}: ${decision.justification}`,
  });
  return { status: "proposed", decision };
}

// ── Human decision: approve / override ───────────────────────────────

export interface DecideArgs {
  kind: "expense" | "supplier_invoice" | GlProposeKind;
  id: string;
  orgId: string;
  actor: { id: string; name: string };
  /** When set and different from the proposal → override. */
  entityId?: string | null;
  overrideReason?: string | null;
}

export type DecideResult =
  | { ok: true; status: "approved" | "overridden"; entityId: string }
  | { ok: false; error: string; message: string };

/**
 * Approve or override the allocation on an expense / supplier invoice.
 * Callers own role gating and period-close checks; this owns the state
 * transition + audit row.
 */
export async function decideAllocation(args: DecideArgs): Promise<DecideResult> {
  const table =
    args.kind === "expense" ? atelierExpenses
    : args.kind === "supplier_invoice" ? atelierPartnerFirmInvoices
    : GL_PROPOSE_TABLES[args.kind];
  const [row] = await db.select().from(table)
    .where(and(eq(table.id, args.id), eq(table.orgId, args.orgId), isNull(table.deletedAt)));
  if (!row) return { ok: false, error: "not_found", message: "Record not found." };
  // "Current" = the proposal baseline: the allocated entity for expenses /
  // supplier invoices, or the pending allocProposedEntityId (falling back to
  // an already-written legalEntityId) for the other GL kinds.
  const current = args.kind === "expense"
    ? (row as typeof atelierExpenses.$inferSelect).entityId
    : args.kind === "supplier_invoice"
      ? (row as typeof atelierPartnerFirmInvoices.$inferSelect).legalEntityId
      : ((row as { legalEntityId: string | null; allocProposedEntityId: string | null }).legalEntityId ??
         (row as { allocProposedEntityId: string | null }).allocProposedEntityId);
  const wanted = args.entityId ?? current;
  if (!wanted) {
    return { ok: false, error: "entity_required", message: "No entity is proposed — pick one to approve." };
  }
  const ctx = await loadAllocationContext(args.orgId);
  const ent = ctx.entities.find((e) => e.id === wanted);
  if (!ent) return { ok: false, error: "entity_not_found", message: "That legal entity is not active." };
  const isOverride = current != null && wanted !== current;
  if (isOverride && !(args.overrideReason ?? "").trim()) {
    return { ok: false, error: "reason_required", message: "Overriding the proposed entity requires a reason." };
  }
  const status: "approved" | "overridden" = isOverride ? "overridden" : "approved";
  const now = new Date();
  const patch = {
    allocStatus: status,
    allocApprovedByUserId: args.actor.id,
    allocApprovedAt: now,
    allocDecidedBy: isOverride ? "human" : (row as { allocDecidedBy: string | null }).allocDecidedBy ?? "human",
    ...(isOverride
      ? {
          allocOverrideReason: args.overrideReason!.trim().slice(0, 1000),
          allocRuleId: "explicit_choice",
          allocJustification: `Overridden by ${args.actor.name}: ${args.overrideReason!.trim().slice(0, 500)}`,
          allocConfidence: 1,
        }
      : {}),
    updatedAt: now,
  };
  if (args.kind === "expense") {
    await db.update(atelierExpenses).set({ ...patch, entityId: wanted })
      .where(eq(atelierExpenses.id, args.id));
  } else if (args.kind === "supplier_invoice") {
    await db.update(atelierPartnerFirmInvoices).set({ ...patch, legalEntityId: wanted })
      .where(eq(atelierPartnerFirmInvoices.id, args.id));
  } else {
    // Approval is the ONLY path that writes legalEntityId for these kinds.
    await db.update(GL_PROPOSE_TABLES[args.kind])
      .set({ ...patch, legalEntityId: wanted, allocProposedEntityId: wanted })
      .where(eq(GL_PROPOSE_TABLES[args.kind].id, args.id));
  }
  await writeAllocationAudit({
    entityType: args.kind === "expense" ? "expense"
      : args.kind === "supplier_invoice" ? "partner_firm_invoice"
      : args.kind,
    entityId: args.id,
    orgId: args.orgId,
    actorId: args.actor.id, actorLabel: args.actor.name,
    action: isOverride ? "allocation.override" : "allocation.approve",
    changes: [
      { field: args.kind === "expense" ? "entityId" : "legalEntityId", from: current, to: wanted },
      { field: "allocStatus", from: (row as { allocStatus: string | null }).allocStatus, to: status },
    ],
    ruleId: isOverride ? "explicit_choice" : (row as { allocRuleId: string | null }).allocRuleId,
    justification: isOverride ? args.overrideReason : (row as { allocJustification: string | null }).allocJustification,
    confidence: isOverride ? 1 : (row as { allocConfidence: number | null }).allocConfidence,
    decidedBy: isOverride ? "human" : (row as { allocDecidedBy: string | null }).allocDecidedBy,
    summary: isOverride
      ? `${args.actor.name} overrode the entity allocation to ${ent.shortName}: ${args.overrideReason}`
      : `${args.actor.name} approved the entity allocation to ${ent.shortName}.`,
  });
  return { ok: true, status, entityId: wanted };
}
