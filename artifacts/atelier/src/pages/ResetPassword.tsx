import * as React from "react";
import { SectionHead } from "@/components/ui/primitives";
import Logo from "@/components/ui/Logo";

/**
 * Task #820 — self-service password reset. Rendered pre-auth (the AuthGate
 * special-cases /reset-password).
 *
 * Two modes:
 *   - no ?token: "forgot password" request form (always says a link was
 *     sent if the account exists — non-enumerating).
 *   - with ?token: validates the single-use reset link and lets the user
 *     choose a new password.
 */
export default function ResetPassword() {
  const token = React.useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("token") ?? "";
    } catch {
      return "";
    }
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center py-20 px-4">
      <div className="w-full max-w-sm space-y-10">
        <div className="text-center space-y-6">
          <div className="flex justify-center">
            <Logo variant="mark" size="lg" />
          </div>
          <SectionHead
            headline={<>Reset your <em className="accent">Atelier</em> password</>}
            lede="Cognirise employee portal"
            className="flex flex-col items-center text-center"
          />
        </div>
        {token ? <SetNewPassword token={token} /> : <RequestReset />}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg-elevate px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-gold";
const labelCls = "block text-xs font-mono uppercase tracking-wider text-text-faint";
const buttonCls =
  "w-full rounded-md bg-gold text-bg font-semibold text-sm py-2.5 transition-opacity hover:opacity-90 disabled:opacity-50";

function RequestReset() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/forgot-password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (r.ok) {
        setSent(true);
      } else if (r.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else {
        setError("Enter a valid email address.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-4 text-center" data-testid="reset-request-sent">
        <p className="text-sm text-text-mute">
          If an account exists for <span className="text-text">{email.trim()}</span>, a reset link
          is on its way. The link is valid for 60 minutes and can be used once.
        </p>
        <a href="/sign-in" className="text-sm text-gold underline underline-offset-4">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="reset-request-form">
      <p className="text-sm text-text-mute text-center">
        Enter your work email and we'll send you a single-use link to choose a new password.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="reset-email" className={labelCls}>
          Email
        </label>
        <input
          id="reset-email"
          data-testid="input-reset-email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
          placeholder="you@cognirise.ai"
        />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert" data-testid="reset-request-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={buttonCls} data-testid="button-request-reset">
        {busy ? "Sending…" : "Send reset link"}
      </button>
      <p className="text-center">
        <a href="/sign-in" className="text-xs text-text-faint underline underline-offset-4">
          Back to sign in
        </a>
      </p>
    </form>
  );
}

function SetNewPassword({ token }: { token: string }) {
  const [info, setInfo] = React.useState<{ email: string } | null>(null);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    fetch(`/api/auth/reset-info?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as
          | { ok?: boolean; email?: string; message?: string }
          | null;
        if (r.ok && j?.email) setInfo({ email: j.email });
        else setInvalid(j?.message ?? "This reset link is invalid, expired, or already used.");
      })
      .catch(() => setInvalid("Could not reach the server. Please try again."))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (r.ok && j?.ok) {
        setDone(true);
        return;
      }
      setError(
        r.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : (j?.message ?? "Reset failed. Request a new link from the sign-in page."),
      );
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p className="text-center font-mono text-xs uppercase tracking-widest text-text-faint">
        Checking your reset link…
      </p>
    );
  }
  if (invalid) {
    return (
      <div className="space-y-4 text-center" data-testid="reset-invalid">
        <p className="text-sm text-text-mute">{invalid}</p>
        <a href="/reset-password" className="text-sm text-gold underline underline-offset-4">
          Request a new link
        </a>
      </div>
    );
  }
  if (done) {
    return (
      <div className="space-y-4 text-center" data-testid="reset-done">
        <p className="text-sm text-text-mute">
          Your password is set. Sign in with your email and your new password.
        </p>
        <a
          href="/sign-in"
          className="inline-block bg-gold text-bg font-medium rounded px-6 py-2 text-sm"
          data-testid="reset-goto-signin"
        >
          Go to sign in
        </a>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="reset-set-form">
      <p className="text-sm text-text-mute text-center">
        Choose a new password for <span className="text-text">{info?.email}</span>.
      </p>
      <div className="space-y-1.5">
        <label htmlFor="reset-new-password" className={labelCls}>
          New password
        </label>
        <input
          id="reset-new-password"
          data-testid="input-new-password"
          type="password"
          required
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          placeholder="••••••••••••"
        />
        <p className="text-[11px] text-text-faint">
          At least 10 characters, including a letter and a number.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="reset-confirm-password" className={labelCls}>
          Confirm password
        </label>
        <input
          id="reset-confirm-password"
          data-testid="input-confirm-password"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputCls}
          placeholder="••••••••••••"
        />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert" data-testid="reset-set-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={buttonCls} data-testid="button-set-password">
        {busy ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}
