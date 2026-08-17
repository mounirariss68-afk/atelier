import { sendEmail, type EmailSender } from "./email";
import { buildCogniriseEmail } from "./cognirise-email-templates";
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

const SANS = "'Inter','Segoe UI',Helvetica,Arial,sans-serif";

export function buildWelcomeEmail(args: WelcomeEmailArgs): {
  html: string;
  text: string;
  attachments: { filename: string; content: string; content_id: string }[];
} {
  const firstName = args.fullName.trim().split(/\s+/)[0] || "there";
  const roleLine =
    args.workerType === "employee"
      ? "We're delighted to welcome you to the team as an employee."
      : "We're delighted to be working with you as a contractor.";
  const activationBlock = args.activationUrl
    ? `<p style="margin:0 0 8px;font-family:${SANS};font-size:14px;color:#3a4360;">This activation link is valid for ${esc(args.activationValidity ?? "72 hours")} and can be used once. It lets you choose your own password — we never send passwords by email.</p>`
    : `<p style="margin:0 0 8px;font-family:${SANS};font-size:14px;color:#3a4360;">Your onboarding contact will share a one-time activation link with you so you can choose your own password — we never send passwords by email.</p>`;
  const signInLine = args.signInUrl
    ? `<p style="margin:0 0 16px;font-family:${SANS};font-size:14px;color:#3a4360;">You can sign in any time at <a href="${esc(args.signInUrl)}" style="color:#8A5BD6;">${esc(args.signInUrl)}</a>.</p>`
    : `<p style="margin:0 0 16px;font-family:${SANS};font-size:14px;color:#3a4360;">Sign in to Atelier — the Cognirise portal — using the link your onboarding contact shares with you.</p>`;
  const bodyHtml = `
    <div style="background:#F3F4F8;border:1px solid #E4E7F0;border-radius:8px;padding:16px 20px;margin:0 0 20px;font-family:Menlo,Consolas,monospace;font-size:14px;color:#1c2440;">
      <span style="color:#6b7490;">Email:</span> ${esc(args.email)}
    </div>
    ${activationBlock}
    ${signInLine}
    <p style="margin:16px 0 8px;font-family:${SANS};font-size:15px;font-weight:600;color:#0A1230;">Getting started</p>
    <ol style="margin:0 0 20px;padding-left:20px;font-family:${SANS};font-size:14px;line-height:1.7;color:#3a4360;">
      <li>Open your activation link and set your password.</li>
      <li>Review and complete your profile.</li>
      <li>Explore your Time and Expenses tabs.</li>
    </ol>
    <p style="margin:0 0 16px;font-family:${SANS};font-size:14px;color:#3a4360;">If anything looks off or you have questions, just reply to this email or reach out to your onboarding contact.</p>
    <p style="margin:16px 0 0;font-family:${SANS};font-size:14px;color:#3a4360;">Warm regards,<br/>The Cognirise team</p>`;
  const textLines = [
    `Dear ${firstName},`,
    "",
    `Welcome to Cognirise. ${roleLine}`,
    "",
    `Your sign-in email: ${args.email}`,
    "",
    args.activationUrl
      ? `Activate your account (valid ${args.activationValidity ?? "72 hours"}, single use): ${args.activationUrl}`
      : "Your onboarding contact will share a one-time activation link so you can choose your own password.",
    args.signInUrl ? `Sign in: ${args.signInUrl}` : "",
    "",
    "Getting started: 1) set your password 2) complete your profile 3) explore Time and Expenses.",
    "",
    "Warm regards, The Cognirise team",
  ].filter((l) => l !== "");
  return buildCogniriseEmail({
    title: "Welcome to Cognirise",
    greeting: `Dear ${firstName},`,
    paragraphs: [
      `Welcome to Cognirise. ${roleLine}`,
      "Your workspace in Atelier is ready. Your sign-in email is:",
    ],
    bodyHtml,
    cta: args.activationUrl
      ? { label: "Activate your account", url: args.activationUrl }
      : args.signInUrl
        ? { label: "Sign in to Atelier", url: args.signInUrl }
        : undefined,
    bodyText: textLines.join("\n"),
  });
}

/**
 * Best-effort welcome email for a newly onboarded joiner. Never throws;
 * returns a status the caller can surface to the onboarding HR user.
 * "not_configured" means email delivery isn't set up (log-only mode), so
 * the temporary password must be shared manually.
 */
/**
 * Task #874 — registration email for a signed partner firm's invited user.
 * The link opens the public, token-gated registration page where the
 * partner submits company legal + bank details and sets their password.
 */
export async function sendPartnerRegistrationEmail(args: {
  fullName: string;
  email: string;
  firmName: string;
  registrationUrl: string | null;
  validity: string;
  sender: EmailSender;
}): Promise<WelcomeEmailStatus> {
  try {
    const firstName = args.fullName.trim().split(/\s+/)[0] || "there";
    const bodyHtml = `
      <div style="background:#F3F4F8;border:1px solid #E4E7F0;border-radius:8px;padding:16px 20px;margin:0 0 20px;font-family:Menlo,Consolas,monospace;font-size:14px;color:#1c2440;">
        <span style="color:#6b7490;">Email:</span> ${esc(args.email)}
      </div>
      <p style="margin:0 0 8px;font-family:${SANS};font-size:14px;color:#3a4360;">${
        args.registrationUrl
          ? `This registration link is valid for ${esc(args.validity)} and can be used once. Following it, you'll confirm ${esc(args.firmName)}'s company details, provide bank details for payments, and choose your own password — we never send passwords by email.`
          : `Your Cognirise contact will share a one-time registration link with you. Following it, you'll confirm ${esc(args.firmName)}'s company details, provide bank details for payments, and choose your own password.`
      }</p>
      <p style="margin:16px 0 0;font-family:${SANS};font-size:14px;color:#3a4360;">Warm regards,<br/>The Cognirise team</p>`;
    const textLines = [
      `Dear ${firstName},`,
      "",
      `Cognirise has invited you to register ${args.firmName} on the partner portal.`,
      "",
      `Your sign-in email: ${args.email}`,
      args.registrationUrl
        ? `Complete your registration (valid ${args.validity}, single use): ${args.registrationUrl}`
        : "Your Cognirise contact will share a one-time registration link with you.",
      "",
      "Warm regards, The Cognirise team",
    ];
    const built = buildCogniriseEmail({
      title: "Complete your partner registration",
      greeting: `Dear ${firstName},`,
      paragraphs: [
        `Cognirise has invited you to register ${args.firmName} on the partner portal. Your sign-in email is:`,
      ],
      bodyHtml,
      cta: args.registrationUrl
        ? { label: "Complete your registration", url: args.registrationUrl }
        : undefined,
      bodyText: textLines.join("\n"),
    });
    const result = await sendEmail({
      sender: args.sender,
      to: args.email,
      subject: `Cognirise partner registration — ${args.firmName}`,
      html: built.html,
      text: built.text,
      attachments: built.attachments,
    });
    if (result.via !== "resend") return result.ok ? "not_configured" : "failed";
    return result.ok ? "sent" : "failed";
  } catch (err) {
    logger.warn({ err, to: args.email }, "Partner registration email failed");
    return "failed";
  }
}

export async function sendJoinerWelcomeEmail(
  args: WelcomeEmailArgs,
): Promise<WelcomeEmailStatus> {
  try {
    const built = buildWelcomeEmail(args);
    const result = await sendEmail({
      sender: args.sender,
      to: args.email,
      subject: "Welcome to Cognirise — your Atelier login details",
      html: built.html,
      text: built.text,
      attachments: built.attachments,
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
