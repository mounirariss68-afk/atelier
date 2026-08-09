import * as React from "react";
import { SectionHead } from "@/components/ui/primitives";
import Logo from "@/components/ui/Logo";
import { useAuth, type AuthUser } from "@/lib/auth";

/**
 * Task #1 — real email + password login. Replaces the old persona-picker
 * mock sign-in. On success the AuthProvider flips to authenticated and a
 * full reload lands on Home with a fresh cache.
 */
export default function SignIn() {
  const { setAuthenticated } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Task #821 — two-step login: when 2FA is enabled the password step
  // returns a short-lived challenge and we ask for an authenticator code.
  const [challenge, setChallenge] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");

  const finishLogin = (
    j: { user?: AuthUser; twoFactorEnrollRequired?: boolean } | null,
    status: number,
    r: boolean,
  ) => {
    if (r && j?.user) {
      // Task #821 — firm policy asks this role to enrol in 2FA: flag it so
      // the shell opens the setup dialog after the reload.
      if (j.twoFactorEnrollRequired) {
        try {
          sessionStorage.setItem("atelier-2fa-nudge", "1");
        } catch {
          // storage unavailable — skip the nudge
        }
      }
      setAuthenticated(j.user);
      // Full reload so every query refetches under the new session.
      window.location.replace("/");
      return true;
    }
    return false;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const j = (await r.json().catch(() => null)) as
        | { user?: AuthUser; message?: string; twoFactorRequired?: boolean; challenge?: string }
        | null;
      if (r.ok && j?.twoFactorRequired && j.challenge) {
        setChallenge(j.challenge);
        setCode("");
        return;
      }
      if (finishLogin(j, r.status, r.ok)) return;
      setError(
        r.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : "Incorrect email or password.",
      );
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login/2fa", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge, code: code.trim() }),
      });
      const j = (await r.json().catch(() => null)) as
        | { user?: AuthUser; message?: string; error?: string }
        | null;
      if (finishLogin(j, r.status, r.ok)) return;
      if (j?.error === "challenge-expired") {
        setChallenge(null);
        setPassword("");
        setError("Sign-in expired. Enter your email and password again.");
        return;
      }
      setError(
        r.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : (j?.message ?? "That code is incorrect or already used."),
      );
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center py-20 px-4">
        <div className="w-full max-w-sm space-y-10">
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <Logo variant="mark" size="lg" />
            </div>
            <SectionHead
              headline={<>Two-factor <em className="accent">verification</em></>}
              lede="Enter the 6-digit code from your authenticator app, or one of your backup codes."
              className="flex flex-col items-center text-center"
            />
          </div>
          <form onSubmit={submitCode} className="space-y-4" data-testid="signin-2fa-form">
            <div className="space-y-1.5">
              <label
                htmlFor="signin-2fa-code"
                className="block text-xs font-mono uppercase tracking-wider text-text-faint"
              >
                Verification code
              </label>
              <input
                id="signin-2fa-code"
                data-testid="input-2fa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full rounded-md border border-border bg-bg-elevate px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold tracking-widest"
                placeholder="123 456"
              />
            </div>
            {error && (
              <p data-testid="signin-error" className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              data-testid="button-verify-2fa"
              disabled={busy}
              className="w-full rounded-md bg-gold text-bg font-semibold text-sm py-2.5 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify and sign in"}
            </button>
            <button
              type="button"
              data-testid="button-2fa-back"
              onClick={() => {
                setChallenge(null);
                setError(null);
              }}
              className="w-full text-xs text-text-faint underline underline-offset-4 hover:text-gold"
            >
              Back to sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center py-20 px-4">
      <div className="w-full max-w-sm space-y-10">
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <Logo variant="mark" size="lg" />
          </div>
          <SectionHead
            headline={<>Sign in to <em className="accent">The Atelier</em></>}
            lede="Cognirise employee portal"
            className="flex flex-col items-center text-center"
          />
        </div>

        <form onSubmit={submit} className="space-y-4" data-testid="signin-form">
          <div className="space-y-1.5">
            <label
              htmlFor="signin-email"
              className="block text-xs font-mono uppercase tracking-wider text-text-faint"
            >
              Email
            </label>
            <input
              id="signin-email"
              data-testid="input-email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-elevate px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold"
              placeholder="you@cognirise.ai"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="signin-password"
              className="block text-xs font-mono uppercase tracking-wider text-text-faint"
            >
              Password
            </label>
            <input
              id="signin-password"
              data-testid="input-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-elevate px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold"
              placeholder="••••••••••••"
            />
          </div>

          {error && (
            <p
              data-testid="signin-error"
              className="text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          )}

          <p className="text-right">
            <a
              href="/reset-password"
              className="text-xs text-text-faint underline underline-offset-4 hover:text-gold"
              data-testid="link-forgot-password"
            >
              Forgot password?
            </a>
          </p>

          <button
            type="submit"
            data-testid="button-signin"
            disabled={busy}
            className="w-full rounded-md bg-gold text-bg font-semibold text-sm py-2.5 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-text-faint">
          Access is restricted to Cognirise partners.
        </p>
      </div>
    </div>
  );
}
