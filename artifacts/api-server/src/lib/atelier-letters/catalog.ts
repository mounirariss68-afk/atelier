/**
 * Task #845 — Employment & salary letter catalog.
 *
 * Nine self-service letter/certificate types employees can request via
 * Riser or the /me API. Each type maps to a code template (templates.ts)
 * in English, Arabic and Turkish. `salaryBearing` types state the total
 * salary (monthly + annual) — never a component breakdown. `travelDates`
 * types require a travel window (visa letters).
 */

export type LetterLanguage = "en" | "ar" | "tr";
export type LetterDeliveryMode = "digital" | "wet_signature";

export interface LetterTypeDef {
  id: string;
  label: string;
  /** Short chat-facing hint of when to use this type. */
  hint: string;
  salaryBearing: boolean;
  travelDates: boolean;
}

export const LETTER_TYPES: readonly LetterTypeDef[] = [
  {
    id: "salary_cert_bank_loan",
    label: "Salary certificate — bank loan",
    hint: "for a bank loan application",
    salaryBearing: true,
    travelDates: false,
  },
  {
    id: "salary_cert_mortgage",
    label: "Salary certificate — mortgage / home finance",
    hint: "for a mortgage or home-finance application",
    salaryBearing: true,
    travelDates: false,
  },
  {
    id: "salary_cert_credit_card",
    label: "Salary certificate — credit card",
    hint: "for a credit card application",
    salaryBearing: true,
    travelDates: false,
  },
  {
    id: "salary_cert_generic",
    label: "Salary certificate — generic",
    hint: "general salary certificate (To Whom It May Concern)",
    salaryBearing: true,
    travelDates: false,
  },
  {
    id: "employment_verification",
    label: "Employment verification letter (no salary)",
    hint: "confirms employment without salary — landlords, tenancy, general",
    salaryBearing: false,
    travelDates: false,
  },
  {
    id: "noc_business_travel_visa",
    label: "No-objection letter — business travel visa",
    hint: "employer-sponsored business trip visa (NOC)",
    salaryBearing: false,
    travelDates: true,
  },
  {
    id: "noc_personal_travel_visa",
    label: "No-objection letter — personal travel visa",
    hint: "personal trip visa NOC (approved leave, self-funded)",
    salaryBearing: false,
    travelDates: true,
  },
  {
    id: "salary_transfer_letter",
    label: "Salary transfer letter — bank",
    hint: "salary domiciliation to a bank account (UAE banks)",
    salaryBearing: true,
    travelDates: false,
  },
  {
    id: "employment_salary_government",
    label: "Employment + salary certificate — government / immigration",
    hint: "residence or family sponsorship, immigration authorities",
    salaryBearing: true,
    travelDates: false,
  },
] as const;

export const LETTER_TYPE_IDS = new Set(LETTER_TYPES.map((t) => t.id));
export const LETTER_LANGUAGES: readonly LetterLanguage[] = ["en", "ar", "tr"];

export function letterTypeById(id: string): LetterTypeDef | null {
  return LETTER_TYPES.find((t) => t.id === id) ?? null;
}
