/**
 * Tabellio adapter stub for The Atelier — Codex (CLM).
 *
 * Tabellio is the regional (GCC) e-sign provider Cognirise uses when a
 * counterparty refuses DocuSign or when a deal mandates UAE-PASS
 * routing. Same shape as the DocuSign adapter so the E-Sign
 * Orchestrator can swap providers without branching.
 *
 * When `ATELIER_TABELLIO_ENABLED=1` is set, this stub throws so we
 * never silently mock-out a real send.
 */

import { randomBytes } from "node:crypto";
import type {
  DocusignRecipient,
  DocusignSendArgs,
  DocusignWebhookEvent,
} from "./docusign.js";

export type TabellioRecipient = DocusignRecipient;
export type TabellioSendArgs = DocusignSendArgs;

export interface TabellioSendResult {
  provider: "tabellio";
  envelopeId: string;
  status: "sent" | "voided" | "completed";
  sentAt: string;
  routingOrder: Array<{ partyId: string; order: number; signerEmail: string }>;
  warning?: string;
}

const LIVE_ENABLED = process.env.ATELIER_TABELLIO_ENABLED === "1";

export async function sendEnvelope(
  args: TabellioSendArgs,
): Promise<TabellioSendResult> {
  if (LIVE_ENABLED) {
    throw new Error(
      "[atelier-codex/tabellio] Real Tabellio integration is not yet wired. " +
        "Unset ATELIER_TABELLIO_ENABLED until production credentials are configured.",
    );
  }
  if (args.recipients.length === 0) {
    throw new Error(
      "[atelier-codex/tabellio] Refusing to send envelope with zero recipients.",
    );
  }
  for (const r of args.recipients) {
    if (!r.signerEmail.includes("@")) {
      throw new Error(
        `[atelier-codex/tabellio] Recipient ${r.partyId} has unresolved email "${r.signerEmail}".`,
      );
    }
  }
  const envelopeId = `tb_${randomBytes(8).toString("hex")}`;
  return {
    provider: "tabellio",
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
      "Mock Tabellio envelope — no real notification was sent. Audit trail records the intent only.",
  };
}

export type TabellioWebhookEvent = DocusignWebhookEvent;

export function reconcileWebhook(
  event: TabellioWebhookEvent,
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
