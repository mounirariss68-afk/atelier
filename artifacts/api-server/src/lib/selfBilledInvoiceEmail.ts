/**
 * Supplier email notifications for self-billed (RCTI) invoices.
 *
 * Two events close the loop for subcontractors who rarely open the
 * portal:
 *  - "approval": the invoice was approved by finance — the supplier
 *    receives the invoice PDF attached;
 *  - "remittance": the payment run was marked paid — the supplier
 *    receives remittance advice (with the updated PDF attached).
 *
 * Delivery status semantics follow the shared sendEmail helper: only
 * ok && via === "resend" means the message was actually accepted for
 * delivery; log-only mode means NOT delivered. Every attempt is
 * appended to the invoice's email_delivery jsonb log (newest last) and
 * audited, so the finance payables UI can surface honest status.
 *
 * Failures never block the calling finance action — approving an
 * invoice or marking a run paid must succeed even when email is down.
 */
import { db, atelierSelfBilledInvoices, atelierAuditEvents, type SelfBilledEmailEvent } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail, type EmailSender } from "./email";
import { buildCogniriseEmail } from "./cognirise-email-templates";
import { renderSelfBilledInvoicePdfBuffer } from "./selfBilledInvoicePdf";
import { logger } from "./logger";

type SelfBilledInvoice = typeof atelierSelfBilledInvoices.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}


type BuiltEmail = ReturnType<typeof buildCogniriseEmail>;

function approvalEmail(inv: SelfBilledInvoice): { subject: string; built: BuiltEmail } {
  return {
    subject: `Self-billed invoice ${inv.invoiceNumber} — ${inv.weekIso}`,
    built: buildCogniriseEmail({
      title: "Your self-billed invoice was approved",
      greeting: `Dear ${inv.supplierName},`,
      paragraphs: [
        `Your self-billed invoice ${inv.invoiceNumber} for the week ${inv.weekIso} has been approved by Cognirise.`,
        `Total: ${inv.currency} ${inv.totalAmount.toFixed(2)}`,
        "The invoice PDF is attached for your records. You can also view it any time in the Cognirise portal under My Pay → Self-billing.",
      ],
      footerText: "Cognirise Finance — The Atelier",
    }),
  };
}

function remittanceEmail(inv: SelfBilledInvoice): { subject: string; built: BuiltEmail } {
  const paid = inv.paidAt ? inv.paidAt.toISOString().slice(0, 10) : "today";
  return {
    subject: `Payment sent — remittance advice for ${inv.invoiceNumber}`,
    built: buildCogniriseEmail({
      title: "Payment sent — remittance advice",
      greeting: `Dear ${inv.supplierName},`,
      paragraphs: [
        `Payment for self-billed invoice ${inv.invoiceNumber} (week ${inv.weekIso}) was released on ${paid}.`,
        `Amount: ${inv.currency} ${inv.totalAmount.toFixed(2)}${inv.remittanceRef ? ` · Remittance reference: ${inv.remittanceRef}` : ""}`,
        "The updated invoice PDF is attached as your remittance advice.",
      ],
      footerText: "Cognirise Finance — The Atelier",
    }),
  };
}

/**
 * Send the supplier notification for an invoice event and record the
 * outcome on the invoice row + audit trail. Never throws.
 */
export async function notifySupplierOfInvoice(
  invoiceId: string,
  kind: "approval" | "remittance",
  sender: EmailSender,
): Promise<SelfBilledEmailEvent | null> {
  try {
    const [inv] = await db
      .select()
      .from(atelierSelfBilledInvoices)
      .where(eq(atelierSelfBilledInvoices.id, invoiceId));
    if (!inv) return null;

    let event: SelfBilledEmailEvent;
    const to = (inv.supplierEmail ?? "").trim();
    if (!to) {
      event = { kind, to: null, status: "no_email", via: "none", at: new Date().toISOString() };
    } else {
      const { subject, built } = kind === "approval" ? approvalEmail(inv) : remittanceEmail(inv);
      const pdf = await renderSelfBilledInvoicePdfBuffer(inv);
      const result = await sendEmail({
        sender,
        to,
        subject,
        html: built.html,
        text: built.text,
        attachments: [
          ...built.attachments,
          { filename: `${inv.invoiceNumber}.pdf`, content: pdf.toString("base64") },
        ],
      });
      const status: SelfBilledEmailEvent["status"] =
        result.ok && result.via === "resend" ? "sent" : result.ok ? "not_configured" : "failed";
      event = { kind, to, status, via: result.via, at: new Date().toISOString() };
    }

    await db.update(atelierSelfBilledInvoices).set({
      emailDelivery: [...(inv.emailDelivery ?? []), event],
      updatedAt: new Date(),
    }).where(eq(atelierSelfBilledInvoices.id, inv.id));
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: inv.orgId,
      entityType: "self_billed_invoice",
      entityId: inv.id,
      actorType: "system",
      actorId: "system",
      actorLabel: "Self-billing notifier",
      action: `finance.self_billing.email_${kind}`,
      payload: event as unknown as Record<string, unknown>,
      payloadSummary:
        event.status === "sent"
          ? `Emailed ${kind === "approval" ? "invoice" : "remittance advice"} ${inv.invoiceNumber} to ${event.to}.`
          : `Supplier email for ${inv.invoiceNumber} (${kind}) NOT delivered: ${event.status}.`,
    });
    return event;
  } catch (err) {
    logger.warn({ err, invoiceId, kind }, "Self-billed invoice supplier email failed");
    return null;
  }
}
