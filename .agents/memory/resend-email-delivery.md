---
name: Resend email delivery
description: How real email delivery is configured for outbound Cognirise emails and its gotchas
---
Email delivery (agreement e-sign outcomes, assessments, scraper alerts, welcome/invoice/collections emails) goes through the shared `sendEmail` helper in the api-server.

- Credential order: Replit Resend connector (5-min cached lookup) → `RESEND_API_KEY` secret → log-only mode with a WARN per skipped email. `getEmailDeliveryStatus()` reports the mode.
- **Why defensive from-address parsing exists:** the user once pasted the API key into `RESEND_FROM` (secret still exists with that bad value; agent cannot delete secrets). `sendEmail` validates every from-address candidate against an email regex and falls back to `Cognirise <onboarding@resend.dev>` — keep that guard.
- **Resend account is in testing mode** (no verified domain): with the default `onboarding@resend.dev` sender, Resend only delivers to the account owner's address (the account-owner inbox) and 403s everyone else. Founders' @cognirise.ai inboxes won't receive mail until a domain is verified at resend.com/domains and `RESEND_FROM` is set to that domain.
- The user dismissed the Replit Resend connector; the key was provided as a plain secret instead.
- **All outbound emails use one founder-approved branded template** (`buildCogniriseEmail` in the api-server's `cognirise-email-templates.ts`, the "Navy Statement" design). It returns html/text/attachments — the logo rides as an inline `cid:` attachment, so callers must send its `attachments` (merging their own PDFs after it) and should pass `text`.
- **Logo asset naming is inverted vs intuition:** `cognirise-logo.png` = WHITE wordmark (for dark/navy backgrounds); assets named "light" mean light-mode surface, not light-colored artwork. Founder confirmed after a swapped send.
