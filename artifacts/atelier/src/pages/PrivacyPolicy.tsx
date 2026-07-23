import * as React from "react";
import Logo from "@/components/ui/Logo";

/**
 * Public privacy policy page — App Store submission requirement.
 * Rendered pre-auth (the AuthGate special-cases /privacypolicy); the
 * content mirrors docs/atelier-privacy-policy.md.
 */

const PROCESSORS: Array<[string, string]> = [
  ["Replit", "Application hosting and database infrastructure"],
  [
    "Anthropic / OpenAI-class LLM providers",
    "Powering the AI assistant, document understanding, and receipt reading",
  ],
  [
    "Microsoft (Graph API)",
    "Calendar sync and meeting invitations, only if you connect Microsoft 365",
  ],
  ["Resend", "Sending transactional emails (meeting invitations, notifications)"],
  ["DocuSeal", "Electronic signing of contracts and agreements"],
  [
    "People Data Labs",
    "Enrichment of public business information about client organisations (not about Cognirise staff)",
  ],
];

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 mb-2 font-mono text-xs uppercase tracking-widest text-text-faint">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-text">{children}</p>;
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="mb-1.5 text-sm leading-relaxed text-text">{children}</li>;
}

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-8 flex items-center gap-3">
          <Logo />
        </div>
        <h1 className="text-2xl font-semibold text-text">Privacy Policy</h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-widest text-text-faint">
          The Atelier — Cognirise · Effective July 23, 2026
        </p>

        <P>
          The Atelier is a private, invite-only internal portal for Cognirise's
          partners, employees, and contractors — available on the web and as
          the Atelier iOS app. There is no public sign-up: every account is
          created and managed by Cognirise for its own workforce. This policy
          explains what data the app handles, why, who processes it, how long
          it is kept, and what rights you have.
        </P>

        <H2>Who we are</H2>
        <P>
          Cognirise operates The Atelier for its own internal business use.
          For anything related to your data or this policy, contact{" "}
          <a className="underline" href="mailto:support@cognirise.ai">
            support@cognirise.ai
          </a>
          .
        </P>

        <H2>What data we collect</H2>
        <ul className="mb-3 list-disc pl-5">
          <Li>
            <strong>Account &amp; profile data</strong> — your name, work
            email, job title, role, profile photo, and business contact
            details used for your digital business card.
          </Li>
          <Li>
            <strong>Work content</strong> — client accounts, opportunities,
            engagements, meetings, tasks, notes, and documents created in the
            portal.
          </Li>
          <Li>
            <strong>Expenses &amp; receipts</strong> — expense claims,
            including receipt photos captured with your device camera or
            attached from your photo library, and invoice PDFs.
          </Li>
          <Li>
            <strong>Calendar &amp; email metadata (optional)</strong> — if you
            connect Microsoft 365, we read your calendar and send meeting
            invitations on your behalf through Microsoft Graph. Connecting is
            optional and you can disconnect at any time.
          </Li>
          <Li>
            <strong>HR &amp; personal documents</strong> — documents your
            employer holds about you (employment contract, payslips, identity
            documents) are viewable by you and authorised HR staff under
            strict role-based access controls.
          </Li>
          <Li>
            <strong>Chat with the AI assistant</strong> — messages and
            attachments you send to the built-in assistant.
          </Li>
          <Li>
            <strong>Technical data</strong> — login events, hashed session
            tokens, IP addresses in security audit logs, and standard server
            logs needed to keep the service secure.
          </Li>
        </ul>
        <P>
          We do <strong>not</strong> collect location data, and the app
          contains no advertising, analytics, or tracking SDKs.
        </P>

        <H2>How we use your data</H2>
        <ul className="mb-3 list-disc pl-5">
          <Li>
            To provide the portal's features: CRM, expenses, calendar,
            documents, chat, and self-service HR.
          </Li>
          <Li>
            To secure the service: authentication, session management, rate
            limiting, and audit logging.
          </Li>
          <Li>
            To operate the AI assistant and document search: your queries and
            relevant excerpts of firm documents are processed by our AI
            providers solely to answer your requests, under business terms
            that do not permit training on our data.
          </Li>
          <Li>
            We never sell your data, share it with data brokers, or use it for
            advertising.
          </Li>
        </ul>

        <H2>Third-party processors</H2>
        <div className="mb-3 overflow-hidden rounded border border-border">
          {PROCESSORS.map(([name, purpose]) => (
            <div
              key={name}
              className="flex flex-col gap-0.5 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <span className="text-sm font-medium text-text">{name}</span>
              <span className="text-sm text-text-faint">{purpose}</span>
            </div>
          ))}
        </div>

        <H2>Retention</H2>
        <ul className="mb-3 list-disc pl-5">
          <Li>
            Business records are retained for as long as Cognirise needs them
            for its business and legal obligations.
          </Li>
          <Li>
            Receipt scans: the raw machine-read (OCR) payload extracted from a
            receipt is automatically redacted 90 days after processing; the
            expense record and its summary are kept for accounting purposes.
          </Li>
          <Li>
            Login sessions expire automatically after 7 days; expired sessions
            are deleted.
          </Li>
          <Li>
            When an account is deactivated, its login is disabled immediately
            and all active sessions are revoked.
          </Li>
        </ul>

        <H2>Security</H2>
        <ul className="mb-3 list-disc pl-5">
          <Li>
            All traffic is encrypted in transit (HTTPS/TLS). On mobile, your
            session token is stored in the operating system's secure keychain.
          </Li>
          <Li>
            Passwords are stored only as salted scrypt hashes; session tokens
            are stored only as SHA-256 digests.
          </Li>
          <Li>
            Access to data is governed by role-based access controls and
            database-level row security; sensitive HR and financial data is
            restricted to authorised roles.
          </Li>
          <Li>
            Security-relevant actions are written to an audit log.
          </Li>
        </ul>

        <H2>Your rights</H2>
        <P>
          Depending on where you are located, you may have rights to access,
          correct, export, or delete your personal data, and to object to or
          restrict certain processing. Because your account is provided by
          your employer, some requests are handled through Cognirise's HR
          processes. To exercise any right, email{" "}
          <a className="underline" href="mailto:support@cognirise.ai">
            support@cognirise.ai
          </a>{" "}
          — we respond within 30 days.
        </P>
        <P>
          Accounts cannot be created or deleted from within the app; they are
          provisioned and removed by Cognirise. If you leave the firm, your
          access is revoked and your personal data is handled according to
          Cognirise's employment-records retention obligations.
        </P>

        <H2>Children</H2>
        <P>
          The Atelier is a workplace tool for Cognirise's workforce and is not
          directed at, or available to, children.
        </P>

        <H2>Changes to this policy</H2>
        <P>
          If we materially change this policy, we will update the effective
          date above and notify users inside the portal.
        </P>

        <H2>Contact</H2>
        <P>
          Questions or requests:{" "}
          <a className="underline" href="mailto:support@cognirise.ai">
            support@cognirise.ai
          </a>
        </P>

        <div className="mt-10 border-t border-border pt-4 text-xs text-text-faint">
          © 2026 Cognirise ·{" "}
          <a className="underline" href="/support">
            Support
          </a>
        </div>
      </div>
    </div>
  );
}
