import { logger } from "./logger";

export interface EmailArgs {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
}

export async function sendEmail(args: EmailArgs): Promise<{ ok: boolean; via: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    logger.info({ to: args.to, subject: args.subject }, "Email skipped (no RESEND_API_KEY); logged only");
    return { ok: true, via: "log-only" };
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env["RESEND_FROM"] ?? "Maven AI <onboarding@resend.dev>",
        to: [args.to],
        subject: args.subject,
        html: args.html,
        attachments: args.attachments,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      logger.warn({ status: resp.status, body: txt }, "Resend email send failed; falling back to log");
      return { ok: false, via: "log-only" };
    }
    return { ok: true, via: "resend" };
  } catch (err) {
    logger.warn({ err }, "Email send error");
    return { ok: false, via: "log-only" };
  }
}
