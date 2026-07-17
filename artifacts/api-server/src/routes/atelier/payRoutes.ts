/**
 * Atelier — Task #54: Personal pay hub.
 *
 * Self-scope (Me lens, all personas incl. employee/contractor allowlist):
 *   GET  /me/pay                            → own pay & benefits bundle
 *   GET  /me/pay/documents/:docId/download  → own PUBLISHED doc bytes (audited)
 *   POST /me/pay/bank-change-request        → request IBAN/SWIFT change (employees)
 *
 * HR surface (People lens; personnel-contract roles: fp/partner/hr):
 *   POST /roster/pay/people/:personId/documents          → upload (multipart)
 *   GET  /roster/pay/people/:personId/documents          → list incl. unpublished
 *   GET  /roster/pay/documents/:docId/download           → HR download (audited)
 *   POST /roster/pay/documents/:docId/publish            → publish + Me-home card
 *   POST /roster/pay/documents/:docId/retract            → retract
 *   PUT  /roster/pay/people/:personId/insurance          → upsert insurance
 *   GET  /roster/pay/bank-change-requests                → HR queue
 *   POST /roster/pay/bank-change-requests/:id/approve    → applies iban/swift
 *   POST /roster/pay/bank-change-requests/:id/reject
 *
 * ACL invariants:
 *  - A person only ever sees their OWN published documents; ownership is
 *    resolved from the session persona (resolveSelfPerson), never from ids
 *    in the URL — the download route re-checks doc.personId against self.
 *  - HR/leadership see any doc; nobody else can reach /roster/pay/*.
 *  - Bank details are never self-editable: the change request is applied to
 *    the roster row only inside the HR approve handler. Both sides audited.
 *  - Contractor variant: remittances instead of payslips, no insurance or
 *    bank-change surface (contractors carry no stored IBAN).
 *
 * Storage: file bytes are stored base64 in-row (atelier_pay_documents),
 * capped at 10MB — object storage is not configured in this workspace and
 * in-row bytes keep every download behind the ACL-gated route.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierPayDocuments,
  atelierPersonInsurance,
  atelierBankChangeRequests,
  atelierAuditEvents,
} from "@workspace/db";
import {
  AtelierGetMyPayResponse,
  AtelierListPersonPayDocumentsResponse,
  AtelierPublishPayDocumentResponse,
  AtelierRetractPayDocumentResponse,
  AtelierUpsertPersonInsuranceResponse,
  AtelierListBankChangeRequestsResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import { assertAuditAction } from "./auditContract.js";
import { canViewPersonnelContract } from "./personaRoles.js";
import { resolveSelfPerson, emitSelfNotification } from "./meRoutes.js";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

// ------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------

const PAY_CATEGORIES = [
  "contract",
  "salary_letter",
  "bonus_letter",
  "comp_letter",
  "payslip",
  "remittance",
  "insurance",
] as const;
type PayCategory = (typeof PAY_CATEGORIES)[number];

// Contractor variant (spec): remittances instead of payslips; no benefits.
const EMPLOYEE_ONLY_CATEGORIES: ReadonlySet<string> = new Set([
  "payslip",
  "insurance",
]);
const CONTRACTOR_ONLY_CATEGORIES: ReadonlySet<string> = new Set(["remittance"]);

const MAX_PAY_FILE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PAY_FILE_BYTES, files: 1 },
});

function uploadSingle(
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
): void {
  upload.single("file")(req, res, (err?: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({
        error: err.code.toLowerCase().replace(/_/g, "-"),
        message: err.message,
      });
      return;
    }
    res.status(400).json({ error: "upload-error", message: String(err) });
  });
}

interface PayPerson {
  id: string;
  workerType: "employee" | "contractor";
  fullName: string;
  email: string;
}

/** Org-scoped person lookup by roster id (employee first, then contractor). */
async function getPayPerson(
  orgId: string,
  personId: string,
): Promise<PayPerson | null> {
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, orgId),
        eq(atelierEmployees.id, personId),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp) {
    return {
      id: emp.id,
      workerType: "employee",
      fullName: emp.fullName,
      email: emp.email,
    };
  }
  const [ct] = await db
    .select()
    .from(atelierContractors)
    .where(
      and(
        eq(atelierContractors.orgId, orgId),
        eq(atelierContractors.id, personId),
        isNull(atelierContractors.deletedAt),
      ),
    );
  if (ct) {
    return {
      id: ct.id,
      workerType: "contractor",
      fullName: ct.fullName,
      email: ct.email,
    };
  }
  return null;
}

/**
 * The atelier_users.id that OWNS a roster person (for Me-home cards).
 * Employees link via user_id; contractors via lower-cased email — the same
 * rule resolveSelfPerson uses in the other direction.
 */
async function resolveOwnerUserId(
  orgId: string,
  person: PayPerson,
): Promise<string | null> {
  if (person.workerType === "employee") {
    const [emp] = await db
      .select({ userId: atelierEmployees.userId })
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.orgId, orgId),
          eq(atelierEmployees.id, person.id),
          isNull(atelierEmployees.deletedAt),
        ),
      );
    return emp?.userId ?? null;
  }
  const email = person.email.trim().toLowerCase();
  const users = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.orgId, orgId), isNull(atelierUsers.deletedAt)));
  return users.find((u) => u.email.trim().toLowerCase() === email)?.id ?? null;
}

function maskIban(iban: string | null | undefined): string | null {
  if (!iban) return null;
  const clean = iban.replace(/\s+/g, "");
  if (clean.length <= 4) return "••••";
  return `•••• ${clean.slice(-4)}`;
}

async function writeAudit(args: {
  me: typeof atelierUsers.$inferSelect;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  assertAuditAction(args.action);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "user",
    actorId: args.me.id,
    actorLabel: args.me.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

type PayDocRow = typeof atelierPayDocuments.$inferSelect;

function docToAdminWire(d: PayDocRow) {
  return {
    id: d.id,
    personId: d.personId,
    personType: d.personType as "employee" | "contractor",
    category: d.category as PayCategory,
    title: d.title,
    periodDate: d.periodDate ?? null,
    fileName: d.fileName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    published: d.published,
    publishedAt: d.publishedAt?.toISOString() ?? null,
    retractedAt: d.retractedAt?.toISOString() ?? null,
    uploadedAt: d.createdAt.toISOString(),
    notes: d.notes ?? null,
    downloadUrl: `/api/atelier/roster/pay/documents/${d.id}/download`,
  };
}

function docToSelfWire(d: PayDocRow) {
  return {
    id: d.id,
    category: d.category as PayCategory,
    title: d.title,
    periodDate: d.periodDate ?? null,
    fileName: d.fileName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    publishedAt: d.publishedAt?.toISOString() ?? null,
    downloadUrl: `/api/atelier/me/pay/documents/${d.id}/download`,
  };
}

type BankReqRow = typeof atelierBankChangeRequests.$inferSelect;

function bankReqToSelfWire(r: BankReqRow) {
  return {
    id: r.id,
    newIbanMasked: maskIban(r.newIban) ?? "••••",
    newSwift: r.newSwift ?? null,
    reason: r.reason ?? null,
    status: r.status as "pending" | "approved" | "rejected",
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote ?? null,
  };
}

function bankReqToAdminWire(r: BankReqRow, personName: string) {
  return {
    id: r.id,
    personId: r.personId,
    personType: r.personType,
    personName,
    previousIbanMasked: r.previousIbanMasked ?? null,
    newIban: r.newIban,
    newSwift: r.newSwift ?? null,
    reason: r.reason ?? null,
    status: r.status as "pending" | "approved" | "rejected",
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedByName: r.decidedByName ?? null,
    decisionNote: r.decisionNote ?? null,
  };
}

function insuranceToWire(row: typeof atelierPersonInsurance.$inferSelect) {
  return {
    provider: row.provider,
    policyNumber: row.policyNumber,
    memberNumber: row.memberNumber,
    coverageSummary: row.coverageSummary,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ------------------------------------------------------------------
// Self-scope: /me/pay
// ------------------------------------------------------------------

// @cli-skip: self-scope pay bundle read; no CLI shape (Task #54)
router.get("/me/pay", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await resolveSelfPerson(me);
    if (!person) {
      res.json(
        AtelierGetMyPayResponse.parse({
          person: null,
          documents: [],
          compSummary: null,
          insurance: null,
          bank: null,
          bankRequests: [],
        }),
      );
      return;
    }
    const docs = await db
      .select()
      .from(atelierPayDocuments)
      .where(
        and(
          eq(atelierPayDocuments.orgId, me.orgId),
          eq(atelierPayDocuments.personType, person.workerType),
          eq(atelierPayDocuments.personId, person.id),
          eq(atelierPayDocuments.published, true),
          isNull(atelierPayDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPayDocuments.createdAt));

    let compSummary: Record<string, unknown> | null = null;
    let bank: Record<string, unknown> | null = null;
    let insurance: Record<string, unknown> | null = null;

    if (person.workerType === "employee") {
      const [emp] = await db
        .select()
        .from(atelierEmployees)
        .where(
          and(
            eq(atelierEmployees.orgId, me.orgId),
            eq(atelierEmployees.id, person.id),
            isNull(atelierEmployees.deletedAt),
          ),
        );
      if (emp) {
        compSummary = {
          baseCompensation: emp.baseCompensation ?? null,
          baseCurrency: emp.baseCurrency ?? null,
          dayRateAmount: null,
          dayRateCurrency: null,
        };
        bank = {
          ibanMasked: maskIban(emp.iban),
          swift: emp.swift ?? null,
          canRequestChange: true,
        };
      }
      const [ins] = await db
        .select()
        .from(atelierPersonInsurance)
        .where(
          and(
            eq(atelierPersonInsurance.orgId, me.orgId),
            eq(atelierPersonInsurance.personType, "employee"),
            eq(atelierPersonInsurance.personId, person.id),
            isNull(atelierPersonInsurance.deletedAt),
          ),
        );
      if (ins) insurance = insuranceToWire(ins);
    } else {
      // Contractor variant: day-rate comp; no benefits, no stored bank
      // details (remittance banking lives with the contracting entity).
      const [ct] = await db
        .select()
        .from(atelierContractors)
        .where(
          and(
            eq(atelierContractors.orgId, me.orgId),
            eq(atelierContractors.id, person.id),
            isNull(atelierContractors.deletedAt),
          ),
        );
      if (ct) {
        compSummary = {
          baseCompensation: null,
          baseCurrency: null,
          dayRateAmount: ct.dayRateAmount ?? null,
          dayRateCurrency: ct.dayRateCurrency ?? null,
        };
      }
    }

    const bankRequests =
      person.workerType === "employee"
        ? await db
            .select()
            .from(atelierBankChangeRequests)
            .where(
              and(
                eq(atelierBankChangeRequests.orgId, me.orgId),
                eq(atelierBankChangeRequests.personType, "employee"),
                eq(atelierBankChangeRequests.personId, person.id),
                isNull(atelierBankChangeRequests.deletedAt),
              ),
            )
            .orderBy(desc(atelierBankChangeRequests.createdAt))
        : [];

    res.json(
      AtelierGetMyPayResponse.parse({
        person,
        documents: docs.map(docToSelfWire),
        compSummary,
        insurance,
        bank,
        bankRequests: bankRequests.map(bankReqToSelfWire),
      }),
    );
  } catch (err) {
    next(err);
  }
});

// @cli-skip: binary self-scope download; no CLI shape (Task #54)
router.get("/me/pay/documents/:docId/download", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const person = await resolveSelfPerson(me);
    if (!person) {
      res.status(404).json({ error: "no-roster-record" });
      return;
    }
    // Ownership + published are part of the WHERE — a foreign or
    // unpublished id 404s identically, never leaks existence.
    const [doc] = await db
      .select()
      .from(atelierPayDocuments)
      .where(
        and(
          eq(atelierPayDocuments.id, req.params.docId),
          eq(atelierPayDocuments.orgId, me.orgId),
          eq(atelierPayDocuments.personType, person.workerType),
          eq(atelierPayDocuments.personId, person.id),
          eq(atelierPayDocuments.published, true),
          isNull(atelierPayDocuments.deletedAt),
        ),
      );
    if (!doc) {
      res.status(404).json({ error: "doc-not-found" });
      return;
    }
    await writeAudit({
      me,
      entityType: "pay_document",
      entityId: doc.id,
      action: "pay_document.downloaded.self",
      payload: { personId: person.id, docId: doc.id, category: doc.category },
      summary: `${me.name} downloaded own ${doc.category} document`,
    });
    const buf = Buffer.from(doc.fileData, "base64");
    res.setHeader("Content-Type", doc.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${doc.fileName.replace(/["\r\n]/g, "")}"`,
    );
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

const BankChangeBody = z.object({
  newIban: z.string().min(8).max(34),
  newSwift: z.string().max(11).optional(),
  reason: z.string().max(1000).optional(),
});

// @cli-skip: self-scope bank change request; no CLI shape (Task #54)
router.post("/me/pay/bank-change-request", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const parsed = BankChangeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const person = await resolveSelfPerson(me);
    if (!person || person.workerType !== "employee") {
      // Contractors have no stored IBAN on the roster record.
      res.status(400).json({ error: "bank-change-employees-only" });
      return;
    }
    const iban = parsed.data.newIban.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{8,34}$/.test(iban)) {
      res.status(400).json({ error: "invalid-iban" });
      return;
    }
    const [pending] = await db
      .select({ id: atelierBankChangeRequests.id })
      .from(atelierBankChangeRequests)
      .where(
        and(
          eq(atelierBankChangeRequests.orgId, me.orgId),
          eq(atelierBankChangeRequests.personType, "employee"),
          eq(atelierBankChangeRequests.personId, person.id),
          eq(atelierBankChangeRequests.status, "pending"),
          isNull(atelierBankChangeRequests.deletedAt),
        ),
      );
    if (pending) {
      res.status(400).json({ error: "request-already-pending" });
      return;
    }
    const [emp] = await db
      .select({ iban: atelierEmployees.iban })
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.orgId, me.orgId),
          eq(atelierEmployees.id, person.id),
        ),
      );
    const [row] = await db
      .insert(atelierBankChangeRequests)
      .values({
        id: rid("bankreq"),
        orgId: me.orgId,
        personType: "employee",
        personId: person.id,
        requestedByUserId: me.id,
        previousIbanMasked: maskIban(emp?.iban ?? null),
        newIban: iban,
        newSwift: parsed.data.newSwift?.trim().toUpperCase() || null,
        reason: parsed.data.reason?.trim() || null,
        createdByUserId: me.id,
      })
      .returning();
    await writeAudit({
      me,
      entityType: "bank_change_request",
      entityId: row.id,
      action: "bank_change.requested",
      payload: {
        personId: person.id,
        newIbanMasked: maskIban(iban),
        hasSwift: !!row.newSwift,
      },
      summary: `${me.name} requested a bank detail change`,
    });
    res.status(201).json(bankReqToSelfWire(row));
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------
// HR surface: /roster/pay/*
// ------------------------------------------------------------------

function ensureHr(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (!canViewPersonnelContract(me.role)) {
    res.status(403).json({ error: "personnel-contract-forbidden" });
    return null;
  }
  return me;
}

const UploadFields = z.object({
  category: z.enum(PAY_CATEGORIES),
  title: z.string().min(1).max(300),
  periodDate: z.string().max(20).optional(),
  notes: z.string().max(2000).optional(),
});

// @cli-skip: multipart HR upload; no CLI shape (Task #54)
router.post(
  "/roster/pay/people/:personId/documents",
  uploadSingle,
  async (req, res, next) => {
    try {
      const me = ensureHr(req, res);
      if (!me) return;
      const person = await getPayPerson(me.orgId, String(req.params.personId));
      if (!person) {
        res.status(404).json({ error: "person-not-found" });
        return;
      }
      const parsed = UploadFields.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
        return;
      }
      const { category } = parsed.data;
      if (person.workerType === "contractor" && EMPLOYEE_ONLY_CATEGORIES.has(category)) {
        res.status(400).json({ error: "category-not-for-contractors" });
        return;
      }
      if (person.workerType === "employee" && CONTRACTOR_ONLY_CATEGORIES.has(category)) {
        res.status(400).json({ error: "category-not-for-employees" });
        return;
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file || file.size === 0) {
        res.status(400).json({ error: "file-required" });
        return;
      }
      const [row] = await db
        .insert(atelierPayDocuments)
        .values({
          id: rid("paydoc"),
          orgId: me.orgId,
          personType: person.workerType,
          personId: person.id,
          category,
          title: parsed.data.title.trim(),
          periodDate: parsed.data.periodDate?.trim() || null,
          fileName: file.originalname || "document",
          mime: file.mimetype || "application/octet-stream",
          sizeBytes: file.size,
          fileData: file.buffer.toString("base64"),
          uploadedByUserId: me.id,
          notes: parsed.data.notes?.trim() || null,
          createdByUserId: me.id,
        })
        .returning();
      await writeAudit({
        me,
        entityType: "pay_document",
        entityId: row.id,
        action: "pay_document.uploaded",
        payload: {
          personId: person.id,
          category,
          fileName: row.fileName,
          sizeBytes: row.sizeBytes,
        },
        summary: `${me.name} uploaded ${category} document for ${person.fullName}`,
      });
      res.status(201).json(docToAdminWire(row));
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: HR pay-doc admin list; no CLI shape (Task #54)
router.get("/roster/pay/people/:personId/documents", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const person = await getPayPerson(me.orgId, req.params.personId);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const docs = await db
      .select()
      .from(atelierPayDocuments)
      .where(
        and(
          eq(atelierPayDocuments.orgId, me.orgId),
          eq(atelierPayDocuments.personType, person.workerType),
          eq(atelierPayDocuments.personId, person.id),
          isNull(atelierPayDocuments.deletedAt),
        ),
      )
      .orderBy(desc(atelierPayDocuments.createdAt));
    res.json(AtelierListPersonPayDocumentsResponse.parse(docs.map(docToAdminWire)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: binary HR download; no CLI shape (Task #54)
router.get("/roster/pay/documents/:docId/download", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const [doc] = await db
      .select()
      .from(atelierPayDocuments)
      .where(
        and(
          eq(atelierPayDocuments.id, req.params.docId),
          eq(atelierPayDocuments.orgId, me.orgId),
          isNull(atelierPayDocuments.deletedAt),
        ),
      );
    if (!doc) {
      res.status(404).json({ error: "doc-not-found" });
      return;
    }
    await writeAudit({
      me,
      entityType: "pay_document",
      entityId: doc.id,
      action: "pay_document.downloaded.hr",
      payload: { personId: doc.personId, docId: doc.id, category: doc.category },
      summary: `${me.name} downloaded ${doc.category} pay document (HR)`,
    });
    const buf = Buffer.from(doc.fileData, "base64");
    res.setHeader("Content-Type", doc.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${doc.fileName.replace(/["\r\n]/g, "")}"`,
    );
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR publish action; no CLI shape (Task #54)
router.post("/roster/pay/documents/:docId/publish", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const [row] = await db
      .update(atelierPayDocuments)
      .set({
        published: true,
        publishedAt: new Date(),
        publishedByUserId: me.id,
        retractedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierPayDocuments.id, req.params.docId),
          eq(atelierPayDocuments.orgId, me.orgId),
          isNull(atelierPayDocuments.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "doc-not-found" });
      return;
    }
    const person = await getPayPerson(me.orgId, row.personId);
    await writeAudit({
      me,
      entityType: "pay_document",
      entityId: row.id,
      action: "pay_document.published",
      payload: { personId: row.personId, category: row.category, title: row.title },
      summary: `${me.name} published ${row.category} document for ${person?.fullName ?? row.personId}`,
    });
    // Me-home card for the owner (best-effort: person may have no login).
    if (person) {
      const ownerUserId = await resolveOwnerUserId(me.orgId, person);
      if (ownerUserId) {
        await emitSelfNotification({
          orgId: me.orgId,
          userId: ownerUserId,
          kind: "pay_document",
          title: `New ${row.category.replace(/_/g, " ")} available`,
          body: row.title,
          href: "/me/pay",
        });
      }
    }
    res.json(AtelierPublishPayDocumentResponse.parse(docToAdminWire(row)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR retract action; no CLI shape (Task #54)
router.post("/roster/pay/documents/:docId/retract", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const [row] = await db
      .update(atelierPayDocuments)
      .set({ published: false, retractedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(atelierPayDocuments.id, req.params.docId),
          eq(atelierPayDocuments.orgId, me.orgId),
          isNull(atelierPayDocuments.deletedAt),
        ),
      )
      .returning();
    if (!row) {
      res.status(404).json({ error: "doc-not-found" });
      return;
    }
    await writeAudit({
      me,
      entityType: "pay_document",
      entityId: row.id,
      action: "pay_document.retracted",
      payload: { personId: row.personId, category: row.category, title: row.title },
      summary: `${me.name} retracted ${row.category} document`,
    });
    res.json(AtelierRetractPayDocumentResponse.parse(docToAdminWire(row)));
  } catch (err) {
    next(err);
  }
});

const InsuranceBody = z.object({
  provider: z.string().min(1).max(200),
  policyNumber: z.string().max(100).optional(),
  memberNumber: z.string().max(100).optional(),
  coverageSummary: z.string().max(4000).optional(),
});

// @cli-skip: HR insurance upsert; no CLI shape (Task #54)
router.put("/roster/pay/people/:personId/insurance", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const person = await getPayPerson(me.orgId, req.params.personId);
    if (!person) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    if (person.workerType === "contractor") {
      res.status(400).json({ error: "insurance-not-for-contractors" });
      return;
    }
    const parsed = InsuranceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const values = {
      provider: parsed.data.provider.trim(),
      policyNumber: parsed.data.policyNumber?.trim() ?? "",
      memberNumber: parsed.data.memberNumber?.trim() ?? "",
      coverageSummary: parsed.data.coverageSummary?.trim() ?? "",
      updatedAt: new Date(),
    };
    const [existing] = await db
      .select()
      .from(atelierPersonInsurance)
      .where(
        and(
          eq(atelierPersonInsurance.orgId, me.orgId),
          eq(atelierPersonInsurance.personType, person.workerType),
          eq(atelierPersonInsurance.personId, person.id),
          isNull(atelierPersonInsurance.deletedAt),
        ),
      );
    let row: typeof atelierPersonInsurance.$inferSelect;
    if (existing) {
      [row] = await db
        .update(atelierPersonInsurance)
        .set(values)
        .where(eq(atelierPersonInsurance.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(atelierPersonInsurance)
        .values({
          id: rid("persins"),
          orgId: me.orgId,
          personType: person.workerType,
          personId: person.id,
          ...values,
          createdByUserId: me.id,
        })
        .returning();
    }
    await writeAudit({
      me,
      entityType: "person_insurance",
      entityId: row.id,
      action: "person_insurance.upserted",
      payload: { personId: person.id, provider: row.provider },
      summary: `${me.name} updated insurance details for ${person.fullName}`,
    });
    res.json(AtelierUpsertPersonInsuranceResponse.parse(insuranceToWire(row)));
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR bank queue read; no CLI shape (Task #54)
router.get("/roster/pay/bank-change-requests", async (req, res, next) => {
  try {
    const me = ensureHr(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierBankChangeRequests)
      .where(
        and(
          eq(atelierBankChangeRequests.orgId, me.orgId),
          isNull(atelierBankChangeRequests.deletedAt),
        ),
      )
      .orderBy(desc(atelierBankChangeRequests.createdAt));
    const sorted = [
      ...rows.filter((r) => r.status === "pending"),
      ...rows.filter((r) => r.status !== "pending"),
    ];
    const wire = [];
    for (const r of sorted) {
      const person = await getPayPerson(me.orgId, r.personId);
      wire.push(bankReqToAdminWire(r, person?.fullName ?? r.personId));
    }
    res.json(AtelierListBankChangeRequestsResponse.parse(wire));
  } catch (err) {
    next(err);
  }
});

const DecisionBody = z.object({ note: z.string().max(1000).optional() });

// @cli-skip: HR bank approve action; no CLI shape (Task #54)
router.post(
  "/roster/pay/bank-change-requests/:id/approve",
  async (req, res, next) => {
    try {
      const me = ensureHr(req, res);
      if (!me) return;
      const parsed = DecisionBody.safeParse(req.body ?? {});
      const note = parsed.success ? (parsed.data.note?.trim() || null) : null;
      // Status guard in the WHERE keeps the decision idempotent-safe: a
      // second approve (or approve-after-reject) 404s and applies nothing.
      const [row] = await db
        .update(atelierBankChangeRequests)
        .set({
          status: "approved",
          decidedByUserId: me.id,
          decidedByName: me.name,
          decidedAt: new Date(),
          decisionNote: note,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(atelierBankChangeRequests.id, req.params.id),
            eq(atelierBankChangeRequests.orgId, me.orgId),
            eq(atelierBankChangeRequests.status, "pending"),
            isNull(atelierBankChangeRequests.deletedAt),
          ),
        )
        .returning();
      if (!row) {
        res.status(404).json({ error: "request-not-found-or-not-pending" });
        return;
      }
      // The ONLY code path that writes bank details from a change request.
      await db
        .update(atelierEmployees)
        .set({
          iban: row.newIban,
          ...(row.newSwift ? { swift: row.newSwift } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(atelierEmployees.orgId, me.orgId),
            eq(atelierEmployees.id, row.personId),
            isNull(atelierEmployees.deletedAt),
          ),
        );
      const person = await getPayPerson(me.orgId, row.personId);
      await writeAudit({
        me,
        entityType: "bank_change_request",
        entityId: row.id,
        action: "bank_change.approved",
        payload: {
          personId: row.personId,
          newIbanMasked: maskIban(row.newIban),
          appliedSwift: !!row.newSwift,
        },
        summary: `${me.name} approved bank detail change for ${person?.fullName ?? row.personId}`,
      });
      await emitSelfNotification({
        orgId: me.orgId,
        userId: row.requestedByUserId,
        kind: "bank_change",
        title: "Bank detail change approved",
        body: note ?? "",
        href: "/me/pay",
      });
      res.json(
        bankReqToAdminWire(row, person?.fullName ?? row.personId),
      );
    } catch (err) {
      next(err);
    }
  },
);

// @cli-skip: HR bank reject action; no CLI shape (Task #54)
router.post(
  "/roster/pay/bank-change-requests/:id/reject",
  async (req, res, next) => {
    try {
      const me = ensureHr(req, res);
      if (!me) return;
      const parsed = DecisionBody.safeParse(req.body ?? {});
      const note = parsed.success ? (parsed.data.note?.trim() || null) : null;
      const [row] = await db
        .update(atelierBankChangeRequests)
        .set({
          status: "rejected",
          decidedByUserId: me.id,
          decidedByName: me.name,
          decidedAt: new Date(),
          decisionNote: note,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(atelierBankChangeRequests.id, req.params.id),
            eq(atelierBankChangeRequests.orgId, me.orgId),
            eq(atelierBankChangeRequests.status, "pending"),
            isNull(atelierBankChangeRequests.deletedAt),
          ),
        )
        .returning();
      if (!row) {
        res.status(404).json({ error: "request-not-found-or-not-pending" });
        return;
      }
      const person = await getPayPerson(me.orgId, row.personId);
      await writeAudit({
        me,
        entityType: "bank_change_request",
        entityId: row.id,
        action: "bank_change.rejected",
        payload: { personId: row.personId },
        summary: `${me.name} rejected bank detail change for ${person?.fullName ?? row.personId}`,
      });
      await emitSelfNotification({
        orgId: me.orgId,
        userId: row.requestedByUserId,
        kind: "bank_change",
        title: "Bank detail change rejected",
        body: note ?? "",
        href: "/me/pay",
      });
      res.json(
        bankReqToAdminWire(row, person?.fullName ?? row.personId),
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
