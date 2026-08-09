---
name: Founder security alerts
description: Durable decisions behind founder email alerts on suspicious sign-in activity.
---

- Alerting is fire-and-forget from the auth routes — it must never delay or fail a login response.
- Debounce/burst state is in-memory by decision; a process restart may re-send one alert, which is accepted. Don't "fix" this by moving it into the DB without reason.
- **Deep-link contract:** alert emails and the Admin Security Log console share URL query param names; any rename must change both the server email builder and the console's prefill. The regression probe (`test:security-alerts`) pins this.
- Alerts for accounts resolving to no org are intentionally skipped — no tenant to route to; the audit log still records the raw failures.
- A single failed attempt may advance both the per-account and per-IP burst windows but must raise at most one alert. **Why:** the same burst otherwise double-emails founders.
- Probes assert via the lib's test hook instead of sending email (sendEmail `via:"log-only"` ≠ delivered), keeping the suite offline.
