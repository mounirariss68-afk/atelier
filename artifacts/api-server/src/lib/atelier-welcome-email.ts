import { sendEmail, type EmailSender } from "./email";
import { logger } from "./logger";

export type WelcomeEmailStatus = "sent" | "failed" | "not_configured";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface WelcomeEmailArgs {
  fullName: string;
  email: string;
  /**
   * One-time activation link (short TTL, single use). The joiner opens it
   * to choose their own password — no credentials travel by email.
   */
  activationUrl?: string | null;
  /** Human-readable validity window for the activation link, e.g. "72 hours". */
  activationValidity?: string;
  workerType: "employee" | "contractor";
  /** Absolute origin of the portal (from the request Origin header), if known. */
  signInUrl?: string | null;
  /** Task #545 — who is sending: the onboarding HR user, or "system". */
  sender: EmailSender;
}

export function buildWelcomeEmailHtml(args: WelcomeEmailArgs): string {
  const firstName = esc(args.fullName.trim().split(/\s+/)[0] || "there");
  const roleLine =
    args.workerType === "employee"
      ? "We're delighted to welcome you to the team as an employee."
      : "We're delighted to be working with you as a contractor.";
  const signInBlock = args.signInUrl
    ? `<p style="margin:24px 0;"><a href="${esc(args.signInUrl)}" style="display:inline-block;background:#0b1f3a;color:#c9a24b;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Sign in to The Atelier</a></p>`
    : `<p style="margin:24px 0;">Sign in to The Atelier — the Cognirise portal — using the link your onboarding contact shares with you.</p>`;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f2;font-family:Georgia,'Times New Roman',serif;color:#1c1c1c;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <div style="background:#0b1f3a;border-radius:8px 8px 0 0;padding:28px 32px;">
        <div style="color:#c9a24b;font-size:20px;letter-spacing:2px;font-weight:600;">COGNIRISE</div>
        <div style="color:#e8e6e1;font-size:13px;margin-top:4px;letter-spacing:1px;">THE ATELIER — EMPLOYEE PORTAL</div>
      </div>
      <div style="background:#ffffff;border-radius:0 0 8px 8px;padding:32px;">
        <p style="font-size:16px;">Dear ${firstName},</p>
        <p>Welcome to Cognirise. ${roleLine}</p>
        <p>Your workspace in The Atelier is ready. Your sign-in email is:</p>
        <div style="background:#f7f5f0;border:1px solid #e4ddcf;border-radius:6px;padding:16px 20px;margin:20px 0;font-family:Menlo,Consolas,monospace;font-size:14px;">
          <div><span style="color:#6b6b6b;">Email:</span> ${esc(args.email)}</div>
        </div>
        ${
          args.activationUrl
            ? `<p style="margin:24px 0;"><a href="${esc(args.activationUrl)}" style="display:inline-block;background:#0b1f3a;color:#c9a24b;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Activate your account</a></p>
        <p style="font-size:14px;color:#444;">This activation link is valid for ${esc(args.activationValidity ?? "72 hours")} and can be used once. It lets you choose your own password — we never send passwords by email.</p>`
            : `<p style="font-size:14px;color:#444;">Your onboarding contact will share a one-time activation link with you so you can choose your own password — we never send passwords by email.</p>`
        }
        ${signInBlock}
        <p style="font-weight:600;margin-bottom:8px;">Getting started</p>
        <ol style="margin:0 0 20px;padding-left:20px;color:#333;">
          <li style="margin-bottom:6px;">Open your activation link and set your password.</li>
          <li style="margin-bottom:6px;">Review and complete your profile.</li>
          <li style="margin-bottom:6px;">Explore your Time and Expenses tabs.</li>
        </ol>
        <p>If anything looks off or you have questions, just reply to this email or reach out to your onboarding contact.</p>
        <p style="margin-top:28px;">Warm regards,<br/>The Cognirise team</p>
      </div>
      <p style="text-align:center;color:#9a9a9a;font-size:12px;margin-top:16px;">Cognirise — The Atelier</p>
    </div>
  </body>
</html>`;
}

/**
 * Best-effort welcome email for a newly onboarded joiner. Never throws;
 * returns a status the caller can surface to the onboarding HR user.
 * "not_configured" means email delivery isn't set up (log-only mode), so
 * the temporary password must be shared manually.
 */
export async function sendJoinerWelcomeEmail(
  args: WelcomeEmailArgs,
): Promise<WelcomeEmailStatus> {
  try {
    const result = await sendEmail({
      sender: args.sender,
      to: args.email,
      subject: "Welcome to Cognirise — your Atelier login details",
      html: buildWelcomeEmailHtml(args),
    });
    if (result.via !== "resend") {
      // sendEmail returns ok:true in log-only mode; that still means the
      // joiner did NOT receive anything.
      return result.ok ? "not_configured" : "failed";
    }
    return result.ok ? "sent" : "failed";
  } catch (err) {
    logger.warn({ err, to: args.email }, "Joiner welcome email failed");
    return "failed";
  }
}
