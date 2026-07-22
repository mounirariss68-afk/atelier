/**
 * Send a sample of the standard Cognirise email template ("Navy Statement",
 * founder-selected in Task #549) for a visual check in a real inbox. Run:
 *   pnpm exec tsx scripts/email-design-test.ts
 * Optionally set EMAIL_TEST_TO to override the recipient (Resend testing
 * mode only delivers to the account-owner inbox).
 */
import { sendEmail, getEmailDeliveryStatus } from "../src/lib/email";
import { buildCogniriseEmail } from "../src/lib/cognirise-email-templates";

const TO = process.env["EMAIL_TEST_TO"] ?? "mounir@cognirise.ai";

async function main() {
  const status = await getEmailDeliveryStatus();
  console.log("delivery status:", JSON.stringify(status));
  if (!status.configured) {
    console.error("ABORT: email is in log-only mode — nothing would be delivered.");
    process.exit(1);
  }
  const built = buildCogniriseEmail({
    title: "Your Q3 engagement review is ready",
    greeting: "Dear Mounir,",
    paragraphs: [
      "The quarterly review pack for your active engagements has been prepared and is ready in The Atelier. It covers delivery status, commercial performance and the outlook for the next quarter across all workstreams.",
      "Please take a moment to review it before Thursday's partner meeting so any adjustments can be discussed with the team in advance.",
    ],
    cta: { label: "Open the review", url: "https://www.cognirise.ai" },
    footerText: "Cognirise — The Atelier · This is a design test email.",
  });
  const res = await sendEmail({
    sender: "system",
    to: TO,
    subject: "Cognirise standard email template — sample",
    html: built.html,
    text: built.text,
    attachments: built.attachments,
  });
  console.log("result:", JSON.stringify(res));
  if (!res.ok || res.via !== "resend") {
    console.error("NOT DELIVERED");
    process.exit(1);
  }
  console.log("Sample delivered via Resend.");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
