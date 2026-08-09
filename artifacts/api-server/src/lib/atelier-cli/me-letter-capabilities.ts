/**
 * Task #845 — me.letter_request: employees request signed salary &
 * employment letters via chat (mirrors POST /me/letters).
 *
 * Identity-locked (subject is always the session persona), employees
 * only — contractors and non-roster personas get a clean, honest
 * refusal. Missing details degrade to a multi-field clarification card
 * (type / language / delivery / addressee, travel dates for visa
 * letters), never a dead-end error. Two-phase confirm surfaces which
 * entity + signatory will sign BEFORE anything is generated; the commit
 * generates the PDF, logs the issuance, stores the letter with the
 * employee's documents and emails it (honest delivery status — Resend
 * log-only mode is surfaced, never claimed as "sent").
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, atelierEmployees } from "@workspace/db";
import { defineSelfWriteCapability, selfWriteAudit } from "./me-write-capabilities.js";
import type { SelfSubject } from "./me-capabilities.js";
import type { ToolResult } from "./index.js";
import {
  LETTER_TYPES,
  letterTypeById,
  type LetterDeliveryMode,
  type LetterLanguage,
} from "../atelier-letters/catalog.js";
import {
  issueLetter,
  previewLetterIssue,
} from "../atelier-letters/service.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const EMPLOYEES_ONLY: ToolResult = {
  ok: false,
  errorCode: "employees_only",
  errorMessage:
    "Official employment and salary letters are issued to employees only — your login isn't linked to an employee roster record, so I can't issue one. HR can help if you believe this is wrong.",
};

// ------------------------------------------------------------------
// Tolerant option parsing — the clarification resolver merges free-text
// answers, so accept catalog ids, labels, or loose descriptions.
// ------------------------------------------------------------------

function normalizeLetterType(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim().toLowerCase();
  const byId = LETTER_TYPES.find((t) => t.id === s);
  if (byId) return byId.id;
  const byLabel = LETTER_TYPES.find((t) => t.label.toLowerCase() === s);
  if (byLabel) return byLabel.id;
  // Loose matching on distinctive keywords.
  const has = (...words: string[]) => words.every((w) => s.includes(w));
  if (has("mortgage") || has("home", "finance")) return "salary_cert_mortgage";
  if (has("credit", "card")) return "salary_cert_credit_card";
  if (has("loan")) return "salary_cert_bank_loan";
  if (has("transfer")) return "salary_transfer_letter";
  if (has("government") || has("immigration") || has("sponsor")) return "employment_salary_government";
  if ((has("business") && (s.includes("visa") || s.includes("noc"))) ) return "noc_business_travel_visa";
  if ((has("personal") || has("holiday") || has("touris")) && (s.includes("visa") || s.includes("noc") || s.includes("travel"))) return "noc_personal_travel_visa";
  if (has("visa") || has("no objection") || has("noc")) return "noc_personal_travel_visa";
  if (has("employment") && has("salary")) return "employment_salary_government";
  if (has("employment") || has("verification") || has("landlord") || has("tenancy")) return "employment_verification";
  if (has("salary")) return "salary_cert_generic";
  return null;
}

function normalizeLanguage(raw: unknown): LetterLanguage | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (["en", "english", "inglizi", "İngilizce", "ingilizce"].includes(s)) return "en";
  if (["ar", "arabic", "العربية", "عربي", "عربى"].includes(s) || s.includes("arab")) return "ar";
  if (["tr", "turkish", "türkçe", "turkce"].includes(s) || s.includes("turk") || s.includes("türk")) return "tr";
  return null;
}

function normalizeDelivery(raw: unknown): LetterDeliveryMode | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("wet") || s.includes("hand") || s.includes("ink") || s.includes("print")) {
    return "wet_signature";
  }
  if (s.includes("digital") || s.includes("email") || s.includes("pdf") || s === "d") {
    return "digital";
  }
  return null;
}

const TYPE_OPTIONS = LETTER_TYPES.map((t) => t.label);
const LANGUAGE_OPTIONS = ["English", "Arabic", "Turkish"];
const DELIVERY_OPTIONS = [
  "Digital — signed PDF emailed to me",
  "Wet signature — hand-signed by the signatory",
];

async function loadEmployeeRow(
  subject: SelfSubject,
): Promise<typeof atelierEmployees.$inferSelect | null> {
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, subject.user.orgId),
        eq(atelierEmployees.userId, subject.user.id),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  return emp ?? null;
}

defineSelfWriteCapability({
  id: "me.letter_request",
  module: "roster",
  toolName: "request_employment_letter",
  description:
    "Request an official signed salary certificate or employment letter for the signed-in employee only (bank loan / mortgage / credit card / generic salary certificates, employment verification, business or personal travel-visa no-objection letters, salary transfer letter, government employment+salary certificate). Issued on Cognirise letterhead in English, Arabic or Turkish, signed and stamped by the employing entity's signatory, and emailed to the employee's Cognirise inbox — or, for wet-signature delivery, sent to the signatory to print, sign and hand over. NEVER refuse these requests — this tool issues the letter end-to-end.",
  slashAliases: { en: ["/request-letter"], fr: ["/demander-attestation"] },
  representativePrompts: {
    en: [
      "I need a salary certificate for my bank",
      "Get me an employment letter for my landlord",
      "I need an NOC letter for a Schengen visa",
    ],
    ar: ["أحتاج شهادة راتب للبنك"],
    fr: ["J'ai besoin d'une attestation de salaire"],
  },
  surfaceOn: ["home", "global"],
  resultCard: "entity_card",
  examplePhrases: {
    en: ["Request a salary certificate for a bank loan in English"],
    ar: ["أحتاج شهادة راتب"],
    fr: ["Demander une attestation de travail"],
  },
  inputSchema: {
    type: "object",
    properties: {
      letterType: {
        type: "string",
        description:
          "Letter type — id or label. One of: " +
          LETTER_TYPES.map((t) => `${t.id} (${t.hint})`).join("; "),
      },
      language: { type: "string", description: "en | ar | tr (English, Arabic, Turkish)" },
      deliveryMode: {
        type: "string",
        description:
          "digital (signed PDF emailed to the employee, default) or wet_signature (unsigned print sent to the signatory to hand-sign)",
      },
      addresseeName: {
        type: "string",
        description: "Addressee person/branch, blank for 'To Whom It May Concern'",
      },
      addresseeInstitution: {
        type: "string",
        description: "Institution the letter is addressed to (bank, embassy, landlord…)",
      },
      purpose: { type: "string", description: "Optional purpose line printed on the letter" },
      travelStart: { type: "string", description: "Trip start date YYYY-MM-DD (visa letters)" },
      travelEnd: { type: "string", description: "Trip end date YYYY-MM-DD (visa letters)" },
      destination: { type: "string", description: "Trip destination (visa letters, optional)" },
      confirm: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
  twoPhaseConfirm: true,
  irreversible: false,
  async runSelf(input, subject) {
    if (!subject.person || subject.person.workerType !== "employee") return EMPLOYEES_ONLY;
    // Mirror the REST guard: a contractor login erroneously linked to an
    // employee roster row must still be refused.
    if (subject.user.role === "contractor") return EMPLOYEES_ONLY;
    const emp = await loadEmployeeRow(subject);
    if (!emp) return EMPLOYEES_ONLY;

    const letterType = normalizeLetterType(input.letterType);
    const language = normalizeLanguage(input.language);
    const delivery = normalizeDelivery(input.deliveryMode) ?? (input.deliveryMode == null || input.deliveryMode === "" ? "digital" : null);

    // Carry forward everything already provided.
    const partial: Record<string, unknown> = {};
    for (const k of [
      "letterType",
      "language",
      "deliveryMode",
      "addresseeName",
      "addresseeInstitution",
      "purpose",
      "travelStart",
      "travelEnd",
      "destination",
    ] as const) {
      const v = input[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") partial[k] = v;
    }
    if (letterType) partial.letterType = letterType;
    if (language) partial.language = language;
    if (delivery) partial.deliveryMode = delivery;

    // Multi-field clarification for anything still missing.
    type ClarField = {
      field: string;
      label: string;
      hint?: string;
      options?: string[];
      inputType?: string;
      defaultValue?: string;
    };
    const missing: ClarField[] = [];
    if (!letterType) {
      missing.push({ field: "letterType", label: "Letter type", options: TYPE_OPTIONS });
    }
    if (!language) {
      missing.push({ field: "language", label: "Language", options: LANGUAGE_OPTIONS });
    }
    if (!delivery) {
      missing.push({ field: "deliveryMode", label: "Delivery", options: DELIVERY_OPTIONS });
    }
    const def = letterType ? letterTypeById(letterType) : null;
    if (def?.travelDates) {
      if (!ISO_DATE.test(String(input.travelStart ?? ""))) {
        missing.push({ field: "travelStart", label: "Trip start date", inputType: "date" });
      }
      if (!ISO_DATE.test(String(input.travelEnd ?? ""))) {
        missing.push({ field: "travelEnd", label: "Trip end date", inputType: "date" });
      }
    }
    // Offer the addressee fields alongside the first clarification only
    // (optional — blank keeps "To Whom It May Concern").
    if (missing.length > 0) {
      if (!partial.addresseeInstitution) {
        missing.push({
          field: "addresseeInstitution",
          label: "Addressed to (institution — optional)",
          hint: "Bank, embassy, landlord… blank = To Whom It May Concern",
        });
      }
      return {
        ok: true,
        data: { partial },
        clarification: {
          field: String(missing[0].field),
          question:
            "A few details for your letter — which type, language and delivery would you like?",
          tool: "request_employment_letter",
          partial,
          fields: missing,
        },
      };
    }

    const req = {
      letterType: letterType!,
      language: language!,
      deliveryMode: delivery!,
      addresseeName: typeof input.addresseeName === "string" ? input.addresseeName : null,
      addresseeInstitution:
        typeof input.addresseeInstitution === "string" ? input.addresseeInstitution : null,
      purpose: typeof input.purpose === "string" ? input.purpose : null,
      travelStart: ISO_DATE.test(String(input.travelStart ?? "")) ? String(input.travelStart) : null,
      travelEnd: ISO_DATE.test(String(input.travelEnd ?? "")) ? String(input.travelEnd) : null,
      destination: typeof input.destination === "string" ? input.destination : null,
    };

    // Preview validates entity/signatory/salary and surfaces failures as
    // clean errors (e.g. wet signature unavailable, no salary on file).
    const preview = await previewLetterIssue(subject.user.orgId, emp, req);
    if (!preview.ok) {
      return { ok: false, errorCode: preview.error.replace(/-/g, "_"), errorMessage: preview.message };
    }

    if (input.confirm !== true) {
      const langLabel = { en: "English", ar: "Arabic", tr: "Turkish" }[req.language];
      const signerBits = preview.entity.signatoryName
        ? `${preview.entity.signatoryName}${preview.entity.signatoryTitle ? ` (${preview.entity.signatoryTitle})` : ""}`
        : "the entity's authorised signatory";
      const deliveryText =
        req.deliveryMode === "wet_signature"
          ? `sent UNSIGNED to ${signerBits} to print, hand-sign, stamp and hand to you in person`
          : `signed digitally by ${signerBits} with the company stamp and emailed to your Cognirise inbox (${emp.email})`;
      const addressee =
        req.addresseeInstitution || req.addresseeName
          ? [req.addresseeName, req.addresseeInstitution].filter(Boolean).join(", ")
          : "To Whom It May Concern";
      return {
        ok: true,
        data: { preview: { ...req, entityName: preview.entity.name, entityVia: preview.entityVia } },
        confirmation: {
          summary:
            `Issue a ${def!.label.toLowerCase()} in ${langLabel}, addressed to ${addressee}, ` +
            `on ${preview.entity.name} letterhead (your employing entity, resolved via ${preview.entityVia === "payroll" ? "your payroll record" : preview.entityVia === "name_match" ? "your roster entity" : "the firm default"}), ` +
            `${deliveryText}` +
            (def!.salaryBearing ? ". It states your total salary (monthly and annual) only — no breakdown" : "") +
            (req.travelStart ? `. Travel window ${req.travelStart} → ${req.travelEnd}` : "") +
            ". Go ahead?",
          diff: {
            create: {
              table: "atelier_letter_issuances",
              values: {
                letterType: req.letterType,
                language: req.language,
                deliveryMode: req.deliveryMode,
                entity: preview.entity.name,
              },
            },
          },
          pending: {
            tool: "request_employment_letter",
            input: { ...partial, ...req, confirm: true },
          },
        },
      };
    }

    const result = await issueLetter(
      { userId: subject.user.id, orgId: subject.user.orgId, userName: subject.user.name },
      emp,
      req,
    );
    if (!result.ok) {
      return { ok: false, errorCode: result.error.replace(/-/g, "_"), errorMessage: result.message };
    }
    await selfWriteAudit({
      subject,
      entityType: "letter_issuance",
      entityId: result.issuanceId,
      action: "letter.issued",
      payload: {
        letterType: req.letterType,
        language: req.language,
        deliveryMode: req.deliveryMode,
        refNumber: result.refNumber,
        entityName: result.entityName,
        emailVia: result.emailVia,
        via: "chat",
      },
      summary: `${subject.user.name} requested ${def!.label} (${result.refNumber}) via chat`,
    });
    const deliveredNote =
      req.deliveryMode === "wet_signature"
        ? `The unsigned letter was ${result.delivered ? "emailed" : "queued"} to ${result.signatoryName} to print, sign and stamp — collect it from them in person. ` +
          (result.delivered ? "" : "Heads-up: email delivery is in test mode, so the signatory may not have received it yet — HR can resend it. ")
        : result.delivered
          ? `The signed PDF was emailed to ${result.emailTo}. `
          : `The signed PDF could not be emailed right now (delivery is in test mode) — it's saved with your documents, so you can download it from Me → Documents. `;
    return {
      ok: true,
      data: {
        id: result.issuanceId,
        label: `${def!.label} — ${result.refNumber}`,
        refNumber: result.refNumber,
        status: result.status,
        entityName: result.entityName,
        delivered: result.delivered,
        note:
          deliveredNote +
          `Reference ${result.refNumber} is printed on the letter; a copy is stored with your documents.`,
        href: "/me/profile",
        navigateTo: { path: "/me/profile", when: "on_commit" as const },
      },
    };
  },
});
