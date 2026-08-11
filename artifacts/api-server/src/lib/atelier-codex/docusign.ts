/**
 * DocuSign adapter stub for Atelier — Codex (CLM).
 *
 * Lives behind the E-Sign Orchestrator. Real DocuSign integration is
 * out of scope for L2C Wave 1 — this stub returns synthetic envelope
 * ids and a "sent" envelope so the contract state machine can advance
 * in demo / dev environments.
 *
 * When `ATELIER_DOCUSIGN_ENABLED=1` is set, this stub will throw
 * loudly so we never silently mock-out a real send. The route layer
 * is responsible for guarding production toggles.
 */

import { randomBytes } from "node:crypto";

export interface DocusignRecipient {
  partyId: string;
  signerName: string;
  signerEmail: string;
  signerTitle: string;
  routingOrder: number;
  side: "cognirise" | "counterparty";
  role: "signer" | "witness" | "notice_party" | "observer";
}

export interface DocusignSendArgs {
  contractId: string;
  envelopeSubject: string;
  renderedBody: string;
  bodyHash: string;
  recipients: DocusignRecipient[];
}

export interface DocusignSendResult {
  provider: "docusign";
  envelopeId: string;
  status: "sent" | "voided" | "completed";
  sentAt: string;
  routingOrder: Array<{ partyId: string; order: number; signerEmail: string }>;
  warning?: string;
}

const LIVE_ENABLED = process.env.ATELIER_DOCUSIGN_ENABLED === "1";

export async function sendEnvelope(
  args: DocusignSendArgs,
): Promise<DocusignSendResult> {
  if (LIVE_ENABLED) {
    throw new Error(
      "[atelier-codex/docusign] Real DocuSign integration is not yet wired. " +
        "Unset ATELIER_DOCUSIGN_ENABLED until production credentials are configured.",
    );
  }
  if (args.recipients.length === 0) {
    throw new Error(
      "[atelier-codex/docusign] Refusing to send envelope with zero recipients.",
    );
  }
  for (const r of args.recipients) {
    if (!r.signerEmail.includes("@")) {
      throw new Error(
        `[atelier-codex/docusign] Recipient ${r.partyId} has unresolved email "${r.signerEmail}".`,
      );
    }
  }
  const envelopeId = `ds_${randomBytes(8).toString("hex")}`;
  return {
    provider: "docusign",
    envelopeId,
    status: "sent",
    sentAt: new Date().toISOString(),
    routingOrder: args.recipients
      .slice()
      .sort((a, b) => a.routingOrder - b.routingOrder)
      .map((r) => ({
        partyId: r.partyId,
        order: r.routingOrder,
        signerEmail: r.signerEmail,
      })),
    warning:
      "Mock DocuSign envelope — no real email was sent. Audit trail records the intent only.",
  };
}

export interface DocusignWebhookEvent {
  envelopeId: string;
  partyId: string;
  event:
    | "sent"
    | "delivered"
    | "signed"
    | "declined"
    | "voided"
    | "completed";
  occurredAt: string;
  evidenceUrl: string;
}

/**
 * Reconcile a webhook event onto a party. Returns the new sign_state
 * the route layer should write — or `null` to indicate no change.
 */
export function reconcileWebhook(
  event: DocusignWebhookEvent,
): {
  signState: "pending" | "sent" | "signed" | "declined" | "expired";
  signedAt: string | null;
  evidenceUrl: string;
} | null {
  switch (event.event) {
    case "sent":
    case "delivered":
      return { signState: "sent", signedAt: null, evidenceUrl: event.evidenceUrl };
    case "signed":
    case "completed":
      return {
        signState: "signed",
        signedAt: event.occurredAt,
        evidenceUrl: event.evidenceUrl,
      };
    case "declined":
      return { signState: "declined", signedAt: null, evidenceUrl: event.evidenceUrl };
    case "voided":
      return { signState: "expired", signedAt: null, evidenceUrl: event.evidenceUrl };
    default:
      return null;
  }
}
