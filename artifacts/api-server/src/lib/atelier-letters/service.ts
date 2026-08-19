/**
 * Task #845 — Letter issuance service.
 *
 * Orchestrates the whole self-service flow for one employee request:
 * entity resolution (explicit rule, never a silent guess), salary +
 * identity data (self-scope: the employee's own comp record only),
 * template → letterhead PDF, issuance-log row, person-document storage,
 * and delivery (digital email to the employee, or unsigned PDF to the
 * entity signatory for wet signature). Honest delivery status: only
 * via:"resend" means the email actually left the building.
 */

import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierEmployees,
  atelierLetterIssuances,
  atelierPersonDocuments,
} from "@workspace/db";
import {
  listSigningEntities,
  type SigningEntity,
} from "../atelier-contract-service.js";
import { storePersonDocBytes, loadPersonDocBytes } from "../personDocStorage.js";
import { sendEmail } from "../email.js";
import { buildCogniriseEmail } from "../cognirise-email-templates.js";
import {
  letterTypeById,
  type LetterDeliveryMode,
  type LetterLanguage,
} from "./catalog.js";
import {
  buildLetterContent,
  formatLetterDate,
  type LetterContext,
} from "./templates.js";
import { generateLetterPdf } from "./pdf.js";

export const HR_VERIFICATION_EMAIL = "hr@cognirise.ai";
export const LETTER_DOC_KIND = "employment_letter";

type EmployeeRow = typeof atelierEmployees.$inferSelect;

// ------------------------------------------------------------------
// Entity resolution — explicit rule (Task #845):
// Registry legalEntityId → legacy unambiguous name match → default entity.
// A stale non-null ID never falls back to a label or a default: correction is
// required before an official letter can be issued.
// ------------------------------------------------------------------

export type EntityResolution = {
  entity: SigningEntity | null;
  via: "registry_id" | "legacy_name" | "default" | "none";
  ambiguous: boolean;
};

export function resolveEmployingEntityFrom(
  entities: SigningEntity[],
  emp: Pick<EmployeeRow, "legalEntityId" | "employingEntity">,
): EntityResolution {
  if (entities.length === 0) return { entity: null, via: "none", ambiguous: false };
  const fallback = entities.find((e) => e.isDefault) ?? entities[0];
  if (emp.legalEntityId) {
    const hit = entities.find((e) => e.id === emp.legalEntityId);
    if (hit) return { entity: hit, via: "registry_id", ambiguous: false };
    return { entity: null, via: "none", ambiguous: false };
  }
  const label = (emp.employingEntity ?? "").trim().toLowerCase();
  if (label) {
    const matches = entities.filter(
      (e) =>
        e.name.trim().toLowerCase() === label ||
        e.name.trim().toLowerCase().includes(label) ||
        label.includes(e.name.trim().toLowerCase()),
    );
    if (matches.length === 1) return { entity: matches[0], via: "legacy_name", ambiguous: false };
    if (matches.length > 1) return { entity: fallback, via: "default", ambiguous: true };
  }
  return { entity: fallback, via: "default", ambiguous: false };
}

export async function resolveEmployingEntity(
  orgId: string,
  emp: Pick<EmployeeRow, "legalEntityId" | "employingEntity">,
): Promise<EntityResolution> {
  const entities = await listSigningEntities(orgId);
  return resolveEmployingEntityFrom(entities, emp);
}

// ------------------------------------------------------------------
// Salary — total only (monthly + annual), from the employee's own
// audited comp fields. baseCompensation is annual; when absent, the
// monthly basic + housing pair is the whole wage (schema comment).
// ------------------------------------------------------------------

export function resolveTotalSalary(
  emp: Pick<
    EmployeeRow,
    "baseCompensation" | "basicWageMonthly" | "housingAllowanceMonthly" | "baseCurrency"
  >,
): { monthly: number; annual: number; currency: string } | null {
  const currency = (emp.baseCurrency ?? "").trim() || "AED";
  const annualRaw = emp.baseCompensation != null ? Number(emp.baseCompensation) : null;
  if (annualRaw != null && Number.isFinite(annualRaw) && annualRaw > 0) {
    return { monthly: annualRaw / 12, annual: annualRaw, currency };
  }
  const basic = emp.basicWageMonthly != null ? Number(emp.basicWageMonthly) : null;
  if (basic != null && Number.isFinite(basic) && basic > 0) {
    const housing =
      emp.housingAllowanceMonthly != null ? Number(emp.housingAllowanceMonthly) : 0;
    const monthly = basic + (Number.isFinite(housing) ? housing : 0);
    return { monthly, annual: monthly * 12, currency };
  }
  return null;
}

async function lookupIdNumber(
  orgId: string,
  personId: string,
): Promise<{ idNumber: string; idKind: "passport" | "national_id" } | null> {
  const rows = await db
    .select({
      kind: atelierPersonDocuments.kind,
      docNumber: atelierPersonDocuments.docNumber,
      uploadedAt: atelierPersonDocuments.uploadedAt,
    })
    .from(atelierPersonDocuments)
    .where(
      and(
        eq(atelierPersonDocuments.orgId, orgId),
        eq(atelierPersonDocuments.personType, "employee"),
        eq(atelierPersonDocuments.personId, personId),
        isNull(atelierPersonDocuments.deletedAt),
      ),
    )
    .orderBy(desc(atelierPersonDocuments.uploadedAt));
  for (const kind of ["passport", "national_id"] as const) {
    const hit = rows.find((r) => r.kind === kind && (r.docNumber ?? "").trim());
    if (hit) return { idNumber: hit.docNumber!.trim(), idKind: kind };
  }
  return null;
}

function newRefNumber(): string {
  const year = new Date().getUTCFullYear();
  return `CGN-LTR-${year}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ------------------------------------------------------------------
// Issuance
// ------------------------------------------------------------------

export interface IssueLetterRequest {
  letterType: string;
  language: LetterLanguage;
  deliveryMode: LetterDeliveryMode;
  addresseeName?: string | null;
  addresseeInstitution?: string | null;
  purpose?: string | null;
  travelStart?: string | null; // ISO date
  travelEnd?: string | null;
  destination?: string | null;
}

export interface IssueLetterActor {
  userId: string;
  orgId: string;
  userName: string;
}

export type IssueLetterFailure = {
  ok: false;
  error:
    | "unknown-type"
    | "unknown-language"
    | "no-entity"
    | "no-salary-data"
    | "travel-dates-required"
    | "no-signatory-email"
    | "no-signing-assets"
    | "no-signatory";
  message: string;
};

export type IssueLetterSuccess = {
  ok: true;
  issuanceId: string;
  refNumber: string;
  status: string;
  documentId: string;
  fileName: string;
  emailVia: string | null;
  emailTo: string | null;
  delivered: boolean;
  entityName: string;
  signatoryName: string | null;
};

export type IssueLetterResult = IssueLetterFailure | IssueLetterSuccess;

/** Preview payload for the confirm step (no side effects). */
export async function previewLetterIssue(
  orgId: string,
  emp: EmployeeRow,
  req: IssueLetterRequest,
): Promise<IssueLetterFailure | {
  ok: true;
  entity: SigningEntity;
  entityVia: EntityResolution["via"];
  salary: { monthly: number; annual: number; currency: string } | null;
}> {
  const def = letterTypeById(req.letterType);
  if (!def) return { ok: false, error: "unknown-type", message: `Unknown letter type "${req.letterType}".` };
  if (!["en", "ar", "tr"].includes(req.language)) {
    return { ok: false, error: "unknown-language", message: `Unsupported language "${req.language}".` };
  }
  if (def.travelDates && (!req.travelStart || !req.travelEnd)) {
    return {
      ok: false,
      error: "travel-dates-required",
      message: "Travel visa letters need the trip start and end dates.",
    };
  }
  const resolution = await resolveEmployingEntity(orgId, emp);
  if (!resolution.entity) {
    return {
      ok: false,
      error: "no-entity",
      message:
        "No signing entity is configured for the firm yet. Ask a partner to set up the legal-entity registry first.",
    };
  }
  const salary = resolveTotalSalary(emp);
  if (def.salaryBearing && !salary) {
    return {
      ok: false,
      error: "no-salary-data",
      message:
        "Your compensation record has no salary on file yet, so a salary-bearing letter can't be issued. Ask HR to complete your payroll record.",
    };
  }
  if (!resolution.entity.signatoryName) {
    return {
      ok: false,
      error: "no-signatory",
      message: `${resolution.entity.name} has no letter signatory configured yet, so letters can't be issued under it. Ask a partner to configure the letter signatory in Firm Profile → Signing entities.`,
    };
  }
  if (req.deliveryMode === "digital") {
    // Digital letters are described as signed — never issue one without the
    // configured signature + stamp assets (an unsigned "signed" letter would
    // be dishonest and useless to the recipient institution).
    if (!resolution.entity.signatureFileRef || !resolution.entity.stampFileRef) {
      return {
        ok: false,
        error: "no-signing-assets",
        message: `${resolution.entity.name} has no ${!resolution.entity.signatureFileRef ? "signature" : "stamp"} image uploaded yet, so digitally signed letters can't be issued. Choose wet-signature delivery instead, or ask a partner to upload the signing assets in Firm Profile.`,
      };
    }
  }
  if (req.deliveryMode === "wet_signature") {
    if (!resolution.entity.signatoryEmail) {
      return {
        ok: false,
        error: "no-signatory-email",
        message: `${resolution.entity.name}'s signatory has no email configured — wet-signature delivery isn't available. Choose digital delivery or ask a partner to add the signatory's email.`,
      };
    }
  }
  return { ok: true, entity: resolution.entity, entityVia: resolution.via, salary };
}

export async function issueLetter(
  actor: IssueLetterActor,
  emp: EmployeeRow,
  req: IssueLetterRequest,
): Promise<IssueLetterResult> {
  const preview = await previewLetterIssue(actor.orgId, emp, req);
  if (!preview.ok) return preview;
  const def = letterTypeById(req.letterType)!;
  const entity = preview.entity;
  const salary = preview.salary;

  const idInfo = await lookupIdNumber(actor.orgId, emp.id);
  const issueDateIso = new Date().toISOString().slice(0, 10);

  // Unique reference (org-scoped unique index; retry on the off chance).
  let refNumber = newRefNumber();
  for (let i = 0; i < 3; i++) {
    const [dup] = await db
      .select({ id: atelierLetterIssuances.id })
      .from(atelierLetterIssuances)
      .where(
        and(
          eq(atelierLetterIssuances.orgId, actor.orgId),
          eq(atelierLetterIssuances.refNumber, refNumber),
        ),
      );
    if (!dup) break;
    refNumber = newRefNumber();
  }

  const ctx: LetterContext = {
    letterType: req.letterType,
    language: req.language,
    refNumber,
    issueDateIso,
    employeeName: emp.fullName,
    gender: (emp.gender as LetterContext["gender"]) ?? "unspecified",
    jobTitle: emp.title ?? null,
    startDateIso: emp.startDate ?? null,
    idNumber: idInfo?.idNumber ?? null,
    idKind: idInfo?.idKind ?? null,
    nationality: emp.nationality ?? null,
    entityName: entity.name,
    entityAddress: entity.registeredAddress || entity.officeAddress || "",
    salaryMonthly: def.salaryBearing && salary ? salary.monthly : null,
    salaryAnnual: def.salaryBearing && salary ? salary.annual : null,
    currency: salary?.currency ?? null,
    addresseeName: req.addresseeName?.trim() || null,
    addresseeInstitution: req.addresseeInstitution?.trim() || null,
    purpose: req.purpose?.trim() || null,
    travelStartIso: req.travelStart ?? null,
    travelEndIso: req.travelEnd ?? null,
    destination: req.destination?.trim() || null,
    hrEmail: HR_VERIFICATION_EMAIL,
    signatoryName: entity.signatoryName || null,
    signatoryTitle: entity.signatoryTitle || null,
  };
  const content = buildLetterContent(ctx);

  const wet = req.deliveryMode === "wet_signature";
  const [signaturePng, stampPng] = wet
    ? [null, null]
    : await Promise.all([
        entity.signatureFileRef ? loadPersonDocBytes(entity.signatureFileRef) : null,
        entity.stampFileRef ? loadPersonDocBytes(entity.stampFileRef) : null,
      ]);

  const pdf = await generateLetterPdf({
    content,
    language: req.language,
    refNumber,
    issueDateText: formatLetterDate(issueDateIso, req.language),
    entityName: entity.name,
    entityAddress: ctx.entityAddress,
    signatoryName: entity.signatoryName || null,
    signatoryTitle: entity.signatoryTitle || null,
    signaturePng,
    stampPng,
    embedSignature: !wet,
  });

  const fileName = `${refNumber} - ${def.label.replace(/[/\\:*?"<>|]/g, "-")}.pdf`;
  const { fileRef, sizeBytes } = await storePersonDocBytes(pdf, "application/pdf");

  const documentId = rid("pdoc");
  await db.insert(atelierPersonDocuments).values({
    id: documentId,
    orgId: actor.orgId,
    personType: "employee",
    personId: emp.id,
    kind: LETTER_DOC_KIND,
    title: `${def.label} (${refNumber})`,
    fileRef,
    fileName,
    mime: "application/pdf",
    sizeBytes,
    docNumber: refNumber,
    issuedAt: issueDateIso,
    uploadedByUserId: actor.userId,
    createdByUserId: actor.userId,
  });

  // Delivery ---------------------------------------------------------
  let emailVia: string | null = null;
  let emailTo: string | null = null;
  const attachment = {
    filename: fileName,
    content: pdf.toString("base64"),
  };
  if (wet) {
    emailTo = entity.signatoryEmail;
    const { html, text, attachments } = buildCogniriseEmail({
      title: "Letter awaiting your wet signature",
      greeting: `Dear ${entity.signatoryName},`,
      paragraphs: [
        `${emp.fullName} has requested a ${def.label.toLowerCase()} (reference ${refNumber}).`,
        "The letter is attached WITHOUT the digital signature and stamp. Please print it, sign and stamp it, and hand it to the employee in person.",
        `The employee has been told to collect it from you. Reference: ${refNumber}.`,
      ],
    });
    const sent = await sendEmail({
      to: emailTo,
      subject: `[Action needed] Wet signature — ${def.label} for ${emp.fullName} (${refNumber})`,
      html,
      text,
      sender: "system",
      attachments: [...attachments, attachment],
    });
    emailVia = sent.via;
  } else {
    emailTo = emp.email;
    const { html, text, attachments } = buildCogniriseEmail({
      title: "Your requested letter is ready",
      greeting: `Dear ${emp.preferredName || emp.fullName},`,
      paragraphs: [
        `Your ${def.label.toLowerCase()} (reference ${refNumber}) is attached, signed on behalf of ${entity.name}.`,
        "A copy is also stored with your documents in Atelier, so you can re-download it any time.",
      ],
    });
    const sent = await sendEmail({
      to: emailTo,
      subject: `${def.label} — ${refNumber}`,
      html,
      text,
      sender: "system",
      attachments: [...attachments, attachment],
    });
    emailVia = sent.via;
  }

  const status = wet ? "sent_to_signatory" : "issued";
  const issuanceId = rid("ltr");
  await db.insert(atelierLetterIssuances).values({
    id: issuanceId,
    orgId: actor.orgId,
    userId: actor.userId,
    personId: emp.id,
    letterType: req.letterType,
    language: req.language,
    deliveryMode: req.deliveryMode,
    addresseeName: ctx.addresseeName,
    addresseeInstitution: ctx.addresseeInstitution,
    purpose: ctx.purpose,
    travelStart: ctx.travelStartIso,
    travelEnd: ctx.travelEndIso,
    refNumber,
    entityId: entity.id,
    entityName: entity.name,
    signatoryName: entity.signatoryName || null,
    signatoryTitle: entity.signatoryTitle || null,
    status,
    emailVia,
    emailTo,
    documentId,
    fileName,
  });

  return {
    ok: true,
    issuanceId,
    refNumber,
    status,
    documentId,
    fileName,
    emailVia,
    emailTo,
    delivered: emailVia === "resend",
    entityName: entity.name,
    signatoryName: entity.signatoryName || null,
  };
}
