# The Atelier — Privacy Policy

**Effective date:** July 23, 2026
**Applies to:** The Atelier web portal and the Atelier mobile app (iOS), operated by Cognirise.

The Atelier is a private, invite-only internal portal for Cognirise's partners, employees, and contractors. There is no public sign-up: every account is created and managed by Cognirise for its own workforce. This policy explains, in plain language, what data the app handles, why, who processes it, how long it is kept, and what rights you have.

## 1. Who we are

Cognirise operates The Atelier for its own internal business use. For anything related to your data or this policy, contact us at **support@cognirise.ai**.

## 2. What data we collect

Because The Atelier is a workplace tool, the data in it is business data tied to your work account:

- **Account & profile data** — your name, work email, job title, role, profile photo, business contact details (phone numbers, office address) used for your digital business card.
- **Work content** — client accounts, opportunities, engagements, meetings, tasks, notes, and documents you and your colleagues create in the portal.
- **Expenses & receipts** — expense claims you submit, including photos of receipts captured with your device camera or attached from your photo library, and invoice PDFs.
- **Calendar & email metadata (optional)** — if you connect your Microsoft 365 account, we read your calendar (and send meeting invitations on your behalf) through Microsoft Graph. Connecting is optional and you can disconnect at any time.
- **HR & personal documents** — documents your employer holds about you (for example your employment contract, payslips, or identity documents) are viewable by you and by authorised HR staff, under strict role-based access controls.
- **Chat with the AI assistant** — messages and attachments you send to the built-in assistant.
- **Technical data** — login events, session tokens (stored hashed), IP address in security audit logs, and standard server logs needed to keep the service secure.

We do **not** collect location data, and the app contains **no advertising, analytics, or tracking SDKs**.

## 3. How we use your data

- To provide the portal's features: CRM, expenses, calendar, documents, chat, and self-service HR.
- To secure the service: authentication, session management, rate limiting, and audit logging.
- To operate the AI assistant and document search: your queries and relevant excerpts of firm documents are processed by our AI providers (see below) solely to answer your requests. AI providers are used under business terms that do not permit them to train their models on our data.
- We never sell your data, share it with data brokers, or use it for advertising.

## 4. Third-party processors

We use a small number of service providers to run The Atelier. Each processes data only on our instructions:

| Processor | Purpose |
|---|---|
| **Replit** | Application hosting and database infrastructure |
| **Anthropic / OpenAI-class LLM providers** | Powering the AI assistant, document understanding, and receipt reading |
| **Microsoft (Graph API)** | Calendar sync and meeting invitations, only if you connect Microsoft 365 |
| **Resend** | Sending transactional emails (e.g. meeting invitations, notifications) |
| **DocuSeal** | Electronic signing of contracts and agreements |
| **People Data Labs** | Enrichment of public business information about client organisations (not about Cognirise staff) |

## 5. Retention

- Business records (accounts, engagements, documents, expenses) are retained for as long as Cognirise needs them for its business and legal obligations.
- **Receipt scans:** the raw machine-read (OCR) payload extracted from a receipt is automatically redacted **90 days** after processing; the expense record itself and its summary are kept for accounting purposes.
- Login sessions expire automatically after 7 days; expired sessions are deleted.
- When an account is deactivated (for example when someone leaves the firm), its login is disabled immediately and all active sessions are revoked.

## 6. Security

- All traffic is encrypted in transit (HTTPS/TLS). On mobile, your session token is stored in the operating system's secure keychain.
- Passwords are stored only as salted scrypt hashes; session tokens are stored only as SHA-256 digests.
- Access to data inside the portal is governed by role-based access controls and database-level row security; sensitive HR and financial data is restricted to authorised roles.
- Security-relevant actions (logins, password changes, permission changes) are written to an audit log.

## 7. Your rights

Depending on where you are located, you may have rights to access, correct, export, or delete your personal data, and to object to or restrict certain processing. Because your account is provided by your employer, some requests (for example deleting employment records) are handled through Cognirise's HR processes. To exercise any right, email **support@cognirise.ai** — we respond within 30 days.

Accounts cannot be created or deleted from within the app; they are provisioned and removed by Cognirise. If you leave the firm, your access is revoked and your personal data is handled according to Cognirise's employment-records retention obligations.

## 8. Children

The Atelier is a workplace tool for Cognirise's workforce and is not directed at, or available to, children.

## 9. Changes to this policy

If we materially change this policy, we will update the effective date above and notify users inside the portal.

## 10. Contact

Questions or requests: **support@cognirise.ai**
