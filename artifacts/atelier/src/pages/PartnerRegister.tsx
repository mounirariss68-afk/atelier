import * as React from "react";
import { SectionHead } from "@/components/ui/primitives";
import Logo from "@/components/ui/Logo";

/**
 * Task #874 — public, token-gated partner registration.
 *
 * A signed partner firm's invited user follows a single-use, 72-hour
 * registration link from their email to this page. In one flow they:
 *  1. confirm the firm's company legal details (saved to the firm record),
 *  2. submit bank details for payments (PENDING until finance approves), and
 *  3. choose their own password.
 *
 * Rendered pre-auth (the AuthGate special-cases /partner-register). The
 * page itself validates the token via /api/auth/partner-register-info.
 */
export default function PartnerRegister() {
  const token = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("token") ?? "";
    } catch {
      return "";
    }
  }, []);

  const [info, setInfo] = React.useState<{
    email: string;
    firm: {
      name: string;
      legalName: string | null;
      registrationNumber: string | null;
      taxId: string | null;
      registeredAddress: string | null;
      defaultCurrency: string | null;
    };
  } | null>(null);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Company details
  const [legalName, setLegalName] = React.useState("");
  const [registrationNumber, setRegistrationNumber] = React.useState("");
  const [taxId, setTaxId] = React.useState("");
  const [registeredAddress, setRegisteredAddress] = React.useState("");
  // Bank details
  const [iban, setIban] = React.useState("");
  const [swift, setSwift] = React.useState("");
  const [bankName, setBankName] = React.useState("");
  const [currency, setCurrency] = React.useState("");
  // Password
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (!token) {
      setInvalid("This registration link is missing its token.");
      setLoading(false);
      return;
    }
    fetch(`/api/auth/partner-register-info?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as
          | {
              ok?: boolean;
              email?: string;
              message?: string;
              firm?: {
                name: string;
                legalName: string | null;
                registrationNumber: string | null;
                taxId: string | null;
                registeredAddress: string | null;
                defaultCurrency: string | null;
              };
            }
          | null;
        if (r.ok && j?.email && j.firm) {
          setInfo({ email: j.email, firm: j.firm });
          setLegalName(j.firm.legalName ?? j.firm.name ?? "");
          setRegistrationNumber(j.firm.registrationNumber ?? "");
          setTaxId(j.firm.taxId ?? "");
          setRegisteredAddress(j.firm.registeredAddress ?? "");
          setCurrency(j.firm.defaultCurrency ?? "");
        } else {
          setInvalid(j?.message ?? "This registration link is invalid, expired, or already used.");
        }
      })
      .catch(() => setInvalid("Could not reach the server. Please try again."))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!legalName.trim()) return setError("Company legal name is required.");
    const ibanNorm = iban.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{8,34}$/.test(ibanNorm)) return setError("Enter a valid IBAN (8–34 characters, letters and digits).");
    if (!bankName.trim()) return setError("Bank name is required.");
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) return setError("Currency must be a 3-letter code (e.g. AED, USD).");
    if (password.length < 10) return setError("Password must be at least 10 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const r = await fetch("/api/auth/partner-register", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: password,
          company: {
            legalName: legalName.trim(),
            registrationNumber: registrationNumber.trim() || null,
            taxId: taxId.trim() || null,
            registeredAddress: registeredAddress.trim() || null,
          },
          bank: {
            iban: ibanNorm,
            swift: swift.trim() || null,
            bankName: bankName.trim(),
            currency: currency.trim().toUpperCase(),
          },
        }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (r.ok && j?.ok) {
        setDone(true);
        return;
      }
      setError(
        r.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : (j?.message ?? "Registration failed. Ask your Cognirise contact for a new link."),
      );
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full bg-bg-elevate border border-border-soft rounded px-3 py-2 text-text text-sm focus:outline-none focus:ring-1 focus:ring-gold/40";
  const labelCls = "block text-xs font-mono uppercase tracking-wider text-text-faint";
  const headCls = "text-xs font-mono uppercase tracking-widest text-gold";

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    opts?: { required?: boolean; placeholder?: string; hint?: string; type?: string; autoComplete?: string },
  ) => (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelCls}>
        {label}
        {opts?.required ? " *" : ""}
      </label>
      <input
        id={id}
        data-testid={`input-${id}`}
        type={opts?.type ?? "text"}
        required={opts?.required}
        placeholder={opts?.placeholder}
        autoComplete={opts?.autoComplete ?? "off"}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={inputCls}
      />
      {opts?.hint && <p className="text-[11px] text-text-faint">{opts.hint}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col items-center py-16 px-4">
      <div className="w-full max-w-md space-y-10">
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <Logo variant="mark" size="lg" />
          </div>
          <SectionHead
            headline={<>Register your firm on the <em className="accent">partner portal</em></>}
            lede="Cognirise alliance partners"
            className="flex flex-col items-center text-center"
          />
        </div>

        {loading && (
          <p className="text-center font-mono text-xs uppercase tracking-widest text-text-faint">
            Checking your registration link…
          </p>
        )}

        {!loading && invalid && (
          <div className="space-y-4 text-center" data-testid="partner-register-invalid">
            <p className="text-sm text-text-mute">{invalid}</p>
            <a href="/sign-in" className="text-sm text-gold underline underline-offset-4">
              Go to sign in
            </a>
          </div>
        )}

        {!loading && !invalid && done && (
          <div className="space-y-4 text-center" data-testid="partner-register-done">
            <p className="text-sm text-text-mute">
              Registration complete. Your company details were saved, and your bank details were
              submitted for review by the Cognirise finance team. Sign in with your email and the
              password you just chose.
            </p>
            <a
              href="/sign-in"
              className="inline-block bg-gold text-bg font-medium rounded px-6 py-2 text-sm"
              data-testid="partner-register-goto-signin"
            >
              Sign in
            </a>
          </div>
        )}

        {!loading && !invalid && !done && info && (
          <form onSubmit={submit} className="space-y-6" data-testid="partner-register-form">
            <p className="text-sm text-text-mute text-center">
              Registering <span className="text-text font-medium">{info.firm.name}</span> as{" "}
              <span className="text-text font-medium">{info.email}</span>.
            </p>

            <div className="space-y-4">
              <div className={headCls}>Company details</div>
              {field("legal-name", "Legal name", legalName, setLegalName, { required: true })}
              {field("registration-number", "Registration number", registrationNumber, setRegistrationNumber)}
              {field("tax-id", "Tax / VAT ID", taxId, setTaxId)}
              <div className="space-y-1.5">
                <label htmlFor="registered-address" className={labelCls}>
                  Registered address
                </label>
                <textarea
                  id="registered-address"
                  data-testid="input-registered-address"
                  rows={2}
                  value={registeredAddress}
                  onChange={(e) => setRegisteredAddress(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className={headCls}>Bank details</div>
              <p className="text-[11px] text-text-faint">
                Bank details are reviewed and approved by the Cognirise finance team before any
                payment is made.
              </p>
              {field("iban", "IBAN", iban, setIban, { required: true })}
              {field("swift", "SWIFT / BIC", swift, setSwift)}
              {field("bank-name", "Bank name", bankName, setBankName, { required: true })}
              {field("currency", "Currency", currency, setCurrency, {
                required: true,
                placeholder: "e.g. AED",
                hint: "3-letter code.",
              })}
            </div>

            <div className="space-y-4">
              <div className={headCls}>Choose your password</div>
              {field("password", "New password", password, setPassword, {
                required: true,
                type: "password",
                autoComplete: "new-password",
                hint: "At least 10 characters.",
              })}
              {field("confirm", "Confirm password", confirm, setConfirm, {
                required: true,
                type: "password",
                autoComplete: "new-password",
              })}
            </div>

            {error && (
              <p className="text-sm text-danger" data-testid="partner-register-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-gold text-bg font-medium rounded px-6 py-2 text-sm disabled:opacity-50"
              data-testid="button-partner-register-submit"
            >
              {busy ? "Submitting…" : "Complete registration"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
