import * as React from "react";
import Logo from "@/components/ui/Logo";

/**
 * Public support page — App Store submission requirement.
 * Rendered pre-auth (the AuthGate special-cases /support).
 */
export default function Support() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-8 flex items-center gap-3">
          <Logo variant="themed" />
        </div>
        <h1 className="text-2xl font-semibold text-text">Support</h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-widest text-text-faint">
          The Atelier — Cognirise
        </p>

        <p className="mt-6 text-sm leading-relaxed text-text">
          The Atelier is Cognirise's internal portal for its partners,
          employees, and contractors. Accounts are provisioned by the firm —
          there is no public sign-up.
        </p>

        <h2 className="mt-8 mb-2 font-mono text-xs uppercase tracking-widest text-text-faint">
          Contact us
        </h2>
        <p className="mb-3 text-sm leading-relaxed text-text">
          For help with the web portal or the Atelier mobile app, email{" "}
          <a className="underline" href="mailto:support@cognirise.ai">
            support@cognirise.ai
          </a>
          .
        </p>

        <h2 className="mt-8 mb-2 font-mono text-xs uppercase tracking-widest text-text-faint">
          What to include in your request
        </h2>
        <ul className="mb-3 list-disc pl-5">
          <li className="mb-1.5 text-sm leading-relaxed text-text">
            Your name and the email address of your Atelier account
          </li>
          <li className="mb-1.5 text-sm leading-relaxed text-text">
            Whether you are using the web portal or the iOS app (and the app
            version, if known)
          </li>
          <li className="mb-1.5 text-sm leading-relaxed text-text">
            A short description of the problem, what you expected to happen,
            and any error message you saw
          </li>
          <li className="mb-1.5 text-sm leading-relaxed text-text">
            A screenshot, if it helps show the issue
          </li>
        </ul>

        <h2 className="mt-8 mb-2 font-mono text-xs uppercase tracking-widest text-text-faint">
          What to expect
        </h2>
        <p className="mb-3 text-sm leading-relaxed text-text">
          We acknowledge support requests within one business day and aim to
          resolve most issues within three business days. Account access
          issues (locked-out logins, password resets) are prioritised.
        </p>

        <div className="mt-10 border-t border-border pt-4 text-xs text-text-faint">
          © 2026 Cognirise ·{" "}
          <a className="underline" href="/privacypolicy">
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  );
}
