export const TAX_CERTIFICATE_KINDS = [
  "tax_registration_ct",
  "tax_registration_vat",
] as const;

export type TaxCertificateKind = (typeof TAX_CERTIFICATE_KINDS)[number];

export interface TaxRegistrationPointer {
  type: string;
  certificateDocumentId?: string | null;
}

/** The registry pointer, not a document's entity_id, defines currentness. */
export function currentTaxCertificateId(
  registrations: readonly TaxRegistrationPointer[],
  kind: TaxCertificateKind,
): string | null {
  return registrations.find((registration) => registration.type === kind)
    ?.certificateDocumentId ?? null;
}

export function isCurrentTaxCertificate(
  registrations: readonly TaxRegistrationPointer[],
  kind: TaxCertificateKind,
  documentId: string,
): boolean {
  return currentTaxCertificateId(registrations, kind) === documentId;
}

export function duplicateTaxCertificateKind(
  registrations: readonly TaxRegistrationPointer[],
): TaxCertificateKind | null {
  for (const kind of TAX_CERTIFICATE_KINDS) {
    if (registrations.filter((registration) => registration.type === kind).length > 1) {
      return kind;
    }
  }
  return null;
}