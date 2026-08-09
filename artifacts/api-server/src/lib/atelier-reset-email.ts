import { sendEmail, type EmailSender } from "./email";
import { buildCogniriseEmail } from "./cognirise-email-templates";
import { logger } from "./logger";

export type ResetEmailStatus = "sent" | "failed" | "not_configured";

/**
 * Task #820 — password reset link email (self-service forgot-password and
 * partner-initiated resets). The link is a single-use, short-lived token —
 * no password ever travels by email.
 */
export async function sendPasswordResetEmail(args: {
  to: string;
  firstName?: string | null;
  resetUrl: string;
  /** Human-readable validity window, e.g. "60 minutes". */
  validity: string;
  /** Self-service vs partner-initiated copy. */
  initiatedBy: "self" | "partner";
  sender: EmailSender;
}): Promise<{ status: ResetEmailStatus; note: string }> {
  const greeting = args.firstName?.trim() ? `Dear ${args.firstName.trim()},` : "Hello,";
  const intro =
    args.initiatedBy === "self"
      ? "We received a request to reset the password for your Atelier account. If this wasn't you, you can safely ignore this email — your password has not changed."
      : "A founding partner has reset access to your Atelier account. Use the link below to choose a new password.";
  const { html, text, attachments } = buildCogniriseEmail({
    title: "Reset your Atelier password",
    greeting,
    paragraphs: [
      intro,
      `This link is valid for ${args.validity} and can be used once. We never send passwords by email.`,
    ],
    cta: { label: "Choose a new password", url: args.resetUrl },
  });
  try {
    const result = await sendEmail({
      to: args.to,
      subject: "Reset your Atelier password",
      html,
      text,
      attachments,
      sender: args.sender,
    });
    if (result.ok && result.via === "resend") {
      return { status: "sent", note: "Reset link emailed." };
    }
    // via "log-only" means NOT delivered (memory: sendEmail log-only semantics).
    return {
      status: "not_configured",
      note: "Email delivery is not configured — share the link through a secure channel.",
    };
  } catch (err) {
    logger.warn({ err, to: args.to }, "password reset email failed");
    return {
      status: "failed",
      note: "Email delivery failed — share the link through a secure channel.",
    };
  }
}
