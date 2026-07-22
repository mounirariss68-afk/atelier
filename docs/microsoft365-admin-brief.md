# Microsoft 365 Connection for The Atelier — IT Admin Brief

**Prepared for:** Microsoft 365 / Entra ID administrator
**Requested by:** Cognirise (The Atelier — internal employee portal & CRM)
**Date:** July 2026

## What we are asking for

The Atelier (Cognirise's internal web application) needs a one-time **app registration in Microsoft Entra ID** so that individual employees can voluntarily link their own Microsoft 365 work account to the portal. Once linked, the portal reads that employee's own calendar (and, in a later phase, selected email metadata and Teams meeting transcripts) to automate CRM housekeeping.

Key security properties of the design:

- **Delegated permissions only.** The app acts on behalf of the signed-in employee and can only access data that employee can already see. No application-level (tenant-wide) mailbox access is requested.
- **Opt-in per employee.** Each user explicitly clicks "Connect Microsoft 365" inside the portal and completes the standard Microsoft sign-in. They can disconnect at any time, which deletes their stored tokens.
- **Least privilege, phased.** Phase 1 requests calendar read only. Later phases (email, Teams transcripts) will come back for the additional scopes listed below — you can consent to everything at once or phase by phase.

## Setup steps (approx. 15 minutes)

1. **Create the app registration**
   - Entra admin center → Identity → Applications → App registrations → **New registration**
   - Name: `Cognirise Atelier`
   - Supported account types: **Accounts in this organizational directory only** (single tenant)
   - Redirect URI (type **Web**) — add both:
     - `https://<production-domain>/api/atelier/me/msauth/callback`
     - `https://<development-domain>/api/atelier/me/msauth/callback`
     - (Cognirise will confirm the exact URLs before go-live.)

2. **Add API permissions** (Microsoft Graph → **Delegated**):

   | Scope | Phase | Purpose |
   |---|---|---|
   | `openid`, `profile`, `offline_access` | 1 | Sign-in and refresh tokens |
   | `User.Read` | 1 | Basic profile of the connecting user |
   | `Calendars.Read` | 1 | Read the user's own calendar |
   | `Calendars.ReadWrite` | 1 | Create calendar events (with Teams links) when an employee books an internal meeting from the portal; supersedes `Calendars.Read` |
   | `Mail.Read` | 2 | Read the user's own mail (client-thread matching) |
   | `OnlineMeetings.Read` | 2 | Look up the user's own Teams meetings |
   | `OnlineMeetingTranscript.Read.All` (delegated) | 2 | Read transcripts of meetings the user organized/attended |

   Then click **Grant admin consent** for the tenant (this suppresses per-user consent prompts and is required for the transcript scope).

3. **Create a client secret**
   - Certificates & secrets → **New client secret** (suggest 12–24 month expiry; calendar a renewal reminder).

4. **Hand back to Cognirise (securely):**
   - Application (client) ID
   - Directory (tenant) ID
   - Client secret value
   - These will be stored as encrypted environment secrets in the portal's hosting platform — never in source code.

5. **Optional (phase 2, for transcripts):** ensure Teams meeting **transcription is allowed** in the Teams admin center meeting policy for the relevant users; without it there is nothing to read.

## What the portal does with the data

- Shows each employee their own upcoming meetings inside the portal, linked to client records.
- Automatically logs client meetings/emails as CRM activity entries (metadata + AI-generated summaries; the employee sees what is logged).
- Generates AI summaries and action items from Teams transcripts of client meetings the employee attended.
- Books **internal meetings** on behalf of the organizing employee: when an employee schedules an internal meeting from the portal (or via its chat assistant), the portal creates one calendar event in *that employee's own* calendar and invites the selected colleagues; Microsoft delivers the invitations and a Teams link is attached for online meetings. This is the only write the portal performs (`Calendars.ReadWrite`).
- **It does not**: access other employees' mailboxes, send mail as users, delete Microsoft 365 data, or expose one employee's mailbox/calendar to another. Colleague availability checks read only the calendars of employees who have themselves connected Microsoft 365.

> **Note for already-connected users:** employees who linked their account before `Calendars.ReadWrite` was granted will be prompted in the portal to reconnect once, so their token picks up the new scope.

## High-value use cases planned on top of this connection

| # | Use case | What it automates | Phase |
|---|---|---|---|
| 1 | Meeting-aware dashboard | Each employee's day/week of meetings inside the portal, with client context attached ("3pm — Ahmed · Al Futtaim, Discovery stage") | 1 |
| 2 | Auto-logged client touchpoints | Meetings (and later, email threads) with known client contacts become CRM activity entries automatically — no manual logging | 1–2 |
| 3 | Pre-meeting briefing | Before an external meeting, the portal assembles a brief: recent activity, open opportunities, outstanding tasks for that client | 1 |
| 4 | Teams transcript → AI summary | After a recorded/transcribed client call, the portal fetches the transcript and produces a summary + action items on the client record | 2 |
| 5 | Email → task extraction | AI scans client threads and proposes follow-up tasks ("client asked for revised proposal by Thursday") for one-click acceptance | 2 |
| 6 | Timesheet hints | Suggests timesheet entries from calendar history ("4 hours of Al Futtaim meetings Tuesday — log them?") | 2 |
| 7 | Contract follow-up nudges | Detects counterparty replies to sent contracts and surfaces them on the contract page | 2 |

## Data handling

- Refresh tokens are stored encrypted at rest, one row per employee, deleted on disconnect.
- Calendar/email data is fetched on demand; only CRM-relevant derivatives (meeting entries, summaries, action items) are persisted in the portal database.
- The portal already enforces per-role access controls; Microsoft-derived data inherits the same controls as the client records it attaches to.

## Questions

Contact Mounir (mounir@cognirise.ai). Happy to walk through the registration together on a call.
