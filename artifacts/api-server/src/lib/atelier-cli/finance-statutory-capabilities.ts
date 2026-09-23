/**
 * Task #1412 — read-only statutory and period-close status.
 *
 * This is intentionally a thin read model.  It does not file returns,
 * recompute provisions, or alter close state.  The role check is repeated in
 * the handler because catalog filtering is not an authorization boundary.
 */
import { and, asc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import {
  db,
  atelierCloseAccrual,
  atelierCloseCycle,
  atelierCloseItem,
  atelierDocumentVersions,
  atelierDocuments,
  atelierGlJournalEntry,
  atelierLegalEntities,
  atelierLegalEntityAliases,
  atelierPeriodCloseLock,
} from "@workspace/db";
import { collectGlVat, monthsOfVatPeriod } from "../atelier-vat201.js";
import { normalizeAlias } from "../legal-entity-document-semantics.js";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import type { ToolResult } from "./index.js";
import type { AtelierRole } from "../../routes/atelier/personaRoles.js";

const FINANCE_ROLES: AtelierRole[] = ["founding_partner", "partner", "finance"];
const FINANCE_ROLE_SET = new Set<string>(FINANCE_ROLES);
const MAX_OPTIONS = 8;

function invalid(message: string): ToolResult {
  return { ok: false, errorCode: "invalid-input", errorMessage: message };
}

export function taxCertificateEvidenceStatus(args: {
  registrationType: string;
  document?: {
    id: string;
    status: string;
    docKind: string | null;
    currentVersionId: string | null;
  };
  liveVersionPointers: ReadonlySet<string>;
}): "missing" | "stale" | "current" {
  const doc = args.document;
  if (!doc) return "missing";
  if (doc.status !== "active" || doc.docKind !== args.registrationType) return "stale";
  if (!doc.currentVersionId || !args.liveVersionPointers.has(`${doc.id}:${doc.currentVersionId}`)) return "stale";
  return "current";
}

async function resolveEntity(orgId: string, query: string) {
  const normalized = normalizeAlias(query);
  const direct = await db.select().from(atelierLegalEntities).where(and(
    eq(atelierLegalEntities.orgId, orgId),
    ne(atelierLegalEntities.status, "archived"),
    or(
      eq(atelierLegalEntities.id, query),
      ilike(atelierLegalEntities.legalNameEn, query),
      ilike(atelierLegalEntities.shortName, query),
      ilike(atelierLegalEntities.legalNameAr, query),
    ),
  )).orderBy(asc(atelierLegalEntities.legalNameEn), asc(atelierLegalEntities.id)).limit(MAX_OPTIONS + 1);
  const aliases = await db.select({ entityId: atelierLegalEntityAliases.entityId })
    .from(atelierLegalEntityAliases).where(and(
    eq(atelierLegalEntityAliases.orgId, orgId),
    eq(atelierLegalEntityAliases.status, "active"),
    eq(atelierLegalEntityAliases.normalizedAlias, normalized),
  )).orderBy(asc(atelierLegalEntityAliases.entityId)).limit(MAX_OPTIONS + 1);
  const aliasEntities = aliases.length ? await db.select().from(atelierLegalEntities).where(and(
    eq(atelierLegalEntities.orgId, orgId),
    ne(atelierLegalEntities.status, "archived"),
    inArray(atelierLegalEntities.id, aliases.map((alias) => alias.entityId)),
  )).orderBy(asc(atelierLegalEntities.legalNameEn), asc(atelierLegalEntities.id)).limit(MAX_OPTIONS + 1) : [];
  const exactMatches = [...new Map([...direct, ...aliasEntities].map((entity) => [entity.id, entity])).values()];
  if (exactMatches.length === 1) return { entity: exactMatches[0]!, options: undefined };
  const fuzzyEntities = exactMatches.length ? [] : await db.select().from(atelierLegalEntities).where(and(
    eq(atelierLegalEntities.orgId, orgId),
    ne(atelierLegalEntities.status, "archived"),
    or(
      ilike(atelierLegalEntities.legalNameEn, `%${query}%`),
      ilike(atelierLegalEntities.shortName, `%${query}%`),
      ilike(atelierLegalEntities.legalNameAr, `%${query}%`),
    ),
  )).orderBy(asc(atelierLegalEntities.legalNameEn), asc(atelierLegalEntities.id)).limit(MAX_OPTIONS);
  const fuzzy = fuzzyEntities
    .map((e) => ({ id: e.id, legalName: e.legalNameEn, shortName: e.shortName }));
  const exactOptions = exactMatches.map((e) => ({ id: e.id, legalName: e.legalNameEn, shortName: e.shortName }));
  const options = [...new Map([...exactOptions, ...fuzzy].map((o) => [o.id, o])).values()]
    .sort((a, b) => a.legalName.localeCompare(b.legalName) || a.id.localeCompare(b.id))
    .slice(0, MAX_OPTIONS);
  return { entity: undefined, options };
}

async function registrationEvidence(orgId: string, entity: typeof atelierLegalEntities.$inferSelect) {
  const regs = (entity.registrations ?? []).filter((r) =>
    r.type === "tax_registration_ct" || r.type === "tax_registration_vat");
  const documentIds = regs.map((r) => r.certificateDocumentId).filter((id): id is string => !!id);
  const docs = documentIds.length ? await db.select().from(atelierDocuments).where(and(
    eq(atelierDocuments.orgId, orgId), eq(atelierDocuments.entityId, entity.id),
    isNull(atelierDocuments.deletedAt),
  )) : [];
  const versionIds = docs.map((d) => d.currentVersionId).filter((id): id is string => !!id);
  const liveVersions = versionIds.length ? await db.select({
    id: atelierDocumentVersions.id,
    documentId: atelierDocumentVersions.documentId,
  })
    .from(atelierDocumentVersions).where(and(
      eq(atelierDocumentVersions.orgId, orgId),
      inArray(atelierDocumentVersions.id, versionIds),
    )) : [];
  const liveVersionPointers = new Set(liveVersions.map((v) => `${v.documentId}:${v.id}`));
  const docById = new Map(docs.map((d) => [d.id, d]));
  return regs.map((r) => {
    const doc = r.certificateDocumentId ? docById.get(r.certificateDocumentId) : undefined;
    return {
      concept: r.type === "tax_registration_ct" ? "ct_registration" : "vat_registration",
      type: r.type, number: r.number, issuer: r.issuer,
      issuedOn: r.issuedOn, expiresOn: r.expiresOn, notes: r.notes ?? null,
      certificateDocumentId: r.certificateDocumentId ?? null,
      certificate: r.certificateDocumentId ? {
        status: taxCertificateEvidenceStatus({
          registrationType: r.type,
          document: doc,
          liveVersionPointers,
        }),
        documentStatus: doc?.status ?? null,
        currentVersionId: doc?.currentVersionId ?? null,
      } : null,
    };
  });
}

defineCapability({
  id: "ledger.finance_statutory_close_status",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "finance",
  toolName: "finance_statutory_close_status",
  description: "Read CT/VAT registrations, VAT settlement evidence, and close status for a live legal entity.",
  slashAliases: { en: ["/statutory-close", "/tax-close-status"] },
  inputSchema: {
    type: "object",
    required: ["entity"],
    properties: {
      entity: { type: "string", description: "Legal entity id, canonical name, short name, or approved alias." },
      period: { type: "string", description: "Optional YYYY-MM or YYYY-Qn period." },
    },
    additionalProperties: false,
  },
  isWrite: false, irreversible: false, requiredRoles: FINANCE_ROLES,
  surfaceOn: ["ledger", "home", "global"], twoPhaseConfirm: false,
  outboundChannel: null, resultCard: "entity_card", promoteAsSuggestion: false,
  examplePhrases: { en: ["Show the statutory close status for our Dubai entity", "Is VAT filed for Acme in 2026-Q1?"] },
  async run(input, ctx) {
    if (!FINANCE_ROLE_SET.has(ctx.persona.role)) {
      return { ok: false, errorCode: "forbidden", errorMessage: "Only founding partners, partners, and finance can read statutory close status." };
    }
    const query = typeof input.entity === "string" ? input.entity.trim() : "";
    if (!query) return invalid("Provide a legal entity id, name, or approved alias.");
    const period = input.period === undefined ? undefined : typeof input.period === "string" ? input.period : "";
    if (period !== undefined && !monthsOfVatPeriod(period)) return invalid("period must be YYYY-MM or YYYY-Qn.");
    const resolved = await resolveEntity(ctx.persona.orgId, query);
    if (!resolved.entity) {
      if (resolved.options?.length) return { ok: true, data: { prompt: "Choose a legal entity.", options: resolved.options }, disambiguation: { kind: "legal_entity", field: "entity", options: resolved.options } };
      return { ok: false, errorCode: "not-found", errorMessage: "No live legal entity matched that id, name, or approved alias." };
    }
    const entity = resolved.entity;
    const months = period ? monthsOfVatPeriod(period)! : undefined;
    const registrations = await registrationEvidence(ctx.persona.orgId, entity);
    const data: Record<string, unknown> = {
      identity: { kind: "legal_entity", id: entity.id, legalName: entity.legalNameEn, shortName: entity.shortName, country: entity.country, status: entity.status },
      registrations,
      fiscal: entity.fiscal ?? null,
    };
    if (period && months) {
      const vat = await collectGlVat(ctx.persona.orgId, entity.id, months);
      const vatEntries = await db.select().from(atelierGlJournalEntry).where(and(
        eq(atelierGlJournalEntry.orgId, ctx.persona.orgId), eq(atelierGlJournalEntry.legalEntityId, entity.id),
        eq(atelierGlJournalEntry.sourceKind, "vat_return"), isNull(atelierGlJournalEntry.deletedAt),
      ));
      // Filing creates one settlement journal keyed by the requested label:
      // quarters are not three independently-filed months.
      const filed = vatEntries.some((e) => e.sourceRef === `${entity.id}:${period}`);
      const cycle = await db.select().from(atelierCloseCycle).where(and(
        eq(atelierCloseCycle.orgId, ctx.persona.orgId), eq(atelierCloseCycle.entityId, entity.id),
        eq(atelierCloseCycle.periodLabel, period), isNull(atelierCloseCycle.deletedAt),
      )).limit(1);
      const c = cycle[0];
      const items = c ? await db.select().from(atelierCloseItem).where(and(eq(atelierCloseItem.orgId, ctx.persona.orgId), eq(atelierCloseItem.cycleId, c.id), isNull(atelierCloseItem.deletedAt))).orderBy(asc(atelierCloseItem.sortOrder)).limit(100) : [];
      const lock = await db.select().from(atelierPeriodCloseLock).where(and(eq(atelierPeriodCloseLock.orgId, ctx.persona.orgId), eq(atelierPeriodCloseLock.periodLabel, period), isNull(atelierPeriodCloseLock.deletedAt))).limit(1);
      const accrual = c ? await db.select().from(atelierCloseAccrual).where(and(eq(atelierCloseAccrual.orgId, ctx.persona.orgId), eq(atelierCloseAccrual.entityId, entity.id), eq(atelierCloseAccrual.cycleId, c.id), eq(atelierCloseAccrual.sourceKey, "ct_provision"), isNull(atelierCloseAccrual.deletedAt))).limit(1) : [];
      const currencies = new Map<string, { output: number; input: number }>();
      for (const line of vat.lines) { const b = currencies.get(line.currency) ?? { output: 0, input: 0 }; if (line.accountCode === "2300") b.output += line.credit - line.debit; else b.input += line.debit - line.credit; currencies.set(line.currency, b); }
      data.period = { label: period, months, vat: { filed, filedSourceRef: filed ? `${entity.id}:${period}` : null, lines: vat.lines.slice(0, 100), lineLimit: 100, byCurrency: Object.fromEntries(currencies) }, close: { cycle: c ? { id: c.id, periodType: c.periodType, status: c.status, signedOffAt: c.signedOffAt } : null, items: items.map((i) => ({ id: i.id, phase: i.phase, itemKey: i.itemKey, title: i.title, status: i.status, note: i.note, detail: i.detail })), lock: lock[0] ? { id: lock[0].id, lockedAt: lock[0].lockedAt, lockedModules: lock[0].lockedModules } : null, ctProvision: accrual[0] ? { id: accrual[0].id, status: accrual[0].status, amount: accrual[0].amount, currency: accrual[0].currency, journalEntryId: accrual[0].journalEntryId, decidedAt: accrual[0].decidedAt, decisionNote: accrual[0].decisionNote } : null } };
    }
    return { ok: true, data };
  },
});