/**
 * Atelier — Legal-entity registry (Task #249; replaces the Task #372
 * empty scaffold).
 *
 * Persistent CRUD over atelier_legal_entities plus an AI extraction
 * endpoint that turns a vault document (DET licenses, MoA, Ejari,
 * establishment cards — bilingual Arabic/English) into proposed entity
 * fields for human review. Nothing is written to an entity without an
 * explicit apply through POST/PATCH.
 *
 * Gating mirrors the finance surfaces: recruiter denied everywhere;
 * writes (create/update/archive/extract) require partner or
 * founding partner.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierDocuments,
  atelierAuditEvents,
  atelierBankAccount,
} from "@workspace/db";
import { isFoundingPartner, isPartner } from "./personaRoles";
import { loadDocBytes, DOC_KINDS } from "../../lib/atelier-documents.js";
import { extractAttachment } from "../../lib/atelier-cli/attachments/extractors.js";
import { extractFirstJsonObject } from "../../lib/atelier-agents/runner.js";
import { extractBankLetterFields } from "../../lib/atelier-finance-docs.js";
// Task #655 — auto-attach statutory payroll filings on entity create.
import { ensureStatutoryFilings } from "../../lib/atelier-payroll/payrollRun.js";
// Task #1092 — ownership type → recommended settlement treatment.
import { recommendedTreatment } from "../../lib/atelier-preformation.js";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;
type EntityRow = typeof atelierLegalEntities.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

function denyRecruiter(me: Me, res: Response): boolean {
  if (me.role === "recruiter") {
    res.status(403).json({
      error: "recruiter-scope",
      message: "Recruiter persona may only access /studio surfaces.",
    });
    return true;
  }
  return false;
}

function requireEntityWriter(me: Me, res: Response): boolean {
  if (isFoundingPartner(me.role) || isPartner(me.role)) return true;
  res.status(403).json({
    error: "forbidden",
    message: "Only partners can modify the legal-entity registry.",
  });
  return false;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function auditEntity(args: {
  entityId: string;
  actor: Me;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "atelier_legal_entity",
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const str = (max: number) => z.string().trim().max(max);
const optStr = (max: number) => str(max).nullish();

const registrationSchema = z.object({
  id: str(60).optional(),
  type: str(60).default("other"),
  label: str(200),
  number: str(120),
  issuer: optStr(300),
  issuedOn: optStr(20),
  expiresOn: optStr(20),
  notes: optStr(600),
  certificateDocumentId: optStr(80),
});

const activitySchema = z.object({
  code: str(40),
  nameEn: str(300),
  nameAr: optStr(300),
  status: optStr(60),
});

const ownerSchema = z.object({
  name: str(200),
  nameAr: optStr(200),
  roles: z.array(str(60)).max(10).default([]),
  sharePct: z.number().min(0).max(100).nullish(),
  nationality: optStr(120),
  passportNo: optStr(60),
  personNo: optStr(60),
  userId: optStr(80),
});

const premisesSchema = z.object({
  addressLine: optStr(400),
  building: optStr(200),
  unit: optStr(80),
  area: optStr(120),
  city: optStr(120),
  plotNumber: optStr(60),
  makaniNo: optStr(60),
  sizeSqm: z.number().min(0).nullish(),
  usage: optStr(120),
});

const leaseSchema = z.object({
  contractNo: optStr(80),
  ejariTenantNo: optStr(80),
  lessorName: optStr(300),
  lessorLicenseNo: optStr(80),
  ownerName: optStr(300),
  startDate: optStr(20),
  endDate: optStr(20),
  annualRentAed: z.number().min(0).nullish(),
  securityDepositAed: z.number().min(0).nullish(),
  areaSqm: z.number().min(0).nullish(),
  registrationFeesAed: z.number().min(0).nullish(),
  notes: optStr(600),
});

// Task #271 — fiscal calendar (VAT / corporate-tax filings), entered by
// finance leadership. Dates YYYY-MM-DD; amounts in entity base currency.
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a valid calendar date");

const fiscalSchema = z.object({
  vatPeriod: z.enum(["monthly", "quarterly"]).nullish(),
  nextVatFilingDate: isoDate.nullish(),
  vatExpectedAmount: z.number().min(0).nullish(),
  nextCtFilingDate: isoDate.nullish(),
  ctExpectedAmount: z.number().min(0).nullish(),
  // Task #542 — corporate-tax registration facts from the FTA certificate:
  // tax-year basis (e.g. "January – December") and the first CT period
  // bounds. Informational for the fiscal calendar; the cash forecast keys
  // off nextCtFilingDate/ctExpectedAmount unchanged.
  ctTaxYearBasis: optStr(60),
  ctFirstPeriodStart: isoDate.nullish(),
  ctFirstPeriodEnd: isoDate.nullish(),
  // Task #654 — CT rate (%) used by the close CT-provision computation.
  ctRatePct: z.number().min(0).max(100).nullish(),
});

// Task #272 — per-entity cash policy (opening balance, min-cash floor,
// optional covenant floor), amounts in the entity's base currency. Feeds
// the 13-week cash forecast breach warnings.
const cashPolicySchema = z.object({
  openingBalance: z.number().finite().nullish(),
  openingBalanceAsOf: optStr(20),
  minCashPolicy: z.number().finite().min(0).nullish(),
  covenantFloor: z.number().finite().min(0).nullish(),
  notes: optStr(600),
});

// Task #655 — per-entity statutory-payroll overrides (country rules live
// in code; this jsonb only carries the genuinely entity-specific knobs).
const statutorySchema = z.object({
  freeZoneRegime: optStr(120),
  optOut: z.array(z.string().trim().min(1).max(80)).max(20).nullish(),
  employerPctOverride: z.record(z.string(), z.number().finite().min(0).max(100)).nullish(),
  employeePctOverride: z.record(z.string(), z.number().finite().min(0).max(100)).nullish(),
  ceilingOverride: z.record(z.string(), z.number().finite().min(0)).nullish(),
  eosbCapPerYearOverride: z.number().finite().min(0).nullish(),
  // Task #1136 — WPS employer config for the SIF export (see EntityStatutory).
  wps: z
    .object({
      applicable: z.boolean().nullish(),
      employerUniqueId: z
        .string()
        .trim()
        .regex(/^\d{13}$/, "13-digit MOHRE Employer Unique ID")
        .nullish(),
      agentBankRoutingCode: z
        .string()
        .trim()
        .regex(/^\d{9}$/, "9-digit agent-bank routing code")
        .nullish(),
    })
    .nullish(),
  notes: optStr(2000),
});

const formationSchema = z.object({
  ownershipType: z.enum(["cognirise_uae", "jv", "founder_partner", "franchise"]).nullish(),
  jvSplits: z
    .array(z.object({
      partnerName: str(200).min(1),
      sharePct: z.number().finite().min(0).max(100),
    }))
    .max(20)
    .nullish(),
  notes: optStr(2000),
});

const entityBody = z.object({
  legalNameEn: str(400).min(1),
  legalNameAr: optStr(400),
  shortName: str(120).default(""),
  legalForm: str(200).default(""),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "ISO-3166 alpha-2 code required"),
  jurisdiction: str(300).default(""),
  status: z.enum(["planned", "active", "in_formation", "dormant", "winding_down"]).default("active"),
  incorporationDate: optStr(20),
  durationYears: z.number().int().min(0).max(1000).nullish(),
  baseCurrency: str(10).default(""),
  registeredAddress: str(600).default(""),
  officeAddress: str(600).default(""),
  governingLaw: str(600).default(""),
  courts: str(600).default(""),
  registrations: z.array(registrationSchema).max(50).default([]),
  activities: z.array(activitySchema).max(100).default([]),
  owners: z.array(ownerSchema).max(50).default([]),
  premises: premisesSchema.nullish(),
  lease: leaseSchema.nullish(),
  fiscal: fiscalSchema.nullish(),
  cashPolicy: cashPolicySchema.nullish(),
  statutory: statutorySchema.nullish(),
  /** Task #1095 — head/default entity for firm-wide cost allocation. */
  isHeadEntity: z.boolean().optional(),
  formation: formationSchema.nullish(),
  notes: optStr(4000),
});

type EntityBody = z.infer<typeof entityBody>;

function normalizeRegistrations(regs: EntityBody["registrations"]) {
  return regs.map((r) => ({
    id: r.id && r.id.trim() ? r.id : rid("reg"),
    type: r.type || "other",
    label: r.label,
    number: r.number,
    issuer: r.issuer ?? null,
    issuedOn: r.issuedOn ?? null,
    expiresOn: r.expiresOn ?? null,
    notes: r.notes ?? null,
    certificateDocumentId: r.certificateDocumentId ?? null,
  }));
}

const TAX_REGISTRATION_KINDS = {
  tax_registration_ct: "Corporate Tax",
  tax_registration_vat: "VAT",
} as const;

async function validateTaxRegistrations(args: {
  orgId: string;
  entityId: string;
  registrations: ReturnType<typeof normalizeRegistrations>;
  requireCorporateTax: boolean;
}): Promise<
  | { ok: true; documents: Array<typeof atelierDocuments.$inferSelect> }
  | { ok: false; error: string; message: string }
> {
  const byType = new Map(args.registrations.map((r) => [r.type, r]));
  const ct = byType.get("tax_registration_ct");
  if (args.requireCorporateTax && !ct?.number) {
    return { ok: false, error: "corporate-tax-number-required", message: "Corporate Tax number is required for an active legal entity." };
  }
  if (args.requireCorporateTax && !ct?.certificateDocumentId) {
    return { ok: false, error: "corporate-tax-certificate-required", message: "Corporate Tax certificate is required for an active legal entity." };
  }
  for (const [type, label] of Object.entries(TAX_REGISTRATION_KINDS)) {
    const reg = byType.get(type);
    const hasNumber = !!reg?.number;
    const hasCertificate = !!reg?.certificateDocumentId;
    if (hasNumber !== hasCertificate) {
      return {
        ok: false,
        error: `${type}-pair-incomplete`,
        message: `${label} number and certificate must be provided together.`,
      };
    }
  }
  const ids = args.registrations
    .map((r) => r.certificateDocumentId)
    .filter((id): id is string => !!id);
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: "duplicate-tax-certificate", message: "Corporate Tax and VAT must use different certificate documents." };
  }
  if (ids.length === 0) return { ok: true, documents: [] };
  const documents = await db.select().from(atelierDocuments).where(and(
    eq(atelierDocuments.orgId, args.orgId),
    inArray(atelierDocuments.id, ids),
    eq(atelierDocuments.status, "active"),
  ));
  if (documents.length !== ids.length) {
    return { ok: false, error: "tax-certificate-not-found", message: "A selected tax certificate is missing or unavailable." };
  }
  if (documents.some((document) => document.entityId && document.entityId !== args.entityId)) {
    return {
      ok: false,
      error: "tax-certificate-already-linked",
      message: "A selected tax certificate belongs to another legal entity.",
    };
  }
  return { ok: true, documents };
}

function taxRegistrationSignature(registrations: ReturnType<typeof normalizeRegistrations>): string {
  return JSON.stringify(
    registrations
      .filter((registration) => registration.type === "tax_registration_ct" || registration.type === "tax_registration_vat")
      .map((registration) => ({
        ...registration,
        certificateDocumentId: registration.certificateDocumentId ?? null,
      }))
      .sort((a, b) => a.type.localeCompare(b.type)),
  );
}

async function linkTaxCertificates(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  entityId: string,
  registrations: ReturnType<typeof normalizeRegistrations>,
): Promise<void> {
  for (const [type] of Object.entries(TAX_REGISTRATION_KINDS)) {
    const docId = registrations.find((r) => r.type === type)?.certificateDocumentId;
    if (!docId) continue;
    const claimed = await tx.update(atelierDocuments).set({
      entityId,
      category: "corporate_legal",
      docKind: type,
      updatedAt: new Date(),
    }).where(and(
      eq(atelierDocuments.id, docId),
      eq(atelierDocuments.orgId, orgId),
      eq(atelierDocuments.status, "active"),
      or(isNull(atelierDocuments.entityId), eq(atelierDocuments.entityId, entityId)),
    )).returning({ id: atelierDocuments.id });
    if (claimed.length !== 1) throw new TaxCertificateClaimError();
  }
}

class TaxCertificateClaimError extends Error {
  constructor() {
    super("A selected tax certificate was linked to another legal entity before this save completed.");
  }
}

function normalizeOwners(owners: EntityBody["owners"]) {
  return owners.map((o) => ({
    name: o.name,
    nameAr: o.nameAr ?? null,
    roles: o.roles ?? [],
    sharePct: o.sharePct ?? null,
    nationality: o.nationality ?? null,
    passportNo: o.passportNo ?? null,
    personNo: o.personNo ?? null,
    userId: o.userId ?? null,
  }));
}

function normalizeActivities(acts: EntityBody["activities"]) {
  return acts.map((a) => ({
    code: a.code,
    nameEn: a.nameEn,
    nameAr: a.nameAr ?? null,
    status: a.status ?? null,
  }));
}

function normalizeFiscal(f: z.infer<typeof fiscalSchema> | null | undefined) {
  if (!f) return null;
  const out = {
    vatPeriod: f.vatPeriod ?? null,
    nextVatFilingDate: f.nextVatFilingDate ?? null,
    vatExpectedAmount: f.vatExpectedAmount ?? null,
    nextCtFilingDate: f.nextCtFilingDate ?? null,
    ctExpectedAmount: f.ctExpectedAmount ?? null,
    ctTaxYearBasis: f.ctTaxYearBasis ?? null,
    ctFirstPeriodStart: f.ctFirstPeriodStart ?? null,
    ctFirstPeriodEnd: f.ctFirstPeriodEnd ?? null,
    ctRatePct: f.ctRatePct ?? null,
  };
  const hasValue = Object.values(out).some((v) => v !== null && v !== "");
  return hasValue ? out : null;
}

function normalizeCashPolicy(p: z.infer<typeof cashPolicySchema> | null | undefined) {
  if (!p) return null;
  const shaped = {
    openingBalance: p.openingBalance ?? null,
    openingBalanceAsOf: p.openingBalanceAsOf ?? null,
    minCashPolicy: p.minCashPolicy ?? null,
    covenantFloor: p.covenantFloor ?? null,
    notes: p.notes ?? null,
  };
  const hasValue = Object.values(shaped).some((v) => v !== null);
  return hasValue ? shaped : null;
}

function normalizeStatutory(s: z.infer<typeof statutorySchema> | null | undefined) {
  if (!s) return null;
  const shaped = {
    freeZoneRegime: s.freeZoneRegime ?? null,
    optOut: s.optOut && s.optOut.length > 0 ? s.optOut : null,
    employerPctOverride: s.employerPctOverride && Object.keys(s.employerPctOverride).length > 0 ? s.employerPctOverride : null,
    employeePctOverride: s.employeePctOverride && Object.keys(s.employeePctOverride).length > 0 ? s.employeePctOverride : null,
    ceilingOverride: s.ceilingOverride && Object.keys(s.ceilingOverride).length > 0 ? s.ceilingOverride : null,
    eosbCapPerYearOverride: s.eosbCapPerYearOverride ?? null,
    wps:
      s.wps && (s.wps.applicable != null || s.wps.employerUniqueId || s.wps.agentBankRoutingCode)
        ? {
            applicable: s.wps.applicable ?? null,
            employerUniqueId: s.wps.employerUniqueId ?? null,
            agentBankRoutingCode: s.wps.agentBankRoutingCode ?? null,
          }
        : null,
    notes: s.notes ?? null,
  };
  const hasValue = Object.values(shaped).some((v) => v !== null);
  return hasValue ? shaped : null;
}

/**
 * Task #1092 — normalize the formation payload, always preserving the
 * existing settlement stamp (clients can never write or clear it).
 */
function normalizeFormation(
  f: z.infer<typeof formationSchema> | null | undefined,
  existingSettlement: NonNullable<EntityRow["formation"]>["settlement"] | null,
) {
  if (!f) {
    return existingSettlement ? { ownershipType: null, jvSplits: null, notes: null, settlement: existingSettlement } : null;
  }
  const shaped = {
    ownershipType: f.ownershipType ?? null,
    jvSplits: f.jvSplits && f.jvSplits.length > 0
      ? f.jvSplits.map((s) => ({ partnerName: s.partnerName, sharePct: s.sharePct }))
      : null,
    notes: f.notes ?? null,
    settlement: existingSettlement ?? null,
  };
  const hasValue = shaped.ownershipType !== null || shaped.jvSplits !== null || shaped.notes !== null || shaped.settlement !== null;
  return hasValue ? shaped : null;
}

function nullishObj<T extends Record<string, unknown>>(o: T | null | undefined): T | null {
  if (!o) return null;
  const hasValue = Object.values(o).some((v) => v !== null && v !== undefined && v !== "");
  return hasValue ? o : null;
}

function entityShape(e: EntityRow) {
  return {
    id: e.id,
    legalNameEn: e.legalNameEn,
    legalNameAr: e.legalNameAr,
    shortName: e.shortName,
    legalForm: e.legalForm,
    country: e.country,
    jurisdiction: e.jurisdiction,
    status: e.status,
    incorporationDate: e.incorporationDate,
    durationYears: e.durationYears,
    baseCurrency: e.baseCurrency,
    registeredAddress: e.registeredAddress,
    officeAddress: e.officeAddress,
    governingLaw: e.governingLaw,
    courts: e.courts,
    registrations: e.registrations ?? [],
    activities: e.activities ?? [],
    owners: e.owners ?? [],
    premises: e.premises ?? null,
    lease: e.lease ?? null,
    fiscal: e.fiscal ?? null,
    cashPolicy: e.cashPolicy ?? null,
    statutory: e.statutory ?? null,
    isHeadEntity: e.isHeadEntity ?? false,
    formation: e.formation ?? null,
    // Task #1092 — ownership type drives the recommended settlement.
    recommendedTreatment: recommendedTreatment(e.formation?.ownershipType ?? null),
    notes: e.notes,
    archivedAt: e.archivedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

async function loadEntity(orgId: string, id: string): Promise<EntityRow | null> {
  const [row] = await db
    .select()
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, id), eq(atelierLegalEntities.orgId, orgId)));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Registry read model for the finance plan/report modules. Replaces the old
// ENTITIES_SEED compat export: entity lists now come from the persisted
// atelier_legal_entities registry (org-scoped, archived rows excluded).
// ---------------------------------------------------------------------------
export interface FinanceEntityFiscal {
  vatPeriod: string | null;
  nextVatFilingDate: string | null;
  vatExpectedAmount: number | null;
  nextCtFilingDate: string | null;
  ctExpectedAmount: number | null;
  ctTaxYearBasis?: string | null;
  ctFirstPeriodStart?: string | null;
  ctFirstPeriodEnd?: string | null;
}

export interface FinanceEntityInfo {
  id: string;
  shortName: string;
  baseCurrency: string;
  country: string;
  fiscal: FinanceEntityFiscal | null;
  /** Task #272 — cash policy amounts in the entity's base currency. */
  cashPolicy: {
    openingBalance: number | null;
    openingBalanceAsOf: string | null;
    minCashPolicy: number | null;
    covenantFloor: number | null;
  } | null;
}

export async function listFinanceEntities(orgId: string): Promise<FinanceEntityInfo[]> {
  const rows = await db
    .select()
    .from(atelierLegalEntities)
    .where(eq(atelierLegalEntities.orgId, orgId))
    .orderBy(desc(atelierLegalEntities.createdAt));
  return rows
    .filter((r) => r.status !== "archived")
    .map((r) => ({
      id: r.id,
      shortName: r.shortName || r.legalNameEn,
      baseCurrency: r.baseCurrency || "USD",
      country: r.country,
      fiscal: r.fiscal ?? null,
      cashPolicy: r.cashPolicy
        ? {
            openingBalance: r.cashPolicy.openingBalance ?? null,
            openingBalanceAsOf: r.cashPolicy.openingBalanceAsOf ?? null,
            minCashPolicy: r.cashPolicy.minCashPolicy ?? null,
            covenantFloor: r.cashPolicy.covenantFloor ?? null,
          }
        : null,
    }));
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/entities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  const includeArchived = req.query.includeArchived === "true";
  const rows = await db
    .select()
    .from(atelierLegalEntities)
    .where(eq(atelierLegalEntities.orgId, me.orgId))
    .orderBy(desc(atelierLegalEntities.createdAt));
  const items = rows.filter((r) => includeArchived || r.status !== "archived");
  res.json({ items: items.map(entityShape) });
});

/**
 * Task #264 — upcoming registry expiries (registrations + lease end dates)
 * across non-archived entities, for the Finance Home compliance calendar,
 * the "Next action" inbox and the Comply deadlines surfaces. Window is
 * configurable via ?windowDays (default 90, clamped 1–365); already-expired
 * items within the last 30 days stay visible so a missed renewal cannot
 * silently vanish.
 *
 * NOTE: must stay registered BEFORE /finance/entities/:id or "expiries"
 * would be captured as an entity id.
 */
export interface EntityExpiryItem {
  id: string;
  entityId: string;
  entityShortName: string;
  kind: "registration" | "lease";
  registrationType: string | null;
  label: string;
  number: string | null;
  issuer: string | null;
  expiresOn: string;
  daysOut: number;
  severity: "overdue" | "critical" | "upcoming";
}

/**
 * Task #406 — shared expiry computation, used by the REST route below and
 * the chat/CLI `finance_entity_expiries` capability. Caller enforces the
 * persona gate (recruiter / self-scope refusals).
 */
export async function listEntityExpiries(
  orgId: string,
  windowDaysRaw?: number,
): Promise<{ windowDays: number; items: EntityExpiryItem[] }> {
  const windowDays = Number.isFinite(windowDaysRaw)
    ? Math.min(365, Math.max(1, Math.round(windowDaysRaw as number)))
    : 90;
  const dayMs = 86_400_000;
  const now = Date.now();
  const rows = await db
    .select()
    .from(atelierLegalEntities)
    .where(eq(atelierLegalEntities.orgId, orgId));
  const items: EntityExpiryItem[] = [];
  for (const e of rows) {
    if (e.status === "archived" || e.archivedAt) continue;
    const shortName = e.shortName || e.legalNameEn;
    const push = (
      id: string,
      kind: "registration" | "lease",
      registrationType: string | null,
      label: string,
      number: string | null,
      issuer: string | null,
      expiresOn: string,
    ) => {
      const t = new Date(expiresOn).getTime();
      if (!Number.isFinite(t)) return;
      const daysOut = Math.round((t - now) / dayMs);
      if (daysOut > windowDays || daysOut < -30) return;
      items.push({
        id,
        entityId: e.id,
        entityShortName: shortName,
        kind,
        registrationType,
        label,
        number,
        issuer,
        expiresOn,
        daysOut,
        severity: daysOut < 0 ? "overdue" : daysOut <= 30 ? "critical" : "upcoming",
      });
    };
    for (const r of e.registrations ?? []) {
      if (!r.expiresOn) continue;
      push(
        `reg-${e.id}-${r.id}`,
        "registration",
        r.type ?? "other",
        r.label || r.type || "Registration",
        r.number ?? null,
        r.issuer ?? null,
        r.expiresOn,
      );
    }
    if (e.lease?.endDate) {
      const leaseLabel = e.lease.ejariTenantNo
        ? "Ejari lease end"
        : "Lease end";
      push(
        `lease-${e.id}`,
        "lease",
        null,
        leaseLabel,
        e.lease.contractNo ?? null,
        e.lease.lessorName ?? null,
        e.lease.endDate,
      );
    }
  }
  items.sort((a, b) => a.daysOut - b.daysOut);
  return { windowDays, items };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/entities/expiries", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  const out = await listEntityExpiries(me.orgId, Number(req.query.windowDays));
  res.json(out);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/entities/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  const row = await loadEntity(me.orgId, String(req.params.id ?? ""));
  if (!row) { res.status(404).json({ error: "not-found" }); return; }
  const docs = await db
    .select()
    .from(atelierDocuments)
    .where(
      and(
        eq(atelierDocuments.orgId, me.orgId),
        eq(atelierDocuments.entityId, row.id),
        eq(atelierDocuments.status, "active"),
      ),
    )
    .orderBy(desc(atelierDocuments.createdAt));
  // Task #287 — surface file name/mime so the entity page can open the
  // file directly via /documents/:id/download.
  const versionIds = docs
    .map((d) => d.currentVersionId)
    .filter((v): v is string => !!v);
  const { atelierDocumentVersions } = await import("@workspace/db");
  const versions = versionIds.length
    ? await db
        .select({
          id: atelierDocumentVersions.id,
          fileName: atelierDocumentVersions.fileName,
          mime: atelierDocumentVersions.mime,
        })
        .from(atelierDocumentVersions)
        .where(inArray(atelierDocumentVersions.id, versionIds))
    : [];
  const versionById = new Map(versions.map((v) => [v.id, v]));
  // Task #287 — display-time classification fallback: documents linked before
  // the classification model existed (docKind null) get a kind inferred from
  // title/filename so they tier correctly without manual work. This read path
  // is deliberately side-effect free (no DB write — GETs stay read-only for
  // every persona); persisted kinds come from partner-gated uploads/overrides
  // and the AI-extraction flow, which always win because we only fill nulls.
  const kindBackfill = new Map<string, string>();
  for (const d of docs) {
    if (d.docKind) continue;
    const v = d.currentVersionId ? versionById.get(d.currentVersionId) : null;
    const inferred = inferDocKindFromTitle(d.title, v?.fileName ?? null);
    if (inferred) kindBackfill.set(d.id, inferred);
  }
  // Task #1065 — the entity's bank accounts ride along on the detail
  // response. IBANs/holder names are firm banking credentials, so they are
  // limited to finance leadership (founding partner / partner / finance);
  // everyone else gets an empty list rather than IBANs.
  const canSeeBank =
    isFoundingPartner(me.role) || isPartner(me.role) || me.role === "finance";
  const bankAccounts = canSeeBank
    ? await db
        .select()
        .from(atelierBankAccount)
        .where(
          and(
            eq(atelierBankAccount.orgId, me.orgId),
            eq(atelierBankAccount.legalEntityId, row.id),
            isNull(atelierBankAccount.deletedAt),
          ),
        )
        .orderBy(desc(atelierBankAccount.createdAt))
    : [];
  res.json({
    entity: entityShape(row),
    bankAccounts: bankAccounts.map((a) => ({
      id: a.id,
      bankName: a.bankName,
      accountLabel: a.accountLabel,
      accountNumberLast4: a.accountNumberLast4,
      currency: a.currency,
      iban: a.iban,
      swift: a.swift,
      accountHolderName: a.accountHolderName,
      purpose: a.purpose,
      isActive: a.isActive,
      createdAt: a.createdAt,
    })),
    documents: docs.map((d) => {
      const v = d.currentVersionId ? versionById.get(d.currentVersionId) : null;
      return {
        id: d.id,
        title: d.title,
        category: d.category,
        docKind: d.docKind ?? kindBackfill.get(d.id) ?? null,
        aiRetrieval: d.aiRetrieval,
        fileName: v?.fileName ?? null,
        mime: v?.mime ?? null,
        createdAt: d.createdAt,
      };
    }),
  });
});

/**
 * Task #287 — conservative title/filename → legal-doc-kind inference used to
 * backfill classification for documents linked before docKind existed. Only
 * unambiguous phrases match; everything else stays unclassified (visible in
 * the UI's Unclassified group with the manual override as the fix path).
 */
function inferDocKindFromTitle(title: string, fileName: string | null): string | null {
  const t = `${title} ${fileName ?? ""}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/trade licen[cs]e/.test(t)) return "trade_license";
  if (/establishment card/.test(t)) return "establishment_card";
  if (/ejari/.test(t)) return "ejari_tenancy";
  if (/memorandum of association|\bmoa\b/.test(t)) return "memorandum_of_association";
  if (/initial approval/.test(t)) return "initial_approval";
  if (/follow ?up|payment receipt|\breceipt\b/.test(t)) return "follow_up_receipt";
  if (/commercial regist/.test(t)) return "commercial_register";
  if (/chamber/.test(t)) return "chamber_membership";
  if (/corporate tax|corporate.*trn|\bct certificate/.test(t)) return "tax_registration_ct";
  if (/vat certificate|vat registration|vat.*trn/.test(t)) return "tax_registration_vat";
  if (/tax registration|\btrn\b/.test(t)) return "tax_registration";
  return null;
}

// @cli-skip: partner-gated registry write; covered by REST tests
router.post("/finance/entities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!requireEntityWriter(me, res)) return;
  const parsed = entityBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  const id = rid("lent");
  const registrations = normalizeRegistrations(b.registrations);
  const taxValidation = await validateTaxRegistrations({
    orgId: me.orgId,
    entityId: id,
    registrations,
    requireCorporateTax: b.status === "active",
  });
  if (!taxValidation.ok) {
    res.status(400).json({ error: taxValidation.error, message: taxValidation.message });
    return;
  }
  let row: EntityRow;
  try {
    row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(atelierLegalEntities).values({
      id,
      orgId: me.orgId,
      legalNameEn: b.legalNameEn,
      legalNameAr: b.legalNameAr ?? null,
      shortName: b.shortName,
      legalForm: b.legalForm,
      country: b.country,
      jurisdiction: b.jurisdiction,
      status: b.status,
      incorporationDate: b.incorporationDate ?? null,
      durationYears: b.durationYears ?? null,
      baseCurrency: b.baseCurrency,
      registeredAddress: b.registeredAddress,
      officeAddress: b.officeAddress,
      governingLaw: b.governingLaw,
      courts: b.courts,
      registrations,
      activities: normalizeActivities(b.activities),
      owners: normalizeOwners(b.owners),
      premises: nullishObj(b.premises ?? null) as EntityRow["premises"],
      lease: nullishObj(b.lease ?? null) as EntityRow["lease"],
      fiscal: normalizeFiscal(b.fiscal),
      cashPolicy: normalizeCashPolicy(b.cashPolicy),
      statutory: normalizeStatutory(b.statutory),
      isHeadEntity: b.isHeadEntity ?? false,
      notes: b.notes ?? null,
      }).returning();
      await linkTaxCertificates(tx, me.orgId, id, registrations);
      return created;
    });
  } catch (error) {
    if (error instanceof TaxCertificateClaimError) {
      res.status(409).json({ error: "tax-certificate-already-linked", message: error.message });
      return;
    }
    throw error;
  }
  if (b.isHeadEntity === true) {
    // At most one head entity per org — the newest flag wins.
    await db.update(atelierLegalEntities)
      .set({ isHeadEntity: false, updatedAt: new Date() })
      .where(and(
        eq(atelierLegalEntities.orgId, me.orgId),
        eq(atelierLegalEntities.isHeadEntity, true),
        ne(atelierLegalEntities.id, id)));
  }
  await auditEntity({
    entityId: id,
    actor: me,
    action: "legal_entity.create",
    payload: { legalNameEn: b.legalNameEn, country: b.country },
    summary: `Created legal entity "${b.legalNameEn}" (${b.country})`,
  });
  // Task #655 — auto-attach the country's statutory payroll filing
  // calendar (WPS / GOSI / GPSSA / GRSIA / MUHSGK) for covered countries.
  await ensureStatutoryFilings(me.orgId, row);
  res.status(201).json({ entity: entityShape(row) });
});

// @cli-skip: partner-gated registry write; covered by REST tests
router.patch("/finance/entities/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!requireEntityWriter(me, res)) return;
  const existing = await loadEntity(me.orgId, String(req.params.id ?? ""));
  if (!existing) { res.status(404).json({ error: "not-found" }); return; }
  if (existing.status === "archived") {
    res.status(409).json({ error: "entity-archived" });
    return;
  }
  const parsed = entityBody.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  if (b.registrations !== undefined || b.status !== undefined) {
    const registrations = normalizeRegistrations(b.registrations ?? existing.registrations);
    const taxRegistrationChanged =
      b.registrations !== undefined &&
      taxRegistrationSignature(registrations) !==
        taxRegistrationSignature(normalizeRegistrations(existing.registrations));
    const statusChanged = b.status !== undefined && b.status !== existing.status;
    const existingCt = existing.registrations.find((registration) => registration.type === "tax_registration_ct");
    const existingVat = existing.registrations.find((registration) => registration.type === "tax_registration_vat");
    const existingTaxComplete =
      !!existingCt?.number &&
      !!existingCt?.certificateDocumentId &&
      (!!existingVat?.number === !!existingVat?.certificateDocumentId);
    const taxValidation = await validateTaxRegistrations({
      orgId: me.orgId,
      entityId: existing.id,
      registrations,
      requireCorporateTax:
        (b.status ?? existing.status) === "active" &&
        (existingTaxComplete || taxRegistrationChanged || statusChanged),
    });
    if (!taxValidation.ok && (existingTaxComplete || taxRegistrationChanged || statusChanged)) {
      res.status(400).json({ error: taxValidation.error, message: taxValidation.message });
      return;
    }
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const changes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown) => {
    patch[key] = value;
    changes[key] = value;
  };
  if (b.legalNameEn !== undefined) assign("legalNameEn", b.legalNameEn);
  if (b.legalNameAr !== undefined) assign("legalNameAr", b.legalNameAr ?? null);
  if (b.shortName !== undefined) assign("shortName", b.shortName);
  if (b.legalForm !== undefined) assign("legalForm", b.legalForm);
  if (b.country !== undefined) assign("country", b.country);
  if (b.jurisdiction !== undefined) assign("jurisdiction", b.jurisdiction);
  if (b.status !== undefined) assign("status", b.status);
  if (b.incorporationDate !== undefined) assign("incorporationDate", b.incorporationDate ?? null);
  if (b.durationYears !== undefined) assign("durationYears", b.durationYears ?? null);
  if (b.baseCurrency !== undefined) assign("baseCurrency", b.baseCurrency);
  if (b.registeredAddress !== undefined) assign("registeredAddress", b.registeredAddress);
  if (b.officeAddress !== undefined) assign("officeAddress", b.officeAddress);
  if (b.governingLaw !== undefined) assign("governingLaw", b.governingLaw);
  if (b.courts !== undefined) assign("courts", b.courts);
  if (b.registrations !== undefined)
    assign("registrations", normalizeRegistrations(b.registrations));
  if (b.activities !== undefined) assign("activities", normalizeActivities(b.activities));
  if (b.owners !== undefined) assign("owners", normalizeOwners(b.owners));
  if (b.premises !== undefined) assign("premises", nullishObj(b.premises ?? null));
  if (b.lease !== undefined) assign("lease", nullishObj(b.lease ?? null));
  if (b.fiscal !== undefined) assign("fiscal", normalizeFiscal(b.fiscal));
  if (b.cashPolicy !== undefined) assign("cashPolicy", normalizeCashPolicy(b.cashPolicy));
  if (b.statutory !== undefined) assign("statutory", normalizeStatutory(b.statutory));
  if (b.isHeadEntity !== undefined) assign("isHeadEntity", b.isHeadEntity);
  if (b.formation !== undefined)
    assign("formation", normalizeFormation(b.formation, existing.formation?.settlement ?? null));
  if (b.notes !== undefined) assign("notes", b.notes ?? null);
  if (Object.keys(changes).length === 0) {
    res.json({ entity: entityShape(existing) });
    return;
  }
  let row: EntityRow;
  try {
    row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(atelierLegalEntities)
        .set(patch)
        .where(eq(atelierLegalEntities.id, existing.id))
        .returning();
      if (b.registrations !== undefined) {
        await linkTaxCertificates(tx, me.orgId, existing.id, normalizeRegistrations(b.registrations));
      }
      return updated;
    });
  } catch (error) {
    if (error instanceof TaxCertificateClaimError) {
      res.status(409).json({ error: "tax-certificate-already-linked", message: error.message });
      return;
    }
    throw error;
  }
  if (b.isHeadEntity === true) {
    // At most one head entity per org — the newest flag wins.
    await db.update(atelierLegalEntities)
      .set({ isHeadEntity: false, updatedAt: new Date() })
      .where(and(
        eq(atelierLegalEntities.orgId, me.orgId),
        eq(atelierLegalEntities.isHeadEntity, true),
        ne(atelierLegalEntities.id, existing.id)));
  }
  await auditEntity({
    entityId: existing.id,
    actor: me,
    action: "legal_entity.update",
    payload: { changes },
    summary: `Updated legal entity "${row.legalNameEn}" (${Object.keys(changes).join(", ")})`,
  });
  res.json({ entity: entityShape(row) });
});

// @cli-skip: partner-gated registry write; covered by REST tests
router.post("/finance/entities/:id/archive", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!requireEntityWriter(me, res)) return;
  const existing = await loadEntity(me.orgId, String(req.params.id ?? ""));
  if (!existing) { res.status(404).json({ error: "not-found" }); return; }
  if (existing.status === "archived") {
    res.json({ entity: entityShape(existing), alreadyArchived: true });
    return;
  }
  const [row] = await db
    .update(atelierLegalEntities)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(atelierLegalEntities.id, existing.id))
    .returning();
  await auditEntity({
    entityId: existing.id,
    actor: me,
    action: "legal_entity.archive",
    payload: { priorStatus: existing.status },
    summary: `Archived legal entity "${existing.legalNameEn}"`,
  });
  res.json({ entity: entityShape(row) });
});

// ---------------------------------------------------------------------------
// AI extraction — vault document → proposed entity fields (review-and-apply)
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM = `You are a corporate-registry analyst digitizing official company documents from the UAE and other jurisdictions (DET/DED trade licenses, initial-approval and follow-up receipts, Memoranda of Association, Ejari tenancy contracts, establishment cards). Documents are frequently bilingual Arabic/English; Arabic text extracted from PDFs may have distorted glyph order — prefer the English strings for Latin fields, but preserve Arabic strings verbatim where the document provides them (legal name, activity names, owner names).

Extract ONLY facts present in the document text. Never invent numbers, dates or names. Dates must be formatted YYYY-MM-DD. Omit (use null / empty array) anything the document does not state.

Return a single JSON object with this exact shape (all keys present):
{
  "documentKind": "trade_license" | "initial_approval" | "follow_up_receipt" | "memorandum_of_association" | "ejari_tenancy" | "establishment_card" | "tax_registration" | "other",
  "confidenceNote": string,
  "fields": {
    "legalNameEn": string|null, "legalNameAr": string|null,
    "legalForm": string|null, "country": string|null (ISO-3166 alpha-2),
    "jurisdiction": string|null, "incorporationDate": string|null,
    "durationYears": number|null, "registeredAddress": string|null,
    "registrations": [{"type": "trade_license"|"commercial_register"|"chamber_membership"|"establishment_card"|"initial_approval"|"moa_contract"|"tax_registration_ct" (Corporate Tax TRN)|"tax_registration_vat" (VAT TRN)|"other", "label": string, "number": string, "issuer": string|null, "issuedOn": string|null, "expiresOn": string|null, "notes": string|null}],
    "activities": [{"code": string, "nameEn": string, "nameAr": string|null, "status": string|null}],
    "owners": [{"name": string, "nameAr": string|null, "roles": [string], "sharePct": number|null, "nationality": string|null, "passportNo": string|null, "personNo": string|null}],
    "premises": {"addressLine": string|null, "building": string|null, "unit": string|null, "area": string|null, "city": string|null, "plotNumber": string|null, "makaniNo": string|null, "sizeSqm": number|null, "usage": string|null} | null,
    "lease": {"contractNo": string|null, "ejariTenantNo": string|null, "lessorName": string|null, "lessorLicenseNo": string|null, "ownerName": string|null, "startDate": string|null, "endDate": string|null, "annualRentAed": number|null, "securityDepositAed": number|null, "areaSqm": number|null, "registrationFeesAed": number|null, "notes": string|null} | null
  }
}`;

// @cli-skip: partner-gated LLM extraction; covered by manual verification
router.post("/finance/entities/extract", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  if (!requireEntityWriter(me, res)) return;
  const documentId = typeof req.body?.documentId === "string" ? req.body.documentId : "";
  if (!documentId) { res.status(400).json({ error: "document-id-required" }); return; }
  const [doc] = await db
    .select()
    .from(atelierDocuments)
    .where(and(eq(atelierDocuments.id, documentId), eq(atelierDocuments.orgId, me.orgId)));
  if (!doc || doc.status !== "active") { res.status(404).json({ error: "document-not-found" }); return; }
  if (!doc.currentVersionId) { res.status(422).json({ error: "document-has-no-version" }); return; }

  const { atelierDocumentVersions } = await import("@workspace/db");
  const [version] = await db
    .select()
    .from(atelierDocumentVersions)
    .where(eq(atelierDocumentVersions.id, doc.currentVersionId));
  if (!version) { res.status(422).json({ error: "document-version-missing" }); return; }

  const bytes = await loadDocBytes(version.blobRef);
  if (!bytes) {
    res.status(422).json({
      error: "document-bytes-missing",
      message: "The stored file could not be loaded from object storage.",
    });
    return;
  }
  let text = "";
  try {
    const extracted = await extractAttachment({
      fileName: version.fileName,
      mime: version.mime,
      bytes,
    });
    text = extracted.normalizedText.trim();
  } catch (err) {
    res.status(422).json({
      error: "text-extraction-failed",
      message: err instanceof Error ? err.message : "extraction error",
    });
    return;
  }
  if (text.length < 40) {
    res.status(422).json({
      error: "document-unreadable",
      message:
        "No usable text could be extracted from this document (scanned image without embedded text?). Extraction requires embedded text.",
    });
    return;
  }

  try {
    const { anthropic } = await (
      await import("../../lib/assistant/provider-runtime.js")
    ).getPrivacyAuthorizedAnthropic({
      dataClasses: ["restricted"],
      orgId: me.orgId,
      capabilityId: "finance.entity_registry_extraction",
      model: "claude-sonnet-4-5",
    });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    const resp = await anthropic.messages
      .create(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 8192,
          system: `${EXTRACT_SYSTEM}\n\nIMPORTANT: Reply with ONLY a single JSON object, no prose, no code fences.`,
          messages: [
            {
              role: "user",
              content: `Document file name: ${version.fileName}\nVault title: ${doc.title}\n\nExtracted document text:\n<<<\n${text.slice(0, 60_000)}\n>>>`,
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
    if (!json) {
      res.status(502).json({
        error: "extraction-non-json",
        message: "The AI returned no structured result.",
        snippet: raw.slice(0, 200),
      });
      return;
    }
    const proposal = JSON.parse(json) as Record<string, unknown>;
    const fields = proposal.fields as Record<string, unknown> | undefined;
    const hasContent =
      fields &&
      Object.values(fields).some(
        (v) => v != null && v !== "" && (!Array.isArray(v) || v.length > 0),
      );
    if (!hasContent) {
      res.status(422).json({
        error: "extraction-empty",
        message:
          "The AI extraction produced no fields from this document. Review the document manually.",
      });
      return;
    }
    // Task #287 — capture the detected kind on the document itself the
    // first time (manual overrides win: never clobber an existing kind).
    const detectedKind =
      typeof proposal.documentKind === "string" &&
      (DOC_KINDS as readonly string[]).includes(proposal.documentKind)
        ? proposal.documentKind
        : null;
    const normalizedKind = detectedKind;
    if (normalizedKind && normalizedKind !== "other" && !doc.docKind) {
      await db
        .update(atelierDocuments)
        .set({ docKind: normalizedKind, updatedAt: new Date() })
        .where(eq(atelierDocuments.id, doc.id));
    }
    await auditEntity({
      entityId: documentId,
      actor: me,
      action: "legal_entity.extract",
      payload: { documentId, documentKind: proposal.documentKind ?? "other" },
      summary: `Ran AI entity extraction on document "${doc.title}"`,
    });
    res.json({ documentId, proposal });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    res.status(aborted ? 504 : 502).json({
      error: aborted ? "extraction-timeout" : "extraction-failed",
      message: err instanceof Error ? err.message : "AI extraction error",
    });
  }
});

// ---------------------------------------------------------------------------
// Task #1065 — bank-letter extraction: vault document → proposed bank-account
// fields (review-and-apply; nothing is saved without an explicit POST to the
// wallet bank routes).
// ---------------------------------------------------------------------------

// Task #1090 — the system prompt + model call moved to the shared
// `atelier-finance-docs` helper so the Riser chat pipeline digitizes
// bank letters through the exact same extraction (no forked parsing).

// @cli-skip: partner-gated LLM extraction; covered by manual verification
router.post("/finance/entities/:id/bank-letter-extract", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  // Bank accounts are a finance-leadership surface (like the wallet bank
  // writes): finance can run parsing too, unlike registry edits.
  if (!(isFoundingPartner(me.role) || isPartner(me.role) || me.role === "finance")) {
    res.status(403).json({
      error: "forbidden",
      message: "Only partners or finance can parse bank letters.",
    });
    return;
  }

  const [row] = await db
    .select()
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, req.params.id), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!row) { res.status(404).json({ error: "entity-not-found" }); return; }

  const documentId = typeof req.body?.documentId === "string" ? req.body.documentId : "";
  if (!documentId) { res.status(400).json({ error: "document-id-required" }); return; }

  const [doc] = await db
    .select()
    .from(atelierDocuments)
    .where(and(eq(atelierDocuments.id, documentId), eq(atelierDocuments.orgId, me.orgId)));
  if (!doc || doc.status !== "active") { res.status(404).json({ error: "document-not-found" }); return; }
  // The letter must actually be linked to THIS entity — extraction against
  // an unrelated vault document is rejected.
  if (doc.entityId !== row.id) {
    res.status(409).json({
      error: "document-entity-mismatch",
      message: "That document is not linked to this legal entity.",
    });
    return;
  }
  if (!doc.currentVersionId) { res.status(422).json({ error: "document-has-no-version" }); return; }

  const { atelierDocumentVersions } = await import("@workspace/db");
  const [version] = await db
    .select()
    .from(atelierDocumentVersions)
    .where(eq(atelierDocumentVersions.id, doc.currentVersionId));
  if (!version) { res.status(422).json({ error: "document-version-missing" }); return; }

  const bytes = await loadDocBytes(version.blobRef);
  if (!bytes) {
    res.status(422).json({
      error: "document-bytes-missing",
      message: "The stored file could not be loaded from object storage.",
    });
    return;
  }
  let text = "";
  try {
    const extracted = await extractAttachment({
      fileName: version.fileName,
      mime: version.mime,
      bytes,
    });
    text = extracted.normalizedText.trim();
  } catch (err) {
    res.status(422).json({
      error: "text-extraction-failed",
      message: err instanceof Error ? err.message : "extraction error",
    });
    return;
  }
  if (text.length < 40) {
    res.status(422).json({
      error: "document-unreadable",
      message:
        "No usable text could be extracted from this document (scanned image without embedded text?). Extraction requires embedded text.",
    });
    return;
  }

  const out = await extractBankLetterFields({
    orgId: me.orgId,
    text,
    contextLabel: `Document file name: ${version.fileName}\nVault title: ${doc.title}\nLegal entity: ${row.legalNameEn ?? row.id}`,
  });
  if (!out.ok) {
    const status =
      out.errorCode === "extraction-empty" ? 422
      : out.errorCode === "extraction-timeout" ? 504
      : 502;
    res.status(status).json({
      error: out.errorCode,
      message: out.errorMessage,
      ...(out.snippet ? { snippet: out.snippet } : {}),
    });
    return;
  }
  await auditEntity({
    entityId: row.id,
    actor: me,
    action: "legal_entity.bank_letter_extract",
    payload: { documentId },
    summary: `Ran AI bank-letter extraction on document "${doc.title}"`,
  });
  res.json({
    documentId,
    proposal: { confidenceNote: out.confidenceNote, fields: out.fields },
  });
});

export default router;
