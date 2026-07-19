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
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierDocuments,
  atelierAuditEvents,
} from "@workspace/db";
import { isFoundingPartner, isPartner } from "./personaRoles";
import { loadDocBytes, DOC_KINDS } from "../../lib/atelier-documents.js";
import { extractAttachment } from "../../lib/atelier-cli/attachments/extractors.js";
import { extractFirstJsonObject } from "../../lib/atelier-agents/runner.js";

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
  status: z.enum(["active", "in_formation", "dormant", "winding_down"]).default("active"),
  incorporationDate: optStr(20),
  durationYears: z.number().int().min(0).max(1000).nullish(),
  baseCurrency: str(10).default(""),
  registeredAddress: str(600).default(""),
  governingLaw: str(600).default(""),
  courts: str(600).default(""),
  registrations: z.array(registrationSchema).max(50).default([]),
  activities: z.array(activitySchema).max(100).default([]),
  owners: z.array(ownerSchema).max(50).default([]),
  premises: premisesSchema.nullish(),
  lease: leaseSchema.nullish(),
  fiscal: fiscalSchema.nullish(),
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
  }));
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
  };
  const hasValue = Object.values(out).some((v) => v !== null && v !== "");
  return hasValue ? out : null;
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
    governingLaw: e.governingLaw,
    courts: e.courts,
    registrations: e.registrations ?? [],
    activities: e.activities ?? [],
    owners: e.owners ?? [],
    premises: e.premises ?? null,
    lease: e.lease ?? null,
    fiscal: e.fiscal ?? null,
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
}

export interface FinanceEntityInfo {
  id: string;
  shortName: string;
  baseCurrency: string;
  country: string;
  fiscal: FinanceEntityFiscal | null;
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
// @cli-skip: pending Task #340 read-parity migration
router.get("/finance/entities/expiries", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiter(me, res)) return;
  const rawWindow = Number(req.query.windowDays);
  const windowDays = Number.isFinite(rawWindow)
    ? Math.min(365, Math.max(1, Math.round(rawWindow)))
    : 90;
  const dayMs = 86_400_000;
  const now = Date.now();
  const rows = await db
    .select()
    .from(atelierLegalEntities)
    .where(eq(atelierLegalEntities.orgId, me.orgId));
  const items: Array<{
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
  }> = [];
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
  res.json({ windowDays, items });
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
  // Task #287 — lazy backfill: already-linked documents uploaded before the
  // classification model get a kind inferred from title/filename (persisted),
  // so seeded entities tier correctly without manual work. Manual overrides
  // and AI-extraction kinds always win because we only fill nulls.
  const kindBackfill = new Map<string, string>();
  for (const d of docs) {
    if (d.docKind) continue;
    const v = d.currentVersionId ? versionById.get(d.currentVersionId) : null;
    const inferred = inferDocKindFromTitle(d.title, v?.fileName ?? null);
    if (inferred) kindBackfill.set(d.id, inferred);
  }
  for (const [docId, kind] of kindBackfill) {
    await db
      .update(atelierDocuments)
      .set({ docKind: kind, updatedAt: new Date() })
      .where(and(eq(atelierDocuments.id, docId), isNull(atelierDocuments.docKind)));
  }
  res.json({
    entity: entityShape(row),
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
  if (/tax registration|\btrn\b|vat certificate|corporate tax/.test(t)) return "tax_registration";
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
  const [row] = await db
    .insert(atelierLegalEntities)
    .values({
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
      governingLaw: b.governingLaw,
      courts: b.courts,
      registrations: normalizeRegistrations(b.registrations),
      activities: normalizeActivities(b.activities),
      owners: normalizeOwners(b.owners),
      premises: nullishObj(b.premises ?? null) as EntityRow["premises"],
      lease: nullishObj(b.lease ?? null) as EntityRow["lease"],
      fiscal: normalizeFiscal(b.fiscal),
      notes: b.notes ?? null,
    })
    .returning();
  await auditEntity({
    entityId: id,
    actor: me,
    action: "legal_entity.create",
    payload: { legalNameEn: b.legalNameEn, country: b.country },
    summary: `Created legal entity "${b.legalNameEn}" (${b.country})`,
  });
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
  if (b.governingLaw !== undefined) assign("governingLaw", b.governingLaw);
  if (b.courts !== undefined) assign("courts", b.courts);
  if (b.registrations !== undefined)
    assign("registrations", normalizeRegistrations(b.registrations));
  if (b.activities !== undefined) assign("activities", normalizeActivities(b.activities));
  if (b.owners !== undefined) assign("owners", normalizeOwners(b.owners));
  if (b.premises !== undefined) assign("premises", nullishObj(b.premises ?? null));
  if (b.lease !== undefined) assign("lease", nullishObj(b.lease ?? null));
  if (b.fiscal !== undefined) assign("fiscal", normalizeFiscal(b.fiscal));
  if (b.notes !== undefined) assign("notes", b.notes ?? null);
  if (Object.keys(changes).length === 0) {
    res.json({ entity: entityShape(existing) });
    return;
  }
  const [row] = await db
    .update(atelierLegalEntities)
    .set(patch)
    .where(eq(atelierLegalEntities.id, existing.id))
    .returning();
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
  "documentKind": "trade_license" | "initial_approval" | "follow_up_receipt" | "memorandum_of_association" | "ejari_tenancy" | "establishment_card" | "other",
  "confidenceNote": string,
  "fields": {
    "legalNameEn": string|null, "legalNameAr": string|null,
    "legalForm": string|null, "country": string|null (ISO-3166 alpha-2),
    "jurisdiction": string|null, "incorporationDate": string|null,
    "durationYears": number|null, "registeredAddress": string|null,
    "registrations": [{"type": "trade_license"|"commercial_register"|"chamber_membership"|"establishment_card"|"initial_approval"|"moa_contract"|"other", "label": string, "number": string, "issuer": string|null, "issuedOn": string|null, "expiresOn": string|null, "notes": string|null}],
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
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
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

export default router;
