/**
 * Task #645 — Offline vCard builder for the employee business-card QR code.
 *
 * The QR encodes this vCard string DIRECTLY (no hosted page, no server round
 * trip), so a customer scanning a printed card saves the contact instantly,
 * even with no network. Only PUBLIC, card-safe fields are ever included —
 * never compensation, IBAN, or other restricted data.
 */

export {
  buildContactVCard as buildVCard,
  canonicalPhoneValue as telValue,
} from "@workspace/contact-card";
export type {
  ContactCardPhone as VCardCell,
  ContactCardInput as VCardInput,
} from "@workspace/contact-card";

/** Sanitise a name into a safe download filename stem. */
export function vcardFilename(fullName: string): string {
  const stem =
    fullName
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "") || "contact";
  return `${stem}.vcf`;
}
