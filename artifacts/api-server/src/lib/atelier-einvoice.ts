/**
 * Task #362 — E-invoicing channel adapters (stubs).
 *
 * Live ZATCA / FTA / Peppol crypto + access points are out of scope for
 * Wave 3; we ship deterministic sandbox adapters that:
 *   - Build a canonical payload from the Atelier invoice header + lines.
 *   - Persist payloads under the application-layer `enc:wallet:<key>` ref
 *     (no live KMS) so the schema columns are exercised end-to-end.
 *   - Return a clearance UUID + QR-code stub the route persists onto
 *     `atelier_einvoice_submission`.
 *
 * Channel selection by jurisdiction:
 *   - SA → zatca
 *   - AE → fta
 *   - EU → peppol
 *   - GLOBAL / unknown → no submission required.
 */

import crypto from "node:crypto";
import type { atelierInvoice, atelierInvoiceLine } from "@workspace/db";

export type EinvoiceChannel = "zatca" | "fta" | "peppol";

export function channelForJurisdiction(j: string): EinvoiceChannel | null {
  switch (j) {
    case "SA":
      return "zatca";
    case "AE":
      return "fta";
    case "EU":
      return "peppol";
    default:
      return null;
  }
}

export interface EinvoiceSubmitInput {
  invoice: typeof atelierInvoice.$inferSelect;
  lines: Array<typeof atelierInvoiceLine.$inferSelect>;
}

export interface EinvoiceSubmitResult {
  channel: EinvoiceChannel;
  status: "cleared" | "rejected";
  submissionPayloadRef: string;
  responsePayloadRef: string;
  clearanceUuid: string | null;
  qrCodePayload: string | null;
  rejectedReason: string | null;
}

function encRef(channel: string, invoiceId: string, kind: string): string {
  const key = `${channel}/${invoiceId}/${kind}-${Date.now().toString(36)}`;
  return `enc:wallet:${key}`;
}

function buildBaseDoc(input: EinvoiceSubmitInput) {
  const { invoice, lines } = input;
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt,
    currency: invoice.currency,
    seller: { name: "Cognirise", country: "AE" },
    buyer: invoice.billTo,
    totals: {
      subtotal: invoice.subtotal,
      vat: invoice.vatAmount,
      total: invoice.total,
    },
    lines: lines.map((l) => ({
      ord: l.ord,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      amount: l.amount,
    })),
  };
}

/**
 * Deterministic stub: hashes the canonical doc to produce a clearance
 * UUID + QR-code payload the wallet UI can render. No live ZATCA cert,
 * no live network call.
 */
export async function submitEinvoice(
  input: EinvoiceSubmitInput,
): Promise<EinvoiceSubmitResult> {
  const channel = channelForJurisdiction(input.invoice.jurisdiction);
  if (!channel) {
    return {
      channel: "peppol",
      status: "cleared",
      submissionPayloadRef: "enc:wallet:noop",
      responsePayloadRef: "enc:wallet:noop",
      clearanceUuid: null,
      qrCodePayload: null,
      rejectedReason: null,
    };
  }
  const doc = buildBaseDoc(input);
  const json = JSON.stringify(doc);
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  const clearanceUuid =
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  return {
    channel,
    status: "cleared",
    submissionPayloadRef: encRef(channel, input.invoice.id, "submission"),
    responsePayloadRef: encRef(channel, input.invoice.id, "response"),
    clearanceUuid,
    qrCodePayload: `${channel.toUpperCase()}|${input.invoice.invoiceNumber ?? input.invoice.id}|${input.invoice.total}|${clearanceUuid}`,
    rejectedReason: null,
  };
}
